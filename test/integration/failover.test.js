// The graceful-degradation invariant, end-to-end over a real swarm:
// kill the provider MID-STREAM and the listener still hears the full sentence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import createTestnet from 'hyperdht/testnet.js'
import { ProviderNode } from '../../lib/provider.js'
import { InferenceRouter, STATES } from '../../lib/router.js'
import { SimEngine } from '../../lib/engines/sim.js'
import { buildHistory, VERBOSITY, FOCUS } from '../../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../../lib/match.js'

const EVENT = new MatchSimulator({ seed: 60 }).all().find(e => e.side)
// rich = 3 sentences → enough tokens to kill the provider mid-stream
const HISTORY = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT, focus: FOCUS.DEFENSE, verbosity: VERBOSITY.RICH })

function withTimeout (promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms).unref?.())
  ])
}

test('provider dies mid-stream → token-exact local resume, state FALLBACK', async (t) => {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({ matchId: 'itg-failover', engine: new SimEngine({ tps: 25 }), bootstrap: tn.bootstrap })
  await provider.start()
  const localEngine = new SimEngine({ tps: 2000 })
  const router = new InferenceRouter({ matchId: 'itg-failover', engine: localEngine, bootstrap: tn.bootstrap, tokenGapTimeoutMs: 4000 })
  await router.start()
  t.after(async () => {
    await router.stop().catch(() => {})
    await tn.destroy()
  })
  if (router.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => router.once('provider', res)), 20_000, 'discovery')

  // ground truth: what an uninterrupted generation would say
  await localEngine.load()
  const ref = localEngine.complete({ history: HISTORY, seed: 99 })
  let expected = ''
  for await (const tkn of ref.tokenStream) expected += tkn

  const failover = new Promise(resolve => router.once('failover', resolve))
  const { stream, result } = router.complete({ history: HISTORY, seed: 99 })
  let received = ''
  const sources = new Set()
  let offloadedCount = 0
  let killed = false
  for await (const c of stream) {
    received += c.token
    sources.add(c.source)
    if (c.source === 'offloaded') offloadedCount++
    if (!killed && offloadedCount === 4) {
      killed = true
      await provider.stop() // hard death mid-sentence
    }
  }
  const summary = await result
  const fo = await withTimeout(failover, 5000, 'failover event')

  assert.equal(killed, true, 'provider was killed mid-stream')
  assert.deepEqual([...sources].sort(), ['local', 'offloaded'], 'stream mixed remote + local tokens')
  assert.equal(fo.received, 4)
  assert.equal(summary.resumed, true)
  assert.equal(summary.restarted, false)
  assert.deepEqual(summary.sources, ['offloaded', 'local'])
  assert.equal(received, expected, 'TOKEN-EXACT resume — full sentence intact')
  assert.equal(router.state.state, STATES.FALLBACK)
})

test('after failover the next segment generates locally without errors', async (t) => {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({ matchId: 'itg-after', engine: new SimEngine({ tps: 25 }), bootstrap: tn.bootstrap })
  await provider.start()
  const router = new InferenceRouter({ matchId: 'itg-after', engine: new SimEngine({ tps: 2000 }), bootstrap: tn.bootstrap, tokenGapTimeoutMs: 4000 })
  await router.start()
  t.after(async () => {
    await router.stop().catch(() => {})
    await tn.destroy()
  })
  if (router.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => router.once('provider', res)), 20_000, 'discovery')

  const first = router.complete({ history: HISTORY, seed: 1 })
  let n = 0
  for await (const _ of first.stream) {  
    if (++n === 3) await provider.stop()
  }
  await first.result

  const second = router.complete({ history: HISTORY, seed: 2 })
  let text = ''
  for await (const c of second.stream) {
    assert.equal(c.source, 'local')
    text += c.token
  }
  const summary = await second.result
  assert.equal(summary.source, 'local')
  assert.ok(text.length > 0)
  assert.equal(router.state.state, STATES.FALLBACK)
})

test('provider returning after failover flips the client back to OFFLOADED', async (t) => {
  const tn = await createTestnet(3)
  const provider1 = new ProviderNode({ matchId: 'itg-recover', engine: new SimEngine({ tps: 400 }), bootstrap: tn.bootstrap })
  await provider1.start()
  const router = new InferenceRouter({ matchId: 'itg-recover', engine: new SimEngine({ tps: 2000 }), bootstrap: tn.bootstrap })
  await router.start()
  t.after(async () => {
    await router.stop().catch(() => {})
    await tn.destroy()
  })
  if (router.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => router.once('provider', res)), 20_000, 'discovery 1')

  const gone = new Promise(resolve => router.once('provider-gone', resolve))
  await provider1.stop()
  await withTimeout(gone, 15_000, 'provider-gone')
  assert.equal(router.state.state, STATES.FALLBACK)

  const provider2 = new ProviderNode({ matchId: 'itg-recover', engine: new SimEngine({ tps: 400 }), bootstrap: tn.bootstrap })
  await provider2.start()
  t.after(() => provider2.stop().catch(() => {}))
  if (router.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => router.once('provider', res)), 20_000, 'discovery 2')
  assert.equal(router.state.state, STATES.OFFLOADED)

  const { stream, result } = router.complete({ history: HISTORY, seed: 3 })
  for await (const c of stream) assert.equal(c.source, 'offloaded')
  assert.equal((await result).source, 'offloaded')
})

test('client cancel propagates to the provider (abort over the wire)', async (t) => {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({ matchId: 'itg-cancel', engine: new SimEngine({ tps: 20 }), bootstrap: tn.bootstrap })
  await provider.start()
  const router = new InferenceRouter({ matchId: 'itg-cancel', engine: new SimEngine({ tps: 2000 }), bootstrap: tn.bootstrap })
  await router.start()
  t.after(async () => {
    await router.stop().catch(() => {})
    await provider.stop().catch(() => {})
    await tn.destroy()
  })
  if (router.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => router.once('provider', res)), 20_000, 'discovery')

  const ac = new AbortController()
  const { stream, result } = router.complete({ history: HISTORY, seed: 4, signal: ac.signal })
  const consume = (async () => {
    let n = 0
    for await (const _ of stream) {  
      if (++n === 2) ac.abort()
    }
  })()
  await assert.rejects(result, (err) => err.name === 'AbortError')
  await consume.catch(() => {})
  // provider abandons the aborted request (may take a beat for cancel frame)
  await withTimeout((async () => {
    while (provider.active.size > 0) await new Promise(r => setTimeout(r, 50))
  })(), 5000, 'provider cleared aborted request')
  assert.equal(provider.active.size, 0)
})

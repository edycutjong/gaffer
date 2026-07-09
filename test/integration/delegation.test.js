// Real P2P delegation over an in-process HyperDHT testnet — no mocks in the
// network path: real Hyperswarm sockets (Noise secretstream), real framing,
// real engines on both ends.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import createTestnet from 'hyperdht/testnet.js'
import { ProviderNode } from '../../lib/provider.js'
import { InferenceRouter, STATES } from '../../lib/router.js'
import { SimEngine } from '../../lib/engines/sim.js'
import { buildHistory } from '../../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../../lib/match.js'

const EVENT = new MatchSimulator({ seed: 44 }).all().find(e => e.side)
const HISTORY = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT })

function withTimeout (promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms).unref?.())
  ])
}

async function rig (t, { matchId, providerTps = 400, clientTps = 50 }) {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({ matchId, engine: new SimEngine({ tps: providerTps }), bootstrap: tn.bootstrap })
  await provider.start()
  const router = new InferenceRouter({ matchId, engine: new SimEngine({ tps: clientTps }), bootstrap: tn.bootstrap, tokenGapTimeoutMs: 4000 })
  await router.start()
  t.after(async () => {
    await router.stop().catch(() => {})
    await provider.stop().catch(() => {})
    await tn.destroy()
  })
  if (router.state.state !== STATES.OFFLOADED) {
    await withTimeout(new Promise(resolve => router.once('provider', resolve)), 20_000, 'provider discovery')
  }
  return { tn, provider, router }
}

test('client discovers the provider through the match topic and goes OFFLOADED', async (t) => {
  const { router } = await rig(t, { matchId: 'itg-discovery' })
  assert.equal(router.state.state, STATES.OFFLOADED)
  assert.ok(router.provider(), 'provider peer visible')
  assert.equal(router.provider().role, 'provider')
})

test('provider announces its engine and the client records connect latency', async (t) => {
  const { router } = await rig(t, { matchId: 'itg-announce' })
  const announce = router.provider().announce || await withTimeout(
    new Promise(resolve => router.once('announce', ({ announce }) => resolve(announce))), 10_000, 'announce')
  assert.equal(announce.engine, 'sim')
  const report = router.stats.report()
  assert.equal(report.connect.n, 1)
  assert.ok(report.connect.p50 >= 0)
})

test('a segment is genuinely generated on the provider and streamed back in order', async (t) => {
  const { provider, router } = await rig(t, { matchId: 'itg-segment' })
  const served = new Promise(resolve => provider.once('served', resolve))
  const { stream, result } = router.complete({ history: HISTORY, seed: 77 })
  const indices = []
  let text = ''
  for await (const c of stream) {
    indices.push(c.i)
    text += c.token
    assert.equal(c.source, 'offloaded')
  }
  const summary = await result
  const servedInfo = await withTimeout(served, 5000, 'provider served event')
  assert.equal(summary.source, 'offloaded')
  assert.equal(servedInfo.tokens, summary.tokens)
  assert.equal(provider.served, 1)
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b), 'token order strictly ascending')
  assert.ok(text.length > 0)
})

test('token-stream fidelity: offloaded text equals local same-seed text', async (t) => {
  const { router } = await rig(t, { matchId: 'itg-fidelity' })
  const { stream, result } = router.complete({ history: HISTORY, seed: 123 })
  let remoteText = ''
  for await (const c of stream) remoteText += c.token
  await result

  const local = new SimEngine({ tps: Infinity })
  await local.load()
  const lres = local.complete({ history: HISTORY, seed: 123 })
  let localText = ''
  for await (const tkn of lres.tokenStream) localText += tkn

  assert.equal(remoteText, localText)
})

test('offloaded throughput beats the weak client by a wide margin', async (t) => {
  const { router } = await rig(t, { matchId: 'itg-throughput', providerTps: 400, clientTps: 12 })
  // offloaded
  const off = router.complete({ history: HISTORY, seed: 5 })
  for await (const _ of off.stream) {} // eslint-disable-line no-empty
  const offSummary = await off.result

  // force local for comparison: same request through the local engine
  const local = new SimEngine({ tps: 12 })
  await local.load()
  const started = Date.now()
  const lres = local.complete({ history: HISTORY, seed: 5 })
  let n = 0
  for await (const _ of lres.tokenStream) n++  
  const localTps = n / ((Date.now() - started) / 1000)

  assert.ok(offSummary.tps > localTps * 2, `offloaded ${offSummary.tps} tok/s not >2× local ${localTps.toFixed(1)} tok/s`)
})

test('two clients can share one provider concurrently', async (t) => {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({ matchId: 'itg-multi', engine: new SimEngine({ tps: 300 }), bootstrap: tn.bootstrap })
  await provider.start()
  const mkClient = async () => {
    const r = new InferenceRouter({ matchId: 'itg-multi', engine: new SimEngine({ tps: 30 }), bootstrap: tn.bootstrap })
    await r.start()
    if (r.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => r.once('provider', res)), 20_000, 'discovery')
    return r
  }
  const [c1, c2] = await Promise.all([mkClient(), mkClient()])
  t.after(async () => {
    await c1.stop().catch(() => {})
    await c2.stop().catch(() => {})
    await provider.stop().catch(() => {})
    await tn.destroy()
  })
  const run = async (r, seed) => {
    const { stream, result } = r.complete({ history: HISTORY, seed })
    let text = ''
    for await (const c of stream) text += c.token
    return { summary: await result, text }
  }
  const [r1, r2] = await Promise.all([run(c1, 1), run(c2, 2)])
  assert.equal(r1.summary.source, 'offloaded')
  assert.equal(r2.summary.source, 'offloaded')
  assert.notEqual(r1.text, r2.text) // different seeds, both served
  assert.equal(provider.served, 2)
})

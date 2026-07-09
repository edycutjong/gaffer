// AUDIT round-2 regressions: hostile/degenerate client containment on the
// provider, and fast abort on the router (no gap-timeout wait).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import createTestnet from 'hyperdht/testnet.js'
import { ProviderNode } from '../../lib/provider.js'
import { InferenceRouter, STATES } from '../../lib/router.js'
import { GafferSwarm } from '../../lib/swarm.js'
import { SimEngine } from '../../lib/engines/sim.js'
import * as proto from '../../lib/protocol.js'
import { buildHistory, VERBOSITY } from '../../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../../lib/match.js'

const EVENT = new MatchSimulator({ seed: 71 }).all().find(e => e.side)
const HISTORY = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT, verbosity: VERBOSITY.RICH })

function withTimeout (promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms).unref?.())
  ])
}

/** Raw protocol client — lets the test send arbitrary frames to the provider. */
async function rawClient (matchId, bootstrap) {
  const swarm = new GafferSwarm({ matchId, role: proto.ROLES.CLIENT, bootstrap, identity: { engine: 'sim' } })
  const inbox = []
  const waiters = []
  swarm.on('message', ({ msg }) => {
    inbox.push(msg)
    for (const w of waiters.splice(0)) w()
  })
  const providerPeer = new Promise(resolve => swarm.on('peer', (p) => {
    if (p.role === proto.ROLES.PROVIDER) resolve(p)
  }))
  await swarm.join()
  const peer = await withTimeout(providerPeer, 20_000, 'raw client provider discovery')
  const waitFor = (pred, label) => withTimeout((async () => {
    for (;;) {
      const hit = inbox.find(pred)
      if (hit) return hit
      await new Promise(resolve => waiters.push(resolve))
    }
  })(), 10_000, label)
  return { swarm, peer, inbox, waitFor }
}

test('AUDIT: duplicate request ids are rejected, the original stream survives', async (t) => {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({ matchId: 'itg-dup', engine: new SimEngine({ tps: 30 }), bootstrap: tn.bootstrap })
  await provider.start()
  const client = await rawClient('itg-dup', tn.bootstrap)
  t.after(async () => {
    await client.swarm.destroy().catch(() => {})
    await provider.stop().catch(() => {})
    await tn.destroy()
  })

  client.peer.send(proto.req({ id: 'dup-1', history: HISTORY, seed: 1 }))
  await client.waitFor(m => m.t === 'tok' && m.id === 'dup-1', 'first token')
  client.peer.send(proto.req({ id: 'dup-1', history: HISTORY, seed: 2 })) // hostile duplicate

  const errFrame = await client.waitFor(m => m.t === 'err' && m.id === 'dup-1', 'duplicate rejected')
  assert.match(errFrame.message, /duplicate request id/)
  // the ORIGINAL stream still completes cleanly
  const end = await client.waitFor(m => m.t === 'end' && m.id === 'dup-1', 'original end')
  assert.ok(end.usage.tokens > 0)
  assert.equal(provider.served, 1)
})

test('AUDIT: per-peer concurrency cap answers "busy" instead of serving', async (t) => {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({
    matchId: 'itg-cap',
    engine: new SimEngine({ tps: 10 }), // slow → requests stay concurrent
    bootstrap: tn.bootstrap,
    maxConcurrentPerPeer: 2
  })
  await provider.start()
  const client = await rawClient('itg-cap', tn.bootstrap)
  t.after(async () => {
    await client.swarm.destroy().catch(() => {})
    await provider.stop().catch(() => {})
    await tn.destroy()
  })

  client.peer.send(proto.req({ id: 'c1', history: HISTORY, seed: 1 }))
  client.peer.send(proto.req({ id: 'c2', history: HISTORY, seed: 2 }))
  client.peer.send(proto.req({ id: 'c3', history: HISTORY, seed: 3 })) // over the cap

  const busy = await client.waitFor(m => m.t === 'err' && m.id === 'c3', 'third request rejected')
  assert.match(busy.message, /busy: max 2/)
  // both admitted requests still stream
  await client.waitFor(m => m.t === 'tok' && m.id === 'c1', 'c1 streams')
  await client.waitFor(m => m.t === 'tok' && m.id === 'c2', 'c2 streams')
})

test('AUDIT: abort between tokens rejects immediately, not after the gap timeout', async (t) => {
  const tn = await createTestnet(3)
  // 2 tok/s → 500ms between tokens; gap timeout deliberately huge
  const provider = new ProviderNode({ matchId: 'itg-fastabort', engine: new SimEngine({ tps: 2 }), bootstrap: tn.bootstrap })
  await provider.start()
  const router = new InferenceRouter({
    matchId: 'itg-fastabort',
    engine: new SimEngine({ tps: 2000 }),
    bootstrap: tn.bootstrap,
    tokenGapTimeoutMs: 60_000
  })
  await router.start()
  t.after(async () => {
    await router.stop().catch(() => {})
    await provider.stop().catch(() => {})
    await tn.destroy()
  })
  if (router.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => router.once('provider', res)), 20_000, 'discovery')

  const ac = new AbortController()
  const { stream, result } = router.complete({ history: HISTORY, seed: 9, signal: ac.signal })
  const consume = (async () => {
    for await (const _ of stream) break  
  })()
  await consume
  const abortedAt = Date.now()
  ac.abort() // mid-gap: next token is ~500ms away, gap timeout is 60s
  await assert.rejects(result, (err) => err.name === 'AbortError')
  const tookMs = Date.now() - abortedAt
  assert.ok(tookMs < 1500, `abort took ${tookMs}ms — must not wait for tokens or the gap timeout`)
  // provider frees the aborted slot (cancel frame)
  await withTimeout((async () => {
    while (provider.active.size > 0) await new Promise(r => setTimeout(r, 50))
  })(), 5000, 'provider slot freed')
})

test('AUDIT: un-awaited result promise does not raise unhandledRejection', async (t) => {
  const tn = await createTestnet(3)
  const provider = new ProviderNode({ matchId: 'itg-unhandled', engine: new SimEngine({ tps: 5 }), bootstrap: tn.bootstrap })
  await provider.start()
  const router = new InferenceRouter({ matchId: 'itg-unhandled', engine: new SimEngine({ tps: 2000 }), bootstrap: tn.bootstrap })
  await router.start()
  t.after(async () => {
    await router.stop().catch(() => {})
    await provider.stop().catch(() => {})
    await tn.destroy()
  })
  if (router.state.state !== STATES.OFFLOADED) await withTimeout(new Promise(res => router.once('provider', res)), 20_000, 'discovery')

  const unhandled = []
  const onUnhandled = (err) => unhandled.push(err)
  process.on('unhandledRejection', onUnhandled)
  t.after(() => process.off('unhandledRejection', onUnhandled))

  const ac = new AbortController()
  // consume ONLY the stream, never await `result` — the library must pre-handle it
  const { stream } = router.complete({ history: HISTORY, seed: 3, signal: ac.signal })
  await assert.rejects(async () => {
    let n = 0
    for await (const _ of stream) {  
      if (++n === 1) ac.abort()
    }
  }, (err) => err.name === 'AbortError')

  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(unhandled, [])
})

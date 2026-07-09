// Coverage: the two InferenceRouter remote-segment failure edges the live-swarm
// integration tests don't reach deterministically — a provider whose send()
// reports the socket already closed, and a provider that accepts the request but
// then goes silent past the token-gap timeout. Driven by calling _remoteSegment
// directly with a fake provider peer (a plain object, not the SDK, not a socket).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InferenceRouter, AsyncQueue, EVENTS } from '../lib/router.js'
import { SimEngine } from '../lib/engines/sim.js'
import { buildHistory } from '../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const EVENT = new MatchSimulator({ seed: 2 }).all().find(e => e.side)
const HISTORY = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT })

function standaloneRouter (opts = {}) {
  // p2p:false → no swarm is constructed; _remoteSegment only needs the router's
  // in-flight bookkeeping and tokenGapTimeoutMs, both present in this mode.
  return new InferenceRouter({ matchId: 'cov', engine: new SimEngine({ tps: Infinity }), p2p: false, ...opts })
}

test('_remoteSegment throws "socket already closed" when the provider send() returns false', async () => {
  const router = standaloneRouter()
  const provider = { send: () => false } // a dead socket: write is a no-op
  await assert.rejects(
    router._remoteSegment({ provider, history: HISTORY, seed: 1, maxTokens: null, signal: null, out: new AsyncQueue(), emitted: [] }),
    /provider socket already closed/
  )
  assert.equal(router._inflight.size, 0, 'the in-flight slot is cleaned up')
})

test('_remoteSegment fails the segment when the provider stalls past the token-gap timeout', async () => {
  const router = standaloneRouter({ tokenGapTimeoutMs: 25 })
  const sent = []
  const provider = { send: (m) => { sent.push(m); return true } } // accepts req, never delivers a token
  // The gap timer is unref()'d (in production the swarm holds the loop open); in
  // isolation we keep the loop alive ourselves so the timer actually fires.
  const keepAlive = setInterval(() => {}, 1000)
  try {
    await assert.rejects(
      router._remoteSegment({ provider, history: HISTORY, seed: 1, maxTokens: null, signal: null, out: new AsyncQueue(), emitted: [] }),
      /token gap exceeded 25ms/
    )
  } finally {
    clearInterval(keepAlive)
  }
  assert.equal(sent[0].t, 'req', 'the request was sent')
  assert.ok(sent.some(m => m.t === 'cancel'), 'the stalled request is cancelled on the way out')
  assert.equal(router._inflight.size, 0)
})

test('a NON-deterministic engine restarts (not resumes) locally after a mid-stream provider loss', async () => {
  // The live failover integration test uses the deterministic sim engine → the
  // token-exact RESUME path. A real LLM is non-deterministic, so the router must
  // RESTART the segment locally and flag it. We stand in a non-deterministic
  // engine (the flag drives router.js's decision — no @qvac/sdk involved) and a
  // provider whose socket is already closed to force the mid-stream failure.
  const engine = new SimEngine({ tps: Infinity })
  engine.deterministic = false
  await engine.load()
  const router = new InferenceRouter({ matchId: 'cov', engine, p2p: false })
  await router.start()
  router.state.dispatch(EVENTS.PROVIDER_UP) // LOCAL → OFFLOADED (precondition for offload)
  router.provider = () => ({ send: () => false }) // a dead provider socket → remote segment throws

  const { stream, result } = router.complete({ history: HISTORY, seed: 7 })
  let text = ''
  for await (const c of stream) text += c.token
  const summary = await result

  assert.equal(summary.restarted, true, 'segment was restarted locally')
  assert.equal(summary.resumed, false)
  assert.deepEqual(summary.sources, ['offloaded', 'local'])
  assert.ok(text.length > 0, 'the restart produced the full local segment')
  await router.stop()
})

test('the swarm handlers ignore non-provider peers coming and going', async () => {
  // p2p:true builds a real GafferSwarm (bootstrap:[] keeps it off the network);
  // we drive its 'peer'/'peer-gone' handlers directly with a client-role peer.
  const router = new InferenceRouter({ matchId: 'cov', engine: new SimEngine({ tps: Infinity }), bootstrap: [] })
  let providerSignals = 0
  router.on('provider', () => providerSignals++)
  router.on('provider-gone', () => providerSignals++)
  router.swarm.emit('peer', { role: 'client', shortKey: 'aa' }) // not a provider → early return
  router.swarm.emit('peer-gone', { role: 'client', shortKey: 'aa' }) // not a provider → early return
  assert.equal(providerSignals, 0)
  await router.stop()
})

test('_remoteSegment rejects when the provider streams a token out of order', async () => {
  const router = standaloneRouter()
  const provider = { send: () => true }
  const p = router._remoteSegment({ provider, history: HISTORY, seed: 1, maxTokens: null, signal: null, out: new AsyncQueue(), emitted: [] })
  const id = [...router._inflight.keys()][0]
  router._onMessage(provider, { t: 'tok', id, i: 3, token: 'x' }) // expected index 0, got 3
  await assert.rejects(p, /token order violated: expected 0, got 3/)
  assert.equal(router._inflight.size, 0)
})

test('stop() fails any segment still in flight', async () => {
  const router = standaloneRouter()
  await router.start()
  const q = new AsyncQueue()
  const consumer = (async () => { for await (const _ of q) { /* drain */ } })()
  router._inflight.set('stuck', { queue: q, provider: {} })
  await router.stop()
  await assert.rejects(consumer, /router stopped/)
  assert.equal(router._inflight.size, 0)
})

// Coverage: ProviderNode's serve-time error handling — an engine that throws
// mid-generation is reported back to the live peer as an `err` frame, and a
// rejection escaping _serve (e.g. a throwing app-level 'request' listener) is
// surfaced as an 'error' event rather than crashing the node. Driven by calling
// the methods directly with a fake peer; the engine is a plain fake (not the
// SDK). bootstrap:[] keeps the (unused) swarm off the network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProviderNode } from '../lib/provider.js'
import { buildHistory } from '../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const EVENT = new MatchSimulator({ seed: 8 }).all().find(e => e.side)
const HISTORY = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT })

function fakeEngine (overrides = {}) {
  return { kind: 'sim', modelId: 'fake', deterministic: true, tps: 1, loaded: true, async load () {}, ...overrides }
}
function fakePeer () {
  const sent = []
  return { sent, publicKey: 'cd'.repeat(32), conn: { destroyed: false }, send (m) { sent.push(m); return true } }
}
// A plain async iterable whose first pull rejects — models an engine failing
// mid-generation (no generator, so no empty-yield lint noise).
function throwingStream (err) {
  return { [Symbol.asyncIterator] () { return { next: () => Promise.reject(err) } } }
}

test('an engine that throws mid-stream is reported to the peer as an err frame', async () => {
  const engine = fakeEngine({
    complete () {
      return {
        modelId: 'fake',
        tokenStream: throwingStream(new Error('inference failed')),
        usage: () => ({ tokens: 0, ms: 1, tps: 0 })
      }
    }
  })
  const provider = new ProviderNode({ matchId: 'cov', engine, bootstrap: [] })
  const peer = fakePeer()
  await provider._serve(peer, { t: 'req', id: 'r1', history: HISTORY, seed: 1 })
  const errFrame = peer.sent.find(m => m.t === 'err')
  assert.ok(errFrame, 'the failure is surfaced as an err frame')
  assert.match(errFrame.message, /inference failed/)
  assert.equal(provider.active.size, 0, 'the request slot is released')
  await provider.stop()
})

test('the client-connect handler announces tps:null when the engine has no tps', async () => {
  const engine = { kind: 'sim', modelId: 'm', deterministic: true, loaded: true, async load () {} } // no tps field
  const provider = new ProviderNode({ matchId: 'cov', engine, bootstrap: [] })
  const peer = fakePeer()
  provider.swarm.emit('peer', peer) // drive the swarm 'peer' handler directly (no live socket)
  const announce = peer.sent.find(m => m.t === 'announce')
  assert.ok(announce)
  assert.equal(announce.tps, null) // engine.tps ?? null → null
  await provider.stop()
})

test('a rejection escaping _serve is emitted as "error", not thrown into the void', async () => {
  const provider = new ProviderNode({ matchId: 'cov', engine: fakeEngine(), bootstrap: [] })
  const errors = []
  provider.on('error', (e) => errors.push(e))
  provider.on('request', () => { throw new Error('bad request listener') }) // throws before _serve's try
  const peer = fakePeer()
  provider._onMessage(peer, { t: 'req', id: 'r2', history: HISTORY, seed: 1 })
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(errors.some(e => /bad request listener/.test(e.message)), 'the rejection became an error event')
  await provider.stop()
})

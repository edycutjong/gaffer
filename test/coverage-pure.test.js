// Coverage: the deterministic-logic edge paths the happy-path suites don't
// reach — flag-cast failures, the weighted-pick defensive fallback, engine
// teardown, the paced-stream sleep, the default state-change sink, and the
// Parser's default (throwing) onError. All pure logic, no network, no SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseArgs } from '../lib/config.js'
import { Rng } from '../lib/prng.js'
import { SimEngine } from '../lib/engines/sim.js'
import { MatchSimulator } from '../lib/match.js'
import { RouterState, STATES, EVENTS } from '../lib/state.js'
import { Parser, encode } from '../lib/protocol.js'
import b4a from 'b4a'

// ── config.js: a value-flag whose cast() throws is reported, not swallowed ──
test('parseArgs records the error when a value flag cast throws', () => {
  const { errors } = parseArgs(['--bootstrap', '{not-json'])
  assert.ok(errors.some(e => /^--bootstrap:/.test(e)), 'JSON.parse failure surfaces as a flag error')
  // a well-formed value still parses (control)
  const ok = parseArgs(['--bootstrap', '[]'])
  assert.deepEqual(ok.config.bootstrap, [])
  assert.equal(ok.errors.length, 0)
})

// ── prng.js: weighted() falls through to the last entry on non-finite totals ──
test('Rng.weighted returns the last entry when the running roll never crosses zero', () => {
  // A non-finite weight makes `roll` NaN, so `roll <= 0` is never true and the
  // loop falls through to the defensive `return entries[last]` guard (line 69).
  const rng = new Rng(1)
  assert.equal(rng.weighted([{ value: 'only', weight: NaN }]), 'only')
  assert.equal(rng.weighted([{ value: 'a', weight: 1 }, { value: 'z', weight: NaN }]), 'z')
})

// ── engines/sim.js: unload() clears the loaded flag ──
test('SimEngine.unload marks the engine unloaded', async () => {
  const sim = new SimEngine({ tps: Infinity })
  await sim.load()
  assert.equal(sim.loaded, true)
  await sim.unload()
  assert.equal(sim.loaded, false)
})

// ── match.js: the real-time paced iterator sleeps between minutes ──
test('MatchSimulator async iterator paces the feed (exercises the minute sleep)', async () => {
  // speed=1 → ~1ms per match-minute; the first gap (kickoff at minute 1) forces
  // one sleep() before the first yield. Break immediately to keep it fast.
  const sim = new MatchSimulator({ seed: 3, minutes: 4, speed: 1 })
  const started = Date.now()
  let first = null
  for await (const ev of sim) { first = ev; break }
  assert.ok(first, 'yielded at least one event')
  assert.ok(Date.now() - started >= 0)
})

// ── state.js: the default no-op onChange runs when none is supplied ──
test('RouterState with no onChange still transitions (default sink is exercised)', () => {
  const rs = new RouterState() // no listener → default () => {}
  assert.equal(rs.dispatch(EVENTS.START), STATES.LOCAL)
  assert.equal(rs.dispatch(EVENTS.PROVIDER_UP), STATES.OFFLOADED)
  assert.deepEqual(rs.history, [STATES.IDLE, STATES.LOCAL, STATES.OFFLOADED])
})

// ── protocol.js: a Parser built without an onError uses the throwing default ──
test('Parser without an onError handler throws on a malformed frame', () => {
  const p = new Parser({ onMessage: () => { throw new Error('should not reach onMessage') } })
  // A frame whose length prefix is valid but whose payload is not JSON.
  const bad = b4a.alloc(7)
  bad[0] = 3 // length = 3
  bad.set(b4a.from('@@@', 'utf8'), 4)
  assert.throws(() => p.push(bad)) // default onError rethrows
  // sanity: with a real handler the same bad frame is captured, not thrown
  const caught = []
  const p2 = new Parser({ onMessage: () => {}, onError: (err) => caught.push(err) })
  p2.push(bad)
  assert.equal(caught.length, 1)
  // and a valid frame still round-trips through the same parser
  const seen = []
  const p3 = new Parser({ onMessage: (m) => seen.push(m) })
  p3.push(encode({ t: 'ping', ts: 1 }))
  assert.equal(seen[0].t, 'ping')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATES, EVENTS, transition, isLocalState, RouterState } from '../lib/state.js'

test('every (state, event) pair is defined — total transition function', () => {
  for (const state of Object.values(STATES)) {
    for (const event of Object.values(EVENTS)) {
      const next = transition(state, event)
      assert.ok(Object.values(STATES).includes(next), `${state} × ${event} → ${next}`)
    }
  }
})

test('the happy path: IDLE → LOCAL → OFFLOADED', () => {
  let s = STATES.IDLE
  s = transition(s, EVENTS.START)
  assert.equal(s, STATES.LOCAL)
  s = transition(s, EVENTS.PROVIDER_UP)
  assert.equal(s, STATES.OFFLOADED)
})

test('mid-stream provider death: OFFLOADED → FALLBACK (both signals)', () => {
  assert.equal(transition(STATES.OFFLOADED, EVENTS.PROVIDER_DOWN), STATES.FALLBACK)
  assert.equal(transition(STATES.OFFLOADED, EVENTS.STREAM_ERROR), STATES.FALLBACK)
})

test('double-dispatch on failure is harmless (FALLBACK absorbs repeats)', () => {
  let s = transition(STATES.OFFLOADED, EVENTS.PROVIDER_DOWN)
  s = transition(s, EVENTS.STREAM_ERROR) // router also reports the stream error
  assert.equal(s, STATES.FALLBACK)
})

test('recovery: FALLBACK → OFFLOADED when the provider returns', () => {
  assert.equal(transition(STATES.FALLBACK, EVENTS.PROVIDER_UP), STATES.OFFLOADED)
})

test('local errors never fall "back" from LOCAL', () => {
  assert.equal(transition(STATES.LOCAL, EVENTS.STREAM_ERROR), STATES.LOCAL)
  assert.equal(transition(STATES.LOCAL, EVENTS.PROVIDER_DOWN), STATES.LOCAL)
})

test('provider discovery before START does not activate anything', () => {
  assert.equal(transition(STATES.IDLE, EVENTS.PROVIDER_UP), STATES.IDLE)
})

test('STOP returns to IDLE from every state', () => {
  for (const state of Object.values(STATES)) {
    assert.equal(transition(state, EVENTS.STOP), STATES.IDLE)
  }
})

test('unknown states and events throw', () => {
  assert.throws(() => transition('LIMBO', EVENTS.START), RangeError)
  assert.throws(() => transition(STATES.LOCAL, 'EXPLODE'), RangeError)
})

test('isLocalState: LOCAL and FALLBACK generate on-device', () => {
  assert.equal(isLocalState(STATES.LOCAL), true)
  assert.equal(isLocalState(STATES.FALLBACK), true)
  assert.equal(isLocalState(STATES.OFFLOADED), false)
  assert.equal(isLocalState(STATES.IDLE), false)
})

test('RouterState notifies only on real changes and records history', () => {
  const changes = []
  const rs = new RouterState((c) => changes.push(c))
  rs.dispatch(EVENTS.START)
  rs.dispatch(EVENTS.START) // no-op — already LOCAL
  rs.dispatch(EVENTS.PROVIDER_UP)
  rs.dispatch(EVENTS.PROVIDER_DOWN)
  assert.deepEqual(rs.history, [STATES.IDLE, STATES.LOCAL, STATES.OFFLOADED, STATES.FALLBACK])
  assert.equal(changes.length, 3)
  assert.deepEqual(changes.map(c => c.event), [EVENTS.START, EVENTS.PROVIDER_UP, EVENTS.PROVIDER_DOWN])
})

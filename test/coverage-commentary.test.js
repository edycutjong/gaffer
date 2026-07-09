// Coverage: CommentaryEngine's three error/pacing edges the main suite doesn't
// reach — a non-abort failure of the segment `result` (rethrown), a stream that
// errors while `result` still resolves (the error is swallowed, result wins),
// and a queued priority event whose drained re-entry throws (surfaced as an
// 'error' event, never a crash). The router is a plain dependency here, stubbed
// with a fake — no @qvac/sdk, no swarm.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CommentaryEngine } from '../lib/commentary.js'
import { AsyncQueue } from '../lib/router.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const EVENTS = new MatchSimulator({ seed: 21 }).all()
const NORMAL_EVENT = EVENTS.find(e => e.type === 'pass_chain') || EVENTS.find(e => e.side)
const PRIORITY_EVENT = EVENTS.find(e => e.priority && e.type !== 'kickoff') || EVENTS.find(e => e.priority)

const SUMMARY = { text: 'a settled line.', tokens: 3, ms: 1, tps: 3, source: 'local', sources: ['local'], resumed: false, restarted: false }

function emptyStream () { const q = new AsyncQueue(); q.end(); return q }

test('a non-abort failure of the segment result is rethrown (surfaced via onEventSettled)', async () => {
  const router = { complete: () => ({ stream: emptyStream(), result: Promise.reject(new Error('inference blew up')) }) }
  const commentary = new CommentaryEngine({ router, fixture: DEFAULT_FIXTURE, seed: 1 })
  // onEvent lets it throw upward…
  await assert.rejects(commentary.onEvent(NORMAL_EVENT), /inference blew up/)
  assert.equal(commentary.busy, false, 'busy is always cleared in finally')

  // …and onEventSettled turns the same throw into an 'error' event, not a crash.
  const errors = []
  commentary.on('error', (e) => errors.push(e))
  const out = await commentary.onEventSettled(NORMAL_EVENT)
  assert.equal(out, null)
  assert.match(errors[0].message, /inference blew up/)
})

test('a stream error is swallowed when the result still resolves (result is the source of truth)', async () => {
  const boomStream = { async * [Symbol.asyncIterator] () { yield { token: 'x' }; throw new Error('stream torn') } }
  const router = { complete: () => ({ stream: boomStream, result: Promise.resolve(SUMMARY) }) }
  const commentary = new CommentaryEngine({ router, fixture: DEFAULT_FIXTURE, seed: 1 })
  const ended = []
  commentary.on('segment-end', (s) => ended.push(s))
  const summary = await commentary.onEvent(NORMAL_EVENT)
  assert.equal(summary.text, SUMMARY.text, 'the resolved result wins over the torn stream')
  assert.equal(ended.length, 1)
  assert.equal(commentary.segments, 1)
})

test('a queued priority event whose drained re-entry throws is reported as an "error"', async () => {
  // Gate the first segment open so a priority event can queue behind it; make
  // the SECOND complete() throw, so draining the queued event rejects and the
  // setImmediate .catch(err => emit(error)) fires.
  let release
  let calls = 0
  const router = {
    complete () {
      calls++
      if (calls === 1) {
        let resolve
        const result = new Promise((r) => { resolve = r })
        release = () => resolve(SUMMARY)
        return { stream: emptyStream(), result }
      }
      throw new Error('drained segment failed')
    }
  }
  const commentary = new CommentaryEngine({ router, fixture: DEFAULT_FIXTURE, seed: 1 })
  const errors = []
  commentary.on('error', (e) => errors.push(e))

  const first = commentary.onEvent(NORMAL_EVENT) // starts segment #1, busy=true, awaiting the gated result
  await new Promise((r) => setImmediate(r))
  const queued = await commentary.onEvent(PRIORITY_EVENT) // busy → priority queues
  assert.equal(queued, null)

  release() // segment #1 completes → finally drains the priority event via setImmediate
  await first
  await new Promise((r) => setTimeout(r, 30)) // let the drained onEvent reject and emit

  assert.ok(errors.some(e => /drained segment failed/.test(e.message)), 'drain failure surfaced as an error event')
  assert.equal(commentary.busy, false)
})

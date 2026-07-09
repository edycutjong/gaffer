import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CommentaryEngine, FOCUS, VERBOSITY } from '../lib/commentary.js'
import { InferenceRouter } from '../lib/router.js'
import { SimEngine } from '../lib/engines/sim.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

async function makeRig ({ tps = Infinity, seed = 2026 } = {}) {
  const engine = new SimEngine({ tps })
  const router = new InferenceRouter({ matchId: 'test', engine, p2p: false })
  await router.start()
  const commentary = new CommentaryEngine({ router, fixture: DEFAULT_FIXTURE, seed })
  return { engine, router, commentary }
}

const EVENTS = new MatchSimulator({ seed: 21 }).all()
const NORMAL_EVENT = EVENTS.find(e => e.type === 'pass_chain')
const GOAL_EVENT = EVENTS.find(e => e.type === 'goal') || { ...NORMAL_EVENT, type: 'goal', priority: true, n: 999 }

test('one event produces one spoken segment with text', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  const summary = await commentary.onEvent(NORMAL_EVENT)
  assert.ok(summary.text.length > 0)
  assert.equal(commentary.segments, 1)
})

test('same seed → the whole broadcast is reproducible', async (t) => {
  const rig1 = await makeRig({ seed: 5 })
  const rig2 = await makeRig({ seed: 5 })
  t.after(() => rig1.router.stop())
  t.after(() => rig2.router.stop())
  const a = await rig1.commentary.onEvent(NORMAL_EVENT)
  const b = await rig2.commentary.onEvent(NORMAL_EVENT)
  assert.equal(a.text, b.text)
})

test('different base seeds → different commentary', async (t) => {
  const rig1 = await makeRig({ seed: 5 })
  const rig2 = await makeRig({ seed: 6 })
  t.after(() => rig1.router.stop())
  t.after(() => rig2.router.stop())
  const a = await rig1.commentary.onEvent(NORMAL_EVENT)
  const b = await rig2.commentary.onEvent(NORMAL_EVENT)
  assert.notEqual(a.text, b.text)
})

test('busy engine drops non-priority events (a pundit does not talk over themselves)', async (t) => {
  const { router, commentary } = await makeRig({ tps: 60 }) // slow enough to still be busy
  t.after(() => router.stop())
  const dropped = []
  commentary.on('dropped', (e) => dropped.push(e))
  const first = commentary.onEvent(NORMAL_EVENT)
  const second = await commentary.onEvent({ ...NORMAL_EVENT, n: 1001 })
  assert.equal(second, null)
  assert.equal(dropped.length, 1)
  await first
})

test('busy engine queues priority events and speaks them after', async (t) => {
  const { router, commentary } = await makeRig({ tps: 120 })
  t.after(() => router.stop())
  const spoken = []
  commentary.on('segment-end', (s) => spoken.push(s.event.type))
  const first = commentary.onEvent(NORMAL_EVENT)
  const queued = await commentary.onEvent(GOAL_EVENT)
  assert.equal(queued, null) // queued, not spoken synchronously
  await first
  await new Promise(resolve => commentary.once('segment-end', resolve))
  assert.deepEqual(spoken.sort(), [NORMAL_EVENT.type, 'goal'].sort())
})

test('pause drops non-priority but keeps priority events audible', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  commentary.pause()
  assert.equal(await commentary.onEvent(NORMAL_EVENT), null)
  const goal = await commentary.onEvent(GOAL_EVENT)
  assert.ok(goal.text.length > 0, 'goal must be spoken even while paused')
  commentary.resume()
  assert.ok(await commentary.onEvent({ ...NORMAL_EVENT, n: 1002 }))
})

test('focus and verbosity setters validate input', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  commentary.setFocus(FOCUS.ATTACK)
  commentary.setVerbosity(VERBOSITY.RICH)
  assert.throws(() => commentary.setFocus('midfield'), RangeError)
  assert.throws(() => commentary.setVerbosity('extreme'), RangeError)
})

test('changing focus changes the commentary for the same event', async (t) => {
  const rig1 = await makeRig({ seed: 9 })
  const rig2 = await makeRig({ seed: 9 })
  t.after(() => rig1.router.stop())
  t.after(() => rig2.router.stop())
  rig1.commentary.setFocus(FOCUS.ATTACK)
  rig2.commentary.setFocus(FOCUS.DEFENSE)
  const a = await rig1.commentary.onEvent(NORMAL_EVENT)
  const b = await rig2.commentary.onEvent(NORMAL_EVENT)
  assert.notEqual(a.text, b.text)
})

test('skip aborts the streaming segment', async (t) => {
  const { router, commentary } = await makeRig({ tps: 30 })
  t.after(() => router.stop())
  const skipped = new Promise(resolve => commentary.once('skipped', resolve))
  commentary.once('token', () => commentary.skip())
  const summary = await commentary.onEvent(NORMAL_EVENT)
  assert.equal(summary, null)
  await skipped
  assert.equal(commentary.busy, false)
})

test('recent context window never exceeds 8 exchanges', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  for (let i = 0; i < 12; i++) {
    await commentary.onEvent({ ...NORMAL_EVENT, n: 2000 + i })
  }
  assert.ok(commentary.recent.length <= 8)
})

test('run() narrates a full short match and reports segments + drops', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  const sim = new MatchSimulator({ seed: 30, minutes: 12, speed: 0 })
  const report = await commentary.run(sim)
  assert.ok(report.segments > 0)
  assert.equal(report.segments, commentary.segments)
  // full_time always narrated last
  assert.ok(commentary.recent.some(r => r.prompt.includes('full time')))
})

test('router errors surface as commentary "error" events, not crashes', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  const errors = []
  commentary.on('error', (e) => errors.push(e))
  router.complete = () => { throw new Error('engine exploded') }
  const out = await commentary.onEventSettled(NORMAL_EVENT)
  assert.equal(out, null)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /exploded/)
})

test('AUDIT: skip() while idle is a no-op — the next segment survives', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  commentary.skip() // stale skip pressed between segments
  const summary = await commentary.onEvent(NORMAL_EVENT)
  assert.ok(summary, 'segment must not be aborted by a stale skip')
  assert.ok(summary.text.length > 0)
  assert.equal(commentary.segments, 1)
})

test('AUDIT: a throwing speaker emits "error" but the segment still completes', async (t) => {
  const { router, commentary } = await makeRig()
  t.after(() => router.stop())
  commentary.speaker = { speak: async () => { throw new Error('tts exploded') } }
  const errors = []
  commentary.on('error', (e) => errors.push(e))
  const summary = await commentary.onEvent(NORMAL_EVENT)
  assert.ok(summary.text.length > 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /tts exploded/)
})

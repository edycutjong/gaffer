// Router in standalone mode (no swarm) + AsyncQueue semantics.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InferenceRouter, AsyncQueue, STATES } from '../lib/router.js'
import { SimEngine } from '../lib/engines/sim.js'
import { buildHistory } from '../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const EVENT = new MatchSimulator({ seed: 2 }).all().find(e => e.side)
const HISTORY = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT })

test('AsyncQueue delivers pushed values in order then completes', async () => {
  const q = new AsyncQueue()
  q.push(1); q.push(2); q.push(3); q.end()
  const got = []
  for await (const v of q) got.push(v)
  assert.deepEqual(got, [1, 2, 3])
})

test('AsyncQueue resolves consumers waiting before the push', async () => {
  const q = new AsyncQueue()
  const p = q.next()
  q.push('late')
  assert.deepEqual(await p, { value: 'late', done: false })
})

test('AsyncQueue.fail surfaces the error to the consumer', async () => {
  const q = new AsyncQueue()
  q.push('one')
  q.fail(new Error('boom'))
  const got = []
  await assert.rejects(async () => {
    for await (const v of q) got.push(v)
  }, /boom/)
  assert.deepEqual(got, ['one']) // values before the failure still delivered
})

test('AsyncQueue.fail wakes a pending consumer with the error', async () => {
  const q = new AsyncQueue()
  const pending = (async () => {
    for await (const _ of q) {} // eslint-disable-line no-empty
  })()
  q.fail(new Error('late-fail'))
  await assert.rejects(pending, /late-fail/)
})

test('AsyncQueue ignores push after end', async () => {
  const q = new AsyncQueue()
  q.end()
  q.push('ghost')
  assert.deepEqual(await q.next(), { value: undefined, done: true })
})

test('standalone router (p2p:false) completes locally with no swarm', async () => {
  const engine = new SimEngine({ tps: Infinity })
  const router = new InferenceRouter({ matchId: 'solo', engine, p2p: false })
  await router.start()
  assert.equal(router.state.state, STATES.LOCAL)
  assert.equal(router.swarm, null)
  assert.equal(router.provider(), null)

  const { stream, result } = router.complete({ history: HISTORY, seed: 5 })
  const tokens = []
  for await (const c of stream) {
    tokens.push(c.token)
    assert.equal(c.source, 'local')
  }
  const summary = await result
  assert.equal(summary.source, 'local')
  assert.deepEqual(summary.sources, ['local'])
  assert.equal(summary.text, tokens.join(''))
  assert.ok(summary.tokens > 3)
  assert.equal(summary.resumed, false)
  assert.equal(summary.restarted, false)
  await router.stop()
  assert.equal(router.state.state, STATES.IDLE)
})

test('standalone router records local segments in session stats', async () => {
  const engine = new SimEngine({ tps: Infinity })
  const router = new InferenceRouter({ matchId: 'solo2', engine, p2p: false })
  await router.start()
  await router.complete({ history: HISTORY, seed: 1 }).result
  await router.complete({ history: HISTORY, seed: 2 }).result
  const report = router.stats.report()
  assert.equal(report.segments, 2)
  assert.equal(report.local.n, 2)
  assert.equal(report.offloaded.n, 0)
  await router.stop()
})

test('router emits token and segment events', async () => {
  const engine = new SimEngine({ tps: Infinity })
  const router = new InferenceRouter({ matchId: 'solo3', engine, p2p: false })
  await router.start()
  const tokenEvents = []
  const segments = []
  router.on('token', (t) => tokenEvents.push(t))
  router.on('segment', (s) => segments.push(s))
  const { stream, result } = router.complete({ history: HISTORY, seed: 3 })
  for await (const _ of stream) {} // eslint-disable-line no-empty
  await result
  assert.ok(tokenEvents.length > 0)
  assert.equal(segments.length, 1)
  assert.equal(tokenEvents.length, segments[0].tokens)
  await router.stop()
})

test('local abort propagates as AbortError', async () => {
  const engine = new SimEngine({ tps: 500 })
  const router = new InferenceRouter({ matchId: 'solo4', engine, p2p: false })
  await router.start()
  const ac = new AbortController()
  const { stream, result } = router.complete({ history: HISTORY, seed: 3, signal: ac.signal })
  const consume = (async () => {
    let n = 0
    for await (const _ of stream) {  
      if (++n === 2) ac.abort()
    }
  })()
  await assert.rejects(result, (err) => err.name === 'AbortError')
  await consume.catch(() => {})
  await router.stop()
})

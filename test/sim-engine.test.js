import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SimEngine, composeCommentary, parseEventLine, parseDirectives, tokenize, SIM_MODEL_ID } from '../lib/engines/sim.js'
import { buildHistory, eventMessage, FOCUS, VERBOSITY } from '../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const EVENTS = new MatchSimulator({ seed: 6 }).all()
const EVENT = EVENTS.find(e => e.side && e.type === 'press') || EVENTS.find(e => e.side)

function historyFor (event, focus = FOCUS.NEUTRAL, verbosity = VERBOSITY.NORMAL) {
  return buildHistory({ fixture: DEFAULT_FIXTURE, event, focus, verbosity })
}

test('parseEventLine inverts eventMessage', () => {
  const parsed = parseEventLine(eventMessage(EVENT))
  assert.equal(parsed.minute, EVENT.minute)
  assert.equal(parsed.type, EVENT.type)
  assert.equal(parsed.team, EVENT.team)
  assert.deepEqual(parsed.players, EVENT.players)
  assert.equal(parsed.zone, EVENT.zone)
  assert.equal(parsed.score, `${EVENT.score.home}-${EVENT.score.away}`)
})

test('parseEventLine returns null on free text (no crash on judge input)', () => {
  assert.equal(parseEventLine('what a game!'), null)
})

test('parseDirectives reads focus and verbosity back from the system prompt', () => {
  for (const focus of Object.values(FOCUS)) {
    for (const verbosity of Object.values(VERBOSITY)) {
      const [system] = historyFor(EVENT, focus, verbosity)
      assert.deepEqual(parseDirectives(system.content), { focus, verbosity })
    }
  }
})

test('composeCommentary is deterministic for the same request + seed', () => {
  const history = historyFor(EVENT, FOCUS.ATTACK, VERBOSITY.RICH)
  assert.equal(composeCommentary({ history, seed: 5 }), composeCommentary({ history, seed: 5 }))
})

test('composeCommentary varies with seed', () => {
  const history = historyFor(EVENT, FOCUS.ATTACK, VERBOSITY.RICH)
  const outs = new Set()
  for (let seed = 0; seed < 12; seed++) outs.add(composeCommentary({ history, seed }))
  assert.ok(outs.size > 3, `too little variety: ${outs.size}`)
})

test('focus changes the tactical read (attack vs defense vocabularies)', () => {
  const attack = composeCommentary({ history: historyFor(EVENT, FOCUS.ATTACK, VERBOSITY.NORMAL), seed: 2 })
  const defense = composeCommentary({ history: historyFor(EVENT, FOCUS.DEFENSE, VERBOSITY.NORMAL), seed: 2 })
  assert.notEqual(attack, defense)
})

test('verbosity controls the sentence budget', () => {
  const count = (s) => (s.match(/[.!]/g) || []).length
  const terse = composeCommentary({ history: historyFor(EVENT, FOCUS.NEUTRAL, VERBOSITY.TERSE), seed: 3 })
  const normal = composeCommentary({ history: historyFor(EVENT, FOCUS.NEUTRAL, VERBOSITY.NORMAL), seed: 3 })
  const rich = composeCommentary({ history: historyFor(EVENT, FOCUS.NEUTRAL, VERBOSITY.RICH), seed: 3 })
  assert.equal(count(terse), 1)
  assert.equal(count(normal), 2)
  assert.equal(count(rich), 3)
})

test('commentary references the event: team or player shows up', () => {
  const text = composeCommentary({ history: historyFor(EVENT, FOCUS.NEUTRAL, VERBOSITY.NORMAL), seed: 1 })
  const mentions = text.includes(EVENT.team) || EVENT.players.some(p => text.includes(p)) || text.includes(EVENT.zone)
  assert.ok(mentions, `no event grounding in: ${text}`)
})

test('arbitrary user input still produces commentary (graceful degrade)', () => {
  const history = [
    { role: 'system', content: 'You are Gaffer.' },
    { role: 'user', content: 'my neighbour just scored in the park' }
  ]
  const text = composeCommentary({ history, seed: 4 })
  assert.ok(text.length > 10)
})

test('tokenize concatenates back to the exact text', () => {
  const text = composeCommentary({ history: historyFor(EVENT), seed: 9 })
  assert.equal(tokenize(text).join(''), text)
})

test('SimEngine.complete streams tokens that join into the composed text', async () => {
  const engine = new SimEngine({ tps: Infinity })
  await engine.load()
  const history = historyFor(EVENT, FOCUS.NEUTRAL, VERBOSITY.NORMAL)
  const res = engine.complete({ history, seed: 11 })
  let text = ''
  let count = 0
  for await (const token of res.tokenStream) {
    text += token
    count++
  }
  assert.equal(text, composeCommentary({ history, seed: 11 }))
  const usage = res.usage()
  assert.equal(usage.tokens, count)
  assert.ok(usage.ms >= 1)
})

test('SimEngine.complete honours maxTokens', async () => {
  const engine = new SimEngine({ tps: Infinity })
  await engine.load()
  const res = engine.complete({ history: historyFor(EVENT), seed: 1, maxTokens: 3 })
  let count = 0
  for await (const _ of res.tokenStream) count++  
  assert.equal(count, 3)
})

test('SimEngine.complete aborts via AbortSignal', async () => {
  const engine = new SimEngine({ tps: 1000 })
  await engine.load()
  const ac = new AbortController()
  const res = engine.complete({ history: historyFor(EVENT), seed: 1, signal: ac.signal })
  let count = 0
  await assert.rejects(async () => {
    for await (const _ of res.tokenStream) {  
      if (++count === 2) ac.abort()
    }
  }, (err) => err.name === 'AbortError')
  assert.ok(count <= 3)
})

test('SimEngine requires a non-empty history', async () => {
  const engine = new SimEngine({ tps: Infinity })
  await engine.load()
  assert.throws(() => engine.complete({ history: [] }), /history required/)
})

test('SimEngine identifies itself honestly', async () => {
  const engine = new SimEngine({})
  assert.equal(engine.kind, 'sim')
  assert.equal(engine.deterministic, true)
  assert.equal(engine.modelId, SIM_MODEL_ID)
  const speech = await engine.speak('hello')
  assert.equal(speech.available, false)
  assert.match(speech.reason, /never fakes audio/)
})

test('SimEngine throttle: 10 tok/s takes visibly longer than unthrottled', async () => {
  const engine = new SimEngine({ tps: Infinity })
  await engine.load()
  const slow = new SimEngine({ tps: 40 })
  await slow.load()
  const history = historyFor(EVENT, FOCUS.NEUTRAL, VERBOSITY.TERSE)

  const t0 = Date.now()
  for await (const _ of engine.complete({ history, seed: 2 }).tokenStream) {} // eslint-disable-line no-empty
  const fastMs = Date.now() - t0

  const t1 = Date.now()
  for await (const _ of slow.complete({ history, seed: 2 }).tokenStream) {} // eslint-disable-line no-empty
  const slowMs = Date.now() - t1

  assert.ok(slowMs > fastMs + 30, `throttle not observable: fast=${fastMs}ms slow=${slowMs}ms`)
})

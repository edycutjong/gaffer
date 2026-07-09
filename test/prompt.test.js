import { test } from 'node:test'
import assert from 'node:assert/strict'
import { systemPrompt, eventMessage, buildHistory, FOCUS, VERBOSITY } from '../lib/prompt.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const EVENT = new MatchSimulator({ seed: 1 }).all().find(e => e.side)

test('systemPrompt names both teams and the persona', () => {
  const p = systemPrompt({ fixture: DEFAULT_FIXTURE })
  assert.match(p, /Gaffer/)
  assert.match(p, /Argentina/)
  assert.match(p, /France/)
})

test('systemPrompt encodes focus directives distinctly', () => {
  const attack = systemPrompt({ fixture: DEFAULT_FIXTURE, focus: FOCUS.ATTACK })
  const defense = systemPrompt({ fixture: DEFAULT_FIXTURE, focus: FOCUS.DEFENSE })
  const neutral = systemPrompt({ fixture: DEFAULT_FIXTURE, focus: FOCUS.NEUTRAL })
  assert.match(attack, /Prioritise attacking/)
  assert.match(defense, /Prioritise defensive/)
  assert.doesNotMatch(neutral, /Prioritise attacking|Prioritise defensive/)
})

test('systemPrompt encodes the sentence budget per verbosity', () => {
  assert.match(systemPrompt({ fixture: DEFAULT_FIXTURE, verbosity: VERBOSITY.TERSE }), /at most 1 short sentence/)
  assert.match(systemPrompt({ fixture: DEFAULT_FIXTURE, verbosity: VERBOSITY.NORMAL }), /at most 2 short sentences/)
  assert.match(systemPrompt({ fixture: DEFAULT_FIXTURE, verbosity: VERBOSITY.RICH }), /at most 3 short sentences/)
})

test('systemPrompt pins the score as ground truth (anti-hallucination)', () => {
  assert.match(systemPrompt({ fixture: DEFAULT_FIXTURE }), /Never invent goals/)
})

test('eventMessage encodes clock, score, type, team and zone', () => {
  const msg = eventMessage(EVENT)
  assert.match(msg, /^\[\d{2}:\d{2}\] \[score \d+-\d+\] /)
  assert.ok(msg.includes(EVENT.team))
  assert.ok(msg.includes(EVENT.zone))
  assert.ok(msg.includes(EVENT.type.replace(/_/g, ' ')))
})

test('buildHistory starts with system and ends with the event user turn', () => {
  const h = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT, focus: FOCUS.NEUTRAL, verbosity: VERBOSITY.NORMAL })
  assert.equal(h[0].role, 'system')
  assert.equal(h[h.length - 1].role, 'user')
  assert.equal(h[h.length - 1].content, eventMessage(EVENT))
})

test('buildHistory keeps a sliding window of past exchanges', () => {
  const recent = Array.from({ length: 10 }, (_, i) => ({ prompt: `p${i}`, text: `t${i}` }))
  const h = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT, recent, window: 3 })
  // system + 3 pairs + current user = 1 + 6 + 1
  assert.equal(h.length, 8)
  assert.equal(h[1].content, 'p7') // only the last 3 exchanges survive
  assert.equal(h[2].content, 't7')
  assert.equal(h[2].role, 'assistant')
})

test('buildHistory with no history is exactly system + user', () => {
  const h = buildHistory({ fixture: DEFAULT_FIXTURE, event: EVENT })
  assert.equal(h.length, 2)
})

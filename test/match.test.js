import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MatchSimulator, DEFAULT_FIXTURE, EVENT_TYPES, PRIORITY_EVENTS } from '../lib/match.js'

test('same seed produces the identical match, instance-independent', () => {
  const a = new MatchSimulator({ seed: 42 }).all()
  const b = new MatchSimulator({ seed: 42 }).all()
  assert.deepEqual(a, b)
})

test('different seeds produce different matches', () => {
  const a = new MatchSimulator({ seed: 1 }).all()
  const b = new MatchSimulator({ seed: 2 }).all()
  assert.notDeepEqual(a.map(e => e.type), b.map(e => e.type))
})

test('events are strictly chronologically ordered', () => {
  const events = new MatchSimulator({ seed: 7 }).all()
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]
    const cur = events[i]
    const before = prev.minute < cur.minute ||
      (prev.minute === cur.minute && prev.second < cur.second) ||
      (prev.minute === cur.minute && prev.second === cur.second && prev.n < cur.n)
    assert.ok(before, `event ${i} out of order`)
  }
})

test('match opens with kickoff and closes with full_time', () => {
  const events = new MatchSimulator({ seed: 3 }).all()
  assert.equal(events[0].type, 'kickoff')
  assert.equal(events[events.length - 1].type, 'full_time')
})

test('half_time appears exactly once, mid-match', () => {
  const events = new MatchSimulator({ seed: 3, minutes: 90 }).all()
  const ht = events.filter(e => e.type === 'half_time')
  assert.equal(ht.length, 1)
  assert.equal(ht[0].minute, 45)
})

test('score on events is monotonically consistent with goals', () => {
  const events = new MatchSimulator({ seed: 11 }).all()
  let home = 0
  let away = 0
  for (const ev of events) {
    if (ev.type === 'goal') {
      if (ev.side === 'home') home++
      else away++
    }
    assert.ok(ev.score.home >= 0 && ev.score.away >= 0)
    assert.ok(ev.score.home <= home && ev.score.away <= away,
      `score ran ahead of goals at ${ev.minute}' (${ev.type})`)
  }
  const last = events[events.length - 1]
  assert.equal(last.score.home, home)
  assert.equal(last.score.away, away)
})

test('every event carries a known type and the fixture match id', () => {
  const events = new MatchSimulator({ seed: 5 }).all()
  for (const ev of events) {
    assert.ok(EVENT_TYPES.includes(ev.type) || ev.type === 'save', `unknown type ${ev.type}`)
    assert.equal(ev.matchId, DEFAULT_FIXTURE.id)
  }
})

test('priority flags match PRIORITY_EVENTS', () => {
  const events = new MatchSimulator({ seed: 5 }).all()
  for (const ev of events) assert.equal(ev.priority, PRIORITY_EVENTS.has(ev.type))
})

test('sided events name a real squad player', () => {
  const events = new MatchSimulator({ seed: 9 }).all()
  for (const ev of events) {
    if (!ev.side) continue
    const squad = DEFAULT_FIXTURE[ev.side].players
    assert.ok(squad.includes(ev.players[0]), `${ev.players[0]} not in ${ev.side} squad`)
  }
})

test('a match produces a substantial but bounded feed', () => {
  const events = new MatchSimulator({ seed: 2026 }).all()
  assert.ok(events.length > 40, `too quiet: ${events.length}`)
  assert.ok(events.length < 250, `firehose: ${events.length}`)
})

test('async iteration yields the same events as all()', async () => {
  const sim = new MatchSimulator({ seed: 13, speed: 0 })
  const collected = []
  for await (const ev of sim) collected.push(ev)
  assert.deepEqual(collected, new MatchSimulator({ seed: 13 }).all())
})

test('custom shorter match length is honoured', () => {
  const events = new MatchSimulator({ seed: 4, minutes: 10 }).all()
  assert.equal(events[events.length - 1].minute, 10)
})

test('AUDIT: a save never narrates before its shot (same minute)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const events = new MatchSimulator({ seed }).all()
    for (let i = 0; i < events.length; i++) {
      if (events[i].type !== 'save' || events[i].penaltySave) continue
      // find the closest preceding shot_on_target in the same minute
      for (let j = i - 1; j >= 0 && events[j].minute === events[i].minute; j--) {
        if (events[j].type === 'shot_on_target') {
          assert.ok(
            events[i].second > events[j].second ||
            (events[i].second === events[j].second && events[i].n > events[j].n),
            `seed ${seed}: save at ${events[i].minute}:${events[i].second} precedes shot at ${events[j].minute}:${events[j].second}`
          )
          break
        }
      }
    }
  }
})

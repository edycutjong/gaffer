// Deterministic match event simulator. Gaffer narrates events; it does not
// invent the match itself non-reproducibly — the same seed always produces the
// same 90 minutes, which is what makes the bench, tests and demo comparable
// across runs and machines.
//
// Team names are real nations; player names are fictional (see docs/SEED_DATA.md).

import { Rng, deriveSeed } from './prng.js'

export const DEFAULT_FIXTURE = Object.freeze({
  id: 'final-2026',
  competition: 'World Cup Final',
  home: {
    name: 'Argentina',
    code: 'ARG',
    players: ['Varela', 'Quinteros', 'Ibáñez', 'Roldán', 'Acosta', 'Ferreyra', 'Maidana', 'Salvio', 'Corrales', 'Bustos', 'Peralta']
  },
  away: {
    name: 'France',
    code: 'FRA',
    players: ['Dumont', 'Lefebvre', 'Moreau', 'Carpentier', 'Baudry', 'Renard', 'Vasseur', 'Chevalier', 'Marchand', 'Aubert', 'Colin']
  }
})

export const EVENT_TYPES = Object.freeze([
  'kickoff', 'pass_chain', 'press', 'shot_on_target', 'shot_off_target', 'save',
  'corner', 'foul', 'yellow_card', 'goal', 'offside', 'counter', 'substitution',
  'var_check', 'penalty_awarded', 'half_time', 'full_time'
])

// Relative likelihood of open-play events per simulated minute.
const OPEN_PLAY_WEIGHTS = [
  { value: 'pass_chain', weight: 30 },
  { value: 'press', weight: 16 },
  { value: 'shot_off_target', weight: 8 },
  { value: 'shot_on_target', weight: 7 },
  { value: 'counter', weight: 7 },
  { value: 'foul', weight: 8 },
  { value: 'corner', weight: 7 },
  { value: 'offside', weight: 4 },
  { value: 'yellow_card', weight: 2 },
  { value: 'substitution', weight: 2 },
  { value: 'var_check', weight: 1 },
  { value: 'penalty_awarded', weight: 1 }
]

const ZONES = ['left flank', 'right flank', 'central corridor', 'left half-space', 'right half-space', 'edge of the box', 'midfield circle', 'deep block']

// Events a paced commentary must never skip.
export const PRIORITY_EVENTS = new Set(['goal', 'penalty_awarded', 'var_check', 'yellow_card', 'kickoff', 'half_time', 'full_time'])

/**
 * Deterministic simulator. `all()` yields the entire match synchronously;
 * `[Symbol.asyncIterator]` paces events in real time (speed = ms per match-minute).
 */
export class MatchSimulator {
  constructor ({ fixture = DEFAULT_FIXTURE, seed = 2026, minutes = 90, speed = 1200 } = {}) {
    this.fixture = fixture
    this.seed = seed
    this.minutes = minutes
    this.speed = speed
    this.score = { home: 0, away: 0 }
    this._events = null
  }

  /** Full deterministic event list (memoised). */
  all () {
    if (this._events) return this._events
    const rng = new Rng(deriveSeed('match', this.fixture.id, this.seed))
    const events = []
    const score = { home: 0, away: 0 }
    this._n = 0

    events.push(this._mk('kickoff', 1, 0, 'home', rng, score))
    for (let minute = 1; minute <= this.minutes; minute++) {
      if (minute === Math.ceil(this.minutes / 2)) {
        events.push(this._mk('half_time', minute, 59, null, rng, score))
        continue
      }
      // 0–2 notable events per minute — football has quiet spells; the pacer
      // (commentary.js) needs those gaps to be real.
      const n = rng.weighted([{ value: 0, weight: 30 }, { value: 1, weight: 55 }, { value: 2, weight: 15 }])
      for (let k = 0; k < n; k++) {
        let type = rng.weighted(OPEN_PLAY_WEIGHTS)
        // Convert some shots/penalties into goals so the score line moves.
        if (type === 'shot_on_target' && rng.chance(0.28)) type = 'goal'
        if (type === 'penalty_awarded' && rng.chance(0.7)) {
          const side = rng.chance(0.5) ? 'home' : 'away'
          events.push(this._mk('penalty_awarded', minute, rng.int(0, 40), side, rng, score))
          if (rng.chance(0.75)) {
            score[side]++
            events.push(this._mk('goal', minute, rng.int(41, 59), side, rng, score, { fromPenalty: true }))
          } else {
            events.push(this._mk('save', minute, rng.int(41, 59), side === 'home' ? 'away' : 'home', rng, score, { penaltySave: true }))
          }
          continue
        }
        const side = rng.chance(0.5) ? 'home' : 'away'
        if (type === 'goal') score[side]++
        const second = rng.int(0, 59)
        events.push(this._mk(type, minute, second, side, rng, score))
        if (type === 'shot_on_target' && rng.chance(0.85)) {
          // the save must narrate AFTER its shot — clamp its clock accordingly
          const saveSecond = Math.min(59, Math.max(second + 1, rng.int(0, 59)))
          events.push(this._mk('save', minute, saveSecond, side === 'home' ? 'away' : 'home', rng, score))
        }
      }
    }
    events.push(this._mk('full_time', this.minutes, 59, null, rng, score))

    // Chronological order with a stable tiebreaker so downstream consumers see
    // a strictly ordered feed.
    events.sort((a, b) => (a.minute - b.minute) || (a.second - b.second) || (a.n - b.n))
    this._events = events
    this.score = { ...score }
    return events
  }

  /** Real-time paced stream of the same deterministic events. */
  async * [Symbol.asyncIterator] () {
    const events = this.all()
    let lastMinute = 0
    for (const ev of events) {
      const gapMinutes = ev.minute - lastMinute
      if (gapMinutes > 0 && this.speed > 0) await sleep(gapMinutes * this.speed)
      lastMinute = ev.minute
      yield ev
    }
  }

  _mk (type, minute, second, side, rng, score, extra = {}) {
    const team = side ? this.fixture[side] : null
    const players = team ? [rng.pick(team.players), rng.pick(team.players)] : []
    return {
      n: this._n++,
      matchId: this.fixture.id,
      type,
      minute,
      second,
      side,
      team: team ? team.name : null,
      players,
      zone: rng.pick(ZONES),
      score: { ...score },
      priority: PRIORITY_EVENTS.has(type),
      ...extra
    }
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

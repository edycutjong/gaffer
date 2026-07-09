// Router state machine — the graceful-degradation invariant from
// ARCHITECTURE.md, made explicit and exhaustively testable. Every
// (state, event) pair is defined; unknown events in a state are no-ops that
// return the same state (never a crash mid-match).
//
//   IDLE ──START──▶ LOCAL ──PROVIDER_UP──▶ OFFLOADED
//   OFFLOADED ──PROVIDER_DOWN/STREAM_ERROR──▶ FALLBACK (local, flagged)
//   FALLBACK ──PROVIDER_UP──▶ OFFLOADED        (recovers when peer returns)
//   any ──STOP──▶ IDLE

export const STATES = Object.freeze({
  IDLE: 'IDLE',
  LOCAL: 'LOCAL',
  OFFLOADED: 'OFFLOADED',
  FALLBACK: 'FALLBACK'
})

export const EVENTS = Object.freeze({
  START: 'START',
  PROVIDER_UP: 'PROVIDER_UP',
  PROVIDER_DOWN: 'PROVIDER_DOWN',
  STREAM_ERROR: 'STREAM_ERROR',
  STOP: 'STOP'
})

const TABLE = {
  IDLE: {
    START: 'LOCAL',
    PROVIDER_UP: 'IDLE', // discovery before start changes nothing until START
    PROVIDER_DOWN: 'IDLE',
    STREAM_ERROR: 'IDLE',
    STOP: 'IDLE'
  },
  LOCAL: {
    START: 'LOCAL',
    PROVIDER_UP: 'OFFLOADED',
    PROVIDER_DOWN: 'LOCAL',
    STREAM_ERROR: 'LOCAL', // local errors stay local — nothing to fall back from
    STOP: 'IDLE'
  },
  OFFLOADED: {
    START: 'OFFLOADED',
    PROVIDER_UP: 'OFFLOADED',
    PROVIDER_DOWN: 'FALLBACK',
    STREAM_ERROR: 'FALLBACK',
    STOP: 'IDLE'
  },
  FALLBACK: {
    START: 'FALLBACK',
    PROVIDER_UP: 'OFFLOADED',
    PROVIDER_DOWN: 'FALLBACK',
    STREAM_ERROR: 'FALLBACK',
    STOP: 'IDLE'
  }
}

/** Pure transition function. Throws on unknown state/event names. */
export function transition (state, event) {
  const row = TABLE[state]
  if (!row) throw new RangeError(`state.transition: unknown state "${state}"`)
  const next = row[event]
  if (next === undefined) throw new RangeError(`state.transition: unknown event "${event}"`)
  return next
}

/** True when the state means "generate on this device". */
export function isLocalState (state) {
  return state === STATES.LOCAL || state === STATES.FALLBACK
}

/** Small observable wrapper used by the router and the HUD. */
export class RouterState {
  constructor (onChange = () => {}) {
    this.state = STATES.IDLE
    this.history = [STATES.IDLE]
    this._onChange = onChange
  }

  dispatch (event, detail = {}) {
    const prev = this.state
    const next = transition(prev, event)
    if (next !== prev) {
      this.state = next
      this.history.push(next)
      this._onChange({ prev, next, event, detail })
    }
    return this.state
  }
}

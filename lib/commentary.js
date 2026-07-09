// CommentaryEngine — turns the match event feed into paced, spoken-word
// commentary segments through the router. Owns the listener-facing controls:
// focus (attack/defense/neutral), verbosity, pause/resume, skip.
//
// Pacing rule: one segment at a time (a pundit doesn't talk over themselves).
// While a segment is streaming, non-priority events are dropped; priority
// events (goal, penalty, cards, kickoff, half/full time) queue and interrupt
// the gap. Quiet minutes stay quiet — that is what makes it feel like a
// broadcast and not a firehose.

import { EventEmitter } from 'node:events'
import { buildHistory, FOCUS, VERBOSITY } from './prompt.js'
import { deriveSeed } from './prng.js'

export class CommentaryEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./router.js').InferenceRouter} opts.router
   * @param {object} opts.fixture
   * @param {number} [opts.seed]     base seed — with the sim engine this makes
   *                                 the whole broadcast reproducible
   * @param {object} [opts.speaker]  optional TTS speaker (lib/tts.js)
   */
  constructor ({ router, fixture, seed = 2047, focus = FOCUS.NEUTRAL, verbosity = VERBOSITY.NORMAL, speaker = null, maxTokens = 96 }) {
    super()
    this.router = router
    this.fixture = fixture
    this.seed = seed
    this.focus = focus
    this.verbosity = verbosity
    this.speaker = speaker
    this.maxTokens = maxTokens
    this.recent = [] // sliding window of { prompt, text } for prompt context
    this.paused = false
    this.busy = false
    this.dropped = 0
    this.segments = 0
    this._pendingPriority = []
    this._skipRequested = false
  }

  setFocus (focus) {
    if (!Object.values(FOCUS).includes(focus)) throw new RangeError(`unknown focus "${focus}"`)
    this.focus = focus
    this.emit('controls', { focus, verbosity: this.verbosity })
  }

  setVerbosity (verbosity) {
    if (!Object.values(VERBOSITY).includes(verbosity)) throw new RangeError(`unknown verbosity "${verbosity}"`)
    this.verbosity = verbosity
    this.emit('controls', { focus: this.focus, verbosity })
  }

  pause () {
    this.paused = true
    this.emit('paused')
  }

  resume () {
    this.paused = false
    this.emit('resumed')
  }

  /** Skip the segment currently streaming (listener control).
   *  A no-op while idle — a stale flag must never kill the NEXT segment. */
  skip () {
    if (this.busy) this._skipRequested = true
  }

  /** Feed one match event. Returns the segment summary, or null if dropped. */
  async onEvent (event) {
    if (this.paused && !event.priority) {
      this.dropped++
      this.emit('dropped', event)
      return null
    }
    if (this.busy) {
      if (event.priority) {
        this._pendingPriority.push(event)
        this.emit('queued', event)
      } else {
        this.dropped++
        this.emit('dropped', event)
      }
      return null
    }
    return this._speak(event)
  }

  async _speak (event) {
    this.busy = true
    this._skipRequested = false // belt & braces: a skip only applies to THIS segment
    const ac = new AbortController()
    try {
      const history = buildHistory({
        fixture: this.fixture,
        event,
        focus: this.focus,
        verbosity: this.verbosity,
        recent: this.recent
      })
      // Segment seed is derived from the base seed + event identity + controls,
      // so provider and local fallback generate the exact same tokens (sim).
      const seed = deriveSeed(this.seed, event.n, event.type, this.focus, this.verbosity)
      const { stream, result } = this.router.complete({ history, seed, maxTokens: this.maxTokens, signal: ac.signal })

      this.emit('segment-start', { event })
      const consume = (async () => {
        for await (const chunk of stream) {
          if (this._skipRequested) {
            this._skipRequested = false
            ac.abort()
            break
          }
          this.emit('token', { ...chunk, event })
        }
      })()

      let summary
      try {
        summary = await result
        await consume.catch(() => {})
      } catch (err) {
        if (err?.name === 'AbortError') {
          this.emit('skipped', { event })
          return null
        }
        throw err
      }

      this.recent.push({ prompt: history[history.length - 1].content, text: summary.text })
      if (this.recent.length > 8) this.recent.shift()
      this.segments++
      this.emit('segment-end', { event, ...summary })

      if (this.speaker && summary.text) {
        // Voice is an accessory — a TTS failure must never kill the broadcast.
        try {
          const spoken = await this.speaker.speak(summary.text)
          if (spoken?.available) this.emit('speech', { event, ...spoken })
        } catch (err) {
          this.emit('error', err)
        }
      }
      return summary
    } finally {
      this.busy = false
      const next = this._pendingPriority.shift()
      if (next) setImmediate(() => this.onEvent(next).catch(err => this.emit('error', err)))
    }
  }

  /** Run an entire match feed (async iterable of events) to completion. */
  async run (feed) {
    for await (const event of feed) {
      await this.onEventSettled(event)
      if (event.type === 'full_time') break
    }
    this.emit('finished', { segments: this.segments, dropped: this.dropped })
    return { segments: this.segments, dropped: this.dropped }
  }

  /** onEvent that never throws upward mid-broadcast (logs via 'error'). */
  async onEventSettled (event) {
    try {
      return await this.onEvent(event)
    } catch (err) {
      this.emit('error', err)
      return null
    }
  }
}

export { FOCUS, VERBOSITY }

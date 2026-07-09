// InferenceRouter — the weak-client side. Decides, per commentary segment,
// whether tokens come from the local engine or a provider peer, and survives
// the provider dying MID-STREAM without dropping the sentence.
//
// Resume semantics (the token-stream fidelity invariant):
//   • deterministic engines (sim): re-run the same {history, seed} locally and
//     skip the tokens already received — the listener hears one continuous
//     sentence, token-exact.
//   • non-deterministic engines (real LLM): token-exact resume across devices
//     is not honest, so the segment RESTARTS locally and is flagged
//     `restarted: true` for the UI. Documented in docs/AUDIT_REPORT.md.

import { EventEmitter } from 'node:events'
import { GafferSwarm } from './swarm.js'
import * as proto from './protocol.js'
import { RouterState, STATES, EVENTS } from './state.js'
import { SessionStats } from './metrics.js'

/** Minimal async queue — bridges wire events into an async-iterable stream. */
export class AsyncQueue {
  constructor () {
    this._values = []
    this._resolvers = []
    this._done = false
    this._error = null
  }

  push (value) {
    if (this._done) return
    const r = this._resolvers.shift()
    if (r) r({ value, done: false })
    else this._values.push(value)
  }

  end () {
    if (this._done) return
    this._done = true
    for (const r of this._resolvers.splice(0)) r({ value: undefined, done: true })
  }

  fail (err) {
    if (this._done) return
    this._error = err
    this.end()
  }

  async next () {
    if (this._values.length > 0) return { value: this._values.shift(), done: false }
    if (this._done) {
      if (this._error) {
        const err = this._error
        this._error = null
        throw err
      }
      return { value: undefined, done: true }
    }
    return new Promise((resolve, reject) => {
      this._resolvers.push((res) => {
        if (res.done && this._error) {
          const err = this._error
          this._error = null
          reject(err)
        } else resolve(res)
      })
    })
  }

  [Symbol.asyncIterator] () {
    return this
  }
}

export class InferenceRouter extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.matchId
   * @param {object} opts.engine        local (fallback) engine
   * @param {Array}  [opts.bootstrap]   hyperdht bootstrap (tests)
   * @param {number} [opts.tokenGapTimeoutMs] max silence mid-stream before failover
   * @param {boolean} [opts.p2p=true]   false = standalone (no swarm at all)
   */
  constructor ({ matchId, engine, name = 'gaffer-client', bootstrap = undefined, tokenGapTimeoutMs = 8000, p2p = true }) {
    super()
    this.engine = engine
    this.matchId = matchId
    this.tokenGapTimeoutMs = tokenGapTimeoutMs
    this.p2p = p2p
    this.stats = new SessionStats()
    this.state = new RouterState((change) => this.emit('state', change))
    this._reqCounter = 0
    this._inflight = new Map() // id → { queue, provider }
    // connect latency = "how long was I searching before a provider appeared";
    // starts at join, re-arms whenever the last provider leaves.
    this._searchingSince = null

    if (p2p) {
      this.swarm = new GafferSwarm({
        matchId,
        role: proto.ROLES.CLIENT,
        bootstrap,
        identity: { name, engine: engine.kind, model: engine.modelId, deterministic: engine.deterministic }
      })
      this.swarm.on('peer', (peer) => {
        if (peer.role !== proto.ROLES.PROVIDER) return
        if (this._searchingSince != null) {
          this.stats.addConnectLatency(Date.now() - this._searchingSince)
          this._searchingSince = null
        }
        this.state.dispatch(EVENTS.PROVIDER_UP, { peer: peer.shortKey })
        this.emit('provider', peer)
      })
      this.swarm.on('peer-gone', (peer) => {
        if (peer.role !== proto.ROLES.PROVIDER) return
        this._failInflight(peer, new Error('provider connection closed'))
        if (!this.provider()) {
          this._searchingSince = Date.now()
          this.state.dispatch(EVENTS.PROVIDER_DOWN, { peer: peer.shortKey })
          this.emit('provider-gone', peer)
        }
      })
      this.swarm.on('message', ({ peer, msg }) => this._onMessage(peer, msg))
    } else {
      this.swarm = null
    }
  }

  async start () {
    if (!this.engine.loaded) await this.engine.load()
    this.state.dispatch(EVENTS.START)
    if (this.swarm) {
      this._searchingSince = Date.now()
      await this.swarm.join()
    }
    this.emit('started')
    return this
  }

  provider () {
    return this.swarm?.peerWithRole(proto.ROLES.PROVIDER) ?? null
  }

  _onMessage (peer, msg) {
    if (msg.t === 'announce') {
      peer.announce = msg
      this.emit('announce', { peer, announce: msg })
      return
    }
    if (msg.t !== 'tok' && msg.t !== 'end' && msg.t !== 'err') return
    const inflight = this._inflight.get(msg.id)
    if (!inflight || inflight.provider !== peer) return
    if (msg.t === 'tok') inflight.queue.push(msg)
    else if (msg.t === 'end') {
      inflight.usage = msg.usage
      inflight.queue.end()
    } else inflight.queue.fail(new Error(`provider error: ${msg.message}`))
  }

  _failInflight (peer, err) {
    for (const inflight of this._inflight.values()) {
      if (inflight.provider === peer) inflight.queue.fail(err)
    }
  }

  /**
   * Generate one commentary segment.
   * @returns {{ stream: AsyncQueue, result: Promise<object> }}
   *   stream yields { token, i, source }, result resolves to
   *   { source, sources, text, tokens, ms, tps, resumed, restarted }
   */
  complete ({ history, seed = 0, maxTokens = null, signal = null }) {
    const out = new AsyncQueue()
    const result = this._run({ history, seed, maxTokens, signal, out })
      .catch((err) => {
        out.fail(err)
        throw err
      })
    // The same failure surfaces through the stream; callers that only consume
    // the stream must not trigger an unhandled-rejection on `result`.
    result.catch(() => {})
    return { stream: out, result }
  }

  async _run ({ history, seed, maxTokens, signal, out }) {
    const started = Date.now()
    const emitted = []
    const sources = []
    let restarted = false
    let resumed = false

    const provider = this.state.state === STATES.OFFLOADED ? this.provider() : null

    if (provider) {
      sources.push('offloaded')
      try {
        await this._remoteSegment({ provider, history, seed, maxTokens, signal, out, emitted })
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        // Mid-stream provider loss → FALLBACK and continue locally.
        this.state.dispatch(EVENTS.STREAM_ERROR, { reason: err.message })
        this.emit('failover', { received: emitted.length, reason: err.message })
        sources.push('local')
        if (this.engine.deterministic) {
          resumed = true
          await this._localSegment({ history, seed, maxTokens, signal, out, emitted, skip: emitted.length })
        } else {
          restarted = true
          emitted.length = 0
          await this._localSegment({ history, seed, maxTokens, signal, out, emitted, skip: 0, restart: true })
        }
      }
    } else {
      sources.push('local')
      await this._localSegment({ history, seed, maxTokens, signal, out, emitted, skip: 0 })
    }

    out.end()
    const ms = Math.max(1, Date.now() - started)
    const summary = {
      source: sources[sources.length - 1],
      sources,
      text: emitted.join(''),
      tokens: emitted.length,
      ms,
      tps: Math.round((emitted.length / (ms / 1000)) * 100) / 100,
      resumed,
      restarted
    }
    // Mixed (failover) segments are excluded from the local/offloaded buckets
    // so the bench numbers stay clean.
    this.stats.addSegment({ source: sources.length > 1 ? 'mixed' : sources[0], tokens: summary.tokens, ms, tps: summary.tps })
    this.emit('segment', summary)
    return summary
  }

  async _remoteSegment ({ provider, history, seed, maxTokens, signal, out, emitted }) {
    const abortErr = () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      return err
    }
    if (signal?.aborted) throw abortErr()

    const id = `r${++this._reqCounter}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const queue = new AsyncQueue()
    const inflight = { queue, provider, usage: null }
    this._inflight.set(id, inflight)

    // Abort must wake the queue IMMEDIATELY — without this a caller aborting
    // between tokens would sit out the full token-gap timeout.
    const onAbort = () => queue.fail(abortErr())
    signal?.addEventListener?.('abort', onAbort, { once: true })

    const ok = provider.send(proto.req({ id, history, seed, maxTokens }))
    if (!ok) {
      signal?.removeEventListener?.('abort', onAbort)
      this._inflight.delete(id)
      throw new Error('provider socket already closed')
    }

    try {
      let expected = 0
      let gapTimer = null
      const armGap = () => {
        clearTimeout(gapTimer)
        gapTimer = setTimeout(() => queue.fail(new Error(`token gap exceeded ${this.tokenGapTimeoutMs}ms`)), this.tokenGapTimeoutMs)
        gapTimer.unref?.()
      }
      armGap()
      try {
        for await (const msg of queue) {
          armGap()
          if (msg.i !== expected) throw new Error(`token order violated: expected ${expected}, got ${msg.i}`)
          expected++
          emitted.push(msg.token)
          out.push({ token: msg.token, i: emitted.length - 1, source: 'offloaded' })
          this.emit('token', { token: msg.token, source: 'offloaded' })
        }
      } finally {
        clearTimeout(gapTimer)
      }
    } catch (err) {
      // Whatever made us walk away mid-stream (abort, gap timeout, protocol
      // violation), free the provider slot — on a dead socket send() is a no-op.
      provider.send(proto.cancel({ id }))
      throw err
    } finally {
      signal?.removeEventListener?.('abort', onAbort)
      this._inflight.delete(id)
    }
  }

  async _localSegment ({ history, seed, maxTokens, signal, out, emitted, skip = 0, restart = false }) {
    const result = this.engine.complete({ history, seed, maxTokens, signal })
    let i = 0
    for await (const token of result.tokenStream) {
      if (i++ < skip) continue // deterministic resume: drop what the peer already delivered
      emitted.push(token)
      out.push({ token, i: emitted.length - 1, source: 'local', restart })
      this.emit('token', { token, source: 'local' })
    }
  }

  async stop () {
    this.state.dispatch(EVENTS.STOP)
    for (const inflight of this._inflight.values()) inflight.queue.fail(new Error('router stopped'))
    this._inflight.clear()
    if (this.swarm) await this.swarm.destroy()
    this.emit('stopped')
  }
}

export { STATES, EVENTS }

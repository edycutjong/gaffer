// ProviderNode — the laptop side. Serves `req` messages from clients in the
// match room by streaming its engine's tokens back as `tok` frames. This is
// Gaffer's engine-agnostic delegation path; when the real QVAC engine is live
// it additionally offers the SDK-native startQVACProvider bridge.

import { EventEmitter } from 'node:events'
import { GafferSwarm } from './swarm.js'
import * as proto from './protocol.js'

export class ProviderNode extends EventEmitter {
  constructor ({ matchId, engine, name = 'gaffer-provider', bootstrap = undefined, nativeProvider = false, maxConcurrentPerPeer = 4 }) {
    super()
    this.engine = engine
    this.matchId = matchId
    this.nativeProvider = nativeProvider
    this.native = null
    this.maxConcurrentPerPeer = maxConcurrentPerPeer
    this.swarm = new GafferSwarm({
      matchId,
      role: proto.ROLES.PROVIDER,
      bootstrap,
      identity: { name, engine: engine.kind, model: engine.modelId, deterministic: engine.deterministic }
    })
    this.active = new Map() // request id → { ac, peer }
    this.served = 0

    this.swarm.on('peer', (peer) => {
      peer.send(proto.announce({ engine: this.engine.kind, model: this.engine.modelId, tps: this.engine.tps ?? null }))
      this.emit('client', peer)
    })
    this.swarm.on('peer-gone', (peer) => this.emit('client-gone', peer))
    this.swarm.on('message', ({ peer, msg }) => this._onMessage(peer, msg))
  }

  async start () {
    if (!this.engine.loaded) await this.engine.load()
    await this.swarm.join()
    // SDK-native delegation (same substrate) — offered when the engine has it.
    // Best-effort: a broken native bridge must not take down the Gaffer protocol.
    if (this.nativeProvider && typeof this.engine.startNativeProvider === 'function') {
      try {
        this.native = await this.engine.startNativeProvider({ topic: this.swarm.topic })
      } catch (err) {
        this.native = { available: false, reason: err.message }
      }
      this.emit('native-provider', this.native)
    }
    this.emit('started', { topic: this.swarm.topic })
    return this
  }

  // Request ids are only unique WITHIN one peer's stream — scope the key,
  // or two independent clients with colliding counters reject each other.
  _key (peer, id) {
    return `${peer.publicKey}:${id}`
  }

  _onMessage (peer, msg) {
    if (msg.t === 'req') this._serve(peer, msg).catch(err => this.emit('error', err))
    else if (msg.t === 'cancel') {
      const key = this._key(peer, msg.id)
      this.active.get(key)?.ac.abort()
      this.active.delete(key)
    }
  }

  _activeFor (peer) {
    let n = 0
    for (const entry of this.active.values()) {
      if (entry.peer === peer) n++
    }
    return n
  }

  async _serve (peer, msg) {
    // Hostile/buggy-client containment: reject duplicate ids (they would
    // interleave two token streams under one id) and cap concurrency per peer.
    const key = this._key(peer, msg.id)
    if (this.active.has(key)) {
      peer.send(proto.err({ id: msg.id, message: 'duplicate request id' }))
      return
    }
    if (this._activeFor(peer) >= this.maxConcurrentPerPeer) {
      peer.send(proto.err({ id: msg.id, message: `busy: max ${this.maxConcurrentPerPeer} concurrent requests per peer` }))
      return
    }
    const ac = new AbortController()
    this.active.set(key, { ac, peer })
    this.emit('request', { peer, id: msg.id })
    try {
      const result = this.engine.complete({
        history: msg.history,
        seed: msg.seed ?? 0,
        maxTokens: msg.maxTokens,
        signal: ac.signal
      })
      let i = 0
      for await (const token of result.tokenStream) {
        if (peer.conn.destroyed || ac.signal.aborted) return
        peer.send(proto.tok({ id: msg.id, i: i++, token }))
      }
      peer.send(proto.end({ id: msg.id, usage: result.usage() }))
      this.served++
      this.emit('served', { peer, id: msg.id, tokens: i })
    } catch (err) {
      if (err?.name !== 'AbortError' && !peer.conn.destroyed) {
        peer.send(proto.err({ id: msg.id, message: err.message }))
      }
    } finally {
      this.active.delete(key)
    }
  }

  async stop () {
    for (const entry of this.active.values()) entry.ac.abort()
    this.active.clear()
    if (this.native?.handle?.stop) await this.native.handle.stop()
    await this.swarm.destroy()
    this.emit('stopped')
  }
}

// GafferSwarm — the match room. Wraps Hyperswarm: derive the topic from the
// match id, join, exchange `hello`, keep peers alive with ping/pong, and hand
// framed protocol messages to the owner (provider.js / router.js).
//
// The swarm connection is a Noise secretstream — E2E encryption comes from the
// transport itself; peers are keypairs, not IPs (HyperDHT holepunching).

import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import { EventEmitter } from 'node:events'
import { matchTopic } from './topic.js'
import * as proto from './protocol.js'

export class Peer {
  constructor (conn, info) {
    this.conn = conn
    this.info = info
    this.hello = null
    this.lastPongMs = null
    this.publicKey = b4a.toString(conn.remotePublicKey, 'hex')
    this.shortKey = this.publicKey.slice(0, 8)
    this.connectedAt = Date.now()
  }

  get role () {
    return this.hello?.role ?? null
  }

  send (msg) {
    if (this.conn.destroyed) return false
    this.conn.write(proto.encode(msg))
    return true
  }
}

export class GafferSwarm extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.matchId
   * @param {'provider'|'client'} opts.role
   * @param {object} [opts.identity] { engine, model, deterministic, name }
   * @param {Array}  [opts.bootstrap] hyperdht bootstrap override (tests: local testnet)
   */
  constructor ({ matchId, role, identity = {}, bootstrap = undefined }) {
    super()
    if (role !== proto.ROLES.PROVIDER && role !== proto.ROLES.CLIENT) throw new TypeError(`GafferSwarm: bad role "${role}"`)
    this.matchId = matchId
    this.role = role
    this.identity = identity
    this.topic = matchTopic(matchId)
    this.swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
    this.peers = new Map() // publicKey hex → Peer
    this.destroyed = false
    this._discovery = null

    this.swarm.on('connection', (conn, info) => this._onConnection(conn, info))
  }

  async join () {
    this._discovery = this.swarm.join(this.topic, { server: true, client: true })
    // Providers must be findable before we report "joined"; clients flush the
    // initial query so an already-present provider connects promptly.
    if (this.role === proto.ROLES.PROVIDER) await this._discovery.flushed()
    else await this.swarm.flush()
    this.emit('joined', { topic: this.topic })
    return this
  }

  _onConnection (conn, info) {
    const peer = new Peer(conn, info)
    const parser = new proto.Parser({
      onMessage: (msg) => this._onMessage(peer, msg),
      onError: (err) => {
        this.emit('protocol-error', { peer, err })
        conn.destroy(err)
      }
    })

    conn.on('data', (chunk) => parser.push(chunk))
    conn.on('error', () => {}) // close handler owns cleanup; swallow ECONNRESET noise
    conn.on('close', () => {
      // A newer connection from the same keypair may have replaced this entry —
      // only remove the map entry if it is still OURS.
      if (this.peers.get(peer.publicKey) === peer) this.peers.delete(peer.publicKey)
      this.emit('peer-gone', peer)
    })
    conn.setKeepAlive?.(5000)

    peer.send(proto.hello({
      role: this.role,
      name: this.identity.name,
      engine: this.identity.engine,
      model: this.identity.model,
      deterministic: this.identity.deterministic
    }))
  }

  _onMessage (peer, msg) {
    switch (msg.t) {
      case 'hello': {
        if (msg.proto !== proto.PROTOCOL_VERSION) {
          peer.send(proto.err({ id: 'hello', message: `protocol mismatch: mine=${proto.PROTOCOL_VERSION} yours=${msg.proto}` }))
          peer.conn.destroy()
          return
        }
        const isNew = !peer.hello
        peer.hello = msg
        this.peers.set(peer.publicKey, peer)
        if (isNew) this.emit('peer', peer)
        return
      }
      case 'ping':
        peer.send(proto.pong(msg))
        return
      case 'pong':
        peer.lastPongMs = Date.now() - msg.ts
        this.emit('latency', { peer, ms: peer.lastPongMs })
        return
      default:
        this.emit('message', { peer, msg })
    }
  }

  /** Round-trip latency probe to one peer (resolves on next pong). */
  async pingPeer (peer, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('latency', onLatency)
        reject(new Error('ping timeout'))
      }, timeoutMs)
      const onLatency = ({ peer: p, ms }) => {
        if (p !== peer) return
        clearTimeout(timer)
        this.off('latency', onLatency)
        resolve(ms)
      }
      this.on('latency', onLatency)
      peer.send(proto.ping())
    })
  }

  /** First connected peer with the given role, if any. */
  peerWithRole (role) {
    for (const peer of this.peers.values()) {
      if (peer.role === role && !peer.conn.destroyed) return peer
    }
    return null
  }

  async destroy () {
    if (this.destroyed) return
    this.destroyed = true
    await this.swarm.destroy()
    this.emit('destroyed')
  }
}

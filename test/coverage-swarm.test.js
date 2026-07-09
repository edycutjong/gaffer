// Coverage: GafferSwarm's message-handling and liveness surface that the live
// testnet integration tests don't reach — the protocol-version mismatch reply,
// ping→pong, pong→latency, the round-trip pingPeer() probe (resolve + timeout),
// and the parser's protocol-error path. Driven over in-process fakes (an empty
// bootstrap keeps HyperDHT off the network); no sockets, no DHT announces.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import b4a from 'b4a'
import { GafferSwarm } from '../lib/swarm.js'
import * as proto from '../lib/protocol.js'

function makeSwarm () {
  // bootstrap:[] → an isolated HyperDHT with no bootstrap nodes: constructed but
  // never joined, so nothing touches the network. Always destroy() at the end.
  return new GafferSwarm({ matchId: 'cov', role: proto.ROLES.CLIENT, bootstrap: [], identity: { engine: 'sim' } })
}

function fakePeer () {
  const sent = []
  return {
    sent,
    publicKey: 'ab'.repeat(32),
    hello: null,
    lastPongMs: null,
    conn: { destroyed: false, destroy () { this.destroyed = true } },
    send (m) { sent.push(m); return true }
  }
}

test('GafferSwarm constructs with the default Hyperswarm options when no bootstrap is given', async () => {
  // The `bootstrap ? { bootstrap } : {}` false branch — a real Hyperswarm with
  // default options. We never join(), so nothing touches the network; destroy
  // immediately.
  const swarm = new GafferSwarm({ matchId: 'cov', role: proto.ROLES.CLIENT, identity: { engine: 'sim' } })
  assert.ok(swarm.topic)
  await swarm.destroy()
})

test('a hello with a mismatched protocol version is refused and the peer is dropped', async () => {
  const swarm = makeSwarm()
  const peer = fakePeer()
  swarm._onMessage(peer, { t: 'hello', proto: proto.PROTOCOL_VERSION + 999, role: proto.ROLES.PROVIDER })
  const errFrame = peer.sent.find(m => m.t === 'err')
  assert.ok(errFrame, 'an err frame is sent back')
  assert.match(errFrame.message, /protocol mismatch/)
  assert.equal(peer.conn.destroyed, true, 'the connection is destroyed')
  await swarm.destroy()
})

test('ping is answered with a pong; pong records latency and emits it', async () => {
  const swarm = makeSwarm()
  const peer = fakePeer()
  swarm._onMessage(peer, proto.ping()) // → pong reply
  assert.equal(peer.sent.at(-1).t, 'pong')

  const latencies = []
  swarm.on('latency', (l) => latencies.push(l))
  swarm._onMessage(peer, { t: 'pong', ts: Date.now() - 5 })
  assert.ok(peer.lastPongMs >= 0)
  assert.equal(latencies.length, 1)
  assert.equal(latencies[0].peer, peer)
  await swarm.destroy()
})

test('pingPeer resolves on the matching pong and ignores a different peer', async () => {
  const swarm = makeSwarm()
  const peer = fakePeer()
  const other = fakePeer()
  const p = swarm.pingPeer(peer, 5000)
  assert.equal(peer.sent.at(-1).t, 'ping', 'a ping was sent')
  // a pong from a DIFFERENT peer must be ignored by pingPeer's latency filter
  swarm._onMessage(other, { t: 'pong', ts: Date.now() })
  // the matching peer's pong resolves it
  swarm._onMessage(peer, { t: 'pong', ts: Date.now() })
  const ms = await p
  assert.ok(ms >= 0)
  await swarm.destroy()
})

test('pingPeer rejects on timeout when no pong arrives', async () => {
  const swarm = makeSwarm()
  const peer = fakePeer()
  await assert.rejects(swarm.pingPeer(peer, 15), /ping timeout/)
  await swarm.destroy()
})

test('a malformed inbound frame raises protocol-error and destroys the connection', async () => {
  const swarm = makeSwarm()
  const conn = new EventEmitter()
  conn.remotePublicKey = b4a.alloc(32, 9)
  conn.destroyed = false
  conn.write = () => true
  conn.destroy = function (err) { this.destroyed = true; this.destroyErr = err }
  conn.setKeepAlive = () => {}

  const errs = []
  swarm.on('protocol-error', (e) => errs.push(e))
  swarm._onConnection(conn, { client: true }) // wires conn.on('data', parser.push) and sends hello

  const bad = b4a.alloc(7)
  bad[0] = 3 // length prefix = 3
  bad.set(b4a.from('@@@', 'utf8'), 4) // not JSON → parser onError
  conn.emit('data', bad)

  assert.equal(errs.length, 1)
  assert.equal(conn.destroyed, true)
  await swarm.destroy()
})

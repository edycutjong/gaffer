import { test } from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'
import * as proto from '../lib/protocol.js'

const HISTORY = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'event' }]

function roundtrip (msg) {
  const out = []
  const parser = new proto.Parser({ onMessage: (m) => out.push(m) })
  parser.push(proto.encode(msg))
  assert.equal(out.length, 1)
  return out[0]
}

test('hello roundtrips with protocol version', () => {
  const m = roundtrip(proto.hello({ role: 'provider', name: 'lap', engine: 'sim', deterministic: true }))
  assert.equal(m.t, 'hello')
  assert.equal(m.proto, proto.PROTOCOL_VERSION)
  assert.equal(m.role, 'provider')
  assert.equal(m.deterministic, true)
})

test('req roundtrips with history and seed', () => {
  const m = roundtrip(proto.req({ id: 'a1', history: HISTORY, seed: 7, maxTokens: 32 }))
  assert.equal(m.t, 'req')
  assert.deepEqual(m.history, HISTORY)
  assert.equal(m.seed, 7)
  assert.equal(m.maxTokens, 32)
})

test('tok / end / err / cancel / ping / pong roundtrip', () => {
  assert.equal(roundtrip(proto.tok({ id: 'a', i: 3, token: 'hi ' })).token, 'hi ')
  assert.deepEqual(roundtrip(proto.end({ id: 'a', usage: { tokens: 5, ms: 10, tps: 500 } })).usage.tokens, 5)
  assert.equal(roundtrip(proto.err({ id: 'a', message: 'boom' })).message, 'boom')
  assert.equal(roundtrip(proto.cancel({ id: 'a' })).id, 'a')
  const ping = proto.ping()
  assert.equal(roundtrip(ping).ts, ping.ts)
  assert.equal(roundtrip(proto.pong(ping)).ts, ping.ts)
})

test('parser reassembles frames split at arbitrary byte boundaries', () => {
  const frame = proto.encode(proto.req({ id: 'split', history: HISTORY, seed: 1 }))
  for (let cut = 1; cut < Math.min(frame.byteLength, 24); cut++) {
    const out = []
    const parser = new proto.Parser({ onMessage: (m) => out.push(m) })
    parser.push(frame.subarray(0, cut))
    parser.push(frame.subarray(cut))
    assert.equal(out.length, 1, `cut at ${cut}`)
    assert.equal(out[0].id, 'split')
  }
})

test('parser handles multiple frames in a single chunk', () => {
  const chunk = b4a.concat([
    proto.encode(proto.ping()),
    proto.encode(proto.cancel({ id: 'x' })),
    proto.encode(proto.tok({ id: 'x', i: 0, token: 'a' }))
  ])
  const out = []
  const parser = new proto.Parser({ onMessage: (m) => out.push(m) })
  parser.push(chunk)
  assert.deepEqual(out.map(m => m.t), ['ping', 'cancel', 'tok'])
})

test('parser reports malformed JSON without crashing and keeps parsing', () => {
  const errors = []
  const out = []
  const parser = new proto.Parser({ onMessage: (m) => out.push(m), onError: (e) => errors.push(e) })
  const bad = b4a.from('{nope', 'utf8')
  const frame = b4a.allocUnsafe(4 + bad.byteLength)
  frame[0] = bad.byteLength; frame[1] = 0; frame[2] = 0; frame[3] = 0
  frame.set(bad, 4)
  parser.push(frame)
  parser.push(proto.encode(proto.ping()))
  assert.equal(errors.length, 1)
  assert.equal(out.length, 1)
})

test('oversized frame length is rejected (hostile peer guard)', () => {
  const errors = []
  const parser = new proto.Parser({ onMessage: () => {}, onError: (e) => errors.push(e) })
  const evil = b4a.alloc(8)
  evil[3] = 0xff // length ≈ 4.2 GB
  parser.push(evil)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /MAX_FRAME/)
})

test('encode rejects unknown message types', () => {
  assert.throws(() => proto.encode({ t: 'evil' }), /unknown message type/)
  assert.throws(() => proto.encode(null), /must be an object/)
})

test('validate: req requires non-empty structured history', () => {
  assert.throws(() => proto.validate({ t: 'req', id: 'x', history: [] }), /non-empty/)
  assert.throws(() => proto.validate({ t: 'req', id: 'x', history: [{ role: 'user' }] }), /content/)
  assert.throws(() => proto.validate({ t: 'req', history: HISTORY }), /"id"/)
})

test('validate: hello rejects bad roles and missing proto', () => {
  assert.throws(() => proto.validate({ t: 'hello', proto: 1, role: 'wizard' }), /bad role/)
  assert.throws(() => proto.validate({ t: 'hello', role: 'client' }), /"proto"/)
})

test('validate: tok requires id, numeric index and string token', () => {
  assert.throws(() => proto.validate({ t: 'tok', id: 'x', i: '0', token: 'a' }), /"i"/)
  assert.throws(() => proto.validate({ t: 'tok', id: 'x', i: 0 }), /"token"/)
})

test('validate: arrays and primitives are rejected', () => {
  assert.throws(() => proto.validate([]), /object/)
  assert.throws(() => proto.validate('ping'), /object/)
})

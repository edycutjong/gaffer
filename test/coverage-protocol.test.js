// Coverage: the protocol's remaining validation/encoding guards and constructor
// defaults — the oversized-frame reject, the non-object/array/null rejections,
// an explicitly-null required field, and the announce/req nullish defaults.
// Pure functions called directly with the edge inputs; no network, no SDK.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encode, validate, announce, req, MAX_FRAME } from '../lib/protocol.js'

test('encode rejects a frame larger than MAX_FRAME', () => {
  // The size check runs on the serialized bytes — a token field just over the
  // 4 MiB cap trips it (one transient allocation, no network).
  const huge = { t: 'tok', id: 'x', i: 0, token: 'x'.repeat(MAX_FRAME + 1) }
  assert.throws(() => encode(huge), /MAX_FRAME/)
})

test('validate rejects non-objects, arrays and null', () => {
  assert.throws(() => validate(null), /must be an object/) // !msg
  assert.throws(() => validate(42), /must be an object/) // typeof !== 'object'
  assert.throws(() => validate([{ t: 'ping', ts: 1 }]), /must be an object/) // Array.isArray
})

test('validate rejects a well-formed object with an unknown message type', () => {
  assert.throws(() => validate({ t: 'not-a-type' }), /unknown type/) // line-80 !TYPES.has(t)
})

test('validate reports an explicitly-null required field as "null" (not "object")', () => {
  assert.throws(() => validate({ t: 'hello', proto: null, role: 'provider' }), /must be number, got null/)
})

test('announce and req fill their nullish defaults when optional fields are omitted', () => {
  const a = announce({ engine: 'sim' }) // no tps / model / loadedAt
  assert.equal(a.tps, null)
  assert.equal(a.model, null)
  assert.equal(typeof a.loadedAt, 'number')
  const a2 = announce({ engine: 'sim', tps: 7, model: 'm', loadedAt: 5 }) // all present
  assert.equal(a2.tps, 7)
  assert.equal(a2.model, 'm')
  assert.equal(a2.loadedAt, 5)

  const r = req({ id: 'x', history: [{ role: 'user', content: 'hi' }] }) // no seed / maxTokens / meta
  assert.equal(r.seed, null)
  assert.equal(r.maxTokens, null)
  assert.deepEqual(r.meta, {})
  const r2 = req({ id: 'x', history: [{ role: 'user', content: 'hi' }], seed: 2, maxTokens: 8, meta: { a: 1 } })
  assert.equal(r2.seed, 2)
  assert.equal(r2.maxTokens, 8)
  assert.deepEqual(r2.meta, { a: 1 })
})

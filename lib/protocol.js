// Gaffer wire protocol — framed JSON messages over a Hyperswarm connection.
// The swarm socket is already a Noise secretstream (E2E encrypted), so the
// protocol only handles framing, typing and validation.
//
// Frame layout: [u32 LE payload length][payload = UTF-8 JSON]
//
// Message types:
//   hello    { t, proto, role, name, engine, model, deterministic }
//   announce { t, tps, model, engine, loadedAt }          provider → client
//   req      { t, id, history, seed, maxTokens, meta }     client  → provider
//   tok      { t, id, i, token }                           provider → client
//   end      { t, id, usage: { tokens, ms, tps } }         provider → client
//   err      { t, id, message }                            provider → client
//   cancel   { t, id }                                     client  → provider
//   ping     { t, ts } / pong { t, ts }                    both ways

import b4a from 'b4a'

export const PROTOCOL_VERSION = 1
export const MAX_FRAME = 4 * 1024 * 1024 // 4 MiB hard cap — a frame larger than this is hostile or corrupt

export const ROLES = Object.freeze({ PROVIDER: 'provider', CLIENT: 'client' })

const TYPES = new Set(['hello', 'announce', 'req', 'tok', 'end', 'err', 'cancel', 'ping', 'pong'])

/** Encode one message into a length-prefixed frame. */
export function encode (msg) {
  if (!msg || typeof msg !== 'object') throw new TypeError('encode: message must be an object')
  if (!TYPES.has(msg.t)) throw new TypeError(`encode: unknown message type "${msg.t}"`)
  const json = b4a.from(JSON.stringify(msg), 'utf8')
  if (json.byteLength > MAX_FRAME) throw new RangeError(`encode: frame exceeds MAX_FRAME (${json.byteLength} bytes)`)
  const frame = b4a.allocUnsafe(4 + json.byteLength)
  writeU32LE(frame, json.byteLength, 0)
  frame.set(json, 4)
  return frame
}

/**
 * Incremental frame parser. Feed arbitrary chunk boundaries; emits complete,
 * validated messages via onMessage. Invalid input raises through onError so a
 * hostile peer can be disconnected instead of crashing the process.
 */
export class Parser {
  constructor ({ onMessage, onError }) {
    this._buf = b4a.alloc(0)
    this._onMessage = onMessage
    this._onError = onError || ((err) => { throw err })
    this.messages = 0
  }

  push (chunk) {
    this._buf = this._buf.byteLength === 0 ? b4a.from(chunk) : b4a.concat([this._buf, chunk])
    while (this._buf.byteLength >= 4) {
      const len = readU32LE(this._buf, 0)
      if (len > MAX_FRAME) {
        this._onError(new RangeError(`protocol: frame length ${len} exceeds MAX_FRAME`))
        this._buf = b4a.alloc(0)
        return
      }
      if (this._buf.byteLength < 4 + len) return // wait for more bytes
      const payload = this._buf.subarray(4, 4 + len)
      this._buf = this._buf.subarray(4 + len)
      let msg
      try {
        msg = JSON.parse(b4a.toString(payload, 'utf8'))
        validate(msg)
      } catch (err) {
        this._onError(err)
        continue
      }
      this.messages++
      this._onMessage(msg)
    }
  }
}

/** Structural validation — every inbound message passes through here. */
export function validate (msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new TypeError('protocol: message must be an object')
  if (!TYPES.has(msg.t)) throw new TypeError(`protocol: unknown type "${msg.t}"`)
  switch (msg.t) {
    case 'hello':
      requireField(msg, 'proto', 'number')
      requireField(msg, 'role', 'string')
      if (msg.role !== ROLES.PROVIDER && msg.role !== ROLES.CLIENT) throw new TypeError(`protocol: bad role "${msg.role}"`)
      break
    case 'announce':
      requireField(msg, 'engine', 'string')
      break
    case 'req':
      requireField(msg, 'id', 'string')
      if (!Array.isArray(msg.history) || msg.history.length === 0) throw new TypeError('protocol: req.history must be a non-empty array')
      for (const turn of msg.history) {
        requireField(turn, 'role', 'string')
        requireField(turn, 'content', 'string')
      }
      break
    case 'tok':
      requireField(msg, 'id', 'string')
      requireField(msg, 'i', 'number')
      requireField(msg, 'token', 'string')
      break
    case 'end':
      requireField(msg, 'id', 'string')
      requireField(msg, 'usage', 'object')
      break
    case 'err':
      requireField(msg, 'id', 'string')
      requireField(msg, 'message', 'string')
      break
    case 'cancel':
      requireField(msg, 'id', 'string')
      break
    case 'ping':
    case 'pong':
      requireField(msg, 'ts', 'number')
      break
  }
  return msg
}

// ── message constructors (keeps call sites honest) ─────────────────────────

export function hello ({ role, name, engine, model, deterministic }) {
  return { t: 'hello', proto: PROTOCOL_VERSION, role, name: name || 'anon', engine, model: model || null, deterministic: !!deterministic }
}

export function announce ({ tps, model, engine, loadedAt }) {
  return { t: 'announce', tps: tps ?? null, model: model || null, engine, loadedAt: loadedAt ?? Date.now() }
}

export function req ({ id, history, seed, maxTokens, meta }) {
  return { t: 'req', id, history, seed: seed ?? null, maxTokens: maxTokens ?? null, meta: meta || {} }
}

export function tok ({ id, i, token }) {
  return { t: 'tok', id, i, token }
}

export function end ({ id, usage }) {
  return { t: 'end', id, usage }
}

export function err ({ id, message }) {
  return { t: 'err', id, message }
}

export function cancel ({ id }) {
  return { t: 'cancel', id }
}

export function ping () {
  return { t: 'ping', ts: Date.now() }
}

export function pong (pingMsg) {
  return { t: 'pong', ts: pingMsg.ts }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function requireField (obj, field, type) {
  const v = obj[field]
  const actual = v === null ? 'null' : typeof v
  if (actual !== type) throw new TypeError(`protocol: field "${field}" must be ${type}, got ${actual}`)
}

function writeU32LE (buf, value, offset) {
  buf[offset] = value & 0xff
  buf[offset + 1] = (value >>> 8) & 0xff
  buf[offset + 2] = (value >>> 16) & 0xff
  buf[offset + 3] = (value >>> 24) & 0xff
}

function readU32LE (buf, offset) {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16)) + buf[offset + 3] * 0x1000000
}

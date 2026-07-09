// TtsSpeaker — the honesty wrapper over the engine's on-device Piper voice.
// It never fakes audio and never calls out: every "unavailable" path reports a
// reason. The engine is a plain dependency, faked here (no @qvac/sdk, no audio
// hardware) so the wrapper's own logic is proven end to end.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TtsSpeaker } from '../lib/tts.js'

test('disabled speaker reports unavailable and never touches the engine', async () => {
  let called = false
  const engine = { speak: async () => { called = true; return { available: true, buffer: Buffer.from('x') } } }
  const spk = new TtsSpeaker({ engine })
  const res = await spk.speak('hello')
  assert.deepEqual(res, { available: false, reason: 'tts disabled' })
  assert.equal(called, false)
  assert.equal(spk.spoken, 0)
})

test('setEnabled(true) then an engine without speak() reports "no TTS"', async () => {
  const spk = new TtsSpeaker({ engine: {} })
  spk.setEnabled(1) // coerced to boolean true
  assert.equal(spk.enabled, true)
  const res = await spk.speak('hello')
  assert.deepEqual(res, { available: false, reason: 'engine has no TTS' })
})

test('an engine that cannot synthesize surfaces its reason (and remembers it)', async () => {
  const engine = { speak: async () => ({ available: false, reason: 'Piper voice not installed' }) }
  const spk = new TtsSpeaker({ engine, enabled: true })
  const res = await spk.speak('hello')
  assert.deepEqual(res, { available: false, reason: 'Piper voice not installed' })
  assert.equal(spk.lastReason, 'Piper voice not installed')
  assert.equal(spk.spoken, 0)
})

test('an engine result with no reason defaults lastReason to "unknown"', async () => {
  const engine = { speak: async () => ({ available: false }) }
  const spk = new TtsSpeaker({ engine, enabled: true })
  const res = await spk.speak('hello')
  assert.equal(res.reason, 'unknown')
  assert.equal(spk.lastReason, 'unknown')
})

test('a successful synth increments the counter and forwards the buffer to onAudio', async () => {
  const buf = Buffer.from([1, 2, 3])
  const heard = []
  const engine = { speak: async (text) => ({ available: true, buffer: buf, text }) }
  const spk = new TtsSpeaker({ engine, enabled: true, onAudio: async (b, text) => heard.push({ b, text }) })
  const res = await spk.speak('goal!')
  assert.deepEqual(res, { available: true, buffer: buf })
  assert.equal(spk.spoken, 1)
  assert.deepEqual(heard, [{ b: buf, text: 'goal!' }])
})

test('a successful synth without an onAudio sink still succeeds', async () => {
  const engine = { speak: async () => ({ available: true, buffer: Buffer.from('ok') }) }
  const spk = new TtsSpeaker({ engine, enabled: true })
  const res = await spk.speak('save!')
  assert.equal(res.available, true)
  assert.equal(spk.spoken, 1)
})

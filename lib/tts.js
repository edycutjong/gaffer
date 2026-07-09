// TTS speaker — voice in the ear via the engine's on-device Piper TTS.
// Honesty rule: when the active engine cannot synthesize (sim engine, or a
// QVAC build without the Piper voice), speak() reports unavailable — Gaffer
// never plays fake audio and never calls a cloud TTS.

export class TtsSpeaker {
  constructor ({ engine, enabled = false, onAudio = null }) {
    this.engine = engine
    this.enabled = enabled
    this.onAudio = onAudio
    this.spoken = 0
    this.lastReason = null
  }

  setEnabled (enabled) {
    this.enabled = !!enabled
  }

  async speak (text) {
    if (!this.enabled) return { available: false, reason: 'tts disabled' }
    if (typeof this.engine.speak !== 'function') return { available: false, reason: 'engine has no TTS' }
    const res = await this.engine.speak(text)
    if (!res?.available) {
      this.lastReason = res?.reason ?? 'unknown'
      return { available: false, reason: this.lastReason }
    }
    this.spoken++
    if (this.onAudio) await this.onAudio(res.buffer, text)
    return { available: true, buffer: res.buffer }
  }
}

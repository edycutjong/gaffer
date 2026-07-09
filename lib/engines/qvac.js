// QvacEngine — the real on-device inference adapter over @qvac/sdk.
//
// COVERAGE NOTE: this file is excluded from the unit coverage gate (see the
// "coverage" npm script). Its live calls (loadModel / completion / tokenStream /
// textToSpeech / startQVACProvider / unloadModel) require the optional @qvac/sdk
// plus a GGUF model, and the SDK is NEVER stubbed to fake coverage. The degraded
// (SDK-absent) contract is still tested in test/coverage-qvac.test.js; the live
// paths run via `npm run setup:qvac` + a manual on-device run.
//
// API surface used (verified against @qvac/sdk 0.14.x docs):
//   loadModel({ modelSrc, modelType, onProgress })   modelSrc may be a local
//     path, an HTTP URL, or a pear:// peer URL (P2P model sharing).
//   completion({ modelId, history, stream: true })  → result.tokenStream
//   textToSpeech({ modelId, text, inputType, stream }) → result.buffer (Piper)
//   startQVACProvider({ topic, firewall })          → P2P delegated inference
//   unloadModel({ modelId })
//
// The SDK is intentionally NOT a hard dependency: `npm run setup:qvac`
// installs it, `createEngine({ engine: 'auto' })` falls back to the disclosed
// SimEngine when it (or a model) is absent, and every surface labels which
// engine is live. No cloud path exists in either engine.

export class EngineUnavailableError extends Error {
  constructor (message, cause) {
    super(message)
    this.name = 'EngineUnavailableError'
    this.cause = cause
  }
}

export class QvacEngine {
  /**
   * @param {object} opts
   * @param {string} [opts.modelSrc]  overrides the default model constant —
   *   a local GGUF path, HTTP URL, or pear:// link from scripts/seed_model.js
   * @param {function} [opts.onProgress] model download/load progress callback
   */
  constructor ({ modelSrc = null, onProgress = null } = {}) {
    this.kind = 'qvac'
    this.label = 'qvac'
    // llama.cpp with a fixed seed is deterministic on one machine/build, but
    // not across devices — so the router must NOT assume token-exact resume.
    this.deterministic = false
    this.modelSrc = modelSrc
    this.modelId = null
    this.ttsModelId = null
    this.onProgress = onProgress
    this.sdk = null
    this.loaded = false
  }

  async _import () {
    if (this.sdk) return this.sdk
    try {
      this.sdk = await import('@qvac/sdk')
    } catch (cause) {
      throw new EngineUnavailableError(
        '@qvac/sdk is not installed — run `npm run setup:qvac` (adds ~native inference deps), or use --engine sim',
        cause
      )
    }
    return this.sdk
  }

  async load () {
    const sdk = await this._import()
    const modelSrc = this.modelSrc || sdk.LLAMA_3_2_1B_INST_Q4_0
    if (!modelSrc) throw new EngineUnavailableError('No model source: pass --model-src or use an SDK model constant')
    const res = await sdk.loadModel({
      modelSrc,
      modelType: 'llm',
      onProgress: this.onProgress || undefined
    })
    this.modelId = res?.modelId ?? res
    this.loaded = true
    return { modelId: this.modelId }
  }

  /** Same contract as SimEngine.complete — adapts the SDK's tokenStream.
   *  (`seed` from the request is accepted but unused: the SDK surface has no
   *  seed parameter; only deterministic engines honour it.) */
  complete ({ history, maxTokens = null, signal = null } = {}) {
    if (!this.loaded) throw new Error('QvacEngine: call load() before complete()')
    const sdk = this.sdk
    const modelId = this.modelId
    const started = Date.now()
    let emitted = 0

    const tokenStream = (async function * () {
      const result = await sdk.completion({ modelId, history, stream: true })
      for await (const token of result.tokenStream) {
        if (signal?.aborted) {
          const err = new Error('aborted')
          err.name = 'AbortError'
          throw err
        }
        emitted++
        yield typeof token === 'string' ? token : (token?.token ?? String(token))
        if (maxTokens != null && emitted >= maxTokens) return
      }
    })()

    return {
      modelId,
      tokenStream,
      usage: () => {
        const ms = Math.max(1, Date.now() - started)
        return { tokens: emitted, ms, tps: Math.round((emitted / (ms / 1000)) * 100) / 100 }
      }
    }
  }

  /** On-device Piper TTS. Loads the voice lazily on first call. */
  async speak (text) {
    const sdk = await this._import()
    if (!this.ttsModelId) {
      if (!sdk.TTS_PIPER_NORMAN_EN_US_ONNX_MEDIUM) return { available: false, reason: 'Piper voice constant not exported by this SDK build' }
      const res = await sdk.loadModel({
        modelSrc: sdk.TTS_PIPER_NORMAN_EN_US_ONNX_MEDIUM,
        configSrc: sdk.TTS_PIPER_NORMAN_EN_US_ONNX_MEDIUM_CONFIG,
        modelType: 'tts'
      })
      this.ttsModelId = res?.modelId ?? res
    }
    const out = await sdk.textToSpeech({ modelId: this.ttsModelId, text, inputType: 'text', stream: false })
    return { available: true, buffer: out?.buffer ?? out }
  }

  /**
   * Expose this device as a P2P inference provider using the SDK-native
   * delegation (same Holepunch substrate as our Hyperswarm room). Gaffer's own
   * provider protocol (lib/provider.js) is the engine-agnostic path; this is
   * the SDK-native one, used when available.
   */
  async startNativeProvider ({ topic, firewall = null } = {}) {
    const sdk = await this._import()
    if (typeof sdk.startQVACProvider !== 'function') {
      return { available: false, reason: 'startQVACProvider not exported by this SDK build' }
    }
    const handle = await sdk.startQVACProvider(firewall ? { topic, firewall } : { topic })
    return { available: true, handle }
  }

  async unload () {
    if (this.sdk && this.modelId != null) {
      try {
        await this.sdk.unloadModel({ modelId: this.modelId })
      } catch {
        // model may already be gone — unload is best-effort teardown
      }
    }
    this.loaded = false
  }
}

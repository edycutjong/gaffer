// QvacEngine contract WITHOUT @qvac/sdk installed. lib/engines/qvac.js is the
// real on-device SDK adapter and is excluded from the coverage gate (its live
// calls need the optional @qvac/sdk + a GGUF model — see the "coverage" npm
// script). These tests still assert the honest degraded behaviour: when the SDK
// is absent, the SDK-backed methods report EngineUnavailableError instead of a
// confusing lower-level crash, and unload() on a never-loaded engine is a no-op.
// The SDK is NEVER stubbed — presence is detected and the live paths are left to
// `npm run setup:qvac` + a manual run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QvacEngine, EngineUnavailableError } from '../lib/engines/qvac.js'

let sdkPresent = true
try { await import('@qvac/sdk') } catch { sdkPresent = false }

test('speak() without @qvac/sdk reports the engine unavailable (never fake audio)', async (t) => {
  if (sdkPresent) return t.skip('real @qvac/sdk installed — live TTS path not exercised here')
  await assert.rejects(new QvacEngine({}).speak('hello'), EngineUnavailableError)
})

test('startNativeProvider() without @qvac/sdk reports the engine unavailable', async (t) => {
  if (sdkPresent) return t.skip('real @qvac/sdk installed — live provider path not exercised here')
  await assert.rejects(new QvacEngine({}).startNativeProvider({ topic: Buffer.alloc(32) }), EngineUnavailableError)
})

test('unload() on a never-loaded engine is a safe no-op', async () => {
  const e = new QvacEngine({})
  await e.unload() // no SDK was ever imported → nothing to tear down
  assert.equal(e.loaded, false)
})

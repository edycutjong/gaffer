import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEngine, EngineUnavailableError, QvacEngine } from '../lib/engine.js'

test('explicit sim engine loads without any SDK', async () => {
  const { engine, requested, fallback } = await createEngine({ engine: 'sim', tps: Infinity })
  assert.equal(engine.kind, 'sim')
  assert.equal(requested, 'sim')
  assert.equal(fallback, false)
  assert.equal(engine.loaded, true)
})

test('auto falls back to sim when @qvac/sdk is absent — and says so', async () => {
  const logs = []
  const { engine, fallback } = await createEngine({ engine: 'auto', tps: Infinity, log: (m) => logs.push(m) })
  if (engine.kind === 'sim') {
    // machine without the SDK (CI): fallback path
    assert.equal(fallback, true)
    assert.ok(logs.some(l => /qvac engine unavailable|falling back/.test(l)), 'fallback is logged, never silent')
  } else {
    // machine with the SDK installed: real engine, no fallback
    assert.equal(engine.kind, 'qvac')
    assert.equal(fallback, false)
  }
})

test('explicit qvac request does NOT silently downgrade', async () => {
  let sdkPresent = true
  try {
    await import('@qvac/sdk')
  } catch {
    sdkPresent = false
  }
  if (sdkPresent) return // real SDK installed — downgrade path not reachable
  await assert.rejects(createEngine({ engine: 'qvac' }), EngineUnavailableError)
})

test('QvacEngine declares itself non-deterministic (honest resume semantics)', () => {
  const e = new QvacEngine({})
  assert.equal(e.kind, 'qvac')
  assert.equal(e.deterministic, false)
  assert.equal(e.loaded, false)
})

test('QvacEngine.complete before load fails loudly', () => {
  const e = new QvacEngine({})
  assert.throws(() => e.complete({ history: [{ role: 'user', content: 'x' }] }), /load\(\) before complete/)
})

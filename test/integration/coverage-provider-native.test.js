// Coverage: ProviderNode's optional SDK-native delegation branch in start().
// When the engine exposes startNativeProvider() the provider offers it as a
// best-effort extra path — a working bridge is recorded, and a broken one is
// caught and reported (never taking down the engine-agnostic Gaffer protocol).
// The engine is a plain fake exposing that method (NOT @qvac/sdk); the swarm
// join is real over an in-process HyperDHT testnet.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import createTestnet from 'hyperdht/testnet.js'
import { ProviderNode } from '../../lib/provider.js'

function fakeEngine (startNativeProvider) {
  return { kind: 'sim', modelId: 'fake', deterministic: true, tps: 1, loaded: false, async load () { this.loaded = true }, startNativeProvider }
}

test('a working native provider bridge is recorded and announced', async (t) => {
  const tn = await createTestnet(3)
  let stopped = false
  const engine = fakeEngine(async ({ topic }) => {
    assert.ok(topic, 'the swarm topic is handed to the bridge')
    return { available: true, handle: { stop: async () => { stopped = true } } }
  })
  const provider = new ProviderNode({ matchId: 'itg-native-ok', engine, bootstrap: tn.bootstrap, nativeProvider: true })
  const nativeEvent = new Promise((resolve) => provider.once('native-provider', resolve))
  await provider.start()
  t.after(async () => { await provider.stop().catch(() => {}); await tn.destroy() })

  const native = await nativeEvent
  assert.equal(native.available, true)
  assert.equal(provider.native.available, true)
  await provider.stop()
  assert.equal(stopped, true, 'stop() tears the native handle down')
})

test('a broken native provider bridge is caught and reported unavailable', async (t) => {
  const tn = await createTestnet(3)
  const engine = fakeEngine(async () => { throw new Error('bridge exploded') })
  const provider = new ProviderNode({ matchId: 'itg-native-bad', engine, bootstrap: tn.bootstrap, nativeProvider: true })
  await provider.start()
  t.after(async () => { await provider.stop().catch(() => {}); await tn.destroy() })

  assert.equal(provider.native.available, false)
  assert.match(provider.native.reason, /bridge exploded/)
})

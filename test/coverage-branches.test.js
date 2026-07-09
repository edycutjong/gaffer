// Coverage: the remaining defensive/edge BRANCHES the behavioural suites don't
// force — link-local hosts, the tls.connect guard, the many host-extraction
// shapes, prompt/sim/match fallbacks, and a handful of router/provider guards.
// All pure or in-process (fakes for dependencies); no @qvac/sdk, no live DHT.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import tls from 'node:tls'
import net from 'node:net'
import b4a from 'b4a'

import { installNetworkGuard, isLoopbackHost, NetworkViolationError } from '../lib/offline-guard.js'
import { GafferSwarm, Peer } from '../lib/swarm.js'
import { systemPrompt } from '../lib/prompt.js'
import { composeCommentary, tokenize } from '../lib/engines/sim.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'
import { InferenceRouter, AsyncQueue } from '../lib/router.js'
import { ProviderNode } from '../lib/provider.js'
import { round2 } from '../lib/metrics.js'
import { buildHistory } from '../lib/prompt.js'

// ── offline-guard.js: link-local + every host-extraction shape ──────────────

test('isLoopbackHost treats fe80: link-local as local', () => {
  assert.equal(isLoopbackHost('fe80::1'), true)
})

test('the tls.connect wrapper is guarded like the rest', () => {
  const { uninstall } = installNetworkGuard()
  try {
    assert.throws(() => tls.connect({ host: 'tls.evil.com', port: 443 }), NetworkViolationError)
  } finally { uninstall() }
})

test('tls.connect with no host defaults to localhost and is allowed', async () => {
  const { uninstall, report } = installNetworkGuard()
  try {
    await new Promise((resolve) => {
      const s = tls.connect({ port: 65002 }) // no host → 'localhost'
      s.on('error', () => resolve()) // nothing listening — but the guard already inspected 'localhost'
      s.on('secureConnect', () => { s.destroy(); resolve() })
    })
    assert.ok(report.allowed.some(a => /localhost \(via tls\.connect\)/.test(a)))
  } finally { uninstall() }
})

test('fetch with a Request-like object reads .url; http.request reads URL / host / defaults', async () => {
  const { uninstall, report } = installNetworkGuard()
  try {
    await assert.rejects(() => fetch({ url: 'https://api.evil.com/x' }), NetworkViolationError)
    assert.throws(() => http.request(new URL('http://url-object.evil.com/')), NetworkViolationError) // a instanceof URL
    assert.throws(() => http.request({ host: 'host-form.evil.com:8080' }), NetworkViolationError) // a.host split
    // neither hostname nor host → 'localhost' default → allowed (not blocked)
    const req = http.request({ port: 65000 })
    req.on('error', () => {})
    req.destroy()
    assert.ok(report.allowed.some(a => /localhost \(via http\.request\)/.test(a)))
  } finally { uninstall() }
})

test('direct Socket.connect(port) with no host defaults to localhost; a string port is parsed', async () => {
  const server = net.createServer((s) => s.end())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const { uninstall, report } = installNetworkGuard()
  try {
    await new Promise((resolve, reject) => {
      const s = new net.Socket()
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', reject)
      s.connect(port) // numeric, no host → 'localhost'
    })
    await new Promise((resolve, reject) => {
      const s = new net.Socket()
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', reject)
      s.connect(String(port), '127.0.0.1') // string port without a slash
    })
    assert.equal(report.blocked.length, 0)
    assert.ok(report.allowed.length >= 2)
  } finally { uninstall(); server.close() }
})

// ── swarm.js: bad role + the role getter's null fallback ────────────────────

test('GafferSwarm rejects an unknown role before any swarm is created', () => {
  assert.throws(() => new GafferSwarm({ matchId: 'x', role: 'referee', bootstrap: [] }), TypeError)
})

test('Peer.role is null until a hello arrives', () => {
  const peer = new Peer({ remotePublicKey: b4a.alloc(32, 1) }, {})
  assert.equal(peer.role, null)
})

// ── prompt.js / sim.js / match.js: the pure fallbacks ───────────────────────

test('systemPrompt falls back to 2 sentences for an unknown verbosity', () => {
  const p = systemPrompt({ fixture: DEFAULT_FIXTURE, verbosity: 'operatic' })
  assert.match(p, /at most 2 short sentences/)
})

test('composeCommentary degrades gracefully with a missing system or user turn', () => {
  const noSystem = composeCommentary({ history: [{ role: 'user', content: '[00:00] [score 0-0] kickoff — both sides — midfield circle.' }] })
  assert.ok(noSystem.length > 0)
  const noUser = composeCommentary({ history: [{ role: 'system', content: 'You are Gaffer.' }] })
  assert.ok(noUser.length > 0)
})

test('tokenize returns an empty array for empty text', () => {
  assert.deepEqual(tokenize(''), [])
})

test('round2 passes null through and rounds real numbers to 2dp', () => {
  assert.equal(round2(null), null) // the defensive nullish guard (summarize relies on it)
  assert.equal(round2(undefined), null)
  assert.equal(round2(1.23456), 1.23)
})

test('MatchSimulator.all() is memoised (same array on the second call)', () => {
  const sim = new MatchSimulator({ seed: 1, minutes: 6 })
  const a = sim.all()
  const b = sim.all()
  assert.equal(a, b)
})

// ── router.js: AsyncQueue idempotence + message/abort guards ─────────────────

test('AsyncQueue.end() and .fail() are no-ops once the queue is done', () => {
  const q = new AsyncQueue()
  q.end()
  q.end() // second end → early return
  q.fail(new Error('ignored')) // fail after done → early return, error not stored
})

test('router ignores unknown message types and messages for unknown in-flight ids', () => {
  const router = new InferenceRouter({ matchId: 'cov', engine: { kind: 'sim', modelId: 'x', deterministic: true }, p2p: false })
  const peer = { send () { return true } }
  // not announce/tok/end/err → dropped
  router._onMessage(peer, { t: 'ping', ts: 1 })
  // a token for an id we never issued → dropped (no inflight)
  router._onMessage(peer, { t: 'tok', id: 'ghost', i: 0, token: 'x' })
  assert.equal(router._inflight.size, 0)
})

test('_remoteSegment throws immediately when the signal is already aborted', async () => {
  const router = new InferenceRouter({ matchId: 'cov', engine: { kind: 'sim', modelId: 'x', deterministic: true }, p2p: false })
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(
    router._remoteSegment({ provider: { send: () => true }, history: [{ role: 'user', content: 'x' }], seed: 0, maxTokens: null, signal: ac.signal, out: new AsyncQueue(), emitted: [] }),
    (err) => err.name === 'AbortError'
  )
})

// ── provider.js: the seed default when a request omits it ────────────────────

test('provider defaults a missing request seed to 0', async () => {
  let seen
  const emptyStream = { [Symbol.asyncIterator] () { return { next: () => Promise.resolve({ done: true, value: undefined }) } } }
  const engine = {
    kind: 'sim', modelId: 'fake', deterministic: true, tps: 1, loaded: true, async load () {},
    complete ({ seed }) { seen = seed; return { modelId: 'fake', tokenStream: emptyStream, usage: () => ({ tokens: 0, ms: 1, tps: 0 }) } }
  }
  const provider = new ProviderNode({ matchId: 'cov', engine, bootstrap: [] })
  const peer = { publicKey: 'ef'.repeat(32), conn: { destroyed: false }, send () { return true } }
  await provider._serve(peer, { t: 'req', id: 'noseed', history: buildHistory({ fixture: DEFAULT_FIXTURE, event: new MatchSimulator({ seed: 8 }).all().find(e => e.side) }) })
  assert.equal(seen, 0)
  await provider.stop()
})

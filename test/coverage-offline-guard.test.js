// Coverage: the offline-guard's remaining primitives and argument shapes — the
// https.request wrapper, fetch with an unparseable URL, net.connect by numeric
// port and by unix path, and http.request called with a string URL / an invalid
// string / no argument at all. Every branch of the two arg-normalisers is hit
// so the "no cloud" guard is proven across the ways Node code reaches the wire.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { installNetworkGuard, NetworkViolationError } from '../lib/offline-guard.js'

test('guard blocks https.request to a public host (default-import surface)', () => {
  const { uninstall, report } = installNetworkGuard()
  try {
    assert.throws(() => https.request({ hostname: 'huggingface.co', port: 443 }), NetworkViolationError)
    assert.ok(report.blocked.some(b => /huggingface\.co/.test(b)))
  } finally { uninstall() }
})

test('guard treats an unparseable fetch URL as "unknown" and blocks it', async () => {
  const { uninstall, report } = installNetworkGuard()
  try {
    await assert.rejects(() => fetch('http://[not-a-valid-url'), NetworkViolationError)
    assert.ok(report.blocked.some(b => /unknown \(via fetch\)/.test(b)))
  } finally { uninstall() }
})

test('guard inspects a direct Socket.connect(port, host) and allows a loopback numeric target', async () => {
  // net.connect() pre-normalises its args to an options object; calling
  // Socket.prototype.connect directly with (port, host) exercises the numeric arg
  // branch of normalizeConnectArgs.
  const server = net.createServer((s) => s.end())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const { uninstall, report } = installNetworkGuard()
  try {
    await new Promise((resolve, reject) => {
      const s = new net.Socket()
      s.on('connect', () => { s.destroy(); resolve() })
      s.on('error', reject)
      s.connect(port, '127.0.0.1')
    })
    assert.ok(report.allowed.length >= 1, 'numeric-port connect was inspected and allowed')
    assert.equal(report.blocked.length, 0)
  } finally { uninstall(); server.close() }
})

test('guard leaves a direct Socket.connect(path) alone (a unix path carries no host)', async () => {
  const { uninstall, report } = installNetworkGuard()
  try {
    await new Promise((resolve) => {
      const s = new net.Socket()
      s.on('error', () => resolve()) // ENOENT — but the guard must not have blocked it
      s.connect('/tmp/gaffer-nonexistent-' + Date.now() + '.sock')
    })
    assert.equal(report.blocked.length, 0, 'a path connect carries no host, so it is never blocked')
  } finally { uninstall() }
})

test('http.request accepts a string URL and the guard reads its host', () => {
  const { uninstall, report } = installNetworkGuard()
  try {
    assert.throws(() => http.request('http://example.com/models'), NetworkViolationError)
    assert.ok(report.blocked.some(b => /example\.com/.test(b)))
  } finally { uninstall() }
})

test('http.request with a non-URL string or no argument falls back to "unknown" and blocks', () => {
  const { uninstall, report } = installNetworkGuard()
  try {
    assert.throws(() => http.request('this is not a url'), NetworkViolationError) // new URL throws → 'unknown'
    assert.throws(() => http.request(), NetworkViolationError) // no arg → 'unknown'
    assert.ok(report.blocked.filter(b => /unknown \(via http\.request\)/.test(b)).length >= 2)
  } finally { uninstall() }
})

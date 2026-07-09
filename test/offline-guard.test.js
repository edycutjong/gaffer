import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { installNetworkGuard, isLoopbackHost, NetworkViolationError } from '../lib/offline-guard.js'

test('isLoopbackHost: loopback and LAN ranges', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.255']) {
    assert.equal(isLoopbackHost(h), true, h)
  }
  for (const h of ['api.openai.com', '8.8.8.8', '172.32.0.1', '1.1.1.1', 'huggingface.co', '']) {
    assert.equal(isLoopbackHost(h), false, h)
  }
})

test('guard blocks fetch to a public host and records the attempt', async () => {
  const { report, uninstall } = installNetworkGuard()
  try {
    await assert.rejects(
      () => fetch('https://api.openai.com/v1/models'),
      (err) => err instanceof NetworkViolationError
    )
    assert.equal(report.blocked.length, 1)
    assert.match(report.blocked[0], /api\.openai\.com/)
  } finally {
    uninstall()
  }
})

test('guard blocks https.request to a public host', async () => {
  const { uninstall } = installNetworkGuard()
  try {
    const https = await import('node:https')
    assert.throws(() => https.request('https://huggingface.co/models'), NetworkViolationError)
  } finally {
    uninstall()
  }
})

test('guard allows loopback http and the request truly works', async () => {
  const server = http.createServer((req, res) => res.end('local-ok'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const { report, uninstall } = installNetworkGuard()
  try {
    const body = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve(data))
      }).on('error', reject)
    })
    assert.equal(body, 'local-ok')
    assert.ok(report.allowed.length >= 1)
    assert.equal(report.blocked.length, 0)
  } finally {
    uninstall()
    server.close()
  }
})

test('strict mode (blockLan) refuses RFC1918 too', () => {
  const { uninstall } = installNetworkGuard({ blockLan: true })
  try {
    assert.throws(() => http.request({ hostname: '192.168.1.50', port: 80 }), NetworkViolationError)
  } finally {
    uninstall()
  }
})

test('throwOnViolation=false records but does not throw', async () => {
  const { report, uninstall } = installNetworkGuard({ throwOnViolation: false })
  try {
    // The request object is created; we abort immediately — DNS may fail later,
    // which is fine: we only assert the guard's accounting.
    const req = http.request({ hostname: 'example.com', port: 80 })
    req.on('error', () => {})
    req.destroy()
    assert.equal(report.blocked.length, 1)
  } finally {
    uninstall()
  }
})

test('uninstall restores the primitives', async () => {
  const originalFetch = globalThis.fetch
  const { uninstall } = installNetworkGuard()
  assert.notEqual(globalThis.fetch, originalFetch)
  uninstall()
  assert.equal(globalThis.fetch, originalFetch)
})

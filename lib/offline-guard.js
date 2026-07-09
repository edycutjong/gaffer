// Network guard — the enforcement half of the "zero cloud" claim.
//
// installNetworkGuard() intercepts every outbound network primitive in the
// process (net/tls socket connects, http/https requests, fetch) and rejects
// any destination that is not loopback / link-local. scripts/verify_offline.js
// runs the full commentary loop under this guard: if any code path tried to
// call a cloud API, the run would fail loudly. Tests assert both directions
// (loopback allowed, remote blocked).

import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'])

export function isLoopbackHost (host) {
  if (!host) return false
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase()
  if (LOOPBACK.has(h)) return true
  if (h.startsWith('127.')) return true
  if (h.startsWith('fe80:')) return true
  // RFC1918 ranges count as "no cloud" for the LAN/offline demo: the whole
  // point is peer↔peer on a local network with the internet unreachable.
  if (h.startsWith('10.')) return true
  if (h.startsWith('192.168.')) return true
  const m172 = h.match(/^172\.(\d+)\./)
  if (m172) {
    const octet = Number(m172[1])
    if (octet >= 16 && octet <= 31) return true
  }
  return false
}

export class NetworkViolationError extends Error {
  constructor (target) {
    super(`offline-guard: blocked outbound connection to ${target} — Gaffer must not touch the network beyond loopback/LAN`)
    this.name = 'NetworkViolationError'
    this.target = target
  }
}

/**
 * Install the guard. Returns { report, uninstall }.
 * @param {object} opts
 * @param {boolean} [opts.blockLan=false] also block RFC1918 (strict airplane mode)
 * @param {boolean} [opts.throwOnViolation=true] throw vs just record
 */
export function installNetworkGuard ({ blockLan = false, throwOnViolation = true } = {}) {
  const report = { attempts: [], blocked: [], allowed: [] }

  const allowedHost = (host) => {
    if (blockLan) {
      const h = String(host || '').toLowerCase()
      return LOOPBACK.has(h) || h.startsWith('127.') || h === '::1'
    }
    return isLoopbackHost(host)
  }

  const inspect = (host, source) => {
    const target = `${host} (via ${source})`
    report.attempts.push(target)
    if (allowedHost(host)) {
      report.allowed.push(target)
      return true
    }
    report.blocked.push(target)
    if (throwOnViolation) throw new NetworkViolationError(target)
    return false
  }

  const originals = {
    netConnect: net.Socket.prototype.connect,
    tlsConnect: tls.connect,
    httpRequest: http.request,
    httpsRequest: https.request,
    fetch: globalThis.fetch
  }

  net.Socket.prototype.connect = function guardedConnect (...args) {
    const opts = normalizeConnectArgs(args)
    if (opts.path == null) inspect(opts.host || 'localhost', 'net.Socket.connect')
    return originals.netConnect.apply(this, args)
  }

  tls.connect = function guardedTlsConnect (...args) {
    const opts = normalizeConnectArgs(args)
    inspect(opts.host || 'localhost', 'tls.connect')
    return originals.tlsConnect.apply(tls, args)
  }

  http.request = function guardedHttpRequest (...args) {
    inspect(hostFromRequestArgs(args), 'http.request')
    return originals.httpRequest.apply(http, args)
  }

  https.request = function guardedHttpsRequest (...args) {
    inspect(hostFromRequestArgs(args), 'https.request')
    return originals.httpsRequest.apply(https, args)
  }

  globalThis.fetch = async function guardedFetch (input, init) {
    const url = typeof input === 'string' ? input : input?.url
    let host = 'unknown'
    try {
      host = new URL(url).hostname
    } catch {
      // relative/invalid URL — fetch will fail on its own terms
    }
    inspect(host, 'fetch')
    return originals.fetch.call(globalThis, input, init)
  }

  const uninstall = () => {
    net.Socket.prototype.connect = originals.netConnect
    tls.connect = originals.tlsConnect
    http.request = originals.httpRequest
    https.request = originals.httpsRequest
    globalThis.fetch = originals.fetch
  }

  return { report, uninstall }
}

function normalizeConnectArgs (args) {
  if (typeof args[0] === 'object' && args[0] !== null) return args[0]
  if (typeof args[0] === 'number') return { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' }
  if (typeof args[0] === 'string' && !args[0].includes('/')) return { port: Number(args[0]), host: typeof args[1] === 'string' ? args[1] : 'localhost' }
  return { path: args[0] }
}

function hostFromRequestArgs (args) {
  const a = args[0]
  if (typeof a === 'string') {
    try {
      return new URL(a).hostname
    } catch {
      return 'unknown'
    }
  }
  if (a instanceof URL) return a.hostname
  if (a && typeof a === 'object') return a.hostname || a.host?.split(':')[0] || 'localhost'
  return 'unknown'
}

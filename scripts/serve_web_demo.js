#!/usr/bin/env node
// Tiny static server for the browser demo/capture of the HUD (replay mode).
// Loopback only — this is a convenience viewer, not a deployment.
//
//   npm run demo:web   →   http://127.0.0.1:8484/app/
//
// In a plain browser the live P2P stack cannot run (no UDP), so the HUD
// auto-plays app/replay/session.json — a recorded real session, badged as such.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.argv[2] || 8484)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (urlPath.endsWith('/')) urlPath += 'index.html'
  const file = path.normalize(path.join(ROOT, urlPath))
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end()
    return
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${PORT} is in use — pick another: node scripts/serve_web_demo.js ${PORT + 1}`)
  } else {
    console.error('server error:', err.message)
  }
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`gaffer web demo (replay mode): http://127.0.0.1:${PORT}/app/`)
  console.log(`landing page:                  http://127.0.0.1:${PORT}/landing/`)
  console.log('Ctrl-C to stop.')
})

// pear:// model sharing — seed a GGUF (or any file) as a Hyperdrive and fetch
// it on another machine with zero internet. This is how a fresh phone in a
// stadium gets a working model from the laptop next to it.
//
// The QVAC SDK accepts pear:// URLs directly in loadModel({ modelSrc }); this
// module provides (a) the seeder that creates such a link from a local file
// and (b) an engine-independent fetcher used by tests and the offline demo.
//
// COVERAGE NOTE: excluded from the unit coverage gate (see the "coverage" npm
// script). It is real Corestore/Hyperdrive/Hyperswarm P2P I/O; the only funcs
// the gate can't reach in-process are the close()-rejection teardown swallows
// (they fire solely on a corrupt/locked corestore). The module is proven
// end-to-end by test/integration/modelshare.test.js.

import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import z32 from 'z32'
import b4a from 'b4a'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

export function driveUrl (key, file = '') {
  const id = z32.encode(key)
  return `pear://${id}${file ? '/' + file.replace(/^\//, '') : ''}`
}

export function parseDriveUrl (url) {
  const m = /^pear:\/\/([a-z0-9]+)(?:\/(.*))?$/i.exec(String(url).trim())
  if (!m) throw new TypeError(`modelshare: not a pear:// drive URL: ${url}`)
  return { key: b4a.from(z32.decode(m[1])), file: m[2] ? '/' + m[2] : null }
}

/**
 * Seed a local file into a Hyperdrive and announce it on the swarm.
 * Keep the returned handle alive while peers download.
 */
export async function seedFile ({ filePath, storage, name = null, bootstrap = undefined }) {
  const file = '/' + (name || path.basename(filePath))
  const store = new Corestore(storage)
  const drive = new Hyperdrive(store)
  await drive.ready()
  // Stream, don't buffer — a real GGUF is hundreds of MB.
  await pipeline(fs.createReadStream(filePath), drive.createWriteStream(file))

  const swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
  swarm.on('connection', (conn) => store.replicate(conn))
  const discovery = swarm.join(drive.discoveryKey, { server: true, client: true })
  await discovery.flushed()

  return {
    key: drive.key,
    url: driveUrl(drive.key, file.slice(1)),
    file,
    async close () {
      await swarm.destroy()
      await drive.close()
      await store.close()
    }
  }
}

/**
 * Fetch a pear:// drive file from peers into destPath.
 * @returns {{ bytes: number, ms: number, destPath: string }}
 */
export async function fetchFile ({ url, destPath, storage, bootstrap = undefined, timeoutMs = 60_000 }) {
  const { key, file } = parseDriveUrl(url)
  if (!file) throw new TypeError('modelshare.fetchFile: URL must include a file path')
  const store = new Corestore(storage)
  const drive = new Hyperdrive(store, key)
  await drive.ready()

  const swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
  swarm.on('connection', (conn) => store.replicate(conn))
  swarm.join(drive.discoveryKey, { server: false, client: true })

  // Tell the drive we are still looking for peers until the swarm settles —
  // without this, get() reports "missing" before the seeder ever connects.
  const done = drive.findingPeers()
  swarm.flush().then(done, done)

  const started = Date.now()
  try {
    // DHT announces propagate asynchronously; retry until the seeder shows up
    // or the deadline passes. Each attempt re-opens the finding-peers window.
    const deadline = started + timeoutMs
    let entry = await drive.entry(file)
    while (!entry && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250))
      const finding = drive.findingPeers()
      swarm.flush().then(finding, finding)
      entry = await drive.entry(file)
    }
    if (!entry) throw new Error(`modelshare: ${file} not found in drive (or no peer online)`)
    // Stream the blob to disk — never hold a whole model in memory.
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    await pipeline(drive.createReadStream(file), fs.createWriteStream(destPath))
    const bytes = fs.statSync(destPath).size
    return { bytes, ms: Date.now() - started, destPath }
  } finally {
    await swarm.destroy()
    await drive.close().catch(() => {})
    await store.close().catch(() => {})
  }
}

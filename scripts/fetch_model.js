#!/usr/bin/env node
// Fetch a pear://-shared model file from peers (the other half of
// seed_model.js). Works with zero internet — only the P2P swarm.
//
//   node scripts/fetch_model.js 'pear://<key>/model.gguf' ./models/model.gguf

import process from 'node:process'
import path from 'node:path'
import os from 'node:os'
import { fetchFile } from '../lib/modelshare.js'

const args = process.argv.slice(2)
const url = args[0]
const dest = args[1]
if (!url || !dest) {
  console.error('usage: node scripts/fetch_model.js <pear://url> <dest-path> [--bootstrap <json>]')
  process.exit(1)
}
const bIdx = args.indexOf('--bootstrap')
const bootstrap = bIdx === -1 ? undefined : JSON.parse(args[bIdx + 1])

console.log(`fetching ${url}\n → ${dest}`)
const storage = path.join(os.tmpdir(), 'gaffer-model-fetch', path.basename(dest))
const res = await fetchFile({ url, destPath: path.resolve(dest), storage, bootstrap, timeoutMs: 10 * 60_000 })
const mb = (res.bytes / (1024 * 1024)).toFixed(1)
console.log(`✓ ${mb} MB in ${(res.ms / 1000).toFixed(1)}s — from a peer, not a CDN.`)
process.exit(0)

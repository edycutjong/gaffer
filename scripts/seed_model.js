#!/usr/bin/env node
// Seed a model file (GGUF) over pear:// so peers fetch it with no internet.
// The printed URL can be passed straight to `--model-src` (the QVAC SDK
// accepts pear:// model sources natively) or fetched with fetch_model.js.
//
//   node scripts/seed_model.js /path/to/model.gguf
//   node scripts/seed_model.js /path/to/model.gguf --bootstrap '[{"host":"192.168.1.10","port":49737}]'

import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { seedFile } from '../lib/modelshare.js'

const args = process.argv.slice(2)
const filePath = args.find(a => !a.startsWith('--'))
if (!filePath || !fs.existsSync(filePath)) {
  console.error('usage: node scripts/seed_model.js <path-to-model.gguf> [--bootstrap <json>]')
  process.exit(1)
}
const bIdx = args.indexOf('--bootstrap')
const bootstrap = bIdx === -1 ? undefined : JSON.parse(args[bIdx + 1])

const storage = path.join(os.tmpdir(), 'gaffer-model-seed', path.basename(filePath))
const mb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(1)

console.log(`seeding ${filePath} (${mb} MB) …`)
const seeder = await seedFile({ filePath, storage, bootstrap })
console.log('\n✓ model is live on the swarm — no internet required to fetch it.')
console.log(`\n  pear:// link:\n  ${seeder.url}\n`)
console.log('on the other machine:')
console.log(`  node scripts/fetch_model.js '${seeder.url}' ./models/${path.basename(filePath)}`)
console.log(`  # or run the client with:  --model-src '${seeder.url}'`)
console.log('\nkeep this process running while peers download. Ctrl-C to stop.')

const stop = async () => {
  await seeder.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

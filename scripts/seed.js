#!/usr/bin/env node
// Deterministic demo-data generator — writes the match fixtures used by the
// demo, docs and app. Same seed → byte-identical fixture files on every
// machine (verified by regenerating and diffing).
//
// Usage: node scripts/seed.js [--out data/fixtures]

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outIdx = process.argv.indexOf('--out')
const OUT = path.resolve(ROOT, outIdx === -1 ? 'data/fixtures' : process.argv[outIdx + 1])

const MATCHES = [
  { id: 'final-2026', seed: 2047, minutes: 90, note: 'the demo match — a 3-2 thriller with an 86th-minute winner and a penalty' },
  { id: 'semi-2026', seed: 1998, minutes: 90, note: 'alternate feed for multi-room tests' },
  { id: 'short-demo', seed: 7, minutes: 12, note: 'twelve-minute quick demo / video capture' }
]

fs.mkdirSync(OUT, { recursive: true })
for (const m of MATCHES) {
  const sim = new MatchSimulator({
    fixture: { ...DEFAULT_FIXTURE, id: m.id },
    seed: m.seed,
    minutes: m.minutes
  })
  const events = sim.all()
  const goals = events.filter(e => e.type === 'goal')
  const doc = {
    generatedBy: 'scripts/seed.js',
    deterministic: true,
    note: m.note,
    matchId: m.id,
    seed: m.seed,
    minutes: m.minutes,
    fixture: { ...DEFAULT_FIXTURE, id: m.id },
    finalScore: events[events.length - 1].score,
    eventCount: events.length,
    events
  }
  const file = path.join(OUT, `${m.id}.json`)
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
  console.log(`✓ ${path.relative(ROOT, file)} — ${events.length} events, final score ${doc.finalScore.home}-${doc.finalScore.away} (${goals.length} goals), seed ${m.seed}`)
}
console.log('\nRegenerate any time — identical output for identical seeds.')

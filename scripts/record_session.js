#!/usr/bin/env node
// Records a REAL end-to-end session (local → offload surge → provider death →
// token-exact resume → recovery) into app/replay/session.json. The HUD plays
// this back in plain browsers, clearly badged as a replay of a real run —
// the offload is never faked, it is re-rendered.
//
// Usage: node scripts/record_session.js [--out app/replay/session.json]

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import createTestnet from 'hyperdht/testnet.js'
import { SimEngine } from '../lib/engines/sim.js'
import { ProviderNode } from '../lib/provider.js'
import { InferenceRouter, STATES } from '../lib/router.js'
import { CommentaryEngine } from '../lib/commentary.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outIdx = process.argv.indexOf('--out')
const OUT = path.resolve(ROOT, outIdx === -1 ? 'app/replay/session.json' : process.argv[outIdx + 1])

const SEED = 2047
const WEAK_TPS = 6
const LAPTOP_TPS = 48

const t0 = Date.now()
const events = []
const rec = (kind, data = {}) => events.push({ t: Date.now() - t0, kind, data })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

console.log('recording a real session (testnet, weak client 6 tok/s, laptop 48 tok/s)…')

const tn = await createTestnet(3)
const matchId = 'final-2026'

// weak client, always on
const clientEngine = new SimEngine({ tps: WEAK_TPS })
const router = new InferenceRouter({ matchId, engine: clientEngine, bootstrap: tn.bootstrap, tokenGapTimeoutMs: 4000 })
// honest connect number: provider process boot → encrypted link established
let providerBootAt = null
router.on('state', ({ prev, next }) => rec('state', { prev, next }))
router.on('provider', (peer) => rec('provider', { shortKey: peer.shortKey, connectMs: providerBootAt ? Date.now() - providerBootAt : null, announce: peer.announce ?? { engine: 'sim' } }))
router.on('provider-gone', () => rec('provider-gone'))
router.on('failover', (d) => rec('failover', d))

const commentary = new CommentaryEngine({ router, fixture: DEFAULT_FIXTURE, seed: SEED })
commentary.on('segment-start', ({ event }) => rec('segment-start', { event: pickEvent(event) }))
commentary.on('token', ({ token, source }) => rec('token', { token, source }))
commentary.on('segment-end', (s) => rec('segment-end', { source: s.source, sources: s.sources, tps: s.tps, tokens: s.tokens, resumed: s.resumed }))

await router.start()

const match = new MatchSimulator({ seed: SEED }).all().filter(e => e.side || e.priority)
let cursor = 0
async function narrate (n, gapMs = 700) {
  for (let i = 0; i < n && cursor < match.length; i++, cursor++) {
    await commentary.onEventSettled(match[cursor])
    await sleep(gapMs)
  }
}

function pickEvent (e) {
  return { type: e.type, minute: e.minute, second: e.second, score: e.score, team: e.team, players: e.players, zone: e.zone, priority: e.priority }
}

function startProvider () {
  providerBootAt = Date.now()
  const p = new ProviderNode({ matchId, engine: new SimEngine({ tps: LAPTOP_TPS }), bootstrap: tn.bootstrap })
  return p.start().then(() => p)
}

// ── act 1: alone in the away end (LOCAL crawl) ──────────────────────────────
console.log('  act 1 — local crawl')
await narrate(2)

// ── act 2: the laptop joins → surge ─────────────────────────────────────────
console.log('  act 2 — provider joins, surge')
let provider = await startProvider()
if (router.state.state !== STATES.OFFLOADED) {
  await new Promise(res => router.once('provider', res))
}
await sleep(400)
await narrate(4)

// ── act 3: provider dies mid-sentence → token-exact resume ─────────────────
console.log('  act 3 — mid-stream failover')
const killMidStream = (async () => {
  let count = 0
  const onTok = async ({ source }) => {
    if (source === 'offloaded' && ++count === 5) {
      commentary.off('token', onTok)
      await provider.stop()
    }
  }
  commentary.on('token', onTok)
})()
await narrate(1)
await killMidStream
await narrate(2)

// ── act 4: the laptop comes back ────────────────────────────────────────────
console.log('  act 4 — provider returns')
provider = await startProvider()
if (router.state.state !== STATES.OFFLOADED) {
  await new Promise(res => router.once('provider', res))
}
await narrate(2)

await router.stop()
await provider.stop()
await tn.destroy()

const session = {
  recordedAt: new Date().toISOString(),
  recordedBy: 'scripts/record_session.js — a real run over a loopback DHT testnet',
  engine: 'sim',
  model: 'sim-tactical-grammar-v1',
  disclosed: `sim throttles: weak client ${WEAK_TPS} tok/s, provider ${LAPTOP_TPS} tok/s; transport + failover are real`,
  seed: SEED,
  fixture: { home: DEFAULT_FIXTURE.home.name, away: DEFAULT_FIXTURE.away.name },
  matchId,
  events
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(session))
const stats = router.stats.report()
console.log(`\n✓ ${path.relative(ROOT, OUT)} — ${events.length} events over ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log(`  local p50 ${stats.local.p50} tok/s · offloaded p50 ${stats.offloaded.p50} tok/s · connect p50 ${stats.connect.p50}ms`)
process.exit(0)

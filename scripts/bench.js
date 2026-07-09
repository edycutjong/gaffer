#!/usr/bin/env node
// bench — the headline artifact: local vs offloaded tokens/sec + peer-connect
// latency, p50/p95, reproducible on any machine with `npm run bench`.
//
// What is REAL in every run, regardless of engine:
//   • the P2P transport: real Hyperswarm sockets (Noise E2E), real framing,
//     real ordering checks — delegation efficiency is genuinely measured
//   • connect latency: swarm join → provider hello, measured wall-clock
// What depends on the engine:
//   • sim  — device profiles are simulated throttles (weak client vs laptop),
//     DISCLOSED in the output header; useful to verify the offload *delta*
//   • qvac — real model tok/s on your hardware (run `npm run setup:qvac`)
//
// Usage: node scripts/bench.js [--segments 12] [--engine auto|sim|qvac]
//        [--tps 6] [--provider-tps 48] [--seed 2026] [--json]

import process from 'node:process'
import createTestnet from 'hyperdht/testnet.js'
import { createEngine } from '../lib/engine.js'
import { ProviderNode } from '../lib/provider.js'
import { InferenceRouter, STATES } from '../lib/router.js'
import { MatchSimulator, DEFAULT_FIXTURE } from '../lib/match.js'
import { buildHistory } from '../lib/prompt.js'
import { deriveSeed } from '../lib/prng.js'
import { summarize } from '../lib/metrics.js'

const args = process.argv.slice(2)
const flag = (name, cast = Number, dflt) => {
  const i = args.indexOf(name)
  return i === -1 ? dflt : cast(args[i + 1])
}
const SEGMENTS = flag('--segments', Number, 12)
const ENGINE = flag('--engine', String, 'auto')
const TPS = flag('--tps', Number, 6)
const PROVIDER_TPS = flag('--provider-tps', Number, 48)
const SEED = flag('--seed', Number, 2026)
const JSON_OUT = args.includes('--json')

function log (...a) {
  if (!JSON_OUT) console.log(...a)
}

const events = new MatchSimulator({ seed: SEED }).all().filter(e => e.side).slice(0, SEGMENTS)
if (events.length < SEGMENTS) throw new Error(`not enough sided events for ${SEGMENTS} segments`)

async function measure (router, label) {
  const tpsSamples = []
  const latencies = []
  for (const [i, event] of events.entries()) {
    const history = buildHistory({ fixture: DEFAULT_FIXTURE, event })
    const seed = deriveSeed(SEED, event.n, 'bench')
    const t0 = Date.now()
    let firstToken = null
    const { stream, result } = router.complete({ history, seed })
    for await (const _ of stream) {  
      if (firstToken === null) firstToken = Date.now() - t0
    }
    const summary = await result
    tpsSamples.push(summary.tps)
    latencies.push(firstToken ?? 0)
    log(`  ${label} segment ${String(i + 1).padStart(2)}/${SEGMENTS}: ${String(summary.tokens).padStart(3)} tokens · ${summary.tps} tok/s · first token ${firstToken}ms`)
  }
  return { tps: summarize(tpsSamples), firstToken: summarize(latencies) }
}

async function main () {
  const started = new Date()

  // ── phase 1: LOCAL (weak client profile) ─────────────────────────────────
  const { engine: localEngine, fallback } = await createEngine({ engine: ENGINE, tps: TPS, log })
  log(`\nGAFFER BENCH — engine: ${localEngine.kind}${fallback ? ' (fallback from auto)' : ''}`)
  if (localEngine.kind === 'sim') {
    log(`  sim profiles: weak client ${TPS} tok/s · provider ${PROVIDER_TPS} tok/s (throttles, DISCLOSED)`)
    log('  → the offload delta + transport overhead + connect latency are the real measurements')
  }
  log(`\n[1/2] local generation on the weak client (${SEGMENTS} segments)`)
  const localRouter = new InferenceRouter({ matchId: 'bench-local', engine: localEngine, p2p: false })
  await localRouter.start()
  const local = await measure(localRouter, 'local    ')
  await localRouter.stop()

  // ── phase 2: OFFLOADED over a real (loopback) swarm ──────────────────────
  log(`\n[2/2] delegated to a provider peer over Hyperswarm (${SEGMENTS} segments)`)
  const tn = await createTestnet(3)
  const { engine: providerEngine } = await createEngine({ engine: ENGINE, tps: PROVIDER_TPS, log })
  const provider = new ProviderNode({ matchId: 'bench-p2p', engine: providerEngine, bootstrap: tn.bootstrap })
  await provider.start()

  const { engine: clientEngine } = await createEngine({ engine: 'sim', tps: TPS, log })
  const connectT0 = Date.now()
  const router = new InferenceRouter({ matchId: 'bench-p2p', engine: clientEngine, bootstrap: tn.bootstrap })
  await router.start()
  if (router.state.state !== STATES.OFFLOADED) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('provider discovery timeout')), 30_000)
      router.once('provider', () => { clearTimeout(t); resolve() })
    })
  }
  const connectMs = Date.now() - connectT0
  const offloaded = await measure(router, 'offloaded')
  await router.stop()
  await provider.stop()
  await tn.destroy()

  // ── report ────────────────────────────────────────────────────────────────
  const speedup = offloaded.tps.p50 && local.tps.p50 ? +(offloaded.tps.p50 / local.tps.p50).toFixed(2) : null
  const efficiency = localEngine.kind === 'sim' ? +((offloaded.tps.p50 / PROVIDER_TPS) * 100).toFixed(1) : null

  const report = {
    generatedAt: started.toISOString(),
    engine: localEngine.kind,
    disclosed: localEngine.kind === 'sim' ? `sim throttles: client ${TPS} tok/s, provider ${PROVIDER_TPS} tok/s` : null,
    segments: SEGMENTS,
    seed: SEED,
    localTps: local.tps,
    offloadedTps: offloaded.tps,
    firstTokenMsLocal: local.firstToken,
    firstTokenMsOffloaded: offloaded.firstToken,
    connectMs,
    speedupP50: speedup,
    transportEfficiencyPct: efficiency,
    connectReport: router.stats.report().connect
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  log('\n═══════════════════════ RESULTS ═══════════════════════')
  log(`engine: ${report.engine}${report.disclosed ? `  (${report.disclosed})` : ''}`)
  log('')
  log('                    p50        p95        mean       n')
  log(`  ⌂ local tok/s     ${cell(local.tps.p50)} ${cell(local.tps.p95)} ${cell(local.tps.mean)} ${local.tps.n}`)
  log(`  ⇄ offload tok/s   ${cell(offloaded.tps.p50)} ${cell(offloaded.tps.p95)} ${cell(offloaded.tps.mean)} ${offloaded.tps.n}`)
  log(`  first-token ms    ${cell(local.firstToken.p50)} (local) vs ${cell(offloaded.firstToken.p50)} (offloaded)`)
  log('')
  log(`  SPEEDUP (p50):            ×${speedup}`)
  if (efficiency != null) log(`  transport efficiency:     ${efficiency}% of provider rate survives the P2P hop`)
  log(`  peer connect → offloaded: ${connectMs} ms`)
  log('════════════════════════════════════════════════════════')
  log('\nreproduce: npm run bench  (same seed → same segments)')
}

function cell (v) {
  return String(v ?? '—').padEnd(10)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('bench failed:', err.message)
  process.exit(1)
})

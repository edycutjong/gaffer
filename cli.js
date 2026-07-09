#!/usr/bin/env node
// Gaffer headless CLI — the two-terminal demo and the judge's zero-setup path.
//
//   node cli.js --standalone                # one terminal, local engine
//   node cli.js --provider --match final-2026
//   node cli.js --client   --match final-2026
//
// Runs under plain Node; `pear run .` starts the desktop HUD instead.

import process from 'node:process'
import { parseArgs, USAGE } from './lib/config.js'
import { createEngine } from './lib/engine.js'
import { ProviderNode } from './lib/provider.js'
import { InferenceRouter, STATES } from './lib/router.js'
import { CommentaryEngine } from './lib/commentary.js'
import { MatchSimulator, DEFAULT_FIXTURE } from './lib/match.js'
import { TtsSpeaker } from './lib/tts.js'
import { topicHex } from './lib/topic.js'
import { TokenMeter } from './lib/metrics.js'

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', lime: '\x1b[92m', yellow: '\x1b[33m', red: '\x1b[31m'
}

const { config, errors } = parseArgs(process.argv.slice(2))

if (config.help || (!config.mode && process.argv.length <= 2)) {
  console.log(USAGE)
  process.exit(0)
}
if (errors.length > 0) {
  for (const e of errors) console.error(`${C.red}error:${C.reset} ${e}`)
  console.error(`\n${USAGE}`)
  process.exit(1)
}
if (!config.mode) {
  console.error(`${C.red}error:${C.reset} pick a mode: --standalone | --provider | --client\n`)
  console.error(USAGE)
  process.exit(1)
}

const log = (...args) => {
  if (!config.quiet) console.log(...args)
}

function banner (mode, engine, fallback) {
  const engineBadge = engine.kind === 'qvac'
    ? `${C.cyan}engine: qvac (on-device model: ${engine.modelId})${C.reset}`
    : `${C.yellow}engine: sim — disclosed deterministic dev engine (no model installed; run \`npm run setup:qvac\`)${C.reset}`
  log(`${C.bold}${C.cyan}GAFFER${C.reset} ${C.dim}— offline AI co-commentator (QVAC × Pear)${C.reset}`)
  log(`mode: ${C.bold}${mode}${C.reset} · match: ${C.bold}${config.matchId}${C.reset} · topic: ${C.dim}${topicHex(config.matchId).slice(0, 16)}…${C.reset}`)
  log(engineBadge)
  if (fallback) log(`${C.dim}(requested "${config.engine}" — fell back to sim; every surface labels this)${C.reset}`)
  log('')
}

async function runProvider () {
  const { engine, fallback } = await createEngine({
    engine: config.engine,
    tps: config.providerTps,
    modelSrc: config.modelSrc,
    log: (m) => log(`${C.dim}${m}${C.reset}`)
  })
  banner('provider', engine, fallback)
  const provider = new ProviderNode({
    matchId: config.matchId,
    engine,
    bootstrap: config.bootstrap ?? undefined,
    nativeProvider: engine.kind === 'qvac'
  })
  provider.on('client', (peer) => log(`${C.lime}⇄ client joined${C.reset} ${C.dim}${peer.shortKey} (${peer.hello?.engine ?? '?'} engine)${C.reset}`))
  provider.on('client-gone', (peer) => log(`${C.dim}⇠ client left ${peer.shortKey}${C.reset}`))
  provider.on('request', ({ peer, id }) => log(`${C.dim}→ completion ${id} from ${peer.shortKey}${C.reset}`))
  provider.on('served', ({ id, tokens }) => log(`${C.cyan}✓ served ${id}${C.reset} ${C.dim}(${tokens} tokens)${C.reset}`))
  provider.on('native-provider', (n) => log(n.available
    ? `${C.lime}startQVACProvider live on the match topic (SDK-native delegation)${C.reset}`
    : `${C.dim}SDK-native provider unavailable: ${n.reason} — Gaffer protocol serving instead${C.reset}`))

  await provider.start()
  log(`${C.bold}sharing this machine's compute${C.reset} — clients joining ${C.bold}${config.matchId}${C.reset} will offload here.`)
  log(`${C.dim}Ctrl-C to stop.${C.reset}\n`)

  const shutdown = async () => {
    log(`\n${C.dim}stopping provider…${C.reset}`)
    await provider.stop().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

async function runListener ({ p2p }) {
  const { engine, fallback } = await createEngine({
    engine: config.engine,
    tps: config.tps,
    modelSrc: config.modelSrc,
    log: (m) => log(`${C.dim}${m}${C.reset}`)
  })
  banner(p2p ? 'client (weak device)' : 'standalone', engine, fallback)

  const router = new InferenceRouter({
    matchId: config.matchId,
    engine,
    bootstrap: config.bootstrap ?? undefined,
    p2p
  })
  const meter = new TokenMeter({ windowMs: 3000 })
  const speaker = new TtsSpeaker({ engine, enabled: config.tts })
  const sim = new MatchSimulator({ seed: config.seed, minutes: config.minutes, speed: config.speed })
  const commentary = new CommentaryEngine({
    router,
    fixture: DEFAULT_FIXTURE,
    seed: config.seed,
    focus: config.focus,
    verbosity: config.verbosity,
    speaker: config.tts ? speaker : null
  })

  router.on('state', ({ prev, next }) => {
    if (next === STATES.OFFLOADED) log(`\n${C.lime}${C.bold}⇄ BOOSTED BY PEER${C.reset} ${C.dim}(${prev} → ${next}) — inference now runs on the provider${C.reset}`)
    else if (next === STATES.FALLBACK) log(`\n${C.magenta}${C.bold}⚠ provider lost — continuing on-device${C.reset} ${C.dim}(${prev} → ${next}, sentence resumes seamlessly)${C.reset}`)
  })
  router.on('provider', (peer) => log(`${C.lime}⇄ provider found${C.reset} ${C.dim}${peer.shortKey}${C.reset}`))
  router.on('failover', ({ received }) => log(`${C.dim}   mid-stream failover after ${received} delegated tokens${C.reset}`))

  let currentSource = null
  commentary.on('segment-start', ({ event }) => {
    const clock = `${String(event.minute).padStart(2, '0')}'`
    const icon = event.type === 'goal' ? '◉' : event.type === 'penalty_awarded' ? '⚠' : event.priority ? '▶' : '·'
    process.stdout.write(`${C.bold}${C.cyan}[${clock} ${icon}]${C.reset} `)
  })
  commentary.on('token', ({ token, source }) => {
    if (source !== currentSource) {
      currentSource = source
      process.stdout.write(source === 'offloaded' ? `${C.lime}` : `${C.reset}`)
    }
    meter.record()
    process.stdout.write(token)
  })
  commentary.on('segment-end', ({ source, tps, resumed }) => {
    currentSource = null
    const badge = source === 'offloaded' ? `${C.lime}⇄ peer${C.reset}` : `${C.cyan}⌂ local${C.reset}`
    process.stdout.write(`${C.reset} ${C.dim}[${badge}${C.dim} · ${tps} tok/s${resumed ? ' · resumed' : ''}]${C.reset}\n`)
  })
  commentary.on('speech', () => log(`${C.dim}   ♪ spoken via on-device Piper${C.reset}`))

  await router.start()
  if (p2p && router.state.state !== STATES.OFFLOADED) {
    // Give discovery a moment before kickoff so the surge can happen from the
    // first segment; the match starts regardless — a provider can join later.
    log(`${C.dim}searching for a provider on "${config.matchId}" (up to ${config.waitProvider}s — kickoff follows either way)…${C.reset}\n`)
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, config.waitProvider * 1000)
      router.once('provider', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  const shutdown = async () => {
    log(`\n${C.dim}stopping…${C.reset}`)
    printReport(router)
    await router.stop().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  let eventCount = 0
  for await (const event of sim) {
    await commentary.onEventSettled(event)
    eventCount++
    if (config.maxEvents > 0 && eventCount >= config.maxEvents) break
    if (event.type === 'full_time') break
  }
  printReport(router)
  await router.stop()
  process.exit(0)
}

function printReport (router) {
  const r = router.stats.report()
  log(`\n${C.bold}session report${C.reset}`)
  log(`  segments: ${r.segments}`)
  if (r.local.n > 0) log(`  ⌂ local     p50 ${r.local.p50} tok/s · p95 ${r.local.p95} · n=${r.local.n}`)
  if (r.offloaded.n > 0) log(`  ⇄ offloaded p50 ${C.lime}${r.offloaded.p50}${C.reset} tok/s · p95 ${r.offloaded.p95} · n=${r.offloaded.n}`)
  if (r.local.n > 0 && r.offloaded.n > 0) log(`  ${C.bold}speedup ×${(r.offloaded.p50 / r.local.p50).toFixed(1)}${C.reset}`)
  if (r.connect.n > 0) log(`  peer connect: ${r.connect.p50} ms`)
}

const main = config.mode === 'provider'
  ? runProvider()
  : runListener({ p2p: config.mode === 'client' })

main.catch((err) => {
  console.error(`${C.red}fatal:${C.reset} ${err.message}`)
  if (process.env.GAFFER_DEBUG) console.error(err)
  process.exit(1)
})

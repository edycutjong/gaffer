#!/usr/bin/env node
// verify_offline — hard proof of the "zero cloud" claim.
//
// Installs a process-wide network guard that BLOCKS any outbound connection
// beyond loopback/LAN (net, tls, http, https, fetch), then runs:
//   1. the full standalone commentary loop (join → narrate → report)
//   2. the full P2P offload loop over a loopback-only DHT testnet
//      (discovery, delegation, streaming, failover machinery — all live)
//
// If ANY code path tried to reach a cloud AI API, a model CDN, or any other
// remote host, the run fails loudly. Pass --strict to also block LAN ranges
// (pure airplane mode; the loopback testnet still works).
//
// Usage: node scripts/verify_offline.js [--strict] [--json]

import process from 'node:process'
import { installNetworkGuard } from '../lib/offline-guard.js'

const STRICT = process.argv.includes('--strict')
const JSON_OUT = process.argv.includes('--json')

const log = (...a) => {
  if (!JSON_OUT) console.log(...a)
}

const checks = []
function check (name, ok, detail = '') {
  checks.push({ name, ok, detail })
  log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}

async function main () {
  log('GAFFER OFFLINE VERIFICATION')
  log(`network guard: ${STRICT ? 'STRICT (loopback only)' : 'loopback + LAN allowed, internet blocked'}\n`)

  const guard = installNetworkGuard({ blockLan: STRICT, throwOnViolation: true })

  try {
    // Everything below runs UNDER the guard — imports too, so any module-level
    // network call would be caught.
    const [{ createEngine }, { InferenceRouter, STATES }, { ProviderNode }, { CommentaryEngine }, { MatchSimulator, DEFAULT_FIXTURE }, { default: createTestnet }] = await Promise.all([
      import('../lib/engine.js'),
      import('../lib/router.js'),
      import('../lib/provider.js'),
      import('../lib/commentary.js'),
      import('../lib/match.js'),
      import('hyperdht/testnet.js')
    ])

    // ── 1. standalone loop ────────────────────────────────────────────────
    log('[1/2] standalone commentary loop (no network at all)')
    const { engine } = await createEngine({ engine: 'sim', tps: Infinity })
    const router1 = new InferenceRouter({ matchId: 'verify-solo', engine, p2p: false })
    await router1.start()
    const commentary = new CommentaryEngine({ router: router1, fixture: DEFAULT_FIXTURE, seed: 99 })
    const sim = new MatchSimulator({ seed: 99, minutes: 8, speed: 0 })
    const report = await commentary.run(sim)
    await router1.stop()
    check('standalone loop narrates a full short match', report.segments >= 3, `${report.segments} segments`)
    check('zero blocked network attempts (standalone)', guard.report.blocked.length === 0)

    // ── 2. full P2P offload on loopback ───────────────────────────────────
    log('\n[2/2] P2P offload over loopback-only DHT (discovery + delegation)')
    const tn = await createTestnet(3)
    const { engine: pEngine } = await createEngine({ engine: 'sim', tps: 300 })
    const provider = new ProviderNode({ matchId: 'verify-p2p', engine: pEngine, bootstrap: tn.bootstrap })
    await provider.start()
    const { engine: cEngine } = await createEngine({ engine: 'sim', tps: 20 })
    const router2 = new InferenceRouter({ matchId: 'verify-p2p', engine: cEngine, bootstrap: tn.bootstrap })
    await router2.start()
    if (router2.state.state !== STATES.OFFLOADED) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('discovery timeout')), 30_000)
        router2.once('provider', () => { clearTimeout(t); resolve() })
      })
    }
    check('provider discovered over loopback DHT', router2.state.state === STATES.OFFLOADED)

    const commentary2 = new CommentaryEngine({ router: router2, fixture: DEFAULT_FIXTURE, seed: 7 })
    const sim2 = new MatchSimulator({ seed: 7, minutes: 5, speed: 0 })
    const report2 = await commentary2.run(sim2)
    const stats = router2.stats.report()
    check('segments generated via P2P delegation', stats.offloaded.n >= 1, `${stats.offloaded.n} offloaded segments`)
    check('commentary loop completed', report2.segments >= 2, `${report2.segments} segments`)
    await router2.stop()
    await provider.stop()
    await tn.destroy()
    check('zero blocked network attempts (P2P loop)', guard.report.blocked.length === 0)

    // ── verdict ───────────────────────────────────────────────────────────
    const allowedNote = `${guard.report.allowed.length} local socket ops allowed (loopback DHT + swarm)`
    check('no third-party inference API reachable by construction', guard.report.blocked.length === 0, allowedNote)
  } catch (err) {
    check('run completed without a network violation', false, err.message)
  } finally {
    guard.uninstall()
  }

  const passed = checks.every(c => c.ok)
  if (JSON_OUT) console.log(JSON.stringify({ passed, strict: STRICT, checks }, null, 2))
  else log(`\n${passed ? '✓ OFFLINE VERIFICATION PASSED — Gaffer never phones home.' : '✗ OFFLINE VERIFICATION FAILED'}`)
  process.exit(passed ? 0 : 1)
}

main()

// CLI/env configuration — tiny flag parser (no dependency) shared by cli.js
// and the scripts. Every knob has a safe default so `node cli.js --standalone`
// works with zero setup.

export const DEFAULTS = Object.freeze({
  mode: null, // 'provider' | 'client' | 'standalone'
  matchId: 'final-2026',
  engine: 'auto', // 'auto' | 'sim' | 'qvac'
  seed: 2047, // the 3-2 thriller: goals 8' 55' 68' 81' + 86' winner, one penalty
  focus: 'neutral',
  verbosity: 'normal',
  tps: 6, // sim throttle — models a weak device
  providerTps: 48, // sim throttle when acting as provider — models a laptop
  speed: 1200, // ms per match minute
  minutes: 90,
  maxEvents: 0, // 0 = no cap
  tts: false,
  quiet: false,
  bootstrap: null, // JSON array — tests/local testnet only
  waitProvider: 10, // client mode: seconds to search for a provider before kickoff
  modelSrc: process.env.GAFFER_MODEL_SRC || null
})

const FLAG_ALIASES = {
  '--provider': ['mode', 'provider'],
  '--client': ['mode', 'client'],
  '--standalone': ['mode', 'standalone'],
  '--tts': ['tts', true],
  '--quiet': ['quiet', true],
  '--no-p2p': ['mode', 'standalone']
}

const VALUE_FLAGS = {
  '--match': ['matchId', String],
  '--engine': ['engine', String],
  '--seed': ['seed', Number],
  '--focus': ['focus', String],
  '--verbosity': ['verbosity', String],
  '--tps': ['tps', Number],
  '--provider-tps': ['providerTps', Number],
  '--speed': ['speed', Number],
  '--minutes': ['minutes', Number],
  '--max-events': ['maxEvents', Number],
  '--bootstrap': ['bootstrap', (v) => JSON.parse(v)],
  '--wait-provider': ['waitProvider', Number],
  '--model-src': ['modelSrc', String]
}

export function parseArgs (argv = [], defaults = DEFAULTS) {
  const cfg = { ...defaults }
  const errors = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      cfg.help = true
      continue
    }
    if (FLAG_ALIASES[arg]) {
      const [key, value] = FLAG_ALIASES[arg]
      cfg[key] = value
      continue
    }
    if (VALUE_FLAGS[arg]) {
      const [key, cast] = VALUE_FLAGS[arg]
      const raw = argv[++i]
      if (raw === undefined) {
        errors.push(`${arg} expects a value`)
        continue
      }
      try {
        cfg[key] = cast(raw)
      } catch (err) {
        errors.push(`${arg}: ${err.message}`)
      }
      continue
    }
    errors.push(`unknown flag: ${arg}`)
  }

  if (cfg.engine && !['auto', 'sim', 'qvac'].includes(cfg.engine)) errors.push(`--engine must be auto|sim|qvac, got "${cfg.engine}"`)
  if (cfg.focus && !['attack', 'defense', 'neutral'].includes(cfg.focus)) errors.push(`--focus must be attack|defense|neutral, got "${cfg.focus}"`)
  if (cfg.verbosity && !['terse', 'normal', 'rich'].includes(cfg.verbosity)) errors.push(`--verbosity must be terse|normal|rich, got "${cfg.verbosity}"`)
  if (Number.isNaN(cfg.seed)) errors.push('--seed must be a number')
  if (Number.isNaN(cfg.tps) || cfg.tps <= 0) errors.push('--tps must be > 0')
  if (Number.isNaN(cfg.waitProvider) || cfg.waitProvider < 0) errors.push('--wait-provider must be ≥ 0 seconds')

  return { config: cfg, errors }
}

export const USAGE = `
Gaffer — offline AI football co-commentator (QVAC × Pear)

Usage:
  node cli.js --standalone                 one terminal, local engine only
  node cli.js --provider [--match <id>]    terminal A: share this machine's compute
  node cli.js --client   [--match <id>]    terminal B: weak client, offloads to A

Options:
  --match <id>         match room id (default: final-2026)
  --engine <e>         auto | sim | qvac  (default: auto — qvac when installed)
  --seed <n>           deterministic seed for match + sim commentary (default: 2026)
  --focus <f>          attack | defense | neutral
  --verbosity <v>      terse | normal | rich
  --tps <n>            sim tokens/sec as client — models a weak phone (default: 6)
  --provider-tps <n>   sim tokens/sec as provider — models a laptop (default: 48)
  --speed <ms>         ms per match minute (default: 1200; 0 = as fast as possible)
  --minutes <n>        match length in minutes (default: 90)
  --max-events <n>     stop after N events (0 = full match)
  --model-src <src>    QVAC model source: local path, http(s) URL, or pear:// link
  --wait-provider <s>  client: search seconds before kickoff (default: 10)
  --tts                speak segments via on-device Piper (qvac engine only)
  --quiet              suppress banner/status lines (commentary still streams)
  -h, --help           this help
`.trim()

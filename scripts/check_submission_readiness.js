#!/usr/bin/env node
// Submission readiness gate — fails if any placeholder survives, a mandatory
// deliverable is missing, or a claim in the README is not backed by execution
// (the stated test count is verified against a LIVE test run).
//
// Usage: node scripts/check_submission_readiness.js [--skip-tests]

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { countTests } from './count_tests.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_TESTS = process.argv.includes('--skip-tests')

const results = []
function gate (name, ok, detail = '', { warn = false } = {}) {
  results.push({ name, ok, detail, warn })
  const mark = ok ? '✓' : (warn ? '⚠' : '✗')
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`)
}

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8')
  } catch {
    return null
  }
}

console.log('GAFFER SUBMISSION READINESS\n')

// ── 1. mandatory deliverables exist ─────────────────────────────────────────
console.log('[1/4] mandatory deliverables')
const MUST_EXIST = [
  'README.md',
  'LICENSE',
  'cli.js',
  'app/index.html',
  'app/app.js',
  'landing/index.html',
  'scripts/bench.js',
  'scripts/verify_offline.js',
  'scripts/seed.js',
  'scripts/seed_model.js',
  'docs/DEMO.md',
  'docs/ARCHITECTURE.md',
  'docs/COMPLEXITY.md',
  'docs/AUDIT_REPORT.md',
  'docs/friction-log.md',
  'docs/PITCH_DECK.md',
  'docs/SEED_DATA.md',
  'docs/gaffer_dorahacks_submission.md',
  '.github/workflows/ci.yml',
  '.gitignore',
  'data/fixtures/final-2026.json'
]
for (const rel of MUST_EXIST) {
  gate(rel, fs.existsSync(path.join(ROOT, rel)))
}

// ── 2. no placeholders in judge-facing files ────────────────────────────────
// Real placeholders (TODO/FIXME/lorem/FILL/…) HARD-FAIL. A not-yet-uploaded
// demo-video link is a legitimate EXTERNAL pending — the video cannot exist
// until it is recorded + uploaded — so it WARNS (exit 0) instead of failing,
// matching the other three builds' gates. Everything else stays blocking.
console.log('\n[2/4] placeholder scan (judge-facing files)')
const PLACEHOLDER_PATTERNS = [
  /⬜\s*FILL/i, /TODO\b/, /FIXME\b/, /PLACEHOLDER/i, /lorem ipsum/i,
  /your-key-here/i, /OWNER\/REPO/, /\bXXX\b/, /coming soon/i
]
const EXTERNAL_PENDING_PATTERNS = [
  /(youtu\.?be\/|youtube\.com\/watch\?v=)PLACEHOLDER/i, /your-video/i
]
const SCAN_FILES = [
  'README.md', 'landing/index.html', 'docs/DEMO.md', 'docs/gaffer_dorahacks_submission.md',
  'docs/PITCH_DECK.md', 'docs/AUDIT_REPORT.md', 'docs/ARCHITECTURE.md', 'app/index.html'
]
for (const rel of SCAN_FILES) {
  const content = read(rel)
  if (content == null) {
    gate(`${rel} placeholder-free`, false, 'file missing')
    continue
  }
  const hits = []
  const pending = []
  for (const [lineNo, line] of content.split('\n').entries()) {
    const loc = `${lineNo + 1}: ${line.trim().slice(0, 60)}`
    // A pending demo-video link warns, not fails — check it first so the
    // generic /PLACEHOLDER/ pattern below doesn't also flag it as blocking.
    if (EXTERNAL_PENDING_PATTERNS.some(pat => pat.test(line))) { pending.push(loc); continue }
    if (PLACEHOLDER_PATTERNS.some(pat => pat.test(line))) hits.push(loc)
  }
  gate(`${rel} placeholder-free`, hits.length === 0, hits[0] || '')
  if (pending.length) {
    gate(`${rel} demo-video URL still a placeholder (record + upload, then replace)`, false, pending[0], { warn: true })
  }
}

// ── 3. licence + disclosure honesty ─────────────────────────────────────────
console.log('\n[3/4] licence & disclosure')
const license = read('LICENSE') || ''
gate('LICENSE is Apache 2.0 (hackathon rule)', /Apache License/.test(license) && /Version 2\.0/.test(license))
const pkg = JSON.parse(read('package.json') || '{}')
gate('package.json license field is Apache-2.0', pkg.license === 'Apache-2.0')
const readme = read('README.md') || ''
gate('README discloses prior work (qvac-examples pattern)', /qvac-examples|qvac-coffee-conversation/.test(readme))
gate('README discloses the sim engine honestly', /sim/i.test(readme) && /disclos/i.test(readme))
gate('README states an honest limitation', /[Ll]imitation/.test(readme))
gate('README has a Why-QVAC/Pear sponsor section', /Why (ONLY )?(QVAC|Pear)/i.test(readme))

// ── 4. claims backed by execution ───────────────────────────────────────────
console.log('\n[4/4] claims vs reality')
const claimMatch = readme.match(/\*\*(\d+)\s+tests?\*\*/) || readme.match(/(\d+)\s+tests pass/i) || readme.match(/(\d+) passing tests/i)
if (!claimMatch) {
  gate('README states an exact test count', false, 'no "N tests" claim found')
} else if (SKIP_TESTS) {
  gate(`README claims ${claimMatch[1]} tests (live verification skipped)`, true, '--skip-tests')
} else {
  const claimed = Number(claimMatch[1])
  process.stdout.write(`  … running the suite to verify the claimed ${claimed} tests\n`)
  try {
    const live = await countTests()
    gate(`README test count is TRUE (${claimed} claimed)`, live.tests === claimed && live.fail === 0,
      `live run: ${live.tests} tests, ${live.fail} failures`)
  } catch (err) {
    gate('live test verification', false, err.message)
  }
}

// ── verdict ─────────────────────────────────────────────────────────────────
// Blocking failures (fixable in-repo now) fail the gate. External pendings
// (demo video not yet uploaded, etc.) only warn — they cannot be satisfied in
// code and must be resolved before the Jul 14 submission.
const failed = results.filter(r => !r.ok && !r.warn)
const warned = results.filter(r => !r.ok && r.warn)
if (failed.length) {
  console.log(`\n✗ NOT READY — ${failed.length} blocking gate(s) failed:`)
  for (const f of failed) console.log(`   · ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
  process.exit(1)
}
if (warned.length) {
  console.log(`\n✓ READY pending ${warned.length} external step(s) — resolve before the Jul 14 deadline:`)
  for (const w of warned) console.log(`   · ${w.name}${w.detail ? ` (${w.detail})` : ''}`)
  process.exit(0)
}
console.log('\n✓ READY — every gate passed.')
process.exit(0)

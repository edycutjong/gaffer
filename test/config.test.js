import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, DEFAULTS, USAGE } from '../lib/config.js'

test('defaults: zero-arg parse is valid standalone-able config', () => {
  const { config, errors } = parseArgs([])
  assert.deepEqual(errors, [])
  assert.equal(config.matchId, 'final-2026')
  assert.equal(config.engine, 'auto')
  assert.equal(config.seed, 2047)
})

test('mode flags set the mode', () => {
  assert.equal(parseArgs(['--provider']).config.mode, 'provider')
  assert.equal(parseArgs(['--client']).config.mode, 'client')
  assert.equal(parseArgs(['--standalone']).config.mode, 'standalone')
  assert.equal(parseArgs(['--no-p2p']).config.mode, 'standalone')
})

test('value flags parse and cast', () => {
  const { config, errors } = parseArgs([
    '--match', 'semi-1', '--engine', 'sim', '--seed', '7', '--focus', 'attack',
    '--verbosity', 'rich', '--tps', '3', '--provider-tps', '99', '--speed', '0',
    '--minutes', '10', '--max-events', '5', '--model-src', '/tmp/m.gguf'
  ])
  assert.deepEqual(errors, [])
  assert.equal(config.matchId, 'semi-1')
  assert.equal(config.engine, 'sim')
  assert.equal(config.seed, 7)
  assert.equal(config.focus, 'attack')
  assert.equal(config.verbosity, 'rich')
  assert.equal(config.tps, 3)
  assert.equal(config.providerTps, 99)
  assert.equal(config.speed, 0)
  assert.equal(config.minutes, 10)
  assert.equal(config.maxEvents, 5)
  assert.equal(config.modelSrc, '/tmp/m.gguf')
})

test('bootstrap parses JSON arrays', () => {
  const { config } = parseArgs(['--bootstrap', '[{"host":"127.0.0.1","port":49737}]'])
  assert.deepEqual(config.bootstrap, [{ host: '127.0.0.1', port: 49737 }])
})

test('invalid enum values produce errors, not silent fallthrough', () => {
  assert.ok(parseArgs(['--engine', 'cloud']).errors.some(e => /--engine/.test(e)))
  assert.ok(parseArgs(['--focus', 'wings']).errors.some(e => /--focus/.test(e)))
  assert.ok(parseArgs(['--verbosity', 'shouty']).errors.some(e => /--verbosity/.test(e)))
})

test('numeric validation catches NaN and non-positive tps', () => {
  assert.ok(parseArgs(['--seed', 'abc']).errors.some(e => /--seed/.test(e)))
  assert.ok(parseArgs(['--tps', '0']).errors.some(e => /--tps/.test(e)))
})

test('unknown flags are reported by name', () => {
  const { errors } = parseArgs(['--cloud-api'])
  assert.deepEqual(errors, ['unknown flag: --cloud-api'])
})

test('missing value for a value-flag is an error', () => {
  const { errors } = parseArgs(['--match'])
  assert.ok(errors.some(e => /--match expects a value/.test(e)))
})

test('--tts and --quiet are boolean switches', () => {
  const { config } = parseArgs(['--tts', '--quiet'])
  assert.equal(config.tts, true)
  assert.equal(config.quiet, true)
})

test('--help sets help without erroring', () => {
  const { config, errors } = parseArgs(['-h'])
  assert.equal(config.help, true)
  assert.deepEqual(errors, [])
})

test('parseArgs never mutates DEFAULTS', () => {
  parseArgs(['--match', 'mutant'])
  assert.equal(DEFAULTS.matchId, 'final-2026')
})

test('usage text documents every public flag', () => {
  for (const flag of ['--match', '--engine', '--seed', '--focus', '--verbosity', '--tps', '--provider-tps', '--speed', '--minutes', '--max-events', '--model-src', '--tts', '--quiet']) {
    assert.ok(USAGE.includes(flag), `${flag} missing from USAGE`)
  }
})

test('AUDIT: --wait-provider parses and validates', () => {
  assert.equal(parseArgs(['--wait-provider', '3']).config.waitProvider, 3)
  assert.equal(parseArgs(['--wait-provider', '0']).config.waitProvider, 0)
  assert.ok(parseArgs(['--wait-provider', '-2']).errors.some(e => /--wait-provider/.test(e)))
  assert.ok(parseArgs(['--wait-provider', 'soon']).errors.some(e => /--wait-provider/.test(e)))
  assert.ok(USAGE.includes('--wait-provider'))
})

#!/usr/bin/env node
// Counts tests by actually running the suite and parsing the TAP summary.
// Used by check_submission_readiness.js to verify the README's stated test
// count is TRUE — claims must be produced by execution, not typed by hand.

import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function countTests ({ timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test'], { cwd: ROOT })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('test run timed out'))
    }, timeoutMs)
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', () => {})
    child.on('close', () => {
      clearTimeout(timer)
      const grab = (label) => {
        const m = out.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))
        return m ? Number(m[1]) : null
      }
      const result = { tests: grab('tests'), pass: grab('pass'), fail: grab('fail'), skipped: grab('skipped') }
      if (result.tests == null) reject(new Error('could not parse TAP summary'))
      else resolve(result)
    })
    child.on('error', reject)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  countTests().then((r) => {
    console.log(JSON.stringify(r))
    process.exit(r.fail === 0 ? 0 : 1)
  }).catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}

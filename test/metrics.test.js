import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentile, summarize, TokenMeter, SessionStats } from '../lib/metrics.js'

test('percentile of empty sample is null', () => {
  assert.equal(percentile([], 50), null)
})

test('percentile of a single sample is that sample at any p', () => {
  assert.equal(percentile([7], 0), 7)
  assert.equal(percentile([7], 50), 7)
  assert.equal(percentile([7], 100), 7)
})

test('percentile interpolates linearly', () => {
  assert.equal(percentile([0, 10], 50), 5)
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5)
  assert.equal(percentile([1, 2, 3, 4, 5], 50), 3)
})

test('p0 = min, p100 = max regardless of input order', () => {
  const samples = [9, 1, 5, 3, 7]
  assert.equal(percentile(samples, 0), 1)
  assert.equal(percentile(samples, 100), 9)
})

test('percentile rejects p outside [0,100]', () => {
  assert.throws(() => percentile([1], -1), RangeError)
  assert.throws(() => percentile([1], 101), RangeError)
})

test('p95 sits between p50 and max', () => {
  const samples = Array.from({ length: 100 }, (_, i) => i + 1)
  const p50 = percentile(samples, 50)
  const p95 = percentile(samples, 95)
  assert.ok(p50 < p95 && p95 <= 100)
})

test('summarize reports p50/p95/mean/min/max/n', () => {
  const s = summarize([2, 4, 6, 8])
  assert.equal(s.n, 4)
  assert.equal(s.min, 2)
  assert.equal(s.max, 8)
  assert.equal(s.mean, 5)
  assert.equal(s.p50, 5)
})

test('summarize of empty is all-null with n=0', () => {
  assert.deepEqual(summarize([]), { p50: null, p95: null, mean: null, min: null, max: null, n: 0 })
})

test('TokenMeter measures rate within its window (fake clock)', () => {
  let now = 1000
  const meter = new TokenMeter({ windowMs: 1000, now: () => now })
  for (let i = 0; i < 10; i++) {
    meter.record()
    now += 100
  }
  // 10 tokens over ~1000ms → ~10 tok/s
  const rate = meter.rate()
  assert.ok(rate > 8 && rate < 13, `rate=${rate}`)
  assert.equal(meter.total, 10)
})

test('TokenMeter forgets tokens older than the window', () => {
  let now = 0
  const meter = new TokenMeter({ windowMs: 500, now: () => now })
  meter.record(5)
  now += 10_000
  assert.equal(meter.rate(), 0)
  assert.equal(meter.total, 5) // total is cumulative
})

test('TokenMeter.reset clears both window and total', () => {
  const meter = new TokenMeter({})
  meter.record(3)
  meter.reset()
  assert.equal(meter.total, 0)
  assert.equal(meter.rate(), 0)
})

test('SessionStats buckets segments by source and summarises tps', () => {
  const stats = new SessionStats()
  stats.addSegment({ source: 'local', tokens: 10, ms: 1000, tps: 10 })
  stats.addSegment({ source: 'local', tokens: 12, ms: 1000, tps: 12 })
  stats.addSegment({ source: 'offloaded', tokens: 50, ms: 1000, tps: 50 })
  stats.addConnectLatency(1800)
  const report = stats.report()
  assert.equal(report.segments, 3)
  assert.equal(report.local.n, 2)
  assert.equal(report.local.p50, 11)
  assert.equal(report.offloaded.n, 1)
  assert.equal(report.offloaded.p50, 50)
  assert.equal(report.connect.n, 1)
  assert.equal(report.connect.p50, 1800)
})

test('SessionStats mixed segments pollute neither bucket', () => {
  const stats = new SessionStats()
  stats.addSegment({ source: 'mixed', tokens: 20, ms: 1000, tps: 20 })
  const report = stats.report()
  assert.equal(report.local.n, 0)
  assert.equal(report.offloaded.n, 0)
  assert.equal(report.segments, 1)
})

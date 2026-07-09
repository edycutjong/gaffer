// Metrics — tokens/sec measurement and latency statistics. These numbers are
// the demo (the HUD gauge, the bench table, the README claims), so they are
// pure functions with unit tests rather than ad-hoc math at call sites.

/** percentile over a sample array (linear interpolation, p in [0,100]) */
export function percentile (samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) return null
  if (p < 0 || p > 100) throw new RangeError('percentile: p must be within [0,100]')
  const sorted = [...samples].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/** { p50, p95, mean, min, max, n } — the bench table row */
export function summarize (samples) {
  if (!Array.isArray(samples) || samples.length === 0) return { p50: null, p95: null, mean: null, min: null, max: null, n: 0 }
  const sum = samples.reduce((s, x) => s + x, 0)
  return {
    p50: round2(percentile(samples, 50)),
    p95: round2(percentile(samples, 95)),
    mean: round2(sum / samples.length),
    min: round2(Math.min(...samples)),
    max: round2(Math.max(...samples)),
    n: samples.length
  }
}

/**
 * Sliding-window tokens/sec meter for the live HUD gauge.
 * record() each token; rate() gives tok/s over the last `windowMs`.
 */
export class TokenMeter {
  constructor ({ windowMs = 3000, now = Date.now } = {}) {
    this.windowMs = windowMs
    this._now = now
    this._stamps = []
    this.total = 0
  }

  record (n = 1) {
    const t = this._now()
    for (let i = 0; i < n; i++) this._stamps.push(t)
    this.total += n
  }

  rate () {
    const cutoff = this._now() - this.windowMs
    while (this._stamps.length > 0 && this._stamps[0] < cutoff) this._stamps.shift()
    if (this._stamps.length === 0) return 0
    const span = Math.max(this._now() - this._stamps[0], 1)
    return round2((this._stamps.length / span) * 1000)
  }

  reset () {
    this._stamps = []
    this.total = 0
  }
}

/** Aggregates per-segment usage into the session stats the HUD shows. */
export class SessionStats {
  constructor () {
    this.segments = []
    this.connectLatencies = []
  }

  addSegment ({ source, tokens, ms, tps }) {
    this.segments.push({ source, tokens, ms, tps })
  }

  addConnectLatency (ms) {
    this.connectLatencies.push(ms)
  }

  bySource (source) {
    return summarize(this.segments.filter(s => s.source === source).map(s => s.tps))
  }

  report () {
    return {
      segments: this.segments.length,
      local: this.bySource('local'),
      offloaded: this.bySource('offloaded'),
      connect: summarize(this.connectLatencies)
    }
  }
}

export function round2 (x) {
  return x == null ? null : Math.round(x * 100) / 100
}

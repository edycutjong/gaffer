// Deterministic PRNG utilities. Everything demo-visible in Gaffer that is not
// produced by a real model must be reproducible from a seed — same seed, same
// match, same sim commentary, byte for byte. That property is load-bearing:
// the mid-stream failover resume (router.js) relies on it.

/** FNV-1a 32-bit hash of a string — cheap, stable seed derivation. */
export function hash32 (str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Combine any values into a single 32-bit seed. */
export function deriveSeed (...parts) {
  return hash32(parts.map(p => String(p)).join('␟'))
}

/** mulberry32 — tiny, fast, good-enough deterministic PRNG. */
export function mulberry32 (seed) {
  let a = seed >>> 0
  return function next () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stateful convenience wrapper around mulberry32. */
export class Rng {
  constructor (seed) {
    this.seed = seed >>> 0
    this._next = mulberry32(this.seed)
  }

  /** float in [0, 1) */
  float () {
    return this._next()
  }

  /** integer in [min, max] inclusive */
  int (min, max) {
    return min + Math.floor(this.float() * (max - min + 1))
  }

  /** pick one element */
  pick (arr) {
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('Rng.pick: empty array')
    return arr[this.int(0, arr.length - 1)]
  }

  /** true with probability p */
  chance (p) {
    return this.float() < p
  }

  /** weighted pick from [{ value, weight }] */
  weighted (entries) {
    const total = entries.reduce((s, e) => s + e.weight, 0)
    let roll = this.float() * total
    for (const e of entries) {
      roll -= e.weight
      if (roll <= 0) return e.value
    }
    return entries[entries.length - 1].value
  }
}

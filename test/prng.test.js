import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hash32, deriveSeed, mulberry32, Rng } from '../lib/prng.js'

test('hash32 is stable for the same input', () => {
  assert.equal(hash32('gaffer'), hash32('gaffer'))
})

test('hash32 differs for different inputs', () => {
  assert.notEqual(hash32('gaffer'), hash32('gaffar'))
})

test('hash32 returns an unsigned 32-bit integer', () => {
  for (const s of ['', 'a', 'final-2026', '⚽️']) {
    const h = hash32(s)
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `bad hash for ${s}: ${h}`)
  }
})

test('deriveSeed combines parts orderly — order matters', () => {
  assert.equal(deriveSeed('a', 'b'), deriveSeed('a', 'b'))
  assert.notEqual(deriveSeed('a', 'b'), deriveSeed('b', 'a'))
})

test('deriveSeed separator prevents concat collisions', () => {
  assert.notEqual(deriveSeed('ab', 'c'), deriveSeed('a', 'bc'))
})

test('mulberry32 same seed yields the same sequence', () => {
  const a = mulberry32(123)
  const b = mulberry32(123)
  for (let i = 0; i < 100; i++) assert.equal(a(), b())
})

test('mulberry32 values stay in [0,1)', () => {
  const next = mulberry32(99)
  for (let i = 0; i < 1000; i++) {
    const v = next()
    assert.ok(v >= 0 && v < 1)
  }
})

test('Rng.int respects inclusive bounds', () => {
  const rng = new Rng(5)
  for (let i = 0; i < 500; i++) {
    const v = rng.int(2, 4)
    assert.ok(v >= 2 && v <= 4)
  }
})

test('Rng.pick returns members and throws on empty', () => {
  const rng = new Rng(5)
  const arr = ['x', 'y', 'z']
  for (let i = 0; i < 50; i++) assert.ok(arr.includes(rng.pick(arr)))
  assert.throws(() => rng.pick([]), /empty array/)
})

test('Rng.weighted honours weights (zero-weight entries never win)', () => {
  const rng = new Rng(1)
  for (let i = 0; i < 200; i++) {
    const v = rng.weighted([{ value: 'never', weight: 0 }, { value: 'always', weight: 10 }])
    assert.equal(v, 'always')
  }
})

test('Rng.chance(0) is never true and chance(1) always true', () => {
  const rng = new Rng(8)
  for (let i = 0; i < 100; i++) {
    assert.equal(rng.chance(0), false)
    assert.equal(rng.chance(1), true)
  }
})

test('two Rng instances with the same seed are identical', () => {
  const a = new Rng(777)
  const b = new Rng(777)
  for (let i = 0; i < 50; i++) assert.equal(a.int(0, 1000), b.int(0, 1000))
})

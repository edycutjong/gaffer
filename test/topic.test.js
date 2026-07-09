import { test } from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'
import { matchTopic, topicHex, TOPIC_NAMESPACE } from '../lib/topic.js'

test('matchTopic returns 32 bytes', () => {
  assert.equal(matchTopic('final-2026').byteLength, 32)
})

test('same match id derives the same topic (both sides independently)', () => {
  assert.ok(b4a.equals(matchTopic('final-2026'), matchTopic('final-2026')))
})

test('different match ids derive different topics', () => {
  assert.ok(!b4a.equals(matchTopic('final-2026'), matchTopic('semi-2026')))
})

test('topic derivation normalises case and whitespace', () => {
  assert.ok(b4a.equals(matchTopic('Final-2026'), matchTopic('  final-2026  ')))
})

test('empty or non-string match ids are rejected', () => {
  assert.throws(() => matchTopic(''), /non-empty/)
  assert.throws(() => matchTopic('   '), /non-empty/)
  assert.throws(() => matchTopic(42), /non-empty/)
  assert.throws(() => matchTopic(null), /non-empty/)
})

test('topicHex is the hex of matchTopic', () => {
  assert.equal(topicHex('x'), b4a.toString(matchTopic('x'), 'hex'))
  assert.match(topicHex('x'), /^[0-9a-f]{64}$/)
})

test('namespace is versioned (topic changes if namespace changes)', () => {
  assert.match(TOPIC_NAMESPACE, /\/v\d+$/)
})

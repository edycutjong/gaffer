// Match id → 32-byte Hyperswarm topic. Provider and clients derive the same
// topic independently, so "join match room" needs nothing but the match id —
// no server, no registry.

import crypto from 'hypercore-crypto'
import b4a from 'b4a'

export const TOPIC_NAMESPACE = 'gaffer/match/v1'

/**
 * Derive the swarm topic for a match id.
 * @param {string} matchId — human string, e.g. "final-2026"
 * @returns {Buffer} 32-byte topic
 */
export function matchTopic (matchId) {
  if (typeof matchId !== 'string' || matchId.trim() === '') {
    throw new TypeError('matchTopic: matchId must be a non-empty string')
  }
  return crypto.hash(b4a.from(`${TOPIC_NAMESPACE}:${matchId.trim().toLowerCase()}`))
}

/** Hex string form (for logging / HUD display). */
export function topicHex (matchId) {
  return b4a.toString(matchTopic(matchId), 'hex')
}

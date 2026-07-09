// gaffer — public module surface. The P2P inference-offload helpers are
// importable as a library so other Pear/QVAC apps can reuse the pattern:
//
//   import { ProviderNode, InferenceRouter, createEngine } from 'gaffer'

export { createEngine, SimEngine, QvacEngine, EngineUnavailableError } from './lib/engine.js'
export { ProviderNode } from './lib/provider.js'
export { InferenceRouter, AsyncQueue } from './lib/router.js'
export { GafferSwarm, Peer } from './lib/swarm.js'
export { CommentaryEngine } from './lib/commentary.js'
export { MatchSimulator, DEFAULT_FIXTURE, EVENT_TYPES, PRIORITY_EVENTS } from './lib/match.js'
export { buildHistory, systemPrompt, eventMessage, FOCUS, VERBOSITY } from './lib/prompt.js'
export { matchTopic, topicHex, TOPIC_NAMESPACE } from './lib/topic.js'
export * as protocol from './lib/protocol.js'
export { TokenMeter, SessionStats, percentile, summarize } from './lib/metrics.js'
export { STATES, EVENTS, transition, isLocalState, RouterState } from './lib/state.js'
export { installNetworkGuard, isLoopbackHost, NetworkViolationError } from './lib/offline-guard.js'
export { seedFile, fetchFile, driveUrl, parseDriveUrl } from './lib/modelshare.js'
export { TtsSpeaker } from './lib/tts.js'
export { parseArgs, DEFAULTS, USAGE } from './lib/config.js'
export { Rng, mulberry32, deriveSeed, hash32 } from './lib/prng.js'

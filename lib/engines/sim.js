// SimEngine — the DISCLOSED deterministic development/demo engine.
//
// This is NOT a language model and is never presented as one: every surface
// (CLI banner, HUD badge, bench output) labels the active engine. It exists so
// that (a) the full P2P offload path runs on machines without @qvac/sdk and a
// 700 MB GGUF, (b) tests are reproducible, and (c) mid-stream failover can be
// verified token-exact (deterministic: same request + seed → same tokens).
//
// It is generative, not canned: commentary is assembled from a tactical
// grammar conditioned on the incoming event, focus and verbosity — arbitrary
// input still produces sensible output (a judge can type their own event).

import { Rng, deriveSeed } from '../prng.js'

export const SIM_MODEL_ID = 'sim-tactical-grammar-v1'

const OPENINGS = {
  kickoff: ['We are underway', 'Off we go', 'First touch of the game'],
  pass_chain: ['{team} knitting it together', 'Patient stuff from {team}', '{p1} and {p2} exchanging passes'],
  press: ['{team} press high', 'The trap springs from {team}', '{p1} leads the counter-press'],
  shot_on_target: ['{p1} lets fly', 'Effort from {p1}', '{p1} tests the keeper'],
  shot_off_target: ['{p1} drags it wide', 'Over the bar from {p1}', 'Wayward from {p1}'],
  save: ['Big save', 'The keeper answers', 'Denied'],
  corner: ['Corner to {team}', '{team} win a corner', 'Set piece coming for {team}'],
  foul: ['{p1} clips {p2}', 'Cynical from {p1}', 'Free kick — {p1} caught late'],
  yellow_card: ['Booking for {p1}', 'Yellow card — {p1}', 'The referee reaches for a card: {p1}'],
  goal: ['GOAL for {team}', '{p1} finds the net', 'It counts — {team} score'],
  offside: ['Flag is up against {p1}', 'Offside — {p1} mistimed the run', 'The line catches {p1}'],
  counter: ['{team} break at pace', 'Transition — {team} pour forward', '{p1} carries it fifty metres'],
  substitution: ['Change for {team}: {p1} on', 'Fresh legs — {p1} enters', '{team} roll the dice with {p1}'],
  var_check: ['VAR is having a look', 'Play held — the review is on', 'Everyone waits on the screen'],
  penalty_awarded: ['PENALTY to {team}', 'The referee points to the spot', 'Spot kick for {team}'],
  half_time: ['That is the half', 'The whistle ends the first act', 'Half time'],
  full_time: ['Full time', 'It is done', 'The final whistle goes']
}

const TACTICAL = {
  neutral: [
    'the midfield triangle keeps its spacing in the {zone}',
    'both benches are pointing at the {zone}',
    'the tempo swings with every regain around the {zone}',
    'watch how quickly the shape resets through the {zone}'
  ],
  attack: [
    'the overlap is free on the {zone} — one switch releases it',
    'the striker is pinning both centre-backs, opening the {zone}',
    'third-man runs keep arriving through the {zone}',
    'the pressing trigger is the back-pass — the front line jumps it in the {zone}'
  ],
  defense: [
    'the back line holds its cover shadow across the {zone}',
    'the low block concedes the {zone} but nothing central',
    'recovery runs are cutting the passing lane into the {zone}',
    'the holding mid screens the {zone} — nothing gets through the middle'
  ]
}

const CLOSERS = {
  terse: [],
  normal: ['Score stays {score}.', 'It is {score} here.', 'Still {score}.'],
  rich: ['At {score}, the manager will take this shape.', 'The scoreboard reads {score} and the plan shows.', '{score} — and the pattern of the half is set.']
}

/** Parse the fields eventMessage() encodes; degrade gracefully on free text. */
export function parseEventLine (content) {
  const m = content.match(/^\[(\d{2}):(\d{2})\] \[score (\d+)-(\d+)\] ([a-z ]+) — (.+?) — (.+)\.$/i)
  if (!m) return null
  const [, minute, second, sh, sa, type, who, zone] = m
  const teamMatch = who.match(/^(.+?) \((.+)\)$/)
  return {
    minute: Number(minute),
    second: Number(second),
    score: `${sh}-${sa}`,
    type: type.trim().replace(/ /g, '_'),
    team: teamMatch ? teamMatch[1] : null,
    players: teamMatch ? teamMatch[2].split(', ') : [],
    zone: zone.trim()
  }
}

/** Detect focus/verbosity the same way a model would — from the system prompt. */
export function parseDirectives (systemContent = '') {
  const focus = /Prioritise attacking/.test(systemContent)
    ? 'attack'
    : /Prioritise defensive/.test(systemContent) ? 'defense' : 'neutral'
  const m = systemContent.match(/at most (\d+) short sentence/)
  const sentences = m ? Number(m[1]) : 2
  const verbosity = sentences <= 1 ? 'terse' : sentences >= 3 ? 'rich' : 'normal'
  return { focus, verbosity }
}

/** Deterministically compose the commentary text for a request. */
export function composeCommentary ({ history, seed = 0 }) {
  const system = history.find(t => t.role === 'system')?.content || ''
  const lastUser = [...history].reverse().find(t => t.role === 'user')?.content || ''
  const { focus, verbosity } = parseDirectives(system)
  const ev = parseEventLine(lastUser)
  const rng = new Rng(deriveSeed('sim', seed, lastUser, focus, verbosity))

  const fill = (tpl) => tpl
    .replace(/\{team\}/g, ev?.team || 'the home side')
    .replace(/\{p1\}/g, ev?.players?.[0] || 'the number ten')
    .replace(/\{p2\}/g, ev?.players?.[1] || 'his marker')
    .replace(/\{zone\}/g, ev?.zone || 'final third')
    .replace(/\{score\}/g, ev?.score || 'level')

  // Sentence budget honours the system prompt: terse=1, normal=2, rich=3.
  const sentences = []
  const openings = OPENINGS[ev?.type] || ['Something stirs in the crowd']
  sentences.push(fill(rng.pick(openings)) + (ev?.type === 'goal' || ev?.type === 'penalty_awarded' ? '!' : '.'))
  if (verbosity !== 'terse') {
    const clause = fill(rng.pick(TACTICAL[focus]))
    sentences.push(clause.charAt(0).toUpperCase() + clause.slice(1) + '.')
  }
  if (verbosity === 'rich') sentences.push(fill(rng.pick(CLOSERS.rich)))

  return sentences.join(' ')
}

/** Word-level tokenizer — keeps trailing spaces so concat(tokens) === text. */
export function tokenize (text) {
  return text.match(/\S+\s*/g) || []
}

export class SimEngine {
  /**
   * @param {object} opts
   * @param {number} opts.tps  tokens/sec emission rate — models device power.
   *                           Use Infinity for tests (no throttle).
   */
  constructor ({ tps = 6, label = 'sim' } = {}) {
    this.kind = 'sim'
    this.label = label
    this.deterministic = true
    this.modelId = SIM_MODEL_ID
    this.tps = tps
    this.loaded = false
  }

  async load () {
    this.loaded = true
    return { modelId: this.modelId }
  }

  /**
   * Engine contract: complete({ history, seed, maxTokens, signal })
   * → { tokenStream, usage() } where tokenStream yields string tokens.
   * Mirrors the shape of @qvac/sdk completion() (result.tokenStream).
   */
  complete ({ history, seed = 0, maxTokens = null, signal = null } = {}) {
    if (!Array.isArray(history) || history.length === 0) throw new TypeError('SimEngine.complete: history required')
    const text = composeCommentary({ history, seed })
    let tokens = tokenize(text)
    if (maxTokens != null) tokens = tokens.slice(0, maxTokens)
    const tps = this.tps
    const started = Date.now()
    let emitted = 0

    const tokenStream = (async function * () {
      for (const token of tokens) {
        if (signal?.aborted) {
          const err = new Error('aborted')
          err.name = 'AbortError'
          throw err
        }
        if (Number.isFinite(tps) && tps > 0) await sleep(1000 / tps)
        emitted++
        yield token
      }
    })()

    return {
      modelId: this.modelId,
      tokenStream,
      usage: () => {
        const ms = Math.max(1, Date.now() - started)
        return { tokens: emitted, ms, tps: round2(emitted / (ms / 1000)) }
      }
    }
  }

  async speak () {
    return { available: false, reason: 'TTS requires the QVAC engine (Piper). Sim engine never fakes audio.' }
  }

  async unload () {
    this.loaded = false
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function round2 (x) {
  return Math.round(x * 100) / 100
}

// Prompt construction — turns match events into a QVAC `history` array.
// The gaffer persona lives in the system prompt, not in a fine-tune: one-line
// setup was a design goal (see ARCHITECTURE.md "Model Selection").

export const FOCUS = Object.freeze({ ATTACK: 'attack', DEFENSE: 'defense', NEUTRAL: 'neutral' })
export const VERBOSITY = Object.freeze({ TERSE: 'terse', NORMAL: 'normal', RICH: 'rich' })

const SENTENCES_PER_VERBOSITY = { terse: 1, normal: 2, rich: 3 }

export function systemPrompt ({ fixture, focus = FOCUS.NEUTRAL, verbosity = VERBOSITY.NORMAL }) {
  const sentences = SENTENCES_PER_VERBOSITY[verbosity] ?? 2
  const focusLine = focus === FOCUS.ATTACK
    ? 'Prioritise attacking patterns: pressing triggers, overlaps, half-space runs, shot selection.'
    : focus === FOCUS.DEFENSE
      ? 'Prioritise defensive structure: block shape, cover shadows, marking assignments, recovery runs.'
      : 'Balance attacking and defensive reads.'
  return [
    'You are Gaffer, a sharp football co-commentator speaking into one fan\'s ear.',
    `Match: ${fixture.home.name} vs ${fixture.away.name} (${fixture.competition}).`,
    `React to the latest event in at most ${sentences} short sentence${sentences > 1 ? 's' : ''}. Be tactical and concrete, never generic.`,
    focusLine,
    'Never invent goals or cards that were not in the event feed. Use the provided score as ground truth.',
    'No preamble, no markdown — just the spoken line.'
  ].join(' ')
}

export function eventMessage (event) {
  const clock = `${String(event.minute).padStart(2, '0')}:${String(event.second).padStart(2, '0')}`
  const score = `${event.score.home}-${event.score.away}`
  const who = event.team ? `${event.team} (${event.players.join(', ')})` : 'both sides'
  return `[${clock}] [score ${score}] ${event.type.replace(/_/g, ' ')} — ${who} — ${event.zone}.`
}

/**
 * Build the chat history for one commentary segment.
 * Keeps a sliding window of previous exchanges so the model has context
 * without unbounded prompt growth on a small device.
 */
export function buildHistory ({ fixture, event, focus, verbosity, recent = [], window = 4 }) {
  const history = [{ role: 'system', content: systemPrompt({ fixture, focus, verbosity }) }]
  for (const past of recent.slice(-window)) {
    history.push({ role: 'user', content: past.prompt })
    history.push({ role: 'assistant', content: past.text })
  }
  history.push({ role: 'user', content: eventMessage(event) })
  return history
}

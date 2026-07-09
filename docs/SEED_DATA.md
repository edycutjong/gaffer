# Seed data design — the demo IS the data

## The devastating demo sequence

The judge-facing run is engineered around one sequence (all deterministic, seed **2047**,
fixture `final-2026`):

1. **Slow burn** — kickoff + a pass chain crawl in at ~6 tok/s (weak-device profile). The
   judge *feels* the weakness.
2. **The surge** — the provider joins; the gauge jumps ~6 → ~47 tok/s mid-match. This is the
   "oh" beat, and it lands on real P2P delegation, not an animation.
3. **The betrayal** — the provider is killed **mid-sentence** during a rich (3-sentence)
   segment; the sentence finishes seamlessly on-device. Deterministic engines make the resume
   token-exact — provable, not vibes.
4. **The storyline** — seed 2047 was selected by scanning 100 seeds for drama: a **3-2
   thriller** with goals at 8' 55' 68' 81', an **86th-minute winner**, and a penalty
   (converted). Goal events are priority — they always get narrated, even mid-surge.

## Why the data is engineered this way

- **Determinism is the product guarantee** — same seed ⇒ same match ⇒ same commentary (sim),
  which is what makes the failover resume verifiable and the bench reproducible across
  machines. `scripts/seed.js` regenerates byte-identical fixtures.
- **Vocabulary design** — event types map to distinct tactical registers (press/counter/
  half-space/low-block…), and the **focus control flips the register** (attack vs defense
  clause banks) so judges can type-and-see: same event, different tactical read.
- **Quiet minutes are real** — 0–2 events/minute with genuine gaps, so the pacing layer
  (drop non-priority while speaking, queue goals) is observable instead of theoretical.
- **Names:** nations are real (Argentina/France — facts), players are **fictional**
  (Varela, Dumont, …) to keep likeness rights clean. Stated here to preempt the question.

## Fixtures shipped (`data/fixtures/`)

| File | Seed | What it's for |
|---|---|---|
| `final-2026.json` | 2047 | the demo: 83 events, 3-2, late winner, penalty |
| `semi-2026.json` | 1998 | second room for multi-match/multi-room tests |
| `short-demo.json` | 7 | 12-minute feed for quick captures |

Regenerate any time: `npm run seed` (deterministic, safe to diff).

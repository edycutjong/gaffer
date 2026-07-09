# AGENTS.md — Gaffer build conventions

**What this is:** the implementation of Gaffer (offline AI football co-commentator, QVAC track,
Tether Developers Cup 2026). Specs live one directory up; this folder is the shippable repo.

## Stack
- Node ≥ 20, pure ESM, no bundler. P2P: hyperswarm / hyperdht / hyperdrive / corestore.
- AI: `@qvac/sdk` as an **optional** engine (`npm run setup:qvac`); disclosed sim engine otherwise.
- Tests: `node --test` (unit in `test/`, real-swarm integration in `test/integration/`).
- App: Pear desktop HUD in `app/` (live under Pear; replay mode in browsers).

## Brand (from spec `_tokens.css`)
- bg `#0A0A0F` · surface `#111119` · cyan `#00E5FF` (live/AI) · magenta `#FF3D71` (alerts) ·
  lime `#B6FF3D` (the boost) · display "Chakra Petch" stack · mono "JetBrains Mono" stack.
- Aesthetic: broadcast tactical HUD / cyberpunk P2P console; kinetic, but honest — the gauge
  only moves on real measured tokens.

## Non-negotiables
1. **Zero cloud AI** — QVAC track rule. `npm run verify:offline` must stay green.
2. **Apache-2.0** — hackathon rule; don't switch to MIT.
3. **Engine honesty** — sim output is never presented as a model; every surface labels the engine.
4. **Claims by execution** — README numbers (tests, bench) must come from real runs;
   `npm run check:ready` re-verifies the test count live.
5. **One flow** — no RAG, no crowd timelines, no translation, no cloud fallback.

## Commands
`npm test` · `npm run lint` · `npm run bench` · `npm run verify:offline` · `npm run check:ready`
· `node cli.js --standalone|--provider|--client` · `pear run .` · `npm run demo:web`

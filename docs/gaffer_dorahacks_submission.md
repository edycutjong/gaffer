# Gaffer — DoraHacks BUIDL submission (copy-paste map)

> Field-by-field for the Tether Developers Cup form. Items marked **[user]** need the
> account owner (repo URL, video URL, team/nation) — everything else is final copy.
> Rule notes: single track on the form; Apache-2.0 repo; ≤3-min unlisted YouTube video;
> judging counts in-window work only (this build: July 2026, in-window).

## 1. Profile

- **BUIDL name:** Gaffer
- **Logo:** `docs/assets/icon-512.png` (1:1, symbol-only)
- **Category:** AI / Robotics
- **Vision (≤256 chars, 178):**
  `Every fan gets a private pundit that works with no cloud, no signal and no API keys — on-device AI that borrows trusted peer compute over encrypted P2P when the hardware is weak.`
- **Elevator pitch (≤150 chars, 143):**
  `Offline AI match commentary. When your phone is too weak it borrows a laptop peer's compute over encrypted P2P. Zero cloud, zero API keys.`

## 2. Form fields (Rules · "Submitting a Project")

| Field | Value |
|---|---|
| Product name | Gaffer |
| Brief description | Offline AI football co-commentator: on-device QVAC inference with P2P offload to a trusted peer over the Pears stack. |
| Track | **QVAC** (meaningful Pears usage described below — Hyperswarm, Hyperdrive, HyperDHT) |
| Nation represented | **[user]** |
| Teammates + backgrounds | **[user]** — list every member on the BUIDL page (eligibility rule) |
| Team location | **[user]** |
| Public GitHub repo (Apache-2.0) | **[user]** — push `build/` as the repo root; LICENSE + package.json already Apache-2.0 |
| Demo video (≤3 min, YouTube unlisted) | ✅ https://youtu.be/PuQPRP3jttA |
| Platform-use blurb | see §4 |

## 3. Project story

### Inspiration
I was in the away end with no signal and a three-year-old phone; the cloud commentary app spun forever and I missed why the ref pointed to the spot. The fans who most want the game explained carry the weakest hardware — so the fix can't be "a bigger cloud". It has to be *no cloud at all*.

### What it does
1. **Streams tactical commentary on-device** via `@qvac/sdk` `completion({stream:true})` — token-by-token from a football system prompt, with attack/defense focus, verbosity, pause and skip.
2. **Delegates inference to a nearby peer when the device is weak:** a laptop joins the match's Hyperswarm topic as a provider; the phone's completion requests stream over a Noise-encrypted socket and the tokens/sec gauge jumps **~6 → ~47 tok/s (×7.8 p50, measured — `npm run bench`)**.
3. **Survives the peer dying mid-sentence:** an exhaustively-tested state machine (LOCAL ⇄ OFFLOADED ⇄ FALLBACK) resumes generation on-device — **token-exact** with deterministic engines.
4. **Fetches the model from peers, not CDNs:** GGUF weights are seeded as a Hyperdrive and loaded via `pear://` — a fresh device gets a working brain with zero internet.
5. **Proves the zero-cloud claim by execution:** `npm run verify:offline` blocks every non-local connection and runs the entire flow; CI runs it on every push.

### How we built it

| Layer | Technology | Why |
|---|---|---|
| Inference | `@qvac/sdk` (LLAMA 3.2 1B GGUF; Piper TTS) | on-device, GGUF from local/http/`pear://`, streaming tokenStream |
| Delegation | Hyperswarm + framed JSON protocol + `startQVACProvider` when present | same Holepunch substrate as QVAC; peers are keypairs |
| Encryption | Noise Secretstream (transport) | E2E by construction, not by policy |
| Model share | Hyperdrive/Corestore over `pear://` | signed, hash-verified sparse replication |
| App | Pear desktop HUD + headless CLI | judge path = two terminals, zero setup |
| Tests | `node --test`, loopback HyperDHT testnet | **real-swarm** integration, no mocked network |

**Quality & security engineering:** 6-stage CI (lint+matrix tests → TruffleHog + npm audit → real-swarm integration → offline proof → bench artifact → submission gate that re-verifies the README's test count by running the suite), CodeQL, Dependabot, Apache-2.0, threat model in `docs/AUDIT_REPORT.md`.

**Engine honesty (disclosed):** without `@qvac/sdk` installed, a deterministic sim grammar drives development/demos — labelled on every surface, never presented as a model, TTS off rather than faked. The P2P layer is identical and real in both engines.

### Challenges we ran into
1. **Hyperdrive reader race:** `drive.get()` returns null before the seeder connects; `swarm.flush()` isn't "connected". Fixed with the `findingPeers()` idiom plus a bounded retry — and turned into a byte-exact integration test.
2. **Mid-stream failover without dropping the sentence:** required strict token indexing, a total state-transition table (double-dispatch safe), and seed-derived segment determinism so the local engine can skip exactly the delivered prefix. The integration test kills a real provider after 4 tokens and asserts the final text equals an uninterrupted run.
3. **Judge-friendly installs vs native inference deps:** made the SDK an optional engine behind a factory — `npm install` stays ~20 s; `npm run setup:qvac` opts into the real model.

### What we learned
The Holepunch substrate turns "borrow a GPU" from infrastructure into a library call — the hard part isn't moving tokens between peers, it's being honest about failure: total state machines and disclosed engines beat magic demos.

### What's next
- Pairing-key provider firewall (the `startQVACProvider` `firewall` hook) + Bare Kit mobile build
- Multi-provider load balancing and spot-auditing of delegated tokens
- WDK micro-payments for lent compute — the laptop earns; publish the offload helper as an npm package

## 4. Platform-use blurb (how the project uses QVAC)

All AI runs on-device through `@qvac/sdk`: `loadModel({modelSrc})` with `pear://` peer sources, streaming `completion()` for the commentary itself, Piper `textToSpeech()` for the ear, and `startQVACProvider({topic})` so a stronger device serves inference to a weaker one over the same Holepunch substrate — plus Hyperswarm/Hyperdrive/HyperDHT (Pears) for rooms, model distribution and holepunched, Noise-encrypted peer links. Zero cloud AI APIs anywhere; `npm run verify:offline` proves it under a network guard.

## 5. Team

- **Team description:** Solo build. 220 passing tests (incl. real-swarm failover integration), reproducible ×7.8 offload benchmark, offline-proof script in CI, Apache-2.0.
- **Contact to organizer:** Hi! I'm Edy — Gaffer is an offline AI co-commentator where a weak phone borrows a laptop's compute over encrypted P2P (QVAC × Pears). Repo + ≤3-min demo video linked on the BUIDL; `node cli.js --standalone` runs with zero setup if you'd like to poke it live. Thank you for reviewing!

## 6. Media

- Logo: `docs/assets/icon-512.png` · Banner: `docs/assets/og-image.png`
- Screenshots: `docs/assets/hud-live.png`, `docs/assets/hud-peer-link.png`, `docs/assets/hud-offline-proof.png`

## 7. Demo video script (≤3 min)

1. **0:00–0:20 · Hook** — away end, dead phone. "Watch it work anyway." Standalone CLI crawling at ~6 tok/s.
2. **0:20–1:00 · The surge** — `--provider` starts on the laptop; HUD gauge 6→47 tok/s, `⇄ BOOSTED BY PEER`; show `npm run bench` table (×7.8).
3. **1:00–1:35 · No cloud, at all** — run `npm run verify:offline` on camera; point at the network guard line; flip to the LAN bootstrap flags for the airplane-mode demo.
4. **1:35–2:05 · pear:// model share** — `seed_model.js` prints the link; second machine fetches with wifi off.
5. **2:05–2:40 · The kill** — Ctrl-C the provider mid-sentence; the sentence finishes; state flips to FALLBACK; provider returns → boosted again.
6. **2:40–3:00 · Close** — 220 tests, disclosed sim engine + forks, Apache-2.0. "Gaffer never once phones home. Thank you."

## 8. Engineering harness summary

| Layer | Status | Details |
|---|---|---|
| Code quality | ✓ | eslint 9 flat config, zero warnings |
| Unit testing | ✓ | 220 tests, `node --test`, deterministic |
| Coverage | ✓ | `npm run coverage` — 100% lines, functions & branches on `lib/`; live `@qvac/sdk`/`pear://` I/O excluded, never stubbed |
| Integration | ✓ | real Hyperswarm over loopback DHT — delegation, failover, model share |
| Security | ✓ | CodeQL + Dependabot + TruffleHog + npm audit |
| CI/CD | ✓ | 6 stages incl. offline-proof + bench artifact + readiness gate |
| Performance | ✓ | `scripts/bench.js` p50/p95, JSON artifact in CI |

## 9. Pre-submit checklist

- [ ] **[user]** Push `build/` to a public GitHub repo (Apache-2.0 already in place); update badge/repo links in README if desired
- [x] **[user]** Record the 3-min video (script above), upload unlisted, paste URL → https://youtu.be/PuQPRP3jttA
- [ ] **[user]** Fill nation / team / location on the form; add all teammates to the BUIDL page
- [ ] Run `npm run check:ready` — must print `✓ READY`
- [ ] Paste §1–§7 into the form fields

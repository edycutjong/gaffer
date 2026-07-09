# Pitch deck — Gaffer (12 slides + talk track)

> Style: dark tactical HUD (tokens: #0A0A0F bg, #00E5FF cyan, #B6FF3D lime, #FF3D71 magenta,
> Chakra Petch display / JetBrains Mono numbers). One idea per slide, numbers over adjectives.

---

## Slide 1 — Title
**GAFFER** — *the offline AI co-commentator that runs on your peers' hardware*
Hero metric strip: **×7.8 speedup · 0 cloud calls · 220 tests**
**Talk track:** "Gaffer is a pundit in your ear that works with no internet, no API keys — and, when your phone is too weak, no local compute either. It borrows a laptop's brain over encrypted P2P."

## Slide 2 — The problem
Away end. No signal. Three-year-old phone. The cloud commentary app spins forever — you miss why the ref pointed to the spot.
Three structural failures: **cloud-dependent · one generic feed for millions · your listening habits are telemetry.** And the fans who most need an explainer hold the weakest hardware.
**Talk track:** anchor on the one fan, not the market.

## Slide 3 — The solution
A local-first "manager in your ear": on-device LLM commentary via **QVAC**; when the device is weak, inference **delegates to a nearby trusted peer** over the **Pear** stack. If the peer dies mid-sentence, the sentence finishes on-device.
**Talk track:** "The offload is the product. Everything else got cut."

## Slide 4 — Live demo flow
1. `node cli.js --client` → commentary crawls at ~6 tok/s
2. `node cli.js --provider` on a laptop → gauge **surges to ~47 tok/s**, `⇄ BOOSTED BY PEER`
3. Ctrl-C the laptop mid-sentence → seamless on-device resume
4. `npm run verify:offline` → ✓ with the internet blocked
**Talk track:** narrate the gauge, then the kill. The kill is the trust moment.

## Slide 5 — How it works (architecture)
Diagram: phone (router state machine LOCAL⇄OFFLOADED⇄FALLBACK) ⇄ Noise-encrypted Hyperswarm socket ⇄ laptop (ProviderNode → engine). HyperDHT topic = hash(match id). Models ride `pear://` Hyperdrives.
**Talk track:** "Peers are keypairs, not IPs. Encryption is the transport, not a feature flag."

## Slide 6 — Why only QVAC × Pear
`completion({stream:true})` · `loadModel({modelSrc:'pear://…'})` · `startQVACProvider({topic})` · Piper TTS · Hyperswarm rooms · Secretstream E2E · Hyperdrive model share.
**Remove them and you need:** cloud LLM + cloud TTS + model CDN + TURN server + rented GPU + a privacy policy.
**Talk track:** same Holepunch substrate — delegation is native, not a bolt-on.

## Slide 7 — Real-world utility
Stadiums and planes today; the same offload pattern generalises to **any weak-edge AI**: field kits, classrooms with one good machine, privacy-bound environments (care, legal). Accessibility: spoken narration for low-vision fans, pace controls built in.
**Talk track:** football is the wedge, peer-boosted on-device AI is the platform.

## Slide 8 — Competitive read
Cloud commentary apps (die offline, telemetry) · on-device-only apps (die on weak hardware) · Gaffer (**on-device + peer-boosted**, private by construction).
**Talk track:** "We don't beat the cloud on model size. We beat it on *works in the away end*."

## Slide 9 — Traction & proof (build-week facts)
**220 tests** green incl. real-swarm failover · bench: **×7.8 p50, 97%+ transport efficiency, ≤25 ms connect** · offline verification in CI · reproducible seeds · Apache-2.0.
**Talk track:** every number on this slide is a script in the repo, not a slide-only claim.

## Slide 10 — Honest limitations
Cold-start model load (mitigated by `pear://` pre-seed) · generative narration, not licensed data · token-exact resume only for deterministic engines (real LLM restarts, flagged) · provider trust = room trust today (pairing firewall is the next step).
**Talk track:** judges remember honesty; say these before they ask.

## Slide 11 — Roadmap
**30d:** pairing-key provider firewall + Bare Kit mobile build. **60d:** multi-provider load-balancing + spot-audit of delegated tokens. **90d:** WDK micro-payments for lent compute — the laptop earns; publish the offload helper as a standalone npm package.
**Talk track:** each item extends the existing state machine — no rewrites.

## Slide 12 — Ask / close
Try it: two terminals, sixty seconds, zero keys. `node cli.js --provider` · `node cli.js --client`.
**"Every fan deserves a pundit in their ear — even the one with a dead phone in the away end. Gaffer never once phones home."**
Thank-you + repo link + demo video link.

# Simulated judge review — self-audit (hybrid code+docs auditor)

> **Superseded** by the Round-of-32 audit pair, run against the real ~53-hacker field and
> exact rubric wording: [AUDIT_HACKATHON_REVIEW.md](AUDIT_HACKATHON_REVIEW.md) (code+docs) and
> [AUDIT_POLISH_WIN_WOW.md](AUDIT_POLISH_WIN_WOW.md) (docs-only). Kept here as the original
> round-2 record — findings below still hold, just re-verified and re-scored in the newer pair.

> Inputs: rubric = DevCup's five 1–5 criteria (technical ambition, UX, real-world utility,
> creativity, real platform use); team = 1 dev; field = knockout bracket (Round of 32 →
> Final); time left = registration locks Jul 6, submission Jul 14. Run on the actual build.

## One-line verdict

**Winnable** — the offload surge + mid-sentence kill is a live, witnessable capability
unlock; the main residual risks are logistics (video quality, repo push) and the "sim
engine on judge's machine by default" optics, which the docs meet head-on.

## Step 1 — hard disqualifiers

| # | Disqualifier | Verdict | Evidence / minimum fix |
|---|---|---|---|
| 1 | Hard part invisible in the demo | **PASS** | The hard part *is* the demo: the gauge surge (6→47 tok/s) and the mid-sentence provider kill happen on screen, in the CLI and the HUD, driven by the real router. |
| 2 | Needs a live external API on stage | **PASS** | Zero external services by construction; `verify_offline.js` runs the flow with non-local connections blocked. The P2P link is machine-to-machine on stage; the standalone mode is the "one I prepared earlier" that needs nothing at all. |
| 3 | Only impresses at scale | **PASS** | Two devices, sixty seconds. |
| 4 | Core feature only works on canned input | **PASS, with disclosure** | The offload/failover works on any request. Commentary from the sim engine is generative-grammar, seeded — but reacts live to focus/verbosity/skip and arbitrary event feeds; it is labelled on every surface and the real-model path (`--engine qvac`) exists with exact SDK calls. Nothing is presented as something it isn't. |
| 5 | One-sentence problem unclear from docs | **PASS** | README line 1-2: commentary dies offline; weakest fans hold the weakest phones. |

## Step 2 — scored tests

**A. Shippable (2× buffer) — 9/10.** It ships today: 158 green tests, lint clean, CI written,
demo scripts runnable. The 2×-risk item is the *optional* real-model path (native install +
700 MB download) — explicitly out of the demo's critical path, so the buffer can't eat the
deadline. Remaining work is account-gated logistics (push, video), each < 1 hour.

**B. Winnable vs field — top third, ceiling top 5.** Expected field archetypes: chat-with-
your-team RAG bots (docs-example distance ≈ zero), wallet dApps, prediction games. A weak
phone thinking with a laptop's brain, fully offline, is a different *kind* of demo, and the
knockout format rewards a project that keeps improving (roadmap = firewall pairing → mobile →
WDK payments). What out-shines it: a team that ships the same offload story **with the real
model on stage on two phones** — which is exactly why `--engine qvac` + `pear://` seeding are
first-class, not afterthoughts.

**C. Wow factor — 8/10.** Magic-moment beat, timestamped in the video script: **at ~0:35 the
provider joins and the gauge surges ×8 with the lime badge; at ~2:10 the provider is killed
mid-sentence and the sentence refuses to die.** Two "oh" beats, both mechanical truths.

**D. Non-generic — 8/10.** Closest patterns judges will have seen: "local llama chat app"
(no P2P), "P2P chat over Hyperswarm" (no AI), "watch-party app" (cloud). P2P *inference
offload with mid-stream failover* pattern-matches to none of the tutorial repos in
qvac-examples; prior-work section keeps the distinction auditable.

**E. Code & docs hygiene — 9/10.** No dead buttons: every HUD control acts (or explains
honestly why not — TTS on sim). No `if demo: return fake` paths — the replay mode is labelled
recording playback, and live modes share one code path. Claims↔code: test count re-verified by
a gate that runs the suite; bench numbers regenerate with one command. README opens with
problem→solution→built in the first three lines.

## Action list (ranked by leverage)

**(a) make-it-true**
1. ~~Verify README's test count by execution~~ → done, gate-enforced (`check:ready`).
2. ~~Offline claim needs proof~~ → done (`verify:offline` + CI stage).
3. **[user] Push the repo public + record the 3-min video** — the only remaining truth gaps
   between docs and a judge's screen (both account-gated; steps in submission doc §9).

**(b) make-judges-care**
4. Record the video's kill-shot in the HUD (peer view) rather than the CLI — the lime surge
   reads instantly on camera.
5. Optional, high-leverage if time allows before a later round: run the real QVAC engine on
   the provider laptop for the video's surge segment (weak client stays sim-throttled) — the
   headline becomes "real model tokens over real P2P".

## Cut list (keep resisting)

RAG "ask the gaffer anything" · crowd timelines/Autobase · translation · any cloud fallback ·
multi-provider load-balancing before the firewall lands. The spec's scope constraint held;
keep it held through the knockout rounds.

# Self-Audit — invariants, threat model, residual risk

> Honest self-assessment. Claiming perfect security is an anti-pattern; this documents what
> Gaffer guarantees, what it assumes, and what it explicitly does not protect against.

## Invariants (each enforced by tests)

| # | Invariant | Enforcement |
|---|---|---|
| I1 | **Token-stream ordering** — delegated tokens arrive with strictly ascending indices; any gap/reorder aborts the remote segment | `router.js` order check; integration test "streamed back in order" |
| I2 | **Token-exact resume (deterministic engines)** — after mid-stream provider death, concat(delivered ⧺ resumed) equals the uninterrupted generation | integration test "token-exact local resume" |
| I3 | **Graceful degradation is total** — every (state × event) pair is defined; double-dispatch (peer-gone + stream-error) cannot crash or wedge | `state.js` table; exhaustive transition test |
| I4 | **No cloud path** — no code path opens a connection beyond loopback/LAN during the full commentary + offload loop | `offline-guard.js` + `verify_offline.js` in CI |
| I5 | **Determinism of demo data** — same seed ⇒ identical match events and identical sim commentary | match/sim determinism tests |
| I6 | **Engine honesty** — the active engine is labelled on every surface; sim never fakes TTS; explicit `--engine qvac` never silently downgrades | engine-factory tests; TTS refusal test |
| I7 | **Hostile-frame containment** — malformed JSON, unknown types, >4 MiB frames disconnect the offending peer, never crash the process | protocol parser tests |
| I8 | **Model share integrity** — bytes fetched over `pear://` equal the seeded bytes | modelshare integration test (byte-exact) |

## Threat model

**Adversaries considered**

1. **Passive network observer (stadium wifi):** sees only Noise-encrypted streams and DHT
   traffic; commentary tokens and prompts are unreadable. ✓ mitigated by Secretstream.
2. **Malicious peer joining the match topic:** can send garbage frames (→ disconnected, I7),
   or announce itself as a provider and return junk tokens. ⚠ residual — see R2.
3. **Cloud-dependency regression (a future dev adds an API call):** caught by `verify:offline`
   in CI (I4). ✓ mitigated structurally.
4. **Tampered model weights in transit:** Hypercore verification rejects corrupted blocks. ✓
   mitigated by the substrate. Poisoned-at-source models are out of scope (R4).

## Residual risks (documented, not hidden)

- **R1 · Provider trust = room trust.** Anyone who knows the match id can join the topic and
  offer compute. Today the client uses the first provider that answers. Mitigation on the
  roadmap: pairing-key firewall (the `startQVACProvider` `firewall` hook exists for exactly
  this) + provider allowlists in the trust panel. For the personal use-case (your own laptop),
  use a private `--match` id, which is effectively a shared secret.
- **R2 · Output integrity is not attested.** A malicious provider could return plausible-but-
  wrong tokens; Gaffer verifies ordering, not semantics. Deterministic engines could be
  spot-audited (recompute k tokens locally); real-LLM attestation would need TEEs — out of scope.
- **R3 · UDP not guarded.** The offline guard intercepts TCP/TLS/HTTP(S)/fetch; HyperDHT
  legitimately uses UDP. A hypothetical exfiltration over raw UDP would evade the guard —
  noted for honesty; no such path exists in the codebase (deps: hyperswarm stack only).
- **R4 · Model provenance.** Gaffer loads the GGUF you point it at; it does not attest what a
  peer seeded. Verify the drive key out-of-band (it IS the content authenticity root).
- **R5 · Prompt-level hallucination.** The system prompt pins the score/events as ground truth
  and forbids inventing goals, but a real LLM can still embellish; the event feed shown in the
  HUD is the source of truth, and commentary is labelled generative.
- **R6 · DoS on a public room.** Request flooding a provider is bounded per-connection
  (one stream per request id, cancel supported) but there is no rate limiting yet.

## Audit round 2 (2026-07-03) — adversarial re-read + cold-clone verification

Every runtime file was re-read line-by-line, a cold clone (`rsync` → fresh `npm ci`) ran the
full judge path, and every documented claim was re-checked against fresh runs. Findings
(all fixed the same day, each with a regression test where testable):

| # | Severity | Finding | Fix |
|---|---|---|---|
| A1 | medium | `commentary.skip()` while idle left a stale flag that silently aborted the NEXT segment | skip is a no-op unless a segment is streaming + flag cleared at segment start; regression test |
| A2 | medium | aborting a delegated segment between tokens waited for the next token or the full gap timeout (up to 8 s) | abort listener fails the wire queue immediately; `cancel` frame sent on every mid-stream walk-away; regression test asserts < 1.5 s |
| A3 | medium | provider accepted unbounded concurrent requests per peer (DoS surface previously overstated as "bounded") | per-peer cap (default 4) answers a `busy` error frame; regression test |
| A4 | medium | duplicate request ids overwrote the live AbortController and interleaved two token streams under one id | peer-scoped duplicate detection rejects with an error frame; regression test — **the first fix attempt keyed ids globally and broke two-client sharing; the existing suite caught it and the key is now `(peer, id)`** |
| A5 | low | `router.complete()` callers consuming only the stream got an unhandled-rejection warning | rejection pre-handled on the returned promise (await still works); regression test |
| A6 | low | duplicate swarm connections from one keypair could delete the LIVE peer from the map on the stale socket's close | close handler removes the entry only if it still owns it |
| A7 | low | a throwing SDK-native provider bridge aborted `ProviderNode.start()` entirely | best-effort try/catch → reported as `{available:false, reason}` |
| A8 | low | a TTS failure crashed the segment pipeline | speaker errors emit `error` and the broadcast continues; regression test |
| A9 | low | `modelshare` buffered whole files in memory (a real GGUF is ~700 MB) | seed + fetch now stream (`pipeline`), entry-based retry; byte-exact test still green |
| A10 | cosmetic | a `save` could narrate before its `shot_on_target` in the same minute | save clock clamped after its shot (no RNG drift — seed 2047's storyline is byte-identical); property test over 20 seeds |
| A11 | cosmetic | `--quiet` claimed "machine-readable only"; web-demo server crashed with a raw stack on a busy port; `--wait-provider` accepted NaN | wording fixed; friendly EADDRINUSE message; flag validated |
| A12 | docs | bench claims quoted one warm run (×7.98 / 99.4% / 22 ms) that fresh runs don't exactly reproduce | all surfaces restated from a cold-clone run with variance noted (×7.8 p50, 97%+ efficiency, ≤25 ms connect) |

Cold-clone verification (fresh dir, `npm ci`): lint ✓ · **158/158 tests** ✓ ·
`verify:offline` ✓ · `check:ready` ✓ (live re-count) · bench ✓ · CLI help/error/exit codes ✓ ·
fixtures regenerate byte-identical ✓ · two-process offline LAN demo boosted from segment 1 ✓.

## Secure-defaults checklist

- [x] E2E encryption on every peer link (transport-level, not optional)
- [x] Peers are keypairs; no IPs or accounts anywhere
- [x] Frame-size cap + structural validation on all inbound messages
- [x] No secrets in the repo (nothing to leak — `.env.example` documents *optional* knobs only)
- [x] CI: TruffleHog secret scan, CodeQL, dependency audit, offline-proof stage
- [x] Apache-2.0, dependencies pure-JS/libsodium stack (`npm audit`: 0 known vulns at commit time)

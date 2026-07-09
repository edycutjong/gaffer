# Friction log — real DX notes from building Gaffer

> Everything below actually happened during this build. Shared for the QVAC/Pears teams —
> a good friction log is worth more than praise.

## Pears / Holepunch stack

1. **`pear` name collision on macOS.** Homebrew's PHP ships `/opt/homebrew/bin/pear`
   (PHP PEAR), which shadows the Pear runtime for anyone who had PHP installed — and on this
   machine the PHP binary was *also* broken (missing `libicuio.74.dylib`), so `pear --version`
   just dies confusingly. Suggestion for docs: a "check `which pear`" note in Getting Started
   would save real minutes. (We documented it in our DEMO.md.)

2. **Hyperdrive reader race — the #1 stumble.** A fresh `drive.get(path)` on a readable drive
   returns `null` if the swarm hasn't connected to the seeder yet; `swarm.flush()` resolving is
   NOT "the seeder is connected", it's "the query finished". The fix is the
   `drive.findingPeers()` + `swarm.flush().then(done, done)` idiom **plus** a bounded retry,
   because DHT announces propagate asynchronously. The idiom is in the docs but easy to miss —
   a copy-pasteable "reader that always works" snippet would be gold.

3. **Testnets are excellent.** `hyperdht/testnet.js` gave us a 3-node loopback DHT that made
   *real-swarm* integration tests (discovery, delegation, mid-stream failover, drive fetch)
   deterministic enough for CI. This is a killer feature — surface it louder in the docs.

4. **Keepalive defaults.** Provider death is only detected on the next socket event; we set
   `conn.setKeepAlive(5000)` and added a token-gap timeout at the protocol layer. A documented
   "recommended liveness recipe" for request/response apps over Hyperswarm would help.

4b. **One bootstrap node is not a DHT.** For the airplane-mode LAN demo we first ran a single
   `DHT.bootstrapper()` and pointed both peers at it: `swarm.flush()` took 12 s and announces
   never resolved — Hyperswarm's NAT/reachability detection needs a few DHT nodes before a
   peer will act as a server. Mirroring `createTestnet`'s shape (bootstrapper + two
   non-ephemeral, unfirewalled helper nodes in one process) made discovery instant (~20 ms).
   A doc note — "to run an isolated DHT, you need ≥3 nodes, here's why" — would have saved an
   evening; better yet, ship `DHT.localnet(port)` as a first-class helper.

## QVAC SDK

5. **Optionality is the right integration shape.** `@qvac/sdk` pulls native inference deps,
   which is exactly right for the product but heavy for "judge runs `npm install` on hotel
   wifi". We made it an *optional engine* behind a factory (`npm run setup:qvac` to opt in,
   labelled sim fallback otherwise) — install stays ~20 s and the P2P layer demos everywhere.
   An official "slim install" story (SDK without engines, engines fetched on first load) would
   make hackathon integrations much smoother.

6. **`startQVACProvider` consumer-side pairing is under-documented.** The provider side
   (`startQVACProvider({ topic, firewall })`) is clear; how a *consumer* device discovers and
   routes `completion()` to that provider is not spelled out in the public docs we had. We
   built an engine-agnostic delegation protocol over Hyperswarm (which also de-risked the
   demo) and kept the native provider as an offered extra. A end-to-end phone→desktop
   delegation example in `qvac-examples` would be the single most valuable addition.

7. **Model constants are great; seeds would be better.** `LLAMA_3_2_1B_INST_Q4_0` as an
   importable constant is lovely. A documented `seed`/`temperature` parameter on
   `completion()` (if the runtime supports it) would let deterministic cross-device resume
   work with real models, not just our sim engine.

## Node / tooling (kept for completeness)

8. **Node 22 `--test` path quirk:** `node --test test/` (trailing slash) throws
   `MODULE_NOT_FOUND`; default discovery (`node --test`) or explicit globs work.
9. **eslint 9 vs `@eslint/js` 10:** the flat-config helper package major-versions with eslint
   itself; `@eslint/js@^9` is the pin that matches `eslint@^9` — ERESOLVE otherwise.

# DEMO.md — exact steps & expected output

Three ways to see the offload, ordered by effort. No accounts, no API keys anywhere.

## 0. One terminal (judge mode, 60 seconds)

```bash
npm install
node cli.js --standalone --speed 400
```

**Expect:** the banner names the active engine (`sim` unless `@qvac/sdk` is installed),
then tactical commentary streams token-by-token at ~6 tok/s (the weak-device profile),
each segment tagged `[⌂ local · 5.9 tok/s]`. Ends with a session report.

## 1. Two terminals — the offload surge (the demo)

```bash
# terminal A — the laptop brain
node cli.js --provider

# terminal B — the weak phone (start it first if you want to SEE the surge happen)
node cli.js --client
```

**Expect in B:**
1. commentary starts sluggish: `[⌂ local · ~6 tok/s]`
2. within seconds: `⇄ provider found`, then **`⇄ BOOSTED BY PEER`**
3. segments now stream at ~48 tok/s, tagged `[⇄ peer · ~47 tok/s]`
4. **kill terminal A mid-sentence (Ctrl-C)** → B prints
   `⚠ provider lost — continuing on-device (OFFLOADED → FALLBACK, sentence resumes seamlessly)`
   and the sentence finishes without a visible seam — token-exact with the deterministic engine
5. restart A → B flips back to `⇄ BOOSTED BY PEER`
6. Ctrl-C in B prints the session report: local p50, offloaded p50, speedup, connect ms

Both terminals on one machine is fine (they meet through the DHT). Two machines on one
network work the same; use `--match my-room-42` on both to pick a private room.

## 2. Fully offline (airplane-mode LAN)

Prove there is no internet dependency at all:

```bash
# machine A: run a local DHT bootstrap (prints the flag to copy)
node scripts/lan_bootstrap.js

# machine A (second terminal):
node cli.js --provider --bootstrap '[{"host":"<A-LAN-IP>","port":49737}]'

# machine B (wifi to the internet OFF, same LAN):
node cli.js --client --bootstrap '[{"host":"<A-LAN-IP>","port":49737}]'
```

Or run the automated proof (blocks every non-local connection, then runs the full loop):

```bash
npm run verify:offline          # loopback + LAN allowed, internet blocked
npm run verify:offline -- --strict   # loopback only
```

**Expect:** `✓ OFFLINE VERIFICATION PASSED — Gaffer never phones home.`

## 3. Desktop HUD (Pear)

```bash
npm i -g pear && pear          # one-time runtime bootstrap
pear run .                     # from the repo root
```

The HUD shows the three screens (Live HUD / Peer Link / Offline Proof). Run
`node cli.js --provider` alongside it to watch the gauge surge. macOS note: Homebrew's PHP
ships a conflicting `pear` binary — check `which pear` (see docs/friction-log.md).

No Pear runtime? `npm run demo:web` serves the same HUD at `http://127.0.0.1:8484/app/`
in **replay mode** — it re-renders a recorded real session and is badged as such.

## Real engine (optional, ~700 MB model)

```bash
npm run setup:qvac                       # installs @qvac/sdk (native deps)
node cli.js --standalone --engine qvac   # first run downloads LLAMA 3.2 1B GGUF
# share the downloaded model to the second machine with zero internet:
node scripts/seed_model.js <path-to-gguf>          # prints a pear:// link
node cli.js --client --engine qvac --model-src 'pear://…'
```

`--engine qvac` refuses to silently downgrade; without the SDK it exits with the install hint.

## Flags you'll actually use

| Flag | Effect |
|---|---|
| `--speed 400` | faster match clock (ms per match-minute) |
| `--max-events 8` | short demo, then the session report |
| `--focus attack` / `--verbosity rich` | commentary style |
| `--seed 2047` | the default 3-2 thriller; any number gives a different match |
| `--tts` | Piper voice in the ear (QVAC engine only — sim never fakes audio) |

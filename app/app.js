// GAFFER HUD — view layer + two honest runtimes.
//
//   LIVE   — under Pear (`pear run .`) or a Node-backed webview, the real
//            stack runs in-process: real engines, real Hyperswarm delegation.
//   REPLAY — in a plain browser (landing page, screenshots) the HUD replays
//            app/replay/session.json, a recording of a REAL session captured
//            by scripts/record_session.js. The badge always says which one
//            you are looking at. The offload surge is never faked.

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(globalThis.location?.search ?? '')

/** Inline SVG icon (symbols defined in index.html) — the UI never uses emoji. */
const icon = (name, cls = '') => `<svg class="icon ${cls}"><use href="#i-${name}"/></svg>`

// ── view state ───────────────────────────────────────────────────────────────
const view = {
  tokenStamps: [],
  energy: 0,
  localTps: [],
  offTps: [],
  served: 0,
  currentSeg: null,
  boosted: false,
  maxRate: 60
}

// tabs
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab))
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab.dataset.view}`))
  })
}

function toast (msg, cls = '', iconName = null) {
  const el = $('toast')
  el.innerHTML = (iconName ? icon(iconName) : '') + `<span>${msg}</span>`
  el.className = `toast show ${cls}`
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.remove('show'), 3400)
}

function setModeBadge (text, cls) {
  const el = $('mode-badge')
  el.textContent = text
  el.className = `mode-badge ${cls}`
}

function setEngineChip ({ kind, modelId, fallback }) {
  $('engine-chip').innerHTML = kind === 'qvac'
    ? `engine: <b style="color:var(--primary)">qvac</b> · on-device ${modelId ?? 'model'}`
    : `engine: <b>sim</b> — disclosed dev grammar${fallback ? ' (no model installed)' : ''}<br>P2P layer is real either way`
  const items = $('verify-list').children
  if (kind === 'qvac') items[0].classList.remove('pending')
}

function setRouterState (next) {
  const badge = $('boost-badge')
  view.boosted = next === 'OFFLOADED'
  if (next === 'OFFLOADED') {
    badge.innerHTML = `${icon('link')} BOOSTED BY PEER`
    badge.className = 'boost-badge on'
    $('laptop-node').setAttribute('opacity', '1')
    $('lock').setAttribute('opacity', '1')
    toast('provider joined — inference offloaded over encrypted P2P', 'boost', 'link')
  } else if (next === 'FALLBACK') {
    badge.innerHTML = `${icon('warn')} PEER LOST · ON-DEVICE`
    badge.className = 'boost-badge fallback'
    $('laptop-node').setAttribute('opacity', '0.35')
    $('failover-state').textContent = 'survived — sentence resumed on-device'
    toast('provider lost mid-stream — resumed on-device without dropping the sentence', 'warn', 'warn')
  } else {
    badge.innerHTML = `${icon('chip')} on-device`
    badge.className = 'boost-badge'
  }
  $('gauge-val').classList.toggle('boosted', view.boosted)
  $('gauge-arc').style.stroke = view.boosted ? 'var(--boost)' : 'var(--primary)'
}

function segmentStart (event) {
  const feed = $('feed')
  const seg = document.createElement('div')
  seg.className = `seg ${event.type === 'goal' ? 'goal' : ''}`
  seg.innerHTML = '<span class="stamp"><span class="etype"></span></span><span class="txt"></span><span class="cursor"></span>'
  const stamp = seg.querySelector('.stamp')
  const etype = seg.querySelector('.etype')
  stamp.insertBefore(document.createTextNode(`${String(event.minute).padStart(2, '0')}' `), etype)
  if (event.type === 'goal') etype.innerHTML = `${icon('ball')} GOAL`
  else if (event.type === 'penalty_awarded') etype.innerHTML = `${icon('warn')} PENALTY`
  else etype.textContent = event.type.replace(/_/g, ' ')
  feed.appendChild(seg)
  feed.scrollTop = feed.scrollHeight
  view.currentSeg = seg
  $('minute').textContent = `${String(event.minute).padStart(2, '0')}'`
  $('score').textContent = `${event.score.home}–${event.score.away}`
}

function tokenArrived ({ token, source }) {
  view.tokenStamps.push(performance.now())
  view.energy = Math.min(1, view.energy + 0.18)
  if (!view.currentSeg) return
  const txt = view.currentSeg.querySelector('.txt')
  const span = document.createElement('span')
  if (source === 'offloaded') span.className = 'tok-off'
  span.textContent = token
  txt.appendChild(span)
  $('feed').scrollTop = $('feed').scrollHeight
}

function segmentEnd (summary) {
  if (view.currentSeg) {
    view.currentSeg.querySelector('.cursor')?.remove()
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.innerHTML = `[${summary.source === 'offloaded' ? `${icon('link')} peer` : `${icon('chip')} local`} · ${summary.tps} tok/s${summary.resumed ? ' · resumed' : ''}]`
    view.currentSeg.appendChild(badge)
    view.currentSeg = null
  }
  if (summary.source === 'offloaded') {
    view.offTps.push(summary.tps)
    view.served++
    $('fact-served').textContent = String(view.served)
  } else if (summary.sources?.length === 1) {
    view.localTps.push(summary.tps)
  }
  updateBeforeAfter()
}

function p50 (arr) {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

function updateBeforeAfter () {
  const local = p50(view.localTps)
  const off = p50(view.offTps)
  const max = Math.max(local ?? 0, off ?? 0, 1)
  if (local != null) {
    $('ba-local').style.width = `${(local / max) * 100}%`
    $('ba-local-n').textContent = local.toFixed(1)
    $('phone-sub').textContent = `local · ${local.toFixed(1)} tok/s`
  }
  if (off != null) {
    $('ba-off').style.width = `${(off / max) * 100}%`
    $('ba-off-n').textContent = off.toFixed(1)
  }
  if (local != null && off != null) {
    $('speedup').firstChild.textContent = `×${(off / local).toFixed(1)}`
  }
  view.maxRate = Math.max(60, (off ?? 0) * 1.25)
}

function providerSeen ({ shortKey, connectMs, announce }) {
  $('laptop-sub').textContent = `${shortKey ?? 'peer'} · ${announce?.engine ?? '?'} engine`
  if (connectMs != null) $('fact-connect').textContent = String(Math.round(connectMs))
  const list = $('peerlist')
  list.innerHTML = `<span class="key">${shortKey ?? 'peer'}</span> — provider · Noise keypair identity, not an IP`
}

function providerGone () {
  $('laptop-sub').textContent = 'gone — searching swarm…'
  $('peerlist').innerHTML = 'provider left the room — on-device fallback active'
}

// gauge + waveform + particles animation loop
const waveCtx = $('wave').getContext('2d')
let particles = []
function initParticles () {
  const g = $('particles')
  g.innerHTML = ''
  particles = []
  for (let i = 0; i < 7; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    c.setAttribute('r', '3')
    c.setAttribute('fill', 'var(--boost)')
    c.setAttribute('filter', 'url(#glow)')
    c.setAttribute('opacity', '0')
    g.appendChild(c)
    particles.push({ el: c, t: i / 7 })
  }
}
initParticles()

function animate () {
  // tokens/sec over a 3s window
  const now = performance.now()
  while (view.tokenStamps.length > 0 && view.tokenStamps[0] < now - 3000) view.tokenStamps.shift()
  const span = view.tokenStamps.length > 1 ? now - view.tokenStamps[0] : 3000
  const rate = view.tokenStamps.length > 1 ? (view.tokenStamps.length / span) * 1000 : 0
  $('gauge-val').textContent = rate < 10 ? rate.toFixed(1) : String(Math.round(rate))
  $('gauge-arc').style.strokeDashoffset = String(283 - Math.min(rate / view.maxRate, 1) * 283)

  // waveform — feed activity, decays between tokens
  view.energy *= 0.965
  const { width, height } = waveCtx.canvas
  waveCtx.clearRect(0, 0, width, height)
  const bars = 90
  for (let i = 0; i < bars; i++) {
    const x = (i / bars) * width
    const jitter = Math.sin(now / 300 + i * 0.7) * 0.5 + 0.5
    const h = 2 + jitter * view.energy * (height - 4)
    waveCtx.fillStyle = view.boosted ? 'rgba(182,255,61,0.75)' : 'rgba(0,229,255,0.7)'
    waveCtx.fillRect(x, (height - h) / 2, 3, h)
  }

  // particles flow provider → phone while boosted
  const speed = 2600 - Math.min(rate / view.maxRate, 1) * 1800
  for (const p of particles) {
    if (!view.boosted) {
      p.el.setAttribute('opacity', '0')
      continue
    }
    p.t = (p.t + 16 / speed) % 1
    p.el.setAttribute('cx', String(490 - p.t * 340))
    p.el.setAttribute('cy', String(180 + Math.sin(p.t * Math.PI * 2.2) * 7))
    p.el.setAttribute('opacity', String(0.25 + 0.75 * Math.sin(p.t * Math.PI)))
  }
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)

// ── controls (wired by the live runtime; disabled in replay) ────────────────
let live = null
function wireControls () {
  for (const btn of document.querySelectorAll('[data-focus]')) {
    btn.addEventListener('click', () => {
      if (!live) return toast('controls need a live session — this is a replay', 'warn')
      live.commentary.setFocus(btn.dataset.focus)
      document.querySelectorAll('[data-focus]').forEach(b => b.classList.toggle('active', b === btn))
      toast(`focus → ${btn.dataset.focus}`)
    })
  }
  for (const btn of document.querySelectorAll('[data-verbosity]')) {
    btn.addEventListener('click', () => {
      if (!live) return toast('controls need a live session — this is a replay', 'warn')
      live.commentary.setVerbosity(btn.dataset.verbosity)
      document.querySelectorAll('[data-verbosity]').forEach(b => b.classList.toggle('active', b === btn))
      toast(`verbosity → ${btn.dataset.verbosity}`)
    })
  }
  $('ctl-pause').addEventListener('click', () => {
    if (!live) return toast('controls need a live session — this is a replay', 'warn')
    const c = live.commentary
    if (c.paused) {
      c.resume()
      $('ctl-pause').classList.remove('active')
      $('ctl-pause').innerHTML = `${icon('pause')} PAUSE`
    } else {
      c.pause()
      $('ctl-pause').classList.add('active')
      $('ctl-pause').innerHTML = `${icon('play')} RESUME`
    }
  })
  $('ctl-skip').addEventListener('click', () => {
    if (!live) return toast('controls need a live session — this is a replay', 'warn')
    live.commentary.skip()
    toast('segment skipped', '', 'skip')
  })
  $('ctl-tts').addEventListener('click', () => {
    if (!live) return toast('controls need a live session — this is a replay', 'warn')
    if (live.engine.kind !== 'qvac') return toast('voice needs the QVAC engine (Piper) — sim never fakes audio', 'warn')
    live.speaker.setEnabled(!live.speaker.enabled)
    $('ctl-tts').classList.toggle('active', live.speaker.enabled)
  })
}
wireControls()

// ── LIVE runtime ─────────────────────────────────────────────────────────────
async function startLive () {
  const lib = await import('../index.js')
  const engineKind = params.get('engine') || 'auto'
  const role = params.get('role') || 'client' // client | standalone
  const matchId = params.get('match') || 'final-2026'
  const seed = Number(params.get('seed') || 2047)
  const speed = Number(params.get('speed') || 700)
  const tps = Number(params.get('tps') || 6)

  const { engine, fallback } = await lib.createEngine({ engine: engineKind, tps })
  setEngineChip({ kind: engine.kind, modelId: engine.modelId, fallback })

  const router = new lib.InferenceRouter({ matchId, engine, p2p: role === 'client' })
  const speaker = new lib.TtsSpeaker({ engine, enabled: false })
  const commentary = new lib.CommentaryEngine({ router, fixture: lib.DEFAULT_FIXTURE, seed, speaker })

  $('team-home').textContent = lib.DEFAULT_FIXTURE.home.name.toUpperCase()
  $('team-away').textContent = lib.DEFAULT_FIXTURE.away.name.toUpperCase()

  const joinedAt = performance.now()
  router.on('state', ({ next }) => setRouterState(next))
  router.on('provider', (peer) => providerSeen({ shortKey: peer.shortKey, connectMs: performance.now() - joinedAt, announce: peer.announce }))
  router.on('announce', ({ peer, announce }) => providerSeen({ shortKey: peer.shortKey, announce }))
  router.on('provider-gone', () => providerGone())
  commentary.on('segment-start', ({ event }) => segmentStart(event))
  commentary.on('token', tokenArrived)
  commentary.on('segment-end', (s) => segmentEnd(s))
  commentary.on('speech', () => toast('spoken via on-device Piper', '', 'audio'))

  await router.start()
  setModeBadge(role === 'client' ? `LIVE · P2P · ${matchId}` : 'LIVE · standalone', 'live')
  live = { lib, engine, router, commentary, speaker }

  const sim = new lib.MatchSimulator({ seed, speed, minutes: Number(params.get('minutes') || 90) })
  ;(async () => {
    for await (const event of sim) {
      await commentary.onEventSettled(event)
      if (event.type === 'full_time') break
    }
  })()
  return live
}

// ── REPLAY runtime ───────────────────────────────────────────────────────────
async function startReplay (reason) {
  let session
  try {
    const res = await fetch('./replay/session.json')
    session = await res.json()
  } catch {
    setModeBadge('NO RUNTIME — run `pear run .` or `npm run demo:web`', 'replay')
    toast(`live stack unavailable here (${reason?.message?.slice(0, 60) ?? 'browser'}) and no replay file found`, 'warn')
    return null
  }
  setModeBadge(`REPLAY of a real session · recorded ${session.recordedAt?.slice(0, 10) ?? ''}`, 'replay')
  setEngineChip({ kind: session.engine, modelId: session.model, fallback: false })
  $('team-home').textContent = (session.fixture?.home ?? 'ARGENTINA').toUpperCase()
  $('team-away').textContent = (session.fixture?.away ?? 'FRANCE').toUpperCase()
  toast('replaying a recorded REAL session — run `pear run .` for live', '', 'play')

  const t0 = performance.now()
  for (const ev of session.events) {
    const wait = ev.t - (performance.now() - t0)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    switch (ev.kind) {
      case 'state': setRouterState(ev.data.next); break
      case 'provider': providerSeen(ev.data); break
      case 'provider-gone': providerGone(); break
      case 'segment-start': segmentStart(ev.data.event); break
      case 'token': tokenArrived(ev.data); break
      case 'segment-end': segmentEnd(ev.data); break
      case 'failover': $('failover-state').textContent = `survived after ${ev.data.received} delegated tokens`; break
    }
  }
  toast('replay finished — reload to watch again')
  return null
}

// ── boot ─────────────────────────────────────────────────────────────────────
;(async () => {
  try {
    await startLive()
  } catch (err) {
    await startReplay(err)
  }
})()

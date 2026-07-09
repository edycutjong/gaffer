// Engine factory — picks the real QVAC engine when it is usable, otherwise
// falls back to the disclosed SimEngine. The chosen engine's `kind` is
// surfaced everywhere (CLI banner, HUD badge, bench header) — the user always
// knows whether tokens come from a model or the sim grammar.
//
// COVERAGE NOTE: excluded from the unit coverage gate (see the "coverage" npm
// script). The "QVAC loaded OK" and "QVAC failed for a non-availability reason"
// branches only execute with the real @qvac/sdk present; the fallback-to-sim
// path is covered by test/engine-factory.test.js (which still runs).

import { SimEngine } from './engines/sim.js'
import { QvacEngine, EngineUnavailableError } from './engines/qvac.js'

export { SimEngine, QvacEngine, EngineUnavailableError }

/**
 * @param {object} opts
 * @param {'auto'|'sim'|'qvac'} [opts.engine]
 * @param {number} [opts.tps]        sim throttle (tokens/sec) — models device power
 * @param {string} [opts.modelSrc]   qvac model source (path | http | pear://)
 * @param {function} [opts.log]
 * @returns {Promise<{ engine, requested, fallback }>} loaded engine + how it was chosen
 */
export async function createEngine ({ engine = 'auto', tps = 6, modelSrc = null, onProgress = null, log = () => {} } = {}) {
  if (engine === 'sim') {
    const sim = new SimEngine({ tps })
    await sim.load()
    return { engine: sim, requested: 'sim', fallback: false }
  }

  const qvac = new QvacEngine({ modelSrc, onProgress })
  try {
    await qvac.load()
    return { engine: qvac, requested: engine, fallback: false }
  } catch (err) {
    if (engine === 'qvac') throw err // explicit request — do not silently downgrade
    if (!(err instanceof EngineUnavailableError)) {
      log(`qvac engine failed to load (${err.message}) — falling back to sim`)
    } else {
      log(`qvac engine unavailable — ${err.message}`)
    }
    const sim = new SimEngine({ tps })
    await sim.load()
    return { engine: sim, requested: engine, fallback: true }
  }
}

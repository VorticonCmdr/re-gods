/* sweep-compare.js — the port's sound plays per tape cursor against the live
 * AdLib sweeps (sweep.py: every CS:0x22CA play with its cursor and caller).
 *
 * Each demo replays from its capture with the random table injected at the
 * sweep's own cursor and the cross-cycle seeds the SWEEP was taken with
 * (PJOYL3's sweep needs gravity 5, not its capture's 1: only then does the
 * random stream match). Plays only; stops are sound_sweep.py's job.
 *
 * Browser-only (dev server, ?debug — AdLib, the sweeps' driver):
 *   const m = await import('/tools/attract-capture/sweep-compare.js');
 *   await m.compareSweeps()                         // every id
 *   await m.compareSweeps({ ids: ['111', '232'] })  // only these
 */
import { loadCapture } from './diff.js';

const STATE_OF = { joyl1: 0, joyl2: 2, joyg2: 3, joyl3: 4 };
const SWEEPS = { joyl1: 'joyl1.sweep.json', joyl2: 'joyl2.sweep.json',
                 joyg2: 'joyg2.sweep.2-470.json', joyl3: 'joyl3.sweep.92-1500.json' };
const GRAVITY = { joyl3: 5 };
/* The world-2 jaw DS:0x2F0, which no fight initialises (guardian.js): the
 * value the PJOYG2 sweep's cycle carried in. */
const JAW = { joyg2: 2 };

export async function compareSweeps({ ids = null, demos = Object.keys(SWEEPS), show = 12, jaw = JAW } = {}) {
  const g = window.__gods;
  const keep = ids && new Set(ids);
  const out = {};
  for (const name of demos) {
    const sw = await (await fetch(`/tools/attract-capture/${SWEEPS[name]}?${Date.now()}`)).json();
    const hdr = sw[0], evs = sw.slice(1).filter((e) => e.k === 'sfx');
    const last = Math.max(...evs.map((e) => e.c));
    const want = new Map(), callers = {};
    for (const e of evs) {
      const id = parseInt(e.id, 16).toString(16);
      if (keep && !keep.has(id)) continue;
      want.set(e.c, (want.get(e.c) || []).concat(id));
      (callers[id] ||= new Set()).add(e.ret);
    }
    const dos = await loadCapture(name);
    g.resetProcessJaw(); g.setLandFlag357(1); g.setStarburstGravityPhase(GRAVITY[name] ?? 0);
    await g.startAttractAt(STATE_OF[name]); g.snap();
    const pend = dos.rnd.filter((e) => e.cursor <= hdr.inject).slice(-1);
    const inject = (c) => { while (pend.length && pend[0].cursor <= c) { const e = pend.shift(); g.setRandom(e.hex, e.r); } };
    inject(0);
    const got = new Map();
    let jawSet = jaw[name] === undefined;
    for (let i = 0; i < 5000; i++) {
      if (!jawSet && g.guardianRaw()) { g.guardianRaw().jaw = jaw[name]; jawSet = true; }
      const [s] = await g.stepTicks(1);
      if (!s.attract || s.attract.state !== STATE_OF[name]) break;
      const c = s.attract.cursor;
      if (c > last) break;
      if (c > hdr.inject) {
        for (const raw of (s.sfx || '').split(',')) {
          /* `id@cursor`: a shop pass's sound, under the cursor that pass read. */
          const [id, at] = raw.split('@');
          if (!id || id.startsWith('s') || (keep && !keep.has(id))) continue;
          const cc = at ? +at : c;
          got.set(cc, (got.get(cc) || []).concat(id));
        }
      }
      inject(c);
    }
    const diffs = [], count = { dos: {}, port: {} };
    for (let c = hdr.inject + 1; c <= last; c++) {
      const a = (want.get(c) || []).slice().sort(), b = (got.get(c) || []).slice().sort();
      for (const x of a) count.dos[x] = (count.dos[x] || 0) + 1;
      for (const x of b) count.port[x] = (count.port[x] || 0) + 1;
      if (a.join() !== b.join()) diffs.push(`${c}: dos[${a}] port[${b}]`);
    }
    const idsSeen = new Set([...Object.keys(count.dos), ...Object.keys(count.port)]);
    const counts = [...idsSeen].filter((i) => count.dos[i] !== count.port[i])
      .map((i) => `${i}${callers[i] ? `(${[...callers[i]].join('/')})` : ''} dos${count.dos[i] || 0}/port${count.port[i] || 0}`);
    out[name] = { plays: Object.values(count.dos).reduce((a, b) => a + b, 0), diffs: diffs.length,
                  countMismatch: counts, first: diffs.slice(0, show) };
  }
  return out;
}

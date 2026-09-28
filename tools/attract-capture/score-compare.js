/* score-compare.js — the port's BCD score through every attract demo against
 * score_cycle.py's live log (score_cycle.json): each demo replayed with the
 * cross-cycle seeds DOS carried into it and the capture's random table
 * injected at the same cursor, and every cursor where the score changes
 * compared.
 *
 * Browser-only (dev server, ?debug):
 *   const m = await import('/tools/attract-capture/score-compare.js');
 *   await m.compareScores()
 */
import { loadCapture } from './diff.js';

const STATE_OF = { joyl1: 0, joyg1: 1, joyl2: 2, joyg2: 3, joyl3: 4, joyg3: 5 };

export async function compareScores({ file = 'score_cycle.json', show = 6 } = {}) {
  const g = window.__gods;
  const live = await (await fetch(`/tools/attract-capture/${file}?${Date.now()}`)).json();
  const out = {};
  for (const [name, d] of Object.entries(live)) {
    const dos = await loadCapture(name);
    g.resetProcessJaw(); g.setLandFlag357(d.seeds.land); g.setStarburstGravityPhase(d.seeds.gravity);
    await g.startAttractAt(STATE_OF[name]); g.snap();
    const pend = dos.rnd.filter((e) => e.cursor <= d.inject).slice(-1);
    const inject = (c) => { while (pend.length && pend[0].cursor <= c) { const e = pend.shift(); g.setRandom(e.hex, e.r); } };
    inject(0);
    const last = Math.max(...d.rows.map((r) => +r.split(':')[0]));
    const rows = []; let prev = null, jawSet = false;
    for (let i = 0; i < 6000; i++) {
      if (!jawSet && g.guardianRaw && g.guardianRaw()) { g.guardianRaw().jaw = d.seeds.jaw; jawSet = true; }
      const [s] = await g.stepTicks(1);
      if (!s.attract || s.attract.state !== STATE_OF[name]) break;
      const c = s.attract.cursor;
      if (c > last) break;
      const v = g.deathState().score;
      if (v !== prev && c >= d.inject) { rows.push(`${c}:${v}`); prev = v; }
      inject(c);
    }
    /* The DOS log's first row is the score it found at the inject cursor. */
    const want = d.rows.slice(1), got = rows.filter((r) => want.length === 0 || +r.split(':')[0] > +d.rows[0].split(':')[0]);
    const bad = [];
    for (let i = 0; i < Math.max(want.length, got.length); i++) if (want[i] !== got[i]) bad.push(`dos ${want[i]} port ${got[i]}`);
    out[name] = { awards: want.length, diffs: bad.length, first: bad.slice(0, show), final: [d.rows.at(-1), rows.at(-1)] };
  }
  return out;
}

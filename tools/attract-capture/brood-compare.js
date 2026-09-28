/* brood-compare.js — the port's brood (game/nest.js Brood, DS:0x8014) against
 * brood_live.py's per-tick dump (NAME.brood.json): the demo replayed with the
 * seeds DOS carried and the same random injection, every slot's
 * {x, y, frame, strength, vx, vy, fall} compared per tape cursor. A DOS row
 * at cursor c is the port's state after its tick c.
 *
 * Browser-only (dev server, ?debug):
 *   const m = await import('/tools/attract-capture/brood-compare.js');
 *   await m.compareBrood('joyl2')
 */
import { loadCapture } from './diff.js';

const STATE_OF = { joyl1: 0, joyg1: 1, joyl2: 2, joyg2: 3, joyl3: 4, joyg3: 5 };

export async function compareBrood(name = 'joyl2', { show = 10 } = {}) {
  const g = window.__gods;
  const live = await (await fetch(`/tools/attract-capture/${name}.brood.json?${Date.now()}`)).json();
  const byC = new Map(live.rows.map((r) => [r.c, r]));
  const hi = Math.max(...live.rows.map((r) => r.c));
  const dos = await loadCapture(name);
  g.resetProcessJaw(); g.setLandFlag357(live.seeds.land); g.setStarburstGravityPhase(live.seeds.gravity);
  await g.startAttractAt(STATE_OF[name]); g.snap();
  const pend = dos.rnd.filter((e) => e.cursor <= live.inject).slice(-1);
  const inject = (c) => { while (pend.length && pend[0].cursor <= c) { const e = pend.shift(); g.setRandom(e.hex, e.r); } };
  inject(0);
  const diffs = [];
  let compared = 0;
  for (let i = 0; i < 6000; i++) {
    const [s] = await g.stepTicks(1);
    if (!s.attract || s.attract.state !== STATE_OF[name]) break;
    const c = s.attract.cursor;
    inject(c);
    if (c > hi) break;
    const d = byC.get(c);
    if (!d) continue;
    compared++;
    const port = g.brood().map((q, k) => [k, q.x, q.y, q.frame, q.strength, q.vx, q.vy, q.fallSubstate])
      .filter((q) => q[3] >= 0);
    const want = d.slots.map((q) => q.join()).join(' | '), got = port.map((q) => q.join()).join(' | ');
    if (want !== got) diffs.push(`${c}: dos [${want}] port [${got}]`);
  }
  return { compared, diffs: diffs.length, first: diffs.slice(0, show) };
}

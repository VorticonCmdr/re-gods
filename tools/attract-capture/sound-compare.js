/* sound-compare.js — sound_sweep.py's live PLAYs and STOPs per tape cursor,
 * against the port's snap().sfx (ids played; stops as `s<id>`).
 *
 * A stop logs only the low byte (AL: CS:0x14F9 `mov al,0x97`, CS:0x771A
 * `mov al,0xc5`); a play the whole id. The port is stepped the same way as
 * rol-compare.js (random table injected at the capture's cursor). Stops that
 * only one side makes are reported per id, so a missing or extra loop stop
 * shows which loop it belongs to.
 *
 * Browser-only (dev server, ?debug, plus &sound=roland when DOS ran ROL.EXE):
 *   const m = await import('/tools/attract-capture/sound-compare.js');
 *   await m.compareSound('joyl1')
 */
import { loadCapture } from './diff.js';

const STATE_OF = { joyl1: 0, joyg1: 1, joyl2: 2, joyg2: 3, joyl3: 4, joyg3: 5 };

export async function compareSound(name = 'joyl1', { seeds = { land: 1, gravity: 0 } } = {}) {
  const g = window.__gods;
  const live = await (await fetch(`/tools/attract-capture/${name}.sound.json?${Date.now()}`)).json();
  const dos = await loadCapture(name);
  const key = (e) => (e.k === 'stop' ? `s${(parseInt(e.id, 16) & 0xff).toString(16)}` : parseInt(e.id, 16).toString(16));
  const dosAt = new Map();
  for (const e of live.log) {
    if (!dosAt.has(e.c)) dosAt.set(e.c, []);
    dosAt.get(e.c).push(key(e));
  }
  g.resetProcessJaw(); g.setLandFlag357(seeds.land); g.setStarburstGravityPhase(seeds.gravity);
  await g.startAttractAt(STATE_OF[name]);
  g.snap();                                            // drain the sound trace
  const pend = dos.rnd.filter((e) => e.cursor <= live.inject).slice(-1);
  const inject = (c) => { while (pend.length && pend[0].cursor <= c) { const e = pend.shift(); g.setRandom(e.hex, e.r); } };
  inject(0);
  const portAt = new Map();
  for (let i = 0; i < 4000; i++) {
    const [s] = await g.stepTicks(1);
    if (!s.attract || s.attract.state !== STATE_OF[name]) break;
    const c = s.attract.cursor;
    if (c > live.end) break;
    if (c > live.inject && s.sfx) portAt.set(c, (portAt.get(c) || []).concat(s.sfx.split(',')));
    inject(c);
  }
  const sortj = (a) => (a || []).slice().sort().join(',');
  const diffs = [];
  const count = { dos: {}, port: {} };
  for (let c = live.inject + 1; c <= live.end; c++) {
    const a = dosAt.get(c), b = portAt.get(c);
    for (const x of a || []) count.dos[x] = (count.dos[x] || 0) + 1;
    for (const x of b || []) count.port[x] = (count.port[x] || 0) + 1;
    if (sortj(a) !== sortj(b)) diffs.push(`${c}: dos[${sortj(a)}] port[${sortj(b)}]`);
  }
  /* The diffs that involve a stop, whatever else that cursor plays. */
  const stopDiffs = diffs.filter((d) => {
    const [a, b] = d.split(': ')[1].split(' port').map((x) => (x.match(/s[0-9a-f]+/g) || []).join());
    return a !== b;
  });
  return { cursors: live.end - live.inject, diffs: diffs.length, first: diffs.slice(0, 12), stopDiffs, count };
}

/* rol-compare.js — the game's random stream under ROL.EXE, live against the
 * port (loaded with ?sound=roland) and against the AdLib capture.
 *
 * rol_trace.py logs every GAME random read (CS:0x3836) with its tape cursor.
 * Under ADL.EXE some sounds draw one too (adl-random.js); under ROL.EXE none
 * do, so the stream leaves the AdLib capture at the first such sound. This
 * counts the draws per cursor on each side and reports the first cursor where
 * they differ.
 *
 * Browser-only (dev server, ?debug&sound=roland):
 *   const m = await import('/tools/attract-capture/rol-compare.js');
 *   await m.compareRol('joyg1')
 */
import { loadCapture } from './diff.js';

const STATE_OF = { joyl1: 0, joyg1: 1, joyl2: 2, joyg2: 3, joyl3: 4, joyg3: 5 };

export async function compareRol(name = 'joyg1') {
  const g = window.__gods;
  const live = await (await fetch(`/tools/attract-capture/${name}.rol.json?${Date.now()}`)).json();
  const dos = await loadCapture(name);
  const dosDraws = new Map();
  for (const e of live.log) if (e.ev === 'rnd') dosDraws.set(e.c, (dosDraws.get(e.c) || 0) + 1);
  const last = Math.max(...live.log.map((e) => e.c));

  g.resetProcessJaw(); g.setLandFlag357(1); g.setStarburstGravityPhase(0);
  await g.startAttractAt(STATE_OF[name]);
  const pend = dos.rnd.filter((e) => e.cursor <= live.inject).slice(-1);
  const inject = (c) => { while (pend.length && pend[0].cursor <= c) { const e = pend.shift(); g.setRandom(e.hex, e.r); } };
  inject(0);
  let prev = g.snap().r;
  const portDraws = new Map();
  for (let i = 0; i < 4000; i++) {
    const [s] = await g.stepTicks(1);
    if (!s.attract || s.attract.state !== STATE_OF[name]) break;
    const c = s.attract.cursor;
    if (c > last) break;
    const n = ((s.r - prev) & 0x1ff) >> 1;
    if (n) portDraws.set(c, (portDraws.get(c) || 0) + n);
    prev = s.r;
    inject(c);
  }
  let firstPort = null;
  for (let c = live.inject + 1; c <= last && firstPort === null; c++) {
    if ((dosDraws.get(c) || 0) !== (portDraws.get(c) || 0)) firstPort = c;
  }
  /* The AdLib capture's DS:0x160 per cursor, as draws per cursor. */
  const adl = new Map();
  let pr = null;
  for (const d of dos) { if (d.r === undefined) continue; if (pr !== null && d.r !== pr) adl.set(d.cursor, ((d.r - pr) & 0x1ff) >> 1); pr = d.r; }
  let firstAdl = null;
  for (let c = live.inject + 2; c <= last && firstAdl === null; c++) {
    if ((dosDraws.get(c) || 0) !== (adl.get(c) || 0)) firstAdl = c;
  }
  const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  return { cursors: last - live.inject, dosDraws: total(dosDraws), portDraws: total(portDraws),
           firstPortDiff: firstPort, firstAdlDiff: firstAdl };
}

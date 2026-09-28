/* familiar-compare.js — replay familiar_live.py's injection in the port and
 * compare the familiar tick by tick.
 *
 * DOS summoned the familiar inside the CS:0x0215 call of the first tick
 * whose tape cursor was `at` (summon + C35E + the tick, in one call), and
 * logged it at CS:0x0218 after every tick. The port gets the summon's
 * inputs (energy, power 4, wings 0) before the tick that snapshots cursor
 * `at` + `shift`; frame.js then runs C308 + C35E + C08E in one tick. The
 * energy is the summon's 1000 unless the live run overwrote it at the first
 * CS:0x0218 (the capture's `energy`), which the port copies. Both sides
 * replay the capture's random table from `inject` (DOS writes it at the
 * poller of that cursor; the port's runPort-style inject does the same),
 * with the live run's cross-cycle bytes seeded.
 *
 * The capture's `events` are its CS:0xAB4D (a creature struck by the
 * familiar's tag drains BP) and CS:0xC440 (death) stops; the port's are
 * recorded by wrapping Familiar#hit, and compared per cursor.
 *
 * Browser-only (dev server, ?debug):
 *   const m = await import('/tools/attract-capture/familiar-compare.js');
 *   await m.compareFamiliar()
 *   await m.compareFamiliar({ file: 'familiar_hits.json' })
 */
import { loadCapture } from './diff.js';

const F = ['x', 'y', 'vx', 'vy', 'face', 'anim', 'spr', 'energy', 'r', 'hx', 'hy', 'alt', 'gate'];

export async function compareFamiliar({ shift = 0, name = 'joyl3', state = 4, file = 'familiar_live.json' } = {}) {
  const g = window.__gods;
  const live = await (await fetch(`/tools/attract-capture/${file}?${Date.now()}`)).json();
  /* familiar_live.py appends one row before it notices the cycler moved on:
   * drop everything from the first cursor that goes backwards. */
  const cut = live.rows.findIndex((r, k) => k > 0 && r.cur < live.rows[k - 1].cur);
  if (cut > 0) live.rows = live.rows.slice(0, cut);
  const dos = await loadCapture(name);
  g.resetProcessJaw();
  g.setLandFlag357(live.seeds.land);
  g.setStarburstGravityPhase(live.seeds.gravity);
  await g.startAttractAt(state);
  const pend = dos.rnd.filter((e) => e.cursor <= live.inject).slice(-1);
  const inject = (c) => { while (pend.length && pend[0].cursor <= c) { const e = pend.shift(); g.setRandom(e.hex, e.r); } };
  const rows = [], events = [];
  let summoned = false, cur = 0;
  for (let i = 0; i < 8000; i++) {
    cur = g.snap().attract?.cursor ?? 0;
    if (cur >= live.inject) inject(live.inject);
    if (!summoned && cur + 1 >= live.at + shift) {
      const fam = g.familiar();          // fresh: a level load replaces Health
      fam.health.familiarEnergy = live.energy ?? 1000; fam.health.familiarPower = 4; fam.health.familiarWings = 0;   // C347-C353
      const ent = fam.entity, hit = ent.hit.bind(ent);
      ent.hit = (bp, health, onDeath) => {
        const before = health.familiarEnergy;
        const died = hit(bp, health, onDeath);
        events.push({ at: '0xab4d', cur: cur + 1, energy: before, bp });
        if (died) events.push({ at: '0xc440', cur: cur + 1, energy: before - bp });
        return died;
      };
      summoned = true;
    }
    const [s] = await g.stepTicks(1);
    if (!s.attract || s.attract.state !== state) break;
    if (!summoned) continue;
    const fam = g.familiar(), e = fam.entity;
    rows.push({ cur: s.attract.cursor, x: e.x, y: e.y, vx: e.vx, vy: e.vy, face: e.facing, anim: e.anim,
                spr: e.draw ? e.draw.sprite : -1, energy: fam.health.familiarEnergy, r: s.r, hx: s.x, hy: s.y,
                alt: fam.arsenal.altSelect, gate: fam.gateOpen ? 0 : 0xff });
    if (s.attract.cursor > live.rows[live.rows.length - 1].cur) break;
  }
  const n = Math.min(rows.length, live.rows.length);
  let first = null;
  /* DOS reads at CS:0x0218, the port at the end of the tick: whatever can
   * change later in the tick (a random draw, the hero's move at 0x0254, a
   * hit's energy drain at 0xAB4D and the death it may cause, a pickup's slot
   * choice) shows in the port one row early, so those must equal DOS's at
   * this row or the next. The familiar's own motion only changes inside
   * C08E and is compared exactly — except x/y/sprite, which a death hides
   * (the port stops updating them; DOS keeps its last values), so after
   * a death only the hidden sprite is compared. */
  const LAG = ['hx', 'hy', 'energy', 'alt', 'gate', 'spr'];
  const dead = (k) => live.rows[k].energy < 0 && rows[k].energy < 0;
  const MOTION = ['x', 'y', 'vx', 'vy', 'face', 'anim'];
  const ok = (k, f) => rows[k][f] === live.rows[k][f] || (k + 1 < n && rows[k][f] === live.rows[k + 1][f]);
  /* The random cursor only moves forward: DOS's mid-tick value must lie
   * between the port's end of the previous tick and the end of this one. */
  const rOk = (k) => k === 0 || rows[k - 1].r > rows[k].r
    || (rows[k - 1].r <= live.rows[k].r && live.rows[k].r <= rows[k].r);
  for (let k = 0; k < n && first === null; k++) {
    for (const f of F) {
      if (dead(k) && MOTION.includes(f)) continue;
      if (f === 'r' ? !rOk(k) : LAG.includes(f) ? !ok(k, f) : rows[k][f] !== live.rows[k][f]) { first = k; break; }
    }
  }
  const show = (k) => k < n && `#${k} dos ${F.map((f) => `${f}=${live.rows[k][f]}`).join(' ')} cur=${live.rows[k].cur}\n` +
                               `    port ${F.map((f) => `${f}=${rows[k][f]}`).join(' ')} cur=${rows[k].cur}`;
  const evKey = (e) => `${e.at}@${e.cur} e${e.energy}${e.bp === undefined ? '' : ` bp${e.bp}`}`;
  /* Only events inside the compared rows count (the capture's own CS:0xC440
   * at the demo's end, and the random-read log, are not the familiar's). */
  const lastCur = rows.length ? rows[Math.min(rows.length, live.rows.length) - 1].cur : 0;
  const dosEv = (live.events || []).filter((e) => e.at !== 'rnd' && e.cur <= lastCur).map(evKey);
  const portEv = events.filter((e) => e.cur <= lastCur).map(evKey);
  return { compared: n, firstDiff: first, at: first === null ? null : [first - 1, first, first + 1].filter((k) => k >= 0).map(show).join('\n'),
           head: [0, 1, 2].map(show).join('\n'),
           events: { dos: dosEv, port: portEv, same: dosEv.join('|') === portEv.join('|') } };
}

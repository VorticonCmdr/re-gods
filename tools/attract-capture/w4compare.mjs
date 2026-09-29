/* w4compare.mjs — replay the live world-4 fight (w4live.py's logs) through
 * game/guardian4.js and report the first per-tick difference.
 *
 * Log record t is read at the START of main tick t (CS:0x0154), after t + 1
 * driver calls (the selector-11 tick's own call is call 1). Each port tick
 * runs the hook (unless the hero is dead: CS:0x01C4 jumps past it) and the
 * driver with that record's camera, hero and health, and is compared with
 * record t + 1. A respawn (lives drop) runs Guardian4#reset first, as
 * CS:0x0866 does before the CS:0x921B tick.
 *
 *   node tools/attract-capture/w4compare.mjs
 */
import { readFileSync } from 'fs';
import { dclDecompress } from '../../src/formats/dcl.js';
import { Guardian4 } from '../../src/game/guardian4.js';

const here = new URL('.', import.meta.url).pathname;
const game = new URL('../../game/', import.meta.url).pathname;
const log = [...JSON.parse(readFileSync(here + 'w4live.json')), ...JSON.parse(readFileSync(here + 'w4live2.json'))];
const rd = (f) => dclDecompress(new Uint8Array(readFileSync(game + f))).data;
const g = new Guardian4({ pat: rd('PGOD04.PAT'), bumlist: rd('PBUMLIST.BIN') });
const s16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;
const words = (hex) => { const b = Buffer.from(hex, 'hex'); const o = []; for (let i = 0; i < b.length; i += 2) o.push(b.readInt16LE(i)); return o; };
const PATH0 = 0xe3a;

function portState() {
  const b = g.boulder;
  const worm = g.recs.map((r) => r.expl
    ? { x: r.x, y: r.y, 4: r.vx, 6: r.vy, 8: r.frame, a: -1 }
    : { x: r.x, y: r.y, 4: r.wait, 6: PATH0 + r.p, a: PATH0 + g.path.steps.length });
  return { thr: g.thrower, boulder: [b.x, b.y, b.frame, b.hp], worm, cur: 0x4f20 + g.cursor,
           wormhp: g.wormHp, hp: g.hp, y250: g.baseY };
}
function dosState(r) {
  const w = words(r.worm);
  const worm = [];
  for (let k = 0; k < 8; k++) {
    const q = w.slice(k * 7, k * 7 + 7);
    const e = { x: q[0], y: q[1], 4: q[2], 6: q[3] & 0xffff, a: q[5] };
    if (q[5] === -1) { e[6] = q[3]; e[8] = q[4]; }
    else e.a = q[5] & 0xffff;
    worm.push(e);
  }
  return { thr: s16(r.thr), boulder: words(r.boulder), worm, cur: r.cur310, wormhp: r.wormhp === undefined ? undefined : s16(r.wormhp),
           hp: s16(r.hp), y250: r.y250 };
}

let draws = 0;
const health = { bar: 24, target: 24, damage(n) { this.target -= n; } };
g.drive({ cam: { x: log[0].cam[0], y: log[0].cam[1] }, hero: { x: 0, y: 0, state: 0 }, health: { bar: -1, target: 0, damage() {} },
          rng: () => { draws++; return 0; }, sfx: () => {}, zap: () => {}, invuln: false });   // call 1 (install tick)
const cs = { mode: 0, tx: 0, ty: 0 };
let bad = 0, compared = 0;
for (let t = 0; t + 1 < log.length && bad < 5; t++) {
  const r = log[t], nx = log[t + 1];
  /* The last death tick (counter 0x12) skips its driver call (CS:0x0A21
   * pop/jmp 0x930); the respawn then runs C624 (CS:0x0866) and CS:0x921B,
   * whose hook and driver are this tick's. */
  const respawn = nx.lives !== undefined && r.lives !== undefined && nx.lives < r.lives;
  if (respawn) g.reset();
  const [tgt, bar] = r.hh ? r.hh.map(s16) : [24, 24];
  health.target = tgt; health.bar = bar;
  const dead = bar <= 0 && !respawn;
  if (respawn) { health.target = 24; health.bar = 1; }             // CS:0x084B / 0x0851
  const o = { cam: { x: r.cam[0], y: r.cam[1] }, hero: { x: r.hero[0], y: r.hero[1], state: 0 }, health,
              rng: () => { draws++; return 0; }, sfx: () => {}, zap: () => {}, invuln: false, camScript: cs };
  if (!dead) g.hook(o);
  g.drive(o);
  const p = portState(), d = dosState(nx);
  if (nx.hh) p.health = health.target, d.health = s16(nx.hh[0]);
  const diffs = [];
  for (const k of ['thr', 'cur', 'wormhp', 'hp', 'y250']) if (d[k] !== undefined && p[k] !== d[k]) diffs.push(`${k} port ${p[k]} dos ${d[k]}`);
  if (nx.hh && !dead && p.health !== d.health) diffs.push(`health port ${p.health} dos ${d.health}`);
  if (d.boulder[2] < 0 ? p.boulder[2] >= 0 : p.boulder.join() !== d.boulder.join())   // a free record keeps stale fields
  diffs.push(`boulder port ${p.boulder} dos ${d.boulder}`);
  for (let k = 0; k < 8; k++) {
    const a = p.worm[k], b = d.worm[k];
    for (const f of ['x', 'y', 4, 6, 'a', 8]) if (f in a && a[f] !== b[f]) diffs.push(`rec${k}.${f} port ${a[f]} dos ${b[f]}`);
  }
  compared++;
  if (diffs.length) { bad++; console.log(`t=${t}->${t + 1} (call ${t + 2}):`, diffs.slice(0, 6).join('; ')); }
}
console.log(`compared ${compared} ticks, ${bad} with differences; port draws ${draws}`);

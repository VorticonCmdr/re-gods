/* w4wormcompare.mjs — replay a w4worm.py log (the hero kept alive, maybe
 * firing) through game/guardian4.js and report the first per-tick
 * difference, as w4compare.mjs does for w4live.py's logs.
 *
 * Record t is read at the START of main tick t (CS:0x0154); the script then
 * rewrote the health to 24/24, so that is the health the tick runs with.
 * For the worm's hits the port scans the damage grid DOS held at the
 * driver's entry (CS:0xC978), and a tag decodes to the damage DOS's own
 * CS:0x9320 returned for it that tick (DS:0x1EA at CS:0xAB45). A tag the
 * port decodes that DOS did not is reported as a difference.
 *
 *   node tools/attract-capture/w4wormcompare.mjs w4escape.json
 */
import { readFileSync } from 'fs';
import { dclDecompress } from '../../src/formats/dcl.js';
import { Guardian4 } from '../../src/game/guardian4.js';
import { DamageGrid } from '../../src/game/collision.js';
import { GodsRandom } from '../../src/game/random.js';

const here = new URL('.', import.meta.url).pathname;
const game = new URL('../../../Gods/', import.meta.url).pathname;
const log = JSON.parse(readFileSync(here + (process.argv[2] || 'w4escape.json')));
log.tagOk = process.argv.includes('--tags');
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
           wormhp: g.wormHp, hp: g.hp, y250: g.baseY, destroyed: g.destroyed ? 1 : 0 };
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
  return { thr: s16(r.thr), boulder: words(r.boulder), worm, cur: r.cur310, wormhp: s16(r.wormhp),
           hp: s16(r.hp), y250: r.y250, destroyed: r.destroyed ? 1 : 0 };
}

let draws = 0;
const table = log[0].table || null;
const gr = new GodsRandom(1);
if (table) { const tb = Buffer.from(table, 'hex'); for (let i = 0; i < 256; i++) gr.table[i] = tb.readUInt16LE(i * 2); }
g.drive({ cam: { x: log[0].cam[0], y: log[0].cam[1] }, hero: { x: 0, y: 0, state: 0 }, health: { bar: -1, target: 0, damage() {} },
          rng: () => { draws++; return 0; }, sfx: () => {}, zap: () => {}, invuln: false });   // the selector-11 tick's call
const cs = { mode: 0, tx: 0, ty: 0 };
let bad = 0, compared = 0, hits = 0, escapes = 0, wormKills = 0;
for (let t = 0; t + 1 < log.length && bad < 5; t++) {
  const r = log[t], nx = log[t + 1];
  const health = { bar: 24, target: 24, damage(n) { this.target -= n; } };
  const grid = new DamageGrid();
  if (r.grid) grid.buf.set(Buffer.from(r.grid, 'base64'));
  const pending = (r.decodes || []).slice();
  const extra = [];
  /* In order: the port's k-th decode this tick is DOS's k-th. Logs made
   * before the [SI] fix hold AL (the row counter) as `tag`, so only logs
   * with `tagOk` compare the tag itself. */
  const decodeTag = (tag) => {
    const d = pending.shift();
    if (!d) { extra.push(tag); return { damage: 0 }; }
    if (log.tagOk && d.tag !== (tag & 0xff)) extra.push(`${tag.toString(16)}!=${d.tag.toString(16)}`);
    hits++;
    return { damage: d.dmg };
  };
  /* Logs with the random table (w4worm.py since the rC978 fix) replay the
   * driver's own draws from DS:0x160 as it stood at CS:0xC978; the port's
   * cursor after the driver is then checked against the draws DOS made
   * before the next tick. Older logs draw 0. */
  let rng = () => { draws++; return 0; };
  if (table && r.rC978 !== undefined) {
    gr.cursor = r.rC978;
    rng = () => { draws++; return gr.next(); };
  }
  const o = { cam: { x: r.cam[0], y: r.cam[1] }, hero: { x: r.hero[0], y: r.hero[1], state: 0 }, health,
              rng, sfx: () => {}, zap: () => {}, invuln: false, camScript: cs,
              grid, decodeTag, difficulty: r.diff, debris: { spawn() {} } };   // a hit's spark draws twice (CS:0xABDE)
  const before = g.recs.map((q) => q.p);
  g.hook(o);
  g.drive(o);
  if (g.recs.every((q, k) => q.p === 0 && before[k] > 0) && g.wormHp === 750) escapes++;
  const p = portState(), d = dosState(nx);
  if (p.wormhp === 1000 && dosState(r).wormhp !== 1000) wormKills++;
  const diffs = [];
  for (const k of ['thr', 'cur', 'wormhp', 'hp', 'y250', 'destroyed']) if (d[k] !== undefined && p[k] !== d[k]) diffs.push(`${k} port ${p[k]} dos ${d[k]}`);
  if (d.boulder[2] < 0 ? p.boulder[2] >= 0 : p.boulder.join() !== d.boulder.join())
    diffs.push(`boulder port ${p.boulder} dos ${d.boulder}`);
  for (let k = 0; k < 8; k++) {
    const a = p.worm[k], b = d.worm[k];
    for (const f of ['x', 'y', 4, 6, 'a', 8]) if (f in a && a[f] !== b[f]) diffs.push(`rec${k}.${f} port ${a[f]} dos ${b[f]}`);
  }
  if (extra.length) diffs.push(`decode mismatch (port tag, or port!=dos): ${extra.map((x) => x.toString(16))}`);
  if (pending.length) diffs.push(`DOS decoded ${pending.length} more than the port`);
  compared++;
  if (diffs.length) { bad++; console.log(`t=${t}->${t + 1}:`, diffs.slice(0, 6).join('; ')); }
}
const decoded = log.reduce((n, r) => n + (r.decodes || []).length, 0);
const hpTrace = [...new Set(log.map((r) => s16(r.wormhp)))].join(',');
console.log(`compared ${compared} ticks, ${bad} with differences; DOS decodes ${decoded}, port hits ${hits}; ` +
            `worm hp values ${hpTrace}; escapes ${escapes}; worm kills ${wormKills}; guardian hp ${s16(log[0].hp)} -> ${s16(log[log.length - 1].hp)}`);

/* barrier-compare.mjs — replay barrier_live.py's live line barriers through
 * the port's LineBarriers + LoopSfx and compare them rescan by rescan.
 *
 * The live run teleported the hero onto barrier cells, so the game armed
 * them by its own probe; the port arms the same record for the same
 * selector. The probe runs in the player tick, AFTER that tick's rescan, so
 * a record is armed right after the rescan that precedes the first post
 * showing it. Each rescan gets the camera DOS had at its CS:0x01F2 / 0x09C7
 * stop (DS:0xA/0xC, which CS:0x7720 reads) and must give:
 *   - every armed slot (DS:0x1CA6 + 0x18*rec): +0/+2 displayed x/y, +5 the
 *     1-based point (0xFF settled), +8/+10 the walker's x/y, +14 the leg's
 *     major length, the error term (+18 for an x-major line, +16 for a
 *     y-major one: the loops keep it in CX / DX), +20 the remaining count;
 *   - DS:0x395 after the rescan;
 *   - the rescan's own sounds: play 0x08C5 (returns to CS:0x770A) and stop
 *     0xC5 (returns to CS:0x771F). Other sound calls are filtered out.
 * A rescan sound after a post is a rescan whose entry was not logged: the
 * death driver's CS:0x09C7 in the first capture (barrier_live.json), and in
 * both the respawn tick's own call, CS:0x9260 (FUN_1000_921B), which the
 * captures did not break on. It gets the last logged camera.
 *
 *   node tools/attract-capture/barrier-compare.mjs 2B barrier_live.json 9:7
 *   node tools/attract-capture/barrier-compare.mjs 2B barrier_live2.json 11:7 9:7
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dclDecompress } from '../../src/formats/dcl.js';
import { parseMap } from '../../src/formats/map.js';
import { palfilsNameFor } from '../../src/game/events.js';
import { LineBarriers, parseLineBarrierRecords } from '../../src/game/line-barriers.js';
import { LoopSfx } from '../../src/game/loop-sfx.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = (n) => new Uint8Array(readFileSync(join(resolve(here, '..', '..', 'game'), n)));
const [key = '2B', file = 'barrier_live.json', ...pairs] = process.argv.slice(2);
/* `rec:sel` arms at the first post showing the slot; `rec:sel:free` is a
 * type-0xFF dispatch, applied before the first post where an armed slot is
 * gone again. */
const arms = (pairs.length ? pairs : ['9:7']).map((p) => p.split(':')).map(([r, s, f]) => [+r, +s, f === 'free']);

const live = JSON.parse(readFileSync(join(here, file), 'utf8'));
const map = parseMap(dclDecompress(raw(`PLEV${key}.MAP`)).data);
const pd = dclDecompress(raw(palfilsNameFor(key))).data;
const lb = new LineBarriers(map, parseLineBarrierRecords(pd));
const sfx = new LoopSfx();

/* One entry per rescan: pre .. sounds .. post. */
const rescans = [];
let cur = null;
for (const e of live.log) {
  if (e.ev === 'pre') { cur = { pre: e, snd: [] }; rescans.push(cur); continue; }
  if (!cur) continue;
  if (e.ev === 'post') { cur.post = e; continue; }
  if (e.ret !== '0x770a' && e.ret !== '0x771f') continue;
  const id = e.ev === 'play' ? parseInt(e.id, 16).toString(16) : `s${(parseInt(e.id, 16) & 0xff).toString(16)}`;
  if (cur.post || cur.inferred) {                   // a rescan with no logged entry stop
    cur = { pre: { ...cur.pre, death: true }, snd: [], post: null, inferred: true };
    rescans.push(cur);
  }
  cur.snd.push(id);
}
/* Arm each record after the rescan before the first post that shows it. */
const armAt = new Map();
for (const [rec, sel, free] of arms) {
  const on = rescans.findIndex((t) => t.post && t.post.slots[rec]);
  const k = free ? rescans.findIndex((t, i) => i > on && t.post && !t.post.slots[rec]) : on;
  if (k < 1) { console.log(`record ${rec} never ${free ? 'freed' : 'armed'} live`); process.exit(1); }
  armAt.set(k - 1, (armAt.get(k - 1) || []).concat([[rec, sel]]));
}
const first = Math.min(...armAt.keys());

const word = (hex, o) => { const v = parseInt(hex.substr(o * 2 + 2, 2) + hex.substr(o * 2, 2), 16); return v & 0x8000 ? v - 0x10000 : v; };
const diffs = [];
let compared = 0, plays = 0, stops = 0, onScreen = 0;
for (let k = first; k < rescans.length; k++) {
  const t = rescans[k];
  const snd = [];
  const out = { roland: !!live.roland, play: (id) => snd.push(id.toString(16)), stop: (id) => snd.push(`s${id.toString(16)}`) };
  const r = lb.tick({ x: t.pre.camX, y: t.pre.camY });
  if (r) sfx.barrierTick(r.active, r.moved, out);
  if (t.post) {
    for (const rec of new Set(arms.map(([r]) => r))) {
      const s = lb.slots[rec], L = t.post.slots[rec];
      if (!s && !L) continue;
      if (!s || !L) { diffs.push({ k, c: t.pre.c, rec, f: 'armed', port: !!s, dos: !!L }); continue; }
      const w = s.walker;
      const got = { x: s.x, y: s.y, pt: s.settled ? 0xff : s.pointIdx + 1, wx: w.line.x, wy: w.line.y,
                    major: w.line.xMajor ? w.line.dx : w.line.dy, err: w.line.err, rem: w.rem };
      const want = { x: L.x, y: L.y, pt: L.d5, wx: word(L.raw, 8), wy: word(L.raw, 10), major: word(L.raw, 14),
                     err: word(L.raw, w.line.xMajor ? 18 : 16), rem: word(L.raw, 20) };
      for (const f of Object.keys(got)) if (got[f] !== want[f]) diffs.push({ k, c: t.pre.c, rec, f, port: got[f], dos: want[f] });
    }
    if (sfx.barrier !== t.post.b395) diffs.push({ k, c: t.pre.c, f: 'b395', port: sfx.barrier, dos: t.post.b395 });
    for (const [cr, v] of Object.entries(t.post.planeB || {})) {   // DS:0x5004 + row*0x80 + col
      const [col, row] = cr.split(',').map(Number);
      if (map.planeB[row * 128 + col] !== v) diffs.push({ k, c: t.pre.c, f: `planeB ${cr}`, port: map.planeB[row * 128 + col], dos: v });
    }
    if (t.post.b395) onScreen++;
    compared++;
  }
  for (const [rec, sel] of armAt.get(k) || []) lb.arm(rec, sel);   // the probe, later in the tick
  plays += t.snd.filter((x) => !x.startsWith('s')).length;
  stops += t.snd.filter((x) => x.startsWith('s')).length;
  const a = snd.join(','), b = t.snd.join(',');
  if (a !== b) diffs.push({ k, c: t.pre.c, f: 'sound', port: a, dos: b });
}
const xs = (rec) => rescans.filter((t) => t.post?.slots[rec]).map((t) => t.post.slots[rec].x);
console.log(JSON.stringify({ key, file, arms, roland: !!live.roland, rescans: rescans.length - first, compared,
  deathRescans: rescans.slice(first).filter((t) => t.pre.death).length,
  livePlays: plays, liveStops: stops, onScreenRescans: onScreen,
  range: Object.fromEntries(arms.map(([rec]) => [rec, [Math.min(...xs(rec)), Math.max(...xs(rec))]])),
  planeBCells: Object.keys(rescans.find((t) => t.post?.planeB)?.post.planeB || {}),
  diffs: diffs.length, first: diffs.slice(0, 10) }));

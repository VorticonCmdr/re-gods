/* syslive-check.mjs — read a syslive.py log and test ranked item 68's
 * [STATIC] reading of System A's leader/follower machinery against it.
 *
 *   node tools/attract-capture/syslive-check.mjs sys2b.json
 */
import { readFileSync } from 'node:fs';
/* DS:0xD96E, read from GAME.EXE (Ghidra 1ffd:d96e): the per-(N, rank) circle
 * angle, (N-2)*10 + (rank-2). */
const D96E = [0,0,0,0,0,0,0,0,0,0, 0,64,0,0,0,0,0,0,0,0, 0,42,85,0,0,0,0,0,0,0, 0,32,64,96,0,0,0,0,0,0, 0,26,51,77,102,0,0,0,0,0];

const log = JSON.parse(readFileSync(new URL('./' + process.argv[2], import.meta.url)));
const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const w = (b, o) => b[o] | (b[o + 1] << 8);
const sw = (b, o) => { const v = w(b, o); return v & 0x8000 ? v - 0x10000 : v; };
const sb = (b, o) => (b[o] & 0x80 ? b[o] - 0x100 : b[o]);
const tbl = Uint8Array.from(Buffer.from(log.d40b0, 'base64'));

function decode(g) {
  const rt = hex(g.rt), e = hex(g.ents);
  const ents = [];
  for (let i = 0; i < 10; i++) {
    const o = i * 0x28;
    ents.push({ i, x: sw(e, o), y: sw(e, o + 2), hp: sw(e, o + 8), rank: sb(e, o + 0x19),
                strat: sb(e, o + 0x24), gx: sw(e, o + 0x1c), gy: sw(e, o + 0x1e), cap: sw(e, o + 0x16) });
  }
  const ring = (c) => ({ x: sw(rt, 0x18 + c), y: sw(rt, 0x1a + c) });
  return { k: g.k, state: w(rt, 0), desc: w(rt, 2), latch: rt[0x10], pre: rt[0x11], count: sb(rt, 0x12),
           live: rt[0x13], mask: w(rt, 0x14), tenure: sw(rt, 0x16), e0: w(rt, 0xe0), e2: rt[0xe2], ents, ring };
}

const ticks = log.ticks.map((t) => ({ t: t.t, rnd: t.rnd, groups: t.groups.map(decode) }));
const out = { elections: [], joins: [], trailChecks: 0, trailOk: 0, formChecks: 0, formOk: 0, bad: [] };
let prev = new Map();
for (const tk of ticks) {
  for (const g of tk.groups) {
    const p = prev.get(g.k);
    const n = g.ents.filter((e, i) => i < 10 && (e.hp !== 0 || e.rank !== 0)).length;
    if (p && p.count === 0 && g.count === 1) {
      const leader = g.ents.find((e) => e.rank === 1);
      out.elections.push({ t: tk.t, k: g.k, leader: leader && leader.i, mask: g.mask, tenure: g.tenure, e0: g.e0 });
    }
    if (p && g.count > p.count && p.count >= 1) {
      out.joins.push({ t: tk.t, k: g.k, from: p.count, to: g.count, tenurePrev: p.tenure,
                       ok10: p.tenure >= 10 * p.count, mask: g.mask.toString(2) });
    }
    /* Strategy-4 goals: a follower whose goal was set this tick. Compare with
     * both cursor positions (leader before or after it this tick). */
    const formation = ((process.argv[3] ? parseInt(process.argv[3], 16) : log.b5) & 0xc0) !== 0;
    for (const e of g.ents) {
      if (e.strat !== 4 || e.rank < 2 || e.hp <= 0) continue;
      if (!formation) {
        const back = (e.rank - 1) * 16 - 8;
        const offs = [g.e0, p ? p.e0 : g.e0].map((c) => ((c - back) % 0x190 + 0x190) % 0x190);
        if (offs.every((c) => 0x18 + c + 4 > 0xe4)) { out.trailOverflow = (out.trailOverflow || 0) + 1; continue; }
        const cands = offs.map((c) => g.ring(c));
        out.trailChecks++;
        if (cands.some((c) => c.x === e.gx && c.y === e.gy)) out.trailOk++;
        else if (out.bad.length < 8) out.bad.push({ t: tk.t, k: g.k, e: e.i, rank: e.rank, goal: [e.gx, e.gy], cands });
      } else {
        /* CS:0xE828-0xE882: leader's latest ring point + DS:0x40B0 (plane A
         * from 0x10AC) LE words >> 10 (SAR). Try both e0/e2 timings. */
        /* Snapshot t is taken at the START of tick t, so this goal was set
         * during tick t-1: the leader (a lower index) had already written the
         * ring (e0 = this snapshot's), and CS:0xEB37 steps e2 only after the
         * member loop (e2 = the previous snapshot's). */
        const cand = [[g.e0, p ? p.e2 : g.e2]].map(([c, e2]) => {
          const ci = ((c - 4) % 0x190 + 0x190) % 0x190;
          if (0x18 + ci + 4 > 0xe4) return null;
          let a = (D96E[(g.count - 2) * 10 + e.rank - 2] + e2) & 0xff;
          if (a & 0x80) a -= 0x80;
          const dx = sw(tbl, a * 8) >> 10, dy = sw(tbl, a * 8 + 0x100) >> 10;
          const r = g.ring(ci);
          return { x: r.x + dx, y: r.y + dy };
        }).filter(Boolean);
        if (!cand.length) { out.formOverflow = (out.formOverflow || 0) + 1; continue; }
        out.formChecks++;
        if (cand.some((c) => c.x === e.gx && c.y === e.gy)) out.formOk++;
        else if (out.bad.length < 8) out.bad.push({ t: tk.t, k: g.k, e: e.i, rank: e.rank, n: g.count, e2: g.e2, goal: [e.gx, e.gy], cand });
      }
    }
  }
  prev = new Map(tk.groups.map((g) => [g.k, g]));
}
const last = ticks[ticks.length - 1];
out.summary = last && last.groups.map((g) => ({ k: g.k, state: g.state, count: g.count, mask: g.mask, tenure: g.tenure,
  e0: g.e0, e2: g.e2, pre: g.pre, ents: g.ents.filter((e) => e.hp || e.rank).map((e) => `${e.i}:hp${e.hp} r${e.rank} s${e.strat} @${e.x},${e.y} goal ${e.gx},${e.gy}`) }));
out.table40b0 = Array.from({ length: 8 }, (_, a) => [sw(tbl, a * 16 * 8), sw(tbl, a * 16 * 8 + 0x100)]);
console.log(JSON.stringify(out, null, 1));

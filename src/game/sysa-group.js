/* sysa-group.js — System A's group runtime: the leader, its followers, and the
 * trail they follow. Gods ranked item 68, [PROVEN] live (the reading below
 * held on every point tested — tools/attract-capture/syslive.py,
 * syslive-check.mjs, deathquirk.py, captures sys2b.json / sys4b.json).
 *
 * ── THE RUNTIME, SS:0x3768 + k*0xE4 (ten slots, zeroed by CS:0xDE6F) ─────
 *     +0x00 state   +0x02 descriptor   (kept in main.js's slotsA / groupsA)
 *     +0x10 reward latch (main.js)     +0x11 pre-selected member (0xFF: none)
 *     +0x12 count of ranked members    +0x14 mask of ranked member indexes
 *     +0x16 leader tenure (cap 100)    +0x18 the trail ring, 100 x {x, y}
 *     +0xE0 ring cursor (bytes)        +0xE2 formation rotation (mod 128)
 * ⚠️ The ring is 0x190 bytes from +0x18 but the runtime is 0xE4 bytes: at
 * cursor 0xC8 the leader writes its x/y over +0xE0/+0xE2 themselves (live,
 * 2B tick 56: e0 200 -> 317), and later entries land in slot k+1. So this
 * module keeps +0x10..+0xE3 of all ten slots in ONE byte buffer, and a slot's
 * fields are read back from it, so the overrun propagates as in DOS. Writes
 * that land on another slot's +0x00..+0x0F (state, descriptor — JS objects
 * here) or past slot 9 (SS:0x4050+, not modelled) are counted in `stray`.
 *
 * ── ELECTION, CS:0xEB37 (once per group, after its members, CS:0xDFB9) ───
 * With a leader it only steps +0xE2. Without one it ALWAYS draws; below the
 * descriptor's +0xA it picks [+0x11], else a uniform member from a second
 * draw (CS:0xEB5C-0xEB7D). A living pick becomes rank 1; count 1, mask its
 * bit, tenure and cursor 0. ⚠️ The uniform pick loops `cmp ax,bx / jc` on a
 * wrapping `add bx,si`: a draw of 0xFFFF never exits (DOS hangs), and
 * 0xFFFC-0xFFFE can wrap to a garbage index. `pickHangs`/`pickWraps` count
 * them; the port gives up the election for that tick instead (see ELECT_GUARD).
 *
 * ── JOINING, CS:0xE6F1-0xE745 (stage 1 with the strategy unset) ─────────
 * With a leader and this member's bit clear it draws; below
 * `(mask & 0xFF00) | weight` (signed, CS:0x3836 preserves CX) and with
 * tenure >= 10 * count, it takes rank ++count, its bit, and strategy 4.
 *
 * ── STRATEGY 4, CS:0xE7DB ────────────────────────────────────────────────
 * Floors +0x16 at 2. Descriptor +5 & 0xC0 clear: goal = the ring entry
 * (rank-1)*16 - 8 bytes behind the cursor. Set: goal = the leader's latest
 * entry plus a circle offset, which CS:0xE828 reads from DS:0x40B0 — plane A
 * from offset 0x10AC (a DS/SS mix-up; the intended table is SS:0x40B0), as
 * little-endian words >> 10, at angle DS:0xD96E[(count-2)*10 + rank-2] + e2.
 *
 * ── THE TRAIL, CS:0xE039 (after stage 6, rank 1 only) ────────────────────
 * tenure + 1 (cap 100); ring[cursor] = (x, y); cursor += 4, 0 at >= 0x190.
 *
 * ── DEATH, CS:0xE283-0xE2A9 (the first dying tick) ───────────────────────
 * Rank 1 -> CS:0xEBB9: count, mask 0; every member's rank, +0x25 and
 * strategy reset (tenure, cursor, rotation stay). Rank > 1 -> count - 1, and
 * clear bit RANK (`rol 0xFFFE, cl`, cl = rank) — not the member's own bit;
 * then CS:0xEBE5 lowers every higher rank still in the mask. [PROVEN] live.
 */

export const SLOTS = 10;
export const STRIDE = 0xe4;               // CS:0xDF66
export const RING = 0x18, RING_BYTES = 0x190;
export const TENURE_CAP = 0x64;           // CS:0xE042
export const TRAIL_STRATEGY = 4;          // CS:0xE741, DS:0xD95C[4] = 0xE7DB
export const FORMATION_TABLE_PLANE_A = 0x10ac;   // DS:0x40B0 - DS:0x3004
export const ELECT_GUARD = 64;            // loop bound standing in for DOS's unbounded one
/* DS:0xD940-0xD9CF from GAME.EXE (Ghidra 1ffd:d940); DS:0xD96E is at +0x2E.
 * Kept raw so an index the death quirk pushes outside its row reads what
 * DOS reads. */
const D940 = Uint8Array.from([
  255,255,254,255,253,255,252,255,252,255,251,255,250,255,250,255,2,0,1,0,0,0,1,0,2,0,21,0,
  123,231,218,233,140,232,54,235,219,231,84,248,41,247,148,247,0,248,0,0,0,0,0,0,0,0,0,0,0,64,
  0,0,0,0,0,0,0,0,0,42,85,0,0,0,0,0,0,0,0,32,64,96,0,0,0,0,0,0,0,26,51,77,102,0,0,0,0,0,0,21,43,
  64,85,107,0,0,0,0,0,18,37,55,73,91,110,0,0,0,0,16,32,48,64,80,96,112,0,0,0,13,26,38,51,64,77,
  90,102,0,110,0,60,0,210,0,136,0]);
const D96E_AT = 0x2e;

const s8 = (v) => ((v & 0xff) ^ 0x80) - 0x80;
const s16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;

export class GroupRuntimesA {
  constructor() {
    /* +0x00..+0xE3 of all ten slots, plus the ring's reach past slot 9. */
    this.bytes = new Uint8Array(SLOTS * STRIDE + RING + RING_BYTES);
    this.stray = 0;         // writes onto another slot's +0..+0xF, or past the buffer
    this.pickHangs = 0;     // CS:0xEB76 with a 0xFFFF draw: DOS never returns
    this.pickWraps = 0;     // CS:0xEB76 wrapped: DOS picks a garbage index
  }

  #w(k, off) {
    const a = k * STRIDE + off;
    const b = (i) => (i >= 0 && i < this.bytes.length ? this.bytes[i] : 0);   // past the model: 0
    return b(a) | (b(a + 1) << 8);
  }
  #put(k, off, v, width = 2) {
    for (let i = 0; i < width; i++) {
      const a = k * STRIDE + off + i;
      if (a < 0 || a >= this.bytes.length) { this.stray++; continue; }
      const rel = a % STRIDE;
      if (Math.floor(a / STRIDE) !== k && rel < 0x10) this.stray++;
      this.bytes[a] = (v >> (8 * i)) & 0xff;
    }
  }

  pre(k) { return this.bytes[k * STRIDE + 0x11]; }
  count(k) { return s8(this.bytes[k * STRIDE + 0x12]); }
  mask(k) { return this.#w(k, 0x14); }
  tenure(k) { return s16(this.#w(k, 0x16)); }
  cursor(k) { return s16(this.#w(k, 0xe0)); }
  rotation(k) { return this.bytes[k * STRIDE + 0xe2]; }
  ringAt(k, c) { return { x: s16(this.#w(k, RING + c)), y: s16(this.#w(k, RING + 2 + c)) }; }

  /** CS:0xDEED-0xDF2A, the materialise tail. `+0x16`/`+0xE0` are NOT reset
   *  (EB37 resets them at an election). Returns [+0x11]. */
  materialise(k, desc, draw) {
    this.#put(k, 0x10, 0, 1);
    let pre = 0xff;
    if (desc.flags & 0x100) {                          // CS:0xDEFA
      const idx = this.#pick(desc.count, draw);        // CS:0xDEFF-0xDF1C, the same loop
      pre = idx === null ? 0xff : idx & 0xff;
    }
    this.#put(k, 0x11, pre, 1);
    this.#put(k, 0x12, 0, 1);                          // CS:0xDF21
    this.#put(k, 0x14, 0);                             // CS:0xDF25
    this.#put(k, 0xe2, 0, 1);                          // CS:0xDF2A
    return pre;
  }

  /** CS:0xEB5C-0xEB7F / CS:0xDEFF-0xDF1E: a uniform index from one draw.
   *  null when DOS would spin forever or wrap (counted, see header). */
  #pick(n, draw) {
    const r = draw() & 0xffff;
    const step = Math.floor(0xffff / (n & 0xff || 1)) & 0xffff;
    let bx = step, dx = 0;
    for (let guard = 0; guard < ELECT_GUARD; guard++) {
      if (r < bx) return dx;                           // `jc`, unsigned
      bx = (bx + step) & 0xffff; dx++;
      if (bx < step) break;                            // wrapped
    }
    if (r === 0xffff) this.pickHangs++; else this.pickWraps++;
    return null;
  }

  /** CS:0xEB37. `members` in slot order; alive = state > 0. */
  elect(k, members, desc, draw) {
    if (this.count(k) !== 0) {                         // CS:0xEB3D
      this.#put(k, 0xe2, (this.rotation(k) + 1) & 0x7f, 1);
      return null;
    }
    const r = draw() & 0x7f;                           // CS:0xEB4A
    if (!(s8(r) < s8(desc.leadWeight || 0))) return null;   // CS:0xEB50 `jl`
    let idx = s8(this.pre(k));
    if (idx < 0) {
      idx = this.#pick(desc.count, draw);
      if (idx === null) return null;
    }
    const e = members[idx];
    if (!e || !(e.state > 0)) return null;             // CS:0xEB8E `jz`/`js`
    e.rank = 1;                                        // CS:0xEB96
    this.#put(k, 0x12, 1, 1);
    this.#put(k, 0x14, 1 << idx);
    this.#put(k, 0x16, 0);
    this.#put(k, 0xe0, 0);
    return idx;
  }

  /** CS:0xE6F1-0xE745. True when the member joined (strategy 4 now). */
  tryJoin(k, e, memberIndex, desc, draw) {
    const n = this.count(k);
    if (n === 0) return false;                         // CS:0xE6F5
    const bit = (1 << memberIndex) & 0xffff;
    if (this.mask(k) & bit) return false;              // CS:0xE705
    const r = draw() & 0x7f;                           // CS:0xE70A
    const cx = s16((this.mask(k) & 0xff00) | ((desc.leadWeight || 0) & 0xff));
    if (r >= cx) return false;                         // CS:0xE712 `jge`
    if (n * 10 > this.tenure(k)) return false;         // CS:0xE714-0xE725 `jg`
    const c = (n + 1) & 0xff;
    this.#put(k, 0x12, c, 1);                          // CS:0xE727
    e.rank = s8(c);                                    // CS:0xE72D
    this.#put(k, 0x14, this.mask(k) | bit);            // CS:0xE73E
    e.strategy = TRAIL_STRATEGY;                       // CS:0xE741
    return true;
  }

  /** CS:0xE7DB. `planeA` is the live map plane (DS:0x3004). */
  strategy4(k, e, desc, planeA) {
    if (e.stepCap < 2) e.stepCap = 2;                  // CS:0xE7DB-0xE7E1
    const cur = this.cursor(k);
    if ((desc.flags & 0xc0) === 0) {                   // CS:0xE813
      let c = s16(cur - s16(((e.rank - 1) << 4) - 8));
      if (c < 0) c += RING_BYTES;                      // CS:0xE7FF `jns`
      const p = this.ringAt(k, c);
      e.goalX = p.x; e.goalY = p.y;
      return;
    }
    const at = D96E_AT + (this.count(k) - 2) * 10 + (e.rank - 2);
    let al = ((at >= 0 && at < D940.length ? D940[at] : 0) + this.rotation(k)) & 0xff;
    if (al & 0x80) al -= 0x80;                         // CS:0xE84E-0xE850
    const base = FORMATION_TABLE_PLANE_A + al * 8;
    const word = (o) => (planeA ? s16(planeA[o] | (planeA[o + 1] << 8)) : 0);
    const dx = word(base) >> 10, dy = word(base + 0x100) >> 10;   // CS:0xE85B-0xE865 `sar`
    let c = cur - 4;
    if (c < 0) c += RING_BYTES;                        // CS:0xE86E `jns`
    const p = this.ringAt(k, c);
    e.goalX = s16(dx + p.x); e.goalY = s16(dy + p.y);
  }

  /** CS:0xE039-0xE06B, after stage 6, rank 1 only. */
  trail(k, e) {
    let t = this.tenure(k) + 1;
    if (t >= TENURE_CAP) t = TENURE_CAP;
    this.#put(k, 0x16, t);
    const c = this.cursor(k);
    this.#put(k, RING + c, e.x);
    this.#put(k, RING + 2 + c, e.y);
    let n = s16(this.cursor(k) + 4);                   // re-read: the write may have hit +0xE0
    if (n >= RING_BYTES) n = 0;                        // CS:0xE060 `jl`
    this.#put(k, 0xe0, n);
  }

  /** CS:0xE283-0xE2A9 with CS:0xEBB9 / CS:0xEBE5. */
  onDeath(k, e, members, desc) {
    if (e.rank === 0) return;
    if (e.rank === 1) {                                // CS:0xE28D -> EBB9
      this.#put(k, 0x12, 0, 1);
      this.#put(k, 0x14, 0);
      for (const m of members.slice(0, desc.count)) {
        m.rank = 0; m.arrivedFine = false; m.strategy = -1;
      }
      return;
    }
    this.#put(k, 0x12, this.count(k) - 1, 1);          // CS:0xE297
    const cl = e.rank & 0xff;
    const rol = ((0xfffe << (cl % 16)) | (0xfffe >>> (16 - (cl % 16)))) & 0xffff;
    this.#put(k, 0x14, this.mask(k) & rol);            // CS:0xE29F-0xE2A6
    if (this.count(k) <= 1) return;                    // CS:0xEBE5 `jle`
    let bits = this.mask(k);
    for (const m of members.slice(0, desc.count)) {    // CS:0xEBF9 `rcr`
      const set = bits & 1; bits >>= 1;
      if (set && e.rank < m.rank) { m.rank -= 1; m.arrivedFine = false; }
    }
  }
}

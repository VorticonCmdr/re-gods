/* line-barriers.js — selectors 7-10, PALFILS +0x189C, the "path job" /
 * line-barrier system. See `docs/triggers-and-difficulty.md`'s "`0x189C`,
 * selectors 7-10 — a second, independent line-barrier system" section (in
 * the Gods RE project this port is built from) for the full disassembly
 * trace and this port's own live-DOSBox proof, which the modelling choices
 * below are derived from.
 *
 * WHY THIS EXISTS: a live DOSBox capture of PLEV1A's opening screen showed a
 * platform tile the port was not drawing — plane A at that cell is 7 (plain
 * background brick) in the shipped `.MAP`, both on disk and read live out of
 * running memory, so it was never a tilemap bug. The graphic (and the solid
 * ground under it) come from this system instead.
 *
 * WHAT THIS PORT REPRODUCES:
 *   - A plane-B event value >=3 whose selector is 7/8/9/10 arms record
 *     [event.param] of this 25-record table (`CS:0x75FC` family), consuming
 *     the event exactly like every other selector (see events.js).
 *   - `FUN_1000_77d6`'s plane-B stamp: a `width x rows` block of cells,
 *     anchored at the displayed position, forced solid (skipped when the
 *     record's own bit 7 is set) — read live: plane B at the barrier cell is
 *     0 in the `.MAP` file and 1 in live memory.
 *   - `FUN_1000_7779`'s per-frame sprite draw over the same footprint.
 *
 * THE MOTION, read from `CS:0x75FC`-`0x7B2C` and [PROVEN] live on 2026-09-28
 * (tools/attract-capture/barrier_live.py + barrier-compare.mjs: PLEV2B
 * records 9 and 11, every slot byte, rescan by rescan):
 *   - The record's type byte for the dispatching selector picks the
 *     behaviour: 0 cycles forward, 1/6 backward, 2-5/7-10 settle, 0xFF
 *     disables. A settle type picks its POINT itself (`settlePoint`: type 2
 *     prefers point 0 and falls forward, type 7 point 0 falling backward,
 *     and so on, skipping points with x == 0) — not `targets[selector-7]`,
 *     which an earlier version of this file used; the two differ for 4 of
 *     the 58 plane-B-reachable settle dispatches (and pointed at (0,0) for
 *     some unreachable ones).
 *   - EVERY armed barrier walks a Bresenham line from its source (the
 *     record's srcX/srcY, or the displayed position when re-armed) at
 *     stepSeed+1 px per rescan. The walker is not the displayed position:
 *     it runs past the target by up to a budget, the display snaps to the
 *     target on the rescan that notices, and a cycler reseeds from where the
 *     walker is (see `tick`). A settle barrier stops there for good; 36 of
 *     the 58 reachable settle dispatches start away from their point, so
 *     they visibly slide in (an earlier version placed them instantly, from
 *     a live proof on a zero-length record, where the two look the same).
 *   - Cycle types 0/1/6 step the 1-based point index +1 / -1, wrapping
 *     1..4, past points with x == 0 (`findValidPoint`; the cascade tables
 *     `SS:0x35EE`/`0x35F8` themselves were not read, the observable
 *     ping-pong between the live points was, for record 9).
 *   - A FRESH arm zeroes DI+5 first (`CS:0x7665`, [PROVEN] live on PLEV1A
 *     record 2), so a forward cycler starts toward point 1, a backward one
 *     toward point 4.
 *   - Not modelled: the 0xFF type frees an armed slot (`CS:0x78DC`: DI+4 =
 *     0xFF, the rescan skips it, so it is no longer drawn). 15 plane-B-
 *     reachable dispatches do that to a record another cell arms (six
 *     records each in PLEV4A and PLEV4B); what becomes of the freed slot's
 *     plane-B stamp is not established, so the port leaves the barrier as
 *     it was (UNKNOWN_barrier_disable_free).
 *   - The exact sprite `FUN_1000_7779` draws. It goes through graphics
 *     export 1 (the same masked blit `selector2.js`'s turrets use),
 *     selected by the record's own `+0x16..+0x19` "obstacle type" byte —
 *     now fully decoded (see doc), but a specific atlas descriptor index
 *     for what it actually draws was never established. Guessing one with
 *     no evidentiary basis would risk looking
 *     WORSE than the gap it replaces, so this port instead borrows the
 *     level's OWN adjacent solid platform tile — the tile immediately
 *     touching the barrier's footprint whose plane B was ALREADY 1 before
 *     this system's own stamp — so the fill is always the correct texture
 *     FAMILY for that level, even where it doesn't reproduce GAME.EXE's own
 *     exact tile choice. See `#resolveTile`. For a CYCLING barrier this is
 *     now re-resolved every tick against its current footprint, so it keeps
 *     borrowing whatever it is currently passing, rather than staying
 *     pinned to whatever bordered its starting cell.
 */

import { MAP_COLS, MAP_ROWS } from '../formats/map.js';
import { newLine, stepLine } from './line-hazard.js';
import { barrierOnScreen } from './loop-sfx.js';

/**
 * Obstacle-"type" byte -> behaviour, `2f3d:35ec`'s 11-entry table
 * (`docs/triggers-and-difficulty.md`'s "The full +0x16..+0x19 type enum").
 * Only `kind`/`direction` matter here — the settle ring's own preferred-
 * point-per-type mapping is `arm()`'s pre-existing, live-proven
 * `targets[selector-7]` shape and is intentionally untouched.
 * The catch-all `'disabled'` default below is a defensive fallback, not
 * something read live — checks.js's own census of every (record, selector)
 * pair an event actually DISPATCHES (not every raw byte in the 800-slot
 * table, most of which is never read) across all 8 shipped PALFILS files
 * confirms the only values that ever occur are `-1, 0, 2, 3, 4, 5` — the
 * default never actually fires on shipped data.
 */
function classifyType(typeVal) {
  if (typeVal === 0) return { kind: 'cycle', direction: 1 };
  if (typeVal === 1 || typeVal === 6) return { kind: 'cycle', direction: -1 };
  if (typeVal >= 2 && typeVal <= 10) return { kind: 'settle' };
  return { kind: 'disabled' };   // 0xFF (-1), and anything else out of range
}

/** `FUN_1000_78E9`/`FUN_1000_790E`'s own `DI+5` bump: +1 or -1, wrapping the
 *  1-based point index into 1..4. Called with `0` for a fresh arm — `[PROVEN]`
 *  live this session (see the file header): `CS:0x7665` unconditionally
 *  zeroes the runtime slot's own `DI+5` on every arm, confirmed live at a
 *  genuine fresh arm (`PLEV1A` record 2), so `bVar1 = 0 +/- 1` is the real
 *  starting arithmetic, not an inference from an assumed-zeroed slot. */
function bump1Based(idx1, direction) {
  let n = idx1 + direction;
  if (n > 4) n = 1;
  if (n < 1) n = 4;
  return n;
}

/** The validating cascade `FUN_1000_78E9`/`0x790E` share with the settle
 *  rings (types 2-5/7-10): starting at `start1Based`, walk in `direction`
 *  order, skipping any point whose `x === 0`, and return the first valid
 *  one as a 0-based `targets` index. Returns -1 only if all 4 points are
 *  degenerate, which `arm()`'s own liveness gate (mirroring `CS:0x761B`)
 *  already rules out before this is ever called. */
function findValidPoint(targets, start1Based, direction) {
  let idx1 = start1Based;
  for (let i = 0; i < 4; i++) {
    if (targets[idx1 - 1].x !== 0) return idx1 - 1;
    idx1 = bump1Based(idx1, direction);
  }
  return -1;
}

/** `CS:0x7933`-`0x79F0`, the settle types' point choice: types 2-5 prefer
 *  point (type - 2) and fall FORWARD past any point whose x is 0 (2 -> 3 ->
 *  4 -> 5 -> 2), types 7-10 prefer point (type - 7) and fall BACKWARD (7 ->
 *  10 -> 9 -> 8 -> 7). Chosen by the TYPE byte, not by the selector. 0-based,
 *  or -1 if every point is degenerate (arm()'s liveness test rules that out). */
export function settlePoint(targets, type) {
  const forward = type >= 2 && type <= 5;
  let i = forward ? type - 2 : type - 7;
  for (let k = 0; k < 4; k++) {
    if (targets[i].x !== 0) return i;
    i = (i + (forward ? 1 : 3)) % 4;
  }
  return -1;
}

/** CS:0x77E0-0x77E9 — the cell a barrier's footprint is anchored at: the
 *  displayed position ROUNDED to the nearest cell, column (x + 16) >> 5 and
 *  row (y + 8) >> 4. The stamp uses it; this port also draws the tiles there
 *  (the original's draw, CS:0x7779, is pixel-positioned at x, y). */
export function anchorCell(s) {
  return { col0: (s.x + 16) >> 5, row0: (s.y + 8) >> 4 };
}

export const TABLE_OFF = 0x189c;        // -> DS:0xa8a4
export const RECORD_COUNT = 25;
export const RECORD_STRIDE = 0x1c;      // 28 bytes, sums to exactly 0x1B58 - 0x189C

/** selector 7/8/9/10 -> the record's own targets[0..3] / types[0..3]. */
export const SELECTOR_TO_SLOT = Object.freeze({ 7: 0, 8: 1, 9: 2, 10: 3 });
export const SELECTOR_PATH_MIN = 7;
export const SELECTOR_PATH_MAX = 10;

/** Parse the 25 records out of a decompressed PALFILS. */
export function parseLineBarrierRecords(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const records = [];
  for (let i = 0; i < RECORD_COUNT; i++) {
    const o = TABLE_OFF + i * RECORD_STRIDE;
    const targets = [0, 1, 2, 3].map((k) => ({
      x: dv.getUint16(o + 0x06 + k * 4, false),
      y: dv.getUint16(o + 0x06 + k * 4 + 2, false),
    }));
    const types = [0, 1, 2, 3].map((k) => dv.getInt8(o + 0x16 + k));
    const wh = dv.getUint8(o + 0x1a);
    records.push({
      index: i,
      srcX: dv.getUint16(o, false),
      srcY: dv.getUint16(o + 2, false),
      stepSeed: dv.getUint8(o + 5),          // n = stepSeed + 1, CS:0x765A -- cycling speed, px/tick
      targets, types,
      width: (wh & 7) + 1,                   // cells -- record's own +0x1a low 3 bits
      skipSolid: (wh & 0x80) !== 0,          // +0x1a bit 7
      rows: dv.getUint8(o + 0x1b) + 1,
      rawWh: wh, rawRows: dv.getUint8(o + 0x1b),   // as CS:0x7748 reads them
    });
  }
  return records;
}

export class LineBarriers {
  /**
   * @param {object} map parsed `.MAP` — `planeA`/`planeB` (live arrays,
   *   mutated in place, same convention as `makeActionContext`'s own
   *   door/trapdoor writers), `cols`/`rows`
   * @param {Array} records `parseLineBarrierRecords()` output
   */
  constructor(map, records) {
    this.map = map;
    this.records = records;
    /* Frozen BEFORE any barrier ever stamps plane B, so the tile-borrowing
     * heuristic below only ever matches genuine pre-existing level
     * geometry, never another barrier's own stamp. */
    this.originalPlaneB = map.planeB.slice();
    /* Runtime mirror, DS:0x1ca6 -- 25 slots, index == record index (both
     * live-tested records this session read back at exactly this offset).
     * null = free. */
    this.slots = new Array(RECORD_COUNT).fill(null);
    this.stampedCells = new Set();   // the cells stamped by the last rescan
    this.saved = [];                 // [cell, old value], the list at DS:0x1EFE
    this.unresolvedTile = 0;   // armed barriers whose footprint borrowed no neighbour tile
    /* DS:0x364, the arm count, and the rescan's own entry byte CS:0x767A
     * (RET until an arm writes NOP at CS:0x7635). The level init CS:0x8D11/
     * 0x8D17 resets both, silently. */
    this.count = 0;
    this.gate = false;
  }

  /**
   * `CS:0x760D-0x7679` — arm one record for the given selector (7..10).
   * Called from `EventRunner`'s `onPathJob` hook; the event is already
   * consumed by the caller before this runs, matching every other
   * selector's shape (`events.js`).
   *
   *   7648  source = the slot's DISPLAYED position if it is already armed
   *         (`[DI+4]` >= 0), else the record's own srcX/srcY
   *   765A  [0x1F0] = stepSeed + 1 (the step budget n) ; DI+5 = 0
   *   7669  the type handler (`CS:0x78C2` -> `2f3d:35ec`) picks the target
   *         point, sets DI+4 (0/1 cycle, 2 settle) and DI+5 (1-based point)
   *   7670  `CS:0x7A2A` seeds the line AND walks it with the budget at once
   *   7674  displayed = where the walk ended — no snap at arm time
   */
  arm(recordIndex, selector) {
    const rec = this.records[recordIndex];
    if (!rec) return;
    const slotIdx = SELECTOR_TO_SLOT[selector];
    if (slotIdx === undefined) return;
    /* CS:0x761B/0x7627 -- liveness is "any of the 4 target points has a
     * nonzero X", tested across all four, not just this selector's own --
     * an all-zero record is inert padding (this project's own census found
     * several, e.g. PLEV1A's own records 4-8). */
    if (!rec.targets.some((t) => t.x !== 0)) return;
    this.count++;                                     // CS:0x7631, every live arm
    this.gate = true;                                 // CS:0x7635

    /* CS:0x7669 -- dispatch through this SELECTOR's own type byte
     * (table25[+0x16+slotIdx]). CS:0x78DC (type 0xFF, "disabled") sets
     * DI+4 = 0xFF, which FREES an already-armed slot, and decrements the
     * count the arm just raised. The next rescan neither draws nor stamps a
     * freed slot, so the barrier vanishes and its cells go back to what they
     * held. [PROVEN] live (tools/attract-capture/barrier_live.py, PLEV3B
     * record 3 armed by event 38 and freed by event 70). */
    const type = rec.types[slotIdx];
    const behavior = classifyType(type);
    if (behavior.kind === 'disabled') {                // CS:0x78DC
      this.count--;                                    // CS:0x78E4
      this.slots[recordIndex] = null;                  // DI+4 = 0xFF
      return;
    }

    const prev = this.slots[recordIndex];
    const from = prev ? { x: prev.x, y: prev.y } : { x: rec.srcX, y: rec.srcY };   // CS:0x7648
    const pointIdx = behavior.kind === 'cycle'
      ? findValidPoint(rec.targets, bump1Based(0, behavior.direction), behavior.direction)
      : settlePoint(rec.targets, type);
    const state = {
      cycling: behavior.kind === 'cycle', direction: behavior.direction ?? 0,
      settled: false, pointIdx, rec, speed: rec.stepSeed + 1,
      x: from.x, y: from.y, walker: null,
      width: rec.width, rows: rec.rows, skipSolid: rec.skipSolid,
    };
    this.#seed(state, from.x, from.y, rec.targets[pointIdx]);
    state.x = state.walker.line.x; state.y = state.walker.line.y;   // CS:0x7674
    state.tileId = this.#resolveTile(state);
    if (state.tileId === null) this.unresolvedTile++;
    this.slots[recordIndex] = state;
    /* No stamp here: CS:0x77D6 runs only in the rescan, so plane B changes
     * at the next one. */
  }

  /** `CS:0x7A2A`: seed a leg from (x, y) toward `target` — the remaining
   *  count [0x1EE] starts at the leg's major length — and walk it with a
   *  fresh budget straight away (the seed falls into the step loop). */
  #seed(state, x, y, target) {
    const line = newLine(x, y, target.x, target.y);
    state.walker = { line, rem: line.xMajor ? line.dx : line.dy };
    this.#walk(state);
  }

  /** The step loop (`CS:0x7A4D`/`0x7A90`/`0x7AE8`/`0x7B2C`, resumed through
   *  `CS:0x7A0B`), with its budget [0x1F0] = stepSeed + 1:
   *      step ; if --budget == 0 { rem-- ; done }
   *      if --rem >= 0 loop ; rem-- ; done
   *  so the walk never stops AT the target: arriving leaves rem < 0 and the
   *  walker up to a budget's worth of steps past it. */
  #walk(state) {
    const w = state.walker;
    let budget = state.speed;
    for (;;) {
      stepLine(w.line, 1);
      if (--budget === 0) { w.rem--; return; }
      if (--w.rem >= 0) continue;
      w.rem--;
      return;
    }
  }

  /**
   * `CS:0x767B-0x76FF`, the per-frame rescan loop — `FUN_1000_7845` per
   * armed slot:
   *
   *   7852  DI+5 < 0 (settled): return
   *   785C  walk (above) ; displayed = the walker
   *   7869  rem >= 0: return
   *   7883  arrived: displayed = the target point DI+5 (the snap)
   *   788E  settle (DI+4 = 2): DI+5 = 0xFF, done for good
   *   78A5  cycle: the type handler bumps DI+5 to the next point, the
   *         budget is reloaded, and CS:0x7A2A reseeds from the WALKER's
   *         position (past the target) and walks at once — so on an
   *         arrival tick the barrier shows the target while the walker is
   *         already up to two budgets further on.
   *
   * [PROVEN] live (tools/attract-capture/barrier_live.py, PLEV2B record 9):
   * the slot bytes DS:0x1CA6+9*0x18 tick for tick. A SETTLE barrier walks
   * the same way until it arrives: only the zero-length ones appear at
   * their point at once.
   *
   * Placement in `main.js`'s per-tick order is `[PROVEN]` by disassembly
   * (`get_xrefs_to` on `CS:0x767A`, this system's own self-modifying gate --
   * see `frame.js`'s `LINE_BARRIERS_AT`): called from `FUN_1000_006F` at
   * `CS:0x01F2`, the death driver at `CS:0x09C7` and the respawn tick at
   * `CS:0x9260`, all unconditional, and
   * before every other system of the tick.
   *
   * @returns {?{active: boolean, moved: boolean}} null while CS:0x767A is
   *   RET (no arm since the level loaded: the rescan does nothing at all);
   *   `active` false on the one tick that finds DS:0x364 at 0 and puts the
   *   RET back (CS:0x767B-0x768D); `moved` = a slot whose displayed position
   *   changed is on screen (CS:0x76CE-0x76D7 -> 0x7720 -> DS:0x395,
   *   game/loop-sfx.js)
   */
  tick(cam = null) {
    if (!this.gate) return null;
    if (this.count === 0) { this.gate = false; return { active: false, moved: false }; }
    this.#restoreStamps();                              // CS:0x769B-0x76A2 -> 0x75C7
    let movedOnScreen = false;
    for (const state of this.slots) {
      if (!state) continue;                             // CS:0x76BB `js`: free
      if (state.settled) { this.#stamp(state); continue; }   // 7845 returns at once; 77D6 still stamps
      const x0 = state.x, y0 = state.y;
      this.#walk(state);
      const w = state.walker;
      state.x = w.line.x; state.y = w.line.y;
      if (w.rem < 0) {
        const t = state.rec.targets[state.pointIdx];
        state.x = t.x; state.y = t.y;
        if (!state.cycling) {
          state.settled = true;
        } else {
          const next1 = bump1Based(state.pointIdx + 1, state.direction);
          state.pointIdx = findValidPoint(state.rec.targets, next1, state.direction);
          this.#seed(state, w.line.x, w.line.y, state.rec.targets[state.pointIdx]);
        }
      }
      if (state.x !== x0 || state.y !== y0) {
        state.tileId = this.#resolveTile(state);
        if (cam && barrierOnScreen(state.x - cam.x, state.y - cam.y, state.rec.rawWh, state.rec.rawRows)) {
          movedOnScreen = true;                         // CS:0x76D7 -> 0x7720
        }
      }
      this.#stamp(state);                               // CS:0x76DF -> 0x77D6
    }
    return { active: true, moved: movedOnScreen };
  }

  /** DS:0x364 != 0 — some barrier has been armed since the level loaded. */
  get active() { return this.count !== 0; }

  /** See the file header -- borrow whichever pre-existing, already-solid
   *  neighbour tile touches this barrier's footprint. Checked in the order
   *  right/left/below/above at each footprint cell in turn (matching how
   *  every shipped 1-wide barrier in this project's census sits at the LEFT
   *  end of a platform run, so "right" resolves correctly first for the
   *  common case) until one is found. Returns null (nothing drawn, but the
   *  solid stamp below still applies) if no footprint cell borders one. */
  #resolveTile(state) {
    const { col0, row0 } = anchorCell(state);
    const probe = (c, r) => {
      if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) return null;
      const cell = r * MAP_COLS + c;
      const a = this.map.planeA[cell];
      if (a === 0 || this.originalPlaneB[cell] !== 1) return null;
      return a;
    };
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.width; c++) {
        const col = col0 + c, row = row0 + r;
        const found = probe(col + 1, row) ?? probe(col - 1, row)
                   ?? probe(col, row + 1) ?? probe(col, row - 1);
        if (found !== null) return found;
      }
    }
    return null;
  }

  /** `FUN_1000_77d6` — every rescan, for every armed slot (settled ones
   *  too) unless the record's +0x1A bit 7 is set: a `width x rows` block of
   *  plane-B cells anchored at the ROUNDED cell of the displayed position,
   *  column (x + 16) >> 5, row (y + 8) >> 4 (CS:0x77E0-0x77E9), each cell's
   *  old value saved to the list at [0x22C] (from DS:0x1EFE) and the cell
   *  set to 1. */
  #stamp(state) {
    if (state.skipSolid) return;                        // CS:0x77D6
    const { col0, row0 } = anchorCell(state);
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.width; c++) {
        const col = col0 + c, row = row0 + r;
        if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) continue;
        const cell = row * MAP_COLS + col;
        this.saved.push([cell, this.map.planeB[cell]]);   // CS:0x7820-0x7827
        this.map.planeB[cell] = 1;                        // CS:0x782C
        this.stampedCells.add(cell);
      }
    }
  }

  /** `CS:0x75C7`, at the top of every rescan: write each saved old value
   *  back, in the order saved, and empty the list. So a stamp lasts one
   *  rescan, a cell a barrier has left gets its own value back (live: an
   *  event cell, 19, in PLEV3B), and a freed slot's cells clear. */
  #restoreStamps() {
    for (const [cell, old] of this.saved) this.map.planeB[cell] = old;
    this.saved = [];
    this.stampedCells.clear();
  }

  /** Undo every stamp this system made and free every slot — level
   *  (re)load only. The original re-derives plane B from a pristine master
   *  copy on every level load; this port instead removes exactly what it
   *  added, which is equivalent for this array (nothing else in this port
   *  writes plane B outside a level's own trigger-action verbs, which run
   *  after this and are reset by the ordinary level-reload path anyway). */
  clear() {
    this.#restoreStamps();
    this.slots.fill(null);
    this.count = 0; this.gate = false;               // CS:0x8D11 / 0x8D17
  }

  get live() { return this.slots.reduce((n, s) => n + (s ? 1 : 0), 0); }

  /** `FUN_1000_7779` — every armed barrier's own footprint, in map cells.
   *  World/screen-independent; the caller applies the camera. Clipped to the
   *  128x64 map exactly like `#stamp`'s own solid-fill — a handful of
   *  shipped `rows`/`width` values on levels 4A/4B run one cell past the
   *  map's own last row (the world is exactly 1024px tall; a footprint
   *  anchored at row 63 with rows >= 2 reaches row 64, which does not
   *  exist), and `map.planeA`/`planeB` are plain fixed-length arrays, not
   *  bounds-safe against that the way a typed-array WRITE silently is. */
  *cells() {
    for (const s of this.slots) {
      if (!s || s.tileId === null) continue;
      const { col0, row0 } = anchorCell(s);   // the same cells #stamp makes solid
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.width; c++) {
          const col = col0 + c, row = row0 + r;
          if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) continue;
          yield { col, row, tileId: s.tileId };
        }
      }
    }
  }
}

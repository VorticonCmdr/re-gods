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
 * WHAT THIS PORT REPRODUCES, PROVEN LIVE THIS SESSION:
 *   - A plane-B event value >=3 whose selector is 7/8/9/10 arms record
 *     [event.param] of this 25-record table (`CS:0x75FC` family), consuming
 *     the event exactly like every other selector (see events.js).
 *   - The armed barrier settles at its OWN selector-indexed target point
 *     (`targets[selector-7]`) — read live from two independently-armed
 *     runtime slots (`PLEV1A` records 0 and 2, one of them predicted from
 *     the tables before it was read), both exactly matching their own
 *     literal target coordinates with zero drift, well after spawn (from a
 *     few dozen to tens of thousands of frames later).
 *   - `FUN_1000_77d6`'s plane-B stamp: a `width x rows` block of cells,
 *     anchored at the target point, forced solid (skipped when the record's
 *     own bit 7 is set) — read live: plane B at the barrier cell is 0 in the
 *     `.MAP` file and 1 in live memory.
 *   - `FUN_1000_7779`'s per-frame sprite draw over the same footprint — a
 *     masonry-textured block was observed at exactly that position, every
 *     frame, starting before the player could send any input.
 *
 * WHAT THIS PORT DOES **NOT** REPRODUCE, AND WHY (UPDATED — both
 * `UNKNOWN_189c_motion` and `UNKNOWN_189c_type_dispatch` are now CLOSED, see
 * the doc section):
 *   - Motion from source toward target IS type-dependent in the original,
 *     not uniform. The obstacle "type" byte (this record's own
 *     `+0x16..+0x19`, one per selector) resolves through `2f3d:35ec`'s
 *     11-entry table into one of three behaviours: types 2-5/7-10 (148 of
 *     183 shipped dispatches) pick ONE target point (with a fixed fallback
 *     search among the record's 4 points, skipping any with x==0) and
 *     SETTLE there forever — this port's "settle at target, hold" model is
 *     now proven correct for these, not just a safe guess. Types 0/1/6
 *     (7 of 183 dispatches, all type 0 in shipped data) instead CYCLE: on
 *     reaching one target point they immediately re-seed toward the next
 *     point in a fixed forward/backward order (wrapping through however
 *     many of the record's 4 points are non-degenerate), forever — a true
 *     patrol, never settling. Cross-checked against all 8 shipped levels'
 *     plane-B/ACT5 dispatch tables: **5 of the 7 shipped cyclers are
 *     genuinely reachable** — real 2-point ping-pong barriers, two each in
 *     PLEV2A/PLEV2B and one in PLEV1B (see the doc for exact cells) —
 *     while the other 2 (an elaborate 4-point patrol, one each in
 *     PLEV4A/PLEV4B) are placed in the static table but never wired to any
 *     reachable plane-B cell or `ACT5` arg in either file, so they are dead
 *     content, same shape as this project's other "authored but
 *     unreachable" findings. **This port still does not implement cycling
 *     — the 5 reachable ping-pong barriers in worlds 1B/2A/2B are a real,
 *     disclosed gap**, not merely an unverified-guess gap anymore: wiring
 *     it is new feature work (same shape as the `PGODSRLA-F.RL` Roland
 *     music gap), not a bug fix, so it's left for a deliberate decision
 *     rather than built here.
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
 *     exact tile choice. See `#resolveTile`.
 */

import { MAP_COLS, MAP_ROWS } from '../formats/map.js';

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
      stepSeed: dv.getUint8(o + 5),          // n = stepSeed + 1, CS:0x765A -- unused, see UNKNOWN_189c_motion
      targets, types,
      width: (wh & 7) + 1,                   // cells -- record's own +0x1a low 3 bits
      skipSolid: (wh & 0x80) !== 0,          // +0x1a bit 7
      rows: dv.getUint8(o + 0x1b) + 1,
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
    this.stampedCells = new Set();
    this.unresolvedTile = 0;   // armed barriers whose footprint borrowed no neighbour tile
  }

  /**
   * `CS:0x760D-0x7679` — arm one record for the given selector (7..10).
   * Called from `EventRunner`'s `onPathJob` hook; the event is already
   * consumed by the caller before this runs, matching every other
   * selector's shape (`events.js`).
   */
  arm(recordIndex, selector) {
    const rec = this.records[recordIndex];
    if (!rec) return;
    const slotIdx = SELECTOR_TO_SLOT[selector];
    if (slotIdx === undefined) return;
    const pt = rec.targets[slotIdx];
    /* CS:0x761B/0x7627 -- liveness is "any of the 4 target points has a
     * nonzero X", tested across all four, not just this selector's own --
     * an all-zero record is inert padding (this project's own census found
     * several, e.g. PLEV1A's own records 4-8). */
    if (!rec.targets.some((t) => t.x !== 0)) return;

    const state = {
      x: pt.x, y: pt.y,
      width: rec.width, rows: rec.rows, skipSolid: rec.skipSolid,
      tileId: null,
    };
    state.tileId = this.#resolveTile(state);
    if (state.tileId === null) this.unresolvedTile++;
    this.slots[recordIndex] = state;
    this.#stamp(state);
  }

  /** See the file header -- borrow whichever pre-existing, already-solid
   *  neighbour tile touches this barrier's footprint. Checked in the order
   *  right/left/below/above at each footprint cell in turn (matching how
   *  every shipped 1-wide barrier in this project's census sits at the LEFT
   *  end of a platform run, so "right" resolves correctly first for the
   *  common case) until one is found. Returns null (nothing drawn, but the
   *  solid stamp below still applies) if no footprint cell borders one. */
  #resolveTile(state) {
    const col0 = state.x >> 5, row0 = state.y >> 4;
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

  /** `FUN_1000_77d6` — stamp `width x rows` plane-B cells solid, anchored at
   *  the barrier's own `(x, y)`, unless the record's own skip bit is set. */
  #stamp(state) {
    if (state.skipSolid) return;
    const col0 = state.x >> 5, row0 = state.y >> 4;
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.width; c++) {
        const col = col0 + c, row = row0 + r;
        if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) continue;
        const cell = row * MAP_COLS + col;
        this.map.planeB[cell] = 1;
        this.stampedCells.add(cell);
      }
    }
  }

  /** Undo every stamp this system made and free every slot — level
   *  (re)load only. The original re-derives plane B from a pristine master
   *  copy on every level load; this port instead removes exactly what it
   *  added, which is equivalent for this array (nothing else in this port
   *  writes plane B outside a level's own trigger-action verbs, which run
   *  after this and are reset by the ordinary level-reload path anyway). */
  clear() {
    for (const cell of this.stampedCells) this.map.planeB[cell] = 0;
    this.stampedCells.clear();
    this.slots.fill(null);
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
      const col0 = s.x >> 5, row0 = s.y >> 4;
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

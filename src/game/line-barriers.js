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
 * THE MOTION MODEL — UPDATED THIS SESSION, cycling is now implemented (both
 * `UNKNOWN_189c_motion` and `UNKNOWN_189c_type_dispatch` were already CLOSED
 * in the doc; this just finishes wiring what that closure described):
 *   - Motion from source toward target IS type-dependent in the original,
 *     not uniform. The obstacle "type" byte (this record's own
 *     `+0x16..+0x19`, one per selector) resolves through `2f3d:35ec`'s
 *     11-entry table into one of three behaviours: types 2-5/7-10 (148 of
 *     183 shipped dispatches) pick ONE target point (with a fixed fallback
 *     search among the record's 4 points, skipping any with x==0) and
 *     SETTLE there forever — this port's pre-existing "settle at target,
 *     hold" model (proven correct live for these) is unchanged. Types 0/1/6
 *     (7 of 183 dispatches, all type 0 in shipped data) instead CYCLE: on
 *     reaching one target point they immediately re-seed toward the next
 *     point in a fixed forward/backward order (wrapping through however
 *     many of the record's 4 points are non-degenerate), forever — a true
 *     patrol, never settling. **Now implemented** (`#armCycle`/`tick`):
 *     the record travels the real Bresenham line from its own source point,
 *     at `stepSeed+1` pixels/tick (`CS:0x765A`'s `n`, parsed but unused
 *     until now), snapping exactly onto each target on arrival (matching
 *     `FUN_1000_7845`'s own literal-coordinate snap, which overrides any
 *     Bresenham rounding drift) before re-seeding toward the next point.
 *     The next point is chosen by bumping the 1-based point index +1
 *     (forward, type 0) or -1 (backward, types 1/6), wrapping 1..4, then
 *     searching in that same direction past any point whose `x==0` —
 *     `findValidPoint` below, matching `FUN_1000_78E9`/`0x790E`'s own
 *     `SS:0x35EE`/`0x35F8`-indexed cascade (the exact cascade table
 *     contents were not disassembled; the OBSERVABLE behaviour — "ping-pong
 *     between only the non-degenerate points, never detour through (0,0)"
 *     — is what's modelled, cross-checked against all 5 real shipped
 *     cyclers below). Cross-checked against all 8 shipped levels'
 *     plane-B/ACT5 dispatch tables: **5 of the 7 shipped cyclers are
 *     genuinely reachable** — real 2-point ping-pong barriers, two each in
 *     PLEV2A/PLEV2B and one in PLEV1B (see the doc for exact cells) —
 *     while the other 2 (an elaborate 4-point patrol, one each in
 *     PLEV4A/PLEV4B) are placed in the static table but never wired to any
 *     reachable plane-B cell or `ACT5` arg in either file, so they are dead
 *     content, same shape as this project's other "authored but
 *     unreachable" findings; this port's cycling code path handles them
 *     correctly too (nothing here is 2-point-specific) but they cannot be
 *     reached by any shipped trigger.
 *     The `DI+5`/1-based-index starting value on a FRESH arm is now CLOSED,
 *     `[PROVEN]` live this session: the arm dispatcher itself (`CS:0x7665`,
 *     `MOV byte[DI+5],0`) unconditionally zeroes it right before dispatching
 *     through the type trampoline, for EVERY arm regardless of type (settle
 *     or cycle) — confirmed both by direct disassembly of `CS:0x75FC..0x7679`
 *     (an unconditional immediate-operand write, not data-dependent) and by
 *     a live DOSBox breakpoint at `CS:0x7669` catching a genuine fresh arm
 *     (`PLEV1A` record 2's runtime slot, `DS:0x1cd6`: `x=y=0xFFFF`, `DI+4=
 *     0xFF` — the true "never-armed" sentinel state — immediately followed
 *     by `DI+5` reading `0x00`). `FUN_1000_78E9`/`0x790E`'s own bump
 *     arithmetic (`0+1=1` forward, `0-1` wraps to `4` backward, both directly
 *     disassembled, pure register ops with no other dependency) then makes
 *     `bump1Based(0, direction)` below the PROVEN starting point, not an
 *     inference — matching `arm()`'s own `bump1Based(0, direction)` call
 *     exactly.
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
    /* CS:0x761B/0x7627 -- liveness is "any of the 4 target points has a
     * nonzero X", tested across all four, not just this selector's own --
     * an all-zero record is inert padding (this project's own census found
     * several, e.g. PLEV1A's own records 4-8). */
    if (!rec.targets.some((t) => t.x !== 0)) return;

    /* CS:0x7669 -- dispatch through this SELECTOR's own type byte
     * (table25[+0x16+slotIdx]). CS:0x78DC (type 0xFF, "disabled") consumes
     * the event but never actually creates a runtime slot -- FUN_1000_78DC
     * decrements the active-obstacle counter the arm dispatcher had just
     * incremented, undoing the arm outright. */
    const behavior = classifyType(rec.types[slotIdx]);
    if (behavior.kind === 'disabled') return;

    const state = behavior.kind === 'cycle'
      ? this.#armCycle(rec, behavior.direction)
      : this.#armSettle(rec, rec.targets[slotIdx]);

    state.width = rec.width; state.rows = rec.rows; state.skipSolid = rec.skipSolid;
    state.tileId = this.#resolveTile(state);
    if (state.tileId === null) this.unresolvedTile++;
    this.slots[recordIndex] = state;
    this.#restamp(state);
  }

  /** The pre-existing settle model -- snap straight to the selector's own
   *  target point and hold there forever. Unchanged (still the live-proven
   *  `targets[selector-7]` shape, not the type ring's own preferred-point
   *  mapping -- see the file header). */
  #armSettle(rec, pt) {
    return { cycling: false, x: pt.x, y: pt.y };
  }

  /** `FUN_1000_78E9`/`0x790E`, the type-0/1/6 arm path: pick the first
   *  non-degenerate point in `direction` order starting from a fresh (zeroed)
   *  1-based point index, and start walking the real Bresenham line toward
   *  it from the record's own source point -- see the file header for the
   *  `bump1Based(0, direction)` reasoning. */
  #armCycle(rec, direction) {
    const start1 = bump1Based(0, direction);
    const pointIdx = findValidPoint(rec.targets, start1, direction);
    const target = rec.targets[pointIdx];
    const state = {
      cycling: true, direction, pointIdx, rec,
      x: rec.srcX, y: rec.srcY,
      speed: rec.stepSeed + 1,
    };
    this.#seedLeg(state, target);
    return state;
  }

  /** Start (or restart, on arrival) one Bresenham leg from the barrier's
   *  CURRENT position toward `target` -- `CALL 0x7A2A`. */
  #seedLeg(state, target) {
    state.line = newLine(state.x, state.y, target.x, target.y);
    state.majorRemaining = state.line.xMajor ? state.line.dx : state.line.dy;
  }

  /**
   * `CS:0x767B-0x76FF`, the per-frame rescan loop (`FUN_1000_7845` per slot)
   * -- advance every cycling barrier one tick. Settle barriers never move
   * once armed and are untouched here, matching the original: `DI+4>1`
   * (settle/disabled) returns immediately at `FUN_1000_7845`'s own top.
   *
   * Placement in `main.js`'s per-tick order is now `[PROVEN]` by disassembly
   * (`get_xrefs_to` on `CS:0x767A`, this system's own self-modifying gate --
   * see `frame.js`'s `LINE_BARRIERS_AT`): called from exactly two places,
   * `FUN_1000_006F` at `CS:0x01F2` and the death driver `FUN_1000_09BB` at
   * `CS:0x09C7`, BOTH unconditional -- so this must run every tick whether
   * or not the hero is mid-death, and within the ordinary tick it is one of
   * the EARLIEST systems, called before pickup/projectiles/starburst/the
   * player state machine/selector-2/System-B entities/enemy shots/the
   * line-hazard pool/the health-bar chase. This corrects an earlier pass
   * that shipped `tick()`'s own call site near the END of `main.js`'s tick
   * instead, grouped with `lineHazards.step()` and disclosed only as
   * unproven -- the real site was one `get_xrefs_to` away, and that
   * placement was backwards, not merely unpinned. See `main.js`'s own call
   * site for the one small, disclosed residual (`grid.clear()`/
   * `blocks.step()` run after this call in the port, before it in the
   * original -- semantically inert, since this system touches neither).
   */
  tick(cam = null) {
    let movedOnScreen = false;
    for (const state of this.slots) {
      if (!state || !state.cycling) continue;
      const x0 = state.x, y0 = state.y;
      const steps = Math.min(state.speed, state.majorRemaining);
      stepLine(state.line, steps);
      state.majorRemaining -= steps;
      if (state.majorRemaining <= 0) {
        /* `FUN_1000_7845`'s own literal-coordinate snap -- overrides any
         * Bresenham rounding drift, so the barrier is always EXACTLY on a
         * target point at the moment it arrives, never one pixel off. */
        const arrived = state.rec.targets[state.pointIdx];
        state.x = arrived.x; state.y = arrived.y;
        const next1 = bump1Based(state.pointIdx + 1, state.direction);
        state.pointIdx = findValidPoint(state.rec.targets, next1, state.direction);
        this.#seedLeg(state, state.rec.targets[state.pointIdx]);
      } else {
        state.x = state.line.x; state.y = state.line.y;
      }
      state.tileId = this.#resolveTile(state);
      this.#restamp(state);
      /* CS:0x76CE-0x76D7: a slot whose position changed calls 0x7720, which
       * raises DS:0x395 if it is on screen (game/loop-sfx.js). */
      if (cam && (state.x !== x0 || state.y !== y0)
          && barrierOnScreen(state.x - cam.x, state.y - cam.y, state.rec.rawWh, state.rec.rawRows)) {
        movedOnScreen = true;
      }
    }
    return movedOnScreen;
  }

  /** DS:0x364 != 0 — some barrier is armed (the rescan gate is open). */
  get active() { return this.slots.some((s) => s !== null); }

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

  /** `width x rows` map cells anchored at the barrier's current `(x, y)`. */
  #footprintCells(state) {
    const col0 = state.x >> 5, row0 = state.y >> 4;
    const cells = [];
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.width; c++) {
        const col = col0 + c, row = row0 + r;
        if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) continue;
        cells.push(row * MAP_COLS + col);
      }
    }
    return cells;
  }

  /** `FUN_1000_77d6` — stamp `width x rows` plane-B cells solid, anchored at
   *  the barrier's own current `(x, y)`, unless the record's own skip bit is
   *  set. For a settle barrier this runs once, at arm time, and the
   *  footprint never changes again. For a CYCLING barrier `tick()` calls
   *  this every frame, so any cell the footprint just vacated is released
   *  first (back to 0, unless some OTHER live slot's own footprint still
   *  covers it — checked so two barriers can never un-solid each other's
   *  shared ground) before the new footprint is stamped. */
  #restamp(state) {
    const next = state.skipSolid ? [] : this.#footprintCells(state);
    const nextSet = new Set(next);
    const prev = state.footprint;
    if (prev) {
      for (const cell of prev) {
        if (nextSet.has(cell)) continue;
        this.stampedCells.delete(cell);
        const stillHeld = this.slots.some((s) => s && s !== state && s.footprint && s.footprint.has(cell));
        if (!stillHeld) this.map.planeB[cell] = 0;
      }
    }
    for (const cell of next) {
      this.map.planeB[cell] = 1;
      this.stampedCells.add(cell);
    }
    state.footprint = nextSet;
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
   *  128x64 map exactly like `#restamp`'s own solid-fill — a handful of
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

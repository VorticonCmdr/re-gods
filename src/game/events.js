/* events.js — the plane-B event chain.
 *
 * ⚠️ THE DISPATCH IS 1-BASED, AND THIS PORT HAD IT WRONG.
 *   An earlier revision used SELECTOR_TRIGGER = 2, from a project note that
 *   said "SS:0x3570 entry [2] is 0x39ae". The note was right about the ENTRY;
 *   what was wrong was assuming selector value 2 reaches it. CS:0x603A does a
 *   `dec ax` before the shift, so
 *
 *       handler = table[selector - 1]
 *
 *   and the trigger evaluator is SELECTOR 3, not 2. Getting this wrong makes
 *   selector 4 (a System-B entity-group spawn) look like the trigger
 *   evaluator, and made PLEV3A appear to fire no triggers at all when in fact
 *   it dispatches 82 of them.
 *
 * PROVENANCE — the dispatch chain, end to end:
 *   1. A plane-B cell value v >= 3 is an EVENT ID. GAME.EXE's per-frame
 *      plane-B scan (0x5fd7-0x601e) calls 0x6022 only when byte > 2.
 *   2. CS:0x6022 (file 0x61B2), read verbatim:
 *        6022  push si
 *        6025  mov al,[si] / 6027 sub al,3      ; -> event record index
 *        6029  mov si,0x932c
 *        602C  shl ax,1 (x2) / add si,ax        ; 4-byte records
 *        6032  mov ax,[si]                      ; selector
 *        6034  or ax,ax / js 0x6047 / jz 0x6047 ; consumed / empty -> skip
 *        603A  DEC AX                           ; <-- the 1-based bias
 *        603B  shl ax,1 / mov di,0x3570 / add di,ax
 *        6042  mov ax,[ss:di] / call ax         ; NO upper-bound check
 *   3. DS:0x932c is a 253-entry table of 4-byte {u16 selector, u16 param},
 *      loaded from PALFILS +0x0324.
 *
 * THE TABLE IS 11 ENTRIES. The immediate 0x3570 occurs exactly once in the
 * whole file (at CS:0x603D); the words at index 11+ belong to a different
 * table at SS:0x3586 whose sole consumer is CS:0xAE7C. The shipped data
 * agrees: the maximum selector across all 2024 records is exactly 11, which
 * under a 0-based reading would dispatch into that foreign table.
 *
 * SHIPPED CENSUS, re-derived here from the 8 PALFILS files (2024 records):
 *   selector : 0=281 1=137 2=406 3=727 4=217 5=57 6=8 7=80 8=74 9=26 10=3 11=8
 *   and the maximum param per selector lands exactly where the table predicts:
 *   sel 1,2,3 -> 99 (three different 100-entry tables), sel 4 -> 49 (a
 *   50-record window), sel 7..10 -> 23,23,13,1 (a 25-record window).
 *   Selector 0 is an EMPTY SLOT, dropped by the `jz` guard — not an error.
 *
 * ENDIANNESS: on disk the records are big-endian; the original packs them to
 * one byte per field (CS:0x386E, `lodsw / xchg al,ah / stosb`) and unpacks to
 * native words (CS:0x3880). No shipped field exceeds 255, so reading the
 * big-endian u16 directly — as this module does — is exactly equivalent.
 * Verified: 0 of 2024 records need more than a byte per field.
 */

import { parseAllTriggers, evalTrigger, verbOf, isLive } from './trigger.js';
import { fireTrigger } from './trigger-actions.js';
import { SELECTOR_SPAWN_B, SELECTOR_SPAWN_A, SELECTOR_SPAWN_2, SELECTOR_SPAWN_1 } from './spawn.js';
import { SELECTOR_PATH_MIN, SELECTOR_PATH_MAX } from './line-barriers.js';

/** ACT5 chain limit — a port-only guard; see dispatchEvent(). */
export const ACT5_MAX_DEPTH = 16;

export const EVENT_TABLE_OFF = 0x0324;   // within PALFILS, -> DS:0x932c
export const EVENT_COUNT     = 253;
export const LEVER_TABLE_OFF = 0x15f0;   // -> DS:0xa5f8
export const LEVER_COUNT     = 64;

/* The SS:0x3570 jump table, verbatim, with what each handler does. Selector
 * value v selects SELECTOR_TABLE[v - 1]. Only the trigger evaluator is
 * implemented here; the rest are named so unhandled dispatches are reported
 * as something specific rather than counted as an anonymous number. */
export const SELECTOR_TABLE = [
  { sel: 1,  handler: 0xb908, name: 'spawn from PALFILS +0x0000 (DS:0x9008)' },
  { sel: 2,  handler: 0xad06, name: 'spawn from PALFILS +0x0718 (DS:0x9720)' },
  { sel: 3,  handler: 0x39ae, name: 'TRIGGER evaluator' },
  { sel: 4,  handler: 0xde08, name: 'activate System-B entity group' },
  { sel: 5,  handler: 0xde42, name: 'activate System-A entity group' },
  { sel: 6,  handler: 0x38f5, name: 'progress / position marker' },
  { sel: 7,  handler: 0x75fc, name: 'line barrier (cx=0) — game/line-barriers.js' },
  { sel: 8,  handler: 0x7600, name: 'line barrier (cx=1) — game/line-barriers.js' },
  { sel: 9,  handler: 0x7605, name: 'line barrier (cx=2) — game/line-barriers.js' },
  { sel: 10, handler: 0x760a, name: 'line barrier (cx=3) — game/line-barriers.js' },
  { sel: 11, handler: 0xc49c, name: 'install per-world scripted routine' },
];
export const SELECTOR_CHECKPOINT = 6;   // CS:0x38F5 — game/progress.js
export const SELECTOR_GUARDIAN = 11;    // CS:0xC49C — game/guardian.js
export const SELECTOR_TRIGGER = 3;   // CS:0x603A `dec ax` — see the header
export const selectorName = (sel) =>
  (SELECTOR_TABLE[sel - 1] && SELECTOR_TABLE[sel - 1].name) || `out of range (${sel})`;

/** PLEV<world><sub> -> PALFILS.0<sub><world>  (e.g. PLEV1A -> PALFILS.0A1) */
export const palfilsNameFor = (key) => `PALFILS.0${key[1]}${key[0]}`;

/** Parse the windows this module needs out of a decompressed PALFILS. */
export function parsePalfils(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const events = [];
  for (let i = 0; i < EVENT_COUNT; i++) {
    const o = EVENT_TABLE_OFF + i * 4;
    events.push({ selector: dv.getUint16(o, false), param: dv.getUint16(o + 2, false) });
  }
  /* Lever records are {u16 x, u16 y, u16 object_type}; bit 0 of the TYPE is
   * the lever state (24/25 = lever off/on, 26/27 = switch off/on), which is
   * why the toggle flips graphic and state together. The game byte-swaps this
   * window at 0x2acf; we read big-endian directly. */
  const levers = [];
  for (let i = 0; i < LEVER_COUNT; i++) {
    const o = LEVER_TABLE_OFF + i * 6;
    levers.push({
      x: dv.getUint16(o, false),
      y: dv.getUint16(o + 2, false),
      type: dv.getUint16(o + 4, false),
    });
  }
  return { events, levers };
}

export class EventRunner {
  constructor(map, palfils) {
    this.map = map;
    this.pal = palfils;
    this.triggers = parseAllTriggers(map.bulk);
    /* Consumed trigger slots: the original writes 0xFFFF into the EVENT
     * record when a trigger fires, so it cannot fire twice.
     * The original keeps a pristine packed master at DS:0x8114 and re-runs
     * the unpack CS:0x3880 from exactly two places (an operand search over
     * the whole image): level load (CS:0x0095) and CS:0x485E. ⚠️ CORRECTED:
     * CS:0x485E is inside FUN_1000_484e, the sublevel-B switch's
     * continuation (game/progress.js), NOT the death/respawn path
     * (FUN_1000_0845), as an earlier revision of this comment said. So dying
     * does NOT re-arm consumed events; entering a level or sublevel does,
     * and this port gets that by building a fresh EventRunner on both. */
    this.consumed = new Set();         // trigger indices, for reporting only
    this.consumedEvents = new Set();   // DS:0x932c record ids — the real key
    this.onSpawnB = null;              // set by the host to receive activations
    this.onSpawnA = null;              // set by the host to receive System-A activations
    this.onPathJob = null;             // set by the host to arm a line-barriers.js record
    this.onCheckpoint = null;          // selector 6, game/progress.js
    this.actionCtx = null;             // set by the host to EXECUTE the verbs
    this.lastCell = -1;
    this.log = [];
    this.unhandled = new Map();   // selector -> count, surfaced not swallowed
  }

  /** Game state the 17 predicates read. */
  makeState(extra = {}) {
    const leverBytes = new Uint8Array(LEVER_COUNT * 6);
    this.pal.levers.forEach((l, i) => { leverBytes[i * 6 + 4] = l.type & 0xff; });
    return {
      inventory: [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF],
      slots3: [0xFFFF, 0xFFFF, 0xFFFF],
      /* COND5/6 read the event word `[0x932c + (arg-1)*4]` as signed: a
       * consumed record holds 0xFFFF (CS:0x39FE). */
      events: this.pal.events.map((e, i) =>
        (this.consumedEvents.has(i) ? -1 : (e.selector << 16) >> 16)),
      /* The host passes the live health target (DS:0x192), lives (DS:0x224),
       * score, the three weapon slots and the inventory in `extra`; these
       * are only the defaults for tools and tests. */
      health: 0, timer: 0,
      levers: leverBytes, lever_count: LEVER_COUNT,
      score: 0, lives: 0,
      ...extra,
    };
  }

  /**
   * Call once per logic tick with the hero's world position. Dispatches EVERY
   * probed cell that names an event; returns the first one that actually
   * fired (for the host's status line), or null.
   * @param {number} x @param {number} y
   * @param {object} state
   * @param {number} [colOverride] test seam — tools/verify-node.mjs passes a
   *   different column rule here (positionally) so the two can be compared on
   *   real level data. It replaces the PRIMARY column only; the left-column
   *   probe stays `col - 1` behind its own `x & 31` gate, as in the original.
   *   Production callers omit it.
   */
  step(x, y, state, colOverride) {
    /* THE PROBE — CS:0x5FAB, called from the epilogue at CS:0x5EA0.
     *
     *     5FB2  add ax,0x10 / and ax,0xffe0    ; col = (X + 16) >> 5
     *     5FB8  and bx,0xfff0                  ; Y FLOORED, not rounded
     *     5FBE  sar ax,1 (x5) / shl bx,1 (x3)  ; -> col, row*128
     *     5FD2  cmp byte [si],2 / jbe / call 0x6022     ; (col, row)
     *     5FDA  add si,0x80 ; cmp/jbe/call               ; (col, row+1)
     *     5FE6  add si,0x80 ; cmp/jbe/call               ; (col, row+2)
     *     5FF2  ax = heroX & 0x1f / cmp 0x10 / jl RET   ; the left column,
     *     5FFD  add si,0xfeff (= -257: back 2 rows, left 1 col)
     *     6001  cmp/jbe/call ; 6009 add si,0x80 ; ... ; 6019 ...
     *
     * The axes are asymmetric on purpose. X is rounded to the NEAREST column
     * (the hero is 32 px wide, so his centre decides); Y is floored to the
     * row his HEAD is in, and then three rows are probed — 48 px, the hero's
     * own height, so the scan covers his whole body rather than one tile.
     *
     * ⚠️ IT IS NOT ONE CELL, and that was this port's bug. Probing only
     * (col, row) fires whichever event sits at the hero's head and misses
     * any event under his feet. PLEV1A's lever-3 spike kill is exactly that
     * shape: trigger #7 hangs off a plane-B cell on row 59 and trigger #8 off
     * one on row 60, and a hero standing on that ledge has row 59 at his head
     * and row 60 at his waist. The original fires BOTH in one tick and both
     * spikes go; a single-cell probe removes one spike and leaves the other.
     *
     * The second column is the hero's own RAW column: when `x & 31 >= 16` the
     * `+16` rounding has already pushed `col` one to the right, so `col - 1`
     * is the tile his left edge is actually in. Below 16 the rounding did not
     * move, and the original probes nothing extra — an asymmetry this
     * reproduces rather than tidies.
     *
     * ⚠️ There is no cell-change gate anywhere in the body (and CS:0x5EA0,
     * its caller, has zero xrefs — it is unconditional per-frame code). The
     * game re-probes every tick and relies on the evaluator's own
     * consume-on-success (CS:0x39FE marks the event 0xFFFF; CS:0x6034 skips
     * it forever after) to make repeats free. An earlier revision of this
     * file gated on `cell === lastCell`, commented "edge-triggered, like the
     * original", and so never re-fired for a player who pulled a lever
     * without stepping off the tile. See docs/camera-and-world-nav.md in the
     * sibling Gods dump for both traces. */
    const col = colOverride === undefined ? (x + 16) >> 5 : colOverride;
    const row = y >> 4;
    const cols = this.map.cols;
    this.lastCell = row * cols + col;   // reported for debugging only

    let first = null;
    const probe = (c, r) => {
      /* The original does raw pointer arithmetic with no bounds check. In
       * practice it stays inside plane B — a hero cannot stand low enough for
       * row+2 to leave the map, and `col - 1` is only reached when rounding
       * already pushed col to 1 or more — so rather than model what lies past
       * the array (the trigger table does), an out-of-range probe reads as 0
       * here, the same call this port already makes for the respawn search. */
      const i = r * cols + c;
      if (c < 0 || c >= cols || i < 0 || i >= this.map.planeB.length) return;
      const v = this.map.planeB[i];
      if (v < 3) return;                                  // CS:0x5FD2 `jbe`
      const res = this.dispatchEvent(v - 3, state, 0);    // CS:0x5FD7
      if (res && !first) first = res;
    };

    probe(col, row);                                      // CS:0x5FD2
    probe(col, row + 1);                                  // CS:0x5FDA
    probe(col, row + 2);                                  // CS:0x5FE6
    if ((x & 0x1f) >= 0x10) {                             // CS:0x5FF2 `jl`
      probe(col - 1, row);                                // CS:0x6001
      probe(col - 1, row + 1);                            // CS:0x6009
      probe(col - 1, row + 2);                            // CS:0x6015
    }
    return first;
  }

  /**
   * CS:0x6029 — dispatch one EVENT RECORD by index. Reached two ways: from the
   * plane-B scan above, and from ACT5, which tail-jumps straight in here with
   * `arg - 1` (CS:0x3D0A `mov ax,[di+0x12] / dec ax / jmp 0x6029`), so its
   * argument is an event index and never a plane-B value.
   *
   * @param {number} depth ACT5 recursion depth. The original needs no such
   *   guard — a fired trigger consumes its event record, so a chain always
   *   terminates on the `js` at CS:0x6034 — but nothing in the hardware stops
   *   a cycle through records that never fire. Reported, not silent.
   */
  dispatchEvent(id, state, depth = 0) {
    if (id >= EVENT_COUNT) return null;
    const ev = this.pal.events[id];

    /* CS:0x6034 `or ax,ax / js / jz` — a consumed slot (0xFFFF) and an empty
     * one (0) both drop out here, before the 1-based bias is applied. */
    if (ev.selector === 0 || (ev.selector & 0x8000)) return null;

    /* ⚠️ THE CONSUME IS KEYED ON THE EVENT RECORD, NOT THE TRIGGER.
     * CS:0x39FE `mov word [si],0xffff` writes through SI, which CS:0x6032 left
     * pointing at the DS:0x932c record — so it is the record that is spent,
     * and CS:0x6034 re-tests that same word on re-entry. An earlier revision of
     * this port keyed on the trigger index instead. Measured over all 8 PALFILS
     * files the two are equivalent — 0 of 727 selector-3 triggers is named by
     * more than one event record — so this is fidelity, not a bug fix, and the
     * check that proves it is in the suite. */
    if (this.consumedEvents.has(id)) return null;

    /* Selector 4 activates a System-B enemy group. The original CONSUMES the
     * event before it even looks for a free runtime slot (CS:0xde08), so the
     * consume is unconditional here too. */
    if (ev.selector === SELECTOR_SPAWN_B) {
      this.consumedEvents.add(id);
      if (this.onSpawnB) this.onSpawnB(ev.param);
      return null;
    }

    /* Selector 5 — System A, same consume-before-lookup shape as selector 4
     * (CS:0xde42 `mov word [si],0xffff` before the runtime-slot search). */
    if (ev.selector === SELECTOR_SPAWN_A) {
      this.consumedEvents.add(id);
      if (this.onSpawnA) this.onSpawnA(ev.param);
      return null;
    }

    /* Selector 2 — the stationary-turret allocator (CS:0xad06 -> CS:0xAD0D),
     * same consume-before-lookup shape as 4/5 (CS:0xAD0D's own caller
     * consumes the event before ever touching the 10-slot runtime pool). */
    if (ev.selector === SELECTOR_SPAWN_2) {
      this.consumedEvents.add(id);
      if (this.onSpawn2) this.onSpawn2(ev.param);
      return null;
    }

    /* Selector 1 — the PGOD0x.PAT scripted-object allocator (CS:0xb908,
     * game/pat-objects.js), same consume-before-lookup shape as 2/4/5. */
    if (ev.selector === SELECTOR_SPAWN_1) {
      this.consumedEvents.add(id);
      if (this.onSpawn1) this.onSpawn1(ev.param);
      return null;
    }

    /* Selectors 7-10 — the "path job" / line-barrier system
     * (game/line-barriers.js). `CS:0x760D-0x7679` shares this consume-
     * before-lookup shape with 1/2/4/5 above: the event is spent whether or
     * not the record it names turns out to be live. `ev.param` is the
     * record index (0..24) into PALFILS +0x189C, not a plane-B value. */
    if (ev.selector >= SELECTOR_PATH_MIN && ev.selector <= SELECTOR_PATH_MAX) {
      this.consumedEvents.add(id);
      if (this.onPathJob) this.onPathJob(ev.param, ev.selector);
      return null;
    }

    /* Selector 6 — the progress checkpoint (CS:0x38F5, game/progress.js).
     * The ONLY selector that never consumes its event: CS:0x38F5 has no
     * `mov word [si],0xffff`, so it re-runs on every tick the hero stands on
     * a marker cell and relies on its own position ring to count a spot
     * once. */
    if (ev.selector === SELECTOR_CHECKPOINT) {
      if (this.onCheckpoint) this.onCheckpoint();
      return null;
    }

    /* Selector 11 — CS:0xC49C `mov word [si],0xffff` consumes the event, then
     * installs the world's guardian. `onGuardian` returns false for a world
     * whose guardian is not ported, and the event is counted as unhandled. */
    if (ev.selector === SELECTOR_GUARDIAN && this.onGuardian) {
      this.consumedEvents.add(id);
      if (!this.onGuardian(ev.param)) {
        this.unhandled.set(ev.selector, (this.unhandled.get(ev.selector) || 0) + 1);
      }
      return null;
    }

    if (ev.selector !== SELECTOR_TRIGGER) {
      this.unhandled.set(ev.selector, (this.unhandled.get(ev.selector) || 0) + 1);
      return null;
    }
    if (ev.param >= this.triggers.length) return null;

    const t = this.triggers[ev.param];
    if (!isLive(t)) return null;
    if (!evalTrigger(t, state)) return null;

    this.consumedEvents.add(id);
    this.consumed.add(ev.param);          // kept for reporting only

    /* The shared prologue plus the verb — CS:0x39FE-0x3A56. With no action
     * context wired the port falls back to its old report-only behaviour, so
     * the evaluator stays testable in isolation. */
    let result = null;
    const msg = this.map.messages[t.messageId] || null;
    if (this.actionCtx) {
      result = fireTrigger(t, this.actionCtx);
      if (result.verb === 5 && result.dispatch !== undefined) {
        if (depth >= ACT5_MAX_DEPTH) {
          this.actionCtx.onDiverge(`ACT5 chain exceeded depth ${ACT5_MAX_DEPTH}`);
        } else {
          result.chained = this.dispatchEvent(result.dispatch, state, depth + 1);
        }
      }
    }

    const entry = { trigger: ev.param, event: id, verb: verbOf(t),
                    messageId: t.messageId, msg, result };
    this.log.push(entry);
    return entry;
  }
}

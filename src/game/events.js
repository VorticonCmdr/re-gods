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
import { SELECTOR_SPAWN_B } from './spawn.js';

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
  { sel: 7,  handler: 0x75fc, name: 'path job (cx=0)' },
  { sel: 8,  handler: 0x7600, name: 'path job (cx=1)' },
  { sel: 9,  handler: 0x7605, name: 'path job (cx=2)' },
  { sel: 10, handler: 0x760a, name: 'path job (cx=3)' },
  { sel: 11, handler: 0xc49c, name: 'install per-world scripted routine' },
];
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
     * NOT MODELLED (no death in the port yet): the original keeps a pristine
     * packed master at DS:0x8114 and re-runs the unpack CS:0x3880 from the
     * RESPAWN path (CS:0x485E) as well as from level load (CS:0x0095) — so
     * DYING RE-ARMS EVERY CONSUMED EVENT. When death lands, clear this set
     * there. UNKNOWN_event_rearm_scope: whether anything else calls it. */
    this.consumed = new Set();
    this.consumedEvents = new Set();   // selector-4 records, consumed at CS:0xde08
    this.onSpawnB = null;              // set by the host to receive activations
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
      events: null, event_count: 0,
      /* DS:0x192 hero health, max 24 (see trigger.js case 7/8). The port
       * does not model damage yet, so it reports 0 — which makes the
       * "help bonus" triggers fire, the correct behaviour for a hurt
       * player, rather than silently never firing. */
      health: 0, timer: 0,
      levers: leverBytes, lever_count: LEVER_COUNT,
      score: 0, lives: 0,
      ...extra,
    };
  }

  /**
   * Call once per logic tick with the hero's world position.
   * Returns the fired trigger entry, or null.
   * @param {number} x @param {number} y
   * @param {object} state
   * @param {number} [colOverride] test seam only — lets the verification run
   *   drive this same code with a different column rule so the two can be
   *   compared on real level data. Production callers omit it.
   */
  step(x, y, state, colOverride) {
    /* THE PROBE CELL — CS:0x5fab, called from the epilogue at 0x5ea0:
     *     5FB2  add ax,0x10          ; X + 16
     *     5FB5  and ax,0xffe0
     *     5FB8  and bx,0xfff0        ; Y floored, NOT rounded
     *     5FBE  sar ax,1 (x5)        ; -> col = (X + 16) >> 5
     *     5FC8  shl bx,1 (x3)        ; -> row * 128
     * The axes are deliberately asymmetric: X is rounded to the NEAREST
     * column (the hero is 32 px wide, so his centre decides), Y is FLOORED to
     * the row his head is in. This port previously used `x >> 5` for the
     * column, which shifts every event trigger half a tile to the left. */
    const col = colOverride === undefined ? (x + 16) >> 5 : colOverride;
    const row = y >> 4;
    const cell = row * this.map.cols + col;
    if (cell === this.lastCell) return null;    // edge-triggered, like the original
    this.lastCell = cell;

    const v = this.map.planeB[cell];
    if (v < 3) return null;

    const id = v - 3;
    if (id >= EVENT_COUNT) return null;
    const ev = this.pal.events[id];

    /* CS:0x6034 `or ax,ax / js / jz` — a consumed slot (0xFFFF) and an empty
     * one (0) both drop out here, before the 1-based bias is applied. */
    if (ev.selector === 0 || (ev.selector & 0x8000)) return null;

    /* Selector 4 activates a System-B enemy group. The original CONSUMES the
     * event before it even looks for a free runtime slot (CS:0xde08), so the
     * consume is unconditional here too. */
    if (ev.selector === SELECTOR_SPAWN_B) {
      if (this.consumedEvents.has(id)) return null;
      this.consumedEvents.add(id);
      if (this.onSpawnB) this.onSpawnB(ev.param);
      return null;
    }

    if (ev.selector !== SELECTOR_TRIGGER) {
      this.unhandled.set(ev.selector, (this.unhandled.get(ev.selector) || 0) + 1);
      return null;
    }
    if (ev.param >= this.triggers.length) return null;
    if (this.consumed.has(ev.param)) return null;

    const t = this.triggers[ev.param];
    if (!isLive(t)) return null;
    if (!evalTrigger(t, state)) return null;

    this.consumed.add(ev.param);
    const msg = this.map.messages[t.messageId] || null;
    const entry = { trigger: ev.param, verb: verbOf(t), messageId: t.messageId, msg };
    this.log.push(entry);
    return entry;
  }
}

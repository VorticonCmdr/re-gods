/* map-writer.js — the inverse of map.js's `parseMap`: serializes an in-memory
 * level model back into a decompressed `.MAP` buffer, byte-for-byte
 * compatible with what GAME.EXE's own parser (`FUN_1000_36f8`) expects.
 *
 * PROVENANCE
 *   Section layout/sizes mirror map.js exactly (see that file's own header
 *   for the GAME.EXE citations) — this file adds no new format knowledge,
 *   it only inverts what map.js already established as [PROVEN].
 *
 *   One field this file DOES newly establish: the message offset table's
 *   high BE word. map.js's parser only ever reads the LOW word of each
 *   4-byte entry; the high word was unconfirmed. Checked directly against
 *   all 8 shipped, decompressed `.MAP` files this session (every one of
 *   40*8=320 entries) — the high word is 0 in all of them. Written as 0
 *   here, and asserted by the round-trip test in verify/checks.js.
 *
 *   Message packing: the shipped pool is NOT one string per fixed slot —
 *   entries point at arbitrary offsets, and an offset of 0 is the ONLY
 *   "no message" sentinel the parser recognizes (a nonzero offset that
 *   happens to decode to an empty string, as PLEV1A's own entry 0 does,
 *   is legal but a different encoding of the same "no text" idea). This
 *   writer always uses the plain off=0 sentinel for null messages and
 *   packs every real string back-to-back, NUL-terminated, starting at the
 *   pool's own absolute base — the simplest encoding the parser accepts,
 *   not a byte-identical reproduction of the original authoring tool's
 *   own (irrelevant, since off=0 makes the choice inert) placement.
 */

import {
  BULK_SIZE, MAP_COLS, MAP_ROWS, PLANE_SIZE,
  OBJ_OFF, OBJ_COUNT, MSG_OFF, MSG_COUNT, MSG_POOL, TRIG_OFF,
} from './map.js';
import { TRIG_COUNT, TRIG_RECSIZE } from '../game/trigger.js';

const MSG_POOL_SIZE = TRIG_OFF - MSG_POOL;   // 1680 bytes, proven above

/** A header with the dead count/headerWord/headerTable fields all zeroed —
 *  legal per map.js's own header-format closure (those fields are never
 *  read by GAME.EXE), used as the starting point for a brand-new level. */
export function blankHeader() {
  return { count: 0, headerWord: 0, headerTable: new Uint16Array(0) };
}

/** An empty, structurally valid level: blank planes, all 200 object slots
 *  dead (`0xFFFF` sentinel, tested by sign per map-format-and-filenames.md),
 *  no messages, and 100 all-zero (dead, per trigger.js `isLive`) trigger
 *  records. The starting point for "create a new level". */
export function blankMap() {
  const objects = [];
  for (let i = 0; i < OBJ_COUNT; i++) objects.push({ x: 0xFFFF, y: 0xFFFF, type: 0xFFFF });
  const messages = new Array(MSG_COUNT).fill(null);
  const triggers = [];
  for (let i = 0; i < TRIG_COUNT; i++) {
    triggers.push({
      condKind: [0, 0, 0], condArg: [0, 0, 0],
      x: 0, y: 0, action: 0, actionArg: 0, messageId: 0, reserved: 0,
    });
  }
  return {
    ...blankHeader(),
    planeA: new Uint8Array(PLANE_SIZE),
    planeB: new Uint8Array(PLANE_SIZE),
    objects, messages, triggers,
    cols: MAP_COLS, rows: MAP_ROWS,
    widthPx: MAP_COLS * 32, heightPx: MAP_ROWS * 16,
  };
}

/**
 * Serialize a level model into a decompressed `.MAP` buffer.
 * @param {object} model {count, headerWord, headerTable, planeA(8192),
 *   planeB(8192), objects(200 {x,y,type}), messages(40 string|null),
 *   triggers(100 trigger.js-shaped records)}
 * @returns {Uint8Array}
 */
export function serializeMap(model) {
  const { count, headerWord, headerTable, planeA, planeB, objects, messages, triggers } = model;

  if (planeA.length !== PLANE_SIZE) throw new Error(`serializeMap: planeA is ${planeA.length}, expected ${PLANE_SIZE}`);
  if (planeB.length !== PLANE_SIZE) throw new Error(`serializeMap: planeB is ${planeB.length}, expected ${PLANE_SIZE}`);
  if (objects.length !== OBJ_COUNT) throw new Error(`serializeMap: ${objects.length} objects, expected ${OBJ_COUNT}`);
  if (messages.length !== MSG_COUNT) throw new Error(`serializeMap: ${messages.length} messages, expected ${MSG_COUNT}`);
  if (triggers.length !== TRIG_COUNT) throw new Error(`serializeMap: ${triggers.length} triggers, expected ${TRIG_COUNT}`);
  if (headerTable.length !== count) throw new Error(`serializeMap: headerTable length ${headerTable.length} != count ${count}`);

  const headerLen = 4 + count * 2;
  const out = new Uint8Array(headerLen + BULK_SIZE);
  const dv = new DataView(out.buffer);

  dv.setUint16(0, count, false);
  dv.setUint16(2, headerWord, false);
  for (let i = 0; i < count; i++) dv.setUint16(4 + i * 2, headerTable[i], false);

  const bulkStart = headerLen;
  out.set(planeA, bulkStart);
  out.set(planeB, bulkStart + PLANE_SIZE);

  /* Objects — 200 x {x,y,type}, big-endian, at OBJ_OFF within the bulk. */
  for (let i = 0; i < OBJ_COUNT; i++) {
    const o = bulkStart + OBJ_OFF + i * 6;
    const { x, y, type } = objects[i];
    dv.setUint16(o,     x & 0xFFFF,    false);
    dv.setUint16(o + 2, y & 0xFFFF,    false);
    dv.setUint16(o + 4, type & 0xFFFF, false);
  }

  /* Messages — 40 x u32 BE offset (low word only meaningful; high word
   * always 0, see this file's own header), then a NUL-terminated pool. */
  let poolCursor = 0;
  const poolBytes = [];
  for (let i = 0; i < MSG_COUNT; i++) {
    const s = messages[i];
    const e = bulkStart + MSG_OFF + i * 4;
    dv.setUint16(e, 0, false);   // high word — always 0, proven above
    if (!s) { dv.setUint16(e + 2, 0, false); continue; }   // off=0 sentinel
    const bytes = new TextEncoder().encode(s);
    if (bytes.some((b) => b === 0)) throw new Error(`serializeMap: message ${i} contains a NUL byte`);
    /* `off` is relative to MSG_OFF, NOT the file/bulk start — parseMap's own
     * `start = MSG_OFF + off` proves it (see this file's own header: pool
     * base = MSG_POOL - MSG_OFF = 0xA0, a fixed constant, confirmed against
     * all 8 shipped files' own entry-0 offset). */
    const off = (MSG_POOL - MSG_OFF) + poolCursor;
    dv.setUint16(e + 2, off, false);
    poolBytes.push(...bytes, 0);
    poolCursor += bytes.length + 1;
  }
  if (poolCursor > MSG_POOL_SIZE) {
    throw new Error(`serializeMap: message pool overflow — ${poolCursor} bytes needed, ${MSG_POOL_SIZE} available`);
  }
  out.set(Uint8Array.from(poolBytes), bulkStart + MSG_POOL);
  /* Remaining pool bytes stay 0 (Uint8Array default) — matches the parser's
   * own NUL-terminated-string convention (a stray 0 just ends iteration). */

  /* Triggers — 100 x 24 bytes, big-endian, at TRIG_OFF within the bulk. */
  for (let i = 0; i < TRIG_COUNT; i++) {
    const t = triggers[i];
    const o = bulkStart + TRIG_OFF + i * TRIG_RECSIZE;
    dv.setUint16(o,      t.condKind[0] & 0xFFFF, false);
    dv.setUint16(o + 2,  t.condArg[0]  & 0xFFFF, false);
    dv.setUint16(o + 4,  t.condKind[1] & 0xFFFF, false);
    dv.setUint16(o + 6,  t.condArg[1]  & 0xFFFF, false);
    dv.setUint16(o + 8,  t.condKind[2] & 0xFFFF, false);
    dv.setUint16(o + 10, t.condArg[2]  & 0xFFFF, false);
    dv.setUint16(o + 12, t.x           & 0xFFFF, false);
    dv.setUint16(o + 14, t.y           & 0xFFFF, false);
    dv.setUint16(o + 16, t.action      & 0xFFFF, false);
    dv.setUint16(o + 18, t.actionArg   & 0xFFFF, false);
    dv.setUint16(o + 20, t.messageId   & 0xFFFF, false);
    dv.setUint16(o + 22, t.reserved    & 0xFFFF, false);
  }

  return out;
}

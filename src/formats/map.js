/* map.js — GODS `.MAP` level parser.
 *
 * PROVENANCE
 *   Parser located at GAME.EXE FUN_1000_36f8 (1000:36f8-1000:3730) plus
 *   helpers FUN_1000_373e / _374b / _3731. The four section sizes are
 *   hard-coded immediates in those routines — 0x2000 words, 0x258, 0x730,
 *   0x4b0 words — and sum to 21824 bytes exactly. Verified: all 8 shipped
 *   maps have `total - 21824 == 4 + 2*count`.
 *
 *   Bulk layout (offsets within the 21824-byte bulk):
 *     +0x0000  16384 B  two parallel 8192-byte tile planes, 128 cols x 64 rows
 *                         plane A (+0x0000) tile graphic byte  -> DS:0x3004
 *                         plane B (+0x2000) attribute/event id -> DS:0x5004
 *     +0x4000   1200 B  200 x 6-byte object records {u16 x, u16 y, u16 type}
 *     +0x44B0   1840 B  40 x u32 offset table, then a NUL-terminated pool
 *     +0x4BE0   2400 B  100 x 24-byte trigger records  (see game/trigger.js)
 *
 *   Tiles are 32x16 px so a level world is 128*32 x 64*16 = 4096 x 1024 px.
 *   Corroborated by the data: object x maxes at 3946-4048 (< 4096) and
 *   y at 936-984 (< 1024).
 *
 *   Plane B values: 0 = empty (54.9%), 1 = solid (39.5%), 2 = climbable
 *   (2.7%). Any value >= 3 is an EVENT ID: GAME.EXE's per-frame scan calls
 *   0x6022 only when byte > 2, and that routine does `sub al,3` then falls
 *   through into the event dispatcher at 0x6029 (mov si,0x932c).
 */

export const BULK_SIZE   = 21824;
export const MAP_COLS    = 128;
export const MAP_ROWS    = 64;
export const PLANE_SIZE  = MAP_COLS * MAP_ROWS;   // 8192
export const OBJ_OFF     = 0x4000;
export const OBJ_COUNT   = 200;
export const MSG_OFF     = 0x44B0;
export const MSG_COUNT   = 40;
export const MSG_POOL    = 0x4550;                // MSG_OFF + 40*4
export const TRIG_OFF    = 0x4BE0;

/* Plane B well-known values (>= 3 is an event id, not an attribute). */
export const CELL_EMPTY     = 0;
export const CELL_SOLID     = 1;
export const CELL_CLIMBABLE = 2;
export const CELL_EVENT_MIN = 3;

/**
 * Parse a decompressed `.MAP`.
 * @param {Uint8Array} buf full decompressed file
 */
export function parseMap(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count      = dv.getUint16(0, false);
  const headerWord = dv.getUint16(2, false);      // 6 or 7 across the 8 files

  const headerTable = new Uint16Array(count);
  for (let i = 0; i < count; i++) headerTable[i] = dv.getUint16(4 + i * 2, false);

  const bulkStart = 4 + count * 2;
  if (buf.length - bulkStart !== BULK_SIZE) {
    throw new Error(
      `MAP: bulk is ${buf.length - bulkStart} bytes, expected ${BULK_SIZE}`);
  }
  const bulk = buf.subarray(bulkStart);

  const planeA = bulk.subarray(0, PLANE_SIZE);
  const planeB = bulk.subarray(PLANE_SIZE, PLANE_SIZE * 2);

  /* Objects — 200 x {x, y, type}, big-endian. Consumed slots are 0xFFFF. */
  const objects = [];
  for (let i = 0; i < OBJ_COUNT; i++) {
    const o = OBJ_OFF + i * 6;
    objects.push({
      x:    (bulk[o]     << 8) | bulk[o + 1],
      y:    (bulk[o + 2] << 8) | bulk[o + 3],
      type: (bulk[o + 4] << 8) | bulk[o + 5],
    });
  }

  /* Messages — 40 offsets, then a NUL-terminated pool. FUN_1000_374b reads
   * the LOW word of each 4-byte entry and treats a negative or zero value,
   * or an empty string, as "no message". */
  const messages = [];
  for (let i = 0; i < MSG_COUNT; i++) {
    const e = MSG_OFF + i * 4;
    const off = (bulk[e + 2] << 8) | bulk[e + 3];
    if (off === 0) { messages.push(null); continue; }
    const start = MSG_OFF + off;
    if (start >= BULK_SIZE) { messages.push(null); continue; }
    let end = start;
    while (end < BULK_SIZE && bulk[end] !== 0) end++;
    const s = new TextDecoder('latin1').decode(bulk.subarray(start, end));
    messages.push(s.length ? s : null);
  }

  return {
    count, headerWord, headerTable,
    bulk, planeA, planeB, objects, messages,
    cols: MAP_COLS, rows: MAP_ROWS,
    widthPx: MAP_COLS * 32, heightPx: MAP_ROWS * 16,
  };
}

/* PLANE A IS 1-BASED: tile = planeA - 1.  `[PROVEN]`
 *
 * Export 0 turns a plane-A byte B into a source address with NO mask, NO
 * limit compare and NO indirection:
 *     VGA:0x112D  mov cx,0xa672      ; tile cache base segment
 *     VGA:0x1130  sub cx,4           ; -4 PARAGRAPHS = -64 bytes
 *     VGA:0x11DE  shl ax,1 (x6)      ; AX = B * 64   (64 bytes per tile)
 *     VGA:0x11ED  mov ds,cx / mov si,ax
 * so the source offset is 64 * (B - 1) from the cache base.
 *
 * Corroborated from the shipped data: 5 of the 8 levels contain cells whose
 * plane-A value equals the level's own tile count exactly. Under a 0-based
 * model every one of those would be out of range; under 1-based they are the
 * last legal tile.
 *
 * Legal range is therefore 1..count, where `count` comes from the per-level
 * table at GAME.EXE DS:0xe90a (see TILE_COUNTS below).
 */
export const PLANE_A_BASE = 1;

/* Per-level tile counts, read from GAME.EXE DS:0xe90a (file 0x1ea6a),
 * indexed (world-1)*4 + sublevel*2. Raw bytes: 6e 7e 85 76 7c 6e 76 7b. */
export const TILE_COUNTS = {
  '1A': 110, '1B': 126, '2A': 133, '2B': 118,
  '3A': 124, '3B': 110, '4A': 118, '4B': 123,
};

/** Plane A tile index at a cell. Row stride is 128 (proven by the accessor). */
export function tileAt(map, col, row) {
  if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return 0;
  return map.planeA[row * MAP_COLS + col];
}
/** Plane B attribute / event id at a cell. */
export function attrAt(map, col, row) {
  if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) return 0;
  return map.planeB[row * MAP_COLS + col];
}
/** Plane B lookup by world pixel — mirrors GAME.EXE helper 1000:496a,
 *  which computes si = 0x5004 + (x >> 5) + (y >> 4) * 128. */
export function attrAtPixel(map, x, y) {
  return attrAt(map, x >> 5, y >> 4);
}

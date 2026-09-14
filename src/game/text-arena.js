/* text-arena.js — `DS:0x1fc6`, the one packed ASCIIZ string pool every
 * in-level message reads its words out of.
 *
 * PROVENANCE
 *   The object-message composer at `CS:0x4673` computes a string pointer as
 *   `0x1fc6 + descriptor[+8]`, and the hint-tablet handler at `CS:0x641f` does
 *   `add si,0x1fc6` on a word it read out of its own table. Same base, same
 *   pool: the POBJECTS names/descriptions and the PALFILS hint strings live
 *   back to back in one arena, appended by two different loaders in a fixed
 *   order. That sharing is what makes `CS:0x4609`'s "walk past this string's
 *   NUL to reach the next one" trick work at all (`CS:0x4698-0x46a5`).
 *
 *   THE ARENA IS PER-WORLD, NOT PER-LEVEL. `CS:0x35ea` gates the POBJECTS
 *   rebuild on `DS:0x43` (the sub-level letter), so it runs on A-levels and is
 *   kept across the A->B transition. `DS:0x14c` is the base and `DS:0x14a` the
 *   running cursor, both written once by the POBJECTS loader at
 *   `CS:0x3664`/`CS:0x3668`; the hint loader reads 0x14c and advances only
 *   0x14a (`CS:0x36b1`/`CS:0x36f2`).
 *
 *   ORDER MATTERS AND IS FIXED: POBJECTS first (132 records), then the 40
 *   PALFILS hint slots (`FUN_1000_36b1`, called from `CS:0x2AAE`), then the
 *   map's own trigger-message table (`FUN_1000_374b`, called at `CS:0x3729`).
 *   This module builds the first two; the third is already parsed separately
 *   by `formats/map.js` and is not re-pooled here, because nothing in the
 *   message path indexes it through this arena.
 */

/** POBJECTS.00N: 132 records of 48 bytes — CS:0x223A `mov cx,0x84`. */
export const OBJ_RECORDS = 0x84;
export const OBJ_STRIDE  = 48;
export const OBJ_NAME_OFF = 0x08, OBJ_NAME_MAX = 16;
export const OBJ_DESC_OFF = 0x18, OBJ_DESC_MAX = 24;
/** Record +6, big-endian — the value the composer prints after "Value". */
export const OBJ_VALUE_OFF = 0x06;

/** PALFILS tail, docs/asset-formats.md — 40 BE i16 keys then 40 x 0x28 ASCIIZ. */
export const HINT_KEYS_OFF = 0x1b58;
export const HINT_STRS_OFF = 0x1ba8;
export const HINT_SLOTS    = 40;
export const HINT_STRIDE   = 0x28;

/** `CS:0x4679`'s sentinel: descriptor[+8] == 0xFFFF means "this type has no
 *  text", and the composer bails on it with a SIGNED compare. */
export const NO_TEXT = 0xffff;

/**
 * `FUN_1000_35fb` — build the arena from a decompressed POBJECTS.00N and
 * return, per object type, the byte offset of its name within it.
 *
 * Both strings are written INCLUDING their NUL (unlike the append helper at
 * `CS:0x481d`, which copies up to a NUL but does not store it) — that is what
 * lets the composer step from the name to the description by walking one past
 * the terminator.
 *
 * @param {Uint8Array} buf 6336 bytes, decompressed
 * @returns {{arena: Uint8Array, textOff: Uint16Array, value: Uint16Array}}
 */
export function buildObjectArena(buf) {
  if (buf.length !== OBJ_RECORDS * OBJ_STRIDE) {
    throw new Error(`POBJECTS: expected ${OBJ_RECORDS * OBJ_STRIDE} bytes, got ${buf.length}`);
  }
  const out = [];
  const textOff = new Uint16Array(OBJ_RECORDS);
  const value   = new Uint16Array(OBJ_RECORDS);
  for (let t = 0; t < OBJ_RECORDS; t++) {
    const R = t * OBJ_STRIDE;
    value[t] = (buf[R + OBJ_VALUE_OFF] << 8) | buf[R + OBJ_VALUE_OFF + 1];   // BE
    const start = out.length;
    const n = copyZ(out, buf, R + OBJ_NAME_OFF, OBJ_NAME_MAX)
            + copyZ(out, buf, R + OBJ_DESC_OFF, OBJ_DESC_MAX);
    if (n <= 2) {                      // both fields empty -> only two NULs
      out.length = start;              // roll them back
      textOff[t] = NO_TEXT;
    } else {
      textOff[t] = start;
    }
  }
  return { arena: Uint8Array.from(out), textOff, value };
}

/**
 * `FUN_1000_36b1` — parse the PALFILS hint tail and append its strings to an
 * arena already holding the POBJECTS pool.
 *
 * The loader byte-swaps each big-endian key into native order and stores the
 * string's ARENA OFFSET (biased by `-0x1fc6` at `CS:0x36c0`, undone by the
 * handler's `add si,0x1fc6` at `CS:0x641f`) in a parallel table — it does not
 * keep pointers into the file.
 *
 * ⚠️ Two shipped-data quirks, both reproduced rather than smoothed over:
 *   - a slot with a NEGATIVE key is skipped entirely (`CS:0x36cd` `js`), so its
 *     offset word is left holding whatever the previous level wrote;
 *   - a slot with a non-negative key but an EMPTY string has its offset stored
 *     (`CS:0x36cf`) before `CS:0x36dc` skips the copy without advancing the
 *     cursor — so it silently inherits the NEXT slot's text. Neither occurs in
 *     the shipped files, but a port that quietly "fixed" them would diverge on
 *     modded data.
 *
 * @param {number[]|Uint8Array} arena  the POBJECTS arena, as a growable array
 * @param {Uint8Array} palfils  8760 bytes, decompressed
 * @returns {{arena: Uint8Array, keys: Int16Array, offs: Int32Array}}
 */
export function appendHints(arena, palfils) {
  const out = Array.from(arena);
  const keys = new Int16Array(HINT_SLOTS);
  const offs = new Int32Array(HINT_SLOTS).fill(-1);
  for (let i = 0; i < HINT_SLOTS; i++) {
    const k = ((palfils[HINT_KEYS_OFF + i * 2] << 8)
             |  palfils[HINT_KEYS_OFF + i * 2 + 1]) << 16 >> 16;   // BE -> i16
    keys[i] = k;
    if (k < 0) continue;                                  // CS:0x36cd `js`
    offs[i] = out.length;                                 // CS:0x36cf
    const src = HINT_STRS_OFF + i * HINT_STRIDE;
    if (palfils[src] === 0) continue;                     // CS:0x36dc — no copy
    copyZ(out, palfils, src, HINT_STRIDE);
  }
  return { arena: Uint8Array.from(out), keys, offs };
}

/**
 * `CS:0x63da-0x63fa` — the hint lookup: an exact-equality scan over all 40
 * key slots, FIRST MATCH WINS, no tolerance and no early-out on empty slots.
 * The compared value is the tablet's own world X.
 * @returns {number} the arena offset of the hint text, or -1 on no match
 */
export function hintOffsetForX(keys, offs, worldX) {
  for (let i = 0; i < HINT_SLOTS; i++) {                  // CS:0x63e9 `mov cx,0x28`
    if (keys[i] === worldX) return offs[i];               // CS:0x63f2 `cmp`/`jz`
  }
  return -1;                                              // CS:0x63fc — see below
}

/** Read one ASCIIZ string out of the arena at `off` (NUL not included). */
export function stringAt(arena, off) {
  if (off < 0 || off >= arena.length) return null;
  let n = off;
  while (n < arena.length && arena[n] !== 0) n++;
  return arena.subarray(off, n);
}

/** `CS:0x4698-0x46a5` — step past this string's NUL to the next packed one. */
export function nextStringOffset(arena, off) {
  if (arena[off] === 0) return off;                       // CS:0x4698 `jz`
  let n = off;
  while (n < arena.length && arena[n] !== 0) n++;
  return n + 1;
}

/** Copy an ASCIIZ field, truncated at `max`, INCLUDING one NUL. Returns the
 *  number of bytes written. */
function copyZ(out, buf, off, max) {
  let n = 0;
  while (n < max) {
    const c = buf[off + n];
    out.push(c);
    n++;
    if (!c) return n;                                     // the NUL is stored
  }
  out.push(0);                                            // field used all `max`
  return n + 1;
}

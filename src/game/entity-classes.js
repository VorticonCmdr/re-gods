/* entity-classes.js — the per-world sprite-class tables at DS:0xdf80.
 *
 * Four worlds x TWO tables, 12-byte records:
 *     { u16 spriteBase, u16 (always 1), u16 handlerA, u16 w, u16 h, u16 handlerB }
 * An all-0xFFFF record is an EMPTY class slot.
 *
 * ⚠️ WHICH TABLE BELONGS TO WHICH ENTITY SYSTEM IS PROVEN BY AN INVARIANT,
 * not assumed: no class index used by either system's shipped descriptors
 * ever lands on an empty record. That is discriminating — swap the two and
 * World 2's System-B descriptors, which use class 4, land on world 2 table
 * 0's 0xFFFF slot. See the checks.
 *   table 0 (handlers 0xbc4b family) <- SYSTEM A, PALFILS +0x0D58
 *   table 1 (handlers 0xb03c family) <- SYSTEM B, PALFILS +0x11A4
 */
export const CLASS_TABLE_DS = 0xdf80;
export const CLASS_RECORD_BYTES = 12;
export const CLASSES_PER_TABLE = 6;
export const EMPTY_CLASS = 0xffff;

/** [world][system] -> 6 class records, read out of GAME.EXE at file+0x10160. */
export const CLASS_TABLES = Object.freeze([
  /* world 1 */ [
    /* sys A, DS:0xe046 */ [
      { spriteBase:   450, one: 0x0001, hA: 0xbe6b, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   516, one: 0x0001, hA: 0xbed3, w: 32, h: 32, hB: 0xbf58 },
      { spriteBase:   456, one: 0x0001, hA: 0xbe71, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase: 65535, one: 0xffff, hA: 0xffff, w: 65535, h: 65535, hB: 0xffff },
      { spriteBase:   462, one: 0x0001, hA: 0xb70e, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   480, one: 0x0001, hA: 0xb718, w: 32, h: 32, hB: 0xb03c },
    ],
    /* sys B, DS:0xe076 */ [
      { spriteBase:   462, one: 0x0001, hA: 0xb70e, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   480, one: 0x0001, hA: 0xb718, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   498, one: 0x0001, hA: 0xb722, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   498, one: 0x0001, hA: 0xb722, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   498, one: 0x0001, hA: 0xb722, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   532, one: 0x0001, hA: 0xb60e, w: 24, h: 24, hB: 0xb670 },
    ],
  ],
  /* world 2 */ [
    /* sys A, DS:0xe0e2 */ [
      { spriteBase:   504, one: 0x0001, hA: 0xbe60, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   512, one: 0x0001, hA: 0xbe66, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   504, one: 0x0001, hA: 0xbe60, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   504, one: 0x0001, hA: 0xbe60, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase: 65535, one: 0xffff, hA: 0xffff, w: 65535, h: 65535, hB: 0xffff },
      { spriteBase:   450, one: 0x0001, hA: 0xb704, w: 32, h: 32, hB: 0xb03c },
    ],
    /* sys B, DS:0xe11e */ [
      { spriteBase:   450, one: 0x0001, hA: 0xb704, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   468, one: 0x0001, hA: 0xb71d, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   521, one: 0x0001, hA: 0xb144, w: 32, h: 32, hB: 0xb290 },
      { spriteBase:   525, one: 0x0001, hA: 0xb60e, w: 24, h: 24, hB: 0xb670 },
      { spriteBase:   486, one: 0x0001, hA: 0xb6ff, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   521, one: 0x0001, hA: 0xb144, w: 24, h: 24, hB: 0xb290 },
    ],
  ],
  /* world 3 */ [
    /* sys A, DS:0xe18a */ [
      { spriteBase:   486, one: 0x0001, hA: 0xbef4, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   523, one: 0x0001, hA: 0xbe5a, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   486, one: 0x0001, hA: 0xbef4, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase: 65535, one: 0xffff, hA: 0xffff, w: 65535, h: 65535, hB: 0xffff },
      { spriteBase:   450, one: 0x0001, hA: 0xb709, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   450, one: 0x0001, hA: 0xb709, w: 32, h: 32, hB: 0xb03c },
    ],
    /* sys B, DS:0xe1ba */ [
      { spriteBase:   450, one: 0x0001, hA: 0xb709, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   450, one: 0x0001, hA: 0xb709, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   468, one: 0x0001, hA: 0xb6fa, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   516, one: 0x0001, hA: 0xb2c7, w: 24, h: 24, hB: 0xb2f3 },
      { spriteBase:   450, one: 0x0001, hA: 0xb709, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   450, one: 0x0001, hA: 0xb709, w: 32, h: 32, hB: 0xb03c },
    ],
  ],
  /* world 4 */ [
    /* sys A, DS:0xe21a */ [
      { spriteBase:   496, one: 0x0001, hA: 0xbf15, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   524, one: 0x0001, hA: 0xbf36, w: 32, h: 32, hB: 0xbc4b },
      { spriteBase:   504, one: 0x0001, hA: 0xbddb, w: 32, h: 48, hB: 0xbd71 },
      { spriteBase:   531, one: 0x0001, hA: 0xbd38, w: 32, h: 32, hB: 0xbd0b },
      { spriteBase: 65535, one: 0xffff, hA: 0xffff, w: 65535, h: 65535, hB: 0xffff },
      { spriteBase:   450, one: 0x0001, hA: 0xb6f5, w: 32, h: 32, hB: 0xb03c },
    ],
    /* sys B, DS:0xe256 */ [
      { spriteBase:   450, one: 0x0001, hA: 0xb6f5, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   486, one: 0x0001, hA: 0xb83d, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   468, one: 0x0001, hA: 0xb6f0, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   547, one: 0x0001, hA: 0xb5e9, w: 24, h: 24, hB: 0xb670 },
      { spriteBase:   486, one: 0x0001, hA: 0xb83d, w: 32, h: 32, hB: 0xb03c },
      { spriteBase:   486, one: 0x0001, hA: 0xb83d, w: 32, h: 32, hB: 0xb03c },
    ],
  ],
]);

/* ── The DS:0xcfcc falling hazard is WORLD 4, SYSTEM A, CLASS 3 ───────────
 * Its record is the only one in any of the eight tables whose handlers are
 * 0xbd38 / 0xbd0b — the pair that spawns a hazard at phase 9 of a 12-phase
 * cycle (CS:0xBD4E `call 0x8b0e`) and drives it. `call 0xbd38` and
 * `call 0xbd0b` occur ZERO times image-wide, so the class table is the only
 * way in.
 *
 * System A in world 4 uses class 0 and nothing else, across both
 * PALFILS.0A4 and .0B4 — which this project once read as "the hazard is CUT
 * CONTENT". ⚠️ CORRECTED (2026-09-29): the same table (DS:0x1fe) is also
 * selector 1's PAT class table, and PALFILS +5 selects class 3 in seven
 * placed selector-1 descriptors of each of PLEV4A/4B. It is a live creature
 * that lets drops fall; see pat-objects.js #bd38 and falling-drop.js.
 */
export const HAZARD_CLASS = Object.freeze({ world: 4, system: 0, cls: 3 });
export const HAZARD_HANDLERS = Object.freeze([0xbd38, 0xbd0b]);
export const HAZARD_SPRITE_BASE = 531;   // 0x213, matching CS:0xBD68 `add bp,0x213`

/* ── One pool, two tenants — UNKNOWN_cfcc_pool_sharing ───────────────────
 * DS:0xcfcc's ten 10-byte slots are shared by TWO independent subsystems,
 * each with its own first-fit allocator, its own walker, and its own
 * self-modifying enable gate, but ONE shared counter DS:0x3b2:
 *
 *   allocator CS:0x8B0E  arms [cs:0x8b56] -> walker CS:0x8B57  (the hazard)
 *   allocator CS:0x8619  (STC on failure) -> walker CS:0x8688  (the co-tenant)
 *   CS:0x8B4A / CS:0x8681 disarm their respective gates
 *
 * The two seed different offsets (0x8B0E: x += 11; 0x8619: x += 3, y -= 0x18)
 * and read `+0x04`/`+0x06` with incompatible meanings. Nothing interlocks
 * them. The nest allocator refuses outside world 2 (CS:0x8611) and the drop
 * creature exists only in world 4, so the conflict cannot arise in shipped
 * data.
 */
export const POOL_DS = 0xcfcc;
export const POOL_SLOTS = 10;
export const POOL_STRIDE = 10;
export const POOL_TENANTS = Object.freeze([
  { alloc: 0x8b0e, walker: 0x8b57, gate: 0x8b56, disarm: 0x8b4a, role: 'falling drop (W4 PAT class 3)' },
  { alloc: 0x8619, walker: 0x8688, gate: 0x8687, disarm: 0x8681, role: 'UNKNOWN_cfcc_cotenant' },
]);

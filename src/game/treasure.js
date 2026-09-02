/* treasure.js — category 1: ordinary treasure, and the three locked chests.
 *
 * CS:0x17E6 splits the object walk three ways on the descriptor's CATEGORY:
 * `jg` rejects (>= 2), `jz` comes HERE (== 1), and the fall-through is
 * consumables (== 0). This module is the `jz` arm, CS:0x184E.
 *
 * ── THE BRANCH, CS:0x184E ─────────────────────────────────────────────────
 *     184E  cmp cx,0xc  / jl  0x1891        ; type < 12  -> ORDINARY
 *     1853  cmp cx,0x12 / jnl 0x1891        ; type >= 18 -> ORDINARY
 *     1858  test cl,0x1 / jz 0x1860
 *     185D  jmp 0x1919                      ; ODD  in [12,17] -> already open
 *     1860  mov dx,cx / sub dx,0xc / sar dx,1 / add dx,0x15
 *                                           ; EVEN in [12,17] -> needs key
 *                                           ;   key = 21 + (type-12)/2
 *     186A  mov ax,di                       ; park the DESCRIPTOR in AX...
 *     186C  mov di,0x17e                    ; ...because DI now walks the
 *     186F  cmp dx,[di] / jz 0x18d6         ;    4-slot inventory
 *     1873  add di,2  ... x4
 *     188B  mov [si+0x4],cx                 ; no key -> restore, do NOTHING
 *     188E  jmp 0x17bd
 *
 * ── THE DATA AGREES, AND IT IS DISCRIMINATING ─────────────────────────────
 * POBJECTS types 12..17 are three "treasure chest" pairs whose DESCRIPTION
 * field is the material:
 *     12/13  "treasure chest" "gold"    value 3000
 *     14/15  "treasure chest" "steel"   value 2000
 *     16/17  "treasure chest" "iron"    value 1000
 * and the three types the key formula computes — 21, 22, 23 — are the only
 * three records in the whole file named "chest key". Types 18/19/20 are
 * "door key", "treasure key", "world key" and are NOT reachable from this
 * arithmetic. A dropped `>> 1`, or `+0x14` instead of `+0x15`, lands on
 * "world key"/"door key" instead. Identical in all four POBJECTS files.
 *
 * EVEN = CLOSED, ODD = OPEN, and the transition is `or cx,1` (CS:0x18E2) —
 * exactly the lever convention this project already proved for types 24/25
 * and 26/27, where `xor byte [...+4],1` flips state and graphic together.
 * Confirmed from the maps: across all 8 levels the shipped types are 12 (x9)
 * and 14 (x3). **13, 15 and 17 are never placed** — a chest always starts
 * closed — and **16 is never placed either**, though key 23 ships 6 times.
 *
 * ── SO THE ODD ARM IS A NO-OP, AND THAT IS ITS PURPOSE ────────────────────
 *     1919  mov [si+0x4],cx / mov word [si+0x6],0x1 / jmp 0x17bd
 * `cx` already IS `[si+4]`, and `[si+6]` is re-derived every activation pass,
 * so both stores are inert. What the arm does is *skip CS:0x1891* — an opened
 * chest must not be collected a second time for its value.
 *
 * ── WHAT AN AWARD IS ──────────────────────────────────────────────────────
 * Both award paths are the same eight instructions (CS:0x18A8 and CS:0x18F4):
 *     mov ax,[di+0x6] / xchg al,ah        ; the descriptor's VALUE, BIG-ENDIAN
 *     clc / adc [0x194],ax / adc word [0x196],0x0    ; 32-bit MONEY
 *     sar ax,1 (x3)                                  ; value >> 3
 *     mov dx,ax / call 0x1950                        ; the BCD SCORE
 *
 * ⚠️ THE SHIFT IS `SAR`, NOT A DIVIDE. No shipped value is negative, but this
 * project has already paid for `/` where the original used `SAR` once (the
 * Bezier Q15 note), so it is written as `>>` here deliberately.
 *
 * ⚠️ THE TWO PATHS RECOVER `di` DIFFERENTLY, and one looks like a bug:
 *     ordinary  18A3  push di / call 0x4609 / 18A7 pop di      (symmetric)
 *     unlock    18ED  push ax / push si / call 0x4609
 *               18F2  pop si
 *               18F3  POP DI            <-- pops the pushed AX
 * That is not a slip. `di` was repurposed as the inventory cursor at
 * CS:0x186C, and CS:0x186A parked the descriptor pointer in `ax` for exactly
 * this. Same deliberate-mispop idiom as the damage routine at CS:0xAC84.
 */

import { GodsRandom } from './random.js';

/* ── The chest range and the key formula ───────────────────────────────── */

export const CHEST_MIN      = 0x0c;   // CS:0x184E `cmp cx,0xc`  (inclusive)
export const CHEST_MAX      = 0x12;   // CS:0x1853 `cmp cx,0x12` (exclusive)
export const CHEST_KEY_BASE = 0x15;   // CS:0x1867 `add dx,0x15`

export const isChestType   = (t) => t >= CHEST_MIN && t < CHEST_MAX;
export const isLockedChest = (t) => isChestType(t) && (t & 1) === 0;
export const isOpenChest   = (t) => isChestType(t) && (t & 1) === 1;

/** CS:0x1860-0x1867. Defined only for a chest type; the parity is ignored,
 *  which is why the open type maps to the same key as its closed twin. */
export const chestKeyFor = (t) => ((t - CHEST_MIN) >> 1) + CHEST_KEY_BASE;

/** CS:0x18E2 `or cx,0x1` — NOT `+ 1`. On a type already odd it is identity. */
export const openedType = (t) => t | 1;

export const TREASURE_SFX = 0x0638;   // CS:0x1892 — the common pickup sound
export const CHEST_SFX    = 0x052d;   // CS:0x18D7 — unlock has its OWN sound

export const INVENTORY_SLOTS = 4;     // DS:0x17e .. 0x184
export const INVENTORY_EMPTY = 0xffff;

/** CS:0x18B7-0x18BB — three SARs, hence `>>` and not `/ 8`. */
export const scoreForValue = (v) => v >> 3;

/* ── The 48-byte POBJECTS record — PROVEN by its own parser, CS:0x35FB ─────
 *
 * This project recorded "no GAME.EXE parser for the raw 48-byte file record
 * was located". It is at CS:0x35FB, reached from CS:0x35E9 (sublevel 'a'
 * only) alongside the PWEAPONS loader, and it compacts each 48-byte record
 * into the 10-byte runtime descriptor at DS:0x2a4e:
 *
 *     3615  mov si,0 / mov di,0x2a4e / mov cx,0x84    ; 132 records
 *     361E  xor dx,dx                                 ; running text offset
 *     3620  movsw / movsw / movsw / movsw             ; copy +0..+7 VERBATIM
 *     3624  mov [es:di],dx / inc di / inc di          ; descriptor +8 = offset
 *     3632  inc cx / lodsb / stosb / cmp al,0 / jnz   ; NAME  from file +0x08
 *     3639  pop si / add si,0x10 / push si            ;   ...so name is 16 B
 *     363E  inc cx / lodsb / stosb / cmp al,0 / jnz   ; DESC  from file +0x18
 *     3646  cmp cx,2 / 364D jg 0x3658
 *     364F  sub bx,2 / mov word [es:di-0x2],0xffff    ; BOTH empty -> no text
 *     3658  add si,0x18                               ; -> the next record
 *
 * `0x08 + 0x10 = 0x18` and `0x18 + 0x18 = 0x30 = 48`: the accounting closes
 * exactly, and the two `add si` immediates are what fix the field widths.
 *
 * ⚠️ `movsw` COPIES RAW, so the descriptor keeps +0..+6 BIG-ENDIAN. That is
 * why every consumer of the value does `xchg al,ah` (CS:0x18AB, CS:0x18F7)
 * while `+8`, written natively as DX, is used unswapped (CS:0x4676).
 *
 * ⚠️ AND +0/+4 ARE THEN OVERWRITTEN. The stamp loop CS:0x2234 runs after this
 * (CS:0x2A80 loads, CS:0x2B30 stamps) and rewrites +0 = 170 + type and +4 =
 * the category byte from DS:0xef78, sign-extended to a NATIVE word. So the
 * descriptor is a mixture: +0/+4 native, +6 big-endian, +8 native. A port
 * that picks one endianness for the whole struct is wrong twice.
 *
 * WHICH PROMOTES +6. This project carried it as "likely the object's Value ...
 * inferred by structural position + behavioural correlation, not a direct
 * decompile". CS:0x18A8 and CS:0x18F4 are that decompile: the word at +6 is
 * added to the money total and shifted into the score.
 */
export const OBJ_RECORD_SIZE = 48;
export const OBJ_NAME_OFF    = 0x08;
export const OBJ_NAME_MAX    = 0x10;   // CS:0x363A `add si,0x10`
export const OBJ_DESC_OFF    = 0x18;
export const OBJ_DESC_MAX    = 0x18;   // CS:0x3658 `add si,0x18`
export const OBJ_NO_TEXT     = 0xffff; // CS:0x3652

const latin1 = (bytes) => {
  let s = '';
  for (const b of bytes) { if (b === 0) break; s += String.fromCharCode(b); }
  return s;
};

/** Parse a decompressed POBJECTS.00x into 132 records, per CS:0x35FB. */
export function parseObjectRecords(buf) {
  const out = [];
  for (let t = 0; t < 132; t++) {
    const o = t * OBJ_RECORD_SIZE;
    const be = (k) => (buf[o + k] << 8) | buf[o + k + 1];
    const name = latin1(buf.subarray(o + OBJ_NAME_OFF, o + OBJ_NAME_OFF + OBJ_NAME_MAX));
    const desc = latin1(buf.subarray(o + OBJ_DESC_OFF, o + OBJ_DESC_OFF + OBJ_DESC_MAX));
    out.push({
      type: t,
      id:       be(0),      // overwritten at runtime by CS:0x2234
      unknown2: be(2),      // UNKNOWN_pobjects_field2 — 0 in all 528 records
      category: be(4),      // overwritten at runtime by CS:0x2234
      value:    be(6),      // <-- the field this module proves
      name, desc,
      /* CS:0x3646 `cmp cx,2` — cx counts bytes written INCLUDING both NULs,
       * so 2 means both strings are empty and +8 becomes 0xFFFF. */
      hasText: name.length > 0 || desc.length > 0,
    });
  }
  return out;
}

/* ── The BCD score, CS:0x1950 ──────────────────────────────────────────────
 *
 * Four bytes at DS:0x3b5, two packed decimal digits each, least significant
 * byte first — eight digits total. The routine converts the binary addend to
 * BCD by eight `div 10`s, then adds byte by byte with `add`/`adc` + `daa`:
 *
 *     1992  clc / lodsb / add al,ah / daa / mov [si-1],al
 *     199A  lodsb / adc al,bh / daa / mov [si-1],al
 *     19A1  lodsb / adc al,ch / daa / mov [si-1],al
 *     19A8  lodsb / adc al,dh / daa / mov [si-1],al
 *     19AF  mov byte [0x70],0xff / mov byte [0x71],0xff     ; display dirty
 *
 * Note the first step is `add`, not `adc`, so no stale carry leaks in — the
 * `clc` in front of it is belt-and-braces. Modelled here as decimal digits
 * because that is what BCD *is*; the wrap at 100000000 is the real hardware
 * behaviour of a 4-byte packed field and is reproduced rather than clamped.
 */
export const SCORE_BYTES  = 4;
export const SCORE_DS     = 0x3b5;
export const SCORE_MODULO = 100000000;

export class Score {
  constructor() { this.bytes = new Uint8Array(SCORE_BYTES); }

  /** CS:0x1950. `n` is binary; the field is packed BCD. */
  add(n) {
    const digits = [];
    let v = n >>> 0;
    for (let i = 0; i < SCORE_BYTES * 2; i++) { digits.push(v % 10); v = Math.floor(v / 10); }
    let carry = 0;
    for (let i = 0; i < SCORE_BYTES; i++) {
      const lo = (this.bytes[i] & 0x0f) + digits[i * 2] + carry;
      const loD = lo % 10; const c1 = lo >= 10 ? 1 : 0;
      const hi = (this.bytes[i] >> 4) + digits[i * 2 + 1] + c1;
      const hiD = hi % 10; carry = hi >= 10 ? 1 : 0;
      this.bytes[i] = (hiD << 4) | loD;
    }
    return this;
  }

  /** The eight digits as an ordinary number. */
  get value() {
    let v = 0;
    for (let i = SCORE_BYTES - 1; i >= 0; i--) v = v * 100 + (this.bytes[i] >> 4) * 10 + (this.bytes[i] & 0x0f);
    return v;
  }

  /** CS:0x8D91 — the full-restart clear. */
  reset() { this.bytes.fill(0); return this; }
}

/* ── The money total, DS:0x194 (32-bit) ───────────────────────────────────
 * `clc / adc [0x194],ax / adc word [0x196],0` — a plain 32-bit add. Zeroed
 * only at CS:0x0487, which is the world-wrap restart, NOT a level change.
 * This is the total the shop refunds against (CS:0x6FDE) and is a DIFFERENT
 * quantity from the score. */
export const MONEY_DS = 0x194;
export const MONEY_MODULO = 0x100000000;

export class Purse {
  constructor() { this.total = 0; }
  add(v) { this.total = (this.total + v) % MONEY_MODULO; return this; }
  reset() { this.total = 0; return this; }
}

/* ── The chest burst, CS:0x12CF ────────────────────────────────────────────
 *
 * Opening a chest throws TEN treasure objects out of it, which fly on a short
 * ballistic arc and then become real, collectable objects where they land.
 *
 *     12CF  mov cx,[si+0x4]                 ; the type, ALREADY made odd
 *     12D2  sub cx,0xc / sar cx,1
 *     12D7  shl cx,1 (x4)                   ; -> x16   <-- see the bug below
 *     12DF  lodsw / mov bx,ax               ; the object's world X
 *     12E2  lodsw / mov dx,ax               ;               world Y
 *     12E5  mov si,0xd8e6 / add si,cx
 *     12EA  mov cx,0xa / mov di,0xb654      ; TEN records, stride 10
 *     12F3  [di]=bx ; [di+2]=dx
 *     12FD  call 0x3836 / and bp,7 / inc bp ; |vx| = 1..8
 *     1306  test ax,0x80 / jz / neg bp      ;   sign from bit 7 of the WORD
 *     1312  call 0x3836 / and ax,7 / add ax,3 / neg ax   ; vy = -3 .. -10
 *     1322  movsw                           ; the item TYPE, from the table
 *
 * ⚠️ THE SPAWNER DOES NOT LOOK FOR FREE SLOTS. `di` is set to 0xb654 and ten
 * records are written unconditionally, so opening a second chest while a
 * burst is still in flight DISCARDS the first burst outright.
 *
 * ── ⚠️ A SHIPPED BUG: the table is authored at stride 20, read at 16 ──────
 *
 * The region is bounded on both sides by known structures. DS:0xd922 is the
 * hero's 23-entry jump-arc table (`0 0 0 0 6 6 5 4 4 3 2 1 1 0 -1 ...`, this
 * project's own finding), and 0xd922 - 0xd8e6 = 60 = 3 x 20 bytes. At a
 * 20-byte stride all three lists begin `80 80 80 80 5` — four gold plates and
 * a bag of gold — and then diverge. At the 16 the code actually strides, list
 * 1 begins `9 9 80 ...` and list 2 `10 5 9 9 80 ...`: entries that start in
 * the middle of the previous one.
 *
 * The decisive evidence is a SECOND CALLER. CS:0x1756 enters the same spawner
 * with `si = 0xd90e` hard-coded — and 0xd90e - 0xd8e6 = 40 = 2 x 20, i.e. the
 * correctly-aligned third list. One caller reads the table aligned; the other
 * computes its offset and gets it wrong.
 *
 * WHY IT IS INVISIBLE, AND WHY THIS PORT REPRODUCES IT ANYWAY:
 *   - list 0 (gold, type 13) is at offset 0, so it is CORRECT either way;
 *   - list 1 (steel, type 15) misaligned is a pure ROTATION of the aligned
 *     list — same ten items, different spawn order, so the loot is identical
 *     and only which random velocity lands on which item changes;
 *   - list 2 (iron, type 17) genuinely differs — aligned it holds a `chrystal`
 *     (11), misaligned a second `bag of gold` (9) — but **type 16 is placed in
 *     zero shipped maps**, so no player ever sees either.
 * Reads stay in bounds (max byte 51 of 60), so nothing else is disturbed.
 * "Fixing" the stride would diverge from the original on a chest that does
 * not exist: the wrong kind of correctness.
 */
export const BURST_TABLE_DS       = 0xd8e6;
export const BURST_COUNT          = 10;      // CS:0x12EA `mov cx,0xa`
export const BURST_STRIDE_WORDS   = 8;       // CS:0x12D7, four `shl` = 16 bytes
export const BURST_AUTHORED_WORDS = 10;      // 60 bytes / 3 lists
export const BURST_ALIGNED_DS     = 0xd90e;  // CS:0x1756 — the second caller
export const BURST_RECORDS        = 10;      // DS:0xb654, stride 10 bytes

/** DS:0xd8e6 .. 0xd922, 30 words, read out of GAME.EXE (file +0x10160).
 *  These are OBJECT TYPES, not sprite indices: 80 "gold plate", 79 "necklace",
 *  78 "gold mask", 10 "diamond", 11 "chrystal", 5 and 9 both "bag of gold". */
export const BURST_TABLE = Object.freeze([
  80, 80, 80, 80,  5, 79,  9,  9,  9,  9,   // list 0, authored (gold)
  80, 80, 80, 80,  5, 78, 10,  5,  9,  9,   // list 1, authored (steel)
  80, 80, 80, 80,  5, 78, 10, 11,  5,  5,   // list 2, authored (iron)
]);

/** What the code actually reads: stride 16 bytes = 8 words. */
export function burstTypes(openChestType) {
  const idx = (openChestType - CHEST_MIN) >> 1;
  const at = idx * BURST_STRIDE_WORDS;
  return BURST_TABLE.slice(at, at + BURST_COUNT);
}

/** What the table was authored as — kept so the bug is assertable, not
 *  folded away. Never used to drive the game. */
export function burstTypesAligned(openChestType) {
  const idx = (openChestType - CHEST_MIN) >> 1;
  const at = idx * BURST_AUTHORED_WORDS;
  return BURST_TABLE.slice(at, at + BURST_COUNT);
}

/* ── The burst's flight, CS:0x133F ─────────────────────────────────────────
 *     1340  cmp word [si+0x8],0 / js next        ; type negative -> free slot
 *     134B  add ax,[si+4] / add bx,[si+6]        ; x += vx ; y += vy
 *     1356  mov cx,[si+8] / add cx,0xaa          ; sprite = 170 + type
 *     135D  ...draw at (x - camX, y - camY)...   ; BEFORE the velocity update
 *     1375  inc word [si+6]                      ; gravity
 *     1378  cmp word [si+6],4 / jl / mov 4       ; vy clamps at +4
 *     1383  ...vx decays one step toward zero, floor 0...
 *     139F  cmp [si+6],4 / jnz alive
 *     13A5  cmp [si+4],0 / jz 0x13b7             ; vy==4 AND vx==0 -> SETTLE
 *     13AB  mov byte [0x397],0x1                 ; otherwise: still active
 *
 * ⚠️ FOUR gravity rules were already catalogued in this project (hero +v cap
 * 10, System-B enemy v then ++ cap 16, time bomb ++ cap 4, magic axe += 2 cap
 * 8). This is a FIFTH: `vy++` capped at **+4**, with a horizontal decay none
 * of the others have. No two share an implementation.
 */
export const BURST_VY_CAP = 4;   // CS:0x1378

/* ── Settling, CS:0x13B7 ───────────────────────────────────────────────────
 *     13B7  call 0x38d7                          ; the object allocator
 *     13BA  js 0x13b0                            ; NO FREE SLOT -> give up
 *     13BC  [bp+0]=x ; [bp+2]=y ; [bp+4]=type ; [bp+6]=1
 *     13D6  mov word [si+8],0xffff               ; free the burst record
 *     13DB  mov bp,0x438 ; add bp,dx ; [bp]=0xff ; mark the slot dirty
 *
 * ⚠️ THE FAILURE PATH IS A REAL DEAD END, AND IT IS REPRODUCED. `js 0x13b0`
 * jumps to the loop tail, skipping BOTH the settle and the `[0x397] = 1`
 * liveness store. So a burst item that reaches its landing condition while
 * all 200 object slots are full is left with vy=4, vx=0 forever; if it is the
 * last one in flight the whole burst updater switches itself off (CS:0x132D
 * early-returns on `[0x397] == 0`) and the record is never retried. Adding a
 * retry would be a different game.
 */

export class TreasureBurst {
  constructor(rnd = new GodsRandom(1)) {
    this.rnd = rnd;
    /* Ten records {x, y, vx, vy, type}; type < 0 means the slot is free. */
    this.records = Array.from({ length: BURST_RECORDS },
                              () => ({ x: 0, y: 0, vx: 0, vy: 0, type: -1 }));
    this.active = false;                 // DS:0x397
    this.stranded = 0;                   // items the allocator refused
  }

  /** CS:0x12CF/0x12EA. `openType` must already be the ODD (opened) type. */
  spawn(openType, x, y) {
    const types = burstTypes(openType);
    for (let i = 0; i < BURST_COUNT; i++) {
      const r1 = this.rnd.next();
      let vx = (r1 & 7) + 1;                       // CS:0x1302-0x1305
      if (r1 & 0x80) vx = -vx;                     // CS:0x1306 — bit 7 of the WORD
      const r2 = this.rnd.next();
      const vy = -((r2 & 7) + 3);                  // CS:0x1315-0x131B
      const rec = this.records[i];
      rec.x = x; rec.y = y; rec.vx = vx; rec.vy = vy; rec.type = types[i];
    }
    this.active = true;                            // CS:0x1326
    return this.records;
  }

  /**
   * CS:0x132D. One tick.
   * @param {Function} alloc CS:0x38d7 — returns a free object slot, or null.
   * @returns {{drawn:Array, settled:Array}} `drawn` is in draw order.
   */
  step(alloc) {
    const drawn = [], settled = [];
    if (!this.active) return { drawn, settled };   // CS:0x132D `jz`
    this.active = false;                           // CS:0x133A
    for (const r of this.records) {
      if (r.type < 0) continue;                    // CS:0x1340 `js`
      r.x += r.vx; r.y += r.vy;                    // CS:0x134B
      drawn.push({ x: r.x, y: r.y, type: r.type, sprite: 0xaa + r.type });

      r.vy += 1;                                   // CS:0x1375
      if (r.vy >= BURST_VY_CAP) r.vy = BURST_VY_CAP;
      if (r.vx > 0) r.vx -= 1; else if (r.vx < 0) r.vx += 1;   // CS:0x1383

      if (r.vy === BURST_VY_CAP && r.vx === 0) {   // CS:0x139F / 0x13A5
        const slot = alloc ? alloc() : null;       // CS:0x13B7
        if (!slot) { this.stranded++; continue; }  // CS:0x13BA — NOT re-armed
        slot.x = r.x; slot.y = r.y; slot.type = r.type; slot.flag6 = 1;
        settled.push(slot);
        r.type = -1;                               // CS:0x13D6
        continue;
      }
      this.active = true;                          // CS:0x13AB
    }
    return { drawn, settled };
  }

  get inFlight() { return this.records.filter((r) => r.type >= 0).length; }
}

/* ── The pickup sparkle, CS:0x1239 ────────────────────────────────────────
 * The ORDINARY path ends `mov cx,[0x20c] / add cx,0xaa / call 0x1239` — the
 * object's sprite index handed to a 10-slot effect array at DS:0xb578, stride
 * 10, written as {x, y, sprite, 6, -12}.
 *
 * NOT PORTED (cosmetic), but one fact is worth recording: the updater
 * CS:0x1280 draws `[si+6] + 0x50` — a seven-frame sequence, sprites 86 down
 * to 80 — and reads NEITHER `[si+4]` (the sprite just stored) NOR `[si+8]`.
 * So on the evidence in hand the animation does not depend on what was
 * collected.
 *
 * ⚠️ WEAKER THAN IT LOOKS, AND DELIBERATELY NOT CALLED "PROVEN". This is not
 * the `.DAT` word2 result: that one scanned every register-load encoding of
 * the displacement across three binaries. This enumerated references to the
 * BASE ADDRESS 0xb578 — exactly three (clear CS:0x1221, spawn CS:0x123B,
 * update CS:0x128A) — and read those three routines. A pointer parked in a
 * register or a DS variable never names 0xb578 again. Dead on all three
 * located references; not an exhaustive displacement scan.
 */
export const UNKNOWN_sparkle_fields =
  'dead on the three located references to DS:0xb578; not displacement-scanned';
export const SPARKLE_DS         = 0xb578;
export const SPARKLE_FRAMES     = 7;
export const SPARKLE_SPRITE_BASE = 0x50;
export const SPARKLE_DEAD_FIELDS = ['+4 sprite', '+8 (-12)'];

/* ── The walk-in outcome ──────────────────────────────────────────────────
 * `collectTreasure` is the whole of CS:0x184E. It assumes the caller has
 * already run the box test and the category check.
 */

/** @typedef {{outcome:string}} TreasureResult */

/**
 * @param {object} obj  the runtime object record ({x, y, type, flag6})
 * @param {object} ctx
 *   - `value`     the descriptor's +6 for this type
 *   - `inventory` Int32Array/array of 4, 0xFFFF = empty (DS:0x17e)
 *   - `purse`     a Purse   (DS:0x194)
 *   - `score`     a Score   (DS:0x3b5)
 *   - `burst`     a TreasureBurst, optional
 */
export function collectTreasure(obj, { value, inventory, purse, score, burst = null }) {
  const type = obj.type;

  /* CS:0x1858 — an ODD chest is already open. Do NOTHING; specifically, do
   * not fall through to the ordinary award. */
  if (isOpenChest(type)) {
    obj.flag6 = 1;                                 // CS:0x191C (inert)
    return { outcome: 'already-open', type };
  }

  if (isLockedChest(type)) {
    const key = chestKeyFor(type);                 // CS:0x1867
    const slot = inventory.findIndex((v) => v === key);   // CS:0x186F..0x1886
    if (slot < 0) return { outcome: 'locked', type, needsKey: key };

    inventory[slot] = INVENTORY_EMPTY;             // CS:0x18DE — the key is spent
    const open = openedType(type);                 // CS:0x18E2 `or cx,1`
    obj.type = open;
    obj.flag6 = 1;                                 // CS:0x18E8
    purse.add(value);                              // CS:0x18FA
    const gained = scoreForValue(value);           // CS:0x1903
    score.add(gained);                             // CS:0x190C
    const loot = burst ? burst.spawn(open, obj.x, obj.y) : null;   // CS:0x1910
    return { outcome: 'unlocked', type, open, key, slot, value, score: gained,
             sfx: CHEST_SFX, loot: loot ? loot.map((r) => r.type) : null };
  }

  /* CS:0x1891 — ordinary treasure. */
  obj.dead = true;                                 // CS:0x1899 `[si+4] = 0xffff`
  obj.flag6 = 0;                                   // CS:0x189E
  purse.add(value);                                // CS:0x18AE
  const gained = scoreForValue(value);             // CS:0x18B7
  score.add(gained);                               // CS:0x18C0
  return { outcome: 'collected', type, value, score: gained, sfx: TREASURE_SFX,
           sparkleSprite: 0xaa + type };           // CS:0x18C8
}

/* ── The inventory survives level changes ─────────────────────────────────
 * Worth stating because the World-2 census below only means something once
 * it is settled. `mov [0x17e],ax` appears TWICE in the whole image:
 *   CS:0x0498 — beside `mov byte [0x42],1` (world 1), `call 0x914c` (the
 *               weapon-slot clear) and `[0x194]=[0x196]=0` (money zeroed);
 *   CS:0x8D80 — beside the difficulty scalar init and `[0x3b5..0x3b8] = 0`
 *               (score zeroed).
 * Both are FULL RESTARTS — the same two sites this project already identified
 * for the weapon slots. Nothing clears the inventory on a sublevel or world
 * transition, so chest keys carry forward exactly as weapons do.
 */
export const INVENTORY_CLEAR_SITES = Object.freeze([0x0498, 0x8d80]);
export const INVENTORY_SURVIVES_LEVEL_CHANGE = true;

/* ── UNKNOWN_chest_key_surplus ────────────────────────────────────────────
 * Measured over all 8 shipped maps (see the checks): 9 gold chests (type 12)
 * against 8 "chest key" type 21; 3 steel chests (14) against 3 type 22; and
 * ZERO iron chests (16) against SIX type 23. World 2 additionally splits a
 * pair across sublevels — 2A holds a steel chest with no key 22, 2B holds a
 * gold chest with no key 21 — which the carry-forward above makes reachable
 * only in one traversal order.
 *
 * The arithmetic is not in doubt; what the surplus MEANS is. The consistent
 * readings are "the iron chest was cut late" or "key 23 doubles as a spare",
 * and this binary cannot distinguish them. Reported as a number rather than
 * smoothed over, the way the port surfaces the strategy-2/3 share.
 */
export const CHEST_KEY_CENSUS = Object.freeze({
  chests: { 12: 9, 14: 3, 16: 0 },
  keys:   { 21: 8, 22: 3, 23: 6 },
});

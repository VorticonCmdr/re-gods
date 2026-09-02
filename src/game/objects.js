/* objects.js — map objects: type -> sprite, category, and draw order.
 *
 * A .MAP carries 200 records {u16 x, u16 y, u16 type} at bulk +0x4000. Until
 * now this port drew them as 5x5 markers because the type -> sprite mapping
 * was unproven. It is now proven three independent ways.
 *
 * THE RULE
 *   sprite = type < 0xC0 ?  170 + type
 *                        :  302 + (type - 0xC0)     // weapon pickup
 *   drawn at (worldX - camX, worldY - camY), TOP-LEFT, no offset.
 *
 * PROOF 1 — the stamp loop, CS:0x2234 (file 0x23C4):
 *     2234  mov si,0xef78      ; category byte table
 *     2237  mov di,0x2a4e      ; runtime descriptor array
 *     223A  mov cx,0x84        ; 132 object types
 *     223D  mov bx,0xaa        ; 170  <-- the base
 *     2240  mov [di],bx        ;   descriptor +0 = sprite index
 *     2242  lodsb / cbw
 *     2244  mov [di+0x4],ax    ;   descriptor +4 = category (sign-extended)
 *     2247  add di,0xa / inc bx / loop
 *   So descriptor stride is 10 and the sprite index is stamped by the EXE,
 *   counting up from 170 — it is NOT read from the file at runtime.
 *
 * PROOF 2 — POBJECTS' own id field agrees. Record `t`'s big-endian u16 at +0
 *   reads 170 + t: type 8 -> 178 ("pile of coins"), type 50 -> 220
 *   ("spike. arc"), type 69 -> 239 ("tablet.roll.....reveals clues"). Two
 *   independent producers of the same number.
 *
 *   ...in worlds 1-3. POBJECTS.004 uses base 175 — every record shifted +5.
 *   That is the SAME authoring drift this project already recorded for
 *   PWEAPONS.004's +0xc/+0x1e fields, in the same file. It never takes
 *   effect, because the stamp loop overwrites descriptor +0 unconditionally.
 *   So CS:0x2234 is load-bearing, not a redundant re-derivation: read the
 *   sprite index from the file and world 4 draws every object 5 sprites off.
 *
 * PROOF 3 — the category table cross-checks against the names. cat[24..27] is
 *   3,3,3,3 and POBJECTS 24..27 are literally "lever off", "lever on",
 *   "switch off", "switch on" — matching this project's separately-established
 *   finding that 24/25 and 26/27 are the lever/switch off/on pairs. And type
 *   69, the known hint trigger, reads "reveals clues".
 *
 * WEAPONS — CS:0x1DC6 (file 0x1F56):
 *     1DC6  sub cx,0xc0
 *     1DCA  add cx,0x12e       ; 302
 *
 * WHY THE MAP'S BIG-ENDIAN TYPE CAN INDEX DIRECTLY — CS:0x373E (file 0x38CE)
 * byte-swaps the WHOLE object section at load:
 *     373E  mov di,0x7964 / mov cx,0x258 / lodsw / xchg al,ah / stosw / loop
 *   600 words = 200 records x 3 fields. This port reads big-endian at parse
 *   time, which is the same thing.
 *
 * MEASURED AGAINST SHIPPED DATA (all 8 levels): 1120 live objects
 * (130/136/170/171/118/115/130/150), 92 distinct types, 55 weapon pickups of
 * 9 distinct types, sprite indices spanning 170..312 — entirely inside the
 * `objects` group (POBJ1 #170..#330, POBJ2 #331..#449).
 *
 * PROOF 4 — the pictures match the words. `npm run objects` renders every
 * distinct type in a world beside its POBJECTS text: types 18-22 (the five
 * "* key" records) draw as key shapes, type 78 ("gold mask") draws a golden
 * mask, type 1 ("ceramic vase with blue stripe") draws a striped vase, and
 * type 50 ("spike arc") is the one 16x32 frame in the set. An arithmetic
 * error of even one would decouple every caption from its picture.
 *
 * A HAZARD THAT NEVER FIRES IN SHIPPED DATA: the stamp loop covers only 132
 * types, so a type in 132..191 would read an unstamped descriptor. Zero
 * shipped objects fall in that gap; the port reports rather than assumes it.
 */

/** CS:0x2234's base, and the weapon-pickup base from CS:0x1DC6. */
export const OBJECT_SPRITE_BASE = 170;   // 0xaa
export const WEAPON_SPRITE_BASE = 302;   // 0x12e
export const WEAPON_TYPE_MIN    = 0xC0;
export const STAMPED_TYPES      = 132;   // CS:0x223A `mov cx,0x84`

export const spriteForType = (type) =>
  type >= WEAPON_TYPE_MIN
    ? WEAPON_SPRITE_BASE + (type - WEAPON_TYPE_MIN)
    : OBJECT_SPRITE_BASE + type;

/** True when the type has no stamped descriptor (never true in shipped data). */
export const isUnstamped = (type) => type < WEAPON_TYPE_MIN && type >= STAMPED_TYPES;

/* Category codes, from POBJECTS record +4 (big-endian u16). Verified
 * byte-identical to the EXE's own table at DS:0xef78 for all 132 records in
 * all four worlds — 528/528 — so the port reads them from the shipped asset
 * rather than from the executable. */
export const CATEGORY = {
  CONSUMABLE: 0, TREASURE: 1, KEY: 2, LEVER: 3, SPECIAL4: 4, SPECIAL5: 5,
};

/** Parse the 132 category codes out of a decompressed POBJECTS.00x. */
export function parseObjectCategories(buf) {
  const cats = new Uint8Array(STAMPED_TYPES);
  for (let i = 0; i < STAMPED_TYPES; i++) cats[i] = (buf[i * 48 + 4] << 8) | buf[i * 48 + 5];
  return cats;
}

/* A record is DEAD when its type is negative — CS:0x9000 `cmp word [si+0x4],0
 * / jns`. That is a SIGN test, not a compare against 0xFFFF, and consumed
 * slots are created by storing 0xFFFF. */
export const isDeadType = (type) => (type & 0x8000) !== 0;

/**
 * Draw order, from graphics export 32 (VGA:0x06F0).
 *
 * It is a bubble pass over adjacent pairs, and the outcome is THREE-way, not
 * a two-way category partition. Reading the branch targets:
 *     06FD  cmp ax,0    / js  0x743   -> SWAP   (dead slot)
 *     0702  cmp ax,0xc0 / jnl 0x743   -> SWAP   (weapon pickup)
 *     072B  cmp word [si+0x4],3 / jz 0x775   -> no swap (k is cat 3)
 *     0731  cmp word [si+0x4],5 / jz 0x775   -> no swap (k is cat 5)
 *     0737  cmp word [di+0x4],3 / jz 0x743   -> SWAP   (k+1 is cat 3)
 * A swap pushes record k LATER, so the settled order is:
 *
 *     cat 3 and cat 5 first (behind)  ->  ordinary objects  ->  weapons and
 *     dead slots last (on top)
 *
 * A stable cat3/cat5 partition leaves the 55 shipped weapon pickups where
 * they started and gets their z-order wrong, which is why this is modelled as
 * a three-band key rather than a boolean.
 */
export function drawRank(type, category) {
  if (isDeadType(type) || type >= WEAPON_TYPE_MIN) return 2;   // last, on top
  if (category === CATEGORY.LEVER || category === CATEGORY.SPECIAL5) return 0;  // behind
  return 1;
}

/** Stable sort of a level's objects into the original's draw order. */
export function sortForDraw(objects, cats) {
  return objects
    .map((o, i) => ({ o, i, rank: drawRank(o.type, cats[o.type] ?? -1) }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((e) => e.o);
}

/* ── The RUNTIME object array, DS:0x8314 — 200 records of EIGHT bytes ──────
 *
 * The .MAP's 200 six-byte records are not what the game walks. CS:0x8FEF
 * expands them into an 8-byte array, and the extra word is what makes both
 * the crouch pickup and the chest burst work:
 *
 *     8FF2  mov si,0x7964 / mov di,0x8314 / mov cx,0xc8 / mov ax,0xffff
 *     9000  cmp word [si+0x4],0x0 / jns 0x900e     ; DEAD (sign, not ==0xFFFF)
 *     9006  stosw / stosw / stosw / add si,6       ;   -> x,y,type all 0xFFFF
 *     900E  movsw / movsw / movsw                  ; ALIVE -> copy x,y,type
 *     9011  mov word [di],0x0 / inc di / inc di    ; +6 := 0  FOR EVERY RECORD
 *
 * ⚠️ SO `+6` STARTS AT ZERO AND IS NOT PART OF THE MAP. It is recomputed by
 * the activation pass CS:0x11D3, which walks all 200 records against a box
 * held at SS:0x418..0x41E (the scroll origin snapped to 32x16, minus 0x40 /
 * 0x30, plus 0x180) and does:
 *     1203  test byte [si+6],1 / pushf / or byte [si+6],1 / popf
 *     120D  jnz next                    ; already active -> nothing more
 *     120F  mov byte [bp+0],0xff        ; first frame in the box: mark dirty
 *     1215  mov word [si+6],0x0         ; dead, or OUTSIDE the box -> clear
 *
 * So `+6` means **"currently inside the activation box"**, not a sticky
 * "seen" flag — an object that scrolls off has it cleared again. Three
 * consumers gate on it: the draw walk (CS:0x14A1, as a BYTE), the crouch key
 * pickup (CS:0x6088, as a WORD) and the burst settle, which creates objects
 * with it already set (CS:0x13D0) so they are live the instant they land.
 *
 * ⚠️ The byte/word read asymmetry is real and the chest path writes the whole
 * word (CS:0x18E8, CS:0x191C). This port models `+6` as a plain flag; whether
 * bits above 0 ever carry meaning is UNKNOWN_object_flag6_bits — there are
 * 120 writes at displacement 6 in the image and most belong to other
 * structures, so a claim either way needs the exhaustive attribution this
 * project applied to the `.DAT` word2 field, and that has not been done.
 */
export const OBJECT_SLOTS = 200;          // CS:0x8FFA `mov cx,0xc8`
export const OBJECT_STRIDE = 8;           // CS:0x38E5 / CS:0x60AF `add si,8`

/* CS:0x11A1-0x11CE — the box, held at SS:0x418..0x41E:
 *     11A8  and ax,0xffe0 / and bx,0xfff0     ; the scroll origin, SNAPPED
 *     11B2  sub ax,0x40 / sub bx,0x30         ; xMin, yMin
 *     11B8  add cx,0x180 / add dx,0xf0        ; xMax, yMax
 * 448 x 288 around a 320x200 screen, and all four compares are `jl`/`jg`, so
 * both ends are INCLUSIVE. */
export const ACTIVATION_MARGIN =
  Object.freeze({ xMin: -0x40, yMin: -0x30, xMax: 0x180, yMax: 0xf0 });

/** CS:0x1187/0x1176 — the box is recomputed only when the camera has moved a
 *  full 32 px in either axis (`and ax,0x1f / jnz`, and `test ax,0x20` against
 *  the Y remembered in DS:0x164), so it lags the camera by up to a tile. */
export const ACTIVATION_STEP = 0x20;

export function activationBox(camX, camY) {
  const ax = camX & 0xffe0, by = camY & 0xfff0;
  return { xMin: ax + ACTIVATION_MARGIN.xMin, yMin: by + ACTIVATION_MARGIN.yMin,
           xMax: ax + ACTIVATION_MARGIN.xMax, yMax: by + ACTIVATION_MARGIN.yMax };
}

/** CS:0x11D3. Returns how many objects entered the box this pass. */
export function activateObjects(objects, box) {
  let newly = 0;
  for (const o of objects) {
    const out = o.dead || isDeadType(o.type)
      || o.x < box.xMin || o.x > box.xMax || o.y < box.yMin || o.y > box.yMax;
    if (out) { o.flag6 = 0; continue; }            // CS:0x1215 — NOT sticky
    if (!(o.flag6 & 1)) newly++;                   // CS:0x120F marks it dirty
    o.flag6 |= 1;                                  // CS:0x1208
  }
  return newly;
}

/** CS:0x8FEF — map records -> the 200-slot runtime array. */
export function expandMapObjects(mapObjects) {
  const out = [];
  for (let i = 0; i < OBJECT_SLOTS; i++) {
    const m = mapObjects[i];
    if (!m || isDeadType(m.type)) {
      out.push({ x: 0xffff, y: 0xffff, type: 0xffff, flag6: 0, dead: true, slot: i });
    } else {
      out.push({ x: m.x, y: m.y, type: m.type, flag6: 0, dead: false, slot: i });
    }
  }
  return out;
}

/* CS:0x38D7 — first-fit over the 200 slots, testing the SIGN of the type:
 *     38DF  cmp word [si+0x4],0x0 / js 0x38ea      ; free
 *     38E5  add si,0x8 / loop
 *     38EA  dec cx / mov dx,0xc7 / sub dx,cx       ; dx = the slot INDEX
 *     38F2  or cx,cx / ret                         ; ZF set = table full
 * Note the caller reads the result through the zero flag, not a pointer test,
 * and `dx` is what the dirty-mark at CS:0x13DB indexes. */
export function allocObject(slots) {
  for (const s of slots) {
    if (s.dead || isDeadType(s.type)) {
      s.dead = false; s.flag6 = 0;
      return s;
    }
  }
  return null;                                   // CS:0x38F2 `or cx,cx` -> ZF
}

/* ⚠️ A NEWLY ALLOCATED OBJECT MUST BE RE-RANKED, NOT APPENDED.
 *
 * The original holds one fixed 200-slot array and re-partitions it every frame
 * through graphics export 32, so a slot the allocator hands out is sorted with
 * everything else on the very next pass. This port sorts once at level load
 * (there is no per-frame partition to hang it off), so an object created at
 * runtime — chest loot, an ACT0 trigger spawn — lands at the END of a
 * pre-sorted array, drawing ON TOP of the weapon pickups. Export 32 puts
 * ordinary treasure BEHIND them.
 *
 * This is the same z-order failure this file already records from the other
 * side: a stable cat-3/cat-5 partition leaves the 55 shipped weapon pickups
 * where they started and gets them wrong too. */
export function insertSpawned(objects, cats, spawned) {
  return sortForDraw([...objects, spawned], cats);
}

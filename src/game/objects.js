import { attrAtPixel, CELL_SOLID } from '../formats/map.js';

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

/**
 * The single per-object DRAW sequence, spikes included INLINE at their
 * already-sorted position — CS:0x1432 (the per-object walker) calls
 * CS:0x1534, which dispatches category 4 straight to CS:0x1B5B, at the
 * object's own place in the SAME array-order walk as every other object.
 * There is no "draw all spikes last" pass in the original — `sortForDraw`'s
 * stable rank-1 band already interleaves spikes with ordinary objects by
 * original array index, so a caller that special-cases spikes into a
 * separate later pass silently puts every spike permanently in front of any
 * same-or-lower-rank object with a HIGHER array index that should draw
 * after (in front of) it.
 *
 * @param {Array} drawObjects  `sortForDraw`'s own output.
 * @param {(type:number)=>boolean} isSpikeType
 * @param {Set} liveSpikeSet  the objects `stepSpikes` marked alive THIS
 *   tick (its own dead/`flag6` activation-box gate) — a spike-typed object
 *   absent from this set is omitted entirely, matching the original's
 *   per-object activation check, not drawn out of position.
 * @returns {Array<{obj:object, spike:boolean}>}
 */
export function buildDrawSequence(drawObjects, isSpikeType, liveSpikeSet) {
  const seq = [];
  for (const o of drawObjects) {
    if (o.dead) continue;
    if (isSpikeType(o.type)) {
      if (liveSpikeSet.has(o)) seq.push({ obj: o, spike: true });
      continue;
    }
    seq.push({ obj: o, spike: false });
  }
  return seq;
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

/** DS:0x379 (the "already recomputed at this X column" latch) and DS:0x164
 *  (camera Y at the last recompute). `force` stands for the direct
 *  `call 0x1196` sites that skip the gate: level entry CS:0x00B7 and
 *  CS:0x901C, respawn CS:0x08EB, teleport CS:0x1015, sublevel-B switch
 *  CS:0x4867. */
export function newActivationGate() { return { armed: 0, lastCamY: 0, force: true }; }

/** CS:0x1187-0x1196 — true when this tick recomputes the box. Between
 *  recomputes `+6` is left alone: objects stay active after leaving the
 *  box, and a freshly spawned one waits for the next recompute.
 *      1187  test [0xa],0x1f / jnz 1171   ; off-column: [0x379]:=0, try Y
 *      118F  cmp [0x379],0 / jnz 1176     ; already done at this column: try Y
 *      1176  |[0xc]-[0x164]| / test ax,0x20 / jnz 1196   (a BIT test, not >=) */
export function activationDue(g, camX, camY) {
  let due = g.force;
  if (!due) {
    if (camX & 0x1f) g.armed = 0;
    else if (!g.armed) due = true;
    if (!due) due = (Math.abs(camY - g.lastCamY) & ACTIVATION_STEP) !== 0;
  }
  if (due) { g.force = false; g.armed = 1; g.lastCamY = camY; }   // CS:0x1196/0x119E
  return due;
}

export function activationBox(camX, camY) {
  const ax = camX & 0xffe0, by = camY & 0xfff0;
  return { xMin: ax + ACTIVATION_MARGIN.xMin, yMin: by + ACTIVATION_MARGIN.yMin,
           xMax: ax + ACTIVATION_MARGIN.xMax, yMax: by + ACTIVATION_MARGIN.yMax };
}

/** CS:0x11D3. Returns how many objects entered the box this pass. `cats` is
 *  optional (omit it and objects never start falling) so this stays callable
 *  from every existing test that doesn't care about fall physics. When
 *  given, it arms `o.fallDirty` on the SAME inactive->active edge CS:0x120F
 *  marks dirty — see `isFallEligible`/`stepObjectFall` below. */
export function activateObjects(objects, box, cats) {
  let newly = 0;
  for (const o of objects) {
    const out = o.dead || isDeadType(o.type)
      || o.x < box.xMin || o.x > box.xMax || o.y < box.yMin || o.y > box.yMax;
    if (out) { o.flag6 = 0; continue; }            // CS:0x1215 — NOT sticky
    if (!(o.flag6 & 1)) {
      newly++;                                     // CS:0x120F marks it dirty
      if (cats && isFallEligible(o.type, cats)) o.fallDirty = -1;   // SS:0x438 := 0xFF, same instant
    }
    o.flag6 |= 1;                                  // CS:0x1208
  }
  return newly;
}

/* ── Object fall physics — CS:0x1511-0x1631 ────────────────────────────────
 *
 * Reported live: "in the DOS version the items don't stay up in the air but
 * fall down once they come into view." A per-object-slot dirty byte at
 * SS:0x438+slotIndex — already on record elsewhere in this project as an
 * under-documented scratch array — turns out to drive a small fall/bounce
 * state machine, armed to 0xFF on the SAME inactive->active transition
 * `activateObjects` already marks (CS:0x120F, immediately after CS:0x1208).
 *
 * THE PROBE — CS:0x1554-0x15CB, read byte-for-byte off the live disassembly.
 * Two columns are tested for solid ground one row BELOW the object
 * (`y + 0x10`): col1 = the object's own column, col2 a straddle column 0xF
 * px to the right (the same threshold the hero's own wall probes use). Once
 * ground is found, the SAME column's own row (`y`, un-incremented — provably
 * the row directly above the ground row) is re-tested for embedding. The
 * branch structure is ASYMMETRIC — when col1 has no ground below it, col1's
 * own row is never re-tested at all, only col2's:
 *
 *     groundCol1 true  -> embedded = ownCol1 || ownCol2
 *     groundCol1 false -> embedded = groundCol2 && ownCol2   (ownCol1 UNTESTED)
 *     neither column has ground below                        -> always falls
 *
 * "Landed" additionally requires row alignment — CS:0x15CB-15D4 test
 * `y & 0xC === 0` (y is always kept a multiple of 4 by the fall step below),
 * so even a supported object keeps stepping by 4px until it reaches an exact
 * 16px row boundary before it is allowed to rest.
 *
 * THE FALL STEP — CS:0x1587: `y = (y + 4) & 0xFFFC` every tick it is
 * unsupported or unaligned; CS:0x1598 destroys the object once
 * `y >= 0x400` (1024, the documented world height) — type := 0xFFFF,
 * flag6 := 0.
 *
 * THE BOUNCE — CS:0x13F7-0x142A. On landing the dirty byte resets to 0
 * (unless already the terminal 24) and a 24-entry signed Y-delta table at
 * DS:0xdf2c is walked, ADDING each entry to the object's real Y once per
 * tick. Read live via `read_memory("1ffd:df2c", 24)` — note 1ffd, not 1000,
 * per this project's own DS-segment warning — and confirmed BYTE-IDENTICAL
 * to the already-documented time-bomb settling-bounce table. There is no
 * shipped audio engine, so the accompanying sound-cue table at SS:0x5450
 * (which only gates whether a thud plays, never motion) is dropped.
 *
 * THE TERMINAL STATE — once the dirty byte clamps at 24 (0x18), CS:0x142D
 * jumps straight back into the ground probe every tick forever, bypassing
 * the sign test that starts the cycle, with no reset: if a supporting block
 * is later destroyed, the very next probe finds no ground and the object
 * re-enters the fall step, re-arming the sentinel. Essentially free once the
 * probe exists, so it is kept rather than treated as a one-shot.
 *
 * WHY CATEGORY >= 3 NEVER VISIBLY MOVES — CS:0x1526 caches the object's
 * pre-tick Y into a scratch word (SS:0x432) before ANY of the above runs,
 * and CS:0x1613 restores it from that scratch word whenever the type is
 * < 0xC0 (not a weapon) and the POBJECTS category is >= 3 (levers, and
 * categories 4/5). Every sub-path above — the fall step, the bounce-delta
 * add, and the terminal re-probe — funnels through the SAME shared tail at
 * CS:0x15F1 before this restore is reached, so the undo is unconditional: a
 * lever's dirty byte silently ticks through its whole fall/bounce cycle
 * every time it is (re)activated, but its Y is pinned back every single
 * tick and it never actually moves. So this port applies the gate UP FRONT
 * (`isFallEligible`) instead of computing motion it would only discard.
 *
 * ⚠️ Weapon pickups (type >= 0xC0) skip the category test entirely
 * (CS:0x15F5 `cmp cx,0xc0 / jl ... / jmp 0x1da0`), so they always fall.
 */

/** CS:0x13FF `mov di,0xdf2c` — confirmed byte-identical to the already-
 *  documented time-bomb settling-bounce table via a live `read_memory` at
 *  "1ffd:df2c" (24 bytes: fc fd fe ff 00 01 02 03 04 fd fe ff 00 01 02 03
 *  fe ff 00 01 02 ff 00 01). */
export const BOUNCE_DELTA = Object.freeze([
  -4, -3, -2, -1, 0, 1, 2, 3, 4,
  -3, -2, -1, 0, 1, 2, 3,
  -2, -1, 0, 1, 2,
  -1, 0, 1,
]);

export const FALL_STEP = 4;             // CS:0x1587 `add word [si+2],0x4`
export const WORLD_HEIGHT = 0x400;      // CS:0x1598, the documented 1024px world height
export const STRADDLE_OFFSET = 0xF;     // CS:0x1565/0x15AE `add ax,0xf`
export const BOUNCE_TERMINAL = 24;      // CS:0x141B/0x141E `cmp dl,0x18 / jl` — clamp

/** CS:0x160D/0x1621/0x15F5 — type<0xC0 && category>=3 never falls (see the
 *  block comment above); weapons (type>=0xC0) always fall. `cats` is the
 *  132-entry array `parseObjectCategories` returns; a type it has no entry
 *  for is treated as not fall-eligible, matching the loader's own 132-type
 *  stamp limit. */
export function isFallEligible(type, cats) {
  if (type >= WEAPON_TYPE_MIN) return true;
  const cat = cats ? cats[type] : undefined;
  return cat !== undefined && cat < CATEGORY.LEVER;
}

/** CS:0x1554-0x15CB — the ground/embed probe, reading `attrAtPixel` exactly
 *  as the original addresses plane B (floored column, floored row — see
 *  map.js). Returns true only for a genuine landing: supported AND
 *  row-aligned. */
function isGrounded(map, x, y) {
  const groundCol1 = attrAtPixel(map, x, y + 0x10) === CELL_SOLID;
  const groundCol2 = attrAtPixel(map, x + STRADDLE_OFFSET, y + 0x10) === CELL_SOLID;
  let embedded;
  if (groundCol1) {
    const ownCol1 = attrAtPixel(map, x, y) === CELL_SOLID;
    embedded = ownCol1 || attrAtPixel(map, x + STRADDLE_OFFSET, y) === CELL_SOLID;
  } else if (groundCol2) {
    embedded = attrAtPixel(map, x + STRADDLE_OFFSET, y) === CELL_SOLID;   // ownCol1 UNTESTED — CS:0x1561-0x1585
  } else {
    return false;                                     // no ground on either column -> falling
  }
  return !embedded && (y & 0xC) === 0;                 // CS:0x15CE-0x15D4 — row-alignment gate
}

/**
 * CS:0x1511-0x1631, one object, one tick. `o.fallDirty` mirrors SS:0x438:
 *   undefined -> not in the fall system (never activated, or category >= 3)
 *   -1        -> the 0xFF sentinel: run the ground probe this tick
 *   0..23     -> mid-bounce, apply BOUNCE_DELTA[o.fallDirty]
 *   24        -> settled; re-probe every tick (CS:0x142D `jmp 0x1534`)
 * Must run before the pickup contact test each tick, matching CS:0x0206's
 * per-object walk (fall/bounce, THEN CS:0x168E's pickup call, same object,
 * same frame) — see main.js.
 *
 * ⚠️ CATEGORY >= 3 NEVER MOVES, EVEN WITH THE SENTINEL ARMED. `[PROVEN]` live.
 * The walker saves y at CS:0x1516 (`mov ss:[0432],bx`) BEFORE the dirty
 * test, and both motion paths — the fall (CS:0x1587) and the bounce
 * (CS:0x1416, `jmp 0x15F1` at CS:0x142A) — end at CS:0x15F1, which reads
 * the POBJECTS category (`cmp byte [di+4],3 / jl`) and for a non-weapon
 * category >= 3 does `mov cx,ss:[0432] / mov [si+2],cx`: the move is undone.
 * CS:0xC041 arms 0xFF for EVERY landing, so this is what keeps a dropped
 * category-4 spike (the id-0x3D snap, selector-2 class 30 in PLEV1A/1B) at
 * its snapped row: live, y went 368 -> 372 at CS:0x15F1 and was 368 again
 * next tick, dirty still 0xFF (tools/attract-capture/sel2contact.py). The
 * port used to let it fall 16px into the floor. The world-height kill
 * (CS:0x1598) runs before the restore, so it is kept.
 * @param {Object<number,number>} [cats]  POBJECTS categories by type
 */
export function stepObjectFall(map, o, cats) {
  if (o.fallDirty === undefined || o.dead) return;
  const y0 = o.y;
  stepMotion(map, o);
  if (!o.dead && o.type < WEAPON_TYPE_MIN && cats && (cats[o.type] ?? -1) >= CATEGORY.LEVER) {
    o.y = y0;                                          // CS:0x15F1-0x15F8
  }
}

function stepMotion(map, o) {
  if (o.fallDirty === -1 || o.fallDirty === BOUNCE_TERMINAL) {
    if (isGrounded(map, o.x, o.y)) {
      if (o.fallDirty !== BOUNCE_TERMINAL) o.fallDirty = 0;   // CS:0x15E0 — start the bounce (else stays 24, CS:0x15DE)
      return;
    }
    o.y = (o.y + FALL_STEP) & 0xFFFC;                  // CS:0x1587-0x158F
    o.fallDirty = -1;                                  // CS:0x158B — re-arm the sentinel
    if (o.y >= WORLD_HEIGHT) {                          // CS:0x1598-0x15A3
      o.dead = true; o.type = 0xffff; o.flag6 = 0;
    }
    return;
  }
  o.y += BOUNCE_DELTA[o.fallDirty];                     // CS:0x1416
  o.fallDirty = Math.min(o.fallDirty + 1, BOUNCE_TERMINAL);   // CS:0x1419-0x1420
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
  /* First fit in SLOT order, not array order: the port keeps the table in
   * draw order, so the lowest `slot` index stands for CS:0x38DF's walk. */
  let best = null;
  for (const s of slots) {
    if (!(s.dead || isDeadType(s.type))) continue;
    if (best === null || (s.slot ?? Infinity) < (best.slot ?? Infinity)) best = s;
  }
  if (!best) return null;                        // CS:0x38F2 `or cx,cx` -> ZF
  best.dead = false; best.flag6 = 0;
  return best;
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

/**
 * CS:0xC041-0xC08C — the shared "drop a carried/recovered item back into the
 * world" allocator. Built on the SAME dead-slot-reuse mechanism as CS:0x38D7
 * (`allocObject`), not the treasure-burst's push-based alloc — C041 calls
 * 38D7 directly (`0xC048 call 0x1000:38d7`).
 *
 *     C041  ax=worldX bx=worldY cx=recoveredId
 *     C044  call 0x38d7                    ; -> bp=slot, dx=index; ZF set = full
 *     C04B  jns 0xc04b                     ; (sign flag from 38D7 survives
 *                                          ;   the intervening `pop cx`, which
 *                                          ;   doesn't touch flags)
 *     C051  cmp cx,0xb / jnl 0xc060        ; id < 0xB -> WEAPON, id+0xC0
 *     C058  add cx,0xc0
 *     C060  sub cx,0xb                     ; id >= 0xB -> ORDINARY, id-0xB
 *     C066  [bp+0]=ax [bp+2]=bx [bp+4]=cx [bp+6]=1
 *     C08x  SS:0x438+slotIndex := 0xFF     ; arm the fall-physics sentinel
 *     (full table -> jmp 0xbf7f, a shared bare ret)
 *
 * This is the OPPOSITE-direction decode of what every caller computes before
 * calling in (carriedType+0xB ordinary / carriedType-0xC0 weapon) — the
 * round-trip is exact: (t+0xB)-0xB=t and (t-0xC0)+0xC0=t.
 *
 * ⚠️ Weapons are unreachable via this port's marker producer: stepMarkers
 * (markers.js:166) skips type>=0xC0, so no marker this port can ever build
 * names a weapon, and `id<0xB` can never arise from a stolen item's own type
 * in practice. Implemented anyway for fidelity (a directly-constructed
 * weapon marker, or a future caller, would still round-trip correctly) —
 * this branch is not exercised by normal play.
 *
 * @param {object[]} slots  the 200-slot object array (dead-slot-reuse)
 * @param {number} id       the recovered id, EXACTLY as the caller built it
 *                          (carriedType+0xB ordinary / carriedType-0xC0 weapon)
 * @param {number} x        world X
 * @param {number} y        world Y
 * @returns {object|null}   the slot written, or null on a full table (CS:0xBF7F)
 */
export function dropCarriedItem(slots, id, x, y) {
  const slot = allocObject(slots);
  if (!slot) return null;                           // CS:0xC04B `jns` fails -> bf7f
  const type = id < 0xB ? id + 0xC0 : id - 0xB;      // CS:0xC051-0xC060
  slot.x = x;
  slot.y = y;
  slot.type = type;
  slot.flag6 = 1;                                    // CS:0xC06E
  slot.fallDirty = -1;                               // SS:0x438+idx := 0xFF
  return slot;
}

/* ── THE ROTATING CRYSTAL — type 54 ("teleport stone"), CS:0x16E5 `[STATIC]` ──
 *
 * The ordinary (category < 3) object draw is NOT one flat blit. CS:0x1669
 * loads the STAMPED SPRITE ID out of the runtime descriptor and dispatches
 * on it, with four animated arms:
 *
 *     1669  mov cx,[di]              ; di = 0x2a4e + type*10 -> sprite 170+type
 *     166b  cmp cx,0xfd  / jz 1699   ; 253  -> DS:0xdfa6[DS:0x39e mod 5]
 *     1671  cmp cx,0xe0  / jz 16e5   ; 224  -> THE CRYSTAL, below
 *     1677  cmp cx,0x117 / jz 16ac   ; 279  -> DS:0xdf9e[DS:0x39d mod 4], y-8
 *     167d  cmp cx,0x118 / jz 16d1   ; 280  -> DS:0xdf96[DS:0x39d mod 4], y-8
 *     1683  [0x4]=screenX ; [0x6]=screenY ; [0x8]=sprite
 *     168e  call 0x177d              ; pickup contact (FIXED offsets — the
 *                                    ;   animated frame cannot move the box)
 *     1691  call 0x356e              ; masked blit, export 2
 *
 * THE CRYSTAL ARM, CS:0x16E5-0x16F7 — 8 frames, base sprite plus seven:
 *
 *     16e5  cmp byte [0x3a0],0 / jz 0x1683   ; phase 0 -> CX unchanged (224)
 *     16ec  mov cl,[0x3a0] / xor ch,ch
 *     16f2  add cx,0x193               ; +403
 *     16f6  dec cx                     ; CX = 402 + phase  -> 403..409
 *
 *   frame table = [224, 403, 404, 405, 406, 407, 408, 409]
 *
 * The eight frames rendered out of the shipped atlases (POBJ1 #54, then
 * POBJ2 #72..78) are the same gem at progressively narrower widths, edge-on
 * around 405-407 and widening again by 408 — one revolution. No Y offset on
 * this arm (the 0x117/0x118 arms do `sub bx,8` at CS:0x16BB; this one does
 * not).
 *
 * ⚠️ NO POSITION PHASE. Unlike the category-5 scenery idiom
 * (`((worldX >> 5) + tick) & 3`, docs/destructible-and-hazards.md), the index
 * here is the GLOBAL counter alone, so every type-54 object in a level spins
 * in lockstep:
 *
 *     CS:0x148B  inc byte [0x3a0]
 *     CS:0x148F  and byte [0x3a0],0x7      ; once per frame, in FUN_1000_1432
 *
 * and that increment sits OUTSIDE the `cmp byte [0x36c],0` parity gate at
 * CS:0x1450 that wraps DS:0x39c/0x39d/0x39e — so the crystal advances every
 * tick, 8 ticks (~0.53 s at 15 Hz) per revolution. An exhaustive
 * search_instructions sweep for the operand `0x3a0` over all 19453
 * instructions returns exactly four hits — the two above and the two in the
 * draw arm — so no direct-offset write resets DS:0x3a0 anywhere in the image.
 * That sweep cannot see a bulk BSS clear (a `rep stosw` spanning 0x3a0 would
 * not appear as an operand), so "free-runs from BSS zero for the whole
 * session" is an inference, not a proof; the starting phase is not observable
 * either way, which is why this port treats it like leverToggle and
 * spikeClock above it.
 *
 * SHIPPED CENSUS: type 54 is placed 14x — PLEV1A (1031,546) and (41,850),
 * PLEV1B x1, PLEV2A x5, PLEV3A x6 — matching consumables.js's own
 * independently recorded `placed: 14`. THREE of PLEV3A's six, at world
 * (70,144), (134,144) and (197,144), are on screen at that level's spawn
 * camera (0,0), which is where this animation is easiest to see; the spin
 * frames are 16x16 against the base sprite's 16x15, so at y=144 they occupy
 * rows 144..159 — the bottom row of the playfield, flush against the status
 * panel, not clipped by it. PLEV1A's (41,850) stone is fall-eligible and
 * settles at y=868, so at the world-1 spawn camera (0,864) it draws at screen
 * (41,4) — fully on screen, measured live in this port by instrumenting the
 * object draw loop. That is the crystal the DOSBox comparison was made
 * against.
 *
 * ⚠️ THE OTHER THREE ARMS ARE READ BUT DELIBERATELY NOT WIRED.
 *   · sprite 253 (type 83, placed 8x): table DS:0xdfa6 = {253,433,434,435,436},
 *     index DS:0x39e mod 5. DS:0x39e only advances on the `[0x36c]==0` branch
 *     of CS:0x1450, and DS:0x36c's per-frame toggle site is not established
 *     (three `not byte [0x36c]` sites exist: CS:0x0172, CS:0x6C9E, CS:0x9221).
 *     Porting it would mean guessing the rate. UNKNOWN_36c_parity.
 *   · sprites 279/280 (types 109/110): tables DS:0xdf9e = {279,397,398,399}
 *     and DS:0xdf96 = {280,400,401,402}, index DS:0x39d mod 4, `sub bx,8`,
 *     export 1; the 0x118 arm also `call 0x16f9` (side effects unread). Both
 *     types are placed ZERO times in all eight shipped maps, so neither arm is
 *     reachable from this walk — the same disposition this project already
 *     recorded for popup ids 0x94/0x95.
 *   All four tables were read directly (read_memory `1ffd:df96`, 32 bytes) and
 *   sit end to end with the category-5 jump table at DS:0xdfb0 with zero
 *   slack — a three-way boundary cross-check.
 */

/** CS:0x1671 `cmp cx,0xe0` — sprite 224 = 170 + type 54 ("teleport stone"). */
export const CRYSTAL_SPRITE = 224;
/** CS:0x16F2 `add cx,0x193` followed by CS:0x16F6 `dec cx` — 403 - 1. */
export const CRYSTAL_SPIN_BASE = 402;
/** CS:0x148F `and byte [0x3a0],0x7`. */
export const CRYSTAL_PERIOD = 8;

/** DS:0x3a0 — CS:0x148B/0x148F. One global 0..7 counter, advanced once per
 *  frame, unconditional (outside CS:0x1450's DS:0x36c parity gate). */
export class ObjectAnimClock {
  constructor() { this.frame3a0 = 0; }
  step() { this.frame3a0 = (this.frame3a0 + 1) & (CRYSTAL_PERIOD - 1); }
}

/** CS:0x16E5-0x16F7. Phase 0 is the BASE sprite (the `jz 0x1683` leaves CX
 *  alone); phases 1..7 are 402 + phase = 403..409. */
export function crystalSprite(frame3a0) {
  return frame3a0 === 0 ? CRYSTAL_SPRITE : CRYSTAL_SPIN_BASE + frame3a0;
}

/** CS:0x1669's sprite-id dispatch, the one arm this port wires: sprite 224
 *  animates, everything else draws its stamped id unchanged. The other three
 *  arms (253 / 279 / 280) are documented above and deliberately left out. */
export function animatedObjectSprite(spriteId, clock) {
  return spriteId === CRYSTAL_SPRITE ? crystalSprite(clock.frame3a0) : spriteId;
}

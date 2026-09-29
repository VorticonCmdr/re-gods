/* trigger-actions.js — the 15 trigger ACTION verbs, SS:0x3592.
 *
 * The companion to trigger.js, which ports the 17 CONDITION predicates. Until
 * this file existed the port evaluated every trigger correctly and then did
 * nothing with the verdict, so no door ever opened, no gate ever moved and no
 * level could be completed — ACT4 is the level-exit zone.
 *
 * The evaluator does NOT call the handler: CS:0x3A56 `jmp bp` TAIL-JUMPS into
 * it, with three shared steps run first (CS:0x39FE-0x3A43). Those three are
 * modelled in fireTrigger() below, not duplicated into each verb.
 *
 * ─── SEVEN TRAPS THIS ENCODES ────────────────────────────────────────────────
 *
 * 1. ⚠️ ACT8's miss guard is DEAD, and the shipped data reaches it.
 *    CS:0x410c reports "no such gate" with `mov cx,0xffff / stc / ret`. Neither
 *    instruction touches SF, and the only SF-setter on the path is `add si,0x6`
 *    over a table at 0x2f8c (always positive) — so SF is 0 on every return.
 *    ACT7 tests `jc` and is correct. ACT8 tests `js` (CS:0x4189) and therefore
 *    NEVER takes its miss branch.
 *      The table is exactly 20*6 = 120 bytes at 0x2f8c, and 0x2f8c + 0x78 =
 *      0x3004 — the plane A base. So on a miss ACT8's `mov word [si+0x4],0x0`
 *      writes a zero WORD into plane A cells 4 and 5, then closes a door at its
 *      own coordinates regardless.
 *    Measured over the 8 shipped maps: ACT7 60 records, 52 hit / 8 miss (all 8
 *    correctly do nothing); ACT8 48 records, 43 hit / 5 MISS — PLEV1A #43 #45,
 *    PLEV1B #45, PLEV2A #43, PLEV2B #43. This fires in worlds 1 and 2.
 *
 * 2. ⚠️ ACT2's `add ax,0xc` is annihilated. CS:0x4285 adds 12 to an
 *    already-`& 0xffe0` value, and CS:0x4298 masks with 0xffe0 AGAIN before
 *    using it. 12 < 32, so the add cannot survive. ACT9 has no add and lands on
 *    the same cell — which is what makes open and close agree. Implementing the
 *    +12 puts every door-open one tile right of its door-close.
 *
 * 3. ⚠️ Opening a door clears THREE plane-B cells, not six. CS:0x42D1-0x42E3
 *    writes the left column only (+0, +0x80, +0x100) even though six plane-A
 *    tiles are written. The right half of an open door stays solid.
 *
 * 4. ⚠️ The door tile block strides +10 per row, not +1 — it is a 2x3 rectangle
 *    on the 10-COLUMN tile sheet. Self-checking: under the proven 1-based plane
 *    A rule (tile = planeA - 1) all four worlds' constants land on a clean
 *    2-wide, 3-tall rectangle. World 1's 59 -> sheet row 5 cols 8,9.
 *
 * 5. ⚠️ ACT9's right column does NOT increment. Left column is t, t+10, t+20
 *    from DS:0x150; all three right cells are the SAME tile from DS:0x156
 *    (CS:0x4323-0x432C, three stores, no `inc al` between). Mirroring ACT2's
 *    structure into ACT9 gets this wrong.
 *
 * 6. ⚠️ ACT3 and ACT4 share one array but disagree on its length. Both scan
 *    DS:0x8f68 for a free slot — ACT4 over 10 records (CS:0x3D17 `mov cx,0xa`),
 *    ACT3 over 20 (CS:0x3D5B `mov cx,0x14`). The duplicate guard CS:0x4257
 *    scans 10. So a teleport zone can be allocated into slots 10..19 where the
 *    guard cannot see it, and the exit-zone verb cannot reach those slots at
 *    all. Unifying the counts changes which zone wins.
 *
 * 7. ⚠️ The duplicate guard aborts its CALLER, not itself. CS:0x4272
 *    `add sp,0x2` discards the return address, so a hit returns past ACT3/ACT4
 *    entirely and no zone is written. Modelled here as a boolean the caller
 *    must honour.
 *
 * Two deliberate divergences, both reported through ctx.onDiverge rather than
 * reproduced, following the precedent trigger.js set for its unbounded
 * cond_kind dispatch:
 *   - ACT8's out-of-bounds plane A write is CLAMPED (it is a real out-of-array
 *     store in the original; here it would corrupt the map view).
 *   - ACT5 recursion is depth-limited. The original terminates naturally
 *     because a fired trigger consumes its EVENT RECORD, but nothing in the
 *     hardware prevents a cycle through records that never fire.
 */

import { verbOf, consumesInventory, consumesKey } from './trigger.js';
import { allocObject, WEAPON_TYPE_MIN, CATEGORY } from './objects.js';
import { KillSmoke } from './kill-smoke.js';

/* ── The per-world door / gate tile constants ────────────────────────────────
 * CS:0x2C64 is the ONLY writer of DS:0x14e — an exhaustive scan of the code
 * segment finds five reads and no other write:
 *     2C64  mov al,[0x42] / dec al / cbw      ; world 1..4 -> 0..3
 *     2C6A  mov si,0xe8da
 *     2C6D  shl ax,1 / shl ax,1 / add si,ax   ; \  ax*4 + ax*8
 *     2C73  shl ax,1 / add si,ax              ; /  = ax*12
 *     2C79  mov di,0x14e / mov cx,0x6 / rep movsw
 * so DS:0xe8da is 4 worlds x 6 words, copied to DS:0x14e..0x159. Read out of
 * GAME.EXE at file offset 0x1EA3A (DS:0xe8da via `file = linear - 0xFE70`).
 *
 * Word 5 (+0x158) is 519/519/519/520 — a sprite id, not a tile index. It is
 * loaded by the same rep movsw but none of these five handlers reads it. */
export const DOOR_TILES = [
  /* world 1 */ { open2: 59, close9: 56, gateOpen: 3,   gateClose: 32, close9Right: 7,  spare: 519 },
  /* world 2 */ { open2: 91, close9: 85, gateOpen: 60,  gateClose: 76, close9Right: 2,  spare: 519 },
  /* world 3 */ { open2: 71, close9: 43, gateOpen: 34,  gateClose: 33, close9Right: 4,  spare: 519 },
  /* world 4 */ { open2: 96, close9: 43, gateOpen: 108, gateClose: 98, close9Right: 75, spare: 520 },
];

/* Sound ids, as the handlers pass them to CS:0x22ca. */
export const SFX = {
  ACT0_SPAWN:     0x1e15,
  ACT3_TELEPORT:  0x0537,
  ACT2_DOOR_OPEN: 0x0537,
  ACT9_DOOR_SHUT: 0x053f,
  ACT7_GATE_OPEN: 0x0548,
  ACT8_GATE_SHUT: 0x052e,
  ACT6_KILL:      0x0f22,
};

export const ZONE_BASE_SLOTS = 20;    // ACT3 CS:0x3D5B `mov cx,0x14`
export const EXIT_SCAN_SLOTS = 10;    // ACT4 CS:0x3D17 `mov cx,0xa`
export const DUP_SCAN_SLOTS  = 10;    // CS:0x425C `mov cx,0xa`
export const GATE_SLOTS      = 20;    // CS:0x410F `mov cx,0x14`
/* The DS:0x8c3c slot count lives in game/kill-smoke.js (`SLOTS`), with the
 * walker that reads it — one owner, so the two cannot drift apart. */
export const KILL_MAX        = 2;     // CS:0x3CBA `cmp byte [0x3a6],0x2`

export const ZONE_TELEPORT = 1;       // CS:0x3D8A
export const ZONE_EXIT     = 3;       // CS:0x3D47

const PLANE_A_CELLS = 8192;

/** Fresh zone array — DS:0x8f68, 20 x {x, y, kind, arg}; free when kind < 0. */
export const makeZones = () =>
  Array.from({ length: ZONE_BASE_SLOTS }, () => ({ x: 0, y: 0, kind: -1, arg: 0 }));

/* The DS:0x8c3c kill list is no longer a bare array: it animates, so it owns
 * its own walker. See game/kill-smoke.js — `KillSmoke`, imported above. */

/**
 * The gate table, DS:0x2f8c.
 *
 * ⚠️ THIS IS THE TRAPDOOR TABLE, not a separate array. CS:0x40C0 is one
 * routine that both seeds this and patches the map:
 *     40C5  mov si,0xa82c / mov di,0x2f8c / mov cx,0x14
 *     40D0  lodsw / xchg al,ah / stosw      x3      ; BE -> native, {x, y, open}
 *     40E2  cmp dx,0 / js 0x4109                    ; negative x = empty slot
 *     40E7..4106                                    ; patch plane A and plane B
 * so DS:0xa82c is the big-endian PALFILS +0x1824 window and DS:0x2f8c is its
 * native runtime copy. ACT7 and ACT8 therefore open and close TRAP DOORS —
 * which is the mechanism behind the shipped message "a trap door closes
 * beneath you". The project notes document both halves separately and never
 * connect them.
 *
 * Note all 20 records are copied, including the negative terminators; only the
 * map patch is skipped for those.
 */
export function makeGates(palfilsBuf) {
  const dv = new DataView(palfilsBuf.buffer, palfilsBuf.byteOffset, palfilsBuf.byteLength);
  const out = [];
  for (let i = 0; i < GATE_SLOTS; i++) {
    const o = 0x1824 + i * 6;
    out.push({
      x: dv.getUint16(o, false),
      y: dv.getUint16(o + 2, false),
      open: dv.getUint16(o + 4, false),
    });
  }
  return out;
}

/* CS:0x410c — exact (x, y) match over the 20 gate records.
 * Returns the index, or -1. The CALLER decides what a miss means, and the two
 * callers disagree; see trap 1. */
function findGate(gates, x, y) {
  for (let i = 0; i < GATE_SLOTS; i++) {
    if (gates[i].x === x && gates[i].y === y) return i;
  }
  return -1;
}

/* The cell index the door/gate verbs compute. Verbatim CS:0x4157 / CS:0x4298:
 *     sar ax,1 (x5)      -> x >> 5
 *     shl bx,1 (x3)      -> y * 8
 *     add si,ax / add si,bx
 * Note y is multiplied by 8, NOT divided into a row and multiplied by 128.
 * Those agree only because every shipped coordinate is a multiple of 16
 * (y*8 == (y>>4)*128 exactly when y % 16 == 0). Reproduced as written. */
const cellOf = (x, y) => (x >> 5) + (y << 3);

/** ACT2/ACT9 both derive their cell this way (CS:0x427F, CS:0x42F0). */
const doorCell = (t) => cellOf((t.x & 0xffe0), ((t.y + 8) & 0xfff0));

/* ── The three shared prologue steps, CS:0x39FE-0x3A43 ─────────────────────── */

/* CS:0x3b81 — clear whichever of the four inventory words holds `id`, first
 * match only, then mark the display dirty (call 0x228e). */
function clearInventory(ctx, id) {
  for (let i = 0; i < ctx.inventory.length; i++) {
    if (ctx.inventory[i] === id) { ctx.inventory[i] = 0xffff; ctx.displayDirty = true; return true; }
  }
  return false;
}

/* CS:0x3aeb — the KEY consume. Runs only for verbs {2,3,4,7,8}, and only on
 * condition slots whose kind is 1 (item IS held) whose arg names a key:
 *     3B13  cmp word [di+0x2],0x12 / jl skip     ; < 18
 *     3B19  cmp word [di+0x2],0x17 / jng take    ; <= 23  -> the six key types
 *     3B1F  cmp word [di+0x2],0x7f / jl skip     ; < 127
 *     3B25  cmp word [di+0x2],0x81 / jg skip     ; > 129
 * i.e. arg in [0x12,0x17] union [0x7f,0x81]. Types 18/19/20 are door, treasure
 * and world key; 21/22/23 are the three chest keys. */
function consumeKeys(t, ctx) {
  for (let i = 0; i < 3; i++) {
    if (t.condKind[i] !== 1) continue;
    const a = t.condArg[i];
    const isKey = (a >= 0x12 && a <= 0x17) || (a >= 0x7f && a <= 0x81);
    if (isKey) clearInventory(ctx, a);
  }
}

/* CS:0x3a69 -> 0x3a94 — the INVENTORY consume. Runs only when the action's
 * bit 15 is set. For each kind-1 slot it looks the arg up as an object id in
 * the 10-byte runtime descriptor array DS:0x2a4e and consumes it only if that
 * descriptor's CATEGORY (+4) is 2 (keys) or 0 (consumables):
 *     3AA6  cmp word [si+0x4],0x2 / jz  take
 *     3AAC  cmp word [si+0x4],0x0 / jnz skip
 * Unlike consumeKeys this clears EVERY matching inventory word, not the first
 * (CS:0x3AB6-0x3AE0 is four independent compares with no early exit). */
function consumeInventory(t, ctx) {
  for (let i = 0; i < 3; i++) {
    if (t.condKind[i] !== 1) continue;
    const id = t.condArg[i];
    const cat = ctx.categoryOf ? ctx.categoryOf(id) : null;
    if (cat !== 2 && cat !== 0) continue;
    let any = false;
    for (let k = 0; k < ctx.inventory.length; k++) {
      if (ctx.inventory[k] === id) { ctx.inventory[k] = 0xffff; any = true; }
    }
    if (any) ctx.displayDirty = true;
  }
}

/* ── The 15 verbs ───────────────────────────────────────────────────────────── */

/* ACT0, CS:0x3da1 — spawn an object of type `arg` at the trigger's point.
 * 203 records, the commonest verb. Three per-type special cases sit between the
 * allocation and the sound, and they are easy to miss:
 *     3DCC  cmp cx,0x40 / jl / cmp cx,0x44 / jng 0x3e07   ; types 64..68: RETURN
 *     3DD6  cmp cx,0x53 / jnz / mov byte [0x361],0x1      ; type 83: shop summon
 *     3DF3  si = 0xef78 + cx / cmp byte [si],0x4 / jz     ; category 4: NO sound
 * Types 64..68 are allocated and placed but get no sparkle, no sound and no
 * DS:0x21e record. */
function act0(t, ctx) {
  const type = t.actionArg;
  const slot = allocObject(ctx.objects);
  if (!slot) return { verb: 0, ok: false, reason: 'object table full' };

  slot.x = t.x; slot.y = t.y; slot.type = type; slot.flag6 = 1;
  ctx.dirty[slot.slot] = 0xff;                       // DS:0x438 + dx
  /* CS:0x3DC3-0x3DC8 — that same 0xFF is the fall-physics sentinel, so a
   * fall-eligible spawn (a weapon, or category < 3) drops to the ground like
   * an activated map object. The port's fall reads `fallDirty`, which ACT0
   * never set, so the item hung where the trigger placed it. [PROVEN]
   * against PJOYL2 cursors 1807-1813 (trigger 61, 317 -> 340). ACT1
   * (CS:0x3E08) writes no dirty byte and stays put. */
  slot.fallDirty = -1;   // every category: the walk restores y for category >= 3 (objects.js)
  ctx.spawned.push(slot);

  if (type >= 0x40 && type <= 0x44) return { verb: 0, ok: true, type, quiet: true };
  if (type === 0x53) ctx.shopSummon = true;          // DS:0x361

  ctx.last = { x: t.x, y: t.y, type };               // DS:0x21e / 0x220 / 0x222
  ctx.sparkPhase = 0;                                // DS:0x34f
  if (ctx.categoryOf && ctx.categoryOf(type) !== 4) ctx.sfx(SFX.ACT0_SPAWN);
  return { verb: 0, ok: true, type };
}

/* ACT1, CS:0x3e08 — spawn a WEAPON pickup; the stored type is arg + 0xC0.
 * ⚠️ Its allocator-failure branch is NOT ACT0's. ACT0 jumps to a bare `ret`
 * (CS:0x3DAF -> 0x3e07); ACT1 jumps to CS:0x3E2E, which still records the
 * position and type into DS:0x21e and still clears DS:0x34f. */
function act1(t, ctx) {
  const type = (t.actionArg + 0xc0) & 0xffff;
  const slot = ctx.alloc();
  if (slot) {
    slot.x = t.x; slot.y = t.y; slot.type = type; slot.flag6 = 1; slot.dead = false;
    ctx.spawned.push(slot);
  }
  ctx.last = { x: t.x, y: t.y, type };
  ctx.sparkPhase = 0;
  return { verb: 1, ok: !!slot, type };
}

/* ACT2, CS:0x4276 -> 0x4294 — open a 2x3 door. See traps 2, 3 and 4.
 *     42AF  al = [0x14e]      [si]      = al
 *     42B4  inc al            [si+1]    = al
 *     42B9  add al,9          [si+0x80] = al        ; +10 from the base
 *     42BF  inc al            [si+0x81] = al
 *     42C5  add al,9          [si+0x100]= al        ; +20
 *     42CB  inc al            [si+0x101]= al
 * AL is a BYTE, so the sequence wraps at 256. */
function act2(t, ctx) {
  const c = doorCell(t);
  const tiles = ctx.tiles;
  let al = tiles.open2 & 0xff;
  const put = (o, v) => { if (c + o >= 0 && c + o < PLANE_A_CELLS) ctx.planeA[c + o] = v; };
  put(0, al);                       al = (al + 1) & 0xff;
  put(1, al);                       al = (al + 9) & 0xff;
  put(0x80, al);                    al = (al + 1) & 0xff;
  put(0x81, al);                    al = (al + 9) & 0xff;
  put(0x100, al);                   al = (al + 1) & 0xff;
  put(0x101, al);
  /* trap 3 — the LEFT column only. */
  for (const o of [0, 0x80, 0x100]) {
    if (c + o >= 0 && c + o < PLANE_A_CELLS) ctx.planeB[c + o] = 0;
  }
  ctx.sfx(SFX.ACT2_DOOR_OPEN);
  return { verb: 2, ok: true, cell: c };
}

/* ACT9, CS:0x42e7 — close a 2x3 door. See trap 5: the right column is one tile
 * repeated three times, from a DIFFERENT constant than the left column. */
function act9(t, ctx) {
  const c = doorCell(t);
  const tiles = ctx.tiles;
  const put = (o, v) => { if (c + o >= 0 && c + o < PLANE_A_CELLS) ctx.planeA[c + o] = v; };
  let al = tiles.close9 & 0xff;
  put(0, al);        al = (al + 0xa) & 0xff;
  put(0x80, al);     al = (al + 0xa) & 0xff;
  put(0x100, al);
  const r = tiles.close9Right & 0xff;                 // no increment — trap 5
  put(1, r); put(0x81, r); put(0x101, r);
  for (const o of [0, 0x80, 0x100]) {
    if (c + o >= 0 && c + o < PLANE_A_CELLS) ctx.planeB[c + o] = 1;
  }
  ctx.sfx(SFX.ACT9_DOOR_SHUT);
  return { verb: 9, ok: true, cell: c };
}

/* CS:0x4257 — the duplicate-zone guard. Scans only the FIRST TEN slots for a
 * zone already at (x, y). See trap 7: a hit does `add sp,0x2`, discarding its
 * own return address so that the CALLER returns too. */
const zoneExists = (zones, x, y) => {
  for (let i = 0; i < DUP_SCAN_SLOTS; i++) {
    if (zones[i].x === x && zones[i].y === y) return true;
  }
  return false;
};

/* ACT3 (CS:0x3d56, kind 1, teleport) and ACT4 (CS:0x3d12, kind 3, level exit)
 * share every line but three: the free-slot scan length, the kind word, and
 * ACT3's sound. See trap 6.
 *     3D6B  ax = [di+0xc] ; bx = [di+0xe] + 8
 *     3D74  and ax,0xffe0 ; and bx,0xfff0
 *     3D7A  sub ax,0x10                      <- AFTER the mask, so it survives
 * (unlike ACT2's +12 — nothing masks ax again here). */
function makeZone(t, ctx, slots, kind) {
  const verb = kind === ZONE_EXIT ? 4 : 3;
  let idx = -1;
  for (let i = 0; i < slots; i++) if (ctx.zones[i].kind < 0) { idx = i; break; }
  if (idx < 0) return { verb, ok: false, reason: 'no free zone slot' };

  const x = ((t.x & 0xffe0) - 0x10) & 0xffff;
  const y = (t.y + 8) & 0xfff0;
  if (zoneExists(ctx.zones, x, y)) {
    return { verb, ok: false, reason: 'duplicate zone — caller aborted' };
  }
  const z = ctx.zones[idx];
  z.x = x; z.y = y; z.kind = kind; z.arg = t.actionArg;
  if (kind === ZONE_TELEPORT) ctx.sfx(SFX.ACT3_TELEPORT);
  return { verb, ok: true, slot: idx, x, y, arg: t.actionArg };
}

/* ACT6, CS:0x3bd1 — kill up to TWO category-4 objects within +/-12 px of the
 * trigger's point, appending each to the 4-slot list at DS:0x8c3c.
 *     3BDC  ax -= 0xc / bx -= 0xc / cx += 0xc / dx += 0xc   ; the box
 *     3C2F  cmp byte [di+0x4],0x4                            ; category 4 only
 *     3C65  cmp word [si+0x4],0x60 / jnz                     ; type 96 -> y -= 8
 *     3CB6  inc byte [0x3a6] / cmp 0x2 / jz done             ; the <= 2 bound
 * The appended record is {0, x - 8, y}. */
function act6(t, ctx) {
  const killed = killCategory4InBox(ctx, t.x - 12, t.y - 12, t.x + 12, t.y + 12);
  return { verb: 6, ok: killed > 0, killed };
}

/**
 * CS:0x3BE8-0x3CC6 — ACT6's body past its own box setup. The time bomb's
 * blast jumps straight here (CS:0xA31A) with its own box, so the two share
 * it. Returns how many objects it killed (at most KILL_MAX).
 */
export function killCategory4InBox(ctx, x0, y0, x1, y1) {
  let killed = 0;
  /* CS:0x3C02-0x3C18 — the free-slot search runs ONCE, before the object
   * scan, and each kill then writes at the cursor and advances it without
   * searching again. See game/kill-smoke.js for why that shape is load-
   * bearing rather than an implementation detail. */
  let cursor = ctx.killSmoke ? ctx.killSmoke.openCursor() : -1;
  for (const o of ctx.objects) {
    if (killed >= KILL_MAX) break;
    if (o.dead || (o.type & 0x8000)) continue;
    if (!ctx.categoryOf || ctx.categoryOf(o.type) !== 4) continue;
    if (x0 > o.x || x1 < o.x || y0 > o.y || y1 < o.y) continue;

    /* ⚠️ Capture the type BEFORE the kill: CS:0x3C65 tests it, and CS:0x3C6B
     * then overwrites it with 0xFFFF. Reading it back after the store makes
     * the type-96 branch unreachable. */
    const wasType = o.type;
    o.dead = true; o.type = 0xffff; o.flag6 = 0;
    if (ctx.killSmoke) {
      /* CS:0x3C75 `sub ax,8`, and CS:0x3C89 `sub word [bp-0x2],0x8` — the
       * extra 8 on Y is the type-0x60 arm only. */
      cursor = ctx.killSmoke.seedAt(cursor, (o.x - 8) & 0xffff,
                                    o.y - (wasType === 0x60 ? 8 : 0));
    }
    ctx.sfx(SFX.ACT6_KILL);
    killed++;
  }
  return killed;
}

/* ACT7, CS:0x4144 — open a trap door. The `jc` guard is correct: a miss
 * returns without touching anything. */
function act7(t, ctx) {
  const g = findGate(ctx.gates, t.x, t.y);
  if (g < 0) return { verb: 7, ok: false, reason: 'no gate record at (x,y)' };
  ctx.gates[g].open = 1;
  const c = cellOf(t.x, t.y);
  if (c >= 0 && c < PLANE_A_CELLS) {
    ctx.planeA[c] = ctx.tiles.gateOpen & 0xff;
    ctx.planeB[c] = 0;
  }
  ctx.sfx(SFX.ACT7_GATE_OPEN);
  return { verb: 7, ok: true, gate: g, cell: c };
}

/* ACT8, CS:0x4180 — close a trap door. See trap 1: the miss guard is dead, so
 * this ALWAYS acts. On a miss the original's `si` has walked to 0x3004 (the
 * plane A base) and `mov word [si+0x4],0x0` clears plane A cells 4 and 5. That
 * out-of-array store is the one thing here we clamp rather than reproduce. */
function act8(t, ctx) {
  const g = findGate(ctx.gates, t.x, t.y);
  if (g >= 0) {
    ctx.gates[g].open = 0;
  } else {
    /* The dead-guard path. 5 of the 48 shipped ACT8 records land here. */
    ctx.onDiverge('ACT8 miss: original clears plane A cells 4-5 via si=0x3004');
  }
  const c = cellOf(t.x, t.y);
  if (c >= 0 && c < PLANE_A_CELLS) {
    ctx.planeA[c] = ctx.tiles.gateClose & 0xff;
    ctx.planeB[c] = 1;
  }
  ctx.sfx(SFX.ACT8_GATE_SHUT);
  return { verb: 8, ok: true, gate: g, cell: c, missed: g < 0 };
}

/* ACT10, CS:0x3e3f — clear whichever of the three weapon slots holds `arg`.
 * First match only: each arm ends in its own `ret`. */
function act10(t, ctx) {
  for (let i = 0; i < ctx.weaponSlots.length; i++) {
    if (ctx.weaponSlots[i] === t.actionArg) {
      ctx.weaponSlots[i] = 0xffff;
      /* ⚠️ ctx.weaponSlots is a plain number array, so for a host whose real
       * arsenal lives elsewhere this write lands on a DETACHED COPY. The hook
       * is what actually disarms the hero; without it ACT10 looks like it
       * works — the result record says ok, and any check that reads the same
       * copy agrees — while the weapon stays in the slot. */
      ctx.clearWeaponSlot(i);
      return { verb: 10, ok: true, slot: i };
    }
  }
  return { verb: 10, ok: false };
}

/** The dispatch table, SS:0x3592. Index = action & 0x7fff. */
export const ACTION_NAMES = [
  'spawn object', 'spawn weapon pickup', 'open door', 'teleport zone',
  'level-exit zone', 'dispatch event', 'kill category-4 objects',
  'trap door open', 'trap door close', 'close door', 'clear weapon slot',
  'no-op (CS:0x3bcf)', 'no-op (CS:0x3bd0)', 'message / gate only (CS:0x3bc1)',
  'zero the level timer',
];

/**
 * Run one ACTION verb. Assumes the caller has already run the shared prologue.
 * @returns {object} a result record describing what happened.
 */
export function runAction(t, ctx) {
  const verb = verbOf(t);
  switch (verb) {
    case 0:  return act0(t, ctx);
    case 1:  return act1(t, ctx);
    case 2:  return act2(t, ctx);
    case 3:  return makeZone(t, ctx, ZONE_BASE_SLOTS, ZONE_TELEPORT);
    case 4:  return makeZone(t, ctx, EXIT_SCAN_SLOTS, ZONE_EXIT);
    case 5:  return { verb: 5, ok: true, dispatch: (t.actionArg - 1) & 0xffff };
    case 6:  return act6(t, ctx);
    case 7:  return act7(t, ctx);
    case 8:  return act8(t, ctx);
    case 9:  return act9(t, ctx);
    case 10: return act10(t, ctx);

    /* CS:0x3bcf, 0x3bd0, 0x3bc1 — three separate single `C3` bytes. Verb 13
     * carries 77 shipped records, 52 of them with real message text
     * ("treasure room", "you need the treasure key"), so it is the
     * message-only / precondition-gate verb rather than dead weight. */
    case 11: case 12: case 13:
      return { verb, ok: true, noop: true };

    /* CS:0x3bc2 — `mov word [0x11e],0 / mov word [0x120],0`, the 32-bit timer
     * that COND9/COND10 divide by 17. */
    case 14:
      ctx.timer = 0;
      return { verb: 14, ok: true };

    default:
      /* The original has no bounds check here either (CS:0x3A4E just indexes
       * SS:0x3592) — but every shipped action is 0..14, so this is unreachable
       * in real data and clamping costs nothing. */
      ctx.onDiverge(`action verb ${verb} out of the 15-entry table`);
      return { verb, ok: false, reason: 'out of range' };
  }
}

/**
 * The full firing sequence, CS:0x39FE onward: consume, message, key-consume,
 * inventory-consume, then tail-jump into the verb.
 *
 * ⚠️ THE ORDER MATTERS. Both consume passes run BEFORE the handler, so a verb
 * that reads the inventory sees it already emptied.
 */
export function fireTrigger(t, ctx) {
  /* CS:0x3A0B — the message. The guard is the SIGN of the DS:0xac00 offset
   * word plus an empty-string test on the arena string, not `id != 0`; the
   * port's map parser already folds both into a null message. */
  const msg = ctx.messages ? (ctx.messages[t.messageId] || null) : null;
  if (msg) ctx.showMessage(msg);

  if (consumesKey(verbOf(t))) consumeKeys(t, ctx);
  if (consumesInventory(t))   consumeInventory(t, ctx);

  const res = runAction(t, ctx);
  res.msg = msg;
  return res;
}

/** A context with everything the verbs touch, for tests and for the host. */
export function makeActionContext(over = {}) {
  const ctx = {
    planeA: new Uint8Array(PLANE_A_CELLS),
    planeB: new Uint8Array(PLANE_A_CELLS),
    objects: [],
    spawned: [],
    dirty: new Uint8Array(200),          // DS:0x438
    zones: makeZones(),
    gates: [],
    killSmoke: new KillSmoke(),
    inventory: [0xffff, 0xffff, 0xffff, 0xffff],
    weaponSlots: [0xffff, 0xffff, 0xffff],
    tiles: DOOR_TILES[0],
    messages: null,
    timer: 0,
    displayDirty: false,
    shopSummon: false,
    last: null,
    sparkPhase: 0,
    categoryOf: null,
    sfx: () => {},
    showMessage: () => {},
    clearWeaponSlot: () => {},
    onDiverge: () => {},
    /* CS:0x38D7. Overridable because the host holds its object array in a
     * different shape than the tests do; the default is the plain allocator. */
    alloc: null,
    ...over,
  };
  if (!ctx.alloc) ctx.alloc = () => allocObject(ctx.objects);
  return ctx;
}

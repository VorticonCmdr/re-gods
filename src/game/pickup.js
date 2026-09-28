/* pickup.js — how the hero arms himself.
 *
 * The fire chain was wired end to end before this module existed and still
 * could not be used in play, because CS:0x914c leaves all three weapon slots
 * empty and nothing else seeds them: a weapon can only come from one of the
 * 55 weapon-pickup objects the eight maps place (type >= 0xC0).
 *
 * ── ⚠️ A CORRECTION THIS MODULE FORCED ──────────────────────────────────
 *
 * This project recorded CS:0x1045 — the routine idle+FIRE calls — as "the
 * 200-record object-pickup walk". It is NOT pickup. Reading it through:
 *
 *     1065  mov si,0x8314 / mov cx,0xc8     ; 200 records, stride 8
 *     1077  mov ax,[si+0x4]                 ; the object type
 *     107A  di = 0x2a4e + type*10           ; its runtime descriptor
 *     1087  cmp byte [di+0x4],0x3 / jnz     ; CATEGORY 3 ONLY
 *     10C5  xor byte [si+0x4],0x1           ; …and flip bit 0 of the type
 *     10C9  xor byte [ds:bp+0x4],0x1
 *
 * Category 3 is levers/switches, and "xor bit 0 of the type" is exactly the
 * lever toggle this project documented separately (types 24/25 = lever off/on,
 * 26/27 = switch off/on). So **idle + FIRE operates a lever you are standing
 * on**, and pickup has no fire-button gate at all — it happens on contact.
 *
 * ── THE CONTACT TEST, CS:0x177d `[PROVEN]` ──────────────────────────────
 *
 *     177D  cmp word [0x19a],0 / js reject   ; the BAR, and strictly negative
 *     1787  cx = [0x17a] ; dx = [0x17c]      ; hero world position
 *     178F  cx -= [0xa] ; dx -= [0xc]        ; -> hero SCREEN position
 *     1799  add ax,0x8 / add bx,0x8          ; the OBJECT's screen position + 8
 *     179F  sub cx,0x4  / 17A2 add di,0x24   ; the X window
 *     17A5  cmp ax,cx / jl reject
 *     17A9  cmp ax,di / jg reject
 *     17AD  di = dx ; sub dx,4 ; add di,0x34 ; the Y window
 *     17B5  cmp bx,dx / jl reject
 *     17B9  cmp bx,di / jng ACCEPT
 *
 * Both sides are converted to screen space and then differenced, so the camera
 * cancels and the test is equivalent in world space. Folding the +8 in gives a
 * 40 x 56 window around the hero's top-left — slightly larger than his 32 x 48
 * body, and NOT symmetric.
 *
 * ⚠️ The gate is `js`, i.e. **strictly** negative: a bar of exactly 0 still
 * allows a pickup. Same shape as the damage guard, and the opposite of the
 * death test, which fires at `<= 0`. Three neighbouring reads of the same
 * variable with three different boundaries.
 */

import { armWeapon, pickUpAgain } from './weapons.js';
import { isDeadType, CATEGORY } from './objects.js';
import { collectTreasure, INVENTORY_EMPTY, INVENTORY_SLOTS } from './treasure.js';
import { CONSUMABLES, WIRED, NOT_WIRED_REASON,
         applyConsumable } from './consumables.js';

/**
 * CS:0x17CA `cmp cx,0xC0` — the comparison, which applies to a LIVE type only.
 *
 * ⚠️ THIS IS NOT A THRESHOLD ABOVE WHICH EVERYTHING IS A WEAPON, and naming it
 * as one is how this port acquired 535 phantom pickups: a dead or unused slot
 * carries 0xFFFF, which passes `>= 0xC0` cheerfully. Ask through
 * `isWeaponPickup` instead — the sign test is not optional, and leaving the
 * bare constant as the way to ask invites the same bug back.
 */
const WEAPON_CMP = 0xc0;

/** The ONLY correct way to ask. CS:0x9000 `jns` first, then CS:0x17CA. */
export const isWeaponPickup = (type) => !isDeadType(type) && type >= WEAPON_CMP;

/** CS:0x192E `sub cx,0xc0` — the type -> weapon-index conversion. */
export const weaponIndexOf = (type) => type - WEAPON_CMP;

/** Object position minus hero position, inclusive on all four edges. */
export const PICKUP_BOX = { xMin: -12, xMax: 28, yMin: -12, yMax: 44 };

/** CS:0x1939's sound, played after the dispatcher returns. */
export const PICKUP_SFX = 0x0638;

/** CS:0x954F — weapon 2 (fireball) is hard-wired to slot C. */
export const FIREBALL = 2;
/** CS:0x95AE — and taking slot C sets the mover's tag base to slot C's. */
export const FIREBALL_TAG_BASE = 0x12;

/**
 * CS:0x177d. `hero` and `obj` are both WORLD positions.
 * @param {number} bar DS:0x19a — the DISPLAYED health bar, not the target.
 */
export function heroTouches(obj, hero, bar = 1) {
  if (bar < 0) return false;                       // CS:0x177D `js`
  const dx = obj.x - hero.x, dy = obj.y - hero.y;
  return dx >= PICKUP_BOX.xMin && dx <= PICKUP_BOX.xMax
      && dy >= PICKUP_BOX.yMin && dy <= PICKUP_BOX.yMax;
}

/**
 * CS:0x953e — which slot a newly collected weapon goes into.
 *
 * ⚠️ Weapon record `+0x00` is what decides slot A, and it is REAL FILE DATA,
 * not one of the pinned fields: the loader's save/restore pairs touch `+0x0c`
 * and `+0x1e` (CS:0x35b7 / 0x35d0) and `+0x08` (CS:0x367a), and none of them
 * reads displacement 0. Measured across ALL FOUR shipped files it reads
 * 0/1/1/1/1/0/0/0/1/1/0 — byte-identical in every world, so unlike +0x08 the
 * slot rule does not drift. Slot A is therefore reserved for knife, throwing
 * star, spear, axe and mace.
 *
 * @returns {number} 0, 1 or 2
 */
export function chooseSlot(arsenal, weaponIndex) {
  if (weaponIndex === FIREBALL) return 2;                     // CS:0x954F
  const w = arsenal.weapons[weaponIndex];
  if (w.slotAClass === 0) return 0;                           // CS:0x9554 -> 0x95A2
  if (arsenal.slots[1].weapon < 0) return 1;                  // CS:0x9559 `js`
  if (arsenal.slots[2].weapon < 0) return 2;                  // CS:0x9560 `jns`
  /* CS:0x956F-0x9598 — both full: replace whichever of B and C has the LOWER
   * pickup count, i.e. the one you have invested less in. `jl` is SIGNED and
   * STRICT, so a tie keeps B and replaces C. */
  const b = arsenal.slots[1].st.count, c = arsenal.slots[2].st.count;
  return b < c ? 1 : 2;                                       // CS:0x9596
}

/**
 * CS:0x94a7 — collect one weapon.
 *
 * ⚠️ THE TWO OUTCOMES ARE NOT THE SAME EVENT. Picking up a weapon you already
 * hold only does `inc word [di+0x8]` (CS:0x94E8) — the count rises, so the
 * volley and the per-hit damage both go up, and the projectile area is left
 * alone. A NEW weapon instead re-bases the count to Power (CS:0x9115, through
 * CS:0x90F9) and CLEARS that slot's 144-byte area (CS:0x9177), which
 * destroys any of the outgoing weapon's shots still in flight.
 *
 * There is no full-slots check anywhere on this path: CS:0x17D0 is the only
 * reference to CS:0x1924, and it jumps there unconditionally for any type
 * >= 0xC0. The selector always yields a slot because it replaces the weaker
 * of B and C, so a weapon is never left on the ground.
 */
export function pickUpWeapon(arsenal, weaponIndex) {
  /* ⚠️ A DELIBERATE DIVERGENCE, and it must not be a throw. The original
   * indexes DS:0xe2b6 with no range check, so a type outside 0xC0..0xCA would
   * read 80 bytes of whatever follows the table. The shipped maps only place
   * types 0xC0..0xC9 (9 distinct weapons across 55 pickups), but that is a
   * property of the DATA, not of the code — and this project already records
   * UNKNOWN_object_stamp_gap for types nothing stamps. Since this runs inside
   * the frame callback, a TypeError here kills the tick; count and skip, the
   * same treatment the out-of-range `dir` and the undecoded handler get. */
  if (!Number.isInteger(weaponIndex) || weaponIndex < 0
      || weaponIndex >= arsenal.weapons.length) {
    arsenal.badWeaponIndex = (arsenal.badWeaponIndex || 0) + 1;
    return null;
  }
  const held = arsenal.slots.findIndex((s) => s.weapon === weaponIndex);
  if (held >= 0) {                                  // CS:0x94A8..0x94B8
    arsenal.slots[held].st = pickUpAgain(arsenal.slots[held].st);   // CS:0x94E8
    return { slot: held, duplicate: true, count: arsenal.slots[held].st.count };
  }
  const n = chooseSlot(arsenal, weaponIndex);
  const s = arsenal.slots[n];
  const replaced = s.weapon;
  s.weapon = weaponIndex;                           // CS:0x94BD `mov [si],dx`
  s.st = armWeapon(arsenal.weapons[weaponIndex]);   // CS:0x94C5 -> CS:0x90F9
  s.clear();                                        // CS:0x94CE -> CS:0x9177
  if (weaponIndex === FIREBALL) arsenal.tagBase = FIREBALL_TAG_BASE;
  if (arsenal.onArmed) arsenal.onArmed();           // CS:0x94D4 -> 0xC35E (familiar.js)
  return { slot: n, duplicate: false, replaced, count: s.st.count };
}

/* ── CONSUMABLES (category 0), CS:0x17EE-0x184B `[PROVEN]` ───────────────
 *
 * ⚠️ THE HANDLER INDEX IS NOT THE OBJECT TYPE. It is the type's RANK among
 * category-0 types, computed by counting on the spot:
 *
 *     1801  ax = cx                       ; the type
 *     1804  si = 0xef78                   ; the 132-byte category table
 *     1807  bx = 0 ; dx = bx
 *     180B  or cx,cx / jz 0x1818          ; type 0 -> rank 0, and this guard
 *                                         ;   exists because `loop` with
 *                                         ;   cx = 0 would run 65536 times
 *     180F  cmp bl,[si] / jnz / inc dl    ; count the category-0 entries
 *     1815  inc si / loop 0x180f          ;   over types 0 .. type-1
 *     1818  shl dx,1
 *     1822  si = 0xd8b8 + dx / si = [si] / call si
 *
 * The count is STRICTLY BELOW the type, so type 0 is rank 0. Measured across
 * the shipped table there are exactly **23** category-0 types — and the table
 * at DS:0xd8b8 is exactly 23 entries wide before it runs into unrelated data
 * (0x50, 0x50, 0x50, 0x50, 0x05, 0x4f, ...). Census and table width agreeing
 * is what pins the size.
 *
 * ⚠️ THE OBJECT IS MARKED DEAD BEFORE THE HANDLER RUNS (CS:0x17F6), and the
 * refuse path returns the same `dx = 1` as success — so a potion taken at
 * negative health is consumed anyway and still shows its message.
 */
export const CONSUMABLE_TABLE_DS = 0xd8b8;

/* ⚠️ THE TABLE MOVED. All 23 handlers are now decoded and live in
 * game/consumables.js, with what each one does, whether this port wires it,
 * and how many times its type is actually placed across the eight maps —
 * seven of the 23 are placed ZERO times, so "decoded" and "reachable" are
 * different questions and the module keeps them apart.
 *
 * The two entries an earlier revision flagged as "pointing into the middle of
 * unrelated routines" both resolved: rank 14 (0x95b5) is the default-argument
 * entry of the weapon-arc copier, and rank 11 (0x5e9b) is a genuinely
 * unimplemented item — see consumables.js. */

/** CS:0x1801-0x1818 — the rank, counting category-0 types strictly below. */
export function consumableRank(type, cats) {
  let n = 0;
  for (let i = 0; i < type; i++) if (cats[i] === 0) n++;   // CS:0x180F
  return n;
}

/**
 * The per-frame walk. In the original this is part of the object pass at
 * CS:0x0206 (CS:0x1432), which runs BEFORE the projectile step at CS:0x020F
 * and before the player at CS:0x0254.
 *
 * ⚠️ SCOPE. CS:0x17C7 splits three ways: >= 0xC0 goes to the weapon path
 * (CS:0x1924), and below that the descriptor's CATEGORY decides — 0
 * (consumables) falls through at CS:0x17EE, 1 (treasure) goes to CS:0x184E,
 * and > 1 is REJECTED here. Weapons, consumables and treasure are all wired.
 *
 * ⚠️ CATEGORY >= 2 RETURNS WITH CARRY SET (CS:0x17C2 `stc`) while every other
 * exit returns carry CLEAR (CS:0x17BD `clc`). Neither of the two call sites
 * makes that mean "collected": CS:0x168E ignores the flag entirely and
 * CS:0x170D uses it inside a routine reached only for sprite 0x118. So a key
 * lying on the ground is NOT taken by walking into it. Keys go in through a
 * different control — CROUCH + FIRE, CS:0x4B1A/0x4B4F/0x4B8F/0x4BC4 ->
 * CS:0x6069, which scans the same 200 records against the hero's hot point
 * (X+16, Y+40) over an inclusive [objX-4, objX+20] x [objY-12, objY+16],
 * requires `[si+6] != 0` (on screen) and `category == 2` exactly, then stores
 * the TYPE into DS:0x17e + [0x366]*2. Now ported: `scanForKey`/`collectKey`
 * below, wired into `Player._crouch` (player.js) via CROUCH + FIRE, feeding
 * the hero's real inventory rather than a synthetic one.
 *
 * @param {Array} objects live map objects; a collected one gets `.dead = true`
 * @returns {{taken:Array}}
 */
export function stepPickups(objects, hero, arsenal, bar = 1,
                            { cats = null, health = null, treasure = null,
                              effects = null } = {}) {
  const taken = [], consumed = [], treasures = [];
  for (const o of objects) {
    if (o.dead) continue;                            // CS:0x1929 `[si+6] = 0`
    /* ⚠️ A DEAD SLOT IS 0xFFFF, WHICH IS ALSO >= 0xC0 — see isWeaponPickup. */
    if (isDeadType(o.type)) continue;                // CS:0x9000 `jns`
    /* CS:0x14A1 — the draw walk this pickup test hangs off gates on `+6`, so
     * an object outside the activation box is never even considered. It CANNOT
     * change a walk-in pickup (the box clears the hero's 40x56 window by 64 px
     * on every side, whatever the camera does), and it is load-bearing only
     * for the crouch key scan at CS:0x6088. Modelled anyway so the two agree.
     * `undefined` passes: a caller that does not run the activation pass gets
     * the pre-activation behaviour rather than a silently empty walk. */
    if (o.flag6 === 0) continue;

    if (o.type >= WEAPON_CMP) {                      // CS:0x17CA
      if (!heroTouches(o, hero, bar)) continue;
      o.dead = true;                                 // CS:0x1924 `[si+4] = 0xffff`
      const w = weaponIndexOf(o.type);               // CS:0x192E
      const r = pickUpWeapon(arsenal, w);
      if (r) taken.push({ ...r, weapon: w, sfx: PICKUP_SFX });
      continue;
    }
    if (!cats) continue;                             // categories not modelled
    /* CS:0x17E6 `cmp byte [di+0x4],1` — the CATEGORY decides. */
    const cat = cats[o.type];

    if (cat === CATEGORY.TREASURE) {                 // CS:0x17EC `jz 0x184e`
      if (!treasure) continue;
      if (!heroTouches(o, hero, bar)) continue;
      const value = treasure.values ? (treasure.values[o.type] ?? 0) : 0;
      const r = collectTreasure(o, { ...treasure, value });
      treasures.push(r);
      continue;
    }
    if (cat !== 0 || !health) continue;
    if (!heroTouches(o, hero, bar)) continue;

    /* ⚠️ DEAD FIRST, THEN DISPATCH — CS:0x17F6 precedes CS:0x1829, so a
     * handler that refuses still leaves the object consumed. */
    o.dead = true;
    const rank = consumableRank(o.type, cats);
    const h = CONSUMABLES[rank];
    if (!h) { consumed.push({ type: o.type, x: o.x, y: o.y, rank, unknownRank: true }); continue; }
    /* Every handler is decoded now, but only the WIRED ones have an effect
     * this port can apply — the rest are reported with the reason. */
    if (!WIRED.includes(h.effect)) {
      consumed.push({ type: o.type, x: o.x, y: o.y, rank, at: h.at, effect: h.effect,
                      name: h.name, desc: h.desc,
                      notWired: NOT_WIRED_REASON[h.effect] || 'not modelled' });
      continue;
    }
    const r = applyConsumable(h, { health, arsenal, ...(effects || {}) });
    consumed.push({ type: o.type, x: o.x, y: o.y, rank, effect: h.effect, name: h.name,
                    desc: h.desc, health: h.health, dx: h.dx,
                    taken: r ? (r.taken ?? true) : false,
                    banked: r ? (r.banked ?? 0) : 0, result: r,
                    sfx: PICKUP_SFX });
  }
  return { taken, consumed, treasures };
}

/* ── Keys (category 2) — CROUCH + FIRE, CS:0x6069 `[PROVEN]` ────────────────
 *
 * This is the gap the honesty note above names directly: keys are never
 * picked up by walking into them (CS:0x17E6 `jg` sends category >= 2 away
 * with `stc`, and neither caller of `stepPickups` turns that into a pickup).
 * The real control is CROUCH (player states 18/19) + FIRE, reached from
 * CS:0x4B1A/0x4B4F/0x4B8F/0x4BC4 -> CS:0x6069.
 *
 * ── THE HOT POINT, shared with CS:0x5B38 below ───────────────────────────
 * CS:0x6078/0x607B: `ax = heroX + 0x10 ; bx = heroY + 0x28` — the SAME two
 * constants CS:0x5B38 (the crouch-entry precondition) adds to the same pair
 * of registers, confirmed by disassembling both fresh, not assumed from one.
 *
 * ── THE SCAN, CS:0x6082-0x60E2 ────────────────────────────────────────────
 *     6082  cmp [si+4],0 / js next        ; dead slot
 *     6088  cmp [si+6],0 / jz next        ; not on screen
 *     608E  bp = [si]-4   ; cmp ax,bp / jl next     ; hotX <  objX-4  -> reject
 *     6097  bp += 0x18    ; cmp ax,bp / jg next     ; hotX >  objX+20 -> reject
 *     609E  bp = [si+2]-0xc ; cmp bx,bp / jl next   ; hotY <  objY-12 -> reject
 *     60A8  bp += 0x1c    ; cmp bx,bp / jle MATCH   ; hotY <= objY+16 -> MATCH
 *
 * ⚠️ INCLUSIVE ON ALL FOUR SIDES (`jl`/`jg`/`jle` at the tested corner), unlike
 * CS:0x5B38's crouch-entry check below, which is EXCLUSIVE on all four
 * (strict `<`/`>`, CS:0x5b5f/0x5b71 `jge`/`jle` REJECT, CS:0x5b77 `jg` ACCEPT).
 * Same box geometry — read fresh off both disassemblies — different boundary.
 *
 * ⚠️ THE WEAPON-ABORT-SCAN QUIRK, CS:0x60C3-0x60CA: once a MATCH's own type is
 * >= 0xC0 (a weapon), the scan does not skip it and keep looking — it ABORTS
 * THE WHOLE SCAN (`pop cx / jmp 0x5e9b`), with no pickup and no message. A
 * weapon sitting in the crouch hot point's box (it can: the box is wider than
 * the walk-in pickup window) makes a key later in scan order unreachable that
 * tick. Below 0xC0, the category table decides: `!= 2` just continues the
 * loop (CS:0x60D4 `jnz next`) — only category 2 exactly is ever taken.
 *
 * ⚠️ ONLY THE FIRST MATCH IS EVER CONSUMED. The object is marked dead THE
 * INSTANT it matches (CS:0x60D8/0x60DD), before FIRE is even tested — then,
 * if FIRE is NOT held, CS:0x60EB-0x60F3 PUTS IT BACK (`[si+4]=dx` restores the
 * type, `[si+6]=1` restores on-screen) and the scan ends there either way.
 * Crouching over a key without holding fire never advances to a second
 * candidate; it just leaves that one exactly as it was.
 *
 * ── THE INVENTORY WRITE — a DELIBERATE SUBSTITUTION, not a bug-for-bug port ─
 * CS:0x6100-0x610D: `di = 0x17e + [0x366]*2 ; [di] = type` — the key is
 * stored into DS:0x366's CURRENT VALUE, the SAME player-controlled slot-
 * selector cursor the (unported) 4-slot inventory panel cycles with
 * CS:0x612F/0x6134/0x615F. There is NO search for an empty slot anywhere in
 * this routine: the original always overwrites whichever slot the cursor is
 * parked on, seeded to 3 at boot (CS:0x048D `mov al,0x3` / CS:0x048F
 * `mov [0x366],al`, confirmed fresh).
 *
 * This port has no slot-selector UI — that panel is the disclosed cosmetic
 * cut this project already lists — so reproducing "always overwrite slot 3"
 * verbatim would mean a SECOND key of ANY kind permanently overwrites the
 * first with no way to move the cursor away first: strictly worse than the
 * bug actually reported ("can't collect and use keys at all"). `collectKey`
 * below substitutes first-empty-slot, falling back to the same slot 3 the
 * original boots into once every slot already holds a key. Because
 * `collectTreasure` (treasure.js) already matches a held key by VALUE across
 * all 4 slots rather than by position, this substitution cannot change
 * whether a key that IS collected later unlocks its chest — only which slot
 * (if any) a full inventory evicts.
 */

/** CS:0x6078/0x607B and CS:0x5B3B/0x5B3E — shared by the key scan and the
 *  crouch-entry precondition below. */
export function keyHotPoint(hero) {
  return { x: hero.x + 0x10, y: hero.y + 0x28 };
}

/**
 * The shared box shape, `[objX-4, objX+20] x [objY-12, objY+16]`.
 * @param {boolean} inclusive CS:0x6069 tests `<=`/`>=` at both far corners
 *   (true); CS:0x5B38 tests strict `<`/`>` on all four (false).
 */
function hotPointHitsBox(obj, hot, inclusive) {
  const minX = obj.x - 4, maxX = minX + 0x18;
  const minY = obj.y - 12, maxY = minY + 0x1c;
  if (inclusive) {
    return hot.x >= minX && hot.x <= maxX && hot.y >= minY && hot.y <= maxY;
  }
  return hot.x > minX && hot.x < maxX && hot.y > minY && hot.y < maxY;
}

/**
 * CS:0x5B38 — "is anything at all near the crouch hot point", called with
 * PRIORITY over the ladder-descend check from the walk states' own DOWN
 * handling (CS:0x598a `call 0x5b38 / jc <crouch>`, ahead of any map read).
 * No category filter — any live, on-screen object counts.
 */
export function objectNearHotPoint(objects, hero) {
  const hot = keyHotPoint(hero);
  for (const o of objects) {
    /* `o.dead` is this port's own live/dead flag (set by every collector —
     * `collectTreasure`, `pickUpWeapon`, this module's own `_crouch` caller);
     * `isDeadType` is the CS:0x9000 sign test on a STATIC type value. Check
     * both, exactly as `stepPickups` above does. */
    if (o.dead || isDeadType(o.type)) continue;   // CS:0x5b44 `js`
    if (!o.flag6) continue;                       // CS:0x5b4a `jz`
    if (hotPointHitsBox(o, hot, false)) return true;
  }
  return false;
}

/**
 * CS:0x6069's scan loop only — the crouch state's own gate (does the hero
 * hold FIRE this tick) is the CALLER's job, exactly as `_tryFire` already
 * separates entry from allocation elsewhere in this port.
 * @returns {?object} the first matching key object, or null.
 */
export function scanForKey(objects, cats, hero) {
  const hot = keyHotPoint(hero);
  for (const o of objects) {
    if (o.dead || isDeadType(o.type)) continue;   // CS:0x6086 `js`
    if (!o.flag6) continue;                       // CS:0x608c `jz`
    if (!hotPointHitsBox(o, hot, true)) continue;
    if (o.type >= WEAPON_CMP) return null;     // CS:0x60C7 — ABORT, not skip
    if (cats[o.type] !== CATEGORY.KEY) continue;   // CS:0x60CF `jnz next`
    return o;
  }
  return null;
}

/**
 * CS:0x6100-0x610D, SUBSTITUTED — see the module doc above for why. First
 * empty slot; CS:0x048F's own boot value (3, the last slot) if none is free.
 * @returns {number} the slot index written.
 */
export function collectKey(inventory, type) {
  let slot = inventory.findIndex((v) => v === INVENTORY_EMPTY);
  if (slot < 0) slot = INVENTORY_SLOTS - 1;
  inventory[slot] = type;
  return slot;
}

/* ── The attract-mode demo grants itself weapons — do NOT read that as the
 *    hero's starting loadout `[PROVEN]` ──────────────────────────────────
 *
 * CS:0x8FD2 calls the pickup dispatcher in a loop: weapon 2 five times, then
 * weapon 6 three times. Its only two callers are CS:0x8F9B and CS:0x8FBB,
 * both inside a block that branches on DS:0x3e6 — the six-state ATTRACT-MODE
 * cycler — and both fall through to CS:0x8FBE `mov byte [0x3bd],0x1`, the
 * joystick-PLAYBACK flag. A third variant at CS:0x8F5F grants weapon 2 x3,
 * weapon 5 x5 and weapon 4 x1 under DS:0x3e6 == 2.
 *
 * So those are the demo's loadouts, set up alongside its scripted camera and
 * hero position. Real play still starts with all three slots at 0xFFFF. A
 * pass that finds CS:0x8FD2 first will read it as a starting loadout, which
 * is why this note is here rather than nowhere. */
export const DEMO_GRANTS_ARE_ATTRACT_MODE = true;

/* hero-fire.js — the hero's arsenal, wired end to end.
 *
 * Every piece of the fire chain existed as a module before this file: the
 * allocator (weapons.js), the spawn handlers and six movers (projectiles.js),
 * the damage grid (collision.js), the eight firing states (fire-states.js).
 * Nothing called any of them. This is the integration layer — the object the
 * player state machine fires through and the main loop steps.
 *
 * ── THE PER-TICK ORDER, read off the main loop `[PROVEN]` ────────────────
 *
 * Re-read here from the disassembly rather than assumed, because getting it
 * wrong is invisible in a unit test and obvious in play:
 *
 *   019D  test byte [0x382],0x80 / jnz      the latch clear, CONDITIONAL
 *   01A4  mov byte [0x351],0
 *   01BD  cmp word [0x19a],0                the death test, on the BAR
 *   01CC  call 0xacf6                       CLEAR the damage grid
 *   020F  call 0x9455                       projectiles MOVE and STAMP
 *   021E  mov byte [0x33c],0xff             the hunter target list resets
 *   0254  call 0x4993                       the player state machine (EMIT)
 *   0285  call 0xed15                       System-B entities -> they SCAN
 *   02C6  call 0xdff                        the health bar chases
 *
 * ⚠️ PROJECTILES STEP BEFORE THE PLAYER. A shot emitted this tick does not
 * move or stamp until the next one, so **it cannot hit anything on its spawn
 * tick**. A port that steps projectiles after the player gives every shot one
 * free frame of collision at the muzzle.
 *
 * ── WHICH STATES CAN FIRE A WEAPON `[PROVEN — exhaustive]` ───────────────
 *
 * All 12 `call 0x95ca` sites in the image, mapped to states through the
 * DS:0xd818 dispatch table:
 *
 *   0x4C0E  state 11  fall left        0x55DF  the ladder-fire entry (right)
 *   0x4D10  state 12  fall right       0x5605  the ladder-fire entry (left)
 *   0x4FD3  state  8  jump left        0x5839  state 14  ladder from stand
 *   0x51D2  state  9  jump right       0x585F  state 14  (the mirror)
 *   0x5A6B  state  0  walk left        0x5D5E  state  5  the CHAIN re-fire
 *   0x5CAF  state  1  walk right       0x5DA5  state  6  the chain mirror
 *
 * ⚠️ IDLE CANNOT SHOOT. State 26 tests the fire bit at CS:0x49EA and calls
 * CS:0x1045 instead — which walks the 200 object records at DS:0x8314 and
 * keeps ONLY category 3 (`CS:0x1087 cmp byte [di+0x4],0x3 / jnz`), ending in
 * `xor byte [si+0x4],0x1`. Category 3 is levers/switches and flipping bit 0 of
 * the type is the documented lever toggle, so **idle + FIRE operates a lever
 * you are standing on.** Likewise the crouch pair 18/19 test fire at
 * CS:0x4B27 / 0x4B9C and jump to CS:0x612F, which reads the 4-slot inventory
 * at DS:0x17e through the selector DS:0x366 — inventory USE.
 *
 * ⚠️ An earlier revision of this comment called CS:0x1045 "object pickup".
 * It is not, and the distinction matters twice over: pickup has **no fire
 * gate at all** (it happens on contact, CS:0x177d — see game/pickup.js), and
 * a port that binds pickup to the fire button makes half the map
 * uncollectable while making levers operate by walking into them.
 *
 * So the hero must be walking, jumping, falling or on a ladder to shoot, and
 * standing still with fire held throws a switch. A port that lets a stationary
 * hero shoot has invented a control scheme.
 */

import { WEAPON_SLOTS, MAX_SUBSLOTS, tagFor, allocateShots, armWeapon,
         reloadWorld } from './weapons.js';
import { spawnVolley, stepProjectiles, DECODED_HANDLERS, NULL_HANDLERS,
         AREA_ENTRIES, ENTRIES_REACHABLE, GROUP_ENTRIES, muzzle } from './projectiles.js';

/** Player states whose handler reaches the allocator (see the census above). */
export const FIRE_CAPABLE_STATES = [0, 1, 8, 9, 11, 12, 13, 14];
/** State 26 — fire operates a LEVER (category 3), CS:0x49EA -> CS:0x1045. */
export const LEVER_STATES = [26];
/** States 18/19 — fire is inventory use, CS:0x4B27 / 0x4B9C -> CS:0x612F. */
export const INVENTORY_STATES = [18, 19];

/** The two chain re-fire sites live INSIDE fire states 5 and 6. */
export const CHAIN_STATES = [5, 6];

/* CS:0x9734 walks all three live pointers (DS:0x1bc / 0x1be / 0x1c0) and calls
 * the record writer for each, so ONE press fires from every armed slot that
 * allocated — up to three weapons, each with its own volley. */
export const SPAWNER_RIGHT = 0x9734;
export const SPAWNER_LEFT  = 0x97ce;

/** DS:0x33d — 0xff normally; a slot index switches that slot to the alternate
 *  muzzle at DS:0x16a/0x16c. CS:0x9750/0x9783/0x97b6 compare it against 0/1/2
 *  respectively, which is what pins the "names this slot" reading. */
export const ALT_EMITTER_NONE = 0xff;

const emptyRecord = () => ({ tag: 0, x: 0, y: 0, dir: 0 });

/**
 * One of the three weapon slots: a weapon index, its runtime {count, base},
 * and the 18-record projectile area (only the first 9 are reachable).
 */
export class Slot {
  constructor(meta) {
    this.meta = meta;                 // WEAPON_SLOTS entry
    this.weapon = -1;                 // <0 = empty, CS:0x95ed `js`
    this.st = null;                   // {index, base, count}
    this.area = Array.from({ length: AREA_ENTRIES }, emptyRecord);
  }

  /** CS:0x9724 — a sub-slot is free when all THREE of its records are empty. */
  get subslots() {
    const out = [];
    for (let g = 0; g < MAX_SUBSLOTS; g++) {
      let busy = false;
      for (let k = 0; k < GROUP_ENTRIES; k++) {
        if (this.area[g * GROUP_ENTRIES + k].tag !== 0) { busy = true; break; }
      }
      out.push(busy);
    }
    return out;
  }

  get live() {
    let n = 0;
    for (let i = 0; i < ENTRIES_REACHABLE; i++) if (this.area[i].tag !== 0) n++;
    return n;
  }

  /** CS:0x9177 — `mov cx,0x48 / rep stosw`, the whole 144-byte area. */
  clear() { for (const r of this.area) { r.tag = 0; r.x = 0; r.y = 0; r.dir = 0; } }
}

export class Arsenal {
  /** @param {Array} weapons parsed PWEAPONS records for the CURRENT world */
  constructor(weapons) {
    this.weapons = weapons;
    this.slots = WEAPON_SLOTS.map((m) => new Slot(m));
    this.latch = false;               // DS:0x351
    this.altSelect = ALT_EMITTER_NONE;// DS:0x33d
    /* DS:0x340 — the tag base the fireball's mover subtracts to get a
     * per-projectile index. Only CS:0x95AE writes it, when the fireball takes
     * slot C, which is why the selector hard-wires that weapon to that slot. */
    this.tagBase = 0;
    /* Counters, surfaced rather than thrown — see `emit` below. */
    this.undecodedHandler = 0;
    this.nullHandler = 0;
    this.outOfRange = 0;
    this.stamped = 0;
    this.hitTerrain = 0;
    this.fired = 0;
  }

  /** CS:0x9115 — a NEW pickup re-bases the count, so the volley drops to one. */
  equip(n, weaponIndex) {
    const s = this.slots[n];
    s.weapon = weaponIndex;
    s.st = weaponIndex < 0 ? null : armWeapon(this.weapons[weaponIndex]);
    return s;
  }

  /** CS:0x35e9 — a sublevel-'a' load re-pins +0x08 under the carried weapon. */
  reloadWorld(weapons) {
    this.weapons = weapons;
    for (const s of this.slots) {
      if (s.weapon >= 0) s.st = reloadWorld(weapons[s.weapon]);
    }
  }

  /** CS:0x019D — call once per tick, BEFORE anything reads the latch. */
  latchTick(fireHeld) { if (!fireHeld) this.latch = false; }

  /**
   * CS:0x95ca. Returns the allocation, or null when nothing could be taken.
   * ⚠️ The original returns 0 for success; this returns the allocation object,
   * and the state machine's `cmp ax,0 / jnz` becomes `!== null`.
   */
  allocate() {
    const r = allocateShots(
      this.slots.map((s) => ({ weapon: s.weapon, subslots: s.subslots })),
      this.weapons, { locked: this.latch });
    this.latch = true;                          // CS:0x95d5
    return r.any ? r : null;
  }

  /**
   * CS:0x9734 (right) / CS:0x97ce (left) — write the records.
   *
   * ⚠️ THE GUARD, and why it is a counter rather than a throw. `spawnVolley`
   * raises on an undecoded handler, which is right for a unit test and wrong
   * on a path that runs whenever the player presses fire: of the 11 shipped
   * weapons only FIVE use the decoded pair 0/1 (knife, lightning bolt,
   * throwing star, axe, mace). The other six would kill the frame. Handlers
   * 12/13 are decoded but no shipped weapon references them, so the decoded
   * set covers 5 of 11 in practice, not 4 families of 11.
   *
   * Same reasoning as the `dir` guard in stepProjectiles: skip and count, so a
   * routing bug is visible in the panel instead of fatal in play.
   */
  emit(alloc, heroX, heroY, right) {
    if (!alloc) return 0;
    let n = 0;
    for (const a of alloc.allocated) {
      if (!a) continue;                          // CS:0x9739 `cmp [0x1bc],0 / jz`
      const w = this.weapons[a.weapon];
      const handler = right ? w.handlerRight : w.handlerLeft;
      if (NULL_HANDLERS.includes(handler)) { this.nullHandler++; continue; }
      if (!DECODED_HANDLERS.includes(handler)) { this.undecodedHandler++; continue; }

      const s = this.slots[a.slot];
      const m = muzzle({ x: heroX, y: heroY }, right,
                       { slot: a.slot, sel: this.altSelect, alt: null });
      const { entries } = spawnVolley(s.st, handler, a.tag, m.x, m.y);
      /* The handler writes consecutive 8-byte records from the sub-slot head,
       * so record k of group g is area[g*3 + k] and carries tag + k. */
      const head = a.subslot * GROUP_ENTRIES;
      entries.forEach((e, k) => {
        const rec = s.area[head + k];
        rec.tag = e.tag; rec.x = e.x; rec.y = e.y; rec.dir = e.dir;
      });
      n += entries.length;
      this.fired++;
    }
    return n;
  }

  /**
   * CS:0x9455 — walk the three slots and run each one's mover.
   * Only the common mover (weapon +0x1A == 0) is stepped here; the other five
   * are ported in projectiles.js but are per-weapon and are wired as those
   * weapons become reachable. Counted, not silently skipped.
   */
  step(cam, grid, planeB, world, planeA = null, blocks = null) {
    let moved = 0, culled = 0;
    const hits = [];                              // this tick's terrain-stops
    for (const s of this.slots) {
      if (s.weapon < 0) continue;                // CS:0x9477 `cmp [di],0 / jns`
      const w = this.weapons[s.weapon];
      const r = stepProjectiles(s.area, cam, {
        grid, weapon: w, planeB, world, planeA, blocks,
        weaponIndex: s.weapon, pickupCount: s.st ? s.st.count : 0 });
      moved += r.moved; culled += r.culled;
      this.outOfRange += r.outOfRange;
      this.stamped += r.stamped;
      this.hitTerrain += r.hitTerrain;
      this.brokeBlocks = (this.brokeBlocks || 0) + r.brokeBlocks;
      hits.push(...r.hits);
    }
    return { moved, culled, hits };
  }

  /** Every live projectile, for the renderer. */
  *live() {
    for (const s of this.slots) {
      if (s.weapon < 0) continue;
      const w = this.weapons[s.weapon];
      for (let i = 0; i < ENTRIES_REACHABLE; i++) {
        const p = s.area[i];
        if (p.tag !== 0) yield { ...p, weapon: w, slot: s.meta.name };
      }
    }
  }
}

/**
 * How many of the shipped weapons this port can actually spawn.
 * Reported rather than assumed — see the guard in `emit`.
 */
export function spawnableWeapons(weapons) {
  const ok = [], blocked = [];
  for (const w of weapons) {
    const pair = [w.handlerLeft, w.handlerRight];
    if (pair.every((h) => DECODED_HANDLERS.includes(h))) ok.push(w.index);
    else blocked.push({ index: w.index, left: w.handlerLeft, right: w.handlerRight,
                        cut: pair.some((h) => NULL_HANDLERS.includes(h)) });
  }
  return { ok, blocked };
}

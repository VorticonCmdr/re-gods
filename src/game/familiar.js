/* familiar.js — the familiar, the flying helper summoned by consumable type 39
 * (bought in the world 3/4 shop; it is placed on no map). Read from
 * GAME.EXE's CS:0xC08E-0xC49B in full on 2026-09-28. No attract demo has a
 * familiar, so one was summoned live into PJOYL3's world-3 gameplay
 * (tools/attract-capture/familiar_live.py: the CS:0x0215 call made to run
 * C308 + C35E + C08E at tape cursor 760) and the port given the same inputs
 * (familiar-compare.js). [PROVEN] for 342 ticks, cursors 760-1101: x, y,
 * vx, vy, facing and the animation cursor match every tick; the random
 * cursor, energy and DS:0x33D agree within the sampling lag (DOS reads at
 * CS:0x0218, the port at the end of the tick). The window covers the
 * summon's own tie draw, steering to the hero and to picked creatures, and
 * C35E moving DS:0x33D to the fireball slot after a pickup. It does NOT
 * cover a hit (energy stayed 1000) or the death, CS:0xC440: [STATIC].
 *
 * STATE. Energy DS:0x168 (-1 = none), power DS:0x210 and wings DS:0x304 stay
 * on combat.js's Health (familiarEnergy / familiarPower / familiarWings),
 * where the shop and consumables.js already put them. This module holds the
 * rest:
 *   DS:0x16A/0x16C  x, y (world)          DS:0x2FC/0x2FE  vx, vy
 *   DS:0x300        facing (+1 right / -1 left)
 *   DS:0x302        animation cursor, 0..0xA step 2 into DS:0xD7AE
 *   DS:0x308/0x30A/0x30C  the draw position (screen) and sprite, -1 = hidden
 *
 * THE TICK, CS:0xC08E (main loop CS:0x0215, right after the starburst
 * CS:0x0212; also CS:0x09EA in the death driver and CS:0x9283 in the respawn
 * tick CS:0x921B — the three are the same code path in this port):
 *   energy < 0 -> nothing.
 *   Save wings. Pick a target with CS:0x9E36 (the hunter's own pick, on the
 *   same list, which the hunter at CS:0x020F has already consumed from):
 *     DS:0x33D >= 0 (carrying a weapon slot, see chooseAltSlot): steer to
 *       x = the hero's x; y = the pick's y, or the hero's y - 0x24.
 *     DS:0x33D = 0xFF: steer to the pick; with no pick, to the hero's
 *       (x, y - 0x24) with wings treated as 0 for this tick (CS:0xC174).
 *   CS:0xC17D, the mover, one axis at a time:
 *     x: speed steps by 1 toward the target, capped at +-(2 * wings + 3), and
 *        facing = the step's direction; y: capped at +-(2 * wings + 2).
 *        A cap that shrank (wings forced to 0) snaps the speed to it.
 *     An exact tie on an axis draws a random number (CS:0x3836) and bit 0
 *     picks the direction: x right on 1, y down on 1. So a live familiar
 *     consumes the game's random table.
 *     Then x += vx, y += vy.
 *   Facing override (CS:0xC0DA-0xC10F): within 8 px of the hero's screen x
 *     either way, DS:0xD7CA[hero state] replaces it (0 = keep the facing the
 *     familiar had BEFORE the mover).
 *   Sprite 0x185 + DS:0xD7AE[cursor] (0,1,2,3,2,1), +4 facing right.
 *   On a tock (DS:0x36C) the cursor advances, wrapping at 0xC.
 *   CS:0xC2B6 stamps tag 0xFF into the damage grid (DamageGrid#stampFamiliar).
 *   Restore wings.
 *
 * HITS, CS:0xAB41-0xAB53: a creature whose grid scan finds tag 0xFF takes the
 * familiar's power as damage (CS:0x938E, difficulty-scaled like any other),
 * and first the familiar LOSES ENERGY equal to that creature's current
 * strength (`sub [0x168],bp`). Below zero it dies (kill below).
 *
 * THE SHOT ORIGIN: when the hero fires the slot DS:0x33D names, the shot
 * comes out of the familiar (CS:0x9750-0x9764 / 0x97EA-0x97F8; projectiles.js
 * muzzle()). See chooseAltSlot for which slot that is.
 *
 * Not modelled: the two unreferenced speed-damping variants at CS:0xC20E and
 * CS:0xC28B (no call or jump to either was found by search_instructions).
 */

export const FAMILIAR_SPRITE = 0x185;                 // CS:0xC0CE / 0xC329
export const FAMILIAR_ANIM = Object.freeze([0, 1, 2, 3, 2, 1]);   // DS:0xD7AE, words
/* DS:0xD7CA, one signed byte per hero state (DS:0x377, 0..28). */
export const FAMILIAR_FACING_BY_STATE = Object.freeze([
  -1, 1, 1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 0, 0,
  1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 0, -1, 1,
]);
export const FAMILIAR_SUMMON_DY = 0xa0;               // CS:0xC30D, above the hero
export const FAMILIAR_PLACE_DY = 0x28;                // CS:0x100A / 0x8C64
export const FAMILIAR_HEAD_DY = 0x24;                 // CS:0xC0AE / 0xC171
export const ALT_NONE = 0xff;                          // DS:0x33D

export class Familiar {
  constructor() { this.reset(); }

  reset() {
    this.alive = false;          // mirrors energy >= 0 as of the last tick
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.anim = 0;
    this.draw = null;            // {x, y, sprite}, DS:0x308/0x30A/0x30C
  }

  /** CS:0xC308-0xC353, the fresh summon: over the hero, still, facing right. */
  summon(hero) {
    this.alive = true;
    this.x = hero.x;
    this.y = hero.y - FAMILIAR_SUMMON_DY;
    this.vx = 0; this.vy = 0; this.facing = 1; this.anim = 0;
    this.draw = null;
  }

  /** CS:0x0FFC (teleport) and CS:0x8C56 (every level start): put a live
   *  familiar just above the hero. */
  place(hero, energy) {
    if (energy < 0) return;
    this.x = hero.x;
    this.y = hero.y - FAMILIAR_PLACE_DY;
  }

  /**
   * CS:0xC08E. Returns the draw record, or null.
   * @param {object} o
   *   health   combat.js Health (familiarEnergy / familiarWings)
   *   hero     {x, y, state} — world position and DS:0x377
   *   cam      {x, y}
   *   pick     () => the picked target {x, y} in SCREEN terms, or null —
   *            projectiles.js pickTarget over the hunter list
   *   rng      () => one CS:0x3836 word
   *   tock     DS:0x36C
   *   altSelect DS:0x33D
   *   grid     DamageGrid, or null
   */
  tick(o) {
    const h = o.health;
    if (h.familiarEnergy < 0) { this.alive = false; this.draw = null; return null; }
    if (!this.alive) this.summon(o.hero);            // bought/picked up since the last tick
    const savedWings = h.familiarWings;               // CS:0xC095 push
    let tx, ty;
    const p = o.pick();                               // CS:0xC0A3 / 0xC163 -> 0x9E36
    const world = p && { x: p.x + o.cam.x, y: p.y + o.cam.y };
    if ((o.altSelect & 0x80) === 0) {                 // CS:0xC099 `cmp byte,0 / jns`
      tx = o.hero.x;                                  // CS:0xC0B1
      ty = world ? world.y : o.hero.y - FAMILIAR_HEAD_DY;
    } else if (world) {                               // CS:0xC16A -> 0xC0B4
      tx = world.x; ty = world.y;
    } else {                                          // CS:0xC16D-0xC17A
      tx = o.hero.x; ty = o.hero.y - FAMILIAR_HEAD_DY;
      h.familiarWings = 0;
    }
    const prevFacing = this.facing;                   // CS:0xC0B4 [0x306] = [0x300]
    this.#move(tx, ty, h.familiarWings, o.rng);       // CS:0xC0BC -> 0xC17D

    const sx = this.x - o.cam.x, sy = this.y - o.cam.y;
    let sprite = FAMILIAR_SPRITE + FAMILIAR_ANIM[this.anim >> 1];   // CS:0xC0CE-0xC0D8
    const hx = o.hero.x - o.cam.x - 8;                // CS:0xC0DA-0xC0E2
    if (sx >= hx && sx <= hx + 16) {                  // CS:0xC0E5-0xC0EE
      const b = FAMILIAR_FACING_BY_STATE[o.hero.state] ?? 0;
      this.facing = b === 0 ? prevFacing : b;         // CS:0xC0FB-0xC10F
    }
    if (this.facing >= 0) sprite += 4;                // CS:0xC113-0xC11A
    this.draw = { x: sx, y: sy, sprite };             // CS:0xC11D-0xC124
    if (o.tock) {                                     // CS:0xC128
      this.anim += 2;
      if (this.anim >= 0xc) this.anim = 0;
    }
    if (o.grid) o.grid.stampFamiliar(sx, sy);        // CS:0xC141 -> 0xC2B6
    h.familiarWings = savedWings;                     // CS:0xC144 pop
    return this.draw;
  }

  /** CS:0xC17D-0xC1BD (and its four arms). */
  #move(tx, ty, wings, rng) {
    let right;
    if (this.x < tx) right = true;                    // CS:0xC187 `jl`
    else if (this.x > tx) right = false;              // CS:0xC189 `jg`
    else right = (rng() & 1) !== 0;                   // CS:0xC18B-0xC192
    const capX = wings * 2 + 3;
    if (right) {                                      // CS:0xC1E7
      if (this.vx !== capX) { this.vx++; if (this.vx > capX) this.vx = capX; }
      this.facing = 1;
    } else {                                          // CS:0xC1BE
      if (this.vx !== -capX) { this.vx--; if (this.vx < -capX) this.vx = -capX; }
      this.facing = -1;
    }
    let down;
    if (this.y < ty) down = true;                     // CS:0xC194 `jge` not taken
    else if (this.y > ty) down = false;
    else down = (rng() & 1) !== 0;                    // CS:0xC1A0-0xC1AA
    const capY = wings * 2 + 2;
    if (down) {                                       // CS:0xC269
      if (this.vy !== capY) { this.vy++; if (this.vy > capY) this.vy = capY; }
    } else {                                          // CS:0xC245
      if (this.vy !== -capY) { this.vy--; if (this.vy < -capY) this.vy = -capY; }
    }
    this.x += this.vx; this.y += this.vy;             // CS:0xC1AD-0xC1B9
  }

  /**
   * CS:0xAB4D: a creature hit by the familiar's tag drains `bp` (its strength
   * before the hit) from the familiar's energy; CS:0xAB53 -> 0xC440 below zero.
   * @returns {boolean} whether the familiar died
   */
  hit(bp, health, onDeath) {
    health.familiarEnergy -= bp;
    if (health.familiarEnergy >= 0) return false;
    this.kill(health, onDeath);
    return true;
  }

  /**
   * CS:0xC440. A familiar whose energy has gone negative bursts (CS:0xA461 at
   * its position + 4, unless DS:0x391, the full-restart flag, is set); then
   * energy = -1, DS:0x33D = 0xFF, the sprite is hidden, and the hunter-list
   * gate DS:0x343 closes unless a slot holds the hunter (CS:0xC481-0xC496).
   * @param {?function(number,number)} onDeath the starburst spawn, world x/y
   */
  kill(health, onDeath = null) {
    if (health.familiarEnergy < 0 && onDeath) onDeath(this.x + 4, this.y + 4);
    health.familiarEnergy = -1;                       // CS:0xC470
    this.alive = false;
    this.draw = null;                                 // CS:0xC47B
  }
}

/**
 * CS:0xC35E — which weapon slot the familiar carries (DS:0x33D), run on a
 * fresh summon and on every weapon pickup (CS:0x94D4). With the familiar
 * dead, or fewer than two slots armed, it is 0xFF. Otherwise each slot's
 * candidate value is its weapon's power (record +6), but only when that
 * slot's weapon INDEX is 2 — the fireball (`cmp word [0xdd10],2` at
 * CS:0xC3D7, and the same for the other two slots). That reads like an
 * authoring slip for a per-slot field, but it is what the bytes do: the
 * familiar only ever carries the fireball. The lowest candidate wins (ties
 * to the earlier slot), and CS:0xC422-0xC43B keeps 0xFF unless the winner
 * really is a candidate.
 * @param {Array<{weapon:number}>} slots  arsenal.slots
 * @param {Array<{power:number}>} weapons the current world's PWEAPONS records
 */
export function chooseAltSlot(slots, weapons, energy) {
  if (energy < 0) return ALT_NONE;                    // CS:0xC363
  const armed = slots.filter((s) => s.weapon >= 0).length;
  if (armed < 2) return ALT_NONE;                     // CS:0xC38E
  const v = slots.map((s) => (s.weapon === 2 ? (weapons[s.weapon]?.power ?? 0) : -1));
  const [a, b, d] = v;
  let pick;
  if (a >= 0 && (b < 0 || a <= b) && (d < 0 || a <= d)) pick = 0;   // CS:0xC3F5-0xC409
  else if (b < 0) pick = 2;                           // CS:0xC40D-0xC41E
  else if (d < 0 || d >= b) pick = 1;
  else pick = 2;
  return v[pick] >= 0 ? pick : ALT_NONE;              // CS:0xC422-0xC43B
}

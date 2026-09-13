/* death.js — the hero's death-burst animation, the lives/respawn fork, and
 * the respawn arrival-position search.
 *
 * `Health#dead` (combat.js, `bar <= 0`, CS:0x01BD-0x01C9) is read every
 * frame in the original main loop; on a hit it `JMP`s (not `CALL`s) into
 * `FUN_1000_09bb`, which keeps most of the per-tick world moving (the
 * projectile mover, the hazard walkers, the selector-2 driver, the
 * object-activation pass — all disassembled fresh this pass, CS:0x09BB-
 * 0x0A11) but skips the player state machine entirely, and drives a small
 * 5-particle burst off a tick counter (DS:0x24c, seeded to a negative
 * sentinel) until it reaches 0x12 (18 ticks, ~1.2s at 15Hz). At that point
 * CS:0x0930 forks:
 *
 *     0930  [0x6c]:=0xff ; [0x6d]:=0xff   ; a display-dirty pair
 *     093A  dec word [0x224]              ; LIVES -= 1
 *     093E  js 0x0943                     ; negative -> GAME OVER
 *     0940  jmp 0x0845                    ; else -> FUN_1000_0845, respawn
 *
 * Lives start at 2 (CS:0x8DD9, the full-restart routine), so this is the
 * hero's THIRD death that ends the game, not the second.
 *
 * This port keeps the burst, the fork, and the respawn positioning byte-
 * exact. It does NOT attempt CS:0x0943-0x0993's own game-over sequence (a
 * 150-iteration palette fade, the hiscore name-entry/table screens, then a
 * jump into the attract-mode demo cycler) — that is this project's title-
 * screen/attract-mode system, which does not exist in this port at all, and
 * building it is a UI/design undertaking well beyond a byte-level port.
 * `gameOverPlaceholder` below is an explicit, disclosed substitute: it
 * reports that the game is over and lets the caller decide what a browser
 * "new game" affordance should look like, rather than silently reproducing
 * nothing.
 */

import { MAP_COLS } from './statue.js';
import { START_TARGET, START_BAR } from './combat.js';

export { START_TARGET, START_BAR };

/* CS:0x0A3B-0x0A5E: 5 records seeded from a template at DS:0xd752, read
 * directly off the image (20 bytes = 5 x {i16 vx, i16 vy}):
 *     fb ff fb ff | 00 00 fb ff | 05 00 fb ff | fb ff fe ff | 05 00 fe ff
 * All 5 particles start at the SAME point — the hero's own screen position
 * at the instant of death, Y-biased +8 (CS:0x0A55 `add bx,8`) — and differ
 * only in velocity: a small upward fan (steep left/straight/steep right,
 * plus two shallower side arcs). */
export const DEATH_BURST_TEMPLATE = Object.freeze([
  { vx: -5, vy: -5 },
  { vx: 0, vy: -5 },
  { vx: 5, vy: -5 },
  { vx: -5, vy: -2 },
  { vx: 5, vy: -2 },
]);

export const DEATH_BURST_Y_BIAS = 8;          // CS:0x0A55
export const DEATH_BURST_SPRITE_BASE = 0x5b;  // CS:0x0A89 `mov bp,0x5b`
export const DEATH_BURST_TICKS = 0x12;        // 18 — CS:0x0A28 `cmp [0x24c],0x12`
export const DEATH_SFX = 0x7f3c;              // CS:0x0A34 — not played, no audio engine yet

/**
 * The 5-particle death burst. CS:0xA73-0xA86 never re-subtracts the camera
 * once seeded, so the particles are SCREEN-LOCKED for the whole animation —
 * they do not track scrolling — which is a real behaviour, not an oversight.
 *
 * ⚠️ ONE FRAME SIMPLIFIED FROM THE ORIGINAL. The original's own tick 18
 * (`[0x24c]==0x11(17)`) is a "silent" tick that updates nothing and only
 * increments the counter (CS:0xA66 `jz 0xaa4`); the fork itself fires on a
 * SEPARATE, 19th call once `[0x24c]==0x12(18)`. This class folds the silent
 * tick and the fork into the same call — `tick()` returns `done:true` the
 * moment the counter would reach 18 — so this port's death sequence is one
 * ~66ms frame shorter than the original's. Disclosed, not chased further:
 * imperceptible next to the ~1.2s duration both share.
 */
export class DeathBurst {
  /**
   * @param {number} screenX @param {number} screenY hero's screen position
   *   at the instant of death (camera-relative, not yet Y-biased).
   */
  constructor(screenX, screenY) {
    this.particles = DEATH_BURST_TEMPLATE.map((t) => ({
      x: screenX, y: screenY + DEATH_BURST_Y_BIAS, vx: t.vx, vy: t.vy,
    }));
    this.counter = 0;   // DS:0x24c, post-seed — the original's own negative
                          // sentinel and its seed-tick are folded into the
                          // constructor rather than modelled as a state.
  }

  /**
   * One 15Hz tick.
   * @returns {{done:boolean, sprites:Array<{x:number,y:number,sprite:number}>}}
   */
  tick() {
    /* CS:0xA66-0xA6B — the ONE tick (counter==17) that updates and draws
     * nothing at all, not a port simplification. */
    if (this.counter === 0x11) {
      this.counter++;
      return { done: this.counter >= DEATH_BURST_TICKS, sprites: [] };
    }
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 1;   // CS:0xA78-0xA7E, gravity uncapped
    }
    const sprite = DEATH_BURST_SPRITE_BASE + this.counter;
    const sprites = this.particles.map((p) => ({ x: p.x, y: p.y, sprite }));
    this.counter++;
    return { done: this.counter >= DEATH_BURST_TICKS, sprites };
  }
}

/* CS:0x0365a, 14 x {i16 planeBOffset, i16 dx, i16 dy} — read directly off
 * the image. Tried in this exact order; the FIRST cell that reads exactly
 * 0xFF (this project's own already-closed "valid respawn arrival tile"
 * marker) wins, and if NONE match, entry 13's own {dx,dy} is applied
 * anyway (CS:0x08AF-0x08B5 falls through unconditionally). */
export const ARRIVAL_ZONE_TABLE = Object.freeze([
  { offset: 1, dx: 32, dy: 0 },        // one right
  { offset: -1, dx: -32, dy: 0 },      // one left
  { offset: -128, dx: 0, dy: -16 },    // one row up
  { offset: -127, dx: 32, dy: -16 },   // one row up, one right
  { offset: -129, dx: -32, dy: -16 },  // one row up, one left
  { offset: 128, dx: 0, dy: 16 },      // one row down
  { offset: 129, dx: 32, dy: 16 },     // one row down, one right
  { offset: 127, dx: -32, dy: 16 },    // one row down, one left
  { offset: 256, dx: 0, dy: 32 },      // two rows down
  { offset: 257, dx: 32, dy: 32 },     // two rows down, one right
  { offset: 255, dx: -32, dy: 32 },    // two rows down, one left
  { offset: 384, dx: 0, dy: 48 },      // three rows down
  { offset: 385, dx: 32, dy: 48 },     // three rows down, one right
  { offset: 383, dx: -32, dy: 48 },    // three rows down, one left
]);

/**
 * CS:0x0873-0x08BD, inside `FUN_1000_0845` (the respawn routine, fully
 * disassembled this pass). Rounds the level's own STATIC spawn point
 * (DS:0x16e/0x170 — the same per-world point this port's own `levelSpawn`
 * table already produces, NOT the hero's death location) to its tile
 * origin, then radiates outward through `ARRIVAL_ZONE_TABLE` looking for a
 * plane-B cell tagged exactly `0xFF`.
 *
 * @param {number} spawnX @param {number} spawnY the level's static spawn point
 * @param {Uint8Array|number[]} planeB
 * @returns {{x:number, y:number}}
 */
export function findRespawnPosition(spawnX, spawnY, planeB) {
  const roundedX = (spawnX + 0x10) & 0xffe0;   // CS:0x087A/0x0880
  const roundedY = (spawnY + 0x8) & 0xfff0;    // CS:0x087D/0x0883
  const baseIdx = (roundedX >> 5) + (roundedY >> 4) * MAP_COLS;   // CS:0x0886-0x089F
  let chosen = ARRIVAL_ZONE_TABLE[ARRIVAL_ZONE_TABLE.length - 1];  // ⚠️ CS:0x08AF-0x08B5 fallthrough
  for (const entry of ARRIVAL_ZONE_TABLE) {
    const idx = baseIdx + entry.offset;
    const cell = (idx >= 0 && idx < planeB.length) ? planeB[idx] : 0;
    if (cell === 0xff) { chosen = entry; break; }        // CS:0x08AA `jz`
  }
  return { x: roundedX + chosen.dx, y: roundedY + chosen.dy };
}

/**
 * CS:0x093A/0x093E — `dec word[0x224]` then `js` on the RESULT.
 * @param {number} lives current DS:0x224 value (starts at 2, CS:0x8DD9)
 * @returns {{lives:number, gameOver:boolean}}
 */
export function loseLife(lives) {
  const next = lives - 1;
  return { lives: next, gameOver: next < 0 };
}

/**
 * A disclosed substitute for CS:0x0943-0x0993 — see this file's own header.
 * Returns what a caller needs to show SOMETHING rather than nothing; it is
 * not a port of the hiscore/attract-mode sequence.
 */
export function gameOverPlaceholder() {
  return { message: 'GAME OVER', canRestart: true };
}

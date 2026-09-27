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
 * exact.
 *
 * ⚠️ **SUPERSEDED, a later pass.** This header used to say the port does NOT
 * attempt CS:0x0943-0x0993's own game-over sequence (the 150-iteration
 * palette fade, the hiscore name-entry/table screens, the attract-mode demo
 * cycler) because "that is this project's title-screen/attract-mode system,
 * which does not exist in this port at all." It now does — see
 * `game/title-menu.js`'s `NameEntry`/`HiscoreTable` and `game/attract.js`.
 * `main.js`'s own death/game-over block calls those directly on the third
 * life lost, not `gameOverPlaceholder` below. That function stays exported
 * (and tested — `verify/checks.js`) as a documented, deliberate STAGE this
 * port went through, not deleted history: it was the honest placeholder for
 * exactly the gap this later pass closed, and the palette fade itself
 * remains unported (a purely cosmetic transition, `CS:0x359D`, disclosed as
 * out of scope the same way `shop.js`'s own held-direction auto-repeat is).
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
export const DEATH_SFX = 0x7f3c;              // CS:0x0A34 — played via audio/audio-bus.js, once, when main.js starts the burst

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
    /* CS:0x0A21-0x0A30 — the counter is tested at the TOP of each death tick:
     * 0x12 jumps to the respawn (CS:0x0930) on that tick, i.e. the tick AFTER
     * the 17 frames and the blank one. Reporting `done` on the tick the
     * counter reached 0x12 respawned a tick early ([PROVEN] PJOYG3 826/827). */
    if (this.counter >= DEATH_BURST_TICKS) return { done: true, sprites: [] };
    /* CS:0xA66-0xA6B — the ONE tick (counter==17) that updates and draws
     * nothing at all, not a port simplification. */
    if (this.counter === 0x11) {
      this.counter++;
      return { done: false, sprites: [] };
    }
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 1;   // CS:0xA78-0xA7E, gravity uncapped
    }
    const sprite = DEATH_BURST_SPRITE_BASE + this.counter;
    const sprites = this.particles.map((p) => ({ x: p.x, y: p.y, sprite }));
    this.counter++;
    return { done: false, sprites };
  }
}

/* SS:0x365a, 15 x {i16 planeBOffset, i16 dx, i16 dy} — 90 bytes, not the 84
 * (14-entry) this project had on record until this session. `[PROVEN]` live
 * this session: a forced world-1 death (mem_write DS:0x192/0x19a to 0, the
 * health target/bar, to trip CS:0x01BD's death test without combat) hit
 * FUN_1000_0845's respawn search with NO 0xFF match anywhere near PLEV1A's
 * own static spawn (64,944) -- and the hero landed at (64,944) EXACTLY, no
 * offset, not the 14-entry reading's own last-entry fallback of (-32,+48).
 * Reading SS:0x365a live (90 bytes, matching the disassembly's `DI==0x36AE`
 * at the fallthrough) found the reason: entries 0-13 below are the real,
 * CHECKED candidates (`CS:0x08AA`'s `CMP byte[BX+SI],0xFF`), but the loop
 * (`BP` seeded to 13, `DEC BP`/`JNS` — 14 iterations) walks DI one step
 * PAST entry 13 before exiting on no match, landing on a 15th record this
 * project's earlier pass never transcribed: `{offset:0, dx:0, dy:0}` — a
 * deliberate, clean all-zero sentinel, not adjacent garbage. It is never
 * itself tested for 0xFF (the loop simply stops and uses it), so the true
 * fallback is "apply no offset at all," not entry 13's real, meaningful
 * (-32,+48). Appending it here as entry 14 is transparent AND harmless if
 * the search loop below ever does test it: its own `offset` field (0)
 * would probe the landing tile itself, and either a match or the unchanged
 * fallthrough apply the identical {dx:0,dy:0}. */
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
  { offset: 0, dx: 0, dy: 0 },         // fallback sentinel -- land on the spawn tile itself
]);

/**
 * CS:0x0873-0x08BD, inside `FUN_1000_0845` (the respawn routine, fully
 * disassembled this pass). Rounds the respawn point (DS:0x16e/0x170) to its
 * tile origin, then radiates outward through `ARRIVAL_ZONE_TABLE` looking
 * for a plane-B cell tagged exactly `0xFF`.
 *
 * ⚠️ CORRECTED: DS:0x16e/0x170 is NOT a static per-level point. CS:0x8C34
 * seeds it with the level spawn, but every selector-6 checkpoint cell the
 * hero touches (CS:0x38F5) overwrites it with the hero's own position — see
 * game/progress.js. The caller passes `progress.respawn`.
 *
 * If none of the 14 real candidates match, the true fallback (`[PROVEN]`
 * live, see `ARRIVAL_ZONE_TABLE`'s own header) is the table's 15th,
 * all-zero sentinel entry — land exactly on the rounded point, no offset:
 * ground the hero already stood on (the spawn, or a checkpoint he touched).
 *
 * @param {number} spawnX @param {number} spawnY the respawn point, DS:0x16e/0x170
 * @param {Uint8Array|number[]} planeB
 * @returns {{x:number, y:number}}
 */
export function findRespawnPosition(spawnX, spawnY, planeB) {
  const roundedX = (spawnX + 0x10) & 0xffe0;   // CS:0x087A/0x0880
  const roundedY = (spawnY + 0x8) & 0xfff0;    // CS:0x087D/0x0883
  const baseIdx = (roundedX >> 5) + (roundedY >> 4) * MAP_COLS;   // CS:0x0886-0x089F
  /* CS:0x08AF-0x08B5's own fallthrough: defaulting to the table's OWN last
   * entry is exactly right now that entry is the true 15-record table's
   * all-zero sentinel, not (as before this session) entry 13's real offset
   * mistaken for the fallback. */
  let chosen = ARRIVAL_ZONE_TABLE[ARRIVAL_ZONE_TABLE.length - 1];
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

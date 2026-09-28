/* player.js — hero kinematics, animation state and phase, from proven bytes.
 *
 * SCOPE / HONESTY NOTE
 *   GAME.EXE's player is a 29-state machine (see game/states.js for the table,
 *   the transition graph and how the left/right split was proven). This file
 *   does NOT port all 29 handlers. It ports the movement of six of them —
 *   walk left/right, jump left/right, fall left/right — plus idle and a
 *   simplified ladder, and it now tracks the ORIGINAL state index and the
 *   original animation phase so the hero can be drawn with the real sprites
 *   instead of a box.
 *
 *   Where a phase progression is not ported, the state is listed in
 *   UNMODELLED_PHASE_STATES and the phase is held at 0 rather than invented.
 *   The verification panel reports which states those are.
 *
 * PROVEN CONSTANTS (GAME.EXE, CS offsets)
 *   X = DS:0x17a, Y = DS:0x17c   integer world pixels, NO sub-pixel bits.
 *   phase = DS:0x36b             persists across ticks: the dispatcher's very
 *                                first instruction is `mov cl,[0x36b]`
 *                                (CS:0x4993) and the epilogue's first is
 *                                `mov [0x36b],cl` (CS:0x5e9b).
 *   Walk    +/-4 px per tick. There is NO X-velocity variable in the binary.
 *   Gravity CS:48b0  `inc word [0x1b2]`, clamped at 10.
 *   Fall    dY = 4 + v, v in 1..10  ->  5..14 px/tick.
 *   Jump    CS:4f6f walks the 23-entry int16 table at DS:0xd922, cursor
 *           DS:0x358 stepping +2 and ending at 0x2e. NO GRAVITY is involved.
 *   Air control  DS:0x345, at most 3 steering steps of 4 px per fall.
 *   Ladder X snap  `add [0x17a],0x20` / `and [0x17a],0xFFE0` -> tile origin.
 *   No floating point exists anywhere in the binary.
 *
 * THE MAP POINTER AND THE WALL PROBES — now ported exactly
 *   CS:0x496a builds the plane-B cursor with no rounding:
 *       si = 0x5004 + ((X & 0xFFE0) >> 5) + ((Y & 0xFFF0) << 3)
 *   i.e. col = X >> 5, row = Y >> 4, row stride 128 — floored on both axes.
 *
 *   Walking probes three cells spanning the hero's 3-row height, but ONLY at
 *   certain sub-cell positions, and the two directions differ:
 *
 *     LEFT  (CS:5A84)  ax = X & 0x1f;  probe only when ax == 0
 *                      cells [si-1], [si+0x7f], [si+0xff]
 *     RIGHT (CS:5CCB)  ax = X & 0x1f;  probe only when ax < 8
 *                      cells [si+1], [si+0x81], [si+0x101]
 *
 *   Any probed cell == 1 (solid) aborts the step entirely — the handler jumps
 *   to the epilogue without moving. Outside those windows the step is
 *   unconditional. The asymmetry is real and matches the straddle threshold
 *   used elsewhere: the hero's body is ~24-25 px wide inside a 32 px cell, so
 *   moving right it must be tested one step BEFORE it overlaps column+1.
 *
 * THE LEVEL-START POSE — a shipped port bug, found by comparison with DOSBox.
 *   REPORTED: at the very start of PLEV1A the real game shows the hero facing
 *   the CAMERA (face and chest visible); this port showed his BACK, its own
 *   HUD reading "state 26 idle - phase 0 - sprite #25".
 *
 *   The port had no level-load seed at all. `new Player(x, y)` leaves the
 *   hero in this file's own uncited ST.FALL / S.FALL_R default, and the first
 *   ground contact (`_fall`'s landing branch) sets stateIndex = S.IDLE (26),
 *   phase 0 — anim_base(26) = 52, remapped at CS:0x5F8B to sprite 25: the
 *   back view.
 *
 *   GAME.EXE does it explicitly. FUN_1000_8c34, the level-load routine, seeds
 *   `8C3E mov byte [0x377],0x4` — state 4, this project's already-documented
 *   "spawn / arrival idle pose", whose three named entrants are level start
 *   (CS:0x8C3E), respawn (CS:0x08D6) and teleport arrival (CS:0x1022) —
 *   together with `8CAA sub ax,ax / 8CAC mov [0x36b],al`, phase 0. The port
 *   already honoured the other TWO entrants through `teleportTo`, which is
 *   exactly why respawn and teleport looked right and only level start did not.
 *
 *   DS:0xd818 entry 4 = {anim_base 9, handler 0x5DFE}, read as raw bytes at
 *   file offset 0x1d998 of Gods/analysis/unpacked/TGAME.unpacked.exe. The
 *   epilogue at CS:0x5F77 gives sprite = 9 + CBW(cl) = 9, and 9 is NOT one of
 *   CS:0x5F8B's three remap keys (0x34/0x36/0x37) — so the remap this port
 *   applies was never the problem; being in state 26 at all was. Rendered
 *   from the shipped PALWAYS1.DAT/.PI1: sprite #9 is the front view, sprite
 *   #25 the back view.
 *
 *   AND THE POSE HOLDS — the half a one-frame seed would miss. State 4's
 *   handler (CS:0x5DFE) tests ONLY the two direction bits (0x8 RIGHT -> state
 *   2 with cl=2; 0x4 LEFT -> state 3 with cl=0) and otherwise does `5E16 jmp
 *   0x56CA`, whose solid-ground arm is a bare `56D4 jmp 0x5e9b`: neither
 *   [0x377] nor CL is written, so sprite 9 is re-selected every tick for as
 *   long as the player presses nothing. Its not-solid arm is `56EC mov
 *   [0x377],0xc / 56F1 xor cl,cl` — state 12 unconditionally, no facing
 *   consulted.
 *
 *   DISCLOSED CUT. `spawnAtLevelStart` parks state 4 in this port's ST.GROUND
 *   bucket, which runs the whole `_ground` body every tick. That is a strict
 *   SUPERSET of state 4's eleven instructions, so the hero at a spawn keeps
 *   four capabilities the original's state 4 does not have — CS:0x5DFE tests
 *   only bits 0x8/0x4, so RIGHT goes to state 2 and LEFT to state 3 no matter
 *   what else is held:
 *     UP alone on a climbable column -> the port enters the ladder
 *     RIGHT/LEFT + UP                -> the port jumps   (measured: idx 9)
 *     RIGHT/LEFT + DOWN              -> the port crouches (measured: idx 18)
 *     RIGHT/LEFT alone               -> the port goes straight to WALK,
 *                                       skipping turn states 2/3
 *   All four are one keypress wide (nothing re-enters state 4 but a spawn, a
 *   respawn or a teleport) and all four are PRE-EXISTING: `teleportTo` has
 *   shipped with exactly this shape. ST.GROUND here is a port-side bucket,
 *   NOT a claim that CS:0x56CA installs a "grounded" state — its solid arm
 *   writes nothing at all.
 */

import { CELL_SOLID, CELL_CLIMBABLE, MAP_COLS } from '../formats/map.js';
import { WALK_CYCLE, WALK_FOOTSTEP_PHASES, jumpPhase,
         LADDER_JUMP_PHASE, LADDER_PHASE_MAX } from './states.js';
import { FIRE_STATES, ENTRY, fireTick, fireAnimOffset, fireGuardBefore,
         fireGuardAfter, JUMP_ARC_STEP, JUMP_ARC_END,
         JUMP_ARC_EXIT } from './fire-states.js';
import { objectNearHotPoint, crouchScan, collectKey } from './pickup.js';
import { INVENTORY_EMPTY } from './treasure.js';

/* DS:0xd922 — the 23-entry jump delta table, verbatim.
 * 4 ticks of wind-up, 32 px rise, apex, 32 px descent; exactly symmetric. */
export const JUMP_DELTAS = [
  0, 0, 0, 0, 6, 6, 5, 4, 4, 3, 2, 1, 1, 0,
  -1, -1, -2, -3, -4, -4, -5, -6, -6,
];

export const WALK_STEP     = 4;    // px/tick
export const GRAVITY_STEP  = 1;    // per tick
export const FALL_VMAX     = 10;   // clamp on DS:0x1b2
export const FALL_BASE     = 4;    // dY = FALL_BASE + v
export const AIR_STEPS_MAX = 3;    // DS:0x345 budget

/**
 * CS:0x4C39-0x4C4A (state 11, fall right) / CS:0x4CB0-0x4CC1 (state 12, fall
 * left) / CS:0x4D3E-0x4D4F (the fall+fire tick, both facings share one body)
 * — all THREE fall-landing sites run the byte-identical sequence, confirmed
 * by fresh `disassemble_bytes` reads at all three addresses this pass:
 *     ax = word[0x176]              ; fallDamage, the accumulated-ticks
 *     ax -= 0x14                    ;   counter this port already tracks
 *     jle skip                      ; <= 20 ticks of fall -> no damage at all
 *     cmp word[0x172],0 / jnz skip  ; invulnerable -> no damage either
 *     shr ax,1                      ; half the EXCESS over the threshold
 *     sub word[0x192],ax            ; off the health TARGET, not the bar
 * A fall under ~1.3s (20 ticks at 15Hz) costs nothing; longer falls cost
 * half of however many ticks past that. `DS:0x176` was already tracked
 * (incremented every fall tick, reset on landing/state-entry) but nothing
 * ever converted it to damage — this closes that gap.
 */
export const FALL_DAMAGE_THRESHOLD = 0x14;
export function fallDamageFor(fallDamage) {
  const excess = (fallDamage || 0) - FALL_DAMAGE_THRESHOLD;
  return excess > 0 ? excess >> 1 : 0;
}
/* CS:0x4F49 (state 8, jump left) / CS:0x5148 (state 9, jump right) —
 * `cmp byte [0x358],0x16 / jl <skip>`. Once the jump-arc cursor reaches this
 * value, the handler probes solidThreeBelow BEFORE reading that tick's arc
 * delta and, on a hit, lands on the spot instead of applying the delta.
 * 0x16 = 22 is NOT "past the apex" — i = cursor>>1 = 11, and JUMP_DELTAS[11]
 * is +1 (still rising); the table doesn't turn negative until i=14. The
 * probe is live for the last two rising ticks as well as the whole descent. */
export const JUMP_ARC_EARLY_LAND_CURSOR = 0x16;
/* CS:0x5663 (descend, state 13) `add word [0x17c],0x6` AND CS:0x58c3
 * (ascend, state 14) `sub word [0x17c],0x6` — BOTH directions step 6 px, not
 * the 4/6 split this project's own notes carried. That 4 px number came from
 * CS:0x55F6/0x561C, which — re-read chasing the top-of-ladder bug below —
 * turn out to belong to the ladder-FIRE states (24/25), not plain climbing at
 * all. The plain climb-up branch (state 14, CS:0x5707) was "not isolated to
 * a single site" in this project's own words; it now is. */
export const CLIMB_STEP = 6;
/* CS:0x54b9/0x5707 `cmp byte [0x36c],0 / jnz` — the WHOLE climb handler,
 * dismount and fire-on-ladder included, runs only every OTHER logic tick;
 * the closed tick is a bare `jmp 0x5e9b` before input is even read. */
export const CLIMB_EVERY_OTHER_TICK = true;

/* FOOTSTEP_SFX — CS:0x5AB3/0x5AC0, both `push ax / mov ax,0x20e / call
 * 0x22ca / pop ax`, gated on `cl==2`/`cl==6` (WALK_FOOTSTEP_PHASES). The
 * full word passed to the sound-effect export, matching this port's own
 * convention (SFX_VOICES is keyed the same way; see projectiles.js's
 * FIRE_SFX for why the bare low byte is the wrong thing to export).
 * `[PROVEN]`-adjacent: read fresh this session AND already carried as the
 * same word by `docs/player-state-machine.md:81` from an earlier pass —
 * two independent reads agreeing, unlike CLIMB_STEP_SFX below. */
export const FOOTSTEP_SFX = 0x020e;
/* CLIMB_STEP_SFX — `[STATIC]`, corrected. `Gods/docs/player-state-machine.md`
 * used to cite this id as "0x5931", which is not a sound id at all — it's the
 * CS: address of `FUN_1000_5931`, a 9-byte thunk (`push ax / mov ax,0x240 /
 * call 0x22ca / pop ax / ret`) called from all four climb turn-arounds
 * (CS:0x5681/0x5690 descend, CS:0x58cd/0x58dc ascend — confirmed by
 * `get_function_xrefs`). The real word passed to the sound export is 0x240. */
export const CLIMB_STEP_SFX = 0x0240;
/* CS:0x551b/0x576d (right) and CS:0x558b/0x57e5 (left) — DOWN + a direction
 * must be held for THREE ticks (`cmp .. ,2 / jle bail` — proceeds only once
 * the counter is > 2) before a sideways dismount is even attempted. */
export const DISMOUNT_HOLD_TICKS = 3;

export const ST = { GROUND: 'ground', JUMP: 'jump', FALL: 'fall', CLIMB: 'climb',
                     CROUCH: 'crouch', LAND: 'land' };

/* Original state indices this port emits. See states.js for the proofs. */
/* DS:0x357 — the landing pose's hold flag. Only landings write it (the
 * state-11/12 and jump landings clear it, CS:0x4C2D/0x4D2F/0x4F64/0x5163/
 * 0x526F/0x538C; the pose's first tick sets it), so it lives for the whole
 * process and a state-10 landing, which does not clear it, inherits it. */
let landFlag357 = 0;
export const setLandFlag357 = (v) => { landFlag357 = v; };

export const S = {
  WALK_L: 0, WALK_R: 1,
  TURN_LR: 2, TURN_RL: 3,   // turn left->right / right->left — CS:0x5dbb/0x5dde
  JUMP_L: 8, JUMP_R: 9,
  FALL_LADDER: 10,   // CS:0x4C5D — off a ladder's foot
  FALL_L: 11, FALL_R: 12,
  CLIMB: 14,
  CLIMB_DOWN: 13,
  ARRIVAL: 4,   // CS:0x1022 — one of state 4's three named entrants
  CROUCH_R: 18, CROUCH_L: 19,
  LAND_R: 16, LAND_L: 17,   // the landing pose — CS:0x5042 / 0x5020
  IDLE: 26,
  IDLE_TO_L: 27, IDLE_TO_R: 28,   // idle -> walk stubs — CS:0x4ACC / 0x4AD6
};

/* CS:0x4AE0 (state 18, crouch RIGHT) / CS:0x4B55 (state 19, crouch LEFT),
 * disassembled fresh:
 *
 *     4AE0  test [0x382],0x2 (DOWN) / jnz 4B11    ; DOWN held -> keep crouching
 *       [DOWN NOT held -- the release/exit path:]
 *     4AE7  drop the selected slot's item if it holds one (CS:0x61A1)
 *     4B00  dec cl / js 4B07                       ; count the phase DOWN
 *     4B04    jmp 5e9b                              ; still >= 0 -> stay, render
 *     4B07  cl=2 ; [0x377]=1 (WALK_R) ; jmp 5e9b    ; went negative -> EXIT
 *       [DOWN held, at 4B11:]
 *     4B11  cl=1                                    ; phase PINNED while crouched
 *     4B13  [0x354]==0 -> jmp 6069                  ; the key scan
 *     4B1D  [0x355]==0 -> jmp 6134                  ; the FIRE tap (slot cycle)
 *     4B27  FIRE -> jmp 612F                        ; arm the tap
 *     4B31  the same drop-if-occupied check as 4AE7
 *     4B48  [0x354]==0 -> jmp 6069                  ; re-check the scan
 *     4B52  jmp 5e9b
 *
 * State 19 (CS:0x4B55-0x4BC7) is the byte-identical mirror, exit to
 * [0x377]=0 (WALK_L).
 *
 * The flag machine ([0x341]/[0x354]/[0x355]), the FIRE tap and the drop are
 * all ported: `_keyScan`, `_inventoryTap` and `_drop` below.
 *
 * Also: the phase pin while held, and the 2-tick exit-delay countdown
 * before standing back up (CS:0x4B00-0x4B07 / 0x4B75-0x4B7C). */
/* The CS:0x4C54 call sites a plain fall's landing runs: left (state 11,
 * CS:0x4C28 -> 0x4C4E), right (state 12 and the fall-fire right landing,
 * CS:0x4D2A -> 0x4D36 and 0x4D53). */
export const LAND_FALL_LEFT = Object.freeze([0x4c4e]);
export const LAND_FALL_RIGHT = Object.freeze([0x4d36, 0x4d53]);

export const CROUCH_EXIT_PHASE_START = 1;   // CS:0x4B11/0x4B86 `mov cl,1`

/**
 * Every (stateIndex, phase) pair this port can actually emit, DERIVED by
 * driving a real Player rather than restated by hand — a hand-maintained list
 * silently stops covering a state the moment one is added, which is exactly
 * the drift the verification suite exists to catch.
 * @returns {{pairs:[number,number][], map:object}}
 */
export function emittableStates() {
  /* A synthetic world: a floor at row 12, and a 2-column climbable band at
   * cols 20-21 (two wide because the ladder snap rounds X UP to the next
   * multiple of 32, so a 1-column ladder would push the hero straight off it).
   * The hero starts at row 9, so `solidThreeBelow` finds the floor at once. */
  const N = MAP_COLS * 64;
  const planeB = new Uint8Array(N);
  for (let c = 0; c < MAP_COLS; c++) planeB[12 * MAP_COLS + c] = CELL_SOLID;
  for (let r = 4; r < 12; r++) {
    planeB[r * MAP_COLS + 20] = CELL_CLIMBABLE;
    planeB[r * MAP_COLS + 21] = CELL_CLIMBABLE;
  }
  const map = { planeA: new Uint8Array(N), planeB, widthPx: 4096, heightPx: 1024 };

  const I = (o = {}) => ({ left: false, right: false, up: false, down: false, fire: false, ...o });
  const seen = new Map();
  const run = (p, program) => {
    for (const [input, n] of program) {
      for (let i = 0; i < n; i++) {
        p.tick(map, input);
        seen.set(`${p.stateIndex},${p.phase}`, [p.stateIndex, p.phase]);
      }
    }
  };

  /* Ground work, well away from the ladder: a full 8-frame walk cycle each
   * way, a stop from each direction, and a jump each way with its fall. */
  run(new Player(2 * 32, 9 * 16), [
    [I(), 4],                       // settle on the floor -> idle
    [I({ right: true }), 20],       // walk right, whole cycle
    [I(), 4],                       // stop-right, then idle proper
    [I({ left: true }), 12],        // walk left
    [I(), 4],                       // stop-left, then idle proper
    [I({ up: true }), 2],           // jump left  (facing left)
    [I(), 30],                      // arc, fall, land
    [I({ right: true }), 8],
    [I({ up: true }), 2],           // jump right
    [I(), 30],
  ]);
  /* The climb, from a hero placed on the ladder — walking 18 columns to reach
   * it would only pad the run. */
  run(new Player(20 * 32, 9 * 16), [[I(), 2], [I({ up: true }), 12], [I(), 6]]);

  /* Crouch, both facings: walk, press DOWN to enter, hold a couple ticks
   * (the key scan is a no-op with no `pickup` context here), release and let
   * the 2-tick exit delay play out before the hero stands back up. */
  run(new Player(2 * 32, 9 * 16), [
    [I(), 4],
    [I({ right: true }), 4],
    [I({ right: true, down: true }), 3],
    [I({ right: true }), 3],
    [I({ left: true }), 4],
    [I({ left: true, down: true }), 3],
    [I({ left: true }), 3],
  ]);

  /* The turn animation, states 2/3: walk one way, reverse, and complete
   * both full turns (each exits into the opposite WALK_* automatically). */
  run(new Player(10 * 32, 9 * 16), [
    [I(), 4],
    [I({ left: true }), 4],
    [I({ right: true }), 5],   // 3 turn ticks + settle into WALK_R
    [I({ left: true }), 5],    // reverse back: 3 turn ticks + settle into WALK_L
  ]);

  /* CS:0x598a/0x5bd2 — the ordinary way a player ducks: walk, RELEASE the
   * direction (the stopped pose leaves stateIndex at WALK_L/WALK_R), then
   * press DOWN alone with no direction held at all. */
  run(new Player(2 * 32, 9 * 16), [
    [I(), 4],
    [I({ right: true }), 4],
    [I(), 1],                       // release -> locked stopped pose
    [I({ down: true }), 3],
    [I(), 4],
    [I({ left: true }), 4],
    [I(), 1],
    [I({ down: true }), 3],
  ]);

  return { pairs: [...seen.values()], map };
}

/** Raw plane-B cell by byte index, matching the `[si + n]` addressing. */
function cellAt(map, idx) {
  return (idx >= 0 && idx < map.planeB.length) ? map.planeB[idx] : 0;
}
/** CS:0x496a — the plane-B cursor, floored on both axes. */
function mapCursor(x, y) {
  return ((x & 0xFFE0) >> 5) + ((y & 0xFFF0) >> 4) * MAP_COLS;
}

/* Solidity probes, from CS:0x4e2d and CS:0x4e4e.
 *   0x4e4e "solid at current row": [si] == 1, or (x & 0x1f) >= 8 and [si+1] == 1
 *   0x4e2d "solid 3 rows below":   [si+0x180] == 1, or the same with [si+0x181]
 * +0x80 is one row (stride 128), so +0x180 is three rows down — the hero is
 * 3 cells (48 px) tall. The (x & 0x1f) >= 8 term is the straddle test.
 * (The binary uses masks 0x1c/0x1e/0x1f at different sites; under the
 * invariant that X is always a multiple of 4 — every X update is +/-4, +0x20
 * or AND 0xFFE0 — all three agree for a `>= 8` test.) */
function solidAtRowOffset(map, x, y, rowOffset) {
  const si = mapCursor(x, y) + rowOffset * MAP_COLS;
  if (cellAt(map, si) === CELL_SOLID) return true;
  if ((x & 0x1f) >= 8 && cellAt(map, si + 1) === CELL_SOLID) return true;
  return false;
}
export const solidHere       = (map, x, y) => solidAtRowOffset(map, x, y, 0);
export const solidThreeBelow = (map, x, y) => solidAtRowOffset(map, x, y, 3);

/** CS:5A84 / CS:5CCB — the real three-cell wall test, per direction. */
export function wallBlocks(map, x, y, dir) {
  const si = mapCursor(x, y);
  const sub = x & 0x1f;
  if (dir < 0) {
    if (sub !== 0) return false;                 // probe only on the boundary
    return cellAt(map, si - 1)     === CELL_SOLID
        || cellAt(map, si + 0x7f)  === CELL_SOLID
        || cellAt(map, si + 0xff)  === CELL_SOLID;
  }
  if (sub >= 8) return false;                    // probe only below the straddle point
  return cellAt(map, si + 1)     === CELL_SOLID
      || cellAt(map, si + 0x81)  === CELL_SOLID
      || cellAt(map, si + 0x101) === CELL_SOLID;
}

/* CS:0x4a15-0x4a6a (idle's own UP handler) — the general "is there a ladder
 * here" test: current row (head level) OR the row directly below it, with a
 * single straddle split at sub-position 0x10 (not the wall probes' 8, and
 * not one test per row — each row is tested at ONLY the column the split
 * picks). Re-read off the disassembly while chasing the climb-entry bug
 * below: a single-row test (what this used to be) is one vertical pixel of
 * rounding away from missing a ladder the original would have found. Used
 * for both entry (_ground) and continuation (_climb). */
/** Which column actually matched — 0 (the hero's own column) or 1 (one
 *  column to the right) — or null. The entry sites need this, not just the
 *  boolean: see `ladderSnapX` below. */
function climbableHereCol(map, x, y) {
  const si = mapCursor(x, y);
  const col = (x & 0x1f) >= 0x10 ? 1 : 0;
  if (cellAt(map, si + col) === CELL_CLIMBABLE
      || cellAt(map, si + MAP_COLS + col) === CELL_CLIMBABLE) return col;
  return null;
}
function climbableHere(map, x, y) {
  return climbableHereCol(map, x, y) !== null;
}
/* The ladder-continues tests run AFTER each climb step, on the cursor of the
 * NEW position (CS:0x496A: column x & ~31, no straddle split):
 *   ascending  CS:0x58E7  row +1 or row -1 is a ladder   ([si+0x80] / [si-0x80])
 *   descending CS:0x569B  row +2 or row +3 is a ladder   ([si+0x100] / [si+0x180])
 * [PROVEN] against PJOYL3 972: the descending hero drops off the ladder's
 * foot where the port (testing rows 0/+1, with a straddle column) kept
 * climbing. */
const ladderAbove = (map, x, y) => {
  const si = mapCursor(x, y);
  return cellAt(map, si + MAP_COLS) === CELL_CLIMBABLE || cellAt(map, si - MAP_COLS) === CELL_CLIMBABLE;
};
const ladderBelow = (map, x, y) => {
  const si = mapCursor(x, y);
  return cellAt(map, si + 2 * MAP_COLS) === CELL_CLIMBABLE || cellAt(map, si + 3 * MAP_COLS) === CELL_CLIMBABLE;
};

/* CS:0x14ED3/0x14F15 (state 8) and their mirrors CS:0x150D2/0x15114 (state
 * 9) — the mid-air ladder-grab test. UNLIKE `climbableHereCol` above, this
 * has NO straddle split: the caller already requires `x & 0x1f == 0`
 * (exact tile alignment), so the column is always `si+0`, never `si+1`. The
 * two directions are also NOT mirrors of each other here: UP tests only the
 * current row; DOWN additionally accepts the row directly below (matching
 * the asymmetry documented elsewhere in this file between ladder-ascend and
 * ladder-descend entries). Both call sites in `_jump()` already guarantee
 * alignment before calling either of these. */
function climbableAtAlignedCol(map, x, y) {
  return cellAt(map, mapCursor(x, y)) === CELL_CLIMBABLE;
}
function climbableAtAlignedColOrBelow(map, x, y) {
  const si = mapCursor(x, y);
  return cellAt(map, si) === CELL_CLIMBABLE
      || cellAt(map, si + MAP_COLS) === CELL_CLIMBABLE;
}

/* CS:0x4A36/0x59AB/0x5A3C/0x5BF3/0x5C80 — the ladder X snap, and it is NOT
 * unconditional. `add word [0x17a],0x20` runs ONLY on the col-1 (one column
 * right) match; the col-0 (the hero's OWN column) match jumps straight to
 * the `and word [0x17a],0xffe0` alone (e.g. CS:0x4a61 `jz 0x1000:4a3b`, which
 * is the AND, skipping the ADD two bytes before it at 0x4a36). So a hero
 * already standing in the ladder's own column is floored to that SAME
 * column; only an approach from the col-1 side advances a whole tile.
 * ⚠️ Applying `(x+0x20)&0xFFE0` unconditionally — as this port used to —
 * shoves a col-0 entry one tile PAST the ladder, into whatever the next
 * column holds. That is the reported clipping bug: the hero snaps into
 * solid geometry beside the ladder instead of standing on it. */
function ladderSnapX(x, col) {
  return col === 1 ? (x + 0x20) & 0xFFE0 : x & 0xFFE0;
}

/* CS:0x598a-0x59e5 (walk-left) / CS:0x5bd2-0x5c02 (walk-right) — the
 * DOWN-onto-ladder entry test, three rows (48 px, the hero's own height)
 * below the current position. Unlike the test above, this one has an
 * overlapping straddle window rather than a hard split: sub-position
 * 0x0c..0x14 tries BOTH columns before giving up. (The original also gates
 * this behind a `call 0x5b38 / jc` that falls to crouch instead when it
 * fails — not modelled here; a port press that would have crouched may
 * descend a ladder instead in that narrow edge case.) */
/* CS:0x599d tries col+1 FIRST (only when sub >= 0xc); CS:0x59de falls back
 * to col+0 (only when sub <= 0x14) — same priority a caller needs for the
 * snap, not just the OR this used to collapse it to. */
function climbableThreeBelowCol(map, x, y) {
  const si = mapCursor(x, y) + 3 * MAP_COLS;
  const sub = x & 0x1f;
  if (sub >= 0x0c && cellAt(map, si + 1) === CELL_CLIMBABLE) return 1;
  if (sub <= 0x14 && cellAt(map, si) === CELL_CLIMBABLE) return 0;
  return null;
}
function climbableThreeBelow(map, x, y) {
  return climbableThreeBelowCol(map, x, y) !== null;
}

/* CS:0x5797-0x57a4 (dismount right) / CS:0x5806-0x5813 (dismount left) — a
 * secondary guard past the wall probe: when the hero isn't exactly row
 * -aligned (`Y & 0xf != 0`), also require the cell three rows below, one
 * column toward the dismount side, to be clear. Row-aligned dismounts skip
 * this test outright. */
function dismountBlocked(map, x, y, dir) {
  if ((y & 0xf) === 0) return false;
  const si = mapCursor(x, y) + 3 * MAP_COLS + dir;
  return cellAt(map, si) === CELL_SOLID;
}

export class Player {
  constructor(x, y) {
    this.x = x | 0;          // DS:0x17a
    this.y = y | 0;          // DS:0x17c
    this.fallV = 0;          // DS:0x1b2
    this.airSteps = 0;       // DS:0x345
    this.jumpCursor = 0;     // DS:0x358, byte offset stepping +2
    this.state = ST.FALL;
    this.facing = 1;
    this.doubleJump = false; // DS:0x174 != 0
    this.fromLadder = false; // seeds the ladder-jump phase, see _ground
    /* DS:0x1b4 — the X the CURRENT jump launched from. Its only four writers
     * in the original are the two ground take-offs (CS:0x5A14/0x5C58) and the
     * two ladder jump-offs (CS:0x590F/0x5924); its only readers are the
     * mid-air ladder-grab checks in `_jump()`. It exists purely to block an
     * instant re-grab of the column just launched from (X hasn't moved yet on
     * the wind-up ticks) — never cleared, exactly like the original. */
    this.jumpTakeoffX = null;

    /* Original-machine mirrors, for rendering. */
    this.stateIndex = S.FALL_R;   // DS:0x377
    this.phase = 0;               // DS:0x36b (CL), sign-extended as a byte
    this.footstep = false;        // set on the ticks the original plays FOOTSTEP_SFX
    this.keyCollected = null;     // {type, slot} on the tick CS:0x60F0 fires
    this.dropped = null;          // {id, x, y}: the crouch drop's popup request, CS:0x61CA
    this.leverToggled = null;     // the object toggled/armed this tick, CS:0x1045

    /* ── The FIRE overlay ───────────────────────────────────────────────
     * The eight firing states are NOT a fifth entry in `ST`. They carry their
     * own movement — 5/6 stand still, 20/21 keep the jump arc running, 22/23
     * run the full fall physics, 24/25 hold the ladder — so they overlay the
     * existing four-way dispatch rather than replacing it. `phase` stays the
     * walk counter; the fire counter is its own variable, because sharing one
     * field clobbers the 8-frame cycle the hero returns to. */
    this.fireState = -1;          // DS:0x377 while firing; -1 = not firing
    this.firePhase = 0;           // the fire CL — SEPARATE from `this.phase`
    this.flag356 = false;         // DS:0x356 — the fall/jump wind-up dip
    this.ladderFacing = 0;        // DS:0x378 — 1 right, -1 left, 0 none
    this.savedLadderPhase = 0;    // DS:0x359
    this.savedLadderY = 0;        // DS:0x1b6
    this.pendingAlloc = null;     // reserved on the press, emitted 3 ticks on
    this.emitted = null;          // {right} on the tick a shot actually spawns
    this.ladderPingPong = false;  // DS:0x347 — the climb-cycle direction flag
    this.dismountHold = 0;        // DS:0x353 / DS:0x348 — shared, see _climb
    this.climbStep = false;       // set on the ticks the original plays CLIMB_STEP_SFX
    /* What the sprite selector should use. Equal to `phase` everywhere except
     * walk+fire, which renders through the DS:0xd950 recoil table while
     * persisting the raw counter (CS:0x5D6B stores, then CS:0x5D75 remaps). */
    this.renderPhase = 0;
  }

  /**
   * CS:0x0FF2-0x1022 — a teleport zone (or the teleport stone) firing.
   * Snaps world position, clears the fire/ladder/jump/fall state exactly as
   * the original's own write set does (`[0x36b]:=0`, `[0x377]:=4`), and
   * leaves the hero in state 4 — the "spawn / arrival idle pose" this
   * project already identified at its two other entrants (level start,
   * respawn). State 4's own handler is not separately ported (see the scope
   * note at the top of this file), so this sets the internal `ST.GROUND`
   * bucket the same way landing does: the original's state 4 body itself
   * "reads LEFT/RIGHT only... otherwise falling into state 15's ground
   * check" (states.js), so grounded is the nearest real approximation for
   * the tick after arrival, not an invented one.
   * @param {number} x  world X, already CS:0x0FF2's `col*32 + 16`
   * @param {number} y  world Y, already CS:0x0FEE's `row*16`
   */
  /**
   * CS:0x8C34-0x8CDC (FUN_1000_8c34) — THE LEVEL-LOAD SEED. The first of
   * state 4's three named entrants; the other two (respawn CS:0x08D6,
   * teleport arrival CS:0x1022) already route through `teleportTo` below.
   * Until now the port had NO equivalent: a fresh level used the
   * constructor's uncited ST.FALL / S.FALL_R default and the first ground
   * contact turned that into S.IDLE (26) — the BACK view. See this file's
   * header section "THE LEVEL-START POSE" for the full derivation.
   *
   *     8C3E  mov byte [0x377],0x4      ; state 4 — the spawn / arrival pose
   *     8C43  mov byte [0x378],0x0      ; the ladder-FIRE latch, NOT a facing
   *     8C48  ax=[0x15a] / [0x17a]=ax   ; the per-world spawn X
   *     8C4E  bx=[0x15c] / [0x17c]=bx   ; ... and Y
   *     8CAA  sub ax,ax
   *     8CAC  mov [0x36b],al            ; animation phase := 0
   *     8CD0  mov [0x174],ax            ; double-jump flag := 0
   *     8CDC  mov [0x176],ax            ; fall-damage accumulator := 0
   *
   * @param {number} x  the per-world spawn X (DS:0x15a)
   * @param {number} y  the per-world spawn Y (DS:0x15c)
   */
  spawnAtLevelStart(x, y) {
    this.x = x | 0;                      // CS:0x8C4B  [0x17a]
    this.y = y | 0;                      // CS:0x8C52  [0x17c]
    this.state = ST.GROUND;
    this.fallV = 0; this.airSteps = 0; this.jumpCursor = 0;
    this.fallDamage = 0;                 // CS:0x8CDC  [0x176] := 0
    this.doubleJump = false;             // CS:0x8CD0  [0x174] := 0
    this.fromLadder = false;
    this.fireState = -1; this.pendingAlloc = null; this.emitted = null;
    this.ladderFacing = 0;               // CS:0x8C43  [0x378] := 0
    this.flag356 = false;
    this.stateIndex = S.ARRIVAL;         // CS:0x8C3E  [0x377] := 4
    this.phase = 0;                      // CS:0x8CAC  [0x36b] := 0
    this.renderPhase = 0;
  }

  teleportTo(x, y) {
    this.x = x | 0;
    this.y = y | 0;
    this.state = ST.GROUND;
    this.fallV = 0; this.airSteps = 0; this.jumpCursor = 0;
    this.doubleJump = false; this.fromLadder = false;
    this.fireState = -1; this.pendingAlloc = null; this.emitted = null;
    this.ladderFacing = 0; this.flag356 = false;
    this.stateIndex = S.ARRIVAL;         // CS:0x1022
    this.phase = 0;                       // CS:0x1018 `[0x36b] := 0`
    this.renderPhase = 0;
  }

  /**
   * One 15 Hz logic tick.
   * @param {object} map
   * @param {{left,right,up,down,fire}} input
   * @param {?{allocate:Function, emit:Function}} fire  the Arsenal, or null.
   *        `allocate()` returns an allocation or null (the original's inverted
   *        `cmp ax,0`); `emit(alloc, x, y, right)` writes the records.
   * @param {number} tock  DS:0x36c, the every-other-frame toggle (CS:0x0172
   *        `not`). Only `_climb` reads it. Defaults to a value that always
   *        leaves the gate open, so a caller that doesn't thread the real
   *        toggle through (tests, tools) climbs at the pre-existing rate
   *        rather than silently halving it.
   * @param {?{objects:Array, cats:Array, inventory:Array, levers:?Array,
   *        leverToggle:?object}} pickup  the live map objects, the category
   *        table, and the 4-slot inventory — everything `_crouch`'s key scan
   *        (CS:0x6069) needs. `levers`/`leverToggle` additionally feed idle's
   *        own fire dispatch (CS:0x1045, game/levers.js). `null` is a valid
   *        caller (tests, tools): crouch entry/exit and idle both still work,
   *        only the scans themselves become a no-op.
   * @param {?{invulnerable:boolean, hurt:Function}} health  CS:0x172/0x192,
   *        threaded only into `_fall`/`_fireTick`'s fall branch for landing
   *        damage (`fallDamageFor`, above) — no other state ever costs
   *        health on its own. `null` is a valid caller (tests, tools): the
   *        fall physics run identically, landing simply never damages.
   */
  /** A tick whose dispatch is skipped and only the epilogue (CS:0x5E9B)
   *  runs: the shopkeeper's turn once facing (CS:0x06D9) and its walk
   *  (CS:0x49AA). Nothing moves; the per-tick outputs are cleared. */
  hold() {
    this.footstep = false;
    this.climbStep = false;
    this.landSfx = 0;
    this.landSites = [];
    this.inventoryCycled = false;
    this.emitted = null;
    this.keyCollected = null;
    this.dropped = null;
    this.leverToggled = null;
    this.zoneHit = null;
  }

  tick(map, input, fire = null, tock = 1, pickup = null, health = null, tock36d = tock) {
    /* DS:0x36D — gravity's own every-other-tick gate (CS:0x48BB). It runs in
     * step with DS:0x36C except after a shop, whose loop toggles 0x36C alone
     * (CS:0x6C9E), so it is passed separately. Defaults to `tock`. */
    this.tock36d = tock36d;
    this.footstep = false;
    this.climbStep = false;
    this.landSfx = 0;            // plays of 0x318 (CS:0x4C54) this tick — see _enterLand
    this.landSites = [];         // which CS:0x4C54 call sites they are (?debug trace)
    this.inventoryCycled = false; // CS:0x615F, the crouch FIRE tap (sound 0x2831) — see _crouch
    this.emitted = null;
    this.keyCollected = null;
    this.dropped = null;
    this.leverToggled = null;
    this.zoneHit = null;
    if (this.fireState >= 0) { this._fireTick(map, input, fire, health, pickup, tock); return; }
    switch (this.state) {
      case ST.GROUND: this._ground(map, input, fire, pickup); break;
      case ST.JUMP:   this._jump(map, input, fire);   break;
      case ST.FALL:   this._fall(map, input, fire, health, tock); break;
      case ST.CLIMB:  this._climb(map, input, fire, tock); break;
      case ST.CROUCH: this._crouch(input, pickup);    break;
      case ST.LAND:   this._land();                   break;
    }
    if (this.fireState < 0) this.renderPhase = this.phase;
  }

  /**
   * Enter a firing state, reproducing the shared entry core:
   *     test byte [0x382],0x80 / jz  keepGoing
   *     call 0x95ca / cmp ax,0 / jnz keepGoing      (0 == allocated)
   *     mov byte [0x377],<state>
   * @returns {boolean} true when the state was entered — the caller must then
   *          skip the rest of its own handler, exactly as the original's
   *          `jmp` past the movement code does.
   */
  _tryFire(stateId, input, fire, extra = {}) {
    if (!fire || !input.fire) return false;
    const e = ENTRY[stateId];
    if (!e) return false;
    /* ⚠️ THE GUARDS STRADDLE THE ALLOCATOR, and which side each sits on is
     * observable through the latch. The ladder's facing test genuinely comes
     * first (CS:0x55D6 precedes CS:0x55DF), and so does the jump's LOWER arc
     * guard (CS:0x51C4) — but the jump's UPPER guard is eight bytes PAST the
     * call (CS:0x51DA), so a press late in a jump runs the allocator, sets
     * DS:0x351, and is only then rejected. That press is consumed: the player
     * must release before firing again. Evaluating it first would leave the
     * latch clear and let the very next tick fire. */
    if (!fireGuardBefore(stateId, extra)) return false;
    const alloc = fire.allocate();             // CS:0x95ca — SETS THE LATCH
    if (!alloc) return false;                  // `cmp ax,0 / jnz` — nothing free
    if (!fireGuardAfter(stateId, extra)) return false;   // the press is spent
    this.fireState = stateId;
    this.firePhase = e.cl;
    this.flag356 = !!e.flag356;
    this.pendingAlloc = alloc;
    this.stateIndex = stateId;
    this.renderPhase = fireAnimOffset(stateId, e.cl);
    return true;
  }

  /** One tick inside a firing state.
   * @param {?{invulnerable:boolean, hurt:Function}} health  see `tick`'s own
   *        doc — threaded only into the fall+fire family's landing branch. */
  _fireTick(map, input, fire, health = null, pickup = null, tock = 1) {
    const id = this.fireState;
    const st = FIRE_STATES[id];
    const flag = this.flag356;

    /* CS:0x5D57 — only the walk family re-checks fire at phase 5, and it does
     * so by CALLING the allocator, so the call must not be made speculatively
     * on any other tick. Pre-compute the phase to decide. */
    const cl = flag ? this.firePhase - 1 : this.firePhase + 1;
    let chained = null;
    if (st.anim === 'table' && cl >= 5 && input.fire && fire) chained = fire.allocate();

    const r = fireTick(id, this.firePhase, input.fire, !!chained, flag,
                       this.savedLadderPhase);
    this.flag356 = false;                      // CS:0x5341 / 0x4DCC — one shot


    /* ── the family's own movement, which runs regardless of the phase gate ── */
    let override = null;
    let steerAbort = false;
    if (st.family === 'jump') {
      /* CS:0x536C `add word [0x17a],4`, behind the same three-cell probe the
       * walk uses; then the arc delta from DS:0xd922 at the CURRENT cursor. */
      this._walk(map, st.right ? +1 : -1);
      /* CS:0x5371-0x5394 — the pre-arc landing test (cursor >= 0x16), into
       * the landing pose, before the arc delta and before the emit. */
      if (this.jumpCursor >= JUMP_ARC_EARLY_LAND_CURSOR && solidThreeBelow(map, this.x, this.y)) {
        this._fireLand(st.right);
        return;
      }
      const i = this.jumpCursor >> 1;
      if (i < JUMP_DELTAS.length) {
        const d = JUMP_DELTAS[i];
        this.y -= d;
        if (this.doubleJump) this.y -= d;      // CS:0x53AD
      }
      /* CS:0x4E4E's shared ceiling-ejection check (see the plain `_jump` for
       * the full derivation) is reached from a jump-fire exactly as it is from
       * an ordinary jump — a fired shot doesn't exempt the hero from clipping
       * head-first through a low platform. */
      if (solidHere(map, this.x, this.y)) {
        this.y = (this.y & 0xfff0) + 0x10;
        this._leaveFire(st.right ? S.FALL_R : S.FALL_L, 0);
        return;
      }
      /* CS:0x53DE-0x53EB — the post-arc landing test. ⚠️ Its threshold is
       * 0x12, NOT the plain jump's 0x16 (CS:0x51B5): a firing jump can land
       * two arc steps earlier. [PROVEN] live: PJOYL1 cursor 192. */
      if (this.jumpCursor >= 0x12 && solidThreeBelow(map, this.x, this.y)) {
        this._fireLand(st.right);
        return;
      }
      this.jumpCursor += JUMP_ARC_STEP;        // CS:0x53F9 / 0x542B — BOTH paths
      if (this.jumpCursor >= JUMP_ARC_END) {
        /* ⚠️ The cursor exit WINS over the phase exit — it is tested after. */
        override = { next: JUMP_ARC_EXIT[id], cl: 0 };
      }
    } else if (st.family === 'fall') {
      /* CS:0x4DD5 — +4, then gravity, then the velocity, then fall-damage.
       * No steering: states 22/23 never test the direction bits. */
      this.y += FALL_BASE;
      this._gravity(this.tock36d);                       // CS:0x48B0
      this.y += this.fallV;
      this.fallDamage = (this.fallDamage || 0) + 1;      // DS:0x176
      /* CS:0x4DEE `call 0x48d4` — the fall-fire pair steers too (an earlier
       * note here said states 22/23 never test the direction bits). A
       * steering press overwrites [0x377] with 11/12, so the firing state
       * ends after this tick; see `steerAbort` below. */
      steerAbort = this._airSteer(map, input);
      if (solidThreeBelow(map, this.x, this.y)) {        // CS:0x4DF1
        this.y &= 0xfff0;
        this.fallV = 0; this.airSteps = 0;
        this.fireState = -1; this.pendingAlloc = null;
        /* CS:0x4D3E-0x4D4F — the fall+fire tick's OWN copy of the byte-
         * identical fallDamageFor formula (see the plain `_fall`'s own
         * citation for the fresh-disassembly confirmation). */
        if (health) {
          const dmg = fallDamageFor(this.fallDamage);
          if (dmg > 0 && !health.invulnerable) health.hurt(dmg);
        }
        /* CS:0x4DF8/0x4E0D -> 0x4D2A (right) and the left mirror -> 0x4C28:
         * the SAME landing the plain fall uses, into the landing pose. */
        this._enterLand(st.right, false, st.right ? LAND_FALL_RIGHT : LAND_FALL_LEFT);
        this.renderPhase = 0;
        return;
      }
    }
    /* THE EMIT. CS:0x5D4E / 0x5423 / 0x4E1D / 0x5461 — `call 0x9734`. In
     * the jump and fall families it sits AFTER the movement and the landing
     * and ceiling tests (CS:0x5423 follows 0x5371-0x53EB; CS:0x4E1D follows
     * the landing at 0x4DF1), so a tick that lands or bumps never emits. */
    if (r.emit && this.pendingAlloc && fire) {
      fire.emit(this.pendingAlloc, this.x, this.y, st.right);
      /* CS:0x985F / 0x9895 play 0x41C once per slot they dispatch, before
       * the handler: one per allocated slot (CS:0x9739 skips the empty). */
      const sounds = this.pendingAlloc.allocated.filter(Boolean).length;
      this.emitted = { right: st.right, state: id, sounds };
      this.pendingAlloc = null;
    }
    if (chained) this.pendingAlloc = chained;  // the next cycle's reservation

    /* The air steer above rewrote [0x377] to a plain fall state; nothing
     * later in the fall-fire handler writes it back unless the phase exit
     * fires this same tick, so from the next tick on the hero is falling. */
    if (steerAbort && !(r.next !== id)) {
      const right = this.facing > 0;
      this.fireState = -1;
      this.pendingAlloc = null;
      this.state = ST.FALL;
      this.stateIndex = right ? S.FALL_R : S.FALL_L;
      this.phase = r.phase;
      this.renderPhase = r.phase;
      return;
    }

    /* walk and ladder move nothing: state 5's body is `inc cl`, the emit gate,
     * the chain check and the animation — there is no X step in it at all, so
     * firing while walking HALTS the hero for the whole 5-tick cycle. */

    if (override) {
      this._leaveFire(override.next, override.cl);
      return;
    }
    if (r.next !== id) {
      this._leaveFire(r.next, r.nextCl);
      /* CS:0x5D7A-0x5D81 (`mov cl,2 / mov [0x377],1 / jmp 0x5B83`) and
       * CS:0x5DB1-0x5DB8 (`... [0x377],0 / jmp 0x593B`): the walk pair does
       * not end the tick on exit — it JUMPS INTO the destination walk
       * handler's own entry (states.js: 0x5B83 is state 1's handler, 0x593B
       * state 0's), which then runs its whole body this same tick with
       * CL=2. So a direction still held when the cycle ends steps +/-4
       * immediately. The jump/fall/ladder exits all end at the common tail
       * CS:0x5E9B instead and do not fall through. [PROVEN] live: PJOYG1
       * cursor 146, right held as state 5 ends — DOSBox steps 3680->3684 on
       * that tick. */
      if (st.family === 'walk') {
        this._ground(map, input, fire, pickup);
        if (this.fireState < 0) this.renderPhase = this.phase;
      }
      return;
    }

    this.firePhase = r.phase;
    this.stateIndex = id;
    this.renderPhase = fireAnimOffset(id, r.phase);
  }

  /** CS:0x5380 (jump-fire right; the left pair mirrors it): landing out of
   *  a firing jump — `mov [0x377],0x10 / and [0x17c],0xfff0 / xor cl,cl /
   *  mov [0x357],0`, the same landing pose a plain jump or fall enters. */
  _fireLand(right) {
    this.y &= 0xfff0;
    this.fireState = -1;
    this.pendingAlloc = null;
    this.fallV = 0; this.airSteps = 0;
    this._enterLand(right, false, right ? [0x5391] : [0x5274]);   // the firing jumps
    this.renderPhase = 0;
  }

  /** Hand control back to a normal state, choosing the matching ST bucket. */
  _leaveFire(stateIndex, cl) {
    const st = FIRE_STATES[this.fireState];
    if (st && st.family === 'ladder') this.y = this.savedLadderY;   // CS:0x547E
    this.fireState = -1;
    this.pendingAlloc = null;
    this.stateIndex = stateIndex;
    this.phase = cl;
    this.renderPhase = cl;

    /* Every destination this overlay can reach names its own direction, so
     * facing is read off the state index rather than carried over. */
    const RIGHT = [S.WALK_R, S.JUMP_R, S.FALL_R];
    const LEFT  = [S.WALK_L, S.JUMP_L, S.FALL_L];
    if (RIGHT.includes(stateIndex)) this.facing = +1;
    else if (LEFT.includes(stateIndex)) this.facing = -1;

    if (stateIndex === S.WALK_L || stateIndex === S.WALK_R) this.state = ST.GROUND;
    else if (stateIndex === S.JUMP_L || stateIndex === S.JUMP_R) this.state = ST.JUMP;
    else if (stateIndex === S.CLIMB || stateIndex === S.CLIMB_DOWN) this.state = ST.CLIMB;
    else if (stateIndex === S.FALL_L || stateIndex === S.FALL_R || stateIndex === S.FALL_LADDER) {
      /* CS:0x540F / 0x5441 clear the fall triple on the way out of a jump. */
      this.state = ST.FALL;
      this.fallV = 0;
      this.airSteps = 0;
      this.fallDamage = 0;
    }
  }

  _enterFall() {
    this.state = ST.FALL;
    this.fallV = 0;        // [0x1b2] = 0
    this.airSteps = 0;     // [0x345] = 0
    /* [0x176] = 0 — every original fall entry writes it: ledge walk-off
     * (CS:0x5967 / 0x5BAF), jump end (CS:0x53D3 / 0x541A) and ladder bottom
     * (CS:0x56C1). It matters now that the landing pose (`_land`) drains
     * this accumulator: a stale value would lengthen the next landing. */
    this.fallDamage = 0;
    /* CS:4BE9 / 4CEB `xor cl,cl` sits on the fall handlers' main path. */
    this.stateIndex = this.facing < 0 ? S.FALL_L : S.FALL_R;
    this.phase = 0;
  }

  /** Returns true if the step was taken. */
  _walk(map, dir) {
    this.facing = dir;
    if (wallBlocks(map, this.x, this.y, dir)) return false;
    this.x += dir * WALK_STEP;
    return true;
  }

  /**
   * CS:0x5dbb (state 2, turn left->right, base 8) / CS:0x5dde (state 3,
   * turn right->left, base 8) — fresh instruction-by-instruction
   * disassembly of both handler bodies:
   *
   *   state 2 (CS:0x5dbb-0x5ddb):
   *     5dbb  TEST [0x382],0x4 (LEFT) / JZ 5dca
   *     5dc2    MOV [0x377],3            ; LEFT held -> reverse into state 3
   *     5dca  INC CL / CMP CL,3 / JGE 5dd4
   *     5dd1    JMP 5e9b                 ; cl<3 -> stay, render w/ incremented cl
   *     5dd4    MOV CL,6 / MOV [0x377],1 / JMP 5e9b   ; cl>=3 -> exit to WALK_R
   *
   *   state 3 (CS:0x5dde-0x5dfb) is the byte-identical mirror: TEST RIGHT
   *   (0x8) first, else `DEC CL / JS` (exits on the SIGN flag, not a CMP)
   *   to WALK_L with CL:=6.
   *
   * Entry, also fresh: state 0 -> 2 at CS:0x5979 (CL:=0, an XOR); state
   * 1 -> 3 at CS:0x5bc1 (CL:=2 — asymmetric with 0->2's own entry). Hand-
   * computed render sequences from these exact bytes match the previously
   * `[WF]`-tagged table in `Gods/docs/player-state-machine.md`, now
   * independently confirmed: 0->2 renders sprites 9,10,17; 1->3 renders
   * 9,8,6. No X step, no fire/jump/crouch test anywhere in either body —
   * the turn is a stationary pivot, committed for its 2-3 ticks.
   *
   * THE CANCEL BRANCH — now ported, `[PROVEN]` by a fresh
   * `disassemble_bytes` over CS:0x5dbb-0x5dfa (GAME.EXE) that resolved the
   * one byte this port previously left unread: what sits at 0x5dc7-0x5dc9,
   * right after state 2's `MOV [0x377],3`. It is `JMP 0x5e9b` (`e9 d1 00`),
   * straight to the epilogue — NOT a fallthrough into the counter tail at
   * 0x5dca. So the cancel is unconditional and instantaneous: on a tick
   * where the OTHER direction is held, the state flips (2<->3) and `CL`
   * (phase) is left completely untouched — no ramp step happens that tick.
   * This is why the cancel is invisible on screen: base(2) == base(3) == 8,
   * so sprite = 8 + sign_extend(CL) renders identically either way. State
   * 3's mirror (`CS:0x5de3`-`0x5dea`) is byte-identical in shape, testing
   * RIGHT (0x8) instead of LEFT (0x4).
   *
   * The cancel does NOT reset `CL` to the other state's own entry value —
   * it inherits whatever the ramp had reached. So the resulting reversal's
   * length depends on WHEN the cancel fires, not just that it fired: a
   * same-tick cancel (CL still 0) hands state 3 a `dec/js` one step from
   * firing — 1 more tick to WALK_L. A cancel on the ramp's last tick (CL
   * already 2, about to exit) hands state 3 a `dec/js` three steps out —
   * 3 more ticks. A late cancel can therefore take LONGER to resolve than
   * an uncancelled turn (2-3 ticks) would have, not "just as fast" — the
   * bytes don't reset the counter, they only redirect it.
   *
   * Holding BOTH directions at once makes the cancel test true in both
   * states, so the pivot oscillates 2<->3 forever, `CL` frozen at whatever
   * it was on the first cancel, without ever reaching WALK_L/WALK_R —
   * reproduced here, not smoothed over (see the `both keys held` case in
   * checks.js).
   */
  _turn(input) {
    if (this.stateIndex === S.TURN_LR) {
      if (input.left) { this.stateIndex = S.TURN_RL; return; }   // CS:0x5dc2
      this.phase += 1;
      if (this.phase >= 3) {
        this.phase = 6;
        this.stateIndex = S.WALK_R;
        this.facing = +1;
      }
    } else {
      if (input.right) { this.stateIndex = S.TURN_LR; return; }  // CS:0x5de5
      this.phase -= 1;
      if (this.phase < 0) {
        this.phase = 6;
        this.stateIndex = S.WALK_L;
        this.facing = -1;
      }
    }
  }

  _ground(map, input, fire, pickup) {
    /* CS:0x5dbb (state 2, turn left->right) / CS:0x5dde (state 3, turn
     * right->left) — a brief, STATIONARY pivot the original inserts on a
     * genuine direction reversal (see the entry check below), not present
     * at all in an earlier revision of this port, which instantly flipped
     * WALK_L<->WALK_R on any direction switch. Dispatched first, before
     * anything else in this function, exactly as states 2/3 have no fire,
     * jump or crouch test of their own — see `_turn`'s own header for the
     * fresh disassembly this rests on. */
    if (this.stateIndex === S.TURN_LR || this.stateIndex === S.TURN_RL) {
      this._turn(input);
      return;
    }
    /* CS:0x4ACC (state 27) / CS:0x4AD6 (state 28): `mov cl,2 / mov
     * [0x377],0 (1) / jmp 0x5e9b` — the whole handler. No input, no ground
     * test, no step: one tick that just hands over to the walk state. */
    if (this.stateIndex === S.IDLE_TO_L || this.stateIndex === S.IDLE_TO_R) {
      const right = this.stateIndex === S.IDLE_TO_R;
      this.stateIndex = right ? S.WALK_R : S.WALK_L;
      this.facing = right ? +1 : -1;
      this.phase = 2;
      return;
    }
    /* CS:0x49CA (state 26, idle): `sub cl,cl`, then RIGHT -> state 28 and
     * LEFT -> state 27, each ending the tick. So leaving idle costs two
     * ticks before the first step (idle -> 28 -> 1 -> step). [PROVEN] live:
     * PJOYL1 cursors 279-281 (st28 at 404, st1 at 404, then 408). */
    if (this.stateIndex === S.IDLE && (input.right || input.left)) {
      this.stateIndex = input.right ? S.IDLE_TO_R : S.IDLE_TO_L;
      this.facing = input.right ? +1 : -1;
      this.phase = 0;
      return;
    }
    /* CS:0x593B (state 0) / CS:0x5B83 (state 1): the walk handlers test the
     * ground under the hero FIRST, at the position he is already at —
     *     call 0x496a ; cmp [si+0x180],1 / jz ok ; (x straddle) [si+0x181]
     *     mov [0x377],0x0b / 0x0c ; [0x1b2]:=0 ; [0x345]:=0 ; [0x176]:=0 ; cl:=0
     *     jmp 0x5e9b
     * so the step that carries him over a ledge completes, and the fall
     * starts on the NEXT tick, without moving. [PROVEN] live: PJOYG3 walks
     * to x=160 on cursor 41 (still state 1) and enters state 12 on 42.
     * (The port used to test ground after the step and fall the same tick.) */
    const walkAtEntry = this.stateIndex === S.WALK_L || this.stateIndex === S.WALK_R;
    if (walkAtEntry && !solidThreeBelow(map, this.x, this.y)) { this._enterFall(); return; }
    const moving = input.left || input.right;
    /* ⚠️ EVERY GROUND STATE HAS ITS OWN FIRE TEST, and each one means
     * something different — see hero-fire.js's own header. State 0/1's own
     * test (CS:0x5A64 / CS:0x5CA8) sits BEFORE the X step and checks ONLY the
     * fire bit, not whether its own direction key is still held — so it also
     * fires from the "locked stopped pose" below (released without UP), not
     * only while actively walking. State 26's own test (CS:0x49EA) instead
     * calls CS:0x1045 — the LEVER/SWITCH toggle (game/levers.js), corrected
     * away from "object pickup" by pickup.js. A stationary hero with fire
     * held throws a switch; pickup itself has no fire gate at all. */
    if (moving) {
      /* CS:0x5979 (state 0 -> 2, entry CL:=0) / CS:0x5bc1 (state 1 -> 3,
       * entry CL:=2 — asymmetric with 0->2's own entry, confirmed fresh).
       * Only a genuine reversal enters the turn — continuing in the SAME
       * direction, or a first press from a dead standstill, goes straight
       * to WALK as before. `UNKNOWN_turn_reversal_priority`: whether this
       * pre-empts state 0/1's own fire test (CS:0x5A64/0x5CA8) in the
       * original, or fire wins when both are pressed on the same tick, was
       * not established this pass — this port checks the reversal first. */
      if (this.stateIndex === S.WALK_L && input.right) {
        this.stateIndex = S.TURN_LR; this.phase = 0; return;
      }
      if (this.stateIndex === S.WALK_R && input.left) {
        this.stateIndex = S.TURN_RL; this.phase = 2; return;
      }
      /* CS:0x5DFE — state 4 (ARRIVAL)'s OWN handler, tested fresh this
       * session: `TEST [0x382],8 (RIGHT) / JZ ... / MOV [0x377],2 ; MOV
       * CL,2 ; JMP 0x5e9b` then, on the LEFT arm, `MOV [0x377],3 ; XOR
       * CL,CL ; JMP 0x5e9b`. Unlike states 0/1 (which only pivot on a
       * genuine reversal, above), ARRIVAL routes EVERY first press through
       * the turn pivot, never walking the same tick — no fire test either,
       * an unconditional jump straight to the epilogue. The entry phases
       * are swapped from 0/1's own reversal entries (0 for 0->2, 2 for
       * 1->3): CS:0x5E0A really does load CL with 2 on the RIGHT arm, and
       * CS:0x5E1E zeroes it on the LEFT arm. Live-confirmed against
       * PJOYG1.DAT's own first "right" press (recorded input tick 14):
       * the original holds hero X for two full ticks (ARRIVAL -> TURN_LR
       * -> WALK_R) before the first real step, landing exactly on
       * PJOYG1.DAT's own tick 16 — this port previously walked on tick 14,
       * two ticks early, `tools/replay-diff.mjs`'s own once-masked lead. */
      if (this.stateIndex === S.ARRIVAL) {
        if (input.right) { this.stateIndex = S.TURN_LR; this.phase = 2; return; }
        if (input.left) { this.stateIndex = S.TURN_RL; this.phase = 0; return; }
      }
      this.facing = input.right ? +1 : -1;
    } else if (this.stateIndex === S.WALK_L || this.stateIndex === S.WALK_R) {
      this.facing = this.stateIndex === S.WALK_L ? -1 : +1;
    } else if (this.stateIndex === S.IDLE && input.fire &&
               pickup && pickup.leverToggle) {
      pickup.leverToggle.tick(pickup.objects, pickup.cats, pickup.levers,
                               { x: this.x, y: this.y });
      this.leverToggled = pickup.leverToggle.lastToggle;
    }
    /* ⚠️ JUMP vs CLIMB priority, re-read from CS:0x5a05-0x5a21 (walk-left),
     * CS:0x5c49-0x5c65 (walk-right) and CS:0x49fe-0x4a6a (idle) — and it used
     * to be backwards. UP alone used to launch a jump whenever the cell
     * under the hero wasn't (yet) climbable, which is exactly what happens
     * when a player walks toward a ladder holding UP the whole way: every
     * tick before reaching the ladder's column jumps, and the jump's own
     * horizontal carry then flies the hero straight over the ladder while
     * airborne — climb is only ever entered from the ground/idle handlers,
     * never from JUMP or FALL, so once airborne the ladder is unreachable
     * until the hero lands past it and has to walk back.
     *
     * The real priority:
     *   - UP together with the direction CURRENTLY being walked -> JUMP,
     *     unconditionally, the map is never consulted (CS:0x5a0c / 0x5c50).
     *   - UP alone (that direction NOT held, i.e. `!moving` here) -> check
     *     for a climbable cell; climb if found.
     *   - UP alone with no climbable cell -> nothing happens this tick
     *     (CS:0x5a64 / CS:0x4a6a `jmp 0x5e9b`) — NOT a jump. */
    /* ⚠️ FIXED — this gate used to be bare `moving`, which is LIVE input
     * (input.left || input.right). CS:0x598a (walk-left) / CS:0x5bd2
     * (walk-right) belong to state 0/1's OWN handler, which keeps running
     * every tick the PERSISTED state is 0/1 — including the "stopped pose"
     * above, where the walk key has been released but stateIndex is
     * deliberately left at WALK_L/WALK_R (see that block's own comment).
     * Gating on live `moving` alone made "walk, stop, press DOWN" — the
     * ordinary way a player ducks — do nothing, because by the time DOWN is
     * pressed neither input.left nor input.right is held. Mirrors the fire
     * test nine lines up, which already uses this same persisted-state proxy.
     * `get_xrefs_to` on both crouch-entry write sites (CS:0x59e5, 0x5c29)
     * returns exactly three conditional jumps each, all inside this same
     * walk-state handler pair, and an exhaustive scan of every
     * `MOV [0x377],...` in the binary found no register-sourced (computed)
     * writer anywhere — every one is a literal immediate. Idle+DOWN (true
     * idle, state 26) still cannot reach crouch in the original at all —
     * only WALK_L/WALK_R's own persisted handler has this check. */
    const inWalkState = moving
      || this.stateIndex === S.WALK_L || this.stateIndex === S.WALK_R;
    if (inWalkState && input.down) {
      /* CS:0x598a (walk-left) / CS:0x5bd2 (walk-right) — `call 0x5b38 / jc`
       * has PRIORITY over the ladder-descend check below: an object sitting
       * near the crouch hot point sends the hero straight to crouch without
       * the map ever being consulted. */
      const nearObject = pickup ? objectNearHotPoint(pickup.objects, this) : false;
      const descendCol = nearObject ? null : climbableThreeBelowCol(map, this.x, this.y);
      /* ⚠️ NOT PORTED, confirmed by fresh disassembly of BOTH handlers this
       * pass (a real fix attempted here first got the polarity backwards —
       * caught before shipping). The direction gate around the col+1/col-0
       * priority is a genuine, CONFIRMED ASYMMETRY between the two states,
       * not a simple "direction held -> crouch" rule either state applies
       * uniformly:
       *   state 0 (CS:0x59a4-0x59a9): col+1 climbable -> test direction ->
       *     HELD -> crouch, NOT held -> descend (col=1, snap). col-0 is
       *     reached only when col+1 doesn't match and is NEVER direction-
       *     gated.
       *   state 1 (CS:0x5be5/0x5c1b-0x5c20): col+1 climbable -> descend
       *     UNCONDITIONALLY, no direction test at all. Direction is instead
       *     tested BEFORE col-0 is even consulted: HELD -> crouch outright
       *     (col-0 never checked), NOT held -> check col-0, descend if
       *     climbable else crouch.
       * i.e. state 0 gates its col+1 branch; state 1 gates its col-0 branch
       * — the mirror is not a mirror here. `climbableThreeBelowCol`'s
       * existing col-0/col-1 priority (verified against both handlers'
       * sub-tile thresholds, 0xc and 0x14) is correct on its own; porting
       * the direction gate needs it to know WHICH state's rule applies, not
       * a single post-hoc `descendCol === 1 ? ...` check. Left as this
       * priority alone, ungated — the same simplification since before this
       * session, now precisely characterized instead of vaguely disclosed.
       * This does NOT affect the new stopped-pose crouch-entry path below:
       * that path only runs with `!moving` (no direction held), which is
       * the "NOT held" arm for BOTH states above, and both states' "NOT
       * held" arm is exactly "defer to col-priority, no override" — so the
       * ungated code already gives the right answer whenever it's reached
       * with no direction held. The unfixed case (a direction ALSO held)
       * was already reachable before this session and remains as it was. */
      if (descendCol !== null) {
        /* CS:0x59ab (walk-left) / CS:0x5bf3 (walk-right) — descend onto a
         * ladder three rows (48 px) below. The port's ladder is simplified
         * (see _climb's own note), so only the state transition and the X
         * snap are reproduced. */
        this.x = ladderSnapX(this.x, descendCol);
        this.state = ST.CLIMB;
        this.stateIndex = S.CLIMB_DOWN;            // CS:0x59BA `mov [0x377],0xd`
        this.phase = 0;
        /* CS:0x59BF `mov cl,0x1a`: state 13's `cmp cl,0x14 / jl` (CS:0x54C3)
         * then clears the phase and moves down on the next open tick,
         * whatever is held. */
        this.climbForce = true;
        this.ladderPingPong = false;
        this.dismountHold = 0;
        this.fromLadder = false;
        return;
      }
      /* CS:0x59e5-0x59f1 (walk-left) / CS:0x5c29-0x5c35 (walk-right) —
       * crouch, facing the direction just walked. ⚠️ CORRECTED — an earlier
       * revision of this fix, and an existing citation elsewhere in this
       * project, claimed `phase` is "deliberately left untouched" at this
       * transition, inheriting the OLD value. Fresh disassembly this pass
       * shows that's wrong: BOTH sites do `XOR CL,CL` (CS:0x59ef / 0x5c33)
       * immediately after writing `[0x377]`, unconditionally — CL is
       * zeroed, not preserved, regardless of what it held on entry (a live
       * walk-cycle phase 0..7, or the locked stopped-pose sentinel
       * 0x2d/0x39 when entering from a stop). This matters concretely: the
       * stopped-pose entry this session's gate fix newly makes reachable
       * would otherwise render `spriteFor(18, 0x2d)=74` / `spriteFor(19,
       * 0x39)=88` for one tick — both well outside this project's own
       * established hero range of [0, HERO_DESCRIPTOR_MAX=57]. With CL
       * correctly zeroed here, that tick renders `spriteFor(18,0)=29` /
       * `spriteFor(19,0)=31` instead — in range, and `_crouch` pins phase
       * to 1 on the very next tick (CS:0x4B11/0x4B86) either way, so this
       * is a one-tick (~67ms) correction, not a new mechanic. */
      this.state = ST.CROUCH;
      this.stateIndex = this.facing < 0 ? S.CROUCH_L : S.CROUCH_R;
      this.phase = 0;
      /* CS:0x59EA-0x59F6 / 0x5C2E-0x5C3A — a fresh crouch clears the FIRE
       * latch [0x341], "scanned" [0x354] and "no key here" [0x355]. */
      this.fireLatch = 0; this.scanned = 0; this.noKey = 0;
      return;
    }
    if (input.up) {
      if (moving) {
        /* CS:0x5A17 — a GROUND take-off is `xor cl,cl / mov byte [0x358],0`.
         * A LADDER take-off instead seeds phase 0x0D / 0x0C
         * (CS:0x5927/0x5912), which is why the hero leaves a ladder in a
         * different pose. */
        this.state = ST.JUMP;
        this.jumpCursor = 0;
        this.stateIndex = this.facing < 0 ? S.JUMP_L : S.JUMP_R;
        this.phase = this.fromLadder ? LADDER_JUMP_PHASE[this.stateIndex] : 0;
        this.fromLadder = false;
        this.jumpTakeoffX = this.x;   // CS:0x5A14/0x5C58 — see jumpTakeoffX's own note
        return;
      }
      /* CS:0x49FE-0x4A12 — idle's UP branch calls the zone scan (CS:0x4A6D)
       * FIRST; a hit (`[0x370]`) ends the tick via 0x5E9B, before the ladder
       * test. This is the scan's ONLY caller (a live-image scan of every
       * E8/E9 rel16 and every `6D 4A` word), so teleports and exits fire
       * only for an idle hero pressing UP. Idle's fire and direction tests
       * (CS:0x49CC-0x49EF) come before it. */
      if (this.stateIndex === S.IDLE && !input.fire && pickup && pickup.zoneScan) {
        const hit = pickup.zoneScan(this.x, this.y);
        if (hit) { this.zoneHit = hit; return; }
      }
      const climbCol = climbableHereCol(map, this.x, this.y);
      if (climbCol !== null) {
        this.x = ladderSnapX(this.x, climbCol);
        this.state = ST.CLIMB;
        this.stateIndex = S.CLIMB;
        this.phase = 0;
        this.ladderPingPong = false;
        this.dismountHold = 0;
        this.fromLadder = true;
        return;
      }
      /* not climbable: UP goes unconsumed, exactly as the original leaves
       * it — fall through to the normal ground continuation below. */
    }
    /* CS:0x5A64 (state 0) / CS:0x5CA8 (state 1) — the walk states' own fire
     * test comes AFTER the down (CS:0x598A/0x5BCB) and up (CS:0x5A05/0x5C42)
     * tests and BEFORE the wall probe and the step (CS:0x5A84/0x5CCB), so a
     * tick that crouches, descends, jumps or grabs a ladder never steps and
     * never fires. ⚠️ REORDERED: the port used to fire first and step
     * before the down/up tests — PJOYL1 cursor 151, a jump take-off, where
     * the original does not step (184 held) and the port stepped to 188. */
    if ((moving || this.stateIndex === S.WALK_L || this.stateIndex === S.WALK_R)
        && this._tryFire(this.facing > 0 ? 5 : 6, input, fire)) return;
    let stepDelta = 0;
    if (input.left  && this._walk(map, -1)) stepDelta = -WALK_STEP;
    if (input.right && this._walk(map, +1)) stepDelta = +WALK_STEP;

    if (moving) {
      this.stateIndex = this.facing < 0 ? S.WALK_L : S.WALK_R;
      /* CS:0x5ACC-0x5AD3 (state 0) / CS:0x5D17-0x5D1E (state 1), fresh
       * disassembly this session — a SECOND divergence surfaced as a side
       * effect of the ARRIVAL fix above, now closed. The "locked stopped
       * pose" release block below (CS:5B1E/5B26 left, 5B2B/5B33 right)
       * pins `phase` to a facing-specific sentinel OUTSIDE the 8-frame
       * cycle — 0x39=57 left, 0x2d=45 right — while leaving stateIndex at
       * WALK_L/WALK_R. On the very next pressed tick the handler steps
       * [0x17a] as usual, but THIS SAME clamp — tested against the phase
       * value from BEFORE this tick's own increment — finds it > 7 and
       * immediately UNDOES that step (`SUB`/`ADD` mirrors the `ADD`/`SUB`
       * it just did), pinning `CL:=7` in place BEFORE the SAME shared
       * `INC CL / AND CL,7` below runs on it — so the undo tick's own
       * phase lands on 0, not 7; the NEXT tick (phase 0, back in-cycle)
       * then steps normally. The mechanism above is from fresh
       * disassembly this session, not a live single-step; the observed
       * behaviour it explains — PJOYG1.DAT's own SECOND "right" press
       * (recorded tick 29, the first press after the tick-22 stop): heroX
       * held at 3448 for one more tick, stepping to 3452 only on tick 30 —
       * is a prior session's live DOSBox capture, now baked into
       * `tools/joyg1-live-capture.json`. This port previously stepped
       * immediately on the resume tick AND (invisibly to
       * `tools/replay-diff.mjs`, which tracks no phase field) landed on
       * the wrong post-undo phase, 6 instead of 0, in an earlier revision
       * of this very fix — caught only by the phase-aware regression
       * check below, not by any live or replayed hero-position match.
       *   Gated on `stepDelta !== 0`: a tick where `_walk` returns false
       * (wall-blocked) never reached the ADD/SUB in the original either
       * (CS:5A8C-0x5AA5 / 5CD6-5CF0 jump straight past it, see the wall-
       * probe header above), so there is nothing here to undo. */
      /* CS:5AAD/0x5ABA (state 0) and CS:0x5CF8/0x5D05 (state 1) both test
       * the footstep sound against CL exactly as the dispatcher handed it
       * to this handler — BEFORE the undo-clamp above and BEFORE this
       * tick's own `INC CL / AND CL,7` below, both of which mutate `phase`.
       * Captured here, before either runs. Getting this ordering backwards
       * (testing phase AFTER those, as an earlier revision of this port
       * did) is invisible on an ordinary ramping tick, where old and new
       * phase rarely straddle 2/6, but is wrong on principle — only a
       * direct assertion against this pre-clamp value can catch it. */
      const preClampPhase = this.phase;
      /* A wall-blocked tick (CS:0x5A92/0x5A9B/0x5AA5 `jmp 0x5e9b`) skips the
       * step, the footstep AND the `inc cl`: the phase holds. [PROVEN]
       * against PJOYG2 cursor 144 — the hero stops at x=160 with LEFT held
       * and DOS plays no 0x20e (whose ADL draws the port used to make). */
      if (stepDelta !== 0) {
        if (this.phase > 7) { this.x -= stepDelta; this.phase = 7; }
        /* CS:5AD8 `inc cl` / 5ADA `and cl,7` — an 8-frame cycle. */
        this.phase = (this.phase + 1) & (WALK_CYCLE - 1);
      }
      /* CS:5AAD and 5ABA both `mov ax,0x20e / call 0x22ca` — the footstep
       * sound, twice per cycle at opposite phases. */
      this.footstep = stepDelta !== 0 && WALK_FOOTSTEP_PHASES.includes(preClampPhase);
    } else {
      /* ⚠️ CORRECTED — an earlier revision of this port had EVERY release enter
       * state 26 (idle), rendering the single direction-neutral sprite 25
       * regardless of facing. Live DOSBox testing (both by the maintainer and
       * by re-reading CS:0x5af2-0x5b35 fresh) shows that is wrong: state 26 is
       * only reached when UP happens to be held at the exact instant the walk
       * key is released (CS:0x5af9/0x5afb left, CS:0x5b0f/0x5b11 right). In the
       * ordinary case — UP not held — the state NEVER changes: the hero stays
       * in WALK_L/WALK_R forever, and the phase locks to a fixed, facing-
       * specific sentinel (CS:0x5b1e/0x5b26 left -> cl=0x39=57; CS:0x5b08/0x5b2b
       * right -> cl=0x2d=45) that renders sprite 0+57=57 or 11+45=56 — a
       * "stopped, still facing that way" pose, not idle's back-view sprite 25.
       * Confirmed live: DS:0x377 never became 26 in either direction after a
       * plain key release, and DS:0x36b landed on exactly these two constants. */
      if (this.stateIndex === S.ARRIVAL) {
        /* CS:0x5DFE — state 4 (spawn / arrival) tests ONLY the two direction
         * bits; with neither held it falls through to `5E16 jmp 0x56CA`,
         * whose solid-ground arm is a bare `56D4 jmp 0x5e9b` — neither
         * [0x377] nor CL is written, so the arrival pose HOLDS at
         * anim_base(4)+0 = sprite 9 for as long as the player presses
         * nothing. The walk-release block below belongs to states 0/1
         * (CS:0x5AF2-0x5B35) and must not run here: without this guard the
         * first UP press at a spawn or teleport arrival set stateIndex =
         * S.IDLE and flipped the hero to the back view, which state 4 —
         * having no UP test at all — never does. */
      } else if (input.up) {
        /* CS:5AF9/5AFB (left) or CS:5B0F/5B11 (right) — the ONLY way a release
         * reaches true idle. State 26's own handler (CS:49CA `sub cl,cl`) zeros
         * the phase again on its very next tick, converging on sprite 25. */
        this.phase = this.facing < 0 ? 0xff : 0x01;
        this.stateIndex = S.IDLE;
      } else if (this.stateIndex === S.IDLE) {
        /* Already idling (reached via the branch above on a prior tick, or via
         * a fall/climb-bottom landing) and UP is no longer held: state 26's own
         * body still runs every tick and keeps zeroing cl. */
        this.phase = 0;
      } else if (this.phase !== 0) {
        /* CS:5B1E/5B26 (left) or 5B2B/5B33 (right): UP not held, and this is
         * the tick the walk key was just released — lock the facing-specific
         * stopped pose. stateIndex is deliberately left at WALK_L/WALK_R. */
        this.phase = this.facing < 0 ? 0x39 : 0x2d;
      }
      /* else: phase is already the locked sentinel (or already 0 at true rest)
       * — CS:5B23/5B30 do nothing at all on this path, so neither field is
       * touched again until the player moves or presses UP. */
    }

    /* The walk states tested ground at entry, above; the others still do it
     * here, as before. */
    if (!walkAtEntry && !solidThreeBelow(map, this.x, this.y)) this._enterFall();
  }

  _jump(map, input, fire) {
    const i = this.jumpCursor >> 1;          // cursor is a byte offset
    if (i >= JUMP_DELTAS.length) { this._enterFall(); return; }
    const d = JUMP_DELTAS[i];
    /* ⚠️ REORDERED — CS:0x4E94-0x4EB9 (state 8) / CS:0x508C-0x50B5 (state 9):
     * the wall-probe/X-step runs against the PRE-delta Y, before the delta
     * table is even reached at CS:0x4F6F/0x516E. An earlier revision of this
     * port applied the Y delta first, so the wall probe could test the wrong
     * row near a 16px boundary (up to 12px off during a double jump).
     * The rise is COMMITTED: handlers 8/9 test input bits 0x01/0x02/0x80 only,
     * never 0x04/0x08, so direction cannot be steered while rising. Horizontal
     * motion is a hard-coded +/-4 gated on `cmp byte [0x358],4; jl`. */
    if (this.jumpCursor >= 4) this._walk(map, this.facing);

    /* CS:0x4EBE-0x4F49 (state 8) / CS:0x50BD-0x5148 (state 9) — grab a
     * ladder OUT OF MID-AIR. Reported live: pressing UP while airborne and
     * positioned over a ladder grabs it immediately, at whatever height the
     * hero happens to be — this port had no such check at all, so a jump
     * arc carried straight over a ladder into FALL/GROUND instead.
     *
     * Tested every tick with NO cursor gate whatsoever — unlike the X-step's
     * `cursor >= 4` and the early-land check's `cursor >= 0x16` just below,
     * this fires from the very first wind-up tick. Only `jumpTakeoffX`
     * (above) suppresses it on the ticks right after take-off. UP tests only
     * the current row; DOWN also accepts the row below (asymmetric, matching
     * the ascend/descend entries documented elsewhere in this file) — see
     * `climbableAtAlignedCol`/`climbableAtAlignedColOrBelow`'s own note for
     * why neither reuses `climbableHereCol`'s straddle split.
     *
     * The snap is NOT a full tile-row snap: `AND [0x17c],0xFFF8` (all four
     * sites agree — CS:0x4EDD/0x4F26/0x50DC/0x5125), a fine 8 px snap that
     * keeps the hero at very nearly the height it was grabbed at, unlike a
     * ground-based mount's 16 px row snap. Getting this wrong to 0xfff0
     * would be invisible to a casual read since both round DOWN.
     *
     * The original lands UP in state 14 (ascend) and DOWN in state 13
     * (descend); this port already collapses both into `S.CLIMB` (see
     * `UNMODELLED_PHASE_STATES` in states.js), so both land in the same
     * place here too — a pre-existing, disclosed simplification, not
     * reinvented for this fix. */
    if (this.x !== this.jumpTakeoffX && (this.x & 0x1f) === 0) {
      if (input.up && climbableAtAlignedCol(map, this.x, this.y)) {
        this.x &= 0xffe0;
        this.y &= 0xfff8;
        this.ladderFacing = 0;
        this.state = ST.CLIMB;
        this.stateIndex = S.CLIMB;
        this.phase = 2;
        this.ladderPingPong = false;
        this.dismountHold = 0;
        this.fromLadder = true;
        return;
      }
      if (input.down && climbableAtAlignedColOrBelow(map, this.x, this.y)) {
        this.x &= 0xffe0;
        this.y &= 0xfff8;
        this.ladderFacing = 0;
        this.state = ST.CLIMB;
        this.stateIndex = S.CLIMB_DOWN;
        this.phase = 2;
        this.ladderPingPong = false;
        this.dismountHold = 0;
        this.fromLadder = false;
        return;
      }
    }

    /* CS:0x4F49-0x4F6C (state 8) / CS:0x5148-0x516B (state 9) — an
     * EARLY-LANDING check this port lacked entirely. Once the cursor reaches
     * JUMP_ARC_EARLY_LAND_CURSOR, every tick first probes solidThreeBelow at
     * the CURRENT position (after this tick's own horizontal step, but
     * BEFORE this tick's arc delta is even read) via CS:0x4e2d — byte-
     * identical in shape to solidThreeBelow's own straddle test, and to the
     * probe FALL uses for landing. On a hit the arc delta is never applied:
     * the hero lands exactly where it stands, Y snapped to the tile row
     * (`AND [0x17c],0xFFF0`), transitioning straight into a landed state
     * (16/17 in the original, `anim_base` 29/31 — the same base as JUMP_R/
     * JUMP_L — with phase 0). This port has no separate landing pose (see
     * FALL's own landing a few lines below, which makes the same
     * simplification), so it goes straight to GROUND/IDLE rather than
     * inventing a timed pose it can't verify.
     *
     * Without this, a jump whose feet come within 3 rows of solid ground
     * mid-arc sails over it instead of landing — this is the reported "jump
     * onto the platform to the left, the hero clips past it" bug. It also
     * covers jumping off a ladder mid-climb at an arbitrary, non-tile-
     * aligned Y: the raw arc used to run to its scripted end (or into FALL)
     * regardless of what was underfoot; now it catches the first solid
     * ground it reaches, same as the original. */
    if (this.jumpCursor >= JUMP_ARC_EARLY_LAND_CURSOR
        && solidThreeBelow(map, this.x, this.y)) {
      /* CS:0x5157: `mov [0x377],0x10 / and [0x17c],0xfff0 / xor cl,cl /
       * mov [0x357],0` — the landing POSE (see `_land`), not idle. */
      this.y &= 0xfff0;
      this.fallV = 0;
      this.airSteps = 0;
      this._enterLand(this.facing > 0, false, this.facing > 0 ? [0x5168] : [0x4f69]);
      this.renderPhase = 0;
      return;
    }

    this.y -= d;
    if (this.doubleJump) this.y -= d;        // applied twice when [0x174] != 0

    /* CS:0x4E4E — a shared "is the hero now standing inside solid ground"
     * ejection check, called from BOTH state 8 (CS:0x4F89) and state 9
     * (CS:0x5188) unconditionally every tick after the Y delta is applied. It
     * is NOT gated on the sign of the delta: it is a penetration check, not a
     * rise/fall look-ahead, so it fires just as readily on the arc's downward
     * half — this is what stops the hero's head clipping through a low
     * platform on the way up. `solidHere` is already byte-identical to this
     * routine's own straddle-tested cell read. On a hit: floor to the tile row
     * and then push ONE FULL ROW further down (CS:0x4F8F-0x4F96 / 0x5190-
     * 0x5195 — `and 0xfff0` alone would move the hero UP into the ceiling
     * tile), force a fall, and — matching the original's own `jmp 0x5e9b` —
     * return before the cursor advances or the fire-guard runs this tick.
     * Zeroing fallDamage here (not just fallV/airSteps) matters: CS:0x4FB3/
     * 0x51AA do it too, and `_enterFall()` deliberately does not (it also
     * serves the unrelated ledge-walk-off entry), so this is inlined rather
     * than routed through it. */
    if (solidHere(map, this.x, this.y)) {
      this.y = (this.y & 0xfff0) + 0x10;
      this.state = ST.FALL;
      this.stateIndex = this.facing < 0 ? S.FALL_L : S.FALL_R;
      this.fallV = 0;
      this.airSteps = 0;
      this.fallDamage = 0;
      this.phase = 0;
      return;
    }
    /* A SECOND landing test, after the arc delta and the ceiling test, into
     * the same landing pose. ⚠️ Its threshold is NOT symmetric: state 9
     * (right) tests >= 0x16 (CS:0x51B5), state 8 (left) tests >= 0x12
     * (CS:0x4FB6) — the same 0x12 both firing jumps use (CS:0x52C1 /
     * 0x53DE). The pre-arc test above is 0x16 in all four. [PROVEN] live:
     * PJOYL1 cursor 518, a left jump landing two arc steps before a right
     * one would. */
    const postArcLand = this.facing < 0 ? 0x12 : JUMP_ARC_EARLY_LAND_CURSOR;
    if (this.jumpCursor >= postArcLand
        && solidThreeBelow(map, this.x, this.y)) {
      this.y &= 0xfff0;
      this.fallV = 0;
      this.airSteps = 0;
      this._enterLand(this.facing > 0, false, this.facing > 0 ? [0x5168] : [0x4f69]);
      this.renderPhase = 0;
      return;
    }
    this.stateIndex = this.facing < 0 ? S.JUMP_L : S.JUMP_R;
    /* The handler's phase chain runs on the cursor as it stands BEFORE this
     * frame's advance — so read it first, then step. */
    this.phase = jumpPhase(this.stateIndex, this.phase, this.jumpCursor);
    /* ⚠️ THE GUARDS READ THE PRE-ADVANCE CURSOR. CS:0x51C4 and CS:0x51DA both
     * compare [0x358] before the entry's own `add byte [0x358],0x2` at
     * CS:0x51ED, so they see the value this tick's arc used — not the next
     * tick's. Passing the advanced value shifts both windows by one step. */
    const cursorBefore = this.jumpCursor;
    this.jumpCursor += JUMP_ARC_STEP;
    /* CS:0x4FCC (state 8) / CS:0x51CB (state 9) sit after the arc code, with
     * the LOWER guard (cursor >= 4) before the allocator and the UPPER one
     * (cursor < 0x2c) after it — see the note in fire-states.js, because the
     * split is observable through the latch. */
    if (this._tryFire(this.facing < 0 ? 21 : 20, input, fire,
                      { arcCursor: cursorBefore })) return;
    if (this.jumpCursor >= JUMP_ARC_END) this._enterFall();
  }

  /**
   * CS:0x48B0, called by every fall step BEFORE it adds the velocity:
   *     48B0  ax = [0x1b2] >> 2 ; add [0x176],ax    ; damage grows with speed
   *     48BB  cmp byte [0x36d],0 / jnz ret           ; gravity every OTHER tick
   *     48C2  inc [0x1b2] ; clamp at 10
   * DS:0x36D is zeroed with DS:0x36C at level entry (CS:0x8CAC-0x8CB2) and
   * both flip at the top of every tick (CS:0x0172/0x0176), so it is 0
   * exactly when `tock` (DS:0x36C) is 0. [PROVEN] live: PJOYG3 falls
   * 80->85->90 from spawn, not 80->85->91. */
  _gravity(tock) {
    this.fallDamage = (this.fallDamage || 0) + (this.fallV >> 2);
    if (tock === 0) {
      this.fallV += GRAVITY_STEP;
      if (this.fallV > FALL_VMAX) this.fallV = FALL_VMAX;
    }
  }

  /**
   * CS:0x4C28 (state 11) / CS:0x4D2A (state 12): landing enters the landing
   * pose, state 17 (left) / 16 (right), with [0x357] := 0 and CL := 0. The
   * fall-damage accumulator DS:0x176 is NOT cleared — the pose drains it.
   */
  _enterLand(right, fromLadderFall = false, sites = [0x4c4e]) {
    /* CS:0x4C54 plays 0x318, and EVERY landing calls it: the falls (state 11
     * CS:0x4C4E; state 12 / fall-fire right CS:0x4D2A calls it TWICE, at
     * 0x4D36 and 0x4D53; the ladder fall CS:0x4CC5), the jumps (CS:0x4F69,
     * 0x5168) and the firing jumps (CS:0x5274, 0x5391). */
    this.landSfx += sites.length;
    this.landSites.push(...sites);
    this.state = ST.LAND;
    this.stateIndex = right ? S.LAND_R : S.LAND_L;
    this.facing = right ? +1 : -1;
    /* State 10's landing (CS:0x4C9B-0x4CC8) clears neither DS:0x357 nor CL,
     * so it inherits the hold flag an earlier landing left (usually 1) and
     * skips the hold tick. [PROVEN] against PJOYL3 975/976. */
    if (fromLadderFall) return;
    landFlag357 = 0;                        // DS:0x357
    this.phase = 0;
  }

  /**
   * CS:0x5042 (state 16) / CS:0x5020 (state 17) — the whole handler:
   *     cmp [0x357],0 / jnz ; inc [0x357] ; done          ; hold one tick
   *     sub [0x176],4 / js -> cl:=2, state:=1 (16) / 0 (17) ; else done
   * No input is read, so a hard landing costs 1 + (damage/4 + 1) ticks.
   * [PROVEN] live: PJOYG3 lands at cursor 4 in state 16, holds through 5,
   * and is walking (state 1) at 6.
   */
  _land() {
    if (!landFlag357) { landFlag357 = 1; return; }
    this.fallDamage = (this.fallDamage || 0) - 4;
    if (this.fallDamage >= 0) return;
    const right = this.stateIndex === S.LAND_R;
    this.state = ST.GROUND;
    this.stateIndex = right ? S.WALK_R : S.WALK_L;
    this.phase = 2;
  }

  /**
   * CS:0x48D4 — air steering, shared by the plain falls (CS:0x4BE3 /
   * 0x4CE5) and the fall-fire pair (CS:0x4DEE). LEFT and RIGHT are tested
   * independently (not else-if), each against the DS:0x345 budget of 3:
   *     LEFT:  [0x377]:=0x0B ; if x&0x1f == 0, blocked by a solid cell at
   *            SI-1, SI+0x7F, SI+0xFF — and SI+0x17F too when y&0xF != 0 ;
   *            else x -= 4, [0x345]++
   *     RIGHT: [0x377]:=0x0C ; if x&0x1c is 0x1c or < 8, blocked by SI+1,
   *            SI+0x81, SI+0x101 — and SI+0x181 when y&0xF != 0 ; else
   *            x += 4, [0x345]++
   * ⚠️ The fourth (feet) row is what the walk probe lacks, and a falling
   * hero's Y is almost never tile-aligned. [PROVEN] live: PJOYL1 cursor 440,
   * RIGHT held on the landing tick — the feet row is the floor, so the
   * original does not steer (x stays 420); the port used to reach 424. A
   * blocked press still sets the fall state's facing and costs no budget.
   * @returns {boolean} whether a direction was pressed with budget left
   *          (i.e. [0x377] was written).
   */
  _airSteer(map, input) {
    let wrote = false;
    const solid = (o) => cellAt(map, mapCursor(this.x, this.y) + o) === CELL_SOLID;
    const unaligned = (this.y & 0xf) !== 0;
    if (input.left && this.airSteps < AIR_STEPS_MAX) {
      this.stateIndex = S.FALL_L; this.facing = -1; wrote = true;
      const blocked = (this.x & 0x1f) === 0
        && (solid(-1) || solid(0x7f) || solid(0xff) || (unaligned && solid(0x17f)));
      if (!blocked) { this.x -= WALK_STEP; this.airSteps++; }
    }
    if (input.right && this.airSteps < AIR_STEPS_MAX) {
      this.stateIndex = S.FALL_R; this.facing = +1; wrote = true;
      const sub = this.x & 0x1c;
      const blocked = (sub === 0x1c || sub < 8)
        && (solid(1) || solid(0x81) || solid(0x101) || (unaligned && solid(0x181)));
      if (!blocked) { this.x += WALK_STEP; this.airSteps++; }
    }
    return wrote;
  }

  _fall(map, input, fire, health = null, tock = 1) {
    /* CS:0x4DD5 (state 11) / CS:0x4D6B (state 12) — the fall step moves Y
     * FIRST: dY = 4 + fallV (gravity already applied), THEN air-steering may
     * move X (CS:0x48D4, budget of 3 steps of 4 px), and ONLY THEN is
     * landing tested — at the resulting, steered position — via the SAME
     * `solidThreeBelow` 3-rows-below probe the ground state uses. Landing
     * SNAPS Y to the tile row (`AND [0x17c],0xFFF0`, CS:0x4C34 / 0x4D39) —
     * the very row the test itself just used.
     *
     * ⚠️ An earlier version of this port checked landing ONE PIXEL AHEAD via
     * a per-pixel scan and left Y unsnapped on touchdown — not how the
     * original works (it moves Y in one lump sum, exactly like the fire-fall
     * overlay a few lines below already does). Whenever the settled Y landed
     * on a non-multiple-of-16 row, the very next tick's identical
     * `solidThreeBelow` test — now run from ST.GROUND on the unsnapped Y —
     * read a DIFFERENT map row than the one that had just reported solid
     * ground underfoot, so the hero immediately re-entered FALL, dropped a
     * pixel, and landed again: the reported idle/fall flicker. Snapping Y on
     * landing, as CS:0x4C34/0x4D39 do, makes the landing check and every
     * later ground check agree by construction. */
    this.y += FALL_BASE;                     // CS:0x4CCC `add [0x17c],4`
    this._gravity(this.tock36d);             // CS:0x4CD1 `call 0x48b0`
    this.y += this.fallV;                    // CS:0x4CD7
    this.fallDamage = (this.fallDamage || 0) + 1;      // DS:0x176
    this._airSteer(map, input);                        // CS:0x4CE5 `call 0x48d4`
    /* State 10 (CS:0x4C5D, off a ladder's foot) runs the same physics but
     * keeps its own index and phase (no `xor cl,cl`), has no fire test, and
     * lands by the ladder facing DS:0x378 (CS:0x4C9B-0x4CA7: >= 0 -> 0x10,
     * negative -> 0x11). [PROVEN] against PJOYL3 972-976. */
    const ladderFall = this.stateIndex === S.FALL_LADDER;
    if (!ladderFall) {
      this.stateIndex = this.facing < 0 ? S.FALL_L : S.FALL_R;
      this.phase = 0;
    }
    if (solidThreeBelow(map, this.x, this.y)) {   // CS:0x4BEB / 0x4CED
      this.y &= 0xfff0;                            // CS:0x4C34 / 0x4D39
      this.fallV = 0;
      this.airSteps = 0;
      /* CS:0x4C39-0x4C4A / 0x4CB0-0x4CC1 — fallDamageFor, above. */
      if (health) {
        const dmg = fallDamageFor(this.fallDamage);
        if (dmg > 0 && !health.invulnerable) health.hurt(dmg);
      }
      /* ⚠️ CORRECTED AGAIN: an earlier revision of this comment called the
       * 16/17 landing pose "unverified speculation" and went straight to
       * idle. It is real: CS:0x4C28 / 0x4D2A write [0x377] := 0x11 / 0x10
       * and the state dispatcher runs CS:0x5020 / 0x5042 on later ticks,
       * which hold one tick and then drain DS:0x176 by 4 per tick before
       * handing back to walk (see `_land`). Live-confirmed by PJOYG3. */
      const right = ladderFall ? this.ladderFacing >= 0 : this.stateIndex === S.FALL_R;
      this._enterLand(right, ladderFall, ladderFall ? [0x4cc5] : right ? LAND_FALL_RIGHT : LAND_FALL_LEFT);
      return;
    }
    if (ladderFall) return;                        // CS:0x4C8E / 0x4C98: no fire test
    /* CS:0x4D06 (state 12) / CS:0x4C04 (state 11) — the fire test sits AFTER
     * the fall physics and the landing check, so a tick that lands never
     * fires. Read straight off state 12: the `add [0x17c],4`, the gravity
     * call and `inc [0x176]` all precede it. */
    this._tryFire(this.facing < 0 ? 23 : 22, input, fire);
  }

  /**
   * @param {number} tock  DS:0x36c — see `tick`'s own doc. The whole handler
   *        is gated on it, exactly as the original's own first instruction is.
   */
  _climb(map, input, fire, tock) {
    /* CS:0x54b9 / CS:0x5707 — the ENTIRE climb handler, dismount and
     * fire-on-ladder included, runs only every other tick; the closed tick
     * doesn't even read input. Everything below this line is the "open"
     * half. */
    if (tock === 0) return;

    /* Jump OFF the ladder — CS:0x550c/0x557c (state 13, descending) and
     * CS:0x575e/0x57d6 (state 14, ascending): UP + a direction is the SAME
     * jump-off regardless of which climb state you're in, and it seeds the
     * same "left a ladder" phase the ground-state jump entry already uses. */
    if (input.up && (input.left || input.right)) {
      const dir = input.right ? +1 : -1;
      this.facing = dir;
      this.state = ST.JUMP;
      this.jumpCursor = 0;
      this.stateIndex = dir > 0 ? S.JUMP_R : S.JUMP_L;
      this.phase = LADDER_JUMP_PHASE[this.stateIndex];
      this.fromLadder = false;
      this.jumpTakeoffX = this.x;   // CS:0x590F/0x5924 — see jumpTakeoffX's own note
      return;
    }

    /* Dismount SIDEWAYS onto solid ground — CS:0x5761-0x57b7 / 0x57cf-0x5826
     * (state 14) and CS:0x54ef-0x555d / 0x5560-0x55cc (state 13), identical
     * shape on both: DOWN + a direction, held for THREE gated ticks (the
     * counter is DS:0x353 for right, DS:0x348 for left — one shared counter
     * here, so switching dismount direction mid-hold doesn't restart it the
     * way two separate counters would; a narrow, disclosed simplification),
     * gated on the SAME three-cell wall probe the walk handlers use plus a
     * secondary alignment guard. This is the ONLY way the original gets off
     * a ladder onto a platform short of jumping — there is no auto-land at
     * the top, which is the bug this was all chasing: the port used to
     * invent a landing (or a fall) the original doesn't have. */
    if (input.down && (input.left || input.right)) {
      const dir = input.right ? +1 : -1;
      this.dismountHold = (this.dismountHold || 0) + 1;
      if (this.dismountHold >= DISMOUNT_HOLD_TICKS
          && !wallBlocks(map, this.x, this.y, dir)
          && !dismountBlocked(map, this.x, this.y, dir)) {
        this.x += dir * 8;
        this.y -= 4;
        this.facing = dir;
        this.state = ST.GROUND;
        this.stateIndex = dir > 0 ? S.WALK_R : S.WALK_L;
        this.phase = 6;
        this.dismountHold = 0;
        this.fromLadder = false;
        return;
      }
      return;   // still holding (or blocked): no movement either way this tick
    }
    this.dismountHold = 0;

    /* DS:0x378 — the ladder facing, and it is set by THIS handler, one branch
     * above the entry it gates:
     *     54EF  test byte [0x382],0x8   (RIGHT)
     *     54F6  test byte [0x382],0x80  (FIRE)  -> 54FD mov byte [0x378],1
     *     5560  test byte [0x382],0x4   (LEFT)
     *     5567  test byte [0x382],0x80  (FIRE)  -> 556E mov byte [0x378],0xff
     * and the entry then reads it: CS:0x55D6 `cmp byte [0x378],0 / jz` skips
     * when zero, `js` takes the LEFT variant when negative. So the ladder pair
     * needs a DIRECTION as well as the fire bit — pressing fire alone on a
     * ladder does nothing, which is why passing a hard-coded 0 here would make
     * states 24/25 look ported while being unreachable. */
    /* The facing PERSISTS: with FIRE alone neither direction branch runs and
     * CS:0x55CF reaches the entry with the DS:0x378 an earlier tick left, so
     * holding FIRE keeps re-firing once a direction has been given (only the
     * mount, CS:0x59B5, clears it). [PROVEN] against PJOYL3 861/862: FIRE
     * held with no direction re-enters state 25; the port used to demand a
     * direction on every shot. */
    if (input.fire && (input.left || input.right)) this.ladderFacing = input.right ? 1 : -1;
    if (input.fire && this.ladderFacing !== 0) {
      const id = this.ladderFacing > 0 ? 24 : 25;
      /* CS:0x55E7 — the entry saves Y and the phase, and nudges Y up 4 when
       * that phase is EVEN (CS:0x55F1 `test cl,1 / jnz`). */
      const before = this.phase;
      if (this._tryFire(id, input, fire, { ladderFacing: this.ladderFacing })) {
        this.savedLadderY = this.y;
        this.savedLadderPhase = before;
        if ((before & 1) === 0) this.y -= 4;
        return;
      }
    }

    /* States 14 (ascending, CS:0x5707) and 13 (descending, CS:0x54B9) are
     * separate. Each MOVES only on an input byte of exactly its own
     * direction (CS:0x571F `cmp [0x382],1` / CS:0x54CD `cmp [0x382],2`),
     * or when the phase is out of range (`cmp cl,0x14`, the descend-mount's
     * cl=0x1A). Otherwise, after the direction/fire branches above, its final
     * fallback (CS:0x5885 / 0x562B) hands off to the OTHER state when the
     * other direction's bit is held — flipping the ping-pong flag DS:0x347,
     * with no step that tick. [PROVEN] against PJOYL3 852-875: DOWN on a
     * ladder in state 14 costs a tick in state 13 before the hero moves.
     * An earlier revision collapsed both into state 14 and stepped at once. */
    const desc = this.stateIndex === S.CLIMB_DOWN;
    const exactly = (k) => ['up', 'down', 'left', 'right', 'fire']
      .every((n) => !!input[n] === (n === k));
    const forced = !!this.climbForce;
    this.climbForce = false;
    if (!forced && !(desc ? exactly('down') : exactly('up'))) {
      if (desc ? input.up : input.down) {
        this.ladderPingPong = !this.ladderPingPong;          // `not byte [0x347]`
        this.stateIndex = desc ? S.CLIMB : S.CLIMB_DOWN;      // 0xE / 0xD
      }
      return;
    }
    if (forced) this.phase = 0;                               // `xor cl,cl`

    /* CS:0x564B-0x5699 (state 13) / CS:0x58A5-0x58E5 (state 14), identical
     * shape: the phase and the ping-pong flag DS:0x347 advance BEFORE the
     * step, with the step sound CS:0x5931 at each turn:
     *     flag clear: inc cl; cl > 3 -> sound, flag on, dec cl, then fall in:
     *     568A: dec cl; zero -> sound, inc cl, flag off, back to the top
     * which cycles 2,3,2*,1,2*,3,2*,... — a sound every SECOND step. [PROVEN]
     * against PJOYL3 899/900 (the sound's ADL draws) and 930 (the ladder-fire
     * entry's even-phase nudge). An earlier revision ran 1,2,3*,2,1,0*, a
     * sound every third step. */
    const phaseBefore = this.phase;                           // DS:0x344 (CS:0x571B)
    for (;;) {
      if (!this.ladderPingPong) {
        this.phase++;
        if (this.phase <= LADDER_PHASE_MAX) break;
        this.climbStep = true; this.ladderPingPong = true; this.phase--;
      }
      this.phase--;
      if (this.phase !== 0) break;
      this.climbStep = true; this.phase++; this.ladderPingPong = !this.ladderPingPong;
    }

    if (!desc) {
      /* CS:0x58c3 `sub word [0x17c],0x6` — see CLIMB_STEP's own note: this
       * used to be 4 px, taken from the wrong (ladder-FIRE) sites. */
      const newY = this.y - CLIMB_STEP;
      if (ladderAbove(map, this.x, newY)) {
        this.y = newY;
      } else {
        /* CS:0x58e7-0x58fa — when neither row around the new spot is still
         * a ladder, the original REVERTS the Y step and the PHASE (`mov cl,
         * [0x344]`, cached before this tick ran) and stays in climb, frozen.
         * The flag flip and the sound above are NOT undone. There is no
         * auto-exit at the top of a ladder; dismount or jump-off is how you
         * leave it. */
        this.phase = phaseBefore;
        return;
      }
    } else {
      /* CS:0x5663 `add word [0x17c],0x6` — descending. */
      const newY = this.y + CLIMB_STEP;
      if (solidThreeBelow(map, this.x, newY)) {
        /* CS:0x566b/0x5670 — land at the bottom, into idle. */
        this.y = newY & 0xfff0;
        this.state = ST.GROUND;
        this.stateIndex = S.IDLE;
        this.phase = 0;
        return;
      }
      this.y = newY;                              // the step stands either way
      if (!ladderBelow(map, this.x, newY)) {
        /* CS:0x56AF — the ladder ends with nothing solid below either: fall
         * off the bottom, into state 10 (not 11/12), phase cleared. */
        this._enterFall();
        this.stateIndex = S.FALL_LADDER;
        return;
      }
    }
  }

  /**
   * States 18/19 — CS:0x4AE0 / CS:0x4B55. See the module-level comment above
   * `S.CROUCH_R` for the full disassembly and which pieces are cut.
   * @param {{down,left,right,fire}} input
   * @param {?{objects:Array, cats:Array, inventory:Array}} pickup
   */
  /** CS:0x6069-0x612C, the key scan: [0x354] := 1 ; the first key in the
   *  hot-point box is taken with FIRE (CS:0x60FB [0x341] := 1, the slot
   *  write, the object message) or put back without it (CS:0x60EB
   *  [0x354] := 0, so the next tick scans again); a weapon in the box aborts
   *  the scan; no key at all sets [0x355] (CS:0x60B4). */
  _keyScan(input, pickup) {
    this.scanned = 1;                                       // CS:0x6069
    if (!pickup) return;
    const { key, abort } = crouchScan(pickup.objects, pickup.cats, this);
    if (abort) return;                                      // CS:0x60C9
    if (!key) { this.noKey = 1; return; }                   // CS:0x60B4
    if (!input.fire) { this.scanned = 0; return; }          // CS:0x60EB, put back
    this.fireLatch = 1;                                     // CS:0x60FB
    key.dead = true;                                        // CS:0x60D8 `[si+4] = 0xffff`
    key.flag6 = 0;                                          // CS:0x60DD `[si+6] = 0`
    const slot = collectKey(pickup.inventory, key.type,    // CS:0x6100, the shown slot
                            pickup.panel ? pickup.panel.selector : 0);
    this.keyCollected = { type: key.type, slot };          // CS:0x6128 -> 0x4609, the name
  }

  /** CS:0x6134-0x619D, the FIRE tap: [0x355] := 0, and on a fresh press
   *  (the [0x341] latch clear) `0x2831`, [0x367] := ([0x366] + 1) & 3,
   *  [0x341] := 1, [0x354] := 1 and the new slot's item named (CS:0x6192,
   *  skipped for an empty slot). A held press releases the latch only once
   *  FIRE is let go (CS:0x614D). [PROVEN] live: PJOYL1 801-811 (DS:0x341/
   *  0x354/0x366 peeked, tools/attract-capture/joyl1.inventory.peek.json). */
  _inventoryTap(input, pickup) {
    this.noKey = 0;                                         // CS:0x6134
    if (this.fireLatch) {                                   // CS:0x613C
      if (!input.fire) this.fireLatch = 0;                  // CS:0x614D
      return;
    }
    if (!input.fire) return;                                // CS:0x6155
    this.inventoryCycled = true;                            // CS:0x6160 0x2831
    const panel = pickup && pickup.panel;
    if (panel) panel.pending = (panel.selector + 1) & 3;    // CS:0x616A-0x6171
    this.fireLatch = 1;                                     // CS:0x6174
    this.scanned = 1;                                       // CS:0x6179
  }

  /** CS:0x61A1, the drop, from CS:0x4B31 (DOWN held, "no key here", no
   *  FIRE) and CS:0x4AE7 (DOWN released). The caller's gate reads the SHOWN
   *  slot [0x366]; the drop itself takes the PENDING slot [0x367]'s item,
   *  empties that slot (CS:0x61C6) and hands `item + 0xB` to the popup
   *  (CS:0xBF5F) at the hero + (8, 0x20). The two only differ between a FIRE
   *  tap and the panel's copy (CS:0x1F5A); an empty pending slot would then
   *  still drop, as id 0xA (0xFFFF + 0xB passes the CS:0x61B7 sign test). */
  _drop(pickup) {
    const panel = pickup && pickup.panel;
    if (!panel) return;
    const inv = pickup.inventory;
    if (inv[panel.selector] & 0x8000) return;               // CS:0x4AF7/0x4B41 `js`
    const id = (inv[panel.pending] + 0xb) & 0xffff;         // CS:0x61B2-0x61B4
    if (id & 0x8000) return;                                // CS:0x61B7 `js`
    inv[panel.pending] = INVENTORY_EMPTY;                   // CS:0x61C6
    this.dropped = { id, x: this.x + 8, y: this.y + 0x20 };  // CS:0x61B9-0x61C3
  }

  _crouch(input, pickup) {
    if (input.down) {
      /* CS:0x4B11/0x4B86 `mov cl,1` — the animation phase is PINNED while
       * actively crouching; there is no cycle to advance. */
      this.phase = CROUCH_EXIT_PHASE_START;
      /* CS:0x4B13-0x4B1A -> CS:0x6069. Gated on FIRE only at the point of
       * collection (CS:0x60E4), exactly like the scan itself — not before,
       * so crouching over a key with fire released still finds it (and
       * silently leaves it) every tick, matching CS:0x60EB's "put it back". */
      if (!this.scanned) {                                  // CS:0x4B13 -> 0x6069
        this._keyScan(input, pickup);
      } else if (!this.noKey) {                             // CS:0x4B1D -> 0x6134
        this._inventoryTap(input, pickup);
      } else if (input.fire) {                              // CS:0x4B27 -> 0x612F
        this.fireLatch = 1;                                 //   then falls into 0x6134
        this._inventoryTap(input, pickup);
      } else {
        /* CS:0x4B31: no key here and no FIRE. Then CS:0x4B48 re-tests
         * [0x354], which is set on this path, so nothing more happens. */
        this._drop(pickup);
      }
      this.stateIndex = this.facing < 0 ? S.CROUCH_L : S.CROUCH_R;
      return;
    }
    /* CS:0x4B00/0x4B02 (right) and CS:0x4B75/0x4B77 (left) — DOWN released:
     * count the phase DOWN from wherever it stood (CROUCH_EXIT_PHASE_START
     * on any tick that was still actively crouching) and only stand up once
     * it goes negative — a 2-tick delay before the transition, not instant.
     * Both release ticks first run the drop (CS:0x4AE7 -> 0x61A1). */
    this._drop(pickup);
    this.phase -= 1;
    if (this.phase < 0) {
      this.state = ST.GROUND;                                  // CS:0x4B07/0x4B7C
      this.stateIndex = this.facing < 0 ? S.WALK_L : S.WALK_R;  // `[0x377] = 0/1`
      this.phase = 2;                                           // `mov cl,2`
      return;
    }
    this.stateIndex = this.facing < 0 ? S.CROUCH_L : S.CROUCH_R;
  }
}

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
 */

import { CELL_SOLID, CELL_CLIMBABLE, MAP_COLS } from '../formats/map.js';
import { WALK_CYCLE, WALK_FOOTSTEP_PHASES, jumpPhase,
         LADDER_JUMP_PHASE } from './states.js';
import { FIRE_STATES, ENTRY, fireTick, fireAnimOffset, fireGuardBefore,
         fireGuardAfter, JUMP_ARC_STEP, JUMP_ARC_END,
         JUMP_ARC_EXIT } from './fire-states.js';

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
export const CLIMB_UP_STEP   = 4;  // see _climb — branch not isolated
export const CLIMB_DOWN_STEP = 6;  // CS:0x5663 `add word [0x17c],0x6` [PROVEN]

export const ST = { GROUND: 'ground', JUMP: 'jump', FALL: 'fall', CLIMB: 'climb' };

/* Original state indices this port emits. See states.js for the proofs. */
export const S = {
  WALK_L: 0, WALK_R: 1,
  JUMP_L: 8, JUMP_R: 9,
  FALL_L: 11, FALL_R: 12,
  CLIMB: 14,
  ARRIVAL: 4,   // CS:0x1022 — one of state 4's three named entrants
  IDLE: 26,
};

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
function climbableHere(map, x, y) {
  const si = mapCursor(x, y);
  const col = (x & 0x1f) >= 0x10 ? 1 : 0;
  return cellAt(map, si + col) === CELL_CLIMBABLE
      || cellAt(map, si + MAP_COLS + col) === CELL_CLIMBABLE;
}

/* CS:0x598a-0x59e5 (walk-left) / CS:0x5bd2-0x5c02 (walk-right) — the
 * DOWN-onto-ladder entry test, three rows (48 px, the hero's own height)
 * below the current position. Unlike the test above, this one has an
 * overlapping straddle window rather than a hard split: sub-position
 * 0x0c..0x14 tries BOTH columns before giving up. (The original also gates
 * this behind a `call 0x5b38 / jc` that falls to crouch instead when it
 * fails — not modelled here; a port press that would have crouched may
 * descend a ladder instead in that narrow edge case.) */
function climbableThreeBelow(map, x, y) {
  const si = mapCursor(x, y) + 3 * MAP_COLS;
  const sub = x & 0x1f;
  if (sub <= 0x14 && cellAt(map, si) === CELL_CLIMBABLE) return true;
  if (sub >= 0x0c && cellAt(map, si + 1) === CELL_CLIMBABLE) return true;
  return false;
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

    /* Original-machine mirrors, for rendering. */
    this.stateIndex = S.FALL_R;   // DS:0x377
    this.phase = 0;               // DS:0x36b (CL), sign-extended as a byte
    this.footstep = false;        // set on the ticks the original plays SFX 0x0e

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
   */
  tick(map, input, fire = null) {
    this.footstep = false;
    this.emitted = null;
    if (this.fireState >= 0) { this._fireTick(map, input, fire); return; }
    switch (this.state) {
      case ST.GROUND: this._ground(map, input, fire); break;
      case ST.JUMP:   this._jump(map, input, fire);   break;
      case ST.FALL:   this._fall(map, input, fire);   break;
      case ST.CLIMB:  this._climb(map, input, fire);  break;
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

  /** One tick inside a firing state. */
  _fireTick(map, input, fire) {
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

    /* THE EMIT. CS:0x5D4E / 0x5423 / 0x4E1D / 0x5461 — `call 0x9734`. */
    if (r.emit && this.pendingAlloc && fire) {
      fire.emit(this.pendingAlloc, this.x, this.y, st.right);
      this.emitted = { right: st.right, state: id };
      this.pendingAlloc = null;
    }
    if (chained) this.pendingAlloc = chained;  // the next cycle's reservation

    /* ── the family's own movement, which runs regardless of the phase gate ── */
    let override = null;
    if (st.family === 'jump') {
      /* CS:0x536C `add word [0x17a],4`, behind the same three-cell probe the
       * walk uses; then the arc delta from DS:0xd922 at the CURRENT cursor. */
      this._walk(map, st.right ? +1 : -1);
      const i = this.jumpCursor >> 1;
      if (i < JUMP_DELTAS.length) {
        const d = JUMP_DELTAS[i];
        this.y -= d;
        if (this.doubleJump) this.y -= d;      // CS:0x53AD
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
      if (this.fallV < FALL_VMAX) this.fallV += GRAVITY_STEP;
      this.y += this.fallV;
      this.fallDamage = (this.fallDamage || 0) + 1;      // DS:0x176
      if (solidThreeBelow(map, this.x, this.y)) {        // CS:0x4DF1
        this.y &= 0xfff0;
        this.state = ST.GROUND;
        this.fallV = 0; this.airSteps = 0;
        this.fireState = -1; this.pendingAlloc = null;
        this.stateIndex = S.IDLE; this.phase = 0; this.renderPhase = 0;
        return;
      }
    }
    /* walk and ladder move nothing: state 5's body is `inc cl`, the emit gate,
     * the chain check and the animation — there is no X step in it at all, so
     * firing while walking HALTS the hero for the whole 5-tick cycle. */

    if (override) {
      this._leaveFire(override.next, override.cl);
      return;
    }
    if (r.next !== id) { this._leaveFire(r.next, r.nextCl); return; }

    this.firePhase = r.phase;
    this.stateIndex = id;
    this.renderPhase = fireAnimOffset(id, r.phase);
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
    else if (stateIndex === S.CLIMB) this.state = ST.CLIMB;
    else if (stateIndex === S.FALL_L || stateIndex === S.FALL_R) {
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

  _ground(map, input, fire) {
    const moving = input.left || input.right;
    /* ⚠️ ONLY THE WALK HANDLERS FIRE. State 26 (idle) tests the same bit at
     * CS:0x49EA and calls CS:0x1045 — the object-pickup walk over DS:0x8314 —
     * so a stationary hero with fire held picks things up instead of shooting.
     * The test sits at CS:0x5A64 (state 0) and CS:0x5CA8 (state 1), BEFORE the
     * X step at CS:0x5A84 / 0x5CCB, and success `jmp`s straight past it: the
     * entry tick does not move, and neither does any tick of state 5/6. */
    if (moving) {
      this.facing = input.right ? +1 : -1;
      if (this._tryFire(this.facing > 0 ? 5 : 6, input, fire)) return;
    }
    if (input.left)  this._walk(map, -1);
    if (input.right) this._walk(map, +1);

    if (moving) {
      this.stateIndex = this.facing < 0 ? S.WALK_L : S.WALK_R;
      /* CS:5AD8 `inc cl` / 5ADA `and cl,7` — an 8-frame cycle. */
      this.phase = (this.phase + 1) & (WALK_CYCLE - 1);
      /* CS:5AAD and 5ABA both `mov ax,0x20e / call 0x22ca` — the footstep
       * sound, twice per cycle at opposite phases. No audio yet; the flag is
       * exposed so the hook exists and is dated by evidence, not invented. */
      this.footstep = WALK_FOOTSTEP_PHASES.includes(this.phase);
    } else {
      /* Leaving walk-left writes `mov cl,0xff` (CS:5AF9) and walk-right
       * `mov cl,0x1` (CS:5B0F) before entering state 26, so the STOPPING tick
       * renders 52-1 = 51 or 52+1 = 53. State 26's own handler then opens with
       * `sub cl,cl` (CS:49CA), so every later idle tick renders a flat 52 — a
       * direction-neutral standing pose. Reproduced exactly. */
      if (this.stateIndex !== S.IDLE) {
        this.phase = this.facing < 0 ? 0xff : 0x01;
        this.stateIndex = S.IDLE;
      } else {
        this.phase = 0;
      }
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
    if (moving && input.down && climbableThreeBelow(map, this.x, this.y)) {
      /* CS:0x59ab (walk-left) / CS:0x5bf3 (walk-right) — descend onto a
       * ladder three rows (48 px) below, tested before UP is even looked
       * at. The port's ladder is simplified (see _climb's own note), so
       * only the state transition and the X snap are reproduced. */
      this.x = (this.x + 0x20) & 0xFFE0;
      this.state = ST.CLIMB;
      this.stateIndex = S.CLIMB;
      this.phase = 0;           // UNKNOWN_ladder_anim_phase
      this.fromLadder = false;
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
        return;
      }
      if (climbableHere(map, this.x, this.y)) {
        /* Ladder snap: add 0x20 then AND 0xFFE0 -> multiple of 32 (tile origin) */
        this.x = (this.x + 0x20) & 0xFFE0;
        this.state = ST.CLIMB;
        this.stateIndex = S.CLIMB;
        this.phase = 0;         // UNKNOWN_ladder_anim_phase
        this.fromLadder = true;
        return;
      }
      /* not climbable: UP goes unconsumed, exactly as the original leaves
       * it — fall through to the normal ground continuation below. */
    }
    if (!solidThreeBelow(map, this.x, this.y)) this._enterFall();
  }

  _jump(map, input, fire) {
    const i = this.jumpCursor >> 1;          // cursor is a byte offset
    if (i >= JUMP_DELTAS.length) { this._enterFall(); return; }
    const d = JUMP_DELTAS[i];
    this.y -= d;
    if (this.doubleJump) this.y -= d;        // applied twice when [0x174] != 0
    /* The rise is COMMITTED: handlers 8/9 test input bits 0x01/0x02/0x80 only,
     * never 0x04/0x08, so direction cannot be steered while rising. Horizontal
     * motion is a hard-coded +/-4 gated on `cmp byte [0x358],4; jl`. */
    if (this.jumpCursor >= 4) this._walk(map, this.facing);
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

  _fall(map, input, fire) {
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
    if (this.fallV < FALL_VMAX) this.fallV += GRAVITY_STEP;
    this.y += FALL_BASE + this.fallV;        // 5..14 px/tick, one lump sum
    this.fallDamage = (this.fallDamage || 0) + 1;      // DS:0x176
    if (this.airSteps < AIR_STEPS_MAX) {
      if (input.left)  { this._walk(map, -1); this.airSteps++; }
      else if (input.right) { this._walk(map, +1); this.airSteps++; }
    }
    this.stateIndex = this.facing < 0 ? S.FALL_L : S.FALL_R;
    this.phase = 0;
    if (solidThreeBelow(map, this.x, this.y)) {   // CS:0x4BEB / 0x4CED
      this.y &= 0xfff0;                            // CS:0x4C34 / 0x4D39
      this.state = ST.GROUND;
      this.fallV = 0;
      this.airSteps = 0;
      /* Landing is its own state pair in the original (16 right / 17 left,
       * which bleed the fall-damage accumulator off at 4 per tick) but the
       * transition into and out of them is not ported, so the port goes
       * straight to idle rather than showing a landing frame it cannot time
       * correctly. UNKNOWN_landing_duration. */
      this.stateIndex = S.IDLE;
      this.phase = 0;
      return;
    }
    /* CS:0x4D06 (state 12) / CS:0x4C04 (state 11) — the fire test sits AFTER
     * the fall physics and the landing check, so a tick that lands never
     * fires. Read straight off state 12: the `add [0x17c],4`, the gravity
     * call and `inc [0x176]` all precede it. */
    this._tryFire(this.facing < 0 ? 23 : 22, input, fire);
  }

  _climb(map, input, fire) {
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
    if (input.fire && (input.left || input.right)) {
      this.ladderFacing = input.right ? 1 : -1;
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
    /* CLIMBING DOWN IS 6 px, NOT 4 — and the branch is unambiguous because the
     * test is a full-byte compare, not a bit test:
     *     54CD  cmp byte [0x382],0x2 / jnz
     *     54D4    jmp 0x564b        ; input == EXACTLY 0x02 (DOWN alone)
     * and inside that block the step is `add word [0x17c],0x6` (CS:0x5663),
     * reached from both arms of the animation ping-pong. The ascent is 4 px.
     * UNKNOWN_ladder_up_branch: the plain climb-UP branch was not isolated to
     * a single site, so 4 is taken from the `sub word [0x17c],4` sites that
     * are visible and is the weaker of the two numbers. */
    if (input.up)   this.y -= CLIMB_UP_STEP;
    if (input.down) this.y += CLIMB_DOWN_STEP;
    this.stateIndex = S.CLIMB;
    this.phase = 0;                          // UNKNOWN_ladder_anim_phase
    if (!climbableHere(map, this.x, this.y)) {
      if (solidThreeBelow(map, this.x, this.y)) {
        this.state = ST.GROUND;
        this.stateIndex = S.IDLE;
      } else this._enterFall();
    }
  }
}

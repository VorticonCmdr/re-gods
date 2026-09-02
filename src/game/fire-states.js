/* fire-states.js — the eight firing states of the player state machine.
 *
 * These are the last piece between the (complete) projectile system and a
 * hero who can actually shoot. Each was read instruction-by-instruction from
 * its handler in the DS:0xd818 dispatch table.
 *
 * ⚠️ THE FOUR FAMILIES ARE NOT VARIANTS OF ONE PATTERN. A port that decodes
 * walk+fire and mirrors it into the other three gets the emit phase wrong in
 * six of the eight states, and the animation wrong in two.
 *
 *   family        states   emit at   animation            epilogue
 *   walk + fire    5,  6   phase 3   table DS:0xd950      0x5e9f (SKIPS the store)
 *   jump + fire   20, 21   phase 1   [0x356] inc/dec flag 0x5e9b
 *   fall + fire   22, 23   phase 1   [0x356] inc/dec flag 0x5e9b
 *   ladder + fire 24, 25   phase 1   bare inc             0x5e9b
 *
 * Walk is the odd one out on BOTH counts.
 */

/* ── The walk-fire animation table, DS:0xd950 ────────────────────────────
 *
 * CS:0x5d68 `mov di,0xd950 / mov [0x36b],cl / bl=cl / shl bx,1 /
 * mov cl,[bx+di]` — the phase is stored FIRST, then cl is replaced by the
 * table byte at [phase*2]. The handler then jumps to 0x5e9f, one instruction
 * PAST the epilogue's own `mov [0x36b],cl` (0x5e9b).
 *
 * ⚠️ So the PERSISTED phase and the RENDERED phase are different values.
 * `[0x36b]` keeps the raw 0..4 counter; the sprite is chosen from the table.
 * A port that stores the remapped value freezes the cycle, because the next
 * tick's `inc cl` would then run on a sprite offset instead of a counter.
 *
 * On-disk the entries are 2 bytes apart but only the low byte is read, so the
 * effective table is 2,1,0,1,2 — a symmetric recoil. Index 5 holds 21 and is
 * NEVER read: `cmp cl,5 / jl` diverts before the table lookup, so cl is only
 * ever 0..4 there. */
/* Index 5 (the value 21) is UNREACHABLE — `cmp cl,5 / jl` diverts before the
 * lookup — but it is the real byte and is kept deliberately. The original has
 * no fallback: `mov cl,[bx+di]` reads whatever is there. Substituting a safe
 * value would make a routing bug render a PLAUSIBLE sprite instead of a
 * visibly wrong one, which is the harder failure to notice. */
export const WALK_FIRE_ANIM = [2, 1, 0, 1, 2, 21];
export const WALK_FIRE_ANIM_REACHABLE = 5;
export const WALK_FIRE_ANIM_DS = 0xd950;

/** Emit phases, per family. Walk alone emits at 3. */
export const EMIT_WALK = 3;      // CS:0x5d48 / 0x5d8f
export const EMIT_OTHER = 1;     // CS:0x5423, 0x4dab, 0x4e15, 0x545c, 0x548e

/**
 * The eight firing states.
 *
 *  `emit`     the phase CL must equal for the spawner to be called
 *  `right`    true -> CS:0x9734, false -> CS:0x97ce
 *  `exit`     phase at which the state ends, and the state index it goes to
 *  `exitCl`   the phase handed to the destination state
 *  `anim`     'table' | 'flag' | 'inc'
 */
export const FIRE_STATES = {
  /* `exitCmp` — A THIRD ASYMMETRY between the families, visible only once
   * DS:0x356 can drive the phase backward:
   *     fall   22/23  CS:0x4DA9 / 0x4E13  `jz`   -> EQUALITY
   *     jump   20/21  CS:0x53F0           `jl`   -> signed >=
   *     ladder 24/25  CS:0x5467 / 0x5499  `jnl`  -> signed >=
   * Using >= everywhere makes the fall pair leave a tick early on any path
   * that decrements the phase. */
  5:  { exitCmp: 'ge', family: 'walk', name: 'walk right + fire', base: 19, right: true,  emit: EMIT_WALK,
        exit: 5, to: 1, exitCl: 2, anim: 'table', at: 0x5d46,
        note: 'at phase 5 re-checks fire and CHAINS (cl := 0) if it can allocate' },
  6:  { exitCmp: 'ge', family: 'walk', name: 'walk left + fire',  base: 22, right: false, emit: EMIT_WALK,
        exit: 5, to: 0, exitCl: 2, anim: 'table', at: 0x5d8d,
        note: 'mirror of 5' },
  /* ⚠️ A FOURTH ASYMMETRY, and this one was WRONG here until the tails were
   * read for the integration pass. An earlier revision mirrored 20 into 21 and
   * gave both exitCl 5. The bytes:
   *     CS:0x53F2  mov cl,5 / mov byte [0x377],9      state 20 -> 9  with cl 5
   *     CS:0x52D5  mov cl,6 / mov byte [0x377],8      state 21 -> 8  with cl 6
   * which is exactly consistent with the jump handlers' own documented split:
   * state 8 (jump LEFT) has two airborne frames and uses 6 as its catch-all,
   * state 9 (jump RIGHT) stores 5 in both of its arms. Handing state 8 a cl of
   * 5 renders a frame that state never produces on its own. */
  20: { exitCmp: 'ge', family: 'jump', name: 'jump right + fire', base: 45, right: true,  emit: EMIT_OTHER,
        exit: 3, to: 9,  exitCl: 5, anim: 'flag', at: 0x5338,
        note: 'exits with [0x358] += 2 so the jump arc continues; past 0x2e -> state 12' },
  21: { exitCmp: 'ge', family: 'jump', name: 'jump left + fire',  base: 48, right: false, emit: EMIT_OTHER,
        exit: 3, to: 8,  exitCl: 6, anim: 'flag', at: 0x521f,
        note: 'CS:0x52D5 `mov cl,6` — NOT the mirror of 20; see above' },
  22: { exitCmp: 'eq', family: 'fall', name: 'fall right + fire', base: 45, right: true,  emit: EMIT_OTHER,
        exit: 3, to: 12, exitCl: 0, anim: 'flag', at: 0x4dc3,
        note: 'runs the full fall physics: +4, gravity 0x48b0, += [0x1b2], fall-damage' },
  23: { exitCmp: 'eq', family: 'fall', name: 'fall left + fire',  base: 48, right: false, emit: EMIT_OTHER,
        exit: 3, to: 11, exitCl: 0, anim: 'flag', at: 0x4d59,
        note: 'mirror of 22' },
  /* ⚠️ THE LADDER PAIR'S EXIT PHASE IS CONDITIONAL, not a constant. Both tails
   * load their own value and then consult the phase the ENTRY saved:
   *     546C  mov byte [0x377],0x0e     ; state 14, both
   *     5471  mov cl,3                  ; 25 does `mov cl,1` at 0x54A3
   *     5473  test byte [0x359],0x1
   *     5478  jnz 0x547e                ; saved phase ODD  -> keep 3 (or 1)
   *     547A  mov cl,[0x359]            ; saved phase EVEN -> restore it
   *     547E  mov ax,[0x1b6] / mov [0x17c],ax    ; and restore Y
   * `[0x359]` is written by the entry (CS:0x55ED `mov [0x359],cl`), which is
   * also the tick that nudged Y up 4 when that same phase was even — so the
   * even case both moved the hero and hands the phase back untouched. Treating
   * exitCl as unconditional loses the climb's animation position on half the
   * entries. `exitClSaved: true` marks the pair that consults it. */
  24: { exitCmp: 'ge', family: 'ladder', name: 'ladder fire right', base: 39, right: true,  emit: EMIT_OTHER,
        exit: 3, to: 14, exitCl: 3, exitClSaved: true, anim: 'inc', at: 0x5455,
        note: 'sets [0x378]=1; restores Y from [0x1b6] on exit' },
  25: { exitCmp: 'ge', family: 'ladder', name: 'ladder fire left',  base: 42, right: false, emit: EMIT_OTHER,
        exit: 3, to: 14, exitCl: 1, exitClSaved: true, anim: 'inc', at: 0x5487,
        note: 'sets [0x378]=0xff; its own constant is 1, NOT 3 — asymmetric' },
};

/** CS:0x358 — the jump arc cursor, advanced by the jump-fire states too. */
export const JUMP_ARC_STEP = 2;      // CS:0x53F9 / 0x542B / 0x52DC / 0x530E
export const JUMP_ARC_END  = 0x2e;   // CS:0x53FE / 0x5430
/** ⚠️ The jump family has TWO exits and the cursor one WINS: the `add` and the
 *  `cmp [0x358],0x2e` run on both the exit and the continue path, and send the
 *  hero to the fall state with cl = 0 regardless of what the phase gate chose.
 *  CS:0x5408 -> 0x0c (12, fall right); CS:0x52EB / 0x531D -> 0x0b (11, left). */
export const JUMP_ARC_EXIT = { 20: 12, 21: 11 };

export const FIRE_STATE_IDS = Object.keys(FIRE_STATES).map(Number);

/**
 * The sprite offset a firing state renders this tick.
 *
 * ⚠️ Walk+fire remaps through the table; the other six render the raw phase.
 * Returns the value that goes into `sprite = anim_base + offset`.
 */
export function fireAnimOffset(stateId, phase) {
  const st = FIRE_STATES[stateId];
  if (!st) throw new Error(`state ${stateId} is not a firing state`);
  if (st.anim !== 'table') return phase;
  /* No fallback, matching CS:0x5d75 `mov cl,[bx+di]`. Out of range is a port
   * bug and should look like one. */
  return WALK_FIRE_ANIM[phase];
}

/** True when the persisted phase (DS:0x36b) differs from the rendered one. */
export const persistsRawPhase = (stateId) => FIRE_STATES[stateId].anim === 'table';

/**
 * One tick of a firing state, as a pure transition.
 * @param {number} stateId
 * @param {number} phase       CL on entry to the handler
 * @param {boolean} fireHeld
 * @param {boolean} canAlloc   result of the allocator, for the walk chain only
 * @param {boolean} flag356    DS:0x356 — set by the fall/jump ENTRIES
 * @param {number}  savedPhase DS:0x359 — the ladder pair's saved entry phase
 * @returns {{phase, emit, next, nextCl}}  `emit` true -> call the spawner
 */
export function fireTick(stateId, phase, fireHeld, canAlloc, flag356 = false,
                         savedPhase = 0) {
  const st = FIRE_STATES[stateId];
  /* CS:0x5473 — the ladder pair restores the saved phase when it is EVEN. */
  const exitCl = (st.exitClSaved && (savedPhase & 1) === 0) ? savedPhase : st.exitCl;
  /* CS:0x4d59 / 0x4dc3 / 0x5338 / 0x521f: when DS:0x356 is set the phase goes
   * DOWN on this tick and the flag clears. Its only writers are the fall and
   * jump ENTRIES, so this fires exactly once per entry. */
  let cl = flag356 ? phase - 1 : phase + 1;
  const emit = cl === st.emit;

  if (st.anim === 'table') {
    /* CS:0x5d52: below 5 -> just render. At 5, re-check fire. */
    if (cl < 5) return { phase: cl, emit, next: stateId, nextCl: cl };
    if (fireHeld && canAlloc) return { phase: 0, emit, next: stateId, nextCl: 0 };
    return { phase: exitCl, emit, next: st.to, nextCl: exitCl };
  }
  /* The other six: leave at the exit phase, no re-check, no chain — but the
   * COMPARISON differs by family (see exitCmp above). */
  const done = st.exitCmp === 'eq' ? cl === st.exit : cl >= st.exit;
  if (done) return { phase: exitCl, emit, next: st.to, nextCl: exitCl };
  return { phase: cl, emit, next: stateId, nextCl: cl };
}

/* ── The ENTRIES — UNKNOWN_fire_state_entry CLOSED `[PROVEN]` ────────────
 *
 * All four families share a core and each adds its own guard:
 *
 *   test byte [0x382],0x80 / jz  keepGoing     ; the fire bit
 *   call 0x95ca / cmp ax,0 / jnz keepGoing     ; the allocator, 0 == success
 *   mov byte [0x377],<state>
 *
 * walk   CS:0x5ca8   -> cl = 0
 * fall   CS:0x4c04   -> cl = 1, and [0x356] = 1
 * jump   CS:0x51cb   -> cl = 1, [0x356] = 1, plus TWO arc guards — see below
 * ladder CS:0x55d6   -> gated on [0x378] (ladder facing): 0 skips, negative
 *                       takes the LEFT variant; then saves Y into [0x1b6]
 *                       (which the exit restores), stores cl into [0x359],
 *                       and nudges Y up 4 when cl is EVEN; cl = 0
 *
 * ── ⚠️ THE JUMP FAMILY HAS TWO GUARDS, AND THEY STRADDLE THE ALLOCATOR ───
 *
 *     51C4  cmp byte [0x358],0x4 / jl 0x51f5     ; LOWER guard, BEFORE
 *     51CB  test byte [0x382],0x80 / jz
 *     51D2  call 0x95ca                          ; <-- the allocator
 *     51D5  cmp ax,0x0 / jnz
 *     51DA  cmp byte [0x358],0x2c / jnl 0x51f5   ; UPPER guard, AFTER
 *     51E1  mov byte [0x377],0x14
 *
 * Two things a port gets wrong by reading only the upper one:
 *
 *   1. THERE IS A LOWER GUARD. The cursor must be >= 4, so the hero cannot
 *      fire during the jump's 4-tick wind-up — the same `cmp [0x358],4` that
 *      gates horizontal motion. Firing is locked out at BOTH ends of the arc.
 *   2. THE UPPER GUARD SITS EIGHT BYTES PAST THE CALL. A press late in a jump
 *      therefore RUNS the allocator — setting the latch DS:0x351 — and is only
 *      then rejected. So that press is CONSUMED: the player must release and
 *      press again. Evaluating the guard first (as the ladder genuinely does,
 *      CS:0x55D6 preceding CS:0x55DF) leaves the latch clear and lets the very
 *      next tick fire.
 *
 * Both compares read [0x358] BEFORE the entry's own `add byte [0x358],0x2` at
 * CS:0x51ED, so they see the pre-advance cursor.
 *
 * ── UNKNOWN_fire_state_356 CLOSED: the ENTRY is its writer ──────────────
 *
 * `CS:0x4c20` / `CS:0x51e8` set DS:0x356 to 1 as part of entering a fall or
 * jump fire state. The handler then DECREMENTS the phase on that first tick
 * instead of incrementing, and clears the flag. With entry at cl = 1 the
 * sequence is 1, 0, 1, 2, 3 — a visible wind-up dip before the shot, which
 * lands on the emit phase 1 the second time through, not the first.
 *
 * ⚠️ So the fall/jump families do NOT emit on their first tick even though
 * their emit phase is 1. Modelling the entry as cl = 0 with a plain increment
 * fires one tick early and skips the dip.
 */
export const ENTRY = {
  5:  { cl: 0, flag356: false },
  6:  { cl: 0, flag356: false },
  /* `arcMin` is checked BEFORE the allocator (CS:0x51C4), `arcMax` AFTER
   * (CS:0x51DA) — see the note above; the split is not cosmetic. */
  20: { cl: 1, flag356: true, arcMin: 0x04, arcMax: 0x2c },
  21: { cl: 1, flag356: true, arcMin: 0x04, arcMax: 0x2c },
  22: { cl: 1, flag356: true },
  23: { cl: 1, flag356: true },
  24: { cl: 0, flag356: false, savesY: true },  // CS:0x55e7 -> [0x1b6]
  25: { cl: 0, flag356: false, savesY: true },
};

/** Guards evaluated BEFORE `call 0x95ca` — failing one leaves the latch alone. */
export function fireGuardBefore(stateId, { arcCursor = 0, ladderFacing = 0 }) {
  const e = ENTRY[stateId];
  if (!e) return false;
  if (e.savesY && ladderFacing === 0) return false;               // CS:0x55D6
  if (e.arcMin !== undefined && arcCursor < e.arcMin) return false; // CS:0x51C4
  return true;
}

/** Guards evaluated AFTER it — failing one still CONSUMED the press. */
export function fireGuardAfter(stateId, { arcCursor = 0 }) {
  const e = ENTRY[stateId];
  if (!e) return false;
  if (e.arcMax !== undefined && arcCursor >= e.arcMax) return false; // CS:0x51DA
  return true;
}

/**
 * Can the hero enter this firing state, and with what phase?
 *
 * ⚠️ This is a PURE PREDICATE and cannot express the latch side effect that
 * the guard ordering produces — use fireGuardBefore/fireGuardAfter around the
 * real allocator call for that. Kept because the combined answer is what the
 * transition tests want.
 *
 * @returns {{cl:number, flag356:boolean}|null}
 */
export function tryEnterFireState(stateId, { fireHeld, allocated, arcCursor = 0,
                                             ladderFacing = 0 }) {
  const e = ENTRY[stateId];
  if (!e) return null;
  if (!fireHeld) return null;
  if (!fireGuardBefore(stateId, { arcCursor, ladderFacing })) return null;
  if (!allocated) return null;                           // `cmp ax,0 / jnz`
  if (!fireGuardAfter(stateId, { arcCursor })) return null;
  return { cl: e.cl, flag356: !!e.flag356 };
}

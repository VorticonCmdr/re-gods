/* states.js — the hero's 29-state machine: table, labels and transition graph.
 *
 * WHY THIS FILE EXISTS
 *   Until now the port drew the hero as a box, because the state -> sprite
 *   mapping was not established. It is now, at instruction level, and this
 *   module is the evidence. Nothing here is inferred from how the game
 *   "should" work; every label below is derived from the bytes cited beside
 *   it, and states whose meaning is NOT established are labelled UNKNOWN
 *   rather than guessed.
 *
 * THE TABLE
 *   DS:0xd818 (GAME.EXE file offset 0x1d978) holds 29 records of
 *   { u16 anim_base, u16 handler }. The dispatcher is FUN_1000_4993, called
 *   once per 15 Hz logic tick.
 *
 * THE PER-TICK CONTRACT — read this before changing anything
 *   4993  mov cl,[0x36b]        ; ANIMATION PHASE, persisted across ticks
 *   4997..49c9                  ; two gates (below), then `jmp ax` into the handler
 *   <handler>                   ; may write [0x377] (state) and CL (phase)
 *   5E9B  mov [0x36b],cl        ; phase stored back
 *   5EA0  call 0x5fab           ; plane-B event probe
 *   5EA4..5F76                  ; camera update (see camera.js)
 *   5F77  bl=[0x377] / bx*=4 / si=0xd818 / al=cl / cx=[bx+si] / cbw / ax+=cx
 *                               ; sprite = anim_base + sign_extend(cl)
 *   5F8B  three hard remaps: 0x34->0x19, 0x36->0x23, 0x37->0x26
 *   5FA7  call 0x6049           ; draw
 *
 *   Two consequences a port gets wrong by default:
 *     - [0x377] is re-read AFTER the handler, so a handler that transitions
 *       renders with the DESTINATION state's anim_base on that same tick.
 *     - CBW sign-extends AL, so CL = 0xFF means -1, not 255.
 *
 *   Dispatcher gates (49AA, 49B5), reproduced for completeness but not
 *   modelled here: a CS-resident self-modifying-code byte [cs:0x71d] must be
 *   0x90 (NOP), and [0x363] must be negative, or the whole state machine is
 *   skipped straight to the epilogue.
 *
 * HOW THE LEFT/RIGHT SPLIT WAS PROVEN — without assuming any input bit
 *   Flow closures were computed from each of the 29 entry points (following
 *   both arms of every branch, stopping at `jmp 0x5e9b`). Handlers share code
 *   by tail-jumping into each other, so a site inside two closures proves
 *   nothing — but four X-step sites sit in exactly ONE closure each:
 *
 *     4EB9  sub word [0x17a],4   only in closure(8)    -> state 8 moves -X
 *     50B5  add word [0x17a],4   only in closure(9)    -> state 9 moves +X
 *     524F  sub word [0x17a],4   only in closure(21)
 *     536C  add word [0x17a],4   only in closure(20)
 *
 *   The transition graph then gives 0 -> 8 and 1 -> 9 (jump take-off), which
 *   forces state 0 into the -X family and state 1 into the +X family. That
 *   chain never touches the meaning of an input bit.
 *
 *   It agrees with the input reading independently: state 26 (idle) at 49CA
 *   sends bit3 -> state 28 -> state 1 and bit2 -> state 27 -> state 0, and the
 *   project notes have bit2 = left, bit3 = right.
 *
 *   And a third, unprompted convergence: leaving walk-left sets `mov cl,0xff`
 *   (5AF9) before entering state 26, leaving walk-right sets `mov cl,0x1`
 *   (5B0F). With base(26) = 52 those render 51 and 53 — which are exactly the
 *   anim_base values of the two stub states 27 (left) and 28 (right). Three
 *   independent derivations, same answer.
 *
 *   Watch out for a trap in the disassembly: state 0's body contains BOTH
 *   `sub [0x17a],4` (5AA8, the real step) and `add [0x17a],4` (5AD3). The add
 *   is NOT a second direction — it sits under `cmp cl,7 / jng / mov cl,7`
 *   (5ACC-5AD1) and undoes the step when the walk-cycle phase is clamped.
 *   Counting signs instead of reading context gives "state 0 walks both ways".
 */

/* --- the shipped table, verbatim from DS:0xd818 --------------------------- */
export const STATE_TABLE = [
  /*  0 */ { base:  0, handler: 0x593b },
  /*  1 */ { base: 11, handler: 0x5b83 },
  /*  2 */ { base:  8, handler: 0x5dbb },
  /*  3 */ { base:  8, handler: 0x5dde },
  /*  4 */ { base:  9, handler: 0x5dfe },
  /*  5 */ { base: 19, handler: 0x5d46 },
  /*  6 */ { base: 22, handler: 0x5d8d },
  /*  7 */ { base:  9, handler: 0x593a },
  /*  8 */ { base: 31, handler: 0x4e6c },
  /*  9 */ { base: 29, handler: 0x5064 },
  /* 10 */ { base: 25, handler: 0x4c5d },
  /* 11 */ { base: 55, handler: 0x4bca },
  /* 12 */ { base: 54, handler: 0x4ccc },
  /* 13 */ { base: 25, handler: 0x54b9 },
  /* 14 */ { base: 25, handler: 0x5707 },
  /* 15 */ { base: 25, handler: 0x56ca },
  /* 16 */ { base: 29, handler: 0x5042 },
  /* 17 */ { base: 31, handler: 0x5020 },
  /* 18 */ { base: 29, handler: 0x4ae0 },
  /* 19 */ { base: 31, handler: 0x4b55 },
  /* 20 */ { base: 45, handler: 0x5338 },
  /* 21 */ { base: 48, handler: 0x521f },
  /* 22 */ { base: 45, handler: 0x4dc3 },
  /* 23 */ { base: 48, handler: 0x4d59 },
  /* 24 */ { base: 39, handler: 0x5455 },
  /* 25 */ { base: 42, handler: 0x5487 },
  /* 26 */ { base: 52, handler: 0x49ca },
  /* 27 */ { base: 51, handler: 0x4acc },
  /* 28 */ { base: 53, handler: 0x4ad6 },
];

/* --- what each state is, and how confident that is ------------------------
 * `sprite: false` marks a state whose own anim_base is provably never used.
 */
export const STATE_INFO = [
  /*  0 */ { label: 'walk left',            proof: 'closure(0) -> 8 (-X); 5AA8 sub X,4; cycle 5AD8 inc cl / and cl,7' },
  /*  1 */ { label: 'walk right',           proof: 'closure(1) -> 9 (+X); mirror of state 0' },
  /*  2 */ { label: 'turn left->right',     proof: '5DBB: LEFT -> state 3, else inc cl; entered from 0 (5979)' },
  /*  3 */ { label: 'turn right->left',     proof: '5DDE: RIGHT -> state 2, else dec cl; entered from 1 (5BC1)' },
  /*  4 */ { label: 'spawn / arrival idle',  proof: '5DFE reads LEFT/RIGHT only, else falls into 15. Entered from level start (8c3e), respawn (8d6) and teleport arrival (1022)' },
  /*  5 */ { label: 'walk right + fire',    proof: 'tail-jumps into state 1; calls 0x9734 (fire right)' },
  /*  6 */ { label: 'walk left + fire',     proof: 'tail-jumps into state 0; calls 0x97ce (fire left)' },
  /*  7 */ { label: 'no-op (bare RET)',     proof: '593A is a single `ret` — returns PAST the 0x5E9B epilogue',
             sprite: false },
  /*  8 */ { label: 'jump left',            proof: '4EB9 sub X,4 (exclusive); walks DS:0xd922 at 4F6F' },
  /*  9 */ { label: 'jump right',           proof: '50B5 add X,4 (exclusive); walks DS:0xd922 at 516E' },
  /* 10 */ { label: 'fall (ladder family)', proof: '4C5D gravity; base 25 = the ladder animation group' },
  /* 11 */ { label: 'fall left',            proof: 'entered from state 0 at 5957 when nothing is 3 rows below' },
  /* 12 */ { label: 'fall right',           proof: 'entered from state 1 at 5B9F; mirror of 11' },
  /* 13 */ { label: 'climb (from walk)',    proof: 'entered at 59BA right after the X snap 59AB/59B0' },
  /* 14 */ { label: 'climb (from stand)',   proof: 'entered at 4A40 right after the X snap 4A36/4A3B; no gravity' },
  /* 15 */ { label: 'ladder drop check',    proof: '56CA: not solid below -> state 12 with the fall counters reset' },
  /* 16 */ { label: 'land right',           proof: '5042 bleeds fall damage: sub word [0x176],4 -> state 1' },
  /* 17 */ { label: 'land left',            proof: '5020 mirror -> state 0' },
  /* 18 */ { label: 'crouch, facing right',  proof: 'the dispatcher special-cases 0x12/0x13 at 499F to SKIP the panel-retract call 0x1e06 (its only caller file-wide); 4516/ac92/db68 raise the hitbox top by 0x18/0x14/0x18' },
  /* 19 */ { label: 'crouch, facing left',   proof: 'mirror of 18; 4B55 -> state 0' },
  /* 20 */ { label: 'jump right + fire',    proof: '536C add X,4 (exclusive); calls 0x9734' },
  /* 21 */ { label: 'jump left + fire',     proof: '524F sub X,4 (exclusive); calls 0x97ce' },
  /* 22 */ { label: 'fall right + fire',    proof: 'entered from 12 at 4D1B after `call 0x95ca`; calls 0x9734' },
  /* 23 */ { label: 'fall left + fire',     proof: 'entered from 11 at 4C19; calls 0x97ce' },
  /* 24 */ { label: 'ladder fire right',    proof: 'entered from 13/14; calls 0x9734; returns to 14' },
  /* 25 */ { label: 'ladder fire left',     proof: 'entered from 13/14; calls 0x97ce; returns to 14' },
  /* 26 */ { label: 'idle',                 proof: '49CA `sub cl,cl` then dispatches LEFT/RIGHT to 27/28' },
  /* 27 */ { label: 'stub: idle -> walk left',  proof: '4ACC mov cl,2 / mov [0x377],0 — 3 instructions',
             sprite: false },
  /* 28 */ { label: 'stub: idle -> walk right', proof: '4AD6 mov cl,2 / mov [0x377],1 — 3 instructions',
             sprite: false },
];

/* The three hard remaps applied at CS:0x5f8b AFTER base + sign_extend(cl). */
export const SPRITE_REMAP = { 0x34: 0x19, 0x36: 0x23, 0x37: 0x26 };

/**
 * The sprite-selection epilogue, ported exactly (CS:0x5f77 - 0x5fa6).
 * @param {number} state 0..28
 * @param {number} cl    animation phase; sign-extended as a BYTE (0xFF = -1)
 */
export function spriteFor(state, cl) {
  /* States 7, 27 and 28 never reach the sprite selector with their own index
   * in [0x377] — 7 returns past the epilogue entirely, 27 and 28 transition in
   * three instructions. Asking for their sprite is a porting error, so this
   * enforces the `sprite: false` metadata instead of leaving it decorative. */
  if (STATE_INFO[state] && STATE_INFO[state].sprite === false) {
    throw new Error(`state ${state} (${STATE_INFO[state].label}) never renders its own anim_base`);
  }
  const signed = ((cl & 0xff) << 24) >> 24;      // CBW on AL
  const id = STATE_TABLE[state].base + signed;
  return id in SPRITE_REMAP ? SPRITE_REMAP[id] : id;
}

/** The states whose own anim_base is provably never consulted. */
export const NON_RENDERING_STATES =
  STATE_INFO.map((s, i) => (s.sprite === false ? i : -1)).filter((i) => i >= 0);

/* The walk cycle is 8 frames (5AD8 `inc cl` / 5ADA `and cl,7`), with a
 * footstep sound fired at phase 2 and phase 6 (5AAD / 5ABA, both
 * `mov ax,0x20e / call 0x22ca`) — two steps per cycle, at opposite phases. */
export const WALK_CYCLE = 8;
export const WALK_FOOTSTEP_PHASES = [2, 6];

/* THE JUMP ANIMATION PHASE — formerly UNKNOWN_jump_anim_phase, now ported.
 *
 * Both jump handlers open with a 4-case chain on the INCOMING phase and the
 * jump cursor DS:0x358, read BEFORE this frame's `+= 2`. Verbatim:
 *
 *   state 8, jump LEFT (base 31), CS:0x4E6C
 *     4E6C  cmp cl,0xd / jnz 4E7C
 *     4E71    cmp byte [0x358],4 / jl -> keep 0x0D
 *     4E78    mov cl,7
 *     4E7C  cmp cl,6 / jz -> keep 6
 *     4E81  cmp cl,0 / jnz 4E92
 *     4E86    cmp byte [0x358],4 / jl -> keep 0
 *     4E8D    add cl,5
 *     4E92  mov cl,6                      ; the catch-all
 *
 *   state 9, jump RIGHT (base 29), CS:0x5064 — same shape with 0x0C / 5 / 4.
 *
 * THE ASYMMETRY IS REAL. State 8's 0x0D-exit stores 7 while its catch-all
 * stores 6, so jump-left has two distinct airborne frames. State 9 stores 5 in
 * BOTH places, so jump-right has one. Do not "fix" it into a mirror.
 *
 * WHERE THE HIGH PHASES COME FROM: 0x0C / 0x0D are set only when jumping OFF
 * A LADDER — CS:0x5912 `mov cl,0xc` (right) and CS:0x5927 `mov cl,0xd` (left),
 * both inside state 14 and both followed by `mov byte [0x358],0`. A GROUND
 * take-off instead does `xor cl,cl / mov byte [0x358],0` (CS:0x5A17), so it
 * always starts from phase 0. That is the whole reason two entry phases exist:
 * the hero leaves a ladder in a visibly different pose.
 */
export const JUMP_CURSOR_WINDUP = 4;      // `cmp byte [0x358],0x4`
export const LADDER_JUMP_PHASE = { 8: 0x0D, 9: 0x0C };   // CS:0x5927 / 0x5912

/** CS:0x4E6C and CS:0x5064. `cursor` is DS:0x358 BEFORE this frame's += 2. */
export function jumpPhase(state, cl, cursor) {
  const windup = cursor < JUMP_CURSOR_WINDUP;
  if (state === 8) {
    if (cl === 0x0D) return windup ? 0x0D : 7;
    if (cl === 6) return 6;
    if (cl === 0) return windup ? 0 : 5;
    return 6;
  }
  if (cl === 0x0C) return windup ? 0x0C : 5;
  if (cl === 5) return 5;
  if (cl === 0) return windup ? 0 : 4;
  return 5;
}

/* Phases the port sets with proof. Anything absent holds at 0 and is reported
 * as unmodelled rather than invented. The ladder's phase ping-pongs 0<->3
 * (CS:0x565C `inc cl / cmp cl,3 / jg`, CS:0x5688 `dec cl / jz` — state 13;
 * CS:0x58B6/0x58D6 — state 14, identical shape) with a climb-step sound
 * CS:0x5931 fired only at the two turn-arounds, and is now ported in
 * player.js's `_climb` — every gated tick steps the cycle one way or the
 * other, so the hero actually animates while climbing instead of freezing on
 * frame 0. A fire while climbing still saves the phase to DS:0x359 and
 * restores it after (not touched by this). UNKNOWN_ladder_anim_phase now
 * narrows to only WHICH physical direction (up vs down) increments vs
 * decrements the cycle — cosmetic, since both ends of the 0..3 range are
 * reachable either way; the port doesn't attempt to pick a side. */
export const PHASE_ZERO_STATES = [11, 12, 26];   // `xor cl,cl` on the main path
export const UNMODELLED_PHASE_STATES = [13];     // 14 (CLIMB) is now animated
export const LADDER_PHASE_MAX = 3;               // CS:0x565E `cmp cl,0x3`

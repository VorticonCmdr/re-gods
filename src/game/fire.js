/* fire.js — the hero's fire cycle: latch, allocate, animate, emit.
 *
 * This is the glue between the player state machine and projectiles.js, and
 * it is a separate module because the ordering is not what a port assumes:
 * allocation and emission happen on DIFFERENT TICKS, three apart.
 *
 * ── The latch, DS:0x351 ──────────────────────────────────────────────────
 *
 * CS:0x95cb reads it at the top of the allocator and bails returning 1 if it
 * is set; CS:0x95d5 sets it on entry. It has exactly two clears, and the
 * per-frame one is conditional:
 *
 *     019D  test byte [0x382],0x80     ; fire bit held?
 *     01A2  jnz 0x1a9                  ; HELD -> do NOT clear
 *     01A4  mov byte [0x351],0         ; RELEASED -> clear
 *
 * ⚠️ So the latch is NOT a per-frame reset. It clears only on a tick where
 * the fire button is *not* held, which makes the weapon SEMI-AUTOMATIC: one
 * volley per press. Holding fire does nothing until you release. A port that
 * clears the latch every frame gives the hero a 15 Hz autocannon.
 *
 * ── The fire branch, CS:0x5ca8 (walk-right; the other seven mirror it) ───
 *
 *     5CA8  test byte [0x382],0x80 / jz  notFiring
 *     5CAF  call 0x95ca               ; the allocator
 *     5CB2  cmp ax,0x0 / jnz notFiring
 *     5CB7  jmp 0x5d3d                ; only on ax == 0
 *
 * ⚠️ Note the test is `ax == 0`. The allocator's return is INVERTED (cx starts
 * at 1 and is zeroed on success), so the state machine enters the fire state
 * only when something was actually allocated. This is the inverted convention
 * observed in live use, not just inferred from the allocator's own bytes.
 *
 * ── The animation, CS:0x5d3d ────────────────────────────────────────────
 *
 *     5D3D  mov byte [0x377],5 ; xor cl,cl     ; enter state 5, phase 0
 *     5D46  inc cl
 *     5D48  cmp cl,3 / jnz                     ; PHASE 3 ONLY:
 *     5D4E    call 0x9734                      ;   emit (0x97ce when facing left)
 *     5D52  cmp cl,5 / jl stay
 *     5D57  test byte [0x382],0x80 / jz leave  ; at phase 5, re-check fire
 *     5D5E  call 0x95ca                        ;   and try to chain another
 *
 * So a shot is RESERVED on the press tick and EMITTED three ticks later, and
 * the cycle offers a chained re-fire at phase 5. At 15 Hz that is a 200 ms
 * delay between pressing and the projectile appearing — visible, and part of
 * why the game feels deliberate.
 */

import { allocateShots } from './weapons.js';

export const FIRE_BIT = 0x80;          // DS:0x382 bit 7
export const EMIT_PHASE = 3;           // CS:0x5d48 `cmp cl,3`
export const RECHECK_PHASE = 5;        // CS:0x5d52 `cmp cl,5`

/** The eight player states that are firing variants (DS:0x377 values). */
export const FIRE_STATES = [5, 6, 20, 21, 22, 23, 24, 25];

export class FireControl {
  constructor() {
    this.latch = false;        // DS:0x351
    this.phase = -1;           // CL while in a fire state; -1 = not firing
    this.pending = null;       // the allocation waiting for EMIT_PHASE
    this.facingRight = true;
  }

  /** CS:0x019D — call once per tick BEFORE anything reads the latch. */
  latchTick(fireHeld) {
    if (!fireHeld) this.latch = false;
  }

  /**
   * CS:0x95ca's gate plus the CS:0x5cb2 `cmp ax,0` test.
   * @returns {boolean} true when the state machine should enter a fire state.
   */
  tryFire(slots, weapons, fireHeld, facingRight) {
    if (!fireHeld) return false;                       // CS:0x5ca8
    const r = allocateShots(slots, weapons, { locked: this.latch });
    this.latch = true;                                 // CS:0x95d5
    if (!r.any) return false;                          // ax != 0 -> keep walking
    this.pending = r;
    this.phase = 0;
    this.facingRight = facingRight;
    return true;
  }

  /**
   * One tick inside a fire state. Returns the allocation to EMIT this tick,
   * or null. The caller turns that into records via spawnVolley().
   */
  tick(fireHeld) {
    if (this.phase < 0) return null;
    this.phase++;                                      // CS:0x5d46
    let emit = null;
    if (this.phase === EMIT_PHASE) {                   // CS:0x5d48
      emit = this.pending;
      this.pending = null;
    }
    if (this.phase >= RECHECK_PHASE && !fireHeld) this.phase = -1;  // CS:0x5d57
    return emit;
  }

  get firing() { return this.phase >= 0; }
}

/* ⚠️ SUPERSEDED — do not derive anything new from this file.
 *
 * `FireControl` hard-codes EMIT_PHASE 3 / RECHECK_PHASE 5, which are the WALK
 * family's numbers; six of the eight firing states emit at phase 1 instead,
 * and the four families differ in their exit comparison, their animation
 * source and their entry phase. game/fire-states.js has all of that.
 *
 * The running build uses game/hero-fire.js (the arsenal: slots, latch,
 * allocate, emit, step) and game/frame.js (the per-tick call order). This
 * module is now reachable only from the verification suite, where it still
 * earns its keep as an independent statement of the latch and the
 * allocate/emit split — two models agreeing is worth more than one. But it is
 * not the fire path, and it is not a scope note about one. */

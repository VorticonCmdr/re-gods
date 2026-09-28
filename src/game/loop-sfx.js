/* loop-sfx.js — the two looping ambience sounds GAME.EXE starts and stops
 * itself: the retracting spikes' machinery (sound 0x17) and a moving line
 * barrier (sound 0x45). Both are "bit 7 = repeat" ids, so the driver loops
 * them until sound export 5 (CS:0x22D6) stops them. Read from GAME.EXE.
 * The spike loop's starts are [PROVEN]: the port plays 0x0197 at exactly the
 * tape cursors the live sweeps logged it from CS:0x14E6 (PJOYL1 218 and 679,
 * PJOYL2 1712), and at none in the swept PJOYG2 2-470 / PJOYL3 92-1500. Its
 * stop and the whole barrier loop are [STATIC]: no demo moves a cycling
 * barrier on screen, and the sweeps log CS:0x22CA only.
 *
 * THE SPIKES — FUN_1000_1432, the per-tick object walk (inside the CS:0x01FC
 * object-pass gate). It zeroes DS:0x39A at CS:0x143C; FUN_1000_1AD6, called
 * first thing by both spike bodies (CS:0x1B72 for types 50/117, CS:0x1AF6
 * for type 130), counts the spikes on screen into it. After the walk:
 *
 *   14C4  if [0x39A]:                      ; a spike is on screen
 *           if [0x3DF]: ret                ;   already playing
 *           if cs:[0x71D] == 0xC3 && ![0x3AB]:
 *             play 0x0197 ; [0x3DF] = 1 ; ret
 *   14F0  if ![0x3DF]: ret
 *         if !([0x85] == 2 && [0x395]): stop 0x97   ; export 5
 *         [0x3DF] = 0
 *
 * cs:[0x71D] is 0xC3 in normal play; it is 0x90 only while the walker that
 * CS:0x05D7 installs after a level-start shop runs (CS:0x063A .. 0x080D),
 * which this port does not model. [0x3AB] is the shop flag; the port's shop
 * screen never runs the game tick. [0x85] == 2 is ROL.EXE (its init writes
 * it). DS:0x3DF has no other writer, so the latch survives a level change.
 *
 * THE LINE BARRIERS — FUN_1000_767A, the rescan loop (CS:0x01F2, also from
 * the death driver at CS:0x09C7):
 *
 *   767B  if ![0x364]: cs:[0x767A] = RET ; [0x395] = 0 ; goto 770C
 *   768F  push [0x395] ; [0x395] = 0
 *         for each armed slot: step it (0x7845); if it moved, 0x7720
 *   76F8  if [0x395]:                      ; one moved on screen
 *           if !old: play 0x08C5           ;   it just started
 *           ret
 *   770C  if !([0x85] == 2 && [0x3DF]): stop 0xC5
 *
 * 0x7720 sets [0x395] = 0xFF when the barrier's screen position overlaps the
 * view — see barrierOnScreen. Settle barriers never move once armed
 * (0x7845 returns at once), so only cycling ones sound.
 */

export const SPIKE_LOOP_SFX = 0x0197;     // CS:0x14E3
export const SPIKE_LOOP_STOP = 0x97;      // CS:0x1506
export const BARRIER_LOOP_SFX = 0x08c5;   // CS:0x7704
export const BARRIER_LOOP_STOP = 0xc5;    // CS:0x771A

/** FUN_1000_1AD6: AX = obj.x - [0xA] (CS:0x15F1), BX = obj.y (CS:0x161B). */
export function spikeOnScreen(sx, sy) {
  return !(sx > 0x140) && !(sx < -0x10) && !(sy <= -0x20) && !(sy >= 0xc0);
}

/** FUN_1000_7720, on the barrier's screen position. `rawWh`/`rawRows` are
 *  the record's own +0x1A / +0x1B bytes, used whole (+0x1A) and `& 7`
 *  (+0x1B), without the +1 the plane-B stamp adds. The branch order is the
 *  original's: x first, and the edge branch tests only the far edges. */
export function barrierOnScreen(sx, sy, rawWh, rawRows) {
  const edge = () => sx + rawWh * 32 > -0x20 && sy + (rawRows & 7) * 16 > -0x10;   // 0x7748
  if (sx <= -0x20) return edge();          // 772D `jle 7748`
  if (sx > 0x160) return false;            // 7732 `jg 7747`
  if (sy <= -0x10) return edge();          // 7737 `jle 7748`
  return !(sy > 0xc0);                     // 773C `jg 7747`
}

export class LoopSfx {
  constructor() {
    this.barrier = 0;       // DS:0x395
    this.spikeLatch = 0;    // DS:0x3DF
  }

  /** The tail of FUN_1000_767A. `active` is [0x364] != 0. */
  barrierTick(active, movedOnScreen, { roland, play, stop }) {
    if (active) {
      const old = this.barrier;
      this.barrier = movedOnScreen ? 0xff : 0;
      if (this.barrier) {
        if (!old) play(BARRIER_LOOP_SFX);
        return;
      }
    } else {
      this.barrier = 0;
    }
    if (!(roland && this.spikeLatch)) stop(BARRIER_LOOP_STOP);
  }

  /** CS:0x14C4-0x1510. `onScreen` is DS:0x39A. */
  spikeTick(onScreen, { roland, play, stop, heroScripted = false, shop = false }) {
    if (onScreen) {
      if (this.spikeLatch) return;
      if (!heroScripted && !shop) {
        play(SPIKE_LOOP_SFX);
        this.spikeLatch = 1;
        return;
      }
    }
    if (!this.spikeLatch) return;
    if (!(roland && this.barrier)) stop(SPIKE_LOOP_STOP);
    this.spikeLatch = 0;
  }
}

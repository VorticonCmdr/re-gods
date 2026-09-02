/* clock.js — fixed-timestep logic clock.
 *
 * PROVENANCE — the tick rate is 15 Hz, NOT 50 Hz.
 *   This is the single most commonly-got-wrong number about this game, so the
 *   derivation is spelled out:
 *
 *   1. All four sound drivers program PIT channel 0 with divisor 19886:
 *        1193182 / 19886 = 60.0011 Hz.
 *   2. Their timer ISR (byte-identical in ADL/BPR/ROL/TDY) begins:
 *        inc byte [0x39]            <- UNCONDITIONAL, full PIT rate
 *        cmp byte [0x85],0 / jz ret
 *        dec byte [0xa9] / jnz play
 *        mov byte [0xa9],6 / jmp ret     <- skip 1 in 6
 *        play: ...call the music player
 *      The 5-of-6 divider gates ONLY the music, giving 50.001 Hz for MUSIC.
 *      `[0x39]` itself counts at the full 60.0011 Hz.
 *   3. GAME.EXE's main loop ends `mov al,[0x3d6]` -> `call 0x35ad`
 *      (graphics export 14). `[0x3d6]` has EXACTLY ONE write in the whole
 *      binary — `mov byte [0x3d6],0x3` at CS:0x0031 — so AL = 3 always.
 *   4. Export 14 spins:  VGA:0x0E60 cmp al,[0x39] / 0x0E64 jnl 0xe60
 *      (wait until [0x39] > 3) and then clears it at VGA:0x0F0D.
 *
 *   => one frame = 4 PIT ticks = 60.0011 / 4 = 15.000 Hz, and the player
 *      update FUN_1000_4993 runs exactly once per frame.
 *
 *   Music runs on a genuinely different clock (50 Hz) and must not be driven
 *   from this one.
 */

export const PIT_HZ    = 1193182 / 19886;   // 60.0011
export const MUSIC_HZ  = PIT_HZ * 5 / 6;    // 50.001
export const LOGIC_HZ  = PIT_HZ / 4;        // 15.000
export const TICK_MS   = 1000 / LOGIC_HZ;   // 66.67 ms

export class Clock {
  /**
   * @param {(tick:number)=>void} onTick  logic step, called at LOGIC_HZ
   * @param {(alpha:number)=>void} onRender  called once per animation frame
   */
  constructor(onTick, onRender) {
    this.onTick = onTick;
    this.onRender = onRender;
    this.acc = 0;
    this.last = 0;
    this.tick = 0;
    this.running = false;
    this._raf = null;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      let dt = now - this.last;
      this.last = now;
      /* Clamp so a background tab or a breakpoint cannot spiral. */
      if (dt > 250) dt = 250;
      this.acc += dt;
      while (this.acc >= TICK_MS) {
        this.onTick(this.tick++);
        this.acc -= TICK_MS;
      }
      this._fpsAcc += dt; this._fpsFrames++;
      if (this._fpsAcc >= 500) {
        this.fps = (this._fpsFrames * 1000) / this._fpsAcc;
        this._fpsAcc = 0; this._fpsFrames = 0;
      }
      /* alpha is a PORT-ONLY addition for display smoothing. The original
       * has no interpolation — it renders one frame per logic tick. */
      this.onRender(this.acc / TICK_MS);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }
  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}

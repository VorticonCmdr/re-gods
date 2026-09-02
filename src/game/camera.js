/* camera.js — the scroll origin, ported from CS:0x5ea4-0x5f76.
 *
 * PROVENANCE
 *   The camera is not a separate system: it is part of the state machine's
 *   per-tick epilogue, running between the plane-B event probe and sprite
 *   selection. DS:0x0a and DS:0x0c are the scroll origin — the same pair the
 *   entity code uses for screen position (`[di+0] - [0xa]`, `[di+2] - [0xc]`).
 *
 *   5EA4  ax = [0x17a] - [0xa]      ; hero X on screen
 *   5EAF  bx = [0x17c] - [0xc]      ; hero Y on screen
 *
 *   HORIZONTAL — a dead zone, panned at a flat 4 px/tick:
 *     5EC0  cmp ax,0x50 / jg        ; ax <= 80  -> pan LEFT
 *     5EC5  sub word [0xa],4 / jns / mov word [0xa],0     ; clamp at 0
 *     5ED4  mov dx,0x140 / sub dx,0x70                    ; = 0xd0 = 208
 *     5EDA  cmp ax,dx / jl          ; ax >= 208 -> pan RIGHT
 *     5EDE  add word [0xa],4 / cmp 0xec0 / jl / mov 0xec0 ; clamp at 3776
 *   Note the asymmetry: the left test is `<=` and the right is `>=`, so the
 *   dead zone is OPEN on the left — screen X in (80, 208). Writing it closed
 *   makes the camera jitter on the boundary.
 *   0xec0 + 320 = 4096 = the world width, exactly.
 *
 *   VERTICAL — proportional catch-up at half the excess, minimum 1 px:
 *     5F33  cmp bx,0x50 / jng       ; bx > 80  -> scroll DOWN
 *     5F38  dx = (bx - 0x50) >> 1   ; SAR, arithmetic
 *     5F3F  jnz / inc word [0xc]    ; a zero step still moves 1 px
 *     5F45  add [0xc],dx / clamp at 0x360
 *     5F59  cmp bx,0x20 / jnl       ; bx < 32  -> scroll UP (mirror)
 *   Dead zone: screen Y in [32, 80] inclusive at both ends.
 *   0x360 = 864 = 1024 - 160, i.e. the clamp keeps the 160-scanline backdrop
 *   region inside the world. 160 is measured directly: VGA:0x10E8 does
 *   `mov cx,0x1b80` = 7040 bytes / 44 bytes-per-row = 160 rows.
 *
 *   UNKNOWN_playfield_height — 160 is the BACKDROP region, not a proven
 *   visible height. The tile renderer covers only 144 px (VGA:0x1136/0x113D
 *   set loop counters 8 and 0xa, both `dec`/`jns`, so 9 rows x 11 columns =
 *   352x144), and VGA.EXE never writes CRTC index 0x18, so there is no
 *   hardware split screen to draw the boundary for us. This port renders the
 *   full 320x200 with no status panel; the camera clamp is faithful, the
 *   viewport is a port-level choice. Flagged, not hidden.
 *
 *   UNKNOWN_camera_alt_path — 5EB3 `cmp byte [0x32],0 / jz 0x5ec0`. Everything
 *   above is the [0x32] == 0 branch. The other branch calls 0x5e22 and jumps
 *   straight to sprite selection, skipping the camera entirely. What sets
 *   [0x32] is not established, so that path is not modelled.
 */

export const CAM_X_MIN = 0;
export const CAM_X_MAX = 0xec0;     // 3776; + 320 = 4096 = world width
export const CAM_Y_MIN = 0;
export const CAM_Y_MAX = 0x360;     // 864;  + 160 = 1024 = world height
export const DEAD_LEFT  = 0x50;     // pan when screenX <= 80
export const DEAD_RIGHT = 0xd0;     // pan when screenX >= 208
export const DEAD_TOP    = 0x20;    // scroll up when screenY < 32
export const DEAD_BOTTOM = 0x50;    // scroll down when screenY > 80
export const PAN_STEP = 4;

/** Arithmetic right shift by 1 — the original uses SAR, not a divide. */
const sar1 = (v) => v >> 1;

export class Camera {
  constructor(x = 0, y = 0) {
    /* UNKNOWN_camera_init — what the original writes into [0xa]/[0xc] at level
     * load has not been traced. The pan code clamps only when it pans, so an
     * out-of-range starting value would simply persist inside the dead zone;
     * the port clamps up front so it can never render outside the world. */
    x = Math.max(CAM_X_MIN, Math.min(CAM_X_MAX, x | 0));
    y = Math.max(CAM_Y_MIN, Math.min(CAM_Y_MAX, y | 0));
    this.x = x; this.y = y;            // DS:0x0a / DS:0x0c
    this.snapX = x; this.snapY = y;    // DS:0x1ae / DS:0x1b0 (see snapshot())
    this.lev3aLatch = false;           // DS:0x3d5
  }

  /* CS:0x023f, 0x0a14 and 0x92ad all do the same three-instruction pair:
   *     mov ax,[0xa] / mov [0x1ae],ax / mov ax,[0xc] / mov [0x1b0],ax
   * immediately before `call 0x4993`. So [0x1ae]/[0x1b0] are simply the scroll
   * origin as it stood BEFORE this tick's state machine — and the hero draw at
   * 0x6049 subtracts THOSE, not the freshly updated camera. Everything drawn
   * this frame should therefore use the snapshot, with the new camera taking
   * effect next frame. (Port-level ordering choice; the alternative is to draw
   * the tilemap with the new value and accept a 4 px hero/background skew,
   * which is the less likely reading of a hardware-scrolled page flip.) */
  snapshot() { this.snapX = this.x; this.snapY = this.y; }

  /**
   * One tick of the epilogue's camera update.
   * @param {number} heroX @param {number} heroY
   * @param {{world:number, sublevel:number}} lvl  DS:0x42 / DS:0x43
   */
  update(heroX, heroY, lvl) {
    const ax = heroX - this.x;
    let bx = heroY - this.y;

    /* horizontal */
    if (ax <= DEAD_LEFT) {
      this.x -= PAN_STEP;
      if (this.x < CAM_X_MIN) this.x = CAM_X_MIN;
    } else if (ax >= DEAD_RIGHT) {
      this.x += PAN_STEP;
      if (this.x > CAM_X_MAX) this.x = CAM_X_MAX;
    }

    /* CS:0x5ef1 — a scripted nudge, world 3 sublevel 'a' only. Once the hero
     * enters the box the latch [0x3d5] is set and the nudge then applies
     * unconditionally on every later tick (5EFD `jnz 0x5f26` skips the tests). */
    if (lvl && lvl.world === 3) {
      const inBox = heroX >= 0x340 && heroX <= 0x400 && heroY >= 0x2a0 && heroY <= 0x330;
      if (this.lev3aLatch || (lvl.sublevel === 0 && inBox)) {
        this.y -= PAN_STEP;
        bx -= 0x14;
        this.lev3aLatch = true;
      }
    }

    /* vertical */
    if (bx > DEAD_BOTTOM) {
      const dx = sar1(bx - DEAD_BOTTOM);
      if (dx === 0) this.y += 1;
      this.y += dx;
      if (this.y > CAM_Y_MAX) this.y = CAM_Y_MAX;
    } else if (bx < DEAD_TOP) {
      const dx = sar1(DEAD_TOP - bx);
      if (dx === 0) this.y -= 1;
      this.y -= dx;
      if (this.y < CAM_Y_MIN) this.y = CAM_Y_MIN;
    }
  }
}

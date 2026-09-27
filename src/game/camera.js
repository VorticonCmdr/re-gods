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
 *   UNKNOWN_playfield_height — CLOSED elsewhere in this project's own
 *   CLAUDE.md: a live DOSBox framebuffer capture (two unrelated rooms, same
 *   result both times) found the visible playfield really does stop dead at
 *   row 159, with a status-panel border starting at row 160 — matching this
 *   camera's own 0x360 = 1024-160 clamp exactly. game/status-panel.js's own
 *   loader finding corroborates it from the asset side: PSTAT3.PI1's own
 *   real content starts at exactly that row and nowhere else in the file is
 *   ever converted. This port still renders the world tilemap/entities over
 *   the full 320x200 buffer (unclamped — see renderer.js), but the status
 *   panel is drawn LAST and is opaque across the whole width, so whatever
 *   the world renderer draws below row 160 is fully covered before present()
 *   — the visible RESULT already matches, even though the world-draw itself
 *   isn't clipped to 160 rows.
 *
 *   UNKNOWN_camera_alt_path — 5EB3 `cmp byte [0x32],0 / jz 0x5ec0`. Everything
 *   above is the [0x32] == 0 branch. The other branch calls 0x5e22 and jumps
 *   straight to sprite selection, skipping the camera entirely. [0x32] is a
 *   scripted pan-to-target mode, installed by trigger ACTION selector 11 for
 *   per-world cutscenes and reset on every spawn/respawn — not modelled here
 *   since it never fires on shipped-level normal play outside those cutscenes.
 *
 * LEVEL-LOAD / RESPAWN / TELEPORT INIT — FUN_1000_2189, CS:0x2189-0x21C1.
 *   Reached, unconditionally or near enough, from three real gameplay sites:
 *   fresh level load (CS:0x8CA7), respawn with lives remaining (CS:0x08D3,
 *   skipped only while [0x32]'s scripted pan above is in control), and
 *   teleport-stone arrival (CS:0x100F).
 *
 *     2189  ax -= 0x90 ; bx -= 0x48        ; spawn point -> camera offset
 *     218F  clamp ax to CAM_X_MIN..CAM_X_MAX  (same bounds as the pan above)
 *     2196  clamp bx to CAM_Y_MIN..CAM_Y_MAX
 *     21AE  [0xa] = ax ; [0xc] = bx
 *
 *   The (0x90, 0x48) offset is not arbitrary: it puts the spawn point at
 *   screen (144, 72), inside the dead zone on BOTH axes (X in (80,208), Y in
 *   [32,80]), so the very first frame after a reset needs no catch-up pan.
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

// CS:0x2189/0x218C — the level-load/respawn/teleport init offset.
export const CAM_INIT_OFFSET_X = 0x90;   // 144
export const CAM_INIT_OFFSET_Y = 0x48;   // 72

/** CS:0x2189-0x21C1 (FUN_1000_2189): camera origin for a fresh spawn/arrival
 * point, clamped to the same world-edge bounds the per-tick pan uses. */
export function cameraForSpawn(x, y) {
  return new Camera(x - CAM_INIT_OFFSET_X, y - CAM_INIT_OFFSET_Y);
}

/** Arithmetic right shift by 1 — the original uses SAR, not a divide. */
const sar1 = (v) => v >> 1;

export class Camera {
  constructor(x = 0, y = 0) {
    /* This clamp is exactly CS:0x218F-0x21AB (FUN_1000_2189)'s own floor/
     * ceiling — see cameraForSpawn() above, the proven level-load/respawn/
     * teleport init path. The plain constructor still clamps unconditionally
     * so any other caller (a hand-picked debug position, say) can't render
     * outside the world either — the original's pan code only clamps when it
     * pans, so an out-of-range value would otherwise persist. */
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

/**
 * CS:0x5E22 — the scripted camera, run from the player epilogue (CS:0x5EB3)
 * INSTEAD of `update` while DS:0x32 is non-zero. No dead zones and no clamps.
 * X moves a flat 4 px toward DS:0x2EC; Y halves toward DS:0x2EE. DS:0x32
 * counts 1 -> 2 on the tick both axes land, then 2 -> 3 -> 4 (the unguarded
 * `jz` paths at CS:0x5E2C/0x5E5C), and stays at 4.
 * @param {{x:number,y:number}} c  the camera, moved in place
 * @param {{mode:number, tx:number, ty:number}} cs  DS:0x32, DS:0x2EC/0x2EE
 */
export function scriptedCameraStep(c, cs) {
  let bp = 0;
  if (cs.tx === c.x) bp++;                             // 5E2C `jz 0x5e53`
  else {
    c.x += cs.tx > c.x ? 4 : -4;                       // 5E2E-5E37
    if (cs.tx === c.x && cs.mode <= 2) bp++;           // 5E40-5E53
  }
  const d = cs.ty - c.y;
  if (d !== 0) {                                       // 5E5C `jz 0x5e8b`
    const h = d >> 1;                                  // 5E60 / 5E6E `sar dx,1`
    if (h === 0) c.y += d > 0 ? 1 : -1;                // 5E64 / 5E72 (only d = 1 reaches it)
    c.y += h;
    if (cs.ty !== c.y) return;                         // 5E82
    if (cs.mode > 2) return;                           // 5E84
  }
  if (bp === 0) return;                                // 5E8B
  if (cs.mode >= 4) return;                            // 5E8F
  cs.mode++;                                           // 5E96
}

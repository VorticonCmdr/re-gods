/* health-bar.js — the in-game vertical health gauge drawn onto the status
 * panel, CS:0x0e77/0x0e93.
 *
 * PROVENANCE
 *   Found by searching for consumers of DS:0x19a (the health BAR this
 *   project's own combat.js `Health` class already models) beyond the
 *   already-documented chase routine `FUN_1000_0dff` — `FUN_1000_0e93`
 *   reads it immediately after. Both disassembled directly (`disassemble_
 *   function`, not decompiled — the pseudo-C hides the two-blit crop trick
 *   this whole module depends on).
 *
 *   CALL SITE, straight-line code in the main loop, no branch:
 *
 *     CS:0x02C6  call 0x1000:0dff   ; the health-bar CHASE (already documented)
 *     CS:0x02C9  call 0x1000:0e77   ; THIS module
 *     CS:0x02CC  call 0x1000:0ab1   ; the lives digits (hud-digits.js)
 *     ...
 *     CS:0x02D8  call 0x1000:0bbf   ; the score digits (hud-digits.js)
 *
 *   so this draws every frame, unconditionally, right after the bar value
 *   itself is updated.
 *
 *   `FUN_1000_0e77` (CS:0x0e77-0x0e93) is the entry: it seeds the icon base
 *   `DS:0x312 := 0x7a` (122) and the position `[0x4] := 0xf` (15), then on
 *   every OTHER tick (`DS:0x36d`, a shared toggle this project already
 *   documents driving several unrelated animation cadences) advances a 0..3
 *   shimmer-phase counter `DS:0x3b4` before falling straight into
 *   `FUN_1000_0e93`'s own body:
 *
 *     0e93  si = 0x1e00 + (DS:0x312 + 4)*8     ; descriptor #126 (0x7a+4)
 *     0eac  ax = 4 - DS:0x3b4                   ; PUSHED, used after draw #1
 *     0eb5  ax := (DS:0x33&4) ? 0xad4c : 0xacde  ; the STATUS-PANEL buffer
 *     0ec9  [0x0] := ax                          ; NOT ES — DS:[0x0] is the
 *                                                ;   shared destination-SEGMENT
 *                                                ;   word the blitters read
 *     0ecc  [0x6] := 7 ; [0x4] += (DS:0x33&4)     ; PANEL-LOCAL Y=7, X=15(+0/4)
 *     0ed8  ax := max(DS:0x19a, 0)                ; the health BAR value, 0..24
 *     0ee7  E := (24 - ax) >> 1                    ; "empty" row count, 0..12
 *     0eee  descriptor[126].height := E             ; (height FIELD = height-1,
 *                                                    ;  the project's own
 *                                                    ;  already-established
 *                                                    ;  8-byte descriptor
 *                                                    ;  convention)
 *     0efd  DRAW #1: sprite 126, height-field E      ; renders SOURCE rows
 *                                                    ;   [0, E+1) at Y=7
 *     0f03  [0x6] += E+1                              ; Y := 7 + (E+1)
 *     0f0d  spriteId := 126 - (4 - DS:0x3b4)            ; one of {122..125}
 *     0f17  si -= (4-DS:0x3b4)*8                          ; that descriptor
 *     0f20  descriptor[that].height := max(11-E,0)+1        ; height-1 field
 *     0f2b  descriptor[that].arenaOffset += E*2               ; SOURCE row skip
 *     0f30  if (E+1)*2 != 26: DRAW #2                          ; SKIPPED
 *                                                               ;   only when
 *                                                               ;   E==12
 *                                                               ;   (health=0)
 *     0f3a  descriptor[that].arenaOffset restored (shared, mutated in place)
 *
 *   MEASURED (this pass, via the port's own `parseAtlas`/`cutAll` against
 *   the real `PALWAYS3.DAT`/`.PI1`): descriptors 122-126 (PALWAYS3 frames
 *   11-15) are all 16x14 — five identical-sized 16px-wide, 14-row sprites.
 *   126 is the "draw #1" graphic; 122/123/124/125 are the four "draw #2"
 *   shimmer phases, cycled by `DS:0x3b4`.
 *
 *   WORKING OUT THE EXACT ROW MATH (E in 0..11; E==12 is the skip case):
 *   draw #1 renders SOURCE rows [0, E+1) of sprite 126 at output Y=[panelY,
 *   panelY+E+1). CS:0x0F02 then increments DX to E+1, so draw #2's height
 *   field is `max(11-E,0)+1` (13-E rows) and its source offset grows by
 *   (E+1)*2 bytes (CS:0x0F29 `shl dx,1` of the INCREMENTED DX): it skips its
 *   own first E+1 rows (2 bytes a row, the 16px mask) and renders source
 *   rows [E+1, 14) at output Y=[panelY+E+1, panelY+14). Together the two
 *   draws cover 14 output rows, and draw #2 ends on the sprite's last row.
 *   ⚠️ An earlier revision skipped only E rows (missing the increment) and
 *   drew every filled row one row too high, never reaching row 13. [PROVEN]
 *   live (tools/attract-capture/panel_*_live.png): at E=0 the screen rows
 *   8-20 are the filled frame's rows 1-13, at E=1 rows 9-20 are rows 2-13,
 *   for the hero's gauge and the guardian's alike.
 *   At E==12 (health==0) draw #1 alone covers SOURCE/output rows [0,13),
 *   i.e. 13 of the 14 rows — draw #2 is skipped by CS:0x0F30's check
 *   (`(E+1)*2 == 26`). Reproduced as is.
 *
 *   Y POSITIONING. `[0x6]=7` is PANEL-LOCAL, not an absolute screen row —
 *   confirmed by disassembling graphics-driver export 21 (VGA.EXE, via
 *   `ndisasm -b16 -o0xced -e...`, offset+0x200 per this project's own
 *   established file<->memory formula) for an unrelated but adjacent
 *   question (the digit glyph's own Y math, see hud-digits.js): its
 *   destination offset is `(X>>3) + Y*44`, the EXACT VGA mode 0Dh 44-byte
 *   scanline pitch this project's CLAUDE.md already documents — with NO
 *   addition of the SS:0x40A variable this project's main loop is ALSO seen
 *   writing (0xA0/0xC0/0xC8 across ten sites) around various UI contexts.
 *   The only way `[0x6]` values this small (5,7,9,17) land inside the
 *   empirically-verified 160-199 status-panel band (`UNKNOWN_playfield_
 *   height`, live DOSBox capture) is if the CALLER already has the
 *   destination SEGMENT (not offset) pre-adjusted to the panel's own start
 *   — consistent with `export 18`'s already-documented 352x160 backdrop
 *   save/restore implying the playfield's own VRAM occupies exactly the
 *   first 160 rows, with the panel immediately following in the same linear
 *   address space.
 *
 *   ⚠️ UPDATE — the +160 is now PROVEN, not inferred, and
 *   `UNKNOWN_status_panel_es_segment` is CLOSED. VGA.EXE graphics exports 1
 *   and 2 (the blitters themselves, table words 0x1d07 / 0x1b86) each do
 *   `mov di,[0x0] / sub di,0x4 / mov es,di`, compute `di = x/8 + 44*y`, then
 *   `add di,0x40` (cancelling the -4 paragraphs): the destination segment is
 *   whatever the caller left in DS:[0x0]. This routine installs the
 *   status-panel buffer there at CS:0x0ec9, and FUN_1000_2274 (CS:0x02DE)
 *   copies that buffer to the live page with `add di,0x1b80` = 160*44. See
 *   inventory-panel.js's header for the full derivation, including VGA.EXE
 *   export 28's two-page backdrop copy and the segment arithmetic
 *   (0xacde-0xac7a = 1600 = 40x40; 0xad4c-0xacde = 1760 = 44x40).
 *
 * NOT PORTED (disclosed, not silently dropped):
 *   - `DS:0x33` / the DS:[0x0] segment choice (0xacde vs 0xad4c): the
 *     scroll-phase panel copies, which land on the same screen pixels
 *     ([PROVEN] live, message.js's DS:0x33 note). One panel is right.
 *   - The dirty-flag pair the original gates this on (none named in the
 *     disassembly above — this routine has NO dirty flag of its own,
 *     unlike score/lives/money; it draws unconditionally whenever called,
 *     matching this port's own full-redraw-every-frame convention exactly
 *     with no divergence to disclose).
 *
 *   `DS:0x3b4` HAS A SECOND WRITER: `FUN_1000_6b97` (an identical `inc`+
 *   `and 3` pair, near the already-documented `FUN_1000_6b00` world-advance
 *   function) and its own reader `FUN_1000_0e3c` are not chased here — this
 *   port's `healthBarShimmer` state models only the health-bar's own
 *   consumption of the counter. An exhaustive `search_instructions` sweep
 *   on `[0x3b4]` (7 hits total, program-wide) found no writer that ever
 *   resets it to zero, which is what justifies keeping this state
 *   session-persistent (main.js, beside `leverToggle`/`spikeClock`) rather
 *   than clearing it on level load.
 */

import { HEALTH_MAX } from './combat.js';

/** CS:0x0e9e/0eac — descriptor #126 (PALWAYS3 frame 15), the "draw #1" sprite. */
export const HEALTH_EMPTY_SPRITE = 126;
/** CS:0x0f0d — descriptor #122 (PALWAYS3 frame 11), the base of the 4-phase
 *  "draw #2" shimmer cycle (122/123/124/125). */
export const HEALTH_FILLED_SPRITE_BASE = 122;
export const HEALTH_FILLED_SPRITE_COUNT = 4;

/** CS:0x0e7d — the gauge's own screen X (before the unported +0/4 DS:0x33 shift). */
export const HEALTH_BAR_X = 0xf;
/** CS:0x0ecc — panel-local Y; see the module header for the +160 justification. */
export const HEALTH_BAR_Y_LOCAL = 7;
/** Both sprites are 16x14 (measured, PALWAYS3 frames 11-15) — the gauge's
 *  own full height in pixels. */
export const HEALTH_BAR_H = 14;

/**
 * CS:0x0F4D (called at CS:0x02E1 after the score, and from the respawn tick
 * at CS:0x931C) — the GUARDIAN'S health bar, drawn only while the guard<N>
 * group is in (DS:0x38A == 2). It re-enters this gauge's body at CS:0x0E93
 * with its own icon base (DS:0x312), x = 0x121 and, in place of DS:0x19A,
 * the guardian's DS:0x28A scaled to 0..24 against a per-world maximum:
 *
 *   0f5e  di = 0xD7BA + (world-1)*4 ; [0x312] = [di]      ; icon base
 *   0f72  ax = max([0x28A], 0) ; dx:ax = ax*24 ; ax /= [di+2]
 *   0f99  [0x19A] = min(ax, 24) ; call 0e93 ; restore [0x19A]
 *
 * DS:0xD7BA, read in the file and live (identical): the maxima are the
 * guardians' starting health (guardian.js, guardian4.js). The icon bases
 * fall in the guard<N> atlas at descriptor 0x1C2 (the four atlases carry
 * the same bar frames). The shimmer phase is the hero gauge's (0x0E93 reads
 * DS:0x3B4, advanced only by 0x0E77). It draws over PSTAT3's digit tile
 * (status-panel.js). [PROVEN] live: in a forced world-2 fight at full
 * health, this module's render of x 280-319, panel rows 0-39 matches the
 * captured screen on all 1600 pixels.
 */
export const GUARDIAN_BAR = {
  1: { base: 0x1e6, max: 1500 },
  2: { base: 0x1ec, max: 4400 },
  3: { base: 0x1d2, max: 2250 },
  4: { base: 0x1d6, max: 6000 },
};
export const GUARDIAN_BAR_X = 0x121;   // CS:0x0F54

/** CS:0x0F72-0x0F9E — DS:0x28A as a 0..24 bar value. */
export function guardianBarValue(hp, max) {
  return Math.min(HEALTH_MAX, Math.floor(Math.max(0, hp) * 24 / max));
}

/**
 * CS:0x0e83/0e8a-0e8e — advance the shimmer phase. Call once per game tick.
 * `DS:0x36d` gates the original's own increment to every OTHER tick (it
 * cycles 0,1,0,1... via `inc`+wrap-at-2, CS:0x0176-0x0181); reproduced here
 * with the state object's own tick parity rather than threading a second
 * shared global through main.js for a cadence nothing else in this port
 * needs to stay in sync with.
 * @param {{phase:number, tick:number}} state e.g. `{phase: 0, tick: 0}`,
 *   persisted across ticks
 */
export function stepHealthBarShimmer(state) {
  state.tick = (state.tick + 1) & 1;
  if (state.tick === 0) state.phase = (state.phase + 1) & (HEALTH_FILLED_SPRITE_COUNT - 1);
}

/**
 * CS:0x0ee7-0x0f3a — compute the two crop draws for a given health value.
 * Pure function so the geometry can be unit-tested without a renderer.
 * @param {number} health the bar value, DS:0x19a (combat.js `Health#bar`)
 * @param {number} shimmerPhase 0..3, `stepHealthBarShimmer`'s own state
 * @returns {{
 *   top: {sprite:number, rowStart:number, rowCount:number, y:number},
 *   bottom: ?{sprite:number, rowStart:number, rowCount:number, y:number}
 * }} `bottom` is `null` exactly when health is clamped to 0 (CS:0x0F30's
 *   own bounds-check skip — see the module header).
 */
export function healthBarDraws(health, shimmerPhase, base = HEALTH_FILLED_SPRITE_BASE) {
  const bar = Math.max(0, health);
  const E = (HEALTH_MAX - bar) >> 1;                    // CS:0x0ee7-0x0eec
  const rows1 = E + 1;                                   // CS:0x0eee/0x0f02
  const top = {
    sprite: base + HEALTH_FILLED_SPRITE_COUNT,           // CS:0x0e9e, [0x312]+4
    rowStart: 0,
    rowCount: rows1,
    y: HEALTH_BAR_Y_LOCAL,
  };
  if (rows1 === HEALTH_BAR_H - 1) return { top, bottom: null };   // CS:0x0f30, E===12
  const rows2 = HEALTH_BAR_H - 1 - E;                     // == max(11-E,0)+2 for E<=11
  return {
    top,
    bottom: {
      sprite: base + shimmerPhase,
      rowStart: E + 1,                                  // CS:0x0F02/0x0F29, (E+1)*2 bytes
      rowCount: rows2,
      y: HEALTH_BAR_Y_LOCAL + rows1,
    },
  };
}

/**
 * Draw the gauge. `frames` is the cumulative descriptor-indexed atlas array
 * (`hero.frames` elsewhere in this port) — descriptors 122-126 are all part
 * of the `always` group, loaded at boot, so no extra atlas load is needed.
 * @param {import('../render/renderer.js').Renderer} renderer
 * @param {Array<{w:number,h:number,pixels:Uint8Array}>} frames
 * @param {number} health
 * @param {number} shimmerPhase
 * @param {number} panelY0 the status panel's own screen-Y origin (160)
 * @param {{base?:number, x?:number}} [at] DS:0x312 and [0x4]: the hero's
 *   gauge by default, GUARDIAN_BAR[world].base / GUARDIAN_BAR_X for 0x0F4D
 */
export function drawHealthBar(renderer, frames, health, shimmerPhase, panelY0,
                              { base = HEALTH_FILLED_SPRITE_BASE, x = HEALTH_BAR_X } = {}) {
  if (!frames) return;
  const { top, bottom } = healthBarDraws(health, shimmerPhase, base);
  for (const draw of bottom ? [top, bottom] : [top]) {
    const f = frames[draw.sprite];
    if (!f || draw.rowCount <= 0) continue;
    const start = draw.rowStart * f.w;
    const crop = { w: f.w, h: draw.rowCount, pixels: f.pixels.subarray(start, start + draw.rowCount * f.w) };
    renderer.blitSprite(crop, x, panelY0 + draw.y);
  }
}

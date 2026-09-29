/* status-panel.js — the in-game HUD/status frame, PSTATUS.PI1 / PSTAT3.PI1.
 *
 * PROVENANCE
 *   Undocumented before this pass — neither file appears anywhere in this
 *   project's own CLAUDE.md. Found by grepping GAME.EXE for ASCII "stat":
 *   four hits, two logical names (Table 1 Block B, DS:0x1ffd) and their
 *   `P`-prefixed Table 2 manifest entries:
 *
 *     1ffd:eab6  "status.pi1"    Table 2: "pstatus.pi1"  disk id 1
 *     1ffd:eb1b  "stat3.pi1"     Table 2: "pstat3.pi1"   disk ids 2,3
 *
 *   Disk 1 is the boot disk (always present); disks 2/3 are the world data
 *   disks (worlds 1-2 / 3-4). That split, and the two load sites below,
 *   settle which file is the real in-game panel.
 *
 *   BOTH decompress to a full 32034-byte DEGAS image (resolution word 0,
 *   proper ST 3-bit palette), but only rows 160-199 hold real pixels — rows
 *   0-159 are uniformly colour index 0. That is not incidental: it is
 *   exactly the 40-row HUD band this project's own CLAUDE.md already proved
 *   live (`UNKNOWN_playfield_height` — a raw DOSBox framebuffer capture
 *   found the visible playfield stops at row 159 and a status-panel border
 *   starts at row 160). The loader below confirms it from the other side —
 *   the conversion routine skips straight to that row and never touches the
 *   rest of the file.
 *
 *   LOAD SITES, both disassembled directly (Ghidra, not decompiled — the
 *   pseudo-C hides the DX/ES/SI register setup this depends on):
 *
 *   `status.pi1` — CS:0x2a01, called from `FUN_1000_2882` (CS:0x28E0), the
 *   already-documented STARTUP loader that also loads the `always` sprite
 *   atlas — i.e. `PSTATUS.PI1` loads once at GAME.EXE boot, before any
 *   level or menu logic runs. Its own body:
 *
 *     2a01  mov dx,0xeab6            ; "status.pi1"
 *     2a09  mov ax,0x351b / mov es,ax  ; ES:BX = the shared DCL staging buffer
 *     2a0e  sub bx,bx
 *     2a10  call 0x1000:257e          ; the shared DCL loader (decompress raw)
 *     2a13  call 0x1000:2a32          ; graphics EXPORT 30 ("GC reset")
 *     2a17  mov ax,0xac7a / mov es,ax  ; ES:DI = the CONVERTED destination
 *     2a1c  sub di,di
 *     2a1e  mov ax,0x351b / mov ds,ax
 *     2a23  mov si,0x6422             ; 0x22 (header) + 160*160 (ST_ROW_BYTES)
 *     2a26  call 0x1000:2a2b          ; graphics EXPORT 31
 *                                     ;   ("ST-interleaved -> VGA planar,
 *                                     ;    contiguous, no pad")
 *
 *   `0x6422 - 0x22 = 0x6400 = 160 * 160` — SI lands exactly on the start of
 *   the 320x200 image's row 160 in ST 4-plane encoding (160 bytes/row), so
 *   only the bottom 40 rows are ever converted. "Contiguous, no pad" (as
 *   opposed to export 3's full-screen, 44-byte-padded conversion) matches a
 *   tight 320x40 result with no virtual-scanline slack.
 *
 *   `stat3.pi1` — CS:0x05a0, inside `FUN_1000_0524`, the GUARDIAN FIGHT's
 *   one-shot setup. ⚠️ An earlier revision called 0524 "the main game loop"
 *   and DS:0x38A a once-per-process latch, and so drew PSTAT3 for all of
 *   gameplay. Both were wrong: 0524's only caller is CS:0x0321, taken when
 *   DS:0x35C (selector 11's guardian request) is set, and DS:0x38A is the
 *   sprite-overlay latch (2 = the guard<N> group, which 0524 loads just
 *   before this):
 *
 *     0529  cmp byte [0x38a],0x2 / jnz 0x533   ; guardian already set up?
 *     0596  mov byte [0x38a],0x2
 *     059b  mov byte [0x3e0],0x1               ; PSTAT3 is in the buffer
 *     05a0  mov dx,0xeb1b                      ; "stat3.pi1"
 *     05a3  call 0x1000:2a09                   ; the SAME body as above,
 *                                              ;   entered past its DX setup
 *
 *   Both files convert into the same destination (0xac7a:0), so one
 *   replaces the other. `DS:0x3E0` says which is in: 2a01 clears it, 059b
 *   sets it. PSTATUS comes back at the next level entry (CS:0x0075 ->
 *   0x21C2 -> 0x2205 `cmp [0x3e0],0` / 0x220C `call 2a01`) and at every
 *   shop exit (CS:0x6D97, unconditional). While DS:0x3E0 is set the money
 *   (CS:0x0B40) and score (CS:0x0BBF) draws return at once, so a guardian
 *   fight shows the skull panel with no money or score; the lives
 *   (CS:0x0AB1) still draw.
 *
 *   [PROVEN] live (tools/attract-capture/panel_*_live.png): in PJOYL2's
 *   world-2 play DS:0x3E0 = 0 and the panel matches PSTATUS on 1621 of the
 *   1906 pixels where the files differ (PSTAT3: 2; the rest lie under the
 *   digits). Poking DS:0x35C = 1 hit CS:0x05A6 with DS:0x3E0 = 1, and the
 *   panel then matched PSTAT3 on 1867 (PSTATUS: 1), with no money or score
 *   drawn. The next level entry hit CS:0x220C with DS:0x3E0 = 1 and left it
 *   0.
 *
 *   PALETTE. Neither load site is followed by a DAC-install call (no export
 *   7/8/9, no `INT 10h AX=1012h`) — the converted bytes are written straight
 *   into video memory using whatever palette the current level already has
 *   loaded. Comparing the embedded palettes bears this out: PSTATUS's words
 *   2-15 (`0112 0223 0334 0445 0556 0777 0300 0421 0532 0643 0754 0032 0770
 *   0000`) are byte-identical to PLEVEL1A.PI1's own words 2-15, differing
 *   only in the two low, level-specific accent slots (0/1) every level
 *   palette also varies independently. So this port does the same thing the
 *   original does: decode the PANEL'S INDICES only, and let whatever level
 *   palette is already active (`level.palette`, passed to `renderer.
 *   present()`) colour them — exactly how the hero and every other sprite
 *   atlas already work in this port (see main.js's own `loadSprites`, whose
 *   `hero.palette` is decoded but never actually used for rendering).
 *
 *   THE TWO IMAGES DIFFER IN ONE 89x29 REGION (x 226-314, y 160-188 of the
 *   full frame — i.e. near the right end of the 40-row band): PSTATUS shows
 *   an amber circular icon beside a horizontal track; PSTAT3 shows a skull
 *   icon beside a small digit tile. In play the score (panel row 5) and the
 *   money (row 17) draw over PSTATUS's part of it; during a guardian fight
 *   they are not drawn. Everything else — the weapon/item alcove on the
 *   left, the portrait frame, the row of empty pillar-flanked slots, the
 *   black health-bar trough along the bottom, the ornate stone border — is
 *   pixel-identical between the two. During the fight the guardian's
 *   health bar (CS:0x0F4D, game/health-bar.js) draws on PSTAT3's tile: the
 *   38 pixels of the live capture that matched neither file are that bar,
 *   and the port's render matches the tile exactly.
 *
 *   The dynamic overlay (health bar, lives, money, score, inventory,
 *   message line) lives in its own modules; this one renders the backdrop.
 *
 *   PSTATUS_PATH: `main.js` has a title screen (game/title-menu.js) but does
 *   NOT draw PSTATUS.PI1 on it — an earlier revision tried that, reasoning
 *   from the "visible... during the title screen" claim two paragraphs up,
 *   and a live DOSBox capture of the real title screen refuted it: the menu
 *   shows one continuous full-screen image (PBACKSCR.PI1 — see game/title-
 *   menu.js's own header) with no distinct HUD strip at the bottom at all.
 *   PSTATUS's boot-time VRAM write is still real (CS:0x2a01 genuinely runs),
 *   just transient: PBACKSCR's own full-screen load evidently happens AFTER
 *   it and overwrites rows 160-199 along with everything else, before a
 *   player ever actually sees the menu. `main.js` draws PSTATUS during play
 *   and PSTAT3 while `panelStat3` (DS:0x3E0) is set.
 */

import { decodePI1 } from '../formats/pi1.js';

export const PANEL_W = 320;
export const PANEL_H = 40;
/** CS:0x2a23's own `0x6422 - 0x22 = 0x6400 = 160 * ST_ROW_BYTES(160)`. */
export const PANEL_Y0 = 160;

/**
 * Decode a decompressed PSTATUS.PI1 / PSTAT3.PI1 into just the 320x40 band
 * that CS:0x2a01/0x2a09 ever actually converts. The panel's own embedded
 * palette is discarded — see the PALETTE note above; the caller colours
 * `indices` with whatever level palette is already active.
 * @param {Uint8Array} buf exactly 32034 bytes (the full decompressed file)
 * @returns {{indices: Uint8Array, w: number, h: number}} PANEL_W*PANEL_H
 *   palette indices, row-major, top-left at world screen row PANEL_Y0.
 */
export function decodeStatusPanel(buf) {
  const img = decodePI1(buf);
  const indices = new Uint8Array(PANEL_W * PANEL_H);
  const srcOff = PANEL_Y0 * PANEL_W;
  indices.set(img.indices.subarray(srcOff, srcOff + PANEL_W * PANEL_H));
  return { indices, w: PANEL_W, h: PANEL_H };
}

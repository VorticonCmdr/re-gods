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
 *   `stat3.pi1` — CS:0x05a0, inside `FUN_1000_0524` — which is the MAIN
 *   GAME LOOP itself (its body is a near-verbatim match of every per-tick
 *   routine this project's frame.js already documents: FUN_1000_9455
 *   (projectile step), FUN_1000_0dff (health-bar chase), FUN_1000_ed15
 *   (System-B entities), the CS:0x35ad frame-sync tail, ...). The load is
 *   gated by a one-time latch:
 *
 *     0529  cmp byte [0x38a],0x2 / jnz 0x533   ; already run? -> skip to the
 *                                              ;   loop body entirely
 *     05a0  mov dx,0xeb1b                      ; "stat3.pi1"
 *     05a3  call 0x1000:2a09                   ; the SAME shared body above,
 *                                              ;   entered PAST the DX setup
 *     0596  mov byte [0x38a],0x2                ; latch set (before the load,
 *                                              ;   but never cleared again)
 *
 *   `call 0x1000:2a09` is CS:0x2a01 + 8 — it skips straight past `status.
 *   pi1`'s own `mov dx,0xeab6`, reusing the identical decompress/convert
 *   body with DX already pointed at "stat3.pi1". So both files load into
 *   the SAME staging buffer (0x351b:0) and convert into the SAME destination
 *   (0xac7a:0) — PSTAT3 physically overwrites PSTATUS there. Since this
 *   latch is set once per process and never reset by any restart path (the
 *   "new game" reset inside this same function clears world/health/weapons/
 *   inventory but never touches DS:0x38a), the overwrite is permanent for
 *   the rest of the session: PSTATUS is visible only before the main loop
 *   has ever run once (this port has no title/menu/hiscore screen, so it is
 *   not modelled — see PSTATUS_PATH below), and PSTAT3 is what a player
 *   actually sees for the whole game from the moment gameplay begins.
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
 *   icon beside a small digit tile. Everything else — the weapon/item
 *   alcove on the left, the portrait frame, the row of empty pillar-flanked
 *   slots, the black health-bar trough along the bottom, the ornate stone
 *   border — is pixel-identical between the two. `UNKNOWN_status_panel_
 *   right_icon` — what that region actually represents (and whether it is
 *   itself later overdrawn by something dynamic) is not established; only
 *   its bounding box and the fact that it is baked differently into the two
 *   shipped files.
 *
 *   NOT PORTED (disclosed, not silently dropped): the health-bar FILL, the
 *   score/weapon-slot/key-icon digits and sprites drawn on top of this
 *   static frame each frame are a separate, unlocated mechanism (this pass
 *   only chased the frame's own load/convert path) — this module renders
 *   the static backdrop only. The black trough this project's own already-
 *   documented health-bar chase (`DS:0x19a`, game/combat.js's `Health`)
 *   would fill spans the full 320px width across roughly y=161..199 of the
 *   panel (index 15, pure black, in both files) — a plausible future
 *   anchor, not yet wired to anything.
 *
 *   PSTATUS_PATH: `main.js` now has a title screen (game/title-menu.js), so
 *   PSTATUS.PI1's own boot-time appearance IS reachable here — loaded once
 *   via `loadStatusPanel('PSTATUS')` and drawn behind the title menu and
 *   password grid, exactly the window CS:0x38a's own latch bounds it to in
 *   the original. `main.js` still loads and draws PSTAT3 for gameplay
 *   proper, matching what a player sees from the moment "BEGIN QUEST" (or
 *   a correct password) actually starts a level.
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

# GAME.EXE memory layout and the driver interface

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## `GAME.EXE` memory layout `[STATIC]`

Ghidra (`x86:LE:16:Real Mode`, 415 functions):

```
CODE_0  1000:0000-1000:ffcf ─┐
CODE_1  1ffd:0000-1ffd:f3ff  ├─ initialized image, ≈148K, matches file size
CODE_2  2f3d:0000-2f3d:5ddf ─┘
CODE_3u..CODE_9u, DATA       ── UNINITIALIZED (BSS), up to e000:1c4f
```

The large BSS region is where decompressed assets are staged. `UNKNOWN_asset_load_segments` — CLOSED, see below.

### `UNKNOWN_asset_load_segments` — the three overlay target segments, resolved `[PROVEN]`

⚠️ **Not BSS at all** — the ranked-list item's own framing ("target segments live in uninitialised data") was wrong. All three target-segment words are **literal, non-zero constants baked into the shipped file**, sitting inside the *initialized* image, and they are **MZ relocation entries**: the linker computed them assuming the program loads at segment 0, and flagged every reference to them — both the storage location and every later consumer instruction — for the DOS loader to patch by adding the true load segment.

**The three `AX=4B03h` (load overlay) parameter blocks**, one per overlay this document already documents loading unconditionally at entry:

| overlay | parameter block | raw (pre-reloc) target segment | reloc factor | load site |
|---|---|---|---|---|
| `unpack.exe` | `DS:0xd7ec`/`0xd7ee` | `0x30EC` | `0x30EC` (own word, separately relocated) | `CS:0x28F7` |
| `vga.exe`/`ega.exe` | `DS:0xd7e8`/`0xd7ea` | `0x2DB3` | `0x0000` (not relocated) | `CS:0x2906` |
| sound driver (`bpr/adl/rol/tdy.exe`) | `SS:0x52f8`/`0x52fa` | `0x3031` | `0x0000` (not relocated) | `CS:0x29A0` |

Every one of these six words (bar the two zero reloc-factors) is a hit in `GAME.EXE`'s own 93-entry MZ relocation table — checked by resolving every `{offset, segment}` entry to a file position and comparing against the parameter blocks' own file positions, an exhaustive table walk, not a spot check.

**And it isn't just the parameter blocks — every later CONSUMER of these constants is separately relocated too**, which is what makes the whole thing self-consistent regardless of where DOS actually loads `GAME.EXE`:

```
CS:0x125A8  9A 00 00 EC 30     call word 0x30ec:word 0x0     ; unpack.exe entry — segment IMMEDIATE relocated
CS:0x292D   B8 B3 2D            mov ax,0x2db3                 ; -> ES for the post-load VGA export copy — relocated
CS:0x29C7   B8 31 30            mov ax,0x3031                 ; -> ES for the post-load sound export copy — relocated
```

All three immediates are independently confirmed in the relocation table (file offsets `0x273b`, `0x2abe`, `0x2b58`).

**And the pattern is uniform across the whole export table, not just one instruction each.** All **41** graphics export slots' segment-half words (`SS:0x5252+2, +6, +10, …`) hold the identical raw value `0x2DB3`; all **13** sound export slots' segment halves hold `0x3031`. The runtime copy loop (`CS:0x2937`/`0x29D1`) only ever writes the **offset** half of each slot (`mov [bp+0],ax`) — the segment half needs no per-export value, because every export in one driver shares one segment, so the linker hardcoded it once across all 54 slots and let relocation fix all of them up together.

**`UNPACK.EXE`'s own header explains the one asymmetry.** `nrel=6` — six internal relocations of its own — while the graphics/sound drivers ship `nrel=0` (already documented). That is why unpack's relocation-factor word is itself relocated (needed, to fix up its own 6 internal fixups once loaded) while the drivers' factor stays a harmless `0`.

**The true runtime segments are `raw + (GAME.EXE's own live load segment)`, not a fixed universal constant** `[PROVEN]` — corrected this pass, live. An earlier revision of this section, written from a single traced session where `GAME.EXE` happened to load at `CS = 0x1000`, generalised that one run's bias into a fixed table (`0x40EC`/`0x3DB3`/`0x4031`) and flagged it `[STATIC]`, pending a live read. That live read has now been done, in a **different** DOSBox session where `GAME.EXE` loaded at a **different** segment — and it refutes the fixed-table framing while confirming the underlying mechanism exactly.

This session's own live `GAME.EXE` segments (established earlier in the same session, from the `DS − 0xFFD = CS` paragraph-gap relationship): `DS = 0x136A` (4970), `CS = 0x36D` (877) — **not** `0x1000`. Reading the three parameter-block words directly out of live guest memory at this `DS`/`SS`:

| overlay | field | raw (static file value) | **live value, this session** | `raw + live CS (0x36D)` |
|---|---|---|---|---|
| `unpack.exe` | `DS:0xd7ec` | `0x30EC` | **`0x3459`** | `0x30EC + 0x036D = 0x3459` ✓ |
| `vga.exe`/`ega.exe` | `DS:0xd7e8` | `0x2DB3` | **`0x3120`** | `0x2DB3 + 0x036D = 0x3120` ✓ |
| sound driver | `SS:0x52f8` | `0x3031` | **`0x339E`** | `0x3031 + 0x036D = 0x339E` ✓ |

All three land exactly on `raw + live CS`, to the byte, with zero fitting — a strong result, since the three raw values and the live bias are four independent numbers and the match has no slack. `DS:0xd7ec`'s *second* word (`DS:0xd7ee`) also reads `0x3459`, identical to the first — consistent with the already-documented "own word, separately relocated" note: `unpack.exe`'s load-segment and its own internal relocation-factor are the same computed value. And `0x3120` independently corroborates an earlier observation in this same session: a `debug_pause` taken at a random moment (while the CPU was idling in the VGA driver's own frame-wait busy-loop) showed `CS = 0x3120` — now explained, not just noted.

So **the mechanism is confirmed, but the earlier fixed-table framing overstated it**: these three parameter-block words are not simply "the linker's segment-0 constant plus a fixed `0x1000`" — they are recomputed by `GAME.EXE`'s own startup code (or fixed up by DOS at load time, not distinguished by this test) using **whatever segment `GAME.EXE` itself actually loaded at this run**, which DOS decides per-session and is not guaranteed to be `0x1000`. The earlier `0x40EC`/`0x3DB3`/`0x4031` table is correct **only** for a run where `GAME.EXE` loads at `CS = 0x1000` (true of the *Dynamic trace* section's own traced session); the general, session-independent rule — now `[PROVEN]`, not `[STATIC]` — is `true_segment = raw + live_GAME_EXE_CS`.

## The driver interface — 41 graphics + 13 sound exports `[PROVEN]`

The drivers are where most of the engine actually lives. Both vector tables sit in `SS` and are pinned by 54 MZ relocations: **`SS:0x5252` = 41 graphics slots**, **`SS:0x52f6` = 13 sound slots**, nothing at or beyond `SS:0x532a`. Driver-side, each graphics driver opens with 41 export offset words terminated by `0x0000`; on the sound side **only `ROL.EXE` has 13** — `ADL`/`TDY`/`BPR` are **20 words wide** (6 real entries, then 14 copies of one shared `RETF` stub) before the terminator, and because the copy loop at `CS:0x29D1` is terminator-driven rather than fixed-count, loading one of those three writes 20 offsets into `SS:0x52f6`.., past the 13 relocation-pinned slots. See the `ADL.EXE` export-table note under *Music formats*. All drivers have `hdrpara=32`, `nrel=0`, `CS:IP=0000:0000`, so **`file_offset = segment_offset + 0x200`** — `ndisasm -b16 -o0 -e512 VGA.EXE` gives segment-relative addresses directly, which is the practical way to read them (they are not in the Ghidra project).

`GAME.EXE` reaches them through **two** thunk forms — a scan for only the first will miss slots:

```
36 FF 1E <imm16>          CALLF SS:[slot]                  e.g. 1000:2342
BD <imm16> / FF 5E 00     MOV BP,slot / CALL FAR [BP+0]    (SS-default)
```

`export_index = (slot − 0x5252) / 4` for graphics, `(slot − 0x52f6) / 4` for sound.

### Graphics: `VGA.EXE` is a **mode 0Dh** driver, not mode 13h

This is the headline surprise, and it changes the whole rendering model a port must reproduce:

- **BIOS mode 0Dh** — 320×200, 16 colours, **4 bitplanes** — matching the Atari ST source art 1:1, which is why the assets were never converted.
- CRTC Offset register `0x13 = 0x16` → a **44-byte / 352-pixel virtual scanline** (40 visible + 4 pad).
- **Two hardware-flipped pages** at `A000:0000` and `A226:0000`, 8800 bytes each (`44 × 200`).
- **No `0x3C8`/`0x3C9` DAC writes anywhere.** The palette is loaded via `INT 10h AX=1012h`.
- **Hardware scrolling**, not blitting: coarse via CRTC start address (`0x0C`/`0x0D`), fine via ATC index `0x13` pixel panning. A port must emulate both, not just swap buffers.

| Idx | VGA off | Role |
|---|---|---|
| 0 | `0x10EE` | **Playfield tile renderer** — walks the map, latch-copies 32×16 tiles from the cache |
| 1, 2 | `0x1D07`, `0x1B86` | **Masked sprite blits** (descriptor consumers; differ in clip bounds) |
| 3 | `0x1ECE` | **ST DEGAS planar → EGA planar converter** — the single most reusable routine for a port |
| 4 | `0x1F14` | Whole-page VRAM→VRAM latch copy (8800 B) |
| 5, 6 | `0x1F37`, `0x108E` | Retrace waits (end / start) |
| 7, 8, 9 | `0x1F44`, `0x1017`, `0x0FAA` | Palette blank / fade-out / fade-in |
| 10, 11 | `0x0F71`, `0x0F49` | Retrace-period calibration; copy visible page |
| 12 | `0x0F1A` | **INIT** — sets mode 0Dh, page segments, CRTC offset |
| 13, 14 | `0x0EE3`, `0x0E59` | Frame sync + **hardware page flip + scroll** (13 is a 5-byte trampoline into 14) |
| 15, 16 | `0x0E22`, `0x0E10` | Clear page; restore saved video mode |
| 17 | `0x204A` | **Build the packed tile cache** from two PI1 images (64 B per tile per plane) |
| 18 | `0x10AD` | Backdrop save/restore (352×160) |
| 19, 20 | `0x0D9D`, `0x0DD8` | Rect save/restore (104×112 at x=32,y=56) |
| 21 | `0x0CED` | Per-frame masked glyph blit, hard-wired to descriptor #127 |
| 22 | `0x0AAD` | **Atlas group loader** (see below) |
| 23, 28 | `0x09FB`, `0x0888` | Build/rebuild the two pre-shifted scroll pages (straight + 4px) |
| 24 | `0x09C7` | **VGA planar → ST DEGAS** (the reverse converter) |
| 25, 26 | `0x0987`, `0x09A7` | Save/restore a 24×16 block to VGA scratch |
| 27 | `0x0939` | Scroll page/phase select |
| 29 | `0x0788` | VRAM→RAM cache pass, 26 fixed 32×16 sprites |
| 30, 31 | `0x0854`, `0x0868` | GC reset; ST-interleaved → VGA planar (contiguous, no pad) |
| 32 | `0x06E6` | Draw-order / priority partition over 8-byte records |
| 33, 34, 35 | `0x0392`, `0x041C`, `0x04C1` | **`INT 9` keyboard ISR** install / remove / poll |
| 36 | `0x024C` | Particle/debris spawner |
| 37 | `0x00B6` | **Cubic Bézier evaluator** over `BEZIER.DAT` |
| 38 | `0x01B5` | Entity/object initialiser (0x28-byte records) |
| 39 | `0x0203` | Pixel → **pathfinder visited-grid** index (`(x−8)>>5 + 20*((y−8)>>4) + 0x55`) — indexes `SS:0x1c70` |
| 40 | `0x022E` | Pixel → **plane-B map** pointer, `bp += (x+16)>>5 + 128*(y>>4)` — see *The enemy pathfinder* |

Three structural findings worth carrying into a port:

- **Six exports do zero port I/O and touch no video memory** — 32, 36, 37, 38, 39, 40 are pure game logic (list partition, particle spawn, curve evaluation, entity init, coordinate math) merely *hosted* in the video driver, almost certainly asm shared with the ST/Amiga builds. A port should relocate them, not reimplement them as graphics.
- There is a **second, undocumented 9-entry jump table at `VGA:0x54`**, reached only by a computed `jmp ax` and pointing into a ~1900-byte region no export entry covers. It is the run-length tile renderer's unrolled-run dispatcher.
- **Calling convention:** registers plus fixed globals across three segments (`DS` host data, `SS` descriptors + scratch, `CS` driver-private), all returning `RETF`. Export 22's `BP=SP` stack frame is the **exception, not the rule**.

**Sprite descriptors.** The 8-byte descriptor `{ -(width-1), height-1, arena_offset, arena_segment }` is **`SS`-resident**, based at `DS:0x0e` (set to `0x1e00` by `GAME.EXE` at `1000:294b`) with stride 8. Consumers are exports 1, 2 and 21. Two *different* producers exist: **export 22** derives them from raw big-endian `P*.DAT` records (the `xchg al,ah` proves the byte-swap), while **export 29** is a VRAM→RAM cache pass emitting 26 hard-coded 32×16 sprites with no byte-swapping at all. Sprite payload plane stride is `w*h/8 − 2`; the commonly seen 64 bytes is just the 32×16 case, not the format.

**`BEZIER.DAT` resolved** `[PROVEN]`: exactly 1600 bytes = **four 200-entry big-endian Bernstein cubic basis tables**, consumed by export 37. Verified numerically — at t=0.5, `q0[100] = 8192 = 0.125 = (1−t)³` and `q1[100] = 24576 = 0.375 = 3t(1−t)²`.

### `UNKNOWN_TABLE_1FFD_0088` — CLOSED: GAME.EXE's own fallback palette, fed straight to the fade-in export `[STATIC]`

⚠️ **Boundary correction first.** The ranked item names "a 30-byte table" at `DS:0x88`. The real table is **32 bytes / 16 words, at `DS:0x86`–`0xa5`** — `DS:0x86` itself is word 0 (`0x0000`, the mandatory black entry 0 of a 16-colour palette), and the 30-byte framing came from starting the count one word late. Decoded values, in the same `0x0RGB` notation used throughout this document:

```
0000 0343 0111 0122 0334 0444 0554 0666 0200 0420 0530 0641 0750 0031 0762 0233
```

`DS:0xa6` (`0x0000`) and `DS:0xa8` (`0x0600`) sit immediately past the table and are unrelated data; not chased further here.

⚠️ **Second correction, found on a later re-read: the table is NOT big-endian in memory.** The parenthetical above ("big-endian, matching the on-disk ST/DEGAS convention") was checked against the raw bytes this pass and is wrong for this specific table. `GAME.EXE`'s own copy at `DS:0x86` is stored in **native x86 word order** — a plain little-endian `mov ax,[addr]` already returns the correct `0x0RGB` value, no `xchg al,ah` needed — which is the opposite of every `.PI1`-derived palette elsewhere in this document. Proven by a direct byte-level diff: `PBACKSCR.PI1`'s own on-disk palette (decompressed via `blast.py`) genuinely **is** big-endian (needs the swap to read correctly), and `GAME.EXE`'s 32 bytes at `DS:0x86` are byte-for-byte **the swap of it** — `game_bytes == byteswap16(pi1_bytes)` holds exactly, all 16 words, zero mismatches. So this table is a build-time pre-converted copy, baked in specifically so the x86 consumer code below can compare it natively with no runtime swap. That consumer is exactly where this matters — see the ratchet loop below, which reads this table with a bare `mov dx,[bx+si]` and no `xchg`.

**Identification.** All 44 shipped `P*.PI1` files were decompressed (`blast.py`) and their embedded 16-word palette (bytes `+2`..`+33`) diffed against this table at every candidate reading. Exactly one file matches **all 16 words exactly**, big-endian: **`PBACKSCR.PI1`** — including the non-round tail values `0x0031`, `0x0762`, `0x0233` that make the match discriminating rather than a run of small coincidental numbers. `PGODFONT.PI1` and `PINTROFT.PI1` (byte-identical to each other) are a near-miss, not the answer: they agree on 15 of 16 words and diverge only at index 7 (`0x0777` against this table's `0x0666`) — a related but different font/UI palette.

`PBACKSCR.PI1` is not an orphan: it is the `"backscr.pi1"` stem this document's own Table 1 Block B already resolves to `GAME.EXE` (distinct from `INTROV.EXE`'s own `PSTBACK.PI1` status background). So the table is a compiled-in duplicate of a real, GAME.EXE-owned asset's palette — not a floating constant with no shipped counterpart.

### `UNKNOWN_backscr_pi1_loader` — CLOSED: the status panel's own backdrop, and a shared refresh utility called from 8 sites `[STATIC]`

The load site sits immediately after the hiscores load routine (`FUN_1000_3445`, `CS:0x3445`–`0x34D4`) and was noted but not chased in an earlier pass. It is `FUN_1000_34d5` (`CS:0x34D5`–`0x3505`), its own properly-boundaried Ghidra function, not a mislabeled continuation:

```
34d5  cmp byte [0x387],0x0 / jnz 0x3505   ; one-shot latch — already loaded, skip
34dc  push es
34dd  mov ax,0x351b / mov es,ax            ; destination segment for the RAW decompress
34e2  xor bx,bx
34e4  mov dx,0xea8c                        ; "backscr.pi1" — read directly off DS:0xea8c
34e7  mov cx,0x7d22                        ; 32034 decimal — the exact DEGAS .PI1 size
34ea  call 0x1000:257e                     ; the shared DCL asset loader
34ed  push ds / push es / pop ds           ; DS := 0x351b (the just-decompressed image)
34f0  mov di,0x0
34f3  mov si,0x22                          ; skip the 2-byte res word + 32-byte palette
34f6  mov ax,0xa44c / mov es,ax            ; ES := 0xa44c, the conversion destination
34fb  call 0x1000:3573                     ; -> graphics EXPORT 3 (ST DEGAS -> VGA planar)
34fe  pop ds / pop es
3500  mov byte [0x387],0x1                 ; latch set
```

`0xea8c` reads `"backscr.pi1\0"` directly (confirmed by `read_memory`), and `0x7d22` = 32034 is this document's own already-established exact DEGAS `.PI1` decompressed size — an independent confirmation of the format claim from a fresh call site. `CS:0x3573` is `mov bp,0x525e / callf [bp+0]`, and `(0x525e − 0x5252)/4 = 3` — graphics **export 3**, the already-documented "ST DEGAS planar → EGA planar converter", called with `SI=0x22` (past the resolution word and 32-byte palette, exactly the bitmap offset this document's atlas-loader math already uses) and `DI=0` into `ES=0xa44c`.

**`FUN_1000_34d5`'s only caller is `FUN_1000_3506`**, which does a *second* driver call right after: `CS:0x351A → CS:0x357A` (`mov bp,0x5262` then fall into the shared `callf [bp+0]` thunk) — `(0x5262−0x5252)/4 = 4`, graphics **export 4**, "whole-page VRAM→VRAM latch copy (8800 B)" — with `DS := 0xa44c` (the buffer export 3 just filled) and `ES := [original DS:0]` (a segment word read out of the caller's own data segment before it was repointed), `SI=DI=0`. So the full sequence is: decompress `backscr.pi1` once (latched), convert its DEGAS planar bitmap to VGA/EGA planar format once, then copy that converted page into an active video/backdrop segment **every time `FUN_1000_3506` runs** — the conversion is one-shot, the VRAM copy is not.

**`FUN_1000_3506` is not hiscores-specific — it has 8 callers across the binary**, found via `get_xrefs_to`: `FUN_1000_2a37` (the central `.MAP`/`PALFILS` level loader this document already credits with both those loads), `FUN_1000_266b`, `FUN_1000_30d4`, `FUN_1000_311c`, `FUN_1000_318f` and `FUN_1000_32c0` (the latter two already named in this document's own *game-over* sequence — `CS:0x0987 call 0x318f` / `CS:0x0990 call 0x32c0`), `FUN_1000_3445` (the hiscores loader), and `FUN_1000_648b`. So this is a general **"ensure the status-panel backdrop is decompressed and refresh it into video memory"** utility, invoked at level (re)load, on entering the high-score screen, on game over, and from several other sites — not something wired specifically to hiscores. This independently corroborates `backscr.pi1`'s already-inferred identity as the status panel's own backdrop image: it is refreshed at exactly the moments the status panel would need repainting.

`FUN_1000_266b` (one of the 8 callers, read in full) is itself informative: it calls export 15 ("Clear page") first, then conditionally calls `FUN_1000_3506` only when `DS:0x387` is already set (skip-if-not-yet-loaded, since a fresh load is handled elsewhere), then `CS:0x2792` — this document's own already-documented `"GODS DISK ?"` swap-prompt digit patcher — then loads 16 words off the palette fade-staging buffer `DS:0x12` (also already documented, under the palette-fade closure) onto the stack. Consistent with a "clear the screen and show the disk-swap prompt" routine, not anything hiscores-specific either.

⚠️ **Correction, a later session: this section's own "status panel's own backdrop" framing was too narrow — `backscr.pi1` is a GENERAL full-screen decorative backdrop, and the title menu is one of its screens too.** A live DOSBox capture of the real title screen (`docs/dynamic-trace-and-runtime-data.md`'s own title-screen section) shows `PBACKSCR.PI1`'s brick-wall-and-skull artwork covering the WHOLE 320x200 frame behind the menu — not confined to a 40-row status band the way `PSTATUS.PI1`/`PSTAT3.PI1` genuinely are (this document's own separate entry for those). That is `[PROVEN]`, resolving this file's earlier "only its palette is proven to feed a generic fade helper, not that its bitmap is ever blitted anywhere" caveat outright: the bitmap is blitted, full-screen, at least for the title menu. What remains `[STATIC]`/unlocated: the specific call site that reaches `FUN_1000_3506` (or an equivalent direct export-3/4 pair) from the title-menu's own init (`FUN_1000_2c82`) or draw (`FUN_1000_317d`) — the 8-caller `get_xrefs_to` list above was gathered before the menu's own backdrop was known to need explaining, and none of the 8 named callers is obviously the menu's own init. A `[WF]`-quality guess (untested this pass) is that `FUN_1000_2a37`, the central level loader already in this 8-caller list, is ALSO on the path `GAME.EXE`'s boot sequence takes before the menu ever shows control to the player — plausible given the menu's own two real choices both converge on that same `FUN_1000_2a37` for the opposite direction (leaving the menu into a level) — but this was not traced forward this pass and should not be read as more than a lead.

### `UNKNOWN_fun_3506_dispatch` — CLOSED: a second one-shot latch loads the `smallfnt` atlas group `[STATIC]`

The branch past `CS:0x351F` (`cmp byte[0x38a],3 / jz 0x3560` — skip if this second latch is already set) is a call into graphics **export 22**, the already-documented atlas-group loader (`CS:0x354F call 0x1000:2342`, and `FUN_1000_2342`'s own body — `CALLF [SS:0x52aa]` — is already on record as export index `(0x52aa−0x5252)/4 = 22`):

```
3526  ax = [0x134] - 0x1e00 ; ax >>= 3   ; -> [0x138]   (see below)
3533  ss:[0x414] = 0xff
3539  push [0x134] / push [0x132] / push [0x130]   ; three scratch words, unread here
3545  push 0x43e                         ; a LITERAL address, i.e. an OUTPUT pointer
3549  push 0xea75                        ; a LITERAL address — the worklist pointer
354d  mov bp,sp
354f  call 0x1000:2342                   ; graphics export 22 — load-atlas-group-by-name
3552  add sp,0xa
3555  mov word [0x43e],0
355b  mov byte [0x38a],3                 ; latch set
```

`DS:0xea75` reads directly (via `read_memory`) as `"smallfnt\0\0hiscores.bin\0backscr.pi1\0objec…"` — so the pushed pointer lands on `"smallfnt"` immediately followed by a **double NUL** (the empty-string list terminator export 22's own documented format uses), i.e. a **one-entry worklist naming only the `smallfnt` group**. `"hiscores.bin"` and `"backscr.pi1"` sit later in the same string pool (Table 1 Block B) but are separate literals for separate call sites (the plain `AH=3Ch` hiscores file open and this section's own DCL loader call), not part of this worklist — Block B is a shared string pool, not one single variable-length list.

So `FUN_1000_3506`, the first time it runs, loads the **small-font sprite atlas** on top of refreshing the status-panel backdrop — which makes sense for any of its 8 call sites (level load, hiscores screen, game over, disk-swap prompt): all of them need to render text over this backdrop, and the small font has to be resident before that can happen.

`ax = ([0x134] − 0x1e00) >> 3` converts an absolute value into a **sprite-descriptor index** — `0x1e00` is this document's own already-documented sprite-descriptor arena base (`DS:0x0e`, set to `0x1e00` at `CS:0x294b`; also the weapon sprite-index base `di = 0x1e00 + val*8`), and `>> 3` divides by the 8-byte descriptor stride. So `DS:0x134` most plausibly holds an absolute descriptor address (out of export 22's own return, or a scratch the loader leaves behind) and `DS:0x138` ends up holding the `smallfnt` group's own **base descriptor index** — needed by any caller that must turn a font character into a sprite id.

### PSTATUS.PI1 / PSTAT3.PI1 — the in-game status panel, and the rest of `DS:0x38a`'s progression `[PROVEN]`

Neither file appeared anywhere in this document before this pass — not in Table 1 Block B's own partial enumeration, not in the disk manifest listing, nowhere. Found by a clean-byte grep of `GAME.EXE` for ASCII `"stat"`: two logical names and their `P`-prefixed Table 2 entries.

```
1ffd:eab6  "status.pi1"     Table 2: "pstatus.pi1"   disk id 1        (the boot disk)
1ffd:eb1b  "stat3.pi1"      Table 2: "pstat3.pi1"    disk ids 2, 3    (both world data disks)
```

Both decompress to a genuine 32034-byte DEGAS image (resolution word 0, a proper ST 3-bit palette) whose only non-blank content is rows 160–199 — the rest is uniformly colour 0. That is the exact 40-row HUD band this document's own `UNKNOWN_playfield_height` closure already proved live via a raw DOSBox framebuffer capture, corroborated here from the asset side.

**`status.pi1` loads once, at boot**, `CS:0x2a01`, called from `FUN_1000_2882` (`CS:0x28E0`) — the same already-documented function that loads the `always` sprite atlas via export 22 as the very first thing `GAME.EXE`'s `entry` does. Its body:

```
2a01  mov dx,0xeab6                 ; "status.pi1"
2a09  mov ax,0x351b / mov es,ax     ; ES:BX = the shared DCL staging buffer (SAME segment backscr.pi1 uses)
2a0e  sub bx,bx
2a10  call 0x1000:257e              ; the shared DCL loader — decompress the raw file
2a13  call 0x1000:2a32              ; mov bp,0x52ca / jmp 2a2e -> graphics EXPORT 30 ("GC reset")
2a16  push ds
2a17  mov ax,0xac7a / mov es,ax     ; ES:DI = the CONVERTED destination — no other reference to
2a1c  sub di,di                     ;   this segment exists anywhere else in the image
2a1e  mov ax,0x351b / mov ds,ax
2a23  mov si,0x6422                 ; 0x22 (2-byte res word + 32-byte palette) + 160*160
2a26  call 0x1000:2a2b              ; mov bp,0x52ce / jmp 2a2e -> graphics EXPORT 31
                                    ;   ("ST-interleaved -> VGA planar, contiguous, no pad")
2a29  pop ds
2a2a  ret
```

`0x6422 − 0x22 = 0x6400 = 160 × 160` (`ST_ROW_BYTES`) — `SI` lands exactly on the start of the 320×200 image's row 160 in ST 4-plane encoding, so export 31 only ever converts the bottom 40 rows. "Contiguous, no pad" (as opposed to export 3's full-screen, 44-byte-padded conversion used for `backscr.pi1` above) matches a tight 320×40 result with no virtual-scanline slack — a routine seemingly built for exactly this one job. Export 30 ("GC reset") running immediately before a raw planar write, with no masked-blit export (1/2) or DAC-install export (7/8/9) anywhere nearby, is consistent with this landing as a direct VRAM overwrite rather than a stored-then-blitted sprite.

**`stat3.pi1` loads once, the first time the real per-tick game loop runs.** `FUN_1000_0524` — a large function whose own body is a near-verbatim match of this document's already-documented per-tick call order (`FUN_1000_9455` the projectile step, `FUN_1000_0dff` the health-bar chase, `FUN_1000_ed15` the System-B entity walk, the `CS:0x35ad` frame-sync tail, …) — opens with a one-time gate:

```
0529  cmp byte [0x38a],0x2 / jnz 0x533   ; already run once? -> skip straight into the loop body
...
0596  mov byte [0x38a],0x2                ; latch set — BEFORE the load, never cleared again
05a0  mov dx,0xeb1b                       ; "stat3.pi1"
05a3  call 0x1000:2a09                    ; the SAME shared body above, entered PAST 2a01's own
                                          ;   `mov dx,0xeab6` — DX is already pointed at stat3
```

So `stat3.pi1` decompresses into the identical staging buffer (`0x351b:0`) and converts into the identical destination (`0xac7a:0`) as `status.pi1` — **`PSTAT3` physically overwrites `PSTATUS` at runtime.** Since this latch is set once per process and is never reset by any restart path (the "new game" reset embedded later in this same function clears world/health/weapon-slots/inventory but never touches `DS:0x38a`), the overwrite is permanent for the rest of the session. `PSTATUS` is visible only in the window between `GAME.EXE` boot and the first time this main loop executes — title screen, hiscores, "ENTER A PASSWORD" — and `PSTAT3` is what a player sees for the entire rest of the game from the moment real gameplay begins. This also completes the `DS:0x38a` progression the sibling `UNKNOWN_fun_3506_dispatch` closure above only had the tail of: `0 → 2` here (stat3 loads) `→ 3` in `FUN_1000_3506` (smallfnt loads) — three ordered one-shot stages of the same boot/first-frame loading sequence, not three unrelated latches.

**Neither load site is followed by a DAC-install call**, and the two files' own embedded palettes corroborate that the game never installs one for this asset: `PSTATUS.PI1`'s palette words 2–15 (`0112 0223 0334 0445 0556 0777 0300 0421 0532 0643 0754 0032 0770 0000`) are byte-identical to `PLEVEL1A.PI1`'s own words 2–15, differing only in the two low, level-specific accent slots every level palette also varies independently. So the panel's indices are drawn through whichever level palette happens to already be active — measured live in the `gods-web` port, which re-tints the identical panel bitmap correctly across worlds 1 and 4 with no special-casing at all, exactly as this reading predicts.

**Rendered, the two images are pixel-identical everywhere except one 89×29 region** (x 226–314, y 160–188 of the full frame): `PSTATUS` shows an amber circular icon beside a horizontal track; `PSTAT3` shows a skull icon beside a small digit tile. Everything else — a left-hand weapon/item alcove, a portrait frame, a row of empty pillar-flanked slots, a black health-bar trough spanning the full width, an ornate stone border — is shared. `UNKNOWN_status_panel_right_icon` — what that region represents, and whether it is itself later overdrawn by something dynamic, is not established; only its bounding box and the fact that it differs between the two shipped files.

**The dynamic overlay — health bar, score/lives/money digits — traced and ported `[STATIC]`, position confirmed live in the browser port.** A later pass chased the elements the paragraph above left unnamed: they are straight-line, unconditional calls in the main loop right after the panel's own backdrop refresh, no branch around any of them —

```
CS:0x02C6  call 0x1000:0dff   ; the health-bar CHASE (already documented — DS:0x19a chases DS:0x192)
CS:0x02C9  call 0x1000:0e77   ; health bar DRAW
CS:0x02CC  call 0x1000:0ab1   ; LIVES digits
CS:0x02CF  call 0x1000:0b21   ; money-changed detector (sets DS:0x6e/0x6f)
CS:0x02D2  call 0x1000:0b40   ; MONEY digits
CS:0x02D8  call 0x1000:0bbf   ; SCORE digits
```

**The health bar, `FUN_1000_0e77`/`FUN_1000_0e93` (CS:0x0e77-0x0e93).** Seeds icon base `DS:0x312:=0x7a`(122) and X `[0x4]:=0xf`(15); on every OTHER tick (`DS:0x36d`, the shared toggle this document already uses for several unrelated cadences) advances a 0..3 shimmer-phase counter `DS:0x3b4` before drawing. The draw itself is a two-crop trick reusing this document's own already-established 8-byte sprite-descriptor convention (`{-(width-1), height-1, arena_offset, arena_segment}`, `DS:0x0e`/`0x1e00`): it dynamically overwrites a sprite's `height-1` field and `arena_offset` field to crop one 16×14 bitmap into a variable-height progress-bar fill — a technique this document had not previously documented anywhere.

```
0e93  si = 0x1e00 + (DS:0x312+4)*8        ; descriptor #126 (0x7a+4), the "empty" sprite
0eac  ax = 4 - DS:0x3b4                    ; pushed, used to pick the shimmer sprite after draw #1
0eb5  ES := (DS:0x33&4) ? 0xad4c : 0xacde  ; see the Y-positioning note below
0ecc  [0x6] := 7 ; [0x4] += (DS:0x33&4)     ; panel-local Y=7, X=15(+0/4)
0ed8  ax := max(DS:0x19a, 0)                ; the health BAR value (chases the target), 0..24
0ee7  E := (24 - ax) >> 1                    ; "empty" row count, 0..12
0eee  descriptor[126].height := E             ; height-1 field
0efd  DRAW #1: sprite 126, height-field E      ; source rows [0, E+1) at output Y=7
0f03  [0x6] += E+1                              ; Y := 7 + (E+1)
0f0d  spriteId := 126 - (4 - DS:0x3b4)            ; one of {122..125}, the shimmer cycle
0f20  descriptor[that].height := max(11-E,0)+1      ; height-1 field
0f2b  descriptor[that].arenaOffset += E*2               ; source row skip = E rows (2 bytes/row, 16px 1-bit mask)
0f30  if (E+1)*2 != 26: DRAW #2                          ; SKIPPED only when E==12 (health==0)
```

Measured against the real assets (`PALWAYS3.DAT`/`.PI1` via the port's own `parseAtlas`/`cutAll`): descriptors 122-126 (frames 11-15) are all **16×14** — five identical-sized sprites. 126 is the empty/trough graphic; 122-125 are the four shimmer-phase fill variants. Draw #1 renders source rows `[0, E+1)` of sprite 126 at output `Y=[panelY, panelY+E+1)`; draw #2 renders source rows `[E, 13)` of the shimmer sprite (13-E rows for E≤11) at output `Y=[panelY+E+1, panelY+14)`. The two output ranges are adjacent with no gap and no overlap, covering exactly 14 rows for every E in 0..11 (verified algebraically: `E+(13-E)+1==14`) — though sprite row 13 (the physical last row of both bitmaps) is never source-sampled by either draw, a 1px reserved border row. At `E==12` (health==0 exactly) draw #2 is skipped by the original's own bounds check, leaving output one row short (13 of 14) — a genuine, faithfully-reproduced quirk, not "fixed."

`DS:0x3b4` (the shimmer phase) has **no zero-reset writer anywhere** in the binary (`search_instructions`, 7 hits, exhaustive) — a genuine session-persistent global, ported as such (`main.js`'s `healthBarShimmer`, beside `leverToggle`/`spikeClock`/`passwordSlots`, not reset by `switchLevel`). It has a second, unchased writer (`FUN_1000_6b97`, near the already-documented `FUN_1000_6b00` world-advance function) not modelled by this port.

**Score/lives/money digits, `FUN_1000_0bbf`/`FUN_1000_0ab1`+`FUN_1000_0af0`/`FUN_1000_0b21`+`FUN_1000_0b40`.** All three share one digit strip: `FUN_1000_0bbf`'s own call into `FUN_1000_0df8` (`mov bp,0x52a6 / callf [bp+0] / ret`) is graphics-driver **export 21**, which this document's own `formats/descriptors.js` had already independently anchored at **descriptor #127** (PALWAYS3 frame 16, measured 80×7 — exactly ten 8×7 digit cells) in prior, undocumented work — this pass is the first time that anchor was actually wired to a consumer.

**Score** draws all 4 bytes of the packed-BCD score (`DS:0x3b5`-`0x3b8`) least-significant byte first, ones nibble before tens nibble, stepping the draw cursor LEFT 8px per digit from a fixed **right** anchor `[0x4]:=0x128`(296):

```
0c05  al := bytes[0] ; push ax ; al &= 0xf   ; LOW nibble (ones) drawn first
0c0b  draw(al) ; [0x4] -= 8
0c13  pop ax ; al >>= 4                       ; HIGH nibble (tens)
0c1c  draw(al) ; [0x4] -= 8
... repeated for bytes[1..3] ...
```

**Lives**, `FUN_1000_0ab1`/`FUN_1000_0af0`, draws in the **opposite** order and from a fixed **left** anchor `LIVES_X=0x42`(66) — established from raw bytes, not the decompiler's pseudo-C, which renders this as an opaque signed-byte loop and gets the digit order backwards:

```
0afb  bl:=10 ; cl:=0
0aff  al -= bl / js 0b07 / inc cl / jmp 0aff   ; repeated subtraction, counting in CL
0b07  al += bl                                  ; undo -> AL = ONES digit
0b09  push ax                                    ; save {ones}
0b10  al := cl ; draw(al)                         ; TENS FIRST, at the fixed left anchor
0b18  [0x4] += 8                                   ; step RIGHT
0b1d  pop ax ; draw(al)                             ; ONES SECOND, 8px right of tens
```

So lives reads normally left-to-right (tens then ones) from a fixed left anchor, the opposite convention from score/money's right-anchored, right-to-left layout — a real asymmetry between a fixed-width 2-digit counter and a variable-magnitude accumulator, clamped at 99 (`CS:0x0af3`/`0x0af8`).

**Money**, `FUN_1000_0b21` (change detector, comparing the live 32-bit total `DS:0x194`/`0x196` against a same-tick snapshot and setting a third dirty-flag pair) + `FUN_1000_0b40` (draw), renders as a **plain decimal** number (repeated `div 10`, not BCD), right-anchored at the same `0x128` score uses, six digits:

```
0b7b  cmp dx,7 / jl 0b92                  ; high word < 7 -> no clamp
0b80  cmp ax,0xa120 / jle 0b92              ; == 7 and low <= 0xa120 -> no clamp
0b85  ax:=0xa120 ; dx:=7                    ; ELSE clamp
0b8b  [0x194]:=ax ; [0x196]:=dx               ; WRITTEN BACK — a real, permanent clamp
```

`0x0007a120 == 500,000` — **money is capped at display time**, in `FUN_1000_0b40`, with the clamped value written back into the real 32-bit total rather than being a display-only trick. A genuinely new finding: no earlier pass of this document had located a money cap anywhere.

⚠️ **`DS:0x33` bit 2 is read by every one of health/score/lives/money** (and, per the backfill below, by the separate top-of-screen inventory panel too) — an unidentified UI-mode flag selecting between `ES=0xacde`/`0xad4c` (health bar) or a 0/4px X shift (digits, inventory panel). Its true meaning was never established in this document; `gods-web` defaults to the bit-clear arm throughout, consistent with `inventory-panel.js`'s own prior, undocumented precedent, and discloses the shift as NOT PORTED rather than silently dropping it.

**`UNKNOWN_status_panel_es_segment` — the exact segment arithmetic in `GAME.EXE` was not traced further, but the +160 offset itself is now confirmed empirically, not just circumstantially.** Panel-local Y values (5, 7, 9, 0x11) are far too small to be absolute screen rows within the empirically-verified 160-199 status-panel band (`UNKNOWN_playfield_height`, above). Disassembling graphics export 21's own body in `VGA.EXE` (`ndisasm`, offset+0x200 per this document's established file↔memory formula) shows its destination is computed as `(X>>3) + Y*44` — the exact mode-0Dh 44-byte scanline pitch this document already documents — with **no** addition of the `SS:0x40A` UI-context variable also seen written around the main loop (a real variable used elsewhere for gameplay/hiscore/password screen Y-origins, but not the mechanism here). The arithmetic itself does not resolve which VGA page or offset `0xacde`/`0xad4c` denote — `0xacde*16` and `0xad4c*16` are not whole multiples of 44 scanlines above either documented page base (`0xa000:0`/`0xa226:0`), so the ES segment is not simply "a page base plus 160 rows" in any form this document can derive from the two known pages alone; it differs from `0xad4c` by exactly 40 rows (1760 bytes), a relationship whose origin was not chased further.

**Rather than push the arithmetic further, the +160 offset was verified the cheaper way the project's own precedent (the ladder-clipping and jump-ceiling fixes) already establishes: driven live in the browser port and looked at.** With `hp=5/24` and `lives=2`, money/score at 0, the rendered frame shows: (1) the lives digit "02" at native pixel `(66, 169)` — exactly `LIVES_X` and `STATUS_PANEL_Y0(160)+LIVES_Y_LOCAL(9)` — sitting correctly inside the portrait-frame art, not in the playfield; (2) the health-bar cage at native X=15 showing a mostly-empty trough with a small filled patch near the bottom, matching `E=(24-5)>>1=9` (10 empty rows on top, 4 filled rows at the bottom) exactly; (3) eight identical "0" digit glyphs in a row at the score's Y (`160+5=165`) and six at money's Y (`160+0x11=177`), 12 native pixels apart as predicted, right-anchored at the same X — matching `SCORE_DIGITS=8`/`MONEY_DIGITS=6` exactly. All three elements land in the correct screen band, in the correct relative positions, with correct proportions for the live game state, with zero special-casing in the renderer. This does not prove the original's own `0xacde`/`0xad4c` segment arithmetic (that remains genuinely `UNKNOWN_status_panel_es_segment`), but it does confirm the port's own model of the mechanism — `STATUS_PANEL_Y0=160` plus the panel-local Y read straight off the disassembly — produces the correct on-screen result, which is the practically load-bearing question for this port.

**Backfill: the crouch/inventory panel is a SEPARATE HUD element near the top of the screen, not part of the bottom status band — a finding from prior, undocumented work in this project that was never written up here.** `gods-web/src/game/inventory-panel.js` (committed in `38464c7`, "Port the crouch/inventory panel's rendering pipeline") already fully implements `FUN_1000_1e1a`/`FUN_1000_1f5a`/`FUN_1000_1dd1`/`FUN_1000_1e06`/`FUN_1000_1ee3`, with citations this later pass independently re-derived byte-for-byte before discovering the port already had them — a process gap (real RE findings existing only in port code comments, never reaching this ledger) worth naming so a future session doesn't repeat the re-derivation. Summarized:

- **Called unconditionally every tick**, straight-line in `FUN_1000_006f`, regardless of player state — not a crouch-only popup:
  ```
  CS:0x02C0  call 0x1000:1f5a   ; commit pending slot-selector change (DS:0x367 -> DS:0x366)
  CS:0x02C3  call 0x1000:1e1a   ; draw the panel: 4 slot frames, then 4 held-item icons
  ```
- **Screen position — PANEL-LOCAL, not absolute.** ⚠️ **This bullet previously read "absolute, not panel-local … rows 3-20ish, near the top of the screen", and that is refuted on bytes.** `FUN_1000_1e1a` draws the 4 slot frames at `screenX0=0x60`(96), `screenY=3`, stepping 0x20(32)px per slot (sprite `0x74`, the highlighted slot `0x73`), then the 4 item icons 8px right and one row down (`screenY=4`), via export 2 — all of that stands. What was wrong is the frame those Y values are in. `CS:0x1E36 mov bx,0xad4c` / `CS:0x1E4B mov bx,0xacde` / `CS:0x1E78 mov word ptr [0x0],bx` retargets the shared destination-segment word `DS:[0x0]` to the **status-panel pages** before drawing (re-disassembled this session: bytes `bb4cad`, `bbdeac`, `891e0000`), which is the identical idiom the health bar (`CS:0x0eb5`), the digits, and the message line (`CS:0x4464`/`0x446B`/`0x448A`, see [`message-line.md`](message-line.md)) all use. So `CS:0x1E65`'s `[0x6] = 3` is panel-local and lands at **screen row 163**, inside the bottom 40-row band. The shipped `PSTAT3` art corroborates it: the four slot frames at x=96/128/160/192 sit at rows ~162-181 of the decoded panel image. `gods-web`'s `inventory-panel.js` was already drawing it panel-local (`drawInventoryPanel(..., STATUS_PANEL_Y0)`), so only this ledger was wrong — the same "findings live in port code but never reach the ledger" process gap named below, in the opposite direction.
- **The highlight is gated by a saturating counter/delta pair** (`DS:0x350` 0..12, `DS:0x352` ±1) with exactly three writers program-wide: `FUN_1000_1dd1` (EXTEND, armed once per CROUCH tick), `FUN_1000_1e06` (RETRACT, armed once per non-crouch tick via the player state-machine's own `CS:0x499A`/`0x49A7` dispatch gate), and `FUN_1000_1e1a`'s own unconditional per-call chase-step. Net effect: crouching advances the counter +1/tick; not crouching advances it −2/tick (RETRACT's own direct step plus the chase-step, both applying delta=−1 the same tick) until it saturates at 0.
- **The item icon, `FUN_1000_1ee3`**: looks up the slot's stamped sprite id (`170+type`) via the runtime object-descriptor array (`DS:0x2a4e`), remaps two special ids (`0x117`→`0xb7`, `0x118`→`0xcc` — the "magical gem"/"treasure chest" popup-only icons get a separate, smaller variant here rather than their own raised popup sprite), and vertically centers a variable-height icon against a nominal 16px band via `(16 - (h-1)) >> 1` (arithmetic shift).
- **NOT PORTED, disclosed**: `DS:0x33` bit 2's 4px shift and dirty-flag swap (moot for a full-redraw renderer); the FIRE-tap slot-selector cycle (`CS:0x612F`-`0x619D`, real trigger confirmed from bytes as a debounced FIRE-tap-while-crouching-over-no-key cycle, not up/down as an earlier design note guessed) — unported, so `selector` never leaves slot 0; `CS:0x61A1` (drop the selected slot's item on crouch exit) — already flagged unported elsewhere.

Both status-panel overlay modules (`game/health-bar.js`, `game/hud-digits.js`) and the inventory panel above are wired into `src/main.js` and covered by dedicated `checkHealthBar()`/`checkHudDigits()` functions in `src/verify/checks.js`.

**`UNKNOWN_export22_call_args` — largely CLOSED: the trailing three parameters are OUTPUT/chained state, threaded across multiple export-22 calls `[STATIC]`.** The clinching site is `FUN_1000_2882` (`CS:0x2882`–`0x28D7`), export 22's **first-ever caller** in the whole binary — called exactly once, from `entry` (`CS:0x006c`), i.e. unconditionally at `GAME.EXE` startup, before any level or screen logic runs:

```
2897  push 0x1e00        ; [BP+8] — the descriptor-arena BASE (the same constant this
                          ;   document already ties to DS:0x0e and the weapon sprite index)
289d  push 0x0            ; [BP+6]
28a1  push 0x4300          ; [BP+4]
28a5  push 0x43e           ; [BP+2] — an output-pointer scratch, reused by later callers
28a9  push 0xe9a0          ; [BP+0] — the worklist pointer
28ac  call 0x1000:2342     ; export 22
28af  ax = [bp+0x4] -> [0x130] AND [0x12a]     ; the callee has REWRITTEN this stack slot
28b8  ax = [bp+0x6] -> [0x132] AND [0x12c]
28c1  ax = [bp+0x8] -> [0x134] AND [0x12e]
28d7  sub word [0x134], 0x8                     ; back off one descriptor stride
```

`DS:0xe9a0` reads (via `read_memory`) as `"always\0\0shop.pi1\0lev?*.map\0…"` — a one-entry, double-NUL-terminated worklist naming only the **`always`** group, the atlas this document already establishes as sprite indices 0–169, loaded first. So `FUN_1000_2882` is the startup **`always`-group loader**, and the three trailing pushed words are not fixed literals consumed once — they are **output parameters export 22 overwrites through the caller's own stack frame** (read back from the identical `[bp+n]` slots after the call returns) and then **persisted to `DS:0x130`/`0x132`/`0x134`** (each duplicated to a second home three bytes later, `0x12a`/`0x12c`/`0x12e` — a "committed" copy alongside a "current" one). `CS:0x28D7`'s `sub word[0x134],8` backs the returned arena pointer off by one 8-byte descriptor stride, plausibly converting an export-22 "one past the last descriptor written" return into "the last descriptor's own address," ready to hand to the *next* group load as its own starting base.

**That chaining is exactly what `FUN_1000_3506`'s own export-22 call does** (documented above): instead of literal seeds, it pushes the *live* `DS:0x134`/`0x132`/`0x130` — i.e. it continues the arena bookkeeping `FUN_1000_2882` started at boot, appending the `smallfnt` group onto whatever the `always` group (and, via `FUN_1000_2a37`'s own write to `DS:0x134` at `CS:0x2BC0`, presumably further per-level groups too) already claimed. This is the machine-level mechanism behind this document's and the port's own already-established "cumulative descriptor index across groups" model (`GROUP_STEMS`/`buildDescriptorMap` in `gods-web`) — confirmed here as real running state threaded through export 22's calling convention, not just an offline indexing convenience. `UNKNOWN_export22_0x4300_role` — the second trailing parameter (seeded `0x4300`, plausibly a destination segment or an arena byte-limit) and `SS:0x414`/`DS:0x43e`'s own exact roles remain untraced past this pattern.

**The consumer.** Not found by the direct-operand searches this document's own ranked item implicitly invited (`[0x88]`/`[0x86]` dereferences, checked exhaustively across all 12 non-PKLITE-packed shipped executables with zero hits) — because nothing ever addresses it that way. `GAME.EXE` instead **preloads a register**. Five sites in the image reach `call 0x3596` with `si` freshly set to `0x86`:

```
CS:0x1269C / 0x12CD4 / 0x12EEB / 0x132DE / 0x164BF:
    mov si,0x86
    mov ax,0x1
    call 0x3596
```

`CS:0x3596` is the graphics-export-9 thunk (`mov bp,0x5276` → `(0x5276−0x5252)/4 = 9`, `call far [bp+0]`) — export 9 is already in this document's own driver-export table as **"palette fade-in"** (`VGA:0x0FAA`).

⚠️ **The fifth site is not literally identical to the other four.** `CS:0x164BF`/`0x164C2` set up `si`/`ax` the same way, but the `call 0x3596` itself is bracketed by `push word [0x42]` / `mov byte [0x42],0x0` before it and `pop word [0x42]` after — forcing the byte this document elsewhere identifies as the current **world** number to `0` for the duration of the call, then restoring it. Export 9's own body never reads `DS:0x42`, so the reason for the bracket is not established here.

**`UNKNOWN_export9_world_zero_bracket` — partly closed: identifies the whole screen this fade belongs to, but not the reason for forcing world `0` `[STATIC]`**

⚠️ **A note on this session's own address citations, since it tripped up the tool calls needed to chase this down:** this document's `CS:0xNNNNN` addresses, when they run past four hex digits (`> 0xFFFF`), are the **linear address** (`segment*16 + offset`, matching the file-offset formula this document already establishes elsewhere), not a literal `segment:offset` pair — `CS:0x164BF` means offset `0x64BF` within `CS=0x1000` (linear `0x10000 + 0x64BF = 0x164BF`), confirmed by cross-checking against the already-verified `CS:0x125A8` unpack-entry call site, which resolves cleanly to `1000:25A8` and disassembles to exactly the documented `CALLF 0x40EC:0000`.

`CS:0x164BF` (`= 1000:64BF`) sits inside **`FUN_1000_648b`**, a previously undocumented, complete function — this document's own already-established `FUN_1000_3506` caller list names it only as an address, with no description. Read in full, it is the **"LOADING" screen shown at each level (re)load**:

```
648b  call 0x1000:359d (ax=2)     ; export 15, clear page
6492  call 0x1000:3506             ; refresh the status-panel backdrop + load smallfnt (this document's own closure)
6495  [0x33] = 0                   ; a flag clear, not chased further
649a  si = 0xebf1 ; [0x389] = 0x46 ; call 0x1000:646f   ; draw "LOADING" (DS:0xebf1), CENTERED
64a5  al = [0x42] - 1 ; cbw ; ax*=2 ; si = 0xeb5a + ax ; si = word[si]
                                    ; -> this document's own already-documented 4-world-name table
                                    ;    (THE CITY / THE TEMPLE / THE LABYRINTH / THE UNDERWORLD)
64b4  [0x389] = 0x64(100) ; call 0x1000:646f            ; draw the CURRENT WORLD's own name, CENTERED
64bc  call 0x1000:35a8              ; graphics EXPORT 13 — frame sync + hardware page flip (commits the drawn text)
64bf  si=0x86 ; ax=1 ; push[0x42] ; [0x42]=0 ; call 0x1000:3596 ; pop[0x42]
                                    ; -> export 9, fade IN — revealing the freshly-composed screen
```

`CS:0x1000:646F` (the routine both text draws share) is a **centering** helper: it walks the ASCIIZ string at `SI` to measure its length, computes `AX = 0xA0 − (length-derived value)` (`0xA0 = 160`, half the 320px screen width), and calls `CS:0x224E` (a text-draw routine using this document's own universal `{[0x4],[0x6],[0x8]}` draw-call convention, `BX=[0x389]` selecting the font/message-id base) — so both `"LOADING"` and the world's own name are drawn horizontally centered. `DS:0xebf1` reads directly as `"LOADING\0COMPLETED\0BONUS\0…"` — a small pool of level-transition captions this document had not previously located.

So the whole picture is now clear: this is the level-loading title card — clear the screen, draw `"LOADING"` then the destination world's own name (both centered), flip the page to show it, then fade up from black to reveal it. **What remains open is only the narrow original question**: *why* the world byte is forced to `0` for the duration of just this one fade-in and not the analogous fade calls elsewhere. Export 9's own body still never reads `DS:0x42` (confirmed again on this pass), and the sequence has no fade-*out* of its own to compare against (the preceding `CS:0x35A8` is graphics **export 13**, frame-sync-and-flip, not a fade) — so the bracket cannot be explained by anything inside this function or inside the driver call it wraps. The remaining candidate explanation — some other, unidentified per-frame process reading `DS:0x42` during the fade's own multi-vsync wait loop — was not chased further; that would need a live breakpoint during an actual level-load fade, not static reading.

**Traced into `VGA.EXE`, and re-traced on this pass with the loose ends closed.** Export 9 runs a **fixed 8-pass** fade-blend — `ax` is seeded to `0x8` and decremented to `0`, not a "16-step" loop as an earlier revision of this section had it. **16 is the per-pass color count**, not the step count: each of the 8 passes walks all 16 palette slots (`bx = 0xf` down to `0`) via `call 0x107e`/`0x106c`, nudging a **working buffer at `DS:0x12`** one nibble-unit closer to the target on each of its three 3-bit channels (masks `0x7`/`0x70`/`0x700`, one `inc`/`add` per channel per pass) — so a channel with a delta of up to 7 fully converges within the 8 passes. The per-pass target read, `mov dx,[bx+si]` at `VGA:0x0FC0`, is a bare, unswapped load against `si = 0x86` — which only produces the correct comparison because `DS:0x86` is pre-swapped native, exactly the correction above.

After each pass, `VGA:0x0FFB` calls `VGA:0x1F6A` to push the updated `DS:0x12` buffer to hardware, then waits `cx = AX_param + 2` repetitions of `[export 5 (`0x1F37`) + a vsync poll (`0x108e`, port `0x3DA` bit 3)]` before the next pass. **This closes `UNKNOWN_export9_ax_param`: the `AX` parameter is a fade-speed knob** — the number of retrace waits between each of the 8 fixed steps. All five `GAME.EXE` call sites pass `AX=1`, giving `cx=3`.

⚠️ **The bigger correction: `VGA:0x1F6A` does NOT read "the caller's own SI."** Its first instruction is `mov si,0x12` — unconditional, executed before the `cmp byte [0x35],0` branch — which clobbers whatever `si` the caller (export 9, still holding `0x86`) had set. So **both** branches operate on the same source, `DS:0x12`, not on `GAME.EXE`'s `DS:0x86` table directly:

```
VGA:0x1F6A  mov si,0x12                          ; clobbers the caller's si — BOTH branches read DS:0x12 from here on
VGA:0x1F6F  cmp byte [0x35],0x0 / jz 0x1f78 / jmp 0x1fdb
  [0x35]==0 -> 0x1F78  16x  INT 10h AX=0x1000     ; one hardware palette register at a time, from DS:0x12
  [0x35]!=0 -> 0x1FDB  vsync-wait, then:
VGA:0x1FED    lodsw              ; from DS:0x12 — the WORKING buffer, not GAME.EXE's DS:0x86
VGA:0x1FEE    xchg al,ah         ; byte-swap: DS:0x12 IS genuinely swapped storage, unlike DS:0x86
VGA:0x1FF0..0x2011               ; nibble-split R/G/B, rescale 3-bit -> 6-bit via call 0x203d
VGA:0x2014..0x201F               ; write the converted triple to CS:0x66
...
VGA:0x2032    mov ax,0x1012 / mov dx,0x66 (ES:=CS) / mov cx,0x10 / mov bx,0
VGA:0x2035    int 0x10                            ; the DAC load this document already records
```

**This closes the second loose end too** ("what the hardcoded-`DS:0x12` alternate path... is for"): `DS:0x35` does not pick between two data sources — it picks between two **DAC-write methods** for the same `DS:0x12` buffer, one `INT 10h AX=0x1000` call per colour versus one block `INT 10h AX=0x1012` call. A third caller of `VGA:0x1F6A` confirms `DS:0x12` is a generic staging buffer, not specific to export 9: **export 7** ("palette blank", `VGA:0x1F44`) zeroes all 16 hardware registers directly, then separately zeroes `DS:0x12` (`mov di,0x12 / mov cx,0x10 / xor ax,ax / rep stosw`) and falls straight into `0x1F6A` — the same "push `DS:0x12` to hardware" tail shared by blank (7), fade-out (8, `0x1017`, the mirror-image `dec`/`sub` ratchet) and fade-in (9).

So the corrected chain: `GAME.EXE`'s `DS:0x86` table feeds the ratchet TARGET inside export 9's own ­loop (consumed via the caller's `si` before `0x1F6A` is ever called); the value actually pushed to the DAC on every pass is the intermediate `DS:0x12` working buffer, which only equals `DS:0x86` once the 8 passes have converged. `DS:0x86` never reaches the DAC directly. Tag stays `[STATIC]`, not `[PROVEN]`: nothing here was watched executing live (DOSBox was deliberately not used this pass), and the `[0x35] != 0` branch condition — true at every point past graphics init on the evidence gathered (its sole writer is `VGA:0x0F26`, inside export 12/INIT) — was not itself confirmed live.

### Sound: a 13-slot interface, and the drivers are shims

- **Indices 0–5** are a common core implemented by all four drivers; **indices 6–12 are music control implemented only by `ROL.EXE`** and are a bare `RETF` (`0xCB`) in `ADL`/`TDY`/`BPR`.
- All four program **PIT channel 0 to 60.001 Hz but call the music player on only 5 of every 6 ticks → 50.0 Hz** — the Atari ST / PAL frame rate reproduced on PC hardware. A port that runs the music at 60 Hz will play everything ~20% too fast.
- ⚠️ **50 Hz is the MUSIC rate only — game logic runs at 15 Hz.** See *Frame pacing* below. Conflating the two is an easy and costly mistake.
- **The drivers are thin shims; the synthesis lives elsewhere.** All of it is reached through the far pointer at `DS:0x00F6`, which `GAME.EXE` sets to `666B:0000` at `1000:29DF`. `PPLAYER.BIN` is a 13-function `AH`-dispatched multi-device engine (OPL2 at `0x388`, Sound Blaster DSP at `0x22x`, MPU-401 at `0x330`) shared by ROL and AdLib; `PTANDY.BIN` and `PBEEPER.BIN` are the other two, both credited *"Sound Images (c) 1991"*.
- `UNKNOWN_sfx_id_space` — **mostly closed.** The id byte is **not** a clean cross-driver constant. `ADL`/`TDY`/`BPR` reject `AL >= 0x49`, but `ROL.EXE` has no such guard and `GAME.EXE` demonstrably emits id `0x49` (`mov ax,0x0e49` at `CS:0xABB7`/`0xABD1`). So `0x48` is only those three drivers' *acceptance window* — they silently drop sounds ROL plays. Bit-7 handling also differs three ways across the four.

  **This is not a hypothetical edge case — it has a concrete, identified trigger and audible consequence.** `0xABB7`/`0xABD1` are both inside `FUN_1000_a9e4` (the shared hero/creature contact-and-damage-grid-scan thunk), gated by `CMP byte[0x35e],0 / JNZ` at `CS:0xAB98`/`0xABC0` — but ⚠️ **these are two separate blocks with two DIFFERENT combine-vs-replace shapes, not one mechanism, and an earlier revision of this paragraph flattened them into one "instead" and got the audible consequence backwards for the more common of the two.** Read live off both blocks in Ghidra:
  - **`CS:0xAB98`, the DEATH branch** (reached from the weapon-vs-creature grid scan's kill path, `creatureScansGrid` in `gods-web`): `DS:0x35e==0` plays `0x0F22` alone (`0xABA0`→`0xABA3`); `DS:0x35e!=0` plays `0x0F22` **and then** `0x0E49` — two separate `call 0x22ca`s back to back (`0xABAF`→`0xABB2`, then `0xABB7`→`0xABBA`), not a replacement. So on Beeper/AdLib/Sound Blaster/Tandy — which reject `AL >= 0x49` — the death is **not silent**: `0x0F22` already played a moment earlier in the same call; only the *extra* Roland-only layer on top is missing.
  - **`CS:0xABC0`, the CONTACT branch** (reached from `CS:0xA9EC`'s `jmp 0xabc0` — a creature's touch on the hero was reported, `attackHero`/`creatureTouchesHero` in `gods-web`): `DS:0x35e==0` plays `0x0F22` then `RET`s (`0xABC8`→`0xABCB`→`0xABCF`); `DS:0x35e!=0` plays `0x0E49` **instead of** `0x0F22` — one call only (`0xABD1`→`0xABD4`), then the same `RET`. Here the "instead" framing is correct, and the audible consequence is real: on non-Roland drivers this specific event goes silent.

  `DS:0x35e` is bracketed nonzero around exactly **three** call sites into this shared contact routine, confirmed by an exhaustive operand search: `CS:0xE0A5`–`0xE0AD` inside `FUN_1000_e001` (System A's own per-entity pipeline, bracketing its `CALL 0xFF93`); `CS:0x7C8B`–`0x7C93` inside `FUN_1000_7c7c` (a 32×32 hit-box + contact-scan wrapper reached from `FUN_1000_7b68`, itself called from the main loop at `CS:0x029A` — identified as the world-1-exclusive awakened-statue hazard, see *`UNKNOWN_8014_world1` — CLOSED*); and `CS:0xBCDF`–`0xBCE7` inside `FUN_1000_bccf`, called from `CS:0xBB40` inside `FUN_1000_b987` — the already-documented `PGOD0x.PAT` selector-1 per-tick driver. **System B's own contact call (`CS:0xEDF4`) never touches `DS:0x35e`.** So the corrected practical effect: a System-A creature, a `PGOD0x.PAT`-spawned object, or the world-1 statue hazard that **touches the hero** during one of these three brackets plays its contact sound only under Roland (silent elsewhere); the SAME creature types **killed by a weapon** during a bracket are audible everywhere, just missing the extra Roland-only layer. System-B kills and every other use of the ordinary sound are audible everywhere regardless.

  `gods-web` ports the id these two blocks share (`combat.js`'s `KILL_SFX = 0x0f22`, fired from both `attackHero`'s reported-hit branch and `creatureScansGrid`'s death branch) but does not model `DS:0x35e` or the Roland-only `0x0e49` layer/replacement at all — every kill and every reported touch plays the same one id, matching what every non-Roland driver actually produces.

**What `gods-web` ports of this, as of the #11 SFX pass (`audio/audio-bus.js`):** the DISPATCH mechanism above (which id, which game event) is now genuinely exercised — the port's own `ctx.sfx` callback slot and half a dozen already-cited SFX ids (shop buy confirm, weapon/treasure pickup, chest unlock, lever toggle, starburst spawn, the seven trigger-action verbs, hero death, the tally "cha-ching") all reach a real Web Audio backend. What is NOT attempted, and is a scope decision rather than a gap in this RE: the actual PER-ID SYNTHESIS. Nobody has decoded what any individual id sounds like through OPL2/SB/Beeper/Tandy — there is no decoded command stream for any of them, and the DOSBox MCP bridge this project uses has no audio-capture tool to extract one live (only `video_capture_start`/`record_start`, neither of which touches audio). So `SFX_VOICES` in that module is a STYLIZED reproduction keyed by the real ids, not a chip-accurate one; closing that gap for real would need either a genuine OPL2/SB emulator fed PPLAYER.BIN's actual command stream, or an external audio-capture tool this project does not currently have. Music (the SMF-extraction path below) is now built too, as of a follow-up session — see that section's own "What `gods-web` ports" note for what changed and why the user's original "General MIDI/soundfont" steer was overridden by a fresh conflict this project's own asset-sourcing convention surfaced.

⚠️ **A still-later session closed the biggest hole this list had: the combat-sound family itself was entirely unwired**, reported as "no sound when hitting an enemy." That investigation is what produced the `CS:0xAB98`/`0xABC0` disassembly and the "instead" correction two paragraphs above — the real answer being that a weapon hit which only damages (never kills) a creature is genuinely silent in the original, so the fix was wiring the KILL sound, not inventing a per-hit one. Also found and fixed in the same pass: `projectiles.js`'s `FIRE_SFX` had been exported as the bare low byte `0x1c` since this port's very first commit, which never matched any `SFX_VOICES` key and so played nothing the moment it was ever wired — corrected to the full word `0x041c` actually passed to `CS:0x22ca`.

### Music formats `[PROVEN]` — `.MUS` and `.RL` are containers of Standard MIDI Files

Both extensions share one container:

```
u16 LE  count
count × u32 LE  absolute offset
u16     pad (80 00)
        ... concatenated blobs ...
```

Verified on `PGODS.MUS` (73 entries, offsets strictly increasing, last extent ending at exactly 21169 = the decompressed length), `PMUSIC.MUS`, `PGODMUS2.MUS`, `PGODSRLA.RL` (63 entries) and `PTITLE.RL`.

**70 of `PGODS.MUS`'s 73 blobs are complete Standard MIDI Files** — `MThd`, format 0, 1 track, division `0x01A4` (420) — with the **OPL instrument definitions carried inline as `FF 7F` sequencer-specific meta events**. That means the music is extractable to `.mid` with essentially no work.

The **3 non-SMF blobs (19, 20, 40)** are exactly the three records in `ADL.EXE`'s 73-entry SFX table whose voice-count byte is 9 — i.e. the nine-voice music tracks. Their real structure (the earlier "count + ascending key table" guess is refuted) is decoded below under `UNKNOWN_mus_type2`.

### Which files `GAME.EXE` actually opens for music `[PROVEN]` — and `UNKNOWN_pgods_mus_cue_dispatch`, a new open item

Of the eleven shipped `.MUS`/`.RL` files, `GAME.EXE` itself opens exactly **one**: a raw byte regex scan of `GAME.EXE` for the case-insensitive token `godsrl` returns zero matches, and the ONLY music-related string literals anywhere in the binary are `gods.mus` (`1ffd:00de`, i.e. `DS:0x00de` — Table 1, the short-name block) and `pgods.mus` (`2f3d:58b1`, i.e. `SS:0x58b1` — Table 2, the full disk filename). `get_xrefs_to` on `1ffd:00de` returns zero hits, but that is expected, not a dead end: this project's own map-format-and-filenames.md already documents that Table 1 entries are walked by INDEX, not referenced by a `mov dx,imm16` immediate the way most other filename loads in this binary are, so no direct xref will ever show up for one.

**The other ten files belong elsewhere, confirmed the same way:**
- `PMUSIC.MUS`/`PGODMUS2.MUS`/`PTITLE.RL` are the AdLib/Sound-Blaster/Roland INTRO music tracks (`execution-and-boot.md`'s own intro sound-file table) — `INTROV/E/T.EXE`'s own music, opened before `GAME.EXE` ever runs and gone by the time it does.
- `PGODSRLA.RL`–`PGODSRLG.RL` (7 files) are referenced by **nothing this project has found anywhere** — the same zero-match `godsrl` scan against `TGAME.EXE` (the Tandy variant, 99.92% code-identical to `GAME.EXE`) also comes back empty. This CLOSES the question of whether they're gameplay-per-level music: they aren't loaded by any traced code path in either binary. All seven share one container shape (checked this session, extending drivers-and-memory.md's own prior check of `PGODSRLA` alone to all seven): 63 blobs apiece, exactly one non-SMF (`mus_type2`) blob in each, always at the SAME index — 21. Re-derived programmatically in `gods-web`'s own `checkMusic()` for `PGODSRLA.RL` specifically (staged for exactly this purpose, since `GAME.EXE` never loads it for real play); the other six were checked once by direct Python analysis of the raw shipped bytes, not re-run by that tool.

**So `PGODS.MUS` is the one file worth parsing for actual gameplay music** — and this session found more about it than the container/SMF format above: **all 70 real SMF blobs are format 0, exactly 1 track, division 420, with EXACTLY one Set-Tempo meta event apiece**, checked exhaustively (every blob, not a sample) via a full Python walk of the decompressed bytes, then independently re-confirmed by `gods-web`'s own from-scratch JS parser reading the identical bytes. One genuine quirk found along the way, consistent in all 70 blobs with zero exceptions: **each blob's own `MTrk` chunk declares a length exactly 4 bytes SHORT of its real content** — the trailing `00 FF 2F 00` (a zero delta-time, then the End-of-Track meta event) sits just past the declared boundary every single time. A real authoring quirk in whatever tool produced these files, not a parser bug; `gods-web`'s parser trusts the actual `FF 2F` terminator over the chunk's own declared length for exactly this reason.

**`UNKNOWN_pgods_mus_cue_dispatch` — a NEW open item, not closed by this session.** `PGODS.MUS` has 73 blobs (70 real SMF tracks); which one plays at which in-game moment — level start, a specific world's theme, a stinger — is unestablished. No code path selecting a blob index by number was found or searched for beyond confirming the file's own two Table 1/2 string entries; closing this would need tracing the caller(s) of whatever function actually reads `gods.mus`'s Table-1 entry and picks a blob, the same kind of dispatch-tracing this document already did for the SFX id space above. `gods-web`'s own port (see the port note below) does not guess at this mapping.

**What `gods-web` ports of this:** `game/audio/mus-container.js` (the container parser, extended to read `PGODS.MUS` specifically, with the full citation trail above) and `game/audio/smf-parser.js` (a general SMF reader — VLQ deltas, running status, meta events, tempo map — written to the real grammar rather than hardcoded to the degenerate case, even though every real blob here reduces to it) are both exhaustively re-derived in `gods-web`'s own Node test suite against the real shipped bytes (73 blobs, 70 SMF, the 3 known non-SMF indices, format/division/tempo-count on all 70, a real note count). Playback (`game/audio/music-player.js`) uses a browser-only `AudioContext`-lookahead scheduler — deliberately NOT the 15 Hz `Clock` (its own header already warns the 50 Hz music clock "must not be driven from" it, and this session directly measured the render loop stalling entirely, FPS stuck, in an automated Chrome tab) — driving a small set of built-in oscillator voices, one per MIDI channel. **The user's own original steer for this (asked earlier, "Soundfont/GM") was overridden once a real conflict surfaced**: a General MIDI soundfont is a multi-megabyte third-party binary asset, and it would be the FIRST asset anywhere in this port that isn't derived from GODS's own shipped bytes (`copy-assets.mjs`'s own header states that rule explicitly). Asked again with that conflict made concrete, the user chose the built-in synth instead — so playback is a stylized, from-scratch reproduction of the real extracted notes, not chip-accurate and not GM-instrument-accurate, in the same disclosed-simplification spirit as `audio-bus.js`'s SFX voices. Since `UNKNOWN_pgods_mus_cue_dispatch` is open, `gods-web` does not attempt any level/event music mapping: `main.js` exposes all 70 real tracks through a dev-only picker (the same disclosed-affordance spirit as its own pre-existing weapon picker, "a CHEAT rather than the only way to arm"), asserting no in-game placement for any of them.

### `UNKNOWN_mus_type2` — container AND event payload decoded; PPLAYER.BIN's parser read `[mixed — see inline tags]`

**The container shape is `[PROVEN]`** — decompressed `PGODS.MUS`/`PGODMUS2.MUS`/`PMUSIC.MUS` and read the resulting bytes directly. The earlier guess (byte count + ascending `u16` LE key table + bulk data) is confirmed refuted, but a real structure replaces it, established across **four** independent non-SMF blobs, not just the three originally named: `PGODS.MUS` indices 19/20/40 (confirmed non-SMF — none begin `MThd`; the other 70/73 blobs do) *and* `PGODMUS2.MUS`'s own single blob (its container has `count=1`; that lone blob is non-SMF too, opening `43 00 00 01 00 02…` — tag byte `0x43` where `PGODS.MUS`'s three use `0x63`, differing by bit 5, cause `UNKNOWN`). `PMUSIC.MUS` by contrast is a plain single-blob SMF (`MThd` at its own blob offset) — not every lone-blob `.MUS` uses this container.

**Layout, `[PROVEN]` byte-for-byte on all four blobs:** byte 0 is a 1-byte tag; bytes `[1,19)` are 9 ascending `u16` LE values `0,1,…,8`, byte-identical across all four; bytes `[19,X)` continue as ascending `u16` LE pairs for a track-length-dependent run (152/222/104/213 pairs for blob19/20/40/PGODMUS2, each an exhaustive first-violation scan); the run is followed by zero padding, and **the padding ends at the identical absolute offset 513 (`0x201`) in all four blobs** despite padding lengths of 208/68/304/86 bytes and total blob lengths of 1090/1313/1090/19346 — the one test that discriminates a hardcoded constant from a three-sample coincidence, run against a fourth, structurally unrelated sample, and it holds exactly. Bytes `[1,513)` — exactly 512 bytes — read as a fixed-capacity reserved region.

For the three `PGODS.MUS` blobs specifically (not found in this shape immediately following offset 513 in `PGODMUS2`'s blob), byte 513 opens a 22-byte mini-header (bytes `[513,535)`: `XX YY 0F 00 06 00 1C ZZ WW 11 20 10` then two 5-byte `[V1] 06 [V2] TAG VAL` records — only bytes at relative offset 3–5 (`00 06 00`) are confirmed constant across all three), followed at blob-relative offset **`0x217` (535), byte-identical in all three**, by a literal **9-record × 19-byte table**, one record per OPL2 channel — plausible given OPL2's fixed 9 FM channels and consistent with this document's own separately-established finding that the `FF 7F` OPL instrument metas carry "voice index 0–8." Format `[V1] 0A [V2] TAG CH <14 bytes>`, with `CH` running `0x00..0x08` in order. In blob19/blob40 the trailing 14 bytes are identical across all 9 channels; in blob20 they split into two groups — channels 0–5 share one 14-byte tail, 6–8 a different one, differing at scattered positions (0,1,2,3,8,9,10 of 14) rather than a contiguous run, arguing against a simple "two OPL operator register blocks" reading. Cause of the split: `UNKNOWN`. After the table (blob offset 706=`0x2C2`), the remaining 384/607 bytes of blob19-40/blob20 continue the same ascending-pair texture with no further fixed-stride record found — format `UNKNOWN`.

**Cross-referenced against `ADL.EXE` — a clean negative result, `[STATIC]` (disassembly only).** `ADL:0x184-0x19C` (`mov bp,0x394` then `sub ah,ah / and al,0x7f / add bp,ax / add ax,ax / add bp,ax`) derives `bp = 0x394 + 3*(AL&0x7F)` into a **73-record, 3-byte-stride table at `ADL:0x394`** (file `0x594`), immediately abutting the driver's own `0x470` handler-pointer table (`0x394 + 3*73 = 0x46F`). Reading the table directly (re-confirmed by direct byte read against the shipped `ADL.EXE`): record byte+0 ("voice count") is `9` at file offsets `0x5CD`/`0x5D0`/`0x60C` — **indices 19, 20, 40 and only those**, out of 73 (all 70 others are 1–6) — self-consistent with the driver's own `cmp al,0x49 / jnl` rejection at `ADL:0x17D` (`0x49` = 73 = exactly the table width). But byte+1 (`ADL:0x19E cmp byte [cs:bp+1],0 / jz 0x1b9`, else index a word table at `ADL:0x470` and `call` it) is `0x00` for all three voice-count-9 records — the same value held by 63 of the table's 73 records — so the special-handler axis is orthogonal to voice count. Byte+0 is consumed only as the trip count of a real-time OPL-channel-search loop (`ADL:0x1BF mov dl,[0xa8]` sets the bound; `ADL:0x1E0 cmp cl,[cs:bp+0]` stops the search once satisfied) when a note is triggered at runtime, not when the file is loaded — this one call path never touches the `.MUS` container's own byte offsets. Consistent with this document's existing "the drivers are thin shims; the synthesis lives elsewhere" finding: the actual container parser is believed to live in `PPLAYER.BIN` (present, DCL-compressed, `00 06…` header, 6957 bytes). ~~confirmed to exist but not decompressed or disassembled~~ — **it now has been**, see below.

### The event payload — `PPLAYER.BIN`'s own parser, disassembled `[STATIC]`

`PPLAYER.BIN` decompresses (`blast.py`) to 11970 bytes (litflag=0, dict=6) and was imported into Ghidra as raw `x86:LE:16:Real Mode` (image base `0000:0000`), giving program `/PLAYER.BIN`. It is position-independent (`DS := CS` at entry) with a 13-entry `AH`-dispatched near-CALL jump table at file offset `0xD8` — matching this document's own "13-function `AH`-dispatched" claim for the sound driver interface exactly.

⚠️ **All addresses in this subsection are `PLAYER.BIN`-relative (`0000:XXXX`), i.e. offsets into the decompressed `.MUS`/`.RL` blob's own logical address space, not `GAME.EXE`/`CS:` addresses used everywhere else in this document.**

**`FUN_0000_12e8` is the shared byte-fetch primitive, and it is dual-mode — this is the key that unlocks the rest.** A flag byte at `[BP+0x8b]` (a caller-frame parameter, constant for one parse) selects between two behaviours:

```
12e8  TEST byte[BP+0x8b],0xff / JNZ 12f8
      ; flag SET -> direct mode
12ef  PUSH BX / ADD BX,[BP+0x8] / MOV AL,ES:[BX] / POP BX / RET
      ;   AL = literal byte at (blob_base + index)

12f8  ; flag CLEAR -> indexed mode
      MOV [0xb78],AH            ; stash caller's AH
      PUSH BX / SHR BX,1 / ADD BX,[BP+0x8]
1302  MOV AL,ES:[BX + 0x201]    ; V := table1[index >> 1],  table1 = blob+0x201
      XOR AH,AH / SHL AX,1
      MOV BX,[BP+0x8] / ADD BX,AX
1310  MOV AX,ES:[BX + 0x1]      ; word := table2[V],  table2 = blob+1, stride 2
      POP BX
      TEST BL,0x1 / JZ 131c
131a  MOV AL,AH                 ; index ODD  -> high byte of the word
131c  MOV AH,[0xb78] / RET      ; index EVEN -> low byte (kept from 1310's AL)
```

**`table1` (blob offset `0x201` = 513) and `table2` (blob offset `1`) are exactly the two byte ranges this document had already independently located by other means, and this is the first proof they are a matched lookup pair.** `table1` is the already-documented 22-byte mini-header + 9×19-byte per-channel table region; `table2` is the already-documented "9 ascending `u16` LE values `0..8`" prefix at blob offset `[1,19)`. Since `table2`'s 9 entries just hold the values `0..8` in order, `word := table2[V]` is `V` itself as a little-endian word (low byte = `V`, high byte = `0x00`) whenever `V ≤ 8` — so indexed-mode reduces to: **return the `table1` byte at `index>>1` when `index` is even, else return `0`.** `FUN_0000_12d0` is the same dual-mode read applied to a running cursor register (`DI`) instead of an explicit index (`BX`) — confirming flag=1 (direct) is what the ordinary byte-stream reads use, and flag=0 (indexed) is specific to these four non-SMF blobs.

**`FUN_0000_1254` is a standard MIDI variable-length quantity (VLQ) decoder**, fetched through `FUN_0000_12e8`: read a byte, mask off bit 7, and if bit 7 was set, loop reading and folding in 7 more bits per byte (assembled via a 32-bit shift-and-OR built from a chained `RCR` across `AX`/`CX`/`DX`) until a byte with bit 7 clear. This is byte-for-byte the same base-128, MSB-continuation shape as real SMF delta-times — evidence in itself that this format is SMF-derived even without an `MThd` header.

**`FUN_0000_0d96` is the top-level event dispatcher.** It loads a stream-cursor struct from `[BP+6]` (`DI := [ [BP+6] ]`, the current position) and reads the byte at the cursor via `FUN_0000_12d0`, then cascades three equality tests against it (re-reading the *same*, unadvanced byte each time — not three different bytes):

| type byte | meaning | matches real SMF |
|---|---|---|
| `0x2F` | end of track — writes a sentinel via `[BP+0xc]`, decrements the cursor | **`FF 2F 00`**, SMF's own End-of-Track meta type |
| `0x51` | set tempo — reads a 3-byte value via 3× `FUN_0000_12d0` (after a 2-byte skip), applies it via a call at `PLAYER.BIN:0x107a` | **`FF 51 03 <3 bytes>`**, SMF's own Set-Tempo meta event, byte-for-byte |
| `0x7F` | validated 5-byte micro-record at the cursor: positions `+0`/`+1` must be nonzero, **position `+2` must read exactly `0x3F`**, positions `+3`/`+4` form a 16-bit `TAG`; dispatches to `FUN_0000_0e33(TAG)` | **`FF 7F`**, SMF's own Sequencer-Specific meta type — the exact type this document already established carries the *SMF* blobs' inline OPL instrument data |
| anything else | generic skip: `cursor += 1` (past the type byte), decode a VLQ via `FUN_0000_1254` and treat it as a **length**, `cursor += length` | `FF <type> <VLQ length> <data>` — SMF meta-event shape with the leading `FF` implicit |

So the non-SMF blobs' event stream is a **compressed re-encoding of SMF meta-event syntax** — the same three meta-event type bytes this project's SMF work already knows (`2F`/`51`/`7F`), plus a fully generic `type + VLQ-length + skip` fallback for anything unrecognised, with every byte fetched through the indexed accessor above instead of literal memory.

**`FUN_0000_0e33` is the `0x7F` (Sequencer-Specific) body**, dispatching on the `TAG` word from the validated micro-record: `TAG==1` copies 28 bytes (`CX=0x1c`) from the cursor into a work buffer at `PLAYER.BIN:0xb1a` via `FUN_0000_12b8`, reads one more indexed byte, adds a per-call bias `[BP+0x8a]`, and calls `PLAYER.BIN:0x1bd5`; `TAG==2` reads one indexed byte and calls `0x1ced`; `TAG==3` reads one indexed byte and calls `0x1ec4`. This is the non-SMF blobs' equivalent of the SMF blobs' inline `FF 7F` OPL-instrument meta events — split into three sub-record kinds rather than one uniform 34-byte AdLib-`.BNK` record, and the 28-byte work buffer is close to but not identical in size to the SMF side's 34-byte format. The three callee bodies (`0x1bd5`/`0x1ced`/`0x1ec4`) were not disassembled this pass.

**`FUN_0000_0e85` is a second, sibling dispatcher — a compressed re-implementation of MIDI's own channel-voice status-byte parsing**, found via `FUN_0000_12e8`'s caller list but not confirmed to be reached from `FUN_0000_0d96` itself (its own caller was not traced this pass — `UNKNOWN_mus_type2_e85_caller`). Given a status-like value in `AX`: `CX := AX`, then `AX := (AX >> 4) & 7` (the high nibble `0x8..0xF` masked to `0..7` — exactly MIDI's command nibble with bit 3 dropped: `0x8`=NoteOff, `0x9`=NoteOn, `0xA`=PolyAT, `0xB`=CC, `0xC`=PgmChange, `0xD`=ChanAT, `0xE`=PitchBend), `CX := (AX & 0xF) + [BP+0x8a]` (channel nibble plus a bias, guarded `< 0xB` — an 11-channel ceiling). Branches:

- command 0 (NoteOff): calls `0x19bb(channel)`.
- command 1 (NoteOn): reads indexed bytes at cursor `+1` then `+0` (note, then velocity-ish byte) and calls `0xf4c(note, velocity, channel)`.
- command 2 (PolyAT) / command 5 (ChanAT): read one indexed byte, run it through a helper at `0x1b47`, and store the result into a per-channel runtime word table at `PLAYER.BIN:0xb52` (stride 2, matching the `< 0xB` = 11-channel guard exactly: `11×2 = 22` bytes).
- command 6 (PitchBend): reads indexed bytes at cursor `+1` and `+0`, assembles a 14-bit value (`AH:=hi>>1`, OR in `lo`), calls `0x1af0(channel, value)`.
- commands 3/4/7 (CC, ProgramChange, System): **no dedicated handling at all** — fall straight through to the shared exit.

**The shared exit (`0xf3b`) advances the cursor by a per-command byte count read from a fixed table at `PLAYER.BIN:0xb0c`** (`AX := word[0xb0c + cmd*2]`, `cursor += AX`), run unconditionally regardless of which branch fired. So Control Change and Program Change messages are recognised (their data-byte count is in the table, so the cursor still advances correctly) but their *content* is silently discarded — consistent with this document's existing finding that instrument/patch selection for this driver family is carried by the `FF 7F`-style meta events instead of real Program Change messages.

**What this closes.** The container's *event grammar* is now decoded to the instruction level: three meta-event types matching real SMF exactly (`2F`/`51`/`7F`), a generic VLQ-length-prefixed skip for anything else, and — via a probable sibling dispatcher — the full MIDI channel-voice command set with NoteOn/NoteOff/PitchBend/Aftertouch implemented and CC/ProgramChange present-but-ignored. The 512-byte reserved region and the `0x201`-based table are now proven to be the parser's own working tables (a byte-array-to-small-int mapping table plus its degenerate `0..8` identity table), not opaque payload. **Still open**, narrower than before: the exact semantics of the 9×19-byte per-channel table's 14 per-channel tail bytes (beyond "some kind of OPL2 voice/operator parameters, consistent with prior notes"), the blob20 channel-6–8 split, the three `0x7F`-body callees `0x1bd5`/`0x1ced`/`0x1ec4`, `FUN_0000_0e85`'s own caller, and the trailing 384/607 bytes after the channel table (which, given the VLQ/meta-event grammar just decoded, most plausibly *are* the actual note/tempo/instrument event stream this parser consumes tick-by-tick — but that was not traced byte-for-byte against the file's own trailing bytes this pass).

`UNKNOWN_mus_type2` narrows to those five residuals — down from the whole event-payload region being opaque.

(Incidental finding while reading `ADL.EXE`'s export table for this: it is **20 slots wide** — 6 real entries then 14 copies of a shared `RETF` stub at `ADL:0x2A` [file `0x22A`=`0xCB`] then a `0x0000` terminator — not the 13 this document elsewhere attributes to sound drivers. `ROL.EXE`'s own table has exactly 13 real entries + terminator, matching the existing claim; `TDY.EXE` and `BPR.EXE` both mirror `ADL.EXE`'s 20-slot shape (6 real + 14 identical stubs). `GAME.EXE`'s sound-export copy loop (`CS:0x29D1`) has **no fixed iteration count** — it copies driver offsets into `SS:0x52f6` until the *source* table's own word hits zero — so loading `ADL`/`TDY`/`BPR` copies 20 entries where `ROL` copies 13. Whether the extra 28 bytes land on harmless `SS` scratch space or something else is `UNKNOWN`; a separate question from the `.MUS` container format, flagged here rather than left as an unremarked aside.)

**`PGOD0x.PAT` is NOT an OPL patch bank** — that hypothesis is refuted. It is a 400-byte, 50-entry directory (8 bytes/entry) over a per-class scripted movement path — see `UNKNOWN_pat_payload` below, not audio. **Its loader is now found** — formerly `UNKNOWN_pat_owner`.

⚠️ **Correction to this document's earlier "{address, length}" description.** The `+0` field is *not* a stored address — it reads `4` or `5` on disk. The **loader overwrites it**: `1000:38a8` does `lea dx,[si+0x190]` (payload start = past the 400-byte directory), walks the entries, writes the running pointer into `[si]`, and advances `dx` by the length. Only the **length at `+6` (BE `u16`)** is real file data; `+0` is a placeholder patched at load time, and an entry whose `+0` is negative is skipped.

Verified independently on all four files: **`400 + Σlength == filesize` exactly** (5320 / 776 / 556 / 2818), with 38 / 6 / 1 / 22 live entries.

Load path: `1000:3855`, called from `1000:2b4a`, template `god0?.pat` with `?` ← `DS:0x42` ∈ {1..4} → `PGOD01`–`PGOD04` (all four ship). It is loaded **only on sublevel `'a'`** (`cmp byte [0x43],0 / jnz`).

### `UNKNOWN_pat_payload` — CLOSED: a per-class scripted movement path, not audio `[STATIC]`

The "8-bit PCM-like payload" framing was never verified and is refuted here. **The directory's `+2` field is a red herring, not garbage.** It forms a genuine, self-consistent running 32-bit big-endian byte offset — `entry[i+1].+2 == entry[i].+2 + entry[i].+6` holds exactly across every live run in all four files, including one real 16-bit carry into `+0` (`PGOD01`, entry 34→35: `0x0004fdd2 + 638 = 0x00050050`) — almost certainly a leftover master-table offset from the authoring tool (`PGOD02` and `PGOD04` even *start* their accumulators at the identical value `0x495c2`, despite being unrelated files). But `CS:0x38a8` loads it into `CX` (once, before the loop) and `AX` (every iteration) and **never stores or branches on either register** before the function's one `ret`: two dead reads of a value that is real, structured, and simply unused by the shipped loader.

**Two previously-undocumented consumers, both reached through `CS:0xb987`**, called every tick in normal play (the `DS:0x34==0` gate) from the main loop at `CS:0x0294` — right after `call 0x8b56`, the `DS:0xcfcc` hazard walker — and again from an identical loop variant at `CS:0x92db`. `CS:0xb987` walks the **already-documented selector-1 runtime table `DS:0xb6b8`** (5 slots, stride `0x1c` — its allocator `CS:0xb908` and its level-init clearer `CS:0x9026` both address exactly 5 records at that stride, and the allocator's spawn-write leaves `[slot+0x4]` at the exact bit pattern — `0x02` — the walker's own gate tests). For each active slot (`test byte [si+0x4],0x2`), a **class byte at `[si+0x7]`** indexes the PAT directory (`bp = SS:0x500 + class*8`) — this is the candidate consumer this document formerly listed as unverified near `1000:b9ae`; its trigger and `[si+0x7]`'s structure are now both resolved.

**On first activation** (`[si+0x4]` bit0 clear, `CS:0xb9a3`), up to 10 sub-records (20 B each, `DS:0xb744 + slot*0xc8 + sub*0x14`) are seeded from the class's blob. If the blob's first native word is literally **`0x4523`** (`CS:0xb9cb cmp ax,0x4523`) the position is `{blob+2, blob+4}` BE16, used as **absolute** world coordinates, and the cursor starts at `blob+6`; otherwise the position is `{blob+0, blob+2}` BE16, **added to the scroll origin `DS:0xa`/`0xc`** (screen-relative), and the cursor starts at `blob+4`. The blob's own end (`blob_ptr+length`, from the directory) is cached at `[si+0x2]`. The `0x4523` tag is real, shipped data, not a refuted guess: across all four files, 30 of 67 live blobs carry it (as the native little-endian byte pair `23 45`), always the *shorter* blobs where a file mixes both (`PGOD01`'s last 3 of 38, lengths 28–68 B; `PGOD02`'s last 4 of 6; `PGOD03`'s and `PGOD04`'s every blob).

**Every later tick** (`CS:0xba75`–`0xbaf7`), one byte is read at the sub-record's stored cursor, the cursor advances, and — unless it has passed the blob's cached end — the byte decodes as **two independent signed 4-bit deltas** via the standard `shl 4/cbw/sar 4` idiom for the low nibble and the equivalent `and 0xf0/cbw/sar 4` form for the high nibble: **low nibble → ΔY** (`CS:0xbacb`–`0xbae0`), **high nibble → ΔX** (`CS:0xbae2`–`0xbaf3`), each added to the running position. ⚠️ **Reaching the cursor's end does not always retire the sub-record.** `CS:0xba8d`–`0xbac4` first re-tests the entity's *screen* position against a 4-way box (X ∈ roughly `[-36, 324]`, Y ∈ roughly `[-40, 196]`): while still inside that box, the code backs the cursor off by one and keeps re-applying the **last** delta byte indefinitely (holding position/velocity), and only retires the sub-record (`[di+0xc]:=0`, `[si+0x16]:=0xFFFF`) once the object has scrolled outside it. Measured over all four files' streams (7542 nibble-pairs): range exactly **−7..+7 with zero occurrences of −8** — the asymmetric two's-complement extreme never appears, matching this project's other small, deliberately-symmetric delta tables (the hero jump arc, the enemy hop arc) rather than anything audio-shaped. The new position converts to screen space, is optionally appended to the **Hunter weapon's own homing-target list** (`DS:0x1d2`/`0x33c` — the same list `CS:0xaa8d` already documents for creature contacts), runs a width/height-gated call at `CS:0xbccf` (dims from a far pointer at `[si+0x10]`), and draws through a table at `DS:0xdf90` indexed by `[si+0xd]`.

**So `PGOD0x.PAT` defines, per class, a small scripted object**: a start position plus a byte-per-tick (15 Hz) delta-path that holds its last motion while still visible and retires only off-screen, spawned only on sublevel `'a'` through the selector-1 group system, targetable by the Hunter weapon, and drawn per-class. Measured against the one confirmed raw 8-bit PCM asset in the release, `PDEMOSB4.SB` (mean 127.76≈128, delta-SD 3.52, mean|Δ|=1.16, 43.6% zero-deltas — smooth, silence-biased, exactly what real digitized audio looks like), the PAT payload read as flat samples is 10–30× noisier (delta-SD 30–92, mean|Δ| 15–46, DC-bias unstable 57–184 blob-to-blob) and sits in the same regime as this release's confirmed *non-audio* structured data (`PGODFONT.PI1`'s raw bitplane bitmap, `PLEV1A.MAP`'s tile-index plane) — exactly what a nibble-packed coordinate stream produces, not sound. "PAT" most plausibly abbreviates **path**/**pattern**, not "patch."

`UNKNOWN_pat_class_fields` — `DS:0xb6b8`'s own layout beyond `+0x4` (state), `+0x7` (class) and `+0xa` (a "key" copied to the sub-record's `+0xc`) is unread: `+0xd` indexes the `DS:0xdf90` draw table (still untraced); calling `+0xb`/`+0xc` the source of the `CS:0xba95`–`0xbab2` cull constants (−36/324/−40/196) is still unverified. ⚠️ **The rest is now CLOSED**, resolved incidentally while chasing two of the enemy-shot emitter pairs (see *The five other emitter-pair owners* below): `+0xe`/`+0xf` and `+0x14`/`+0x15` are `class_table[cls]+4/+5` and `class_table[cls]+10/+11` respectively — copied verbatim from the class's own `handlerA`/`handlerB` words at spawn time (`CS:0xB964`–`0xB974`) and called as bare far-fn pointers every tick (`CS:0xBB2B`: `mov bp,[si+0xe] / call bp`; `CS:0xBB30`: `mov bp,[si+0x14] / call bp`). And `+0xb`/`+0xc` are exactly the **high and low nibble of the triggering PALFILS spawn record's own byte 6** (`CS:0xB941`/`0xB94C`, one byte, two nibbles, two destination bytes) — read every tick into `DS:0x232`/`DS:0x230` and consumed directly by the `[si+0x14]` handler as a facing-select flag and a fire-rate/reload divisor. See below for what those handlers turn out to be.


# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Evidence discipline.** This directory is a reverse-engineering target, not a source repo. Every claim below is tagged with how it was established. Do not add unverified claims — label unknowns `UNKNOWN_<identifier>` instead.
> `[PROVEN]` = verified by executing something (decompressed the bytes, ran the code, or traced it live under DOSBox).
> `[STATIC]` = read out of the binary (strings/disassembly) but **not** confirmed at runtime.
> `[WF]` = **produced by a subagent workflow and not yet re-read by the maintainer.** Plausible and adversarially reviewed, but nobody in this project has personally executed a check on it. That workflow's own error rate was demonstrably nonzero — fifteen of its findings were refuted on bytes by its own verifiers, and a histogram it reported was wrong. **Treat `[WF]` as a lead, not a fact, and promote it to `[PROVEN]` only by reading the bytes.**
> `[UNKNOWN]` = not established.
>
> **The DOSBox bridge is working** (mount `C:\Users\...\Gods`, launch with `gods`). The full launcher chain — `GODS.EXE` → `INTROV.EXE` → `GAME.EXE`, config parse, drive-check bypass, EXEC patching, overlay loads, first Table-2 asset open — has been traced live with `INT 21h` breakpoints and matches the static disassembly exactly, down to individual register values. See *Dynamic trace* below. The game renders and plays correctly through this path.

## What this is

A complete file dump of the DOS release of **GODS** (The Bitmap Brothers / Millennium Interactive, 1991/92) — raw floppy-disk contents, `GODS.INI` records "Version 1.0". 140 files, **no source code, build system, or tests**. There is nothing to build, lint, or test; treat all work here as software archaeology.

`READ.ME` (the game's own release notes) states SoundBlaster/Roland music and high-score/password saving work only when installed to hard disk, not from the low-density 3.5" floppy.

## The asset container: PKWARE DCL — the single most important fact `[PROVEN]`

**Every one of the 119 `P`-prefixed files is PKWARE Data Compression Library ("implode"/`blast`) compressed**, regardless of extension. The `P` prefix means **Packed** — it is not part of the logical asset name.

- All 119 begin with bytes `00 06` = DCL header (literal mode 0 = uncoded literals, dictionary size 6 = 4096 bytes).
- The only three asset files **without** the `P` prefix — `SINCOS.DAT`, `BEZIER.DAT`, `HISCORES.BIN` — are exactly the three that are **not** DCL-compressed. The correlation is perfect and is what proves the prefix convention.
- `UNPACK.EXE` embeds `PKWARE Data Compression Library(tm) Copyright 1990-91 PKWARE Inc. Version 1.02`, and `GAME.EXE` references the string `unpack.exe` at `1ffd:eb45`.
- Verified by decompressing all 119 with a port of zlib's `contrib/blast.c`: **119/119 succeed and consume the input exactly, zero trailing bytes.**

A working decompressor lives at `blast.py` (see *Tooling*). Anything reading these assets must DCL-decompress first.

**`GODS.INI` and `HISCORES.BIN` are mutable runtime state**, not shipped immutable assets — `INSTALL.EXE` writes the INI, and `GAME.EXE` has generic `AH=3Ch`/`AH=40h` helpers at `1000:2803`/`1000:2822` with no embedded filename. Any hash recorded for these two goes stale the moment the game runs.

> **Correction:** an earlier revision of this file claimed `.PI1` files were "native Atari ST DEGAS format" visible directly in the raw bytes. **That was wrong** — the on-disk bytes are DCL-compressed, and DEGAS PI1 is a fixed 32034 bytes whereas these files vary in size. DEGAS is the *decompressed payload*, not the file format. See below.

### Extension does not determine format

`.PI1`, `.DAT`, `.MAP`, `.RL`, `.PAT`, `.MUS`, `.BIN`, `.SB` and the extension-less numbered files all share the same `00 06` DCL wrapper. **Decompress first, then dispatch on content.**

## Decompressed asset formats

### `P*.PI1` → Atari ST DEGAS, low resolution `[PROVEN]`

Every `.PI1` decompresses to **exactly 32034 bytes** = 2-byte resolution word + 16 palette words + 32000 bytes bitmap. The resolution word is `0x0000` (low-res, 320×200, 4 bitplanes, 16 colours) in all 44 files.

⚠️ **Correction — the palette claim holds for only 32 of the 44 files.** An earlier revision of this document stated that *every* `.PI1` has `0x0RGB` palette words with all nibbles ≤ 7. Measured across the whole set, that splits perfectly and non-randomly:

| | files | palette words |
|---|---|---|
| Sprite / screen art | **32** | proper ST 3-bit, every nibble ≤ 7 |
| **`PBITS*` and `PXTRA*` tile sheets** | **12** | nibbles > 7, and the **high nibble set** in every one |

e.g. `PGODFONT.PI1` reads `0000 0343 0111 0122 0334 0444 0554 0777 …` while `PBITS1A.PI1` reads `0000 0000 0112 0223 033c 1c45 1d5e 3f7f …` and `PBITS4B.PI1` reads `f888 f888 f899 … ffff`.

So **a tile sheet's palette region is not a usable ST palette** and a port must take the level palette from elsewhere. `UNKNOWN_level_palette_source` — which file `GAME.EXE` loads for the in-game palette is not established from the binary, but there is now **behavioural evidence for `PLEVEL<N><X>.PI1`**: the hero's sprites render correctly when composited into a level under that palette, and the test is discriminating rather than vacuous — `PALWAYS1` and `PLEVEL1A` disagree on **7 of 16** entries and the hero's frames use **6 of those 7**. Under a wrong palette he would visibly break. Still short of proof (one level, one atlas, and "looks right" is a human judgement), so the `UNKNOWN_` stands — but it is no longer a blind choice. The project's validated level renders used `PLEVEL<N><X>.PI1` (per-level, 3-bit clean), and the web port does the same. This was found by the port's own load-time invariant checks, which is exactly what that panel is for. The DOS port ships the original ST graphics unconverted, in ST word-interleaved 4-bitplane layout.

### `P*.DAT` → sprite atlas index into the same-named `.PI1` `[PROVEN]`

25 of 31 `P*.DAT` files match this schema exactly (big-endian throughout):

```
u16  count
count × {
    u16  width  - 1
    u16  height - 1
    u16  word2       // PROVEN NEVER READ — dead padding. Always 0 in all 1451 records.
    u16  x           // pixel offset into the paired .PI1
    u16  y
}
```

Confirmed by two independent checks: in `PGODFONT.DAT` the `x` field steps by exactly the frame width and wraps to `x=0, y+=16` after 320 — the DEGAS canvas width; and across **all** records in all files, `max(x+width) = 320` and `max(y+height) = 200`, exactly the DEGAS canvas. Pairs are e.g. `PGUARD11.DAT`↔`PGUARD11.PI1`, `POBJ1.DAT`↔`POBJ1.PI1`. Every atlas file is exactly `2 + 10*count` bytes; 25 files, 1451 records total.

**`word2` is dead padding — safe to drop in a port** `[PROVEN]`. The parse loop dereferences exactly four of the five words (`+0`, `+2`, `+6`, `+8`) and steps over `+4` with an `add si,4` whose result is never used — on one path `SI` is popped, on the other it's overwritten by `mov si,0x22` before any load. A byte scan of all three graphics drivers for every register-load encoding of `[si+4]` found exactly one hit anywhere: a `mov si,[ss:si+0x4]` roughly 4 KB away from the loop, which is an **`SS`-override** read against the *derived* runtime descriptor (whose `+4` is an arena offset) — a different structure entirely. The derived descriptor is only 8 bytes wide and has no slot the field could propagate into. Two independent investigations (one via the load path, one via the consumer path) reached this conclusion separately.

`PSMLFNT.DAT` and `PSHOPFNT.DAT` are byte-identical (411 bytes, same SHA-256).

### ⚠️ The atlas parser is in the graphics driver, not `GAME.EXE` `[PROVEN]`

This is why every earlier search for an atlas consumer inside `GAME.EXE` came up empty — **it isn't there.** `GAME.EXE`'s `FUN_1000_2342` is a three-instruction thunk:

```
1000:2342  CALLF [0x52aa]        ; SS-override → far call into the graphics-driver overlay
1000:2347  CALL  0x1000:de34     ; 0xb4-byte memset cleanup
1000:234a  RET
```

`SS:0x5252` holds a **41-entry far-pointer table into the graphics driver**, immediately followed at `SS:0x52f6` by **13 entries into the sound driver** — pinned by 54 MZ relocation entries, not inference. The driver side matches exactly: `VGA/EGA/TGA.EXE` each open with a word table of **41 export offsets terminated by `0x0000` at index 41** (independently verified: `hdrpara=32`, `nrel=0`, `CS:IP=0000:0000`, so file offset = segment offset + `0x200`), and `ROL.EXE` has exactly 13. **Export 22** — `0x0aad` in VGA and EGA, `0x09aa` in TGA — is the sole atlas loader, verified present exactly once in each table.

Export 22 is a *load-asset-group-by-name* entry point, not a per-frame blitter: `GAME.EXE` passes a pointer to a NUL-separated worklist of group names, the driver matches it against its own CS-resident name table (`always`, `objects`, `smallfnt`, `shop`, `level1-4`, `guard1-4`, `introft`) and expands it via a pointer table into the 25 real atlas file stems. It then loads `<name>.pi1` + `<name>.dat`, walks the 10-byte records, and builds an **8-byte-per-sprite runtime descriptor** `{ -(width-1), height-1, arena_offset, arena_segment }` in the stack segment, doing a one-time planar→chunky conversion with mask generation along the way. The source address into the DEGAS bitmap is computed as `0x22 + y*160 + x/2` (`0x22` = the 2-byte resolution word + 32 palette bytes).

Note the division of labour, which matters for a port: `GAME.EXE` owns the filenames (the `.pi1`/`.dat` extension literals at `DS:0x58`/`DS:0x5d`, the `P` pack-prefix, and all file I/O), while the driver owns parsing, format conversion and the runtime descriptor layout. `VGA.EXE` contains no extension or prefix strings at all. **The graphics drivers are not thin video back-ends — they own asset parsing.**

### `P*.JOY{G,L}{1,2,3}.DAT` → recorded attract-mode input, not sprite data `[PROVEN]`

The six `PJOY{G,L}{1,2,3}.DAT` files decompress fine but have `count = 0` under the atlas schema — because they aren't atlases. They are **flat, headerless recordings of joystick/button input**, played back to drive GAME.EXE's attract-mode demo.

`GAME.EXE`'s per-tick game-port poller (`FUN_1000_241d`, reads I/O port `0x201`) writes a packed "combined input state" byte to `DS:0x382` every frame: bit7 = button, bits{3,2}/{1,0} = digital direction pairs for the two axes, bits{6,5,4} always 0 in the live-computed value. During playback (`DS:0x3bd` nonzero), the same function **overwrites `DS:0x382` a second time** with the next byte pulled from a flat buffer at segment `0x3cf8`, cursor `DS:0x282`, auto-incrementing with **no length field and no bounds check** — until it hits `0xFF`, forced whenever the live button bit is set, and otherwise unreachable from real input construction. Two independent consumers explicitly check for that `0xFF` as an end-of-stream sentinel (`FUN_1000_006f`, `FUN_1000_6e50`). Confirmed empirically: all 6 files (6506 bytes decompressed total) end in exactly one `0xFF` byte each, at the last position, and no other byte in any file has bits 4–6 set — an exact match to the code's construction rules.

The loader (`FUN_1000_2c82`) drives a 6-state attract-mode cycler (`DS:0x3e6` = 0..5) that patches a single ASCII digit into the already-known `"joyl1.dat"`/`"joyg1.dat"` templates (`1ffd:eacc`/`ead6`) to build `joyl1→joyg1→joyl2→joyg2→joyl3→joyg3` in turn, loading+DCL-decompressing each (`p`-prefixed, through the same shared loader everything else uses) into the shared buffer. Only the **`joyg`** loads jump into real gameplay code (`FUN_1000_6b00`) with the file driving the demo; the **`joyl`** loads stay inside the attract sequencer, and their exact playback-termination path wasn't conclusively traced (`0xFF`'s bit0 is also set, so the sequencer's own loop catches it on an earlier, different branch than the gameplay path's `0xFF` check — `UNKNOWN`). A live-recording code path exists in the same reader (write instead of read, gated by `DS:0x3bd` being negative) but is **proven dead** in this shipping `GAME.EXE` — an exhaustive check of all 8 references to `DS:0x3bd` found no instruction that ever writes a negative value there. Presumably how these files were captured during development; that authorship claim is inference, not proof from this binary.

The `"joypos.dat"`/`"pjoypos.dat"` stem (`1ffd:eac1`, Table 2 `2f3d:58f8`) plausibly names the *real* joystick calibration file (populating the threshold words the poller compares against, `DS:0x13e/140/142/144`) — explaining why the PJOY files above aren't calibration data — but `PJOYPOS.DAT` isn't present on disk to confirm, and no code reference to its string address was found (same SS/DS-relative-addressing blind spot noted elsewhere for Table 1/2).

`UNKNOWN_joypos_owner` — **closed negative, exhaustively.** A clean-byte search for `"joypos"` (case-insensitive) across **all 16 shipped executables** — the same gold-standard sweep this document already ran for `"wibble"` — finds **zero** hits anywhere, packed binaries included: the 12 already-plaintext EXEs (`GAME`, `GODS`, `INSTALL`, the four graphics drivers, the four sound drivers `ADL`/`TDY`/`BPR`/`ROL`, `UNPACK`, `WIBBLE`) were grepped directly, and the four still-PKLITE-packed ones (`INTROE`/`INTROT`/`INTROV`/`TGAME`) were unpacked fresh with `deark -m pklite` (output sizes matching this document's own previously-recorded figures exactly, and each re-confirmed readable via known strings like `"unpack.exe"`/`"beeper.bin"` before trusting a negative result) and searched in the clear. So the earlier "not present on disk, no code reference found" framing understated the case: **no instruction in any shipped binary, of the 16, references `pjoypos.dat`/`joypos.dat` by any literal string operand.** The residual narrows to exactly the blind spot already named — a pointer computed into a register rather than encoded as an immediate — which this project has never had a way to rule out for any string.

### Fixed-size record tables `[mixed — see per-family confidence]`

`PALFILS.0{A,B}{1-4}` (8760 B), `POBJECTS.00{1-4}` (6336 B), `PWEAPONS.00{1-4}` (880 B) all decompress to uniform per-category sizes, implying fixed-size record tables. Traced by finding `GAME.EXE`'s actual consumers (not via Table-2 filename xrefs, which dead-end at a generic disk-id lookup shared by all 105 entries — the parsers were instead found via the `"Power"`/`"Value"` shop-label strings and record-stride searches).

**`PWEAPONS.00x`** `[PROVEN]` — 11 fixed **80-byte (`0x50`)** records, closed two ways: weapon-name text lands at a clean 80-byte stride in the decompressed buffer, *and* `GAME.EXE`'s load-time init loop (`FUN_1000_366d`) byte-swaps exactly the first 32 bytes of each of 11 records at stride `0x50`, over a table based at `DS:0xE2B6` (reused by ~14 functions as `weapon_index*0x50 + 0xE2B6`). Field `+0x6` (inside the swapped range, native after swap) is the **"Power"** stat; field `+0x4a` (outside the swapped range, byte-swapped only at display time) is the **"Value"** stat — both confirmed via the shop-display routine (`FUN_1000_474c`) printing straight under those two string labels. **Fields `+0xc`, `+0x1e` and `+0x48` are now resolved** `[STATIC]`: `+0xc` = sprite descriptor index (`di = 0x1e00 + val*8`); `+0x1e` = a second sprite descriptor index, selected by the previously-undocumented `+0x0e`; `+0x48` = **"projectile is STOPPED BY solid terrain"** — ⚠️ **not** "breaks blocks"; see the correction under *The move→stamp link* below. Note `+0xc`/`+0x1e` are **pinned at the EXE-image values**, so each `PWEAPONS` file's own copy of them is discarded — `.004`'s `+5` shift never takes effect. ⚠️ **`+0x08` is pinned too, by a different mechanism** — see *THREE `PWEAPONS` fields are pinned* below; this line used to name only two.

**`POBJECTS.00x`** `[PROVEN]` — 132 fixed **48-byte (`0x30`)** records. Formerly "structure proven, field semantics mixed, no parser located". **The parser is `CS:0x35FB`**, reached from `CS:0x35E9` (sublevel `'a'` only) immediately after the `PWEAPONS` loader `0x366d`, and it settles the whole layout because its own immediates fix every width:

```
3615  mov si,0 / mov di,0x2a4e / mov cx,0x84     ; 132 records
361E  xor dx,dx                                  ; the running TEXT offset
3620  movsw / movsw / movsw / movsw              ; copy +0..+7 VERBATIM
3624  mov [es:di],dx / inc di / inc di           ; descriptor +8 = that offset
3632  inc cx / lodsb / stosb / cmp al,0 / jnz    ; NAME, from file +0x08
3639  pop si / add si,0x10 / push si             ;   -> so the name is 16 bytes
363E  inc cx / lodsb / stosb / cmp al,0 / jnz    ; DESCRIPTION, from file +0x18
3646  cmp cx,2 / 364D jg 0x3658
364F  sub bx,2 / mov word [es:di-0x2],0xffff     ; BOTH empty -> +8 = 0xFFFF
3658  add si,0x18                                ; -> the next record
3664  mov [0x14a],bx / mov [0x14c],bx            ; the text arena end
```

`0x08 + 0x10 = 0x18` and `0x18 + 0x18 = 0x30 = 48` — the accounting closes exactly:

| off | field |
|---|---|
| `+0x00` | BE `u16` id (`170 + type`; `.004` uses 175) |
| `+0x02` | dead padding — 0 in all 528 records, copied verbatim, **never read back** (see below) |
| `+0x04` | BE `u16` category |
| `+0x06` | BE `u16` **VALUE** — see below |
| `+0x08` | name, ASCIIZ, 16 bytes |
| `+0x18` | description, ASCIIZ, 24 bytes |

Category codes: `0`=potion/consumable, `1`=treasure, `2`=keys, `3`=levers/switches, `4`/`5`=`UNKNOWN`.

**`+0x06` = Value is now `[PROVEN]`**, promoted from "likely, inferred by structural position". `CS:0x18A8` and `CS:0x18F4` are the direct decompile: both treasure award paths do `mov ax,[di+0x6] / xchg al,ah`, add the result to the 32-bit money total at `DS:0x194` and shift it into the BCD score. See *Treasure* below.

⚠️ **The 10-byte runtime descriptor at `DS:0x2a4e` is a MIXTURE of endiannesses**, and a port that picks one is wrong twice. `movsw` copies raw, so `+0`..`+6` arrive **big-endian**; `+8` is written natively as `DX`. Then the stamp loop `CS:0x2234` runs (`CS:0x2A80` loads, `CS:0x2B30` stamps) and rewrites `+0` = `170 + type` and `+4` = the `DS:0xef78` category byte **sign-extended to a native word**. Net: `+0`/`+4` native, `+6` big-endian (hence the `xchg` at every use), `+8` native with `0xFFFF` meaning "this object has no text".

**`UNKNOWN_pobjects_field2` — CLOSED negative, exhaustively `[STATIC]`.** Every site anywhere in `GAME.EXE` that bases a register directly on `DS:0x2a4e` was enumerated (`search_instructions` on the literal `0x2a4e`, 14 hits total) and individually read: `FUN_1000_177d` (pickup), `FUN_1000_2234`/`FUN_1000_35fb` (stamp/parser, already documented touching only `+0`/`+4`/`+6`/`+8`), `FUN_1000_1ee3`, `FUN_1000_4609`, `FUN_1000_6e62`, `FUN_1000_7392`, `FUN_1000_bf80` show **no** `+0x2` access at all. Four sites (`FUN_1000_110a`, `FUN_1000_1534`, `FUN_1000_402b`, `FUN_1000_904c`) looked promising on a broad `[reg+0x2]` sweep, but each turned out to read a *different* register that just happens to share the function with a `0x2a4e`-based one — the object array at `DS:0x7964`'s own Y field (three of the four), or the weapon sprite-descriptor table at `DS:0x1e00`'s own height field (the fourth); none of the four ever dereferences the `0x2a4e`-based register at offset `+2`. The one indirect route out of `GAME.EXE` — `FUN_1000_90e6` stores the descriptor base into `DS:0x7e` and hands it to a driver export (`callf [ss:0x52d2]`, graphics export 32, the draw-order partition) — is already fully decompiled elsewhere in this document (*Draw order is three-way*) and only ever tests `+0x4`. So **no code anywhere, in `GAME.EXE` or the one driver export that receives the descriptor, ever reads offset `+0x2`** — dead padding, in the same authoring-pattern family as the `.DAT` atlas's proven-dead `word2` and the `.MAP` header's unread count table. Safe to drop in a port.

**`PALFILS.0{A,B}{1-4}` — the level hint/objective text, plus an entity table** `[PROVEN]`. Formerly `UNKNOWN_alfils_layout`. Despite the filename it is **not** a palette table (that finding stands — no genuine 16-word `0RGB` window exists anywhere in the 8760 bytes, and every `.PI1` embeds its own palette). The real logical stem is `"alfils"`; `P` is only the pack-prefix.

Loaded at `GAME 1000:2a89` (template `DS:0x298a + 0xaa` → `alfils.0<a|b><world>`), the first 7000 bytes are copied to `DS:0x9008` and the tail is parsed by `1000:36b1`. **The layout accounts for all 8760 bytes exactly**, and holds on all eight files:

```
0x0000 .. 0x1b58   7000 B  NINE distinct windows, strides 8/4/0x10/0x16/0x16/6/6/6/0x1c
                             (see "PALFILS feeds the trigger system") -> copied to DS:0x9008
0x1b58 .. 0x1ba8     80 B  40 x BE i16 key      (negative = empty slot)
0x1ba8 .. 0x21e8   1600 B  40 x 0x28-byte ASCIIZ strings
0x21e8 .. 0x2238     80 B  all zero; NOT read by this parser
```

`0x1b58 + 0x50 + 40*0x28 + 0x50 = 0x2238 = 8760` — verified against all eight decompressed files. The strings are the in-game hints: `"find the gold key to exit this world"`, `"illuminate the study to end the world"`, `"is this small gold key cursed ??"`, `"repair the mosaic to please the gods"`, `"return the levers to get cross"`.

**The 40 keys are world X coordinates, and object type 69 is the hint trigger** `[PROVEN]`. Cross-referencing the 45 non-empty keys against each map's 200 object records: **44/45 match an object's `x` exactly**, all 44 on `type == 69` (`0x45`), against only 3/45 spurious matches on `y`. On 6 of 8 map/alfils pairs the key set equals the type-69 x-set exactly. The consumer at `1000:63d5` (same address in `GAME` and `TGAME`) takes the entity's screen X, adds the scroll origin, and does an **exact-equality** scan over the 40 keys — which only makes sense because the entity compared *is* the placed type-69 object whose `x` is verbatim the stored key.

Two leftovers: `PALFILS.0B4` has one key (`x=1104`) whose text is the developer placeholder `"we need a hint for the quest"`, and `PLEV1B` has two type-69 objects with no hint text. ⚠️ The front region is **not one array** — an earlier revision of this file claimed "875 8-byte records" here, and that is refuted. It is **nine distinct windows** with strides 8 / 4 / 0x10 / 0x16 / 0x16 / 6 / 6 / 6 / 0x1c; see the full table below. Only the first (100 × 8 bytes) is the spawn table consumed at `1000:b912`.

Also embedded in these files, unreferenced by any parser: a developer banner reading `Cripal Source Code` / `Level One of Gods` inside a row of asterisks.

**Decompressor caveat:** the local `blast.py`/DCL decompressor used for this analysis has a reproducible 1–2-byte text corruption in record 0's name field, identical across all four world-variant files per family, confirmed (via cross-file diffing) to be a genuine source-data property rather than a decoder bug — but it makes one specific value untrustworthy at "proven": `POBJECTS` record 8 ("pile of coins", treasure category) reads `value=2`, breaking the otherwise clean round-number pattern of every other treasure record; true value is plausibly 20/200/2000.

## Execution model `[STATIC — disassembly-proven, not yet runtime-confirmed]`

**The user runs `GODS.EXE`. Nothing else is launched directly.** Full chain, proven instruction-by-instruction:

```
INSTALL.EXE  ── writes GODS.INI (AH=3Ch create @0xcb4, AH=40h write @0xcd0). Has NO EXEC call.
                 It is the ONLY writer of the INI.

GODS.EXE (launcher, 4.8K)
  ├─ 1000:03ec  copy-protection check (INT 21h AH=19h current drive)
  │               drive >= 2 (hard disk) → verdict byte [0x63d] = 'X'  (check bypassed)
  │               floppy → INT 13h/25h read volume label, accept only 'X'/'1'/'A'
  ├─ 1000:051d  read + parse GODS.INI into config bytes [0x634..0x63d]
  │               ends with bias loop @1000:05b5: all 10 bytes += 0x61 (→ printable letters)
  ├─ 1000:0057  INT 21h AH=4Bh AL=00h  EXEC child #1: "introv.exe"
  │               byte [0x6cf] patched 'v'→'t' (Tandy) or 'v'→'e' (EGA) from the video setting
  ├─ 1000:0112  INT 21h AH=4Bh AL=00h  EXEC child #2: "game.exe"
  │               → "tgame.exe" when the video letter is 'c' (Tandy 16 colour)
  └─ 1000:0168  AH=4Dh read child exit code:
                  0 → JMP back to 1000:003b, re-running intro+game (quit-to-title loop)
                  5 → "Protection failure."
                  else → "Thank you for playing GODS." and exit
```

Config reaches the children through the **DOS EXEC command tail** (param block at `0xa2a`, tail at `0x634`), landing in the child's PSP at `0x80`. `GAME.EXE` reads `PSP:0x81` (video), `PSP:0x88` (sound), `PSP:0x89` (protection verdict).

**`GAME.EXE` never spawns a process.** It uses `INT 21h AX=4B03h` (**DOS load-overlay**) exactly three times, unconditionally, as the first three calls from its entry point:

| Site | Loads | Notes |
|---|---|---|
| `1000:28f7` | `unpack.exe` | The PKWARE DCL decompressor — **live, not vestigial**. Confirms the container format below. **No error check** on this one; a missing `UNPACK.EXE` goes undetected. |
| `1000:2906` | `vga.exe`, patched to `ega.exe` | Single-byte patch when the video letter is `'a'` |
| `1000:29a0` | one of `bpr/adl/rol/adl/tdy.exe` | Via a 5-entry pointer table at `1ffd:eb50` indexed by (sound letter − `'a'`). **Index 3 (Sound Blaster) reuses `adl.exe`** — SB is driven through the AdLib/OPL driver. |

`VGA/EGA/TGA/ROL/ADL/TDY/BPR.EXE` are **not standalone programs** — they are host-loaded overlay modules: 512-byte all-zero MZ header, zero relocations, `CS:IP=0000:0000`, and they call back into the host through far pointers at fixed `DS` offsets (e.g. `ROL.EXE` → `[DS:0x0044]`, `VGA/EGA` → `[DS:0x00a1]`). `TGA.EXE` is unreachable from `GAME.EXE` and belongs to `TGAME.EXE`.

Sound overlays open their own data files by unprefixed name: `ROL.EXE` → `player.bin` + `godsrle.rl` (7th char patched `'a'+n` → `PGODSRL{A..G}.RL`), `TDY.EXE` → `tandy.bin`, `BPR.EXE` → `beeper.bin`. `ADL.EXE` contains no filename strings at all.

### `UNKNOWN_unpack_ax_param` — site located and value pinned, semantics still `[UNKNOWN]`

This token lost its own defining prose at some point (a project self-audit, `analysis/audit-2026-09/items.txt`, confirmed it as a bare, undefined name — the only trace of the original question was the sibling, already-closed `UNKNOWN_export9_ax_param`, which suggested the naming convention but not this one's content). What follows is fresh work, not a recovery of lost prose.

The shared file-load wrapper, `CS:0x257E`, is what every overlay/asset open funnels through (filename-buffer prep, DOS open+read, then the actual DCL decompress). Its tail, immediately before the far call into the just-loaded `unpack.exe` entry point (`CS:0x25A8`, `callf 0x40ec:0000` post-relocation — this document's own already-established runtime segment):

```
2598  mov dx,0x1666          ; the "P"-prefixed filename buffer
259B  call 0x1000:25bb       ; open + read the compressed file, stash a {offset,seg} pointer at DS:0x2f6/0x2f8
259E  mov ax,0x89f3          ; <- the AX parameter, a bare constant, set unconditionally
25A1  pop es / pop di        ; restore the CALLER's ES:DI (the decompression OUTPUT buffer)
25A3  mov cx,[0x102]         ; compressed byte count (from the read)
25A7  push ds
25A8  callf 0x40ec:0000      ; -> UNPACK.EXE entry
25AD  pop ds
```

**`AX = 0x89F3` is a literal immediate, not a computed value and not a GAME.EXE address** — disassembling `CS:0x89F3` as if AX held a same-segment callback offset lands mid-instruction inside an unrelated routine (the `DS:0x8014` brood-array walker), which rules out the "it's a callback pointer into the host" hypothesis this document uses elsewhere for the graphics/sound driver interface (`ROL.EXE`'s `DS:0x0044`, `VGA/EGA`'s `DS:0x00a1`) — those are genuine near/far function pointers into real code; `0x89F3` is not. `ES:DI` (the destination buffer) and `CX` (the compressed length) are the two registers that visibly vary per call; `AX` does not, across every call site disassembled this pass.

**What `UNPACK.EXE` itself does with `AX` is not established** — that requires disassembling `UNPACK.EXE` (a separate PKLITE-unpacked-derivative binary per this document's own *`GAME.EXE` and `INSTALL.EXE` are unpacked derivatives* section), which was not done this pass. `UNKNOWN_unpack_entry_ax_semantics` narrows the residual to exactly that: the call site, the exact constant, and its "not an address" status are now `[PROVEN]`; only the constant's *meaning inside `UNPACK.EXE`* remains open.

### `WIBBLE.EXE` invocation — **now CLOSED**, see *Unpacking the PKLITE binaries*

> The paragraph below records how far the pre-unpack analysis got. The four packed binaries it names as unchecked have since been unpacked and searched; nothing invokes `WIBBLE.EXE`.

The string `wibble.exe` sits in `GODS.EXE`'s table at `0x6bf`, but **no instruction anywhere in the binary loads that address** (verified: zero hits for the immediate across all 4868 bytes, while its table neighbours all hit). A follow-up pass proved the same for `GAME.EXE` (zero `"wibble"` hits by raw-byte grep, Ghidra string search, and a full `.exe`-stem enumeration that found only the 13 known driver-launcher names) and `INSTALL.EXE` (not PKLITE-packed, so a clean-byte search is conclusive: no `"wibble"`, and its only `.exe` reference is its own name). No `.BAT`/`.SYS`/`.COM` file exists in the directory, and `GODS.INI` is pure config text with no filenames. **`INTROE/INTROT/INTROV.EXE` and `TGAME.EXE` remain PKLITE-packed and unchecked** — a raw-byte search on them is provably inconclusive (their post-header content is opaque compressed noise, not plaintext), so invocation from one of those four is not ruled out.

`WIBBLE.EXE` itself turns out to hide a genuinely sophisticated hand-written anti-debug scheme, fully reverse engineered statically: its entry point hijacks the `INT3` vector (self-relocating via a call/pop trick) to point at `CS:0x778`; that handler then hijacks `INT1` (single-step trap) to point at `CS:0x7C4` and decrypts exactly 59 bytes there in place with a byte-wise `NEG` loop (independently verified by extracting and NEG-ing those bytes offline — they disassemble into coherent code). The decrypted `INT1` handler implements a **sliding, self-decrypting one-word execution window** walking forward from `CS:0x33`, with a `0xCC` (breakpoint) tripwire check — a classic single-step-based decryption cascade whose full extent can't be recovered statically since each step's key depends on executing the previous one. Past that protected region, a plaintext epilogue at `CS:0x7FF` unconditionally exits via `INT21h AH=4Ch`; one branch first prints the verified `"Warning: Gods original disk not found..."` string and waits for a keypress. **Which branch fires is not determined** — the byte pair that looked like the deciding `TEST`/`JC` sits inside the still-encrypted region and is ciphertext, not real code (and `TEST` can't even set the carry flag `JC` reads). Confirmed: `WIBBLE.EXE` never itself issues `AH=4Bh` (it doesn't spawn anything).

Best-supported reading: an orphaned, standalone disk-verification utility (its instruction-level shape — anti-debug guard, print-message-and-exit — fits a manually-run tool, not a library routine meant to be called). Not conclusively excluded: invocation from one of the four still-packed binaries.

### ⚠️ `GAME.EXE` and `INSTALL.EXE` are unpacked derivatives

Both were PKLITE-packed on the distribution media and were **unpacked in place** (`GAME.EXE` 49.6K→148.8K, `INSTALL.EXE` 4.9K→9.6K). Their current hashes are **not** distribution hashes; pristine copies are backed up outside this directory (per the maintainer). `INTROE/INTROT/INTROV.EXE` and `TGAME.EXE` shipped PKLITE-packed — the PKLITE signature (`"PKLITE Copr. 1990-91 PKWARE Inc."`) starts at file offset `0x1e` in all four, confirmed byte-for-byte (an earlier pass mis-cited this as `0x20`, which is the third letter of the signature, not its start). **All four have now been unpacked** — see the next section. The on-disk copies are untouched; the decompressed images live only in the session scratchpad.

## Unpacking the PKLITE binaries `[PROVEN]`

All four remaining packed executables are decompressed with **`deark -m pklite`** (`brew install deark`, v1.7.3). Nothing was written to the game directory.

```
INTROE.EXE   6.0K →  11552 B      INTROV.EXE   6.0K →  11488 B
INTROT.EXE   5.6K →  11136 B      TGAME.EXE   50.1K → 152898 B
```

All four are PKLITE v1.12 with an identical relocator stub (`CS:IP = fff0:0100`, entry at image start, `"Not enough memory$"` at `0x132`). `TGAME.EXE`'s flag byte is `0c 31` versus `0c 11` on the three intros — a different packing option, which deark handled anyway.

**The unpacker is validated against a live trace, not merely assumed correct.** `INTROV.EXE` is the one of the four already traced under DOSBox, so its expected string set was known in advance. The unpacked image contains all 8 of the traced filenames — `unpack.exe`, `one.pi1`, `introft.dat`, `introft.pi1`, `stback.pi1`, `beeper.bin`, `player.bin`, `title.rl` — and, as the `P`-prefix convention predicts, **unprefixed**. The output is also a structurally sane MZ (48 relocations, 14-paragraph header, `CS:IP=0000:0000`, declared size matching actual). The other three outputs inherit that confidence.

> **Tagging caveat:** the *unpacking method* is `[PROVEN]`. A string read out of a resulting image is `[STATIC]` — present in the binary, not observed being used at runtime.

### `UNKNOWN_wibble_invocation` — CLOSED `[PROVEN]`

A clean-byte search for `wibble` across **all 16 shipped executables** (counted: `ls *.EXE` = 16) now returns exactly one hit, in `GODS.EXE`, which is the already-known orphan table entry at `0x6bf` that no instruction loads:

| Binary | hits | | Binary | hits |
|---|---|---|---|---|
| `GODS.EXE` | **1** (dead table entry) | | `INTROE/INTROT/INTROV` (unpacked) | 0 |
| `GAME.EXE` | 0 | | `TGAME` (unpacked) | 0 |
| `INSTALL.EXE` | 0 | | `UNPACK.EXE` | 0 |
| `VGA/EGA/TGA.EXE` | 0 | | `ROL/ADL/TDY/BPR.EXE` | 0 |
| `WIBBLE.EXE` itself | 0 | | | |

Every binary in the release is now searchable in the clear — the four PKLITE files were the last blind spot. **Nothing invokes `WIBBLE.EXE`.** It is an orphaned standalone disk-verification utility, exactly as the instruction-level shape of its code suggested.

### The intro sound-file list `[STATIC]`

All three intros carry a **packed ASCIIZ list of five names** — spacings `0x0b / 0x0c / 0x0b / 0x0a` are exactly `strlen+1`, so it is a contiguous string list, not a padded array:

```
introv 0x2640  beeper.bin  godmus2.mus  demosb4.sb  tandy.bin  title.rl
introe 0x2660  (same five, same spacing)
introt 0x24c0  (same five, same spacing)
```

Five names, five `GODS.INI` sound settings. **This resolves the last three unowned assets** (`PDEMOSB4.SB`, `PGODMUS2.MUS`, and `PMUSIC.MUS`, the last at introv `0x29fe` in the general-asset cluster alongside `player.bin`/`introft`/`stback`/`one.pi1`/`unpack.exe`).

**There is no table at all** `[STATIC, exhaustive]` — which is why the pointer-table scan found nothing and why "storage order = enum" contradicted the live trace. The five names are reached by **seven hard-coded `mov dx,imm16` instructions in the branches of one if/else dispatcher** (introv `0x1355`, single caller at `0x004A`; introe `0x1380`; introt `0x1209`, instruction-for-instruction identical).

The reason the offsets looked invisible: each intro sets `DS` to a paragraph that puts **`DS:0x0000` exactly on the first byte of `"beeper.bin"`** (`mov ax,0x256 / mov ds,ax` in introv → image `0x2560` → file `0x2640`). So the code carries tiny immediates — `0x00`, `0x0B`, `0x17`, `0x22`, `0x2C` — not pointer-sized values.

```
1359  mov al,[es:0x88]   ; ES = PSP; sound config byte
135D  sub al,0x61        ; un-bias -> 0..4
135F  jnz ...            ; enum 0 -> 0x1514  BEEPER
1364  cmp al,0x4 -> 0x1540  TANDY
136C  mov dx,0x3b3       ; enums 1,2,3 all load "player.bin" first
137B  cmp al,0x2 -> 0x13F2  ROLAND
137F  mov dx,0x3be       ; "music.mus"    <- default (enum 1, AdLib)
138C  cmp al,0x3 / 1390  mov dx,0xb       ; "godmus2.mus"  <- override (enum 3, SB)
13BD  cmp al,0x3 / 13C1  mov dx,0x17      ; "demosb4.sb"   <- extra SB sample load
```

| `GODS.INI` sound | enum | Files the intro opens |
|---|---|---|
| Beeper | 0 | `beeper.bin` |
| AdLib | 1 | `player.bin` + `music.mus` |
| Roland | 2 | `player.bin` + `title.rl` |
| Sound Blaster | 3 | `player.bin` + `godmus2.mus` + `demosb4.sb` |
| Tandy | 4 | `tandy.bin` |

**This reconciles exactly with the live trace** — Beeper reaches only `beeper.bin`; Roland loads `player.bin` at `0x136C` then branches to `title.rl` *before* reaching the `music.mus` code, so neither traced config could ever have opened the three AdLib/SB assets. Closure was checked exhaustively: those seven immediates appear nowhere else in the image, and the dispatcher has exactly one caller.

### ⚠️ A shipped bug in the Tandy intro `[STATIC]`

`INTROT.EXE` uses **`adlib.bin`** (`DS:0x3d3`, file `0x2893`) where the other two intros use `player.bin`. **No `PADLIB.BIN` ships** — verified directly: the only `.BIN` files in the release are `PBEEPER.BIN`, `PPLAYER.BIN`, `PTANDY.BIN`, `PBUMLIST.BIN` and `HISCORES.BIN`. So selecting Tandy *video* (which is what launches `INTROT.EXE`) together with AdLib, Roland or Sound Blaster *sound* asks for a file that does not exist. Only the Beeper and Tandy sound branches of `INTROT.EXE` reach a real file.

### `TGAME.EXE` is a variant build of `GAME.EXE` `[STATIC]`

Unpacked `TGAME` is 152898 B against `GAME.EXE`'s 152384 B — a **514-byte** delta. Filtering both string dumps to plausible real text (≥4 chars, containing letters) gives **240 shared strings and zero meaningful differences**; the handful of set-unique entries on each side (`R*SZS`, `.rXV`, `QHQxQ`, `y3yNyiy`) are binary noise from shifted code. Both headers declare the same 93 relocations and 25-paragraph header.

So **the difference is code, not data** — the filename tables, message pool and driver interface are common. `tga.exe` appears in `TGAME` at `0x1ec6b` and `0x25041`, consistent with the documented claim that `TGA.EXE` belongs to `TGAME.EXE` rather than `GAME.EXE`.

⚠️ Do **not** read a string's presence in `TGAME` as new information: `god0?.pat`, `pgod01/02/03.pat`, `alfils.0*?`, `joypos.dat` and `\pcgods.dat` are all present in `GAME.EXE` too (verified count-for-count). They are shared-table entries, so their presence in `TGAME` proves nothing on its own. (`.PAT` and `alfils` were both cracked later, but by *code* analysis — see below — not by this string check.)

### Credits and intro text recovered `[STATIC]`

The intro's full text pool sits at introv `0x2a3e`–`0x2cd5`: `RENEGADE` / `PRESENTS` / `A BITMAP BROTHERS` / `GAME`, then `PRODUCTION TEAM` — **CODE** Steve Tall, **GRAPHICS** Mark Coleman, **DESIGN** Eric Matthews + Steve Tall, **MUSIC** Nation XII, **MUSIC CODE AND SFX** Richard Joseph, **ADDITIONAL CODE** Mike Montgomery — followed by `LOADING GAME` and the 24-line story poem (`"the challenge / any man may / earn through / skill and courage..."`). Two Roland-specific messages sit at `0x2677`/`0x2698`: `"initialising roland card"` / `"please wait"`.

One oddity resolved: the poem reads `heroGs failure` where an apostrophe belongs. This is **glyph-index arithmetic, not a typo** — the renderer maps a string byte to an atlas record by adding a fixed bias, and `'G'` lands on the apostrophe glyph. Text is fed to the blitter as `C + 0x20`. So the intro really renders `HERO'S`.

### `TGAME.EXE`'s 514 bytes, mapped `[STATIC]`

Aligning the two images properly (rather than by naive `cmp`) gives **22 size-changing regions summing to exactly +514**, across 575 raw differing regions; 24821 of ~24850 instructions are structurally identical (**99.92%**). Two findings matter for a port:

- **`TGAME` exports 40 graphics entries, not 41 — export 16 is absent** (`GAME.EXE`'s only export-16 thunk is at `CS:0x22dc`). `TGA.EXE` itself still ships a full 41-offset table.
- **482 of the 514 bytes are one added table** in `CODE_2`: 241 `u16` where `v[y] == (y&3)*0x2000 + (y>>2)*160` for the first 200 entries and `v[200+y] == y*160` for the next 40. That is a **row→address table for Tandy's 4-way interleaved video banks** (`0x2000` apart), replacing VGA's flat 44-byte pitch. `GAME.EXE` has 482 zero bytes in that slot. Corroborated by the blit constants: `GAME` uses `0x1fcc = 185×44` and `0x1b80 = 160×44`, `TGAME` uses `0x172 = 185×2` and `0x140 = 160×2`.

The overlay-load site is otherwise byte-identical between the two, differing only in the filename it points at (`vga.exe` → `tga.exe`, both at `DS:0xeaeb`).

> **Reusable technique — `TGAME` as a de-aliasing oracle.** `TGAME`'s `SS` is shifted `+0x1e2` relative to `GAME.EXE`'s. A common immediate that is hopelessly ambiguous in one binary can be unambiguous in the other: the `.PAT` buffer is `SS:0x500` in `GAME.EXE` (27 hits, mostly noise) but `SS:0x6e2` in `TGAME` (**6 hits, all real**). That is what cracked `UNKNOWN_pat_owner` below. Map the hits back to `GAME.EXE` afterwards — the code is the same, just shifted.

## Frame pacing — the game logic runs at **15 Hz**, not 50 `[PROVEN]`

Two different clocks, and they are easy to conflate:

```
PIT channel 0                              1193182 / 19886 = 60.0011 Hz
music player   (ISR skips 1 in 6)                            50.001  Hz
game logic / display  (frame gate, below)  60.0011 / 4     = 15.000  Hz
```

The sound-driver timer ISR is byte-identical in `ADL`/`BPR`/`ROL`/`TDY`, and the crucial detail is the **ordering**:

```
inc byte [0x39]              ; UNCONDITIONAL - full 60.001 Hz
cmp byte [0x85],0 / jz ret   ; sound disabled?
dec byte [0xa9] / jnz play
mov byte [0xa9],6 / jmp ret  ; skip 1 in 6
play: ... call the music player
```

`inc byte [0x39]` sits **before** the 5-of-6 divider, so `[0x39]` counts PIT ticks, not music ticks.

`GAME.EXE`'s main loop ends with `mov al,[0x3d6]` → `call 0x35ad` (graphics export 14). **`[0x3d6]` has exactly one write in the whole binary** — `mov byte [0x3d6],0x3` at `CS:0x0031` — so `AL = 3` always. Export 14 spins on it and then clears the counter:

```
VGA:0x0E5C  cmp al,0xff / jz 0xe66      ; 0xFF would skip the wait (never happens)
VGA:0x0E60  cmp al,[0x39]
VGA:0x0E64  jnl 0xe60                   ; wait until [0x39] > 3
   ... 0x3DA retrace sync, page flip ...
VGA:0x0F0D  mov byte [0x39],0x0         ; identical in EGA.EXE
```

**One frame = 4 PIT ticks = 15.0 Hz**, and the player update `FUN_1000_4993` runs once per frame. Every per-second figure must be derived from 15 Hz: walking is ~60 px/s and a jump lasts ~1.53 s — consistent with the game's famously slow, committed jump. `UNKNOWN_tick_bypass`: no path setting `AL=0xFF` was found.

## The player state machine `[PROVEN]`

Lives almost entirely in the 5208-byte Ghidra gap `1000:49ca`–`1000:5e21`, which is why earlier passes never found it — **use `ndisasm`, not Ghidra, for this region.** Entry `FUN_1000_4993`, called once per frame from `1000:0254`. Dispatch at `1000:49bf` indexes a **29-entry `{u16 anim_base, u16 handler}` table at `DS:0xd818`** and does `jmp ax`.

| `DS` | Meaning |
|---|---|
| `0x17a` / `0x17c` | hero X / Y — **integer world pixels, no sub-pixel bits** |
| `0x1b2` | fall velocity (1…10) |
| `0x176` | fall-damage accumulator |
| `0x345` | air-control step counter (capped at 3) |
| `0x358` | jump-arc cursor |
| `0x377` | state index into the `0xd818` table |
| `0x382` | packed input: bit0 up, bit1 down, bit2 left, bit3 right, bit7 fire |
| `0x17e`–`0x184` | **4-slot inventory**, `0xFFFF` = empty |
| `0x192` | **hero HEALTH**, capped at `0x18` = 24 — see below. An earlier revision labelled it *ammo*; that was wrong. |
| `0x19a` | the **displayed health bar**, which chases `0x192` — see below |

**Dispatcher gates — two paths skip the entire state machine.** The dispatch is not a straight line from `0x4993` to `0x49bf`; 34 bytes in between matter:

```
499D  sub ah,ah / cmp al,0x12 / jz / cmp al,0x13 / jz
49A7  call 0x1e06                    ; runs for every state EXCEPT 0x12/0x13
49AA  cmp byte [cs:0x71d],0x90       ; CS-resident SELF-MODIFYING-CODE gate (0x90 = NOP)
49B0  jnz / jmp 0x5e9b               ; -> whole state machine skipped
49B5  cmp byte [0x363],0
49BA  js  0x49bf / jmp 0x5e9b        ; handler runs only when [0x363] < 0
```

**Sprite id = `anim_base + sign_extend(cl)`**, with three hard remaps at `0x5f8b` (`0x34→0x19`, `0x36→0x23`, `0x37→0x26`). `[0x377]` is re-read at `0x5f77` *after* the handler wrote it, so on a transition the sprite uses the **destination** state's `anim_base`.

### The per-tick contract, and `DS:0x36b` — the animation phase `[PROVEN]`

`CL` is **not** a scratch register. It is persisted across ticks in `DS:0x36b`: `FUN_1000_4993`'s very first instruction is `mov cl,[0x36b]`, and the epilogue's very first is `mov [0x36b],cl`. A port that recomputes `cl` each frame freezes every animation on frame 1. Only 10 references binary-wide; initialised to 0 at `0x8db`/`0x1018`.

```
4993  mov cl,[0x36b]              ; animation phase in
4997..49c9                        ; the two gates, then `jmp ax` into the handler
<handler>                         ; may write [0x377] (state) and CL (phase)
5E9B  mov [0x36b],cl              ; phase out
5EA0  call 0x5fab                 ; plane-B event probe
5EA4..5F76                        ; camera update  (see "The camera", below)
5F77  bl=[0x377] / bx*=4 / si=0xd818 / al=cl / cx=[bx+si] / cbw / ax+=cx
5F8B  the three remaps
5FA7  call 0x6049                 ; draw
```

`CBW` sign-extends **AL**, so `cl = 0xFF` is `−1`, not 255. A port that widens `cl` as unsigned indexes descriptor #307 instead of #51 and draws a font glyph.

### The 29 states, decoded `[PROVEN]`

Formerly `UNKNOWN_player_state_semantics`. Flow closures were computed from all 29 entry points (following both arms of every branch, stopping at `jmp 0x5e9b`) and cross-referenced with every `mov byte [0x377],imm` to give the full transition graph.

| # | base | meaning | # | base | meaning |
|---|---|---|---|---|---|
| 0 | 0 | **walk left** | 15 | 25 | ladder drop check |
| 1 | 11 | **walk right** | 16 | 29 | land right |
| 2 | 8 | turn left→right | 17 | 31 | land left |
| 3 | 8 | turn right→left | 18 | 29 | **crouch, facing right** |
| 4 | 9 | spawn / arrival idle pose | 19 | 31 | **crouch, facing left** |
| 5 | 19 | walk right + fire | 20 | 45 | jump right + fire |
| 6 | 22 | walk left + fire | 21 | 48 | jump left + fire |
| 7 | 9 | **no-op — a bare `RET`** | 22 | 45 | fall right + fire |
| 8 | 31 | **jump left** | 23 | 48 | fall left + fire |
| 9 | 29 | **jump right** | 24 | 39 | ladder fire right |
| 10 | 25 | fall (ladder family) | 25 | 42 | ladder fire left |
| 11 | 55 | **fall left** | 26 | 52 | **idle** |
| 12 | 54 | **fall right** | 27 | 51 | stub → walk left |
| 13 | 25 | climb (from walk) | 28 | 53 | stub → walk right |
| 14 | 25 | climb (from stand) | | | |

**How left/right was proven without assuming any input bit.** Handlers share code by tail-jumping, so a site inside two closures proves nothing — but four X-step sites sit in exactly **one** closure each: `4EB9 sub [0x17a],4` only in closure(8), `50B5 add [0x17a],4` only in closure(9), `524F sub` only in closure(21), `536C add` only in closure(20). The transition graph gives `0 → 8` and `1 → 9` at take-off, forcing state 0 into the −X family and state 1 into the +X family.

Three further derivations agree independently: state 26 dispatches input bit2 → 27 → 0 and bit3 → 28 → 1 (matching bit2 = left); leaving walk-left writes `mov cl,0xff` (`5AF9`) and walk-right `mov cl,0x1` (`5B0F`), which against `base(26) = 52` render **51 and 53** — exactly the `anim_base` values of stubs 27 and 28; and the extracted frames *look* left- and right-facing.

⚠️ **A trap in the disassembly.** State 0's body contains both `sub [0x17a],4` (`5AA8`) **and** `add [0x17a],4` (`5AD3`). The `add` is **not** a second direction — it sits under `cmp cl,7 / jng / mov cl,7` (`5ACC`–`5AD1`) and *undoes* the step when the walk-cycle phase clamps. Counting signs instead of reading context yields "state 0 walks both ways".

**The walk cycle is 8 frames** (`5AD8 inc cl` / `5ADA and cl,7`), with the footstep sound (`mov ax,0x20e / call 0x22ca`) fired at phases **2 and 6** — two steps per cycle, at opposite phases.

**What the three remaps are for** `[PROVEN]`. Their inputs are exactly the phase-0 sprite of the three states the hero spends most of its time in: `52 = base(26)` idle → **25**, `54 = base(12)` fall right → **35**, `55 = base(11)` fall left → **38**. Base 52 exists to generate 51/52/53 for stop-left / standing / stop-right; the middle one is then redirected. **The hero's frames are not a contiguous block**, and a port that skips the remap draws the wrong sprite in three of the commonest states. All three redirects land on 32×48 frames.

### States 4, 7, 18 and 19 `[PROVEN]`

**18 and 19 are the crouch / inventory pair** — proven by the dispatcher gate rather than inferred. `CS:0x499A` special-cases exactly these two states, skipping the panel-retract call:

```
499A  mov al,[0x377] / sub ah,ah
499F  cmp al,0x12 / jz 0x49aa       ; state 18
49A3  cmp al,0x13 / jz 0x49aa       ; state 19
49A7  call 0x1e06                   ; panel retract — EXACTLY ONE caller file-wide
```

They are the only two states in which the 4-slot inventory panel stays extended. 18 faces right (base 29, exits to state 1), 19 faces left (base 31, exits to state 0).

**The hitbox is shorter while crouching** `[PROVEN]` — three sites each run the identical range test and then raise the hero's box **top** edge:

```
4516  cmp byte [0x377],0x12 / jl / cmp 0x13 / jg / 4524 add cx,0x18   ; cx = [0x17c]
AC92  same test                                   / ACA0 add bx,0x14
DB68  same test                                   / DB76 add bp,0x18  ; bp = [0x17c]
```

A port that omits it makes crouching purely cosmetic — the dodge stops working.

**State 4 (base 9) is the spawn / arrival idle pose.** Eleven instructions, reading only LEFT and RIGHT — no up, down or fire — and otherwise falling into state 15's ground check. Exactly three entrants (`C6 06 77 03 04`, 3 hits file-wide): `CS:0x8c3e` (level start), `CS:0x8d6` (respawn, in the same routine that does `mov word [0x192],0x18`), `CS:0x1022` (teleport arrival).

⚠️ **The turn animation is not a symmetric ramp.** An earlier plausible reading had state 2 ramping `cl` 1..3 and state 3 ramping −1..−3. The bytes say otherwise: state 2 does `inc cl / cmp cl,3 / jnl → mov cl,6 / mov [0x377],1`; state 3 does `dec cl / js → mov cl,6 / mov [0x377],0`. Because the epilogue re-reads `[0x377]` *after* the handler, the handoff frame renders the **destination** base. Actual sequences:

| path | entry `cl` | rendered sprites |
|---|---|---|
| state 0 → 2 | 0 | **9, 10, 17** |
| state 4 → 2 (`cl=2`) | 2 | **17** |
| state 1 → 3 (`cl=2`) | 2 | **9, 8, 6** |
| state 4 → 3 (`cl=0`) | 0 | **6** |

There is no `cl` of −1..−3, and no sprite 11, 7 or 5. `[WF]` — the four rendered sequences above come from the workflow and were not re-read here; the `0x499A` gate and the three hitbox sites were.

**State 7 is a bare `RET` at `0x593a`.** Handlers are entered by `jmp` with the caller's return address still on the stack, so this returns *past* the `0x5e9b` epilogue — skipping the phase store, the event probe, the camera update, sprite selection **and** the draw. It is a freeze, not a pose; its `anim_base` of 9 is never read. States 27 and 28 are three instructions each and transition immediately, so their bases are never read either.

### The wall probes and the map cursor `[PROVEN]`

`0x496a` builds the plane-B cursor with no rounding at all:

```
si = 0x5004 + ((X & 0xFFE0) >> 5) + ((Y & 0xFFF0) << 3)     ; col = X>>5, row = Y>>4, stride 128
```

Walking probes three cells spanning the hero's 3-row height, but only at certain sub-cell positions — **and the two directions differ**:

| dir | gate | cells probed |
|---|---|---|
| left (`5A84`) | `(X & 0x1f) == 0` | `[si-1]`, `[si+0x7f]`, `[si+0xff]` |
| right (`5CCB`) | `(X & 0x1f) < 8` | `[si+1]`, `[si+0x81]`, `[si+0x101]` |

Any probed cell `== 1` aborts the step entirely (`jmp` to the epilogue without moving); outside those windows the step is unconditional. The asymmetry matches the straddle threshold used elsewhere — the hero's body is ~24–25 px wide inside a 32 px cell, so moving right it must be tested one step *before* it overlaps column+1.

### The ladder controls `[PROVEN]`, and `UNKNOWN_climb_down_rate` — CLOSED

The `add [0x17c],6` at `0x5663` is not a snap, as an earlier revision of this file guessed — it is the **climb-down step**, and the branch that reaches it is unambiguous because the test is a full-byte `cmp`, not a `test`:

```
54CD  cmp byte [0x382],0x2 / jnz 54D7
54D4    jmp 0x564b            ; input == EXACTLY 0x02 (DOWN alone) -> the climb block
```

Inside that block the Y step is `add word [0x17c],0x6`, reached from **both** arms of the animation ping-pong. So **climbing down is 6 px/tick**, against 4 px going up — deliberately asymmetric.

The rest of state 13's input dispatch decodes just as cleanly:

| input | effect |
|---|---|
| DOWN alone (`0x02`) | climb down 6 px (`0x5663`) |
| RIGHT + FIRE | `mov byte [0x378],1` → the ladder-fire path (`0x55cf`) |
| RIGHT + UP | `jmp 0x5907` → **jump right off the ladder**, seeding `cl = 0x0C` |
| RIGHT + DOWN, after `[0x353]` reaches 2 | dismount right: `mov [0x377],1 / mov cl,6 / add word [0x17a],8 / sub word [0x17c],4`, gated on three wall probes |
| LEFT … | the mirror, from `0x5560` |

Note the dismount needs `inc byte [0x353] / cmp byte [0x353],2 / jng` — a **two-tick hold** before it fires, so a tap of RIGHT+DOWN does not throw the hero off a ladder.

**The animation ping-pongs 0↔3** (`0x565C inc cl / cmp cl,3 / jg`, `0x5688 dec cl / jz`) with the climb-step sound `0x5931` fired **only at the two turn-arounds**, not per tick. Leaving the ladder at the bottom exits to state 26 with `xor cl,cl` and `and word [0x17c],0xfff0` — a Y snap to the tile row, which *is* what `0x5679` does.

`UNKNOWN_ladder_up_branch` — the plain climb-UP branch was not isolated to a single site; the `sub word [0x17c],4` sites at `55F6`/`561C` sit inside the *fire* paths and are gated on `test cl,0x1` (even phases only).

### `UNKNOWN_ladder_anim_phase` — CLOSED: `cl=1` is left-foot-forward, `cl=3` is right-foot-forward `[PROVEN]`

The residual (named in `gods-web/README.md`'s own status table) was purely which of the climb cycle's four `cl` values (sprites `anim_base(25)+cl` = 25/26/27/28) render which foot forward — not a movement-direction question, since the DOWN-only climb block applies the same `add [0x17c],6` regardless of phase (see above).

**Rendered from the validated atlas** (`tools/hero-sheet.mjs`-style extraction of `PALWAYS1` frames 25–28, the exact bytes the game's own atlas loader produces): the four frames are **not** a plain walk-style cycle — they alternate between two symmetric "neutral" poses and two asymmetric "reaching" poses:

| `cl` | sprite | pose |
|---|---|---|
| 0 | 25 (32×48) | legs extended/spread, both arms down — symmetric |
| **1** | 26 (32×48) | **screen-left arm raised, screen-left leg bent/forward** — reaching |
| 2 | 27 (32×43, shorter) | legs compressed/crouched, both arms down — symmetric, the cycle's other extreme |
| **3** | 28 (32×48) | **screen-right arm raised, screen-right leg bent/forward** — the mirror of `cl=1` |

**Confirmed live**, not just from the extracted atlas: paused `GAME.EXE` under the DOSBox debugger mid-climb (state 14, same `anim_base=25`), read `DS:0x36b` (the persisted animation phase) and `DS:0x377` (state) directly out of guest memory, and captured the exact composed frame at each reading. `cl=3`, captured live, shows the hero's screen-right arm raised and screen-right leg forward — pixel-identical in silhouette to the atlas-rendered sprite 28. `cl=2`, captured live a few ticks later (hero's Y had advanced, confirming real climbing motion, not a frozen state), shows the symmetric crouched pose — matching sprite 27 exactly, right down to the shorter frame height. Both checks used `DS` segment 4970 for this run (verified correct beforehand by reading the documented constant fallback-palette table at `DS:0x86` and getting an exact byte-for-byte match against the sixteen `0x0RGB` words already recorded in this document).

Since viewed from behind (climbing away from camera, no left/right mirroring the way a face-on sprite would have), screen-left/right corresponds directly to the hero's own left/right. **So `cl=1` is the left-foot-forward frame and `cl=3` is the right-foot-forward frame**, with `cl=0`/`cl=2` as the two feet-together passing poses at the ping-pong's ends (extended) and middle (crouched) respectively.

### `UNKNOWN_hero_sprite_anchor` — CLOSED `[PROVEN]`

The draw at `0x6049` computes `heroX − [0x1ae]`, `heroY − [0x1b0]`, which looks like a per-sprite trim offset. It is not. **All three writers of that pair** (`0x023f`, `0x0a14`, `0x92ad`) do the identical four instructions — `mov ax,[0xa] / mov [0x1ae],ax / mov ax,[0xc] / mov [0x1b0],ax` — immediately before `call 0x4993`. They are a **snapshot of the scroll origin taken before the state machine runs**, so the draw is plain screen-space conversion against the *previous* frame's camera.

**The sprite anchor is therefore exactly `(X, Y)`, top-left, with no offset.** Corroborated by the pickup test at `0x6069`, which uses `(X + 0x10, Y + 0x28)` as the hero's hot point — the centre-bottom of a 32×48 box anchored at `(X, Y)`.

**No handler in `0x4993`–`0x5e22` calls any graphics or sound driver export** (scanned for both thunk forms, zero hits) — all rendering is deferred to the epilogue's `call 0x6049`.

Handlers are entered by `jmp`, not `call`, with `CL` preloaded and the caller's return address still on the stack; they exit via `jmp 0x5e9b`. No handler offset repeats, but handlers **share code by tail-jumping into each other's bodies**, so a port cannot treat the 29 states as independent routines.

X/Y are proven integer by the map-pointer routine `1000:496a`: `col = (X & 0xFFE0) >> 5`, `row_stride = (Y & 0xFFF0) << 3` over map plane B at `0x5004` — 32×16 tiles, 128 columns, matching the `.MAP` format exactly.

**Movement constants.** Walk is a bare `add`/`sub word [0x17a],4`; **there is no X-velocity variable in the binary** — no acceleration to model. Gravity (`1000:48b0`) is `inc word [0x1b2]` clamped to `10`; falling advances `dY = 4 + v` = 5…14 px/tick. `GAME.EXE` contains **zero x87 instructions** (checked across Ghidra's listing *and* all 76 code gaps, plus zero `CD 34`–`CD 3D` FPU-emulator traps), so every constant is integer.

### The jump animation phase `[PROVEN]` — formerly `UNKNOWN_jump_anim_phase`

Both jump handlers open with a four-case chain on the incoming `CL` and the arc cursor `DS:0x358`, read **before** this frame's `+= 2`:

```
state 8, jump LEFT (base 31), CS:0x4E6C          state 9, jump RIGHT (base 29), CS:0x5064
  cl == 0x0D -> cursor < 4 ? 0x0D : 7              cl == 0x0C -> cursor < 4 ? 0x0C : 5
  cl == 6    -> 6                                  cl == 5    -> 5
  cl == 0    -> cursor < 4 ? 0 : 5                 cl == 0    -> cursor < 4 ? 0 : 4
  else       -> 6                                  else       -> 5
```

⚠️ **The asymmetry is real — do not mirror it.** State 8's `0x0D` exit stores **7** while its catch-all stores **6**, so jump-left has two distinct airborne frames; state 9 stores **5** in both places and has one.

**Where the high phases come from:** `0x0C`/`0x0D` are set *only* when jumping **off a ladder** — `CS:0x5912 mov cl,0xc` (right) and `CS:0x5927 mov cl,0xd` (left), both inside state 14 and both followed by `mov byte [0x358],0`. A ground take-off instead does `xor cl,cl / mov byte [0x358],0` (`CS:0x5A17`). That is the entire reason two entry phases exist: **the hero leaves a ladder in a visibly different pose.**

Resulting sprite sequences, all inside the hero range:

| take-off | sprites |
|---|---|
| ground, left | 31, 31, 36, 37, 37, … |
| ground, right | 29, 29, 33, 34, 34, … |
| ladder, left | **44**, 44, 38, 37, 37, … |
| ladder, right | **41**, 41, 34, 34, … |

The two leading frames are the crouch, which independently matches the arc table's leading zeros.

**The jump ignores gravity entirely — it is table-driven.** `1000:4f6f` walks a 23-entry `int16` delta table at `DS:0xd922`, subtracting each from Y (twice, when the double-jump power-up word `[0x174]` is set):

```
0 0 0 0 6 6 5 4 4 3 2 1 1 0 -1 -1 -2 -3 -4 -4 -5 -6 -6
```

Exactly symmetric — 4 ticks of wind-up, 32 px rise, apex, 32 px descent, then state `0x0b` (fall). **A port must copy this table; simulating it with gravity will not match.** Air control is a budget rather than a lockout: the rise is fully committed, and the fall allows 3 steering steps (12 px) before `DS:0x345` caps out.

**Ladder snap** rounds to the **tile origin**, not the tile centre: `add word [0x17a],0x20` / `and word [0x17a],0xFFE0` — the `AND` can only yield a multiple of 32.

## `UNKNOWN_DS_0192` — CLOSED: health, and a bar that lags it `[PROVEN]`

Two variables, not one, and conflating them is why this stayed open. **`DS:0x192` is the health TARGET** (max 24); **`DS:0x19a` is the DISPLAYED bar**, which chases the target one unit per frame — and the bar, not the target, is what everything else tests.

The chase routine is `FUN_1000_0dff`, called once per frame from the main loop at `0x02c6` (plus three other sites):

```
0DFF  mov ax,[0x19a]              ; displayed
0E02  cmp ax,[0x192]              ; vs target
0E06  jg  0xe10                   ; too high -> tick DOWN
0E08  jl  0xe2a                   ; too low  -> tick UP
0E0A  mov byte [0x3ad],0          ; equal: clear the one-shot latch / RET

0E10  dec word [0x19a]            ; DOWN one unit
0E15  cmp byte [0x3ad],0 / jnz    ; latch: play the hurt sound ONCE per descent,
0E1D  mov ax,0xe42 / call 0x22ca  ;   not once per tick
0E24  inc byte [0x3ad]

0E2A  mov byte [0x3ad],0          ; UP one unit, clamped at 24
0E2F  inc ax / cmp ax,0x18 / jng / mov ax,0x18 / mov [0x19a],ax
```

**Level start fills the bar visibly**: `0x84B mov word [0x192],0x18` then `0x851 mov word [0x19a],0x1` — target full, display 1, so it animates up over 23 frames.

| what | site | effect |
|---|---|---|
| combat damage | `0xACD3 sub [0x192],dx` | `dx = ((raw + 1) >> 5) + 5`, gated on `[0x172] == 0` (invulnerability) — see the correction below |
| fall damage | `0x4C4A`, `0x4CC1`, `0x4D4F` `sub [0x192],ax` | one site inside each of the three fall handlers |
| potions | `0x6310 +2`, `0x63BE +3`, `0x639D +4`, `0x6339 +0xc`, `0x6362 +0x18` | each followed by `cmp 0x18 / mov 0x18`, and each gated on `cmp word [0x19a],0` — **a potion does nothing while the bar reads zero** |
| respawn restore | `0x7D26 mov bp,[0x250] / 0x7D2A mov [0x192],bp` | `DS:0x250` holds the value to restore |
| the death test | `0x1BD cmp word [0x19a],0` → `jns`/`jnz`, else `jmp 0x9bb` | **reads the BAR, not the target** |

That last row matters for a port: because the bar lags by up to 24 frames (1.6 s at 15 Hz), a hit that takes the target to 0 does not kill immediately — the player has the bar's descent to drink a potion. Draining the target instantly would change the game.

`0x9bb` is a 17-call reset sequence ending `mov word [0x1d2],0x8c54 / mov byte [0x33c],0xff`; that it is specifically death-and-respawn is `[STATIC-INFERENCE]` from its shape — the lives decrement `0x93A dec word [0x224]` was **not** traced to this path.

**Consequence for the trigger table:** conditions 7 and 8 (`0x3F13`/`0x3F21`, `[0x192] >` / `< arg`) are **health** conditions. So the `"help bonus"` triggers that this document described as gating on *ammo* actually gate on the player being hurt — which is a far more sensible design and is the real mechanism behind GODS' reputation for adaptive difficulty.

⚠️ **Two corrections to the rows above.**

**1. The damage shift is `>> 5`, not `>> 4`.** `CS:0xACBE` is `inc dx` followed by **five** `D1FA` (`sar dx,1`) at `0xACBF`, `0xACC1`, `0xACC3`, `0xACC5`, `0xACC7` — ten bytes, closing exactly at `0xACC9 add dx,5`. So `damage = ((raw + 1) >> 5) + 5`.

This is not pedantry, because for System-B contact the `raw` strength is **the enemy's own HP** and shipped HP runs to 255:

| HP | 2 | 15 | 45 | 100 | 255 |
|---|---|---|---|---|---|
| `>> 5` (the bytes) | 5 | 5 | 6 | 8 | **13** |
| `>> 4` (the old note) | 5 | 6 | 7 | 11 | **21** |

The two disagree on **27 of the 31 distinct HP values that ship**. Against a maximum health of 24, the wrong reading makes one touch from a late-game creature cost 21 of 24 rather than 13 — very nearly instant death.

**2. Death fires when the bar reaches ZERO, not below.** Both branches of the test reach the same reset:

```
01BD  cmp word [0x19a],0
01C2  jns 0x1c7  / 01C4 jmp 0x9bb      ; bar <  0 -> death
01C7  jnz 0x1cc  / 01C9 jmp 0x9bb      ; bar == 0 -> death
```

So the condition is `bar <= 0`. Note the damage routine's own guard is `js` — it skips only when the bar is **negative** — so at a bar of exactly zero a hit still lands.

### The damage routine `CS:0xac59` `[PROVEN]`

Reached from 18+ sites through the `CS:0xa9e4` thunk plus four direct callers (`0x07ef`, `0x7d6e`, `0x8be2`, `0xb49f`).

⚠️ **The calling convention has a trap.** The routine opens `push ax / push cx / push dx / push bx` and then does `0xAC84 pop ax / 0xAC85 push ax` — which pops the **fourth** thing pushed, i.e. **BX**. Read literally as "pop ax restores ax", the routine appears to test the attacker's X against the hero's *Y* box, which is nonsense. The real convention is **`ax` = attacker X, `bx` = attacker Y, `bp` = strength**.

The box test is the same shape on both axes:

```
ac64  bx = heroX ; cx = bx ; bx += 0x0a ; cx += 0x16    ; hero core [X+10, X+22]
ac70  dx = [0x1e2] >> 1                                 ; half the attacker's width
ac76  ax += dx ; bx -= dx ; cx += dx
ac7c  cmp ax,bx / jl reject / cmp ax,cx / jg reject
```

which reduces to `heroX + 10 − w <= atkX <= heroX + 22`, and identically for Y over `[heroY + 8, heroY + 38]`. **Crouching (states 18/19) raises the top edge by 20** (`0xACA0 add bx,0x14`), so the dodge is real geometry rather than decoration.

⚠️ **`bp` is IN AND OUT.** Every caller tests its *sign* after the call (`0x07F2 or bp,bp / js`, `0xB4A2`, `0xA9E7`). The routine writes `bp = 0xFFFF` only when **`DS:0x34 == 0`** (`0xACDB`/`0xACE2`); the reject path leaves it untouched. So a hit with `DS:0x34 != 0` still damages the hero but reads as "no hit" to the caller. `UNKNOWN_DS_0034` — written 0/1/2 from eight sites, initialised to 0 at `CS:0x009e`, meaning unestablished. A port that returns a plain boolean loses this gate.

Also note `[0x1e2]`/`[0x1e4]` are **globals set by each caller immediately before calling**, not parameters — a stale-value hazard the moment two attackers are tested in one frame.

### Entity contact — `CS:0xff93`, shared by BOTH entity systems `[PROVEN]`

```
ff93  mov word [0x1e2],0x20 / mov word [0x1e4],0x20   ; a 32x32 creature
ffa2  mov bp,[di+0x8]              ; STRENGTH = the entity's own state word
ffa5  add ax,[0xa] / add bx,[0xc]  ; the caller passes SCREEN coords
ffaf  call 0xa9e4                  ; -> 0xac59
ffb4  mov [di+0x8],bp              ; AND WRITES IT BACK
ffb7  or bp,bp / js 0xffbf / ret
ffbf  mov word [di+0x4],0xffff / mov word [di+0x6],0   ; start the death frames
```

**Touching the hero costs him health AND kills the creature.** The entity's state word and the damage strength are literally the same word passing through one routine in both directions: the routine stores `0xFFFF` into it on a reported hit, the caller writes it straight back, and a negative state is *dying*. So creatures are not persistent contact hazards — each one gets one touch.

`0x7d6e` is **not** an attack despite calling the same routine: it saves `[0x192]` into `[0x250]` (the respawn-restore slot, read back at `0x7D26`) and brackets its call by patching the self-modifying gate `[cs:0x71d]` to `0x90`. It sits inside the death/respawn region.

⚠️ **`CS:0xff93` has two callers, one per entity system** — `CS:0xedf4` (System B, below) and a site inside System A's pipeline `CS:0xe001`. Contact *and* the draw `CS:0x3569` are shared; see *`UNKNOWN_sysA_movement_layer` — CLOSED*. An earlier revision of this heading said "System-B contact", which is why the System-A pipeline looked like it had no contact test of its own.

**The System-B caller is the per-frame entity driver, `CS:0xedf4`** — contact is tested every frame, immediately after the movement-mode handler runs:

```
edb8  cmp word [0x2fa],0 / jnz            ; a global gate
edc3  si = 0xdbe0 + [di+0xa]*4 / call ax  ; run the movement mode
eddd  ax = [di] ; bx = [di+2]
ede2  ax -= [0xa] ; bx -= [0xc]           ; world -> SCREEN
edea  [0x4] = ax ; [0x6] = bx             ; (these feed the draw call)
edf4  call 0xff93                         ; which adds the scroll back on
edf7  cmp word [di+0x8],0 / jns 0xee00
edfd  jmp 0xf02a                          ; NEGATIVE -> the death path
ee00  call 0x3569                         ; alive -> draw
```

The screen conversion at `0xede2` and the world conversion inside `0xff93` are a **round trip** — they exist because `[0x4]`/`[0x6]` are also the draw call's arguments, so a port may pass world coordinates directly.

### `UNKNOWN_creature_death_anim` — CLOSED: the death path draws through the SAME call as the alive path `[STATIC]`

`CS:0xF02A` — reached only from `CS:0xEDFD` on a negative `[di+0x8]` — is two instructions:

```
f02a  call 0x1000:efe7      ; a small helper, read below
f02d  jmp  0x1000:ee00      ; UNCONDITIONAL -> the SAME draw call the alive branch uses (-> CALL 0x3569)
```

So the earlier framing — *"`0xf02a` is unread, so a port should stop drawing a dying creature"* — is **wrong, and the opposite of what the bytes do**: a dying System-B entity is never skipped from the draw. It falls straight into the identical `CALL 0x3569` the live path takes, using whatever `[di+0x4]` ("frame", already documented as becoming the death-sequence counter post-death) currently holds, run through the ordinary `sprite = class_base + MODE_ANIM[mode] + frame` formula this document already has for `CS:0xf0ae`. A port that special-cases "stop drawing on death" diverges from the original, which relies on the death-sequence counter (not a skip) to produce the death animation's frames through the normal draw path.

`CS:0xEFE7` itself (the helper called first) reads a byte at `[SI+1]`, halves it (`SHR 1`), adds 1, divides by 10 (`DIV BL, BL=0xa`), and packs the quotient/remainder into a nibble pair (`SHL AL,1 ×4` then `OR AL,BL`) — the same divide-by-10, pack-two-digits shape this document's own BCD score routine (`CS:0x1950`) uses. `[SI]` here is not the entity pointer `DI` (which stays reserved for the draw call) — `UNKNOWN_efe7_source` narrows to exactly what `SI` points at and what the packed byte feeds; plausibly a per-kill score/popup award (consistent with, but not full confirmation of, this document's existing `[WF]` note that "kills award score by the same path as contact kills").

⚠️ **Invulnerability makes the hero a battering ram.** `0xACCC`'s `jnz` skips **only** the `sub` at `0xACD3`; the `DS:0x34` test and the `bp = 0xFFFF` store at `0xACDB`/`0xACE2` sit after the branch rejoins. So while `[0x172]` is set the hero takes no damage *and still kills everything he touches*.

## The camera `[PROVEN]`

Not a separate system — it is part of the state machine's per-tick epilogue, at `0x5ea4`–`0x5f76`, between the event probe and sprite selection. `DS:0x0a`/`DS:0x0c` are the scroll origin (the same pair the entity code uses for screen position).

```
5EA4  ax = [0x17a] - [0xa]        ; hero X on screen
5EAF  bx = [0x17c] - [0xc]        ; hero Y on screen
5EB3  cmp byte [0x32],0 / jz      ; UNKNOWN_camera_alt_path — the other branch
                                  ; calls 0x5e22 and skips the camera entirely
5EC0  cmp ax,0x50 / jg            ; ax <= 80  -> sub [0xa],4, clamp at 0
5ED4  dx = 0x140 - 0x70 = 0xd0    ; ax >= 208 -> add [0xa],4, clamp at 0xec0
5F33  cmp bx,0x50 / jng           ; bx > 80 -> dx = (bx-80)>>1 (SAR); if dx==0
                                  ;            inc [0xc]; add [0xc],dx; cap 0x360
5F59  cmp bx,0x20 / jnl           ; bx < 32 -> mirror, floor at 0
```

- **Horizontal: a hard dead zone, panned at a flat 4 px/tick.** Note the asymmetry — the left test is `<=` and the right `>=`, so the zone is **open on the left**: screen X in `(80, 208)`. Writing it closed makes the camera jitter on the boundary. `0xec0 + 320 = 4096` = the world width, exactly.
- **Vertical: proportional catch-up at half the excess, minimum 1 px**, dead zone screen Y in `[32, 80]` inclusive at both ends. The clamp `0x360 = 864` is exactly `1024 − 160`, i.e. it guarantees the **160-scanline** playfield region never runs past the bottom of the world.

⚠️ **Correction to an earlier revision of this file, which read "the playfield is 160 px tall".** 160 is the height of the *backdrop region*, not an established visible height. The three measurable facts, and what they do and don't settle:

| | measured | from |
|---|---|---|
| backdrop save/restore region | **160 scanlines** | `VGA:0x10E8 mov cx,0x1b80` = 7040 B ÷ 44 B/row |
| tile renderer coverage | **11 cols × 9 rows = 352 × 144 px** | `VGA:0x113D mov word [ss:0x400],0xa` and `0x1136 mov word [ss:0x402],0x8`, both `dec`/`jns` so N+1 iterations; the row advance `add dx,0x294` (660) plus the inner loop's own 44 = 704 = 44×16, one tile row |
| camera Y clamp | `0x360` = `1024 − 160` | `VGA` n/a — `GAME:0x5F51` |

**There is no hardware split screen.** `VGA.EXE` touches the CRTC at exactly two sites — `0xEB9` (start address, indices `0x0C`/`0x0D`) and `0xF39` (index `0x13`, Offset). Index `0x18` (Line Compare) is never written, so the status panel is drawn into the same page as the playfield rather than being a hardware-split region.

### `UNKNOWN_playfield_height` — CLOSED: the visible playfield is the full 160-row backdrop `[PROVEN]`

Measured live under DOSBox (`dosbox-automation` debug build, `GAME.EXE`, real gameplay — not the demo/attract mode) by fetching the raw 320×200 composed framebuffer directly (`GET /api/v1/video/frame?mode=raw`, the same bytes `screen_capture(mode:"raw")` returns) and reading it pixel-by-pixel. Two independent captures — a fresh level-1 spawn room and a ladder room several screens away, entirely different tile art in both — show the **identical** boundary: ordinary playfield tile art through row 159, then **row 160 is a bright, near-uniform decorative border strip spanning the full screen width** (sampled RGB triples like `(255,255,255)`/`(182,182,219)` at every column checked, in both captures), with the black HUD background and its icons/digits starting at row 161. The transition is exact to the pixel and reproducible across rooms/levels.

**So the visible playfield is exactly 160 scanlines (rows 0–159), matching the backdrop save/restore region — not the 144 px of tile-renderer coverage.** The status panel occupies the bottom 40 rows (160–199), with row 160 itself belonging to the HUD's own decorative frame, not the playfield. This settles which of the three previously-tabulated candidate figures (160-row backdrop / 144-row tile coverage / `0x360` camera clamp) is the real viewport: **160**, consistent with (and now independently confirming) the camera clamp `0x360 = 1024 − 160` already established from the code. The 16 px gap between the 144-row tile-compositing pass and the 160-row visible playfield (rows 144–159) is real but is a *different* quantity than "viewport height" — it's how much of the visible playfield the per-frame tile loop actually redraws, not how tall the playfield is; that band is presumably left showing the saved backdrop image, un-refreshed by tile compositing most frames. A port should size its camera-visible viewport at 160 px tall, not 144.
- **A scripted nudge exists** at `0x5ef1`: on world 3 sublevel `'a'`, once the hero enters the box `x ∈ [0x340, 0x400]`, `y ∈ [0x2a0, 0x330]`, a latch at `DS:0x3d5` is set and `camY −= 4` with `bx −= 0x14` applies on every later tick.

### `UNKNOWN_camera_alt_path` — CLOSED: a scripted pan-to-target camera mode `[PROVEN]`

`DS:0x32` is a small-integer mode selector for the camera epilogue, read at `CS:0x5EB3` (`!= 0` → skip the whole hero-follow camera and `call 0x5e22` instead) and twice more *inside* `0x5e22` itself (`cmp byte[0x32],2 / jg`, at `CS:0x5E4C` and `CS:0x5E84`).

**`CS:0x5e22` is a second, independent camera-mover**, pushing the scroll origin `[0xa]`/`[0xc]` toward a *fixed* target pair `DS:0x2ec`/`DS:0x2ee` instead of toward the hero:

```
5E22  bp := 0                              ; a per-call "both axes reached" counter
5E24  dx = [0x2ec] ; cmp dx,[0xa] / jz 5E53 ; X already at target -> count it, skip the step
5E2E  jg 5E37 (target > current -> ADD [0xa],4)  else  SUB [0xa],4     ; flat ±4/tick, same rate as the normal camera's X
5E3C  re-test dx==[0xa]; if so, SNAP [0xa]:=dx exactly (overshoot correction),
        then cmp byte[0x32],2 / jg 5E54 (skip the count when the mode is > 2) else INC bp
5E54  dx = [0x2ee] - [0xc]                  ; Y delta
        jg (target below) / else (target above): SAR dx,1 (halve, floor -1 on the
        odd remainder — the IDENTICAL proportional-catch-up shape the normal camera's
        own Y axis uses), ADD [0xc],dx
5E7A  re-test [0x2ee]==[0xc]; if so and byte[0x32]<=2, INC bp (Y counted as reached)
```

So `0x5e22` is not a stub — it is the *general form* of the documented per-tick camera (flat ±4 X, proportional-halving Y), just aimed at a scripted world-space point instead of the hero's screen position, and it tracks how many axes have converged in `bp` (unread by the caller in the bytes examined here, so its consumer is not chased further).

**`DS:0x32` values 1 and 3 are both set by the same per-world scripted-sequence machinery this document already documents** (`DS:0x34`/`DS:0x375` cutscene engine, `CS:0xC49C` installer, `SS:0x537a` per-world entry table): two call sites, `CS:0xCBCE`/`CS:0xCBD4` (target `0xb60,0x78`) and `CS:0xCD7B`/`CS:0xCD81` (target `0xa0,0x354`), each set `DS:0x2ec`/`DS:0x2ee` and then `cmp byte[0x32],0 / jnz skip / mov byte[0x32],1` (turn the alt-camera on, once, if not already on); a third site, `CS:0xCC07`, sets it to **3** after a scripted countdown (`DS:0x250`) expires and a driver export call runs, immediately followed by a self-modifying gate patch (`mov byte cs:[0xcbc7],0xc3`) disabling the routine that reached it — a one-shot step in a larger scripted sequence.

**`DS:0x32` is reset to 0 on hero spawn/respawn**, `CS:0x8D43`–`0x8D53`, inside the same routine this document already cites for state-4 spawn-idle and the health-bar refill (`CS:0x8d6`/`CS:0x84B`): `cmp byte[0x32],0 / jz skip`, else show a message (`DX = filename-template+0x4a`, the same `call 0x37e3` used for the .MAP/PALFILS message path) and then unconditionally `mov byte[0x32],0` — so any in-flight scripted pan is cut short and the camera returns to normal hero-follow the instant the hero dies or a level (re)loads reaches this point.

A port implementing only the dead-zone hero-follow camera diverges exactly during these per-world scripted sequences (values 1/3, targets `(0xb60,0x78)`/`(0xa0,0x354)` in the two sites read here) and is safe everywhere else, since `DS:0x32` starts at 0 (BSS) and is force-reset on every spawn.

### `UNKNOWN_camera_init` — CLOSED: the level-load camera origin is `spawnPos − (0x90, 0x48)`, clamped `[PROVEN]`

The real-gameplay half of this question — as opposed to the attract-mode teleport positions this document already had — is `FUN_1000_2189` (`CS:0x2189`–`0x21C1`), reached from three genuine gameplay contexts, none of them the demo cycler:

```
2189  ax -= 0x90 ; bx -= 0x48                 ; spawn/arrival point -> camera offset
218f  cmp ax,0 / jns / xor ax,ax              ; floor X at 0
2196  cmp bx,0 / jns / xor bx,bx              ; floor Y at 0
219d  cmp ax,0xec0 / jl / mov ax,0xec0        ; ceiling X at 0xec0  (world width - 320)
21a5  cmp bx,0x360 / jl / mov bx,0x360        ; ceiling Y at 0x360  (world height - 160)
21ae  mov [0xa],ax / mov word [0xc],bx        ; SET the scroll origin
21b5  cmp byte [0x3d5],0 / jz 0x21c1
21bc  sub word [0xc],0x20                     ; world-3 scripted-nudge latch: an extra -32 Y
21c1  ret
```

The clamp bounds are byte-for-byte the `0xec0`/`0x360` this document already establishes for the hero-follow camera's own per-tick clamp (*The camera*, above) — level-load init and per-tick tracking share one pair of world-edge limits, not two independently-authored ones. The `(0x90, 0x48)` offset is deliberate: it places the spawn point at screen `(144, 72)`, squarely inside the documented dead zone (`X ∈ (80, 208)`, `Y ∈ [32, 80]`) — so the first frame after a camera reset needs no catch-up snap, because the hero already sits where the per-tick clamp would leave him undisturbed.

**Three real callers, all previously untraced:**

| site | when | gate |
|---|---|---|
| `CS:0x8CA7`, inside `FUN_1000_8c34` | fresh level load | none — unconditional, the routine's first substantive act after clearing the phase flags and setting state 4 |
| `CS:0x08D3`, inside `FUN_1000_0845` | respawn after death (lives remain) | `cmp byte [0x32],0 / jnz` — skipped while a scripted alt-camera pan (see `UNKNOWN_camera_alt_path` above) is in control |
| `CS:0x100F`, inside `FUN_1000_0fac` | teleport-stone arrival | none — unconditional |

**The level-load call chain, traced end to end:**

```
CS:0x0092  FUN_1000_006f (main loop prologue)  -> CALL FUN_1000_8c34, unconditional on every level (re)entry
CS:0x8C48  FUN_1000_8c34                        -> [0x17a]/[0x17c] (hero pos) := [0x15a]/[0x15c]
CS:0x8C99                                        -> [0x16e]/[0x170]           := [0x15a]/[0x15c]  (2nd copy)
CS:0x8CA7                                        -> CALL FUN_1000_2189([0x15a],[0x15c])
```

`DS:0x15a`/`0x15c` — the level's own spawn point — is **not** derived from the `.MAP`/`PALFILS` data. It comes from a small, previously-undocumented **hardcoded per-world table at `DS:0xe8ca`: 4 records of `{u16 x, u16 y}`**, indexed by `DS:0x42` (world 1–4) inside `FUN_1000_2a37` (`CS:0x2AB5`–`0x2ACC`, the same function this document already credits with the `.MAP`/`PALFILS` loads). Read directly off the image:

| world | spawn `(x, y)` | camera `(x, y)` after the clamp |
|---|---|---|
| 1 | `(64, 944)` | `(0, 864)` — X floors at 0, Y ceilings at `0x360` |
| 2 | `(3888, 112)` | `(3744, 40)` — inside both ranges, no clamp |
| 3 | `(64, 48)` | `(0, 0)` — both floor |
| 4 | `(384, 496)` | `(240, 424)` — inside both ranges, no clamp |

All four spawn points fall inside the documented 4096×1024 world bounds, which is itself a check on the read — a wrong table offset or wrong world index would put at least one of the four outside `[0,4096)×[0,1024)`.

**Respawn recomputes from the hero's actual (possibly zone-adjusted) landing position, not the level's static spawn table.** `FUN_1000_0845` — reached only by `JMP` from `CS:0x0940`, itself the tail of the death-reset chain at `CS:0x09BB` (called from the main loop's death test, `CS:0x01C4`/`0x01C9`) — this closes this document's own previously-flagged loose end: *"the lives decrement `0x93A dec word [0x224]` was **not** traced to this path"* is exactly `CS:0x093A`, now traced. `FUN_1000_0845` starts from the second spawn-point copy `[0x16e]`/`[0x170]` that `FUN_1000_8c34` stashed at level-load time, adjusts it through a small `SS:0x365a`-resident, 14-entry, stride-6 arrival-zone table keyed by a plane-B probe at the rounded landing tile (`UNKNOWN_respawn_zone_table` — a new, narrower residual; not traced past confirming it feeds `[0x17a]`/`[0x17c]` before the camera call), and only then calls `FUN_1000_2189` with the final, possibly-nudged position. So a respawn's camera can differ from the level's own opening camera when the zone table nudges the landing tile.

A port that seeds the scroll origin to `(0,0)` or to the raw, unclamped spawn point on every level load will visibly snap on the first frame in three of the four worlds (1, 2 and 4 — world 3's spawn point happens to clamp to `(0,0)` either way, so it alone matches by accident).

## The plane-B event probe rounds X but floors Y `[PROVEN]`

`0x5fab`, called from the epilogue at `0x5ea0`:

```
5FB2  add ax,0x10 / and ax,0xffe0     ; col = (X + 16) >> 5   -- NEAREST column
5FB8  and bx,0xfff0                   ; row = Y >> 4          -- FLOORED
5FBE  sar ax,1 (x5) / shl bx,1 (x3) / si = 0x5004 + ax + bx
5FD2  cmp byte [si],2 / jna           ; skip unless > 2
```

The asymmetry is deliberate: the hero is 32 px wide so his **centre** picks the column, while Y is floored to the row his head is in. A port using `X >> 5` fires **every** plane-B event 16 px late — measured across all 8 shipped levels, all 1923 event cells shift by exactly 16 px.

## Randomness — a replayed table, not a PRNG `[PROVEN]`

`GAME.EXE` has only 14 `MUL`/`IMUL` instructions total, all register-operand: **there is no LCG or multiply-based generator.**

1. **Seed** (`1000:236c`, once at init): `sub ah,ah / int 1Ah / mov [0x122],dx` — the low word of the BIOS tick count. **Wall-clock seeded, so the original is not reproducible run-to-run.**
2. **Mixer** `FUN_1000_2375` — a hand-rolled bytewise `RCR`/`XOR` shuffle over `[0x122]`.
3. **Table** `FUN_1000_37f6` — 256 words into `1ffd:7e14`, regenerated **once per level load** (called from `1000:2b2a`, right after the `.MAP` loader), retried if all-zero, then 1–2 entries forced to zero.
4. **Draw** `FUN_1000_3836` — **59 call sites**, the game's only random source: return `[0x7e14 + [0x160]]`, then `[0x160] = ([0x160] + 2) & 0x1FF`.

## Entity records — three structs, three registers `[PROVEN]`

⚠️ **Correction to earlier notes in this file.** Fields previously listed as *entity* fields were mostly not. Inside the entity loop three different structures are live at once, one per register:

| Reg | Points at | System A | System B |
|---|---|---|---|
| **DI** | entity record | `DS:0x0e96`, stride `0x28`, 10 × 16 | `DS:0x0536`, stride `0x18`, 10 × 10 |
| **SI** | **group descriptor** | `DS:0x9d60` (PALFILS `+0xD58`), stride `0x16`, **50 records** | `DS:0xa1ac` (PALFILS `+0x11A4`), stride `0x16`, **50 records** |
| **BP** | **group runtime** | `SS:0x3768`, stride `0xe4`, 10 slots | `SS:0x36b4`, stride `0x12`, 10 slots |
| | per-frame head | `0xdf39` | `0xed15` |
| | allocator | `0xde42` | `0xde08` |

⚠️ **There are TWO parallel entity systems, not one.** Both run every frame, discriminated by `DS:0x3c2` (`0x00` for A, `0xff` for B — exactly three references binary-wide). Note the descriptor count is **50 records on file** but only **10 live runtime slots** — easy to conflate.

So `+0x11` (previously documented as a per-group random index) is a **`BP` group-runtime** field — entity `+0x11` is never touched, being the high byte of the word at `+0x10`. Likewise `[si+0xb]` and `[si+0xf]` are **group-descriptor** fields, and the dispatchers' `[si+8]`/`[si+9]` are too. Every word read through `SI` is byte-swapped (`xchg al,ah`), confirming it is big-endian **loaded file data** rather than runtime state.

`DS:0x9d60` is a **fifth `PALFILS` window**: `0x9008 + 0xD58 = 0x9d60`, landing inside the previously unaccounted `+0x0718…+0x11a4` span.

`SI` aliases the entity in exactly five places, via two shadow globals (`DS:0x2a2` = saved DI, `DS:0x294` = current group's entity base). `DS:0x294` is **shared with a second, parallel 0x18-byte record system** at `DS:0x0536`, so a port must not treat it as a fixed global.

Two entity fields are settled and worth stating, because they re-confirm the tile geometry independently: **`+0x00` = world X**, spawn-quantised to 32 px, and **`+0x02` = world Y**, quantised to 16 px. Screen position is `[di+0] − [0xa]`, `[di+2] − [0xc]`. `+0x04` is the animation frame index (and, after death, the death-sequence counter); sprite id = `0x5b + [di+4]`.

Only **one** driver export ever receives the entity pointer: export 38 (`0xdee3 call far [ss:0x52ea]`), the initialiser.

## Enemy AI — the three answers a port needs `[STATIC]`

**(a) Do entities track the hero? Yes — as a goal POINT, never as a homing step.**
`0xe7ca` does `mov ax,[0x17a] / mov bx,[0x17c] / add bx,8 / mov [di+0x1c],ax / mov [di+0x1e],bx` — it writes an **absolute destination**. There is no sign test and no per-frame `enemy − hero` difference anywhere in the behaviour bodies. Whether an enemy homes or patrols is decided one layer up — but ⚠️ **the two entity systems use different layers, and this routine belongs to System A.** `0xe7ca`'s `[di+0x1c]`/`[di+0x1e]` fields only fit System A's `0x28` stride, and **System A never reads `DS:0xdbe0`** (that immediate occurs exactly twice file-wide, `CS:0xedc3`/`CS:0xf0ae`, both System B): its selector is the sticky `[di+0x24]` byte resolved in pipeline stage 1, `CS:0xe6e4`. `DS:0xdbe0` is **System B's** movement-mode table, and there the decision is the pathfinder verdict `DS:0x2ac`. See *`UNKNOWN_sysA_movement_layer` — CLOSED*. **A port must not put homing logic in these routines.**

**(b) Do the behaviour bodies probe the map planes? No — but the proof needed a hole closed.** A transitive closure over 18 routines found no reference to `0x3004`/`0x5004`, but that argument covered indirect *calls* and missed an indirect *read*: `0xe8a3 mov si,[0x208] / mov ax,[si]`. Resolving every write to `[0x208]` shows it is a cursor into the `DS:0xb5dc` marker array (clamped to 20 records at `0x1648`), not a map pointer. Corroborated by a raw-immediate scan for `04 30`/`04 50` — 74 hits file-wide, **zero inside any behaviour body** — and by disassembling export 39 in *both* `VGA.EXE` and `EGA.EXE` (byte-identical, pure arithmetic, no memory access), closing the last far-vector escape.

  Map probing does exist, one level up: `0xf0d9`, `0xf0fc`, `0xf554`, `0xf55f` each build `0x5004 + (x>>5) + (y>>4)*128`, and `0xf11f`/`0xf1ef` probe `[di−1]`, `[di+0x7f]`, `[di+0xff]`, `[di+1]`, `[di+0x81]`, `[di+0x101]` for ground and wall. **That is the platform-edge logic, and it belongs to the movement layer.**

**(c) Which behaviours are randomised?** `A0` (`0xe77b`), `A1` (`0xe9da`, ×4) and `A2` (`0xe88c`, but only when `(cx & 3) == 0`), plus both dispatchers' nibble coin-flip (`0xe75f`, `0xf710`). `A3`–`A8` are fully deterministic. So **destination selection is randomised; the goal-grid painters are not.** Remember the source is the replayed 256-word table, not an LCG.

## The enemy pathfinder — `UNKNOWN_f586_verdict_semantics` CLOSED `[PROVEN]`

`CS:0xf586` is a cost-bounded graph search, and its single output word `DS:0x2ac` is what turns a System-B enemy from a patroller into a hunter. The walk handlers call it **once per tile crossing** — so the verdict is *sticky for a whole tile*; between crossings the entity just re-runs its current mode.

⚠️ **It is NOT a breadth-first queue**, though an earlier revision of this section called it one. Push is **first-fit from slot 0**; pop is a **cyclic cursor that does not advance past the slot it just emptied** (`0xf5ff inc cx` with no `add si,8`), so the emptied slot is rescanned and `cx` is charged twice per expansion — the cursor wraps after roughly 16 expansions, not 32. **Cost never orders anything**; it is used only for the budget reject, the grid dedup and the tails. A port written with `queue.shift()` changes the expansion order and can change the verdict.

```
f586  mov word [0x2ac],0xffff   ; verdict   := none
f58c  mov word [0x2ae],0xffff   ; best cost := infinity
f592  ax = [di] - [0xa] ; bx = [di+2] - [0xc]        ; screen position
f59f  cmp ax,-64 / jng ret   ... cmp bx,0xe0 / jnl ret   ; THE CULL
f5b7  call 0xf68f             ; clear the 32-slot open list, count := 0
f5c0  call 0xf6db             ; clear the visited grid, then seed
f5c6  mov word [0x2b0],0      ; depth := 0 — this is the ROOT
f5d5  call 0xf64d             ; expand the root
f5d8  cmp word [0x2ae],0x10 / jna done      ; GOOD ENOUGH -> stop early
      ... pop a node, expand, repeat ...
```

**The cull is part of the algorithm, not an optimisation.** An entity outside the window returns with the verdict still `0xFFFF`, so **off-screen enemies never hunt** — they fall through to patrol every tick.

### The verdict domain — 8 values, decoded at `CS:0xf2ac` `[PROVEN]`

```
f2ac  mov ax,[0x2ac] / cmp ax,1 / jg 0xf2b8
f2b4  mov [di+0xa],ax          ; 0 or 1 -> mode = verdict (walk left / right)
f2b8  sub ax,2 / mov bx,ax / and bx,1 / add bx,4
f2c3  mov [di+0xa],bx          ; mode = 4 + ((v-2)&1)  -> hop left / hop right
f2c6  and ax,0xfffe
f2c9  mov bx,7 / or ax,ax / jz store
f2d0  mov bx,9 / sub ax,2 / jz store
f2d8  mov bx,0xd
f2db  mov [di+0x12],bx         ; THE HOP CURSOR
f2de  mov word [di+0x4],0      ; frame := 0
```

| verdict | effect | | verdict | effect |
|---|---|---|---|---|
| `0xFFFF` | no path — caller patrols | | 4 / 5 | hop left / right, cursor 9 |
| 0 / 1 | walk left / walk right | | 6 / 7 | hop left / right, cursor 13 |
| 2 / 3 | hop left / right, cursor 7 | | | |

**The hop cursor is a REACH, not a phase.** The sibling seeders `CS:0xf2e4`/`0xf2fc` compute it as `5 + 2*(d − 1)` from an explicit distance, so 7/9/13 are hop lengths **2, 3 and 5**. That is why the verdict needs six hop values rather than two — direction *and* reach. All three seeds land in the arc table's flat `−8` tail, so the cursor must count **down** toward the `+8` rise at index −6; the loop that walks it (`CS:0xf316`) is still unread, so `UNKNOWN_sysB_hop_cursor` stands for the traversal only.

### ⚠️ The two walk handlers test the verdict against **different** constants

```
walk LEFT  (CS:0xf147)   cmp [0x2ac],0 / js patrol / jz keepGoing / call 0xf2ac
walk RIGHT (CS:0xf209)   cmp [0x2ac],0 / js patrol
                         cmp [0x2ac],1 / jz keepGoing / call 0xf2ac
```

Each handler compares against **its own mode number** and treats "the search agrees with what I am already doing" as a no-op so the ordinary step runs. A port that tests both against 0 makes right-walkers re-apply their mode every tile and reset their animation frame.

### The visited grid — 20 × 20 at `SS:0x1c70`, and it closes `UNKNOWN_EXPORT40_TARGET` `[PROVEN]`

`CS:0xf6db` clears it with `mov cx,0xc8 / rep stosw` = 400 bytes. The pitch is proven **at the use site**, not inferred:

```
f7dd  call word far [ss:0x52ee]     ; graphics EXPORT 39 -> cx = cell index
f7e3  js 0xf7fe / cmp cx,0x17c / jnl 0xf7fe
f7eb  mov si,0x1c70 / add si,cx
f7f0  mov byte [ss:si],0xff
f7f4  mov byte [ss:si+0x14],0xff    ; +20 = EXACTLY ONE ROW DOWN
```

The bound `0x17c` is `400 − 20`: the last row is excluded precisely because the writer also touches `+20`. Pitch 20 and 400 bytes together force 20 × 20. Export 39's `+0x55` bias is `20*4 + 5` — a **5-column, 4-row margin** around the 11 × 10 visible tile field, so the search may step off-screen a little without leaving the grid.

**`UNKNOWN_EXPORT40_TARGET` — the arithmetic is now decoded, but the routine is unreachable.** The unknown stood because "the pitch disagrees with export 39". It does, deliberately: the two exports address **two different grids**.

```
export 39  VGA:0x203   (x-8)>>5 + 20*((y-8)>>4) + 0x55     the 20-wide search grid
export 40  VGA:0x22e   add ax,0x10 / and ax,0xffe0 ...     the 128-wide MAP
                       add bp,ax / add bp,bx / retf
```

Export 40 is the driver-hosted version of the hero's own event probe at `CS:0x5fab`. The one thunk that references its slot, `CS:0xf544`, feeds it `[0x17a]`/`[0x17c]` with `bp = 0x5004` — *"which plane-B cell is the hero standing in"* — so the intent is clear.

⚠️ **But `CS:0xf544` is DEAD.** An exhaustive scan of every `E8`/`E9` rel16 and every `EB`/`7x` rel8 in the image finds **zero** references to it, and the raw word `0xf544` appears nowhere in the file, so it is not in a table either. Its sibling `CS:0xf55f` is likewise unreferenced, while `CS:0xf554` — the inline, *floored*-column entity version — has 10 live callers. So: **export 40's semantics are proven from its own bytes; its purpose is strongly indicated by a dead thunk; and no live path in `GAME.EXE` calls it.** `UNKNOWN_export40_live_caller` — **CLOSED negative `[STATIC, exhaustive]`**: the scan above already is the complete answer — zero near-jump/call references and zero table appearances, the same two-pronged sweep this document uses elsewhere (e.g. `UNKNOWN_365_second_incrementer`) to certify an address as genuinely unreachable, not merely unfound.

⚠️ **Two cell-address rules, and they round differently.** A port will naturally write one helper and use it everywhere:

| | rule | column |
|---|---|---|
| **entity** | `CS:0xf56a` `and cx,0xffe0` | **floored** |
| **hero** | export 40 / `CS:0x5fab` `add ax,0x10` first | **rounded to nearest** |

Both floor the row. Only the hero rounds the column, because he is 32 px wide and his centre should pick it.

### The open list — `DS:0xd476`, 32 × 8 bytes `[PROVEN]`

Cleared by `CS:0xf68f` (`mov cx,0x80 / rep stosw` = 256 bytes). Count in `DS:0x2b6`.

Slots are `{u16 x, u16 y, u16 cost, u16 firstMove}`.

**Push, `CS:0xf6a8`:** refuses when `31 < count`; a slot is free when **both** `[si]` and `[si+2]` are zero. `pop bp` at `0xf6ca` **precedes** the stores, which is exactly what makes `[si+4]` the *caller's* value rather than the loop counter `0x1f` — and both pushers (`0xfd2f`, `0xfc93`) leave the node's **cost** in BP. That closes what an earlier revision called `UNKNOWN_openlist_field4`.

⚠️ **A node at `(0, 0)` is indistinguishable from an empty slot** — every emptiness test is `x | y`. Adding a `used` flag to "fix" it changes which nodes survive.

⚠️ **Do not reproduce the spin:** if `[0x2b6]` ever disagrees with actual occupancy the scan never terminates. Assert the invariant instead.

### The five min-update tails are **not uniform** `[PROVEN]`

Each producer commits its candidate through its own tail, and three different comparison shapes appear:

| tail | producer | test | commits on | **value stored to `0x2ae`** |
|---|---|---|---|---|
| `0xFB1A` | hop, mid-flight probe | `cmp cx,[0x2ae] / ja` | `<=` unsigned | ⚠️ **`cx` — a sub-tile X offset** |
| `0xFC98` | hop, landing | `cmp bp,[0x2ae] / ja` | `<=` unsigned | cost |
| `0xFD3F` | drop | `cmp dx,[0x2ae] / ja` | `<=` unsigned | cost |
| `0xFE26` | walk right | `cmp dx,[0x2ae] / jc` | **`<` STRICT**, unsigned | cost |
| `0xFF07` | walk left | `[0x2ac] < 0` bypass, then `cmp dx,bx / jl` | **SIGNED**, strict | cost |

One is strict where the others are not, and one is signed where the others are unsigned. A port that unifies them scrambles left/right or drops equal-cost improvements.

⚠️ **And `0xFB1A` does not store a cost at all.** `0xFADF mov si,cx` / `0xFB0A mov cx,si` parks `CX` across the grid-pointer call and restores it, then `0xFB41` writes *that* to `[0x2ae]` while the computed cost sits unused in `AX`. `cx ∈ {0, 4, …, 28}`, so a mid-flight goal hit with `cx <= 16` **trips the main loop's own `<= 0x10` cutoff and ends the search on the spot** — the loop's stop test is being compared against something that is not a cost. `UNKNOWN_fb1a_cx_intent`: the behaviour is proven, the intent is not. Implement it verbatim.

**How the first move gets back to the root.** Tails 4 and 5 both special-case `[0x2b0] == 0` — tail 4 substituting `cx = 1`, tail 5 `cx = 0`. `[0x2b0]` is the depth of the node being expanded, so **at the root the move *is* the direction**; deeper, `[0x2b2]` carries the first move inherited through the queue. Tails 1 and 2 do the same job with `[si+4] == 0 → verdict = [0x2c4]`.

### The seed — four goal strategies, chosen at random `[PROVEN]`

This is where the enemy's *personality* lives, and it is the part that makes the search a hunt rather than a wander. `CS:0xf6db` clears the grid, then picks a seeding strategy:

```
f6ed  cmp byte [0x399],0 / jz 0xf6f7 / jmp 0xf794   ; global override
f6f7  mov cl,[si+0x8] / mov dl,cl
      and cx,0xf                     ; cl = LO nibble -> strategy A
      and dx,0xf0 / shr dx,1 (x4)    ; dl = HI nibble -> strategy B
f70b  mov bl,[si+0x9] / sub bh,bh
f710  call 0x3836 / and ax,0x7f      ; random, 0..127
f716  cmp bx,ax / jnl 0xf71c
f71a  xchg cx,dx                     ; SWAP when [si+9] < rand
f71c  mov si,0xd966 / shl cl,1 / add si,cx / mov si,[si] / jmp si
```

So descriptor **`+0x08` carries two strategy ids, one per nibble**, and **`+0x09` is a 7-bit weight favouring the LO one**: `+9 = 127` can never swap (rand ≤ 127, so `127 < rand` is never true), `+9 = 0` swaps 127 times in 128.

**The jump table at `DS:0xd966` is only FOUR entries** — index 4 onward is zeros and then unrelated data. There is **no bounds check** on the nibble, so a value > 3 would jump into garbage. The shipped data never does, and that census is what proves the size: across all **270 live System-B descriptors both nibbles are in {0,1,2,3} and `+9` is in 0..127** — exactly the table width and the `0x7f` mask.

| n | routine | goal region | shipped nibbles |
|---|---|---|---|
| 0 | `0xf854` | **the hero's own 3-cell column** — direct pursuit | 298 |
| 1 | `0xf729` | a **box ±64 px around the hero**, 8 cells a side | 32 |
| 2 | `0xf794` | **the marker list** — the *"attracts monsters"* potion | 201 |
| 3 | `0xf800` | the **first on-screen per-world waypoint** | 9 |

### `UNKNOWN_seed_2` / `UNKNOWN_seed_3` / `UNKNOWN_399_source` — all CLOSED `[PROVEN]`

**Strategy 2 is a potion effect, not an AI variant.** `DS:0x399` forces *every* System-B enemy onto strategy 2 regardless of its own descriptor, and it has exactly two writers — cleared at `0x1437`, set at `0x164d` inside the object-pickup dispatcher under `cmp dx,0x2d`:

```
1632  inc byte [0x398]                ; append a marker
1636  cmp byte [0x398],0x14 / jg      ; clamp at 20
163d  cmp dx,0x2d / jnz 0x1652        ; object TYPE 45 only
1642  mov word [0x208],0xb5dc         ; reset the marker cursor
1648  mov byte [0x398],0x14           ; count := 20
164d  mov byte [0x399],0x1            ; force strategy 2 globally
```

`POBJECTS` type 45 reads **`"potion..........attracts monsters"`**. So the mechanism is exactly what the item says: enemies stop heading for the hero and head for the marker list at `DS:0xb5dc` instead. (Type 46, `"distracts monsters"`, takes the same marker-append path without setting the gate.) `UNKNOWN_marker_record` — what the 6-byte records hold beyond the leading `{x, y}` that `0xf7bb` reads is not established.

⚠️ **Strategy 2 is NOT inert when there are no markers — it retries the other nibble.** `0xf799` jumps to `0xf71a`, which is `xchg cx,dx` followed by the dispatch. The same fallback fires when every marker lands off-grid (`0xf7d2` tests `DS:0x3cf`). Since markers exist only after an attract potion, that fallback is the *common* case, and implementing it is what took the port's hero-relative coverage from **72.5% to 97.4%** of shipped descriptors.

**Strategy 3's waypoints are static data**, four per-world pointers at `DS:0xdb28` = `{0xdb30, 0xdb58, 0xdba8, 0xdba8}` — **worlds 3 and 4 share a list**. Records are `{u16 tileX, i16 tileY}`, terminated by a negative `tileY`:

```
f81a  ax <<= 5              ; X = tileX * 32
f824  inc bx / bx <<= 4     ; Y = (tileY + 1) * 16     <- note the `inc`
f82d  ax -= [0xa] ; bx -= [0xc]
f835  4-way cull; on FAILURE loop back and try the NEXT waypoint
```

So it paints the **first** waypoint that is on screen — not the nearest, not all of them — and paints nothing if none is. Unlike strategy 2 it has no fallback (`0xf852` just returns). The shipped lists hold 9 / 19 / 13 / 13 entries and **every coordinate lies inside the 128×64 map** (tileX 4..125, tileY 4..60), which is what makes the decode self-checking.

Strategy 0 marks the hero's cell **and the two below it** — exactly his 3-row height, a 32×48 hero spanning three 16-px tile rows.

⚠️ **`SS:0x1c70` is BOTH the goal marks and the closed set** — one byte array, two meanings, discriminated by sign. The seed writes `0xFF` (negative) for *goal*; the producers then write the **depth** at which they reached each cell, and test `js` for the goal and `cmp dl,[ss:si]` for "already reached more cheaply". A port that models the goal region and the visited set as two arrays has to keep them in the same byte to reproduce the interaction.

⚠️ **Strategy 0's cell math is not export 39's**, despite the identical `0x55` bias: export 39 does `sub cx,8 / sub dx,8` first and `CS:0xf868` does not, so the two disagree by 8 px on both axes and land in different cells near a boundary. Two inlined copies of "the same" formula that are not the same — factoring them into one helper moves the goal.

### The producers are a four-stage pipeline, not four peers `[PROVEN for `0xfd54`]`

`CS:0xfd54` — the first one called, and reading it resolves the architecture. It is the **walk-right ray**:

```
fd58  mov cl,[si+0xd] / mov [0x3d0],cl   ; the PURSUIT RANGE, in tiles
fd5f  call 0xf554                        ; di := plane-B pointer
fd62  call 0xf8a6                        ; si := SS:0x1c70 grid pointer
fd68  cmp byte [di+0x100],1 / jnz ret    ; must be standing on ground
fd79  cmp dl,[ss:si] / jg ret            ; cell already reached cheaper -> stop
fd96  [bp+0]=ax [bp+2]=bx [bp+4]=dx [bp+6]=cx   ; append to the DS:0xd586 list
fdb2  mov [ss:si],dl                     ; mark the cell WITH THE DEPTH
fdb5  inc byte [0x3ce]                   ; candidate counter
fdb9  inc dx / cmp dl,[0x3d0] / jnl ret  ; range exhausted
fdc1  add ax,0x20                        ; +32 px = ONE TILE RIGHT
fdc9  cmp word [0x2c6],0x160 / jnl ret   ; off the right of the screen
fdd2  cmp byte [di],1 / jz ret           ; wall at head height
fdd7  cmp byte [di+0x80],1 / jz ret      ; wall at mid height
fdde  cmp byte [ss:si],0 / jz step
fde4  js 0xfe13                          ; NEGATIVE = 0xFF = THE GOAL -> commit
fde6  cmp dl,[ss:si] / jnl ret
fdeb  cmp byte [di+0x100],1 / jz 0xfd96  ; ground -> record another step
fdf2  [0xd576..0xd57c] = ax,bx,dx,firstMove   ; NO GROUND -> remember the LEDGE
```

So the four routines are **stages feeding each other through two scratch areas**, which is why `DS:0xd576` and `DS:0xd586` looked like unexplained arrays:

| stage | routine | reads | writes |
|---|---|---|---|
| 1 | `0xfd54` | the map | `0xd586` walk steps, `0xd576` a ledge |
| 2 | `0xfe36` | the map (mirror — walk **left**) | the same two |
| 3 | `0xfcbc` | **`0xd576`** (`mov si,0xd576`) | hop candidates off ledges |
| 4 | `0xfb4d` | **`0xd586`** (`mov si,0xd586`), count `[0x3ce]` | pushes onto the open list |

`[0x3ce]` — zeroed by the expand routine `0xf64d`, incremented at `0xfdb5`, reset at `0xfe13`/`0xfef5` — is the **count of candidates this expansion produced**, and stage 4 opens by reading it.

**`DS:0x2b2` carries the first move**, seeded at the root by `or dx,dx / jnz / mov cx,1` — literally *"at depth 0 the first move is 1 (walk right)"*, with the mirror producer using 0. Deeper nodes inherit it verbatim through the queue, which is how a verdict found five tiles away still names the step to take **now**.

**Two new descriptor fields.** `+0x0d` is the **cost budget** (`[0x3d0]`, signed byte) — shipped values span 0..127 with 13, 19, 25 and 32 dominating. ⚠️ Its *units differ per producer*: walk `+1` per tile, drop `+1` per 16-px row, hop `arcCost >> 2`. `+0x0c` gates the long hops: `> 4` (signed) unlocks the seed-13 arcs. `UNKNOWN_descriptor_0c` beyond that.

### The remaining stages `[PROVEN — every body re-read here]`

A 36-agent adversarial pass decoded stages 2–4 first; **all three bodies, both arc simulators, the mid-flight probe and the landing evaluator have since been read instruction-by-instruction in this project**, so they are no longer `[WF]`.

| stage | role |
|---|---|
| `0xfe36` | walk **left** — the mirror of `0xfd54`, but with no `mov bp,imm`: it appends to whatever BP stage 1 left, into the same buffer, and skips its own origin store at the root because stage 1 already made it |
| `0xfcbc` | **drop** — consumes the two ledge records, walks straight down, pushes the landing tile. Never mints a move code |
| `0xfb4d` | **hop** — for each staged record simulates up to four ballistic arcs (seeds 7 and 13, left and right) and evaluates each landing. Gated by a ceiling check `[di−0x80] != 1` |

⚠️ **The hop's arc simulator (`0xf8dc`/`0xf9d4`) is NOT the hop locomotion handler (`0xf316`/`0xf3ee`).** They walk the same table and differ in two ways that matter: the simulator holds a **byte** cursor and ping-pongs `−6`/`−5` forever, while the handler holds a **word** cursor (`0xf368 mov ax,[di+0x12] / shl ax,1`) and, once it drops below `−5`, **hands off to the fall handler at velocity 8** — so a real hop always terminates. A bonk hands off at velocity 2 instead.

Consequences worth carrying into a port:

- **Reaching the goal DISCARDS the staged records.** Tails `0xFE13`/`0xFEF5` set `[0x3ce] = 0` but never rewind BP, so stage 2 keeps appending at the advanced pointer while the count restarts at 0.
- **The reachable verdict set is `{0xFFFF, 0, 1, 2, 3, 6, 7}`** — 4 and 5 are never minted, so `0xf2ac`'s cursor-9 branch (`0xf2d0 mov bx,0x9`) is **dead code**.
- **Five different cull rectangles** across entry, stage 1 (right edge only), stage 2 (left edge only), stage 3 (vertical only, against `0xC0`) and the hop evaluator (full 4-way). Reusing one constant diverges.
- Grid dedup and budget compares are **signed byte**, and the polarity splits: the walk scanners reject at `>=` budget, the drop/hop paths at `>` — one step tighter for the walkers.

**`UNKNOWN_pathfinder_producers` — CLOSED.** All four stages are decoded and ported (`gods-web/src/game/pathfind-producers.js`), and the port hunts: on real `PLEV1A` geometry an enemy closes 256 px to 20, reverses to `verdict 0` when the hero is placed on the other side, **hops a two-tile wall** when one is in the way, and reports `0xFFFF` on every attempt when walled off by six tiles — which no hop can clear. The negative half matters as much as the positive: a pursuit test that only passes on an open field proves very little.

A shipped-data measurement, not an open question — `UNKNOWN_seed_2`/`UNKNOWN_seed_3` and the `DS:0x398`/`DS:0x399` gates are closed above: strategy 2 is **201 of the 540 shipped nibbles** — the second most common. But the flat nibble count overstates the impact, because `+0x09` decides how often the *high* nibble is consulted at all: measured over every `rnd` value across all 270 live descriptors, **27.5%** of groups actually land on strategy 2 or 3. The port surfaces that share as a measurement rather than defaulting silently, because otherwise "enemies hunt" would be true only for a biased subset.

Two more traps the porting pass turned up, neither of which is visible in a "does it pursue" test:

- **The arc simulator carries `di`, `cx` and `dx` as explicit state and they go out of phase with the world position.** Landing right snaps X forward a tile *and* increments `di`, but only when `cx != 0` (`0xf945`–`0xf94f`); a ceiling bonk snaps Y, forces `dx` to 0 rather than deriving it, and moves `di` (`0xf9a7`–`0xf9b3`). A port that recomputes the cell from X/Y each step diverges silently.
- **The hop locomotion handler tests the ground with a STALE cell pointer.** `0xf32c` computes it, `0xf345` then steps X, and `0xf34e` tests using the old pointer with the *new* X for the straddle. On the tick a hop crosses a tile boundary those disagree.

And one that bit this port directly: **the search runs only from the two walk handlers, only on a tile crossing, and only when standing on ground.** Applying a verdict outside that gate re-seeds the hop cursor every frame and freezes the entity in mid-air — which looks exactly like a broken pathfinder.

⚠️ **There is no differential test available here.** The root seeding is randomised, and the random source is the wall-clock-seeded replay table, so **enemy paths are not reproducible run-to-run even in the original**. Verification of this subsystem has to be structural — invariants and "does it pursue" — not byte-exact.

## Difficulty: authored per-trigger, plus one progression scalar `[PROVEN]`

GODS is widely described as having "adaptive difficulty". That is **true in effect but not in mechanism** — there is no global evaluator anywhere in `GAME.EXE`. Two real systems produce the effect:

**1. A progression-driven difficulty scalar `DS:0x365`.** Exactly 10 references. Initialised to 0 (1 when `[0x42]==4`), incremented on level completion (`1000:0445`, clamped to `[2,4]`), and **consumed** as a difficulty multiplier at only two adjacent instructions inside damage resolution (`1000:ab56`/`ab63`) — though it is also read by its own clamp logic at `0x449`/`0x455`, so "two reads in the whole binary" (an earlier claim here) was wrong; there are four reads across ten reference sites. Net damage multiplier by value: **1.00, 0.75, 0.50, 0.25, 0.25** — i.e. **the hero deals less damage as the scalar rises**; see the correction below for why the shift is the amount *forgiven* rather than the amount dealt, ⚠️ and why those figures are the **asymptotic** ratio rather than what a creature touch actually costs. Its inputs are **level progression only** — never health, lives, deaths, time or score. Corroborated by the game's own hint text: `"and the game gets more difficult too"`.

**2. Performance conditions authored into individual trigger records.** The section-4 trigger table genuinely gates spawns on how the player is doing — as level data, per trigger. Decoded examples:

- `PLEV1A #28` — `ACT=0 spawn(type=54)`, message `"help bonus"`, conditions `score ≤ 24*5000` **and** `timer/17 > 24*5` → help for a slow, low-scoring player.
- `PLEV1A #6` — `ACT=0 spawn(type=5)`, message `"speed bonus"`, condition `timer/17 ≤ 12*5` → reward for a fast player.
- Other `"help bonus"` triggers gate on **health** `[0x192]` and lives `[0x224]` — see *`UNKNOWN_DS_0192` — CLOSED*.

⚠️⚠️ **A CORRECTION TO A CORRECTION — the shifted value is NOT the damage** `[PROVEN]`. This section has now held the multipliers two different ways, and **both were wrong**, because both were read off `shr bx,cl` in isolation. The full bracket, re-read here instruction by instruction:

```
ab56  cmp byte [0x365],0 / jz 0xab92    ; scalar 0 -> the simple path
ab5d  push bp                           ; save the target's HP
ab5e  sub bp,bx                         ; bp = HP - RAW      <-- SUBTRACT FIRST
ab60  mov cx,3
ab63  sub cl,[0x365]                    ; cl = 3 - scalar   (a BYTE subtract)
ab67  jns 0xab6b / ab69 sub cx,cx       ; clamp at 0
ab6b  push bx                           ; save RAW
ab6c  shr bx,cl                         ; bx = RAW >> cl    (LOGICAL shift)
ab6e  push si / mov si,sp
ab71  cmp bx,[ss:si+0x2]                ; vs the saved RAW
ab76  jnz 0xab82                        ; the shift changed it -> keep bx
ab78  mov cx,bx / shr bx,1 / sub cx,bx / sar cx,1 / add bx,cx   ; else bx = 3/4 RAW
ab82  add sp,0x2 / ab85 pop cx          ; cx = the saved HP
ab86  add bp,bx                         ; bp = (HP - RAW) + bx  <-- ADDED BACK
ab88  js 0xab98 / ab8a jz 0xab98        ; <= 0 -> the death path
ab8c  sub cx,bp / mov bx,cx             ; the damage REPORTED is HP - newHP
ab92  sub bp,bx                         ; scalar 0: the full raw damage
```

`bp` is the target's HP, in and out (`0xffa2` loads it, `0xffb4` writes it back). The routine subtracts the **raw** damage at `0xab5e` and adds the **shifted** value back at `0xab86` — so the shift is the amount **forgiven**, not the amount dealt. Applied damage is `raw − (raw >> cl)`:

| scalar | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `cl` | — | 2 | 1 | 0 | 0 |
| forgiven | — | raw/4 | raw/2 | ¾ raw | ¾ raw |
| **multiplier** | **1.00** | **0.75** | **0.50** | **0.25** | **0.25** |

which is the *original* table, with the intuitive direction: **as the scalar rises the hero deals less damage.** The clamp was re-read too — `0x0445 inc byte [0x365]`, then `0x0449 cmp 2 / jnl` raises it to 2 and `0x0455 cmp 4 / jl` caps it at 4 — so the sequence a player meets is **0, 2, 3, 4, 4** → a monotone **1.00 → 0.50 → 0.25 → 0.25**. **Enemies are toughest at the end**, which is also the only reading consistent with the game's own hint text *"and the game gets more difficult too"*.

⚠️ **The multipliers above are ASYMPTOTIC, and at shipped damage magnitudes they are not what the hero meets** `[PROVEN]`. `forgiven` is an integer shift, so the clean fraction only lands when `raw` is divisible by the relevant power of two; otherwise it floors and the applied damage is proportionally **higher**. That is not academic, because System-B contact damage is `((HP + 1) >> 5) + 5` — i.e. `raw` runs **5..13**, squarely in the deviating range:

| `raw` | 5 | 6 | 8 | 10 | 13 | 1000 |
|---|---|---|---|---|---|---|
| applied at scalar 3 | 2 | 2 | 2 | 3 | 4 | 250 |
| **effective multiplier** | **0.40** | **0.33** | **0.25** | **0.30** | **0.31** | 0.25 |

So the endgame scalar forgives roughly a **third**, not three quarters, of a typical creature touch. The clean table is the limit (mean ratio over `raw` 1..4000 is 1.0000 / 0.7508 / 0.5006 / 0.2509 / 0.2509) — **a port must implement the shift, not the fraction.**

⚠️ **And there is a SECOND, UNCLAMPED incrementer** `[PROVEN]`. The byte pattern `FE 06 65 03` (`inc byte [0x365]`) occurs **exactly twice** in the image: `CS:0x0445`, which is followed by the `cmp 2 / jnl` … `cmp 4 / jl` clamp pair this section already records, and **`CS:0xD5F7`, which is followed immediately by `C3` (`RET`)** — it increments and returns, with no clamp at all. It cannot change any multiplier: `cl` saturates at 0, so every scalar from 3 upward gives the same result.

`UNKNOWN_365_second_incrementer` — **CLOSED negative: `CS:0xD5F7` is unreachable dead code `[STATIC, exhaustive]`.** Both `get_xrefs_to(1000:d5f7)` and a `search_instructions` sweep for the operand `d5f7` return zero hits — no near `CALL`/`JMP` anywhere in the image targets it. A separate raw byte-pattern search for the little-endian word `F7 D5` across all four initialized code blocks (152384 bytes, the whole image) also returns zero matches, so the address isn't parked in any jump table, dispatch table, or computed-call slot either — every other instance of a computed call in this codebase (trigger ACTION/CONDITION tables, the sound-driver export tables, the graphics export table, `DS:0xd95c`, `DS:0xdbe0`, …) stores its target as exactly this kind of raw little-endian word, so this sweep is the same check that would have found it. **No code path in the shipped `GAME.EXE` can ever reach `CS:0xD5F7`** — it is a second, harmless-if-called-but-never-called copy of the same `inc byte[0x365]` instruction sequence, sitting in the image without ever being wired to anything.

> **The transferable lesson, worth more than the numbers:** an instruction that looks like it computes the answer may be computing a *correction* to it. Reading `shr bx,cl` and asking "what multiplier is this?" produced a confident wrong answer twice, in opposite directions. The `push bp` / `sub bp,bx` … `add bp,bx` bracket is the evidence, and it is 40 bytes away from the shift.

`bx` is the raw damage from `DS:0x1ea` and `bp` the target's HP, restored from `DS:0x1ec` at `0xac53`.

⚠️ **This whole bracket belongs to the WEAPON-vs-CREATURE grid scan, not the hero-contact box test — a genuine ambiguity in how this section was worded, not just a reader's mistake, since it stood next to *"The damage routine CS:0xac59"* with no explicit disambiguation and the debris section elsewhere in this document (under `CS:0x8b4c`) went on to wrongly say `0xAC4C` sits "inside the shared contact/damage routine `CS:0xac59`".** Traced the full call chain fresh, since getting this wrong would have misdirected a port's `attackHero()`:

```
CS:0xa9e4  call 0xac59            ; the hero-contact BOX TEST (a small, self-contained
                                   ; routine with its own early RETs at 0xACBB/0xACD7/…) —
                                   ; already documented under "The damage routine CS:0xac59"
CS:0xa9e7  cmp bp,0 / jns 0xa9ef  ; bp UNCHANGED on a REJECT (no overlap) — ac59 never
                                   ; touches bp on that path, only on a HIT
CS:0xa9ec  jmp 0xabc0             ; HIT -> sound, return (this document's own existing note)
CS:0xa9ef  ...                    ; REJECT -> the DAMAGE-GRID SCAN begins here, using the
                                   ; SAME bp untouched by ac59 — i.e. the creature's own HP
                                   ; (CS:0xff93 sets it once, at 0xffa2, before EITHER path runs)
...        (CS:0xaad1-0xab3f, "the scanner", already documented)
CS:0xab40  call 0x9320            ; a HIT -> the tag decode, sets DS:0x1ea
CS:0xab56  ...                    ; THIS bracket — applies the scalar to raw damage from
                                   ; DS:0x1ea against the SAME bp (creature HP)
```

So `CS:0xac59` (hero-contact) and this bracket (weapon-vs-creature) are **two different consumers of one shared `bp`**, not one routine — `ac59` is CALLED and RETURNS before the scan even starts, and everything from `0xa9ef` onward (the scan, the tag decode, this bracket, and the `CS:0xABDA-0xAC58` tail including the `CS:0xAC4C` debris spark) is a separate, larger body of code that happens to sit at LOWER addresses than `ac59` despite running AFTER it. The practical upshot for a port: **the difficulty scalar and the "hit lands, target survives with reduced HP" mechanic apply ONLY to a weapon hitting a creature, never to a creature touching the hero** — `attackHero()`/`CS:0xac59` needs no difficulty-scalar or survival logic of its own; that model belongs entirely to the grid-scan side (`creatureScansGrid` in `gods-web`, which already implemented it correctly before this correction was written — the only piece genuinely missing was the `CS:0xAC4C` debris spark on the survive case, now closed, see *`DS:0x8b4c` — debris*).

So a port reproduces this by **evaluating the shipped trigger records**, not by writing a balance function.

### Trigger verbs decoded so far

First-pass ACTION-verb table, superseded by the complete decode below (*The 15 trigger ACTION verbs* / *The 17 trigger CONDITION predicates* — `UNKNOWN_map_trigger_verbs` is CLOSED). Kept for the verb-count census (across 756 live records: `203/4/75/75/3/134/25/60/48/18/7/6/8/77/13`):

| Slot | Meaning |
|---|---|
| ACT 0 | spawn object, `arg` = object type |
| ACT 6 | kill category-4 objects near the record's point |
| ACT 7 / 8 | write `word [0x2f8c + n*6 + 4]` (a flag array **no condition reads**) |
| COND 1 / 2 | inventory check — 4 compares against `DS:0x17e`…`0x184` |
| COND 9 / 10 | level timer — `uint32/17` vs `arg*5` |
| COND 11 / 12 | lever bit — `test byte [0xa5f8 + dx*6 + 4],1` |

## The 17 trigger CONDITION predicates `[PROVEN]`

Table `SS:0x35b0` (file `0x22B10`). The handlers occupy `1000:3bc1` and `1000:3e69`–`1000:4019` **contiguously with no gaps**, which independently confirms the set is complete.

**Result convention:** each slot byte (`DS:0x3a3`/`0x3a4`/`0x3a5`) is pre-initialised to `0xFF`; a predicate signals **FAIL by writing 0** and PASS by doing nothing. The three are ANDed and tested for the **sign bit**. Clearing is monotone, so no handler ever needs to write `0xFF`.

| # | Addr | Reads | PASS when |
|---|---|---|---|
| 0 | `3bc1` | — | **always** (a bare `RET`; the "unused slot") |
| 1 / 2 | `3e69` / `3e88` | inventory `0x17e`…`0x184` | arg **is** / **is not** in inventory |
| 3 / 4 | `3ea8` / `3ec1` | `0xdd10`, `0xdda2`, `0xde34` | arg **matches** / **matches none** of the 3 slots |
| 5 / 6 | `3edb` / `3ef7` | event word `[0x932c + (arg−1)*4]` | word **< 0** / **≥ 0** |
| 7 / 8 | `3f13` / `3f21` | **health** `[0x192]` | value **>** / **<** arg |
| 9 / 10 | `3f2f` / `3f51` | 32-bit timer `[0x11e]:[0x120]` | `timer/17` **>** / **<** `arg*5` |
| 11 / 12 | `3f6c` / `3f87` | `byte [0xa5f8 + arg*6 + 4]` | lever bit0 **set** / **clear** |
| 13 / 14 | `3fbe` / `3ff1` | BCD score `[0x3b5]`…`[0x3b8]` | threshold **<** / **>** score |
| 15 / 16 | `3fa2` / `3fb0` | lives `[0x224]` | lives **>** / **<** arg |

**Every pair is strict — equality FAILS both members.** Getting a polarity backwards would invert level logic, so a port must copy the table rather than infer it.

Two implementation notes: the dispatcher at `1000:3a58` has **no bounds check** on `cond_kind`; and the FAIL store is a **word**, so slot *n* also zeroes byte *n+1*. Because clearing is monotone the spill can never change a verdict, so **a port may safely use byte writes**.

`COND0` accounts for 1207 of the 2268 condition slots in shipped data — most records use fewer than three conditions. Its argument is ignored, so nonzero args on those slots are dead editor data.

## The 15 trigger ACTION verbs `[PROVEN]`

Table `SS:0x3592` (file `0x22AF2`). The evaluator **tail-jumps** into the handler (`1000:3a56 jmp bp`), and runs three shared steps first: show `[di+0x14]`'s message (guarded by the *sign* of `DS:0xac00[id]` plus an empty-string test — **not** `id != 0`); `call 0x3aeb` key-consume, only for actions {2,3,4,7,8}; `call 0x3a69` inventory-consume, only when action bit15 is set.

| # | Addr | Arg `[di+0x12]` | Effect | n |
|---|---|---|---|---|
| 0 | `3da1` | object type | spawn object into `DS:0x8314` via allocator `0x38d7` | 203 |
| 1 | `3e08` | weapon idx (stored `+0xC0`) | spawn weapon pickup | 4 |
| 2 | `4276` | — | **open a 2×3 door** — writes plane A and clears plane B (passable) | 75 |
| 3 | `3d56` | packed dest `(col<<8)\|row` | create teleport zone in `DS:0x8f68` | 75 |
| 4 | `3d12` | zone arg | create level-exit zone in `DS:0x8f68` | 3 |
| 5 | `3d08` | event index | `jmp 0x6029` — dispatch a `DS:0x932c` event | 134 |
| 6 | `3bd1` | — | kill ≤2 category-4 objects near the point | 25 |
| 7 | `4144` | — | gate open: `DS:0x2f8c[n].state=1`, plane A/B updated | 60 |
| 8 | `4180` | — | gate close: `DS:0x2f8c[n].state=0` | 48 |
| 9 | `42e7` | — | **close a 2×3 door** | 18 |
| 10 | `3e3f` | weapon id | clear whichever of `0xdd10`/`0xdda2`/`0xde34` matches | 7 |
| 11, 12, 13 | `3bcf`, `3bd0`, `3bc1` | — | **three separate single `C3` bytes** — no-ops | 6, 8, 77 |
| 14 | `3bc2` | — | zero the 32-bit level timer | 13 |

`ACT13`'s 77 records are not inert: 52 carry real text (`"treasure room"`, `"you need the treasure key"`), so it is the **message / precondition-gate** verb. `ACT11`/`ACT12`'s 14 records have no text and are genuinely inert in the shipped data.

**Clean negatives:** no action verb calls the random source `0x3836`, and none writes the lever table, the descriptors, or the entity array.

### `UNKNOWN_planeB_id_range` — RESOLVED `[PROVEN]`

`0x6022` (`sub al,3`) **falls straight through** into `0x6029` (`mov si,0x932c`), and its only other caller is the per-frame plane-B scan at `0x5fd7`–`0x601e`, which calls it only when `byte[si] > 2`. Therefore:

> **A plane-B cell value `v ≥ 3` is an event id**, dispatching `DS:0x932c` record `v − 3`.

That explains the census exactly: plane B's `0`/`1`/`2` are empty/solid/climbable (97 % of cells), and the thin spread over 3–254 is per-cell **event ids**, as suspected. `ACT5` reaches the same table with `arg − 1`, so `arg = planeB − 2`.

### ⚠️ The selector dispatch is **1-BASED** — `handler = SS:0x3570[selector − 1]` `[PROVEN]`

This is the most consequential correction in the document. An earlier revision said "the selector indexes the jump table at `SS:0x3570`; entry [2] is `0x39ae`". The **entry** was right; the inference that *selector value 2* reaches it was wrong. `CS:0x603A` does a `dec ax` first:

```
6022  push si
6025  mov al,[si] / 6027 sub al,3        ; -> event record index
6029  mov si,0x932c
602C  shl ax,1 (x2) / add si,ax          ; 4-byte records
6032  mov ax,[si]                        ; selector
6034  or ax,ax / js 0x6047 / jz 0x6047   ; consumed (0xFFFF) / empty (0) -> skip
603A  DEC AX                             ; <-- the 1-based bias
603B  shl ax,1 / mov di,0x3570 / add di,ax
6042  mov ax,[ss:di] / call ax           ; NO upper-bound check
```

So the trigger evaluator is **selector 3, not 2** — which dissolves the `PLEV3A` paradox (it dispatches 82 triggers, not zero). Getting this wrong makes selector 4, a System-B entity-group spawn, look like the trigger evaluator. **Apply the correction exactly once.**

| sel | idx | handler | effect | param |
|---|---|---|---|---|
| 1 | 0 | `0xb908` | spawn from PALFILS `+0x0000` (`DS:0x9008`) → runtime `DS:0xb6b8` | < 100 |
| 2 | 1 | `0xad06` | spawn from PALFILS `+0x0718` (`DS:0x9720`) → runtime `DS:0xaec0` | < 100 |
| **3** | 2 | `0x39ae` | **trigger evaluator** (the 100 × 24 B table at `DS:0x7004`) | < 100 |
| 4 | 3 | `0xde08` | activate **System-B** entity group → `SS:0x36b4` | < 50 |
| 5 | 4 | `0xde42` | activate **System-A** entity group → `SS:0x3768` | < 50 |
| 6 | 5 | `0x38f5` | progress / position marker (param never read) | 0 |
| 7–10 | 6–9 | `0x75fc/7600/7605/760a` | four entry points into one body, `CX = sel − 7` | < 25 |
| 11 | 10 | `0xc49c` | install per-world scripted routine via `SS:0x537a[world−1]` | 0 |

**The table is 11 entries.** The immediate `0x3570` occurs exactly once file-wide (`CS:0x603D`); the words from index 11 belong to a different table at `SS:0x3586` whose sole consumer is `CS:0xAE7C`.

**The shipped data forces the same reading independently.** Across all 2024 records in the 8 `PALFILS` files the selector census is `0:281 1:137 2:406 3:727 4:217 5:57 6:8 7:80 8:74 9:26 10:3 11:8` — **maximum 11, exactly the table size**, which under 0-based would dispatch into the foreign table. And each selector's maximum param lands exactly where its handler's table requires: `1/2/3 → 99` (three different 100-entry tables), `4 → 49` (a 50-record window), `7–10 → 23/23/13/1` (a 25-record window). Selector 0 is an **empty slot**, dropped by the `jz`.

**Endianness.** On disk the records are big-endian. The original packs each field to one byte (`CS:0x386E`, `lodsw / xchg al,ah / stosb`, 506 words) into a master at `DS:0x8114`, then unpacks to native words (`CS:0x3880`). No shipped field exceeds 255 (verified: 0 of 4048), so reading the big-endian `u16` directly is equivalent.

Three further consequences `[PROVEN]`:

- **Dying re-arms every consumed event.** `CS:0x3880` is called from level load (`CS:0x0095`) *and* from the respawn path (`CS:0x485E`), restoring the pristine master and wiping all `0xFFFF` consume markers.
- **Records 251 and 252 are hard-patched** on every unpack to `{11,0}` and `{6,0}` (`CS:0x3894`), discarding whatever `PALFILS` holds. All 8 shipped files already read exactly that, so it is a no-op on shipped data.
- **Trigger actions write plane B**, so the event map is not immutable. `ACT2` zeroes three cells (`0x42D1`–`0x42E3`), `ACT9` sets them to 1, `ACT7`/`ACT8` write one each. A door opening can erase an event cell permanently.

### `PALFILS` feeds the trigger system `[PROVEN]`

The 7000-byte front region — previously `UNKNOWN_alfils_record_fields` — is not one array. `1000:2aa6` copies it (`rep movsb`, `cx=0x1b58`) to **`DS:0x9008`**, and three known tables are windows into it:

| PALFILS off | DS addr | Stride | Count | Consumer / role |
|---|---|---|---|---|
| `0x0000` | `0x9008` | 8 | 100 | spawn table; runtime `DS:0xb6b8` stride `0x1c`, 5 slots |
| `0x0324` | `0x932c` | 4 | 253 | **event records**, dispatched via `SS:0x3570` |
| `0x0718` | `0x9720` | `0x10` | 100 | spawner `0xad0d`; runtime `DS:0xaec0` stride `0x20` |
| `0x0D58` | `0x9d60` | `0x16` | **50** | **System-A group descriptors** → runtime `SS:0x3768` stride `0xe4`, 10 slots |
| `0x11A4` | `0xa1ac` | `0x16` | **50** | **System-B group descriptors** → runtime `SS:0x36b4` stride `0x12`, 10 slots |
| `0x15F0` | `0xa5f8` | 6 | 64 | **levers** `{x, y, object_type}`, BE→native at `0x2acf`; `+4` bit0 = state |
| `0x1770` | `0xa778` | 6 | 30 | `{key, x, y}` lookup at `0x6241` |
| `0x1824` | `0xa82c` | 6 | **20** | **trap doors** — see below |
| `0x189C` | `0xa8a4` | `0x1c` | 25 | handed to the driver via `DS:0x7a` |
| `0x1B58` | `0xab60` | 2 | 40 | hint **trigger values** (BE `i16`) |
| `0x1BA8` | arena `DS:[0x14c]` | `0x28` | 40 | hint **text**, ASCIIZ |

**The accounting closes:** `804 + 1012 + 1600 + 1100 + 1100 + 384 + 180 + 120 + 700 = 7000 = 0x1B58`, and `+80 + 1600 + 80 = 8760`. Every region abuts the next exactly, and each count was taken from a loop immediate in code, not fitted to the data. **6996 of the 7000 front bytes are accounted for**; the only gaps are `UNKNOWN_palfils_0320` — see below — and `UNKNOWN_palfils_tail` (the 80-byte all-zero tail at `0x21E8`).

### `UNKNOWN_palfils_0320` — mechanism CLOSED, live-reachability CLOSED (negative) `[PROVEN]`

The 4 bytes are byte-identical `00 02 00 00` in all 8 shipped `PALFILS.0{A,B}{1-4}` files, landing at runtime `DS:0x9328` via the front-region copy `CS:0x2AA3 mov si,0x0 / CS:0x2AA6 mov di,0x9008 / CS:0x2AA9 mov cx,0x1b58 / CS:0x2AAC rep movsb`. No instruction in `GAME.EXE`, `TGAME.EXE`, or any of the other shipped executables references linear address `DS:0x9328`/`0x9329`/`0x932A` via a direct immediate operand — the lone `CS:0x9328`-shaped hits in both binaries are unrelated code addresses (inside the grid damage-tag decoder), not data references.

**But three handlers reach it anyway, via an off-by-one.** `COND5` (`CS:0x3EDB`), `COND6` (`CS:0x3EF7`), and `ACT5` (`CS:0x3D08 → CS:0x6029`) all compute `si = 0x932c + (arg−1)*4` into the PALFILS event table; because the arithmetic is 16-bit, an `arg` of `0` — or, equivalently mod 65536, `16384`/`32768`/`49152` — underflows to exactly `DS:0x9328`. (Checked exhaustively: brute-forcing all 65536 possible `arg` values confirms `{0, 16384, 32768, 49152}` is the complete aliasing set, and none of the three other values occurs anywhere in the 800 shipped `.MAP` trigger records for either handler family.) These 4 bytes are structurally "PALFILS event record −1."

For `COND5`/`COND6` an `arg` of 0 is harmless — it just makes the predicate test the mystery word's sign (`0x0200` is positive, so `COND5` fails and `COND6` passes, silently; zero shipped records use either with an aliasing arg). For `ACT5` it is a genuine wild jump. `CS:0x6029` reads the mystery bytes as a *native* word — they are never byte-swapped, since the pack/unpack loop at `CS:0x386E`/`CS:0x3880` starts exactly at `0x932c` (`mov si/di,0x932c`, `cx=0x1fa`=506 words) and never touches `0x9328` — giving `0x0200` = 512. **Because that value is neither zero nor negative, it fails to trip the routine's own `or ax,ax / js 0x6047 / jz 0x6047` "consumed/empty" guard**, and execution falls through to `dec ax / shl ax,1 / mov di,0x3570 / add di,ax / mov ax,[ss:di] / call ax`, landing on `SS:0x396E` — 1022 bytes past the legitimate 11-entry `SS:0x3570` selector table, and, by address arithmetic against this document's own `SS:0x3768`/stride-`0xE4`/10-slot System-A group-runtime span (`[0x3768, 0x4050)`), inside that live runtime array rather than any jump table. The call target is therefore whatever entity-group runtime data happens to sit there at the moment — an unguarded, data-dependent wild call.

**Shipped data comes within one wiring step of hitting this.** A full census of all 8 `.MAP` files' 800 trigger records finds exactly one record anywhere with `ACT5` and an aliasing arg: **`PLEV3A.MAP` record #50** — `cond0: kind=2 (item NOT held) arg=23 ("chest key")`, `action=5 arg=0` — "if the player lacks chest key 23, run `ACT5(0)`." But reaching record #50 at all requires a `PALFILS.0A3` event record `{selector=3, param=50}`, which exists at event index 95 (of 78 live `selector=3` records in that file) — and the *only* two ways to ever dispatch event index 95 are a plane-B cell valued 98 (`95+3`) or another `ACT5` with `arg=96` (`95+1`). **Neither exists in `PLEV3A`'s shipped data**: 0 of its 8192 plane-B cells equal 98, and none of its 20 `ACT5` records use `arg=96`. So the wild-jump path is real and structurally proven — and it fails to fire only because the level-editor never wired an entry point to event index 95, not because of anything about the 4 mystery bytes.

**Conclusion:** in every shipped play scenario these 4 bytes are dead padding — not because their specific value blocks anything (it does not; `0x0200` is exactly the kind of value that would let the wild call proceed if the code path were ever reached), but because the one code path able to read them as data is never dispatched with shipped level content. Their value never varies with level content, unlike every record around them (including the very next 4 bytes, event record #0, which differs across files), ruling out "duplicated first record." A plausible origin — unprovable from these bytes alone — is a level-export-tool artifact: a phantom "index-0 / base" slot the tool's own internal array representation always emits ahead of the real table. `UNKNOWN_palfils_0320_intent` — deliberate guard vs. tooling artifact — is not decidable from static bytes alone.

### `DS:0xa82c` — trap doors `[PROVEN]`, formerly `UNKNOWN_alfils_a82c`

`1000:40c0`, `cx=0x14`: **20 records of `{u16 x, u16 y, u16 open}`** that patch the map at level load — plane-A tile from `[0x152]`/`[0x154]`, and **plane-B solidity as `open XOR 1`**:

```
40E2  cmp dx,0 / js skip        ; 0xFFFF terminates
40E9  call 0x379b               ; di = plane A + (Y<<3) + (X>>5)
40F1  mov bl,[0x152] / mov [di],bl    ; open != 0
40F9  mov bl,[0x154] / mov [di],bl    ; open == 0
40FF  add di,0x2000             ; -> plane B
4103  xor dl,1 / mov [di],dl    ; solidity = open XOR 1
```

This is the mechanism behind the message `"a trap door closes beneath you"`.

Verified independently: `0x9008 + 0x324/0x15f0/0x1824` land exactly on `0x932c`/`0xa5f8`/`0xa82c`, and `PALFILS.0A1+0x15f0` decodes to 36 live lever records whose `{x, y, type}` match `PLEV1A`'s object records exactly (entry 0 = `(424, 592, 24)` = object #15). A byte-swap pass at `1000:2acf` (`cx=0xc0` = 64×6 bytes) converts the lever table BE→native.

**The lever "state" is bit 0 of the object type**, not a separate flag: types 24/25 = lever off/on, 26/27 = switch off/on, so `xor byte [...+4],1` flips state and graphic together. Conditions 11/12 test that same bit.

## Levers and triggers — no bitfields `[PROVEN]`

A lever is a `POBJECTS` **category 3** object. State lives in a **64-entry × 6-byte `{x, y, state}` table at `DS:0xa5f8`**, toggled one bit at a time (`xor byte [...+4],1`) by the player-overlap handler around `1000:1087`, and read by trigger conditions 11 and 12 (`test byte [0xa5f8 + dx*6 + 4],1`).

Multi-lever puzzles are real — a census of the 756 live trigger records finds 17 with three lever conditions, and levers {45,46,47} on `LEV3A/3B` appear in five records with five polarity patterns selecting five different actions. But the combination logic is **the trigger table's three AND-ed predicates**, not a bitfield indexed into a solution matrix: an exhaustive search of the handler and toggle regions found **zero** bitfield idioms (`or reg,reg`, `or [abs],r16`, `rcl`/`rcr`, `xlat`).

Trigger actions cannot set levers — `DS:0xa5f8` is written only by the player toggle — so lever puzzles cannot chain into one another.

## `GAME.EXE` memory layout `[STATIC]`

Ghidra (`x86:LE:16:Real Mode`, 415 functions):

```
CODE_0  1000:0000-1000:ffcf ─┐
CODE_1  1ffd:0000-1ffd:f3ff  ├─ initialized image, ≈148K, matches file size
CODE_2  2f3d:0000-2f3d:5ddf ─┘
CODE_3u..CODE_9u, DATA       ── UNINITIALIZED (BSS), up to e000:1c4f
```

The large BSS region is where decompressed assets are staged. `UNKNOWN_asset_load_segments` — CLOSED, see below.

### `UNKNOWN_asset_load_segments` — the three overlay target segments, resolved `[STATIC]`

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

**The true runtime segments**, given the load bias. `GAME.EXE`'s header declares its own entry `CS` as `0x0000` (the linker's segment-0-relative convention); this document's whole file-offset formula and the *Dynamic trace* section's live `delta 0` confirmation both independently establish the actual runtime `CS = 0x1000`. So the load bias is `0x1000`, and:

| overlay | raw | **true runtime segment** |
|---|---|---|
| `unpack.exe` | `0x30EC` | **`0x40EC`** |
| `vga.exe`/`ega.exe` | `0x2DB3` | **`0x3DB3`** |
| sound driver | `0x3031` | **`0x4031`** |

⚠️ **Tag discipline: this is `[STATIC]`, not `[PROVEN]`**, by this document's own header rule — every word above is confirmed via the file bytes and the relocation table, not by watching it happen. **To promote:** no mid-run breakpoint is even needed — since nothing else in the whole `CS` segment writes any of these six words (an exhaustive grep, matching this document's usual bar), reading `DS:0xd7ec`/`DS:0xd7e8`/`SS:0x52f8` at *any* point after `GAME.EXE` is loaded — even paused at its very first instruction — would confirm `0x40EC`/`0x3DB3`/`0x4031`. Not run this pass, to avoid disrupting a DOSBox session already in use for something else.

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

**The consumer.** Not found by the direct-operand searches this document's own ranked item implicitly invited (`[0x88]`/`[0x86]` dereferences, checked exhaustively across all 12 non-PKLITE-packed shipped executables with zero hits) — because nothing ever addresses it that way. `GAME.EXE` instead **preloads a register**. Five sites in the image reach `call 0x3596` with `si` freshly set to `0x86`:

```
CS:0x1269C / 0x12CD4 / 0x12EEB / 0x132DE / 0x164BF:
    mov si,0x86
    mov ax,0x1
    call 0x3596
```

`CS:0x3596` is the graphics-export-9 thunk (`mov bp,0x5276` → `(0x5276−0x5252)/4 = 9`, `call far [bp+0]`) — export 9 is already in this document's own driver-export table as **"palette fade-in"** (`VGA:0x0FAA`).

⚠️ **The fifth site is not literally identical to the other four.** `CS:0x164BF`/`0x164C2` set up `si`/`ax` the same way, but the `call 0x3596` itself is bracketed by `push word [0x42]` / `mov byte [0x42],0x0` before it and `pop word [0x42]` after — forcing the byte this document elsewhere identifies as the current **world** number to `0` for the duration of the call, then restoring it. Export 9's own body never reads `DS:0x42`, so the reason for the bracket is not established here; flagged as `UNKNOWN_export9_world_zero_bracket` rather than folded into the "identical" framing.

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

  **This is not a hypothetical edge case — it has a concrete, identified trigger and audible consequence.** `0xABB7`/`0xABD1` are both inside `FUN_1000_a9e4` (the shared hero/creature contact-and-damage-grid-scan thunk), gated by `CMP byte[0x35e],0 / JNZ` at `CS:0xAB98`/`0xABC0`: sound `0x0F22` (id `0x22`, well inside every driver's window) plays on an ordinary kill, but `0x0E49` (id `0x49`, ROL-only) plays instead whenever `DS:0x35e` is nonzero at the moment of death. `DS:0x35e` is bracketed nonzero around exactly **three** call sites into this shared contact routine, confirmed by an exhaustive operand search: `CS:0xE0A5`–`0xE0AD` inside `FUN_1000_e001` (System A's own per-entity pipeline, bracketing its `CALL 0xFF93`); `CS:0x7C8B`–`0x7C93` inside `FUN_1000_7c7c` (a 32×32 hit-box + contact-scan wrapper reached from `FUN_1000_7b68`, itself called from the main loop at `CS:0x029A` — identified as the world-1-exclusive awakened-statue hazard, see *`UNKNOWN_8014_world1` — CLOSED*); and `CS:0xBCDF`–`0xBCE7` inside `FUN_1000_bccf`, called from `CS:0xBB40` inside `FUN_1000_b987` — the already-documented `PGOD0x.PAT` selector-1 per-tick driver. **System B's own contact call (`CS:0xEDF4`) never touches `DS:0x35e`.** So the practical effect: creatures killed via System A, the `PGOD0x.PAT`-spawned objects, or the world-1 statue hazard play their death sound only under Roland — on Beeper/AdLib/Sound Blaster/Tandy that specific death is silent — while System-B kills and every other use of the ordinary death sound are audible everywhere.

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

## The `.MAP` level format `[PROVEN]`

Cracked, with its parser located: **`GAME.EXE FUN_1000_36f8`** (`1000:36f8`–`1000:3730`) plus helpers `FUN_1000_373e` / `FUN_1000_374b` / `FUN_1000_3731`. It loads via the shared loader using the filename pointer at `DS:0x15e`.

> Correction to an earlier steer: `FUN_1000_2a37` builds a name from the `lev?*.map` template but the load it actually performs is template entry `+0xAA` = `PALFILS.0*?`. It is **not** the map load path.

```
u16 BE  count
u16 BE  UNKNOWN_map_header_word     (6 or 7 across the eight files)
count × u16 BE                      UNKNOWN_map_header_table
--- bulk: EXACTLY 21824 bytes ---
+0x0000  16384 B  two parallel 8192-byte tile planes, 128 cols × 64 rows
                    plane A (+0x0000) = tile graphic byte
                    plane B (+0x2000) = per-cell attribute / ID  (NOT boolean - see below)
+0x4000   1200 B  200 × 6-byte object records { u16 x, u16 y, u16 type }
+0x44B0   1840 B  message block: 40 × u32 BE offsets, then a NUL-terminated
                    string pool starting at +0x4550
+0x4BE0   2400 B  TRIGGER / EVENT TABLE — 100 records x 24 bytes (see below)
```

The four section sizes are hardcoded immediates in the parser (`0x2000` words, `0x258`, `0x730`, `0x4b0`) and sum to 21824 exactly — the same for all eight files, with only the variable header making total sizes differ (21834–21874).

### `UNKNOWN_map_header_word` and `UNKNOWN_map_header_table` — CLOSED: both are unread by the parser `[PROVEN]`

`CS:0x3711`–`0x3724`, the very start of `FUN_1000_36f8` after the shared-loader call, is the whole header handler:

```
3711  mov si,0x0
3714  lodsw si            ; AX := count (byte-swapped, native), SI auto-advances to 2
3717  add si,0x2          ; SI := 4   -- the SECOND +2, skipping the header_word FIELD ITSELF
371a  shl ax,1            ; AX := count*2
371c  add si,ax           ; SI := 4 + count*2   == exactly the header's total byte length
371e  mov di,0x3004        ; plane A destination
3721  mov cx,0x2000
3724  rep movsw es:di,si   ; the bulk copy starts at SI — i.e. AT the computed skip
```

**Neither the header word (offset 2) nor any entry of the header table (offset 4..4+count×2) is ever loaded into a register.** The `add si,0x2` is a blind constant advance past the header-word field, not a read of it, and the table is skipped by pure arithmetic (`count*2`) with no loop that touches its bytes. This is the identical shape this document already established for `POBJECTS +0x02` (dead, copied verbatim) and the `.DAT` word2 field (dead, proven never read) — a third instance of the same authoring pattern: **the map header is entirely unread by the shipped parser**, both the single word and the variable-length table. `count` (offset 0) is the only header field the code actually consumes, and only as an arithmetic skip length, never compared or stored anywhere.

This also confirms exactly *which* function threads `DS:0x15e` (the `.map` filename pointer `FUN_1000_36f8` consumes): `FUN_1000_2a37`'s own tail, `CS:0x2B0D`–`0x2B1B`, sets `SI := 0x298a` (the filename-template base, offset **0** — not `+0xAA`, which is the PALFILS entry a few instructions earlier at `CS:0x2A89`), stores it to `DS:0x15e`, then `call 0x1000:36f8` directly. So `FUN_1000_2a37` performs *both* loads in sequence — PALFILS first (`+0xAA`, `CS:0x2A97`), then the `.map` file (`+0`, `CS:0x2B1B`) — which sharpens this document's own earlier "correction" (*"the load it actually performs is template entry `+0xAA`… It is **not** the map load path"*): that was true of the code the earlier pass was looking at, but the same function goes on, a dozen instructions later, to also be the map load path. Both readings are needed to describe `FUN_1000_2a37` correctly.

The port already parses and exposes both fields (`gods-web/src/formats/map.js`) without interpreting them; this closure says that is the correct behaviour — there is nothing to interpret.

**Tiles are 32×16 pixels, so a level world is 128×64 tiles = 4096×1024 px.** Proven from the accessor's index math (`x` masked to a multiple of 32, `y` to 16, row stride 128) and corroborated by the data: object-record `x` maxes at 3946–4048 (< 4096) and `y` at 936–984 (< 1024).

Object `type` is validated against `< 0xC0` and indexes the objects table at `DS:0x2a4e`; consumed slots are marked dead with `0xFFFF` (tested by **sign**, `CS:0x9000 cmp word [si+0x4],0 / jns` — not by comparing to `0xFFFF`).

### `UNKNOWN_object_sprite` — CLOSED: `sprite = 170 + type` `[PROVEN]`

```
sprite = type < 0xC0 ?  170 + type
                     :  302 + (type - 0xC0)      // weapon pickup
```

drawn at `(x, y)`, top-left, no offset.

**The stamp loop, `CS:0x2234`** (file `0x23C4`) — the sprite index is written by the EXE, not read from the file:

```
2234  mov si,0xef78      ; the 132-byte category table
2237  mov di,0x2a4e      ; runtime descriptor array, stride 10
223A  mov cx,0x84        ; 132 object types
223D  mov bx,0xaa        ; 170  <-- the base
2240  mov [di],bx        ;   descriptor +0 = sprite index
2242  lodsb / cbw
2244  mov [di+0x4],ax    ;   descriptor +4 = category, sign-extended
2247  add di,0xa / inc bx / loop 0x2240
```

Weapons: `CS:0x1DC6 sub cx,0xc0 / add cx,0x12e` (302).

The map's big-endian `type` can index directly because **`CS:0x373E` byte-swaps the whole object section at load** — `mov di,0x7964 / mov cx,0x258 / lodsw / xchg al,ah / stosw / loop`, 600 words = 200 records × 3 fields.

**Four independent confirmations:**

1. `POBJECTS`' own big-endian `+0` id field reads `170 + type` — type 8 → 178 (`"pile of coins"`), 50 → 220 (`"spike arc"`), 69 → 239 (`"tablet…reveals clues"`, the known hint trigger).
2. The category table at `DS:0xef78` is **byte-identical to `POBJECTS` `+4` read big-endian, 528/528** across all four worlds, and `cat[24..27] = 3,3,3,3` — exactly the lever/switch off/on pairs this document established separately. Its 132 entries have the histogram `{2:45, 0:23, 5:22, 3:18, 1:17, 4:7}` (sums to 132). *(A workflow report gave `{0:83, …}`, which sums to 192 — it counted past the end of the 132-entry table. The figures above are re-derived here.)*
3. Rendering every shipped type beside its `POBJECTS` text: the five `"* key"` records draw as keys, `"gold mask"` draws a gold mask, `"ceramic vase with blue stripe"` draws a striped vase, and `"spike arc"` is the one 16×32 frame in the set.
4. All 1120 live objects across the 8 maps (130/136/170/171/118/115/130/150), 92 distinct types, 55 weapon pickups of 9 distinct types, map to sprite indices 170–312 — entirely inside the `objects` group (`POBJ1` #170–#330, `POBJ2` #331–#449).

⚠️ **`POBJECTS.004` uses base 175 — every record shifted +5.** That is the *same authoring drift* already recorded here for `PWEAPONS.004`'s `+0xc`/`+0x1e`, in the same file. It never takes effect because the stamp loop overwrites descriptor `+0` unconditionally — which is precisely what makes `CS:0x2234` load-bearing rather than a redundant re-derivation. **A port that reads the sprite index from the file draws every world-4 object 5 sprites off.**

`UNKNOWN_object_stamp_gap`: the loop stamps only 132 types, so a type in `132..191` would read an unstamped descriptor. Zero shipped objects fall in that gap.

**Draw order is three-way, not a two-way category split** `[PROVEN]`. Graphics export 32 (`VGA:0x06F0`) bubble-swaps adjacent pairs, and a swap pushes a record *later*:

```
06FD  cmp ax,0    / js  0x743   -> SWAP  (dead slot)
0702  cmp ax,0xc0 / jnl 0x743   -> SWAP  (weapon pickup)
072B  cmp word [si+0x4],3 / jz 0x775   -> no swap (k is cat 3)
0731  cmp word [si+0x4],5 / jz 0x775   -> no swap (k is cat 5)
0737  cmp word [di+0x4],3 / jz 0x743   -> SWAP  (k+1 is cat 3)
```

Settled order: **cat 3 and cat 5 behind → ordinary objects → weapons and dead slots on top.** A stable cat-3/cat-5 partition leaves the 55 weapon pickups where they started and gets their z-order wrong. Message-pool strings read as e.g. `"a trap door closes beneath you"`, `"you need the treasure key"`, `"the temple of the gods"`.

**Plane B is not a boolean flag** `[PROVEN by census]`. Across all 8 maps (65,536 cells): `0` = 54.9%, `1` = 39.5%, `2` = 2.7% — those three cover 97%, and rendered, `1` traces solid masonry while `2` forms vertical runs aligning with ladders in plane A. The remaining ~3% spreads thinly over **almost the whole byte range 3–254, only 2–15 occurrences each**, plus `255` appearing 108 times. That is the distribution shape of **per-cell entity/trigger IDs**, not an attribute enum — plausibly the link mechanism joining doors to keys and levers to gates (`POBJECTS` categories 2 and 3 are exactly keys and levers/switches). `UNKNOWN_planeB_id_range` is **CLOSED** — a cell value `v >= 3` is an **event id**, dispatching `DS:0x932c` record `v - 3`; see *`UNKNOWN_planeB_id_range` — RESOLVED* above, which confirms this census rather than overturning it.

### Section 4 is the trigger / event table `[PROVEN]`

Formerly `UNKNOWN_map_section4`. **100 records of 24 bytes** (`2400 = 100 × 24`), loaded by `FUN_1000_3731` to **`DS:0x7004`** with every `u16` byte-swapped BE→native (`0x4b0` = 1200 *words*). The object table lands immediately after at `DS:0x7964` (`0x7004 + 2400 = 0x7964`).

```
+0x00  u16 cond0_kind   u16 cond0_arg
+0x04  u16 cond1_kind   u16 cond1_arg
+0x08  u16 cond2_kind   u16 cond2_arg   // three conditions, AND-ed; an unused slot passes
+0x0C  u16 x                            // world pixels, observed max 4032 (< 4096)
+0x0E  u16 y                            // world pixels, observed max  984 (< 1024)
+0x10  u16 action                       // bit15 = flag; (action & 0x7fff) indexes SS:0x3592
+0x12  u16 action_arg
+0x14  u16 message_id                   // indexes the 40-entry message table at DS:0xac00
+0x16  u16 reserved                     // ALWAYS 0 in all 800 shipped records
```

The evaluator is at **`1000:39ae`**, in one of Ghidra's un-disassembled gaps — it has no function entry, so `decompile_function` fails and only `ndisasm` reaches it. It computes `record = 0x7004 + index*24` via an explicit **`mov bl,0x18` / `mul bl`** — the stride is proven by the code, not inferred:

```
39B6  mov ax,[si+0x2]        ; record index
39B9  mov di,0x7004
39BC  mov bl,0x18            ; stride = 24
39BE  mul bl
39C2  mov byte [0x3a3],0xff  ; three condition results, 0xFF = "unused / passes"
39C7  mov byte [0x3a4],0xff
39CC  mov byte [0x3a5],0xff
39D1  mov cx,[di]     mov dx,[di+0x2]   call 0x3a58   ; cond 0
39DC  mov cx,[di+0x4] mov dx,[di+0x6]   call 0x3a58   ; cond 1
39E6  mov cx,[di+0x8] mov dx,[di+0xa]   call 0x3a58   ; cond 2
39F0  mov al,[0x3a3]  and al,[0x3a4]  and al,[0x3a5]
39FB  js  fire                                        ; sign bit survives AND => fire
39FE  mov word [si],0xffff                            ; consume the slot
```

**Two dispatch tables, and they live in `SS` (`0x2f3d`), not `DS`** — the code reads them with `mov ax,[bp+0]`, which defaults to `SS`. Reading them as `DS` yields all zeros, so the segment choice is verifiable, not assumed:

| Table | `SS` offset | Entries | Indexed by |
|---|---|---|---|
| Action handlers | `0x3592` | **15** | `action & 0x7fff` |
| Condition handlers | `0x35b0` | **17** | `cond_kind` |

All 15 and all 17 entries are plausible near-code offsets (`0x3bc1`–`0x4276`), and the two tables are exactly adjacent — `0x3592 + 15*2 = 0x35b0`.

**Three independent cross-checks between the data and the code all land exactly**, which is why this is `[PROVEN]` rather than a plausible fit:

- `message_id` observed max across all 8 maps = **39**; the message table it indexes has **40** entries.
- `action & 0x7fff` observed max = **14**; the action jump table has exactly **15** slots.
- `cond*_kind` observed max = **16**; the condition table has **17** slots.
- The `+0x16` word is zero in **800/800** records, matching a reserved field.

Statistical structure discovery agreed with the disassembly before the disassembly was read: a stride sweep over all divisors of 2400 found stride 12 gave the only all-zero columns, and even/odd 12-byte halves then showed disjoint ranges (even ≤ 255 everywhere, odd carrying coordinate-scale values with an always-zero tail word) — i.e. one 24-byte record with two halves.

**Condition kind 1 is an object reference** (`0x3a69`/`0x3a94`): when the action's bit 15 is set, every condition slot whose kind is `1` has its arg used as an object id into the **10-byte** runtime descriptor table at `DS:0x2a4e` (`si = 0x2a4e + id*2 + id*8`), and the descriptor's `+0x4` category word is tested against `2` and `0`. Given the documented `POBJECTS` category map (`2` = keys), this is very likely the **key/door and lever/gate link mechanism** that the plane-B census pointed at — but the *gameplay* meaning is inferred from the category table, so treat `cond_kind == 1 → object id` as `[PROVEN]` and "it means keys" as likely, not proven. `UNKNOWN_map_trigger_verbs` is CLOSED — the remaining 16 condition kinds and 15 action kinds are decoded below, in *The 17 trigger CONDITION predicates* and *The 15 trigger ACTION verbs*; note their table there identifies `cond_kind` 1/2 as a plain inventory-contents check (`0x3e69`/`0x3e88`, arg tested against `DS:0x17e`…`0x184`), while `0x3a69`/`0x3a94` here is a *different* routine — the ACTION side's bit-15 inventory-consume post-processing, which happens to re-read a firing record's own kind-1 slots by the same field layout.

Plane A ↔ plane B correlation is independently strong — weighted dominant-B purity 0.79–0.95 against an independence baseline of 0.54–0.75 — confirming **both** planes decode correctly, since a wrong decode of either would destroy the correlation.

## The two filename tables `[STATIC — fully recovered from raw bytes]`

**File↔memory mapping for `GAME.EXE`: `file_offset = linear_address − 0xFE70`** (MZ header 25 paragraphs = 0x190; Ghidra image base segment `0x1000`). Verified byte-for-byte.

⚠️ **Use the right segment.** That formula takes a *linear* address, so you must resolve `segment:offset` first — and the three segments are used for different things: `CS=0x1000` (code), `DS=0x1ffd` (Table 1 and the data cluster), `SS=0x2f3d` (Table 2, the driver vector tables). A `DS` offset must be read as `1ffd:<off>` (file = `off + 0x10160`), **never** as `1000:<off>` — that resolves to a different linear address and silently returns unrelated code bytes. This has already produced at least one wrong turn in earlier analysis.

> `list_strings` returns only *defined* strings and **misses most of both tables**. Always dump raw bytes.

### Table 2 — `2f3d:581e`, the real asset manifest: 105 records

Reader is `FUN_1000_2619`. **Addressed via `SS`, not `DS`** — which is why `get_xrefs_to` finds nothing (entry sets `SS=0x2f3d`, `DS=0x1ffd`).

Records are **packed and variable-length**, not fixed-width:

```
record := ASCIIZ filename , 1..2 disk-id bytes , 0xFF
table  := record* , 0xFF          // sentinel at 2f3d:5ddc
```

**The bytes between filenames are floppy DISK NUMBERS, not load addresses or lengths.** Values are only 0..4: `1` = boot disk (engine, drivers, fonts, music, hiscores), `2` = worlds 1–2, `3` = worlds 3–4, `4` = intro font + payoff screen, `0` = no disk check (UI chrome), `2,3` = present on both. `FUN_1000_270a` validates the id against the floppy's **DOS volume-label** last character; `FUN_1000_2792` patches the `?` in `"GODS DISK ?"` for the swap prompt.

Reader quirks worth mirroring in a port: on a multi-id list with no match it returns the **last** id, not the first; it reads at most 3 value bytes per record; and it treats any byte with the **high bit set** as the list terminator, while end-of-table is an exact `CMP 0xFF`.

Three records are dead: `psmlfnt. pi1` at `2f3d:5869` is **malformed** (ASCII space where the extension's first char belongs) and can never match a file; `psmlfnt.dat` is **duplicated** (`5941` and `5b11`). All carry id 0, so the effect is benign.

### Table 1 — `1ffd:e994`, DS-relative: two ASCIIZ blocks split by `0xFFFF` at `1ffd:ea73`

- **Block A (`e994`–`ea70`)** — 20 wildcard/template names. **Eight match nothing on disk**: `\pcgods.dat`, `level?.spr`, `switches.0*?`, `intel.0*?`, `god?*.evt`, `\LEVEL.?`, `mblocks.0*?`, `teleport.0*?`. No `.SPR` or `.EVT` file exists at all — those are almost certainly **leftovers from the Atari ST/Amiga original or an internal level-editor toolchain**.

  ⚠️ **Two of the ten previously listed as dead are LIVE**: `trapdoor.0*?` and `hints.0*?` name real, running systems whose data was **folded into `PALFILS`** (`+0x1824` = 20 trap-door cells; `+0x1B58`/`+0x1BA8` = 40 hint triggers + text). They are template names for data that *moved*, not data that vanished. The earlier "`PCGODS.DAT` = hard-disk archive" hypothesis is **not supported**: no code path opening it was found, and it sits among nine other equally dead templates.
- **Block B (`ea75`–`eb4f`)** — 22 logical names/stems that resolve **once the `P` prefix is applied**: `backscr.pi1`→`PBACKSCR.PI1`, `payoff.pi1`→`PPAYOFF.PI1`, `joyl1.dat`→`PJOYL1.DAT`, stems `always`/`objects`/`guard?`/`introft`, plus the driver names.

Immediately after: two pointer arrays — `1ffd:eb50` (5 sound-driver names) and `1ffd:eb5a` (4 world names → `THE CITY`, `THE TEMPLE`, `THE LABYRINTH`, `THE UNDERWORLD`).

Runtime name construction uses the bare extension literals `.pi1` at `1ffd:0058` and `.dat` at `1ffd:005d`.

### Reconciliation

103 distinct names are referenced **and** present on disk. Only **two** literal references miss: `pjoypos.dat` and the malformed `psmlfnt. pi1`.

`UNKNOWN_asset_owner` — **CLOSED.** Of six assets originally unowned by any readable binary, three were resolved by live trace (`PONE.PI1`, `PSTBACK.PI1` belong to `INTROV.EXE` under any sound config; `PTITLE.RL` surfaces only when sound = Roland). The last three — `PDEMOSB4.SB`, `PGODMUS2.MUS`, `PMUSIC.MUS` — are now resolved by **static unpacking of the intro executables** (see *Unpacking the PKLITE binaries*): all three names appear as literals in `INTROE/INTROT/INTROV.EXE`. Every shipped asset now has a named owner.

## Dynamic trace `[PROVEN]`

Traced live under DOSBox with `INT 21h AH`-filtered breakpoints (open/read/write/seek/close/exec), mounting this directory as `C:` and running `gods`. Every stop below matches the static prediction exactly — including register-level details (buffer segments, byte counts, DX offsets) computed purely from disassembly beforehand.

```
DOS shell  EXEC "gods.EXE"                     (COMMAND.COM's own launch)
GODS.EXE   open/read(200B→DS:0xA38)/close "gods.ini"   ← matches 1000:051f-0530 exactly
           no INT 13h/25h floppy check fires           ← confirms drive≥2 bypass branch taken
           EXEC AH=4B AL=0 DX=0x6ca "introv.exe"       ← unpatched, matches Colour VGA config
  INTROV.EXE (loaded at the segment introv/game share after each other's memory frees)
           AX=4B03 overlay-load "unpack.exe"           ← matches GAME.EXE's own pattern
           open "pone.pi1"        → decompressed via unpack.exe (2048-byte read chunks)
           open "pintroft.dat", "pintroft.pi1"
           open "pstback.pi1"
           open "pbeeper.bin"
GODS.EXE   EXEC AH=4B AL=0 DX=0x6d5 "game.exe"          ← unpatched; "tgame.e[xe]" sits right after in memory
  GAME.EXE (reloaded into the freed intro segment)
           AX=4B03 overlay-load "unpack.exe"
           AX=4B03 overlay-load "vga.exe"               ← matches Colour VGA
           AX=4B03 overlay-load "bpr.exe"                ← matches sound=Beeper in GODS.INI
           open "palways1.pi1"                           ← Table 2's first record, disk id 1
→ the game renders and is playable (screenshot captured)
```

**Three of the six unowned assets are resolved**: `PONE.PI1` is `INTROV.EXE`'s title-screen graphic, `PSTBACK.PI1` its status-screen background — both load regardless of sound config. `PTITLE.RL` is Roland-specific.

### Sound config changes what the intro opens `[PROVEN]`

Re-ran the identical trace with `GODS.INI`'s sound line changed `Beeper` → `Roland` (restored after). The traces diverge exactly where `INTROV.EXE` would load sound: instead of opening `pbeeper.bin`, it opens `pplayer.bin` → `ptitle.rl` — **resolving `PTITLE.RL`** as the Roland variant of the title music, confirming the `READ.ME` hint. `INTROV.EXE` finishes after that (no `PDEMOSB4.SB`/`PMUSIC.MUS`/`PGODMUS2.MUS` — those need a config this pass didn't try, almost certainly Sound Blaster for `PDEMOSB4.SB`).

Continuing into `GAME.EXE` with Roland active confirmed the sound-overlay pointer-table math live: third overlay load is `rol.exe` (not `bpr.exe`), matching the config exactly. Further tracing caught `GAME.EXE` opening `pplayer.bin` again, then **`pgodsrle.rl`** — with the `p` prefix, even though `ROL.EXE`'s own embedded string is the unprefixed `"godsrle.rl"`. This resolves a loose end from the static analysis: `ROL.EXE`'s far-call host callback (`DS:0x0044`) routes into the **same shared, prefix-prepending loader** `GAME.EXE` uses for every other asset — the driver requests a logical name, the host loader adds `P` and does the real DOS open. That's the actual mechanism behind the `P`-as-Packed-prefix convention holding even for names a driver overlay constructs itself at runtime.

Practical notes for repeating this: the emulator's SDL keymap on this machine is QWERTZ, not QWERTZ-transparent to `input_type` — typed `y`⇄`z` are swapped, `/` requires `Shift+7`, and `:` requires `Shift+.` (period). Compensate before typing DOS paths/commands. Also, `debug_map_set_base`'s `ghidra_address` is an integer offset (not a `"seg:off"` string); for these small single-segment real-mode EXEs the live segment-relative offset equals the Ghidra offset directly (delta 0), so Ghidra's `1000:XXXX` addresses can be read straight off live `CS:XXXX`. Finally: this environment's port 8386 is occasionally used by something else outside this session (instances have appeared/exited without being started here) — if a call suddenly gets connection-refused, check `lsof -iTCP:8386` before assuming the fault is local.

## `GODS.INI` `[STATIC]`

**Written by `INSTALL.EXE`, read by `GODS.EXE`** — an earlier revision of this file wrongly credited `GODS.EXE` as the writer; it has no `AH=3Ch`/`40h` anywhere (all 26 of its INT 21h sites were enumerated).

`GODS.EXE` reads it into a 200-byte buffer at `0xa38` and parses each line against a keyword table, storing **0-based indices**:

```
Beeper          # sound @0x640: Beeper=0 Adlib=1 Roland=2 Sound Blaster=3 Tandy=4   → [0x634],[0x63c]
Colour VGA      # video @0x669: EGA=0 Colour VGA=1 Tandy 16 colour=2 ega=3 Mono VGA=4 → [0x635]
Keyboard        # input @0x696: Joystick=0 Keyboard=1                                → [0x636]
Version 1.0     # @0x6a9
072 080 075 077 057   # BIOS scan codes Up/Down/Left/Right/Fire → [0x637..0x63b]
```

Two behaviours a port must reproduce:

- **Floppy sound downgrade** (`FUN_1000_048e`): when running from drive < 2, Roland silently becomes Beeper and Sound Blaster becomes AdLib, with an on-screen notice — matching `READ.ME`'s warning about music on low-density floppies.
- **The `+0x61` bias.** All 10 config bytes `[0x634..0x63d]` get `+0x61` before the EXEC so the command tail is printable; every consumer subtracts it. This resolves what would otherwise look like an inconsistency: the protection verdict is written as raw `'X'`/`'1'`/`'A'` (`0x58/0x31/0x41`), biased to `0xB9/0x92/0xA2`, and `GAME.EXE` recovers the original with `SUB AL,0x61` at `1000:0013` before comparing `[0x3e5]` against `0x58`/`0x31`/`0x41`. The round-trip is exact.

## Formats validated by reconstruction `[PROVEN]`

Every format above was originally proven by *reading* disassembly. All of the major ones have now also been proven by *rebuilding* — extractors were written and the output inspected. This is the strongest available check: a wrong format still produces a valid file, but not a coherent one.

Extractors and output live under `scratchpad/extract/` (nothing was written to the game directory; verified).

**Sprites — 25/25 atlases correct.** All `P*.PI1`/`P*.DAT` pairs render as recognisable Gods artwork with atlas rectangles landing exactly on sprite boundaries. `PGODFONT` renders a fully legible gold character set with each 16×16 rect framing one glyph; `PGUARD11` gives 20 frames of an armoured guard in a clean 10×2 grid; `POBJ1` gives 161 individually-framed pots, keys and chests. Zero files decoded to garbage. An adversarial verifier rebuilt the whole chain independently from the pristine files and got a **perfect colour-index bijection — 0 disagreeing pixels across all 25**.

A deliberate **control experiment** separates two claims that a legible image alone would conflate: re-decoding with the bitplane order reversed keeps the letters perfectly legible (geometry is invariant under plane permutation) but collapses the smooth gold gradient into banded stripes. So the plane→bit assignment (`plane0` = LSB) is proven, not just the pixel geometry.

**Levels — 8/8 render as coherent platform geometry.** Masonry courses, ladders, towers, gears and stairs, with three visually distinct tilesets. The header arithmetic (`total − 21824 == 4 + 2*count`) holds exactly on all eight.

- **Tile sheet layout confirmed: 10 cols × 12 rows = 120 tiles, row-major** (`col = N%10`, `row = N//10`) — matching export 17's `0x78` clamp exactly. Column-major is visibly wrong (fragments every wall).
- **Each map indexes its own sheet: `PLEV<N><X>.MAP` → `PBITS<N><X>.PI1`.** Smoking gun: `PBITS1A[83]` is byte-identical to `PBITS1B[114]`, while `PBITS1A[114]` is blank — and `PLEV1A` uses index 83 for 818 cells where `PLEV1B` uses 114 for 782. If `PLEV1B` indexed the A sheet, 782 cells would render blank.
- **`UNKNOWN_map_sheet1` — the second tile sheet is `PXTRA<key>.PI1`** `[PROVEN]`. The earlier pass ruled `PXTRA` out because those sheets are 90–97 % blank; that was the wrong inference — a sheet supplying only a handful of extra tiles *should* be almost entirely blank.

  **Export 17 reads a per-level tile count from a table at `DS:0xe90a`**, indexed `(world−1)*4 + sublevel*2` (`[0x42]` = world 1–4, `[0x43]` = sublevel):

  ```
  205F  mov di,[0x48]        ; 0xe90a, table base
  2078  mov ax,[di]          ; tile count for this level
  2080  cmp cx,0x78 / mov cx,0x78    ; pass 1 clamped to 120 tiles
  2099  cmp cx,0x78 / jng done       ; count <= 120 -> one sheet only
  209E  sub cx,0x78 / mov dx,[0x3e]  ; remainder from the second source
  ```

  The shipped counts are **110, 126, 133, 118, 124, 110, 118, 123** for `1A,1B,2A,2B,3A,3B,4A,4B`. Exactly four exceed 120 — **1B, 2A, 3A, 4B** — and exactly four `PXTRA` files ship: `PXTRA1B`, `PXTRA2A`, `PXTRA3A`, `PXTRA4B`. **The same four.** Confirmed further: each sheet's non-blank tiles form a *leading contiguous run* of exactly the shortfall — 6/6, 12 of 13, 4/4, 3/3.

  So: index `0..119` → `PBITS<key>.PI1`; index `120..count−1` → `PXTRA<key>.PI1` at `index−120`.

- **`UNKNOWN_planeA_above_count` — RESOLVED** `[PROVEN]`. Two findings, and the first corrects a model this document previously implied.

  **1. Plane A is 1-BASED: `tile = planeA - 1`.** Export 0 turns a cell byte `B` into a source address with no mask, no limit compare and no indirection:

  ```
  VGA:0x112D  mov cx,0xa672     ; tile cache base segment
  VGA:0x1130  sub cx,4          ; -4 PARAGRAPHS = -64 bytes
  VGA:0x11DE  shl ax,1  (x6)    ; AX = B * 64   (64 bytes per tile in VRAM)
  VGA:0x11ED  mov ds,cx / mov si,ax
  ```

  i.e. source offset = `64 * (B - 1)`. Corroborated from shipped data: **5 of the 8 levels contain cells whose plane-A value equals the level's own tile count exactly** — out of range under 0-based, the last legal tile under 1-based. Note both readings render *plausibly*, since neighbouring tiles are similar masonry; only the instruction bytes distinguish them.

  **2. Values outside `[1, count]` are not a second namespace — they read the tile cache past what export 17 filled.** Export 17 contains no memset: it writes `count` tiles and stops. Confirmed live under DOSBox — probe value 111 drew the junk already sitting at cache slot 110, and probe value 0 drew the bytes 64 bytes *below* the cache base. On a fresh level load that tail is zeros, so these cells draw as colour 0. **A port should reproduce the fresh-load result (empty) rather than emulate uninitialised VRAM**, which is what `gods-web` does. Consistent with the data: 97 % of such cells carry plane-B = 0 (passable), so they are never collision geometry.

  Three hypotheses killed two ways each: a mask/modulo (no `AND`/`CMP` in either blitter, and no unconditional mask fits — `0x7F` leaves 127 > count 126 on 1B); the run-length dispatcher (that 9-entry table at `VGA:0x54` is indexed by the **run counter `AH`**, not by the tile byte, and is a contiguous continuation of the export table); and a load-time rewrite (the live plane A is byte-identical to the file; the parser is a verbatim `rep movsw`).

  `UNKNOWN_planeA_value_choice` — why the level editor emitted 111..182 rather than one canonical "empty" code — is not answerable from this binary.

  Also settled: **`DS:0x3e` is a general-purpose scratch word carrying a filename pointer**, not a dedicated slot. `0x2a40` is the `PXTRA` name buffer; the value flows to the host loader at `0x257E`, which prepends `'p'`. GAME.EXE reuses the same slot for the values 7 and 8 elsewhere.

**Music — 506 SMF files extracted, all parse clean.** Every blob beginning `MThd` was written out and then **re-parsed with an independent stdlib SMF walker** (running status, VLQ lengths), each reaching `FF 2F 00` with the walked byte count matching the `MTrk` header exactly. `file(1)` independently calls them "Standard MIDI data (format 0)". Only 140 of the 506 are unique content — the `.RL` set is heavily deduplicated.

- **A real defect in the shipped game data:** all 71 AdLib-family blobs ship an `MTrk` length **4 bytes too small**, excluding the trailing `00 FF 2F 00` end-of-track — which is present in the blob but outside the declared length. All 71 land on that boundary exactly, with the canonical EOT immediately after. The game's driver must therefore read to EOT rather than trust the length field; **a port that trusts the length will truncate every AdLib track.**
- **`FF 7F` metas are conclusively OPL2 instrument data** in AdLib `.BNK` layout: 1115 instances, all 34 bytes — 5-byte header, voice index 0–8, then 2 operators × 13 bytes, then 2 waveform-select bytes. Confirming detail: operator 0's `FEEDBACK` field is in-range 0–7 while operator 1's holds only junk values, exactly the `.BNK` convention where op1's feedback slot is unused. `waveSel` capped at 3 pins it to OPL2, not OPL3.
- **The two driver families are complementary and mutually exclusive:** AdLib embeds OPL patches and never sends a program change; Roland sends MT-32 program changes (programs 0–41, plus CC7/CC1/CC121) and embeds no instrument data at all. Consequence: **the extracted AdLib `.mid` files play as default piano in a GM player** — they are only correct through an OPL synth loaded with their embedded patches.

Two claims this pass **refuted or corrected**: `PGODFONT.DAT` is *not* 42 records of 16×16 — it is 41 of 16×16 plus one **208×46 record holding the GODS title logo**; and the previously-hypothesised `UNKNOWN_mus_type2` structure (count byte + ascending `u16` key table + bulk) does **not** hold — the ascending prefix is only 13–28 entries and the predicted boundary shows no discontinuity. Also worth noting for the map work: **`PLEVEL<N><X>.PI1` is not a terrain tileset** despite the name — it is a 60-frame 32×32 creature animation strip.

## Phase 4 — ported functions `[PROVEN by differential test]`

Five load-bearing functions are ported to portable C99 in `scratchpad/port/`, each **differential-tested against real game data** and independently re-verified (compiled and re-run by a second party, with its own independent test written from the binary).

| Function | Port | Test result |
|---|---|---|
| Graphics export 3 — ST→VGA planar convert | `gods_gfx_planar.c` | **44/44 `.PI1` files pixel-exact** vs the validated oracle |
| Graphics export 37 — cubic Bézier | `gods_bezier.c` | **2400/2400 exact** vs a register-level simulation |
| `FUN_1000_2619` — Table 2 disk lookup | `gods_table2.c` | **14592 cases, 0 diffs**; 37 quirk assertions pass |
| `FUN_1000_36f8` — `.MAP` parser | `gods_map.c` | **8/8 maps**, 1600/1600 objects, real game text recovered |
| `1000:39ae` + 17 predicates — **trigger engine** | `gods_trigger.c` | **756/2268/1207** record/slot/COND0 counts and the full verb histogram reproduced from raw bytes; **9/9 mutants killed** |

### The trigger engine port `[PROVEN]`

`gods_trigger.c` / `test_trigger.c`. The test recomputes, independently from the shipped `.MAP` bytes, every published figure for section 4 — **756 live records, 2268 condition slots, 1207 of them `COND0`**, max cond kind 16, max verb 14, and the verb histogram `203/4/75/75/3/134/25/60/48/18/7/6/8/77/13`. Those numbers were originally produced by a different tool, so agreement is a genuine cross-check rather than a restatement.

It also runs two real records end-to-end: `PLEV1A #6` (`verb 0, arg 5, msg 2, COND10 arg 12`) fires for a fast player and not a slow one, and `#28` (`verb 0, arg 54, msg 7, COND14 arg 24 + COND9 arg 24`) fires for a slow, low-scoring player and not a fast one — the "speed bonus" / "help bonus" behaviour, reproduced by the port.

**Mutation-tested, 9 plausible porting mistakes injected, all 9 killed:** strict `>` relaxed to `>=` (twice), a swapped pair polarity, `COND0` returning FAIL, `AND` becoming `OR`, big-endian parse flipped to little-endian, the timer divisor 17 → 16, the score scale 5000 → 1000, and the record stride 24 → 12.

Four traps this port encodes, each of which silently breaks level logic:

- **Every predicate pair is strict — equality fails *both* members.** Writing `>=` anywhere inverts boundary behaviour.
- **PASS is "do nothing".** Slots start `0xFF`; predicates only ever store 0. Clearing is monotone, so slot order provably cannot matter (asserted in the test).
- **`COND0` is a bare `RET`** — always passes, argument ignored. It is the unused-slot filler, and a record whose three slots are all `COND0` always fires.
- **The original's FAIL store is a word**, spilling a zero into the next slot byte. Because clearing is monotone the spill can never change a verdict, so **a port may safely use byte writes** — the analysis matters precisely because it licenses the simpler implementation.

One deliberate divergence, flagged rather than copied: the original dispatcher has **no bounds check** on `cond_kind` and would call through arbitrary memory. The port clamps instead.

Build and run: `cc -std=c99 -O2 -Wall -Wextra -o test_planar test_planar.c gods_gfx_planar.c && ./test_planar .` (zero warnings on all four).

**The test suites are mutation-tested**, which matters more than the pass counts: four plausible porting mistakes were deliberately injected into the planar converter (reversed plane order, stride 40 instead of 44, an added byte-swap, source skip 7 instead of 6) and **all four were killed** — three by the oracle comparison, one by a `PROT_NONE` guard page catching the read overrun. A suite that cannot fail is not evidence.

### Four traps found, each of which a reasonable port would fall into

- **Export 3 contains no byte swap, and adding one is a bug.** Despite the asset data being big-endian throughout, this routine does a pure `movsb` byte copy. ST plane-word bit 15 is the leftmost pixel, so the big-endian word's *high* byte holds pixels 0–7 with bit 7 = pixel 0 — which is exactly VGA planar byte order. **The endianness cancels.** Proven by mutation: the "endian fix" mutant failed all 44 files.
- **`BEZIER.DAT` is Q16, not Q15.** The basis tables sum to ~65536, and a `shr ax,1` in the *caller* at `GAME.EXE:0xD489` converts to Q15 before use. Get this wrong and the error against exact Bernstein values explodes from ~3 to ~49110 (int16 wrap). The table is loaded raw — `INT 21h` open/read/close, no decompression — so `0xD489` is the only transform applied.
- **The Q15 shift must be an arithmetic right shift, not a division.** For basis `32767` × control `−100`, `>>15` floors to `−100` while C's `/32768` truncates to `−99`. The original uses `SAR`; a port written with `/` is silently wrong on every negative coordinate.
- **`t = i/200`, and there is no `t = 1.0` entry.** So `t=199` yields `(199,197)` rather than the exact endpoint `P3=(200,199)`. That is the table's design, not drift — a port that "corrects" the endpoint diverges from the original.

### Corrections to this document's own prior claims

- **Table 2 quirk 3 was stated too simply.** Value byte #1 gets a **zero** test (`OR AL,AL / JZ` — id 0 means *no disk check*), while bytes 2–3 get the **sign** test (`JS` — any high-bit byte terminates the list). Two different tests with different meanings, not one.
- **Quirk 1's consequence was overstated.** Returning the *last* id on a no-match is confirmed at the instruction level, but it does **not** mean the game asks for the wrong disk: the id list is the **set** of disks holding that file, and all 10 multi-id records in the shipped table are `{2,3}` — both disks hold the asset. It is a last-listed-wins tie-break. The mechanism is proven; the "wrong disk" characterisation was not.

## Enemy spawn — the chain a port needs `[PROVEN]`

Formerly the biggest port blocker. Selector 4 activates a **System-B** group; selector 5 is System A.

**Activation, `CS:0xde08` — and the order is a real behaviour:**

```
de08  mov word [si],0xffff        ; THE EVENT IS CONSUMED FIRST
      mov ax,[si+0x2]             ; param
      mov si,0xa1ac / mov bx,0x16 / mul bx / add si,ax
      mov bp,0x36b4 / mov cx,0xa
de1f  cmp word [bp+0x0],0 / jz / add bp,0x12 / loop
de2a  ret                         ; ALL TEN SLOTS BUSY -> ACTIVATION LOST FOREVER
de2b  mov word [bp+0x0],2 / mov [bp+0x2],si
```

Because the consume precedes the slot search, a group arriving when all ten runtime slots are busy is dropped **and can never fire again**.

**The spawn loop, `CS:0xec60`:**

```
ec63  mov cl,[si] / or cx,cx / jnz / jmp 0xed38   ; count 0 -> the slot is NOT freed
ec70  mov ax,[si+0x12] / xchg al,ah / mov bx,ax
      mov al,ah / sub ah,ah / sub bh,bh
      shl ax,1 (x5)                               ; X = desc[0x12] * 32
      shl bx,1 (x4)                               ; Y = desc[0x13] * 16
ec9f  mov word [di+0x8],0xfffe                    ; state = waiting
eca4  mov [di+0x6],dx                             ; stagger, += desc[0x14] per entity
```

**Initial mode, `CS:0xecc5`** — note the `push di`/`pop di` around a clobber; reading `[di+0x100]` as an *entity* field writes garbage:

```
ecc6  push di
ecc9  call 0xf0d9                 ; DI := plane-B pointer for the SPAWN cell
eccc  cmp byte [di+0x100],0x1     ; ground two rows below? EXACTLY == 1
ecd3  mov cx,0x2                  ; not ground -> +2 (a fall mode)
ecd6  mov ax,[si+0x4] / xchg al,ah / shr ax,9 / and ax,1 / add ax,bx
ece7  pop di / mov [di+0xa],ax
```

**All entities of a group spawn at the same point** — only the appearance *time* differs, and it is **not** the plane-B cell that triggered them.

### The System-B group descriptor — PALFILS `+0x11A4`, 50 × 22 B

| off | meaning | | off | meaning |
|---|---|---|---|---|
| `+0x00` | entity count, 1..10; **0 = dead record** | | `+0x0b` | speed: step delay = `10 − v`, so **higher is faster** |
| `+0x01` | hit points per entity | | `+0x12` | spawn tile X (× 32) |
| `+0x04`/`05` | BE flag word; **bit 9 = initial facing** | | `+0x13` | spawn tile Y (× 16) |
| `+0x06` | lo nibble = fire rate; hi nibble `[WF]` | | `+0x14` | per-entity stagger, in frames |
| `+0x07` | sprite-class index | | | |

**Measured across the 8 shipped levels:** 270 live descriptors (14/14/30/28/50/50/42/42), 217 selector-4 references and **zero dangling**, entity counts `{1,2,3,4,5,10}`, speeds `{1,7,8,9,10}`, spawn tiles X 1..126 and Y 1..60 — inside the 128×64 map every time.

### The enemy sprite — `UNKNOWN_sysB_sprite_formula` CLOSED `[PROVEN]`

```
CS:0xf0ae  si = 0xdbe0 + mode*4 / cx = [si+2]      ; MODE_ANIM
           cx += [di+4]                            ; frame
           si = [bp+2] / al = [si+7]               ; class index
           si = [0x1fc] / si += cls*12
           cx += [si]                              ; + class sprite base
```

`sprite = class_base + MODE_ANIM[mode] + frame`, `MODE_ANIM = [0,9,8,17,8,17,8,17]`.

**The `#450` anchor lands exactly.** `always` (170) + `objects` (280) = **450**, and the lowest class base is 450. The group at #450 is `level<N>` — and this document separately established that *"`PLEVEL<N><X>.PI1` is not a terrain tileset despite the name — a 60-frame 32×32 creature animation strip"*. That is exactly what a monster group at #450 has to be. Three findings converging.

**`DS:0x1fc` is not a table — it's a per-level POINTER, and `DS:0xdf80`'s 8 entries are not fixed-size records.** The loader, `CS:0xad62` (previously unlocated):

```
ad62  mov si,0xdf80
ad65  mov al,[0x42]        ; world (1..4)
ad68  dec al / cbw
ad6b  shl ax,1 / shl ax,1  ; (world-1)*4
ad6f  add si,ax
ad71  lodsw / mov [0x1fe],ax   ; pointer #1 -> DS:0x1fe
ad75  lodsw / mov [0x1fc],ax   ; pointer #2 -> DS:0x1fc  (what f0ae reads)
ad79  ret
```

So `DS:0xdf80` is **4 worlds × 2 pointers**, and each pointer is the base of its own **variable-length, `0xFFFF`-terminated class table** — not a slice of one flat 12-entry array. Reading all 8 tables with their real bounds (each table's length is exactly the byte gap to the next table's pointer, confirmed independently by every one of the 8 ending in an explicit all-`0xFFFF` sentinel record with zero slack either side):

| world | system | pointer | records | ends |
|---|---|---|---|---|
| 1 | A | `0xe046` | 3 live + sentinel | butts against world 1's own B pointer, `0xe076` |
| 1 | B | `0xe076` | 8 live + sentinel | butts against world 2's A pointer |
| 2 | A | `0xe0e2` | 4 live + sentinel | | 2 | B | `0xe11e` | 8 live + sentinel |
| 3 | A | `0xe18a` | 3 live + sentinel | | 3 | B | `0xe1ba` | 7 live + sentinel |
| 4 | A | `0xe21a` | 4 live + sentinel | | 4 | B | `0xe256` | 7 live + sentinel |

Memory order is `w1A, w1B, w2A, w2B, w3A, w3B, w4A, w4B` — each world's **A** table sits immediately before that **same world's own B** table, and each world's B table butts against the **next world's** A table. This is exactly what produced the earlier "bases are 6 apart, pooled" confusion: reading a fixed 8 or 12 records per pointer with no knowledge of where a table actually ends walks straight through the `0xFFFF` sentinel into the next table — a different world or a different system — and collects numbers that were never adjacent in any single real table. Sorting the result afterward manufactured small, meaningless gaps between unrelated tables' entries.

**`DS:0x1fe` (pointer #1) is System A's own class table, with its own resolver — `CS:0xe199`, previously unlocated.** Structurally identical to System B's `CS:0xf0ae` but reading the other pointer:

```
e199  mov cl,[si+0x7] / sub ch,ch      ; class index (same descriptor offset as System B)
e19f  mov si,[0x1fe]                   ; System A's table pointer
e1a3  shl cx,1 (x2) / add si,cx        ; +4*cls
e1a7  shl cx,1 / add si,cx             ; +8*cls  -> total +12*cls
e1ad  mov cx,[si]                      ; class sprite base
```

called from `CS:0xe001`'s own tail (`CS:0xe094`, right after the trail-follow buffer append and the world→screen conversion `sub ax,[0xa] / sub bx,[0xc]`), storing the result into `[0x8]` alongside `[0x4]`/`[0x6]` — the exact same screen-position/sprite-id triple this document already documents feeding the **shared** `CS:0xff93` contact test and `CS:0x3569` draw call. So System A really does have its own 12-byte-stride class table, reached the same way as System B's, just through the sibling pointer — confirming the "6–8 apart" figures genuinely belong to System A's tables (they use a flatter animation model with no `MODE_ANIM`-style per-mode offset, so their classes don't need 18-wide reservations) and were never in tension with System B's numbers; they were just read as if they were the same table.

**The "25 slots" tension is dissolved, not just avoided.** It assumed `anim_base` (max 17) and `frame` (max 7) vary independently. Reading the three mode-handler bodies that matter settles it:

- **Walk** (`CS:0xf11f` left, anim_base 0; `CS:0xf1e5` right, anim_base 9) — `inc word [di+0x4] / and word [di+0x4],0x7` (`CS:0xf1d7`, mirrored at `CS:0xf29e`): frame free-runs **0..7**, but `anim_base` here is only 0 or 9, never 17.
- **Fall** (`CS:0xf4e5`, anim_base 17) — `mov word [di+0x4],0x0` is the handler's *first instruction*, and nothing in the body writes `[di+0x4]` again: frame is **pinned to 0** for the whole fall.
- **Hop** (`CS:0xf316`/`CS:0xf3ee`, anim_base 8/17) — an exhaustive read of both bodies (main loop plus the `0xf3ae`/`0xf3cd` ground-probe helpers) finds **no reference to `[di+0x4]` at all**. Frame is whatever the walk→hop transition left it at, and every transition into a hop explicitly zeroes it first (e.g. `CS:0xf165 mov word [di+0x4],0x0`), so it stays **0** for the hop's whole duration.

So `anim_base == 17` and `frame > 0` **never co-occur** — the highest offset any class ever computes is `max(9 + 7, 17 + 0) = 17`, needing exactly **18** contiguous slots (`0..17`). That is not a coincidence restricted to "the 9 classes the shipped descriptors reference" (an earlier revision's hedge) — it is a structural guarantee from the handler code itself, true for every class the table could ever hold. The 18-wide spacing measured between consecutive live 32×32 System-B classes (e.g. world 1: 462 → 480 → 498) is exactly this bound with zero slack, and it can never be violated by any reachable `(mode, frame)` pair.

### `UNKNOWN_sysA_movement_layer` — CLOSED: System A has its own movement layer `[PROVEN]`

Half of the old `UNKNOWN_entity_movement_layer` closed earlier with a correction: **`DS:0xdbe0` is System B's movement layer only.** The immediate `E0 DB` occurs exactly twice file-wide (`CS:0xedc3`, `CS:0xf0ae`) and every caller of the second reader lies in `0xee0e`–`0xf4ea`; System A (head `0xdf3a`, stride `0x28`) never touches it. So `0xe7ca`'s absolute-destination write belongs to System A. **System A's own layer is now located too — see below — and it is architecturally different from B's, not a variant of it.**

**The System-B movement layer, re-read here and `[PROVEN]` unless tagged.**

`DS:0xdbe0` (file `0x1DD40`) is **8 × 4 bytes of `{u16 handler, u16 anim_base}`** — the *reverse* field order of the player's `DS:0xd818`, which is exactly the sort of thing a port mirrors wrongly:

| mode | handler | `anim_base` | | mode | handler | `anim_base` |
|---|---|---|---|---|---|---|
| 0 | `0xf11f` | 0 | walk left | 4 | `0xf316` | 8 | hop left |
| 1 | `0xf1e5` | 9 | walk right | 5 | `0xf3ee` | 17 | hop right |
| 2 | `0xf487` | 8 | fall left | 6 | `0xf129` | 8 | *unreachable* |
| 3 | `0xf4e5` | 17 | fall right | 7 | `0xf1ef` | 17 | *unreachable* |

Both read sites are identical — `mov si,0xdbe0 / mov ax,[di+0xa] / shl ax,1 ×2 / add si,ax` — so the selector is entity `[di+0x0a]` with **no bounds check**. The immediate `E0 DB` occurs exactly twice file-wide (`CS:0xedc4`, `CS:0xf0af`), which is what pins this table to System B alone. Modes 6/7 are the *fall-through targets of modes 0/1's alignment gate* (`0xf11f` gates `jz 0xf129`), not separate behaviours.

- **Walk** (`0xf1be`): `dec word [di+0x6] / jns` — move only when the delay counter goes **negative**, then reload `ax = 10 − desc[+0x0b]` (`cbw`-extended), step `sub word [di],4`, and advance the animation `inc word [di+0x4] / and word [di+0x4],7`. So **higher `desc[+0x0b]` is faster**; shipped values are `{0,1,7,8,9,10}`, and 10 is the largest that keeps the reload non-negative.
- **The map is probed only on a tile crossing**: `mov ax,[di] / and ax,0x1c / jz`. Since X moves in steps of 4, that is true only at multiples of 32 — once per tile. This is observable behaviour, not just an optimisation: it sets when turn-arounds can happen.
- **Fall** (`0xf487`): `ax = [di+0x12]; if (ax != 0x10) [di+0x12]++; [di+0x2] += ax` — the velocity is applied **before** the increment and clamps at **16**. The hero uses `4 + v` capped at 10. **Do not share the code.** Landing snaps `and word [di+0x2],0xfff0` and sets mode 0.
- **The ground test is `== 1` exactly** (`cmp byte [ds:bp+0x100],0x1`), with the same `(X & 0x1f) >= 8` straddle the hero uses. Plane-B 2 (ladder) and every event cell ≥ 3 are therefore **not ground** — a System-B entity falls straight through them. A port written as `planeB >= 1` diverges on every ladder column.
- **The on-screen cull** (`0xf586`) is asymmetric: `x ∈ [−63, 351]`, `y ∈ [−63, 223]`, and it **pre-sets the verdict `DS:0x2ac` to `0xFFFF`** before testing — so an off-screen entity gets verdict −1 and mode 0 branches on `js`. Off-screen enemies skip the search entirely.

**The hop arc table `DS:0xdcde` extends into NEGATIVE indices** — it is centred on its own base, like the hero's jump table but signed both ways:

```
idx  -6  -5  -4  -3  -2  -1 |  0  +1  +2  +3  +4  +5 .. +15
val   8   8   4   2   1   1 |  0  -1  -1  -2  -4  -8 ..  -8
```

A port that treats `0xdcde` as the start of the table and clamps at 0 loses the entire descent. Indices ≥ 16 are garbage (`−772, −248, 1288, 1280`), so the cursor cap matters.

**The System-A movement layer, `[PROVEN]` — and it is NOT a `DS:0xdbe0`-shaped mode table.**

`CS:0xdf3a` is System A's per-frame group loop — the structural sibling of B's `CS:0xedb8`/`CS:0xedf4` — and it announces itself unambiguously: `mov byte [0x3c2],0x0` is the very first instruction, matching the already-documented "`DS:0x3c2`, `0x00` for A, `0xff` for B" discriminator exactly. It sets `bp = SS:0x3768` (group runtime), `di = DS:0xe96` (entity records), resets the marker cursor `DS:0x208 = 0xb5dc`, and walks **10** group-runtime slots (`SS:0x435`, seeded 9, the familiar `dec/jns` off-by-one — a sixth instance of that trap in this project). For each active group (`[bp+0] == 1`) it reads `si = [bp+2]` (the descriptor, saved by the activator `CS:0xde42` — itself byte-for-byte the System-A twin of B's `CS:0xde08`: consume-the-event-first, first-fit over 10 slots, give up silently if all are busy), `cl = [si]` (entity count), and calls **`CS:0xe001`** once per live entity (`[di+0x8]` nonzero), stride `0x28`.

**`CS:0xe001` is a fixed six-stage pipeline, run unconditionally for every entity every tick — not a dispatch to one handler:**

| stage | call | role |
|---|---|---|
| 1 | `CS:0xe6e4` | **the mode selector — this is System A's real analogue of B's `DS:0xdbe0` dispatch** |
| 2 | `CS:0xe336` | accelerate a velocity pair `[di+0x12]/[di+0x14]` toward the goal `[di+0x1c]/[di+0x1e]`, or decay it to zero once arrived |
| 3 | `CS:0xe487` | descriptor-gated (`[si+0xf]`) special action (attack/leap), may override the velocity |
| 4 | `CS:0xe44d` | clamp velocity to a **second**, independent speed cap `[si+0xb]` |
| 5 | `CS:0xe42b` | **apply** — position update, or a snap-to-goal, or nothing at all |
| 6 | `CS:0xe659` | recompute the facing/muzzle direction `DS:0x206` |

Then contact via **`CS:0xff93`** and draw via **`CS:0x3569`** — reached through the identical `push si/di/bp`, `DS:0x35e = 1` then `0`, `[di+0x8]`-sign, death-or-draw bracket already documented for System B at `CS:0xedf4`–`0xee00`. **Both routines are shared between the two systems, not System-B-exclusive as this document previously implied** — corrected at *Entity contact* above.

**Stage 1, `CS:0xe6e4`, is the real find.** `[di+0x24]` is a *sticky* per-entity mode byte: if it is negative (unset), the entity rolls a fresh strategy — gated first by a per-GROUP throttle (a bitmask at `[bp+0x14]`/`[0x3c4]` capping how many group members can commit to a new strategy on the same tick, plus a `[si+0xa]`-vs-random gate) — landing at `CS:0xe748`, which reads descriptor `[si+0x8]` as a **lo/hi nibble pair** and `[si+0x9]` as a **7-bit weight**, rolls `0x3836` against it, and swaps the two nibbles on a lost roll. This is the *exact* shape already documented for System B's pathfinder-seed picker at `CS:0xf6db` — same field offsets, same weight polarity — just wired to a different entity system. If `[di+0x24]` is already set (≥ 0), the entity skips the reroll and jumps straight back into the **same** strategy via `CS:0xe76b` with the sticky value.

Both paths land on one jump table, **`DS:0xd95c`**, verified by reading the raw words (file offset `= (0x1ffd*16 + 0xd95c) − 0xFE70 = 0x1DABC`, the same formula this document already uses, cross-checked first against the already-documented `DS:0xd966` to confirm it):

```
idx 0  0xe77b        idx 5  0xf854   ⎫
idx 1  0xe9da        idx 6  0xf729   ⎬ byte-identical to DS:0xd966[0..3]
idx 2  0xe88c        idx 7  0xf794   ⎪ (the System-B pathfinder-seed table)
idx 3  0xeb36  (RET) idx 8  0xf800   ⎭
idx 4  0xe7db
idx 9  0x0000  (terminator)
```

**`DS:0xd966` is not a second table — it is `DS:0xd95c + 5 words`.** System B's own picker hardcodes base `0xd966` only because no shipped System-B descriptor nibble ever exceeds 3; the physical words it reads are the tail of the same array System A indexes from 0. This reframes the earlier "`DS:0xd966` is only four entries" finding: true in isolation, but it is a four-entry *window* onto a shared nine-entry table, not a standalone one.

- **Index 0 — `0xe77b`, chase.** Falls straight into `0xe7c4`/`0xe7ca` (`mov ax,[0x17a] / mov bx,[0x17c] / add bx,8` — write the hero's position as the goal) unless a per-entity progress ratio (`[bp+0x12]`/`[bp+0x13]`) or a `[si+0xa]`-gated reroll intervenes.
- **Index 1 — `0xe9da`.** A weighted, minimum-cost search over **six** scratch slots at `DS:0x3c5..0x3ca` (`mov bp,5` then `dec bp/jns` — the off-by-one again, seven instance now), gated by descriptor `[si+0xd]`; the deepest-undecoded piece of this system (`0xec12`, `0xeaf7`, `0xeb1a` unread).
- **Index 2 — `0xe88c`, the marker-seek.** Reuses the *same* `DS:0x398`/`DS:0x208` globals as System B's own "attracts monsters" potion strategy (`0xf794`) — implemented as separate code for A, but the same mechanism.
- **Index 3 — `0xeb36`.** A bare `RET`. Dead, in the same family as player state 7 and the flame weapon's null spawn/mover pair.
- **Index 4 — `0xe7db`, trail-follow.** `CS:0xe001`'s own tail (`add [bp+0xe0],4`, wrap at `0x190`) appends every entity's `(X,Y)` each tick to a 100-slot circular buffer per group, based at `[bp+0x18]`; index 4 reads an **older** slot, offset by `([di+0x19]−1)×16` bytes back — a conga-line / follow-the-leader mechanic.
- **Indices 5–8 — the four System-B goal strategies**, verbatim: hero-column, box-around-hero, marker-list, first-on-screen waypoint.

**Shipped-data census, matching this document's own validation standard.** Across all 400 System-A descriptor slots (`PALFILS.0{A,B}{1-4}`, `DS:0x9d60`, 50 records × 8 files), only **74 are live** (`9/9/10/9/9/9/10/9`, entity count `[si+0] != 0`) — and the `[si+0x8]` nibble across every live record is in **`{0, 1, 2}`**, never reaching 3 or beyond. So in the shipped release **only strategies 0–2 (chase, the flock/target search, marker-seek) are ever selected** — the dead RET, the trail-follow, and all four B-shared goal strategies are real, reachable code with no bounds check, but no shipped System-A descriptor ever picks them.

`UNKNOWN_sysB_sprite_formula` is CLOSED — see *The enemy sprite* above, which now also covers System A's own resolver (`CS:0xe199`), the `DS:0xdf80` pointer-table structure, and the proof that the 18-slot spacing has no exceptions.

`UNKNOWN_pathfinder_producers` — the four move generators (`0xfd54`, `0xfe36`, `0xfcbc`, `0xfb4d`) called by the expand routine `0xf64d` — **is CLOSED**; all four are decoded and ported, and the port hunts. See *The enemy pathfinder* **above**, not below. ⚠️ An earlier revision of this paragraph called them "the last thing standing between the port and hunting enemies", and left that standing after the closure was written 980 lines earlier — the same stale-`UNKNOWN_` pattern this document keeps having to sweep for.

### System A's six-stage pipeline — stages 2, 4, 5, 6 and the sprite resolver, fully decoded `[PROVEN]`

Following on from *`UNKNOWN_sysA_movement_layer` — CLOSED* above (which located the pipeline and decoded stage 1's strategy dispatch): the remaining five pieces — stages 2, 4, 5, 6, the sprite resolver `CS:0xe199`, and System A's own spawn/materialise loop — are now read byte-for-byte, all via `disassemble_function`/`disassemble_bytes` (never `decompile_function`), closing the port-blocking gaps the earlier pass over the pipeline left.

**Stage 2 — `CS:0xe336`, accelerate-toward-goal, and the flag stage 3 depends on.**

```
e336  cx = [di+0x1c] ; dx = [di+0x1e]        ; goal X/Y
e33c  ax = [di]      ; bx = [di+0x2]         ; entity X/Y
      push ax,bx,cx,dx                        ; save the RAW (pre-round) values
e346  bp = 0x10 ; ax/bx/cx/dx += bp           ; +16 to all four
e351  bp = 0xffe0 ; ax/bx/cx/dx &= bp         ; round DOWN to the nearest 32 (a rounded-to-nearest-cell test)
e35d  cmp cx,ax / jnz e365
e361  cmp dx,bx / jz e3b5                     ; rounded goal cell == rounded entity cell -> ARRIVED (e3b5)
e365  pop dx,cx,bx,ax                          ; not arrived: restore the RAW values
e369  cx = goalX - entityX ; dx = goalY - entityY
e36d  cx >>= 3 (arithmetic)                    ; a proportional step, 1/8 of the remaining distance
e373  dx >>= 3 (arithmetic)
e379  ax = [di+0x16]                            ; entity's own per-tick step cap
e37c  bx = [si+0xc]                             ; descriptor +0xc, zero-extended byte — a SECOND cap
e381  ax = min(ax, bx)                          ; the smaller of the two caps wins
e386  bx = -ax
e38a  cx = clamp(cx, bx, ax)                    ; clamp the 1/8-distance step to +/-min(cap)
e39c  dx = clamp(dx, bx, ax)
e3ae  [di+0x12] += cx ; [di+0x14] += dx         ; ACCUMULATE into velocity — not a set, an increment
e3b4  ret
```

So stage 2's normal path does not steer velocity directly at goal; it nudges the existing velocity by up to `min([di+0x16], descriptor[+0xc])` toward `(goal-entity)/8` every tick, clamped per-axis independently. `[di+0x16]` is therefore a THIRD role for that field, beyond the already-documented stage-3 speed-comparison and the sprite resolver's animation-cadence divisor (`CS:0xe199`, below) — one word governs per-tick steering budget, attack-speed comparison, and animation rate together. `descriptor[+0xc]` is a per-class steering-step cap that competes with `[di+0x16]` for the smaller value — see *`UNKNOWN_sysA_descriptor_0c` — CLOSED* below for its shipped-data range (always 1..10), still without a name for what *sets* `[di+0x16]` per-entity.

**The arrival branch, `e3b5`, is where the coarse/fine distinction lives:**

```
e3b5  ax = min([di+0x16], [si+0xc])            ; the same cap
e3c2  cx = [di+0x12] ; decay CX toward 0 by ax, clamping AT the zero crossing (not past it)
e3d7  dx = [di+0x14] ; the same decay on Y
e3ec  [di+0x12]=cx ; [di+0x14]=dx
e3f2  [di+0x1b] = 1                             ; COARSE arrival flag (32px cell match)
      pop dx,cx,bx,ax                            ; the RAW (unrounded) saved values, still on the stack
e3fa  cmp byte [di+0x19],0 / jz e42a
e400  cmp byte [di+0x19],1 / jz e42a             ; [di+0x19] gates the fine check: skip when 0 or 1
e406  bp=4 ; ax/bx/cx/dx += bp ; bp=0xfff8 ; ax/bx/cx/dx &= bp   ; round to the nearest 8
e41e  cmp cx,ax / jnz e42a
e422  cmp dx,bx / jnz e42a
e426  [di+0x25] = 1                              ; FINE arrival flag — 8px, not 32px
e42a  ret
```

**`[di+0x25]` is the flag stage 3 (`CS:0xe487`, `[si+0xf]`-gated attack/leap) reads to decide whether to fire its special action, and stage 5 reads it too (below) to decide whether to snap position outright.** So the closure this session already wrote for `FUN_1000_e4e2`/stage 3's caller behavior gets its missing precondition: the attack only arms once the entity is within 8px of its goal on BOTH axes, and only when `[di+0x19]` is neither 0 nor 1 — see the closure immediately below.

### `UNKNOWN_sysA_field_0x19` — substantially CLOSED: a per-entity "reroll queue rank" stamp `[STATIC]`

`[di+0x19]` has exactly **one writer** in the whole image, `CS:0xE72D`, inside stage 1's per-entity throttled-reroll gate (`FUN_1000_e6e4`, the strategy dispatcher this document already documents). Reading the gate in full:

```
e6f1  cmp byte[bp+0x12],0 / jz 0xe748        ; group-runtime "reroll slots used" counter == 0 -> nothing gates, skip
e6f7  cl = [0x3c4] ; ax = 1<<cl               ; a per-tick GLOBAL bit position
e700  cx = [bp+0x14] ; test ax,cx / jnz 0xe748  ; that bit already set in this group's "rolled" bitmask -> skip
e707  cl = [si+0xa] ; call 0x3836 (random) ; and ax,0x7f
e710  cmp ax,cx(weight) / jge 0xe748          ; the descriptor's own weight, same shape as the pathfinder-seed picker
e714  al=[bp+0x12] ; ax = al*10               ; the group's reroll counter, scaled by 10
e722  cmp bx,[bp+0x16] / jg 0xe748            ; over the group's own cap -> skip (the "per-group throttle" already documented)
e727  inc byte[bp+0x12]                       ; ADVANCE the group's reroll counter
e72a  al = [bp+0x12]
e72d  [di+0x19] = al                          ; <-- STAMP this entity with the counter's NEW value
e730..e73e                                     ; mark the per-tick global bit as consumed
```

So `[di+0x19]` is not a boolean gate at all — it is **the group-runtime reroll-throttle counter's value at the moment this specific entity's reroll request was granted**, i.e. a 1-based "my rank in this group's reroll queue this tick" stamp. It has **four** readers, and two of them treat the value ordinally rather than as a flag:

- Stage 2 (`CS:0xE3FA`/`E400`, already documented) only distinguishes `0` from `1` from "anything else" to gate the fine-arrival check.
- The pipeline dispatcher `CS:0xE001` (`CS:0xE039`) tests it against exactly `1`.
- The entity system's per-entity death handler (`CS:0xE289`; see *`UNKNOWN_df62_full_flow` — CLOSED* below for why it is **not** actually `FUN_1000_df62`, a mislabelled, unrelated address) reads it, compares against `1`, and branches to `CALL 0x1000:ebb9` when true, else `DEC byte[bp+0x12]` — **undoing** the group counter's own advance, as if giving the slot back — immediately after this same code drops any carried item via the popup spawner `CS:0xBF5F` (gated on a separate field, `[di+0x10]`, not on this rank check). Read together with this session's own `UNKNOWN_bf5f_popup_id` closure: a normal drop goes through the popup spawner (so most dropped items become a floating icon, not a solid object), and **only the entity whose reroll rank is exactly 1 — the first granted this tick — proceeds to `CS:0xEBB9`**; every other entity that rolled this tick has its own throttle advance reversed.
- `FUN_1000_ebe5` (`CS:0xEBEB`) reads `[di+0x19]` and compares it against **another group member's own `[si+0x19]`** (`si` sourced from `DS:0x294`, the already-documented "current group's entity base" shadow global), gated by rotating a bit out of the group's "rolled" bitmask per candidate — a genuine ordinal scan across the group, not a boolean test.

So `[di+0x19]`'s real role is: **exactly one entity per group per tick — the one stamped `1`, i.e. first through the reroll gate — is privileged** by at least two of its four consumers, with a third (`ebe5`) running a fuller rank comparison across the whole group.

### `UNKNOWN_ebb9_reroll_effect` — CLOSED: a synchronized whole-group strategy reset `[STATIC]`

`CS:0xEBB9`, the privileged (rank-1) entity's own call target, is a **group-wide reset**, not a per-entity effect:

```
ebb9  [bp+0x12] = 0                 ; the GROUP's own reroll-throttle counter -> back to 0
ebbd  [bp+0x14] = 0                 ; the GROUP's own "rolled" bitmask -> cleared
ebc2  al = [si]                     ; SI here is still the GROUP DESCRIPTOR pointer (this entity system's `+0x0` = entity count field)
ebc4  si = [0x294]                  ; the already-documented "current group's entity base" shadow global
ebc8  cx = sign_extend(al)          ; loop count := the group's own entity count
ebcb  [si+0x19] = 0                 ; each member's own reroll stamp -> 0
ebcf  [si+0x25] = 0                 ; each member's own FINE-arrival flag -> 0
ebd3  [si+0xa] = 1                  ; a movement-related field, set uniformly
ebd8  [si+0x24] = 0xff              ; each member's own STICKY strategy byte -> unset (0xFF, "reroll a fresh strategy next stage-1 pass")
ebdc  si += 0x28 ; loop 0xebcb      ; next member, stride 0x28 (System A's own entity stride)
```

So `CALL 0xEBB9` walks **every entity in the group** and force-unsets each one's own sticky strategy byte (`+0x24`) — the field stage 1 (`CS:0xE6E4`) checks first to decide "roll a fresh strategy vs. keep the current one." The whole `[di+0x19]` mechanism now reads as a coherent design: it exists so that when one entity in a group is granted the (randomly-weighted, budget-capped) reroll, only that ONE entity — the first through the gate this tick — gets to trigger a **synchronized reset of the entire group's goal strategy**, rather than each member rerolling independently and out of sync. Every other entity that also rolled this tick (rank ≠ 1) has its own individual throttle slot given back instead, so the group's reroll budget isn't wasted on entities that don't get to act.

### `UNKNOWN_df62_full_flow` — CLOSED: it isn't `FUN_1000_df62` at all — this is System A's per-entity DEATH DRAW `[STATIC]`

⚠️ **Correction to this document's own naming, caused by exactly the trap this document's header already warns about for this code region.** `1000:E283` (where the `[di+0x19]`/`CS:0xBF5F` code was first read) sits inside Ghidra's function labelled `FUN_1000_df62` purely because Ghidra's linear function-boundary detection swallowed a large, unrelated span starting at that address — `CS:0xDF62` itself is a completely different, already-fully-decoded piece of code (the shared inactive-slot loop-advance tail of the master per-group loop `FUN_1000_df39`, confirmed by direct disassembly: `df62 di=[0x294] / bp+=0xe4 / di+=0x190 / dec ss:[0x435] / jns df51 / ret`). The `CS:0xE283` block has nothing to do with it. Tracing the real chain instead (`get_xrefs_to` at each step):

```
CS:0xE0B2  cmp word[di+8],0 / jns 0xe0bb / jmp 0xe241   ; the STATE test: alive -> draw now; dead(<0) -> the death arm
CS:0xE0BB  call 0x1000:3569                              ; ALIVE: the shared entity blitter (already documented)
CS:0xE0C1  cmp word[di+0x10],0 / jns 0xe0c8 / ret         ; a NEW field, +0x10 = carried-item TYPE, negative = "carrying nothing"
CS:0xE0C8..E0F3                                           ; carrying: EASE the carried icon's own [di+0x20]/[di+0x22]
                                                           ;   position halfway toward the entity (SAR 1), matching this
                                                           ;   document's already-documented "eases those coordinates halfway"

CS:0xE241  call 0x1000:efe7 ; jmp 0x1000:e0bb              ; DEAD: the SAME BCD-pack helper this session's own
                                                           ;   UNKNOWN_creature_death_anim closure found for System B,
                                                           ;   then falls into the SAME draw call (0xe0bb -> CALL 0x3569)
                                                           ;   the alive branch uses — confirming BOTH entity systems
                                                           ;   share one death-draw idiom, not just System B
```

`[di+0x10]` (carried-item type) is the gate that ties everything together — it selects between the "ease + draw the carried icon" branch above **and** a *separate* drop path, reached elsewhere (`CS:0xE251`–`E282`, the position-cache/popup-drop block this document already documents): `CS:0xE25C cmp word[di+0x10],0 / js 0xe283` — carrying nothing skips straight to the `[di+0x19]` rank-check/`CS:0xEBB9` reset code; carrying something first drops it via `CS:0xBF5F` (recovering the display id: weapons pass through for `CS:0xBF5F`'s own `−0xC0`, ordinary types get `+0xB` pre-added so the SAME `id≥0xB → type=id−0xB` recovery inside `CS:0xBF5F` works unmodified) and only then falls into the identical `[di+0x19]` code.

**So the drop and the rank-check/group-reset are two independent, sequential steps on one shared code path, not two readings of the same mechanism**: the leading `[di+0x10]` test decides whether an item gets dropped first; the `[di+0x19]` machinery that follows runs unconditionally either way. `CS:0xE251`/`E253`/`E259` also caches the entity's own position into `DS:0x202`/`DS:0x204` — the *same* scratch pair this document's `UNKNOWN_creature_death_anim` closure already found `CS:0xEFE7`'s caller using.

### `UNKNOWN_sysA_0x1f4_elimination_detector` — CLOSED: a per-group "cleared" message, and the group-deactivation condition `[STATIC]`

Reading `FUN_1000_df39`'s tail in full (`CS:0xDFAC`–`0xE000`, immediately after the per-entity loop this document's own six-stage-pipeline section already documents):

```
dfac  cl = [si]                               ; the group descriptor's own entity-count field
dfae  cl -= [0x3c3] ; cl -= [0x1f4]            ; minus fully-dead, minus dying — the group's LIVE count
dfb6  [bp+0x13] = cl                            ; cached into a NEW group-runtime field, +0x13
dfb9  call 0x1000:eb37                          ; a side random-event roll — see below, not part of the elimination logic itself
dfbc  cl = [0x3c3] ; cl += [0x1f4]              ; dead + dying
dfc4  cmp cl,[si] / jnz 0xdff1                  ; not everyone dead-or-dying -> skip the whole block below
dfc8  ax=[0x202]+8 ; bx=[0x204]+8               ; the cached "last interesting entity" position, +8 on both axes
dfd5  cmp byte[bp+0x10],0 / jnz 0xdff1          ; group-runtime +0x10 — a ONE-SHOT "already announced" latch
dfdb  cx = word[si+0x10]                        ; the GROUP DESCRIPTOR's OWN +0x10 field (BE u16 — a PREVIOUSLY UNDOCUMENTED PALFILS field)
dfe0  or cx,cx / js 0xdfed                       ; negative -> no message configured for this group, skip the popup
dfe4  call 0x1000:bf5f                           ; spawn it via the already-decoded popup system, at the cached position
dfed  [bp+0x10] = 1                              ; latch — never announces twice
dff1  cl = [0x3c3]                               ; fully-dead count ALONE (dying entities don't count here)
dff5  cmp cl,[si] / jl 0xdffe                    ; still fewer fully-dead than the group total -> just advance
dff9  [bp+0] = 0                                 ; ALL fully dead -> DEACTIVATE the group (state -> 0, slot freed for reuse)
```

So there are **two distinct thresholds, not one**: "dead + dying == total" is the trigger for a **one-shot popup/message**, read straight out of a previously-undocumented `PALFILS` field (`System-A group descriptor +0x10`, big-endian `u16`) — this is the mechanism behind "you cleared this group" style flavour text, fired the instant the last live entity starts dying rather than waiting for its death animation to finish, at the position cached from whichever entity most recently went through the death-draw path. "Dead == total" (strictly fully dead, not merely dying) is the **separate, stricter** condition that actually frees the group's runtime slot. A group that has just finished dying-but-not-yet-dead sits in a window where the message has fired but the slot is still occupied.

### `UNKNOWN_sysA_0x16_refill` — CLOSED: a windup countdown, refilled by the attack and re-floored inside strategy 4 `[STATIC]`

`CS:0xE001`'s very first act is `DEC word[di+0x16]`, floored at `1` (`CS:0xE006`–`0xE00F`). A program-wide sweep for every instruction touching `[DI+0x16]` finds **13 hits**, and they split cleanly by which entity system actually owns them — a real trap, since System A and System B's entity records both happen to have live data at this same displacement:

| site | function | role |
|---|---|---|
| `E006`/`E009`/`E00F` | `FUN_1000_e001` (pipeline entry) | the generic per-tick decrement, floor `1` — already found |
| `E1CB`/`E20F`/`E233` | `FUN_1000_e199` (sprite resolver) | reads only — the already-documented animation-cadence divisor |
| `E379`/`E3B5` | `FUN_1000_e336` (stage 2) | reads only — the already-documented steering-step cap |
| **`E496`** | `FUN_1000_e487` (**stage 3**) | **`MOV word[di+0x16], 0xA`** — the REFILL: this is the already-documented attack/leap windup arm ("`[di+0x16] := 0xa`, a 10-tick windup") — so the field's real shape is a 10-tick countdown that re-arms on every successful attack and decays back down to a resting value of 1 between attacks, not a static per-class constant |
| `E7DB`/`E7E1` | `FUN_1000_e6e4` (**stage 1**, strategy-4/trail-follow handler) | `CMP word[di+0x16],2 / JGE / MOV word[di+0x16],2` — a **second, context-specific floor**: inside the trail-follow strategy specifically, the field is re-floored to `2` rather than `1` before use |
| `EE1E` | `FUN_1000_ee00` | ⚠️ **NOT the same field** — `FUN_1000_ee00` is this document's own already-documented **System-B** draw dispatcher (`"ee00 call 0x3569 ; alive -> draw"`), whose entity record is a different, `0x18`-stride struct. This hit is System B's own unrelated field at the same displacement. |
| `EFD2` | `FUN_1000_ef01` | ⚠️ Also **System B** — the already-documented steal-and-carry gate (`cmp byte[0x3cd],2`). Same caveat. |

So System A's own `+0x16` has exactly three write sites (the generic decrement/floor, the stage-3 windup refill, and stage 1's trail-follow-specific re-floor), all already independently attributable to documented mechanisms — the field was never actually "static," and the earlier framing undersold it.

### `UNKNOWN_eb37_purpose` — CLOSED: trail-follow LEADER ELECTION `[STATIC]`

Continuing `CS:0xEB37`'s weighted-pick branch (`CS:0xEB7F`–`0xEBB5`) past where it was left:

```
eb7f  cl = dl                        ; the picked member index (weighted draw, or the pre-selected [bp+0x11])
eb81  si = [0x294] + cl*0x28          ; the SELECTED entity's own record
eb8e  cmp word[si+8],0 / jz/js 0xebb5 ; must be genuinely alive — else give up silently
eb96  [si+0x19] = 1                   ; FORCE that entity's rank-1 stamp — the SAME field stage 1's organic reroll gate sets
eb9a  [bp+0x12] = 1                   ; the group's reroll-throttle counter forced to "exactly one winner"
eb9e  bx = 1 << cl ; [bp+0x14] = bx   ; the "rolled" bitmask forced to just that member's bit
ebaa  [bp+0x16] = 0                   ; reset — the SAME field CS:0xE039 (below) increments
ebaf  [bp+0xe0] = 0                   ; reset — the already-documented trail-follow circular-buffer cursor
```

And the pipeline's own tail, `CS:0xE039`, reveals the missing other half — it is the **direct consumer of the very fields `CS:0xEB37` just reset**:

```
e034  ax=[di] ; bx=[di+2]                      ; entity position, post-pipeline
e039  cmp byte[di+0x19],1 / jnz 0xe06e          ; the SAME rank-1 test the death-draw code and EBB9-call already document
e03f  inc word[bp+0x16] ; clamp at 0x64(100)    ; <-- the field EB37 zeroes
e04d  cx = [bp+0xe0]                            ; <-- the OTHER field EB37 zeroes; feeds the trail-buffer cursor logic
```

So `CS:0xEB37` is the **election mechanism for strategy 4's trail-follow leader**: it picks one group member (by weighted random draw using the same descriptor `+0xa` weight field stage 1's reroll gate reads, or by the pre-selected `[bp+0x11]` member from the materialise-time draw), stamps it to rank 1, and resets both the "how long has this entity been leader" counter (`[bp+0x16]`, capped at 100 ticks) and the trail circular-buffer's write cursor (`[bp+0xe0]`) so the conga-line starts fresh behind the newly-elected leader. `CS:0xE039` is that leadership-duration timer's own per-tick incrementer, running for as long as the elected entity holds rank 1.

**`[di+0x19]` therefore has two genuinely separate meanings layered on the same field**, both self-consistent with the bytes: (1) the organic, per-tick "reroll queue rank" this document's `UNKNOWN_sysA_field_0x19` closure already documents, which — at rank 1 — fires a synchronized whole-group strategy reset via `CS:0xEBB9` on that entity's own death; and (2) this election mechanism's "I am the trail-follow leader" flag, which a live rank-1 entity carries every tick it remains elected, driving the leadership-duration timer and (per this document's own existing strategy-4 note) the trail-buffer's per-member read offset. The two uses don't conflict operationally — a freshly-elected leader also happens to satisfy the death-path's "rank 1" test if it later dies — but they are two different subsystems reading the same byte for two different questions, and a port must reproduce both readings rather than picking one. `UNKNOWN_bp_0x11_source` — where the pre-selected `[bp+0x11]` member index (as opposed to a fresh weighted draw) gets set is not traced past its own already-documented origin at materialise time (`[bp+0x11] := the bit-`0x100`-gated random member draw`); whether `CS:0xEB37` is the only reader of it was not checked.

### `UNKNOWN_sysA_ec12_zone_table` / `UNKNOWN_sysA_field_0x1a_consumer` — CLOSED negative: the zone code is write-only, dead `[STATIC, exhaustive]`

A program-wide `search_instructions` sweep for any instruction touching displacement `+0x1a` on `DI` finds **exactly one hit in the whole image**: `CS:0xDEC4`, inside the materialise loop `FUN_1000_de7d`, the very write this document already documents (`[di+0x1a] = al`, the zone code `CS:0xec12` computes at spawn time). **No instruction anywhere reads it.** So the `CS:0xec12` zone-classification table at `DS:0xd9d0` and the code that stamps its result onto every freshly-spawned System-A entity are both real and wired correctly, but the *consumer* this document's own ranked item asked about does not exist — the field is dead, in the same authoring-pattern family as `POBJECTS +0x02` and the `.DAT` atlas's `word2`.

**Stage 4 — `CS:0xe44d`, the speed clamp — is exactly the one-liner the ledger already had, confirmed to the byte:** `cap = sign_extend(descriptor[+0xb])`; clamp `[di+0x12]`/`[di+0x14]` independently to `[-cap, +cap]`. No surprises.

**Stage 5 — `CS:0xe42b`, apply position:**

```
e42b  cmp word [0x2fa],0 / jz e433 / ret         ; "freezes aliens" global — frozen entities don't move at all
e433  cmp byte [di+0x25],0 / jz e447
e439  [di] = [di+0x1c] ; [di+2] = [di+0x1e]      ; FINE-arrival flag set -> SNAP straight to the goal, ignore velocity
e447  [di] += cx ; [di+2] += dx                   ; else: apply velocity — but CX/DX are NOT reloaded from memory
e44c  ret
```

⚠️ **Stage 5 reads CX/DX left over from stage 4's own tail, not `[di+0x12]`/`[di+0x14]` freshly.** Stage 4 ends `mov [di+0x12],cx / mov [di+0x14],dx / ret`, and stage 5 is called immediately after with those same registers still loaded — a register-passing contract between two "independent" pipeline stages. It produces the identical numeric result to re-reading memory (stage 4 just wrote those exact values), so it is not a functional trap for a port that re-reads memory instead — but it is worth recording, because a port that reorders or interleaves the stages differently than the original's straight-line `CALL e336 / CALL e487 / CALL e44d / CALL e42b / CALL e659` would still need stage 5 to use stage 4's *output*, not some other snapshot of velocity.

**Stage 6 — `CS:0xe659`, facing AND the shared enemy-shot emitter, fully decoded — this also completes the "five other emitter-pair owners" entry for `CS:0xE659` written earlier this session, which had only the gating logic, not the full body:**

```
e659  al = [si+0x6] ; or al,al / jz e6be           ; descriptor +0x6 == 0 -> no fire capability at all, skip
e664  bl = al                                        ; bl = the FULL byte (both nibbles)
e666  al &= 0xf ; jz e6be                            ; low nibble == 0 -> also skip
e66b  dec word [di+0xe] / jnz e6be                   ; entity's OWN reload timer [di+0xe] — per-entity, not per-group
e670  cl = 0x10 - al ; cx <<= 2 ; [di+0xe] = cx       ; reseed: (16 - loNibble(desc[+6])) << 2 ticks
e67d  cx = [si+0x4] ; BE->native ; cx = (cx>>4)&3     ; descriptor +0x4 bits [5:4] of the native word
e68d  jz e692 / jmp e5e4                              ; nonzero -> DIVERT to CS:0xe5e4, the alternate/unread attack path
e692  bx = (bl & 0xf0) >> 4                           ; the HIGH nibble of descriptor+0x6 -> the "direction/config" value
e69e  cmp byte [0x3c2],0 / js e6d4                    ; System B (0x3c2 negative) -> e6d4; System A falls through
        ; --- System A path ---
e6a5  cmp word [di+0x12],0 / jz e6be                  ; entity's own velocity X == 0 -> don't fire
e6ab  jns e6c3                                        ; velocity positive -> RIGHT branch (e6c3)
e6ad  bx = -bx ; [0x206] = bx                          ; velocity negative -> negate direction, LEFT
e6b3  ax=[di] ; bx=[di+2] ; ax -= 8                    ; muzzle = (entityX - 8, entityY)
e6bb  call 0x1fe7                                      ; the shared LEFT emitter
e6be  ret
e6c3  [0x206] = bx                                     ; RIGHT: direction unchanged
e6c7  ax=[di] ; bx=[di+2] ; ax += 0x20                 ; muzzle = (entityX + 32, entityY)
e6cf  call 0x2039                                      ; the shared RIGHT emitter
        ; --- System B path ---
e6d4  cx = [di+0xa]                                    ; System B's movement-mode field
e6d7  ax = [0xd95a] ; ax >>= cl ; test ax,1             ; the mode-bit constant, already documented
e6df  jnz e6ad (LEFT) / jmp e6c3 (RIGHT)               ; feeds the SAME e6ad/e6c3 branches System A uses
```

Confirms and sharpens the earlier "five other emitter-pair owners" entry for this address: System A's facing test is the **sign of its own stage-2 velocity `[di+0x12]`** (zero means don't fire at all — an entity that has arrived and decayed to zero velocity stops shooting), muzzle offsets are **exactly `-8`/`+32`** relative to entity X, and the reload timer this generic path uses (`[di+0xe]`) is a **per-entity** field distinct from the group-descriptor/runtime fields the other four emitter-pair owners use. `descriptor[+0x4]` doing double duty — BE flag word, bit `0x100` read at spawn (below) for random group-member selection, AND bits `[5:4]` read every tick here to gate the attack divert — is new.

**`CS:0xe199`, the System-A sprite resolver, read in full (the earlier pass only had its call site and its bytes-`[si]` table lookup):**

```
e199  cl = [si+0x7] ; si = [0x1fe] + cl*12           ; class table lookup, same +0x7 offset System B uses
e1ad  cx = [si]                                        ; the class's sprite base
e1b0  cmp cx,0x1f0 (496) / jz e200                      ; SPECIAL sprite base 496
e1b6  cmp cx,0x1e6 (486) / jz e21d                      ; SPECIAL sprite base 486
        ; --- DEFAULT case ---
e1bc  dec byte [di+0x26] / jns e1d5                     ; animation reseed timer — skip if still counting
e1c1  inc word [di+0x4] ; and word [di+0x4],3           ; frame cycles 0..3 (4 frames)
e1c8  dx = 10 - [di+0x16] ; dx >>= 2 ; [di+0x26] = dl    ; reseed rate: faster entities ([di+0x16] high) animate faster
e1d5  dx = [di+0x4]                                     ; current frame
e1d8  cmp byte [0x42],2 / jge e1f4                      ; world >= 2 ?
        ; world < 2:
e1df  si = 0xdf78 + dx*2 ; cx += [si]                    ; frame -> SPRITE OFFSET via a lookup table, not added directly
e1ea  cmp byte [di+0x27],0 / jnz e1f3 / cx += 3 / ret    ; facing flag clear -> +3
        ; world >= 2:
e1f4  cx += dx                                          ; frame added DIRECTLY (no lookup table)
e1f6  cmp byte [di+0x27],0 / jnz e1f3 / cx += 4 / ret    ; facing flag clear -> +4 (DIFFERENT offset than world<2!)
        ; --- SPECIAL case, base 496 (0x1f0) ---
e200  dec byte [di+0x26] / jns e219
e205  inc word [di+0x4] ; and word [di+0x4],7            ; frame cycles 0..7 (8 frames)
        ... same reseed ...
e219  cx += [di+0x4] ; ret                                ; NO facing offset at all — symmetric sprite
        ; --- SPECIAL case, base 486 (0x1e6) ---
e21d  dec byte [di+0x26] / jns e23d
e222  inc word [di+0x4] ; cmp 6 / jl / else = 0            ; frame cycles 0..5 (6 frames, NOT a power-of-2 mask)
        ... same reseed ...
e23d  cx += [di+0x4] ; ret                                ; also NO facing offset
```

Two traps for a port: (1) **the world<2 default case indexes a lookup table `DS:0xdf78` by frame instead of adding the frame directly.** `UNKNOWN_sysA_df78_table` — **CLOSED**: read live (DOSBox), the table is exactly **4 words: `{0, 1, 2, 1}`** — the identical 3-unique-frame ping-pong shape this document finds everywhere else in this game's idle animations (matching, e.g., the world-1 statue's own `DS:0xdf68` table). So the "lookup" isn't remapping to anything exotic — it just turns a linear `0..3` frame counter into the game's standard `0,1,2,1` ping-pong cycle, the same way a dedicated ping-pong counter does elsewhere; this table is simply a data-driven version of that pattern. Distinct from the already-documented `DS:0xef78` POBJECTS category table one digit off in address; getting the two confused would silently substitute object-category bytes for animation-frame sprite offsets. (2) **the facing-offset constant differs by world** (+3 under world<2, +4 under world>=2) even though both use the same `[di+0x27]` gate — collapsing them to one constant draws the wrong frame in exactly one world tier. The two special sprite bases (496, 486) have longer, non-power-of-two-safe cycles (8 and 6 frames) and — because they carry no facing offset — are presumably symmetric sprites (e.g. a stationary turret or blob) that don't need a left/right distinction. Animation cadence is shared across all three cases: `(10 - [di+0x16]) >> 2` ticks between frame advances, tying the same field to steering budget (stage 2), attack-speed clamp (stage 3, already documented), AND animation speed.

### System A's own materialise/spawn loop — `CS:0xde42`–`0xdf37`, previously unlocated `[PROVEN]`

The activator `CS:0xde42` was already documented as "byte-for-byte the System-A twin of B's `CS:0xde08`" — that comparison is now direct, not inferred: disassembled in full, it is `mov [si],0xffff` (consume first) / `param = [si+2]` / `si = 0x9d60 + param*0x16` / walk 10 runtime slots at `SS:0x3768+n*0xe4` for a free one (`[bp+0]==0`) / `[bp+0]=2` (busy) / `[bp+2]=si` (save descriptor). Identical shape to `0xde08`, confirmed rather than assumed.

**Immediately following it, `0xde6f`–`0xde7c` is the group-runtime CLEAR routine** (10 slots × `0xe4` = `0x8e8` = 2280 bytes, `rep`-equivalent `stosb` loop, zeroing every byte) — the twin of a step this document's System-B tables already implied but had not located for System A specifically.

**And immediately after THAT, `0xde7d`–`0xdf37` is System A's own materialise/spawn loop — structurally parallel to System B's `CS:0xec60`–`0xed38` (same `desc[+0x12]` byte-pair decode: `X = byte0*32, Y = byte1*16`, the identical `shl x5`/`shl x4`/`and 0xffe0`/`and 0xfff0` sequence) but NOT the same code, and with real behavioral differences a port must not merge:**

```
de7d  si = [bp+2]                    ; the descriptor (passed from the activator's slot)
de80  cl = [si] ; count
de84  or cl,cl / jnz de8b / jmp df62  ; count==0 -> the runtime slot is NOT freed (System B's exact idiom, confirmed here for A)
de8b  loop entry, dx := 0 (dx will become the per-entity STAGGER index)
de8d  ax = [si+0x12] ; BE->native byte pair -> X = byte0*32, Y = byte1*16   ; same decode as System B's spawn
deb2  [di] = X ; [di+2] = Y
deb7  [di+0x1c] = X ; [di+0x1e] = Y   ; **System A ALSO seeds the GOAL to the spawn point** — System B's loop does not do this
debf  call 0xec12                     ; a NEW routine (below) -> AL = 0..7
dec4  [di+0x1a] = al                  ; spawn-zone code, from ec12
dec7  [di+4] = 0                      ; frame := 0
decc  [di+0x26] = 2 ; [di+0x27] = 0   ; anim-reseed timer, facing flag — both zeroed/seeded fresh
ded4  [di+0x8] = 0xfffe                ; "waiting" sentinel — IDENTICAL to System B's own [di+0x8]=0xfffe convention
ded9  [di+0x6] = dx                    ; per-entity STAGGER = the loop's own dx counter (0, 1, 2, ... one per entity)
dedc  or dx,dx / jnz dee3
dee0  call 0xff59                      ; ONLY for the FIRST entity of the group (dx==0) — see below
dee3  callf [0x52ea]                   ; graphics EXPORT 38 — "the entity/object initialiser" — confirmed called here, once per spawned entity
dee8  loop de8d                        ; next entity (cl counts down)
deea  dec word [bp+0]                  ; group-runtime state: 2 (materialising) -> 1 (active) after the full batch
deed  [bp+0x10] = 0 ; [bp+0x11] = 0xff ; two group-runtime fields reset
def5  ax = [si+0x4] ; BE->native ; test ax,0x100 / jz df21
        ; bit 0x100 of descriptor+0x4 SET:
deff  cl = [si] (entity count) ; call 0x3836 (the RANDOM draw)
df07  bucket-pick: divide 0xFFFF by count, walk cumulative buckets against the random draw
df1e  [bp+0x11] = dl                   ; OVERWRITES the 0xff above with a 0..count-1 "which member" index
df21  [bp+0x12] = 0 ; [bp+0x14] = 0 ; [bp+0xe2] = 0   ; further group-runtime resets
df2f  al = [si+0xe]                    ; descriptor +0xe — a field NOT documented for System A before this pass
df34  [bp+0x6] = zero_extend(al)       ; group-runtime +0x6 := descriptor +0xe
df37  jmp df62                          ; done
```

**Three things worth carrying into a port, none of them shared with System B's loop:**

1. **System A seeds the entity's goal to its own spawn point** (`[di+0x1c]/[di+0x1e] = [di]/[di+2]`), so before stage 1's strategy dispatch ever runs, a freshly spawned entity's stage-2 accelerate call sees itself as already "arrived" — consistent with `[di+0x1b]` (coarse arrival) being expected to read true immediately on spawn.
2. **`CS:0xec12` is a NEW routine**, not the strategy-1 weighted search the ranked-list item's prose implied it might be part of (`"the deepest-undecoded piece ... 0xec12, 0xeaf7, 0xeb1a unread"` — that framing is corrected here, at least for `0xec12`: it is read in full below and is unrelated to strategy 1's scratch-slot search). It probes the entity's own screen position (and screen position + 32 on both axes) against a **7-entry, 8-byte `{loX, loY, hiX, hiY}` table at `DS:0xd9d0`**, returning `0` (no match) or `1..7` (which entry matched, in table order) into `[di+0x1a]` — a spawn-time "zone" code whose consumer is not traced past this write. `UNKNOWN_sysA_ec12_zone_table` / `UNKNOWN_sysA_field_0x1a_consumer`.
3. **Descriptor `+0x4` bit `0x100` gates a random "which group member am I" draw** using the shared random-table reader `CS:0x3836` and a cumulative-bucket walk over `0xFFFF/count`-sized shares — written into group-runtime `+0x11`, overwriting a `0xFF` default. This parallels the doc's already-documented System-B `+0x4`/`+0x5` "bit 9 = initial facing" field, but here the SAME field position is read for a completely different purpose (member selection, not facing) — a port must not assume the two systems' BE flag words share a schema despite the identical byte offset.
4. **A new descriptor field, `+0xe`**, is copied verbatim into group-runtime `+0x6` at the end of every materialise pass. Its consumer is not traced. `UNKNOWN_sysA_descriptor_0e`.
5. **`CS:0xff59` runs exactly once per group activation** (only when the per-entity stagger counter is still 0, i.e. only for the group's first entity). `UNKNOWN_sysA_ff59` — **CLOSED**: it is a self-contained **"spawn flash" one-shot visual effect**, not entity logic. It plays sfx `0x46` unconditionally, then allocates into a **previously-uncatalogued 10-slot × 6-byte pool at `DS:0xac90`** (sitting immediately before, and structurally a sibling of, the world-1 statue hazard array at `DS:0xaccc` this document documents elsewhere — allocator `CS:0xb0da`, clear `CS:0xb0c3`, walker `CS:0xb0ef` called from the main loop at `CS:0x028E`), seeding `{entityWorldX, entityWorldY, state=7}` at the triggering entity's own spawn position. The walker (gated on a shared "any active" flag `DS:0x1f6`, the same auto-disarm-when-empty pattern this document documents for several other pools) draws sprite `100 + state` via the shared entity blitter `CS:0x3569` and decrements `state` once per tick, freeing the slot once it goes negative — **an 8-frame (sprites 100–107), one-shot flash animation** at the spawn point, no physics, no collision, purely decorative. `CS:0xff59` also writes `[di+6]=5`, `[di+8]=0xFFFD` (−3) and the shared gate `DS:0x1f6=1` onto the *triggering* entity itself; those three writes are not chased further here (`UNKNOWN_sysA_spawn_flash_entity_fields`, a new, narrower residual).

### Consolidated System-A entity record layout, `DS:0x0e96`, stride `0x28` `[PROVEN, from this session's reads]`

| off | field | established by |
|---|---|---|
| `+0x00`/`+0x02` | world X / Y | materialise loop, stage 2, already-known |
| `+0x04` | animation frame | `CS:0xe199`, materialise loop |
| `+0x06` | (unresolved beyond earlier general notes) | — |
| `+0x08` | state word; `0xfffe` = "waiting" at spawn; shared contact/death sentinel per the existing `CS:0xff93` closure | materialise loop, existing doc |
| `+0xc` | (unresolved) | — |
| `+0xe` | per-entity reload/reserve timer for the generic fire path | `CS:0xe659` (stage 6) |
| `+0x12`/`+0x14` | velocity X/Y | stages 2/3/4/5, existing doc |
| `+0x16` | triple-duty: steering-step cap (stage 2), attack-speed comparator (stage 3, existing doc), animation-cadence divisor (`CS:0xe199`) | this session |
| `+0x19` | gates whether stage 2 evaluates the FINE (8px) arrival check at all | stage 2 |
| `+0x1a` | spawn-zone code, 0..7, written once by `CS:0xec12` at materialise time | materialise loop |
| `+0x1b` | COARSE arrival flag (32px cell match) | stage 2 |
| `+0x1c`/`+0x1e` | goal X/Y | stage 2, existing doc; seeded to spawn point by the materialise loop |
| `+0x24` | sticky per-entity strategy byte (existing doc, stage 1) | existing |
| `+0x25` | FINE arrival flag (8px both axes) — read by stage 5 (snap-to-goal) and by stage 3 (existing doc, attack gate) | stage 2, stage 5 |
| `+0x26` | animation reseed countdown | `CS:0xe199`, materialise loop |
| `+0x27` | facing flag, read by `CS:0xe199` (+3/+4 sprite offset) and written in stage 1 (existing doc, `e07d`/`e088`) | existing, `CS:0xe199` |

Fields not touched by any routine read this session (`+0x06`, `+0xc`, and the bytes between the known offsets) remain unresolved; the table above is not claimed complete, only what this session's reads pin down.

The hero carries **three weapon slots**, each holding a weapon index or a negative value when empty:

| slot | weapon idx | projectiles | tag base |
|---|---|---|---|
| A | `DS:0xdd10` | `DS:0xdd12` | 1 (`0x95e8`) |
| B | `DS:0xdda2` | `DS:0xdda4` | **`0x0a`** (`0x9674`) |
| C | `DS:0xde34` | `DS:0xde36` | `0x13` (`0x96df`) |

⚠️ **Slot B's tag base is 10, not absent** — an earlier revision of this table left it blank. The three slots are a **uniform `0x92` stride** (`0xdda2 − 0xdd10 == 0xde34 − 0xdda2`), and with the shared `add dx,3` per sub-slot the whole tag space is regular: **`tag = 1 + slot*9 + subslot*3`** → 1/4/7, 10/13/16, 19/22/25. **No tag is ever 0**, which is exactly what lets the tag word double as the record's free flag.

Those are exactly the three words trigger predicates COND3/COND4 test (`0x3ea8`/`0x3ec1`) — independent confirmation that they are the weapon inventory. Per slot the routine computes the record with an explicit `idx*16 + idx*64` (**stride `0x50`**, so it indexes `PWEAPONS` directly), reads **`+0x0a` = the maximum simultaneous projectiles**, and walks up to **three** sub-slots at stride `0x18`, stopping after `maxShots` attempts. A sub-slot is free when `[di]`, `[di+8]` and `[di+0x10]` are **all** zero (`0x9724`) — the same `x|y` emptiness idiom used by the open list and the ledge records, not three sub-projectiles.

**The shipped data corroborates `+0x0a` exactly**: across all 11 weapons it is only ever **1 or 3**, which is precisely what a 3-iteration unrolled loop can consume. A 2 or a 7 would refute the reading.

⚠️ **CORRECTION — the asymmetry is between slot A and the other two, not between C and the other two.** An earlier revision of this section called both guards a slot-C special case. **Slots B *and* C** each carry the max-shots sign guard (`0x966f`, `0x96da`) *and* the `DS:0x33e` interlock (`0x969a`, `0x9705`), byte-for-byte identical: `cmp bp,1 / jnz fire / cmp byte [0x33e],0 / jnz skip`. **Slot A has neither** — it is instead the sole *writer* of `DS:0x33e` (`0x963b`), setting it when its own max-shots is 1 and it allocated. So the rule is: **if the slot-A weapon is single-shot and fires this frame, no other single-shot weapon fires with it**; multi-shot weapons are exempt on both sides of the test. `UNKNOWN_weapon_slot_c_interlock` (the *reason*) stands; the shape does not.

⚠️ **The return value is inverted, and there is a lockout.** `ax = cx`, where `cx` starts at 1 and is zeroed by `xor cx,cx` on any successful allocation — so **`0` means something fired**. `DS:0x351` is a top-of-function lockout (`0x95cb`) that returns 1 *before* clearing `DS:0x33e` or the three live pointers.

**The allocator does not spawn.** It records only the free sub-slot pointer in `DS:0x1bc`/`0x1be`/`0x1c0` and the tag in `DS:0x1c2`/`0x1c4`/`0x1c6`; `0x9734`/`0x97ce` (the **right/left spawners**) read those back. Eight player states are firing variants (5, 6, 20, 21, 22, 23, 24, 25).

(The `0xaad1`–`0xab3f` routine formerly listed here as a "pixel-mask collision scan" is decoded — it is the damage-grid scanner, and it is not a pixel mask; see *Projectile collision*.)

### The death/respawn reset set — CLOSED: two divergent paths, not one reset `[PROVEN]`

`FUN_1000_09bb` (`CS:0x09BB`–`0x0AAF`, reached from the main loop's own death test at `CS:0x01C4`/`0x01C9` when the health bar goes negative) is **not itself "the reset"** — re-reading it in full shows it is the **death-animation tick driver**: it re-runs the ordinary per-tick projectile/hazard/entity calls (`CALL 0x9455`, `CALL 0xAD88`, `CALL 0xB1C2`/`0xB3CE`/`0xB4E7`/`0x1280`/`0x3CC7` — the identical block the main loop itself runs at `CS:0x0223`–`0x0239`, confirming these hazard walkers really do run continuously, dead or not), then drives a small state machine on **`DS:0x24c`** (a previously-undocumented step counter, 0..0x12) that seeds a **5-record death-burst particle array** at `DS:0xd76e` from a template at `DS:0xd752` (world position of death, screen-converted with a `+8` Y bias — `CS:0x0A3B`–`0x0A5E`), then applies simple position += velocity, velocity++ (gravity) physics to those 5 records and draws each via the shared entity blitter `CS:0x3569`, sprite `= 0x5b + [0x24c]` — the same `0x5b`-base sprite-id convention this document already documents for entity death frames, here reused for the *hero's own* death burst.

**Once the animation counter reaches `0x12` (18 ticks ≈ 1.2 s at 15 Hz), it jumps to `CS:0x0930` — the real fork point:**

```
0930  [0x6c] = 0xff ; [0x6d] = 0xff     ; a display-dirty pair (new — not previously documented)
093A  dec word [0x224]                   ; LIVES -= 1 — this document's own previously-flagged
                                          ;   "not traced to this path" loose end; now traced exactly here
093E  js 0x0943                          ; lives went negative -> GAME OVER (below)
0940  jmp 0x0845                         ; lives remain -> RESPAWN (already extensively documented:
                                          ;   FUN_1000_0845, health restore from [0x250], the
                                          ;   14-entry arrival-zone table at SS:0x365a, camera
                                          ;   re-init via FUN_1000_2189, state 4, [0x32]:=0)
```

**So the respawn-with-lives-remaining path was already comprehensively documented** (health/position/camera/invulnerability, all under *`UNKNOWN_camera_init`* and *`DS:0x8b4c`*'s reach into `FUN_1000_0845`) — nothing new needed there. **The genuinely undocumented half was GAME OVER** (`CS:0x0943` onward, lives negative):

```
0943  SS:[0x40a] = 0xc0                  ; a UI/display parameter
094A  call 0x0929                        ; local helper, not chased further
094D  callf [0x531e]                     ; sound driver export 10 (music-control range, ROL-only)
0952  sfx 0x6413 (call 0x22ca)           ; play a sound effect
095A  call 0x22d0                        ; a second sound-related call
095D  cx=0x96(150) : { call 0x357f ; call 0x358d }   ; 150-iteration palette fade loop
0968  ax=0x15e ; call 0x2516             ; unrelated to the file-loader's own DS:0x15e filename
                                          ;   pointer — here it's a plain parameter, not chased further
096E  [0x38d]=0 ; [0x33]=0               ; two flags cleared
0978  callf [0x5326]  (ax=4)             ; sound driver export 12 (music-control range)
0980  callf [0x530e]  (al=0x80)          ; sound driver export 6 (music-control range)
0987  call 0x318f
098A  call 0x359d  (ax=1)
0990  call 0x32c0
0993  jmp 0x2c82                         ; -> the ATTRACT-MODE DEMO CYCLER
```

**Game over does not reset hero/world state at all — it exits straight to the attract-mode cycler** (`FUN_1000_2c82`, this document's own already-documented 6-state title/high-score/demo loop). This matches this session's own live DOSBox observation: dying with no lives left dropped straight into the `TOP TEN GODS` high-score screen and on into demo playback, exactly this code path. **The actual "new game" reset — `world:=1`, money zeroed, weapon slots cleared, health/lives to their starting values — happens later and separately**, only once the player picks "BEGIN QUEST" from the menu again (`CS:0x0473`/`CS:0x8DD9` for health/lives/weapon-slot clear, `CS:0x0498`/`CS:0x8D80` for money/score/inventory, both already documented under *Weapon pickup* and *`UNKNOWN_key_pickup`*). So "the death/respawn reset set" was never one function to find — it is these two already-largely-documented forks, now both fully pinned.

### `UNKNOWN_projectile_record` — CLOSED: 8 bytes, not 24 `[PROVEN]`

**A projectile is `{ u16 tag, u16 x, u16 y, u16 dir }`.** The `0x18` the allocator strides is *three consecutive records*, which is why the free test (`0x9724`) reads `[di]`, `[di+8]` and `[di+0x10]` — it is checking the tag word of each. The spawn handler then writes those three words-of-four in sequence (`mov [di],dx / add di,2 / stosw / mov [di],bx / add di,2 / mov word [di],<dir>`), filling one, two or three of them.

Slot geometry follows: `0x92 − 2 = 144 = 18 × 8`, so each slot has **18 record positions**, of which the allocator's three-deep unrolled loop can reach only the **first 9** (groups at `+0x00`, `+0x18`, `+0x30`).

The 18 is not inferred from the stride alone. The clear routine `CS:0x9177` does `mov cx,0x48 / xor ax,ax / mov [si],ax / add si,2 / loop` — **exactly 72 words = 144 bytes** — from each slot's base + 2, called for all three slots by `CS:0x914c` (level start, and `CS:0x94ce` on a new weapon pickup). So the whole 144-byte region is one array of projectile records and is not shared with anything else. `UNKNOWN_projectile_area_upper` narrows further still: the **mover also walks exactly nine** (`CS:0x9c6d mov cx,0x9`), so the upper 9 are untouched by *both* sides and the open question is only why 144 bytes were reserved for 72.

**The spawn is data-driven through a jump table at `DS:0xd88c`.** The emitters read a **byte** from the weapon record — `+0x16` firing right (`0x987f`), `+0x12` firing left (`0x98b5`) — double it, and `call` through it. ⚠️ Because the load-time pass byte-swaps the first 32 bytes *as words*, the native byte at `0x16` is the **file** byte at `0x17`; reading file `0x16`/`0x12` yields 0 for every weapon.

| | |
|---|---|
| table | **16 entries** `[PROVEN]` — see the correction below |
| parity | **even = left-facing, odd = right-facing** — pinned by the table itself: entry 12 is `sub bx,8 / jmp 0x991c` (left body), entry 13 `sub bx,8 / jmp 0x98d1` (right) |
| shipped | left ∈ {0,2,4,6,8,10,14}, right ∈ {1,3,5,7,9,11,15} — **right == left + 1 in all 44 records**; max 15, so the table has **no unused tail at all** |

⚠️ **CORRECTION — the spawn table is 16 entries, not 22.** An earlier revision of this section guessed 22 by noticing that entries 22+ hold the potion handlers. There are in fact **three adjacent tables**, each with its own single consumer, and the boundaries are pinned by the code that loads them:

| base | width | loaded at | role |
|---|---|---|---|
| `DS:0xd88c` | 16 | `0x9886`, `0x98bc` | **spawn** handlers, indexed by weapon `+0x12`/`+0x16` |
| `DS:0xd8ac` | 6 | `0x949d` | **mover** handlers, indexed by weapon `+0x1A` |
| `DS:0xd8b8` | — | `0x1822`, `0x6f32` | the potion handlers |

Reading them as one table made the six movers look like unreachable spawn handlers, which is exactly why `UNKNOWN_projectile_mover` stayed open a pass longer than it needed to.
| decoded | 0/1 (base) and 12/13 (raised muzzle). 2/3, 6/7, 8/9, 10/11, 14/15 are `UNKNOWN_projectile_handlers` |

Handler 1 (right) does `add ax,0x10 / sub bx,0xc` and writes dirs **1, 0, 2**; handler 0 (left) does `sub bx,0xc` and writes **4, 3, 5** — the two triples are a clean +3 apart, and note the *write order* puts the odd code first. Each also stores the facing back into weapon `+0x0e` (`1` right, `0xFFFF` left) — **which resolves what `+0x0e` selects between `+0xc` and `+0x1e` for: it is the facing.**

⚠️ **Handler 13 is not handler 1 with a different Y.** It jumps to `0x98d1`, *past* `add ax,0x10`, so it never applies the +0x10 its same-facing sibling does. Mirroring 1 to build 13 puts every shot 16 px off.

⚠️ **`bp = [si+8] − [si+6] + 1` is not a fixed projectile count.** Only 1 and 2 are distinguishable (`dec bp / jz` twice); everything else falls through to three. Port it as the branch — and see the next section, because both operands are runtime state.

### `UNKNOWN_weapon_08` — CLOSED: it is the weapon's PICKUP COUNT `[STATIC]`

> **`[STATIC]`, deliberately.** This closure rests on a *negative* result — "these are the only writers" — from a search that is incomplete by construction, and it was used to overturn port behaviour shipped on the same pass. **To promote:** watchpoint `DS:0xe2be + n*0x50`, pick one weapon up twice, and confirm the word goes `base → base+1 → base+2` while `+0x06` never moves.

`+0x08` is not a stat, it is mutable state, and it has **exactly three writers** in the whole image:

| site | effect |
|---|---|
| `CS:0x9115` | `[rec+8] := [rec+6]` — a **new** weapon: count := base |
| `CS:0x94e8` | `inc [rec+8]` — picking up one you **already hold** |
| `CS:0x9451` | `inc [rec+8]` — a bulk power-up applied to all three slots (`CS:0x9426`) |

The same pickup path also resets **`+0x04` to 0** unconditionally and **`+0x02` to 0** when it reads 3 (`CS:0x910d`, `CS:0x9118`), so those two are runtime state as well — `UNKNOWN_weapon_02` / `UNKNOWN_weapon_04`. Neither is parsed by the port.

All three are reachable only from the pickup dispatcher `CS:0x94a7`, which branches on whether `bx` already matches one of the three slot words.

**`+0x06` (Power) has no runtime writer at all.** This is the keystone of the base/counter reading, so it was established by an **exhaustive** scan rather than a windowed one: every write instruction in the image with displacement 6 or 8, in *any* addressing form, is 190 instructions, and only `si`/`di`/`bp` bases occur — **no two-register (`[bx+si+…]`) write form exists at all** for these displacements, so that blind spot is theoretical here rather than actual. Of the 190, five have a `0xe2b6` load within 200 lines; three are the `+0x08` writers above, one (`0x9A74`) writes a *projectile's* `+6` through `di`, and the last (`0xC50B`) is a **false positive** — its `si` is `0xd030`, a different 15-record array of stride `0x0a`. So Power is immutable, which also closes the standing question of whether it can be upgraded.

`0x9A74` is worth keeping: handler 9's body writes `[di+0] = tag`, `[di+2] = x`, `[di+4] = y`, `[di+6] = 0x2f` — **the same four fields in the same order as handlers 0/1, from unrelated code.** That is an independent corroboration of the 8-byte record layout. It also shows the `dir` word is *not* confined to 0–5: handler 9 writes 47, so the `{1,0,2}`/`{4,3,5}` triples are handlers 0/1's codes, not the field's domain.

So `[si+8] − [si+6] + 1` reads as **1 + the number of EXTRA pickups**, clamped to three by the `dec bp / jz` chain. **Collect the same weapon repeatedly and it fires more projectiles at once, up to 3.**

The shop confirms the reading independently, from the other side: `CS:0x6fde` refunds `([+8] − [+6]) × (value + 1) / 2` — proportional to the extras collected, which is only meaningful if the difference counts pickups. (`mul bx / sar dx,1 / rcr ax,1` into the 32-bit total at `DS:0x194`.)

⚠️ **The pin and the pickup counter COMPOSE — neither alone describes the volley.** The loader re-pins `+0x08` to the EXE-image value for all 11 records on every **sublevel-`'a'`** load (`CS:0x35e9`, gated `cmp byte [0x43],0`), while the weapon slots are cleared only by `CS:0x914c` — whose two callers, `CS:0x473` (after the world wraps to 1 and the money total is zeroed) and `CS:0x8dd9` (health `0x18`, lives 2), are **full game restarts, not level transitions**. So a weapon is *carried* between worlds while its count is reset underneath it, and a carried weapon's volley becomes `1 + (imageCount − thatWorld's Power)`. For the axe entering world 3 that is `1 + (4 − 12)` → a **3-projectile spread**, where freshly picking the same axe up gives one. `UNKNOWN_carried_weapon_volley` — the bytes are clear, but whether that reads as a designed reward or an artefact is not decidable from them; a level-2→3 transition carrying an axe would settle the observable half. The port models both paths.

⚠️ **This still overturns the per-weapon volley table.** A port must NOT derive the volley size from the shipped files or from the pinned EXE values: `CS:0x9115` overwrites `+0x08` the instant a weapon is picked up, so **every weapon starts at one projectile whatever was loaded**, and the loaded state is never fired from. An earlier revision of the port derived a per-world spread from the files (including "the axe fires 3 in worlds 3–4"); that was reading state the pickup path discards. The pinning section below is still correct about what the *loader* leaves in the table — it simply never reaches gameplay.

### ⚠️ THREE `PWEAPONS` fields are pinned at the EXE-image value, not two `[STATIC]`

> **Tag discipline, deliberately applied.** The *divergence* between file and image is `[PROVEN]` — both byte sets were read and diffed. But **"the game therefore uses the image value" is a reading of a push/pop loop, not an execution**, so this section is `[STATIC]` under this document's own rules. That matters more than usual here, because this reading was used to **overturn behaviour already shipped in the port on the same pass** — precisely the case the project directive names when it says static analysis can mislead.
>
> **To promote it:** breakpoint `CS:0x3692` (the restore store, `mov [si],ax`). It should hit **11 times**, with `SI` walking `0xe5de → 0xe2be` in `−0x50` steps and `AX` carrying the byte-swapped image values. World-independent, so it settles on level 1 without reaching world 3 or 4.

This document recorded `+0x0c` and `+0x1e` as pinned and **missed `+0x08`** — which is exactly the field the volley branch above subtracts from. The loader `CS:0x35e9` (sublevel `'a'` only, `cmp byte [0x43],0 / jnz`) brackets the file load with **two independent mechanisms**:

| fields | mechanism |
|---|---|
| `+0x0c`, `+0x1e` | `CS:0x35b7` copies both out of all 11 records to a scratch at `DS:0x2f76`; `CS:0x35d0`, called at the very end of `CS:0x366d`, copies them back |
| **`+0x08`** | `CS:0x367a`–`0x3682` **pushes** it from all 11 records, calls the loader, then pops and stores it back with a compensating `xchg al,ah` (`CS:0x368f`) so the later 32-byte swap pass returns it to its native value |

The save/restore ordering is unambiguous at the call-graph level: `CS:0x2a79 call 0x35b7` (save) sits **immediately before** `CS:0x2a80 call 0x35e9` (the loader, which ends by calling `0x35d0` to restore), and each of `0x35b7`/`0x35d0`/`0x35e9` has **exactly one caller**. So each `PWEAPONS` file's own copies of all three fields are discarded. Image values, `DS:0xe2b6 + n*0x50`:

```
+0x08   1, 5, 3, 4, 8, 1, 6, 4, 5, 3, 3
+0x0c   331, 339, 343, 347, 363, 369, 373, 377, 385, 426, 437
+0x1e   0, 0, 0, 0, 366, 0, 375, 0, 0, 0, 0
```

**This cost the port a wrong result before it was caught.** Seven of the 44 file records disagree with the image at `+0x08`, all in `PWEAPONS.003`/`.004` — the same authoring drift already recorded for the sprite fields. Reading `+0x08` from the file makes four world-4 weapons fire the wrong number of projectiles **and invents a two-projectile volley that no shipped weapon ever fires**: with the field read correctly the volley size is only ever **1 or 3**, and the `2` branch at `CS:0x9905`, while real code, is **unreachable in shipped data**. An earlier revision of this section claimed weapon 8 (`hunter`) in `.004` was "the only fixture exercising the middle branch" — that fixture was an artefact of reading the discarded value.

The genuine discriminating fixture is the **axe**: 1 projectile in worlds 1–2 and **3 in worlds 3–4**, driven by `Power` (4/4/12/12), which is *not* pinned, against a fixed `+0x08` of 4. Two corroborations that these are the right bytes: `+0x0c` lands in 331–437, inside the `POBJ2` descriptor range (#331–#449), and `+0x1e` is zero for every weapon except the two that visibly have a second sprite — `lightning bolt` and `spear`.

⚠️ **Table entries 4, 5 and 18 are NULL**, and weapon 3 (**`flame`**) points at 4/5 — a `call cx` with `cx = 0` would jump to `CS:0x0000`. **It is unreachable in the shipped game**: a census of all 200 object records in all eight maps finds **55 weapon pickups of 9 distinct types**, and **type 3 is not among them**. (That 55/9 matches this document's independently recorded figure.) Type 9, `magic axe`, is also unplaced but its handlers 14/15 are real code. The consistent reading is a **cut weapon whose handler was never written**. A port should refuse rather than emulate the wild jump.

## Projectile collision — an occupancy grid, not a hit test `[PROVEN]`

**There is no pairwise projectile-vs-creature test anywhere in `GAME.EXE`.** That is why every search for one failed. Collision is mediated by a shared **8×8-pixel occupancy grid in SCREEN space at `DS:0x16ca`**: every live projectile stamps its own tag byte there on its *draw* path, and every creature then scans the grid over its own bounding box and reacts to the first nonzero cell. The two halves never reference each other — only the grid.

```
CS:0x01CC  call 0xACF6     clear the grid
CS:0x020F  call 0x9455     projectiles move and draw -> each STAMPS its tag
CS:0x0285  call 0xED15     System-B entities -> CS:0xFF93 -> CS:0xA9E4 SCANS
```

⚠️ **`[WF]` provenance note.** This was produced by an 11-agent workflow. The five load-bearing pieces below — the clear, the stamp, the scanner, the scanner's rounding and the tag decode — **were re-read on the bytes in this project** and are `[PROVEN]`. The death/score path, the 3×3 stamp variant, the stamp-site census and the remaining movers are `[WF]` and are marked where they appear.

### The grid `[PROVEN]`

| property | value | proof |
|---|---|---|
| cleared | 1600 bytes at `DS:0x1666`, once per frame | `0xACF6 mov cx,0x320 / mov di,0x1666 / rep stosw` |
| element | 1 byte per **8×8 screen pixels** | both axes shifted by 3 at stamp and scan |
| row stride | **`0x30` = 48 bytes = 384 px** | `6*(y & ~7)` = `48*(y>>3)` |
| origin | `DS:0x16ca` = screen (0,0) | 100 bytes into the cleared region — margin above/left |
| write window | `[0x1696, 0x1c42)` | `0xA87A cmp si,0x1696 / jl`, `0xA880 cmp si,0x1c42 / jnl` |

Index at both ends: `si = 0x16ca + (x >> 3) + 6*(y & ~7)`.

⚠️ **But the stamp FLOORS and the scan ROUNDS half-up.** `0xA863` shifts `x` with `sar` and masks `y` with `and 0xfff8`; `0xAA09` does `add ax,4 / add bx,4 / and 0xfff8` on **both** first. They agree only on exact multiples of 8. **One shared helper for both misplaces every stamp by up to half a cell.**

### The scanner — and CLAUDE.md's own name for it was wrong `[PROVEN]`

An earlier revision of this file called `0xaad1`–`0xab3f` "the pixel-mask collision scan". **It is not a pixel mask.** All 60 bytes of the compare chain at `0xAAF7`–`0xAB32` are `cmp byte [si],0 / jnz 0xab40 / inc si` — no `TEST`, no `AND`, no shift, no bit index. It is **rectangle-vs-rasterised-occupancy at 8×8 granularity**, and sub-cell precision does not exist anywhere in this system.

The computed `jmp` is a variable-length loop on a fixed unrolled chain:

```
AAC2  dx = [0x1e4] >> 3 ; dec dx ; jns / sub dx,dx     ; rows-1, floored at 0
AAD3  cx = [0x1e2] >> 3 ; dec cx ; js/jnz -> cx = 1    ; columns, minimum 1
AAE5  di = 0xab33                                      ; the END of the chain
AAE8  dx = 0x30 - cx                                   ; row advance
AAED  shl cx,1 / sub di,cx / shl cx,1 / sub di,cx      ; di -= 6*cx
AAF5  jmp di                                           ; enter so exactly cx compares run
AB33  add si,dx / dec al / jns 0xaaf5                  ; next row
AB3F  ret                                              ; NO HIT
```

Each unit is exactly **6 bytes**, so the chain holds **10 columns = 80 px maximum** — a wider box simply cannot reach past column 10. `DS:0x1e2`/`0x1e4` are the caller's width/height globals, set to `0x20`/`0x20` for a System-B creature at `0xFF93`.

⚠️ **The scanner has no bounds check of its own** — there is no compare against the buffer limits anywhere in `0xAAAA`–`0xAB3F`. It stays in range only because the caller's clips and the largest shipped creature box happen to keep it there. Change a clip constant and the safety vanishes silently. A port should clamp.

### `UNKNOWN_weapon_08` enlarged — it is also the DAMAGE `[PROVEN]`

The tag decode `CS:0x9320` turns a grid cell back into a weapon:

```
9323  al = [si]                  ; the cell = the projectile's tag
9325  cbw / or ax,ax / js        ; NEGATIVE -> a non-projectile source
932A  si = 0xdd10 ; cmp al,9 / jng     ; each slot owns NINE tags
9331  si = 0xdda2 ; al -= 9
933A  si = 0xde34 ; al -= 9
933F  dec al / shl ax,1 ×3       ; (tag-1)*8 = the record's byte offset
9347  bx = [si]                  ; the slot's weapon index
934B  di = 0xe2b6 + weapon*0x50
935E  ax = [di+0x8]              ; <-- THE DAMAGE
9361  [0x1ea] = ax               ; which 0xAB45 then reads as `bx`
```

**Damage is weapon `+0x08` — the pickup count — not Power (`+0x06`).** Since a new pickup sets `count := Power` (`CS:0x9115`), **Power is the weapon's STARTING damage**, and every duplicate pickup adds exactly 1 to it. So a duplicate buys **both** an extra projectile *and* +1 damage each — which is also why the shop refunds on `(count − base)`.

This joins cleanly to what this document already recorded: `0xAB45 mov bx,[0x1ea]` and `0xAB56 cmp byte [0x365],0` are the difficulty-scalar site already documented, with "`bx` the raw damage from `DS:0x1ea` and `bp` the target's HP". The tail was known; what was missing was that the **entry is a grid scan**.

The `cmp al,9` split independently re-confirms the tag layout: 9 tags per slot, `(tag−1)*8` addressing 8-byte records — records 0..8, the same **nine** the allocator reaches and the mover walks. Three independent routines agree on nine.

### Other grid users — the `[WF]` note was checked, and half of it was wrong `[PROVEN]`

An earlier revision of this block, tagged `[WF]` and explicitly marked *not re-read*, said: *"`0xFC` debris (`0xA549`)"*. **`CS:0xA549` is inside the STARBURST updater**; debris is a different, 20-record array at `DS:0x8b4c` (cleared at `CS:0x8E91`, appended at `CS:0xA816` on the projectile's terrain-stop path). The tag *value* was right and the *source* was wrong. This is the first time that block has been checked on the bytes.

**And "negative tags deal no damage" was wrong for three of the four.** The ladder at `CS:0x938B` peels one `inc ax` per tag:

| tag | `ax` | site | damage |
|---|---|---|---|
| `0xFF` | −1 | `0x938E` | `[0x1ea] = DS:0x210` — **the familiar's power** |
| `0xFE` | −2 | `0x93A8` | **10000**, or 0 when `DS:0x34 != 0` — the invulnerability aura |
| `0xFD` | −3 | `0x93C2` | **0**, always — CLOSED, see *`UNKNOWN_tag_fd`* below |
| `0xFC` | −4 | `0x93CC` | **10000**, or 50 when `DS:0x34 != 0` — the **starburst** |

⚠️ **10000 against creature HP that tops out at 255 is an instant kill**, and no difficulty scalar can forgive it — the scalar forgives at most three quarters. The 3×3 stamp variant `0xA8B8` nudges *before* its bounds check where `0xA860` nudges *after*, so the two clip differently at the grid edge.

### `UNKNOWN_tag_fd` — CLOSED: no producer exists in `GAME.EXE`, which makes a real, matching consumer permanently dead too `[STATIC, exhaustive]`

**The producer is provably absent, on BOTH ways a byte can ever reach the grid, not just the immediate-constant one.** `DS:0x16ca` has exactly two write mechanisms in this binary:

**1. Direct immediate stores** — the shape both the familiar (`CS:0xC2E7`, `MOV AL,0xFF` then four `MOV byte ptr[DI+n],AL`, inside `FUN_1000_c2b6`) and the invulnerability aura (`CS:0xA9DA`/`0xA9DF`, `MOV byte ptr[SI+disp8],0xFE`, inside `FUN_1000_a9ae` — a fourth, previously-undocumented stamp shape, reached from the aura's own per-frame particle updater `CS:0xA931`) actually use. Swept exhaustively for the byte value `0xFD`, confirming the encodings first against the two known producers (`C6 44 D0 FE` / `C6 44 30 FE` read straight off `CS:0xA9DA`/`0xA9DF`, so the pattern shape is verified, not guessed):

- Every `MOV r8, imm8` encoding (opcodes `B0`–`B7`, all eight 8-bit registers) with `imm8 = 0xFD`: **zero hits** (`MOV AL,0xFD` etc.).
- Every `MOV byte ptr[mem], imm8` (opcode `C6`) addressing form with `imm8 = 0xFD` — absolute, bare `[BX]`, bare `[DI]`, `[BP+disp8]`, `[SI+disp8]`, `[DI+disp8]`, `[SI+disp16]`, `[DI+disp16]`, `[BX+SI]`, `[BX+DI]`, `[BP+SI]`, `[BP+DI]` — **zero hits**, all twelve ModRM shapes.
- All 122 `MOV DI, imm16` loads in the image were enumerated and their targets checked; none points at a fixed memory byte holding `0xFD` the way `CS:0xA549` points at `DS:0xdcfe` holding `0xFC`.

Coverage: 152,384 bytes across the program's 4 initialized code blocks — the same span every other exhaustive byte-pattern sweep in this document covers (8 uninitialized data blocks are skipped, as always, and none of them can hold code). The only three literal `0xFD` bytes anywhere in the image are *reads*, not writes: `CS:0x166B` (an unrelated loop bound inside `FUN_1000_1534`), `CS:0xD7DC` (a step-index compare inside a scripted-sequence world routine, testing a signed cursor against `−3`, unrelated to the damage grid), and the one that matters, next.

**2. Register-copy stores — the shared stampers `CS:0xA860` (2×2) and `CS:0xA8B8` (3×3).** Neither writes an immediate: both do `MOV CL, byte ptr[DI]` once, then copy `CL` into every covered grid cell (`A8B8`'s body was fully re-read here for the first time — it is byte-for-byte the same `CL←[DI]` shape as `A860`, just 3×3 instead of 2×2). So the real question for this path is not "does `0xFD` appear as a literal" but "can `DI` ever point at a byte holding `0xFD` when either stamper runs" — and every caller of both is enumerated, not sampled: `A860` has exactly 3 static callers (`get_xrefs_to`, confirmed complete) — the starburst's fixed `DI=0xdcfe` (always `0xFC`), and two sites inside `FUN_1000_a7b6`; `A8B8` has **zero** static callers and is reached only through the draw-style jump table (`DS:0xdf26` entries 1/2), where `DI` is set by the common projectile mover to the projectile's own record. In every non-starburst case `DI` is a projectile record, and that record's tag byte (offset 0) has exactly one writer in the whole image — the fire-slot allocator's `tag = 1 + slot*9 + subslot*3` (1..25 in shipped use, structurally bounded ≤27) — and exactly one other, which zeroes it on despawn. No arithmetic on that formula reaches anywhere near 253 (`0xFD`).

**The consumer is real, and it is now found.** `CS:0xE5B9`, inside `FUN_1000_e4e2`, is reached from `CS:0xE48D` inside `CS:0xE487` — System A's own pipeline **stage 3**, "descriptor-gated (`[si+0xf]`) special action (attack/leap)" (see *System A has its own movement layer*), gated on `[si+0xf] != 0`. `FUN_1000_e4e2` computes the entity's own damage-grid cell — the identical `SI = 0x16ca + …` formula every other grid consumer uses, with the same nearest-column-but-floored-row split the hero's own event probe (`CS:0x5fab`) uses — then walks a per-class **reach table**: a signed-word offset stream at `DS:0xda08` paired with a `{dx,dy}` displacement stream at `DS:0xda68`, budgeted by `CH = (0x10 − descriptor[+0xf]) & 0xf` ticks off a starting allowance of `0x2f` (47), probing `[grid_cell + reach_offset]` at each step. An occupied cell (any nonzero tag) is normally treated as a found target, and the accumulated `{dx,dy}` is returned to the caller, which arms the entity's attack/leap (`[di+0x16] := 0xa`, a 10-tick windup, `[di+0x25] := 0`). **`CS:0xE5B9` singles out exactly one tag for different treatment: `CMP BL,0xFD / JZ` skips the accumulation and keeps scanning** — a cell tagged `0xFD` is deliberately *not* a valid target, unlike every other nonzero tag (weapon 1–27, or the special sources FC/FE/FF). ⚠️ **Correction — this exclusion is not universal.** `FUN_1000_e4e2` actually runs one of *two* parallel scan loops depending on the entity's own state, and only one of them ever reaches `CS:0xE5B9`; see *`UNKNOWN_e4e2_reach_table` — CLOSED* below for the full mechanism and why it doesn't change the practical conclusion.

**Put together, this is the game's fifth cut feature**, in the same family as the `flame` weapon's null spawn/mover handlers, the unplaced iron chest, the unplaced familiar-chain potions, and the world-4 falling hazard (`DS:0xcfcc` class 3). The tag decoder's `0xFD` branch (`CS:0x93BF`–`0x93CB`, forced zero damage) and this scan's `0xFD` special case were both built to recognize a fourth kind of grid occupant — plausibly something System A's attack/leap logic was meant to detect but path around rather than target (a decoy, a corpse, a friendly) — and nothing in the shipped `GAME.EXE` ever stamps it. Both halves of the mechanism are intact and wired, and permanently unreachable together. `UNKNOWN_e4e2_reach_table` — the class-indexed reach/displacement tables at `DS:0xda08`/`DS:0xda68` themselves, and which System-A classes reference them, are not traced past this.

⚠️ **Tag discipline, deliberately applied.** "No producer" here means every static write mechanism was traced to its complete set of callers and shown to be bounded away from `0xFD` — it is not proof that no runtime bug (memory corruption, an unrelated array's overrun) ever leaves a stray `0xFD` in a projectile record's tag byte or directly in the grid. **To promote to `[PROVEN]`:** a DOSBox watchpoint on `DS:0x16ca`–`0x1CE5` (the grid) for the byte value `0xFD` across a full playthrough would settle it; not run this pass.

### `UNKNOWN_e4e2_reach_table` and `UNKNOWN_hunter_negative_tag` — CLOSED: one global two-ring probe, not per-class tables `[STATIC]`

Both open items rested on a premise the full disassembly of `FUN_1000_e4e2` refutes: **the reach-offset and displacement tables are not class-indexed, or per-entity at all.** `CS:0xE4EE`/`CS:0xE4F4` reset both stream cursors to the same fixed immediates — `0xda08` and `0xda68` — on **every** call, and the caller (`CS:0xE48D`, inside stage 3 `CS:0xE487`) passes no per-class offset into any register beforehand (confirmed by disassembling `CS:0xE487`–`E4E1` in full: `SI` is the group descriptor, untouched before the call). Every System-A entity that reaches this stage scans the *identical* hardcoded pattern; the only thing that varies per entity is how far into it the scan gets to go.

**The 48-word reach-offset table at `DS:0xda08` is a two-ring spiral around the entity's own grid cell**, read directly off the raw bytes and verified by exact arithmetic on all 48 entries (row stride 48 = `0x30`, matching the grid's own documented stride):

| ring | entries | shape (offsets from the entity's own 4×4-cell / 32×32px box) |
|---|---|---|
| 1 | 0–19 (20 cells) | row−1 sweep cols −1..+4 (6) + col−1 strip rows 0..+3 (4) + col+4 strip rows 0..+3 (4) + row+4 sweep cols −1..+4 (6) |
| 2 | 20–47 (28 cells) | row−2 sweep cols −2..+5 (8) + col−2 strip rows −1..+4 (6) + col+5 strip rows −1..+4 (6) + row+5 sweep cols −2..+5 (8) |

20+28 = 48, exactly the table's own size — every entry is accounted for, and the table ends exactly where it should (`0xda08 + 96 = 0xda68`, the displacement table's own base). `CS:0xE4FE`–`E503` computes `CH = (0x10 − descriptor[+0xf]) & 0xf`, the per-scan-tick decrement subtracted from a fixed budget `CL = 0x2f` (47, the same starting allowance this document already recorded). A **larger** `descriptor[+0xf]` (the same field that gates stage 3's entry) gives a **smaller** `CH`, so the scan survives more ticks and reaches further into the spiral before the budget goes negative. **`descriptor[+0xf]` is a reach *depth* into one universal search pattern, not a selector into a per-class table** — which is also the answer to "which System-A classes reference them": none individually; every entity that reaches stage 3 walks the same 48-entry sequence, just to a depth its own descriptor allows.

⚠️ **The displacement stream at `DS:0xda68` does not walk in lockstep with the reach-offset stream, and accumulates at most two hits per call.** Its own 48 pairs (96 words, `da68`–`db27`, bounded exactly — the words immediately following, `0xdb30/0xdb58/0xdba8/0xdba8`, are the already-documented Strategy-3 waypoint pointer table at `DS:0xdb28`) sit un-consumed (`ADD word ptr [0x2a8],AX` with `AX=0`) until the first occupied cell is found. That first hit always reads pair 0 (`[0xda68]`/`[0xda6a]`) cleanly, then sets `AX:=1` (`CS:0xE5C3`/`E5D6`). From then on the cursor drifts forward **one byte per further scan tick** (not one 4-byte pair) until a second hit, whose read lands at whatever byte offset the elapsed tick count left it at — almost never a clean pair boundary. A third or later hit is never accumulated at all: `TEST AX,0x2 / JNZ` (`CS:0xE5BE`/`E5D1`) skips it once `AX` reaches 2. Read exactly as coded, not tidied up: the mechanism only ever cleanly uses displacement pair 0, and a second accumulation, when one happens, reads a data-dependent, usually-misaligned byte offset into the same table.

`UNKNOWN_e4e2_displacement_drift` — **root cause identified, intent still not provable `[STATIC]`.** Re-read the full entry sequence (`CS:0xE4E2`–`0xE585`) fresh rather than starting from the found-handler alone: `AX` is explicitly zeroed once, right before the Loop A/Loop B dispatch (`CS:0xE555 xor ax,ax`), and `DS:0x2a8` is reset to the table base `0xda68` once, at function entry (`CS:0xE4F4`) — both confirmed fresh per call, so the drift can't accumulate *across* calls, only within one 47-tick scan. But **`ADD word[0x2a8],AX` at `CS:0xE5A2`/`0xE57B` runs on every scan tick, hit or miss, not only when a displacement is consumed** — `AX` is doing double duty as both "how many hits found so far" (0/1/2, tested and capped via `TEST AX,2`) and, unintentionally, "how many bytes to advance the displacement cursor this tick." That is a textbook single-variable-reuse bug shape: the cursor should plausibly have advanced a fixed 4 bytes *only* on a hit, via its own dedicated step, not ridden along on the hit-counter every tick regardless of whether anything was found. This doesn't prove authorial intent — nothing in a binary can — but it identifies a concrete, specific mechanical explanation for the drift that "deliberate jitter" doesn't need and wouldn't naturally produce (jitter has no obvious reason to accelerate from a 1-byte to a 2-byte step partway through, or to keep advancing on ticks that found nothing). It can never matter for `0xFD` specifically, since `0xFD` never reaches the grid at all (see above) — this is offered as the closest this binary gets to an answer, not as proof.

⚠️ **Correction to the tag_fd closure above: the `0xFD` exclusion at `CS:0xE5B9` only fires on ONE of two parallel scan loops.** `CS:0xE557`–`E567` branches on entity fields `[di+0xa]` and `[di+0x24]` (the latter is the already-documented sticky per-entity strategy-mode byte from `CS:0xE6E4`): when **both** are nonzero the scan runs the **Loop A** body (`CS:0xE569`–`E583`), whose grid probe (`CMP byte ptr [BX+SI],0x0` at `CS:0xE576`) never loads the tag byte into any register at all — it tests the memory operand directly against zero — and whose found-handler (`CS:0xE5D1`) has **no tag-value check whatsoever**: any nonzero cell, `0xFD` included, counts as a hit. The `CMP BL,0xFD` exclusion lives only in **Loop B**'s found-handler (`CS:0xE5B9`, reached from `CS:0xE59C`'s `MOV BL,byte ptr [BX+SI]`), which runs when either field is zero. So the tag decoder's dead `0xFD` branch is guarded against being *targeted* only in the non-sticky case — an entity already committed to a strategy (Loop A) would treat a hypothetical `0xFD` cell as an ordinary target. This doesn't change the practical conclusion (nothing in shipped `GAME.EXE` ever writes `0xFD` to the grid, so neither loop ever actually encounters one), but it means "the exclusion" is not a single, uniform piece of code — it's specific to the less-common branch, and a description that doesn't name Loop A overstates how deliberately the cut feature was fenced off.

**The caller, `CS:0xE487`–`E4E1`, turns the returned `{CX,DX}` into a velocity delta, not a raw position** — new material, not previously documented. On a nonzero result (`OR AX,DX` / `JZ` rejects an all-zero return) it arms the windup (`[di+0x16]:=0xa`, `[di+0x25]:=0`, both already documented), doubles `CX`/`DX` (`SHL ..,1`), clamps each to `±descriptor[+0xc]` (a **new** System-A group-descriptor field, signed byte, sign-extended and negated into a floor `BX = -descriptor[+0xc]`), then **adds a baseline velocity pair from `DS:0x298`/`DS:0x29a`** before writing the sum into the stage-2 velocity fields `[di+0x12]`/`[di+0x14]` — exactly the fields this document already names as System A's own accelerate-toward-goal output, confirming stage 3 "may override the velocity" by *blending into* stage 2's result rather than replacing it outright.

⚠️ **`UNKNOWN_DS_0298` — CLOSED `[PROVEN]`.** The writer is `CS:0xE001` itself, the pipeline dispatcher: right after stage 1 (`CALL 0xE6E4`) and before stage 2 runs, `CS:0xE017`–`0xE021` does `DX=[di+0x12] / [0x298]=DX` then `DX=[di+0x14] / [0x29a]=DX` — a **snapshot of the entity's own velocity fields, taken before stage 2 overwrites them this tick.** So the "baseline pair" stage 3 blends into isn't a separate constant at all — it's the entity's *own* velocity as it stood at the start of the tick, cached in a global scratch pair specifically so stage 3 (which runs after stage 2 has already updated `[di+0x12]`/`[di+0x14]`) can add its steering delta on top of the pre-stage-2 value rather than the post-stage-2 one. A port that has stage 3 read the live (already-updated) velocity fields instead of this cached snapshot will double-apply stage 2's own contribution on any tick both stages fire.

⚠️ **`UNKNOWN_sysA_descriptor_0c` — CLOSED (shipped-data census) `[PROVEN]`.** Decompressed all 8 `PALFILS.0{A,B}{1-4}` files (`blast.py`) and read the System-A descriptor table (`+0x0D58`, stride `0x16`, live when `+0x00 != 0`) at field `+0xc` as a signed byte, for all 74 live records: values are **`{1:8, 2:12, 3:11, 4:7, 5:8, 6:14, 7:4, 8:5, 10:5}`** — every one strictly positive (1..10), never 0, never negative, and clustered low (median 4, mode 6). So in shipped play the per-class steering-step cap this field sets is always a small positive value; the "signed, sign-extended and negated" handling in the code is defensive generality the data never actually exercises. Worlds 1, 2 and 4 have byte-identical value sets between their `A`/`B` sublevels (expected, since sublevels of the same world share one entity roster); only world 3's sublevels diverge (`0A3`'s tail `6,8,10,6` against `0B3`'s `4,3,6,6`).

**`UNKNOWN_hunter_negative_tag` closes alongside it, for an unrelated reason: the hunter's target-list "key" is not a distance, an HP value, or anything derived from the damage-grid tag ladder at all — it is the entity's own currently-computed SPRITE ID.** `CS:0xAA8D` (the target-list append, gated on `DS:0x343`) writes `{AX, BX, CX}` unconditionally for every creature scanned this frame, and `CX` at that point is untouched since whichever of two identical mechanisms last set it, confirmed by full disassembly of both:

- **System B** (`FUN_1000_edb8`, `CS:0xEDD3`): `CALL AX` into the `DS:0xdbe0` movement-mode handler (walk/fall/hop), whose tail — confirmed on all three RET paths of the walk-left handler at `CS:0xF11F`–`E4` (`CS:0xF156`, `F16D`, `F1E4`, each immediately preceded by `CALL 0x1000:F0AE`) — ends by calling the already-documented sprite-formula routine `CS:0xF0AE` (`sprite = class_base + MODE_ANIM[mode] + frame`), which leaves the computed sprite id in `CX`. `CS:0xEDD5` stores it to `DS:0x8`; the subsequent `CALL 0x1000:EF01` (the steal-and-carry mechanic) leaves `CX` untouched on every early-exit path (confirmed by reading `FUN_1000_ef01` in full — its common case is `CMP [0x3cd],2 / JNZ RET` before touching any register), so `CX` reaches `CS:0xEDF4`'s `CALL 0x1000:FF93` → `CS:0xA9E4`'s `CALL 0x1000:AC59` unchanged.
- **System A** (`FUN_1000_e001`, `CS:0xE0AA`): the mirror image, one register-width instruction apart — `CS:0xE094 CALL 0x1000:E199` (System A's own already-documented sprite-formula resolver) leaves the class sprite base in `CX`, `CS:0xE09E` stores it to the same `DS:0x8` scratch word, and `CS:0xE0AA`'s `CALL 0x1000:FF93` passes it through the identical way.

Since `FUN_1000_ff93` itself never touches `CX`/`DX` (confirmed by its full disassembly), both entity systems hand the hunter's target list a **sprite id**, not a priority score. Sprite ids are always small positive values (every documented class base is in the low hundreds; the highest, `always+objects = 450`, plus a bounded `MODE_ANIM`/frame offset, stays far under the 16-bit sign boundary), so the theoretical worry behind the item's name — a *negative* key reaching the signed "keep the smaller one" comparison at `CS:0x9E36` (`cmp dx,[si] / jnl`) — cannot arise from legitimate class data, and the key never touches the grid's tag decode (`CS:0x9320`) at all. What the bytes actually show is odder: **the hunter homes on whichever on-screen creature happens to have the lowest computed sprite index this frame** — an authoring-order artifact of the sprite atlas layout, not a distance, threat, or health heuristic.

`UNKNOWN_hunter_key_intent` — **narrowed, not fully closed `[STATIC]`.** Whether this was a deliberate cheap tie-break or an abandoned distance calculation can't be settled with certainty (no source, no comments), but `CS:0x9E36` itself — the search routine, read here in full, 24 instructions — is genuine evidence either way, and it points one direction. The loop is a **plain, complete "find the minimum" scan**: `cmp dx,[si] / jge skip`, and on a new best it loads the record's world position (`AX`/`BX`, converted screen→world by adding the camera scroll) purely to **carry forward as the eventual steering target**, not as an input to the comparison. There is no subtraction of the hero's own position anywhere in the loop, no discarded register load, no dead arithmetic of any kind — nothing that looks like the leftover shape of a distance calculation someone started and didn't finish (contrast this with genuinely unfinished/cut code elsewhere in this document, e.g. the `flame` weapon's null handlers or the world-4 hazard's real-but-unwired tables, which all leave a *structural* trace). A routine this minimal and self-consistent reads more like a deliberately cheap tie-break than a stub — evidence, not proof, but the strongest this binary can offer on the question.

⚠️ **A theoretical hazard, checked and closed negative.** `CH = (0x10 − descriptor[+0xf]) & 0xf` is **zero** when `descriptor[+0xf]` is exactly `0` or `0x10` (16), which would make `SUB CL,CH` a no-op every tick and the scan never terminate. `0` is already excluded by the stage-3 entry gate; a shipped `16` is not ruled out by the code, so this was checked directly against data: `blast.py`-decompressing all 8 `PALFILS.0{A,B}{1-4}` files and reading `DS:0x9d60 + rec*0x16 + 0xf` for every record whose own `+0x0` (entity count) is nonzero reproduces this document's own already-published liveness census exactly (`9/9/10/9/9/9/10/9` live of 50 per file — the same figures recorded under *the enemy sprite*), confirming the offset scheme, and the 74 live `+0xf` values are `{0, 6, 9, 10, 12, 13, 14, 15}` — **maximum 15, and 0 only ever appears on non-participating descriptors that never reach stage 3 in the first place.** No shipped System-A descriptor can hit the `CH=0` case.

⚠️ **A workflow lane's own conclusion was refuted by its verifier and is worth not re-deriving:** "System-B creatures are one-touch kills". No instruction decrements entity `+0x08` in memory — but `0xFFA2` loads it into `BP`, `0xA9E4` modifies **BP in place**, and `0xFFB4` writes it back. Creature HP does deplete across frames, and projectile kills award score by the same path as contact kills. `[WF]` — the register round-trip matches the `bp` in/out convention this document already documents for `0xac59`, but the score path itself was not re-read here.

### Three more movers, and an engine feature hiding inside one `[PROVEN]`

**Mover 1, `CS:0x9d97` — fireball.** The common mover plus a per-projectile Y accumulator that *accelerates*:

```
9DBF  si = 0xdefc
9DC2  dx = [di] ; sub dl,[0x340] / dec dl    ; -> index within the slot, 0..8
9DCA  shl dx,1 / add si,dx
9DCE  add bx,[si]                            ; add the accumulator to Y
9DD0  inc word [si]                          ; AND BUMP IT
```

`DS:0xdefc` is **nine words** — one per projectile record — sitting exactly `0x12` bytes below the velocity table at `0xdf0e`, which is what pins its size. Because the entry is incremented every tick the drop grows by one each frame rather than staying constant; that is the fireball's arc. It also calls the terrain-aware stamp `0xa7b6` **directly** (no draw-style dispatch) and re-tests the tag afterwards, so a shot the wall just consumed is not also drawn.

**Mover 4, `CS:0x9ef7` — hunter, and it does home.** But the interesting part is not the weapon:

> ⚠️ **The target list is built by the COLLISION SCANNER, not by the weapon.** During the per-frame creature scan, `CS:0xAA8D` appends `{x, y, key}` — six bytes — to a list growing from `DS:0x8c54` (`mov word [0x1d2],0x8c54`, `CS:0x0218`) and bumps the count `DS:0x33c` (initialised to `0xFF` = −1 at `CS:0x021E`, so N creatures leave it at N−1). `CS:0x9e36` then walks that list and takes the entry with the **largest** key.
>
> ⚠️ **Correction, found porting this mover.** This line used to say "the smallest key… `cmp dx,[si] / jnl` keeps only a strictly smaller one" — a misreading of the mnemonic that survived uncorrected. Traced with a concrete example rather than from the mnemonic alone: `dx` (the running best) seeds at `0xFFFF` (signed −1, the lowest value any real non-negative key can beat), and `JNL`/`JGE` **skips** (keeps the OLD best, does not replace) exactly when `dx >= [si]` — so it replaces only when `dx < [si]`, walking the running best **UP** toward the largest key, never down. Walked by hand against keys `[5, 3]` in scan order: record 1 (key 5) beats the −1 seed and becomes best; record 2 (key 3) then loses (`5 >= 3`, skip) — final best is 5, not 3. `CS:0x9e6c mov word [bp],0` then zeroes the WINNING record's own key, so a second hunter shot searching the same list this tick scores that creature worst rather than re-picking it — a natural "spread across live targets" side effect.

So the hunter can only chase creatures the scan actually visited **this frame**, and ordering matters: run the mover before the scan and it homes on last frame's creatures. That also gives the damage grid a second consumer — it is not only a hit test.

⚠️ **For this mover `dir` is a PACKED SIGNED VELOCITY PAIR, not a table index — and the halves are the reverse of the obvious:**

```
9F3E  cx = [di+6]
9F41  dl = cl (LOW) ; cl = ch (HIGH)
9F46  al = cl / cbw / cx = ax     ; cx = sign_extend(HIGH)
9F4B  al = dl / cbw / dx = ax     ; dx = sign_extend(LOW)
9F51  ax += cx                    ; X += the HIGH byte
9F53  bx += dx                    ; Y += the LOW byte
```

**X comes from the high byte, Y from the low one.** The debris spawner at `CS:0xA039` reads the same word the same way round, which corroborates it. Reading them the natural way mirrors every hunter shot diagonally. This is also why a `dir` of `0x2f` is meaningful to one mover and meaningless to another — **`dir` is per-mover, and there is no global encoding**.

The turn rate is a third use of the pickup count: `CS:0x9f12` computes `[si+8] − [si+6] − 2` clamped to `[1, 2]`. Note the `− 2`: the rate only rises at **four** extras, well past the two that already max the volley — so `+0x08` keeps paying after the projectile count stops. It now drives **volley size, damage per hit, and turn rate**.

`UNKNOWN_projectile_movers` narrows to `0xa678` (magic axe) and the tail of `0xa058` (time bomb).

### Mover 3, `CS:0xa058` — the time bomb, and `dir` is a FUSE `[PROVEN]`

⚠️ **For this mover the `dir` word is not a direction at all — it is a countdown**, decremented once per tick in the shared tail:

```
A261  dec word [di+0x6]
A06B  cmp dx,0 / jns fly / jmp 0xa273      ; negative -> leave the flight path
A273  cmp dx,0xffff / jz 0xa27b            ; EXACTLY -1 is the trigger
A27C  sfx 0x22 ; si = 0x8eda ; cx = 0x0a   ; ten fragments
```

The spawn handler seeds `0x2f` = **47 ticks ≈ 3.1 s at 15 Hz** — a literal time bomb. Only exactly `−1` detonates; anything more negative takes the `0xa326` path instead. Sprite is `0x153 + (fuse & 3)`, and `0x153` = 339 = **`PINNED_SPRITE[1]`**, the time bomb's own descriptor — a second routine agreeing with the pinned table without reading it.

> **This settles `dir` for good: it has NO global meaning.** The common mover uses it as an index into the 6-entry velocity table; the hunter unpacks it as two signed bytes (X in the high half); the time bomb counts it down. `0x2f` is a 3-second fuse in one mover and out of range in another. A port with one `dir` helper is wrong twice over.

Flight uses the globals `DS:0x1c8` (vx), `0x1ca` (vy), `0x1cc` (state) rather than per-projectile storage — safe only because the time bomb's max-shots is 1.

| | |
|---|---|
| gravity | `A0A8 inc [0x1ca]` capped at **4**, and only when `(fuse + 2) & 3 == 0` — a *stepped* fall, and a **third** distinct gravity rule |
| vx decay | `A130 dec [0x1c8]` every 4th tick, toward zero |
| wall | `A16C neg word [0x1c8]` — **negates**, unlike the axe's fixed ±4 |
| land | `A234 and bx,~0xf` ; `[0x1ca] = 0` ; `[0x1cc] = 0x64` |

⚠️ Its wall probe rounds x with **`add cx,0xf`** (`CS:0xA139`) — neither the `+8` the terrain-stop path uses nor a plain floor. Three different roundings now live in this subsystem.

**`DS:0xdf2c` is a 24-byte signed Y-delta table — the damped settling bounce after landing**, indexed by `DS:0x1cc` and reset past 23:

```
-4 -3 -2 -1 0 1 2 3 4 | -3 -2 -1 0 1 2 3 | -2 -1 0 1 2 | -1 0 1
```

Four arcs of falling amplitude (4, 3, 2, 1), so the bomb visibly settles rather than stopping dead.

**All six movers are now decoded.** `UNKNOWN_projectile_movers` is CLOSED.

### `UNKNOWN_hunter_turn` — CLOSED: the steering, the spawn handlers, the stamp, and why the tag is born negative `[PROVEN]`

The steering itself, past `CS:0x9f5b`, is a per-axis accelerate-toward-goal with a fall-through quirk:

```
9F61  cmp ax,[ss:0x420] / jl 0x9f72     ; left of goal -> accelerate toward it
9F68  sub cx,bp                          ; else decelerate by the turn rate
9F6A  cmp cx,-6 / jnl 0x9f72
9F6F  mov cx,-6                          ; pinned to the −6 floor...
9F72  add cx,bp                          ; ...and the rate is ADDED BACK — falls through
9F74  cmp cx,6 / jng done / mov cx,6     ; ceiling, same shape
```

⚠️ **The low clamp falls through into the increment.** A plain `clamp(v − rate, −6, 6)` sits flat at −6; the real code pins to −6 and then re-adds the rate, so at rate 1 the velocity oscillates −6, −5, −6, −5… forever rather than settling. Same shape on Y (`CS:0x9f83`–`0x9f94`). The goal is offset `+6` on both axes first (`CS:0x9f55`/`0x9f5b`), so the hunter aims **into** the creature's body, not its corner.

**The spawn handlers, table indices 10 (left, `CS:0x9aca`) and 11 (right, `CS:0x9a82`) — previously undecoded — are the hunter's own 3-shot fan, not a `DIRS` lookup:**

```
9A82  neg dx                 ; RIGHT: dx (tag, IN) flips negative
9A84  sub bx,0xc              ; muzzle Y, same -0xc every base handler uses
9A87  bp = [si+8] - [si+6] + 1 ; the volley count, same formula as 0/1
9A8E  [di]=dx / [di+2]=ax(stosw) / [di+4]=bx / [di+6]=0xb00   ; entry 0: vx=+11,vy=0
9AA0  dec bp / jz done
9AA3  dec dx ; [di]=dx / ... / [di+6]=0xb07                   ; entry 1: vx=+11,vy=+7
9AB6  dec bp / jz done
9AB9  dec dx ; [di]=dx / ... / [di+6]=0xbf9                   ; entry 2: vx=+11,vy=-7
```

`9AA0` mirrors it at `CS:0x9aca` (left), with `add ax,0x10` before the write (matching handler 1's own muzzle asymmetry — only ONE arm of a pair ever touches X) and dirs `0xf500/0xf507/0xf5f9` (vx=−11). **Neither arm writes weapon `+0x0e`** (the facing field handlers 0/1 both set) — a genuine, unexplained asymmetry.

⚠️ **The record's own TAG is written NEGATIVE from birth** (`neg dx` then `dec dx` per entry) — not a stray bug, but load-bearing: `CS:0x9EFA`'s own dispatch reads the sign of `[di]` as a state flag:

```
9EFA  cmp word [di],0 / jnz 0x9f02   ; tag==0 -> empty slot, skip entirely
9F02  js 0x9e9e                       ; tag<0  -> COAST (ballistic, below)
       [falls through]                ; tag>=0 -> SEARCH (0x9f04, CS:0x9e36)
```

So a freshly-spawned hunter shot's FIRST tick takes the COAST arm, not the search. That arm (`CS:0x9E9E`–`0x9EFA`) applies the packed `[di+6]` literal the spawn handler just wrote as **plain ballistic motion** (no steering), **damps it toward zero one unit per axis per tick** (drag), and once BOTH components reach exactly zero, writes the sentinel `[di+6] = 0x0F00` (unreachable by any steered velocity, since steering clamps to ±6 on both axes). ⚠️ **Correction — the tag is NOT negated on this same tick.** An earlier revision of this section said reaching the sentinel "does a single `neg word [di]` — flipping the tag positive for the first time"; re-reading `CS:0x9E74`–`0x9E94` in full shows the sentinel tick only writes `0x0F00` and returns (`jmp 0x9fa3`) — the flip happens later, once the cooldown below expires. From the next tick on, `[di+6] >= 0xF00` keeps re-entering `CS:0x9E74` every tick until that fires; nothing else ever re-negates the tag once it finally does, so the hunter homes for the rest of its life once the delay elapses.

### `UNKNOWN_hunter_coast_reaim` — CLOSED: a fixed ~0.8 s delay, not a periodic cooldown `[PROVEN]`

`CS:0x9E74`–`0x9E94` is reached every tick the COAST arm's own dispatch (`cmp cx,0xf00 / jge 0x9e74`) finds `[di+6]` already at-or-past the rest sentinel:

```
9E74  cx += 0x100                    ; [di+6]'s HIGH byte, a tick counter, +1 per tick since the sentinel
9E78  [di+6] = cx                     ; write back
9E7B  pop dx / push dx                ; dx = the value FUN_1000_9ef7 pushed at its own entry — see below
9E7D  add dl,2 / and dl,3             ; dl = (dl+2) & 3
9E83  shl dl,1 / shl dl,1             ; dl <<= 2
9E87  xchg dl,dh                      ; reassemble into dx
9E89  add dx,0xf00                    ; dx = the RE-AIM THRESHOLD
9E8D  cmp cx,dx / jge 0x9e94          ; reached it? -> re-aim (below); else keep coasting
9E94  [di+6] = 0 ; neg word [di]      ; clear the counter AND flip the tag positive -> SEARCH from next tick
```

⚠️ **The `dl` byte this pass called "cycling" is not — it is a fixed constant, because its input never varies.** `9E7B`'s `pop dx` retrieves the value `FUN_1000_9ef7` (this mover's own dispatch entry, `CS:0x9EF7`–`0x9EFD`) pushes **unconditionally at the top of every call**: `MOV CX,0x9` (literal 9), immediately followed by `PUSH CX` inside the COAST-arm prologue at `CS:0x9E9E`, with nothing on the path in between touching `CX`. `get_xrefs_to` confirms `CS:0x9E9E` has exactly one caller (`CS:0x9F02`, the `JS` inside this same dispatch) and `CS:0x9E74` has exactly one caller (`CS:0x9EAC`, the `JGE` two lines above) — one calling context, `CX` always `9`. Working the arithmetic through: `dl = (9+2)&3 = 3`, shifted left twice = `12`, swapped into `dh`, giving `dx = 0x0C00`; `+ 0xF00 = 0x1B00` (6912) — a **fixed** threshold, not one that varies tick to tick or call to call.

**So the wait is a plain fixed-length timer, dressed up in a bit-shuffle that always produces the same answer.** `[di+6]` climbs `0xF00 → 0x1000 → 0x1100 → …` by `0x100` per tick from the moment it first hits the sentinel; reaching `0x1B00` takes exactly `(0x1B00 − 0xF00) / 0x100 = 12` further ticks. **At the documented 15 Hz game-logic rate, that is exactly 0.8 s.** A hunter shot that has fully decayed to a stop coasts in place for 0.8 s before its tag flips positive and it starts homing — not a periodic re-check, a one-shot delay. The elaborate `(dl+2)&3` construction is most plausibly a generic reload/delay helper's shape, reused here with a hardcoded parameter that happens to make the "cyclic" part of it inert; nothing in this call site ever exercises a second value.

**The stamp, `CS:0x9FC8`, and why the tag's sign has to be flipped for it:**

```
9FC8  cmp word [di],0 / jns 0x9fd6      ; tag non-negative -> just stamp
9FCD  neg word [di]                     ; NEGATIVE -> flip positive...
9FCF  call 0xa7b6                       ; ...the SAME shared terrain-aware
9FD2  neg word [di]                     ; stamp every other mover uses...
9FD4  jmp 0x9fd9                        ; ...then flip back
9FD6  call 0xa7b6                       ; already non-negative -> stamp directly
```

So the tag's magnitude is always the ordinary 1..27 slot tag the shared damage grid and `CS:0x9320`'s tag decode expect; the SIGN is a private state flag (ballistic vs. homing) that would corrupt both if it ever reached the grid unflipped, so it is normalised for exactly the instant the shared stamp needs it. `CS:0xa7b6` internally re-tests `weapon+0x48` (`breaksTerrain`, `0` for the hunter — it is one of the five weapons that pass straight through terrain), so hunter shots never stop at walls, only stamp.

**The cull, `CS:0x9FB3`–`0x9FC6`, is a third shape**: `x ∈ (−16, 320]`, `y ∈ (−16, 192]`, narrower than the common mover's `(−32, 320)`, and — unlike every other mover — going out of it only skips the stamp+draw (`jmp 0x9fd9`), never despawns. A hunter shot that leaves the screen keeps flying and can come back.

Together this closes `UNKNOWN_hunter_turn` fully: steering, the two spawn handlers, the stamp, the cull, and the tag's sign are all read to the byte. The coast phase's re-aim delay is closed too — see *`UNKNOWN_hunter_coast_reaim` — CLOSED*, above: a fixed 0.8 s timer, not a periodic cooldown, and it never changes whether a shot stamps or homes, only how long the opening spread lasts before it does.

### Mover 5, `CS:0xa678` — the magic axe bounces `[PROVEN]`

The only mover with per-projectile velocity **state**. `DS:0xdec6` — which sits exactly where slot C's projectile area ends (`0xde34 + 0x92`) — holds **nine 6-byte records `{i16 vx, i16 vy, i16 lifetime}`**, walked in lockstep with the 8-byte projectile records:

```
A77A  add di,0x8      ; the projectile record
A77D  add si,0x6      ; its velocity/lifetime record
A780  dec bp / js     ; bp starts at 8 -> NINE iterations
```

⚠️ **The wall probe is gated on the sub-tile position**, so outside a narrow window the axe moves without testing for a wall at all:

```
A69D  cmp dx,0xc / jng move    ; moving right: only when (x & 0x1f) > 12
A6A9  mov cx,0xfffc            ; vx := -4
A6B8  cmp dx,4  / jnl move     ; moving left:  only when (x & 0x1f) < 4
A6C4  mov cx,0x4               ; vx := +4
```

**And WHICH cell gets tested is decoded too, `CS:0xA5A5` (right) / `CS:0xA5D9` (left).** Both take X **and** Y — a probe that drops Y (as an earlier revision of the `gods-web` port's own `wallAt(x, dir)` signature did) cannot reproduce this. The tile cell is the usual `0x5004 + (x&~0x1f)>>5 + ((y&~0xf)<<3)`, and the NEIGHBOUR tested depends on the Y sub-tile remainder:

```
A5C6  and bx,0xf / jz 0xa5d2        ; y HAS a sub-tile remainder ->
A5CB  cmp byte [si+0x81],1 / jz     ;   test row+1, col+1 (diagonal)
A5D2  cmp byte [si+0x1],1           ; y remainder == 0 -> same row, col+1
```

⚠️ Read the offsets literally, not by the comment gloss above them: `+0x81` (129 = 128+1) is tested when the Y remainder is **nonzero**, and it is **row+1, col+1** — a diagonal look-ahead, not "the same row". `+0x1` (same row, col+1) is tested when the remainder is **zero**. The left probe mirrors it at `si-1` (same row) / `si+0x7f` (row+1, col−1). `ZF` on return is the comparison result (`byte == 1` → wall); the caller's own `jnz` after the `call` reads "not a wall → keep flying".

⚠️ **And the bounce is a fixed ±4, not a reflection** — an incoming +12 leaves as −4.

⚠️ **A FOURTH distinct gravity rule.** `A703 add cx,2 / cmp cx,8 / jng / sub cx,2`. Collected, no two alike:

| | rule | cap |
|---|---|---|
| hero | `dY = 4 + v`, `v++` | 10 |
| System-B enemy | `dY = v` *then* `v++` | 16 |
| time bomb | `v++` | 4 |
| **magic axe** | **`v += 2`** | **8** |

Lifetime is `A737 dec word [si+0x4] / js` — **decrement then test the sign**, so a life of 2 survives two ticks and dies on the third. Sprite is `0x1aa + ((weaponFrame + phase) mod 6) + 1`, and **`0x1aa` = 426 = `PINNED_SPRITE[9]`**, the magic axe's own pinned descriptor — an independent check on that table from a routine that never reads it. Bounces play sfx `0x09` (`CS:0xa7ad`).

**On expiry, `CS:0xA7A1 call 0xa633` drops a debris spark** carrying the state record's OWN current `{vx, vy}` (`cx=[si]`, `dx=[si+2]`) — a MOVING spark, not the stationary puffs the terrain-stop and enemy-shot-hits-hero paths drop, and notably **after** that same tick's own gravity clamp has already run (the instruction order is position-update → gravity → cull → lifetime-test), so the spark's `vy` is the post-gravity value. This closes one of the five `CS:0xA633` callers catalogued under *`DS:0x8b4c` — debris* above.

**The spawn handlers, table indices 14 (left, `CS:0x9bc1`) / 15 (right, `CS:0x9b15`) — previously undecoded — are now read in full.** Same muzzle/volley-count shape as every other pair, but `dy = -0x10` (twice the common `-0xc`) and, unusually, **neither `dx` nor `dir` is mirrored by facing** — both handlers open `add ax,0x10 / sub bx,0x10`, and both write `dir = {1, 0, 2}` to every entry regardless of facing:

```
9B40  [di]=tag(dx) / [di+2]=x(stosw,ax) / [di+4]=y(bx) / [di+6]=dir(1, then 0, then 2)
9B52  [si]=4                    ; state.vx := +4  (RIGHT, CS:0x9b15); LEFT (0x9bc1) writes -4
9B59  cx=[0xdf14] ; [si+2]=cx   ; state.vy := the LIVE PROJECTILE_VELOCITY[dir].vy
9B62  [si+4]=0x32               ; state.life := 50
```

`dir` carries no meaning here to mirror, because `stepMagicAxe`'s own body never reads a projectile's `dir` field — movement comes entirely from the paired `DS:0xdec6` state record, which these same handlers seed. The state slot index is computed from the entry's own TAG (`(tag-1) mod 9`-shaped, via two `cmp cx,0xa / sub cx,9` folds), landing on the exact array position the mover will later walk to by loop index, since the tag numbering and the record's physical slot share one numbering. ⚠️ `DS:0xdf14` etc. are read out of the SAME mutable `DS:0xdf0e` velocity table the weapon-arc potions overwrite (already documented above) — so a magic axe's initial `vy` genuinely depends on whichever arc potion is active the moment it's thrown, and a port must read that table live at spawn time rather than bake a constant.

`UNKNOWN_projectile_movers` is **CLOSED** — see the time bomb above.

⚠️ **This line used to also claim `UNKNOWN_hunter_turn` closed, pointing at the turn-RATE formula (`CS:0x9f12`, the `[si+8]-[si+6]-2` clamp).** That was premature: the turn rate is a scalar multiplier, not "the hunter's steering arithmetic" the item actually named — the per-axis accelerate-toward-goal logic (`CS:0x9f61` onward) was still unread at the time. It is now genuinely closed, along with the two spawn handlers, the stamp, and why the tag is born negative — see *`UNKNOWN_hunter_turn` — CLOSED* right after the hunter mover section above.

### The move→stamp link, and a long-standing claim corrected `[PROVEN]`

**The grid stamp is on the projectile's DRAW path, not in the move loop.** The common mover ends by tail-jumping through a **three-entry draw-style table at `DS:0xdf26`**, indexed by weapon `+0x02`, and it is those branches that stamp:

```
9CF1  cx = [si+0x2] / shl cx,1 / mov di,0xdf26 / add di,cx / mov cx,[di] / jmp cx
  [0] 0x9cff  ->  call 0xa7b6  (terrain-aware 2x2)  then one blit
  [1] 0x9d0c  ->  call 0xa8b8  (3x3)                then one blit
  [2] 0x9d19  ->  call 0xa8b8 at y-0x10             then TWO blits, branching on facing
```

The table is **three** entries — `DS:0xdf2c` onward holds signed byte pairs, a different table — and weapon `+0x02` is **0..2 across all 44 shipped records**, the table's exact width. That also settles the tension flagged earlier: the pickup path zeroing `+0x02` when it reads 3 (`CS:0x9118`) is a **range guard**, not a second meaning for the field.

**This was the real break in the port**, not the fire entry: a reimplementation that moves projectiles but never stamps leaves the damage grid empty every frame, so nothing can ever be hit however complete the rest of the chain is.

#### ⚠️ `PWEAPONS` `+0x48` is "stopped by terrain", NOT "breaks blocks"

This document has carried `+0x48` = *"projectile breaks solid terrain — the `maces break blocks` flag"* as a `[STATIC]` inference from field position. **The bytes refute it.**

```
A7B7  cmp byte [si+0x48],0 / jnz
A7BD  jmp 0xa860                        ; flag CLEAR -> just stamp, keep flying
A7C0  cx = x + [0xa] + 8 ; and 0xffe0   ; ⚠️ +8 on BOTH axes before the mask
      dx = y + [0xc] + 8 ; and 0xfff0
      bp = 0x5004 + (cx>>5) + (dx<<3)
A7EF  cmp byte [ds:bp+0],1 / jnz 0xa860 ; not solid -> stamp, keep flying
A7F6  play sfx 0x1d
A816  append a debris record to the 20-slot array at DS:0x8b4c
A85B  mov word [di],0                   ; DESPAWN THE PROJECTILE
```

**There is no write to plane A or plane B anywhere on that path.** The projectile is consumed by the wall; the wall is untouched. So the flag means the shot *collides with* terrain, and a weapon with `+0x48 == 0` flies **straight through walls**. Shipped: knife, time bomb, fireball, flame, throwing star and mace collide; **lightning bolt, spear, axe, hunter and magic axe pass through**.

Block destruction is a much narrower, separate mechanism: only when the plane-A tile is **`0x6d`** *and* the world is **≥ 3** does `CS:0xA810` call `0x73ec`, which appends the cell to a 40-entry queue at `DS:0xd0c6`. `UNKNOWN_destructible_tile` is **CLOSED** — see *Destructible blocks* below for what that queue then does.

⚠️ Note the **`+8` on both axes** before the tile masks. A port using a plain `x>>5, y>>4` picks a different cell near a boundary; a wall at the correctly-rounded cell stops the shot while one at the naive cell does not.

### The fire cycle — semi-automatic, and allocate is 3 ticks before emit `[PROVEN]`

**`DS:0x351` is not a per-frame latch.** Its per-frame clear is conditional:

```
019D  test byte [0x382],0x80    ; fire bit held?
01A2  jnz 0x1a9                 ; HELD -> do NOT clear
01A4  mov byte [0x351],0        ; RELEASED -> clear
```

The allocator bails returning 1 when the latch is set (`0x95cb`) and sets it on entry (`0x95d5`). So the latch clears only on a tick where fire is *not* held: **one volley per button press.** Holding fire does nothing until you release. A port that clears it every frame gives the hero a 15 Hz autocannon.

**The state machine enters a fire state only on allocator success, and success is 0** (`CS:0x5ca8`, walk-right; the other seven mirror it):

```
5CA8  test byte [0x382],0x80 / jz  keepWalking
5CAF  call 0x95ca
5CB2  cmp ax,0x0 / jnz keepWalking      ; the INVERTED return, in live use
5CB7  jmp 0x5d3d
```

That is independent confirmation of the inverted convention — not merely inferred from the allocator's own `xor cx,cx`.

**⚠️ Allocation and emission are on different ticks.** `CS:0x5d3d` sets state 5 with phase 0, and the handler emits at **phase 3**:

```
5D46  inc cl
5D48  cmp cl,3 / jnz                    ; PHASE 3 ONLY:
5D4E    call 0x9734                     ;   emit (0x97ce facing left)
5D52  cmp cl,5 / jl stay
5D57  test byte [0x382],0x80 / jz leave ; at phase 5, re-check fire
5D5E  call 0x95ca                       ;   and chain another
```

So the press *reserves* a sub-slot and the projectile *appears* three ticks later — **200 ms at 15 Hz**, visible, and part of why the game feels deliberate.

### `UNKNOWN_fire_state_bodies` — CLOSED: all eight decoded `[PROVEN]`

⚠️ **The four families are NOT variants of one pattern.** Decoding walk+fire and mirroring it into the other three gets the emit phase wrong in **six of the eight states** and the animation wrong in two.

| family | states | emits at | animation | epilogue |
|---|---|---|---|---|
| walk + fire | 5, 6 | **phase 3** | table `DS:0xd950` | **`0x5e9f`** — skips the phase store |
| jump + fire | 20, 21 | phase 1 | `[0x356]` inc/dec flag | `0x5e9b` |
| fall + fire | 22, 23 | phase 1 | `[0x356]` inc/dec flag | `0x5e9b` |
| ladder + fire | 24, 25 | phase 1 | bare `inc` | `0x5e9b` |

**Walk is the odd one out on both counts.**

⚠️ **The persisted phase and the rendered phase are different values.** `CS:0x5d68` stores the raw counter into `DS:0x36b` *first*, then overwrites `CL` from the table and jumps to **`0x5e9f`** — one instruction past the epilogue's own `mov [0x36b],cl` at `0x5e9b`. Storing the remapped value instead freezes the cycle, because the next tick's `inc cl` would then run on a sprite offset rather than a counter.

The table at `DS:0xd950`, read as a byte at `[phase*2]`, is the symmetric recoil **2, 1, 0, 1, 2**. Entry 5 holds 21 and is **never read**: `cmp cl,5 / jl` diverts before the lookup, so `cl` is only ever 0..4 there.

| state | exits at | to | with `cl` | note |
|---|---|---|---|---|
| 5 / 6 | 5 | 1 / 0 | 2 | at phase 5 re-checks fire and **chains** (`cl := 0`) if it can allocate |
| 20 / 21 | 3 | 9 / 8 | 5 | `[0x358] += 2` so the jump arc continues; past `0x2e` → state 12 |
| 22 / 23 | 3 | 12 / 11 | 0 | runs the **full fall physics** — `+4`, gravity `0x48b0`, `+= [0x1b2]`, fall-damage |
| 24 / 25 | 3 | 14 | **3 / 1** | restores Y from `[0x1b6]`; `[0x378]` = 1 / 0xff |

⚠️ **The ladder pair is asymmetric** — 24 exits with `cl = 3` (`CS:0x5471`) and 25 with `cl = 1` (`CS:0x54a3`), though both return to state 14. Mirroring one into the other gets the exit pose wrong.

⚠️ **TWO CORRECTIONS to the table above, both found by reading the tails when wiring the states into the port** `[PROVEN]`. Decoding a handler's head and inferring its tail is exactly the shortcut this project keeps paying for:

**1. The jump pair's exit phases DIFFER — 20 leaves with 5, 21 with 6.**

```
CS:0x53F2  mov cl,5 / mov byte [0x377],9      state 20 -> state 9  with cl = 5
CS:0x52D5  mov cl,6 / mov byte [0x377],8      state 21 -> state 8  with cl = 6
```

The row above listed `5 / 5`, by mirroring. The bytes agree with this document's *own* separate finding about the jump handlers — state 8 (jump left) uses **6** as its catch-all airborne frame while state 9 (jump right) stores **5** in both arms — so handing state 8 a `cl` of 5 renders a frame that state never produces on its own. **A fourth asymmetry in a family that has one at every level.**

**2. The ladder pair's exit phase is CONDITIONAL, not a constant.**

```
546C  mov byte [0x377],0x0e     ; state 14, both
5471  mov cl,3                  ; 25 does `mov cl,1` at 0x54A3
5473  test byte [0x359],0x1
5478  jnz 0x547e                ; the saved entry phase is ODD  -> keep 3 (or 1)
547A  mov cl,[0x359]            ; the saved entry phase is EVEN -> restore it
547E  mov ax,[0x1b6] / mov [0x17c],ax    ; and restore Y
```

`DS:0x359` is written by the entry (`CS:0x55ED mov [0x359],cl`) — the same tick that nudges Y up 4 when that phase is even. So on an even entry the hero both moves *and* gets his climb position handed back untouched; the constant only applies on an odd one. Treating `exitCl` as unconditional loses the climb's animation position on half of all ladder shots.

#### The four ENTRY patterns — `UNKNOWN_fire_state_entry` CLOSED `[PROVEN]`

All four share a core, and each adds its own guard:

```
test byte [0x382],0x80 / jz  keepGoing      ; the fire bit
call 0x95ca / cmp ax,0 / jnz keepGoing      ; the allocator — 0 IS success
mov byte [0x377],<state>
```

| family | entry | extra guard |
|---|---|---|
| walk `CS:0x5ca8` | `cl = 0` | — |
| fall `CS:0x4c04` | `cl = 1`, **`[0x356] = 1`** | — |
| jump `CS:0x51cb` | `cl = 1`, **`[0x356] = 1`** | **two** arc guards straddling the allocator — see below |
| ladder `CS:0x55d6` | `cl = 0` | `cmp byte [0x378],0 / jz` — zero skips; **negative** takes the left variant. Saves Y into `[0x1b6]` (which the exit restores), stores `cl` into `[0x359]`, and nudges Y up 4 when `cl` is even |

⚠️ **The jump family has TWO guards, and they sit on opposite sides of the allocator** `[PROVEN]`. An earlier revision of this section named only the upper one, and the port then evaluated it *before* the allocator by analogy with the ladder:

```
51C4  cmp byte [0x358],0x4 / jl 0x51f5      ; LOWER guard — BEFORE the call
51CB  test byte [0x382],0x80 / jz 0x51f5
51D2  call 0x95ca                           ; <-- the allocator; SETS DS:0x351
51D5  cmp ax,0x0 / jnz 0x51f5
51DA  cmp byte [0x358],0x2c / jnl 0x51f5    ; UPPER guard — EIGHT BYTES PAST IT
51E1  mov byte [0x377],0x14                 ; state 20
51ED  add byte [0x358],0x2
```

Two consequences a port misses by reading only `0x51DA`:

1. **The cursor must also be ≥ 4** — the same `cmp [0x358],4` that gates horizontal motion during a jump. So firing is locked out at **both** ends of the arc, not just the end: the hero cannot shoot during the jump's 4-tick wind-up.
2. **A press late in a jump is CONSUMED.** Because the upper guard runs *after* `call 0x95ca`, the allocator has already set the latch `DS:0x351` before the rejection. The player must release and press again. Guarding first — which the ladder genuinely does, `0x55D6` preceding `0x55DF` — leaves the latch clear and lets the very next tick fire.

Both compares read `[0x358]` **before** the entry's own `add byte [0x358],0x2` at `0x51ED`, so they see the pre-advance cursor. `CS:0x4FC5`/`0x4FDB` are the byte-identical mirror in state 8.

#### `UNKNOWN_fire_state_356` — CLOSED: the entries are its writers `[PROVEN]`

`CS:0x4c20` and `CS:0x51e8` set `DS:0x356` to 1 as part of entering a fall or jump fire state. The handler then **decrements** the phase on that first tick instead of incrementing, and clears the flag. So with entry at `cl = 1` the sequence is **1, 0, 1, 2, 3** — a visible wind-up dip before the shot.

⚠️ **The fall and jump families therefore do NOT emit on their first tick**, even though their emit phase is 1: the shot lands on the *second* time the phase reads 1. Modelling the entry as `cl = 0` with a plain increment fires a tick early and loses the dip entirely.

**The fire chain is now complete end to end**: press → latch → allocate → enter a state → wind up → emit → spawn → move → stamp → scan → damage.

### Which states can fire a weapon — and the two that mean something else `[PROVEN, exhaustive]`

All **12** `call 0x95ca` sites in the image, mapped to states through the `DS:0xd818` dispatch table:

| site | state | | site | state |
|---|---|---|---|---|
| `0x4C0E` | 11 fall left | | `0x55DF` | the ladder-fire entry (right) |
| `0x4D10` | 12 fall right | | `0x5605` | the ladder-fire entry (left) |
| `0x4FD3` | 8 jump left | | `0x5839` | 14 ladder-from-stand |
| `0x51D2` | 9 jump right | | `0x585F` | 14 (the mirror) |
| `0x5A6B` | 0 walk left | | `0x5D5E` | 5 — the **chain** re-fire |
| `0x5CAF` | 1 walk right | | `0x5DA5` | 6 — the chain mirror |

⚠️ **The idle state cannot shoot, and neither can the crouch pair.** Both test the *same* fire bit and route it elsewhere:

```
state 26 (idle)   CS:0x49EA  test byte [0x382],0x80 / jz
                  CS:0x49F2  call 0x1045   -> mov si,0x8314 / mov cx,0xc8
                                              200 object records, stride 8
                             CS:0x1087      cmp byte [di+0x4],0x3 / jnz  <- CAT 3
                             CS:0x10C5      xor byte [si+0x4],0x1        <- TOGGLE
                                                                  -> LEVER/SWITCH
states 18/19      CS:0x4B27 / 0x4B9C       -> jmp 0x612F, which reads the
                                              4-slot inventory at DS:0x17e
                                              through the selector DS:0x366
                                                                  -> INVENTORY USE
```

So **fire means three different things depending on the hero's state**: shoot while moving, throw a switch while standing, use an item while crouching. A port that lets a stationary hero shoot has invented a control scheme — and one that doesn't know this will "fix" the missing shot.

⚠️ **CORRECTION — `CS:0x1045` is the LEVER toggle, not object pickup.** An earlier revision of this section (written one pass before the pickup path was traced) called it "the 200-record object-pickup walk", on the strength of the array walk and the `DS:0x2a4e` index alone. Reading the body through kills that: it keeps **only category 3** and ends in `xor byte [si+0x4],0x1`. Category 3 is levers/switches, and flipping bit 0 of the type is exactly the lever toggle this document records elsewhere (types 24/25 = lever off/on, 26/27 = switch off/on) — the two findings are the same mechanism seen from two directions. Four object types are special-cased out of the toggle (`cmp word [di],0x120 / 0x122 / 0x124 / 0xe8`, i.e. sprite ids 288/290/292/232, object types 118/120/122/62) and instead set `DS:0x20e` and clear `DS:0x3a2`.

**`UNKNOWN_lever_special_types` — CLOSED.** These four are still genuine category-3 lever/switch objects (confirmed by decompressing all four `POBJECTS.00{1-4}` and reading the actual records: type `{62,118,120,122}` — `{237,293,295,297}` under world 4's `+5` id drift — are category 3 in every world, but unlike the ordinary lever/switch pairs they carry **no name and no description** in any world). They aren't toggled instantly; touching one arms a **delayed, animated toggle**, consumed by the object-draw routine `FUN_1000_1d01`:

```
1D0E  cmp [0x3a2],0 / js 1d86         ; armed? (CS:0x10BA/0xBE set [0x20e]=the object, [0x3a2]=0 on touch)
1D15  is THIS drawn object's type one of the 4 special ones?
1D2D  si=[0x20e]                       ; the touched special-lever object
1D31  does its screen position match the object CURRENTLY being drawn?  (so only that one object animates)
1D46  si = 0xe01e + (world-1)*0xa      ; a per-world, 5-word animation-frame table
1D5B  si += [0x3a2]*2 ; cx=[si]        ; sprite for this phase
1D67  inc [0x3a2]
1D6B  cmp [0x3a2],3 / jnz 1d7a
1D72    si=[0x20e] ; xor [si+4],1      ; <-- THE ACTUAL STATE TOGGLE, at phase 3 of 5
1D7A  cmp [0x3a2],5 / jnz 1d86
1D81    [0x3a2] = 0xff                 ; done -> re-arm the entry gate for next time
1D86  draw with the phase's sprite
```

So these four are **lever/switch variants with a visible multi-frame swing animation** rather than an instant flip — the underlying `xor [si+4],1` toggle is identical to the ordinary lever mechanism, just fired mid-animation instead of on contact. Read live (DOSBox) the four worlds' tables at `DS:0xe01e` are **`{410,411,289,411,410}` / `{329,330,233,330,329}` / `{412,413,291,413,412}` / `{414,415,293,415,414}`** — and the middle (phase-2) sprite in each is *exactly* that world's own special type's sprite id **+1** (`289=288+1`, `233=232+1`, `291=290+1`, `293=292+1`) — i.e. the swing animation's peak frame is drawn as the object's own *toggled* sprite, landing precisely on the tick the state actually flips. A clean, fully self-consistent, cross-world-verified mechanism: a dramatic animated lever, not a plain one.

The distinction matters twice: **real pickup has no fire gate at all** (it happens on contact, `CS:0x177d`), and a port that binds pickup to the fire button makes half the map uncollectable while making levers operate by walking into them.

## Weapon pickup — how the hero arms himself `[PROVEN]`

Since `CS:0x914c` leaves all three slots at `0xFFFF`, this is the *only* way a weapon enters play.

**The contact test, `CS:0x177d`:**

```
177D  cmp word [0x19a],0 / js reject   ; the BAR, and STRICTLY negative
1787  cx = [0x17a] ; dx = [0x17c]      ; hero world position
178F  cx -= [0xa] ; dx -= [0xc]        ; -> hero SCREEN position
1799  add ax,0x8 / add bx,0x8          ; the OBJECT's screen position + 8
179F  sub cx,0x4  / 17A2 add di,0x24   ; the X window
17A5  cmp ax,cx / jl reject  /  17A9 cmp ax,di / jg reject
17AD  di = dx ; sub dx,4 ; add di,0x34 ; the Y window
17B5  cmp bx,dx / jl reject  /  17B9 cmp bx,di / jng ACCEPT
```

Both sides go to screen space and are then differenced, so the camera cancels. Folding the `+8` in gives an **inclusive window of `objX − heroX ∈ [−12, +28]`, `objY − heroY ∈ [−12, +44]`** — 40 × 56, wider than the hero's 32 × 48 body and reaching further below than above.

⚠️ The gate is `js`, i.e. **strictly** negative: a bar of exactly 0 still allows a pickup. That is the same shape as the damage guard and the *opposite* of the death test, which fires at `<= 0`. Three neighbouring reads of `DS:0x19a` with three different boundaries.

**The type split, `CS:0x17C7`:** `cmp cx,0xC0` — at or above, `jmp 0x1924` (the weapon path); below, the descriptor's **category** decides (`cmp byte [di+0x4],1`: `jg` rejects, `jz` → treasure at `0x184E`, else potions/consumables fall through at `0x17EE`).

⚠️ **A dead slot is `0xFFFF`, which is also `>= 0xC0`.** `CS:0x9000` tests the **sign** rather than comparing against `0xFFFF`, and a port that writes `type >= 0xC0` first matches every consumed or unused record — measured, **535** of them across the eight maps instead of the 55 real pickups, all sitting at `(0, 0)`, so a hero near the map origin collects seventy phantom weapons at once. Sign first.

**The weapon path, `CS:0x1924` → `CS:0x94a7`:** mark the object dead (`[si+4] = 0xFFFF`, `[si+6] = 0`), `weapon = type − 0xC0`, dispatch, then sfx `0x0638`. **There is no full-slots check** — `CS:0x17D0` is the only reference to `CS:0x1924` and it jumps there unconditionally, which is safe because the selector always yields a slot.

⚠️ **The two outcomes are different events.** Already holding it → `CS:0x94E8 inc word [di+0x8]` only: the count rises (so volley *and* per-hit damage rise) and the projectile area is untouched. A **new** weapon instead re-bases the count to Power (`CS:0x90F9`) and **clears that slot's 144 bytes** (`CS:0x9177`) — swapping weapons destroys your shots in flight. That clear is also why pickup must run at `CS:0x0206`, *before* the projectile step at `CS:0x020F`: run it after and a weapon you no longer hold gets one more move and one more stamp.

**The slot selector, `CS:0x953e`:**

| order | rule | site |
|---|---|---|
| 1 | weapon **2 (fireball) is hard-wired to slot C**, and the same write sets `DS:0x340 = 0x12` | `0x954F`, `0x95AE` |
| 2 | the new weapon's **`+0x00 == 0` → slot A** | `0x9554` → `0x95A2` |
| 3 | slot B empty (negative) → B | `0x9559` |
| 4 | slot C empty → C | `0x9560` |
| 5 | both full → replace whichever of B/C has the **lower** `+0x08`; `jl` is strict, so a **tie keeps B and replaces C** | `0x9580`–`0x9596` |

Rule 1 explains itself: `DS:0x340` is the tag base the fireball's mover subtracts at `CS:0x9DC2` to get a per-projectile index, and slot C's tags are 19–27, so `0x12` is right only if the fireball is in slot C. Pinning the weapon to the slot is what makes that constant safe.

**`+0x00` is genuine file data, not a pinned field** — the loader's save/restore pairs read displacement `+0x0c`/`+0x1e` (`CS:0x35b7`/`0x35d0`) and `+0x08` (`CS:0x367a`), never 0. Measured across **all four** files it reads `0/1/1/1/1/0/0/0/1/1/0`, byte-identical in every world — so unlike `+0x08`, which diverges in `.003` and `.004`, the slot rule does not drift. Slot A is reserved for **knife, throwing star, spear, axe, mace**.

**Re-derived from the shipped bytes:** the eight maps place **3/4/0/2/7/2/14/23 = 55** weapon pickups — matching the figure this document recorded from a different tool. Note `PLEV2A` places **none at all**.

### Consumables (category 0) — the handler index is a RANK, not the type `[PROVEN]`

The category-0 branch at `CS:0x17EE` marks the object dead, then computes an index by **counting on the spot**:

```
1801  ax = cx                       ; the object type
1804  si = 0xef78                   ; the 132-byte category table
1807  bx = 0 ; dx = bx
180B  or cx,cx / jz 0x1818          ; type 0 -> rank 0 (and `loop` at cx=0
180F  cmp bl,[si] / jnz / inc dl    ;   would otherwise run 65536 times)
1815  inc si / loop 0x180f          ; count the category-0 entries, types 0..type-1
1818  shl dx,1
1822  si = 0xd8b8 + dx / si = [si] / call si
```

So `DS:0xd8b8` is indexed by the type's **rank among category-0 types**, counted **strictly below** it — a dense re-index, not the type. Two independent facts pin the width: the shipped category table has exactly **23** zero entries, and the table at `DS:0xd8b8` holds exactly **23** plausible code offsets before running into unrelated data (`0x50, 0x50, 0x50, 0x50, 0x05, 0x4f, …`).

### All 23 decoded — `UNKNOWN_consumable_handlers` CLOSED `[PROVEN]`

Every one is confirmed by its own `POBJECTS` text. That is what makes the set checkable: nothing about a handler address says what it should do, and the 48-byte record carries a 16-byte name and a 24-byte description for every type.

| rank | type | handler | name / description | effect | placed |
|---|---|---|---|---|---|
| 0 | 0 | `0x6327` | health / restores energy | **+12 health** | 15 |
| 1 | 2 | `0x62da` | power potion / increases weapon power | `0x9426` **+1 pickup count on ALL three weapons**, then `0x94f5` | 4 |
| 2 | 3 | `0x62d7` | power potion (12000) | enters one instruction above rank 1 → calls `0x9426` **twice** | 2 |
| 3 | 35 | `0x6350` | health / restores energy | **+24 health** | 18 |
| 4 | 36 | `0x61f7` | starburst | `0xa461` at (heroX+8, heroY+32) — an 80-slot particle array at `DS:0x8cfa` | 5 |
| 5 | 37 | `0x62bf` | shield / **reduces damage** | `[0x34c] = 1` — **and nothing reads it. A shipped no-op.** | 3 |
| 6 | 38 | `0x62c8` | shield / invulnerabilty | `0xa90b`: `[0x19c] = 255`, `[0x172] = 1` | 5 |
| 7 | 39 | `0x61cf` | familiar | `0xc2f6` — summon, or +1000 energy and +1 power | **0** |
| 8 | 40 | `0x61d6` | magic wings / effects familiar | `inc [0x304]`, then the same | **0** |
| 9 | 41 | `0x61df` | power claws / effects familiar | `[0x210] += 2`, then the same | **0** |
| 10 | 42 | `0x62ec` | extra life | sfx `0x6416`, `inc word [0x224]` (lives), display dirty | 10 |
| 11 | 43 | `0x5e9b` | magic potion / slows monsters | ⚠️ **no handler — see below** | **0** |
| 12 | 44 | `0x620d` | magic potion / freezes aliens | `[0x2fa] = 0xAA` | **0** |
| 13 | 47 | `0x62b5` | magic potion / giant jump | `[0x174] = 0x154` | 3 |
| 14 | 51 | `0x95b5` | weapon arc / standard | copy `SS:0x3612` → `DS:0xdf0e` | 10 |
| 15 | 52 | `0x62a1` | weapon arc / intense | copy `SS:0x362a` | 5 |
| 16 | 53 | `0x62ab` | weapon arc / wide | copy `SS:0x3642` | 4 |
| 17 | 54 | `0x6217` | teleport stone | sets `[0x370]`, `[0x3a8]`, `[0x22e]` | 14 |
| 18 | 69 | `0x63d5` | tablet / reveals clues | the `PALFILS` hint system, already documented | 46 |
| 19 | 70 | `0x6306` | food / restores energy | **+2 health** | **0** |
| 20 | 71 | `0x6393` | food / restores energy | **+4 health** | **0** |
| 21 | 72 | `0x63b4` | food / restores energy | **+3 health** | 4 |
| 22 | 83 | `0x61e9` | shop potion / summons the shopkeeper | `[0x363] = 0x41`, `[0x375] = 0`; **returns `dx = 2`** | 8 |

⚠️ **SEVEN OF THE 23 TYPES ARE PLACED ZERO TIMES** across all eight maps — 39, 40, 41, 43, 44, 70, 71. **Decoded is not the same as reachable**, and that includes the *entire* familiar chain.

**The earlier "ranks 11 and 14 point into unrelated routines" flag resolved two different ways.** Rank 14's `0x95b5` is `mov si,0x3612 / call 0x95bc / ret` — the default-argument entry of the arc copier, i.e. the potion that puts the **standard** arc back. Rank 11's `0x5e9b` really is the player state machine's epilogue, and that is the finding — see below.

#### The return value is a MESSAGE TIER, not a success flag `[PROVEN]`

```
182D  or dx,dx / jz 0x183c        ; 0   -> no message at all
1831  dec dx   / jz 0x1839        ; 1   -> show the message
1834  mov byte [0x394],0          ; >=2 -> clear DS:0x394 first
1839  call 0x4609                 ;        then show it
```

21 handlers return 1; only the shop potion returns 2. A refusal returns 1 as well, so the caller cannot tell it from a success.

#### The three weapon arcs — the sharpest confirmation in the set `[PROVEN]`

All three potions call the same copier `CS:0x95BC` (`di = 0xdf0e / mov cx,0xc / ss lodsw / stosw`), which **overwrites** the six-entry projectile velocity table this document already records at `DS:0xdf0e`. They differ only in the source, and the three sources are adjacent 24-byte tables (`0x3612 + 0x18 + 0x18`):

| potion | `SS` | dirs `{vx, vy}` |
|---|---|---|
| **standard** | `0x3612` | `(±12, ∓3 / 0 / ±3)` — what the game boots with |
| **intense** | `0x362a` | `(±12, ∓1 / 0 / ±1)` — a tight bundle |
| **wide** | `0x3642` | `(±10, ∓10 / 0 / ±10)` — a broad fan, and slower in X |

Y-spreads of **3 / 1 / 10** against descriptions **standard / intense / wide**. Nothing about the addresses says which is which; the numbers do.

#### ⚠️ Invulnerability: the potion and the spawn share a helper and differ by 170 frames `[PROVEN]`

`CS:0xA90B` sets `[0x19c] = 255`, seeds four aura phase offsets at `DS:0x1d8`, and sets `[0x172] = 1` — the flag the damage gate `0xACCC` reads. `[0x19c]` is decremented once per frame at `0xA99B` (from the per-frame call at `CS:0x026F`), clearing `[0x172]` at zero.

**But `CS:0x085D` — inside the level-start/respawn block that also sets health target 24 and bar 1 — calls the same helper and then immediately does `sub word [0x19c],0xaa`.** So a spawn gets `255 − 170 = 85` frames and the potion gets the full 255: at 15 Hz, **5.7 s of spawn protection against 17 s of shield**. Reading `0xA90B` alone and not chasing the `sub` puts a confidently wrong 17 s on both.

And this is not purely defensive — `0xACCC`'s `jnz` skips only the health subtraction, so while `[0x172]` is set **the hero takes no damage and still kills everything he touches**.

#### Two handlers land on globals this document already knew from the other side `[PROVEN]`

- **`[0x2fa] = 0xAA`** (type 44, *"freezes aliens"*) — decremented once per frame at `CS:0x0186`, floored at `0x018C`, and read by **eighteen** sites including `0xEDB8`, the System-B movement gate recorded here long before this handler was decoded, plus `0xAD8D`/`0xAE53` in System A. 170 frames = **11.3 s**, both entity systems.
- **`[0x174] = 0x154`** (type 47, *"giant jump"*) — `CS:0x4F6F` subtracts each of the 23 arc deltas from Y **twice** while that word is set. This document recorded the doubling as *"the double-jump power-up word"* without knowing what set it. 340 frames = **22.7 s**.

#### ⚠️ *"shield … reduces damage"* is a shipped no-op `[STATIC, exhaustive]`

`CS:0x62BF` is `mov byte [0x34c],1` — and **nothing reads `DS:0x34c`.** Held to the `.DAT` word2 standard, not the weaker base-address one:

- the immediate `4C 03` occurs **four** times across all twelve shipped binaries, and every one is `C6 06 4C 03 imm` — a byte write (`0x62BF` and `0xC57B` set 1, `0x656E` and `0x8E11` clear);
- a **word** access based one byte low would read `0x34c` as its high half and encode `4B 03`. That pair occurs four times too, and all four are again byte writes, to the neighbouring `0x34b`.

Neither alignment yields a reader anywhere. The only remaining escape is an address computed into a register rather than encoded. **Three of these ship across the eight maps and none of them reduces any damage.**

#### ⚠️ *"slows monsters"* has no handler at all `[PROVEN]`

Rank 11's table word is `0x5e9b`, the **player state machine's epilogue**. Calling it from the object walk runs a spurious phase store, event probe, camera update, sprite selection and hero draw, then returns. Two facts make *cut item* the reading rather than *undecoded effect*: type 43 is placed in **zero** maps, and **the epilogue never sets `DX`** — which `CS:0x182D` reads to pick the message tier. All 22 other handlers set it.

#### The teleport stone `[PROVEN]`

`CS:0x6217` sets three variables: `[0x370] = 1` ("a teleport is pending", consumed by the per-frame check at `CS:0x0324`), `[0x3a8] = 1` (the kind), and `[0x22e]` = the destination packed as `(col << 8) | row`. `CS:0x0FDF` unpacks exactly that — `bl = al` (row), `al = ah`, `shl ax,5` (col × 32).

The destination comes from the **30-record `{key, x, y}` table at `DS:0xa778`** — the `PALFILS +0x1770` window this document had recorded only as "a lookup at `0x6241`" — searched by a key read through `DS:0x20a`, with world 2 sublevel `'a'` and hero x in `[0x5c0, 0x640]` hard-coded to `0x202e`. ⚠️ **The same three variables are written by the ACT3 teleport-zone trigger at `CS:0x4AA5`**, which is what confirms the meaning: the stone and the zone are one mechanism reached two ways.

⚠️ **CORRECTION — the potion gate is `bar < 0`, not `bar == 0`.** This document recorded *"each gated on `cmp word [0x19a],0` — a potion does nothing while the bar reads zero"*. Every site is `cmp word [0x19a],0 / **jns** <effect>`, so it proceeds while the bar is **non-negative** and refuses only once it has gone negative. **A potion still works at a bar of exactly zero.** That is the same non-strict shape as the damage guard and the pickup gate, and the opposite of the death test which fires at `<= 0` — four reads of `DS:0x19a`, three different boundaries.

⚠️ **The 24 cap is a CONVERSION, not a clamp.** Overflow falls through to `CS:0x6377`:

```
6377  sub ax,0x18            ; ax is the PRE-clamp target
637A  shl ax,1  (x5)         ; excess * 32
6384  cmp word [0x168],0 / js 0x638f
638B  add [0x168],ax         ; banked — unless [0x168] is negative
```

⚠️ **But the bank has a gate, and in shipped play it never opens.** `0x6384`'s `js` skips the credit whenever `[0x168]` is **negative** — and `UNKNOWN_DS_0168` is now **CLOSED: it is the FAMILIAR'S ENERGY.** All the behaviours line up: 1000 on summon (`0xC347`), +1000 for a second potion (`0xC2FD`), drained by damage (`0xAB4D`), −1 when it dies or is dismissed (`0xC470`). `0xC440` is the dismiss, and its callers are `CS:0x047D` and `CS:0x8DDF` — **the two full restarts** — so the value is −1 from the start. The only thing that lifts it is a *"familiar"* potion, **type 39, placed zero times in all eight maps**.

So the banking is real code that no shipped level can reach: **over-healing is discarded.** An earlier revision of this document (and of the port) stated the banking as what over-healing does; that was reading the arithmetic without its guard. The `0x9129` hunter-target-list gate fits the same reading — the list is built while a familiar is alive **or** a hunter is held, because a live familiar needs targets for the same reason the hunter does. **`[0x168]` is not the shop total** — that is `DS:0x194`.

⚠️ **The object is marked dead BEFORE the handler runs** (`0x17F6` precedes `0x1829`), and the refuse path returns the same `dx = 1` as success (`0x6209` against `0x638F`). So **a potion taken at negative health is still consumed** and still shows its message, and the caller cannot tell the two apart.

**Treasure (category 1) is a different mechanism**, not more of this one — see the next section. `UNKNOWN_treasure_pickup` is **CLOSED**.

## Destructible blocks — `UNKNOWN_destructible_tile` CLOSED `[PROVEN]`

This is the mechanism behind *"maces break blocks"* — and it **vindicates** this document's earlier correction rather than reopening it. `PWEAPONS +0x48` really is *"stopped by terrain"*; the mace's advantage is a **`+50` at `CS:0x74AF`**, in a different routine reached through a different call.

### The trigger, and a world gate the data confirms

```
A7EF  cmp byte [ds:bp+0],1 / jnz         ; the cell must be SOLID
A800  cmp byte [di],0x6d / jnz 0xa816    ; plane A must read 0x6d
A806  cmp byte [0x42],3 / jl  0xa816     ; and the world must be >= 3
A810  call 0x73ec                        ; si = the WEAPON record, bp = plane-B cell
```

⚠️ **The world gate matches the shipped maps exactly.** Tile `0x6d` appears in every level, but its plane-B solidity does not:

| | cells | solid |
|---|---|---|
| `PLEV1A` / `1B` | 6 / 6 | **0** |
| `PLEV2A` / `2B` | 11 / 14 | **0** |
| `PLEV3A` / `3B` | 15 / 8 | **all** |
| `PLEV4A` / `4B` | 120 / 103 | **all** |

**246 of 246 solid across worlds 3–4, against 0 of 37 across worlds 1–2.** The authors used `0x6d` decoratively early and as breakable masonry late.

### The queue, `DS:0xd0c6` — 40 × 6 bytes

`{u16 worldX, u16 worldY, i16 hp}`, free when X is negative, cleared by `CS:0x74CD` (`mov cx,0x78 / rep stosw` = 240 bytes = 40 × 6 exactly). Coordinates are **reconstructed from the plane-B pointer**, not passed in: `col = (bp−0x5004) & 0x7f`, `row = ((bp−0x5004) & 0xff80) >> 7`, then `×32` and `×16`.

⚠️ Note `shr` in the append (`0x741F`) against `sar` in the removal (`0x7574`) for the same quantity. Both operands are non-negative, so they agree — recorded because a reader diffing the two will wonder.

### The damage — `CS:0x743E`, and the mace's +50

```
7481  pop dx / 7482 xchg dx,si       ; si = the WEAPON record
7484  mov ax,[si+8]                  ; its PICKUP COUNT = its damage
7487  xchg dx,si                     ; si = the QUEUE record again
7489  DS:0x33f picks which slot fired -> bx = that weapon index
74AA  cmp bl,0xa / jnz / 74AF add ax,0x32     ; <-- THE MACE BONUS, +50
74B2  sub [si+4],ax                           ; hp -= damage
74B5  cmp word [si+4],0xff38 / jl / 74C2 mov word [si+4],0   ; < -200 -> ZERO
74BE  pop ax / jmp 0x7439            ; DISCARD the return address and unwind
                                     ; out of 0x73EC, skipping the append
```

⚠️ **The two `xchg`es cancel**, so `0x74B2` lands on the *queue* record. Corroborated at the use site: the updater reads `[si+4]` with `si` walking `0xd0c6` at stride 6. Read one `xchg` and not the other and the subtract lands on `PWEAPONS +0x04`, the projectile animation frame.

⚠️ **hp counts DOWN from −1 and "breaking" is hp ≥ 0**, so a block absorbs **200 cumulative damage**. And ⚠️ **the first shot does none** — `0x73EC` calls `0x743E` *before* appending, so on an unqueued cell the scan finds nothing and the first hit only creates the record.

Only the six weapons whose `+0x48` **byte** is nonzero ever reach this path:

| weapon | dmg/hit | shots to break |
|---|---|---|
| **mace** | 3 + 50 = **53** | **5** |
| time bomb | 20 | 11 |
| fireball | 5 | 41 |
| flame | 4 | 51 |
| throwing star | 2 | 101 |
| knife | 1 | 201 |

⚠️ `+0x48` is a **byte** (`cmp byte [si+0x48],0`). Read as a big-endian `u16` it picks up `+0x49`, and the hunter and magic axe wrongly appear to collide — a mistake made and caught while porting this.

⚠️ **Shooting an already-breaking block queues a DUPLICATE.** `0x746E` requires the matched record's hp to be **negative** before applying damage; once breaking, hp is a frame index, so the scan finds no match and `0x73EC` appends a second record for the same cell.

### The break, the restore, and both capacity quirks

`CS:0x7500` is `C3` (RET), **patched to `0x90` by `CS:0x7433`** when the first block is queued — the same self-modifying enable the player state machine's `[cs:0x71d]` gate uses — and re-disabled at `0x7508` when `[0x3c0]` reaches 0. It is called at **`CS:0x01DF`**, before the mode dispatch and so before the object pass, the projectiles and the player.

Four frames advancing on **every other frame** (`DS:0x36c`, toggled by `not` at `CS:0x0172`) — about **0.53 s** at 15 Hz. ⚠️ `DS:0x158`, the sprite base, is **read once and written nowhere** in any of the eight binaries at either alignment, so it is 0 and the drawn sprite is the frame index itself. A port reproducing that is reproducing an **uninitialised read**, exactly as the plane-A out-of-range note does.

`CS:0x7566` then appends the plane-B pointer to a **100 × 4-byte restore list at `SS:0x46b0`** — ⚠️ **`SS`, not `DS`**, on two independent counts: every access is `[bp+0]`, which defaults to `SS`, and the clear at `0x75E1` does `push ss / pop es` — and writes **plane B = 0** (passable) and **plane A = 1**. ⚠️ **Plane A becomes 1, not 0**: under the proven 1-based rule that is tile index 0, not "empty".

| quirk | site | effect |
|---|---|---|
| queue full (40) | `0x7403` | the hit is dropped silently |
| restore list full (100) | `0x759A` | returns **before touching either plane** — the block finishes its animation, frees its queue slot, and **stays solid**. `PLEV4A` has 120 destructible cells against 100 entries, so this is reachable in shipped data |

`CS:0x74DB` is the restore — plane A `0x6d`, plane B `1` — and its two callers (`CS:0x69B1`, `CS:0x8E40`) each follow it immediately with the queue clear. **Broken blocks come back on level load or restart.**

### `UNKNOWN_block_breaker_8bca` — CLOSED: the `DS:0xcfcc` falling hazard `[PROVEN]`

⚠️ **And closing it corrected a claim made in this document one pass earlier.** That pass said the second block-breaker was the *debris* array `DS:0x8b4c`. It is not, and the reason is exactly the failure this document's own rule — *"resolve the segment FIRST; a `DS` offset read as `1000:<off>` returns unrelated code bytes"* — exists to prevent:

```
CS:0x8b4a   2E C6 06 56 8B C3    mov byte [cs:0x8b56],0xc3
                     ^^^^^ an IMMEDIATE inside that instruction; CS:0x8b4c is
                           its modrm byte, mid-instruction, not an array
CS:0x8b57   BE CC CF             mov si,0xcfcc     <- the walker's REAL base
```

`CS:0x8b4a` is a **self-modifying gate** that writes `RET` at `CS:0x8b56`. The walker that reaches `0x8BCA` starts at `CS:0x8b57` and walks **`DS:0xcfcc`, ten records of ten bytes** (`0x8B5A cx=0xa`, `0x8C1C add si,0xa`) — a system this document already mentions in passing as *"`0x8687` (a 10-slot system at `DS:0xcfcc`)"*. `DS:0x8b4c` is a different array entirely, and it is **inert** (see below).

**The hazard falls, breaks blocks, and touches the hero once:**

```
8B6D  dx = [si+6] ; bx = [si+2] ; bx += dx ; [si+2] = bx    ; y += vy
8B78  cmp byte [0x36d],0 / jnz 0x8b8d
8B7F  inc word [si+6] / cmp word [si+6],0x10 / jng / mov 0x10   ; gravity, cap 16
8B8D  di = 0x3004                                    ; PLANE A
8B92  col = ((X + 5) & 0xffe0) >> 5                  ; FLOORED on X+5
8BA4  row = (Y & 0xfff0) << 3
8BB1  add di,0x100                                   ; = 2 TILE ROWS DOWN
8BB5  cmp byte [di],0x6d / jnz 0x8bcd
8BBA  mov word [si+0x8],0xfa                         ; damage 250, into ITS OWN record
8BBF  mov byte [0x33f],0
8BC4  add di,0x2000 / mov bp,di / 8BCA call 0x73ec
8BCD  [0x1e2] = 5 ; [0x1e4] = 0x10                   ; a 5 x 16 box
8BD9  mov bp,[si+0x4]                                ; ⚠️ DEAD — overwritten
8BDF  mov bp,3 / call 0xac59
8BE5  or bp,bp / jns / 8BE9 mov word [si],0xffff     ; a reported hit FREES it
```

⚠️ **No solidity check and no world gate on this path.** `0x8B57`–`0x8BCA` contains no plane-B read and no reference to `DS:0x42` — the `cmp byte [0x42],3` belongs to the *projectile* caller at `0xA806`, and `CS:0x73EC` itself has no world test. The hazard tests one plane-A byte and nothing else, so it **falls through solid geometry**.

⚠️ **The probe is two tile rows below the hazard's own row** (`+0x100 / 128 = 2`), and the column is floored on `X + 5` rather than rounded. `UNKNOWN_hazard_probe_lookahead` — why two rows is not established.

⚠️ **`CS:0x8BD9` is a dead load**, overwritten by `mov bp,3` two instructions later. It reads like a per-record strength that was hard-coded and never removed.

### ⚠️ Two corrections to the destructible-block section above `[PROVEN]`

**1. `CS:0x7484` is POLYMORPHIC, and `DS:0x33f` is NOT the damage source.** That section said *"`0x7489` DS:0x33f picks which slot fired → bx = that weapon index"* and described `[si+8]` as "the weapon's pickup count". The two reads are independent:

```
7484  mov ax,[si+0x8]     ; THE DAMAGE — +0x08 of whatever struct the CALLER
                          ; of CS:0x73EC held in SI
7489  DS:0x33f 0/1/2 -> bx = [0xdd10] / [0xdda2] / [0xde34]
74AA  cmp bl,0x0a         ; BX's ONLY consumer, image-wide
74AF  add ax,0x32
```

So `DS:0x33f` selects which **slot is tested for holding weapon 10**, and nothing else. On the projectile path the two coincide — `SI` is the `PWEAPONS` record (pinned by `0xA7B7` reading `[si+0x48]` through the same `SI`), so `[si+8]` *is* that weapon's pickup count and `DS:0x33f` *is* the slot that fired it. The equivalence breaks on the hazard, which supplies its **own 250** at `0x8BBA` and forces `DS:0x33f = 0` purely to test slot A. (`0x8BBF` never restores it; benign, because `CS:0x9455` rewrites it before every `call 0x9477`.)

**2. On the hazard path the mace bonus is behaviourally inert.** HP seeds at −1 and the first damaging touch applies 250 → −251, already past the −200 threshold, so the clamp trips whether the value was 250 or 300. **Two touches destroy a block either way** — one to enqueue, one to damage.

### `UNKNOWN_hazard_emitter_placement` — CLOSED: the hazard is CUT CONTENT `[PROVEN]`

The emitter is reached only through the **per-world sprite-class tables at `DS:0xdf80`** — four worlds × **two** tables of six 12-byte records `{u16 spriteBase, u16 (always 1), u16 handlerA, u16 w, u16 h, u16 handlerB}`, with an all-`0xFFFF` record meaning an empty class slot. `call 0xbd38` and `call 0xbd0b` occur **zero** times image-wide, so there is no other way in.

**Which table belongs to which entity system is proven by an invariant, not assumed.** Across all 8 `PALFILS` files, every class index a descriptor uses (`+0x07`) lands on a **non-empty** record under the binding *table 0 = System A (`+0x0D58`), table 1 = System B (`+0x11A4`)*. It is discriminating because it fails the other way round: World 2's System-B descriptors use **class 4**, and only table 1 has a class 4 in world 2 — table 0's is `0xFFFF`.

| | table 0 = **System A** | table 1 = **System B** |
|---|---|---|
| handler family | `0xbc4b` | `0xb03c` / `0xb670` |
| world 1 classes used | 0, 2 | 0, 1 |
| world 2 | 0, 2 | 1, **4** |
| world 3 | 0, 1, 2 | 0, 2 |
| world 4 | **0 only** | 0, 2 |

**The hazard is world 4 / System A / class 3** (`DS:0xe23e`) — the only record in any of the eight tables carrying the handler pair `0xbd38`/`0xbd0b`, and its sprite base `0x213` = 531 matches `CS:0xBD68`'s `add bp,0x213` exactly. **System A in world 4 uses class 0 and nothing else**, in both `PALFILS.0A4` and `.0B4`.

⚠️ **So nothing instantiates it.** And the pattern of empty slots across the eight tables is the signature of a built-then-unplaced feature rather than an unbuilt one. There are **exactly four `0xFFFF` records in all 48**, and **all four are System A** — System B has no holes at all:

```
w1 sysA class 3     w2 sysA class 4     w3 sysA class 3     w4 sysA class 4
```

The hole **moves**: class 3 in worlds 1 and 3, class 4 in worlds 2 and 4. So System-A class 3 is *empty* in worlds 1 and 3, *populated* in worlds 2 and 4 — and **used in none of the four**. World 4's populated-but-unused class 3 is the hazard.

**This is the fourth cut feature in the game**, after the `flame` weapon (null spawn *and* mover handlers), the iron chest (six keys ship for a chest placed nowhere) and the entire familiar chain (three potions, none placed).

⚠️ The earlier suspicion that "the descriptor window may be wrong" is **refuted**: the window is right, and the all-zero world-4 result is the finding. `0A1`/`0B1` and `0A4`/`0B4` agree while `0A2`/`0B2` and `0A3`/`0B3` differ, which is what a correct window over real level data looks like.

⚠️ **Correction, found while chasing an unrelated enemy-shot emitter pair (`CS:0xBDC5`/`0xBDD6`, see *The five other emitter-pair owners* below).** "Table 0 = System A" / "table 1 = System B" describes correctly which *pointer* (`DS:0x1fe` vs `DS:0x1fc`, `CS:0xAD62`'s own loader) each table hangs off — but it does **not** mean these tables are read by the System-A/System-B *roaming-entity* pipelines this document documents elsewhere (`CS:0xe001` / `CS:0xed15`). World 4's own class 2 — the record immediately before the cut hazard at class 3, same table, `DS:0xe23e − 0x16` — is live, placed, and fully traced this pass: its `handlerA`/`handlerB` pair (`0xbddb`/`0xbd71`) is reached exclusively through the **selector-1 `PGOD0x.PAT` spawn system** (`DS:0xb6b8` group slot → `DS:0xb744` sub-record, walked by `CS:0xb987`), which merely *looks up* this per-world class table via the same `[0x1fe]` pointer System A's own `CS:0xe199` resolver uses — it is a second, independent consumer, not the entity array itself. Since class 3 (the hazard) sits in the identical table, reached the identical way, **its own would-be runtime consumer is almost certainly this same selector-1/PAT mechanism, not a bare System-A entity record** — consistent with, and a plausible explanation for, why it was never wired to any placed object: nothing in any shipped `PGOD0x.PAT` file's directory points a class at index 3. `handler family: 0xbc4b` in the table above is table 0's *default* `handlerB` (11 of 14 live entries across all four worlds) — a generic "fire a shot in the direction I last moved" behaviour, not a fixed per-table constant; see below for what it and its System-B counterpart (`0xb03c`/`0xb670`) actually do.

### `UNKNOWN_b1c2` — CLOSED: three more dead hazard systems sharing the same cut sprite `[PROVEN]`

`FUN_1000_b1c2` (real entry `1000:b1c1`, a one-byte falling-through prologue) is a **10-slot × 8-byte array walker at `DS:0xaccc`**: `{i16 worldX, i16 worldY, u16 type(0..3), i16 lifetime}`. A record is free when `worldX` is negative. Per live record it drifts `worldY += 2` each tick unless a ground probe (`CALL 0x1000:b27f` → `0x1000:37b3`, the same `0x5004 + (X>>5) + (Y<<3)` plane-B formula used everywhere else in this document) finds a solid cell immediately below, in which case the increment is reverted (net 0 — the piece has landed and stops sinking). The `type` field cycles `0..3` on the shared every-other-frame toggle (`DS:0x36c`) and indexes a **4-entry sprite table at `DS:0xdf44`**, read live: **`531, 532, 533, 532`** — a small wobble/settle loop, not a monotonic run. It draws via the shared export-2 masked blitter (`CALL 0x1000:356e`) and, every tick, calls **`CS:0xdb4e`** — the same shared hero-hit-and-damage helper the `DS:0xd2be` Bresenham line-hazard pool uses (see *A sixth system: `DS:0xd2be`*) — with `BP` = the record pointer. A lifetime counter (`w3`) counts down; at negative it frees the slot. The three call sites this document already had on record (`CS:0x022D`, `0x0a02`, `0x929b`) are exactly the main loop, the death/respawn reset chain, and the attract-mode mirror — confirmed via `get_xrefs_to`, matching what was already written.

**The base sprite 531 = `0x213` is the same constant already established for the world-4/System-A/class-3 cut hazard** (`CS:0xBD68`'s `add bp,0x213`, immediately above) — not a coincidence: `FUN_1000_b1c2` is a *third*, independent piece of that same never-shipped "falling rock" content, not a new, unrelated feature.

**And it, along with two siblings, is provably unreachable — closing the question further than "what does it do."** `DS:0xaccc` has exactly two writers in the whole image: `FUN_1000_b1c2` itself (updating fields of an *already-live* record) and `FUN_1000_b263` (the level-init clear, called once from `FUN_1000_8c34`, which stamps every one of the 10 slots dead — `{0xFFFF, 0, 0, 0}` — and zeroes the "any active" flag `DS:0x1f8`). `DS:0x1f8` itself has exactly three references total: the entry gate's read, `FUN_1000_b1c2`'s own end-of-pass write-back (which can only ever report what it just walked), and `FUN_1000_b263`'s force-to-zero. **No code anywhere ever writes a live record into `DS:0xaccc` or sets `DS:0x1f8` from outside this closed loop** — an exhaustive operand search for both addresses across the whole program (`search_instructions`, 15,000+ instructions scanned) turns up nothing else. The array is permanently empty; the walker runs every frame, forever, and does nothing.

**Two structurally identical siblings, found chasing the same call site, are the same story with a self-modifying twist.** `CS:0x0230`/`0x0233` (right after `b1c2` in the main loop) call `FUN_1000_b3ce` (12 slots, `DS:0xad1c`, stride 10) and `FUN_1000_b4e7` (30 slots, `DS:0xad94`, stride 10 — the two arrays are contiguous, `0xad1c + 12*10 = 0xad94` exactly). Both open with a literal `RET` (`0xC3`) as their **first byte** — a self-modifying gate, disabled by default — and both are considerably more developed than `b1c2`: real physics (`vy` grows every other frame = gravity, `vx` decays toward 0 = drag), the same plane-B ground probe, a **5×5 hero-hit test via `CALL 0x1000:ac59`** (the actual hero-contact box test, not just `db4e`), a cull rectangle (screen `X∈(−16,352)`, `Y∈(−16,192)`), sprite = `(type field) + 0x213` directly (so sprites 531–534, the same range `b1c2`'s own table draws from), and — on a successful hit — a **moving debris spark via `CALL 0x1000:a633`** carrying the particle's own current velocity (the identical mechanism the magic axe's expiry debris uses). Each walker **self-disarms** once its own slot count empties (`cmp [0x1fa],0 / jnz keep-running`, else re-write its own entry byte back to `0xC3`).

**The only code that ever writes a *non-RET* byte to either gate is `FUN_1000_b3b2` — and it writes `RET`, not `NOP`.** `FUN_1000_b3b2` (called once, from `FUN_1000_8c34`, the level-init routine, alongside `b263`) clears all 42 records across both arrays in one pass (`CX=0x2a`, stride 10, starting at `0xad1c`) and then explicitly force-disables **both** gates (`MOV AL,0xC3` / `MOV CS:[0xb3ce],AL` / `MOV CS:[0xb4e7],AL`). An exhaustive operand search for `0xb3ce` and `0xb4e7` across the whole program finds exactly one write to each — this same disabling pair — and no enabling write (`0x90`) anywhere. So, exactly like `b1c2`'s array: **`b3ce` and `b4e7` are called every frame, hit the `RET` at their own first byte instantly, and can never do anything in the shipped game**, because nothing ever arms them and nothing ever seeds a live record even if they were armed.

**Net finding: this is the sixth identified cut feature in the project** (after the `flame` weapon, the iron chest, the familiar potion chain, the world-4/System-A/class-3 environmental hazard, and the dead damage-grid tag `0xFD`) — a small family of three "falling rock/rubble" particle systems (a settle/idle variant at `DS:0xaccc`, and two burst-with-physics variants at `DS:0xad1c`/`DS:0xad94`) built with full collision, damage, and debris-on-hit behaviour, sharing sprite atlas slot `531` with the already-documented unplaced environmental hazard, and never wired to any spawn trigger, descriptor, or scripted-sequence entry point in the shipped release.

### `UNKNOWN_cfcc_pool_sharing` — one pool, two tenants `[PROVEN]`

`DS:0xcfcc`'s ten 10-byte slots are shared by **two independent subsystems**, each with its own first-fit allocator, its own walker, and its own self-modifying enable gate:

| allocator | arms | walker | disarm | role |
|---|---|---|---|---|
| `CS:0x8B0E` (`x += 11`) | `[cs:0x8b56] = 0x90` | `CS:0x8B57` | `CS:0x8B4A` | the falling hazard — **CUT** |
| `CS:0x8619` (`x += 3`, `y −= 0x18`, **STC on failure**) | `[cs:0x8687]` | `CS:0x8688` | `CS:0x8681` | the **world-2 nest creature** — *placed 32 times*; see below |

They read `+0x04`/`+0x06` with incompatible meanings and nothing interlocks them. ⚠️ **The reason the conflict cannot arise is STRUCTURAL, not incidental** — an earlier revision said "only because the hazard half is never instantiated", which is the weaker half of the truth. **The two allocators are gated to different worlds**: `CS:0x8611 cmp byte [0x42],2` for the nest against world 4 for the hazard. Even if the hazard were placed, the two could never coexist.

⚠️ **Correction — `DS:0x3b2` is NOT shared state.** An earlier revision of this section called it "one shared counter". All six references in the image are `CS:0x868E`/`0x869B`/`0x8796` (the nest) and `CS:0x8B5D`/`0x8B69`/`0x8C26` (the hazard), and **each walker sets it to 0 at the top of its own pass**, increments once per live record, and reads it only at the bottom of that same pass to decide whether to unhook its own gate. Nothing survives between the two. The genuine sharing hazard is the **records**.

Also open: `UNKNOWN_cfcc_bottom_row_overrun` (neither probe axis is bounds-checked; `row + 2` in the bottom two tile rows indexes past plane A into `DS:0x7004`, the trigger table — arithmetic confirmed, reachability not).

## `UNKNOWN_cfcc_cotenant` — CLOSED: a PLACED world-2 enemy `[PROVEN]`

The pool's other tenant is the **opposite** of the hazard. It is reachable, it is placed **32 times**, and the port had nothing for it — which makes it the first genuinely *missing* enemy this project has found rather than another cut one.

It was missed because it arrives by a route nothing else here uses: **not** the plane-B selector table, **not** the entity group descriptors, but the **object array**. A map object whose `POBJECTS` category is 4 is routed by **sprite id** through a chain of `cmp cx,imm / jz` arms, and one arm calls an allocator.

```
CS:0x1511  ax=[si] (world X)  bx=[si+2] (world Y)  cx=[si+4] (type)
CS:0x1526  mov [ss:0x432],bx        ; the world Y is SAVED here
CS:0x15F1  sub ax,[0xa]             ; X becomes SCREEN.  Y is NOT touched.
CS:0x160D  cmp byte [di+0x4],3 / jl ; category < 3 leaves
CS:0x1613  mov cx,[ss:0x432] / mov bx,cx    ; bx RESTORED to the world Y
CS:0x161D  cmp byte [di+0x4],4 / jnz        ; CATEGORY 4 -> jmp 0x1b5b
CS:0x1CC6  cmp cx,0x11d / jz 0x1c91         ; sprite 285 = object TYPE 115
CS:0x1C91  call 0x8611
```

⚠️ **So `ax` is SCREEN X and `bx` is WORLD Y at the call**, which is why the allocator does `add ax,[0xa]` with no matching `add bx,[0xc]`. The missing-looking instruction was never needed: `CS:0x1613` puts the world Y back deliberately, from a copy saved before any adjustment. A port that "fixes the asymmetry" moves every creature by the scroll offset.

`UNKNOWN_ss432_indirect` `[WF]` — `SS:0x432` has exactly two references in the whole image, this write and this read (`CS:0x1526` = `36 89 1E 32 04`, `CS:0x1613` = `36 8B 0E 32 04`, both `SS`-overridden). The six other `[0x432]` hits in the binary are `DS`-relative (`A1 32 04`/`A3 32 04`, the DS default with no override prefix) and are a *different* variable — so this scratch word is genuinely private to this one save/restore pair, on the bytes checked. That check is an immediate-operand scan only, though: a pointer parked in a register with an SS-default base (e.g. `[bp+n]`) would not name `0x432` in its encoding at all, and is this project's standing blind spot for this kind of claim.

**Reachability, from the shipped data:** object **type 115** (sprite `170 + 115 = 285 = 0x11d`) is placed **16× in `PLEV2A`, 16× in `PLEV2B`, and zero times in the other six maps** — matching the allocator's own `cmp byte [0x42],2` exactly. The census was run after the world gate was read, and could have contradicted it.

### ⚠️ A shipped bug: the caller tests the wrong flag, so a nest fires ONCE

`CS:0x8611` signals failure with **STC**, exactly like its sibling allocator `CS:0x7F0D` — and the sibling's caller tests it correctly:

```
CS:0x1C7D  call 0x7f0d  /  CS:0x1C80  jc 0x1ce0     <- carry.  Right.
CS:0x1C91  call 0x8611  /  CS:0x1C94  jz 0x1ce0     <- ZERO.   Wrong.
```

ZF is 0 on **all three** return paths: success (`CS:0x8657 add [si],ax` lands the timer in `0x28..0x37`), pool-full (an occupied slot's `x` is non-zero, and neither `loop` nor `stc` touches ZF) and wrong-world (the `cmp` failed by construction). So `jz` is never taken and the fall-through always runs `CS:0x1C98 mov word [si+4],0xffff` — **the object is marked dead whatever happened.**

Two consequences a port must reproduce: **a nest yields at most one creature ever**, so 16 placements cap a sublevel at 16; and a nest activating while the ten slots are full is **consumed with nothing spawned**. The intended `jc` would have left it to retry.

### The record, and the state machine

10 bytes: `{ i16 worldX, i16 worldY, i16 state, i16 hp, i16 timer }`, free when **`x` is negative**. Seeds: `x = screenX + camX + 3`, `y = worldY − 0x18`, `state = −4`, `hp = 60`, `timer = 0x28 + (rand & 0xf)`.

**`sprite = 0x204 + state`, applied unchanged across the whole signed range** (`CS:0x88B4` while hatching, `CS:0x8765` alive). State runs `[−4, +4]`, so the creature owns the **nine consecutive frames 512–520**. Under world 2's load order those are `PLEVEL2B` frames 8–16, and rendered they read exactly as the state machine predicts:

| state | sprite | |
|---|---|---|
| −4 … −1 | 512–515 | four frames growing upward out of nothing |
| 0 | 516 | aiming left |
| 1 | 517 | fired left — **one tick only** |
| 2 | 518 | the dead band — a **symmetric upright** pose |
| 3 | 519 | aiming right |
| 4 | 520 | fired right — **one tick only** |

That is a genuine cross-check, not a restatement: the left/right assignment was derived from the signs of two `cmp bx,ax / jl` branches with no reference to the art, and the art then puts the symmetric frame on exactly the state the dead band writes. Frame 521 is visibly a different creature.

**The hatch is gated on visibility, and that is the spawn gate.** While `state == −4` the timer only ticks inside the window `x ∈ [−24, 320]`, `y ∈ [8, 176]` (`CS:0x8850`–`0x8869`, all four compares signed and inclusive); off screen `CS:0x88DE` resets it to `0x27`. So a nest the player never approaches never opens, and one they walk away from re-arms — which is why there is no separate "activated" flag. ⚠️ That window is a **seventh** distinct cull rectangle, and the only one whose Y floor is positive.

States `−3 … −1` advance one step **every other frame**, gated on `DS:0x36c` (the toggle `CS:0x0172` flips with `NOT`). ⚠️ When the increment carries state to 0 the handler does **not** return — `CS:0x8840 jmp 0x86b1` runs the live AI in the *same* tick.

⚠️ **The hitbox changes with state, by a factor of nine**: `8 × 8` at `(x+8, y+15)` while hatching (`CS:0x8883`) against `24 × 24` flush at `(x, y)` alive (`CS:0x8740`). One box for both makes the whole emergence a free kill. ⚠️ The blitter changes mid-hatch too — `CS:0x88AF cmp dx,0xffff / jnl` sends `state ≥ −1` to export 1 and everything below to export 2.

### The fire logic — asymmetric twice over

```
86C1  ax = [si]              ; entity X
86C3  bx = [0x17a] ; add bx,0x20
86CA  cmp bx,ax / jl 0x8703  ; heroX + 32 < entityX  -> hero LEFT, fire left
86CE  sub bx,0x38            ; bx is now heroX - 24  -- CUMULATIVE
86D1  cmp bx,ax / jl 0x8736  ; heroX - 24 < entityX  -> the DEAD BAND
86D5  mov word [si+4],3      ; else                  -> hero RIGHT, fire right
```

⚠️ **`sub bx,0x38` is applied to the already-biased `bx`.** Read as a fresh offset from `heroX` it gives −56 and widens the band from 56 px to 88. The band is `heroX − entityX ∈ [−32, +24)` — **32 left, 24 right, inclusive on the left and exclusive on the right.**

Muzzles are asymmetric too: right `(x + 0x18, y + 6)`, left `(x − 6, y + 6)`. Only the direction word `DS:0x206` (±5) is a clean mirror. `UNKNOWN_cfcc_muzzle_asymmetry` — the offsets are read correctly, but *why* they differ (30 px apart) isn't established; would close by rendering sprites 516–520 and measuring their widths against −6 / +0x18.

**Timers.** `CS:0x86BB cmp word [si+8],0x28 / jg` runs the aim logic only at or below 40; the reload is **42**, which is *greater*, so for two ticks after every shot the creature holds its fired pose without re-aiming. The steady period is 43 ticks (the shot lands when the `dec` goes negative) ≈ 2.9 s at 15 Hz.

⚠️ **But the FIRST shot comes after 40, not 43** — the emerge handler reloads `0x27` = **39**, which is *below* the gate, so the aim path runs immediately. The two numbers differ purely because the reload straddles the gate in opposite directions.

⚠️ **And the timer FREEZES in the dead band.** `CS:0x8736` writes state 2 and falls straight through with **no `dec`** — only the two aiming branches decrement. Since the `> 40` gate decrements *before* the aim test, a creature whose hero has stood in the band since its last shot sits at exactly **40** and needs 41 more frames once the hero leaves. A port that ticks the timer unconditionally fires the instant the player steps out.

⚠️ **The random part of the seed is probably never observed.** All four cull branches of state −4 target `CS:0x88DE`, which forces the timer to 39 on **every** off-screen frame — and the activation box (±64/±48 around the screen) is *larger* than the emerge window, so an approaching nest is normally allocated while still culled and the `0x28 + (rand & 0xf)` is overwritten before it is ever decremented. An earlier revision of this section claimed the randomisation exists "to stop sixteen nests firing in lockstep"; that is **not supported**. `UNKNOWN_cfcc_dormant_seed_observable` — a watchpoint on `DS:0xcfcc+8` under DOSBox would settle whether any record's seed survives a pass.

**Freeze covers only the middle third of the dispatch.** `CS:0x86B1 cmp word [0x2fa],0 / jnz 0x873b` lands past the aim and fire logic but **before** the contact test and the draw. And because HP and state are tested *earlier* — at `CS:0x869F` and `CS:0x86A8` — ⚠️ **the dormant countdown keeps ticking, the rise keeps advancing and the death animation keeps running while "freezes aliens" is active.** Only `CS:0x86BB`–`0x8736` stops. A frozen creature still hurts the hero, still takes damage, still draws and still counts live.

**The companion draw, `CS:0x8806`,** blits sprite `0x11d` — the object's own sprite — at `(x−3, y+0x18)` on *every* path. The creature carries its own plinth, which is why the dispatcher can mark the object dead immediately without it vanishing.

⚠️ **Those offsets cancel the allocator's exactly.** The seed is `x + 3`, `y − 0x18`; the pedestal draw is `x − 3`, `y + 0x18`. So **the plinth is drawn precisely on the placed object** and the creature's own record sits 3 px right and 24 px above it. That is a self-check on both readings at once — and it matters, because ⚠️ **the aim compare uses the creature's X, not the object's**, so the dead band is centred 3 px right of where the art sits.

### Death, and the brood

Entered when HP goes negative. Each tick draws `state + 0x6c` **twice**, at `(x−4, y−8)` and `0x18` lower, then `inc state`. Sprites 108–114 are `PALWAYS2#69..71` then `PALWAYS3#0..3` — the sequence **crosses an atlas boundary**, which only the cumulative descriptor numbering makes work.

⚠️ **A creature killed MID-RISE does reset to 0.** `CS:0x88C6`/`0x88DB jmp 0x877e` means the emerge draw shares the live path's tail, so `CS:0x8784 mov word [si+4],0` applies to it too — otherwise the death handler would start negative and draw sprite `0x6c − 3`, three frames before the death cloud. `CS:0x8789` then calls `0x87EF` — the score award `[WF]`: `0x87EF → 0x8A27` spawns a **popup id `0x2D`** at `(x+4, y+0x18)` with Y-velocity `0xFFFA` (−6) via `CS:0xBF5F`, *conditionally* (skipped when `[0x1a0] ≥ 0`), then **unconditionally** `clc / call 0xC8B`, which enters the BCD score chain at `[0x3b6]` with `dl = 0x25` = **2500 points**.

### `UNKNOWN_bf5f_popup_id` — CLOSED: a general floating-item-icon popup, and id `0x3D` is deliberately special-cased to respawn a spike `[STATIC]`

`CS:0xBF5F`–`0xBF7F` is the popup *spawner* (single-slot, `DS:0x1a0` holds the id or `0xFFFF` when free — `CS:0xBF80`'s own sibling entry is the per-tick *updater*, which floats the popup by its stored Y-velocity and, once `id ≥ 0xB` (11), fetches a sprite for it):

```
bf5f  cmp cx,0x3d / jz 0xbf59        ; id == 0x3D (61) -> DIVERT, see below
bf64  cmp word[0x1a0],0 / js 0xbf6e  ; slot already busy?
bf6b    jmp 0xc041                   ; BUSY -> forward straight into the respawn routine instead
bf6e  [0x226]=AX / [0x228]=BX / [0x22a]=0xfffa(-6)   ; seed world position + Y-velocity -6
bf7b  [0x1a0] = CX                   ; id becomes the "popup active" flag
bf7f  ret

bf80  cmp word[0x1a0],0 / js 0xbf7f  ; UPDATER: inactive -> nothing to do
bf87..bf92  world -> screen, Y += velocity, CX := the stored id
bf96  cmp cx,0xb / jl 0xc004         ; id < 11 -> a PLAIN NUMERIC popup (score-style, CS:0xc004, not chased further)
bf9b  sub cx,0xb                     ; id >= 11 -> POBJECTS TYPE = id - 11
bf9e  si = 0x2a4e + type*10          ; the runtime object-descriptor table, stride 10 — already documented elsewhere
bfab  cx = word[si]                  ; descriptor +0 = sprite id (170+type)
bfb9  cmp cx,0x117(279) / jz 0xbff1  ; two hardcoded special sprites get bespoke draw handling, not chased further
bfbf  cmp cx,0x118(280) / ...
      [otherwise: draw the fetched sprite floating up from the world position]
```

**The `id == 0x3D` divert is not a rejection — it's a deliberate second path.** `CS:0xBF59` (`and bx,0xfff0 / jmp 0xc041`) snaps the popup's Y to a 16-px tile boundary and jumps straight into `CS:0xC041` — this document's own already-documented **"steal-and-carry" respawn routine**, which allocates a fresh `DS:0x8314` object slot and drops a live object of type `(id − 11)` back into the world at the given position. `0x3D − 11 = 50`, and **`POBJECTS` type 50 is `"spike"`** (decompressed and read directly: `PWEAPONS`/`POBJECTS.001` record 50 → name `"spike"`, the one *named* category-4 object this document already flagged). So the world-2 nest's own death award (`popup id 0x2D`) and a spike hazard share this one entry point, but they take genuinely different branches: **a spike (id `0x3D`) is re-dropped into the world as a real, solid object instead of floating up as a collectible-style icon** — matching what a spike trap should do on reset (become a physical hazard again, not a score popup). The busy-slot fallback (`CS:0xBF6B`) reaches the identical respawn routine for the *same* reason: if a popup is already in flight, a second request is treated as "drop a real object" rather than losing the request.

**Popup id `0x2D` (45) itself is the ordinary case** — `45 − 11 = 34`, and **`POBJECTS` type 34 is `"jewel"`** (same direct read; empty description). So the world-2 nest's death award floats a jewel-icon popup up from the kill point at `(x+4, y+0x18)`, falling under gravity (`Y += −6` per tick, uncapped in the bytes read here), while the BCD score chain separately and unconditionally credits the player 2500 points — the popup is purely a visual flourish layered on top of the score award, not the mechanism that grants it. `UNKNOWN_bf5f_special_sprites` — what sprites `0x117`(279)/`0x118`(280) get instead of the generic float, and which other popup ids reach them, is not traced past locating the branch.

⚠️ **From a LIVE state, death inherits it; it does not reset.** `CS:0x87DA` is `cmp ...,4 / jnz` — an *equality* test — and `CS:0x87E9` frees at ≥ 7:

| killed in state | ticks dying | broods? |
|---|---|---|
| 0 | 7 | yes |
| 3 | 4 | yes |
| **4** | 3 | **NO** — it increments straight past 4 |

State 4 lasts exactly one tick, so the window is narrow, but a port written with `>= 4` loses it.

**The brood, `CS:0x88E5`.** ⚠️ **3 or 4 children, not 2 or 3** — `mov dx,2 / add dx,(rand & 1)` with `dec dx / jns` at the bottom runs one pass more than the seed suggests. (Fourth time this project has been caught by that shape, after the starburst particles, hits-to-break and the block's first shot.) Target array `DS:0x8014`, **16 records of 16 bytes**, free when `+4` is negative, exactly the 256 bytes `CS:0x8676` fills. Children inherit the parent's `x, y` by `movsw / movsw` and then add `0x18` to y.

⚠️ **The two seeded signed fields use different random shapes**, drawn in this order:

```
CS:0x8913  and ax,3 / neg ax / sub ax,2      -> +0xa, always -2..-5
CS:0x8921  mov bx,ax / and ax,3 / or bx,bx / jns / neg ax
                                             -> +0x8, MAGNITUDE from the mask,
                                                SIGN from the untouched word
```

A single `(rand & 3) − 2` reproduces neither: wrong range, wrong symmetry, and it never reaches −3 or +3. ⚠️ They are **not labelled** here — a small signed pair, one symmetric and one strictly negative, on something bursting out of a corpse is *consistent* with `{vx, vy}`, but the consumer is `CS:0x894E`, which is out of scope.

⚠️ A full brood array **abandons the whole burst** (`CS:0x8904` leaves the per-record walk), not just one child.

### Where it sits in the frame, and the pool lifecycle

The main loop calls all three of these pools' gate bytes, in this order:

```
CS:0x027F  call 0x894d    ; the DS:0x8014 brood gate
CS:0x0282  call 0x8687    ; THIS creature
CS:0x0285  call 0xed15    ; System-B entities
CS:0x0291  call 0x8b56    ; the DS:0xcfcc falling hazard (cut)
```

`CS:0x8661` (from `CS:0x69C0` and `CS:0x8E4F`, level init) disarms both gates, fills `DS:0x8014` with `0xFFFF` **in world 2 only**, then `mov si,0xcfcc / jmp 0x7f48` to clear the pool. ⚠️ That jump lands **inside a third pool's clear routine** — `CS:0x7F45` is `mov si,0xce64` falling into the same loop — and the shared tail `CS:0x7F55` disarms the `DS:0xce64` walker as a side effect. ~~`UNKNOWN_ce64_pool`~~ — **CLOSED**, see *`UNKNOWN_ce64_pool` — CLOSED* below.

⚠️ **`DS:0x8014` is itself shared, by world.** `CS:0x7CBD` gates on `cmp byte [0x42],1`; `CS:0x7EB6` is not a separate gate but one instruction *inside* the world-1 populator `FUN_1000_7e9b` (see the full closure just below), which performs the identical world-1 test as part of its own plane-A scan; and `CS:0x7E62` uses the populated records to write **plane A** (`mov si,0x3004 / mov [si],bl`). The two tenants are mutually exclusive by world, which is exactly why nothing interlocks them and why the level-init clear is world-gated.

### `UNKNOWN_8014_world1` — CLOSED: a hidden-statue "wakes up and attacks" mechanic, exclusive to world 1 sublevel B `[STATIC]`

⚠️ **Correction to an earlier pass of this section, caught by a live DOSBox check that came back empty.** Live-reading `DS:0x8014` on `PLEV1A` (world 1, sublevel `'a'`) found the table entirely `0xFFFF` — not a bug in the reading, but the actual shipped behaviour: this content is **sublevel-`'b'`-exclusive**, not merely world-1-exclusive as first written. Tracing why closes the record layout and the trigger's coordinate units in the same pass.

**The real populator is `FUN_1000_7e9b`, called from `FUN_1000_2a37`** (the central `.MAP`/`PALFILS` loader this document already credits with those loads) — a fourth, previously-unexamined reference to `0x8014` this pass's `search_instructions` turned up alongside the three already on record:

```
7E9B  DS = ES = 0x1ffd                  ; the game's own real DS segment (not just this doc's Ghidra base)
7EA2  SI = 0x3004 ; DI = 0x8014 ; BP = 0
7EAB  cmp byte[0x43],0 / jz 0x7ec7      ; SUBLEVEL != 'a' ? if 'a' (0), skip the scan entirely
7EB2  cx = 0x2000                        ; else: scan ALL 8192 plane-A cells
7EB5    lodsb                            ; al = this cell's tile
7EB6    cmp byte[0x42],1 / jnz 7ec5      ; world != 1 -> no match, next cell
7EBD    cmp al,0x23 / jz 7ed4            ; tile 0x23 -> MATCH (variant A)
7EC1    cmp al,0x24 / jz 7ed4            ; tile 0x24 -> MATCH (variant B)
7EC5  loop 7eb5
7EC7  cmp bp,0x20 / jz 0x7ed3(ret)       ; (the 'a'/non-world-1 path falls straight here with bp=0)
7ECC  ax=0xffff ; cx=4 ; stosw x4        ; write ONE all-dead 8-byte terminator record, then RET
```

**So on sublevel `'a'`, or any world but 1, `DS:0x8014` is forced to a single dead record and nothing else ever runs** — exactly what the live read on `PLEV1A` showed. Only on world 1 sublevel `'b'` does the function scan the freshly-loaded plane A for tiles `0x23`/`0x24` (up to 32 hits) and, for each, compute and store:

```
7ED9  bx = (matched cell offset) ; row = bx >> 7 (plane A stride 128)  -> [DI+2]
7EEA  col = (matched cell offset) & 0x7f                                -> [DI]
7EF0  [DI+4] = 0                 ; NOT FIRED
7EF8  [DI+6] = the matched tile id (0x23 or 0x24), from AL             ; STOSW using stale AH
```

**This corrects the record layout** this document's earlier pass guessed at: `DS:0x8014` (world 1, sublevel B) is `{i16 tileCol, i16 tileRow, i16 fired, i16 matchedTileId}` — **tile-grid coordinates (0..127, 0..63), not world pixels**, and the 4th field is the matched tile id, not a duplicate of the 3rd. `CS:0x7E62` (level init, `FUN_1000_7e58`, called from the outer level-init `FUN_1000_8c34`) then re-stamps the map using that **stored** tile id (`[DI+6]`, not a hardcoded constant) at the record's plane-A position — a two-row stamp (`base`, `base+10`) — which is what makes a level *reload* restore any statue that had already woken up back to its original, undisturbed tile.

**`CS:0x7CBD` (the trigger) now resolves cleanly, including its own long-flagged residual.** It processes one `0x8014` record per tick via a cursor at `DS:0x24e`, skipping already-fired records (`[si+4] != 0`). The proximity test compares the **camera position shifted into the same tile-grid units** (`camera_x >> 5`, i.e. ÷32; `camera_y >> 4`, i.e. ÷16 — the game's own standard 32×16 tile size) against the record's own **already-tile-grid** `[si]`/`[si+2]` — **so `UNKNOWN_8014_trigger_box_units` is closed: there is no unit mismatch, both sides of the comparison are in tile-grid coordinates all along**, which only became legible once the populator (not just the trigger) was read. If the hero is currently overlapping a `0x30×0x30` px box around the record (tested via `CS:0xac59`, bracketed by the `CS:[0x71d]` self-modifying player-state gate and a `DS:0x250` health snapshot, exactly as this document documents for the respawn path), the statue defers rather than fires that tick. Otherwise it fires: marks `[si+4] = 0xFFFF`, rewrites the plane-A pair to tile `0xd`, and allocates into `DS:0xcdec` with `worldX = tileCol × 32`, `worldY = tileRow × 16` — the tile→pixel conversion this document's earlier pass had already correctly inferred for the *output*, now traced to its actual source — seeding one of two initial states depending on which tile (`0x23` vs `0x24`) matched.

**`DS:0xcdec` (`FUN_1000_7b68`/`CS:0x029A`) is the awakened statue's live behaviour: a 10-slot, 12-byte, world-1/sublevel-B-exclusive homing hazard.** `{i16 worldX, i16 worldY, i16 state, i16 animFrame/deathCounter, i16 stepX, i16 stepY}`, free when `state == 0`. While alive (`state` in `0..0x10` and the "freezes aliens" potion `DS:0x2fa` inactive) it **ratchet-steers toward the hero** — the identical clamped ±1-per-tick catch-up shape this document's own camera code uses — draws via the shared entity blitter `CS:0x3569` with an idle/walk sprite table at `DS:0xdf68`, and calls the shared **hero-contact-and-damage-grid-scan routine `CS:0xa9e4`** (via the `FUN_1000_7c7c` wrapper this document's `UNKNOWN_sfx_id_space` closure already found — the `DS:0x35e` bracket around it selects the ROL-only alternate death sound `0x49` for this creature specifically). On death (`state` goes negative) it plays an **18-tick burst-and-fall animation**, sprite `= 0x5b + deathCounter` — the identical `0x5b`-base sprite convention this document already documents for entity death frames, shared with the hero's own death burst (`DS:0x24c`, under *The death/respawn reset set*) — before freeing the slot.

**`UNKNOWN_dxf68_sprite_table` — CLOSED.** Read live (DOSBox, `DS` segment `4970` this run, verified against the documented fallback-palette constant beforehand): the first 8 words are **`450, 451, 452, 451, 456, 457, 458, 457`** — two 4-frame ping-pong idle cycles (`0,1,2,1` shape twice, offset by 6 sprites), both drawn from atlas base **450** — this document's own already-established `level1` group base (`always`(170) + `objects`(280) = 450, the same atlas this document separately proves holds `PLEVEL<N><X>.PI1`'s 60-frame 32×32 creature strip). So the awakened statue's idle animation is cut straight from the `level1` creature sheet, with two distinct 3-unique-frame cycles — almost certainly the two tile-`0x23`/tile-`0x24` variants each getting their own idle loop, six sprites apart in the same strip.

So the mechanism this document had recorded only as "`DS:0x8014` is shared by world, and `CS:0x7E62` writes plane A" is a small, complete, previously uncatalogued **scripted enemy exclusive to world 1, sublevel B**: a decorative two-tile statue baked into the map, discovered by scanning the level's own plane A for one of two tile ids at load time, that — once scrolled on-screen and the hero isn't already touching it — replaces its own art, spawns a hero-homing, damage-dealing creature with a full death animation, and resets back to dormant stone on the next level load. Tagged `[STATIC]` — read from the bytes across four functions and cross-checked for internal consistency (units, field layout, and the live DOSBox negative-result on sublevel A), but not yet watched firing on `PLEV1B` itself; a live visit there would promote it to `[PROVEN]`.

### What category 4 is, from the data side

Types **50, 73, 96, 97, 115, 117, 130** are category 4, identically in all four `POBJECTS` files. **Six of the seven have an empty name and an empty description**; the exception is type 50, named `"spike"`. That fits: categories 0–3 are potion / treasure / keys / levers — all things the hero picks up and all named — while category 4 holds things that are *done to* the hero. A category-4 object is also rejected by the walk-in pickup path (`CS:0x17E6 jg` sends category ≥ 2 away), so it never needs text. `POBJECTS` categories 4 and 5 remain `UNKNOWN` as enums, but this is what 4 looks like.

### `pobjects-cat-4-5` — category 5 census `[PROVEN, enum meaning still open]`

Decompressed all four `POBJECTS.00{1-4}` (`blast.py`) and read every 48-byte record directly (not via the game's own id-based type formula, which is unsafe for world 4 — see below). **Category 5 has exactly 22 members, identical across all four worlds once the already-documented world-4 `+5` id drift is corrected for**: types `49, 55, 64, 65, 66, 67, 68, 81, 82, 95, 102, 103, 104, 105, 106, 107, 108, 111, 112, 113, 114, 131`. Confirmed self-consistent two ways: worlds 1–3 (base id `170+type`) agree on this set exactly, and world 4's own raw ids (base `175`) read as this same set **minus 5** on every one of the 22 records (`54,60,69,70,71,72,73,86,87,100,107,108,109,110,111,112,113,116,117,118,119,136`), which is precisely the already-documented world-4 `+0x08`/`+0x0c`/`+0x1e`/id authoring-drift pattern applied consistently — not a different, world-specific category-5 roster.

**Every single category-5 record has an empty name, an empty description, and `Value = 0`** — a stronger blank-field pattern than category 4's (which has one named, valued member, `"spike"`). Sprite ids for the 22 types (`170 + type`, or `302+` if ≥`0xC0` — none are) run `219, 225, 234, 235, 236, 237, 238, 251, 252, 265, 272, 273, 274, 275, 276, 277, 278, 281, 282, 283, 284, 301`. No dedicated `cmp cx,<sprite>` dispatch site for any of these 22 values was found in the portion of the object-array walk read this pass (`CS:0x1511`–`0x1CC6`, the same chain that resolved the world-2 nest at sprite `0x11d`/285); a full sweep of every `CMP CX,imm16`/`CMP AX,imm16` in that walker for all 22 sprite ids was not run, so absence of a dedicated handler is not exhaustively proven, only not found where category 4's hits were found.

The one behavioural fact this document already had — category 5 draws behind ordinary objects in the same swap-suppression rule as category 3 (`CS:0x0731 cmp word[si+0x4],5 / jz 0x775 -> no swap`) — still stands and is the only established consequence. Given the total blankness (no name, no description, no value, unlike category 4's one exception), category 5 is at least as plausible a candidate for "purely structural/never-instantiated" filler as it is for a second creature-hazard category; the enum's *meaning* remains open, only its *membership* is now settled.

### `UNKNOWN_ce64_pool` — CLOSED: a sixth creature type, world 3 only, and it is the real reason `DS:0x34` ever reduces starburst/aura damage `[STATIC]`

`DS:0xce64` is a **third** 10-slot × 10-byte pool, independent of the `DS:0xcfcc` nest/hazard pool it merely shares a clear-loop tail with. Its own allocator is `CS:0x7F0D` (re-read here byte-for-byte, not decompiled):

```
7f0f  mov si,0xce64 / mov cx,0xa        ; walk 10 slots
7f15  cmp word [si],0 / js 0x7f23       ; free when x is negative
7f1a  add si,0xa / loop 0x7f15
7f21  stc / ret                          ; all ten busy -> fail
7f23  add ax,[0xa]                       ; screen -> world X
7f27  mov [si],ax / mov [si+2],bx        ; seed x, y
7f2c  mov word [si+4],0xc8               ; hp/"strength" := 200
7f31  mov word [si+6],0                  ; wander-state := 0
7f36  mov word [si+8],0xa                ; timer := 10
7f3b  mov byte cs:[0x7f5c],0x90          ; ARM the update entry (NOP = enabled)
7f43  clc / ret
```

`CS:0x7F0D` has **exactly one caller**, `CS:0x1C7D` — the same category-4 object-type dispatch chain the nest's `CS:0x8611` hangs off, one arm earlier:

```
1c77  cmp cx,0x10a / jnz 0x1cc6         ; sprite 0x10a = 266
1c7d  call 0x7f0d
1c80  jc 0x1ce0                          ; (this sibling tests the carry correctly, unlike the nest's `jz` bug)
```

`sprite = 170 + type` (this document's own formula) makes `0x10a` **object type 96** — one of the seven category-4 types already catalogued in *What category 4 is, from the data side* (`50, 73, 96, 97, 115, 117, 130`), unnamed like the other six. Decompressing all eight `.MAP`s (`blast.py`) and reading the 200 six-byte object records of each (per this document's own `.MAP` format) finds type 96 placed **1× in `PLEV3A` and 5× in `PLEV3B`, zero elsewhere** — live, shipped, world-3-only content, not cut.

**The per-tick update, armed by `CS:0x7f5c`** (a `RET`/`NOP` self-modifying gate at the routine's own entry, same trick as `CS:0xAD88`): free-slot test, then `cmp word[si+4],0 / jns` (hp still ≥ 0, else a separate death branch at `CS:0x8076`), then `cmp word[0x2fa],0 / jnz <skip to draw>` — **this creature honours the "freezes aliens" potion**, exactly like System A/B. Past that gate sits a wander-state counter (`[si+6]`, a timer at `[si+8]` reloaded with `10 + rand()&0x1f` on expiry) that, every third advance, diverts into a separate screen-cull-and-`CALL 0x80b4`(→`0xc8b`, the BCD score entry with `dl=0x10`) branch at `CS:0x803a` — an attack/score mechanic not chased further here.

**The tail every live slot runs, `CS:0x7fb5`–`0x7fdd`, is what matters for damage numbers.** It loads `{x, y, hp}` from the record (`hp` doubling as the creature's own "strength"), sets a `0x20 × 0x28` hit box, and brackets the shared hero-contact-and-self-damage-scan call with a **save/force/restore** of `DS:0x34`:

```
7fcf  mov dl,byte [0x34]        ; save the incoming value
7fd3  push dx
7fd4  mov byte [0x34],0x1       ; FORCE DS:0x34 = 1
7fd9  call 0x1000:a9e4          ; the shared hero-contact test + damage-grid self-scan
7fdc  pop dx
7fdd  mov byte [0x34],dl        ; restore it
```

This is a **second, previously undocumented writer of `DS:0x34 = 1`**, and it has nothing to do with the "scripted sequence" framing below — it is a call-scoped reentrancy flag around exactly one call, used by exactly one creature type.

**Why it changes damage numbers.** `CS:0xa9e4` (`call 0xac59` for the hero-hit box test, then — only when that test did *not* report a hit — proceeds to round the creature's own box to screen space and scan the damage grid) can, if this creature happens to be standing on a stamped cell, fall into the tag decode `CS:0x9320`. Re-reading that decode's negative-tag ladder byte-for-byte confirms this document's existing table exactly, including the `DS:0x34` gates:

```
93a8  mov word [0x1ea],0x2710        ; tag 0xFE (invulnerability aura): 10000 by default
93b0  cmp byte [0x34],0 / jz 0x93bd
93b7  mov word [0x1ea],0x0            ; ... but 0 whenever DS:0x34 != 0
93cc  cmp byte [0x34],0 / jz 0x93dd
93d3  mov word [0x1ea],0x32           ; tag 0xFC (starburst): 50 whenever DS:0x34 != 0
93dd  mov word [0x1ea],0x2710         ; ... else (DS:0x34 == 0) the usual 10000
```

So **while this creature's own contact-test call is in flight, any starburst or invulnerability-aura hit *against it* resolves to the reduced value (50 / 0) instead of 10000** — every time, in completely ordinary play, whenever an object-96 creature (world 3 only) is standing on a stamped cell at the moment its update runs.

**The mode-1/2 "scripted sequence" (below) can never reach this same branch.** Both call sites for this creature's per-frame update — `CS:0x029D` (normal play) and its attract-mode mirror `CS:0x92DE` — sit inside a block gated `cmp byte[0x34],0 / jnz <skip>`, exactly like every other entity-AI call in the main loop (see *the `DS:0x34` gate reference below*). So this creature's own `DS:0x34=1` bracket can only ever fire when `DS:0x34` is *already* 0 at the top of the frame — the scripted-sequence mode and this creature's bracket are temporally disjoint, never nested, never racing. And because mode 1/2 freezes *every* entity contact-test call (the only path that ever reaches `CS:0x9320`), the "reduced damage" arm of `CS:0x93A8`/`CS:0x93CC` is **structurally unreachable via the scripted sequence** — the *only* live path to it is this one creature's bracket.

**Net correction to the starburst/aura damage claim below:** "10000 in normal play" is correct for the hero and for every other creature type, but **object type 96 (world 3, 6 shipped placements) is permanently capped at 50 damage from a starburst and is fully immune to the invulnerability aura**, by ordinary code, with no cutscene involved. A port that gives every creature the same starburst/aura damage number reproduces the wrong answer for this one enemy.

### `UNKNOWN_ce64_death_branch` — partly CLOSED: the death draw reuses the world-2 nest's own sprite convention `[STATIC]`

`CS:0x8076`–`0x8096` is the object-96 creature's death-frame draw, and it is a byte-for-byte structural match to the world-2 nest's own death handler (*Death, and the brood*, above — `"Each tick draws state + 0x6c twice"`):

```
8076  ax = [si] ; bx = [si+2]        ; world X/Y from the DS:0xce64 record
807b  ax -= 4 ; bx -= 8               ; the SAME (−4,−8) offset the nest's death draw uses
8081  bp = [si+6]                     ; the wander-state field, repurposed post-death — same pattern this
8084  bp += 0x6c                      ;   document already documents for every other entity's death counter
8087  ax -= [0xa] ; bx -= [0xc]       ; world -> screen
808f  [0x4]=ax ; [0x6]=bx ; [0x8]=bp  ; the shared entity-blitter's draw-call arguments
```

So object 96's death cloud is drawn with **exactly the nest's own `sprite = state + 0x6c` formula**, off the same wander-state field this document already documents as the record's runtime state — the two creature types visually share one death-burst effect. Immediately before it, `CS:0x8068`–`0x8073` is a sibling arm with a different offset (`bx −= 0xa`) that calls `CS:0x80BB` instead of drawing directly — plausibly the *alive* draw, gated on hp by a comparison this pass's linear disassembly window didn't include (the true branch point wasn't located, so this is inferred from the arms' shapes, not proven). `UNKNOWN_ce64_identity` — the game never names object type 96, so it has no in-project label yet — and the creature's own attack/wander AI (`CS:0x803a` onward) remains untraced beyond this draw pair; the specific `CALL 0x80b4`/`0xc8b` citation from an earlier pass was not re-located at that exact address this session and should be treated as unverified until re-read.

### `UNKNOWN_8014_brood` — CLOSED: the walker confirms the record layout and adds a hitbox and a sprite table `[STATIC]`

`CS:0x894E` walks all 16 `DS:0x8014` slots (`CX=0x10`), and its own bytes settle several previously-open pieces at once:

```
894e  si = 0x8014 ; cx = 0x10
895a  cmp word[si+4],0 / jns 0x8963 / jmp 0x8a07   ; +4 < 0 -> FREE slot, skip (confirms the existing "free when +4 negative" claim)
8963  inc byte[0x3af]                               ; a live-count, reset to 0 at the top of every pass
8967  cmp word[si+6],0 / jns 0x8970 / jmp 0x8a33    ; +6 < 0 -> a separate branch, not chased further
8970  cmp word[si+0xc],0 / jz 0x8979 / jmp 0x8ab1   ; +0xc != 0 -> a THIRD branch, not chased further
8979  cmp word[0x2fa],0 / jnz 0x8983 / call 0x8a6c  ; "freezes aliens" honoured, else CALL a movement routine
8983  ax=[si] ; bx=[si+2] ; bp=[si+6]                ; world X/Y, and +6 loaded as the BP-in/BP-out "strength"
898b  [0x1e2]=0x18(24) ; [0x1e4]=0x10(16)            ; a 24x16 HITBOX, distinct from the nest's own 24x24/8x8 pair
8997  call 0x1000:a9e4                                ; the SHARED hero-contact-and-damage-grid-scan thunk
899a  [si+6] = bp                                     ; strength written back — the familiar BP round-trip convention
899d  dx = [si+4] ; dx <<= 1                          ; the lifetime/frame field, DOUBLED -> a WORD index
89a2  di = 0x360a + dx                                ; SS:0x360A — the sprite table this residual asked about
89a7  dx = word[ss:di]                                 ; the fetched sprite id
89aa  cmp word[si+8],0 / js 0x89b3 / add dx,3          ; +8's SIGN selects a +3 sprite-id variant
```

So the brood record is `{ i16 worldX, i16 worldY, i16 frame(also the free/lifetime sentinel), i16 strength, +0x8 a sign-tested facing/variant flag, +0xc a second state gate not traced past this read, ... }`, each brood child takes hero-contact damage through the **same shared `CS:0xa9e4` thunk** every other creature uses (with its own 24×16 box), and its sprite is `SS:0x360A[frame]`, optionally `+3` when `[si+8]` is non-negative — the identical "table lookup, ±3 variant by a sign test" shape this document already documents elsewhere for other small creatures. `UNKNOWN_8014_field_0x6_branch` / `UNKNOWN_8014_field_0xc_branch` narrow the residual to the two untraced branch targets (`0x8A33`, `0x8AB1`).

Still open here: **`UNKNOWN_nest_identity`** — the game never names type 115, so "nest" is the port's label; **`UNKNOWN_cfcc_dormant_seed_observable`** (above); **`UNKNOWN_cfcc_pool_full_in_play`** — whether real play ever leaves ten alive, which is what the `jz` bug needs to bite; **`UNKNOWN_cfcc_1ca5_orphan`** — `CS:0x1CA5`–`0x1CC3` is a complete export-2 draw block with **zero** branch references and no fall-through path into it; **`UNKNOWN_cfcc_7f48_shared_tail`** — whether disarming `[cs:0x7f5c]` from the `0xcfcc` clear path is intended; **`UNKNOWN_cfcc_muzzle_asymmetry`** (above, *The live/emerge fire logic*); **`UNKNOWN_cfcc_spawner_cull_reason`** (below, *`UNKNOWN_nest_shot`*); **`UNKNOWN_ss432_indirect`** (above, *the object-array dispatch*).

**Two measurements worth keeping.** Swept over every camera position, at most **4** of `PLEV2A`'s nests and **5** of `PLEV2B`'s fit inside one activation box — so the ten slots are not a per-screen budget. They are a **cumulative** one: `CS:0x87E9` is the only `mov word [si],0xffff` in the whole `0x8611`–`0x894D` range, so **nothing frees a slot but death** — not scroll-off, not a timeout. The reachable failure is a player who leaves ten alive and then activates an eleventh, which is destroyed permanently.

The port is `gods-web/src/game/nest.js`, with 18 assertions in the verification suite and 23 injected porting mistakes all killed.

## `UNKNOWN_nest_shot` — CLOSED, and it opened a whole subsystem `[PROVEN]`

What the nest fires turns out not to be nest-specific. `CS:0x1FE7` (left) and `CS:0x2039` (right) are **the mechanism by which every shooting enemy in the game shoots**, and the port had no model of it at all. Six left/right emitter pairs call them:

```
CS:0x8725 / 0x86F7   the world-2 nest creature
CS:0xB07D / 0xB08F   CS:0xB6C8 / 0xB6EA   CS:0xBCBE / 0xBCCA
CS:0xBDC5 / 0xBDD6   CS:0xE6BB / 0xE6CF   -- five further behaviour handlers
```

The array is **`DS:0x8954`, 20 records of 8 bytes**: `{ i16 worldX, i16 worldY, i16 vx, i16 state }`, free when `state` is negative, seeded 0. ⚠️ The emitter tests `js` for free and the updater `jns` for alive — the same word in opposite senses.

**The emitter converts to screen, culls, then `pop bx / pop ax` to recover the world coordinates before storing**, so the record holds world position and the cull is a screen test. ⚠️ **The two cull rectangles differ and are not mirrors**: Y is identical (`screenY ∈ [−4, 191]`) but X is `[8, 328]` firing left against `[−8, 312]` firing right — each shifted 16 px *away* from the direction of travel. That is an eighth and a ninth distinct cull rectangle. `UNKNOWN_cfcc_spawner_cull_reason` — whether the 16 px shift tracks projectile travel distance (so a shot can't spawn already off-screen) or something else isn't established.

### ⚠️ This is a SECOND, completely separate damage path

Everything this document records about hurting the hero runs through `CS:0xac59` (the box test with the `BP`-in-`BP`-out convention) via the `CS:0xa9e4` thunk, and through the 8×8 occupancy grid at `DS:0x16ca`. **An enemy shot uses neither.** `CS:0x4501` — two callers, both inside the shot updater — is a bespoke inline box test:

```
4504  ax += 0x0a ; bx += 0x04          ; the shot's hot point
450A  ax += [0xa] ; bx += [0xc]        ; -> WORLD
4512  cx = [0x17c]                     ; the hero box TOP
4516  cmp byte [0x377],0x12 / jl / cmp 0x13 / jg
4524  add cx,0x18                      ; CROUCHING -> raise it 24
4527  cmp bx,cx / jl reject            ; the box is 32 x 48, INCLUSIVE
452B  cmp ax,[0x17a] / jl reject
4538  cmp ax,[0x17a]+0x20 / jg reject
4543  cmp bx,[0x17c]+0x30 / jg reject
4547  cmp word [0x172],0 / jnz reject  ; INVULNERABLE
454E  sub word [0x192],2               ; a FLAT 2, off the TARGET
4553  mov word [si+6],0xffff           ; the shot is consumed
4561  call 0xa633 with cx = dx = 0     ; a STATIONARY debris puff
```

Three consequences a port reusing the contact path gets wrong:

1. **The difficulty scalar does not apply.** `DS:0x365` is consumed at exactly two instructions, `CS:0xab56`/`0xab63`, inside the `CS:0xac59` resolution. `CS:0x4501` never goes near it, so enemy shots hit for the same amount in world 1 and world 4.
2. **It writes the target `DS:0x192`, not the bar** — so the bar chases down afterwards like every other source.
3. ⚠️ **Invulnerability makes the shot pass THROUGH.** `CS:0x4547`'s `jnz` skips *both* the subtract and the `[si+6] = 0xffff` that consumes it, so the projectile keeps flying. That is the opposite of the contact path, where `CS:0xACCC`'s `jnz` skips only the subtract and the creature still dies.

⚠️ **This also attributes a site this document listed without attribution.** The crouch section names three sites running the identical range test — `CS:0x4516` (+0x18), `CS:0xAC92` (+0x14), `CS:0xDB68` (+0x18). **`CS:0x4516` is this one**, and it belongs to the enemy-*shot* path rather than to `CS:0xac59`. The raises genuinely differ: **crouching helps by 24 px against a shot and by 20 px against contact.**

### Flight, terrain and the fade

`CS:0x20A8` steps `x += vx` and branches on the **sign of the velocity** — and a velocity of exactly **zero is not "stationary", it is the impact state** (`CS:0x2072`).

⚠️ **The terrain stop seeds the fade BY DIRECTION, and that is why there are two free tests.**

```
2158  cmp word [si+4],0 / js 0x2165
215E  mov word [si+6],4        ; flying RIGHT -> state 4
2165  mov word [si+6],1        ; flying LEFT  -> state 1
216A  mov word [si+4],0        ; and the VELOCITY is zeroed
```

So a left-stopped shot fades 1, 2 and frees at **3**; a right-stopped one fades 4, 5 and frees at **6**. Both `jz`s are live and the fade cannot be collapsed to a `>=`. `CS:0x216A` is also the writer that makes `CS:0x20B6`'s zero-velocity arm reachable at all.

The sprite numbering falls straight out and is self-checking: **`0x45, 0x46, 0x47` left flight + two fade frames, `0x48, 0x49, 0x4A` right** — six consecutive descriptors, three per direction, which is why the left flight sprite and the fade base are the same number. Despawn edges are asymmetric too — `0x140` on the right against `−0x10` on the left.

⚠️ **The terrain probe rounds unlike anything else, and the straddle is NOT a gate.**

```
2143  cmp byte [di],1   / jz  stop     ; the shot's own cell — ALWAYS tested
2148  dx = x & 0x1f
214D  cmp dl,0x18       / jng fly      ; STRICTLY greater; 0x18 does not straddle
2152  cmp byte [di+1],1 / jnz fly      ; the NEXT cell right
```

Stop when `[di] == 1`, **or** when the shot straddles past 24 px *and* `[di+1] == 1`. Reading it as "a cell of 1 stops the shot, gated by a straddle test" — which an earlier draft of the port did — lets a shot fly straight through a wall it entered head-on.

The cursor itself is `(x & ~0x1f, (y + 2) & ~0xf)` — a **+2 Y bias**. Collected, there are now **four distinct pixel-to-cell rules**: floored (entity), rounded-to-nearest (hero and export 40), `+8` on both axes (the hero's projectile terrain stop), and `+2` on Y only here. One shared helper is wrong three times.

### ⚠️ The two projectile systems sit on OPPOSITE sides of the player

```
CS:0x020F  the HERO's shots move and stamp     -- BEFORE the state machine
CS:0x0254  the player state machine EMITS
CS:0x0282  the nest walker           0x0285  the entities   -- both EMIT
CS:0x02BA  the ENEMY shots move and hit        -- AFTER every emitter
```

So a hero shot cannot hit anything on its spawn tick, while an enemy shot moves and can reach the hero **on the very tick it is fired**. Giving both systems one ordering is wrong for one of them whichever you pick.

`UNKNOWN_enemy_shot_other_emitters` — CLOSED, and it splits into three real mechanisms plus one false lead. (`UNKNOWN_enemy_shot_impact_writer`, briefly open in the port, is **closed**: `CS:0x216A` is the writer.)

The port is `gods-web/src/game/enemy-shots.js`, with 9 assertions and 14 injected porting mistakes all killed.

### The five other emitter-pair owners, closed `[PROVEN]`

All five were confirmed to be exactly `call 0x1fe7` / `call 0x2039` (the same two shared emitters documented above), and split into three genuinely different mechanisms — none of them the world-2 nest.

**Two (`CS:0xB07D`/`0xB08F`, `CS:0xB6C8`/`0xB6EA`) belong to a previously-undocumented per-tick driver for the already-known **selector 2** spawn system.** This document's own selector table already names `0xad06` as "spawn from PALFILS `+0x0718` (`DS:0x9720`) → runtime `DS:0xaec0`" — what was missing was the runtime *driver*. It is `CS:0xAD88`, a self-modifying `nop`/`ret` gate (enabled at `CS:0x18E70` → `0x90`, disabled at `CS:0x1C4AA` → `0xc3`) called from three main-loop sites (`CS:0x0223`, `0x09F8`, `0x9291` — `0x0223` sits right after the documented hunter-target-list reset, so this driver is a genuinely new addition to the per-tick call order). It walks all 10 `DS:0xaec0` slots (32-byte stride) and, per slot, calls `[si+0x16]` ("handlerA") unconditionally and `[si+0x1c]` ("handlerB") unless `DS:0x2fa` ("freezes aliens") is set. Both handler words are copied verbatim from the spawning class's 12-byte record — `class_table[cls]+4` and `class_table[cls]+10` — by the allocator `CS:0xAD0D`–`0xAD61`, which also raw-copies the class's own **`+0xC`/`+0xD`** source bytes into the new slot's `+0x12`/`+0x13`. `CS:0xB03C` (fires left via `0xB07D`) and `CS:0xB670` (fires right via `0xB6C8`) are exactly the `handlerB` wired into `DS:0x1fc`'s table (the **`b` = System-B-pointer** class table, per `CS:0xAD62`) for a specific run of classes — World 1 idx 5/6/7, World 2 idx 3, World 4 idx 3 (never World 3) — each reading those two raw bytes back as a facing-select flag (`[si+0x12]`, `0` = fire, nonzero = divert to a different, unread attack routine at `CS:0xDBC6`/`0xB63F`) and a fire-rate/reload divisor (`[si+0x13]`, reload `= (0x10−value)<<2` ticks). Confirmed live in shipped data: `PALFILS.0{A,B}{1,2,4}`'s `+0x0718` window places exactly the classes this table wires up.

**Two (`CS:0xBCBE`/`0xBCCA`, `CS:0xBDC5`/`0xBDD6`) belong to the already-closed `PGOD0x.PAT` / **selector 1** spawn table**, and close `UNKNOWN_pat_class_fields`'s handler-pointer half (see above). `CS:0xBC4B` — the sub-record's `[si+0x14]` handler — is the **default/most-common** behaviour: fire-rate-gated (`DS:0x230`/`0x232`, the class's own byte-6 nibbles), it compares the sub-record's own pre-tick vs. post-tick X (`DS:0x200` vs. `[di]`, both already-established PAT fields) to fire *in whichever direction the object last moved*, through the same two shared emitters. It is wired to **11 of the System-A table's 14 live class entries** across all four worlds (World 2 and 3: every entry; World 1: 2 of 3; World 4: 2 of 4) — the most common secondary behaviour for a PAT-spawned object, never a primary (`handlerA`) one. `CS:0xBDC5`/`0xBDD6` is different: it is **World 4's own class-index-2 record's dedicated pair** — `handlerA = CS:0xBDDB` (a walk/chase-vs-attack dispatcher reading facing bit3 of `[di+0xe]`) arming `handlerB = CS:0xBD71`, which reload-gates into `CS:0xBD9F`, a fire routine using `[di+0xe]`'s bit3 directly as the facing test rather than a movement comparison. **World 4 class index 3 — one record later in the identical table — is the already-documented cut hazard** (`0xbd38`/`0xbd0b`); this pins down for the first time *which* runtime mechanism would have driven it had it ever been placed (see the correction above).

**One (`CS:0xE6BB`/`0xE6CF`) is genuinely generic, shared code inside the real System-A/System-B entity pipelines — `CS:0xE659`.** Unlike the four above, this one really is called from both documented architectures: it is System A's own pipeline **stage 6** (`CS:0xE001`'s sixth call, already catalogued as "recompute the facing/muzzle direction `DS:0x206`") *and* the first thing System B's per-frame entity driver (`CS:0xEDB8`) does, before its `DS:0xdbe0` movement-mode dispatch. It self-gates on the group descriptor's own `+0x6` byte (low nibble = fire-rate enable, matching this document's already-published field) and a reload timer at `[di+0xe]` (present, at that offset, in *both* systems' entity records despite their differing strides). A non-firing branch (bits 4–5 of `+0x4`/`+0x5` nonzero) diverts to a different, unread spawn path (`CS:0xE5E4`, again touching `CS:0xDBC6`). Direction is read off the entity's own current motion: System A tests the sign of its stage-2 velocity field `[di+0x12]`; System B bit-tests a small constant, `DS:0xd95a = 0x0015` (binary `00010101`), indexed by the entity's current `DS:0xdbe0` movement-mode `[di+0xa]` — bits 0/2/4 (walk/fall/hop-left) are set, 1/3/5 (the right-facing mirrors) are clear, an exact, self-consistent match to the already-documented mode table. Across the shipped `PALFILS` group descriptors, 71 of 344 live records (fire-rate nonzero *and* not diverted) reach this shared code — 12 System-A (worlds 1–3 only; **System A never reaches it in world 4**, every world-4 System-A firer diverting to `CS:0xE5E4` instead) and 59 System-B (present in every world).

### `CS:0xE99F` / `CS:0xEFA2` are not enemy-shot code at all — a "steal-and-carry" pickup mechanic `[PROVEN]`

The false lead: both loaders start `mov si,0x8954`, but that literal is a coincidence of layout, not a shared array. `0x8314 + 200×8 = 0x8954` — the enemy-shot array's documented base is simply the **exclusive upper bound** of the 200-record, 8-byte **object array** at `DS:0x8314` (`CS:0x8FEF`'s already-documented expansion of the map's object table). Both routines walk *backward* from that bound (`sub si,0x8` first, then decrementing) through the object array, never the shot array; the resemblance to the shot record's own `{x,y,vx/type,state/flag}` shape is because both arrays happen to use a similar 8-byte, sign-tested layout, not because they're the same data. (This refutes a plausible-looking hypothesis about the enemy shot's own fade sequence repurposing its velocity word as a "signal" for these two routines to match against — a full re-read of the terrain-stop/fade code found the shot's `[si+4]` is written exactly once during termination, always to literal `0`, nowhere else; E99F/EFA2 never read the shot array in the first place.)

What they actually do: search the object array for a **live, currently-on-screen, matching object** — matching a caller-supplied type (`bp`), world X (`cx`) and world Y (`dx`) exactly — and if found, **kill that map object** (`[si+4]:=0xFFFF`, `[si+6]:=0`, this document's own already-documented "mark dead" idiom) and copy its type and position into the calling *entity's* own record. `CS:0xE99F` (called once, from `CS:0xE90E`, itself called once from `CS:0xE88C` — this document's own already-documented `DS:0xd95c[2]` "marker-seek" strategy handler) is **System A**: it writes the stolen object's X/Y into `[di+0x20]`/`[di+0x22]` and its type into `[di+0x10]`, and System A's own per-frame draw bracket (`CS:0xE0C1`–`0xE0E8`) then **eases** those coordinates halfway toward the carrying entity every tick, drawing the carried item as a second sprite that visibly drifts to follow. `CS:0xEFA2` (reached only through `CS:0xEF01`, called once from `CS:0xEDDA` — inside System B's own documented per-frame driver, right after its `DS:0xdbe0` mode dispatch) is the **System B** mirror: it writes to `[di+0x14]`/`[di+0x16]`/`[di+0x10]` instead, but only `[di+0x10]` (the type) survives past the same tick — System B recomputes the carried item's screen position **fresh every frame** from a fixed per-class attach-point offset (`CS:0xEEBA`, via the same `DS:0x1fc` class-table pointer this document's `CS:0xf0ae` sprite formula already reads), a rigidly-attached icon rather than an eased drift. Both gates are the same: `EF01`/`E88C` only run while `DS:0x3cd`/the group's own goal-strategy is specifically **2**, this document's already-documented "attracts monsters" marker-seek strategy — so a creature can only steal a nearby marked pickup while it is actively drawn toward the marker list. One asymmetry: System B's marker match explicitly excludes type `0x45` (69, the hint tablet) via a check System A's own marker loop lacks.

Both systems eventually **drop** the carried item probabilistically (a per-tick 1-in-128 roll, gated by bits of the group descriptor's own `+0x4`/`+0x5` word — `0` = never carries this far, `2` = always keeps it, `1`/`3` = the roll applies) through one shared respawn routine, `CS:0xC041`, which allocates a fresh `DS:0x8314` object slot (`CS:0x38D7`, the same allocator this document already documents elsewhere) and writes the carried type back in as a new, live object at the *carrier's* current position — closing the loop: steal a placed pickup, carry it, and (usually) put a fresh copy back down somewhere else. `cx`'s discriminated encoding into `CS:0xC041` (weapon index `<0xB` recovered via `+0xC0`, ordinary type `≥0xB` recovered via `−0xB`) is exactly matched by both callers' own construction of it, closing what would otherwise have looked like an arbitrary bias constant.

### `UNKNOWN_eeba_class_offsets` — CLOSED: a per-class, per-world signed byte-pair offset table at `DS:0xdc00` `[STATIC]`

`CS:0xEEBA` computes `si = [0x1fc] + cls*12` (System B's per-world class table, the same `+0x7`-indexed lookup `CS:0xf0ae`'s sprite formula uses), then:

```
eecd  cx = word[0x8] - word[si]      ; a caller-supplied value MINUS the class's own sprite base (word[si] = class_table[cls].spriteBase)
eed3  cx <<= 1
eed5  si = 0xdc00 + cx                ; table1 = DS:0xdc00, 2-byte stride, indexed by (carried-sprite − classSpriteBase)
eeda  dl = [0x42] - 2 ; dh = 0        ; world (1..4) minus 2
eee3  dx <<= 1 (x3) ; si += dx        ; += (world-2)*8
eeeb  dx <<= 1 (x2) ; si += dx        ; += (world-2)*32   -> total += (world-2)*40
eef1  dx = ax                          ; caller's world X
eef3  al = signed_byte(si[0]) ; dx += ax     ; dX offset
eef7  al = signed_byte(si[1]) ; bx += ax     ; dY offset
eefd  si = [bp+2]                      ; restore the entity pointer
ef00  ret
```

So the table is genuinely a **per-class, per-world signed `{dx, dy}` byte pair**, added to a caller-supplied world position (`AX`/`BX`) to produce the carried item's fixed draw offset — exactly the "rigidly-attached icon" behaviour this document's own *steal-and-carry* section already describes for System B, now with the table itself decoded rather than merely located. The index into it is **not** the class alone: it is `(carriedSpriteId − classSpriteBase)`, i.e. which specific carried item (by its sprite id's distance from the class's own base) picked among however many items that class's icon table holds, plus a `(world−2)*40` per-world block offset — 40 bytes = 20 `{dx,dy}` pairs reserved per world. `CX = word[0x8]` — the caller-supplied sprite id — comes from `DS:0x8`, a **shared per-tick scratch word** written by an unrelated animation-phase routine (`CS:0xBF4B`–`0xBF52`, an every-other-frame `[di+0xe]` 0..7 counter plus a fixed `0x20C` bias) that this pass also located but did not trace to a caller linking it specifically to the carried-item context; `UNKNOWN_ds_0008_writer_link` narrows the residual to exactly that connection.

### `UNKNOWN_marker_record_field4_gating_scope` — CLOSED: every category 0/1/2 touch appends a marker, not just type 45 `[STATIC]`

Reading the object-touch dispatcher (`CS:0x15F1`–`0x1652`, the same function this document already credits with the category-4 dispatch at `CS:0x161D`/`0x1CC6`) end to end: the category split at `CS:0x160D` (`cmp byte[di+4],3 / jl 0x162e`) sends **every category < 3 touch — potions (0), treasure (1), AND keys (2)** — through `0x162e` and straight into the marker-append body at `CS:0x1632` (`inc byte[0x398]`, clamp at 20). The type-45-specific branch (`cmp dx,0x2d / jnz 0x1652`) only gates the *extra* behaviour — resetting the marker cursor to the array base and forcing the global strategy override `DS:0x399` — not the append itself. So **any potion, treasure, or key the hero touches appends a marker record**, and only the `"attracts monsters"` potion additionally rewinds the cursor and forces every System-B enemy onto the marker-seek strategy. `CS:0xC041` (called two arms later, per the trigger case above) is reached from this same dispatcher for the *weapon* path.

### `UNKNOWN_c041_176b_purpose` — CLOSED: a generic "spawn N copies" bulk helper `[PROVEN]`

`CS:0x1764`–`0x177A` is a small, reusable subroutine, not part of the pickup dispatcher itself — it sits between the already-documented chest-loot burst spawner (`CS:0x12CF`→`0x12EA`/`0x1756`, whose own tail ends at `CS:0x1763`) and the main pickup contact test (`CS:0x177D`), and `get_xrefs_to` confirms it is called from **two unrelated places**: three times in a row from `FUN_1000_16f9` (this document's own already-documented "routine reached only for sprite `0x118`" — `280 − 170 = 110`, and `POBJECTS` type 110 reads `"treasure chest"`, a *second*, differently-triggered chest-shaped object distinct from the category-1 chest mechanism) and once from `CS:0xCCC6` (not chased further). Its body:

```
1764  push ax,dx           ; save the base position/count
1766  push ax,bx,cx,dx,bp   ; re-push all FIVE call args every iteration — CS:0xC041 consumes and PRESERVES them via its own push/pop
176b  call 0x1000:c041      ; the shared object-respawn allocator, already documented
176e  pop bp,dx,cx,bx,ax    ; restores the SAME values pushed at 0x1766 — the call itself doesn't touch the caller's copies
1773  add ax,bp             ; X += BP, the CALLER's own fixed per-iteration step (NOT the allocator's return — see below)
1775  dec dx / jns 0x1766   ; loop DX+1 times
1778  pop dx,ax
177a  ret
```

So `CS:0x1764` is a **generic "spawn `DX+1` copies of object `CX`, starting at `(AX,BX)` and stepping X by a fixed `BP` each time" loop**, built on the already-documented single-object respawn routine.

### `UNKNOWN_16f9_burst_counts` — CLOSED: a hidden "treasure vault" object that scatters 28 items in three waves `[STATIC]`

`FUN_1000_16F9` (the sprite-`0x118`/`POBJECTS` type-110 `"treasure chest"` handler) is a one-shot trap, not a passive pickup:

```
1700  cmp byte[0x360],0 / jnz 0x175c    ; a ONE-SHOT LATCH — already fired -> do nothing
1707  bx += 8 ; ax += 8                  ; nudge the touch-test box
170d  call 0x1000:177d                   ; the GENERIC pickup contact test (this document's own "the contact test")
1710  jnc 0x175c                         ; not touched this tick -> leave
1712  mov byte[0x360],1                  ; LATCH — never fires again
1717  ax=0xd40 bx=0x320 cx=0x15(21) dx=9 bp=0x10   ; wave 1: 10 copies of type 21, X step 16
1726  call 0x1000:1764
1729  ax += 8 ; bx += 0x12               ; move the spawn origin down-right for the next wave
172f  cx=0x10(16) dx=8                    ; wave 2: 9 copies of type 16, same X step (bp unchanged, still 0x10)
1735  call 0x1000:1764
1738  bx += 0x12
173b  cx=0x12(18) dx=8                    ; wave 3: 9 copies of type 18
1741  call 0x1000:1764
```

Reading the three spawned `POBJECTS` types directly (decompressed `POBJECTS.001`): **type 21 = `"chest key"`, type 16 = `"treasure chest"` (description `"iron"`), type 18 = `"door key"`.** So touching this hidden object once scatters **10 chest keys, 9 iron treasure chests, and 9 door keys** — 28 objects in total — across three horizontal rows (`Y` stepping `0x12`=18px between waves, `X` stepping `0x10`=16px within each wave). This is the first documented dynamic source of **iron chests** (`POBJECTS` type 16) — this document's own chest census records **zero** iron chests placed statically in any of the eight shipped `.MAP` files, so every iron chest a player can ever see comes from this trap object firing, not from level data. **But no shipped map places one.** Decompressing all eight `.MAP` files and scanning every one of their 200×8 object records for `type == 110` finds **zero hits in all eight levels.** So this is a **seventh cut feature**, in the same family as the `flame` weapon, the unplaced familiar potions, and the world-4 System-A environmental hazard: fully implemented — contact test, one-shot latch, three-wave 28-item scatter — and permanently unreachable in the shipped release, because the level editor never placed the one object that triggers it. `CS:0xCCC6`'s own, structurally unrelated call into `CS:0x1764` was not chased.

The marker record's own trailing bytes (beyond the `{x, y}` that `0xf7bb`'s consumer reads) were not located this pass — the write site past `CS:0x1652` continues into a `PUSH DI / PUSH DS` sequence consistent with the shared message-display call this document documents elsewhere, not an obvious marker-array store, so `UNKNOWN_marker_record`'s original question (what the record's other two bytes hold) stays open.

## `DS:0x8b4c` — debris, and it is inert `[PROVEN]`

**20 records of 12 bytes**, cleared at `CS:0x8E91`. The whole per-record body `CS:0x1F8C`–`0x1FD6` contains **exactly one call** — `0x1FC0 call 0x356e`, the masked sprite blit (`0x356E` is `mov bp,0x525a`, and `(0x525a − 0x5252)/4` = **graphics export 2**, not the export-1 blitter the alive-entity draw uses). No `0xac59`, no damage-grid stamp, no plane pointer. **Debris cannot hurt anything and cannot touch the map.**

```
+0x00  u16  alive: 0 alive, 0xFFFF free      +0x06  i16  X velocity — READ ONLY
+0x02  i16  world X                          +0x08  i16  Y velocity — READ ONLY
+0x04  i16  world Y                          +0x0A  u16  sprite id AND lifetime
```

⚠️ **No gravity and no drag** — `0x1F99`/`0x1F9E` *read* the velocities and never write them, so debris flies in a straight line for its whole life. Every other particle system here accelerates (hero, enemy, time bomb, magic axe, chest loot, starburst, and the `DS:0xcfcc` hazard), so "obviously it should fall" is the wrong instinct.

⚠️ **The sprite word IS the lifetime**: seeded `0x3A`, drawn raw, incremented, freed at `0x45`. The draw precedes the increment, so ids `0x3A`..`0x44` are all drawn — **eleven ticks**. There is **no cull** of any kind.

**Three producer shapes**, differing only in what the *caller* passes — all three store **world** coordinates, pinned by the consumer subtracting the scroll at `0x1FA9`:

| entry | input | velocity | callers |
|---|---|---|---|
| `0xA00D` | world | the projectile's `dir` word, **hi → vx, lo → vy** | 1 (the hunter's no-target arm) |
| `0xA633` | screen, + scroll added inside | `cx`/`dx` | **5** — see below |
| `0xA81A` | screen, + scroll added inside | **zero** — a stationary impact puff | 0 (fall-through from `0xA810`) |

`0xA00D`'s hi/lo split is a second, independent routine agreeing with the hunter mover's reversed packing at `0x9F41`. `UNKNOWN_debris_identity` — "debris" is a label; the bytes prove only an 11-frame inert visual effect. `UNKNOWN_8b4c_indirect_write` — the "read-only velocity" and five-site census rest on immediate scans, blind to a parked pointer.

⚠️ **Correction — `0xA633`'s caller count was wrong, and it stood uncorrected for two sessions.** "ELEVEN callers" was never paired with an address list anywhere in this document — a genuine gap the project's own evidence discipline exists to catch, caught only when the `gods-web` port went to wire the remaining producers and the named callers ("block-breaking, the familiar's death, the starburst chain") turned out not to be real. Traced fresh in Ghidra with two independent methods agreeing (`get_xrefs_to` and `search_instructions` on the exact operand `a633`, both against `GAME.EXE`, `instructions_scanned: 14010`): **exactly five** direct near-`CALL`s to `1000:a633`.

| site | in | what |
|---|---|---|
| `CS:0x4561` | `FUN_1000_4501` | the enemy-shot hero-hit puff, already documented above under *"The hero hit, CS:0x4501"* |
| `CS:0xA7A1` | the magic axe's own mover, `0x9f38`/`0xa678` | fires on the tick the axe's **lifetime** expires (`0xA737 dec word [si+4] / js 0xa799`, already documented under *Mover 5*), carrying the axe's **own current velocity** (`cx=[si]`, `dx=[si+2]`, the SAME 6-byte `{vx,vy,lifetime}` record) rather than a stationary puff — a moving spark, then the projectile record is cleared (`mov word [di],0`) |
| `CS:0xAC4C` | the WEAPON-vs-CREATURE grid-scan tail, `CS:0xa9ef`-`0xac58` — **NOT** inside `CS:0xac59` (see the correction under *Difficulty*) | on the branch where a hit lands and the **target survives** — reached via `0xab90`/`0xab96`, i.e. from *inside* the difficulty-scalar bracket this document already documents at `CS:0xab56`-`0xab98` (`abda: mov [0x1ec],bp` stores the survivor's new HP; `bx`=reported damage; `ac00`-`ac4c` rolls two `0x3836` draws jittered by `DS:0x1e6`/`0x1e8`, the box width/height, and calls `0xa633` with `cx=dx=0` — a **stationary hit-spark** at a random point inside the target's own hitbox). The **death** branch (`bp` forced to `0xFFFF`, reached via `CS:0xab88`/`0xab8a jz 0xab98`) does **not** go through here. ⚠️ An earlier revision of this row said `CS:0xAC4C` sits "inside the shared contact/damage routine `CS:0xac59`" and gated it on `attackHero()` not modelling a difficulty-scalar/survival distinction — both wrong: `ac59` is hero-contact only and needs no such model, and the survival logic already lived in `gods-web`'s `creatureScansGrid` before this was corrected. **Closed** — `gods-web`'s `hitSparkAxis`/`creatureScansGrid` now drop the spark |
| `CS:0xDBBB` `CS:0xDC2F` | a **previously undocumented** pool | see below |

**A sixth system: `DS:0xd2be`, 20 slots × 22 bytes — `UNKNOWN_d2be_pool` CLOSED `[PROVEN]`.** It is a pool of fragments that fly along a Bresenham line from an entity's position toward the hero, and it is fed by a previously-undocumented divert inside the shared System-A/B facing-and-fire routine.

**The spawn trigger.** `CS:0xE659` (this document's own "the shared enemy-shot emitter", already recorded under *The five other emitter-pair owners*) reads `cx = (desc+0x4 >> 4) & 3` — call it `attackBits`. `attackBits == 0` fires an ordinary shot through the documented `CS:0x1FE7`/`0x2039` emitter; **any other value (`CS:0xE68D jz e692 / jmp e5e4`) diverts to `CS:0xE5E4` instead**, which spawns into this pool:

| `attackBits` | source | target |
|---|---|---|
| 1 | entity position, exact (no muzzle offset) | hero position, jittered: two independent `CS:0x3836` draws, `(rand() & 0x3f) - 0x1f` per axis — **range `[-31, +32]`, asymmetric** |
| 2 or 3 | entity position, **X muzzle `+0x10`** — a THIRD muzzle-offset constant in this game, next to the shared emitter's own `-8`/`+32` | hero position, exact: `(heroX+8, heroY+6)` |

`n` — the per-spawn/per-frame step count, the field this document's own group-descriptor table had left `[WF]` — is the **high nibble of `desc+0x6`** in both variants; the low nibble is the ordinary fire-rate divisor `CS:0xE659` already reads. A shipped-data census (`blast.py` over all 8 `PALFILS` files, both entity systems, both descriptor windows) found this genuinely reachable and live: **89 of 344 live descriptors** set nonzero `attackBits` AND a nonzero fire-rate nibble (`attackBits ∈ {1: 53, 2: 36}` — **3 never occurs**), concentrated in worlds 3-4, matching this document's separate finding that every world-4 System-A firer diverts to `CS:0xE5E4`. `n` itself is never 0 or 1 in the census (`n ∈ {2,3,4,5,6,8,10}`) — see the N==0 note below.

**⚠️ The most consequential finding: this is a RAY, not a segment — it does NOT stop at the target.** `CS:0xdce1` (the SEED, called once at spawn via `CS:0xdbc6`/`0xdbd4`) computes the classic Bresenham parameters (`dx`,`dy` unsigned magnitudes, per-axis sign, `err` seeded to `major>>1`) and picks one of FOUR near-identical loop bodies depending on x-major/y-major × leftward/rightward — `0xdd04`, `0xdd43`, `0xdd95`, `0xddd3`. It writes the CHOSEN loop's own entry address into the record's `+0x00` word as a "resume pointer", and the per-tick walker `CS:0x7a0b` loads saved register state from the record and does `DI=[DI+0] / JMP DI` to resume mid-loop.

The seed's four loops and `7A0B`'s four loops are **byte-identical in their relative encoding — except for one thing**: `7A0B`'s loops ALSO test whether the major-axis distance counter (`[0x1ee]`, decremented once per Bresenham step) has gone negative, and exit early if so; **the seed's loops do not.** Since the seed's own finalize re-writes the SAME `0xdd04`-family constant every time it runs, `JMP DI` always lands back in the **seed's** copy — so every real per-tick resume executes the seed's unconditional loop, which burns exactly `n` steps and stops, with **no destination check at all**. `[0x1ee]` is loaded, decremented, and stored back every call, and nothing ever branches on it. So the fragment keeps flying past the target, at `n` grid-steps per frame, until solid terrain, the hero, or the off-screen cull stops it — never because it "arrived".

**⚠️ N == 0 would hang.** `DEC [0x1f0] / J.. loop` wraps on an input of 0 (`0 - 1 = 0xFFFF`, ~65536 iterations) — the low nibble of `desc+0x6` has its own zero-guard (`CS:0xe666 al&=0xf / jz e6be`), the HIGH nibble does not. The census above (89/89 reachable descriptors) shows this never happens in shipped data — `n` is always 2..10.

**The per-tick body, `CS:0xdc49`-`0xdcd0` (walker) + `CS:0xdb4e` (hero-hit):**
1. Advance `n` Bresenham steps (always `n` — see the ray-not-segment finding).
2. Solid-terrain probe, `CS:0xdc68`-`0xdc8d`: `col = floor((x+3)/32)`, `row = floor((y+3)/16)` — a **fifth** distinct pixel-to-cell rounding rule in this game (`+3` on BOTH axes; this document's collection so far has floored/rounded-nearest/`+8`-both/`+2`-Y-only). Solid → consume, drop a **stationary** debris puff at world `(x-3, y-3)` (`CS:0xdc1b`/`0xdc1e` — its own constant, not "undo the probe bias"), no draw.
3. Screen-space cull, `CS:0xdca2`/`0xdca7`: `screenX < 0x13c(316)` and `screenY < 0xbc(188)`, both floored at 0 by a sign test — matching this document's own earlier estimate exactly. Outside it → consume WITHOUT debris (`CS:0xdcdb`), no draw.
4. Else, hero-hit test `CS:0xdb4e`: hot point `(x+6, y+4)` world, against a `0x20 × 0x30` box with the crouch top-raise at `+0x18` (matching `CS:0x4501`'s magnitude, **not** `CS:0xac59`'s `+0x14`). Hit → consume, flat `-2` off the health **target** (chases down like every other source), a stationary debris puff at world `(x-2, y-2)` — a **fourth** distinct debris-offset constant in this subsystem alone. **Invulnerable → pass through** (`CS:0xdb99`/`0xdb9e`, same shape as `CS:0x4547`): no consume, no damage, no debris, keeps flying.
5. Draw, **regardless of whether step 4 just consumed the record** — the sprite/position are staged before the `db4e` call, and the draw (`CS:0xdccb`, export 2, the same blitter debris uses) runs unconditionally once a record survives steps 2-3. Sprite = `0x4b + (DS:0x36c & 1)` — 75/76, the same every-other-frame toggle the world-2 nest's hatch animation reads, immediately after the enemy-shot sprite range (`0x45`-`0x4A`) — discriminating, not decorative.

Cleared once per level load, `CS:0xdbfb`, called from `CS:0x8e37` inside the level-init routine (`FUN_1000_8c34`) alongside the other particle pools. Stepped from the main loop at `CS:0x02BD`, immediately after the enemy-shot step (`CS:0x02BA`) and before the health-bar chase (`CS:0x02C6`).

⚠️ `FUN_1000_b1c2` is `db4e`'s OTHER caller (`CS:0xb236`) and is **not** this pool — it is its own separate, permanently-dead 10-slot hazard at `DS:0xaccc`, sharing sprite atlas slot 531 with the already-documented world-4 cut hazard. See *`UNKNOWN_b1c2` — CLOSED*, above (under *`UNKNOWN_hazard_emitter_placement`*).

Ported as `gods-web/src/game/line-hazard.js`. **The spawning side is now wired for System A**: `entity-a.js`'s `stageFacingAndFire` (this document's `CS:0xE659`) reads `attackBits` and returns a hazard-spawn descriptor instead of a muzzle when it is nonzero, and `main.js` routes it to `spawnJittered`/`spawnAtHero`. ⚠️ **System B has no fire logic at all in this port** — `CS:0xE659` is shared by both entity systems, but this port has never given System B's own per-frame driver (`CS:0xEDB8`) a call into it (a pre-existing gap, not introduced by this pass); the majority of the census's 89 live descriptors (65 System B, 24 System A) belong to System B and so still fire nothing.

## The starburst — `UNKNOWN_starburst` CLOSED `[PROVEN]`

The *starburst* potion (category-0 type 36, placed 5 times) throws eight particles out in a compass rose. They fly, fall, **stamp the damage grid**, and each one can set off a **whole new burst from where it is** — so it is a chain reaction, not a one-shot effect, and it is the most destructive thing in the hero's reach.

### The array and the template

`DS:0x8cfa`, **80 records of six bytes** `{i16 x, i16 y, i8 vx, i8 vy}`. A slot is free when its **X is negative** — every test is `cmp word [..],0 / js`, the same sign idiom the object array uses. Cleared at `CS:0x8E9F` (`mov cx,0x50 / mov di,0x8cfa / stosw ×3 / loop`); ⚠️ the `ax` it stores comes from `CS:0x8E96 mov ax,0xffff` and nothing between touches it, which is what makes all 80 slots start **free**.

⚠️ **The template is EIGHT pairs, and the count is self-checking.** `CS:0xA47C` loads `dl = 7` and exits on `dec dl / js`, so it places **eight** particles, each consuming one `{i8 vx, i8 vy}` pair. `0xdd00 + 8×2 = 0xdd10` — **the hero's weapon slot A**, a variable this document established from an entirely different direction. Seven would leave the template two bytes short of a known boundary.

```
(+8,-1) (+8,+5) (0,+5) (-8,+5) (-8,-1) (-8,-6) (0,-6) (+8,-6)
```

Three rays right, three left, two vertical, and only three distinct `vy` values — with the "level" pair carrying `−1` rather than 0, a constant upward bias.

### The chain reaction, and what makes it finite `[PROVEN]`

`CS:0xA58C` calls the spawner **from inside the updater's own walk** over the same array. Nothing guards the recursion; three things bound it:

```
A463  cmp byte [0x34d],0 / jz spawn       ; INACTIVE -> always spawn
A46A  cmp word [0x1d6],0xbe / jl spawn    ; active and age < 190 -> spawn
A472  ret                                 ; active and age >= 190 -> REFUSE
A568  cmp byte [0x374],0 / js  ...        ; only in the 10 frames after a burst
A574  dx = 0xbe - [0x1d6] / shl dx,1      ; threshold = (190 - age) * 2
A57D  cmp ax,dx / ja skip                 ; vs the FULL 16-bit random word
```

⚠️ **A chain re-burst does NOT reset the age.** `CS:0xA493`'s `js` skips the whole init block — age, active flag *and* chain window — when `DS:0x34d` is already negative, and `CS:0xA581` then reopens the ten-frame window on its own. So the window keeps resetting while the age climbs at +2/frame, and it is the **age** that ends the cascade. Reset it on a chain and the effect runs forever.

⚠️ **Chained particles are stepped in the SAME frame they are created.** The spawner is first-fit from slot 0, so with slots 0–7 occupied the new eight land at 8–15 — ahead of the walk cursor — and `CS:0xA592`'s `loop` carries straight over them.

### Physics, animation and the cull

- **A sixth distinct gravity rule, and the only uncapped one.** `CS:0xA50D` gates `inc byte [si-1]` (vy += 1) on `DS:0x1d4` — a 0..7 counter — reading zero, so the starburst falls one step **every eighth frame**. Against: hero `4+v` cap 10, System-B enemy `v` then `++` cap 16, time bomb `++` cap 4, magic axe `+= 2` cap 8, chest loot `++` cap 4. No two of the six alike.
- **Sprite = `77 + DS:0x349`**, a three-frame cycle stepped once per frame and shared by the whole array.
- **A sixth cull rectangle**: `x ∈ [−8, 351]`, `y ∈ [−8, 191]`, inclusive, and a culled particle frees its slot (`CS:0xA53D`). It matches none of the others.
- **Deactivation** is `CS:0xA599`: `bp` counts live particles across the walk, and zero clears `DS:0x34d`.

### It is a damage source, and in normal play it one-shots `[PROVEN]`

`CS:0xA560` tail-jumps into the 2×2 grid stamp with a hand-built return address, passing `di = 0xdcfe` — and `CS:0xA886` reads the tag with `mov cl,[di]`. The byte at `DS:0xdcfe` is **`0xFC`**, which the ladder above decodes to **10000** in normal play.

**`DS:0x34` is 0 in normal play — CLOSED, `[STATIC]`.** `UNKNOWN_DS_0034` is resolved: the byte has **two unrelated uses**, not one "mode" with two mystery values.

⚠️ **Correction — an exhaustive byte-pattern sweep (`C6 06 34 00 ??`, the codebase's uniform direct-immediate-byte-write encoding, all 4 code blocks searched, 152384 bytes, 0 blocks failed) finds exactly EIGHT writer instructions, not nine**: the init (`CS:0x009e` → 0), two sites that write **1** (`CS:0xC4A5` and `CS:0x7FD4` — see below, a second site this document previously missed), one site that writes **2** (`CS:0xC9D1`), and four restores to 0 (`CS:0xC767`, `CS:0xC808`, `CS:0xCAB5`, `CS:0xD950` — the "push/pop bracket at `0xCAB1`/`0xCABD`" this document described earlier is in fact a `push [0x34]` / literal `mov byte[0x34],0` at `0xCAB5` / `call 0xa9e4` / `pop [0x34]`, i.e. the *same* call-scoped save/force/restore pattern as `CS:0x7FD4`, just forcing 0 instead of 1).

**Reader semantics, read off the main loop exactly** (`CS:0x01E5`, `0x01FC`, `0x0226`, `0x0272`):

- `0x01E5`: `cmp byte[0x34],0 / jz 0x1f2` — when **non-zero**, makes one *extra* per-frame call through a function pointer at `DS:0x286`.
- `0x01FC`: `cmp byte[0x34],1 / jz 0x20f` (reached only when the world is **not** 2 — world 2 always takes the full path) — skips the object-activation-box pass **only when the value is exactly 1**, not on 2.
- `0x0226` and `0x0272`: both `cmp byte[0x34],0 / jnz <skip>` — skip the pickup/sparkle block and, at `0x0272`, **all** entity AI and drawing (brood, nest, System A, System B, the hazard walker, the `PGOD0x.PAT` selector-1 driver, and the `DS:0xce64` creature below) for **any** non-zero value, substituting a second function-pointer call through `DS:0x284`.

**Mode 1 is a scripted-sequence engine, installed by trigger ACTION selector 11** (`CS:0xC49C`, this document's own "install per-world scripted routine"): it consumes the trigger event, sets `DS:0x375=0xFF`, sets `DS:0x34=1`, patches `CS:0xAD88` to `RET` (silencing the selector-2 spawn driver), then `jmp`s into `SS:0x537a[(world−1)*2]` — a per-world entry point. The world-1 entry seen here (`CS:0xC4C6`) sets up a small state machine — `DS:0x284`/`0x286`/`0x288` (per-frame script-step function pointers, the world routine's own callbacks), `DS:0x28A` (a countdown, `0x5DC`=1500, ticked down 1000 at a time by `CS:0xC776` and firing a scripted **seven-burst starburst explosion** at `CS:0xC758` when it goes negative — the game's own "scripted seven-burst explosion" already documented above), and `DS:0x28C`/`0x28E` (the burst's world position). A **second**, distinct burst call (`CS:0xC9C2`) runs the same seven-burst sequence and then sets `DS:0x34=2` instead of restoring it to 0 — a post-burst hold state that, among other things, freezes a `[si+4]` countdown in an unrelated per-object animation walker (`CS:0xC814`: `cmp byte[0x34],2 / jz <skip the dec>`). Both values are restored to 0 once the scripted routine finishes (see the four restore sites above). This is almost certainly a boss-defeat / world-ending cutscene machine — plausible, not proven; no attempt was made to trace which trigger record installs it or watch it fire live.

**`DS:0x34`'s effect on damage is real but does *not* come from this cutscene machine.** Because entity AI (including every contact-test call that can reach the starburst/aura tag decode `CS:0x9320`) is unconditionally skipped whenever `DS:0x34 != 0`, the scripted sequence can never itself trigger the reduced-damage branches at `CS:0x93A8`/`CS:0x93CC` — there is nothing left running that could hit them. The **entire practical effect** comes from the second writer this document previously missed: `CS:0x7FD4`, a one-call save/force/restore bracket inside a **sixth, previously uncharacterized creature type** (object type 96, `DS:0xce64` pool). See *`UNKNOWN_ce64_pool` — CLOSED* above for the full mechanism and why it caps that one creature's starburst damage at 50 and makes it immune to the invulnerability aura, in ordinary play, every time — a real correction to "10000 in normal play," scoped to exactly one enemy.

### The five call sites — the potion is only one of them

| site | what |
|---|---|
| `CS:0x6205` | the type-36 potion, at `(heroX + 8, heroY + 0x20)` |
| `CS:0x9417` | a tile-derived position (`ax<<2`, `bx<<3`, plus the scroll origin) |
| `CS:0xA58C` | the chain reaction, from a live particle's own position |
| `CS:0xC464` | **the familiar's death** — a burst at its last remembered spot, gated on `DS:0x391` |
| `CS:0xD945` | a scripted **seven-burst** explosion at random offsets around `DS:0x28c`/`0x28e`. ⚠️ It clears `DS:0x34d` on *every* iteration, forcing seven **fresh** bursts rather than one continuation — the only site that does that, and why it then pokes `DS:0x374` to −4 instead of the usual −10 |

The updater runs at **`CS:0x0212`**, between the projectile step (`0x020F`) and the player (`0x0254`), extending the per-tick call order this document records.

## Treasure — `UNKNOWN_treasure_pickup` CLOSED `[PROVEN]`

`CS:0x184E` is the `jz` arm of the category split, and it is a three-way branch on the type:

```
184E  cmp cx,0xc  / jl  0x1891          ; type < 12  -> ORDINARY treasure
1853  cmp cx,0x12 / jnl 0x1891          ; type >= 18 -> ORDINARY treasure
1858  test cl,0x1 / jz 0x1860
185D  jmp 0x1919                        ; ODD  in [12,17] -> already open
1860  mov dx,cx / sub dx,0xc / sar dx,1 / add dx,0x15
                                        ; EVEN in [12,17] -> key = 21 + (type-12)/2
186A  mov ax,di                         ; park the DESCRIPTOR pointer in AX...
186C  mov di,0x17e                      ; ...because DI now walks the inventory
186F  cmp dx,[di] / jz 0x18d6           ;   4 slots, exact equality
1888  add di,0x2
188B  mov [si+0x4],cx / jmp 0x17bd      ; no key -> restore, do NOTHING
```

**The shipped data lands on this exactly, and the test is discriminating.** `POBJECTS` types 12..17 are three `"treasure chest"` pairs whose **description field is the material** — `"gold"` (3000), `"steel"` (2000), `"iron"` (1000) — and the three types the formula computes, **21/22/23, are the only records in the file named `"chest key"`**. Types 18/19/20 are `"door key"`, `"treasure key"`, `"world key"` and are *not* reachable from this arithmetic: a dropped `>> 1` gives 21/23/25 and a base of `0x14` gives 20/21/22, both of which hit the wrong keys. Identical in all four `POBJECTS` files.

**Even = closed, odd = open**, with the transition `or cx,1` at `CS:0x18E2` — the same convention already proven for levers 24/25 and switches 26/27, where flipping bit 0 changes state and graphic together. ⚠️ Note `or`, not `+1`: on the even types it reaches the two agree, but the convention rests on the open type being a **fixed point**.

**So the odd arm is a no-op, and that IS its purpose.** `0x1919` stores `[si+4] = cx` (already true) and `[si+6] = 1` (which the activation pass recomputes on the camera's next 32-px step anyway). What it does is **skip `0x1891`** so an opened chest cannot be collected a second time for its value. Confirmed by census: across all 8 maps the placed chest types are **12 (×9) and 14 (×3)** and **13/15/17 never appear** — a chest always starts closed, so this arm is only ever reached by re-touching one the player opened.

### The award — and what a "Value" is worth `[PROVEN]`

Both paths run the same eight instructions (`CS:0x18A8`, `CS:0x18F4`):

```
mov ax,[di+0x6] / xchg al,ah                    ; POBJECTS +6, big-endian
clc / adc [0x194],ax / adc word [0x196],0x0     ; the 32-bit MONEY total
sar ax,1 (x3)                                   ; value >> 3
mov dx,ax / call 0x1950                         ; the BCD SCORE
```

⚠️ **Three `SAR`, not a divide.** No shipped value is negative, so `/8` passes every data-driven test and is still wrong — the same trap already recorded for the Bézier Q15 shift.

**`DS:0x194` (money) and `DS:0x3b5` (score) are different quantities.** Money is the 32-bit total the shop refunds against (`CS:0x6FDE`); the score is **4 bytes of packed BCD**, eight decimal digits, added with `add`/`adc` + `daa` (`CS:0x1950`, which converts the binary addend with eight `div 10` first) and ending `mov byte [0x70],0xff / mov byte [0x71],0xff` to mark the display dirty.

⚠️ **The two paths recover `DI` differently, and one looks like a bug but is not.** The ordinary path brackets its message call with a plain `push di`/`pop di` (`0x18A3`/`0x18A7`). The unlock path pushes `ax` and `si` and then pops **`si` and `DI`** (`0x18F2`/`0x18F3`) — deliberately popping the pushed `AX`, because `DI` was repurposed as the inventory cursor at `0x186C` and `0x186A` parked the descriptor there for exactly this. Same idiom as the damage routine's `0xAC84`.

### Opening a chest throws ten items out of it `[PROVEN]`

`CS:0x12CF` → `CS:0x12EA` writes **ten records of 10 bytes** at `DS:0xb654` — `{u16 x, u16 y, i16 vx, i16 vy, u16 type}` — at the chest's own world position:

```
12FD  call 0x3836 / and bp,7 / inc bp        ; |vx| = 1..8
1306  test ax,0x80 / jz / neg bp             ;   sign from bit 7 of the WORD
1312  call 0x3836 / and ax,7 / add ax,3 / neg ax   ; vy = -3 .. -10
1322  movsw                                  ; the item TYPE, from the table
```

⚠️ **The spawner does not look for free slots** — `di` is set to `0xb654` and ten records are written unconditionally, so opening a second chest mid-burst discards the first burst outright.

The flight (`CS:0x133F`) is a **fifth distinct gravity rule**: `vy++` clamped at **+4**, plus a horizontal decay of 1/tick toward zero that none of the other four have. (Hero `4+v` cap 10; System-B enemy `v` then `++` cap 16; time bomb stepped `++` cap 4; magic axe `+=2` cap 8.) When `vy == 4 && vx == 0` the item **settles into a real object** via the allocator `CS:0x38D7`, with `[+6] = 1` already set (`CS:0x13D0`) so it is collectable the instant it lands. Ten treasure objects, drawn with the same `170 + type` rule as any placed one.

⚠️ **The allocator-failure path is a dead end.** `CS:0x13BA js 0x13b0` skips **both** the settle and the `[0x397] = 1` liveness store, so an item that lands while all 200 object slots are full is frozen at `vy=4, vx=0` forever — and if it is the last one in flight the updater switches itself off (`CS:0x132D` early-returns on `[0x397] == 0`) and never retries. Reproduce it; a retry is a different game.

### ⚠️ A shipped bug: the loot table is authored at stride 20 and read at 16 `[PROVEN]`

`DS:0xd8e6` holds the three loot lists as **object types** (80 `"gold plate"`, 79 `"necklace"`, 78 `"gold mask"`, 10 `"diamond"`, 11 `"chrystal"`, 5 and 9 both `"bag of gold"`). The region is closed at both ends: **`DS:0xd922` is the hero's own jump-arc table**, and `0xd922 − 0xd8e6 = 60 = 3 × 20`. At a 20-byte stride all three lists open `80 80 80 80 5` and then diverge — plainly authored. `CS:0x12D7` strides **16** (`sar cx,1` then four `shl`), so lists 1 and 2 are read misaligned by 4 and 8 bytes and begin `9 9 80 …` and `10 5 9 9 80 …` — inside the previous entry.

**The decisive evidence is a second caller**: `CS:0x1756` enters the same spawner with `si = 0xd90e` **hard-coded**, and `0xd90e − 0xd8e6 = 40 = 2 × 20` — the correctly aligned third list. One caller reads the table aligned, the other computes its offset and gets it wrong.

It is invisible in play, which is why a port must copy it: list 0 is at offset 0 and correct either way; list 1 misaligned is a **pure rotation** of the authored one (same ten items, only the spawn order and hence which random velocity lands on which item differ); list 2 genuinely differs (a `chrystal` becomes a second `bag of gold`) but **type 16 is placed in zero shipped maps**. Reads stay in bounds (max byte 51 of 60). "Fixing" the stride diverges from the original on a chest that does not exist.

### ⚠️ Keys are NOT collected by walking into them `[PROVEN]`

`CS:0x17E6 jg 0x17c2` sends category ≥ 2 to an **`stc`** return while every other exit is **`clc`** — and neither call site turns that into a pickup: `CS:0x168E` ignores the flag entirely, and `CS:0x170D` reads it inside `CS:0x16F9`, a routine reached only for sprite `0x118`. Keys go in through a **different control — CROUCH + FIRE**:

```
crouch states 18/19  CS:0x4B1A / 0x4B4F / 0x4B8F / 0x4BC4  ->  CS:0x6069
6069  si = 0x8314 ; ax = heroX + 0x10 ; bx = heroY + 0x28   ; the hot point
6082  cmp word [si+0x4],0 / js next        ; dead
6088  cmp word [si+0x6],0 / jz next        ; NOT on screen
608E  [si]-4 <= ax <= [si]+0x14 ; [si+2]-0xc <= bx <= [si+2]+0x10
60CF  cmp byte [ds:bp+0x0],2 / jnz next    ; category 2 EXACTLY
60D8  mark dead
60E4  test byte [0x382],0x80 / jz 0x60eb   ; fire NOT held -> PUT IT BACK
60FB  [0x17e + [0x366]*2] = dx             ; held -> into the selected slot
```

So the fire button means a fourth thing: shoot while moving, throw a lever while standing, use an item while crouching — and **take a key while crouching over one**.

**The inventory survives every level change.** `mov [0x17e],ax` appears exactly **twice** in the image, and both are full restarts: `CS:0x0498` (beside world:=1, the weapon-slot clear `CS:0x914c`, and money:=0) and `CS:0x8D80` (beside score:=0). Nothing clears it on a sublevel or world transition, so chest keys carry forward exactly as weapons do.

### `UNKNOWN_object_flag6` — CLOSED: `+6` means "on screen right now" `[PROVEN]`

The `.MAP`'s 200 six-byte object records are not what the game walks. `CS:0x8FEF` expands them into **200 eight-byte records at `DS:0x8314`**, and `CS:0x9011` writes `+6 = 0` for **every** one — so the extra word is not map data. The activation pass `CS:0x11D3` recomputes it — but only when the camera has moved a full 32 px in either axis (`CS:0x1187 and ax,0x1f / jnz`, and `CS:0x1176 test ax,0x20` against the Y remembered in `DS:0x164`), so the box LAGS the camera by up to a tile:

```
11D3  si = 0x8314 ; bp = 0x438 ; cx = 0xc8
11E7  four range tests against SS:0x418..0x41E (the scroll origin snapped to
      32x16, minus 0x40/0x30, plus 0x180)
1203  test byte [si+6],1 / pushf / or byte [si+6],1 / popf
120D  jnz next                       ; already active
120F  mov byte [bp+0],0xff           ; first frame in the box -> mark dirty
1215  mov word [si+6],0x0            ; dead, or OUTSIDE the box -> CLEAR it
```

⚠️ **It is not sticky** — an object that scrolls off has the flag cleared again. Three consumers gate on it: the draw walk (`CS:0x14A1`, as a **byte**), the crouch key pickup (`CS:0x6088`, as a **word**) and the burst settle, which creates objects with it already set. That byte/word asymmetry plus the chest path's whole-word writes raised the question of whether bits above 0 carry meaning — see `UNKNOWN_object_flag6_bits` below, now closed with the exhaustive attribution this document's `.DAT` word2 finding used as its gold standard.

### `UNKNOWN_object_flag6_bits` — CLOSED: bit 0 only `[STATIC]`

An exhaustive census — every instruction in the image whose encoding carries a `+0x6` displacement on `si`, `di`, `bp`, `bx+si`, `bx+di`, `bp+si`, or `bp+di`, with or without a segment override — finds **256** such instructions (165 `[si+0x6]`, 79 `[di+0x6]`, 5 `[ds:bp+0x6]`, 5 `[bp+0x6]`, 1 `[ss:si+0x6]`, 1 `[bx+si+0x6]`; zero `[bx+di+0x6]`/`[bp+si+0x6]`/`[bp+di+0x6]`; zero `es:`-prefixed). This supersedes and corrects this document's earlier estimate of "120 writes at displacement 6" — that figure counted only write-shaped instructions and was never run to ground (an independent recount of write-shaped `+0x6` instructions among the 256 gives ~123, in the same ballpark).

**Closure, not a windowed search.** A pointer into `DS:0x8314` can only ever be produced by **8 literal register loads** (`CS:0x1065`, `0x11D3`, `0x149E`, `0x38D9`, `0x3BFC`, `0x5B38`, `0x606E` — all `si` — and `0x8FF5` — `di`, the load-time expander) plus one **dead** store to `DS:0x7c` (`CS:0x90E6`, written once, read nowhere in the file — confirmed by a file-wide grep for `[0x7c]`). So any `+6` hit whose register cannot be traced back to one of those 8 sites, by straight-line flow or by a `CALL` that hands the pointer back, is *provably* a different structure — and 233 of the 256 are, verified individually against their own base-register load. Sampled bases include the projectile `dir` field at `DS:0xdd10`/`0xdda2`/`0xde34`; `PWEAPONS` **Power** at `DS:0xe2b6+n*0x50`; the `POBJECTS` runtime descriptor's **Value** at `DS:0x2a4e` (`CS:0x18A8`/`0x18F4`, immediately followed by the documented `adc [0x194],ax` money-total code); the treasure-burst array `DS:0xb654`; the enemy-shot array `DS:0x8954`; a raw stack-frame read inside two unrelated routines (`[bp+0x6]` off `mov bp,sp`, at `CS:0x28AA`/`0x2BAC`); and several further arrays at `DS:0xcf40`, `0xd030`, `0xaec0`, `0xce64` (the already-documented `UNKNOWN_ce64_pool`), `0xd1b6`, plus `SS:0x500`/`0x3768`-family records — a sample of what was traced, not a claimed-complete inventory.

Tracing the reachable closure of the 8 sites by hand — including one indirect route the first pass missed: **`CS:0x38D7` is a linear allocator over `DS:0x8314`** (scans for `[si+4]<0`, returns the free slot's pointer in `BP` via `xchg si,bp`, cx's sign flags success) with **exactly 5 callers** (`CS:0x13B7` treasure-burst settle, `0x3DAB`/`0x3E12` type/weapon spawns, `0x8566`/`0x1C042` two further spawns, the latter two writing the field through a pre-incremented `[ds:bp+0x2]` rather than a literal `+0x6` encoding, so outside the strict 256-instruction count but confirmed as the same logical field by direct read) — yields **23 genuine hits** on the object record's `+6` field, and every one of the 23 uses only the literal **`0x0`** or **`0x1`**: 4 plain liveness tests (`CS:0x106B`, `0x14A1`, `0x5B4A`, `0x6088`, all `!=0`/`==0`), 11 literal-`0` clears on death/deactivation (`0x1215`, `0x15A3`, `0x17FB`, `0x189E`, `0x1929`, `0x1C89`, `0x1C9D`, `0x1CD8`, `0x3C70`, `0x3C95`, `0x60DD`), 6 literal-`1` (re)activations (`0x18E8`, `0x191C`, `0x13D0`, `0x3DBD`, `0x3E28`, and `0x60F3` as a **byte**), and the already-documented bit-0 test/set pair at `CS:0x1203`/`CS:0x1208`. No `AND`, no shift, no comparison against 2/4/8, anywhere. **Bit 0 is the whole story**, established from the disassembly alone — no runtime trace was used or is needed to close this specific question, since the claim is a closed negative over a finite, exhaustively-enumerated instruction set.

Two automation traps surfaced doing this and are worth recording as a method note for the next displacement census: a naive push/pop-bracket-skipping backward scan can walk **into an unrelated, textually-earlier function** and return a confident wrong answer — it misattributed 5 genuine object-array writes inside the `CS:0x177D` pickup dispatcher (treasure/consumable/weapon dead-marking, chest open/already-open re-activation) to an unrelated `mov si,0xdf96` at `CS:0x16DC`, 2.7 KB away, simply because that address happened to sit on the scan's path. And any such scanner is blind to a **register returned by a `CALL`** — which is exactly how the `CS:0x38D7` allocator's 3 writes (`CS:0x13D0`, `0x3DBD`, `0x3E28`, all `mov word [ds:bp+0x6],0x1` on a freshly-allocated object) were found only by grepping every `call 0x38d7` site and reading each one directly, not by trusting the tracer's output.

### `UNKNOWN_chest_key_surplus` — partly closed: one key's real purpose found in shipped trigger text

Counted over all 8 shipped maps, with the carry-forward above in mind:

| chest | placed | its key | placed |
|---|---|---|---|
| 12 gold (3000) | **9** | 21 | **8** |
| 14 steel (2000) | **3** | 22 | **3** |
| 16 iron (1000) | **0** | 23 | **6** |

World 2 additionally splits a pair across sublevels — `PLEV2A` holds a steel chest with no key 22, `PLEV2B` a gold chest with no key 21. The arithmetic is not in doubt.

⚠️ **What the surplus *means* is no longer a pure data question — one of the six key-23 pickups has shipped, readable in-game text attached to it.** All 800 trigger records across the 8 maps (decompressed with `blast.py`, parsed per this document's own established layout) were scanned for a `COND` slot (kind 1 = *item held* / kind 2 = *item not held*) with `arg == 23`. Exactly **two** records test it, and both were already latent in this document — one is the already-documented `PLEV3A #50` wild-jump record (*"does not hold key 23" → ACT5, no message*); the other, **`PLEV4B #79`, was not previously read for its message text**:

```
PLEV4B trigger #79:  cond0 = (kind 1 "item held", arg 23)   action = ACT13 (message/precondition gate)   message #1
message #1 text:      "you won't need that key anymore"
```

So **in world 4, holding key 23 fires a trigger whose entire job is to tell the player they no longer need it** — exactly the flavour text you'd expect once a key has done whatever it was really for. Cross-referenced against the census: world 4 places key 23 **once** (`(628, 756)`, both sublevels — same underlying position), and this is its only trigger reference anywhere in the shipped data. Since no iron chest (type 16) is placed in any of the 8 maps, **this key's "real" purpose in world 4 was never the chest at all** — it opens or grants something else (a door, a barrier, a different object this pass didn't chase), and the message is a design nicety confirming the key has already served that purpose. This resolves the *world-4* third of the surplus concretely; the two `PLEV2A`/`PLEV2B` key-23 pickups (`(2965,21)`, `(3307,48)`) have **no** trigger reference anywhere in either map's 100 records, so for world 2 specifically the original framing stands: a chest cut late, or a spare, genuinely not decidable from the bytes.

### Two more small closures from this pass `[PROVEN]`

- **Object messages are shown once per type, and mostly only in world 1.** `CS:0x4609` keeps a 1-bit-per-type "already seen" bitmap at `DS:0x8cea` (`si = 0x8cea + (type >> 3)`, `ah = 1 << (type & 7)`, `test` then `or`, `jz` = show) and bypasses it for category 2 and type 83. Before that, `CS:0x461D`/`0x4624` suppress the message entirely unless `[0x3ab] != 0` **or** the world is 1. Descriptor `+8` is the text offset into the arena at `DS:0x1fc6`, with `0xFFFF` short-circuiting at `CS:0x4676`.
- **The pickup sparkle `CS:0x1239` writes two fields nothing located reads.** It writes `{x, y, sprite, 6, -12}` into a 10-slot array at `DS:0xb578`, but the updater `CS:0x1280` draws `[si+6] + 0x50` — a seven-frame sequence, sprites 86 down to 80 — and reads **neither** `[si+4]` (the sprite just stored) nor `[si+8]`. So on the evidence in hand the animation does not depend on what was collected.

  ⚠️ **This is weaker than the `.DAT` word2 result and must not be quoted as its equal.** That one scanned *every register-load encoding of the displacement* across three binaries. This one enumerated references to the **base address** `0xb578` — exactly three (clear `0x1221`, spawn `0x123B`, update `0x128A`) — and read those three routines. A pointer parked in a register or a DS variable never names `0xb578` again, which is the same blind spot this document flags for `SS`/`DS`-relative addressing elsewhere. **Dead on all three located references; not an exhaustive displacement scan.** `UNKNOWN_sparkle_fields`.

### ⚠️ The attract-mode demo grants itself weapons — that is NOT a starting loadout `[PROVEN]`

`CS:0x8FD2` calls the pickup dispatcher in a loop: weapon 2 five times, then weapon 6 three times. It reads exactly like a starting loadout. Its **only two callers** are `CS:0x8F9B` and `CS:0x8FBB`, both inside a block branching on `DS:0x3e6` — the six-state **attract-mode cycler** — and both fall through to `CS:0x8FBE mov byte [0x3bd],0x1`, the joystick-**playback** flag. A third variant at `CS:0x8F5F` grants 2×3 / 5×5 / 4×1 under `[0x3e6] == 2`, alongside a scripted camera and hero position.

So those are the *demo's* weapons. Real play still starts with all three slots empty. Recorded here because the next pass to find `0x8FD2` will read it the other way.

⚠️ **The walk-fire states do not move.** State 5's whole body (`CS:0x5D46`) is `inc cl`, the emit gate, the chain check and the animation — **there is no X step in it at all**, and the entry at `CS:0x5CA8` sits *before* the walk step at `CS:0x5CCB` and jumps past it. So firing while walking **halts the hero for the entire 5-tick cycle**, entry tick included.

### The per-tick call order `[PROVEN — read off the main loop]`

The order of these seven calls is load-bearing and is invisible to any per-module test:

```
019D  test byte [0x382],0x80 / jnz     the latch clear — CONDITIONAL, and this
01A4  mov byte [0x351],0                 is what makes the weapon semi-automatic
01BD  cmp word [0x19a],0                the death test, on the BAR
01CC  call 0xacf6                       CLEAR the damage grid
020F  call 0x9455                       projectiles MOVE and STAMP
021E  mov byte [0x33c],0xff             the hunter target list resets
0254  call 0x4993                       the player state machine — the EMIT
0285  call 0xed15                       System-B entities -> they SCAN
02C6  call 0xdff                        the health bar chases
```

⚠️ **Projectiles step BEFORE the player.** A shot emitted at `0x0254` does not move or stamp until the next tick's `0x020F`, so **it cannot hit anything on its spawn tick**. Stepping projectiles after the player gives every shot a free frame of collision at the muzzle.

⚠️ **Contact and the damage scan are ONE call, and contact wins.**

```
a9e4  call 0xac59              ; the hero-contact box test
a9e7  cmp bp,0x0 / jns 0xa9ef
a9ec  jmp 0xabc0               ; bp NEGATIVE -> sfx, and RETURN
a9ef  ... save the box, world -> screen, round half-up, scan the damage grid
```

A creature that touched the hero this tick is **not** also damage-scanned — the `jmp` skips the grid entirely. So one creature cannot both hurt the hero and die to a projectile on the same frame, which is precisely what a port running the two tests independently would allow. This also explains why `0xa9e4` is documented in this file both as "the `0xac59` thunk" and as "the scanner": it is the two in sequence.

**The death path forces `BP` negative** `[PROVEN]` — `0xABA7 mov bp,0xffff`, reached from both `0xAB88 js` and `0xAB8A jz`. So a creature taken to *exactly* zero does enter its death frames: `0xffb7 or bp,bp / js` sees the forced `-1`, not the 0 the arithmetic produced. A port that leaves the state word at 0 on a kill reports a kill that never animates. `0x0f22` is the death sound; `0x0e49` plays instead when `DS:0x35e` is nonzero.

### `UNKNOWN_scan_clip` — CLOSED: the scan's clip prologue `[PROVEN]`

`0xA9EF`–`0xAA83` sits between the half-up round and the scan loop and **shrinks the box against the screen edges**, mutating the caller's globals to do it (which is why `0xA9F0`/`0xA9F6` save them into `DS:0x1e6`/`0x1e8` first; those two are read back only at `0xABEE`/`0xAC14`, in the post-hit debris tail).

```
AA15  cmp bx,0xfff0 / jg 0xaa30           ; screen Y <= -16 ?
AA1A  add bx,0x10 / add [0x1e4],bx        ; SHRINK the height by the overshoot
AA21  jns / jnz  else jmp 0xab3b          ; <= 0 -> NO HIT, without scanning
AA2B  mov bx,0xfff0 / jmp 0xaa4e          ; clamp Y, and SKIP the bottom clip
AA30  cx = [0x1e4] + bx                   ; else: the BOTTOM edge
AA36  cmp cx,0xd0 / jl 0xaa4e             ; past 208 -> shrink by the overshoot
AA4E  cmp ax,0xfff0 / jg 0xaa69           ; the same shape on X
AA64  mov ax,0xfff0 / jmp 0xaa86          ; clamp X, and SKIP the right clip
AA69  cx = [0x1e2] + ax                   ; else: the RIGHT edge…
AA6F  cmp ax,0x150 / jl 0xaa86            ; …but compares AX. See below.
```

⚠️ **Each axis clips once, not twice.** Both near-edge paths end in a `jmp` *past* the far-edge test, so it is an if/else per axis. A port that applies both clamps unconditionally diverges on any box tall enough to exceed both edges.

⚠️ **The two axes are not written the same way — read the encodings, not the mnemonics.** `0xAA36` is `81 F9 D0 00` = `cmp cx,0xd0`, testing the computed **bottom** edge; `0xAA6F` is `3D 50 01` = `cmp ax,0x150`, testing the **left** edge — even though `0xAA6D` has just computed the right edge into `CX` and then ignores it. The consequence is concrete: the right-edge clip only engages once the box's *left* edge has passed x=336, so for a 32-wide creature it is **effectively dead code**. Reproduce it verbatim; "fixing" it to `cmp cx` starts clipping boxes the original scans in full.

The `−16` clamp is exactly the grid's own margin: `DS:0x16ca` is 100 bytes into the cleared region with a 48-byte stride, and `100 = 2×48 + 4` — two rows and four columns of slack, and `−16 px` is two rows.

### The 3×3 stamp, `0xA8B8` — and why it is not the 2×2 with a bigger loop `[PROVEN]`

Draw styles **1 and 2** stamp 3×3 (24×24 px); only style 0 stamps 2×2 (16×16). The bodies are otherwise near-identical, but **the nudge and the bounds check are in opposite orders**:

| | order |
|---|---|
| 2×2 `0xA860` | `0xA87A` bounds → `0xA88A` `and dl,4` nudge |
| 3×3 `0xA8B8` | `0xA8DA` `and dl,4` nudge → `0xA8DF` bounds |

So a 3×3 whose *nudged* index falls outside `[0x1696, 0x1c42)` is rejected whole, while a 2×2 in the same position passes on its *pre-nudge* index and then writes nudged. Measured concretely: at `y = 236` (bit 2 set) the pre-nudge index is `0x1C3A` — inside — and `0x1C3A + 0x30 = 0x1C6A` is not, so the 2×2 stamps and the 3×3 refuses. Factoring them into one size-parameterised helper gets one of them wrong.

**This mattered in practice.** The **axe** and the **lightning bolt** are both draw style 1 and both are among the five weapons a port can actually spawn, so routing every style to the 2×2 makes them cover less than half the grid area they should — an under-hit on every shot.

### The hunter's target list is GATED on holding the hunter `[PROVEN]`

`0xAA86 cmp byte [0x343],0 / js 0xaaaa` skips the `{x, y, key}` append at `0xAA8D` (into `DS:0x1d2`, count `DS:0x33c`). `DS:0x343` is set to `0xFF` at `0x9124` — *don't build* — and cleared to 0 at `0x9146` only when `DS:0x168 >= 0` **or** one of the three slot words equals **8**, which is the hunter's own weapon index (`0x9130`/`0x9137`/`0x913E`).

So the list the hunter homes on exists only while the hero is carrying a hunter (or a familiar — `UNKNOWN_DS_0168` is CLOSED, see *the 23 consumable handlers*); every other frame it stays empty. A port that always appends hands the weapon targets the original never gave it. `DS:0x168` is the **familiar's energy** — see *the 23 consumable handlers*; the gate reads "a familiar is alive OR a hunter is held", both of which need a target list.

### The hero starts UNARMED `[PROVEN]`

`CS:0x914c` writes `0xFFFF` into all three slot words (`DS:0xdd10` / `0xdda2` / `0xde34`) and clears each 144-byte projectile area (`CS:0x9177`, `mov cx,0x48 / rep stosw`). Its **only two callers** are `CS:0x473` and `CS:0x8dd9` — the full game restarts — and nothing else ever seeds a slot. So a weapon can only arrive from one of the **55 weapon pickups** the eight maps place (object type ≥ `0xC0`). `CS:0x90f9` is the arm routine: `di = 0xe2b6 + weapon*0x50`, `+0x04 := 0`, `+0x08 := +0x06`, and `+0x02 := 0` if it read 3.

This is not an `UNKNOWN` — the answer is "none". The pickup path that arms him is decoded above.

### Only 5 of the 11 weapons have a decoded spawn handler `[PROVEN]`

Measured from the shipped files rather than assumed. Handler pairs, constant across all four worlds:

| weapon | L/R | mover | weapon | L/R | mover |
|---|---|---|---|---|---|
| 0 knife | **0/1** | 0 | 6 spear | 6/7 | 0 |
| 1 time bomb | 8/9 | 3 | 7 axe | **0/1** | 0 |
| 2 fireball | 2/3 | 1 | 8 hunter | 10/11 | 4 |
| 3 flame | **4/5 NULL** | 2 NULL | 9 magic axe | 14/15 | 5 |
| 4 lightning bolt | **0/1** | 0 | 10 mace | **0/1** | 0 |
| 5 throwing star | **0/1** | 0 | | | |

Each mover index lands on its own weapon's routine — mover 1 = `0x9d97` (fireball), 3 = `0xa058` (time bomb), 4 = `0x9ef7` (hunter), 5 = `0xa678` (magic axe) — which is an independent confirmation that the name order below is right.

⚠️ **Handlers 12/13 are decoded but NO shipped weapon references them.** The decoded set `{0, 1, 12, 13}` therefore covers **five** weapons in practice — knife, lightning bolt, throwing star, axe, mace — not "four families of eleven". A port must guard the spawn call the same way it guards the unbounded `dir`: skip and count, not throw, because the throw is on the fire button.

*(Note: the weapon-name order is `knife, time bomb, fireball, flame, lightning bolt, throwing star, spear, axe, hunter, magic axe, mace`, read out of the records' own text at the 80-byte stride. Getting it from memory instead put fireball and lightning bolt in each other's places and made this document's `+0x48` list look wrong when it is right.)*

### `UNKNOWN_projectile_handlers` — CLOSED for the three that were actually still open `[PROVEN]`

⚠️ **Two of the five pairs this residual named were already decoded elsewhere in this document and never cross-linked**: entries 10/11 (hunter) are the hunter's own 3-shot fan, fully read under *`UNKNOWN_hunter_turn` — CLOSED*; entries 14/15 (magic axe) are read under *Mover 5, `CS:0xa678` — the magic axe bounces*. Only **2/3 (fireball)**, **6/7 (spear)** and **8/9 (time bomb)** were genuinely undecoded, and all three are read here.

**Entries 2/3 — fireball, `CS:0x99d7` (right) / `CS:0x996f` (left).** Not a simple muzzle-offset variant like the other pairs — it is a full volley writer, structurally identical to handlers 0/1's `bp = [si+8]-[si+6]+1` loop, but it *also* seeds the fireball's own per-projectile Y-accumulator on every shot spawned:

```
99D7  ax += 0x10 ; bx -= 0x6                      ; muzzle nudge (right)
99DD  cx = dx - [0x340] - 1 ; shl cx,1             ; -> word index into DS:0xdefc
99E6  bp = [si+8] - [si+6] + 1                     ; volley count, the shared formula
99ED  [di]=dx(tag) / stosw(x)/[di]=bx(y)/[di]=4(dir) ; write the {tag,x,y,dir} record
99FF  [si+0xe] = 0xffff                             ; (weapon scratch, not chased further)
9A04  si = 0xdefc + cx ; [si] = 0xfffa (-6)         ; SEED the fall accumulator to -6
9A11  dec bp / jz 9a41 ; inc dx ; … loop            ; next shot in the volley
```

The `DS:0xdefc + cx` write is exactly the "per-projectile Y accumulator that accelerates" this document already documents under *Mover 1, `CS:0x9d97` — fireball* (`dx = index within the slot`, `add bx,[si]` then `inc word[si]` every tick) — seeding it at **−6** gives the shot a brief rise before gravity takes over, matching the fireball's visibly lobbed arc. `0x996f` (left) is the byte-for-byte mirror, confirmed by its own table slot and the shared tail.

**Entries 6/7 — spear, `CS:0x9a48` (left) / `CS:0x9a42` (right).** Both are two-instruction muzzle adjustments that tail-jump into the base handlers, the same pattern already documented for 12/13:

```
9A42  sub bx,0x4  / jmp 0x98d1     ; right: -4 px Y, then reuse handler 1's body
9A48  sub bx,0x4 / sub ax,0x18 / jmp 0x991c  ; left: -4 px Y AND -24 px X, then handler 0's body
```

So the spear's muzzle is raised half as much as the mace/lightning-bolt pair (`-4` against their `-0xc`/`-0x10` variants), and only the **left**-facing shot gets an extra `-0x18` pull-back on X — an asymmetry with no stated reason, consistent with this document's other muzzle-offset asymmetries (the hunter's, the axe's, the common emitters').

**Entries 8/9 — time bomb, `CS:0x9a7a` (left) / `CS:0x9a51` (right).** These are the spawn handler this document's own *Mover 3, `CS:0xa058` — the time bomb* section already decoded the flight physics for, without ever naming the table indices that reach it:

```
9A51  ax += 0x10                                    ; right muzzle nudge
9A54  [0x1c8]=4 (vx) / [0x1cc]=0xffff (state) / [0x1ca]=0 (vy)
9A66  bx -= 0x20 ; bx &= 0xfffc
9A6C  [di]=dx(tag) / [di+2]=ax(x) / [di+4]=bx(y) / [di+6]=0x2f(47, the 3.1s fuse)
9A7A  [0x1c8] = 0xfffc (-4)  ; jmp 0x9a5a           ; left: same body, vx negated first
```

`0x2f` (47 ticks) is the exact fuse value this document already records ("seeds `0x2f` = 47 ticks ≈ 3.1 s"), and `DS:0x1c8`/`0x1ca`/`0x1cc` are the exact globals `Mover 3` already documents the flight using — this closure is purely "which table entries reach that code," not new physics.

The port's `projectiles.js` (`HANDLER_TABLE`) already names all five addresses (including the two closed elsewhere); the three above are what a port needs to implement that it did not already have decoded prose for.

### `UNKNOWN_projectile_mover` — CLOSED `[PROVEN]`

```
CS:0x020F  call 0x9455                    ; per-frame (also 0x09e4, 0x927d)
CS:0x9455  for each of the three slots:  DS:0x33f := slot index; call 0x9477
CS:0x9477  cmp word [di],0 / jns          ; slot weapon negative -> skip
           si := 0xe2b6 + weapon*0x50     ; the weapon record
           add di,2                       ; di -> the slot's projectile area
           al := [si+0x1a] / shl al,1
           jmp [0xd8ac + al*2]            ; the SIX-entry mover table
```

`0x9455` runs **once per frame**: `CS:0x020F` is the fall-through of a conditional block inside the per-frame sequence that also holds the death test at `CS:0x01BD`, and the other two callers are byte-identical sibling copies of the same seven-call block for other game-state loops — so no path steps projectiles twice. `DS:0x33f` carries the slot index into the mover; the common mover never reads it, so a port should treat it as unmodelled rather than unnecessary.

⚠️ **`CS:0x9c88` has no bounds check on `dir`** — it shifts left twice and adds, so a `dir` of `0x2f` reads 188 bytes past `DS:0xdf0e`. Since `dir` is per-mover and the three weapon slots are independent, a record carrying another mover's `dir` can reach this walk. **A port must not raise here**: the original draws garbage, and a throw on a per-frame path is a strictly worse failure mode. Skip and count, as the trigger port clamps its unbounded `cond_kind` dispatch.

**Weapon `+0x1A` is the mover index.** Across all 44 shipped records it is exactly **0..5** — the table's precise width, every entry used — and constant per weapon across all four worlds:

| `+0x1A` | mover | weapons |
|---|---|---|
| 0 | `0x9c6d` | knife, lightning bolt, throwing star, spear, axe, mace |
| 1 | `0x9d97` | fireball |
| **2** | **NULL** | **flame** — the same cut weapon whose spawn pair 4/5 is null |
| 3 | `0xa058` | time bomb |
| 4 | `0x9ef7` | hunter |
| 5 | `0xa678` | magic axe |

**Two independent null slots, both reachable only through `flame`** — the cut-weapon reading now has corroboration from a second table.

> **Why this stayed hidden.** `CS:0x9477` reaches the arrays as `di = 0xdd10 / add di,2`, so a scan for the array addresses cannot see it; and the mover dispatch uses a *different* table from the spawn dispatch, so "the handler table is loaded at only two sites" was true and misleading at once. Both of this document's earlier "ruled out" claims were sound as stated and useless as guidance.

**The common mover, `CS:0x9c6d`** — 6 of 11 weapons, and now ported:

```
9C6D  mov cx,0x9                  ; walks NINE records, exactly the allocator's reach
9C70  cmp word [di],0 / jz next   ; tag 0 -> empty
9C85  dx = [di+6] (dir) ; shl dx,1 ×2
9C8E  si = 0xdf0e + dir*4 ; ax += [si] ; bx += [si+2]      ; apply {vx, vy}
9C9A  [di+2] = ax ; [di+4] = bx
9CA0  -> screen ; cull  x <= -32, y <= -32, x >= 320, y >= 192  (bounds EXCLUSIVE)
9CF1  cx = [si+0x2] ; jmp [0xdf26 + cx*2]                   ; a draw-style table
9D6A  add di,0x8 / loop                                     ; stride 8, a 4th confirmation
9D91  mov word [di],0             ; DESPAWN — zeroes the same tag the free test reads
```

**`DS:0xdf0e` is a six-entry velocity table** `{i16 vx, i16 vy}`, copied from `SS:0x3612` by `CS:0x95bc` (`mov cx,0xc` = 12 words = 6 entries) and indexed by the projectile's `dir`:

```
dir 0  +12,-3     dir 3  -12,-3      (up)
dir 1  +12, 0     dir 4  -12, 0      (level)
dir 2  +12,+3     dir 5  -12,+3      (down)
```

**This closes the loop on the spawn write order.** The right-facing handler writes dirs **1, 0, 2** and the left-facing one **4, 3, 5** — *level first*, then up, then down. So a one-projectile volley flies straight and the extras fan out around it, which is why the order is 1,0,2 and not 0,1,2. It also confirms the facing assignment independently: every `DIRS.right` code carries `vx = +12`, every `DIRS.left` code `−12`. At 15 Hz, 12 px/tick is **180 px/s**.

⚠️ **Superseded — all six movers are decoded**; see *Three more movers*, *Mover 3* and *Mover 5* above. At the time this paragraph was written the other five were unread, and it is the pass that first established `dir` is per-mover: `0xa058` (time bomb) is a **gravity-and-bounce arc** driven by the globals `DS:0x1c8`/`0x1ca`/`0x1cc` (`inc [0x1ca]` clamped at 4, `add ax,[0x1c8]`, `neg`/`dec` for the bounce, ground test on plane-B `[si+0x80]`/`[si+0x100]`, sound `0x0609` on landing) rather than the velocity table — and it reads a `dir` of `0x2f`, which that table cannot index. **`dir` is therefore per-mover, not a global encoding.** Globals are safe there because time bomb's max-shots is 1.

Two more weapon fields fell out of this: **`+0x02` is a draw-style index** into a second table at `DS:0xdf26` (`UNKNOWN_weapon_02` — ⚠️ **the table is since decoded: three entries**, and `+0x02` is 0..2 across all 44 shipped records, so the `CS:0x9118` zeroing below is a range guard; see *The move→stamp link*). ⚠️ Note the pickup path *zeroes* `+0x02` when it reads exactly 3 (`CS:0x9118`); "a style index reset when it equals 3" is odd enough that these may be two readings of one word rather than one field, and **`+0x04` is the current animation frame** with **`+0x1c` its frame count**, stepped up or down by facing and wrapped at the mover's tail (`CS:0x9d74`). Both are runtime state, reset on pickup.

**Collision is CLOSED, and it was never a pairwise test** — see *Projectile collision — an occupancy grid, not a hit test*. Projectiles stamp, and creatures scan, one 8×8 screen-space occupancy grid at `DS:0x16ca`; terrain is a separate mechanism, the weapon `+0x48` stop at `CS:0xA7B7`/`0xA7EF`. ⚠️ **This paragraph stood for several passes claiming the opposite** — *"still missing … the pixel-mask scan at `0xaad1`–`0xab3f` … are next"* — using a name the document retracts in three other places (the `### The scanner` heading, the closing note of *`UNKNOWN_hero_combat_details`*, and the resolved list) for a routine that is the **damage-grid scanner**, and asserting a gap its own *Projectile collision* section had already closed. Genuinely still open from that pass: **`UNKNOWN_creature_death_anim`** — `0xf02a`, the arm `CS:0xEDFD` takes on a negative entity `+0x08`, is unread — and **`UNKNOWN_alt_emitter`**, now **CLOSED** (see immediately below). ⚠️ `0x8687`, listed here as *"ruled out by reading"*, is now identified as the world-2 nest walker (`UNKNOWN_cfcc_cotenant`) and reaches the damage path itself at `CS:0x874F`; it was ruled out correctly as the *mechanism*, and is misleading left standing as unrelated.

### `UNKNOWN_alt_emitter` — CLOSED: `DS:0x16a`/`0x16c` is the FAMILIAR's own world position `[PROVEN]`

The port (`gods-web/src/game/projectiles.js`) had already worked out the muzzle arithmetic — `+0x10` on Y always, `+8` on X only when firing right (`CS:0x975e`/`CS:0xc450`: `ADD AX,0x4` / `ADD BX,0x4`, read here as the general-case nudge, folded into a caller-specific `+8`/`+0x10` at the two sites actually traced) — and the trigger (`DS:0x33d != 0`, written by `CS:0xc389` inside the weapon-auto-select-by-Power routine that starts at `CS:0xc368`, both addresses genuine — `0xc368` is the routine entry, `0xc389` the specific `mov byte[0x33d],0xff` instruction inside it). What neither the ledger nor the port had was **what `DS:0x16a`/`0x16c` themselves are** — that is now closed.

**They are the familiar creature's own current world X/Y**, established four independent ways:

1. **Seeded at level/respawn init from the hero's own spawn position.** `CS:0x8C56`–`0x8C64`, inside the same spawn/respawn routine already documented for state 4 and the health refill: `cmp word[0x168],0 / js skip` (only when the familiar is alive — `DS:0x168` is the already-documented familiar energy) `→ mov [0x16a],ax ; mov [0x16c],bx ; sub word[0x16c],0x28` — `ax`/`bx` at this point hold the hero's own just-loaded spawn X/Y, so the familiar starts 40 px above the hero.
2. **The familiar's own death spawns a starburst at this position**, exactly matching this document's own already-documented call-site table (*The starburst — five call sites*, `CS:0xC464`, "the familiar's death — a burst at its last remembered spot, gated on `DS:0x391`"): `CS:0xC447`–`0xC469` reads `[0x16a]`/`[0x16c]`, adds `+4` to both, and conditionally calls `0xa461` (the starburst spawner) when `[0x391]==0`.
3. **The familiar shares the Hunter weapon's target-search routine**, `CS:0x9e36` (called at `CS:0xC0A3`/`CS:0xC163`), and the code immediately around those calls reads/writes `[0x16a]`/`[0x16c]` as the familiar's own position for goal-seeking and comparison against the returned target — the same routine this document already documents the Hunter projectile using to home in on whichever on-screen creature has the lowest sprite id.
4. **The familiar stamps its own position onto the damage grid**, `CS:0xC2B6`–`0xC2DB`: `[0x16a]`/`[0x16c]` minus the scroll origin `[0xa]`/`[0xc]`, fed through the exact `DI = 0x16ca + (x>>3) + …` formula this document's `CS:0xA860` 2×2 stamp uses — so the familiar is a stampable/damageable occupant of the shared projectile-collision grid, like a creature.

So "the second muzzle position" framing was half right and half a red herring: `DS:0x33d` does gate a muzzle switch in the fire path (already resolved by the port), but the *position it switches to* is not a second emitter offset at all — it is wherever the player's own familiar currently stands. A port that models the familiar as a tracked entity with a world position already has everything needed; one that treats `0x16a`/`0x16c` as a fixed alternate muzzle constant does not.

## Open questions — ranked

⚠️ **Numbered contiguously from 1, and that is load-bearing, not cosmetic.** This list previously ran `3…15` and then `11`, with items 1 and 2 orphaned ~1,500 lines earlier. Markdown renumbers an ordered list sequentially from its first marker, so the typed numbers never rendered as typed — and because the paragraph above ran straight into the list with no blank line, CommonMark refused to open a list at all and the whole block rendered as one run-on paragraph with `3.`, `4.` … as literal text. **Keep the blank line above, and keep the numbering starting at 1.**

1. ~~`UNKNOWN_hero_combat_details`~~ — **CLOSED**. The fire-slot allocator was already decoded (see *`UNKNOWN_hero_combat_details` — the fire-slot allocator `0x95ca`, decoded* above). The death/respawn reset set is now closed too — see *The death/respawn reset set — CLOSED*, in the weapon-slot/projectile-record area: `FUN_1000_09bb` is the death-*animation* tick driver, not a reset, and forks at `CS:0x093A`'s `dec word[0x224]` into either respawn (`CS:0x0845`, already documented) or game-over (`CS:0x0943`, which exits straight to the attract-mode cycler with no state reset at all — the real "new game" reset happens later, when "BEGIN QUEST" is chosen again).
2. ~~`UNKNOWN_asset_load_segments`~~ — **CLOSED `[STATIC]`**, see *the three overlay target segments* under *`GAME.EXE` memory layout*. Not BSS — all three are MZ-relocated constants; runtime targets are `0x40EC` (unpack.exe), `0x3DB3` (vga/ega.exe), `0x4031` (sound driver).
3. ~~`UNKNOWN_TABLE_1FFD_0088`~~ — **CLOSED `[STATIC]`, re-verified with two prior errors fixed**, see *`UNKNOWN_TABLE_1FFD_0088` — CLOSED* under *Graphics: `VGA.EXE` is a mode 0Dh driver*. It is a 16-word (32-byte, not 30) copy of `PBACKSCR.PI1`'s palette at `DS:0x86`, but **byte-swapped into native x86 order** at build time (not big-endian like every other on-disk palette in this document — confirmed by an exact byte diff against the swap of the real `.PI1` bytes), fed via a preloaded `SI` into graphics export 9 (palette fade-in, 8 fixed passes not 16) from five call sites in `GAME.EXE`. A re-read of `VGA:0x1F6A` found its own `mov si,0x12` clobbers the caller's `si` before the `DS:0x35` branch, so the DAC push actually reads a separate working buffer `DS:0x12` (ratcheted toward `DS:0x86` inside export 9's own loop), not `DS:0x86` directly as the previous close claimed — which also closes both loose ends the previous pass left open (`UNKNOWN_export9_ax_param` = a retrace-wait speed knob; the `DS:0x35`-gated path is a DAC-write-method choice, not a second data source).
4. ~~`UNKNOWN_palfils_0320`~~ — **CLOSED `[PROVEN]`**, see the section of that name under *`PALFILS` feeds the trigger system*. Structurally "event record −1," reached by an `arg=0`/`16384`/`32768`/`49152` aliasing bug in `COND5`/`COND6`/`ACT5`; a genuine wild-jump path for `ACT5`, provably never dispatched by any shipped `.MAP`+`PALFILS` pair.
5. ~~`UNKNOWN_pat_payload`~~ — **CLOSED `[STATIC]`**, see *`UNKNOWN_pat_payload` — CLOSED* under *Music formats*. Not audio — a per-class scripted movement path (start position + byte-per-tick signed-nibble delta stream), consumed via `CS:0xb987` from the selector-1 runtime table `DS:0xb6b8`.
6. ~~`UNKNOWN_mus_type2`~~ — **substantially CLOSED `[mixed]`**, see *`UNKNOWN_mus_type2`* and *The event payload — `PPLAYER.BIN`'s own parser, disassembled* under *Music formats*. `PPLAYER.BIN` was decompressed and disassembled in Ghidra this pass: the non-SMF blobs' event stream is a compressed re-encoding of real SMF meta-event syntax (type bytes `0x2F`/`0x51`/`0x7F` match SMF's End-of-Track/Set-Tempo/Sequencer-Specific exactly, plus a generic VLQ-length-prefixed skip for anything else), read through a dual-mode byte accessor whose "indexed" table pair is exactly the document's own already-located `0x201` mini-header/channel-table region and the `[1,19)` ascending-prefix region — proving those two ranges are a matched lookup pair for the first time. A sibling dispatcher re-implements MIDI's channel-voice status byte parsing (NoteOn/Off, PitchBend, Aftertouch; CC/ProgramChange recognised but discarded). Residual `UNKNOWN`: the channel table's 14 per-channel tail bytes, the blob20 channel split, three unread `0x7F`-body callees, and the trailing event-stream bytes proper.
7. ~~`UNKNOWN_sfx_id_space`~~ — **mostly CLOSED**, see the entry under *Sound: a 13-slot interface*. `0x49` is the alternate death sound (`DS:0x35e` nonzero), bracketed around exactly three contact-call sites (System A's pipeline, the world-1 statue hazard, and the `PGOD0x.PAT` driver) but never System B's — so those specific deaths are silent on every driver but Roland. Chasing the third bracket site (`FUN_1000_7b68`) also closed `UNKNOWN_8014_world1` (see *`UNKNOWN_8014_world1` — CLOSED*, under *`UNKNOWN_cfcc_cotenant` — CLOSED: a PLACED world-2 enemy*) — a previously uncatalogued world-1-exclusive "statue wakes up and attacks" scripted enemy.
8. ~~`UNKNOWN_joypos_owner`~~ — **closed negative, exhaustively**, see the entry under *`P*.JOY{G,L}{1,2,3}.DAT` → recorded attract-mode input, not sprite data*. `PJOYPOS.DAT` doesn't ship, and a clean-byte search for `"joypos"` across all 16 shipped executables — the four still-PKLITE-packed ones freshly unpacked with `deark` for this pass — finds zero references anywhere. Residual narrows to the same register-pointer blind spot this project can never fully rule out for any string.
9. **The chain is broken between MOVE and STAMP — that is the real blocker, not the fire entry.** ⚠️ An earlier revision of this list called `UNKNOWN_fire_state_entry` "the last gap"; that was wrong. Three separate breaks remain, and the middle one is the one that stops a hit happening at all:
    - ~~`UNKNOWN_projectile_stamp_sites`~~ — **CLOSED.** The stamp is reached through the 3-entry draw-style table at `DS:0xdf26` (weapon `+0x02`), and the port now stamps. The chain fire→allocate→spawn→move→stamp→scan→damage is **continuous and tested end to end**.
    - ~~`UNKNOWN_projectile_movers`~~ — **CLOSED**, all six decoded and ported.
    - ~~`UNKNOWN_fire_state_entry`~~, ~~`UNKNOWN_fire_state_356`~~, ~~`UNKNOWN_hunter_turn`~~ — **CLOSED**.

   What remains in this subsystem: ~~`UNKNOWN_tag_fd`~~ — **CLOSED**, see *`UNKNOWN_tag_fd` — CLOSED* under *Other grid users* above: no producer exists anywhere in `GAME.EXE` (exhaustive byte-write sweep), and a real, matching consumer at `CS:0xE5B9` (System A's attack/leap reach-scan) is permanently dead as a result — the game's fifth cut feature. ~~`UNKNOWN_hunter_negative_tag`~~ / ~~`UNKNOWN_e4e2_reach_table`~~ — both **CLOSED**, see *`UNKNOWN_e4e2_reach_table` and `UNKNOWN_hunter_negative_tag` — CLOSED* under *Other grid users* above: the reach table is one global 48-cell two-ring spiral (not per-class), and the hunter's target "key" is the entity's own sprite id, not a tag or distance. New, narrower residuals from that pass, both now narrowed with fresh evidence rather than left as bare "not decidable": `UNKNOWN_e4e2_displacement_drift` — see *`UNKNOWN_e4e2_displacement_drift` — root cause identified*, above: `AX` does double duty as both a hit-counter and (accidentally) the cursor's per-tick step size, a textbook single-variable-reuse bug shape, which the code advancing on *every* tick (not just hits) and accelerating from a 1-byte to a 2-byte step makes a more natural fit than deliberate jitter. It sits inside the already-proven-dead `0xFD` path either way. `UNKNOWN_hunter_key_intent` — see *`UNKNOWN_hunter_key_intent` — narrowed, not fully closed*, above: `CS:0x9E36`'s search loop is a complete, minimal "find the minimum," with no dead arithmetic suggesting an abandoned distance calculation — evidence for "deliberate cheap tie-break," though intent can never be proven from bytes alone. ~~`UNKNOWN_sysA_descriptor_0c`~~ and ~~`UNKNOWN_DS_0298`~~ are **CLOSED** — see the two closures inline above (under *the caller, `CS:0xE487`–`E4E1`*): `DS:0x298`/`DS:0x29a` is a pre-stage-2 velocity snapshot written by `CS:0xE001` itself, and `descriptor[+0xc]`'s shipped range is `1..10` across all 74 live System-A records. (`UNKNOWN_cfcc_cotenant`, listed here in an earlier revision, is closed — see *`UNKNOWN_cfcc_cotenant` — CLOSED: a PLACED world-2 enemy* above.)
10. ~~`UNKNOWN_DS_0034`~~ — **CLOSED `[STATIC]`**, see *`DS:0x34` is 0 in normal play — CLOSED* under *The starburst* and *`UNKNOWN_ce64_pool` — CLOSED* above. Two unrelated uses of one byte: a scripted-sequence engine (values 1/2, installed by trigger ACTION selector 11, freezes all entity AI while active) and a call-scoped bracket inside a sixth creature type's own contact test (`CS:0x7FD4`, object type 96, `DS:0xce64` pool, world 3 only). Only the second ever reaches the starburst/aura tag decode — the cutscene mode structurally cannot, since it freezes the very entity-AI calls that would reach it. Net effect: 10000 damage in normal play holds for the hero and every other creature, but object type 96 is capped at 50 from a starburst and immune to the aura, always, by ordinary code.
11. ~~`UNKNOWN_object_flag6_bits`~~ — **CLOSED `[STATIC]`**, see the section of that name under *`UNKNOWN_object_flag6` — CLOSED*. Exhaustive 256-instruction displacement-6 census closes to 23 genuine hits, all literal 0/1 — bit 0 is the whole story.
12. ~~`UNKNOWN_chest_key_surplus`~~ — **partly closed**, see the entry under *`UNKNOWN_chest_key_surplus` — partly closed*. Scanning all 800 trigger records across the 8 maps for a condition testing key 23 finds exactly two hits: the already-documented `PLEV3A #50`, and a previously-unread `PLEV4B #79` whose message text is **"you won't need that key anymore"** — world 4's copy of the key was never for the (unplaced) iron chest at all; it does something else, and this trigger just confirms it's done. World 2's two copies have no trigger reference anywhere and remain a genuine data question.
13. ~~`UNKNOWN_pobjects_field2`~~ — **CLOSED negative, exhaustively**, see the entry under *Fixed-size record tables*. Every one of the 14 sites that bases a register on the runtime descriptor `DS:0x2a4e` was checked; none ever reads offset `+0x2`. Dead padding, same family as the `.DAT` atlas's proven-dead `word2`.
14. Remaining small gaps — swept this pass (see `analysis/audit-2026-09/` for the self-audit that first flagged several of these as evidence-debt rather than research debt, i.e. tokens with no recoverable defining prose anywhere in the project):
    - ~~`UNKNOWN_map_header_word`~~ / ~~`UNKNOWN_map_header_table`~~ — **CLOSED**, see *`UNKNOWN_map_header_word` and `UNKNOWN_map_header_table` — CLOSED* under *The `.MAP` level format*. Both fields are provably unread by the parser (a blind `+2` skip plus a `count*2` arithmetic skip, no load of either).
    - ~~`UNKNOWN_camera_alt_path`~~ (`DS:0x32`) — **CLOSED**, see *`UNKNOWN_camera_alt_path` — CLOSED* under *The camera*. A 0/1/3-valued scripted-camera-pan-to-target mode, target `DS:0x2ec`/`0x2ee`, reset on every hero spawn/respawn.
    - ~~`UNKNOWN_alt_emitter`~~ (`DS:0x16a`/`0x16c`) — **CLOSED**, see *`UNKNOWN_alt_emitter` — CLOSED* under *Projectile collision*. It is the familiar creature's own world position, not a second muzzle constant.
    - `UNKNOWN_projectile_handlers` — the three genuinely-undecoded pairs (fireball 2/3, spear 6/7, time bomb 8/9) are **CLOSED**, see *`UNKNOWN_projectile_handlers` — CLOSED for the three that were actually still open*; entries 10/11 (hunter) and 14/15 (magic axe) were already decoded elsewhere in this document under different headings and only needed cross-linking, now done.
    - `POBJECTS` category codes `4`/`5` — category 5's **membership** is now settled (22 types, identical across worlds once the world-4 id drift is corrected for, every one blank name/description/value=0) — see *`pobjects-cat-4-5` — category 5 census* under *What category 4 is, from the data side*. Its **enum meaning** is still open; no dedicated code consumer was found for any of the 22 sprite ids in the object-array walk (search not exhaustive).
    - `UNKNOWN_unpack_ax_param` — the call site and the exact constant (`AX = 0x89F3`, a literal, not a same-segment callback address) are now `[PROVEN]`, see the section of that name under *Execution model*; `UNPACK.EXE`'s own interpretation of it is not, since that binary was not disassembled this pass.
    - `UNKNOWN_x_parity_at_spawn`, `UNKNOWN_act_dx_source` — **confirmed evidence-debt, not research debt**: the project's own self-audit (`analysis/audit-2026-09/items.txt`) already established both tokens occur exactly once in this document, as bare names inside this packed list, with zero defining prose anywhere in the project (ledger, port, or docs) — genuinely unrecoverable as written, not merely unresearched. For `act_dx_source`, if the intended question was "where does the trigger ACTION dispatch get its `DX` argument from" (the audit's own labelled guess, not a confirmed reading of a lost original), the answer is now on record: `CS:0x3A40`–`0x3A56`, the shared ACTION-verb dispatch prologue, never touches `DX` at all — unlike the CONDITION dispatch (`CS:0x3A58`, pre-loaded `CX`=kind/`DX`=arg by its caller `CS:0x39D1`), each ACTION handler must read its own `[DI+0x12]` arg directly. No corresponding guess resolves `x_parity_at_spawn`; the hero-spawn/respawn routine (`CS:0x8C30`–`0x8CC7`, read in full this pass while investigating `camera_init`) contains no parity test on any spawn coordinate.
    - `UNKNOWN_projectile_area_upper` — per the audit's own recommendation, downgraded to an **informational note, not answerable from the binary**: both the fire-slot allocator and the mover reach exactly 9 of a weapon slot's 18 record positions; the remaining 9 are provably untouched by both sides and most plausibly an authoring-tool or ST-port sizing artefact. Zero port impact.
    - ~~`UNKNOWN_playfield_height`~~ — **CLOSED**, see *`UNKNOWN_playfield_height` — CLOSED* under *The camera*. Live DOSBox framebuffer capture (two independent rooms) finds an identical, pixel-exact HUD border at scanline 160 in both — the visible playfield is the full 160-row backdrop, not the 144-row tile-coverage figure.
    - ~~`UNKNOWN_ladder_anim_phase`~~ — **CLOSED**, see *`UNKNOWN_ladder_anim_phase` — CLOSED* under *The ladder controls*. Atlas rendering plus a live DOSBox memory-read-and-screenshot cross-check (paused mid-climb, `DS:0x36b`/`DS:0x377` read directly) confirms `cl=1` = left-foot-forward, `cl=3` = right-foot-forward, `cl=0`/`cl=2` the two feet-together passing poses.
    - ~~`UNKNOWN_camera_init`~~ — **CLOSED**, see *`UNKNOWN_camera_init` — CLOSED* under *The camera*. The real-gameplay level-load/respawn/teleport camera origin is `FUN_1000_2189` (`CS:0x2189`–`0x21C1`): `spawnPos − (0x90,0x48)`, clamped to the exact same `0xec0`/`0x360` world-edge bounds the per-tick hero-follow camera already uses, fed by a previously-undocumented hardcoded per-world spawn table `DS:0xe8ca`. The two attract-mode-only teleport sites (`CS:0x8F47`/`0x8F83`) and a third, previously-uncounted one (`CS:0x8FB5`, demo-cycler state 0) are all inside the same block, gated behind `DS:0x3e7` — genuinely demo-only, not the real path this item asked about. The earlier claim that `CS:0x8C30`–`0x8CC7` "does not write `DS:0xa`/`0xc` anywhere" was true only because that range stops short of the function's real body, which runs to `0x8FD1` and reaches the camera-init call at `0x8CA7` well past it.
15. ~~`UNKNOWN_b1c2`~~ — **CLOSED**, see *`UNKNOWN_b1c2` — CLOSED* under *`UNKNOWN_hazard_emitter_placement`*. `FUN_1000_b1c2` and two structurally-richer siblings (`FUN_1000_b3ce`, `FUN_1000_b4e7`) are three permanently-dead "falling rock" particle systems sharing sprite atlas base `531 = 0x213` with the already-documented world-4/System-A/class-3 cut hazard — the sixth identified cut feature in the project. Exhaustive operand searches confirm no code anywhere ever seeds a live record or arms `b3ce`/`b4e7`'s self-modifying gates.
16. ~~`UNKNOWN_hunter_coast_reaim`~~ — **CLOSED**, see *`UNKNOWN_hunter_coast_reaim` — CLOSED* under *`UNKNOWN_hunter_turn` — CLOSED*. Not a periodic cooldown — the "cycling" input (`CX`) is a hardcoded literal `9` at the mover's own dispatch entry, so the threshold it builds is a fixed constant (`0x1B00`), making the whole mechanism a plain **0.8 s** (12 ticks at 15 Hz) one-shot delay between a hunter shot's velocity fully decaying and its tag flipping to homing. Also corrects an earlier claim in this document that the tag flips on the same tick velocity reaches zero — it doesn't; the flip is deferred to the end of this delay.

⚠️ `UNKNOWN_openlist_field4` was listed here *and* in the resolved list below. It is **closed** — the resolved entry is correct.

### Resolved by static (Ghidra + `ndisasm`) passes
**`UNKNOWN_d2be_pool`** (closed `[PROVEN]` — see *A sixth system: `DS:0xd2be`* under *`DS:0x8b4c` — debris*. It is a Bresenham-line fragment pool, fed by a previously-undocumented divert (`attackBits = (desc+0x4>>4)&3 != 0`) inside `CS:0xE659` to `CS:0xE5E4`, live and shipped (89 of 344 descriptors, census via `blast.py`). The single most consequential finding: it is a RAY, not a segment — the seed's four Bresenham loop bodies (`0xdd04`/`0xdd43`/`0xdd95`/`0xddd3`) have no destination check, and the per-tick walker `CS:0x7a0b`'s resume-pointer trick always lands back in the SEED's own copy (which re-writes the same resume constant every pass), so `7A0B`'s OWN destination-check loops — byte-identical to the seed's otherwise — never actually run. Caught by re-reading all four seed finalize sites against all four `7a0b` finalize sites before writing any port code, not empirically. Ported as `gods-web/src/game/line-hazard.js`; the spawning side has no entity-AI caller yet, same posture as `enemy-shots.js`'s other five undocumented emitter pairs),

**`UNKNOWN_tag_fd`** (closed `[STATIC]` — no code in `GAME.EXE` ever writes damage-grid tag `0xFD`, checked on **both** ways a byte can reach the grid: every `MOV r8,imm8` register-load encoding and every `MOV byte[mem],imm8` addressing form (twelve ModRM shapes) were swept for the literal value across all 4 initialized code blocks, zero hits, cross-validated against the two known immediate-store producers found in the same pass — the familiar's direct 4-cell stamp (`CS:0xC2B6`, hardcoded `AL=0xFF`) and the invulnerability aura's direct single-cell stamp (`CS:0xA9AE`, hardcoded immediate `0xFE`, a stamp shape distinct from the shared `CS:0xA860`/`CS:0xA8B8` routines and previously undocumented); separately, the shared register-copy stampers `A860`/`A8B8` (both `MOV CL,byte[DI]` then copy `CL`, `A8B8`'s body read in full here for the first time) were traced through their complete, enumerated caller lists, and every caller's `DI` is bounded either to the starburst's fixed `0xFC` byte or to a projectile record whose tag field has exactly one writer, a formula capped at 27 — nowhere near `0xFD`. A genuine consumer was found at `CS:0xE5B9`, inside System A's pipeline stage 3 (`CS:0xE487`, the descriptor-gated attack/leap special action, `FUN_1000_e4e2`'s reach-table scan), which explicitly excludes tag `0xFD` from counting as a valid target — so the tag decoder's dead `0xFD` branch and this scan's exclusion case were both built for a fourth kind of grid occupant that the shipped game never places: the fifth identified cut feature in this project. Static coverage only — a DOSBox watchpoint on the grid would be needed to rule out runtime corruption and promote to `[PROVEN]`), **`UNKNOWN_e4e2_reach_table`** and **`UNKNOWN_hunter_negative_tag`** (both closed `[STATIC]` — full disassembly of `FUN_1000_e4e2` shows the "class-indexed reach table" premise was wrong: both stream cursors reset to the same fixed `0xda08`/`0xda68` immediates on every call, with no per-class offset applied anywhere in the caller (`CS:0xE487`) either, so it's one shared 48-entry table, not per-class ones. Read as raw bytes, the reach-offset table decomposes exactly into two concentric square rings around the entity's own 4×4-cell box (ring 1: 20 cells at 1-cell distance, ring 2: 28 cells at 2-cell distance, 20+28=48 with zero slack), and `descriptor[+0xf]` sets scan *depth* into that shared spiral via the budget rate `CH`, not a table selector — closing "which System-A classes reference them" as a malformed question (none do individually). A second, previously-missed correction to the `tag_fd` closure fell out of the same read: the `0xFD` exclusion at `CS:0xE5B9` fires only in one of *two* parallel scan loops (gated on entity fields `[di+0xa]`/`[di+0x24]`) — the other loop (`CS:0xE5D1`) never loads the tag byte into a register at all and would accept `0xFD` as a valid target, though this can't matter in practice since nothing ever stamps `0xFD` to the grid. Separately, `UNKNOWN_hunter_negative_tag` closed for an unrelated reason: the hunter's target-list "key" (`CS:0xAA8D`) is neither a distance nor a grid tag but the entity's own currently-computed sprite id, confirmed identically in both entity systems (System B via `CS:0xF0AE`, called as the last instruction of every `DS:0xdbe0` movement handler; System A via `CS:0xE199`, its own sprite-formula resolver) — so "smallest key wins" (`CS:0x9E36`) actually means lowest on-screen sprite index wins, an authoring-order artifact rather than a distance/threat heuristic; sprite ids are always small and positive, so a genuinely negative key never arises. A related theoretical hazard (`CH=0`, `descriptor[+0xf]==16`, would infinite-loop the scan) was checked directly against data by `blast.py`-decompressing all 8 `PALFILS` files and reading every live System-A descriptor's `+0xf` byte: values are `{0,6,9,10,12,13,14,15}` across all 74 live records, `16` never occurs), **`UNKNOWN_DS_0034`** (closed `[STATIC]` — two unrelated uses of one byte, found by an exhaustive `C6 06 34 00 ??` sweep that turned up a second, previously-missed writer at `CS:0x7FD4`. Values 1/2 are a scripted-sequence/cutscene engine installed by trigger ACTION selector 11 (`CS:0xC49C`), which freezes all entity AI while active; `CS:0x7FD4` is an unrelated one-call save/force/restore bracket inside a newly-identified sixth creature type's own contact test. Only the bracket ever reaches the starburst/aura damage-reduction branch, because the cutscene mode freezes every call that could reach it — see `UNKNOWN_ce64_pool`), **`UNKNOWN_ce64_pool`** (closed `[STATIC]` — a third 10-slot × 10-byte creature pool at `DS:0xce64`, allocator `CS:0x7F0D`, sole caller `CS:0x1C7D` gating on sprite `0x10a` = object type 96 (one of the seven already-catalogued unnamed category-4 types), placed 6× total across `PLEV3A`/`PLEV3B` and nowhere else (world 3 only, confirmed by decompressing and parsing all eight `.MAP`s). Its per-tick update honours the "freezes aliens" potion (`DS:0x2fa`) like System A/B, and its hero-contact-test call is bracketed by `DS:0x34=1` (`CS:0x7FD4`–`0x7FDD`), which — via the shared tag decode `CS:0x9320` — caps this one creature's starburst damage at 50 and makes it immune to the invulnerability aura, in ordinary play, every time it is standing on a stamped cell during its own update), **`UNKNOWN_enemy_shot_other_emitters`** (closed — split into three real mechanisms plus a false lead, all under *The five other emitter-pair owners* / *`CS:0xE99F`/`CS:0xEFA2`* in the enemy-shots section. Two emitter pairs belong to a newly-found per-tick driver, `CS:0xAD88`, for the already-documented selector-2 spawn system (`DS:0xaec0`); two belong to the already-closed `PGOD0x.PAT`/selector-1 system, one of them (`CS:0xBC4B`) a generic "fire in my direction of travel" behaviour wired to 11 of 14 System-A-table classes, the other (`CS:0xBD9F`, world 4 class 2) a dedicated pair sitting one class before the already-documented cut hazard in the identical table — which reattributes that hazard's would-be runtime consumer from a bare System-A entity to this same selector-1/PAT mechanism. One (`CS:0xE659`) is genuinely generic code shared by both real entity pipelines (System A pipeline stage 6, System B's per-frame driver), reachable from 71 of 344 live group descriptors, System-A-exclusive-in-world-4-never (it always diverts elsewhere there). And `CS:0xE99F`/`CS:0xEFA2` turn out not to touch the shot array at all — the shared `0x8954` literal is a coincidence, since `DS:0x8314 + 200×8` (the object array's own exclusive bound) equals it; they are a previously-undocumented "steal a nearby marked pickup, carry it, probabilistically respawn a fresh copy" mechanic implemented once per entity system, gated on the already-documented "attracts monsters" marker-seek strategy), **`UNKNOWN_palfils_0320`** (closed `[PROVEN]` — the 4 constant bytes are "PALFILS event record −1," reached by a 16-bit underflow (`arg` ∈ `{0,16384,32768,49152}`) in three handlers' `si = 0x932c + (arg−1)*4` arithmetic. Harmless for `COND5`/`COND6`; for `ACT5` a genuine wild call into the System-A group-runtime array via an unguarded jump-table overrun — structurally proven, and shown to be unreachable in every shipped `.MAP`+`PALFILS` pairing because the one record that would trigger it, `PLEV3A` #50, has no wired entry point into its own `PALFILS.0A3` event slot), **`UNKNOWN_pat_payload`** (closed `[STATIC]` — refutes the "8-bit PCM" framing statistically (10–30× noisier than the one confirmed real-PCM asset, `PDEMOSB4.SB`) and structurally: `PGOD0x.PAT` is a per-class scripted object, a start position plus a byte-per-tick signed-nibble delta path, consumed every tick via `CS:0xb987` from the selector-1 runtime table `DS:0xb6b8`, spawned only on sublevel `'a'`, targetable by the Hunter weapon's homing list. "PAT" most plausibly abbreviates *path*, not *patch*), **`UNKNOWN_object_flag6_bits`** (closed `[STATIC]` — an exhaustive 256-instruction census of every `+0x6`-displacement addressing form in the image, closed by a provable 8-site register-load closure down to 23 genuine hits on the object array, every one a literal 0 or 1; bit 0 is the whole story), **`UNKNOWN_TABLE_1FFD_0088`** (closed `[STATIC]`, re-verified — a 16-word/32-byte palette at `DS:0x86` (one word earlier than the ranked item's own "30 bytes at `0x88`" framing), decompressed-and-diffed against `PBACKSCR.PI1`'s own on-disk palette to an exact 16/16 value match — a real, `GAME.EXE`-owned asset via Table 1 Block B, not an orphan — but, unlike the `.PI1` source it was compiled from, `GAME.EXE`'s copy is stored **byte-swapped into native x86 order**, not big-endian (an exact byte diff proves `game_bytes == byteswap16(pi1_bytes)`; an earlier close of this item asserted big-endian, which the diff refutes). The consumer eluded a direct-operand search because it is reached through a **preloaded `SI`**, not a memory operand: five sites (`CS:0x1269C/0x12CD4/0x12EEB/0x132DE/0x164BF`) run `mov si,0x86 / mov ax,0x1 / call 0x3596`, and `CS:0x3596` is the graphics export-9 (palette fade-in, a fixed **8** passes, not 16 — 16 is the per-pass colour count) thunk. Traced into `VGA.EXE`: `VGA:0x1F6A`'s own first instruction, `mov si,0x12`, clobbers the caller's `si` **before** the `DS:0x35` branch, so — contrary to an earlier close of this item — neither branch reads `GAME.EXE`'s `DS:0x86` table directly; both read a separate working buffer `DS:0x12` that export 9's own loop had already ratcheted toward `DS:0x86` one nibble-step per pass, and `DS:0x35` merely selects the DAC-write method (16× `INT 10h AX=0x1000` vs. one block `AX=0x1012`) for that same buffer — confirmed by a third caller of `0x1F6A`, graphics export 7 (palette blank), which zeroes `DS:0x12` and falls into the identical tail. Also closes two loose ends the previous pass left open: the uniform `AX=1` parameter is a fade-speed knob (`cx = AX+2` retrace-waits between passes), and the `DS:0x35==0` path is a DAC-write-method choice, not a second data source), **`UNKNOWN_asset_load_segments`** (closed `[STATIC]` — the three overlay target segments (`unpack.exe`, `vga`/`ega.exe`, the sound driver) are not BSS; they are MZ-relocated constants, confirmed by an exhaustive walk of all 93 relocation entries plus all 54 graphics/sound export-table segment halves. Runtime targets: `0x40EC`/`0x3DB3`/`0x4031`, given the already-established load bias `CS=0x1000`. `UNPACK.EXE`'s own `nrel=6` — versus the drivers' `nrel=0` — explains why only its relocation-factor word is meaningfully relocated), **`UNKNOWN_sysA_movement_layer`** (closed — System A has **no** `DS:0xdbe0`-shaped mode table; instead `CS:0xe001` runs a **fixed six-stage pipeline** every tick per entity (goal-seek velocity, a descriptor-gated attack, a second speed clamp, position-apply, facing), with the actual mode *selection* living in stage 1, `CS:0xe6e4`, which reads a sticky per-entity byte `[di+0x24]` and — on a fresh roll — dispatches through a **9-entry** table at `DS:0xd95c` via the exact nibble-pair/weight picker already documented for System B's pathfinder seed. `DS:0xd966` turns out to be `DS:0xd95c + 5 words`, not a separate table — System B's own picker just never needs the first five entries. Contact (`CS:0xff93`) and draw (`CS:0x3569`) are shared between both entity systems, not System-B-exclusive as this document previously said. A shipped-descriptor census (74 live of 400) shows only strategies 0–2 are ever chosen; the dead-RET entry and the four B-shared goal strategies are real but never selected), **`UNKNOWN_sysB_sprite_formula`** (fully closed — the earlier "bases only 6 apart" tension was two separate mistakes stacked: `DS:0xdf80`'s 8 pointers are **not** fixed-size records but tightly packed, `0xFFFF`-terminated, variable-length per-world-per-system tables, so reading past one's own terminator silently reads into the next table; and System A has its **own** class-lookup routine, previously unlocated, `CS:0xe199` off the sibling pointer `DS:0x1fe`, loaded by the also-previously-unlocated `CS:0xad62`, so pooling "6 apart" System-A entries with "18 apart" System-B ones was comparing two different tables as one. Direct disassembly of all three mode families (`CS:0xf1d7`/`0xf29e` walk, `CS:0xf4e5` fall, `CS:0xf316`/`0xf3ee` hop) proves `anim_base == 17` and a nonzero animation frame never co-occur — fall pins the frame to 0 on entry and hop never touches it at all — so the true max offset is 17 and the 18-slot spacing has no exceptions, not just none in the shipped data), **`UNKNOWN_nest_shot`** (closed — and it opened the game's whole **enemy-projectile subsystem**: `DS:0x8954`, 20 x 8, reached from **six** left/right emitter pairs, with a **second, completely separate hero-damage path** at `CS:0x4501` that bypasses `CS:0xac59`, the damage grid and the difficulty scalar, deals a flat 2, and — unlike contact — lets an invulnerable hero be passed *through* rather than eating the shot. It also attributes `CS:0x4516`, previously listed among the crouch sites without an owner, to the shot path rather than to contact), **`UNKNOWN_cfcc_cotenant`** (closed — the pool's other tenant is a **placed world-2 enemy**, not another cut feature: object type 115, `POBJECTS` category 4, 16 in `PLEV2A` and 16 in `PLEV2B` and nowhere else, reached from the object array by sprite id rather than from any entity table. Its caller tests `jz` where its sibling arm correctly tests `jc`, so a nest is **consumed whether or not it spawns** and fires exactly once; the sprite formula `0x204 + state` spans the whole signed state range and closes on nine consecutive frames whose art independently confirms the left/right assignment derived from two branch signs), **`UNKNOWN_hazard_emitter_placement`** (closed — the emitter is world 4 / System A / class 3 in the `DS:0xdf80` class tables, and **no shipped descriptor selects it**: the hazard is the game's fourth cut feature; the table↔system binding is proven by "no class index ever lands on an empty record", which fails if the two are swapped), **`UNKNOWN_cfcc_pool_sharing`** (closed — one ten-slot pool, two allocators, two walkers, two self-modifying gates, and ⚠️ **not** a shared counter: `DS:0x3b2` is reset at the top of each walker's own pass, so nothing survives between them — the genuine sharing hazard is the records), **`UNKNOWN_block_breaker_8bca`** (closed — the `DS:0xcfcc` ten-slot **falling hazard**, not the `DS:0x8b4c` debris a previous pass of this document named; the two differ by two bytes *in different segments*, and `CS:0x8b4c` is the modrm byte of a self-modifying `mov byte [cs:0x8b56],0xc3`), **`UNKNOWN_destructible_tile`** (closed — tile `0x6d` in worlds ≥ 3, a 40-entry damage queue at `DS:0xd0c6`, 200 cumulative damage to break, and a **`+50` mace bonus at `CS:0x74AF`** that has nothing to do with `+0x48`; broken blocks are restored from a 100-entry list at **`SS:0x46b0`** on level load), **`UNKNOWN_starburst`** (closed — an 80-slot particle array at `DS:0x8cfa` fed by an 8-pair compass-rose template at `DS:0xdd00`, with a **chain reaction** bounded by an age ceiling rather than a recursion guard; it stamps the damage grid with tag `0xFC` and **one-shots** in normal play, and the `[WF]` note calling `0xA549` "debris" was wrong about the source), **`UNKNOWN_consumable_handlers`** (closed — all 23 decoded, each confirmed against its own `POBJECTS` name/description; the three *weapon arc* potions swap the projectile velocity table between Y-spreads 3/1/10 matching `standard`/`intense`/`wide`, *freezes aliens* and *giant jump* write globals this document already knew from the consuming side, *"shield / reduces damage"* is a **shipped no-op**, and *"slows monsters"* has **no handler**), **`UNKNOWN_DS_0168`** (closed — the familiar's energy, which also makes the over-healing bank unreachable in shipped play), **`UNKNOWN_treasure_pickup`** (closed — `CS:0x184E`'s three-way branch, the three `"chest key"` types the formula names, the value→money/score award, and the ten-item burst a chest throws out; the burst's loot table is authored at stride 20 and read at 16, a **shipped bug** pinned by a second caller that reads it aligned), **`UNKNOWN_camera_init`** (closed `[PROVEN]` — see *`UNKNOWN_camera_init` — CLOSED* under *The camera*. The real-gameplay level-load/respawn/teleport camera origin is `FUN_1000_2189`: `spawnPos − (0x90,0x48)`, clamped to the per-tick camera's own `0xec0`/`0x360` world-edge bounds, fed by a previously-undocumented hardcoded per-world spawn table `DS:0xe8ca`; the two (in fact three) attract-mode teleport sites this document already had are a separate, demo-only block gated behind `DS:0x3e7`), **`UNKNOWN_pobjects_parser`** (closed — `CS:0x35FB`, which fixes the 48-byte record's field widths from its own immediates and promotes `+0x06` = **Value** from inference to decompile), **`UNKNOWN_object_flag6`** (closed — the runtime record's `+6` is "currently inside the activation box", written 0 for every map object at load and recomputed by `CS:0x11D3`; NOT sticky), **`UNKNOWN_key_pickup`** (closed — keys are category 2, rejected by the walk-in path with `stc`, and taken by CROUCH + FIRE through `CS:0x6069`; the inventory has exactly two clear sites, both full restarts, so keys carry across levels), **`UNKNOWN_f586_verdict_semantics`** (closed — `CS:0xf586` is a cost-bounded graph search, **not a BFS**, see the correction in *The enemy pathfinder*; the verdict `DS:0x2ac` is an 8-value first-move code decoded at `CS:0xf2ac`, and the two walk handlers test it against *different* constants), **`UNKNOWN_projectile_record`** (closed — the hero's projectile is **8 bytes** `{tag, x, y, dir}`, and the `0x18` the allocator strides is three of them; spawn is data-driven through the `DS:0xd88c` handler table, and weapon `+0x0e` is the **facing**), **`UNKNOWN_projectile_collision`** (closed — there is **no pairwise hit test**; collision runs through an 8x8 screen-space occupancy grid at `DS:0x16ca` that projectiles stamp and creatures scan, and the `0xaad1` routine this document called a "pixel-mask scan" is nothing of the kind), **`UNKNOWN_projectile_mover`** (closed — the main loop walks the three slots at `CS:0x9455` and dispatches on weapon `+0x1A` through a **separate 6-entry table** at `DS:0xd8ac`; the common mover applies a 6-entry velocity table at `DS:0xdf0e`), **`UNKNOWN_weapon_08`** (closed — it is the weapon's **pickup count**, `+0x06` its immutable base; duplicate pickups raise the projectile volley 1→2→3, and the shop refunds on the same difference),  **`UNKNOWN_EXPORT40_TARGET`** (*partly* closed — export 40's arithmetic is the pixel→plane-B-map pointer with the hero's rounded-column rule, and it "disagrees" with export 39 because they address two different grids; but its only thunk `CS:0xf544` is unreferenced, so `UNKNOWN_export40_live_caller` remains), **`UNKNOWN_sysB_hop_cursor`** (closed — the cursor decrements one index per tick from its seed and ping-pongs `−6`/`−5` at the floor; the `−8` run is the launch, not a tail), **`UNKNOWN_openlist_field4`** (closed — it is the node's cost; both pushers put it in BP, `CS:0xfd2c mov bp,dx` and `CS:0xfc81 xchg ax,bp`), **`UNKNOWN_selector_dispatch_base`** (closed — the plane-B selector dispatch is 1-based, `CS:0x603A dec ax`; the trigger evaluator is selector **3**, and `PLEV3A` dispatches 82 triggers rather than none), **`UNKNOWN_object_sprite`** (closed — `sprite = 170 + type`, or `302 + (type − 0xC0)` for weapons), **`UNKNOWN_state_4`/`_18`/`_19`** (closed — spawn-idle, and the crouch/inventory pair with a shortened hitbox), **`UNKNOWN_DS_0192`** (closed — `DS:0x192` is hero health and `DS:0x19a` the bar that lags it; the death test reads the bar), **`UNKNOWN_player_state_semantics`** (closed — all 29 states labelled, the transition graph extracted, left/right proven four independent ways), **`UNKNOWN_hero_sprite_anchor`** (closed — `DS:0x1ae`/`0x1b0` are a camera snapshot, so the anchor is exactly `(X, Y)`), **`UNKNOWN_map_trigger_verbs`** (closed — all 15 action verbs and all 17 condition predicates decoded), **`UNKNOWN_planeB_id_range`** (closed — plane-B value ≥ 3 is an event id into `DS:0x932c`), **`UNKNOWN_alfils_record_fields`** (closed — the 7000-byte region feeds the event and lever tables), **`UNKNOWN_wibble_invocation`** (closed — all 16 shipped executables clean-byte searched, `WIBBLE.EXE` is invoked by nothing), **`UNKNOWN_asset_owner`** (closed — every shipped asset now has a named owner), **`UNKNOWN_intro_sound_index`** (closed — an if/else dispatcher, not a table), **`UNKNOWN_alfils_layout`** (closed — level hint text + entity table; object type 69 is the trigger), **`UNKNOWN_pat_owner`** (closed — `1000:3855`, sublevel `'a'` only), **`UNKNOWN_map_section4`** (closed — the 100-entry trigger/event table), **`UNKNOWN_TGAME_delta`** (closed — 482 of 514 bytes are a Tandy banked-video row table; export 16 dropped), `UNKNOWN_apostrophe_glyph` (closed — glyph-index bias, the intro renders `HERO'S`), `UNKNOWN_pjoy_format` (recorded attract-mode demo input), `UNKNOWN_dat_word2` (**provably never read** — dead padding, safe to drop in a port), `PWEAPONS.*`/`POBJECTS.*` record layouts, **the full 41-graphics + 13-sound driver export interface**, **the `.MAP` level format and its parser**, **the `.MUS`/`.RL` music container (Standard MIDI Files)**, `BEZIER.DAT` (Bernstein cubic basis tables), the discovery that **asset parsing lives in the drivers, not `GAME.EXE`**, and the PKLITE-signature-offset citation error (`0x1e`, not `0x20`).

Two claims the adversarial verifiers **corrected** and that are worth not re-deriving wrongly: graphics export 29 is *a* descriptor producer but **not the one that reads `P*.DAT`** (that is export 22 — the `xchg al,ah` is the tell; 29 caches from VRAM with no byte-swap), and the sprite plane stride is `w*h/8 − 2`, not a fixed 64 bytes.

## Tooling

Moved to the `gods-re-tooling` skill (`.claude/skills/gods-re-tooling/SKILL.md`) — Ghidra MCP, DOSBox MCP, `blast.py`, and the `gods-web` port's verification tooling, with the same gotchas as before. Load it when actually running any of those tools.

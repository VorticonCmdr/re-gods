# Asset formats — the DCL container and decompressed layouts

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

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

The loader (`FUN_1000_2c82`) drives a 6-state attract-mode cycler (`DS:0x3e6` = 0..5) that patches a single ASCII digit into the already-known `"joyl1.dat"`/`"joyg1.dat"` templates (`1ffd:eacc`/`ead6`) to build `joyl1→joyg1→joyl2→joyg2→joyl3→joyg3` in turn, loading+DCL-decompressing each (`p`-prefixed, through the same shared loader everything else uses) into the shared buffer. Only the **`joyg`** loads jump into real gameplay code (`FUN_1000_6b00`) with the file driving the demo; the **`joyl`** loads stay inside the attract sequencer, and their exact playback-termination path wasn't conclusively traced (`0xFF`'s bit0 is also set, so the sequencer's own loop catches it on an earlier, different branch than the gameplay path's `0xFF` check — `UNKNOWN`).

**Which world each `joyg` segment plays, watched live end-to-end for the first time this pass** `[PROVEN]`: a full attract cycle was observed from one `"TOP TEN GODS"` screen back around to the next, and the three `joyg` segments visit **world 1 (both sublevels A and B in turn), then world 2, then world 3**, in that fixed order — confirmed via `DS:0x42`/`0x43` (world/sublevel) read live at each transition, and via the `FUN_1000_648b` `"LOADING <worldname>"` title card appearing exactly as documented (`"LOADING THE LABYRINTH"` at the world-3 transition, matching the world-name table's `THE LABYRINTH` = world 3 exactly). The demo never reached world 4 in the cycle observed. Each `joyg` segment ran only 15–20 real seconds before dying and cycling back to the hiscore screen — short recordings, not full playthroughs.

While in world 1 sublevel B, `DS:0x8014` (the statue-trigger table, see `UNKNOWN_8014_world1` above) was read live and matches the static prediction exactly: 8 populated records at tile columns 88–96, rows 8–10, tagged `0x23`/`0x24`, all with `fired = 0`, and `DS:0xcdec` (the awakened-statue runtime pool) entirely empty — i.e. the populator scan ran correctly against this real level load, though the demo's short recorded path didn't happen to trigger one before dying, so the *firing* half of the mechanism remains `[STATIC]` rather than watched live. A live-recording code path exists in the same reader (write instead of read, gated by `DS:0x3bd` being negative) but is **proven dead** in this shipping `GAME.EXE` — an exhaustive check of all 8 references to `DS:0x3bd` found no instruction that ever writes a negative value there. Presumably how these files were captured during development; that authorship claim is inference, not proof from this binary.

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


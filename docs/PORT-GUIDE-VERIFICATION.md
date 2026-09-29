# Verification of *Gods Game HTML5 Port Guide.md*

**Verdict: do not port from this document.** Its engineering scaffolding is fine, but **every binary-format claim it makes about this game is wrong**, and following them would produce a decoder that cannot read a single shipped file.

All checks below were run against the actual files in this directory. Nothing here is inference.

---

## Why it is wrong: the citations point at other games

The document is an LLM "deep research" export (note the German `Referenzen` heading and 25 inline base64 formula images). Its 23 references contain **zero** sources describing the DOS release. The load-bearing technical claims trace to:

| Claim | Cited source | Actually about |
|---|---|---|
| RNC1 compression | refs 3, 6 | **Magic Pockets** — a different Bitmap Brothers game |
| 16-bit packed tilemap words | refs 7, 8 | **Chaos Engine** — a different game |
| Lever puzzle bitmask table | ref 14 | GameFAQs for the **Sega Genesis** port |
| Ladder / wall-jump physics | refs 17, 18 | **Godot engine** forum threads |
| Frame loop, PRNG | ref 1 | **Speedball 2** — a different game |

The pattern is consistent: real facts about *adjacent* subjects, asserted about this one. That is why the claims feel plausible and are still false.

It also describes the DOS runtime as "Motorola 68000 assembly". The DOS release is 16-bit x86.

---

## Refuted claims — each empirically

### 1. "The overwhelming majority of data files use Rob Northen Compression (RNC1)" — **FALSE**

RNC1 files begin `52 4E 43 01` (`RNC\x01`).

```
files scanned in this directory : 145
starting with RNC\x01           : 0
containing the bytes "RNC" anywhere : 0
```

Every packed asset begins `00 06` — **PKWARE Data Compression Library** (implode/blast): literal mode 0, 4096-byte dictionary. Independently corroborated by `UNPACK.EXE`, which embeds the string `PKWARE Data Compression Library(tm) Copyright 1990-91 PKWARE Inc. Version 1.02`, and by decompressing all 119 `P*` files with a `blast` port — 119/119 succeed and consume their input exactly.

A port built on the guide's 18-byte RNC header parser would fail on file one.

### 2. "A 5th bitplane is embedded as a pixel-exact collision mask" — **FALSE**

| | bytes |
|---|---|
| 320×200 @ **4** planes + 34-byte header | **32034** |
| 320×200 @ **5** planes + 34-byte header | 40034 |
| **Actual `.PI1` decompressed size, every file** | **32034** |

Every `.PI1` is exactly 32034 bytes = Atari ST DEGAS low-res: 2-byte resolution word + 16 palette words + 32000 bytes of 4-plane bitmap. **There is no 5th plane; the bytes for it do not exist.** Collision comes from the tilemap's plane B, not from pixels.

### 3. "Maps are 256 columns × 64 rows of 16-bit packed cell words" — **FALSE**

Fatal arithmetic: 256 × 64 = 16384 cells × 2 bytes = **32768 bytes required**. The map's tile region is **16384 bytes** — exactly half.

The real structure is **128 × 64 = 8192 cells in two parallel 8-bit planes** (plane A = tile graphic byte, plane B = per-cell attribute / entity id), 8192 × 2 × 1 = 16384 bytes, which fits exactly. So the guide's bitfield unpacking (`0x01FF` tile id, `0x1E00` depth, `0xE000` attributes) decodes nothing real.

Its header table is also wrong. It claims width at `0x40`, height at `0x42`, max-tile at `0x44`, cells from `0x46`. Actual start of a decompressed map:

```
00000000: 0014 0006 0000 0001 0002 0003 0004 0005
          ^^^^ count=20   ^^^^ header word
```

`u16 BE count`, `u16 BE` header word, then `count` × `u16` — bulk begins at `4 + 2*20 = 0x2C`, not `0x46`.

### 4. "Tiles are 16×16" — **FALSE, they are 32×16**

Graphics export 17 clamps the tile index at `0x78` = 120.

- 32×16 tiles → 320/32 = 10 cols, 192/16 = 12 rows = **120 tiles = 0x78** ✓
- 16×16 tiles → 320/16 = 20 cols, 12 rows = 240 tiles ✗

Confirmed independently by rendering: all 8 levels decode to coherent platform geometry at 32×16 and fragment at 16×16.

### 5. "Audio is 4-channel ProTracker MOD driven by Paula emulation" — **FALSE for DOS**

Scanning every file for the MOD signature at offset 1080 (`M.K.` / `FLT4` / `4CHN`): **0 hits.**

The DOS release ships **Standard MIDI Files** — `PGODS.MUS` alone contains 70 `MThd` blobs (format 0, 1 track, division 420) — with **OPL2 instrument definitions carried inline as `FF 7F` sequencer-specific metas** in AdLib `.BNK` layout. Synthesis targets OPL2 at port `0x388`, Sound Blaster DSP, or MPU-401, selected by `GODS.INI`. `libopenmpt` / Paula emulation would play nothing.

*(The Amiga original did use MOD. That is the transplant.)*

### 6. "The shop sells Daggers, Maces, Spears, Firebombs, Bouncing Axes" — **INCOMPLETE / RENAMED**

`PWEAPONS.00x` holds **11** records of 0x50 bytes. Actual names in the shipped data:

`knife` · `time bomb` · `fireball spell` · `flame` · `lightning bolt` · `throwing stars` · `spear` · `axe` · `hunter missile` · `magic axe` · `mace`

Mace and spear match; the rest are renamed or missing, and the guide omits six items. (The `flame` entry's real in-game description is `"refugee from xenon ii"` — a Bitmap Brothers in-joke absent from the guide.)

### 7. "LEV1BAK.BIN" — **no such file**

The level files are `PLEV<world><sublevel>.MAP` (`PLEV1A`…`PLEV4B`).

---

## What the document gets right

Credit where due — these agree with independently proven findings:

- **320×200, 16 colours, 4-bitplane planar source art.** Correct.
- **320×200, 16 colours, 4-bitplane planar source art.** Correct.
- **Fixed-timestep accumulator loop, nearest-neighbour scaling, `imageSmoothingEnabled = false`.** Sound, generic HTML5 practice — but see the tick rate below; **50 Hz is the wrong number to put in the accumulator.**
- **Deterministic RNG matters for parity.** The principle is right. Everything specific about it is wrong (§8).

### 8. "Bind physics and AI to a fixed 50 Hz tick" — **WRONG RATE. The game logic runs at 15 Hz.**

This one is subtle enough that **an earlier revision of this document repeated the error**, so it is worth spelling out. 50 Hz is real, but it is the **music** rate, not the logic rate.

The sound-driver timer ISR (byte-identical in `ADL`, `BPR`, `ROL`, `TDY`):

```
inc byte [0x39]         <-- UNCONDITIONAL, every PIT tick
cmp byte [0x85],0 / jz ret
dec byte [0xa9] / jnz play
mov byte [0xa9],6 / jmp ret     <-- skip 1 in 6
play:  ... call the music player
```

`inc byte [0x39]` sits **before** the 5-of-6 divider, so `[0x39]` counts at the full PIT rate. Only the music call is divided.

`GAME.EXE`'s main loop ends `mov al,[0x3d6]` → `call 0x35ad` (graphics export 14). `[0x3d6]` has **exactly one write in the entire binary** — `mov byte [0x3d6],0x3` at `CS:0x0031` — so `AL = 3` always. Export 14 then spins:

```
VGA:0x0E60   cmp al,[0x39]
VGA:0x0E64   jnl 0xe60        ; wait until [0x39] > 3
   ...
VGA:0x0F0D   mov byte [0x39],0x0   ; reset (identical in EGA.EXE)
```

So one frame = **4 PIT ticks**:

| | |
|---|---|
| PIT channel 0 | 1193182 / 19886 = **60.0011 Hz** |
| Music (5 of every 6) | **50.001 Hz** |
| **Game logic / display (gate > 3)** | 60.0011 / 4 = **15.000 Hz** |

**Consequences for a port:** run the simulation at **15 Hz** and the music at **50 Hz** — they are genuinely different clocks. Every per-second figure derived from a 50 Hz assumption is 3.33× too fast. With the real constants below, walking is ~60 px/s (not 200) and a jump lasts ~1.53 s — which matches Gods' famously slow, committed jump.

*(Residual: `UNKNOWN_tick_bypass` — whether any code path skips the wait. Export 14 does skip it when `AL == 0xFF`, but `[0x3d6]` is only ever 3.)*

The rendering/compositing and frame-loop JavaScript is reasonable boilerplate. It is the *data layer* that is fabricated.

---

## Gameplay claims — audited against `GAME.EXE`

| Guide claim | Verdict |
|---|---|
| Gravity `0.4`/tick, terminal velocity `6.5` | **REFUTED** — gravity is `inc word [0x1b2]` = **+1 integer**, clamped at **10** |
| Deterministic LCG, seed `0x12345678`, multiplier `1103515245` | **REFUTED** — no LCG exists; 0 hits for those constants |
| Adaptive difficulty subsystem (5 tracked variables, 50-tick evaluator) | **REFUTED** |
| Thief state machine (steal → retreat → purge item) | **REFUTED** as described |
| AI ticked only in a ±200 px vertical window | **REFUTED** — no spatial gate on the entity tick |
| Lever bitfields evaluated against solution matrices | **REFUTED** (mechanism); the 5 Genesis rows unverifiable |
| Inventory is 4 slots | **CONFIRMED** |
| 5th item swaps and drops the held one | **REFUTED** |
| Fixed integer walk speed, no acceleration | **CONFIRMED** (it is ±4 px/tick on a *word*, not a byte) |
| Jump arc fully committed, no air control | **PARTLY** — committed on the rise, steerable while falling |
| Ladder snaps to tile **centre** | Snap **confirmed**, target refuted — it snaps to the tile **origin** |

### No floating point exists

Asked directly: `GAME.EXE` contains **zero x87 instructions** — 0 across Ghidra's 13421 disassembled instructions *and* 0 across all 76 un-disassembled code gaps (11705 more instructions), plus 0 occurrences of the FPU-emulator trap signature `CD 34`–`CD 3D`. So `0.4` and `6.5` cannot be literal constants.

Nor can they be fixed-point encodings, by a scale-free argument: the claim implies `gravity/terminal = 0.4/6.5 = 0.0615`, while the real ratio is `1/10 = 0.1`. **No scale factor fixes a wrong ratio.** (Separately, `0.4` is not exactly representable in binary fixed point at any precision.)

### The real hero physics `[PROVEN]`

```
CS:48b0  mov ax,[0x1b2]  / shr ax,1 / shr ax,1
CS:48b7  add [0x176],ax          ; fall-damage accumulator ONLY
CS:48bb  cmp byte [0x36d],0 / jnz ; gravity-disable flag
CS:48c2  inc word [0x1b2]        ; GRAVITY = +1, integer
CS:48c6  cmp word [0x1b2],0x0A
CS:48cd  mov word [0x1b2],0x0A   ; CLAMP = 10
```

Per tick while falling, `dY = 4 + v` with `v ∈ 1…10`, i.e. **5…14 px/tick**. Walk is `add`/`sub word [0x17a],4` — **there is no X-velocity variable anywhere in the binary**, so no acceleration to model.

**The jump uses no gravity at all — it is table-driven.** `CS:0x4f6f` indexes a 23-entry `int16` delta table at `DS:0xd922`:

```
0 0 0 0 6 6 5 4 4 3 2 1 1 0 -1 -1 -2 -3 -4 -4 -5 -6 -6
```

Exactly symmetric: 4 ticks of wind-up, 32 px rise, apex, 32 px descent, then hand-off to the fall state. At the real 15 Hz tick that is a **1.53 s** jump. A port that simulates the jump with gravity will not reproduce it — copy the table.

Air control is a **budget, not a lockout**: `DS:0x345` is capped at `3` steps (12 px) per fall and reset on entering the fall state.

### The real randomness `[PROVEN]`

Not an LCG — a **256-word table replayed cyclically**:

1. **Seed** — `sub ah,ah / int 1Ah / mov [0x122],dx`: the low word of the **BIOS tick count**, i.e. wall-clock. *So the original is **not** reproducible run-to-run — the guide's fixed-seed advice describes behaviour the game does not have.*
2. **Mixer** at `FUN_1000_2375` — a hand-rolled bytewise `RCR`/`XOR` shuffle, not a multiply. `GAME.EXE` contains only 14 `MUL`/`IMUL` total, all register-operand.
3. **Table** — 256 words generated at `FUN_1000_37f6` into `1ffd:7e14`, **regenerated once per level load**, with 1–2 entries forced to zero.
4. **Draw** — `FUN_1000_3836`, **59 call sites**, the game's sole random source: read `[0x7e14 + [0x160]]`, then `[0x160] = ([0x160]+2) & 0x1FF`.

### What the guide's puzzle model gets structurally wrong

Levers are real and three-lever banks are real — a census of 756 live trigger records finds 17 with three lever conditions, and levers {45,46,47} on `LEV3A/3B` appear five times with five different polarity patterns selecting five different actions. So "a combination selects an outcome" is genuine.

But it is **not** a bitfield indexed into a solution matrix. It is five separate 24-byte trigger records, each carrying three AND-ed `{kind, arg}` predicates. An exhaustive search of both the handler region and the lever-toggle region found **zero** bitfield idioms (`or reg,reg`, `or [abs],r16`, `rcl`/`rcr`, `xlat`). A single lever toggles with `xor byte [...+4],1` — one bit, one lever.

The guide's "requires prior U-D-D" state dependency is **structurally impossible**: lever bits live at `DS:0xa5f8` and are written *only* by the player's toggle; no trigger action can set a lever.

---

## Recommendation

Use `CLAUDE.md` as the data-format reference — every claim in it is tagged `[PROVEN]` / `[STATIC]` / `UNKNOWN` and traceable to a byte offset or a live trace. Keep this guide only for its HTML5 scaffolding, and treat every number in it as unsourced until checked.

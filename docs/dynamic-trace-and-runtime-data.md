# Dynamic trace, GODS.INI, HISCORES.BIN, and format validation

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

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

### A safe world-jump technique, and a sublevel limitation it hits `[PROVEN]`

For jumping directly to a chosen **world** (1–4) from a live session without touching level geometry blind: set an execute breakpoint at `CS:0x2d9e` (live segment `877`, i.e. `877:0x2d9e` = linear offset `11678` — this document's own established `DS=4970, CS=877` boot-deterministic paragraph pair, reproduced across multiple restarts this session) — the instruction reached immediately after the "Begin Quest" menu path (or the attract-mode cycler's own world-loading script) sets `DS:0x42` (world) and, right before, `JMP`s into the central level loader (`FUN_1000_2a37`). Pausing there and patching `DS:0x42` to any value 1–4 before `debug_continue` reuses the game's own clean, unmodified level-load code path — no raw EIP hijack, no plane/camera data mismatch. Confirmed working across three separate world jumps this session (1→2, 2→3, and repeated re-entries into 1 and 3), each time with the frame-pacing tick counter (`DS:0x39`) ticking normally afterward and a live screenshot showing genuine gameplay in the target world.

Once loaded, a **position write** (a single isolated `mem_write` to `DS:0x17a`/`DS:0x17c`, the hero's world X/Y) is enough to place the hero anywhere inside that already-loaded level without any further code-path trickery — used successfully to drop the hero directly into the world-3 scripted camera-nudge box (see *A scripted nudge exists*, above) instead of platforming there blind. This is strictly safer than patching world/sublevel variables mid-level, since only the hero's own coordinates are touched and the level's plane/camera/trigger state is left completely alone.

⚠️ **This breakpoint cannot be used to force sublevel B.** `DS:0x43` (the sublevel selector) reliably reverts to `0` (sublevel A) by the time gameplay actually starts, *regardless of what value it holds at the breakpoint and regardless of whether it is patched there at all* — confirmed by patching it to `1` (reverted), by leaving it unpatched at an observed value of `1` (also reverted), and by a genuine attract-mode load that itself set `DS:0x43=1` at the breakpoint (still reverted moments later once real gameplay started). So some step inside the central loader's own "fresh entry" path (`FUN_1000_2a37` or a callee) unconditionally resets the sublevel to `'a'` for this specific entry point, and the attract-mode footage that visibly plays sublevel B (documented earlier as part of the `joyg1` cycle) must reach it through a *different*, not-yet-identified transition — plausibly an in-level exit/door action or a lighter attract-cycler-internal reload that bypasses this reset. `UNKNOWN_sublevel_b_entry_point` — the actual code path that legitimately sets `DS:0x43=1` for real gameplay (as opposed to this reset-to-0 loader entry) was not located this session.

⚠️ **Correction, a later session — `FUN_1000_4828` is NOT this answer, and should not be read as one.** `FUN_1000_4828` (table slot `0x35e8`, bit 11 of the *`UNKNOWN_level_exit_destination`* bit-dispatch, see that section) does exactly the shape a sublevel-B entry point would have — `DS:0x43:=1` then a jump straight into the level loader at `0x1000:2a4a`, bypassing the full hero-reset routine — but bit 11 is **never set** in any of the four real `EXIT_DESTINATIONS` records (`LEVEL ONE`/`TWO`/`THREE` = `0x0502`/`0x0502`/`0x0702`, `GAME` = `0x0000`; none has bit 11), confirmed by direct `read_memory` of all four. So `FUN_1000_4828` cannot fire from the real, shipped level-exit flow — it is unreachable code with the right *shape*, not a confirmed entry point. Either a fifth destination record exists somewhere this project hasn't found, or `FUN_1000_4828`'s real caller (if any) is something else entirely. The attract-mode `joyg1` footage that visibly plays world 1 sublevel B therefore still has no identified transition mechanism — this closes off one candidate rather than answering the question.

`UNKNOWN_sublevel_b_entry_point` — **CLOSED, a later session, `[PROVEN]` live in DOSBox.** It was never a trigger/door mechanism at all — it's a hardcoded, attract-mode-only double-load baked into the shared level loader itself, unconditional on world index, so it fires identically for all three `joyg` segments.

An exhaustive sweep of every instruction touching `DS:0x43` (both `MOV`s and a check for any word-sized write straddling it via `DS:0x42`) finds exactly six writers in the whole binary: four force it to `0` (boot init `1000:0060`, `FUN_1000_031a` at `1000:0466` — inside that function's level-complete/tally block, the same `DS:0x42:=1`-adjacent reset `FUN_1000_006f` also carries, not an error path — the "Begin Quest" menu branch at `1000:2d9e`, and `FUN_1000_6b00` at `1000:6b0e`), and only two ever set it to `1` — the already-documented dead `FUN_1000_4828` (`1000:483e`, unreachable per the correction above) and **`FUN_1000_2df1` at `1000:2dfd`**, which is the answer.

`FUN_1000_2df1` is reached only from one place: the tail of the shared level loader `FUN_1000_2a37`, at `CS:0x2C34` (`CMP [0x3e7],0x0 / JNZ 0x1000:2df1`), i.e. only when the attract-mode flag `DS:0x3e7` is nonzero. A second exhaustive sweep (including the word-write hole at `DS:0x3e6`) finds `DS:0x3e7` is written in exactly three places, and only one of them is a real caller: `FUN_1000_2c82` sets it to `1` at `CS:0x2DE9`, **only inside the attract cycler's own `joyg` dispatch branch** (every `joyg1`/`2`/`3` state, unconditional on which); `FUN_1000_2df1` increments it once (`CS:0x2E02`); and `FUN_1000_8c34` (the per-level gameplay-init routine, called from `FUN_1000_006f`) clears it back to `0` at `CS:0x8F3B`. No real, non-attract code path can ever make `DS:0x3e7` nonzero, so `FUN_1000_2df1`'s sublevel-B branch is categorically unreachable from real gameplay — which is exactly why the world-1→4 "safe breakpoint" technique above never sees it.

The mechanism, read in full from `FUN_1000_2df1` (`CS:0x2DF1`–`0x2E20`) and confirmed by disassembling `FUN_1000_2a37`'s own tail (`CS:0x2A37`–`0x2C4D`) alongside it: a `joyg` dispatch (`FUN_1000_2c82`'s odd-state branch) sets the raw 0-based world and `DS:0x3e7:=1`, then calls `FUN_1000_6b00`, which turns the world 1-based and **forces `DS:0x43:=0`** (sublevel A) before calling the shared loader `FUN_1000_2a37`. That loader runs its full sequence — title card, plane/palette/text load, the works — for **sublevel A**, then at its tail (`CS:0x2C34`) sees `DS:0x3e7=1` and jumps into `FUN_1000_2df1` instead of returning to the menu. `FUN_1000_2df1` sets **`DS:0x43:=1`** (sublevel B) and `DS:0x38b:=1`, increments `DS:0x3e7` to `2`, and re-runs the *same* load sequence a second time — but starting from the equivalent of `CS:0x2A4A` (right after the title-card call, `FUN_1000_648b`, which it skips, so the "LOADING `<worldname>`" card is never shown twice) — this time loading **sublevel B**. At its own tail it re-checks `DS:0x3e7` (now `2`, `>1`) and this time falls through to real gameplay (`FUN_1000_006f`), which immediately calls `FUN_1000_8c34`; since `DS:0x3e7` is still nonzero there, `FUN_1000_8c34` runs its one-time attract-mode setup block — clearing `DS:0x3e7:=0` at `CS:0x8F3B` (so this only ever fires once per `joyg` segment) and hard-setting the hero/camera to a fixed per-world "showcase spot" (`DS:0x3e6==2`→world 1: camera `(0xce0,0x200)`, hero `(0xd60,0x260)`; `DS:0x3e6==4`→world 2: camera `(0xa0,0x340)`, hero `(0xa0,0x3c0)`; `DS:0x3e6==0`→world 3: camera `(0,0)`, hero `(0x60,0x50)`) — these three call sites are the same ones `docs/open-questions-history.md`'s `UNKNOWN_camera_init` closure (item 14) already named as "two attract-mode-only teleport sites (`CS:0x8F47`/`0x8F83`) and a third... (`CS:0x8FB5`, demo-cycler state 0)... gated behind `DS:0x3e7`," without giving their actual coordinates — the figures above fill that in — before finally resetting the `joyg` playback cursor (`DS:0x3bd:=1; DS:0x282:=0`) and handing off to the real per-tick loop. **Sublevel A is loaded but never once rendered as a gameplay frame** — no tick, no input poll, nothing happens between the two loads.

Live-confirmed this session for world 1's `joyg1` segment, breakpointed at all three key instructions in sequence: at `CS:0x2DFD` (about to execute `MOV [0x43],1`), `DS:0x42=1` (world 1, already converted to 1-based), `DS:0x43=0` (still sublevel A, pre-write), `DS:0x3e6=2`, `DS:0x3e7=1` — exactly the first-call state the trace predicts. At `CS:0x8F3B` (about to execute `MOV [0x3e7],0`), `DS:0x43=1` (sublevel B — the reload landed), `DS:0x3e7=2` — exactly the second-call state. (The hero/camera figures above are the exact hardcoded immediates from the disassembly, not a live re-read — a position read ~1 real second after this point had already drifted from them under the `joyg1` recording's own input, as expected.) The other two `joyg` segments weren't re-walked breakpoint-by-breakpoint this session, but nothing in the mechanism depends on which world it is — the dispatch is identical code for all three states — so it applies to worlds 2 and 3 without further live checking.

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

## `HISCORES.BIN` decoded `[PROVEN]`

This document had named `HISCORES.BIN` three times (as one of the three non-`P`-prefixed uncompressed assets, and as mutable runtime state written by the game rather than shipped) but never actually decoded its 216-byte format — the same kind of gap this session already closed for `SINCOS.DAT`. Its string appears twice (`DS:0xEA7F`, Table 2 `2f3d:5878`); the sole reader/writer pair is `FUN_1000_3211` (save) and `FUN_1000_3445` (load, which itself calls a third helper, `FUN_1000_3506`, not read this pass).

**Layout: 10 records × 20 bytes, plus a 16-byte trailing block.** The save routine writes `CX=0xD8`(216) bytes from a buffer at `0x45E`; reading the shipped file at that same stride splits it perfectly:

```
+0x000  200 B  10 × 20-byte TOP-TEN records
+0x0C8   16 B  4 × 4-byte XOR-obfuscated validation block (see below)
```

**Each 20-byte record is `{ name, NUL-padded, up to 18 bytes ; score, u16 LE, bytes 18–19 }`.** The name uses a **1-based alphabet encoding** (`A=1 … Z=26`, `0` = terminator/pad) — decoding all 10 shipped records this way gives **9 clean, unambiguous Greek deity/hero names, plus one generic placeholder**, confirming the encoding beyond doubt:

| rec | bytes | decoded |
|---|---|---|
| 0 | `01 01 01 01 01 01` | `AAAAAA` (a generic placeholder — the only record with a non-zero score field, `0x1978`/`0x7819` depending on endianness, plausibly the shipped default score to beat) |
| 1 | `08 05 12 01 03 0c 05 13` | `HERACLES` |
| 2 | `1a 05 15 13` | `ZEUS` |
| 3 | `08 05 12 01` | `HERA` |
| 4 | `01 10 0f 0c 0c 0f` | `APOLLO` |
| 5 | `10 0f 13 05 09 04 0f 0e` | `POSEIDON` |
| 6 | `04 09 0f 0e 19 13 15 13` | `DIONYSUS` |
| 7 | `01 12 05 13` | `ARES` |
| 8 | `01 14 08 05 0e 01` | `ATHENA` |
| 9 | `08 05 12 0d 05 13` | `HERMES` |

Matching the game's own already-documented "`TOP TEN GODS`" high-score screen exactly — nine Greek gods and heroes pre-populating the board, plus one generic filler slot. Records 1–9 all carry a **zero** score field; only record 0 (`AAAAAA`) has a non-zero one.

**`UNKNOWN_hiscores_score_distribution` — CLOSED: all 10 slots are designed to hold real scores; the shipped file is just a lightly-played capture `[STATIC]`.** `FUN_1000_3211` (the save routine) contains its own insertion-sort shift loop, `CS:0x329A`–`0x32B6`, reached whenever the insertion point `SI`/`BP` (passed in from wherever a new score is ranked against the table — not traced further here) doesn't already sit at the table's own end (`DI = 0x512`, exactly `0x45E + 9×20` — the last record's own offset, confirming the 20-byte stride this document already establishes): it copies each record down into the next slot (`REP MOVSW`, 20 bytes at a time) working backward from the end toward the insertion point, discarding whatever was in the last slot — the textbook shape of "insert a new entry, bump every lower entry down one place, drop the bottom of the list." So the mechanism is built to let a new score displace and rank against **any** of the 10 slots, not just slot 0 — the shipped file's "only record 0 has a nonzero score" shape is simply how this particular capture happened to look (a fresh or barely-played install), not a designed asymmetry between the slots.

**The trailing 16 bytes are a per-tick-state validation block, XOR-obfuscated per field — and it's the "other" `DS:0x432`.** `FUN_1000_3211` (save) writes four 4-byte values in sequence, each conditionally XORed:

```
3211  si = 0x526                          ; = 0x45E + 0xC8(200) — the LAST 16 bytes of the 216-byte buffer
321b  ax=[0x432] ; bx=[0x434]              ; a DS-relative scratch pair — see the correction below
3222  cx=ax|bx / jz 0x322f                 ; value exactly zero -> skip the XOR entirely
3228  ax ^= 0x616f ; bx ^= 0x4368          ; else XOR with a fixed per-field key
322f  [si]=ax ; [si+2]=bx ; si+=4          ; store, advance

3237  ax=[0x432] ; bx=[0x434]              ; the SAME source read again — a second, independently-keyed copy
3244  ax ^= 0x6e67 ; bx ^= 0x7345

3253  ax=[0x436] ; bx=[0x438]              ; a second scratch pair
3260  ax ^= 0x654d ; bx ^= 0x696e

326f  ax=[0x43a] ; bx=[0x43c]              ; a third scratch pair
327c  ax ^= 0x6f6e ; bx ^= 0x656c
```

⚠️ **Correction: this closes part of `UNKNOWN_ss432_indirect`.** That closure documented `SS:0x432` as a private two-instruction scratch pair and flagged "the six other `[0x432]` hits in the binary are `DS`-relative … and are a different variable" as unexplored. These are exactly those hits — a completely separate `DS:0x432`/`0x434` pair, unrelated to the `SS`-relative one, used here as (at least) one of the three 32-bit values this validation block protects. `[0x432]`/`[0x434]` is read identically by **both** of the first two sub-blocks (not two different sources), so the same 32-bit value is stored **twice**, each under a different XOR key.

### `UNKNOWN_hiscores_0x432_0x436_0x43a` — CLOSED: the "validation" block is inert — nothing ever computes it `[STATIC, exhaustive]`

**The load side (`FUN_1000_3445`, `CS:0x3467`–`0x34D4`) is the mirror-image decode of the save path — but there is no comparison anywhere in it.** It walks the same three destination pairs, `LODSW`/`XOR`(conditional on nonzero)/store — `[0x432]`/`[0x434]` decoded and stored, then **decoded a second time and stored again to the identical address**, silently overwriting the first result with the second (`CS:0x347D` then `CS:0x3497`), then `[0x436]`/`[0x438]` and `[0x43a]`/`[0x43c]` once each — ending in a bare `XOR AX,AX / RET`. So this is **not** a tamper-detection cross-check: the two on-disk copies of the same 32-bit value are never compared against each other, only the second one survives, and nothing branches on whether either decode "looks right."

**And an exhaustive program-wide sweep finds no OTHER writer for any of the three source addresses.** Every `MOV [addr], reg`-shaped write to `0x432`, `0x436`, and `0x43a` was enumerated directly (not sampled): `0x432` has exactly three hits total — one unrelated `SS`-relative variable (already documented) and the load routine's own two self-writes; `0x436` has exactly two — one unrelated `SS`-relative hit inside `FUN_1000_ef01` (System B's steal-and-carry mechanic, an unrelated coincidental-offset variable in the same family as the `+0x16`/`FUN_1000_ee00` false positive this session already caught) and the load routine's own write; `0x43a` has **exactly one** hit, the load routine's own write, full stop. **No game-logic code anywhere in `GAME.EXE` — no score update, no lives counter, no level-progress tracker — ever sets `DS:0x432`, `DS:0x436`, or `DS:0x43a` to anything.**

So the full picture: these three `DS:` pairs are read from the file on load, immediately re-serialized unchanged on the next save (since nothing in between ever touches them), and the "protect against tampering by storing one value twice under different keys" shape the save routine implies is never actually acted on by the load routine. This is a **coherent, self-consistent anti-tamper mechanism that was wired up but never finished or activated** — the write-twice redundancy exists, but the read-side comparison that would make it meaningful does not, and no real game state was ever connected to feed it in the first place. It joins this project's own established family of cut/unfinished features (the `flame` weapon, the familiar potion chain, the world-4 environmental hazard, the "treasure vault" trap object) — except this one is pure infrastructure, not gameplay content, and it explains cleanly why the shipped `HISCORES.BIN`'s trailing 16 bytes are all zero: not because a particular save happened to capture zero stats, but because there was never anything to write there in the first place.

⚠️ **Major correction, found live the next session: `DS:0x432`/`0x436`/`0x43a` are not an inert validation checksum at all — they are the game's LEVEL-SELECT PASSWORD SLOTS.** The closure above still holds as far as it goes (nothing in `GAME.EXE` ever computes a value for these three locations, and the save/load round-trip is exactly as described), but "anti-tamper scaffolding" was the wrong model entirely. See *The password / level-select screen* under *Dynamic trace*, discovered when the attract-mode demo briefly showed an `"ENTER A PASSWORD"` screen this document had never previously encountered.

⚠️⚠️ **CORRECTION, a later session — "nothing in `GAME.EXE` ever computes a value for these three locations" is ALSO wrong, and the earlier "exhaustive" writer sweep two paragraphs up missed it for a structural reason, not an incomplete search radius.** `FUN_1000_69d7` (bit 10 of the level-exit destination record's `+0x1e` dispatch — see *`UNKNOWN_level_exit_destination` — CLOSED*) writes exactly these three addresses, one per completed world, via the `DS:0x42a` password-pointer table it shares with the "ENTER A PASSWORD" consumer this section documents. The write is `MOV word[SI],BX` / `MOV byte[SI+2],AL` where `SI` was loaded from `DS:0x42a + world*2` — a **register-indirect** write through a pointer table, not a literal `MOV [0x432],reg` the earlier sweep's pattern search could ever match; the same blind spot this document keeps rediscovering (most recently for `FUN_1000_6ad4`'s key-inventory clear, found in the same pass). So a legitimate player who finishes a world for the first time in a session **does** get a real, working password written into the matching slot — the mechanism is fully wired end to end (generate → store if empty → display → later re-enter and match), not "wired for consumption with no producer."

### The hiscore name-entry screen — `FUN_1000_2eb0`, and a genuinely broken dead branch, not cut content `[PROVEN]`

Previously-undocumented: `CS:0x2EB0`–`0x3075` is the interactive input loop behind `"ENTER YOUR NAME HERO"` (`1ffd:eba7`), called from `FUN_1000_318f` (the game-over/hiscore-insertion sequence already on record) as `call 0x1000:2eb0`. It clears a 20-byte name-scratch buffer at `DS:0x3004` (reusing unused plane-A memory during this menu), draws the tablet screen, and loops: poll the game's own scancode-packed input (`DS:0x382`, via the already-documented `FUN_1000_241d`), poll the raw BIOS keyboard (`FUN_1000_2503` — `INT 16h` non-destructive peek, then a real read on a hit, `STC`/`CLC` reporting the result), redraw, repeat.

`FUN_1000_2503` itself works exactly as designed — verified live, see below — but its result is **discarded by a broken gate**, making the entire ASCII-keyboard half of this screen (letters, digits, `.`, Space, Backspace, Enter) dead code. This was wrongly assumed reachable in an earlier pass of this investigation; it is not, and a live DOSBox trace both explains why and shows what actually works instead.

**The gate, `CS:0x2F14`–`0x2F26`, disassembled and confirmed byte-identical between Ghidra's static image and a live DOSBox instruction trace:**

```
2F14  mov byte [0x37c],0        ; re-entrancy flag clear (already documented)
2F19  pop bx
2F1A  cmp byte [0x84],0x0       ; <-- clobbers the flags FUN_1000_2503 just set
2F1F  jnz 0x2f26                ; [0x84] != 0 -> grid-navigation path
2F21  jnc 0x2f26                ; [0x84] == 0 -> test carry... but see below
2F23  jmp 0x2fda                ; the ASCII classifier — PROVABLY UNREACHABLE
2F26  test byte [0x382],0x80    ; grid-navigation / fire handling starts here
```

**`JMP 0x2FDA` can never execute.** `CMP reg/mem, 0` can never set CF — unsigned subtraction of 0 never borrows — so `CF = 0` is guaranteed the instant `CS:0x2F1A` retires, regardless of what `FUN_1000_2503` set two instructions earlier (the intervening `mov`/`pop` don't touch flags, so the *only* flag-setting instruction between the BIOS check and this test is the `cmp` itself). Consequently `JNC` at `0x2F21` is **unconditionally taken** whenever `JNZ` at `0x2F1F` isn't — i.e. every possible outcome of this gate lands at `0x2F26`, never at `0x2F23`'s `jmp`. This holds for *any* value of `DS:0x84` and *any* result from `FUN_1000_2503`: the earlier framing in this document ("only taken when `DS:0x84==0` AND the carry flag... is set") was an analysis error — it silently assumed the carry survives the `cmp`, which no x86 `cmp`-against-zero ever allows.

**Confirmed live, not just from the disassembly.** Set an execute breakpoint on `FUN_1000_2503`'s own `STC` (live `CS:0x2511`, session segment `877`), pressed a real Enter key, and captured the CPU actually consuming `AL = 0x0D` with carry set (`EAX = 0x1C0D`, flags bit 0 = 1) at the breakpoint. Single-stepped forward through the exact gate above with `debug_step` and watched `EIP` land at `0x2F26` (the `test byte[0x382],0x80` grid/fire test) — **not** `0x2FDA` — confirming the dead branch empirically, not just on paper. Repeated Enter/Backspace presses that this session initially thought were "not registering" were in fact being correctly detected by the BIOS check every time and then silently thrown away by this gate — the input was never lost at the OS/emulator layer, it was discarded by the game's own code.

**The real, and only, way to submit a name is the on-screen letter grid via Fire — confirmed by completing it live.** With the emulator's execute breakpoints cleared (so the game runs at full speed), an `input_sequence` of 5× `KBD_right` (moving the grid cursor from index 34 to 39, the `"+"` confirm cell — see the already-documented `DS:0x385` cursor mechanics and the `==0x27(39) -> jmp 0x3030` dispatch) followed by `KBD_space` (GODS.INI's configured Fire key) drove the cursor to 0 and the whole screen transitioned from `"ENTER YOUR NAME HERO"` to `"TOP TEN GODS"`, with the name already sitting in the scratch buffer (`DS:0x3004`, decoded per this document's own 1-based alphabet as `AIQQQQBBBBBBBBB5` — leftover test input from earlier probing in this same session) now inserted into the rendered top-ten table. This closes the standing question from an earlier pass of this session outright: **`CS:0x3030` is genuinely the confirm-and-submit path** (plays a click sound, clears the page via export 15, and `RET`s out of the whole `FUN_1000_2eb0` loop, unwinding into `FUN_1000_318f`'s already-documented 16-byte name copy + `FUN_1000_3211` save) — but it is reached **only** through the grid's `"+"` cell, never through a keyboard Enter press, because the keyboard path can't reach anything past `CS:0x2F1A`.

**Net finding, and how it differs from this document's other dead/cut content.** Every other "cut feature" catalogued in this project (the `flame` weapon, the familiar potion chain, the world-4 System-A hazard, the damage-grid's `0xFD` tag, the second `DS:0x365` incrementer at `CS:0xD5F7`) is either unplaced level data or an unwired call target — code that would work if something pointed at it. This is different: `FUN_1000_2503`, the ASCII classifier at `0x2FDA`–`0x3075`, and the whole character-encoding scheme this session reverse-engineered from it (a-z → 1–26, 0-9 → 0x1D–0x26, `.` → 0x1B, Space → 0x1C, Backspace/grid-`.` → erase, Enter/grid-`+` → `CS:0x3030`) are all **real, correct, and permanently unreachable by construction** — a genuine authoring bug in the shipped `GAME.EXE`, not missing content. A player has never been able to type a hiscore name on a real keyboard in this release; the grid was always the only path, on every platform this binary shipped for.

### The title screen — a 3-option menu, cascading into hiscores, then into the attract-mode demo `[PROVEN]`

`FUN_1000_2c82` — this document previously described only as "the loader [that] drives a 6-state attract-mode cycler" — turns out to be much more: it is the **entire title-screen main-menu loop**, and the already-documented `joyl`/`joyg` attract cycler is just what it falls into after being left idle long enough. Read in full (`CS:0x2C82`–`0x2E26`), the structure is:

```
2C82  init: stop/reset sound (sound exports 6/12), load hiscores, world:=0, [0x3d7]:=0 (an outer "how many
        idle cycles" counter)
2CAF  <-- the state-machine head
2CB3  cmp [0x3d7],3 / jl continue  ; fewer than 3 full idle cycles so far -> keep showing the menu
2CBA  cmp [0x384],2 / jl continue  ; (a second gate on an untraced flag)
2CC1  jmp 0x2da6                    ; 3+ idle cycles -> FALL INTO THE ATTRACT-MODE joyl/joyg CYCLER
2CC4  reset the menu cursor (DS:0x385:=0) and the idle timer (DS:0x11e:0x120, the 32-bit level-timer
        pair, reused here as an IDLE counter); draw the menu (FUN_1000_317d)
2CF1  <-- redraw-and-poll head
2CF7  cmp [0x11e],100 / jl poll_input     ; idle timer < 100 ticks (~6.7s at 15Hz) -> keep polling
2CFE    clear page ; call 0x1000:32c0      ; timed out -> show the "TOP TEN GODS" HISCORE TABLE
2D07    jmp 0x2caf                         ; then go back to the state-machine head (bumping [0x3d7]
                                             ;   implicitly via whatever 32c0/its own ~500-tick wait does)
2D09  poll_input: call 0x241d (scancode poll) ; call 0x2503 (BIOS keyboard peek — result never tested,
        exactly the same silently-discarded-keyboard pattern as the hiscore/password screens)
        UP   -> cursor -1, clamp at 0, click sfx 0x119, redraw
        DOWN -> cursor +1, clamp at [0x386] (the option count), click sfx 0x119, redraw
        FIRE -> confirm sfx 0x233 (same sound the grid-entry widget uses to confirm), dispatch on cursor:
                cursor 0 -> world:=1, sublevel:='a', [0x391]:=1, JMP 0x1000:2a37   ; BEGIN QUEST
                cursor 1 -> JMP 0x1000:2e2f                                        ; ENTER PASSWORD
                cursor 2 -> [0x11a]:=1, JMP 0x1000:22ed -> INT 21h AH=4Ch(AL=1)     ; QUIT
```

**So the menu is exactly three options — Begin Quest, Enter Password, Quit** — the last confirmed by tracing `CS:0x22ED` to a plain `INT 21h AH=4Ch` (DOS terminate) with the exit code taken from `DS:0x11a`; exit code 1 lands in `GODS.EXE`'s own already-documented "anything but 0 or 5 → `Thank you for playing GODS.`" branch. **Both real menu choices converge on the same continuation** — `JMP 0x1000:2a37` (world 1) and the password routine's own `JMP 0x1000:2ea0`/`2ea8`/`2d9e` tail both land at `CS:0x2d9e` (`sublevel:=0`) immediately before that same `JMP 0x1000:2a37`, the central level loader this document already extensively documents.

**Idle timeout has two layers, not one.** Leave the menu alone for ~6.7 s and it shows the hiscore table (`FUN_1000_32c0`, which itself waits roughly 500 ticks for a keypress before clearing and returning); do that **three times in a row** with no real input in between (`DS:0x3d7` reaching 3, alongside an untraced second gate on `DS:0x384`) and the loop instead falls into `CS:0x2da6` — **the already-documented 6-state `joyl`/`joyg` attract cycler**. So "attract mode" is not a parallel top-level state in this game; it is what the *title-screen menu itself* degrades into after being ignored for long enough — a detail this document previously had no model for at all.

**The `joyl` states feed their recording into this very same menu loop, which is why the demo briefly shows the password screen.** `CS:0x2DBA`–`0x2DD2`: an even cycler state loads `"joylN.dat"` into the shared playback buffer, sets `DS:0x3bd:=1` (playback), and jumps straight back to `CS:0x2cc4` — the menu's own redraw-and-poll head. So a `joyl` segment is simply **the recorded demo navigating this same title menu with fake joystick input** (real gameplay's per-frame `DS:0x382` poller is the same one the menu's own UP/DOWN/FIRE dispatch reads), which is exactly how the attract-mode session ended up briefly opening `"ENTER A PASSWORD"` — the developers scripted the demo to show off the menu, including a peek at the password screen, before it navigates to Begin Quest.

**The `joyg` states set the world with a two-stage indexing scheme worth getting right.** `CS:0x2DD5`–`0x2DE9` computes `W = (state−1) >> 1` for the odd states 1/3/5, giving **0, 1, 2** — not 1, 2, 3 — and stores that raw 0-based value into `DS:0x42` before jumping to `FUN_1000_6b00`. It is `FUN_1000_6b00` itself (`CS:0x6B00`–`0x6B0B`, confirmed by direct disassembly) that does `AL=[0x42] / INC AL / (wrap 5→1) / [0x42]:=AL` — turning the raw 0/1/2 into the real 1-based world 1/2/3 the rest of the game expects. This two-step handoff is exactly why this session's own live reads showed `DS:0x42 = 1, 2, 3` for the three `joyg` segments (matching real play) even though the attract-cycler's own arithmetic computes 0, 1, 2 first — both readings are correct, at two different points in the call chain, and a port modelling only one of them would misnumber the demo's own world selection.

### The title screen's visual appearance, and the password/hiscore grid's exact layout `[PROVEN]`

A later session, prompted by the sibling `gods-web` port initially guessing wrong (it drew `PSTATUS.PI1`'s status-panel border behind the menu, reasoning only from that file's own boot-time load order — see `docs/drivers-and-memory.md`'s `PSTATUS.PI1`/`PSTAT3.PI1` entry), booted straight through `GODS.EXE`→`INTROV.EXE`→`GAME.EXE` with no breakpoints and screenshotted the real menu:

- **The backdrop is `PBACKSCR.PI1`, drawn FULL-SCREEN, not `PSTATUS.PI1`'s 40-row status band.** The live capture shows one continuous image — a brick/stone wall with a large skull motif — behind the GODS logo and all three menu options, with no distinct HUD strip at the bottom at all. This closes `docs/drivers-and-memory.md`'s own "only its palette is proven to feed a generic fade helper, not that its bitmap is ever blitted anywhere" gap for `PBACKSCR.PI1` — the bitmap IS blitted, as the title screen's own backdrop. `PSTATUS.PI1`'s boot-time VRAM write (`CS:0x2a01`) is still real, just transient: `PBACKSCR` evidently loads full-screen afterward and overwrites it, before a player ever actually sees the menu.
- **The menu option's own text is `"ENTER PASSWORD"` (no `"A"`)** — legible directly in the capture — a DIFFERENT string from the password screen's own title, `"ENTER A PASSWORD"` (`1ffd:eb96`, see below). Two distinct strings for two distinct UI elements, not one string reused for both, which an earlier pass of the sibling port had assumed.
- **The selected menu option is flanked by inward-pointing arrows on both sides** (`> BEGIN QUEST <`), not a single leading marker.
- **The password/hiscore letter-grid is 8 columns x 5 rows (40 cells)**, read directly off a live capture: row 1 `A-H`, row 2 `I-P`, row 3 `Q-X`, row 4 `Y Z . <space> 0 1 2 3`, row 5 `4 5 6 7 8 9` then a left-arrow erase icon then a distinct circular confirm icon (neither icon matched to a `PSMLFNT` glyph — their own sprite source was not chased down this pass). Row 4's middle cell (obscured by the skull artwork in every screenshot taken, cursor-icon-on or off) is read as space rather than confirmed pixel-for-pixel, resting on the already-established alphabet ordering (`.` then Space, `docs/dynamic-trace-and-runtime-data.md`'s own hiscore-entry section above) rather than a clean read.
- **This CROSS-VALIDATES against this document's own earlier finding, two sections up**: moving the cursor "from index 34 to 39" via "5x KBD_right" while completing a real hiscore entry. Row-major index 34 in THIS 8x5 grid is row 4 col 2 (the `6` cell); index 39 is row 4 col 7 (confirm) — exactly 5 columns apart, matching "5x KBD_right" exactly. Two independent sessions' worth of evidence (one byte/cursor-level, one purely visual) pin the same grid down from two different directions.

### The password / level-select screen — `FUN_1000_2e2f`, moved to its own document `[PROVEN]`

Found live: watching the attract-mode demo cycle through its title-screen states (see immediately above), it briefly showed a screen this document had never encountered — `"ENTER A PASSWORD"` (`1ffd:eb96`), on the exact same letter-grid tablet UI as the hiscore name-entry screen. Tracing it fully resolves a real game feature — a level-select cheat/password system — and **retroactively corrects** the `HISCORES.BIN` closure above: the three `DS:0x432`/`0x436`/`0x43a` fields that closure called "inert anti-tamper scaffolding" are, in fact, the storage for this feature's three passwords.

**The full entry/match algorithm (`FUN_1000_2e2f`), the password table, the attract-mode `"L"+digit` bypass, the hiscore-screen hint text, the real generator this document's own earlier pass here originally missed, and three real passwords captured live from it now live in their own dedicated document: see `docs/passwords.md`.** That document supersedes this section, including its own now-superseded "no producer" claim and correction.

### In-gameplay ESC (quit) and P (pause) — `FUN_1000_031a`'s own ASCII keyboard poll `[PROVEN]`

Not previously documented anywhere in this project: the per-tick gameplay function `FUN_1000_031a` (called from the main loop `FUN_1000_006f`, `CS:0x0092`) polls the raw BIOS keyboard once per frame at `CS:0x0335` (`CALL FUN_1000_2503`, an `INT 16h AH=1` peek then `AH=0` read, `CF` set only on a hit, `AL`=ASCII/`AH`=scancode). This is a *separate* mechanism from the movement/fire input (the packed byte at `DS:0x382`, built from a raw-scancode `INT 9` ISR the driver installs — `docs/drivers-and-memory.md`'s exports 33-35 — and scoped, per the shipped `GODS.INI`, to exactly the 5 configured scancodes: up/down/left/right/fire). `FUN_1000_2503` has only 4 call sites in the whole binary — this one, the title menu (`FUN_1000_2c82`), the password/hiscore grid (`FUN_1000_2eb0`, whose keyboard half is already documented dead code), and a generic "wait for fire or timeout" helper (`FUN_1000_255d`) that discards the key value entirely — so the branches below are the *only* ASCII-keyboard behaviour reachable during real gameplay:

```
0335  call 0x1000:2503        ; AL=ascii, CF=key-available
0338  jnc 0x1000:0349         ; no key -> flush stale input, continue
033a  cmp al,0x1b             ; ESC?
033c  jnz 0x1000:0341
033e  jmp 0x1000:0996         ; -> "QUIT GAME" text (1ffd:ec1d) then falls into
                               ;    the title-menu loop FUN_1000_2c82
0341  cmp al,0x70             ; 'p'?
0343  jz 0x1000:0357
0345  cmp al,0x50             ; 'P'?
0347  jz 0x1000:0357
0349  call 0x1000:24f0        ; flush stale keyboard input, fall through, continue
...
0357  mov byte[0x3ac],0       ; PAUSE: a tight busy-wait, nothing else runs —
035c  call 0x1000:2503        ;   no render, no tick — until ANY key is read
035f  jnc 0x1000:0357
0361  cmp al,0x20             ; space?
0363  jnz 0x1000:036d
0365  mov byte[0x3ac],1       ; only Space sets this; any other key leaves it 0
036a  jmp 0x1000:013c         ; either way, back to the main tick loop — RESUMED
036d  jmp 0x1000:013c
```

`DS:0x3ac` itself has no other reader anywhere in `GAME.EXE` (only these two writers, plus two unrelated `mov …,0` resets elsewhere that never feed a comparison) — confirmed by `search_instructions` across the whole program, not just `get_xrefs_to` (which structurally misses DS-relative real-mode operands, per this project's own `ghidra-evidence` discipline). So it is write-only/vestigial: the pause's practical effect is identical regardless of which key ends the busy-wait.

**Both confirmed live in DOSBox**, execute breakpoints resolved through `debug_map_to_live` (`CS_GAME` range: Ghidra's `1000:xxxx` labels are live segment `0x036D`, *not* `0x1000` — a fixed relocation, easy to get wrong):
- A breakpoint at `CS:0x033E` (live `877:830`) fired with `AL=0x1B` the instant ESC was pressed during real gameplay; the screen was back at the title menu (`BEGIN QUEST`/`ENTER PASSWORD`/`EXIT TO DOS`) one capture later.
- A breakpoint at the pause loop head (`CS:0x0357`, live `877:855`) fired immediately on resume after pressing `P`; two screen captures one second apart, mid-pause, were pixel-identical (hero position, HP, money, `INVULN` counter all frozen); pressing an arbitrary non-space key (`A`) resumed ticking (confirmed via the HUD's own counters changing again) without quitting; and pressing **ESC while paused** also just resumed — it does **not** reach `FUN_1000_0996` at all, since the pause sub-loop has no ESC special-case, only a space-vs-not-space branch after the wait ends.

No other hidden keys: the string table (all 144 entries, searched exhaustively) has nothing cheat/debug-shaped, and the only two `INT 16h` call sites in the whole binary are `FUN_1000_2503` (above) and `FUN_1000_24f0` (a pure discard-and-flush, no dispatch).

⚠️ **CORRECTION, a later session, both prompted by a user report from live DOSBox play: "QUIT GAME is shortly on screen while the screen fades out and exits to the menu."** The earlier close above left this `[UNKNOWN]`, having found the old gameplay frame still in VRAM at a breakpoint right after the draw call — wrong conclusion from an insufficiently late breakpoint, not a wrong mechanism: `FUN_1000_0996` really does draw `"QUIT GAME"` (`FUN_1000_489d`, `SI=0xec1d`) visibly, THEN calls a palette fade-out (`FUN_1000_359d`, one opaque driver call — exports 7/8/9 are "Palette blank / fade-out / fade-in", `docs/drivers-and-memory.md`) before falling into the title-menu loop, which is why the earlier breakpoint (taken before the fade-out even runs) still read the pre-draw frame from a stale mid-instruction pause, not because the text was never shown.

**The user also asked whether "QUIT GAME" shares the menu's own font, guessing `PSMLFNT.PI1` rather than `PSMLFNT.DAT` — the underlying instinct (a font distinct from the small message-line one) was right, the specific file wasn't: it's a different atlas entirely, `PGODFONT`, not either half of the `PSMLFNT` pair.** Both `FUN_1000_311c` (the title menu's own per-frame redraw, called from `FUN_1000_2c82`) and `FUN_1000_489d` (`"QUIT GAME"`) draw their text through the SAME routine, `FUN_1000_646f` (a centering wrapper: counts the string to its NUL, computes `X = 0xA0 − 8×count`) `->` `FUN_1000_224e`:

```
224e  lodsb / cbw            ; next byte, sign-extended
      cmp ax,0 / jz done     ; NUL -> stop
      cmp ax,0x20 / jz skip  ; space -> advance only, no blit
      add ax,0x3f            ; descriptor = byte + 0x3F (a FIXED constant —
      mov [8],ax             ;   not a runtime-snapshotted base like PSMLFNT's
      call 0x1000:356e       ;   own DS:0x27e, message-line.md's own citation)
skip: add word[4],0x10       ; UNCONDITIONAL 16px advance (not PSMLFNT's 10px)
      jmp 224e
```

`'A'` (`0x41`) `+ 0x3F = 128`, and `128` is exactly `PGODFONT`'s own base in the "always" group's global descriptor numbering — `PALWAYS1(39)+PALWAYS2(72)+PALWAYS3(17) = 128`, independently corroborated by `gods-web/src/main.js`'s own pre-existing anchor for descriptor `#169` (`PGODFONT`'s LAST record, the 208×46 title logo, `128+41=169`, verified by two predicted-then-measured anchors before this session ever started). Confirmed visually too, not just arithmetically: rendering `PGODFONT`'s own records 0-25 (`gods-web/tools/atlas-render.mjs PGODFONT`) shows literal gold `A`-`Z`, in order, in the exact bevelled style the `GODS` logo itself uses — the same style visible on the real title screen.

⚠️ **Correction, later the same pass: a user report that the menu's own left/right arrows had gone missing (the direct consequence of this font swap — PGODFONT has no ASCII `<`/`>` at all, so the port's old literal-character arrows silently stopped rendering) prompted pinning down the REST of this atlas's record map precisely, per-record rather than from a cropped strip render — which had put the digits and the two arrows each one record too high.** Pixel-verified this time (each record rendered to its own file, and for the two arrow candidates, checked programmatically which edge of the 16×16 sprite the shape actually touches — the point of an arrow touches one edge across only a couple of rows, its tail touches the opposite edge across most of the sprite's height): records 26/27 are `.` and two small dots (still unidentified); **28-37 are digits `0`-`9`** (`'0'` is record 28, not 29); **38 is a LEFT-pointing arrow, 39 a small circular icon (text too fine to read at 16×16), 40 a RIGHT-pointing arrow** — not "39/40, left-arrow-then-circle" as this section first read it. `FUN_1000_311c` itself settles which is which and where: right after the three option lines it blits descriptor `0xA8` (`128+40`, the RIGHT arrow) at fixed `X=0x18(24)`, then `0xA6` (`128+38`, the LEFT arrow) at fixed `X=0x118(280)` — both at the selected option's own row (`Y := cursor*32+0x52`, the SAME three values `0x52/0x72/0x92` `FUN_1000_646f` already uses for that row's text). So the LEFT-side icon points RIGHT/inward and the RIGHT-side icon points LEFT/inward — matching this doc's own already-established "inward-pointing arrows on both sides" finding, and now with the exact sprites, not just the fact of their existence. Fixed in `gods-web` as fixed-position sprite blits (`title-menu.js`'s `MENU_ARROW_LEFT_DESC`/`MENU_ARROW_RIGHT_DESC`), not flowed text — and `main.js`'s own digit remap for `tally.js` (`menuGlyphs['0'..'9']`) is corrected to the real `28-37` range too, since it had inherited the same off-by-one (ASCII `'9'` was landing on record 38 — the left arrow — not a digit at all).

Records 39/40 remain a promising but NOT yet closed lead for `title-menu.js`'s own long-standing "erase/confirm icon sprite unlocated" note for the PASSWORD GRID specifically (a different screen from the menu arrows just closed above): that grid's own drawer (`FUN_1000_30d4`) blits through this SAME atlas (`descriptor := 0x80 + n` for cell `n`, `0x80 = 128` again), but records 26/27's own two unidentified marks don't match that module's own assumed `.`/space/space for those cells, so the exact cell-to-record correspondence for row 4 onward is still a genuinely open follow-up, not assumed here.

Also draws through `FUN_1000_224e`, all previously unremarked: `FUN_1000_648b` (two lines at rows `0x46`/`0x64`), `FUN_1000_2792` (two lines at rows `0x3c`/`0x5a`, one conditionally built — likely a `"LOADING"`/world-name banner), `FUN_1000_30d4` (the password/hiscore grid's own header line, above its per-cell blits), and `FUN_1000_32c0`/`FUN_1000_6553` — the hiscore table and the tally/bonus screen, the latter already on record (`gods-web/src/game/tally.js`'s own header) as knowingly substituting PSMLFNT for this "then-unidentified" font. That substitution is now a misidentification, not just a disclosed stand-in, and has been corrected in the port alongside the title-menu/`"QUIT GAME"` font fix — see both files' own updated headers.

**Ported** to `gods-web/src/main.js` — a `paused` flag gates the tick callback (not the render callback, so a paused frame keeps redrawing the same frozen state, matching the original's silent freeze with no "PAUSED" overlay); the keydown handler checks `paused` before `Escape` so a paused ESC can't fall through to the quit case, exactly mirroring the asm ordering above. The `"QUIT GAME"` text flash was not ported, since its visibility was never confirmed live.

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


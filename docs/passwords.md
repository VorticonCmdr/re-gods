# The level-select password system

Covers the `"ENTER PASSWORD"` title-menu option end to end: the letter-grid UI, the
entry/match algorithm, the generator that actually produces a password when a world
is completed, the disk-save XOR encoding, and the evidence trail — this feature was
misread twice by earlier passes of this project before landing on the mechanism
below, and that history is preserved here because it's a useful case study in how
`[PROVEN]`-tagged conclusions can still be locally wrong.

This document inherits the evidence-discipline tags and citation conventions defined
in the project's own top-level `CLAUDE.md`.

## TL;DR

- There is **no fixed "the password" list**. Each world's password is generated
  **once**, the first time that world is completed in a given `GAME.EXE` process's
  lifetime, from whatever state a wall-clock-seeded shared RNG happens to be in at
  that instant. A different boot — or the same boot completing worlds in a
  different order — produces different passwords.
- The mechanism has **no bug**: every real level completion (world 1, 2, or 3)
  generates a correct password for the *next* world, and the on-screen
  `"LEVEL n PASSWORD"` label always matches what that password actually does when
  re-entered. An earlier pass of this project's own documentation had a
  transcription error that implied otherwise — see *The corrected `SI` formula*,
  below — caught by live-testing before it shipped as a finding.
- Passwords persist across a session in `GAME.EXE`'s own memory, and — on a
  hard-disk install (`DS:0x384 > 1`) — round-trip to `HISCORES.BIN`'s own trailing
  16 bytes, XOR-obfuscated. This project's own working copy of that file has a real,
  decoded password in it: see *Three real, live-captured passwords*.

## The UI: title menu → letter-grid entry screen

The title screen (`FUN_1000_2c82`) is a 3-option menu — **Begin Quest**, **Enter
Password**, **Quit** — confirmed live: the menu's own on-screen text is
`"ENTER PASSWORD"` (no `"A"`), a *different* string from the password screen's own
title, `"ENTER A PASSWORD"` (`1ffd:eb96`). Selecting it (`FIRE` on cursor row 1)
jumps to `CS:0x2e2f`, the password/level-select handler documented below.

**The letter-grid widget is shared with the hiscore name-entry screen** (both call
the same interactive grid+keyboard loop, `FUN_1000_2eb0`) and is an **8-column ×
5-row, 40-cell grid**, read directly off a live capture:

| row | cells |
|---|---|
| 1 | `A B C D E F G H` |
| 2 | `I J K L M N O P` |
| 3 | `Q R S T U V W X` |
| 4 | `Y Z . <space> 0 1 2 3` |
| 5 | `4 5 6 7 8 9` `<erase icon>` `<confirm icon>` |

Row 4's middle cell (obscured by decorative artwork in every screenshot taken) is
read as Space rather than confirmed pixel-for-pixel, resting on the already-
established alphabet ordering (`.` then Space) rather than a clean read. The
erase/confirm icons' own sprite source was never chased down. This cross-validates
against an independent, earlier byte-level finding: completing a real hiscore-name
entry moved the cursor "from index 34 to 39" via 5× right-presses — row-major index
34 in this 8×5 grid is row 4 col 2 (the `6` cell) and index 39 is row 4 col 7
(confirm), exactly 5 columns apart.

**Unlike the hiscore-name screen, the password screen's raw-keyboard input path is
*not* known to be dead** — `FUN_1000_2eb0` is literally the same shared loop for
both screens, and the hiscore-entry screen's own ASCII-keyboard half was proven
dead code by a live trace (a broken gate at `CS:0x2F1A` discards the BIOS keyboard
result before it can reach the confirm dispatch). The password screen was not
separately live-traced for this same defect, but since it drives the *identical*
shared input loop, the same dead branch almost certainly applies — the letter grid
via `FIRE`, not a physical keyboard, is very likely the only way to actually submit
a password too. Not independently confirmed for this screen specifically.

### The exact rendering — `FUN_1000_30d4`/`FUN_1000_3065`/`FUN_1000_3097` `[PROVEN]`

Full decompile of the three per-tick draw helpers `FUN_1000_2eb0` calls (in this
order, every tick this screen is open):

- **`FUN_1000_30d4` — title + grid.** Calls `FUN_1000_224e` for the title text
  (the PGODFONT/status-panel convention — the SAME routine the title menu's own
  options, the tally screen, and the "QUIT GAME" fade-out all use, not PSMLFNT),
  then blits the grid: 8 columns of 32px starting at `X=40`, 5 rows of 24px
  starting at `Y=40`, each cell's descriptor `0x80 + (row*8+col)` — i.e. PGODFONT
  records 0-39 in row-major order, DIRECT indexing (not the title menu's own
  left/right-swapped inward-pointing arrows).
- **`FUN_1000_3065` — the typed-buffer readout.** *Correction to this project's
  own earlier live-trace note* ("a row of diamond glyphs below the real grid that
  does NOT change as cells are fired — a fixed decorative border, not a buffer
  readout"): that reading was wrong. The function reads `DS:0x3004` (the same
  scratch buffer the grid input loop fills) byte-for-byte, 16 cells, left-aligned
  at `X=32, Y=168`, 16px/cell — a real typed-feedback row, not decoration. An
  empty (never-yet-typed) buffer byte is `0`, substituted with alphabet code
  `0x1C` (Space); descriptor is `code + 0x7F`, so an empty cell draws PGODFONT
  record `0x1C + 0x7F - 0x80 = 27`. **This closes a second previously-open
  ambiguity**: record 27 (this grid's own row-4 "space" cell, per the earlier
  live-read grid layout) was never confirmed as a real space rather than some
  other unidentified mark — it now is, independently, by this second mechanism
  converging on the identical record for the identical alphabet code.
- **`FUN_1000_3097` — the cursor.** A small animated icon (4-frame cycle,
  descriptor `0x57 + phase`, an "always"-group sprite not chased down further)
  blitted directly at the selected cell's own position (`X=(cursor&7)*32+40,
  Y=(cursor>>3)*24+40`) — the SAME grid geometry `FUN_1000_30d4` uses, confirming
  both functions share one coordinate scheme.

Live-confirmed visually in a `gods-web` port session this pass: matching a
user-supplied screenshot of the real screen pixel-for-pixel in layout (title font,
grid font/geometry, the row-4 "space" cell's own faint mark, the erase/confirm
icons, and the `"PASS n :xxx"` hint line below).

## The entry/match algorithm — `FUN_1000_2e2f` `[PROVEN]`

```
2e2f  [0x146] = 0xeb96          ; message pointer := "ENTER A PASSWORD" (the SAME field FUN_1000_318f
                                  ;   sets to "ENTER YOUR NAME HERO" for the hiscore screen)
2e35  [0x37e] = 0x20 ; [0x37f] = 0x8      ; grid-loop parameters (hiscore entry used 0/8 here)
2e3f  call 0x1000:2eb0           ; the shared interactive grid+keyboard input loop
2e42  push ds / pop es
2e44  si = 0x42a                 ; a 4-entry table of WORD POINTERS to password strings
2e47  di = 0x3004                ; the SAME name-scratch buffer the input loop just filled
2e4a  cmp byte[0x3bd],0 / jz 0x2e6c   ; NOT in attract-mode playback -> the real check, below
      ; --- IN ATTRACT-MODE PLAYBACK (DS:0x3bd != 0): a hardcoded developer/demo SHORTCUT ---
2e51  cmp byte[di],0xc / jnz 0x2e6c        ; typed char 1 == code 0xC (='L', 1-based alphabet)?
2e56  cmp byte[di+1],0x1f / jl 0x2e6c      ; typed char 2 in ['2'..'4'] (codes 0x1F-0x21)?
2e5c  cmp byte[di+1],0x21 / jg 0x2e6c
2e64  dl = byte[di+1] - 0x1d               ; '2'/'3'/'4' -> dl = 2/3/4 directly
2e6a  jmp 0x2ea0                           ; -> set world = dl, SKIPPING the real password check entirely
      ; --- THE REAL PATH (reached always when not in playback, and as attract-mode's own fallback) ---
2e6c  cx=4 ; dl=1
2e71  lodsw (si) / di=ax                   ; di := this entry's password-string pointer
2e74  cmp byte[di],0 / jz 0x2e86           ; an EMPTY table entry never matches -> skip to next
2e79  push si / si=0x3004                  ; compare the TYPED buffer against the table string,
2e7d    cmpsb es:di,si / jz loop            ;   byte-for-byte, handling unequal lengths on both ends
2e93    (both strings ended together -> MATCH)
2e86  inc dl / loop 0x2e71                  ; else try the next of the 4 entries
2e8a  (no match after all 4) -> clear the page, JMP 0x1000:2caf   ; WRONG PASSWORD, back to the menu
2e99  cmp dl,1 / jnz 0x2ea0 / mov dl,2       ; entry #1 maps to world 2, not world "1"
2ea0  [0x42] = dl                           ; SET THE WORLD directly
2ea8  [0x391] = 1                           ; a flag this project elsewhere ties to the familiar's
                                              ;   death-starburst gate — reused here for an unrelated purpose
2ead  jmp 0x1000:2d9e                       ; back into the menu flow
```

**The password table, `DS:0x42a` — four word pointers, read live: `{0x432, 0x432,
0x436, 0x43a}`.** The match loop initializes `dl=1` and increments it once per
failed comparison, walking the table in order:

| slot (loop index) | address | on match → world | note |
|---|---|---|---|
| 0 | `0x432` | 2 | `dl` stays `1` here, special-cased `dl==1 → dl=2` at `2e99` |
| 1 | `0x432` (same address) | 2 | `dl` is already `2` by the time this slot is tried |
| 2 | `0x436` | 3 | |
| 3 | `0x43a` | 4 | |

Slots 0 and 1 are the *same address* — the special-case at `2e99` exists purely to
compensate for the loop's own `dl` starting at 1 instead of 0. This is why matching
either slot 0 or slot 1 sends the player to world 2 either way: they're checking
the literal same bytes. An empty table entry (`byte[di]==0`) never matches and is
silently skipped (`2e74`'s `jz 2e86`) — this is what makes an unfilled slot
harmless rather than an accidental always-match on an empty typed string.

**The attract-mode demo's own shortcut.** The demo can't feasibly script a real,
correctly-typed password through recorded joystick input, so its own code carries a
hardcoded developer bypass: while `DS:0x3bd` (recording-playback mode) is set,
typing `"L"` followed by a digit `2`–`4` sets the world directly and skips the real
match loop entirely. This is the *only* way the shipped attract-mode demo is ever
seen to "enter a password" — real play must use the real match loop above.

## The generator — `FUN_1000_69d7` `[PROVEN]`, dispatched from level-exit

A password is generated (not merely entered) here — this is the *producer* side of
the same `DS:0x42a` table the entry screen (above) reads from.

**When it fires.** The score-tally/bonus screen (`FUN_1000_6553`, run on every real
level exit) hands off through a 32-iteration bit-dispatch table
(`FUN_1000_694d`, walking `SS:0x35aa`–`0x35e8`) keyed off a per-record `+0x1e`
field. Bit 10 of that field calls `FUN_1000_69d7`:

| record | address | `+0x1e` | bit 10 (password) fires? |
|---|---|---|---|
| `LEVEL ONE` | `0xe6ea` | `0x0502` | ✓ |
| `LEVEL TWO` | `0xe796` | `0x0502` | ✓ |
| `LEVEL THREE` | `0xe7fe` | `0x0702` | ✓ |
| `GAME` (world 4's own completion) | `0xe8a8` | `0x0000` | — never fires |

So password generation is attempted on **every** real world-1/2/3 completion, and
never on world 4's (there is no "world 5", and the `GAME` record's `+0x1e` is
entirely zero — no bits at all fire on it). Bit 10 runs *before* bit 1
(`FUN_1000_6b00`, the world-advance `[0x42]++`) in the same dispatch pass, so
`[0x42]` still holds the **just-completed** world's number when `69d7` runs, not
the world about to be entered.

**`FUN_1000_69d7`, read in full (`1000:69d7`–`0x6a5a`, 45 instructions):**

```
69d7  SI := word[0x42a + world*2]              ; this world's own password-slot pointer
69e3  CMP byte[SI],0 / JNZ 0x6a48 (RET)        ; slot already filled -> nothing to do
69e8  CALL 0x6a6b                              ; generate: AX/BX carry the 3 raw 1-26 codes
69eb  word[SI]  := BX                          ; chars 1-2
69ed  byte[SI+2]:= AL                          ; char 3
69f1  CALL 0x921b                              ; ONE ordinary game tick+render (keeps the
                                                ;   world visibly moving/drawing underneath)
69f7  CL := byte[0x42] + 1 + 0x5d              ; = (completedWorld+1) + 0x9c after 224e's
                                                ;   own "+0x3f" glyph bias -- lands EXACTLY
                                                ;   on the digit-sprite base (0x9c=156)
6a00  byte[0xed28] := CL                       ; patches the digit into a fixed template
6a04-6a2f  draw 3 lines via FUN_1000_646f (walks a NUL-terminated string, glyph=byte+0x3f
           via FUN_1000_224e -- the STATUS-PANEL font convention, not PSMLFNT's identity
           map), reading a template pool at 1ffd:0xed22 directly off the image:
             "LEVEL   PASSWORD\0"   (0xed22, the middle space patched at ed28 with the digit)
             "   \0"                (0xed33, the 3-char password slot, converted from raw
                                      1-26 codes to real 'A'-'Z' ASCII by FUN_1000_6a5b
                                      in between the first and second draw)
             "FIRE TO CONTINUE\0"   (0xed37)
6a35  SI := 0x43e                              ; the password-reveal's own palette-fade source
6a3a  CALL 0x3596                              ; palette fade-in (8-pass thunk)
6a3d  CALL 0x24f0                              ; flush stale keyboard input
6a40  CALL 0x252c                              ; BLOCKS: wait for FIRE press, then release
                                                ;   (two poll loops on byte[0x382] bit 7) --
                                                ;   this is the actual "FIRE TO CONTINUE" gate
6a43  CALL 0x3211 / JC 0x6a49                  ; disk-save path, see below
6a48  RET                                      ; shared exit: EITHER the "slot already filled" skip
                                                ;   OR the normal post-save return land here
6a49  MOV word[0x212],0xed48 / ...             ; disk-save FAILED -> "disk error - password not
                                                ;   saved..." posts through the priority mailbox
6a5a  RET
```

The `SI := 0x43e` fade source at `6a35` closes a previously-open question in
`docs/drivers-and-memory.md` about a sixth palette-fade call site using `si=0x43e`
instead of the five other sites' `si=0x86` — it is exactly this password-reveal
fade, not a separate mechanism.

The reveal is a **separate, input-gated HUD overlay**, drawn directly over the
still-visible game world (no dedicated backdrop image — confirmed both statically,
no graphics-load pair in the disassembly, and live, the hero and level tiles are
visible underneath the text) — shown once, the first time a world is freshly
completed, gated on an actual `FIRE` press before play can continue.

### `FUN_1000_6a6b` — the random draw

Draws three values through the project's already-documented shared mixer
(`FUN_1000_2375`) and random source (`FUN_1000_3836`), each range-reduced via
`random / 0x9d9 (2521) + 1` to **1..26** — exactly this project's established
1-based alphabet (`A=1…Z=26`), the identical encoding the entry screen's own match
loop compares against. So every generated password is composed of real,
grid-enterable characters by construction, not garbage the entry screen could never
match.

### The corrected `SI` formula — a caught documentation error, `[PROVEN]`

An earlier pass of this project's own `[PROVEN]`-tagged transcript had this line
as `SI := word[0x42a + (world-1)*2]` — subtracting 1 from the world number before
indexing. **That was wrong.** The real instructions (`MOV AL,[0x42] / MOV
SI,0x42a / SHL AX,1 / ADD SI,AX / MOV SI,[SI]`) contain no subtraction anywhere;
the correct formula is `word*2`, with no `-1`.

The error was invisible to every prior live check because it only manifests for
`world ≥ 2`: table slots 0 and 1 both hold the same address (`0x432`), so for
`world=1` — the only case anyone had actually tested live before — `world*2`
(offset 2, slot 1) and `(world-1)*2` (offset 0, slot 0) predict the *same* address,
`0x432`. The `"PME"` capture from completing world 1 (below) could never have told
the two formulas apart.

Taken at face value, the wrong formula implied a real shipped bug: completing
world 2 would compute slot 1 = `0x432`, already filled by world 1's own password,
and skip generation entirely (no password ever shown for world 2 in ordinary
continuous play); and completing world 3 would compute slot 2 = `0x436` — the
address the entry screen matches to world 3, not world 4 — meaning the on-screen
`"LEVEL 4 PASSWORD"` label would be lying about its own destination. This
conclusion was **about to be written up as a finding** when it was tested live
first instead.

**Live test, forcing a level-exit dispatch by hand** (write `DS:0x42:=world`,
`DS:0x178:=` the target `LEVEL n` record's address, `DS:0x36a:=1` — the
exit-pending flag, confirmed as a plain byte flag via `search_instructions` on its
literal operand — then resume and breakpoint right after the password write):

| forced `world` | predicted `SI` (`word*2`) | predicted `SI` (`(world-1)*2`, wrong) | actual live `ESI` |
|---|---|---|---|
| 2 | `0x436` | `0x432` (already full → would skip) | **`0x436`** — matches `word*2` |
| 3 | `0x43a` | `0x436` | **`0x43a`** — matches `word*2` |

Both forced completions generated a fresh password into a slot that had never
been written before, at exactly the address `word*2` predicts. **The mechanism has
no bug.** Every real level completion (world 1, 2, or 3) writes into its own
fresh, never-before-used slot, and the on-screen digit (`[0x42]+1`) always matches
the world the entry screen will actually honor for that slot:

| completed world | slot written | on-screen label | entry screen sends re-entry to |
|---|---|---|---|
| 1 | `0x432` (aliased with slot 1) | `"LEVEL 2 PASSWORD"` | world 2 ✓ |
| 2 | `0x436` | `"LEVEL 3 PASSWORD"` | world 3 ✓ |
| 3 | `0x43a` | `"LEVEL 4 PASSWORD"` | world 4 ✓ |
| 4 | — (`GAME` record never fires bit 10) | — | — (game ends, no world 5) |

Slot 0 (`table[0]=0x432`) is never the *target* of a generator write on its own —
the generator's minimum offset is `world*2` with `world≥1`, i.e. offset ≥2 (slot
1) — it exists purely so the entry screen's 4-slot compare loop has something at
index 0, aliased to slot 1's real data via the `dl==1→2` special-case documented
above.

## Three real, live-captured passwords `[PROVEN]`

Captured live this session, directly from one specific `GAME.EXE` process's guest
memory — **not reusable outside that one process**, see *Randomness*, below.

| completed world | password slot | password | evidence |
|---|---|---|---|
| 1 | `0x432` | **PME** | already present in this machine's own save (decoded from `HISCORES.BIN`, see below); re-displayed live this session on the `TOP TEN GODS` hiscore hint line as `"PASS 2 : PME"` |
| 2 | `0x436` | **JEZ** | forced live (`DS:0x42:=2`, `DS:0x178:=0xe796`, `DS:0x36a:=1`); breakpointed right after the write and read `[0x436..0x439] = 0A 05 1A 00` (`J,E,Z`) directly from guest memory |
| 3 | `0x43a` | **BXI** | forced live the same way (`DS:0x42:=3`, `DS:0x178:=0xe7fe`); read `[0x43a..0x43d] = 02 18 09 00` (`B,X,I`) from memory, then let execution run to the actual `"FIRE TO CONTINUE"` gate and screenshotted the live render: `"LEVEL 4 PASSWORD" / "BXI" / "FIRE TO CONTINUE"` |

Enter any of these on the title screen's `"ENTER PASSWORD"` letter grid to jump
straight into the corresponding world — while that specific `GAME.EXE` process is
still running (or, for `PME`, via that install's own saved `HISCORES.BIN`).

### Randomness — why there is no fixed, enumerable password list

`FUN_1000_6a6b`'s three `random/2521+1` draws consume whatever state the shared
mixer (`FUN_1000_2375`) is in at that instant. That state is advanced by:

- a one-time wall-clock seed at process boot (`[0x122] := ` the low word of the
  BIOS tick count, `INT 1Ah`, never reseeded again for the process's life);
- every per-level table regen (one 258-call pass through the mixer, per level
  load);
- every prior password draw in the same process.

So the mixer state at the moment any given world's password is generated depends
on the entire play history since boot — how many levels have been loaded, in what
order, and how many passwords were already drawn. A different boot, or the same
boot completing the worlds in a different order, produces different passwords.
There is no fixed, enumerable "the level passwords" for GODS to look up; each is
generated once, the first time a world is finished in a given process's lifetime.

## Disk persistence — `HISCORES.BIN`'s trailing 16 bytes `[PROVEN]`

On a hard-disk install (`byte[0x384] > 1` — the same gate this project's own
`CLAUDE.md` already cites from `READ.ME` for SoundBlaster/Roland music and
hiscore/password saving requiring a hard-disk install, not the low-density
floppy), the tail of `FUN_1000_69d7` calls `FUN_1000_3211`, which XOR-obfuscates
the 3 password slots into a second, 16-byte block and writes it to disk via
`FUN_1000_27e5`. Full decompile of `FUN_1000_3211`:

```
if (byte[0x384] > 1) {
  (w0,w1) := word[0x432],word[0x434]          ; world-2 slot (read TWICE, see below)
  if (w0|w1 != 0) { w0^=0x616f; w1^=0x4368 }   ; XOR only if the password is non-empty
  word[0x526],word[0x528] := w0,w1
  (w0,w1) := word[0x432],word[0x434]           ; SAME source, a SECOND time
  if (w0|w1 != 0) { w0^=0x6e67; w1^=0x7345 }
  word[0x52a],word[0x52c] := w0,w1
  (w0,w1) := word[0x436],word[0x438]           ; world-3 slot
  if (w0|w1 != 0) { w0^=0x654d; w1^=0x696e }
  word[0x52e],word[0x530] := w0,w1
  (w0,w1) := word[0x43a],word[0x43c]           ; world-4 slot
  if (w0|w1 != 0) { w0^=0x6f6e; w1^=0x656c }
  word[0x532],word[0x534] := w0,w1
  FUN_1000_27e5()                              ; the actual file write
}
```

The duplicated first block (source `0x432` XORed twice, with two *different* key
pairs, into two different destinations) is simply the generator's own 4-slot table
walked straight through — slots 0 and 1 both being `0x432` means the save routine
encodes the world-2 password twice, once under each key pair, rather than skipping
the duplicate.

**Load side (`FUN_1000_3445`) is the mirror-image decode**, walking the same
XOR keys in reverse. Historically, this pair of routines was misread twice before
the mechanism above was understood — worth keeping on record as a caution about
trusting even `[STATIC]`-then-`[PROVEN]` closures without re-checking every claim
they make:

1. **First reading**: "an inert anti-tamper checksum — nothing ever computes a
   value for these three addresses, the load routine never compares its two
   decoded copies against anything, and the whole thing is cut infrastructure."
   This was true as far as an exhaustive literal-address write sweep could see —
   which was the bug: `FUN_1000_69d7`'s write (`MOV word[SI],BX`, `SI` loaded from
   a pointer table) is register-indirect and invisible to a literal
   `MOV [0x432],reg` pattern search.
2. **Second reading**: "these are the password slots, and the entry screen (`
   FUN_1000_2e2f`) is real — but every table entry reads as an empty string in the
   shipped binary, so this is a *cut* feature: fully wired for consumption, with
   **no producer**, unreachable by legitimate play."
3. **Third reading (current)**: the "no producer" claim was itself wrong, for the
   exact same register-indirect blind spot as reading 1 — `FUN_1000_69d7` *is* a
   real producer, reachable from ordinary play (see *The generator*, above). The
   feature is not cut at all.
4. **The SI-formula correction** (this document's own *The corrected `SI`
   formula* section) is a fourth pass over the same mechanism, catching a
   transcription error inside an already-`[PROVEN]` disassembly transcript that
   had gone unnoticed because the one case previously tested live (`world=1`)
   couldn't distinguish the correct formula from the wrong one.

**This machine's own real save, decoded.** This project's own working copy of
`HISCORES.BIN` (216 bytes; `git status` shows it locally modified, not the
pristine shipped file, which is all zero at this offset) has its trailing 16 bytes
(file offset `0xc8`–`0xd7` = live `DS:0x526`–`0x535`) as:

```
7F 6C 6D 43 77 63 40 73 00 00 00 00 00 00 00 00
```

XOR-inverting both `0x432`-slot copies against their own keys —
`0x6c7f^0x616f = 0x0d10` and `0x436d^0x4368 = 0x0005`; independently,
`0x6377^0x6e67 = 0x0d10` and `0x7340^0x7345 = 0x0005` — gives the identical
plaintext both times: codes `16,13,5` = `P,M,E`, an exact match for the
live-displayed `"PME"` above. Two independently-keyed encodings of the same
plaintext decoding to the same answer is a clean self-consistency check that this
XOR scheme is understood correctly, not just plausible. The trailing 8 bytes
(world-3/world-4 slots) are all zero — this save predates any world-2/world-3
completion having been persisted to disk.

On a disk-write failure (`JC` back in `69d7`), a template at `1ffd:0xed48` —
`"\x11\x11 disk error - password not saved..."` — posts through the project's
already-documented `CS:0x434e` priority mailbox.

## The hiscore-screen hint text — `FUN_1000_32fe`

The `"TOP TEN GODS"` hiscore table has a permanent hint line at screen `(10, 190)`
(bottom-left corner, inside the decorative border): a literal `'2'` followed by the
three bytes at `DS:0x432`/`0x433`/`0x434`, each `+0x60` (converting the 1-based
alphabet to real lowercase ASCII, `code+0x60`). Since `0x432` holds exactly
world 2's own password, this renders as `"2" + <world-2 password>` — a permanent,
always-visible hint for the one password the earliest part of any playthrough can
produce. On the pristine shipped image (all-zero slots) this renders as `"2"`
followed by three copies of whatever glyph code `0x60` maps to — not a functional
hint until a world-2 password actually exists.

## Port-side notes

None of the disk-save/load path has a port-side equivalent — a browser port has no
disk write to fail.

`gods-web`'s `zones.js` originally carried a header comment stating "there is no
'ENTER A PASSWORD' screen here to type this back into," as if the game never shows
one. It does — see *The generator*, above. `zones.js`'s own `generatePassword()`
is a reasonable simplification of `FUN_1000_6a6b` (three `random/2521+1` draws)
but does **not** reproduce that function's own up-to-100-retry uniqueness check
against the other two stored passwords — a known, minor, not-yet-chased
divergence. `zones.js`'s own `passwordSlotForWorld`/`passwordWorldForSlot` already
implemented the correct `completedWorld - 1` / `slot + 2` mapping independently of
this document's own now-fixed `FUN_1000_69d7` transcript error — the port was never
affected by that bug.

`game/title-menu.js`'s `PasswordEntry` originally used PSMLFNT throughout, wrong
grid geometry, a per-cell text marker not present on the real screen, and had no
`"PASS n :xxx"` hint line or real typed-buffer readout at all (its own header
comment disclosed both the font and the buffer-row reading as open gaps). Fixed
this pass to match *The exact rendering*, above, end to end: PGODFONT for the
title/grid/buffer-row, the real pixel geometry, the erase/confirm icons via
`main.js`'s new `gridEraseIcon`/`gridConfirmIcon` (descriptors 166/167), and the
`"PASS n :xxx"` hint line reading `passwordSlots` directly. Live-verified against
a real screenshot of the DOS screen and functionally (menu navigation, typing,
the wrong-guess bounce back to the menu) in a running `gods-web` session.

## Residual open ends

- The password/hiscore grid's own erase and confirm icon sprites are now
  identified as PGODFONT records 38/39 (descriptors 166/167, a left-pointing
  arrow and a small circular icon respectively) — CLOSED, see *The exact
  rendering*, above.
- The password/hiscore grid's own row-4 "space" cell (record 27) is now
  confirmed real — CLOSED, see *The exact rendering*, above.
- The password screen's raw-keyboard input path was not independently live-traced
  for the same dead-gate defect already proven on the hiscore name-entry screen —
  very likely shares it (identical shared input loop), but not confirmed.
- `FUN_1000_6a6b`'s up-to-100-retry uniqueness check (mentioned in passing above)
  was not itself fully disassembled — its exact retry/collision behavior against
  the other two already-stored passwords is unread.
- `FUN_1000_3097`'s own cursor sprite (descriptor `0x57+phase`, a 4-frame
  animation) was not chased down to a named asset.

# Execution model, PKLITE unpacking, and frame pacing

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

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

`WIBBLE.EXE` hides a genuinely sophisticated hand-written anti-debug scheme, and this whole mechanism is now `[PROVEN]` by a live single-step DOSBox trace (breakpoints on the load segment, on the decrypt/re-encrypt sites, and on the interrupt vectors it installs — not by reasoning about the NEG'd bytes offline). Its entry point (`CS:0x0000`) first saves the live `INT0`–`INT4` vectors (5 far pointers, 20 bytes, pushed onto its own stack — this is a well-behaved hook that means to restore them, not a raw takeover), then hijacks `INT3` (self-relocating via a `call $+0`/`pop` trick) to point at `CS:0x778`. The `INT3` handler hijacks `INT1` (the single-step trap) to point at `CS:0x7C4` and NEG-decrypts exactly 59 bytes there in place (`CS:0x7C4`–`0x7FE`, confirmed live: `AX` counts down from `0x3B`, `SI` walks `0x7C4→0x7FE` one `NEG byte cs:[si]` per tick) — this is the *only* part of the file the earlier static pass could reach, and it decoded correctly.

**The full decrypted `INT1` handler, read live while briefly exposed in memory:** `sti / push ax,si,ds / xor ax,ax / mov ds,ax / lds si,[0000]` — that last load is not IVT bookkeeping, it's reading a **persistent "current cascade position" variable that the code parks in the normally-idle `INT0` vector slot** (`0000:0000`, 4 bytes, free precisely because `INT0` was already saved off elsewhere and never fires here) — then `mov ax,[si-2] / not ax / rol ax,1 / xor ax,[si] / xchg [si],ax / cmp al,0xCC / je → CS:0x7FB`: this re-encrypts the *previous* word (the one exposed in plaintext since the last time this handler ran) and, if its original ciphertext byte reads back as `0xCC`, treats that as "a debugger planted a software breakpoint on the code while it sat decrypted" and skips ahead to cleanup. Falling through: `mov si,sp / lds si,ss:[si+6]` loads the **trapped IP itself** (the single-step-interrupt frame the CPU just pushed) — `mov ax,[si-2] / not ax / rol ax,1 / xor [si],ax` decrypts the *next* word to run, keyed off the two bytes immediately before it (a one-word cipher-block-chaining construction: once word 1 is decrypted, every later key comes from already-executed plaintext, not from anything sitting statically on disk — this is exactly why the cascade "can't be recovered statically", confirmed rather than merely asserted). It then restamps the `INT0` scratch slot with the new position, restores registers, and `iret`s. The `INT3` handler's own tail runs the identical `lds/mov/not/rol/xor` arithmetic once (at `CS:0x7EC`, keyed off the two static bytes at `CS:0x30`) to decrypt the cascade's first word at `CS:0x32`, then — via `mov si,sp` then `xor byte ss:[si+0B],0x03` (the high byte of the flags word it's about to restore) — flips the saved Trap Flag on and Interrupt Flag off before its own `iret`, which is what actually starts the single-stepping. That same XOR doubles as a coarse debugger check: if `TF` was **already** 1 on entry (something was single-stepping `WIBBLE.EXE` before it ever ran this code), the XOR result flips the branch the other way, into a second check (`CS:0x7AD`) that reads 2 bytes near the *live* `INT0` handler's own code for a planted `0xCC`, then exits with `TF` silently turned back off — this path never fired in any of this session's traces (nothing here ever sets the guest's real Trap Flag) and its bytes are read, not exercised, so its consequences stay `[STATIC]` even though the bytes themselves are `[PROVEN]`.

**Past the cascade, `WIBBLE.EXE` performs genuine floppy hardware access — this corrects the section's earlier "no file-open/read calls" reading, which never disassembled this span.** Immediately before the (already-known) `INT3`-handler entry at `CS:0x778` sits a plaintext, never-encrypted block: `cd 13` (`INT 13h`, BIOS disk service) at `CS:0x764`, followed by `cd 25` (`INT 25h`, DOS absolute disk **read**) at `CS:0x769` and `cd 26` (`INT 26h`, DOS absolute disk **write**) at `CS:0x771`, each trailed by the `83 c4 02` stack fixup `INT 25h`/`26h` require (they push `FLAGS` without a matching `IRET`) and then a `cc` (`INT3`) that re-enters the protection. Live-traced, on a run with no floppy in the drive: execution reaches `CS:0x764` with `AH=0, DL=0` — a genuine `INT 13h AH=0` (reset disk system, drive A) — then diverts straight to the `CS:0x7FF` epilogue **without** touching the `0x769`/`0x771` thunks; a second full run confirmed the same. Those two thunks are proven present and plaintext but not proven to execute on this (no-disk) path — plausibly they're only reached after a successful reset, to actually read/verify a sector. Separately, the live memory image at `CS:0x351`–`0x550` — **exactly 512 bytes, one floppy sector** — reads as dense pseudo-random bytes on disk but comes back all-zero after a run, on both sides of the span byte-identical to disk; the size match to a sector, right next to `INT 25h`'s own absolute-read thunk, makes "unused/never-filled sector-read buffer" the best-supported reading, though no instruction that clears or targets it was directly caught executing, so that specific reading stays a strong inference, not a proven mechanism.

Past the protected region, the plaintext epilogue at `CS:0x7FF` unconditionally exits via `INT21h AH=4Ch`; one branch first prints the verified `"Warning: Gods original disk not found..."` string and waits for a keypress. **Which branch fires is now determined, `[PROVEN]`:** at `CS:0x7FF`, live `FLAGS` reads `0x7247` (`CF=1`); `CS:0x800` is `72 04` (`jc`, plaintext on disk, not ciphertext as this section previously assumed) and CF=1 takes it straight to the print-and-wait branch — matching the screen output on every traced run (both single-stepped and free-running, so the instrumentation itself doesn't perturb the branch). Confirmed: `WIBBLE.EXE` never itself issues `AH=4Bh` (it doesn't spawn anything).

Best-supported reading, now with direct execution evidence rather than only code shape: an orphaned, standalone floppy-authenticity-check utility — real `INT 13h`/`25h`/`26h` disk access, a plausibly sector-sized scratch buffer, an anti-debug bootstrap layered on top, print-message-and-exit. Nothing decrypted or executed in any traced run references `GAME.EXE`-style data (no `PALFILS`/`POBJECTS`/`PWEAPONS`-shaped tables, no `.MAP` structure, no asset-format bytes) — everything reachable is disk I/O and self-referential anti-tamper bookkeeping. The `0x351`–`0x550` sector buffer and the `0x769`/`0x771` thunks are the only pieces of the file no live trace has yet exercised; a run with an actual floppy mounted in drive A would be the way to close that last gap. Not conclusively excluded: invocation from one of the four still-packed binaries.

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

Every binary in the release is now searchable in the clear — the four PKLITE files were the last blind spot. **Nothing invokes `WIBBLE.EXE`.** It is an orphaned standalone disk-verification utility — confirmed by live trace, not just code shape, see *`WIBBLE.EXE` invocation* above.

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

### `PDEMOSB4.SB` format and playback rate — CLOSED `[PROVEN]`, disassembly plus live DOSBox capture

`blast.py` decompresses `PDEMOSB4.SB` to 227502 bytes. It is not one flat PCM stream: it is a tiny directory over one or more embedded clips, read by `PPLAYER.BIN`'s own `FUN_0000_22f9` (decompressed via `blast.py`, imported into Ghidra as raw `x86:LE:16:Real Mode`, giving program `/PLAYER.BIN` — same convention as the `.MUS`/`.RL` event-payload work above). Byte 0 is a clip count (**1** for this file — a single voice line); each clip's 4-byte directory entry (starting at offset `4 + i*4`) is `{u16 dataStart, u8 stateByte, u8 param}` — no explicit length field, so a clip's PCM runs from its own `dataStart` to the next clip's `dataStart` (or EOF for the last one). For this file's one clip: `dataStart=8`, `stateByte=0xFF`, `param=0xFC` (neither further decoded), giving **227494 bytes of raw 8-bit unsigned mono PCM** starting at file offset 8 — consistent with this project's own already-`[PROVEN]` byte-histogram read of the whole file (mean 127.76≈128, silence-biased, smooth; `docs/drivers-and-memory.md`'s `PGOD0x.PAT` closure uses that statistic as its own "what real 8-bit PCM looks like" reference).

**The playback RATE is not stored in the file at all** — it's a driver-side runtime parameter, live-confirmed rather than read out of any asset. `PPLAYER.BIN`'s single far-call entry point (`0000:0000`, `DS:=CS` at entry, position-independent) dispatches on the caller's `AH` through a 13-entry table at file offset `0xD8`; `AH=0` (`Func0Dispatch`, `0000:00fa`) is a device-enable-mask handler whose `AL` bit1 (set whenever `INTROV.EXE`'s own SB branch calls it with `AL=3`, `docs/execution-and-boot.md`'s own dispatcher table above) resets the SB DSP (ports `0x226`/`0x22A`/`0x22E`, the standard `0xAA` reset-ack poll), sends DSP command `0xD1` ("speaker on"), and installs an IRQ handler via DOS `AH=0x25`. The actual **time-constant** and **start-DMA** commands are sent by a separate routine, `0000:2667` (named `SetupSbPlayback` this session), reached only through an indirect/self-modifying path this pass did not fully resolve (`UNKNOWN_sb_setup_caller`) — it validates `AX`/`BX:ES`/`CX` parameters off the stack, stores the caller's `AX` (a requested rate in Hz) to its own `DS:0x294C`, and computes the DSP time constant with the textbook formula `AX = 1000000 / rateHz; timeConstant = -AX` (truncating 8-bit negate, i.e. `256 - (1000000/rateHz)`), sent via DSP command `0x40`.

**Live DOSBox capture, not just static reading**, closes the actual value: booted `GODS.EXE`→`INTROV.EXE` with `GODS.INI` set to Sound Blaster (the shipped default), located `PPLAYER.BIN`'s own DSP-command-write primitive (`0000:27cc`, a position-independent byte signature — it hardcodes only the I/O port `0x22C`, never its own load segment) live via `mem_scan` (physical `0x293F3`, giving a live load segment of `0x26BE`), and set an execute breakpoint on its `OUT DX,AL` instruction (live `0x26BE:0x27E8`). Captured command sequence, stable across three consecutive streamed blocks:

```
0xD1                 speaker on (once, at stream start)
0x40, 0xA0            set time constant = 0xA0 (160 decimal) — IDENTICAL every block
0x14, 0x39, 0x00       8-bit single-cycle DMA output, length-1 = 0x0039 = 57 -> 58-byte block
```

So this is **streamed** playback — 58-byte DMA blocks, each re-armed by the transfer-complete IRQ — not one large transfer, matching a pre-auto-init-DMA Sound Blaster driver design. A live read of `DS:0x294C` at the same session confirms the *requested* rate feeding that formula is **10383** Hz; `1000000/10383` truncates to 96, giving `timeConstant = 256-96 = 160 = 0xA0` — exactly the captured byte, cross-confirming the formula end to end. The *achieved* hardware rate from that time constant is `1000000/(256-160) = 1000000/96 ≈ 10416.67` Hz — the ~0.3% gap from the requested 10383 is the same integer-truncation rounding the original driver code itself accepts, not a decode error.

**Ported to `gods-web`** (`src/formats/sb-voice.js`, `src/audio/pcm-player.js`, wired in `main.js` alongside the existing `PMUSIC.MUS` substitute): decodes the directory, extracts the one clip's raw PCM, and plays it once at 10417 Hz (the achieved hardware rate, rounded) as a bonus layer over the intro's existing SMF music bed — not a replacement for it, since `PGODMUS2.MUS` (the real per-config music file layered alongside `demosb4.sb`, per the dispatcher table above) is still undecoded/unported.

`UNKNOWN_sb_setup_caller`: the exact indirect call site that reaches `SetupSbPlayback` (`0000:2667`) was not pinned down statically this pass — `get_xrefs_to` finds zero direct near-calls to it anywhere in the image, so it is reached through a computed/indirect call this pass didn't trace (a callback pointer `FUN_0000_22f9` sets at `DS:0x2990` is the leading candidate, unconfirmed). Live capture answers the *value* question (rate=10383, constant=0xA0) without needing this resolved. `UNKNOWN_sb_voice_stream_end`: whether playback runs to the clip's own natural end-of-buffer or is cut short by the intro's own credits-timing logic advancing past the Sound-Blaster card was not chased down either.

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


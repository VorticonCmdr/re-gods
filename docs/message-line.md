# The status-panel message line

How the game shows words to the player: the priority mailbox at `CS:0x434e`, its
paginating layout, the `PSMLFNT` glyph blit, the two in-level composers, and the
hint tablet's own path.

> **How this was established.** Every routine below was disassembled directly
> (`disassemble_bytes`, not decompiled) and then re-confirmed **by
> reconstruction**: rendering `PLEV1A`'s `x=178` tablet through the `gods-web`
> port's own re-implementation reproduces both pages of the message a DOSBox
> capture of the real game shows, glyph for glyph. Where a claim rests only on
> reading, it is tagged `[STATIC]`.

## The subsystem this project recorded as done and never had `[PROVEN]`

`docs/asset-formats.md` decoded the hint table — 40 big-endian `int16` keys at
`PALFILS+0x1b58`, 40 `0x28`-byte ASCIIZ strings at `+0x1ba8`, keyed on the world
X of object type 69 — and that finding stands unchanged. What did **not** exist
anywhere was the *display* side, and the `gods-web` port recorded the gap as
closed: `game/consumables.js`'s own `NOT_WIRED_REASON.hint` read `"already
ported as the PALFILS hint system"`. Nothing drew a character. Walking over the
first tablet in `PLEV1A` produced no text at all.

That is the failure mode this document exists to prevent a repeat of: the table
being decoded is not the same thing as the mechanism being ported, and a
`NOT_WIRED_REASON` string is not evidence.

## `CS:0x434e` — a priority mailbox, not a queue

One slot. Callers pass a priority in `DL` and it arbitrates against a **barrier**
byte at `DS:0x394`.

```
434e  cmp dl,[0x394] / jc 0x4370       ; below the barrier -> reject, AX=0
4354  cmp byte [0x393],0 / jz 0x4373   ; nothing showing -> accept
435b  ...prefix compare, see below...
4373  [0x3b9]=[0x3ba]=0xff             ; both panel pages dirty
437e  call 0x4602                      ; erase the strip (graphics export 23)
4382  [0x394]=dl                       ; barrier := this priority
4389  [0x260]=[0x212]                  ; latch the string
4392  [0x393]=1                        ; active
43a3  call 0x43b6                      ; lay out and draw page 1 NOW
43b2  mov ax,1 / ret
```

**The comparison and the latch are 8-bit** (`cmp dl,[0x394]`, `mov [0x394],dl`),
so `CS:0xcc5c`'s `mov dx,0x7fff` submits **0xFF**, not 32767. A port storing a
16-bit priority mis-ranks that channel.

**The eight submit sites** (`search_instructions` for `call 434e`: `0x0cda`,
`0x0d97`, `0x4714`, `0x4814`, `0x6467`, `0x6f74`, `0x7079`, `0xcc5f`) give the
whole ladder:

| priority | site | channel |
|---|---|---|
| `0xFF` | `CS:0xcc5c` | the endgame crawl |
| `0x64` (100) | `CS:0x6464` | **the hint tablet** |
| `0x32` (50) | `CS:0x0cd8` | extra life |
| `0x31` (49) | `CS:0x0d94` | bonus gem |
| `0x1e` (30) | `CS:0x4811` | the shop's item composer |
| `0x19` (25) | `CS:0x4711`, `0x6f6d`, `0x7071` | object messages, shop refusals |

**The barrier is short-lived by design.** `CS:0x4485` zeroes `DS:0x394` again on
the first real draw — which happens inside the same submit call. So priority only
arbitrates between messages posted in the same frame, unless a caller holds it up
deliberately: the shop does exactly that across a purchase, saving the barrier,
forcing it to `0x32` and restoring it (`CS:0x7024`-`0x7031`).

### ⚠️ The duplicate check is a PREFIX test, and it is asymmetric

The obvious reading — "reject an identical message" — is wrong in one direction.

```
435b  mov si,[0x212]        ; SI = the NEW string
435f  mov di,[0x260]        ; DI = the string CURRENTLY displayed
4363  lodsb                 ; reads from the NEW string
4364  or al,al / jz 0x4370  ; NEW ran to its NUL, all equal so far -> REJECT
4368  inc di
4369  cmp al,[di-1]
436c  jnz 0x4373            ; first difference -> ACCEPT
436e  jmp 0x4363
```

So the reject condition is "the new string is a **prefix** of the displayed one",
equality being the special case. New `"ABC"` against displayed `"ABCDEF"`
**rejects**; new `"ABCDEF"` against displayed `"ABC"` **accepts**, because the
displayed string's NUL mismatches `'D'`. A symmetric equality test is wrong.

A busy engine does **not** reject on being busy — `CS:0x4359` accepts outright
when nothing is showing, and a busy one falls into this compare, so a *different*
message preempts the live one.

## It is paginated, not scrolled

There is no marquee anywhere. `DS:0x262` is written only as `0` / `0xFFFF` /
`0x140` and read only by a sign test; nothing in the chain advances an X by a
per-tick delta. An exhaustive operand search for `0x262` returns five sites, four
of them writes.

`CS:0x43b6` copies the accepted string into a work buffer at `DS:0xd716`,
counting its length, then:

```
43cb  [0x262] = 0xffff       ; "last page" — UNCONDITIONAL
43d1  [0x276] = cx           ; total characters
43d5  dx = 0x1c - cx / sar dx,1   ; centring offset, in CHARACTER cells
43dc  [0x280] = 0            ; page-1 length, 0 = single page
43e2  [0x264] = 0x1e         ; 30-tick countdown
43ea  jns 0x4430             ; fits in 28 -> centred single page, done
43ec  dx = 0
43ee  [0x262] = 0x140        ; only its SIGN matters: "a second page is pending"
```

The wrap path then scans **backwards from index 27** for a space:

```
4400  inc dx / dec si / dec bx / dec cx
4404  cmp byte [si],0x20 / jnz 0x4400
4409  cmp byte [si+1],0x30 / jl 0x4415      ; never break just before a number
440f  cmp byte [si+1],0x39 / jle 0x4400
4417  call 0x44a8 / jc 0x4420               ; anything printable after the break?
441d  mov byte [si],0x26                    ; YES -> the "continued" wedge glyph
4420  cmp byte [si-1],0x11 / jnz 0x442a
4426  mov byte [si-1],0x20                  ; demote a diamond sitting on the seam
442a  sar dx,1                              ; page-1 centring
442c  [0x280] = bx                          ; page-1 length == break index + 1
```

⚠️ **`CS:0x44a8` accepts only lowercase letters and digits.** It tests
`0x61..0x7a` then `0x30..0x39` and loops on anything else, so `'A'` falls through
both windows. Shipped text is lowercase so it rarely matters, but the composed
hint's literal `"Hint"` is capitalised, and a port that widened this to `A-Z`
would place some breaks differently.

⚠️ **The backward scan is unbounded** `[STATIC]`. `CS:0x43f4 mov cx,0x1d` looks
like a guard but `dec cx` is never tested; a message whose first 28 bytes hold no
space walks off the front of the buffer. Not reachable with shipped content —
every composer emits `0x11, 0x20` as its first two bytes.

### ⚠️ Wrapping is the normal path, not an edge case

Measured over the shipped data by re-deriving every message: **39 of the 46
placed tablets wrap to two pages.** A port that renders one centred line is wrong
for most of the hints in the game.

### Lifetime: 30 ticks, then 60 more only if a second page is pending

```
4573  dec word [0x264] / jns 0x45ba   ; still counting -> just redraw
4579  cmp word [0x262],0 / js 0x45f4  ; NEGATIVE -> tear down
4580  [0x262] = 0xffff
4586  [0x264] = 0x3c                  ; page 2 gets 60
4596  ax = 0x1c + [0x280] - [0x276] / sar ax,1   ; page-2 centring
45af  [0x27a] += [0x280] / [0x276] -= [0x280] / [0x280] = 0
45f4  call 0x4602 / [0x393]=0 / [0x394]=0        ; erase, inactive, barrier down
```

At 15 Hz that is ~2.07 s then ~4.07 s (31 and 61 decrements).

⚠️ **A single-page message gets 30 ticks only.** Two independent verification
passes in this project disagreed here, one reading the lifetime as always
two-phase. That reading misses `CS:0x43cb`, which sets `[0x262] = 0xFFFF`
unconditionally after the copy loop — bytes `c7 06 62 02 ff ff`, re-disassembled
to settle it. Only the wrap path at `CS:0x43ee` makes it positive.

## Geometry

```
4443  [0x4] = 0x18              ; x0 = 24
4452  and ax,0x4 / add [0x4],ax ; +4 on the pre-shifted panel page — see below
4459  [0x6] = 0x1d              ; y = 29, PANEL-LOCAL
448e  dx*10 / add [0x4],dx      ; centring offset, 10 px per character cell
44f4  add word [0x4],0xa        ; the per-glyph advance, FIXED
```

| | |
|---|---|
| field width | `0x1c` = 28 characters, x 24…304 |
| y | 29 panel-local → **absolute screen row 189** |
| glyph cell | 16 px wide, 9 rows tall → the text occupies rows **189–197** |
| advance | **10 px, fixed** — nothing reads a per-glyph width |

Rows 189–197 sit inside the 160–199 status band, never the playfield, and match
the flat trough in the shipped `PSTAT3` art exactly.

The `+4` arm and its `DS:0xad4c` panel page are **not** modelled in the port,
correctly. ~~`UNKNOWN_ds33_bit2_setter`~~ — **CLOSED, `[PROVEN]` live
(2026-09-28).** The setter is in the driver, not `GAME.EXE`: graphics export 0
writes `[0x33] = [0xa] & 0x1c` every frame (`VGA:0x10F5`–`0x10FB`), the camera's
fine-scroll phase. `GAME.EXE`'s own writes are all zeroes or `POP AX` restores,
which is why the earlier `GAME.EXE`-only operand scan found nothing. At
`CS:0x4449`–`0x4475` a nonzero `[0x33]` selects the pre-shifted panel copy
`0xad4c` (and clears `0x3b9`, else `0x3ba` for `0xacde`), and bit 2 adds the 4 px
that copy needs. Live, with camera X poked to `0x1C0`/`0x1C4`/`0x1C8` at the loop
head (`[0x33]` read back 0/4/8) and at a natural `0x1DC` (28), the status band's
pixels matched each other at shift 0; the only differing pixels (19, at x 19–27,
y 174–179) are the health bar's shimmer. So the panel and its text never move on
screen, and the port's single unshifted panel is exact. The same byte drives the
health bar, digits and inventory panel shifts (`docs/drivers-and-memory.md`).

### The blit gate, `CS:0x44c7`-`0x44e1`

```
44c7  cmp byte [0x38a],0 / jz 0x44e3    ; a level is loaded and running -> draw
44ce  cmp byte [0x3ab],0 / jnz 0x44e3   ; the shop is up -> draw
44d5  cmp byte [0x42],0x4 / jnz 0x44fb
44dc  cmp byte [0x38a],0x2 / jnz 0x44fb ; world 4 mid-load stage 2 -> draw
44fb  mov byte [0x393],1                ; the active flag is set EITHER WAY
```

Evaluated once per draw call, not per character. It is a **separate** gate from
the composer's own at `CS:0x461D`, on two of the same variables — a port that
implements one and not the other draws text the original suppresses.

## The font is `PSMLFNT`, and the mapping is the identity

```
44e3  lodsb / sub ah,ah / add ax,[0x27e] / mov [0x8],ax / call 0x356e
```

`sprite = zero_extend(byte) + DS:0x27e`. **No `sub al,0x20`, no translation
table, no range fold, no case fold anywhere in the path** — `DS:0x27e` has
exactly three references program-wide (two writers, this one reader). Its
gameplay writer is `CS:0x2c57`, which snapshots the descriptor cursor immediately
before the `"smallfnt"` group load at `CS:0x2c19`, so it is that atlas's own
record 0. The shop's writer is `CS:0x6b62` (`[0x25e]+0x2b`), selecting
`PSHOPFNT`.

`PSMLFNT.DAT` is a **130-record atlas indexed directly by ASCII code**
(`2 + 10*130 = 1302` bytes). Notable slots:

| byte | glyph |
|---|---|
| `0x11` | the **solid diamond** separator every composer emits |
| `0x20` | the only all-zero cell in the atlas |
| `0x26` | the right-arrow **"continued"** wedge the word-wrap writes |
| `0x41`–`0x5A` | `A`–`Z` |
| `0x61`–`0x7A` | `a`–`z` — artwork **pixel-identical** to the uppercase slots, 26/26 |
| `0x7B`–`0x81` | not glyphs: `GODS` logo pieces |

⚠️ **So do not uppercase the string.** The shipped hint text is lowercase and
renders uppercase purely because of the art. Adding a `toUpperCase()` would look
right for letters and silently break `0x11`, `0x20` and `0x26`, which are
ordinary printable glyphs here, not control codes. `CS:0x44E6` applies no clamp
either, so a byte past `0x7A` would blit a logo piece — no shipped string ever
emits one (checked across every composable object message in all four worlds).

⚠️ `PSHOPFNT.DAT` is byte-identical to `PSMLFNT.DAT`, but the two `.PI1` files
hold **different artwork**, not a recolour: compared as palette-independent ink
shape, 61 of the 91 cells in `0x20..0x7A` differ. A port cannot reuse `PSMLFNT`'s
decoded pixels for the shop.

## `DS:0x1fc6` — one shared string arena

The object composer computes a string pointer as `0x1fc6 + descriptor[+8]`
(`CS:0x4673`); the hint handler does `add si,0x1fc6` on a word from its own table
(`CS:0x641f`). Same base: the `POBJECTS` names/descriptions and the `PALFILS`
hint strings live back to back in one pool, which is what makes the composer's
"walk past this string's NUL to reach the next one" trick work.

Built per **world**, not per level — `CS:0x35ea` gates the rebuild on `DS:0x43`,
so it runs on A-levels and survives the A→B transition. `DS:0x14c` is the base,
`DS:0x14a` the cursor. Fixed order: `POBJECTS` (132 records, `FUN_1000_35fb`),
then the 40 hint slots (`FUN_1000_36b1`, called from `CS:0x2AAE` with
`DI = 0x9008 + 0x1b58 = 0xab60`), then the map's own trigger-message table
(`FUN_1000_374b`).

Each `POBJECTS` record contributes its 16-byte name at `+8` and its 24-byte
description at `+0x18`, each truncated at its first NUL and each written
*including* that NUL; a record with both fields empty gets `descriptor[+8] =
0xFFFF`, the "no text" sentinel `CS:0x4679` bails on with a signed `jge`.

**The four world arenas measure 1435 / 1447 / 1425 / 1442 bytes**, with 42 of the
132 types having no text in every world. Those figures were predicted from the
binary's parser and then reproduced independently by building the arena from the
shipped asset — which is what makes them a cross-check rather than a restatement.

## `CS:0x4609` — the object message, and its gates

```
11 20  <name>  20 11 20  <desc>  [20 11 20]  ["Value" 20 <5 digits> 20 11]  20 00
```

The `20 11 20` after the description is emitted only when the description was
non-empty (`CS:0x46b0` tests the append helper's own character counter, which
`CS:0x46a7` zeroed first). The Value clause appears only when `descriptor[+6]`
(big-endian, hence the `xchg ah,al`) is non-zero, and is always five zero-padded
digits built by five `cwd`/`idiv 10` steps with the remainders stacked.
`DS:0xecf3` is the literal `"Value"`.

### ⚠️ The world gate is not "world 1 only"

```
4613  cmp byte [bx+si],0x2 / jz 0x4651   ; category 2 (keys) -> bypass everything
4618  cmp cx,0x53 / jz 0x4651            ; type 0x53 -> bypass everything
461d  cmp byte [0x3ab],0 / jnz 0x462e
4624  cmp byte [0x42],0x1 / jz 0x462e
462b  jmp 0x4733                          ; otherwise: silence
462e  ...the once-per-type bitmap...
```

`DS:0x3ab` is the **shop-active** flag — its live setter, `CS:0x6c58`, sits three
instructions before the shop main loop. Both halves of the OR are load-bearing:
reading this gate as "world 1 only" ships silence in three worlds. The
"world != 1" half comes from `CS:0x461d cmp byte[0x42],0x1` — a plain world-number
test, *not* `CS:0x00c4` as an earlier revision of this section cited; `0x00c4`
is a different `FUN_1000_006f`-prologue check entirely (`cmp byte[0x42],0x1`
gating a title-screen-entry flag, `DS:0x38c` — see the correction below).

⚠️ **Correction: the shop is not an automatic between-level screen in worlds
2–4.** An earlier revision of this section read the gate above as "worlds 2–4
show [object messages] on the shop screen between levels," implying the shop
itself opens routinely. An exhaustive program-wide search for every writer of
`DS:0x3ab` (`search_instructions`, mnemonic `MOV`, operand `0x3ab`) finds
exactly four sites: `CS:0x4846` (an orphan block with zero referencing
instructions — dead), `CS:0x484e` (clears it), `CS:0x6c58` (`FUN_1000_6c19`,
the one live *setter*), `CS:0x6db2` (`FUN_1000_6d7b`, clears it on exit). And
`get_xrefs_to(1000:6c19)` returns **exactly one** reference program-wide:
`CS:0x0693`, an unconditional `CALL` from `FUN_1000_0643` — not from the
level-exit tally screen, not from the shop-potion pickup (`CS:0x61e9`), not
from the trigger-summon path (`CS:0x3dd6`/`DS:0x361`). `FUN_1000_0643` is
itself reached only from `FUN_1000_006f`'s `CS:0x00cb JMP`, gated on
`DS:0x38c` — a flag set once, at title-screen entry (`CS:0x2c8a`), and cleared
only by the BEGIN QUEST dispatch (`CS:0x2d99`) or the attract-mode demo
cycler (`CS:0x2e13`) — **never by a successful password entry.** So the shop
opens **exactly once per game**: immediately after a correct password takes
the player straight into world 2, 3 or 4 (after `FUN_1000_0643` grants a
fixed starting stash, `DS:0x194:=0x3880`), never on an ordinary level exit and
never automatically per-level. In ordinary, non-password play, this gate's
practical effect in worlds 2–4 is therefore just **silence** — object/treasure
pickup messages are dropped (except the category-2 key and type-0x53
shop-potion bypasses `CS:0x4613`/`0x4618` already document above), not shown
on some other screen. What the type-0x53 potion / trigger-summon paths
(`DS:0x361`/`0x363`, a separate "shopkeeper NPC" state tested at `CS:0x0248`)
actually connect to remains unresolved — no direct call from either reaches
`FUN_1000_6c19`, so if they open the shop at all it is through an
unidentified indirect/table dispatch. `[WF]`, not independently re-verified
byte-for-byte beyond the `DS:0x3ab` writer census and the `6c19` xref check
above (both spot-checked directly); the shop's own internal mechanics (item
grid, buy/sell dispatch, the roster filter pipeline) are now fully
disassembled and partly live-confirmed — see `docs/shop.md`.

Type `0x53` (the shop potion) jumps past **both** the world gate and the bitmap,
from the ordinary in-level pickup path, in any world, every time.

⚠️ `DS:0x3ab` has a **fourth** writer at `CS:0x4846`, inside an orphan block
(`CS:0x4828`-`0x484b`) that no instruction references. Because the block has no
owning function, caller- and xref-based sweeps miss it. `[STATIC]`.
⚠️ It is not orphaned: no *instruction* references it, but the `SS:0x35AA` bit
table does (bits 0, 3, 11). It is the sublevel-B switch, reached from the
progress-record tally — `[PROVEN]` live, see `docs/camera-and-world-nav.md`'s
selector-6 section.

### The once-per-type bitmap, `DS:0x8cea`

16 bytes / 128 bits (`CS:0x8ee9 mov cx,0x10` + `rep stosb`), indexed as bit
`type & 7` of byte `type >> 3`, test-and-set in one pass
(`test` / `pushf` / `or` / `popf`). Cleared on a full level entry, and *not* on
the light re-entry path.

**The retry path matters**: `CS:0x4717` tests the submit's return and, on a
refusal, un-sets the bit it just set (`mov ch,0xfe / rol ch,cl / and [si],ch`),
so a message that loses a priority race is retried rather than lost forever.

Four call sites reach the composer: consumable pickup and treasure pickup
(`CS:0x1839` / `CS:0x18a4`, `CX` = type), chest-opened (`CS:0x18ef`,
`CX = type|1`), and the shop's hover wrapper (`CS:0x6e43`), which force-clears
the seen bit first so a description re-shows every time the cursor lands on it.

## `CS:0x63D5` — the hint tablet bypasses all of it

The handler is entry 18 of the 23-entry consumable table at `DS:0xd8b8`.

```
63da  mov di,0xab60                 ; the 40 native-endian int16 keys
63dd  mov bp,[0x208] / mov ax,[bp-0x6] / add ax,[0xa]
                                    ; the key is this object's own WORLD X:
                                    ; its screen X from the draw-list record the
                                    ; walker just appended, plus the camera origin
63e9  mov cx,0x28
63ec  lea si,[di+0x50]              ; the parallel arena-offset table, DS:0xabb0
63ef  add di,2 / cmp ax,[di-2] / jz 0x63fe / add si,2 / loop
                                    ; EXACT equality, first match wins
63fe  [0x27c] = si
6409  call 0x4737                   ; the composer's buffer allocator, shared
640d  mov si,0xed0e + four movsw    ; "\x11 Hint \x11"
6416  al=0x20 / stosb
641d  mov si,[si] / add si,0x1fc6   ; the hint text, in the shared arena
644e  movsb loop                    ; append it
6456  0x20 / 0x11 / NUL
6460  [0x212] = si
6464  mov dx,0x64 / call 0x434e     ; submit at priority 100
646c  sub dx,dx / ret               ; return tier 0
```

Three consequences a port must get right:

1. **It never calls `CS:0x4609`.** It builds its own buffer and submits directly,
   sharing only the buffer allocator.
2. **It returns `DX = 0`,** which makes the pickup dispatcher's tier decode at
   `CS:0x182D` (`or dx,dx / jz`) skip the generic composer — so the player never
   also sees the tablet's own `"tablet"` / `"reveals clues"`. The `gods-web`
   port had this row recorded as `dx: 1`, which is refuted by `CS:0x646C`.
3. **It touches neither the once-per-type bitmap nor the world gate.** That is
   what lets all 46 placed tablets each show their own distinct line, in every
   world. The only gates it passes are the priority test and the blit gate.

### ⚠️ The no-match arm is a shipped, reachable stack underflow

`CS:0x63FC jmp 0x6425` lands on nine `POP`s — `1f 07 5f 5e 5d 5a 59 5b 58` —
having pushed five words. The first pop loads `DS` with `0x63d5` (the handler's
own address, still in `SI` from the dispatch), the sixth eats the return address,
and the `RET` at `CS:0x646E` returns to the tablet's screen Y. There is no
matching nine-`PUSH` prologue anywhere in the image, so this is not an epilogue
the handler merely shares.

It is reachable in shipped data: of the 46 placed tablets, **two match no key in
their level's `PALFILS`** — `PLEV1B` objects at `x=348` and `x=329`, against
`PALFILS.0B1`'s only live keys 1521 and 1611. What the arm was *written* to show
is the string at `DS:0xed17`, `"Hint Error"`, reached through a 5-entry pointer
table at `DS:0xe94a` whose entries are all the same pointer.

`UNKNOWN_63d5_nomatch_runtime_effect` — what the machine actually does, frame by
frame, after the underflow fires is established only statically; it has not been
observed under a live debugger. `UNKNOWN_plev1b_nomatch_tablets_touchable` —
whether the hero can physically reach either object in ordinary play was not
checked.

## Where the port implements this

`gods-web/src/game/message.js` (the engine and the blit),
`message-compose.js` (the two composers, the gates, the seen bitmap) and
`text-arena.js` (the `DS:0x1fc6` pool). `npm run messages` renders every shipped
hint's pages onto the real panel; `node tools/frame-node.mjs 1A 12 out.ppm 178
p2` composites the whole frame. The `checkMessages` group in
`src/verify/checks.js` carries the invariants.

# The shop screen — `FUN_1000_6c19` (loop), `FUN_1000_6e62` (buy/sell dispatch), `FUN_1000_7233`/`0x7276` (roster)

Placement (when the shop opens at all, and that it is not a between-level screen)
is established in `docs/message-line.md`'s own "world gate is not world 1 only"
section — this file only covers the shop's *internal* mechanics, disassembled
and partly live-confirmed this session. Read that section first if the "shop
opens exactly once per game, via password entry only" claim looks unfamiliar.

> **How this was established.** `FUN_1000_6c19`, `FUN_1000_6e50`, `FUN_1000_6e62`,
> `FUN_1000_7233`, `FUN_1000_7276`, and `FUN_1000_7392` were disassembled directly
> (`disassemble_bytes`/`disassemble_function`, not the decompiler — several branches
> here turn on a carry flag or a register-passed return value the decompiler's
> pseudo-C either dropped or mis-rendered as a dead variable, e.g. `FUN_1000_6e50`'s
> result surfaces only as `JNC`, never as a value the pseudo-C shows). The 18-slot
> grid and slot-17-is-EXIT were additionally **live-confirmed under DOSBox**: forced
> into the world-2 shop via the isolated-write technique (below), screenshotted, and
> the on-screen icon layout matches the disassembled cursor math exactly. Item
> **prices are not established** — see `UNKNOWN_shop_prices` — despite the price
> *formula* being fully disassembled; that gap and how it happened are recorded
> honestly rather than papered over, because a wrong number here would be worse
> than none.

## Forcing shop entry live, without a real password

Passwords are wall-clock-seeded (`docs/dynamic-trace-and-runtime-data.md`), so
there is no way to know one in advance. Typing 40+ precise letter-grid moves blind, while fighting the title screen's
own attract-mode demo takeover (it hijacks input within seconds of the menu
appearing — the same behavior `docs/dynamic-trace-and-runtime-data.md` already
documents for the demo's own use of this menu), is impractical. Instead: write a fixed 3-letter password directly into slot 0
(`DS:0x432`, world 2's slot) while sitting at the title menu, breakpoint on
`FUN_1000_241d` (the input poller — called from every idle/menu/shop loop, a
safe and frequent landing spot fully inside `GAME.EXE`'s own code segment, not
a BIOS/DOS interrupt context), and once stopped there, overwrite the five bytes
at that address with a **far call** (`9A` + offset + segment, live segment `877`
established via the project's own CS-delta convention) to `FUN_1000_006f`'s live
address — **not** `FUN_1000_0643` directly. That distinction matters: `0x006f`'s
own prologue unconditionally runs `FUN_1000_8c34` (the level/map loader) before
its own `DS:0x38c`/`DS:0x42` check redirects into `FUN_1000_0643`, and skipping
that load (an earlier pass in this session called `0643` directly) leaves
level-scoped tables — the price table among them — never populated, and the
shop eventually crashes solid (CS:EIP lands executing the interrupt
vector table's own bytes as code) after enough ticks. Routing through `006f`
survived; direct-to-`0643` did not. `DS:0x42` (world) is set to `2`/`3`/`4`
before the injection; `DS:0x38c` is already `1` from title-screen entry and
does not need touching.

## The grid: 18 cells, 3×6, clamped not wrapped, slot 17 is EXIT

```
6e74  mov al,[0x385] / sub ah,ah / cmp ax,0x11 / jnz +5
6e7e  jmp 0x6d7b                      ; cursor==17 -> leave the shop, no lookup
...
6cef  mov ax,0x11
6cf2  test [0x382],0x8  (RIGHT) / jz +.. / inc [0x385] / cmp al,[0x385] / jge +.. / dec [0x385]
6d07  test [0x382],0x4  (LEFT)  / jz +.. / dec [0x385] / jns +.. / inc [0x385]
6d18  test [0x382],0x1  (UP)    / jz +.. / sub [0x385],6 / jns +.. / add [0x385],6
6d2b  test [0x382],0x2  (DOWN)  / jz +.. / add [0x385],6 / cmp al,[0x385] / jge +.. / sub [0x385],6
```

`DS:0x385` is the cursor index, `0..17`. Direction bits are the project's own
already-established convention (`docs/player-state-machine.md:17`: bit0 up,
bit1 down, bit2 left, bit3 right) — UP/DOWN move by row (±6), LEFT/RIGHT by
column (±1), and **every one of the four clamps at the grid edge rather than
wrapping**: moving left from column 0, or up from row 0, simply does nothing
that tick (the post-move `dec`/`sub` is undone), and likewise moving past the
last populated column or past row 2. This is `[PROVEN]` both on paper and live:
the DOSBox capture below shows a 3-row × 6-column grid with the bottom-right
cell reading `EXIT` — cursor value `17`, checked and dispatched *before* any
grid-table lookup, `[PROVEN]` — matching the disassembly exactly.

Live DOSBox capture of the world-2 shop (screenshot taken this session, not
attached to this file): 5 icons in the top row, an apparently-full second row
(the screenshot's own low light made the icons hard to read by eye — the live
`SS`-relative slot dump below removed the ambiguity and confirmed all 6 are
populated), 3 icons plus a gap in the third row, and `EXIT` in the last cell.

## The roster pipeline — `0x408c` is the FILTERED WORKING COPY, not the roster

⚠️ **Correction for anyone reading this project's own session notes before this
file existed**: an earlier working note (this port's own backlog memory, not
CLAUDE.md) called `DS:0x408c` "the per-world roster table." That is wrong in a
way that matters. `0x408c` is a 30-word (`0x1e`) **scratch buffer that gets
overwritten every time the shop (re)builds its visible grid** — it is the
*output* of a filter-and-sort pass, not the source data. The actual per-world
source is `DS:0x51aa`.

```
7233  cmp byte[0x38c],0
      == 0:  ptr = word[0x5078 + (((world-1)*2 + sublevel_adj) - 1)*2]   ; sublevel-indexed
      != 0:  ptr = word[0x51aa + (world-1)*2]                             ; WORLD-ONLY, 4 entries
      (copy 30 words from ptr into 0x408c)
      call FUN_1000_7276
```

`DS:0x38c` is the already-documented title-screen-entry flag (`docs/message-line.md`).
The shop's **only live entry path** (`FUN_1000_0643`, reached from `FUN_1000_006f`,
reached only after a successful password) never touches `0x38c`, and `0x38c` is
only ever cleared by BEGIN QUEST or the attract-mode demo cycler — so at the one
call site that shipped code can actually reach, `0x38c` is provably still `1`.
**The `0x5078` sublevel-indexed branch is dead for the shop feature specifically**
— every real invocation uses `DS:0x51aa`, a plain 4-entry (`world 1..4`) pointer
table to a `-1`-terminated list of raw item ids. `[PROVEN]` by disassembly;
`UNKNOWN_shop_roster_source` below is about not having *read* those 4 lists,
not about how they're selected.

`FUN_1000_7276` (`0x7276`-`0x7391`, with a same-function continuation Ghidra
splits off as `FUN_1000_73d3` — it is reached only by a plain `JMP`, not a
`CALL`, and jumps back into `0x7276`'s own loop; it is not a recursive call
despite how the decompiler renders it) then, for every non-empty id in that
copy:

1. Computes a **category index** by counting `0x00` bytes among the first `id`
   bytes of `DS:0xef78` (a per-item boundary-marker byte array — the same table
   `FUN_1000_6e62`'s purchase path uses, see below).
2. Skips the id if `DS:0x319[category]` is already set (bought this category
   already, this shop visit — `0x319` is a 23-byte scratch cleared to zero at
   shop entry, `CS:0x6c5d`-`0x6c67`).
3. Skips it if either of two unexplained eligibility gates fails —
   `FUN_1000_731b` (`AND`s three words at `DS:0xdd10`/`0xdda2`/`0xde34`, then
   additionally special-cases raw ids `2` and `3`) or `FUN_1000_7336`
   (checks `DS:0x168 == -1`, then special-cases ids `0x28`/`0x29`). Both were
   disassembled but their *bit-level meaning* was not chased further — see
   `UNKNOWN_shop_eligibility_gates`.
4. Calls `FUN_1000_7392(id)` (the price/value accessor — see below) and skips
   the id if its cost exceeds current money (`DS:0x194:0x196`).
5. Otherwise keeps it in a 30-slot scratch (`DS:0x4050`), then copies that
   scratch back into `0x408c`, **selection-sorts it ascending by
   `FUN_1000_7392`'s own value**, and counts the survivors into `DS:0x318`.
6. If zero survivors, forces the cursor straight to the EXIT cell
   (`*(byte*)0x385 = 0x11`) — the shop can render as "nothing for sale," never
   as a broken empty grid the player could get stuck hovering.

`FUN_1000_707d` (the per-tick grid *renderer*, not the builder) additionally
computes a scroll offset `DS:0x25c = count - 17` whenever the survivor count
exceeds 17 (the number of non-EXIT cells) — i.e. the roster can in principle be
longer than one screenful. **Not exercised by either live capture below** (15
and 16 survivors respectively, both `< 17`) — `UNKNOWN_shop_roster_source`
covers whether any shipped world roster is ever long enough to trigger it.

### Two independent live captures of world 2, and why they disagree

Both forced via the same technique (money `0x3880`=14464, fresh spawn, no
prior purchases):

| Run | Survivors (`0x408c`, in on-screen order) |
|---|---|
| 1 | `70,72,53,52,51,71,44,0,197,38,35,36,194,201,42,` empty,empty,empty |
| 2 | `72,71,70,53,52,51,44,201,194,42,36,35,2,197,38,0,` empty,empty |

The **stable core** — `{0,35,36,38,42,44,51,52,53,70,71,72}` plus sell-marker
ids `{194,197,201}` — is identical across both runs. Run 2 additionally shows
id `2`, run 1 doesn't, and the sort order differs entirely between runs. This
is not read noise: it is exactly what step 3 above predicts — `FUN_1000_731b`'s
own special case for id `2` gates it on a runtime word triple this session
never decoded, so the SAME world's shop can legitimately show a different item
count from one boot to the next. **Do not treat either list as "the" world-2
roster** — both are one filtered sample of it, taken at different eligibility
states. The raw source (`DS:0x51aa`'s own 4 pointers) was never read.

Ids `≥0xc0` (`194`, `197`, `201` here) are **not** extra high-priced buy items —
`FUN_1000_6e62` (below) routes any id `≥0xc0` to the sell path unconditionally,
with no buy branch reachable for that range at all. `194-192=2`, `197-192=5`,
`201-192=9` — these are **sellable-item TYPE ids** (not raw inventory-slot
indices 0-3; the confirm path's own `FUN_1000_953e(type)` call, not chased
further this session, is what maps a type to "do you currently hold one, and
in which of your 4 slots" — seen in the disassembly below but not itself
disassembled).

## Buy: two-press confirm, category lockout, refund-and-message on a full inventory

`DS:0x258` caches "the item currently under preview" (its raw id, always
stored positive). Pressing FIRE:

```
6e91  cursor slot empty (<0)         -> back to the poll loop, no-op
6ea2  raw id == abs([0x258])         -> CONFIRM (buy or sell dispatch, below)
      else                          -> PREVIEW ONLY: store id in [0x258],
                                        call 0x6e20 (id<0xc0) or 0x6df5 (id>=0xc0)
                                        (draw-only routines; not chased further),
                                        return to the poll loop without buying
```

So buying anything is **always two presses**: the first on a slot just shows
its detail card, the second (on the *same* slot) executes the purchase. This
is `[PROVEN]` from the disassembly; not independently live-confirmed (the
DOSBox session ended before a purchase was attempted).

On confirm, for `id < 0xc0` (`CS:0x6ee0`-`0x6f7a`):

1. `FUN_1000_22ca(0x333)` — a sound-effect cue (`FUN_1000_22ca` is the
   project's own already-established SFX-play primitive, `AX` = effect id;
   see `docs/player-state-machine.md:411` and `docs/entity-systems-spawning.md:908`
   for its two other cited call sites — this is a third, previously unlisted).
2. `price = FUN_1000_7392(id)` (see below); `money -= price` (a real 32-bit
   subtract, `SUB`+`SBB`, not the 3×SAR bug documented elsewhere in this
   project).
3. Category index via the same `0xef78` zero-count scan as the roster filter
   (`DS:0x319[category] = 1` — locks this category out of the roster for the
   rest of this shop visit, independent of whether the purchase actually
   succeeds in the next step).
4. `if (DS:0x5060[category] == 0)`: **give-to-inventory path** — scan the
   4-slot weapon/item array `DS:0x17e/0x180/0x182/0x184` for an empty slot
   (`word < 0`), **skipping the slot that equals `DS:0x366`** (the *currently
   selected* slot — already established in `docs/consumables-and-treasure.md:154`
   as `[0x17e+[0x366]*2] = dx` on an ordinary in-level pickup). If every
   eligible slot is full, **refund the money** (`money += price`) and submit a
   message at priority `0x19` (25) with text pointer `0xec8b` via `FUN_1000_434e`
   — `CS:0x6f6d` is exactly the address `docs/message-line.md`'s own priority
   table already lists for "object messages, shop refusals," an independent
   cross-check between the two sessions that touched this code.
5. `else` (`0x5060[category] != 0`): call straight into `DS:0xd8b8 + category*2`
   — **the same 23-entry consumable-pickup jump table** `docs/message-line.md`
   already documents for the hint tablet (`CS:0x63D5`). Buying a potion/key
   from the shop runs the identical handler an in-level pickup would.

## Sell: id ≥0xc0 always routes here; three-stage confirm

```
6ed7  raw id >= 0xc0 on CONFIRM -> 0x6f7c
6f7c  if [0x258] < 0 (already toggled negative)   -> 0x6fa7  ; EXECUTE
      else:
        FUN_1000_953e(id-0xc0) -> SI               ; does the player hold this type?
        if not holding it, or holding the exact same type again -> 0x6fa7 ; EXECUTE
        else: FUN_1000_703a() (preview only) ; NEG [0x258] ; back to poll loop
6fa7  EXECUTE: FUN_1000_22ca(0x333) (same confirm sfx as buy)
      FUN_1000_953e(...) again, then a value computed from an 80-byte-stride
      table at DS:0xe2b6 (keyed partly by the 953e result, partly by the raw
      inventory-slot arithmetic) is added to money, and a second value from
      the SAME table (keyed by slot index directly) is subtracted.
```

The **trade-in value arithmetic itself was not resolved** this session — see
`UNKNOWN_shop_tradein_value`. What *is* proven: sell is reachable, always
gated on the same raw-id-≥-0xc0 rule the buy path also enforces, uses the same
confirm sound effect, and needs its own multi-step confirm distinct from buy's
plain two-press (a third press only actually executes once `[0x258]` has been
toggled negative by a *second* distinct press — a minimum of two presses to
preview plus one more to execute, three total, vs. buy's two).

## `FUN_1000_7392` — the price/value accessor (formula proven, table contents not)

```
7392  cmp ax,0xc0 / jge 0x73b1
      id<0xc0:  DI = 0x2a4e + id*10 ; DH=byte[DI+6] ; DL=byte[DI+7] ; return DX=(DH<<8)|DL
      id>=0xc0: DI = 0xe2b6 + (id-0xc0)*80 ; DH=byte[DI+0x4a] ; DL=byte[DI+0x4b] ; return DX
```

This is the exact function both the roster's own afford-filter (`CS:0x72c9`)
and the buy-confirm price deduction (`CS:0x6ef7`-`0x6efc`, byte-swapped via
`XCHG AH,AL` there rather than the direct `DH`/`DL` load here — same value,
different instruction sequence) call. The **formula is `[PROVEN]`** — read
directly off two independent call sites' own disassembly, not the decompiler.

## `UNKNOWN_shop_prices`

The table **contents** at `DS:0x2a54` (stride 10, price at the record's own
first word, byte-swapped) were captured once, live, as a 730-byte dump
covering ids `0`-`72`. That capture cannot be trusted: several ids that the
SAME live session's own affordability filter had already accepted into the
visible roster (with starting money `14464`) decode, under the proven formula
above, to prices far exceeding `14464` (`id 51 → 59454`, `id 70 → 62597`) —
direct proof that this session's own hand-transcription of the 730-number
tool result into a file (done to parse it with a script, since eyeballing a
flat 730-element array reliably is not something to trust either) dropped or
mis-copied bytes somewhere the record-boundary landmark (a monotonic counter
byte at each record's own offset `+3`, confirmed unbroken for ids `1`-`72`)
did not happen to catch. **No number from that capture is cited anywhere in
this file or in the `gods-web` port.** The formula is solid; the specific
prices for any item are not established. A future session should re-read
`DS:0x2a54` (id `<0xc0`) and `DS:0xe2b6` (id `>=0xc0`, stride 80) directly with
a machine-verified parse (e.g. a script fed the tool's own JSON, not a
hand-copy) rather than trusting a manual transcription of a 730-number array.

## `UNKNOWN_shop_roster_source`

`DS:0x51aa`'s own 4 pointers (one per world) were never dereferenced this
session — every roster observation came from `0x408c`, the *filtered output*,
not the source list. Reading the 4 raw lists would settle both "what's the
full candidate set per world" and "is the `0x25c` scroll path ever shipped-data
reachable" in one pass, without needing a live DOSBox session at all (the
table is static, never written — confirmed via a program-wide write-search
this session).

## `UNKNOWN_shop_eligibility_gates`

`FUN_1000_731b` (three words ANDed from `0xdd10`/`0xdda2`/`0xde34`, then a
special case for raw ids `2`/`3`) and `FUN_1000_7336` (`0x168 == -1`, special
case for `0x28`/`0x29`) were disassembled but their bit-level meaning was not
chased. Both directly explain the run-to-run roster variance observed live
(above) but neither table's actual semantics are established.

## `UNKNOWN_shop_tradein_value`

The `DS:0xe2b6` (stride `0x50`=80) sell-value computation
(`(rec[+8]-rec[+6]) * (byteswap(rec[+0x4a])+1) >> 1`, added to money, followed
by a *second*, differently-indexed subtraction from the same table) was
disassembled but not resolved to a clean "this is what selling item X for Y
condition returns" statement. Do not guess a refund formula from this.

## What `gods-web` ports and what it discloses as not ported

See the port's own `game/shop.js` header for the current state — built and
tested as a state machine (grid navigation, the two-press buy confirm, the
`0x319` category lockout, the `0x5060` auto-use-vs-inventory branch, the
selected-slot skip, the priority-`0x19` refusal message), fed roster and price
data through an explicit constructor parameter rather than a hardcoded
per-world table, specifically because `UNKNOWN_shop_roster_source` and
`UNKNOWN_shop_prices` above are both still open. Sell is not ported — see
`UNKNOWN_shop_tradein_value`.

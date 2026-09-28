# The shop screen — `FUN_1000_6c19` (loop), `FUN_1000_6e62` (buy / weapon-swap dispatch), `FUN_1000_7233`/`0x7276` (roster)

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
> **prices are now established** for the ids this port's world 2/3/4 rosters
> use — see `UNKNOWN_shop_prices`, closed in a later session via a machine-parsed
> live memory dump (not a hand transcription) plus independent live purchase
> confirmation. The fuller table (ids 0-131) is read and landmark-verified but not
> purchase-confirmed past the original 12. **The per-world roster source is also
> now established** — see `UNKNOWN_shop_roster_source`, closed the same session
> after finding that the previous "reads as zero" result was a segment error
> (`SS:0x51aa`, not `DS:0x51aa` — `[BP+disp]` addressing defaults to `SS` in
> real mode), not evidence the table needed something more exotic. **The two
> eligibility gates' bit-level meaning is also now established** — see
> `UNKNOWN_shop_eligibility_gates`, closed by cross-referencing three
> already-`[PROVEN]` findings elsewhere in this project (the hero's weapon
> slots, the "hero starts unarmed" restart clear, and the familiar-energy
> word `DS:0x168`) plus one fresh live read this session.

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
does not need touching. (A later session found the `DS:0x432` slot-0
password write described above is not actually load-bearing — setting only
`DS:0x42`/confirming `DS:0x38c` and injecting is sufficient; it may have been
a leftover from an earlier, abandoned real-password attempt.)

**The patch must be one-shot, not left permanent — a second failure mode,
distinct from the `006f`-vs-`0643` one above.** `FUN_1000_241d` is called
from every idle/menu/**shop** loop, so leaving the far-call bytes in place
means the first time anything inside `006f`'s own world calls the input
poller again — including the shop's own loop, once it starts — execution
lands right back on the patched address and re-enters `006f`, runaway,
corrupting the stack. This manifests as the emulator's frame counter still
advancing while the screen is permanently stuck (not a hard crash) — a
distinct symptom from the `006f`-vs-`0643` crash above, discovered when a
later session replayed this exact recipe without the fix and hung at the
high-score screen with input dead. **Fix**: add a second execute breakpoint
at the far-call's own target (`FUN_1000_006f`'s live address) before
resuming from the `0x241d` breakpoint. When it fires, `EIP` is already past
the consumed far call; restore the original 5 bytes at `0x241d` (captured
from the first breakpoint hit's own `code_bytes`, e.g. `53 50 52 51 56` —
`PUSH BX/AX/DX/CX/SI`) before continuing. `006f` then runs, calls the level
loader, and opens the shop with an intact input poller for its own loop to
keep using.

## The grid: 18 cells, 3×6, a flat index clamped only at its ends, slot 17 is EXIT

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
column (±1) on the **flat** index. Only the flat index's two ends clamp: `RIGHT`
undoes a step past `0x11`, `LEFT` a step below 0, `UP`/`DOWN` a step that leaves
`0..0x11`. So `RIGHT` from a row's last column lands on the next row's first
cell, and `LEFT` from a row's first column on the previous row's last cell.
The 3-row × 6-column grid with `EXIT` in the last cell is `[PROVEN]` live
(capture below), and cursor `17` is checked and dispatched *before* any
grid-table lookup, `[PROVEN]`.

⚠️ **Correction, 2026-09-28** `[STATIC]`: this section used to say every
direction clamps at the grid *edge* ("moving past the last populated column …
does nothing") and called that `[PROVEN]` live. The live capture only showed
the grid's shape; the listing above has no per-row test, and `gods-web`'s
`ShopScreen` had shipped the row clamp. Both are corrected.

**Held-direction auto-repeat, `CS:0x6CAA`–`0x6CEA`** `[STATIC]`, ported.
`DS:0x339` latches the input byte, `DS:0x33A` counts held passes:

```
6caa  [0x382]==0      -> [0x339]:=0, [0x33a]:=0            (then the move block, no bits)
6cb1  [0x339]==0      -> [0x33a]:=1, [0x339]:=[0x382], move (a new press)
6cc6  [0x382]==[0x339]-> inc [0x33a]; <8 skip; else [0x33a]:=6, move
6cde  otherwise       -> [0x33a]:=0, skip                   ([0x339] is NOT updated)
```

A new press moves at once, the 7th held pass after it moves again, then every
2nd pass. Passes run at 20 Hz (`CS:0x6D72`'s 2-tick wait), so a held direction
repeats at 10 Hz after 0.35 s. Changing direction without releasing never moves.
FIRE is handled by `CS:0x6E62`, which polls until FIRE is released, acts, and
jumps back to `CS:0x6C90` without clearing `[0x339]`. So the first direction
pass after a FIRE doesn't move unless a neutral pass cleared it. A pass whose
cursor changed plays sfx `0x232` (`CS:0x6D42`–`0x6D4F`, against `[0x25a]`, the
pass-start cursor).

**The inventory-full refusal text** is `DS:0xEC8B`: `11 " Inventory Full - You
cannot buy that " 11 00` (`CS:0x6F67`, priority `0x19`). `CS:0x6F5E` first adds
the price back to `DS:0x194` (`add [0x194],bp / adc [0x196],0`), so the net
money change is zero, the same as the port's check-before-charge.

Live DOSBox capture of the world-2 shop (screenshot taken this session, not
attached to this file): 5 icons in the top row, an apparently-full second row
(the screenshot's own low light made the icons hard to read by eye — the live
`SS`-relative slot dump below removed the ambiguity and confirmed all 6 are
populated), 3 icons plus a gap in the third row, and `EXIT` in the last cell.

## The roster pipeline — `0x408c` is the FILTERED WORKING COPY, not the roster

⚠️ **Correction for anyone reading this project's own session notes before this
file existed**: an earlier working note (this port's own backlog memory, not
CLAUDE.md) called `0x408c` "the per-world roster table." That is wrong in a
way that matters. `0x408c` is a 30-word (`0x1e`) **scratch buffer that gets
overwritten every time the shop (re)builds its visible grid** — it is the
*output* of a filter-and-sort pass, not the source data. The actual per-world
source is `0x51aa`.

⚠️ **Second correction, a later session: every address in this pipeline
section that this file previously cited as `DS:` is actually `SS:`** —
`0x51aa`, `0x408c`, and `0x4050` (the roster-load/filter scratch trio) all
live in the stack segment, not the main data segment. This was missed
originally because `[BP+disp]` addressing **defaults to `SS`, not `DS`, in
real mode** — the disassembly text (`MOV SI, word ptr [BP+0]`, `MOV BP,
0x408c` ... `MOV CX, word ptr [BP+0]`) never shows an explicit segment,
so the earlier pass assumed the project's usual `DS:` default rather than
applying the base-register rule. Two independent proofs: (1) live —
breakpointing the exact instruction and single-stepping it shows `SI` load
a real pointer value while `DS:0x51aa` itself reads all zero and `SS:0x51aa`
reads the same value `SI` just got; (2) static — Ghidra's own disassembly of
the surrounding `FUN_1000_7276` renders several of these same accesses with
an **explicit** `SS:` prefix in the text itself (`LODSW SS:SI`, `MOV word ptr
SS:[SI],BX`, `STOSW ES:DI` with `ES` freshly loaded from `SS`), which is only
printed when a real `0x36` override byte is present in the machine code —
not a inferred default. `DS:0x2a4e` (the price table, `[DI+disp]` addressing,
which DOES default to `DS`) and `DS:0x318`/`0x319`/`0x25c`/`0xef78` (plain
direct-displacement or explicitly `DS:`-overridden `[BP+disp]` addressing in
the very same disassembly) are unaffected by this correction — re-checked
against Ghidra's own text this session, still `DS`.

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
— every real invocation uses `SS:0x51aa` (see the segment correction above), a
plain 4-entry (`world 1..4`) pointer table to a `0xFFFF`-terminated list of raw
item ids. `[PROVEN]` by disassembly and now also live (below) —
`UNKNOWN_shop_roster_source` is CLOSED, see below.

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
3. Skips it if either of two gates fails — both fully disassembled AND
   bit-level-decoded, `UNKNOWN_shop_eligibility_gates` CLOSED (see below):
   `FUN_1000_731b` returns "skip" **only when** `DS:0xdd10 & DS:0xdda2 &
   DS:0xde34 == -1` **and** the raw id is `2` or `3` — any other id passes
   regardless, and if that AND is anything other than `-1` (all-ones), ids
   `2`/`3` pass too. That AND is `-1` exactly when the hero holds **no
   weapon at all** in any of his three weapon slots (see below) — world 2's
   own two live captures disagreeing on id `2`'s visibility reflects a hero
   who was unarmed in one run and armed in the other, not random state.
   `FUN_1000_7336` is the identical shape one level down: skip **only when**
   `DS:0x168 == -1` (no familiar alive) **and** the id is `0x28`(40) or
   `0x29`(41). Both special-cased pairs are otherwise ordinary entries in
   the raw source list (below) — they are not always available.
4. Calls `FUN_1000_7392(id)` (the price/value accessor — see below) and skips
   the id if its cost exceeds current money (`DS:0x194:0x196`).
5. Otherwise keeps it in a 30-slot scratch (`SS:0x4050`), then copies that
   scratch back into `0x408c`, **selection-sorts it ascending by
   `FUN_1000_7392`'s own value**, and counts the survivors into `DS:0x318`.
6. If zero survivors, forces the cursor straight to the EXIT cell
   (`*(byte*)0x385 = 0x11`) — the shop can render as "nothing for sale," never
   as a broken empty grid the player could get stuck hovering.

`FUN_1000_707d` (the per-tick grid *renderer*, not the builder) additionally
computes a scroll offset `DS:0x25c = count - 17` whenever the survivor count
exceeds 17 (the number of non-EXIT cells) — i.e. the roster can in principle be
longer than one screenful. **Now confirmed shipped-data-reachable**: world 3's
and world 4's raw candidate lists (below) are 21 and 23 entries respectively —
well past 17 even before the two eligibility gates run — so a real player
opening either shop with most/all gates open would see this scroll path fire.

⚠️ **`[STATIC]` — this is a misnomer: it is a fixed truncation, not a
scroll, and it drops the CHEAP end, not the recently-added end.** Reading
the actual bytes (`0x7091`-`0x70a7`, quoted in full above the numbered
filter-steps list) shows `BP` — the render loop's own cursor into the
already-ascending-by-price-sorted survivor list `0x408c` builds — starts at
`0x408c` and, only when `count > 17`, advances FORWARD by `scroll*2` bytes
before the render loop ever runs. There is no per-tick input anywhere that
moves this offset once computed, and no code that ever decrements it — it is
set once, at roster-rebuild time, from the count alone. So a shop with 18
eligible survivors doesn't let the player scroll to see the 18th; it
permanently shows only the 17 MOST EXPENSIVE ones and drops the single
CHEAPEST survivor outright, silently, every time the roster is rebuilt.
`gods-web`'s `ShopScreen#rebuildVisible` reproduces this exactly (sort
ascending by price, then keep only the last `DATA_SLOTS`) and a synthetic
test confirms it: feeding worlds 3/4's full 18-id list with both gates open
and unlimited money drops exactly id `70` — the single cheapest of the 18
— never any other id, matching this reading precisely. This was never
observed live against the ORIGINAL binary with more than 17 survivors
(both live captures in this file were world 2, capped at 15/16) — the
disassembly and the port's own reproduction agree, but the original itself
was never watched actually truncating a real overflowing roster.

### Two independent live captures of world 2, and why they disagree

Both forced via the same technique (fresh spawn, no prior purchases, money set
by `FUN_1000_0643` itself: `DS:0x194:=0x3880`, `DS:0x196:=1` — the FULL 32-bit
value is `0x1_3880 = 80000`, **not** `0x3880` alone; an earlier pass in this
session read only the low word and treated `14464` as the starting stash,
which is wrong and is corrected here):

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
states. The raw source (`SS:0x51aa`'s own 4 pointers) was read in a later
session — see `UNKNOWN_shop_roster_source` below — and its own 16-entry list
for world 1/2 is exactly the union of these two filtered samples, confirming
both captures and the source read agree.

### The 12 buy ids are exactly 12 `gods-web` `CONSUMABLES` types — independent cross-check

`{0,35,36,38,42,44,51,52,53,70,71,72}` — the full stable-core buy set from both
runs above — is **exactly** the set of `type` values already present in
`gods-web`'s own `game/consumables.js` `CONSUMABLES` table (ranks 0, 3, 4, 6,
10, 12, 14, 15, 16, 19, 20, 21 respectively: health, health, starburst,
invulnerable, extraLife, freeze, three weaponArc ranks, and three more health
ranks). Twelve items, twelve exact matches, zero misses. That table was built
from a completely different investigation (in-level consumable pickups, an
earlier session, no connection to the shop work this session) and uses the
POBJECTS object-type numbering throughout the rest of this project. This is
strong, independent confirmation that **the shop's own item ids are POBJECTS
type numbers** — not a separate shop-only id space — and, as a side effect,
that this session's own `0x408c` reads (the 12 ids themselves, as opposed to
their prices, below) are correct: 12 essentially-arbitrary-looking numbers
landing on exactly the auto-use consumable ranks already on record is not
plausible by chance. It also explains `DS:0x5060` cheaply: every one of these
12 is a "give effect immediately" type (`0x5060[category] != 0` in every
observed case for world 2) — the give-to-inventory branch was not exercised by
either live capture.

Ids `≥0xc0` (`194`, `197`, `201` here) are **not** extra high-priced consumables
and this is **not a sell mechanic** — `UNKNOWN_shop_tradein_value` is now
CLOSED, see below. `FUN_1000_6e62` routes any id `≥0xc0` to a **weapon
purchase/swap** dispatch unconditionally, with no ordinary buy branch
reachable for that range at all. `194-192=2`, `197-192=5`, `201-192=9` are
**weapon TYPE ids** (0-10, the same order `docs/combat-and-projectiles.md`
already establishes: `knife, time bomb, fireball, flame, lightning bolt,
throwing star, spear, axe, hunter, magic axe, mace`) — world 1/2's shop
offers to buy/switch to fireball(2), throwing star(5), and magic axe(9).

## Buy: two-press confirm, category lockout, refund-and-message on a full inventory

`DS:0x258` caches "the item currently under preview" (its raw id, always
stored positive). Pressing FIRE:

```
6e91  cursor slot empty (<0)         -> back to the poll loop, no-op
6ea2  raw id == abs([0x258])         -> CONFIRM (buy or weapon-swap dispatch, below)
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

## Weapon purchase/swap: id ≥0xc0 always routes here — `UNKNOWN_shop_tradein_value` CLOSED

**This is not a "sell your stuff for cash" mechanic — there is no shipped
path that refunds money without also arming a new weapon.** Every id `≥0xc0`
names a **weapon type to buy and equip** (`id - 0xc0` = weapon index 0-10);
the "sell" framing this file used until this session came from mirroring
`FUN_1000_7392`'s own two-branch shape (id `<0xc0` reads the consumable
price table, id `≥0xc0` reads a *different* table) without yet knowing what
that second table actually drove. `gods-web`'s `SELL_ID_BASE`/"sell" naming
inherited the same misreading and should be renamed if this gets ported.

`FUN_1000_953e(weaponIndex)` (fully disassembled this session — the earlier
"not chased further" note above is stale) is the SAME slot-selector
`docs/combat-and-projectiles.md`/`gods-web`'s own `pickup.js` already port
as `chooseSlot`/`weapons.js`'s `WEAPON_SLOTS` logic: weapon index `2`
(fireball) is hard-wired to slot C; otherwise a weapon whose own record
`+0x00` field is `0` goes to slot A; otherwise it competes for slots B/C,
preferring an empty one or (if both hold a weapon already) whichever holds
*fewer* extra pickups. It returns the target slot's base address
(`0xdd10`/`0xdda2`/`0xde34`) in `SI` and the slot number in `BX` — an
out-parameter pair the decompiler's pseudo-C for this function badly
mis-rendered (a truncated, wrong-looking `if (BX==2) ...; return;` body);
**read this one from `disassemble_function`, not `decompile_function`.**

```
6ed7  raw id >= 0xc0 on CONFIRM -> 0x6f7c
6f7c  if DS:0x258 (preview) < 0  -> 0x6fa7                     ; already warned -> EXECUTE
      else:
        SI,BX = FUN_1000_953e(id-0xc0)                          ; where would/does this weapon live?
        if that slot is EMPTY (DS:[SI] < 0), OR already holds
          this exact weapon (DS:[SI] == id-0xc0)   -> 0x6fa7    ; nothing displaced -> EXECUTE
        else: FUN_1000_703a()  ; builds "Warning.. this weapon replaces the "
                                ;   + the CURRENTLY-EQUIPPED weapon's own name
                                ;   (its record's own +0x20 embedded name string,
                                ;   confirmed by decompressing PWEAPONS.001 with
                                ;   blast.py: each 80-byte record carries its own
                                ;   null-terminated name there, e.g. "knife\0")
              NEG DS:0x258      ; toggle the preview negative -- needs ONE more press
              -> back to the poll loop
6fa7  EXECUTE: FUN_1000_22ca(0x333)  ; same confirm sfx as an ordinary buy
      SI,BX = FUN_1000_953e(id-0xc0) again
      if slot NOT empty AND DS:[SI] != id-0xc0:        ; a DIFFERENT weapon IS being displaced
        oldIdx = DS:[SI]
        rec = DS:0xe2b6 + oldIdx*0x50                   ; the DISPLACED weapon's own record
        refund = (rec[+8] - rec[+6]) * (byteswap(rec[+0x4a]) + 1) >> 1
        money += refund                                  ; a real 32-bit add
      price = byteswap((DS:0xe2b6 + (id-0xc0)*0x50)[+0x4a])   ; the NEW weapon's own price
      money -= price                                     ; a real 32-bit subtract
      FUN_1000_94a7(id-0xc0)                             ; the ARM routine -- already
                                                          ;   ported in gods-web as
                                                          ;   pickup.js's real pickup path
      FUN_1000_7233()                                    ; rebuild the roster
```

**`rec+0x4a`/`+0x4b` is the weapon's own PRICE, in the same units and scale
as the consumable table — not a stat.** Read out of all four shipped
`PWEAPONS.00{1-4}` files (`blast.py`): `knife=2500, time bomb=20000,
fireball=12500, flame=45 (the cut weapon, a degenerate placeholder value
consistent with its cut status elsewhere in this project), lightning
bolt=30000, throwing star=5000, spear=17500 (all four worlds), axe=10000
(worlds 1/2) or 17500 (worlds 3/4 — the only weapon whose price differs by
world in the first 9 records), hunter=15000 (all four worlds), magic
axe=15000 (worlds 1/2), 20000 (world 3), 10000 (world 4), mace=7500 (all
four worlds)`. This settles the dimensional question the refund
formula raises: `rec+8` (pickup count) minus `rec+6` (Power, the immutable
base — `UNKNOWN_weapon_08`, already closed) is the number of *extra*
duplicate pickups collected for that weapon, so **the refund is exactly
half the displaced weapon's own price, per extra copy collected** — a
proportional trade-in credit for however invested the player was in the
weapon being given up, not an arbitrary formula. `rec+0x20` (confirmed by
reading the decompressed bytes directly) is a null-terminated embedded name
string inside each weapon's own 80-byte record, the exact same "small
record with embedded name text" idiom this project already knows from
`POBJECTS`' 48-byte records.

**The three-press shape, precisely.** Buying a weapon for an EMPTY slot, or
re-buying the exact same weapon already equipped there, is a plain
two-press confirm exactly like a consumable (no displacement, no warning).
Buying a weapon that would displace a genuinely DIFFERENT weapon needs a
third press: press 1 previews (shows the new weapon's own description,
`FUN_1000_6df5`/`0x474c`); press 2 hits the CONFIRM branch, finds a real
mismatch, shows the "this weapon replaces the X" warning and toggles
`DS:0x258` negative *for this same raw id*; press 3 on the *same* cell
re-enters CONFIRM, and the negative-preview short-circuit sends it straight
to EXECUTE. **The reset is on a FIRE press, not cursor movement**:
`LAB_1000_6cef` (the cursor-move handler) never touches `[0x258]` at all —
only a fire press on a *different* cell resets it, at `6ea4`, to that new
id (positive). This has a real, slightly surprising consequence: warn on
weapon A (press 1, press 2 -> negative preview, third press pending), then
move the cursor away *without firing* and back to A — the preview is still
`-A`, unchanged, so the very next press on A is the THIRD press and executes
immediately with no second warning. The one-press-swap case genuinely
doesn't exist, but only because it requires a fire press elsewhere to arm
it, not because moving the cursor clears anything.

**Tags.** The control-flow and formula are `[STATIC]` — read directly from
disassembly (`disassemble_function`, not the decompiler, for `953e`) and
cross-checked against the shipped `PWEAPONS` bytes for the price-scale
claim; none of it was exercised live under DOSBox this session (no purchase
of a weapon-type id, nor a displacement, was actually driven through the
running game). The arm step (`FUN_1000_94a7`) and its own slot-selection
(`FUN_1000_953e`) were already `[PROVEN]` elsewhere in this project via
prior live pickup-path work — only the SHOP's own orchestration around them
(the warning, the refund, the charge) is new this session.

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

## `UNKNOWN_shop_prices` — CLOSED for the 12 ids this port's roster uses

**History of two retracted objections, kept for the record.** An earlier
pass of this session hand-transcribed a 730-byte dump of `DS:0x2a54` (stride
10, price at the record's own first word, byte-swapped) into a file to parse
with a script, and flagged it as untrustworthy twice: first, that several
decoded prices exceeded the observed starting money (`14464`) — wrong, that
was only the low word of a 32-bit value whose real figure is `80000`, and
against `80000` every decoded price for the 12 relevant ids is affordable;
second, that `FUN_1000_7276`'s ascending sort of survivors by
`FUN_1000_7392`'s value should make a live capture's buy-only subsequence
monotonic, and it wasn't — also wrong, since `FUN_1000_7392` reads a
*different* table for `id >= 0xc0` (then called "sell-side," `DS:0xe2b6`,
uncalibrated at the time — since resolved as weapon-purchase prices, see
`UNKNOWN_shop_tradein_value` below), and both live captures interleave those
`≥0xc0` ids into the same sorted list, so checking monotonicity of only the
buy-only subsequence of a jointly-sorted list proves nothing. Both
objections are retracted. What
actually remained wrong with that pass was narrower and real: the
transcription was independently known to be short by one element (729 of
730), and, being a single hand-copy nobody had re-read, no number from it
should have been trusted regardless.

**Closed in a later session, by not trusting a hand transcription at all.**
`DS:0x2a4e` (the record start; price is at each record's own `+6`/`+7`) was
read live via the DOSBox bridge's `mem_read` in `base64` view and decoded
by a script straight from that base64 string — no manual retyping of any
byte anywhere in the pipeline, the exact failure mode of the earlier pass.
Two reads (2048 bytes total) cover records `0`-`204`; a per-record tag byte
at each record's own offset `+0` increments by exactly 1 every record,
wrapping `0xff -> 0x00`, with **zero deviation for 132 consecutive
records** (ids `0`-`131`, tag `0xaa` through `0xff` then `0x00`-`0x2d`) —
far stronger self-consistency than the old dump's 71-record run with a
known one-element defect. Record `132` breaks the pattern, marking where
this table actually ends (**not** id `72` as the old, incomplete
transcription assumed).

**Independently corroborated by four live purchases**, a check the earlier
pass never ran: with a fresh `80000`-money shop open, the actual `DS:0x194`
money deduction on a real two-press buy matched the freshly-decoded price
exactly, for four different ids —

| id (slot bought) | decoded price | live `DS:0x194` delta |
|---|---|---|
| 70 | 650 | 650 |
| one of `{51,52,53,72}` | 1000 | 1000 |
| one of `{51,52,53,72}` | 1000 | 1000 |
| one of `{0,44}` | 4000 | 4000 |

The first is a **unique** match — `650` appears nowhere else in the decoded
table — so this is not "a plausible-looking number," it is the game's own
buy-confirm code path (`CS:0x6ef7`) independently agreeing with a plain
memory read, through no shared code or shared transcription between the two.

**Confirmed global, not per-world/level-scoped, by a direct re-read.** The
132-record dump above was captured during an ordinary world-1 start (no shop
injection); the four purchase deltas were captured separately, in a
world-2 shop. Those two facts alone leave open whether `DS:0x2a4e`'s
*content* could differ by world even though its *address* doesn't — the
same open question this file's own "Forcing shop entry" section already
raises for level-scoped tables in general. Settled directly: the identical
2048-byte range (`DS:0x2a4e`, records `0`-`204`) was re-read live with the
world-2 shop actually open and diffed byte-for-byte against the world-1
capture — **an exact match, all 2048 bytes**. The price table is populated
once with the same fixed content regardless of which world's level loaded
it, not a level-scoped economy that varies per world.

**All 18 raw ids either world's roster can name** (12 live-purchase-confirmed
originally, `37`/`39` added when worlds 3/4 were first wired in, and `2`/`3`/
`40`/`41` added once `UNKNOWN_shop_eligibility_gates` closed and the port
started actually gating rather than omitting them — see `UNKNOWN_shop_
roster_source` and `UNKNOWN_shop_eligibility_gates` below; only the original
12 are purchase-confirmed individually, the rest read from the same
132-record table with the same unbroken landmark):

| id | 0 | 2 | 3 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 44 | 51 | 52 | 53 | 70 | 71 | 72 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| price | 4000 | 6000 | 12000 | 8000 | 10000 | 20000 | 5000 | 30000 | 5000 | 10000 | 20000 | 4000 | 1000 | 1000 | 1000 | 650 | 1300 | 1000 |

Weapon-purchase prices (`DS:0xe2b6+0x4a`, id `>=0xc0`) are now resolved too
— see `UNKNOWN_shop_tradein_value`, CLOSED below, for the full 11-weapon
table (read from the shipped `PWEAPONS` files, not purchase-confirmed
individually the way the 12 original consumable prices were).

## `UNKNOWN_shop_roster_source` — CLOSED

Closed in a later session, once the segment error above (`SS:0x51aa`, not
`DS:0x51aa`) was found — a straight `DS:0x51aa` read had genuinely returned
all zero every time it was tried, including right after `GAME.EXE` starts,
at the title menu, and inside an open shop, which is what led the earlier
session to conclude (wrongly) that the table needed a live DOSBox read for
some *other* reason it couldn't pin down. It didn't; it needed the right
segment. Once corrected, `SS:0x51aa`'s 4 words read live as `20646, 20646,
20718, 20808` (worlds 1-4) — `SS:0x50a6`, `SS:0x50a6` (world 1 and 2 share a
list), `SS:0x50ee`, `SS:0x5148`. Each is a flat, `0xFFFF`-terminated list of
raw item ids (mixing buy ids `<0xc0` and sell-marker ids `>=0xc0` together,
exactly as `FUN_1000_6e62`'s dispatch already implied) — read live and
saved verbatim, not hand-transcribed:

| World | Raw list (sentinel-terminated) |
|---|---|
| 1 / 2 | `0,38,197,2,35,36,42,194,201,44,51,52,53,70,71,72` |
| 3 | `0,38,197,40,35,41,36,42,194,198,37,39,2,3,44,51,52,53,70,71,72` |
| 4 | `194,198,199,200,202,0,2,3,35,36,37,38,39,40,41,42,44,51,52,53,70,71,72` |

**World 1/2's raw list is an exact, independent reproduction of a fact this
project had only ever *inferred* before**: the "stable core" `{0,35,36,38,
42,44,51,52,53,70,71,72}` (12 ids) plus the conditionally-present `2` plus
sell markers `{194,197,201}` — derived earlier this project from comparing
two *filtered* live captures — is precisely this raw list's own 16 entries,
with nothing added or missing. That the unfiltered source and the two
filtered samples agree exactly, from two unrelated reads months apart, is
strong independent confirmation the whole pipeline (source table, filter,
and this project's own reconstruction of it) is understood correctly.

**Worlds 3 and 4 share an identical buy-id candidate set**, `{0,2,3,35,36,
37,38,39,40,41,42,44,51,52,53,70,71,72}` (18 ids) — world 1/2's 12 plus six
new ones: `2,3,37,39,40,41`. Cross-checked exactly like the original 12: all
six are real `gods-web` `CONSUMABLES` types (`2`→rank 1 weaponPower, `3`→
rank 2 weaponPower, `37`→rank 5 noop34c, `39`→rank 7 familiar, `40`→rank 8
familiarWings, `41`→rank 9 familiarClaws) — six items, six exact matches,
zero misses, the same signal that validated the original 12.

**Of those six, four are conditionally gated and two are not** — see
`UNKNOWN_shop_eligibility_gates` below, CLOSED. Ids `2` and `3` are skipped
when `DS:0xdd10 & DS:0xdda2 & DS:0xde34 == -1` (the hero is fully unarmed)
and pass once he holds any weapon; ids `40` and `41` follow the identical
shape gated on `DS:0x168` (no familiar alive). Both gates are reachable in
ordinary shipped play — gate 1 opens on the hero's first weapon pickup
(nearly certain by world 3), and gate 2 opens if the player buys id `39`
(the familiar, `30000`) in this same world 3/4 shop, since `39` is itself
one of the 18 raw ids and is not gated by either check. Ids `37` and `39`
are not named by either gate and pass unconditionally regardless.

**Consequently, this port now ships the FULL 18-id raw candidate list for
worlds 3/4** (`{0,2,3,35,36,37,38,39,40,41,42,44,51,52,53,70,71,72}`) and the
full 13-id list for world 2 (`{0,2,35,36,38,42,44,51,52,53,70,71,72}`), not a
pre-filtered subset — `ShopScreen#rebuildVisible` (`game/shop.js`) applies
both eligibility gates and the `0x25c` scroll truncation itself (see the next
section), reading `state.arsenal.slots` and `state.health.familiarEnergy`
directly, exactly as `FUN_1000_731b`/`FUN_1000_7336` do. An earlier revision
of this port shipped only the 14 ids passing regardless of gate state,
deliberately excluding `2,3,40,41` — a reasonable call while the gates'
meaning was unresolved, but a real port-fidelity gap once it wasn't (a player
who bought the familiar got no visible payoff, since `40`/`41` never
appeared regardless). Closed the same session `UNKNOWN_shop_eligibility_
gates` was: `npm run verify` exercises both gates directly (an unarmed vs.
armed hero, no familiar vs. one bought mid-visit) and the 18-vs-17 scroll
truncation, and a live browser check reproduced the same results.

## `UNKNOWN_shop_eligibility_gates` — CLOSED

Both gates' bit-level meaning is established this session by cross-
referencing three findings this project had already made and `[PROVEN]`
elsewhere — the shop's own gate code was never the only place these four
words are read — plus one live read this session confirming the identity
directly.

**Gate 1 (`FUN_1000_731b`, ids 2/3) reads the hero's own weapon inventory.**
`docs/entity-systems-spawning.md`'s `UNKNOWN_projectile_record` closure
already documents `DS:0xdd10`/`0xdda2`/`0xde34` as **the hero's three weapon
slots** — each holds a weapon index, or `0xFFFF` when empty — and states
outright: "those are exactly the three words trigger predicates COND3/COND4
test … independent confirmation that they are the weapon inventory." The
shop's gate reads the identical three addresses the same way (AND all
three, compare to `-1`) — a second independent confirmation of the same
fact. `docs/consumables-and-treasure.md`'s "The hero starts UNARMED"
section pins the write side: `CS:0x914c` clears all three to `0xFFFF`,
called only from the two full-game-restart sites (`CS:0x473`/`CS:0x8dd9`);
the only way a slot is ever set again is the arm routine `CS:0x90f9`, fired
by picking up one of the 55 shipped weapon pickups (object type `>=0xC0`).
So: **ids 2 and 3 (both "power potion" — increases weapon power) are hidden
exactly while the hero holds no weapon at all, and become purchasable the
moment any of the three slots holds one** — upgrading a weapon he doesn't
have would be meaningless, so this is a deliberate, sensible design choice,
not an arbitrary restriction. `docs/triggers-and-difficulty.md`'s ACT10
(`3e3f`, 7 shipped records) is the one shipped gameplay event that can
re-close this gate mid-level: it clears whichever of the three slots holds
a given weapon id, so a level script can take a weapon back and the shop's
own power-potion listing follows automatically on the next visit.

**Gate 2 (`FUN_1000_7336`, ids 40/41) reads the familiar's energy.**
`docs/combat-and-projectiles.md` already closes `UNKNOWN_DS_0168`: `DS:0x168`
is **the familiar's energy** — `-1` from every full restart (`CS:0xC440`
dismiss, called only by the two restart sites), set to `1000` on summon
(type-39 consumable, `CS:0xC2F6`/`CS:0xC347`), drained by damage
(`CS:0xAB4D`), and driven back to `-1` on death/dismissal. So: **ids 40 and
41 ("magic wings"/"power claws", both explicitly *effects familiar* in
their own `POBJECTS` text) are hidden exactly while no familiar is alive.**

⚠️ **Correction to this file's own earlier framing in this same session.**
An earlier pass here claimed gate 2 "never opens in shipped play" because
type 39 (the familiar-summon consumable) is placed in **zero** map
locations across all eight shipped maps. That census only covers *map
placement* — it misses the shop as a second, separate acquisition channel,
the exact blind spot `UNKNOWN_chest_key_surplus` already caught this
project making once before ("the prior pass only checked static object
placement; it never checked trigger actions that spawn objects"). **Id 39
is itself a purchasable item in worlds 3 and 4's own shop roster**
(`SS:0x51aa`'s raw list, `UNKNOWN_shop_roster_source` above; priced
`30000`, the single most expensive of all 18 raw ids this port now ships).
`FUN_1000_6e62`'s buy dispatch runs the identical category-0 consumable
handler a map pickup would (`safeApplyConsumable`'s `gods-web` equivalent
already mirrors this — see below), so buying id 39 in world 3 or 4's shop
sets `DS:0x168` to `1000` exactly as a (never-shipped) map pickup would have.
**Gate 2 is reachable in shipped play — a two-stage unlock (buy the
familiar, then its boosts become purchasable), not dead content.** Worlds
1/2 never carry `39`/`40`/`41` in their raw roster at all, so the gate is
moot there; it matters only for worlds 3/4.

**Tags, precisely.** The *identity* of all four words is `[PROVEN]` — a
fresh live read this session (`GAME.EXE` boot, world 1, mid-quest) found
slot A (`DS:0xdd10`) `= 0` (armed with the knife, weapon index 0), slots B/C
(`DS:0xdda2`/`0xde34`) `= 0xFFFF` (empty, confirming the empty-sentinel
convention live), and `DS:0x168 = 0xFFFF` (no familiar) — consistent with,
and now a live cross-check of, the three prior `[PROVEN]` docs cited above.
**The specific claim that the shop's own rendered roster visibly changes
when these words change is `[STATIC]`, not `[PROVEN]`** — this session read
the four words directly and separately re-confirmed the shop's own
disassembled AND/compare logic, but never round-tripped through an actual
shop screen with a controlled before/after (read the four words at a shop
entry with id 2 absent, force a weapon pickup, re-enter, confirm id 2 now
present and the words changed accordingly). That specific check was not run
this session; doing so would close the last gap to a fully end-to-end
`[PROVEN]` result.

This also retroactively explains this file's own earlier puzzle: world 2's
two live captures disagreeing on id `2`'s visibility (run 1 absent, run 2
present) is exactly what a hero who happened to be unarmed in run 1 and
armed in run 2 produces. Neither run read the actual weapon-slot words at
the time, but the mechanism now on record predicts precisely that shape.

## `UNKNOWN_shop_tradein_value` — CLOSED

Renamed from what this project's own earlier framing got wrong: there is no
"sell for cash" action anywhere in the shop. Every id `≥0xc0` is a **weapon
purchase** (buy weapon `id-0xc0` and equip it), and the "trade-in value" is
the partial refund credited for whichever *different* weapon that purchase
displaces from the same physical slot — see the "Weapon purchase/swap"
section above for the full mechanism, the resolved formula (`(extra pickups)
× (displaced weapon's own price + 1) ÷ 2`), the confirmed price table (read
from the shipped `PWEAPONS` files), and the three-press confirm shape
including the "Warning.. this weapon replaces the X" message. `[STATIC]` —
disassembly- and shipped-bytes-confirmed, not yet exercised live under
DOSBox.

## The money counter and its tick, `CS:0x718B` — `[PROVEN]` live (2026-09-28)

The shop does not show `DS:0x194`/`0x196` directly. It shows a copy at `DS:0x254`/`0x256`, set to the real money on both entries (`CS:0x6BED`, and `CS:0x0676` for the level-start shop). `FUN_1000_718B` runs once at entry (`CS:0x6C6F`) and on every loop pass that is not a FIRE press (`CS:0x6D60`, after the cursor sound `0x232` at `0x6D4F`; the FIRE path jumps to `CS:0x6E62` and skips it). Each call moves the shown money `0x2EE` (750) toward the real money, never past it, and plays **`0x111`** (`CS:0x71A3` counting down, `0x71CF` up). Equal: nothing, silent. So after a purchase the display counts down in 750 steps, one tick sound per pass: 108 ticks means 81,000 spent.

Live: the `PJOYL2` and `PJOYL3` sweeps log exactly these runs (108 and 84 plays), each under the tape cursor of its own shop pass. `gods-web` drew the purse itself; `game/shop.js` now keeps `shownMoney` and plays `0x111` per step, and matches every play per cursor.

**The shop's exit runs a respawn tick.** `CS:0x6DCB` calls `FUN_1000_921B` (the tick body a respawn uses, with a tape poll) before `jmp cx` (`CS:0x6DF3`, patched to `0x0696` for the level-start shop), and only then `CS:0x06A9` plays the level-start sound `0x7F12`; `0x0111`'s check at `0x0126` then plays the aura loop `0x280` if a shield was bought, else stops `0x80`. `gods-web` now runs that respawn tick and plays the sound after it (the sweeps' `0x7F12` lands one cursor after the exit pass).

## What `gods-web` ports and what it discloses as not ported

See the port's own `game/shop.js` header for the current state — built and
tested as a state machine (grid navigation, the two-press buy confirm, the
`0x319` category lockout, the `0x5060` auto-use-vs-inventory branch, the
selected-slot skip, the priority-`0x19` refusal message), fed the FULL raw
per-world candidate list (not a pre-filtered array) through an explicit
constructor parameter: world 2 gets `SS:0x51aa`'s own 13-id list, worlds 3/4
the full 18-id list, both cross-checked above. `ShopScreen#rebuildVisible`
reproduces `FUN_1000_7276`/`FUN_1000_707d`'s own full pipeline — eligibility
gates, per-visit category lockout, affordability, ascending-by-price sort,
and the 17-slot scroll truncation — so both eligibility gates
(`UNKNOWN_shop_eligibility_gates`, CLOSED) are genuinely wired: `game/
weapons.js`'s `arsenal.slots` (gate 1) and `game/combat.js`'s
`health.familiarEnergy` (gate 2, raised by a new `applyFamiliar` handler for
the previously-unwired type-39/40/41 consumables, `game/consumables.js`).
All real, byte-grounded content from the actual `SS:0x51aa` per-world source
lists, not invented placeholders. Real prices are shown and charged for all
18 raw ids (`game/shop.js`'s `PRICES` table, `UNKNOWN_shop_prices` closed —
see above). Along the way, two pre-existing bugs in `main.js`'s own
`switchLevel`/`fullRestart` were found and fixed: `switchLevel` was
rebuilding `arsenal` (and silently dropping the familiar's own state) from
scratch on EVERY level transition, not just a full restart, which would
have made gate 1 unreachable through the shop's one real entry path
(password entry always calls `switchLevel` immediately before opening the
shop) regardless of how correctly the gate itself was wired. `ShopScreen`
holding `arsenal` by reference (not a copy) is load-bearing for the weapon
purchase mechanic below too, not only gate 1.

The weapon purchase/swap mechanic (`UNKNOWN_shop_tradein_value`, CLOSED
above) is now ported: world 2's roster gained its 3 weapon ids, and worlds
3/4 (which diverge in which weapons they sell, unlike their shared
consumable set) each got their own weapon-id tail instead of reusing one
roster constant. `game/weapons.js`'s `parseWeapons` now carries each
weapon's own embedded name (`WEAPON_NAMES`, read from `rec+0x20` and
cross-checked against `PWEAPONS.001`'s decompressed bytes) alongside its
pre-existing `value`/`refundFor`, and `ShopScreen` gained the three-press
warning/execute flow (`#buyWeapon`/`#wouldDisplace`/`#warningFor`) plus
per-world live pricing (`#priceFor` — weapon prices, unlike consumable
prices, come from the CURRENTLY LOADED world's own `PWEAPONS` file, not one
static table). `pickUpWeapon` (`game/pickup.js`) and the slot selector it
uses were reused as-is for the ARM half, exactly as this doc predicted; the
refund-then-charge orchestration in `#buyWeapon` and the warning/preview
state machine in `#fire` were the only genuinely new surface. Every
boundary check against the raw id (`#fire`, `#buy`, `#priceFor`,
`#isEligible`, `#labelFor`) goes through `pickup.js`'s own `isWeaponPickup`/
`weaponIndexOf` rather than a bare `id >= WEAPON_ID_BASE` comparison —
`pickup.js`'s own header warns a dead/unused slot's `0xFFFF` sentinel also
passes a bare `>= 0xc0` test, which is exactly how this port acquired 535
phantom pickups the first time; `WEAPON_ID_BASE` stays exported only for
constructing ids (docs, tests, `main.js`'s rosters), never for a boundary
comparison. Verified three ways: a synthetic Node suite in
`src/verify/checks.js` (sequential purchases, displacement, refund math,
the warning text and its clearing, the no-category-lockout behavior, and
the fire-press-not-cursor-move preview-persistence case above), a live
Chrome session against the real decompressed `PWEAPONS.001` (world 2's
three real weapon purchases — fireball/throwing star/magic axe at their
real 12500/5000/15000 prices — landing in the correct slots with no
spurious warning), and `npm run verify` (1834 assertions, all passing)
plus a clean `vite build`.

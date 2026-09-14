# The starburst, treasure, and object fall physics

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

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

⚠️ **CORRECTION, a later session — the inventory does NOT survive every level change; it is cleared (selectively) on every world-B completion.** The claim above rested on a search for **direct-immediate** writes to the literal address `0x17e` (`mov [0x17e],reg`), which found only the two full-restart sites — but that search has exactly the blind spot this document flags repeatedly elsewhere: a base address loaded into a register and then walked/indexed is invisible to a literal-operand scan. `FUN_1000_6ad4` (`CS:0x6AD4`–`0x6AFF`, previously undisassembled, reached only through the `UNKNOWN_level_exit_destination` bit-dispatch table below — zero direct `CALL`/`JMP` xrefs anywhere in the image) walks all 4 inventory slots via `SI := 0x17e`, and for each non-empty slot (`[SI] >= 0`) resolves the held item's runtime descriptor (`DI = 0x2a4e + item*10`, the same stride this document already establishes elsewhere) and, whenever that descriptor's `+0x4` (category, sign-extended) is **nonzero** — i.e. any item that is NOT a category-0 potion/consumable, which in practice means every key — does `MOV word[SI],0xFFFF`, clearing the slot, then calls `CS:0x228E` (presumably the inventory-panel redraw). This handler is dispatched by bit 8 of the just-completed world's destination record's own `+0x1e` field (see below), which is **set** for every real "LEVEL ONE"/"LEVEL TWO"/"LEVEL THREE" exit and clear only for the never-wired "GAME" record. **So the 4-slot key inventory is cleared at every world-B completion** (finishing `PLEV1B`, `PLEV2B`, or `PLEV3B`) — chest keys do NOT carry across a world boundary, though (per the two already-documented full-restart sites, still the only other writers of this slot) they do survive an ordinary sublevel transition or death/respawn within the same world. A port must clear the key inventory at world-advance, not merely at a full restart.

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

## Object fall physics — placed objects fall once they scroll into view `[PROVEN]`

Reported live: *"in the DOS version the items don't stay up in the air but fall down once they come into view."* A screenshot showed a weapon pickup floating unsupported next to a mystery box in `PLEV1A`. The mechanism is a small per-slot state machine, keyed off the SAME activation flag `UNKNOWN_object_flag6` already documents — the fall/bounce logic is armed on the identical inactive→active edge that flag's own bit 0 marks dirty, not a separate trigger.

**A per-object-slot dirty byte at `SS:0x438+slotIndex`** — already on record elsewhere in this document as an under-documented scratch array — is a three-role overloaded state machine: (a) `0xFF` = "just activated, needs a fall-check this tick" (b) once falling stops, a 0–23 index into a 24-byte Y-delta bounce table (c) once clamped at 24 (terminal), a "perpetually re-verify support" sentinel that jumps straight back into the ground probe every frame forever, with no reset.

```
CS:0x120F  mov byte [bp+0],0xff        ; the activation edge — SS:0x438 := 0xFF, UNCONDITIONALLY
```

**The bounce table, `CS:0x13FF mov di,0xdf2c`, is `[PROVEN]` via live `read_memory("1ffd:df2c", 24)`** this session — note `1ffd:`, not `1000:`, per this document's own DS-segment warning, which cost an earlier pass of this same investigation a whole session of garbage reads before the correct segment was used:

```
fc fd fe ff 00 01 02 03 04 fd fe ff 00 01 02 03 fe ff 00 01 02 ff 00 01
  -4 -3 -2 -1  0  1  2  3  4 -3 -2 -1  0  1  2  3 -2 -1  0  1  2 -1  0  1
```

**Byte-identical to the already-documented time-bomb settling-bounce table** (`BOMB_BOUNCE` in the port's `projectiles.js`), confirming the two were never independently corroborated until this session — CLAUDE.md had carried the fall table from recollection of the bomb's own table under a different heading. The **consumer differs**: the object-fall state machine **clamps** at index 24 (`CS:0x1420 mov dl,0x18`) once the table is exhausted, where the time bomb's own mover (`CS:0x142F`) **wraps** back to phase 0 and recycles the same table forever — one table, two different terminal behaviours.

**The ground/embed probe, `CS:0x1554-0x15CB`**, tests two columns for solid ground one row below the object (`y + 0x10`): col1 = the object's own column (`x >> 5`), col2 = a straddle column `0xF` px to the right (`(x + 0xF) >> 5` — the same threshold the hero's own wall probes use). Once ground is found on either column, the SAME column's own row (`y`, un-incremented — the row directly above the ground row) is re-tested for embedding. **The branch structure is asymmetric**, and this is the detail a naive symmetric probe gets wrong: when col1 has no ground below it, col1's own row is **never** re-tested — only col2's:

```
groundCol1 true  -> embedded = ownCol1 || ownCol2
groundCol1 false -> embedded = groundCol2 && ownCol2      ; ownCol1 is UNTESTED
neither column has ground below                            -> always falls
```

"Landed" additionally requires row alignment (`y & 0xC === 0`, `CS:0x15CB-15D4`) — since the fall step below always keeps `y` a multiple of 4, an object keeps stepping by 4px until it reaches an exact 16px row boundary before it may rest.

**The fall step, `CS:0x1587`: `y = (y + 4) & 0xFFFC` every tick it is unsupported or unaligned.** **World-bottom destruction, `CS:0x1598-0x15A3`: once `y >= 0x400` (1024, the documented world height), the object is destroyed** — `type := 0xFFFF`, `flag6 := 0`, the same dead-slot convention this array already uses for a collected pickup.

**Why category >= 3 (levers, and categories 4/5) never visibly moves.** `CS:0x1526` caches the object's pre-tick Y into a scratch word (`SS:0x432`) before any of the above runs, and `CS:0x1613` restores it from that scratch word whenever the type is `< 0xC0` (not a weapon) and the `POBJECTS` category is `>= 3`. Every sub-path — the fall step, the bounce-delta add, and the terminal re-probe — funnels through the SAME shared tail (`CS:0x15F1`) before this restore is reached, so the undo is **unconditional**: a lever's dirty byte ticks through its whole fall/bounce cycle every time it is (re)activated, but its Y is pinned back every single tick and it never actually moves. Weapons (`type >= 0xC0`) skip the category test entirely (`CS:0x15F5 cmp cx,0xc0 / jl ... / jmp 0x1da0`) and always fall.

**Port design decision.** Since the category-gate's net effect is provably always zero, the port (`gods-web/src/game/objects.js`, `isFallEligible`) applies the gate **up front** — checked once at the inactive→active transition (`activateObjects`) — rather than replicating the original's compute-then-discard restore mechanism. This is a legitimate simplification validated by the exhaustive disassembly trace above, not a behavioural deviation: `stepObjectFall` itself never re-checks category, exactly like the original's own state machine never actually un-does a lever's motion by any other means.

**No sticky "already settled" state — re-arming on re-entry replays the bounce, and this is deliberate, not a bug.** `activateObjects` fires `SS:0x438 := 0xFF` on every inactive→active edge with no "already settled" test anywhere in `CS:0x120F` or its callers, and activation is not sticky (an object that scrolls off has its activation flag cleared, per `UNKNOWN_object_flag6` above). So a settled item that scrolls off-screen and back on is re-armed to the `0xFF` sentinel, finds the same ground still solid, and **plays its full landing bounce again from index 0** — verified in the port's own test suite: settle an object, deactivate it (scroll the activation box away), reactivate it (scroll back), and `fallDirty` returns to `-1` and the bounce genuinely restarts (one tick to re-enter the bounce at index 0 with Y unchanged, the next tick actually applies `BOUNCE_DELTA[0]`).

**Shipped-data verification — not just presence-of-ground, but a full simulation against real level geometry.** A census across all 8 `.MAP` files found **616 of 652** fall-eligible objects (weapon pickups or category `< 3`) have no ground directly beneath either probed column at their placed position — `1A:83/85, 1B:89/89, 2A:86/88, 2B:76/81, 3A:50/64, 3B:54/56, 4A:80/86, 4B:98/103`. That 94% figure is **not** a minority case to be explained away — read correctly, near-universal initial non-support *corroborates* the reported behaviour (items falling is the general case, not a rare oddity), and an earlier revision of this project's own notes wrongly called the identical figure "a small minority," a self-contradiction caught on review.

The number that actually discriminates a sound decode from a systematic probe error is not that raw percentage — it is **how many of those objects get destroyed** (fall clean through the bottom of the world) when the fall/bounce state machine is actually run against each level's real plane B. A shipped game does not silently delete most of its pickups on first scroll-in; a wrong ground probe or a systematic row-offset would show up here as mass destruction. Simulating all 652 eligible objects to settle/destruction on their own level's real geometry: **0 destroyed** (excluding one object, `PLEV2A` object #114, type 5 at `y = 65529` — an authoring `y < 0` that wrapped to a huge `u16`, sitting far past every real camera position's activation-box reach and therefore never activated in actual play regardless of the fall decode, the same "dead shipped data" genre as this document's other proven-unread padding fields). Of the 651 genuinely simulated, the largest settled drop was **278px** and **425** settled after falling more than one tile (32px) — a long tail of multi-tile drops, exactly the reported screenshot's shape (an item floating next to a ladder with open air beneath it), not a uniform one-row rounding artefact.

**Tag discipline.** This mechanic is tagged `[PROVEN]` for the bounce table (a live `read_memory`) and the shipped-data simulation (executed against real level bytes), but the fall-step/ground-probe/category-gate disassembly itself was read, not watched executing — the disassembly-only parts remain `[STATIC]` until a live trace confirms them. **To promote:** an execute breakpoint on the fall-step store at offset `CS:0x1587` (resolve the live segment first — this project has recorded `CS=0x1000`, `CS=877`(`0x36D`), and other values across different traced sessions depending on where DOS actually loads `GAME.EXE`; see *`UNKNOWN_asset_load_segments` — CLOSED*) should hit repeatedly for an unsupported object, with `[SI+2]` (the object's Y) climbing by 4 each hit.

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

**Collision is CLOSED, and it was never a pairwise test** — see *Projectile collision — an occupancy grid, not a hit test*. Projectiles stamp, and creatures scan, one 8×8 screen-space occupancy grid at `DS:0x16ca`; terrain is a separate mechanism, the weapon `+0x48` stop at `CS:0xA7B7`/`0xA7EF`. ⚠️ **This paragraph stood for several passes claiming the opposite** — *"still missing … the pixel-mask scan at `0xaad1`–`0xab3f` … are next"* — using a name the document retracts in three other places (the `### The scanner` heading, the closing note of *`UNKNOWN_hero_combat_details`*, and the resolved list) for a routine that is the **damage-grid scanner**, and asserting a gap its own *Projectile collision* section had already closed. Genuinely still open from that pass at the time: **`UNKNOWN_creature_death_anim`** — `0xf02a`, the arm `CS:0xEDFD` takes on a negative entity `+0x08` — is now **CLOSED** (see *`UNKNOWN_creature_death_anim` — CLOSED*, above: it draws through the same call the alive path uses, and its score-award helper `CS:0xEFE7` reads the group descriptor's own HP field) — and **`UNKNOWN_alt_emitter`**, now **CLOSED** (see immediately below). ⚠️ `0x8687`, listed here as *"ruled out by reading"*, is now identified as the world-2 nest walker (`UNKNOWN_cfcc_cotenant`) and reaches the damage path itself at `CS:0x874F`; it was ruled out correctly as the *mechanism*, and is misleading left standing as unrelated.

### `UNKNOWN_alt_emitter` — CLOSED: `DS:0x16a`/`0x16c` is the FAMILIAR's own world position `[PROVEN]`

The port (`gods-web/src/game/projectiles.js`) had already worked out the muzzle arithmetic — `+0x10` on Y always, `+8` on X only when firing right (`CS:0x975e`/`CS:0xc450`: `ADD AX,0x4` / `ADD BX,0x4`, read here as the general-case nudge, folded into a caller-specific `+8`/`+0x10` at the two sites actually traced) — and the trigger (`DS:0x33d != 0`, written by `CS:0xc389` inside the weapon-auto-select-by-Power routine that starts at `CS:0xc368`, both addresses genuine — `0xc368` is the routine entry, `0xc389` the specific `mov byte[0x33d],0xff` instruction inside it). What neither the ledger nor the port had was **what `DS:0x16a`/`0x16c` themselves are** — that is now closed.

**They are the familiar creature's own current world X/Y**, established four independent ways:

1. **Seeded at level/respawn init from the hero's own spawn position.** `CS:0x8C56`–`0x8C64`, inside the same spawn/respawn routine already documented for state 4 and the health refill: `cmp word[0x168],0 / js skip` (only when the familiar is alive — `DS:0x168` is the already-documented familiar energy) `→ mov [0x16a],ax ; mov [0x16c],bx ; sub word[0x16c],0x28` — `ax`/`bx` at this point hold the hero's own just-loaded spawn X/Y, so the familiar starts 40 px above the hero.
2. **The familiar's own death spawns a starburst at this position**, exactly matching this document's own already-documented call-site table (*The starburst — five call sites*, `CS:0xC464`, "the familiar's death — a burst at its last remembered spot, gated on `DS:0x391`"): `CS:0xC447`–`0xC469` reads `[0x16a]`/`[0x16c]`, adds `+4` to both, and conditionally calls `0xa461` (the starburst spawner) when `[0x391]==0`.
3. **The familiar shares the Hunter weapon's target-search routine**, `CS:0x9e36` (called at `CS:0xC0A3`/`CS:0xC163`), and the code immediately around those calls reads/writes `[0x16a]`/`[0x16c]` as the familiar's own position for goal-seeking and comparison against the returned target — the same routine this document already documents the Hunter projectile using to home in on whichever on-screen creature has the lowest sprite id.
4. **The familiar stamps its own position onto the damage grid**, `CS:0xC2B6`–`0xC2DB`: `[0x16a]`/`[0x16c]` minus the scroll origin `[0xa]`/`[0xc]`, fed through the exact `DI = 0x16ca + (x>>3) + …` formula this document's `CS:0xA860` 2×2 stamp uses — so the familiar is a stampable/damageable occupant of the shared projectile-collision grid, like a creature.

So "the second muzzle position" framing was half right and half a red herring: `DS:0x33d` does gate a muzzle switch in the fire path (already resolved by the port), but the *position it switches to* is not a second emitter offset at all — it is wherever the player's own familiar currently stands. A port that models the familiar as a tracked entity with a world position already has everything needed; one that treats `0x16a`/`0x16c` as a fixed alternate muzzle constant does not.


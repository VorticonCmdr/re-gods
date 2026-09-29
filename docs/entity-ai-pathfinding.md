# Entity records, enemy AI, and the enemy pathfinder

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

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

⚠️ **The marker list is rebuilt on every tick, `[PROVEN]` live.** The object walk's own head resets it:

```
1432  mov byte [0x398],0x0            ; count := 0
1437  mov byte [0x399],0x0            ; override off
143c  mov byte [0x39a],0x0
1441  mov word [0x208],0xb5dc         ; rewind the write cursor
...
14b8  cmp byte [0x399],0 / jz         ; after the walk:
14bf  mov byte [0x398],0x1            ;   under the override, only marker 0 (the potion) counts
```

So the list holds only this tick's on-screen category-0/1/2 objects. It also re-arms the override each tick while an attract potion stays on screen. A live trace at `PJOYL2` cursor 2092 (`CS:0xF5C3`) read `[0x398]` = 1 with a single marker, and goal cells 250/270 painted from it. `gods-web` had cleared the list only on level load. Its pathfinder chased 20 stale copies of one falling object, and that was the last random-stream divergence in `PJOYL2`.

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

**`UNKNOWN_pathfinder_producers` — CLOSED.** All four stages are decoded and ported (`src/game/pathfind-producers.js`), and the port hunts: on real `PLEV1A` geometry an enemy closes 256 px to 20, reverses to `verdict 0` when the hero is placed on the other side, **hops a two-tile wall** when one is in the way, and reports `0xFFFF` on every attempt when walled off by six tiles — which no hop can clear. The negative half matters as much as the positive: a pursuit test that only passes on an open field proves very little.

A shipped-data measurement, not an open question — `UNKNOWN_seed_2`/`UNKNOWN_seed_3` and the `DS:0x398`/`DS:0x399` gates are closed above: strategy 2 is **201 of the 540 shipped nibbles** — the second most common. But the flat nibble count overstates the impact, because `+0x09` decides how often the *high* nibble is consulted at all: measured over every `rnd` value across all 270 live descriptors, **27.5%** of groups actually land on strategy 2 or 3. The port surfaces that share as a measurement rather than defaulting silently, because otherwise "enemies hunt" would be true only for a biased subset.

Two more traps the porting pass turned up, neither of which is visible in a "does it pursue" test:

- **The arc simulator carries `di`, `cx` and `dx` as explicit state and they go out of phase with the world position.** Landing right snaps X forward a tile *and* increments `di`, but only when `cx != 0` (`0xf945`–`0xf94f`); a ceiling bonk snaps Y, forces `dx` to 0 rather than deriving it, and moves `di` (`0xf9a7`–`0xf9b3`). A port that recomputes the cell from X/Y each step diverges silently.
- **The hop locomotion handler tests the ground with a STALE cell pointer.** `0xf32c` computes it, `0xf345` then steps X, and `0xf34e` tests using the old pointer with the *new* X for the straddle. On the tick a hop crosses a tile boundary those disagree.

And one that bit this port directly: **the search runs only from the two walk handlers, only on a tile crossing, and only when standing on ground.** Applying a verdict outside that gate re-seeds the hop cursor every frame and freezes the entity in mid-air — which looks exactly like a broken pathfinder.

⚠️ **There is no differential test available here.** The root seeding is randomised, and the random source is the wall-clock-seeded replay table, so **enemy paths are not reproducible run-to-run even in the original**. Verification of this subsystem has to be structural — invariants and "does it pursue" — not byte-exact.


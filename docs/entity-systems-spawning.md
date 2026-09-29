# Enemy spawn — System A/System B entity pipelines

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## Enemy spawn — the chain a port needs `[PROVEN]`

Formerly the biggest port blocker. Selector 4 activates a **System-B** group; selector 5 is System A.

**Activation, `CS:0xde08` — and the order is a real behaviour:**

```
de08  mov word [si],0xffff        ; THE EVENT IS CONSUMED FIRST
      mov ax,[si+0x2]             ; param
      mov si,0xa1ac / mov bx,0x16 / mul bx / add si,ax
      mov bp,0x36b4 / mov cx,0xa
de1f  cmp word [bp+0x0],0 / jz / add bp,0x12 / loop
de2a  ret                         ; ALL TEN SLOTS BUSY -> ACTIVATION LOST FOREVER
de2b  mov word [bp+0x0],2 / mov [bp+0x2],si
```

Because the consume precedes the slot search, a group arriving when all ten runtime slots are busy is dropped **and can never fire again**.

**The spawn loop, `CS:0xec60`:**

```
ec63  mov cl,[si] / or cx,cx / jnz / jmp 0xed38   ; count 0 -> the slot is NOT freed
ec70  mov ax,[si+0x12] / xchg al,ah / mov bx,ax
      mov al,ah / sub ah,ah / sub bh,bh
      shl ax,1 (x5)                               ; X = desc[0x12] * 32
      shl bx,1 (x4)                               ; Y = desc[0x13] * 16
ec9f  mov word [di+0x8],0xfffe                    ; state = waiting
eca4  mov [di+0x6],dx                             ; stagger, += desc[0x14] per entity
```

**Initial mode, `CS:0xecc5`** — note the `push di`/`pop di` around a clobber; reading `[di+0x100]` as an *entity* field writes garbage:

```
ecc6  push di
ecc9  call 0xf0d9                 ; DI := plane-B pointer for the SPAWN cell
eccc  cmp byte [di+0x100],0x1     ; ground two rows below? EXACTLY == 1
ecd3  mov cx,0x2                  ; not ground -> +2 (a fall mode)
ecd6  mov ax,[si+0x4] / xchg al,ah / shr ax,9 / and ax,1 / add ax,bx
ece7  pop di / mov [di+0xa],ax
```

**All entities of a group spawn at the same point** — only the appearance *time* differs, and it is **not** the plane-B cell that triggered them.

### The System-B group descriptor — PALFILS `+0x11A4`, 50 × 22 B

| off | meaning | | off | meaning |
|---|---|---|---|---|
| `+0x00` | entity count, 1..10; **0 = dead record** | | `+0x0b` | speed: step delay = `10 − v`, so **higher is faster** |
| `+0x01` | hit points per entity | | `+0x12` | spawn tile X (× 32) |
| `+0x04`/`05` | BE flag word; **bit 9 = initial facing** | | `+0x13` | spawn tile Y (× 16) |
| `+0x06` | lo nibble = fire rate; hi nibble `[WF]` | | `+0x14` | per-entity stagger, in frames |
| `+0x07` | sprite-class index | | `+0x10` | BE `i16`; **group-clear reward popup id** — see below |

**Measured across the 8 shipped levels:** 270 live descriptors (14/14/30/28/50/50/42/42), 217 selector-4 references and **zero dangling**, entity counts `{1,2,3,4,5,10}`, speeds `{1,7,8,9,10}`, spawn tiles X 1..126 and Y 1..60 — inside the 128×64 map every time.

### The kill score, `CS:0xEFE7` — `[PROVEN]` live (2026-09-28)

A System-B kill (`CS:0xEDF7`: `[di+8] < 0` after the contact call → `CS:0xF02A`) and a System-A kill (`CS:0xE241`) both `call 0xEFE7`, which reads the group descriptor's byte `+1` (the entities' starting HP): `AL = (b >> 1) + 1`, `div 10`, and the tens and units packed into `DL` for `CS:0x0C8B`, which adds `DL` into the hundreds byte `DS:0x3B6` and ripples the carry up with `adc`/`daa`. So a kill scores `((b >> 1) + 1) × 100`. A tens digit above 9 is packed as it is (`0xA0`–`0xC0`), which `daa` still carries, and `CS:0xF023` adds `(q − 9) << 4` on top: HP 198–255 score 1,000 more than the formula.

Live: `tools/attract-capture/score_callers.py` breaks on `CS:0x0C80`/`0x0C8B` in `PJOYL2` 1600–1800. The four awards at 1638, 1640 (`DL = 0x11`), 1743 and 1758 (`DL = 0x03`) return to `CS:0xF014` inside a call from `CS:0xF02D`: System B's kill tick. `re-gods` had never wired it (ranked item 59); it now awards through `awardKill` (`src/game/treasure.js`), emulating the `adc`/`daa` bytes, and its `PJOYL2` score matches DOS at every award.

### `UNKNOWN_f030_item_drop` — CLOSED: a group-clear reward, and a previously undocumented descriptor field `+0x10` `[STATIC]`

Found while tracing the System-B death path's score-award trampoline (`CS:0xF02A`, see *`UNKNOWN_creature_death_anim`* above): `FUN_1000_f030` (reached via `FUN_1000_ff20`'s dispatch, itself called from `FUN_1000_ed38`) turned out to belong to a genuinely different mechanism from the per-kill score award — **a bonus popup awarded once, when an entire System-B group has been cleared.**

**`FUN_1000_ed38` is System B's per-group entity loop**, called from the already-documented per-frame head `FUN_1000_ed15` and from the materialise loop `FUN_1000_ec60`. Per entity, it dispatches on `[di+0x8]` (the entity's state/HP word):

```
ed64  cmp word [di+0x8],0 / jns 0xed6d
ed6a    jmp 0xff20            ; NEGATIVE -> the state-sentinel dispatcher (below)
ed6d  jz 0xed4b                ; ZERO -> [0x3c3]++ ("empty slot"), skip
ed6f  call 0xedb8              ; POSITIVE (alive) -> the ordinary movement+contact routine
```

`FUN_1000_ff20` further splits the negative case by three sentinel values:

```
ff20  cmp word [di+0x8],-2 / jz 0xff4b      ; -2 = "waiting" (this document's already-documented spawn sentinel)
ff26  cmp word [di+0x8],-3 / jz 0xff2f      ; -3 = respawn countdown
ff2c    jmp 0xf030                          ; any OTHER negative -> mid-death-animation
ff2f  dec word [di+0x6] / jz ...            ; countdown: on expiry, [di+0x8] := desc[+0x1] (HP) — reactivates
ff2c  jmp 0xf030
```

**`FUN_1000_f030` is the death-animation frame advancer**, `inc byte[0x1f4]` (a per-group tally, reset to 0 by `FUN_1000_ed38` at the top of each group's loop) then, once `[di+0x4]` (the frame counter) reaches **7**, finalizes the entity to `[di+0x8]=0`/`[di+0x6]=0` — exactly the "empty slot" state `FUN_1000_ed38`'s own `jz 0xed4b` arm tests for on a later frame. Along the way it caches the entity's own world position into shared scratch `DS:0x202`/`0x204` and calls `CS:0xBF5F` (the already-documented, now-closed floating-item-icon popup spawner) with a converted type id from `[di+0x10]` — this is the **per-kill** score/popup this document's own *`UNKNOWN_creature_death_anim`* closure already covers, not the group-level one.

**After the per-entity loop finishes, `FUN_1000_ed38` checks whether the whole group is spent:**

```
ed78  cl = [0x3c3] + [0x1f4]           ; empty-slot count + still-dying count
ed80  cmp cl, [si]  / jnz 0xedaa        ; [si] = group descriptor +0x0, the entity count
ed84  ax=[0x202] ; bx=[0x204] ; ax+=8   ; the world position LAST cached by a dying entity
ed8e  cmp byte [bp+0x10],0 / jnz 0xedaa ; group-runtime +0x10 — "reward already given" flag
ed94  cx = [si+0x10]                    ; descriptor +0x10, BE i16 — the REWARD popup id
ed99  or cx,cx / js 0xeda6              ; negative -> no reward, just set the flag
ed9d  call 0x1000:bf5f                  ; spawn the reward popup at the cached position
eda6  [bp+0x10] = 1                     ; mark "reward given" — fires exactly once per group
edaa  cmp [0x3c3], [si] / jl 0xedb6     ; only "empty" (not "dying") count matters here
edb1    [bp+0] = 0                      ; ALL entities fully finished -> free the group-runtime slot
```

So a System-B monster group can carry its own **group-clear bonus item**, encoded as a signed 16-bit id in the previously-uncatalogued descriptor field `+0x10`, big-endian on disk like every other `SI`-read descriptor word in this document — negative means "no reward". The reward fires once, at the position of whichever entity happened to die last (cached via `DS:0x202`/`0x204`), gated by a new group-runtime field `+0x10` (a one-shot latch, distinct from and three fields after the already-documented `+0xe`/`copy of descriptor +0xe`... — this project's own `SS:0x36b4` stride-`0x12` runtime layout gains a newly-identified `+0x10` field: "group reward already awarded"), and only *after* that the group-runtime slot is freed and can be reallocated by a future trigger.

**Ported, popup rendering included.** `src/game/popup.js` is the single-slot `CS:0xBF5F`/`0xBF80` spawner itself (id encoding, `-6` Y-velocity, an explicitly-disclosed `UNKNOWN_popup_cull` for the lifetime/cull this document has not established); `spawn.js`'s `parseGroupsB` reads descriptor `+0x10` as `rewardId`; `entity.js`'s `EntityB` carries the `CS:0xF034` one-shot position cache as `deathCacheX`/`deathCacheY`/`deathCacheSeq` (the `+8`-on-X-only bias from `CS:0xED84` baked in at write time); and `main.js` tracks per-group membership (a `GroupSlots` instance has no per-entity tracking of its own) and fires the reward once every member reads `state === FREE || state === DYING` — the live per-tick recount `[0x3c3]+[0x1f4] === count` actually is, not a monotonic latch. One disclosed, acknowledged timing gap: because this port ticks all of a level's `EntityB`s in one flat loop rather than per-group, an entity killed by the SAME tick's own contact test can complete a group immediately rather than waiting for the following tick's `ff20`/`f030` pass the way the original's own per-entity dispatch order requires — at most one frame early, not a mechanism error. The per-kill carried-item popup this same `F030` gate also drives (entity's own `[di+0x10]`, unrelated to the group descriptor's `+0x10` above) remains unported, same disclosed steal-and-carry gap as elsewhere in this project. **System-A's own, separate group-elimination-reward mechanism** (`UNKNOWN_sysA_0x1f4_elimination_detector`, below) is likewise unported — `parseGroupsA` has no `rewardId`-equivalent field — and is a distinct System-A-only descriptor field at the same `+0x10` offset, not a duplicate of this one.

**`UNKNOWN_sysB_reward_ids` — CLOSED: censused across all 8 shipped levels, and it corrects the `<0xB` branch's own meaning `[PROVEN]`**

⚠️ **Correction first: `id < 0xB` is not a weapon-recovery branch.** Re-reading `CS:0xBF5F`'s own body (this document's now-closed `UNKNOWN_bf5f_popup_id` section) settles it precisely: `id < 0xB` reaches `CS:0xC004`, "a plain numeric popup (score-style)" — it is **not** the weapon-index recovery this document documents elsewhere for the unrelated `CS:0xC041` steal-and-carry routine (which recovers a weapon via `id − 0xC0`, a completely different encoding). `id ≥ 0xB` is the only branch that recovers a `POBJECTS` type (`id − 0xB`).

Decompressing all 8 `PALFILS.0{A,B}{1-4}` files (`blast.py`) and reading every live System-B descriptor's `+0x10` field directly gives a small, fully decodable set of distinct values:

| `+0x10` | meaning | how common |
|---|---|---|
| `-1` | no reward | the minority — worlds 2–3 only, never worlds 1/4 |
| `0`, `6` | plain numeric popup (`id < 0xB`, `CS:0xC004`) | rare, two isolated records |
| `22` → type 11, `"chrystal"` | the overwhelming **default** — nearly every live group in every world | dominant |
| `21` → type 10, `"diamond"` | a handful, world 1 | |
| `17`/`18` → types 6/7, `"water chrystal"`/`"fire chrystal"` | world 1 only | |
| `135`/`136` → types 124/125, `"fire gem"`/`"water gem"` | world 2 only | |
| `112` → type 101, `"gold bowl"` | worlds 4A/4B, one group each | |
| `46`/`11` → type 35/0, `"health"` (`"restores energy"`) | one group each, worlds 3/2 | |
| `56` → type 45, `"potion" / "attracts monsters"` | world 3, two groups | |

So a cleared monster group overwhelmingly drops a **chrystal** (the default reward almost every world's author left in place), with a sprinkling of diamonds, elemental gems, a gold bowl, an outright health potion, and — strikingly — the **same `"attracts monsters"` potion type this document already documents forcing every System-B enemy onto pathfinder strategy 2** (`DS:0x399`/`DS:0x398`, under *`UNKNOWN_seed_2`/`UNKNOWN_seed_3`*) as a **clearing reward** in world 3. A handful of groups (world 2 and 3 only) award nothing at all. No group in any shipped level reaches the numeric-popup branch with a value worth noting (`0`/`6`, both essentially inert score-style flourishes), and none reaches the two unreachable icon sprites (`0x94`/`0x95`, this document's own already-closed *`UNKNOWN_bf5f_special_sprite_callers`*) — this is an entirely separate, fully-populated reward channel from that dead one.

### The enemy sprite — `UNKNOWN_sysB_sprite_formula` CLOSED `[PROVEN]`

```
CS:0xf0ae  si = 0xdbe0 + mode*4 / cx = [si+2]      ; MODE_ANIM
           cx += [di+4]                            ; frame
           si = [bp+2] / al = [si+7]               ; class index
           si = [0x1fc] / si += cls*12
           cx += [si]                              ; + class sprite base
```

`sprite = class_base + MODE_ANIM[mode] + frame`, `MODE_ANIM = [0,9,8,17,8,17,8,17]`.

**The `#450` anchor lands exactly.** `always` (170) + `objects` (280) = **450**, and the lowest class base is 450. The group at #450 is `level<N>` — and this document separately established that *"`PLEVEL<N><X>.PI1` is not a terrain tileset despite the name — a 60-frame 32×32 creature animation strip"*. That is exactly what a monster group at #450 has to be. Three findings converging.

**`DS:0x1fc` is not a table — it's a per-level POINTER, and `DS:0xdf80`'s 8 entries are not fixed-size records.** The loader, `CS:0xad62` (previously unlocated):

```
ad62  mov si,0xdf80
ad65  mov al,[0x42]        ; world (1..4)
ad68  dec al / cbw
ad6b  shl ax,1 / shl ax,1  ; (world-1)*4
ad6f  add si,ax
ad71  lodsw / mov [0x1fe],ax   ; pointer #1 -> DS:0x1fe
ad75  lodsw / mov [0x1fc],ax   ; pointer #2 -> DS:0x1fc  (what f0ae reads)
ad79  ret
```

So `DS:0xdf80` is **4 worlds × 2 pointers**, and each pointer is the base of its own **variable-length, `0xFFFF`-terminated class table** — not a slice of one flat 12-entry array. Reading all 8 tables with their real bounds (each table's length is exactly the byte gap to the next table's pointer, confirmed independently by every one of the 8 ending in an explicit all-`0xFFFF` sentinel record with zero slack either side):

| world | system | pointer | records | ends |
|---|---|---|---|---|
| 1 | A | `0xe046` | 3 live + sentinel | butts against world 1's own B pointer, `0xe076` |
| 1 | B | `0xe076` | 8 live + sentinel | butts against world 2's A pointer |
| 2 | A | `0xe0e2` | 4 live + sentinel | | 2 | B | `0xe11e` | 8 live + sentinel |
| 3 | A | `0xe18a` | 3 live + sentinel | | 3 | B | `0xe1ba` | 7 live + sentinel |
| 4 | A | `0xe21a` | 4 live + sentinel | | 4 | B | `0xe256` | 7 live + sentinel |

Memory order is `w1A, w1B, w2A, w2B, w3A, w3B, w4A, w4B` — each world's **A** table sits immediately before that **same world's own B** table, and each world's B table butts against the **next world's** A table. This is exactly what produced the earlier "bases are 6 apart, pooled" confusion: reading a fixed 8 or 12 records per pointer with no knowledge of where a table actually ends walks straight through the `0xFFFF` sentinel into the next table — a different world or a different system — and collects numbers that were never adjacent in any single real table. Sorting the result afterward manufactured small, meaningless gaps between unrelated tables' entries.

**`DS:0x1fe` (pointer #1) is System A's own class table, with its own resolver — `CS:0xe199`, previously unlocated.** Structurally identical to System B's `CS:0xf0ae` but reading the other pointer:

```
e199  mov cl,[si+0x7] / sub ch,ch      ; class index (same descriptor offset as System B)
e19f  mov si,[0x1fe]                   ; System A's table pointer
e1a3  shl cx,1 (x2) / add si,cx        ; +4*cls
e1a7  shl cx,1 / add si,cx             ; +8*cls  -> total +12*cls
e1ad  mov cx,[si]                      ; class sprite base
```

called from `CS:0xe001`'s own tail (`CS:0xe094`, right after the trail-follow buffer append and the world→screen conversion `sub ax,[0xa] / sub bx,[0xc]`), storing the result into `[0x8]` alongside `[0x4]`/`[0x6]` — the exact same screen-position/sprite-id triple this document already documents feeding the **shared** `CS:0xff93` contact test and `CS:0x3569` draw call. So System A really does have its own 12-byte-stride class table, reached the same way as System B's, just through the sibling pointer — confirming the "6–8 apart" figures genuinely belong to System A's tables (they use a flatter animation model with no `MODE_ANIM`-style per-mode offset, so their classes don't need 18-wide reservations) and were never in tension with System B's numbers; they were just read as if they were the same table.

**The "25 slots" tension is dissolved, not just avoided.** It assumed `anim_base` (max 17) and `frame` (max 7) vary independently. Reading the three mode-handler bodies that matter settles it:

- **Walk** (`CS:0xf11f` left, anim_base 0; `CS:0xf1e5` right, anim_base 9) — `inc word [di+0x4] / and word [di+0x4],0x7` (`CS:0xf1d7`, mirrored at `CS:0xf29e`): frame free-runs **0..7**, but `anim_base` here is only 0 or 9, never 17.
- **Fall** (`CS:0xf4e5`, anim_base 17) — `mov word [di+0x4],0x0` is the handler's *first instruction*, and nothing in the body writes `[di+0x4]` again: frame is **pinned to 0** for the whole fall.
- **Hop** (`CS:0xf316`/`CS:0xf3ee`, anim_base 8/17) — an exhaustive read of both bodies (main loop plus the `0xf3ae`/`0xf3cd` ground-probe helpers) finds **no reference to `[di+0x4]` at all**. Frame is whatever the walk→hop transition left it at, and every transition into a hop explicitly zeroes it first (e.g. `CS:0xf165 mov word [di+0x4],0x0`), so it stays **0** for the hop's whole duration.

So `anim_base == 17` and `frame > 0` **never co-occur** — the highest offset any class ever computes is `max(9 + 7, 17 + 0) = 17`, needing exactly **18** contiguous slots (`0..17`). That is not a coincidence restricted to "the 9 classes the shipped descriptors reference" (an earlier revision's hedge) — it is a structural guarantee from the handler code itself, true for every class the table could ever hold. The 18-wide spacing measured between consecutive live 32×32 System-B classes (e.g. world 1: 462 → 480 → 498) is exactly this bound with zero slack, and it can never be violated by any reachable `(mode, frame)` pair.

### `UNKNOWN_sysA_movement_layer` — CLOSED: System A has its own movement layer `[PROVEN]`

Half of the old `UNKNOWN_entity_movement_layer` closed earlier with a correction: **`DS:0xdbe0` is System B's movement layer only.** The immediate `E0 DB` occurs exactly twice file-wide (`CS:0xedc3`, `CS:0xf0ae`) and every caller of the second reader lies in `0xee0e`–`0xf4ea`; System A (head `0xdf3a`, stride `0x28`) never touches it. So `0xe7ca`'s absolute-destination write belongs to System A. **System A's own layer is now located too — see below — and it is architecturally different from B's, not a variant of it.**

**The System-B movement layer, re-read here and `[PROVEN]` unless tagged.**

`DS:0xdbe0` (file `0x1DD40`) is **8 × 4 bytes of `{u16 handler, u16 anim_base}`** — the *reverse* field order of the player's `DS:0xd818`, which is exactly the sort of thing a port mirrors wrongly:

| mode | handler | `anim_base` | | mode | handler | `anim_base` |
|---|---|---|---|---|---|---|
| 0 | `0xf11f` | 0 | walk left | 4 | `0xf316` | 8 | hop left |
| 1 | `0xf1e5` | 9 | walk right | 5 | `0xf3ee` | 17 | hop right |
| 2 | `0xf487` | 8 | fall left | 6 | `0xf129` | 8 | *unreachable* |
| 3 | `0xf4e5` | 17 | fall right | 7 | `0xf1ef` | 17 | *unreachable* |

Both read sites are identical — `mov si,0xdbe0 / mov ax,[di+0xa] / shl ax,1 ×2 / add si,ax` — so the selector is entity `[di+0x0a]` with **no bounds check**. The immediate `E0 DB` occurs exactly twice file-wide (`CS:0xedc4`, `CS:0xf0af`), which is what pins this table to System B alone. Modes 6/7 are the *fall-through targets of modes 0/1's alignment gate* (`0xf11f` gates `jz 0xf129`), not separate behaviours.

- **Walk** (`0xf1be`): `dec word [di+0x6] / jns` — move only when the delay counter goes **negative**, then reload `ax = 10 − desc[+0x0b]` (`cbw`-extended), step `sub word [di],4`, and advance the animation `inc word [di+0x4] / and word [di+0x4],7`. So **higher `desc[+0x0b]` is faster**; shipped values are `{0,1,7,8,9,10}`, and 10 is the largest that keeps the reload non-negative.
- **The map is probed only on a tile crossing**: `mov ax,[di] / and ax,0x1c / jz`. Since X moves in steps of 4, that is true only at multiples of 32 — once per tile. This is observable behaviour, not just an optimisation: it sets when turn-arounds can happen.
- **Fall** (`0xf487`): `ax = [di+0x12]; if (ax != 0x10) [di+0x12]++; [di+0x2] += ax` — the velocity is applied **before** the increment and clamps at **16**. The hero uses `4 + v` capped at 10. **Do not share the code.** Landing snaps `and word [di+0x2],0xfff0` and sets mode 0.
- **The ground test is `== 1` exactly** (`cmp byte [ds:bp+0x100],0x1`), with the same `(X & 0x1f) >= 8` straddle the hero uses. Plane-B 2 (ladder) and every event cell ≥ 3 are therefore **not ground** — a System-B entity falls straight through them. A port written as `planeB >= 1` diverges on every ladder column.
- **The on-screen cull** (`0xf586`) is asymmetric: `x ∈ [−63, 351]`, `y ∈ [−63, 223]`, and it **pre-sets the verdict `DS:0x2ac` to `0xFFFF`** before testing — so an off-screen entity gets verdict −1 and mode 0 branches on `js`. Off-screen enemies skip the search entirely.

**The hop arc table `DS:0xdcde` extends into NEGATIVE indices** — it is centred on its own base, like the hero's jump table but signed both ways:

```
idx  -6  -5  -4  -3  -2  -1 |  0  +1  +2  +3  +4  +5 .. +15
val   8   8   4   2   1   1 |  0  -1  -1  -2  -4  -8 ..  -8
```

A port that treats `0xdcde` as the start of the table and clamps at 0 loses the entire descent. Indices ≥ 16 are garbage (`−772, −248, 1288, 1280`), so the cursor cap matters.

**The System-A movement layer, `[PROVEN]` — and it is NOT a `DS:0xdbe0`-shaped mode table.**

`CS:0xdf3a` is System A's per-frame group loop — the structural sibling of B's `CS:0xedb8`/`CS:0xedf4` — and it announces itself unambiguously: `mov byte [0x3c2],0x0` is the very first instruction, matching the already-documented "`DS:0x3c2`, `0x00` for A, `0xff` for B" discriminator exactly. It sets `bp = SS:0x3768` (group runtime), `di = DS:0xe96` (entity records), resets the marker cursor `DS:0x208 = 0xb5dc`, and walks **10** group-runtime slots (`SS:0x435`, seeded 9, the familiar `dec/jns` off-by-one — a sixth instance of that trap in this project). For each active group (`[bp+0] == 1`) it reads `si = [bp+2]` (the descriptor, saved by the activator `CS:0xde42` — itself byte-for-byte the System-A twin of B's `CS:0xde08`: consume-the-event-first, first-fit over 10 slots, give up silently if all are busy), `cl = [si]` (entity count), and calls **`CS:0xe001`** once per live entity (`[di+0x8]` nonzero), stride `0x28`.

**`CS:0xe001` is a fixed six-stage pipeline, run unconditionally for every entity every tick — not a dispatch to one handler:**

| stage | call | role |
|---|---|---|
| 1 | `CS:0xe6e4` | **the mode selector — this is System A's real analogue of B's `DS:0xdbe0` dispatch** |
| 2 | `CS:0xe336` | accelerate a velocity pair `[di+0x12]/[di+0x14]` toward the goal `[di+0x1c]/[di+0x1e]`, or decay it to zero once arrived |
| 3 | `CS:0xe487` | descriptor-gated (`[si+0xf]`) special action (attack/leap), may override the velocity |
| 4 | `CS:0xe44d` | clamp velocity to a **second**, independent speed cap `[si+0xb]` |
| 5 | `CS:0xe42b` | **apply** — position update, or a snap-to-goal, or nothing at all |
| 6 | `CS:0xe659` | recompute the facing/muzzle direction `DS:0x206` |

Then contact via **`CS:0xff93`** and draw via **`CS:0x3569`** — reached through the identical `push si/di/bp`, `DS:0x35e = 1` then `0`, `[di+0x8]`-sign, death-or-draw bracket already documented for System B at `CS:0xedf4`–`0xee00`. **Both routines are shared between the two systems, not System-B-exclusive as this document previously implied** — corrected at *Entity contact* above.

**Stage 1, `CS:0xe6e4`, is the real find.** `[di+0x24]` is a *sticky* per-entity mode byte: if it is negative (unset), the entity rolls a fresh strategy — gated first by a per-GROUP throttle (a bitmask at `[bp+0x14]`/`[0x3c4]` capping how many group members can commit to a new strategy on the same tick, plus a `[si+0xa]`-vs-random gate) — landing at `CS:0xe748`, which reads descriptor `[si+0x8]` as a **lo/hi nibble pair** and `[si+0x9]` as a **7-bit weight**, rolls `0x3836` against it, and swaps the two nibbles on a lost roll. This is the *exact* shape already documented for System B's pathfinder-seed picker at `CS:0xf6db` — same field offsets, same weight polarity — just wired to a different entity system. If `[di+0x24]` is already set (≥ 0), the entity skips the reroll and jumps straight back into the **same** strategy via `CS:0xe76b` with the sticky value.

Both paths land on one jump table, **`DS:0xd95c`**, verified by reading the raw words (file offset `= (0x1ffd*16 + 0xd95c) − 0xFE70 = 0x1DABC`, the same formula this document already uses, cross-checked first against the already-documented `DS:0xd966` to confirm it):

```
idx 0  0xe77b        idx 5  0xf854   ⎫
idx 1  0xe9da        idx 6  0xf729   ⎬ byte-identical to DS:0xd966[0..3]
idx 2  0xe88c        idx 7  0xf794   ⎪ (the System-B pathfinder-seed table)
idx 3  0xeb36  (RET) idx 8  0xf800   ⎭
idx 4  0xe7db
idx 9  0x0000  (terminator)
```

**`DS:0xd966` is not a second table — it is `DS:0xd95c + 5 words`.** System B's own picker hardcodes base `0xd966` only because no shipped System-B descriptor nibble ever exceeds 3; the physical words it reads are the tail of the same array System A indexes from 0. This reframes the earlier "`DS:0xd966` is only four entries" finding: true in isolation, but it is a four-entry *window* onto a shared nine-entry table, not a standalone one.

- **Index 0 — `0xe77b`, chase.** Falls straight into `0xe7c4`/`0xe7ca` (`mov ax,[0x17a] / mov bx,[0x17c] / add bx,8` — write the hero's position as the goal) unless a per-entity progress ratio (`[bp+0x12]`/`[bp+0x13]`) or a `[si+0xa]`-gated reroll intervenes.
- **Index 1 — `0xe9da`.** A weighted, minimum-cost search over **six** scratch slots at `DS:0x3c5..0x3ca` (`mov bp,5` then `dec bp/jns` — the off-by-one again, seven instance now), gated by descriptor `[si+0xd]`; the deepest-undecoded piece of this system (`0xec12`, `0xeaf7`, `0xeb1a` unread).
- **Index 2 — `0xe88c`, the marker-seek.** Reuses the *same* `DS:0x398`/`DS:0x208` globals as System B's own "attracts monsters" potion strategy (`0xf794`) — implemented as separate code for A, but the same mechanism.
- **Index 3 — `0xeb36`.** A bare `RET`. Dead, in the same family as player state 7 and the flame weapon's null spawn/mover pair.
- **Index 4 — `0xe7db`, trail-follow.** `CS:0xe001`'s own tail (`add [bp+0xe0],4`, wrap at `0x190`) appends every entity's `(X,Y)` each tick to a 100-slot circular buffer per group, based at `[bp+0x18]`; index 4 reads an **older** slot, offset by `([di+0x19]−1)×16` bytes back — a conga-line / follow-the-leader mechanic. **Read in full this pass (`CS:0xE7E6`–`0xE81D`), confirming the offset formula exactly to the byte** (`al=[di+0x19] / dec ax / shl x4` = `([di+0x19]−1)×16`, then `[bp+0xe0] − offset`, wrapping `+0x190` when negative — precisely as summarised): the historical `{X, Y}` read back from that wrapped slot is written straight into the entity's own **goal** (`[di+0x1c]`/`[di+0x1e]`) — *unless* the group descriptor's own `+0x4` BE flag word, masked to its top two bits (`& 0xC0`), is nonzero. When bit `0x80` specifically is set, the handler diverts into a **second, undecoded sub-mode** (`CS:0xE821` onward) indexing a stride-10 table at `DS:0xD96E` by a *different*, previously-unlocated group-runtime field (`[bp+0x12] − 2`), which then folds into the same `[di+0x19]`/group-runtime-`+0xe2` wraparound arithmetic this document's stage-1 section already documents nearby. `UNKNOWN_sysA_trail_follow_altmode` — **partly closed: the `0xD96E` table is an evenly-spaced-fractions generator `[STATIC]`.** Reading the raw bytes directly (6 records × 10 bytes, `DS:0xd96e`–`0xd9a1`):

```
record 0 (k=0):  00 00 00 00 00 00 00 00 00 00
record 1 (k=1):  00 00 00 40 00 00 00 00 00 00                       -> {64}
record 2 (k=2):  00 00 00 00 2a 55 00 00 00 00                       -> {42, 85}
record 3 (k=3):  00 00 00 00 20 40 60 00 00 00                       -> {32, 64, 96}
record 4 (k=4):  00 00 00 1a 33 4d 66 00 00 00                       -> {26, 51, 77, 102}
record 5 (k=5):  00 00 15 2b 40 55 6b 00 00 00                       -> {21, 43, 64, 85, 107}
```

Every non-zero value matches `floor(256 × i / (2k+2))` for `i = 1..k` (record `k`'s own live-value count), to the byte, across all 5 non-empty records — e.g. record 5: `256×1/12=21.3→21`, `256×2/12=42.7→43`, …, `256×5/12=106.7→107`. So this is a **generator for `k` evenly-spaced fractions of a byte's full 0–255 range**, one record per follower count — exactly the shape needed to space `k` trailing entities evenly around a queue/circle rather than stacking them at fixed 16-byte trail-buffer offsets, the way the ordinary (non-`0x80`) trail-follow path does. This strongly suggests `[bp+0x12]` is a **follower count or follower index** (offset `−2` to zero-base it against this table's own record numbering) and the alt-mode is a refinement used for larger trail-follow groups, spacing members proportionally rather than linearly.

**And the downstream code (`CS:0xE859`–`0xE882`, read immediately after) confirms the goal-write and reveals the shape is very likely genuinely circular, not just evenly-spaced-linear:**

```
e859  si += ax                          ; the fraction-derived offset indexes a SECOND table via si
e85b  ax = word[si]                     ; read one word
e85d  bx = word[si + 0x100]             ; read ANOTHER word, exactly 256 BYTES later in the same table
e861  sar ax,0xa ; sar bx,0xa           ; both >> 10 (i.e. scaled down from a large fixed-point range)
e867  cx = [bp+0xe0] - 4                ; the MOST RECENT trail-buffer slot (one step back from the write cursor)
e874  bp += wrapped(cx)
e879  ax += [bp+0x18] ; bx += [bp+0x1a] ; add the historical position at that freshest slot
e87f  [di+0x1c] = ax ; [di+0x1e] = bx    ; <-- THE GOAL — confirmed, exactly like the ordinary path
```

So the alt-mode **does** write the entity's goal, exactly as inferred, but computes it very differently: it adds an `(Δx, Δy)` offset — read from two words **256 bytes apart** in a table indexed by the `0xD96E`-derived "fraction of 256" — to the *freshest* trail-buffer position (not a historical one N steps back, the way the ordinary conga-line path works).

### `SINCOS.DAT` decoded, and `UNKNOWN_sysA_trail_follow_altmode_sincos` — CLOSED `[PROVEN]`

A first attempt at this (naive little-endian, arbitrary stride guess) found no sine pattern and was recorded as a refutation — **that was an endianness mistake, corrected here.** Read as **big-endian** `i16`, `SINCOS.DAT`'s first 512 words are `sin(i × 2π/512) × 32767` to within **±1** (rounding) across the entire period — verified exhaustively against a computed reference for all 512 entries, not sampled:

```python
words = struct.unpack('>640h', open('SINCOS.DAT','rb').read())
# words[i] == round(sin(i/512 * 2*pi) * 32767), max abs error 1, for i in 0..511
```

So `SINCOS.DAT` is a **1024-byte, 512-entry, big-endian `i16` sine table spanning one full 360° period** (amplitude `±32767`), and — because a quarter period is exactly `128` words `= 256` bytes — **`cos(θ)` is `sin(θ + 90°)`, reachable in the SAME table at a fixed `+256`-byte offset**, no separate cosine array needed. That is **exactly** the game code's own access pattern at `CS:0xE85B`/`0xE85D` (`ax = word[si]`, `bx = word[si + 0x100]`) — not a plausible-shaped coincidence but a byte-for-byte match to the table's own real period. This **confirms** the alt-mode's reading: it computes `(sin θ, cos θ)` — scaled by `>>10` inside the game (dividing the `±32767` amplitude down to a small pixel-scale radius) — from an angle `θ` derived from the `0xD96E` evenly-spaced-fraction table, and adds that `(Δx, Δy)` to the trail's freshest position. **The alt-mode genuinely arranges trail-follow members in a circle or arc around the leader**, radius set by whatever scaling happens before the `>>10`, angle picked by each follower's own evenly-spaced slice of the full turn.

The trailing **128 words (bytes 1024–1279, `SINCOS.DAT`'s own on-disk last 256 bytes)** are **not** part of the sine cycle on disk — small values (`23, 16, 15, 0, …`) with no relation to the period-512 formula.

### `UNKNOWN_sincos_dat_tail` — CLOSED: overwritten at load time with a wraparound copy of the table's own first quarter `[PROVEN]`

Also settles `SI`'s provenance for the trail-follow alt-mode's own `(sin,cos)` read, left as "not directly observed" in the closure above: the string `"sincos.dat"` sits at `DS:0xEAA1`, and its **only** reader is `CS:0x9207` inside `FUN_1000_9200` — a one-shot-latched (`DS:0x3E3`) raw loader (`CX=0x500`=1280, the file's exact size, no DCL decompress — matching this document's own "not DCL-compressed" list) that reads it straight to **`SS:0x40B0`**. `CS:0xE828`'s `MOV SI,0x40B0` is **the identical constant** — so the sine-table base the trail-follow alt-mode reads from is now **directly confirmed** to be this loaded copy of `SINCOS.DAT`, not merely inferred by shape.

`FUN_1000_9196` — which calls the loader and runs unconditionally right after it — is what fills the "tail":

```
9196  call 0x1000:9200                  ; load SINCOS.DAT to SS:0x40B0
919b  si = 0x40b0                        ; the table's own start — words 0..127, i.e. sin(0°..90°), the ASCENDING quarter
919e  di = 0x44b0                        ; 0x40b0 + 0x400(1024) = exactly ONE FULL 512-word PERIOD past the table start
91a3  cx = 0x80 (128)                     ; 128 words = 256 bytes — exactly the "tail" region's own size
91ad  rep movsw es:di,si                  ; COPY the ascending quarter (0°..90°) to the tail, verbatim
```

So the bytes sitting at file offset 1024+ on disk are never actually read as data at all — at load time they are **unconditionally overwritten** with a copy of the table's own first 256 bytes (indices `0..127`, `sin(0°)` through `sin(90°)`). The purpose is the classic circular-table wraparound trick: the trail-follow alt-mode's own cosine read is `sin(θ)` fetched `256` bytes *ahead* of the matching sine read (`CS:0xE85D`, `word[si+0x100]`) — for any `θ` whose sine index falls in the table's **last** quarter (indices `384..511`, i.e. `270°..360°`), that `+256`-byte cosine read lands at indices `512..639` — past the real one-period table entirely. By duplicating the ascending quarter there, `sin(θ)` for `θ` in `360°..450°` reads correctly as `sin(θ−360°)` with **no wraparound/modulo logic needed in the consumer** — the table simply keeps going linearly past its own "true" end. `SINCOS.DAT`'s own on-disk tail bytes are consequently pure padding/whatever the export tool happened to leave there; nothing in the shipped game ever reads them as data.

`FUN_1000_9196` continues past this copy (`CS:0x91B0` onward, re-read in full below) to build a **second, separate 32-entry derived table at `DS:0xAC50`** — in the same memory neighbourhood as this session's already-documented "spawn flash" pool (`DS:0xAC90`) and the world-1 statue hazard array (`DS:0xACCC`) — reading `sin`/`cos` pairs stepping `32 bytes` (`16` words `= 11.25°`) per entry across the full circle (`32 × 11.25° = 360°`, exactly), and dividing them by **two different constants**, `0x556`(1366) for the sine half and `0x400`(1024) for the cosine half, each then biased by `+9`/`+17` respectively before being packed as two signed bytes per entry.

### `UNKNOWN_9196_ac50_table` — CLOSED: the invulnerability aura's own 4-particle orbit `[PROVEN]`

`get_xrefs_to` on `0xAC50` finds exactly one other reference: `CS:0xA940`, inside `FUN_1000_a931` — the **invulnerability aura's per-frame particle updater**, this document's own already-named source of the aura's damage-grid stamp (`CS:0xA9AE`). Reading it in full closes the whole chain:

```
a931  cmp word[0x172],1 / jnz a930          ; only while invulnerability is active (the already-documented flag)
a938  di = 0x1d8 ; cx = 4                    ; the already-documented "four aura phase offsets", one per particle
a93e  dx = word[di]                          ; THIS particle's own phase — a byte offset INTO the 0xAC50 table
a940  si = 0xac50 + dx
a945  lodsb / cbw / bx = ax                  ; entry byte 0 (the sin/1366+9 value), sign-extended
a949  lodsb / cbw / xchg ax,bx               ; entry byte 1 (the cos/1024+17 value)
a94c  ax += [0x17a] ; bx += [0x17c]          ; + hero world X/Y
a954  ax -= [0xa] ; bx -= [0xc]              ; -> screen space
a95c  call 0x1000:a9ae                        ; STAMP the damage grid at this particle's own position
a95f  dx = (cx-1)<<1 ; dx += [0x1e0] ; dx &= 3 ; dx += 0x57(87)   ; sprite = 87 + a rotating 0..3 variant
a97b  call 0x1000:356e                        ; DRAW it (the shared masked blitter)
a980  [di] += 2 ; [di] &= 0x3f                ; advance THIS particle's own phase, wrapped at 64 (the table's own byte size)
a986  di += 2 ; loop 0xa93e                    ; next particle (4 total)
```

So `DS:0xAC50` is the lookup table for **four particles orbiting the hero while invulnerable** — each with its own independently-advancing phase (`DS:0x1d8`, 4 words, `+2`/frame, wrapped at `0x3F` — exactly the table's own `32 × 2 = 64`-byte span, so the wrap and the table size were sized together deliberately), each stamping the shared damage grid at its current position (this is the literal mechanism behind the already-documented "while `[0x172]` is set the hero takes no damage *and still kills everything he touches*" — the orbiting particles, not just the hero's own hitbox, are what's doing the killing) and drawing through a **separately** rotating 4-sprite variant selected by a global phase counter `DS:0x1E0` (incremented once every other frame, the same toggle this document uses throughout). The `+9`/`+17` biases and the asymmetric `/1366` vs `/1024` divisors are consistent with an **intentionally non-circular (taller-than-wide) orbit** sized to clear the hero's own 32×48 sprite — the smaller-magnitude (more-divided) axis is the horizontal one, the larger the vertical, matching a sprite that's taller than it is wide. The whole table is rebuilt on every level load/respawn (`FUN_1000_9196`'s sole caller is `CS:0x8D40`, inside the already-documented level-load/respawn routine `FUN_1000_8c34`), so it isn't shipped data at all — computed fresh each time from `SINCOS.DAT`.
- **Indices 5–8 — the four System-B goal strategies**, verbatim: hero-column, box-around-hero, marker-list, first-on-screen waypoint.

**Shipped-data census, matching this document's own validation standard.** Across all 400 System-A descriptor slots (`PALFILS.0{A,B}{1-4}`, `DS:0x9d60`, 50 records × 8 files), only **74 are live** (`9/9/10/9/9/9/10/9`, entity count `[si+0] != 0`) — and the `[si+0x8]` nibble across every live record is in **`{0, 1, 2}`**, never reaching 3 or beyond. So in the shipped release **only strategies 0–2 (chase, the flock/target search, marker-seek) are ever selected** — the dead RET, the trail-follow, and all four B-shared goal strategies are real, reachable code with no bounds check, but no shipped System-A descriptor ever picks them.

`UNKNOWN_sysB_sprite_formula` is CLOSED — see *The enemy sprite* above, which now also covers System A's own resolver (`CS:0xe199`), the `DS:0xdf80` pointer-table structure, and the proof that the 18-slot spacing has no exceptions.

`UNKNOWN_pathfinder_producers` — the four move generators (`0xfd54`, `0xfe36`, `0xfcbc`, `0xfb4d`) called by the expand routine `0xf64d` — **is CLOSED**; all four are decoded and ported, and the port hunts. See *The enemy pathfinder* **above**, not below. ⚠️ An earlier revision of this paragraph called them "the last thing standing between the port and hunting enemies", and left that standing after the closure was written 980 lines earlier — the same stale-`UNKNOWN_` pattern this document keeps having to sweep for.

### System A's six-stage pipeline — stages 2, 4, 5, 6 and the sprite resolver, fully decoded `[PROVEN]`

Following on from *`UNKNOWN_sysA_movement_layer` — CLOSED* above (which located the pipeline and decoded stage 1's strategy dispatch): the remaining five pieces — stages 2, 4, 5, 6, the sprite resolver `CS:0xe199`, and System A's own spawn/materialise loop — are now read byte-for-byte, all via `disassemble_function`/`disassemble_bytes` (never `decompile_function`), closing the port-blocking gaps the earlier pass over the pipeline left.

**Stage 2 — `CS:0xe336`, accelerate-toward-goal, and the flag stage 3 depends on.**

```
e336  cx = [di+0x1c] ; dx = [di+0x1e]        ; goal X/Y
e33c  ax = [di]      ; bx = [di+0x2]         ; entity X/Y
      push ax,bx,cx,dx                        ; save the RAW (pre-round) values
e346  bp = 0x10 ; ax/bx/cx/dx += bp           ; +16 to all four
e351  bp = 0xffe0 ; ax/bx/cx/dx &= bp         ; round DOWN to the nearest 32 (a rounded-to-nearest-cell test)
e35d  cmp cx,ax / jnz e365
e361  cmp dx,bx / jz e3b5                     ; rounded goal cell == rounded entity cell -> ARRIVED (e3b5)
e365  pop dx,cx,bx,ax                          ; not arrived: restore the RAW values
e369  cx = goalX - entityX ; dx = goalY - entityY
e36d  cx >>= 3 (arithmetic)                    ; a proportional step, 1/8 of the remaining distance
e373  dx >>= 3 (arithmetic)
e379  ax = [di+0x16]                            ; entity's own per-tick step cap
e37c  bx = [si+0xc]                             ; descriptor +0xc, zero-extended byte — a SECOND cap
e381  ax = min(ax, bx)                          ; the smaller of the two caps wins
e386  bx = -ax
e38a  cx = clamp(cx, bx, ax)                    ; clamp the 1/8-distance step to +/-min(cap)
e39c  dx = clamp(dx, bx, ax)
e3ae  [di+0x12] += cx ; [di+0x14] += dx         ; ACCUMULATE into velocity — not a set, an increment
e3b4  ret
```

So stage 2's normal path does not steer velocity directly at goal; it nudges the existing velocity by up to `min([di+0x16], descriptor[+0xc])` toward `(goal-entity)/8` every tick, clamped per-axis independently. `[di+0x16]` is therefore a THIRD role for that field, beyond the already-documented stage-3 speed-comparison and the sprite resolver's animation-cadence divisor (`CS:0xe199`, below) — one word governs per-tick steering budget, attack-speed comparison, and animation rate together. `descriptor[+0xc]` is a per-class steering-step cap that competes with `[di+0x16]` for the smaller value — see *`UNKNOWN_sysA_descriptor_0c` — CLOSED* below for its shipped-data range (always 1..10), still without a name for what *sets* `[di+0x16]` per-entity.

**The arrival branch, `e3b5`, is where the coarse/fine distinction lives:**

```
e3b5  ax = min([di+0x16], [si+0xc])            ; the same cap
e3c2  cx = [di+0x12] ; decay CX toward 0 by ax, clamping AT the zero crossing (not past it)
e3d7  dx = [di+0x14] ; the same decay on Y
e3ec  [di+0x12]=cx ; [di+0x14]=dx
e3f2  [di+0x1b] = 1                             ; COARSE arrival flag (32px cell match)
      pop dx,cx,bx,ax                            ; the RAW (unrounded) saved values, still on the stack
e3fa  cmp byte [di+0x19],0 / jz e42a
e400  cmp byte [di+0x19],1 / jz e42a             ; [di+0x19] gates the fine check: skip when 0 or 1
e406  bp=4 ; ax/bx/cx/dx += bp ; bp=0xfff8 ; ax/bx/cx/dx &= bp   ; round to the nearest 8
e41e  cmp cx,ax / jnz e42a
e422  cmp dx,bx / jnz e42a
e426  [di+0x25] = 1                              ; FINE arrival flag — 8px, not 32px
e42a  ret
```

**`[di+0x25]` is the flag stage 3 (`CS:0xe487`, `[si+0xf]`-gated attack/leap) reads to decide whether to fire its special action, and stage 5 reads it too (below) to decide whether to snap position outright.** So the closure this session already wrote for `FUN_1000_e4e2`/stage 3's caller behavior gets its missing precondition: the attack only arms once the entity is within 8px of its goal on BOTH axes, and only when `[di+0x19]` is neither 0 nor 1 — see the closure immediately below.

### `UNKNOWN_sysA_field_0x19` — substantially CLOSED: a per-entity "reroll queue rank" stamp `[STATIC]`

`[di+0x19]` has exactly **one writer** in the whole image, `CS:0xE72D`, inside stage 1's per-entity throttled-reroll gate (`FUN_1000_e6e4`, the strategy dispatcher this document already documents). Reading the gate in full:

```
e6f1  cmp byte[bp+0x12],0 / jz 0xe748        ; group-runtime "reroll slots used" counter == 0 -> nothing gates, skip
e6f7  cl = [0x3c4] ; ax = 1<<cl               ; a per-tick GLOBAL bit position
e700  cx = [bp+0x14] ; test ax,cx / jnz 0xe748  ; that bit already set in this group's "rolled" bitmask -> skip
e707  cl = [si+0xa] ; call 0x3836 (random) ; and ax,0x7f
e710  cmp ax,cx(weight) / jge 0xe748          ; the descriptor's own weight, same shape as the pathfinder-seed picker
e714  al=[bp+0x12] ; ax = al*10               ; the group's reroll counter, scaled by 10
e722  cmp bx,[bp+0x16] / jg 0xe748            ; over the group's own cap -> skip (the "per-group throttle" already documented)
e727  inc byte[bp+0x12]                       ; ADVANCE the group's reroll counter
e72a  al = [bp+0x12]
e72d  [di+0x19] = al                          ; <-- STAMP this entity with the counter's NEW value
e730..e73e                                     ; mark the per-tick global bit as consumed
```

So `[di+0x19]` is not a boolean gate at all — it is **the group-runtime reroll-throttle counter's value at the moment this specific entity's reroll request was granted**, i.e. a 1-based "my rank in this group's reroll queue this tick" stamp. It has **four** readers, and two of them treat the value ordinally rather than as a flag:

- Stage 2 (`CS:0xE3FA`/`E400`, already documented) only distinguishes `0` from `1` from "anything else" to gate the fine-arrival check.
- The pipeline dispatcher `CS:0xE001` (`CS:0xE039`) tests it against exactly `1`.
- The entity system's per-entity death handler (`CS:0xE289`; see *`UNKNOWN_df62_full_flow` — CLOSED* below for why it is **not** actually `FUN_1000_df62`, a mislabelled, unrelated address) reads it, compares against `1`, and branches to `CALL 0x1000:ebb9` when true, else `DEC byte[bp+0x12]` — **undoing** the group counter's own advance, as if giving the slot back — immediately after this same code drops any carried item via the popup spawner `CS:0xBF5F` (gated on a separate field, `[di+0x10]`, not on this rank check). Read together with this session's own `UNKNOWN_bf5f_popup_id` closure: a normal drop goes through the popup spawner (so most dropped items become a floating icon, not a solid object), and **only the entity whose reroll rank is exactly 1 — the first granted this tick — proceeds to `CS:0xEBB9`**; every other entity that rolled this tick has its own throttle advance reversed.
- `FUN_1000_ebe5` (`CS:0xEBEB`) reads `[di+0x19]` and compares it against **another group member's own `[si+0x19]`** (`si` sourced from `DS:0x294`, the already-documented "current group's entity base" shadow global), gated by rotating a bit out of the group's "rolled" bitmask per candidate — a genuine ordinal scan across the group, not a boolean test.

So `[di+0x19]`'s real role is: **exactly one entity per group per tick — the one stamped `1`, i.e. first through the reroll gate — is privileged** by at least two of its four consumers, with a third (`ebe5`) running a fuller rank comparison across the whole group.

### `UNKNOWN_ebb9_reroll_effect` — CLOSED: a synchronized whole-group strategy reset `[STATIC]`

`CS:0xEBB9`, the privileged (rank-1) entity's own call target, is a **group-wide reset**, not a per-entity effect:

```
ebb9  [bp+0x12] = 0                 ; the GROUP's own reroll-throttle counter -> back to 0
ebbd  [bp+0x14] = 0                 ; the GROUP's own "rolled" bitmask -> cleared
ebc2  al = [si]                     ; SI here is still the GROUP DESCRIPTOR pointer (this entity system's `+0x0` = entity count field)
ebc4  si = [0x294]                  ; the already-documented "current group's entity base" shadow global
ebc8  cx = sign_extend(al)          ; loop count := the group's own entity count
ebcb  [si+0x19] = 0                 ; each member's own reroll stamp -> 0
ebcf  [si+0x25] = 0                 ; each member's own FINE-arrival flag -> 0
ebd3  [si+0xa] = 1                  ; a movement-related field, set uniformly
ebd8  [si+0x24] = 0xff              ; each member's own STICKY strategy byte -> unset (0xFF, "reroll a fresh strategy next stage-1 pass")
ebdc  si += 0x28 ; loop 0xebcb      ; next member, stride 0x28 (System A's own entity stride)
```

So `CALL 0xEBB9` walks **every entity in the group** and force-unsets each one's own sticky strategy byte (`+0x24`) — the field stage 1 (`CS:0xE6E4`) checks first to decide "roll a fresh strategy vs. keep the current one." The whole `[di+0x19]` mechanism now reads as a coherent design: it exists so that when one entity in a group is granted the (randomly-weighted, budget-capped) reroll, only that ONE entity — the first through the gate this tick — gets to trigger a **synchronized reset of the entire group's goal strategy**, rather than each member rerolling independently and out of sync. Every other entity that also rolled this tick (rank ≠ 1) has its own individual throttle slot given back instead, so the group's reroll budget isn't wasted on entities that don't get to act.

### `UNKNOWN_df62_full_flow` — CLOSED: it isn't `FUN_1000_df62` at all — this is System A's per-entity DEATH DRAW `[STATIC]`

⚠️ **Correction to this document's own naming, caused by exactly the trap this document's header already warns about for this code region.** `1000:E283` (where the `[di+0x19]`/`CS:0xBF5F` code was first read) sits inside Ghidra's function labelled `FUN_1000_df62` purely because Ghidra's linear function-boundary detection swallowed a large, unrelated span starting at that address — `CS:0xDF62` itself is a completely different, already-fully-decoded piece of code (the shared inactive-slot loop-advance tail of the master per-group loop `FUN_1000_df39`, confirmed by direct disassembly: `df62 di=[0x294] / bp+=0xe4 / di+=0x190 / dec ss:[0x435] / jns df51 / ret`). The `CS:0xE283` block has nothing to do with it. Tracing the real chain instead (`get_xrefs_to` at each step):

```
CS:0xE0B2  cmp word[di+8],0 / jns 0xe0bb / jmp 0xe241   ; the STATE test: alive -> draw now; dead(<0) -> the death arm
CS:0xE0BB  call 0x1000:3569                              ; ALIVE: the shared entity blitter (already documented)
CS:0xE0C1  cmp word[di+0x10],0 / jns 0xe0c8 / ret         ; a NEW field, +0x10 = carried-item TYPE, negative = "carrying nothing"
CS:0xE0C8..E0F3                                           ; carrying: EASE the carried icon's own [di+0x20]/[di+0x22]
                                                           ;   position halfway toward the entity (SAR 1), matching this
                                                           ;   document's already-documented "eases those coordinates halfway"

CS:0xE241  call 0x1000:efe7 ; jmp 0x1000:e0bb              ; DEAD: the SAME BCD-pack helper this session's own
                                                           ;   UNKNOWN_creature_death_anim closure found for System B,
                                                           ;   then falls into the SAME draw call (0xe0bb -> CALL 0x3569)
                                                           ;   the alive branch uses — confirming BOTH entity systems
                                                           ;   share one death-draw idiom, not just System B
```

`[di+0x10]` (carried-item type) is the gate that ties everything together — it selects between the "ease + draw the carried icon" branch above **and** a *separate* drop path, reached elsewhere (`CS:0xE251`–`E282`, the position-cache/popup-drop block this document already documents): `CS:0xE25C cmp word[di+0x10],0 / js 0xe283` — carrying nothing skips straight to the `[di+0x19]` rank-check/`CS:0xEBB9` reset code; carrying something first drops it via `CS:0xBF5F` (recovering the display id: weapons pass through for `CS:0xBF5F`'s own `−0xC0`, ordinary types get `+0xB` pre-added so the SAME `id≥0xB → type=id−0xB` recovery inside `CS:0xBF5F` works unmodified) and only then falls into the identical `[di+0x19]` code.

**So the drop and the rank-check/group-reset are two independent, sequential steps on one shared code path, not two readings of the same mechanism**: the leading `[di+0x10]` test decides whether an item gets dropped first; the `[di+0x19]` machinery that follows runs unconditionally either way. `CS:0xE251`/`E253`/`E259` also caches the entity's own position into `DS:0x202`/`DS:0x204` — the *same* scratch pair this document's `UNKNOWN_creature_death_anim` closure already found `CS:0xEFE7`'s caller using.

### `UNKNOWN_sysA_0x1f4_elimination_detector` — CLOSED: a per-group "cleared" message, and the group-deactivation condition `[STATIC]`

Reading `FUN_1000_df39`'s tail in full (`CS:0xDFAC`–`0xE000`, immediately after the per-entity loop this document's own six-stage-pipeline section already documents):

```
dfac  cl = [si]                               ; the group descriptor's own entity-count field
dfae  cl -= [0x3c3] ; cl -= [0x1f4]            ; minus fully-dead, minus dying — the group's LIVE count
dfb6  [bp+0x13] = cl                            ; cached into a NEW group-runtime field, +0x13
dfb9  call 0x1000:eb37                          ; a side random-event roll — see below, not part of the elimination logic itself
dfbc  cl = [0x3c3] ; cl += [0x1f4]              ; dead + dying
dfc4  cmp cl,[si] / jnz 0xdff1                  ; not everyone dead-or-dying -> skip the whole block below
dfc8  ax=[0x202]+8 ; bx=[0x204]+8               ; the cached "last interesting entity" position, +8 on both axes
dfd5  cmp byte[bp+0x10],0 / jnz 0xdff1          ; group-runtime +0x10 — a ONE-SHOT "already announced" latch
dfdb  cx = word[si+0x10]                        ; the GROUP DESCRIPTOR's OWN +0x10 field (BE u16 — a PREVIOUSLY UNDOCUMENTED PALFILS field)
dfe0  or cx,cx / js 0xdfed                       ; negative -> no message configured for this group, skip the popup
dfe4  call 0x1000:bf5f                           ; spawn it via the already-decoded popup system, at the cached position
dfed  [bp+0x10] = 1                              ; latch — never announces twice
dff1  cl = [0x3c3]                               ; fully-dead count ALONE (dying entities don't count here)
dff5  cmp cl,[si] / jl 0xdffe                    ; still fewer fully-dead than the group total -> just advance
dff9  [bp+0] = 0                                 ; ALL fully dead -> DEACTIVATE the group (state -> 0, slot freed for reuse)
```

So there are **two distinct thresholds, not one**: "dead + dying == total" is the trigger for a **one-shot popup/message**, read straight out of a previously-undocumented `PALFILS` field (`System-A group descriptor +0x10`, big-endian `u16`) — this is the mechanism behind "you cleared this group" style flavour text, fired the instant the last live entity starts dying rather than waiting for its death animation to finish, at the position cached from whichever entity most recently went through the death-draw path. "Dead == total" (strictly fully dead, not merely dying) is the **separate, stricter** condition that actually frees the group's runtime slot. A group that has just finished dying-but-not-yet-dead sits in a window where the message has fired but the slot is still occupied.

⚠️⚠️ **CORRECTION, a later session — now PORTED.** This is a third, INDEPENDENT group-elimination-reward mechanism, distinct from both System-B's own `+0x10` (`UNKNOWN_f030_item_drop`, port: `popup.js`/`spawn.js`'s `parseGroupsB`/`main.js`) and the selector-2 spawner's own reward (`CS:0xAED0`-`0xAF0F`, port: `selector2.js`). A prior revision of this note said `re-gods`'s `parseGroupsA` had no `rewardId`-equivalent field and `main.js` never drained a System-A reward — both are now closed: `parseGroupsA` (`spawn.js`) reads `+0x10` with the identical BE `i16` convention as `parseGroupsB`, and `main.js` carries a `groupsA` runtime-tracking array (mirroring the existing `groupsB` array's own shape) whose reward-check loop fires on the SAME `dead+dying === count` condition as `CS:0xDFC4` above, draining into the same single-slot `popup.js` every other reward channel in this project already shares.

Two divergences from System B's own port that are easy to get backwards, both load-bearing:
- **The position bias is applied at the OPPOSITE end.** System B's own entity caches its position WITH a `+8`-on-X-only bias baked in at write time (`CS:0xED84`). System A's own cache (`CS:0xE251`/`E256`, see the fresh disassembly two sections below) is **raw, no bias at all** — the `+8`-on-**BOTH**-axes bias seen in the trace above (`dfc8 ax=[0x202]+8 ; bx=[0x204]+8`) is applied at THIS READ SITE instead. `re-gods`'s `entity-a.js` (`deathCacheX`/`deathCacheY`) stores the raw position; `main.js`'s own `groupsA` reward loop adds `+8` to both axes when it reads the cache out, not before.
- **The slot-free condition (`dff9`/`dff5`, strictly `dead === count`, dying does NOT count) is NOT modelled**, for the same reason System B's own port doesn't model its identical `CS:0xEDB1`/`0xEDAA` condition either: this port's `GroupSlots`/runtime-tracking arrays have no fixed 10-slot cap to recycle, so there is nothing for a stricter free-condition to protect. Only the looser reward-fire condition (dead-**or**-dying) is ported, on both entity systems, consistently.

**`UNKNOWN_sysA_reward_ids` — a first census, mirroring `UNKNOWN_sysB_reward_ids` above.** Decompressed all 8 `PALFILS.0{A,B}{1-4}` files and read every live System-A descriptor's `+0x10` field directly (`re-gods`'s own test suite now runs this same census at `node tools/verify-node.mjs` time, so it stays live rather than transcribed): across the 74 live records the set is exactly `{-1, 0, 16, 22, 27, 45}` — negative (none) is the minority, and the four positive ids recover as `POBJECTS` types `5`, `11` (`"chrystal"` — the SAME dominant default System B's own census finds), `16` (`"treasure chest"`/iron — the very chest this document's own chest-key-surplus section finds SIX keys shipped for and ZERO placed), and `34` (`"jewel"` — the SAME type the world-2 nest's own death-award popup already spawns). Unlike System B's own eight-value census, `0` (the undecoded plain-numeric-popup branch, `CS:0xC004`) is genuinely reachable here, not merely theoretical.

⚠️ **A later session's `entity-a.js` port note, since it bears on the port's own DYING dispatch, not on anything in this file's own bytes above.** `re-gods`'s `EntityA#tick()` originally tested its fade-entry branch with `this.state < 0`, reasoning from the "any other value" jmp target quoted at the top of this section. But in the port, `-2`/`-3` are already claimed by the pre-life `WAITING`/`MATERIALISING` sentinels (a value collision this document already flags two sections up — the original's own `-2`/`-3` mean dormant/reawaken, a different, unported mechanism), so a bare `state < 0` test is reached only *after* the port's own WAITING/MATERIALISING checks, which intercept `-2`/`-3` unconditionally regardless. Checked whether `combat.js` could ever hand the fade branch anything but `-1` for an already-alive entity: it can't — both `creatureScansGrid` (`if (killed) entity.state = -1;`) and `attackHero`'s own `strengthOut` (unchanged, or forced `-1`) mirror this document's own `[PROVEN]` finding under *The death path forces `BP` negative* (`CS:0xABA7 mov bp,0xffff`, reached from both the `js` and `jz` arms of the `<=0` test) — so `-1` is the only negative value the port's combat layer ever produces on a kill, on both entity systems. The port now tests `state === EST.DYING` (exact equality, matching `entity.js`'s own convention for System B) rather than `state < 0` — not a fix for a reachable bug, but a defense-in-depth tightening that keeps the branch honest if that forcing is ever relaxed.

### `UNKNOWN_sysA_0x16_refill` — CLOSED: a windup countdown, refilled by the attack and re-floored inside strategy 4 `[STATIC]`

`CS:0xE001`'s very first act is `DEC word[di+0x16]`, floored at `1` (`CS:0xE006`–`0xE00F`). A program-wide sweep for every instruction touching `[DI+0x16]` finds **13 hits**, and they split cleanly by which entity system actually owns them — a real trap, since System A and System B's entity records both happen to have live data at this same displacement:

| site | function | role |
|---|---|---|
| `E006`/`E009`/`E00F` | `FUN_1000_e001` (pipeline entry) | the generic per-tick decrement, floor `1` — already found |
| `E1CB`/`E20F`/`E233` | `FUN_1000_e199` (sprite resolver) | reads only — the already-documented animation-cadence divisor |
| `E379`/`E3B5` | `FUN_1000_e336` (stage 2) | reads only — the already-documented steering-step cap |
| **`E496`** | `FUN_1000_e487` (**stage 3**) | **`MOV word[di+0x16], 0xA`** — the REFILL: this is the already-documented attack/leap windup arm ("`[di+0x16] := 0xa`, a 10-tick windup") — so the field's real shape is a 10-tick countdown that re-arms on every successful attack and decays back down to a resting value of 1 between attacks, not a static per-class constant |
| `E7DB`/`E7E1` | `FUN_1000_e6e4` (**stage 1**, strategy-4/trail-follow handler) | `CMP word[di+0x16],2 / JGE / MOV word[di+0x16],2` — a **second, context-specific floor**: inside the trail-follow strategy specifically, the field is re-floored to `2` rather than `1` before use |
| `EE1E` | `FUN_1000_ee00` | ⚠️ **NOT the same field** — `FUN_1000_ee00` is this document's own already-documented **System-B** draw dispatcher (`"ee00 call 0x3569 ; alive -> draw"`), whose entity record is a different, `0x18`-stride struct. This hit is System B's own unrelated field at the same displacement. |
| `EFD2` | `FUN_1000_ef01` | ⚠️ Also **System B** — the already-documented steal-and-carry gate (`cmp byte[0x3cd],2`). Same caveat. |

So System A's own `+0x16` has exactly three write sites (the generic decrement/floor, the stage-3 windup refill, and stage 1's trail-follow-specific re-floor), all already independently attributable to documented mechanisms — the field was never actually "static," and the earlier framing undersold it.

### `UNKNOWN_eb37_purpose` — CLOSED: trail-follow LEADER ELECTION `[STATIC]`

Continuing `CS:0xEB37`'s weighted-pick branch (`CS:0xEB7F`–`0xEBB5`) past where it was left:

```
eb7f  cl = dl                        ; the picked member index (weighted draw, or the pre-selected [bp+0x11])
eb81  si = [0x294] + cl*0x28          ; the SELECTED entity's own record
eb8e  cmp word[si+8],0 / jz/js 0xebb5 ; must be genuinely alive — else give up silently
eb96  [si+0x19] = 1                   ; FORCE that entity's rank-1 stamp — the SAME field stage 1's organic reroll gate sets
eb9a  [bp+0x12] = 1                   ; the group's reroll-throttle counter forced to "exactly one winner"
eb9e  bx = 1 << cl ; [bp+0x14] = bx   ; the "rolled" bitmask forced to just that member's bit
ebaa  [bp+0x16] = 0                   ; reset — the SAME field CS:0xE039 (below) increments
ebaf  [bp+0xe0] = 0                   ; reset — the already-documented trail-follow circular-buffer cursor
```

And the pipeline's own tail, `CS:0xE039`, reveals the missing other half — it is the **direct consumer of the very fields `CS:0xEB37` just reset**:

```
e034  ax=[di] ; bx=[di+2]                      ; entity position, post-pipeline
e039  cmp byte[di+0x19],1 / jnz 0xe06e          ; the SAME rank-1 test the death-draw code and EBB9-call already document
e03f  inc word[bp+0x16] ; clamp at 0x64(100)    ; <-- the field EB37 zeroes
e04d  cx = [bp+0xe0]                            ; <-- the OTHER field EB37 zeroes; feeds the trail-buffer cursor logic
```

So `CS:0xEB37` is the **election mechanism for strategy 4's trail-follow leader**: it picks one group member (by weighted random draw using the same descriptor `+0xa` weight field stage 1's reroll gate reads, or by the pre-selected `[bp+0x11]` member from the materialise-time draw), stamps it to rank 1, and resets both the "how long has this entity been leader" counter (`[bp+0x16]`, capped at 100 ticks) and the trail circular-buffer's write cursor (`[bp+0xe0]`) so the conga-line starts fresh behind the newly-elected leader. `CS:0xE039` is that leadership-duration timer's own per-tick incrementer, running for as long as the elected entity holds rank 1.

**`[di+0x19]` therefore has two genuinely separate meanings layered on the same field**, both self-consistent with the bytes: (1) the organic, per-tick "reroll queue rank" this document's `UNKNOWN_sysA_field_0x19` closure already documents, which — at rank 1 — fires a synchronized whole-group strategy reset via `CS:0xEBB9` on that entity's own death; and (2) this election mechanism's "I am the trail-follow leader" flag, which a live rank-1 entity carries every tick it remains elected, driving the leadership-duration timer and (per this document's own existing strategy-4 note) the trail-buffer's per-member read offset. The two uses don't conflict operationally — a freshly-elected leader also happens to satisfy the death-path's "rank 1" test if it later dies — but they are two different subsystems reading the same byte for two different questions, and a port must reproduce both readings rather than picking one. **`UNKNOWN_bp_0x11_source` — CLOSED, exhaustively `[STATIC]`.** A program-wide `search_instructions` sweep for `[bp+0x11]` returns **exactly four hits in the whole image** — the complete set, not a sample:

| site | in | role |
|---|---|---|
| `CS:0xDEF1` | `FUN_1000_de7d` (materialise loop) | `MOV byte[BP+0x11], 0xFF` — the default, "no pre-selected member" |
| `CS:0xDF1E` | `FUN_1000_de7d` (materialise loop) | `MOV byte[BP+0x11], DL` — the bit-`0x100`-gated random member draw, already documented |
| `CS:0xE30D` | `FUN_1000_e2ec` (the dormant/reawaken handler) | `CMP CL, byte[BP+0x11]` — already documented: tests whether the reawakening slot is the pre-selected member, to decide whether to double its reborn state |
| `CS:0xEB55` | `FUN_1000_eb37` (the leader-election routine) | `MOV CL, byte[BP+0x11]` — already documented: the weighted-vs-preselected branch |

So there is no third reader and no other writer: `[bp+0x11]` is set exactly twice (materialise default, materialise random draw) and read exactly twice (the reawaken handler and the leader-election routine), both already fully documented above. `CS:0xEB37` **is** the only reader besides the reawaken handler — confirmed, not merely unrefuted.

### `UNKNOWN_sysA_ec12_zone_table` / `UNKNOWN_sysA_field_0x1a_consumer` — CLOSED negative: the zone code is write-only, dead `[STATIC, exhaustive]`

A program-wide `search_instructions` sweep for any instruction touching displacement `+0x1a` on `DI` finds **exactly one hit in the whole image**: `CS:0xDEC4`, inside the materialise loop `FUN_1000_de7d`, the very write this document already documents (`[di+0x1a] = al`, the zone code `CS:0xec12` computes at spawn time). **No instruction anywhere reads it.** So the `CS:0xec12` zone-classification table at `DS:0xd9d0` and the code that stamps its result onto every freshly-spawned System-A entity are both real and wired correctly, but the *consumer* this document's own ranked item asked about does not exist — the field is dead, in the same authoring-pattern family as `POBJECTS +0x02` and the `.DAT` atlas's `word2`.

**Stage 4 — `CS:0xe44d`, the speed clamp — is exactly the one-liner the ledger already had, confirmed to the byte:** `cap = sign_extend(descriptor[+0xb])`; clamp `[di+0x12]`/`[di+0x14]` independently to `[-cap, +cap]`. No surprises.

**Stage 5 — `CS:0xe42b`, apply position:**

```
e42b  cmp word [0x2fa],0 / jz e433 / ret         ; "freezes aliens" global — frozen entities don't move at all
e433  cmp byte [di+0x25],0 / jz e447
e439  [di] = [di+0x1c] ; [di+2] = [di+0x1e]      ; FINE-arrival flag set -> SNAP straight to the goal, ignore velocity
e447  [di] += cx ; [di+2] += dx                   ; else: apply velocity — but CX/DX are NOT reloaded from memory
e44c  ret
```

⚠️ **Stage 5 reads CX/DX left over from stage 4's own tail, not `[di+0x12]`/`[di+0x14]` freshly.** Stage 4 ends `mov [di+0x12],cx / mov [di+0x14],dx / ret`, and stage 5 is called immediately after with those same registers still loaded — a register-passing contract between two "independent" pipeline stages. It produces the identical numeric result to re-reading memory (stage 4 just wrote those exact values), so it is not a functional trap for a port that re-reads memory instead — but it is worth recording, because a port that reorders or interleaves the stages differently than the original's straight-line `CALL e336 / CALL e487 / CALL e44d / CALL e42b / CALL e659` would still need stage 5 to use stage 4's *output*, not some other snapshot of velocity.

**Stage 6 — `CS:0xe659`, facing AND the shared enemy-shot emitter, fully decoded — this also completes the "five other emitter-pair owners" entry for `CS:0xE659` written earlier this session, which had only the gating logic, not the full body:**

```
e659  al = [si+0x6] ; or al,al / jz e6be           ; descriptor +0x6 == 0 -> no fire capability at all, skip
e664  bl = al                                        ; bl = the FULL byte (both nibbles)
e666  al &= 0xf ; jz e6be                            ; low nibble == 0 -> also skip
e66b  dec word [di+0xe] / jnz e6be                   ; entity's OWN reload timer [di+0xe] — per-entity, not per-group
e670  cl = 0x10 - al ; cx <<= 2 ; [di+0xe] = cx       ; reseed: (16 - loNibble(desc[+6])) << 2 ticks
e67d  cx = [si+0x4] ; BE->native ; cx = (cx>>4)&3     ; descriptor +0x4 bits [5:4] of the native word
e68d  jz e692 / jmp e5e4                              ; nonzero -> DIVERT to CS:0xe5e4, the alternate/unread attack path
e692  bx = (bl & 0xf0) >> 4                           ; the HIGH nibble of descriptor+0x6 -> the "direction/config" value
e69e  cmp byte [0x3c2],0 / js e6d4                    ; System B (0x3c2 negative) -> e6d4; System A falls through
        ; --- System A path ---
e6a5  cmp word [di+0x12],0 / jz e6be                  ; entity's own velocity X == 0 -> don't fire
e6ab  jns e6c3                                        ; velocity positive -> RIGHT branch (e6c3)
e6ad  bx = -bx ; [0x206] = bx                          ; velocity negative -> negate direction, LEFT
e6b3  ax=[di] ; bx=[di+2] ; ax -= 8                    ; muzzle = (entityX - 8, entityY)
e6bb  call 0x1fe7                                      ; the shared LEFT emitter
e6be  ret
e6c3  [0x206] = bx                                     ; RIGHT: direction unchanged
e6c7  ax=[di] ; bx=[di+2] ; ax += 0x20                 ; muzzle = (entityX + 32, entityY)
e6cf  call 0x2039                                      ; the shared RIGHT emitter
        ; --- System B path ---
e6d4  cx = [di+0xa]                                    ; System B's movement-mode field
e6d7  ax = [0xd95a] ; ax >>= cl ; test ax,1             ; the mode-bit constant, already documented
e6df  jnz e6ad (LEFT) / jmp e6c3 (RIGHT)               ; feeds the SAME e6ad/e6c3 branches System A uses
```

Confirms and sharpens the earlier "five other emitter-pair owners" entry for this address: System A's facing test is the **sign of its own stage-2 velocity `[di+0x12]`** (zero means don't fire at all — an entity that has arrived and decayed to zero velocity stops shooting), muzzle offsets are **exactly `-8`/`+32`** relative to entity X, and the reload timer this generic path uses (`[di+0xe]`) is a **per-entity** field distinct from the group-descriptor/runtime fields the other four emitter-pair owners use. `descriptor[+0x4]` doing double duty — BE flag word, bit `0x100` read at spawn (below) for random group-member selection, AND bits `[5:4]` read every tick here to gate the attack divert — is new.

**`CS:0xe199`, the System-A sprite resolver, read in full (the earlier pass only had its call site and its bytes-`[si]` table lookup):**

```
e199  cl = [si+0x7] ; si = [0x1fe] + cl*12           ; class table lookup, same +0x7 offset System B uses
e1ad  cx = [si]                                        ; the class's sprite base
e1b0  cmp cx,0x1f0 (496) / jz e200                      ; SPECIAL sprite base 496
e1b6  cmp cx,0x1e6 (486) / jz e21d                      ; SPECIAL sprite base 486
        ; --- DEFAULT case ---
e1bc  dec byte [di+0x26] / jns e1d5                     ; animation reseed timer — skip if still counting
e1c1  inc word [di+0x4] ; and word [di+0x4],3           ; frame cycles 0..3 (4 frames)
e1c8  dx = 10 - [di+0x16] ; dx >>= 2 ; [di+0x26] = dl    ; reseed rate: faster entities ([di+0x16] high) animate faster
e1d5  dx = [di+0x4]                                     ; current frame
e1d8  cmp byte [0x42],2 / jge e1f4                      ; world >= 2 ?
        ; world < 2:
e1df  si = 0xdf78 + dx*2 ; cx += [si]                    ; frame -> SPRITE OFFSET via a lookup table, not added directly
e1ea  cmp byte [di+0x27],0 / jnz e1f3 / cx += 3 / ret    ; facing flag clear -> +3
        ; world >= 2:
e1f4  cx += dx                                          ; frame added DIRECTLY (no lookup table)
e1f6  cmp byte [di+0x27],0 / jnz e1f3 / cx += 4 / ret    ; facing flag clear -> +4 (DIFFERENT offset than world<2!)
        ; --- SPECIAL case, base 496 (0x1f0) ---
e200  dec byte [di+0x26] / jns e219
e205  inc word [di+0x4] ; and word [di+0x4],7            ; frame cycles 0..7 (8 frames)
        ... same reseed ...
e219  cx += [di+0x4] ; ret                                ; NO facing offset at all — symmetric sprite
        ; --- SPECIAL case, base 486 (0x1e6) ---
e21d  dec byte [di+0x26] / jns e23d
e222  inc word [di+0x4] ; cmp 6 / jl / else = 0            ; frame cycles 0..5 (6 frames, NOT a power-of-2 mask)
        ... same reseed ...
e23d  cx += [di+0x4] ; ret                                ; also NO facing offset
```

Two traps for a port: (1) **the world<2 default case indexes a lookup table `DS:0xdf78` by frame instead of adding the frame directly.** `UNKNOWN_sysA_df78_table` — **CLOSED**: read live (DOSBox), the table is exactly **4 words: `{0, 1, 2, 1}`** — the identical 3-unique-frame ping-pong shape this document finds everywhere else in this game's idle animations (matching, e.g., the world-1 statue's own `DS:0xdf68` table). So the "lookup" isn't remapping to anything exotic — it just turns a linear `0..3` frame counter into the game's standard `0,1,2,1` ping-pong cycle, the same way a dedicated ping-pong counter does elsewhere; this table is simply a data-driven version of that pattern. Distinct from the already-documented `DS:0xef78` POBJECTS category table one digit off in address; getting the two confused would silently substitute object-category bytes for animation-frame sprite offsets. (2) **the facing-offset constant differs by world** (+3 under world<2, +4 under world>=2) even though both use the same `[di+0x27]` gate — collapsing them to one constant draws the wrong frame in exactly one world tier. The two special sprite bases (496, 486) have longer, non-power-of-two-safe cycles (8 and 6 frames) and — because they carry no facing offset — are presumably symmetric sprites (e.g. a stationary turret or blob) that don't need a left/right distinction. Animation cadence is shared across all three cases: `(10 - [di+0x16]) >> 2` ticks between frame advances, tying the same field to steering budget (stage 2), attack-speed clamp (stage 3, already documented), AND animation speed.

### System A's own materialise/spawn loop — `CS:0xde42`–`0xdf37`, previously unlocated `[PROVEN]`

The activator `CS:0xde42` was already documented as "byte-for-byte the System-A twin of B's `CS:0xde08`" — that comparison is now direct, not inferred: disassembled in full, it is `mov [si],0xffff` (consume first) / `param = [si+2]` / `si = 0x9d60 + param*0x16` / walk 10 runtime slots at `SS:0x3768+n*0xe4` for a free one (`[bp+0]==0`) / `[bp+0]=2` (busy) / `[bp+2]=si` (save descriptor). Identical shape to `0xde08`, confirmed rather than assumed.

**Immediately following it, `0xde6f`–`0xde7c` is the group-runtime CLEAR routine** (10 slots × `0xe4` = `0x8e8` = 2280 bytes, `rep`-equivalent `stosb` loop, zeroing every byte) — the twin of a step this document's System-B tables already implied but had not located for System A specifically.

**And immediately after THAT, `0xde7d`–`0xdf37` is System A's own materialise/spawn loop — structurally parallel to System B's `CS:0xec60`–`0xed38` (same `desc[+0x12]` byte-pair decode: `X = byte0*32, Y = byte1*16`, the identical `shl x5`/`shl x4`/`and 0xffe0`/`and 0xfff0` sequence) but NOT the same code, and with real behavioral differences a port must not merge:**

```
de7d  si = [bp+2]                    ; the descriptor (passed from the activator's slot)
de80  cl = [si] ; count
de84  or cl,cl / jnz de8b / jmp df62  ; count==0 -> the runtime slot is NOT freed (System B's exact idiom, confirmed here for A)
de8b  loop entry, dx := 0 (dx will become the per-entity STAGGER index)
de8d  ax = [si+0x12] ; BE->native byte pair -> X = byte0*32, Y = byte1*16   ; same decode as System B's spawn
deb2  [di] = X ; [di+2] = Y
deb7  [di+0x1c] = X ; [di+0x1e] = Y   ; **System A ALSO seeds the GOAL to the spawn point** — System B's loop does not do this
debf  call 0xec12                     ; a NEW routine (below) -> AL = 0..7
dec4  [di+0x1a] = al                  ; spawn-zone code, from ec12
dec7  [di+4] = 0                      ; frame := 0
decc  [di+0x26] = 2 ; [di+0x27] = 0   ; anim-reseed timer, facing flag — both zeroed/seeded fresh
ded4  [di+0x8] = 0xfffe                ; "waiting" sentinel — IDENTICAL to System B's own [di+0x8]=0xfffe convention
ded9  [di+0x6] = dx                    ; per-entity STAGGER = the loop's own dx counter (0, 1, 2, ... one per entity)
dedc  or dx,dx / jnz dee3
dee0  call 0xff59                      ; ONLY for the FIRST entity of the group (dx==0) — see below
dee3  callf [0x52ea]                   ; graphics EXPORT 38 — "the entity/object initialiser" — confirmed called here, once per spawned entity
dee8  loop de8d                        ; next entity (cl counts down)
deea  dec word [bp+0]                  ; group-runtime state: 2 (materialising) -> 1 (active) after the full batch
deed  [bp+0x10] = 0 ; [bp+0x11] = 0xff ; two group-runtime fields reset
def5  ax = [si+0x4] ; BE->native ; test ax,0x100 / jz df21
        ; bit 0x100 of descriptor+0x4 SET:
deff  cl = [si] (entity count) ; call 0x3836 (the RANDOM draw)
df07  bucket-pick: divide 0xFFFF by count, walk cumulative buckets against the random draw
df1e  [bp+0x11] = dl                   ; OVERWRITES the 0xff above with a 0..count-1 "which member" index
df21  [bp+0x12] = 0 ; [bp+0x14] = 0 ; [bp+0xe2] = 0   ; further group-runtime resets
df2f  al = [si+0xe]                    ; descriptor +0xe — a field NOT documented for System A before this pass
df34  [bp+0x6] = zero_extend(al)       ; group-runtime +0x6 := descriptor +0xe
df37  jmp df62                          ; done
```

**Three things worth carrying into a port, none of them shared with System B's loop:**

1. **System A seeds the entity's goal to its own spawn point** (`[di+0x1c]/[di+0x1e] = [di]/[di+2]`), so before stage 1's strategy dispatch ever runs, a freshly spawned entity's stage-2 accelerate call sees itself as already "arrived" — consistent with `[di+0x1b]` (coarse arrival) being expected to read true immediately on spawn.
2. **`CS:0xec12` is a NEW routine**, not the strategy-1 weighted search the ranked-list item's prose implied it might be part of (`"the deepest-undecoded piece ... 0xec12, 0xeaf7, 0xeb1a unread"` — that framing is corrected here, at least for `0xec12`: it is read in full below and is unrelated to strategy 1's scratch-slot search). It probes the entity's own screen position (and screen position + 32 on both axes) against a **7-entry, 8-byte `{loX, loY, hiX, hiY}` table at `DS:0xd9d0`**, returning `0` (no match) or `1..7` (which entry matched, in table order) into `[di+0x1a]` — a spawn-time "zone" code whose consumer is not traced past this write. `UNKNOWN_sysA_ec12_zone_table` / `UNKNOWN_sysA_field_0x1a_consumer`.
3. **Descriptor `+0x4` bit `0x100` gates a random "which group member am I" draw** using the shared random-table reader `CS:0x3836` and a cumulative-bucket walk over `0xFFFF/count`-sized shares — written into group-runtime `+0x11`, overwriting a `0xFF` default. This parallels the doc's already-documented System-B `+0x4`/`+0x5` "bit 9 = initial facing" field, but here the SAME field position is read for a completely different purpose (member selection, not facing) — a port must not assume the two systems' BE flag words share a schema despite the identical byte offset.
4. **A new descriptor field, `+0xe`**, is copied verbatim into group-runtime `+0x6` at the end of every materialise pass. `UNKNOWN_sysA_descriptor_0e` — **CLOSED negative `[STATIC, exhaustive]`**: a program-wide sweep of every `[BP + 0x6]` instruction finds seven hits, and the other six are all local-stack-frame reads (`BP` as a plain function frame pointer) inside unrelated functions with no connection to the System-A group-runtime array — none of the pipeline stages, the master group loop, or `FUN_1000_eb37`/`e2ec` ever read group-runtime `+0x6`. It is write-only, the same dead-field pattern this document already establishes for `POBJECTS +0x2`, the `.DAT` atlas's `word2`, and System A's own entity `+0x1a`.
5. **`CS:0xff59` runs exactly once per group activation** (only when the per-entity stagger counter is still 0, i.e. only for the group's first entity). `UNKNOWN_sysA_ff59` — **CLOSED**: it is a self-contained **"spawn flash" one-shot visual effect**, not entity logic. It plays sfx `0x46` unconditionally, then allocates into a **previously-uncatalogued 10-slot × 6-byte pool at `DS:0xac90`** (sitting immediately before, and structurally a sibling of, the world-1 statue hazard array at `DS:0xaccc` this document documents elsewhere — allocator `CS:0xb0da`, clear `CS:0xb0c3`, walker `CS:0xb0ef` called from the main loop at `CS:0x028E`), seeding `{entityWorldX, entityWorldY, state=7}` at the triggering entity's own spawn position. The walker (gated on a shared "any active" flag `DS:0x1f6`, the same auto-disarm-when-empty pattern this document documents for several other pools) draws sprite `100 + state` via the shared entity blitter `CS:0x3569` and decrements `state` once per tick, freeing the slot once it goes negative — **an 8-frame (sprites 100–107), one-shot flash animation** at the spawn point, no physics, no collision, purely decorative. `CS:0xff59` also writes `[di+6]=5`, `[di+8]=0xFFFD` (−3) and the shared gate `DS:0x1f6=1` onto the *triggering* entity itself.

### `UNKNOWN_sysA_spawn_flash_entity_fields` — CLOSED: the flash also holds its OWN entity dormant for 5 ticks `[STATIC]`

Those three writes are `CS:0xFF7F`–`0xFF8A`, the tail of `CS:0xFF59` (now read in full): `[di+6] := 5` then, two instructions later, `[di+8] := 0xFFFD` (−3). Cross-referencing this session's own `UNKNOWN_sysA_dormant_respawn` closure, **this is a direct producer of the dormant/reawaken state**: the entity that triggers the spawn flash (the group's first-materialised member) is immediately parked in state `−3` with its dormant countdown seeded at `5`. So the decorative flash and the gameplay delay are the same event: the group's leader doesn't just get a visual flourish, it is genuinely held out of action for 5 ticks — reawakening afterward with a fresh state pulled from the group descriptor's own `+0x1` byte, per the `FUN_1000_e2ec` reawaken arm already documented. The flash is the *visible* half of a staggered, delayed group entrance.

⚠️ **A tension that looked unresolved until the materialise loop's own OTHER half was re-read: it dissolves completely — "waiting" (`−2`/`0xFFFE`) and this dormant state are the SAME value on purpose.** `FUN_1000_e2ec`'s first test, `cmp word[di+8],-2`, is bit-identical to the "waiting" sentinel every materialised entity starts at, and the outer per-entity loop routes *any* negative `[di+8]` into `FUN_1000_e2ec` — so a freshly-materialised entity genuinely does enter the `−2` arm (`CS:0xE31A`: `dec word[di+6] / jz → CALL 0xFF59`) on its very first visit. The apparent problem was entity 0: materialise seeds `[di+6]` to the entity's own index (`0, 1, 2, …`), and a bare `DEC`-then-`JZ` starting from `0` underflows to `0xFFFF` without ever hitting zero again for 65535 ticks.

**Entity 0 never actually takes that path, because the materialise loop itself already special-cases it.** This document's own materialise-loop transcript (*System A's own materialise/spawn loop*, above) has the answer in plain sight: `dedc or dx,dx / jnz dee3 / dee0 call 0xff59` — `CS:0xFF59` is called **synchronously, at materialise time**, for exactly the entity whose stagger index is `0`, immediately after `[di+8]` is set to `0xFFFE`. Inside that call, `CS:0xFF8A` overwrites it again to `0xFFFD`(−3) before the entity is ever visited by the per-tick loop at all — so entity 0 passes through "waiting" for zero ticks, never reaching `FUN_1000_e2ec`'s `−2` arm in any state where the stagger decrement matters.

**Entities `1..N−1` are the ones that legitimately ride the `−2` arm**, and it works exactly as a stagger should: entity `k` (stagger `= k`) decrements once per tick it spends "waiting," and `CS:0xE322`'s own `CALL 0x1000:ff59` fires — for that entity, from the per-tick path this time rather than materialise — the instant its own countdown reaches zero, `k` ticks after the group activated. So **every entity in a freshly-materialised group eventually gets its own flash-and-5-tick-dormancy, staggered by its own materialise-time index**: entity 0 immediately (synchronously, no visible "waiting" frame at all), entity 1 after one tick, entity 2 after two, and so on — a visibly staggered group entrance, not a single leader flashing while its siblings pop in instantly. `UNKNOWN_sysA_waiting_vs_dormant_overlap` is **closed**: the two states share one value *because* the transition from "waiting" to "dormant-then-active" is the same event for every entity in the group, just reached by two different call sites (materialise-time for entity 0, the per-tick loop for everyone else).

### `UNKNOWN_sysA_dormant_respawn` — CLOSED: states −2/−3 are a delayed reawaken, distinct from ordinary dying `[STATIC]`

Reading `FUN_1000_e2ec` (reached from the master loop, `CS:0xDF98 jmp 0xe2ec`, whenever `[di+8] < 0`) in full rather than just its already-documented `<= −4` fallthrough:

```
e2ec  cmp word[di+8],-2 / jz 0xe31a        ; state == -2 -> the FLASH arm
e2f2  cmp word[di+8],-3 / jz 0xe2fb        ; state == -3 -> the REAWAKEN arm
e2f8  jmp 0xe247                           ; ANY OTHER value -> the ordinary death draw — see the correction below

; state == -3, REAWAKEN:
e2fb  dec word[di+6] / jz 0xe303           ; a countdown at +0x6 — ticks down, does nothing while nonzero
e303  al = [si+1]                          ; SI is still the GROUP DESCRIPTOR — reads its own +0x1 byte
e308  cl = ss:[0x435]                      ; the outer loop's own per-slot counter (this entity's index within the group)
e30d  cmp cl,[bp+0x11] / jnz 0xe314        ; is THIS the group's pre-selected member (the same field CS:0xEB37 elects)?
e312    shl ax,1                           ;   if so, DOUBLE the descriptor byte
e314  [di+8] = ax                          ; either way, this becomes the entity's NEW state — reactivating it

; state == -2, FLASH:
e31a  dec word[di+6] / jz 0xe322           ; the SAME countdown field, same shape
e322    call 0x1000:ff59                    ; the already-documented "spawn flash" one-shot visual (UNKNOWN_sysA_ff59)
```

So this closes two of the three previously-"unresolved" fields in one pass: **`+0x6` is a dormant/reawaken countdown**, reused identically by both special states, and **`+0x8` (state) has a THIRD region beyond "positive=alive" and "≤−4=ordinary dying"**: `−2` and `−3` are a genuine **delayed-respawn mechanism** — an entity is parked dormant for `[di+6]` ticks, then either (`−2`) plays the spawn-flash effect again or (`−3`) is reactivated outright, with its fresh state value pulled from the group descriptor's own `+0x1` byte — **doubled specifically for the group's pre-selected member** (`[bp+0x11]`, the same materialise-time random draw `CS:0xEB37`'s leader-election reads).

`UNKNOWN_sysA_0x8_states_-2/-3_producer` — **CLOSED.** `−3`'s producer is `CS:0xFF59` (the spawn-flash routine, above — see *`UNKNOWN_sysA_spawn_flash_entity_fields` — CLOSED*), which writes `[di+8]=0xFFFD`(−3) and `[di+6]=5` onto whichever entity's stagger countdown just reached zero. `−2` has no *distinct* producer, and that closure — see the same section, *`UNKNOWN_sysA_waiting_vs_dormant_overlap` — CLOSED* — is the point: `−2` and `0xFFFE`("waiting") are deliberately the same value, because the ordinary post-materialise "waiting" state *is* the dormant countdown's starting point for every entity but the group's first. `UNKNOWN_descriptor_0x1` — **narrowed by a shipped-data census, not fully proven.** Reading the raw byte directly across all live System-A descriptors in all 8 `PALFILS` files (74 records): values are `{5, 8, 10, 20, 25, 30, 40, 50}` — always a multiple of 5, ranging 5–50, one value per world tier (world 1: mostly 5–10; world 4: mostly 30–50). That range and shape is a plausible fit for a **per-entity hit-point/strength value** reborn into `[di+8]` on reawaken — matching the documented pattern for both System B's own descriptor (`+0x1` = hit points per entity) and the `DS:0xce64` creature's `+4` "hp/strength" field — and the doubling for the group's elected member would then read as "the leader reawakens tougher than its followers." This is inferred from the value range and the doubling behaviour alone, **not confirmed by tracing any code that consumes the reawoken `[di+8]` as HP** (e.g. via the shared damage-grid/contact thunk `CS:0xA9E4`, which this document already documents round-tripping a `BP`-held strength value for other entity types) — that trace was not run this pass.

⚠️⚠️ **CORRECTION, a later session — the third arm's own condition, re-verified.** The transcript directly above already labels the third arm "ANY OTHER value" rather than repeating the framing this closure originally shipped with, and that correction is the substance of this note: an earlier revision of this document read `e2f8 jmp 0xe247` as gated on `state <= -4`, which the bytes do not support. `CS:0xE2EC`–`0xE2F8` is exactly two `CMP`/`JZ` pairs (against `-2`, then `-3`) followed by a bare, **unconditional** `JMP` — there is no third comparison and no lower bound anywhere in this span. So the real rule is: **any state that is not exactly `-2` or `-3` falls through to `CS:0xE247`**, `-1` included — `state <= -4` merely describes the *shipped* case, since `-1` (ordinary post-contact death, `CS:0xFFBF`) and the pre-life sentinels (`WAITING`/`MATERIALISING`, `-2`/`-3`) are the only states this project's own port ever produces for `[di+8]`, and the port's own dispatch order (checking `WAITING`/`MATERIALISING` by exact equality first, matching `-2`/`-3` here) means every OTHER state — `-1` included — reaches the death-fade branch, exactly as `CS:0xE2EC` does. `src/game/entity-a.js` implements this as `if (this.state < 0)` gated *after* the two exact-equality pre-life checks, which is the literal shape of `CS:0xE2EC` itself, not an approximation of it.

### System A's own death-fade — `CS:0xE247`–`0xE2EC`, the full routine, decoded and PORTED `[PROVEN]`

The `jmp 0xe247` arm above lands here, and the routine turns out to differ from System B's own fade (`CS:0xF030`, `UNKNOWN_creature_death_anim`) in three concrete, easy-to-transpose-wrong ways. Full disassembly, `1000:e247`–`1000:e2eb` (165 bytes):

```
e247  inc word[0x1f4]                      ; per-group dying tally, CS:0xDFAC's own field
e24b  cmp word[di+4],0 / jns 0xe2ac        ; ONE-SHOT gate: skip everything below once frame >= 0
e251  ax=[di] / [0x202]=ax                  ; cache X — NO bias (contrast System B's own CS:0xED84 `ax += 8`)
e256  ax=[di+2] / [0x204]=ax                ; cache Y — NO bias either
e25c  cmp word[di+0x10],0 / js 0xe283       ; carried-item type: negative = carrying nothing -> skip the drop
e262  cx=[di+0x10]
e265  cmp cx,0xc0 / jge 0xe270
e26b    add cx,0xb                          ; ordinary POBJECTS type: +0xB bias (CS:0xBF5F's own id>=0xB convention)
e26e    jmp 0xe274
e270    sub cx,0xc0                         ; weapon index: -0xC0 bias
e274  ax=[di+0x20] / bx=[di+0x22]           ; the CARRIED ICON's own (eased) position — NOT the entity's own x/y
e27d  call 0x1000:bf5f                      ; popup.spawn(ax, bx, cx) — the shared floating-item-icon popup
e283  cmp byte[di+0x19],0 / jz 0xe2ac       ; the [di+0x19] rank check — see fineGate's own header, unreachable in this port
e289  al=[di+0x19] / cbw / cmp ax,1 / jnz 0xe297
e292    call 0x1000:ebb9 / jmp 0xe2ac       ; rank == 1 -> synchronized whole-group strategy reset
e297    dec byte[bp+0x12]                    ; rank != 0,1 -> give the group's own throttle slot back
        ... bitmask clear ...
e2a9    call 0x1000:ebe5                     ; a further group-wide rank scan
e2ac  inc word[di+4]                        ; frame++, UNCONDITIONAL
e2af  cmp word[di+4],0x11 / jl 0xe2c2       ; frame < 17(0x11) -> draw (e2c2); else finalize
e2b5    mov word[di+8],0                     ; state := FREE
e2ba    mov word[di+6],0                     ; the dormant-countdown field, also cleared
e2bf    jmp 0xdfa2                           ; back to the outer per-entity loop tail — NO draw this tick
e2c2  ax=[di] / bx=[di+2] / ax-=[0xa] / bx-=[0xc]   ; world -> screen
e2cf  cx=[di+4] / cx += 0x5b                 ; sprite = frame + 0x5B(91) — a FLAT constant, not a class lookup
e2d5  [0x4]=ax / [0x6]=bx / [0x8]=cx
e2e3  call 0x1000:3569                       ; draw — the SAME shared blitter every entity in this game uses
e2e9  jmp 0xdfa2
```

Three divergences from System B's own fade, all now ported in `src/game/entity-a.js`:

- **`DEATH_FRAMES_A = 17` (`0x11`), not System B's `7`.** `cmp word[di+4],0x11` at `e2af`, closing at frame `17` rather than `7`.
- **The fade sprite base is `0x5B` (91), not System B's `0x6C` (108).** `cx += 0x5b` at `e2d2`, a flat add with no class-table lookup — the same "flat constant" shape as System B's own `0x6c`, just a different constant.
- **The one-shot position cache has NO bias at write time.** `e251`/`e256` are bare `mov`s — contrast System B's own `CS:0xED84`, which adds `+8` to X before storing. This project's own group-elimination-reward closure above (`UNKNOWN_sysA_0x1f4_elimination_detector`) already establishes where System A's own `+8` bias actually lives instead: `dfc8`'s own read site, applied to **both** axes, not System B's X-only convention. A port that bakes the bias into the write-time cache (mirroring System B) either double-applies it or applies it on the wrong axis.

**One piece of this routine is intentionally NOT ported, an already-disclosed gap; the other — the carried-item drop — is now CLOSED for System A, see *Steal-and-carry, System A — CLOSED* below:**
- ~~The carried-item drop (`e25c`–`e282`) needs a `carriedType` field...~~ **CLOSED.** `EntityA` now carries `carriedType`/`carriedX`/`carriedY`, and the DYING branch's `frame === -1` one-shot records `deathDropId`/`deathDropX`/`deathDropY` from them (mirroring `e25c`–`0xe27d`'s own `+0xB`/`-0xC0` id bias) for `main.js` to hand to `popup.spawn` — see the new section below for the full decode-to-port mapping.
- The `[di+0x19]` rank-check (`e283`–`e2a9`, `CALL 0x1000:ebb9`/`0x1000:ebe5`) is gated on a field (`fineGate`, `EntityA`'s own `+0x19`) this port never sets nonzero, because the reroll-throttle mechanism that would set it (`CS:0xE72D`, inside stage 1's strategy-reroll gate) is itself unported — see `entity-a.js`'s own header note on `stageAccelerate`. Provably unreachable in this port; not implemented. This is unchanged by the steal-and-carry work below — a `+0x19` of 0 also means `CS:0xE283`'s own rank check never took the `CS:0xEBB9` synchronized-reset arm, so the death-time drop still fires exactly on the disclosed `frame === -1` tick regardless.

### Steal-and-carry, System A — CLOSED end to end (port + tests) `[PROVEN]`

The mechanism itself — `CS:0xE88C`/`0xE90E`/`0xE99F`/`0xE0C1`-`0xE198`/`0xE25C`-`0xE282`/`0xC041`, and its System-B mirror `CS:0xEF01`/`0xEFA2`/`0xEEBA` — was already fully decoded in the *`CS:0xE99F`/`CS:0xEFA2`* section above and in *`UNKNOWN_eeba_class_offsets`*. This section records that **System A's half is now ported end to end into `re-gods`, tested, and verified**; System B's own mirror remains disclosed-but-unported (see the *Next: System B* note at the end).

**Scope, per an `advisor()` review at the start of that pass: System A only.** System B's own theft gate depends on `DS:0x3cd`, a genuine System-B-only global whose writer has never been located in this port (`CS:0xEF01`'s own `cmp byte[0x3cd],2 / jnz ret` reads it, but no write site has been traced) — porting System B's mirror needs that writer found first, not a guessed substitute. Not attempted this pass.

**`objects.js` — `dropCarriedItem(slots, id, x, y)`**, added immediately after `insertSpawned`. This is `CS:0xC041`-`0xC08C`'s own shared "drop a real object back into the world" primitive, built on the already-existing `allocObject` (`CS:0x38D7`) allocator:
```
CS:0xC041  bp := allocObject(...)      ; CS:0x38D7 — first-fit dead-slot reuse
CS:0xC04B  jns 0xc051 / jmp 0xbf7f     ; allocator failed (no free slot) -> silent no-op
CS:0xC051  type = id < 0xB ? id + 0xC0 : id - 0xB     ; the SAME id encoding both callers below construct
CS:0xC060  slot.x = x ; slot.y = y ; slot.type = type
CS:0xC06E  slot.flag6 = 1                              ; immediately collectable/on-screen
           SS:0x438+idx := 0xFF                        ; objects.js's `fallDirty` — arms the fall/bounce state machine
```
Returns `null` on an exhausted object pool (`allocObject` returning `null`), matching the original's own silent-no-op-on-failure shape exactly.

**`popup.js` — the busy-slot divert, `CS:0xBF6B`, closed.** `Popup.spawn(worldX, worldY, id, objects)` gained an optional 4th parameter: a second `spawn()` call while the single popup slot is already busy now diverts to `dropCarriedItem` (matching `CS:0xBF6B`'s own `jmp 0xc041`) when `objects` is supplied, instead of silently losing the request as it did before this pass. Every pre-existing caller that doesn't pass `objects` keeps the old behaviour untouched. All three pre-existing group-reward `popup.spawn(...)` call sites in `main.js` (System B, System A, selector-2) were updated to pass `level.drawObjects`, activating the divert universally rather than only for the new steal-and-carry call site.

**`entity-a.js` — the theft, carry, and periodic drop.** New constructor fields `carriedType`/`carriedX`/`carriedY` (System A's `[di+0x10]`/`[di+0x20]`/`[di+0x22]`) and `deathDropId`/`deathDropX`/`deathDropY` (port-level bookkeeping — `tick()` has no popup-instance reference of its own, so the death-time drop's `CS:0xE27D call 0x1000:bf5f` is recorded for `main.js` to act on, the same pattern `strategy2`'s `objects` parameter already uses for the live-carry side).

- **`strategy2`** (`CS:0xE88C`) rewritten: bails immediately if already carrying (`entity.carriedType >= 0`, matching `js e89c`'s own carrying-bail — the *degenerate redirect* this project's own header comment on `strategy2` already discloses as a simplification, independent of and unaffected by this pass), otherwise sets the goal from a random marker as before and then calls `stealAttempt` when an `objects` array is supplied.
- **`stealAttempt`** (`CS:0xE90E`) and **`searchAndSteal`** (`CS:0xE99F`) are new exports: a 48×48 proximity+eligibility walk over the marker list (capped at `MARKER_MAX`, matching the original's own 20-entry clamp) followed by a backward, exact-`{type,x,y}`-match walk of the 200-slot object array that kills the matched object and records it as carried.
- **`stealFlagBits`** decodes the group descriptor's `+0x4` BE flag word as `flags & 3` for ordinary types or `(flags >> 2) & 3` for weapons (`type >= 0xC0`) — a **third**, independent 2-bit slice of that word, alongside `stageFacingAndFire`'s own `attackBits = (flags>>4)&3` and the (differently-sliced) periodic-drop test below. All three must stay distinct; do not "normalize" them into one shared accessor.
- **`stepCarriedItem`** (`CS:0xE0C1`-`0xE198`) is a new export, called once per carrying entity per tick from `main.js` alongside `tick()` rather than folded into the pipeline itself — the drop mutates the shared object array, a side-effect channel `tick()` doesn't otherwise have. Eases `carriedX`/`carriedY` halfway toward `(entity.x+8, entity.y+24)` via an arithmetic right shift (matching `CS:0xE0C1`-`0xE0E8`'s own `SAR`, which floors toward −infinity on a negative delta — not a truncating `/2`) every tick regardless of the drop roll, then tests the periodic-drop condition: ordinary items read the LITERAL UNSHIFTED `flags & 3` (0 → drop now, 2 → never, else a 1-in-128 roll), weapons read `flags & 0xC` against 0/8 the same way. ⚠️ **This is NOT the same bit-slice as `stealFlagBits` above**, despite both reading 2 bits out of the same word for a weapon-vs-ordinary split — `stealFlagBits`'s weapon read is `(flags>>2)&3` (shifted), the drop-roll's weapon read is `flags&0xC` (unshifted mask). Conflating the two changes which descriptor bits gate theft-eligibility versus carry-retention.
- The DYING branch's `frame === -1` one-shot block now also records `deathDropId`/`deathDropX`/`deathDropY` (`CS:0xE25C`-`0xE27D`'s own id bias: `+0xB` ordinary, `-0xC0` weapon) and clears `carriedType`, mirroring the original's own "drop through the popup system, not through `dropCarriedItem`" asymmetry — a real, disclosed divergence between the two drop paths (periodic vs. death-time), not a simplification.

**`main.js` — wiring.** `level.drawObjects` (this port's live 200-slot-equivalent runtime object array) now threads through to `e.tick(...)`'s 8th parameter (`objects`), and the `enemiesA` per-tick loop gained: a `dropCarriedIntoWorld(id, x, y)` closure calling `dropCarriedItem` and re-inserting the result via `insertSpawned` for correct draw-order (mirroring the file's own pre-existing `fr.loot.settled` re-rank pattern, since this port sorts once at load rather than per-frame like the original's export 32); a call to `stepCarriedItem` for every still-alive entity, feeding a periodic drop into `dropCarriedIntoWorld`; and a drain of `deathDropId`, handed to `popup.spawn(..., level.drawObjects)` so the busy-slot divert is live for this call site too.

⚠️ **Superseded, `[PROVEN]` live (`PJOYL3` 736, `DS:0x398` = 5): weapons DO append markers.** `CS:0x15F5` routes type ≥ `0xC0` to `CS:0x1DA0`, which appends `(x, y, type)` with no category test, so the weapon branches below are reachable. The marker list is also rebuilt on every tick; see `docs/entity-ai-pathfinding.md`.

**Marker-weapon unreachability, disclosed at every relevant site rather than silently assumed.** `markers.js`'s own `stepMarkers` explicitly filters `o.type >= 0xC0` at the marker-production stage (its own header, `CS:0x15F5`) — the port's only marker producer. So the weapon branches of `stealFlagBits`, `stepCarriedItem`'s drop test, and `dropCarriedItem`'s id decode are all **structurally unreachable via normal play in this port**, implemented anyway for fidelity per the same standard this project already holds for e.g. System A's own dead RET strategy and the four B-shared goal strategies. `stealAttempt`'s own header additionally notes a corollary an advisor review raised: since every marker `stepMarkers` can ever produce has `cat < 3`, `stealFlagBits(flags, marker.type)` collapses to the *same* value (`flags & 3`) for every marker in one call's loop — there is no genuine per-marker eligibility distinction to find in this port, only a per-*group* one.

**The stepMarkers/stealAttempt coordinate round-trip — a real, if currently accidental, fragility, tested rather than left implicit.** `stepMarkers` writes SCREEN coordinates (`o.x - cam.x`, at marker-write time); `stealAttempt` reconstructs world coordinates as `marker.x + camera.x` (at steal-attempt time) and `searchAndSteal` demands an exact match. These only agree when both calls run against the same camera snapshot — true today because `main.js` calls `stepMarkers` (around line 789) and `stealAttempt` (around line 1085, inside `stageFacingAndFire`'s dispatch) against the identical `cam.snapX`/`cam.snapY` within one tick, but nothing in either function's own signature enforces that. `checks.js`'s `checkEntityA()` now includes a test that goes through the real `stepMarkers` producer rather than a hand-built marker (every other stealAttempt fixture constructs `marker.x + camera.x` to already equal the target's world X, which never exercises this round-trip) — the one assertion in the suite that would fail if a future change moved either call site relative to `cam.snapshot()`.

**Tests.** `checks.js`'s `checkEntityA()` gained 38 new assertions covering `searchAndSteal` (live-object match, dead/flag6/type-0xffff exclusions), `stealAttempt` (eligible+proximate steal, ineligible flags, out-of-range, already-carrying bail, empty list), the `stepMarkers`→`stealAttempt` round-trip above, `strategy2`'s wiring (theft-on-goal-write, the carrying-bail degenerate case, backward-compatibility with no `objects` argument), `stepCarriedItem` (ease-only, ordinary/weapon drop-now, ordinary/weapon never-drop, the 1-in-128 roll's pass/fail), the DYING-branch death-drop recording, `dropCarriedItem`'s id round-trip (ordinary and weapon) plus its exhausted-pool null case, and a two-case test pinning main.js's own per-tick ordering (`tick()` → `if (e.alive) stepCarriedItem()` → contact damage, all AFTER stepCarriedItem in the same frame) so a periodic drop and a death-time drop for the same carried item can never both fire — an `advisor()` review flagged this as worth a real ordering test rather than an inspection-only conclusion. `checkWeaponsProjectiles()` gained 2 more assertions exercising `dropCarriedItem`+`insertSpawned` (the actual pair `main.js`'s `dropCarriedIntoWorld` closure calls) against a real, `cats`-ranked `PLEV4B.MAP` array with a simulated in-play kill supplying the reusable dead slot — main.js's own `level.drawObjects` filters every dead-type slot out at load (`main.js:178`), unlike the original's fixed 200-slot table, so `allocObject` can only ever find a slot this way in this port. `checkPopup()` gained the busy-slot-divert coverage. `node tools/verify-node.mjs`: 1008/1008 assertions pass (up from 968 before this pass: 32 in the initial steal-and-carry implementation, 2 from the stepMarkers round-trip, and 6 more from the two advisor-review follow-ups in this paragraph). `node tools/lint-checks.mjs`: passes, no tautologies.

**Next: System B.** ~~The mirror mechanic (`CS:0xEF01`/`0xEFA2`/`0xEEBA`) remains disclosed but unported. Its first required step is locating `DS:0x3cd`'s writer...~~ **CLOSED**, see the new section below.

### Steal-and-carry, System B — CLOSED end to end (port + tests) `[PROVEN]`

System B's own mirror (`CS:0xEF01`/`0xEFA2`/`0xEEBA`/`0xEE06`-`0xEEB8`/`0xF045`-`0xF068`) is now ported into `re-gods`, tested, and verified. It shares two formulas verbatim with System A but is architecturally different from it in three ways: the theft gate is a single global latch rather than a per-entity strategy, the carried item has **three** distinct positions in play rather than one, and the periodic-drop mechanism reuses System A's own formula unchanged.

**`DS:0x3cd`'s writer, located.** An exhaustive `search_instructions` sweep on the operand `3cd` returns exactly **two** hits in the whole image: the reader at `CS:0xEF01` (`cmp byte[0x3cd],2 / jnz ret`) and the sole writer at `CS:0xF7C9`. `CS:0xF7C9` sits at the tail of `seedGoals`'s own `idx===2` branch (the "attracts monsters" marker-seek strategy, `pathfind-producers.js`) — immediately after the marker-paint loop, before the `painted` fallback check — and fires **unconditionally** the instant that branch is reached with a nonempty marker list, regardless of whether anything actually got painted onto the search grid. `DS:0x3cd` is a **global, one-way, never-reset** latch: no second writer exists anywhere (not at level load, not at a full restart — the level-load clear routine `CS:0x1420`-`0x145F` does not touch it), so once any System-B strategy-2 seed has ever run once in a session, the gate stays open for every System-B entity for the rest of the game. This is architecturally very different from System A's own `strategy2`, whose theft gate is `entity.carriedType >= 0` checked per-entity, per-call — System A's gate is local and re-evaluated every time; System B's is a single switch flipped once for the whole game.

Ported as `pathfind.js`'s `stealGate = { active: false }` export, set by `pathfind-producers.js`'s `seedGoals` at the exact point `CS:0xF7C9` occupies (right after the `idx===2` marker-paint loop, before the `painted` fallback), and read by `entity.js`'s `stealAttemptB` exactly as `CS:0xEF01` reads `DS:0x3cd`. `checkEntityB()`'s own test suite arms it via the **real** `seedGoals` producer with `markersOverride: true` (this project's established way of forcing strategy 2 deterministically without reverse-engineering the random nibble roll) rather than hand-setting the flag, so the one assertion that would fail if `CS:0xF7C9`'s write ever moved relative to the paint loop is in the suite, not merely inspected.

**The shared formulas — confirmed byte-identical, not assumed from System A's shape.** A fresh disassembly of `CS:0xEF39`-`0xEF4C` (System B's own theft-eligibility test, inside `FUN_1000_ef01`) shows it computes the **identical** `stealFlagBits` formula on the identical bit positions as System A's own `CS:0xE88C`-adjacent read: `type >= 0xC0 ? (flags>>2)&3 : flags&3`. Rather than duplicate it, `stealFlagBits` was promoted from a private helper in `entity-a.js` to an exported one, with a doc comment recording that System B's own `stealAttemptB` computes the same formula byte-for-byte. `searchAndSteal` (the backward 200-slot object-array walk, exact `{type,x,y}` match, kill+carry) is likewise generic and imported into `entity.js` from `entity-a.js` rather than reimplemented — confirmed no circular-import risk (`pathfind.js` has zero imports of its own, `entity-a.js` doesn't import `entity.js`).

**The `0x45` hint-tablet exclusion — System B only.** `CS:0xEF51` excludes marker type `0x45` (the hint tablet) from theft eligibility even when otherwise proximate and flag-eligible; System A's own `stealAttempt` has no such check (confirmed by re-reading `CS:0xE90E` — no `cmp` against `0x45` anywhere in its body). `stealAttemptB` ports this as an explicit `marker.type === 0x45` exclusion, called out in the code as System-B-specific rather than folded into the shared `stealFlagBits`.

**Three positions, not one.** System A eases `carriedX`/`carriedY` toward a single target every tick and uses that same eased pair for both drawing and the periodic drop. System B's live carry step (`CS:0xEE06`-`0xEEB8`) is different in kind, not just in constants:

1. **The rigid attach/draw position**, `carryOffsetB` — a per-class, per-world signed-byte-pair offset (`DS:0xdc00`) added to the entity's own current position, recomputed **fresh every tick with no easing** (contrast System A's drift-toward-target model). Indexed by `spriteId - classBase`, where `spriteId` is the carrying creature's own currently-computed sprite id (`CS:0xF0AE`, this port's `spriteForEntity`) — not the carried item's sprite, and not a class-only lookup, which is why the animate-while-carrying test below matters.
2. **The periodic-drop position** — a completely separate, unbiased-on-Y raw point, `(entity.x + 8, entity.y)`, used by the ordinary tick-by-tick drop roll.
3. **The death-time drop position** — the *same* raw formula, `(entity.x + 8, entity.y)`, applied independently at death rather than reused from whatever the attach or periodic-drop code last computed.

`carryOffsetB(world, cls, spriteId)` and `stepCarriedItemB(entity, desc, world, rand)` are the two new `entity.js` exports covering this. `stepCarriedItemB` unconditionally recomputes `carriedX`/`carriedY` (position 1) every call regardless of whether the drop test (using position 2) actually fires that tick — mirroring `CS:0xEE1B`/`0xEE1E` running unconditionally before the drop test at `0xEE4A`/`0xEE9A`. The periodic-drop test itself reuses System A's own `stepCarriedItem` formula unchanged: ordinary items read `flags & 3` (0 = now, 2 = never, else a 1-in-128 roll), weapons read `flags & 0xC` (0 = now, 8 = never, else the same roll) — a genuine cross-system reuse, not a coincidence of similar shapes.

**`CARRY_OFFSET_TABLE_B` and the disclosed world-1 bug.** The table itself (worlds 2/3/4, 20 signed-byte pairs each) was transcribed from a live `read_memory` read of `1ffd:dc00`, not decompiled — `DS:0xdc00`'s own consumer, `CS:0xEEBA`, computes `(world - 2)` via an 8-bit `SUB DL,0x2` then zero-extends it via `SUB DH,DH` rather than sign-extending via `CBW`, which this codebase uses everywhere else for exactly this kind of signed byte-to-word promotion. For world 1, `world - 2 = -1`, which zero-extension turns into `+255` instead of `-1`, producing a wildly out-of-range table index into unrelated memory — a genuine, reproducible bug in the original binary, not a transcription artifact (confirmed by reading the actual instruction sequence, not inferring it from the table's own shape). `carryOffsetB` implements the disclosed simplification this project uses elsewhere for the analogous "uninitialized VRAM" plane-A case: world 1 always returns `{dx: 0, dy: 0}` rather than attempting to reproduce a meaningless out-of-bounds memory read.

**`CS:0xED84` vs. `CS:0xF03A` — a documentation ambiguity resolved, not a code correction.** The pre-existing `entity.js` comment on `deathCacheX` (`this.x + 8 // CS:0xED84 'ax += 8'`) appeared to contradict a fresh disassembly of `CS:0xF03A` (the death-time drop's own position write, which is unbiased on Y and computed independently). Disassembling `CS:0xED60`-`0xED B9` resolved it: `CS:0xED84` is a separate **read** (with its own `+8` bias) inside the group-elimination-reward tail, consuming what `CS:0xF03A` (the actual **writer**, unbiased) had already cached — two different steps of one mechanism, both citations correct. No change was needed to the pre-existing `deathCacheX`/`deathCacheY` port; this only confirmed the new per-kill drop needed its own independently-recomputed position (`deathDropX`/`deathDropY`, per the DYING-branch code above) rather than reading `deathCacheX`/`deathCacheY`.

**`main.js` wiring, and the ordering that matters.** `stealAttemptB`/`stepCarriedItemB` are called for every alive System-B entity, after `e.tick()` for that entity — matching `CS:0xEDDA` sitting between the mode handler (`CS:0xEDD3`) and the contact test (`CS:0xEDF4`) in the original, so a steal attempt sees the entity's post-move position for the tick but pre-contact-damage state (`stepCreatureDamage` runs later, after the whole `enemies` loop). This ordering is called out explicitly in a `main.js` comment rather than left implicit, per an `advisor()` review that flagged it as load-bearing and invisible from either function's own code.

**Tests.** `checkEntityB()` gained 22 new assertions (up from the 21 recorded when this section was first drafted — one more added following the `advisor()` review below): the gate armed by the real `seedGoals` producer; gate-closed bail; gate-open successful steal; the `0x45` exclusion; already-carrying bail; empty-marker-list no-op; `carryOffsetB` for world 2/idx0, world 4/idx9 (a negative dx), world 1's disclosed fallback, and an out-of-range fallback; `stepCarriedItemB`'s not-carrying null, attach-position-recomputes-regardless-of-drop, drop-position-differs-from-attach, weapon never/drop-now, and the roll-gated pass/fail; the DYING-branch per-kill drop and its carrying-nothing negative case; and — added after an `advisor()` review of the initial pass — a test that ticks a real walking carrier through its own animation cycle and asserts `carryOffsetB`'s attach offset genuinely moves as `frame` advances, landing on multiple distinct rows of `CARRY_OFFSET_TABLE_B`. That review's other finding — that `searchAndSteal`'s own write to `carriedX`/`carriedY` (the stolen object's world position, `CS:0xEFCF`/`0xEFD2`) is immediately superseded by `stepCarriedItemB`'s own attach recompute one call later, matching the original's own steal-then-recompute sequence exactly — is now recorded as a comment at the `searchAndSteal` call site in `stealAttemptB` rather than left for a future reader to rediscover; the existing test asserting the steal-written position was kept rather than dropped, since that value is real (if transient) original-binary behaviour worth pinning. `checkEntityB()`'s own global-state discipline (saving/restoring `stealGate.active` around the whole block, since it is genuinely shared mutable state across all check functions in the same module graph) is unchanged from the initial pass. `node tools/verify-node.mjs`: 1030/1030 assertions pass (up from 1008 before System B's steal-and-carry closure — 21 in the initial pass, 1 more from the animate-while-carrying test). `node tools/lint-checks.mjs`: passes, no tautologies, 563 imported names scanned.

### `DS:0x296` — CLOSED: a facing-deadzone snapshot, not a new mechanism `[STATIC]`

`CS:0xE003` caches the entity's own world X (`[di]`) into `DS:0x296` at the very top of the pipeline, before stage 1 runs; `CS:0xE06E`–`E08B` (the pipeline's own tail, past the `[di+0x19]` rank check) reads it back and diffs against the POST-pipeline X:

```
e06e  cx = [0x296] - ax          ; ax = the CURRENT (post-pipeline) X -> cx = net X displacement this whole tick
e074  jz 0xe08c                   ; no net movement -> leave facing alone
e078  cmp cx,2  / jl 0xe08c        ; moved right by < 2px -> too small, leave facing alone
e07d    [di+0x27] = 1              ; moved right by >= 2px -> facing := RIGHT
e083  cmp cx,-2 / jg 0xe08c        ; moved left by < 2px -> leave facing alone
e088    [di+0x27] = 0              ; moved left by >= 2px -> facing := LEFT
```

So `DS:0x296` is simply the snapshot half of a **2px facing-deadzone**: `[di+0x27]` (the already-documented facing flag `CS:0xE199`'s sprite resolver reads) only flips once the whole pipeline pass has actually moved the entity at least 2px net in one direction, preventing 1px steering jitter from flickering the sprite's facing every tick.

### Consolidated System-A entity record layout, `DS:0x0e96`, stride `0x28` `[PROVEN, from this session's reads]`

| off | field | established by |
|---|---|---|
| `+0x00`/`+0x02` | world X / Y | materialise loop, stage 2, already-known |
| `+0x04` | animation frame | `CS:0xe199`, materialise loop |
| `+0x06` | dormant/reawaken countdown, shared by states −2 and −3 | `FUN_1000_e2ec`, this session |
| `+0x08` | state word: `>0` alive, `0xfffe` "waiting" at spawn, `−2`/`−3` dormant/reawaken (this session), `≤−4` ordinary dying | materialise loop, `FUN_1000_e2ec`, existing doc |
| `+0xa` | write-only: set to `1` for every group member by `CS:0xEBD3` (`FUN_1000_ebb9`, the group-wide reroll/strategy reset), never read anywhere reachable from System A's own tick (`UNKNOWN_sysA_entity_0xa`, closed — see below; corrects this document's own immediately-prior session, which misattributed a **System-B** read at the same coincidental displacement to this field) | this session |
| `+0xc` | dead: never read or written anywhere in `GAME.EXE` (`UNKNOWN_sysA_entity_0xc`, closed negative — see below) | this session |
| `+0xe` | per-entity reload/reserve timer for the generic fire path | `CS:0xe659` (stage 6) |
| `+0x10` | carried-item TYPE, negative = carrying nothing | this session (`UNKNOWN_df62_full_flow`) |
| `+0x12`/`+0x14` | velocity X/Y | stages 2/3/4/5, existing doc |
| `+0x16` | windup countdown: refilled to 10 by stage 3's attack arm, floored at 1 generically / 2 inside the trail-follow handler | this session |
| `+0x19` | dual-use: (a) per-tick reroll-queue rank, gating stage 2's FINE arrival check and stage-1's `CS:0xEBB9` group reset on death; (b) the trail-follow leader-election flag `CS:0xEB37` sets | stage 2, this session |
| `+0x1a` | spawn-zone code, 0..7, written once by `CS:0xec12` at materialise time — dead, never read (`UNKNOWN_sysA_field_0x1a_consumer`, closed negative) | materialise loop |
| `+0x1b` | COARSE arrival flag (32px cell match) | stage 2 |
| `+0x1c`/`+0x1e` | goal X/Y | stage 2, existing doc; seeded to spawn point by the materialise loop |
| `+0x20`/`+0x22` | carried item's own EASED screen/world position | this session (`UNKNOWN_df62_full_flow`) |
| `+0x24` | sticky per-entity strategy byte (existing doc, stage 1) | existing |
| `+0x25` | FINE arrival flag (8px both axes) — read by stage 5 (snap-to-goal) and by stage 3 (existing doc, attack gate) | stage 2, stage 5 |
| `+0x26` | animation reseed countdown | `CS:0xe199`, materialise loop |
| `+0x27` | facing flag, driven by a 2px deadzone diff against the pre-pipeline X (`DS:0x296`, this session); read by `CS:0xe199` (+3/+4 sprite offset) | this session, `CS:0xe199` |

Fields not touched by any routine read this session (the bytes between the known offsets, other than `+0xa`/`+0xc` above) remain unresolved; the table above is not claimed complete, only what this session's reads pin down.

### `UNKNOWN_sysA_entity_0xc` — CLOSED negative, exhaustive `[STATIC]`

The entity record's own `+0xc` (a word sitting between the state word `+0x08` and the per-entity reload timer `+0xe`, in a struct otherwise packed with four consecutive words at `+8/+0xa/+0xc/+0xe`) has no registered `UNKNOWN_` name in this document; it sat as a bare "(unresolved)" cell in the table above. `get_xrefs_to` on the struct's own base (`1ffd:0e96`) is not useful here and would be a rule-1 trap if trusted at face value: it returns a clean `count: 0` with `in_memory_block: true`, but that is because the base is loaded as a bare 16-bit immediate (`CS:0xDF42 MOV DI, 0xe96`) with the segment supplied implicitly by `DS` at each later `[DI+n]` use — a real-mode pattern Ghidra's own reference analyzer does not resolve into a data xref, so the zero is a tooling gap, not a "nothing references this struct" finding.

The actual technique: `search_instructions` with `operand_pattern` for each of the four addressing forms 8086 real mode allows for a register-plus-displacement memory operand (`DI + 0xc]`, `SI + 0xc]`, `BX + 0xc]`, `BP + 0xc]` — the trailing `SI`/`DI` also catches the two-register based-indexed forms `[BX+SI+d]`/`[BX+DI+d]`/`[BP+SI+d]`/`[BP+DI+d]` as a substring, so this sweep is a complete addressing-mode census, not a sample) against the whole of `GAME.EXE` (21,157 instructions scanned per query, consistent across all four calls, confirming full coverage). Results: 28 hits at `DI + 0xc]`, 22 at `SI + 0xc]`, 0 at `BX + 0xc]`, 0 at `BP + 0xc]`. None of the 28 `DI`-relative hits fall inside any known System-A entity-pipeline function — every one resolves into unrelated structs elsewhere in the binary (the sole hit that looked promising, `FUN_1000_ec60:0xecf1`, is **System B's** own materialise loop, a different struct at the same coincidental displacement — the exact kind of collision this document's own `UNKNOWN_sysA_0x16_refill` closure already warns about for `+0x16`). Of the 22 `SI`-relative hits, three (`CS:0xE37C`/`0xE3B8` in stage 2, `CS:0xE4A3` in stage 3) do land inside System-A code — but `SI` there is the **group descriptor** pointer, not the entity pointer (see `UNKNOWN_sysA_descriptor_0c` below); the other 19 are unrelated structs elsewhere.

Coverage was cross-checked by direct disassembly rather than resting on the sweep alone: every System-A entity-pipeline function this document has located — the materialise loop (`FUN_1000_de7d`), the outer per-group/per-entity dispatcher and death-fade (`FUN_1000_df39`/`FUN_1000_df62`, `df62`–`e2eb`, 341 instructions read in full this session), the stage-1 mode selector (`FUN_1000_e6e4`), stages 2/3/4/5/6 (`FUN_1000_e336`/`e487`/`e44d`/`e42b`/`e659`), the materialise-time zone probe (`FUN_1000_ec12`) and the spawn-flash routine (`FUN_1000_ff59`) — was read byte-for-byte this session or a prior one, and none references `+0xc` off any register. `list_bookmarks(category="Bad Instruction")` finds no disassembly failures anywhere near this code region (nearest is `CS:0x651D`, far outside it), so this isn't a coverage gap masquerading as a negative. No `STOS`/`REP` bulk-clear of the entity array exists anywhere in the image (zero hits for mnemonic `STOS`) that might zero the field without a literal per-field reference — the group-runtime clear (`CS:0xDE6F`–`0xDE7C`) zeroes the *group-runtime* array (`SS:0x3768`, stride `0xE4`), a different structure entirely, not the entity array.

**Worded as what was checked, not as what doesn't exist:** as of 2026-09-17, against `GAME.EXE` (Ghidra instance `/GAME.EXE.1`, 542 functions), an exhaustive `search_instructions` sweep of all four valid 8086 base+displacement addressing forms at offset `0xc`, cross-checked by full manual disassembly of every known System-A entity-pipeline function, finds no reader and no writer of entity-record `+0xc` anywhere in the binary. The field sits in a tightly-packed run of per-entity words (`+8` state, `+0xa` a distinct, only-partly-investigated field, `+0xc` this one, `+0xe` reload timer) that makes accidental padding less likely than for an isolated byte — but "genuinely dead struct space, perhaps a field whose logic was removed pre-ship" is the only reading these bytes support; authorial intent for *why* is not recoverable from disassembly and is not claimed here.

### `UNKNOWN_sysA_descriptor_0c` — CLOSED: a per-group steering-step cap, shared by stages 2 and 3 `[PROVEN]`

This document's own *Stage 2* section (above) already found `descriptor[+0xc]` (`SI`-relative, the **group descriptor** at `DS:0x9d60`+`record*0x16`, a completely different struct from the entity record despite the identical numeric offset) acting as a steering-step cap, and forward-referenced a fuller closure here that was never actually written — a dangling reference of exactly the kind this document elsewhere warns about. This section delivers it.

Fresh disassembly of stage 3 (`FUN_1000_e487`, the descriptor-gated attack/leap arm, `[si+0xf]`-tested) shows it reads the **identical** descriptor field, at `CS:0xE4A3` (`MOV AL, byte[SI+0xc] / CBW`), applying the same min/max clamp shape stage 2 uses at `CS:0xE37C`/`0xE3B8` (there read unsigned, `MOV BL,byte[SI+0xc] / XOR BH,BH` — no practical difference, since the shipped value range never exceeds 127) to the doubled reach-table displacement (`CS:0xE49F`/`0xE4A1`, `SHL CX,1`/`SHL DX,1`) before adding it into velocity. So `descriptor[+0xc]` is a **per-group cap shared by both the ordinary accelerate-to-goal stage and the attack/leap stage** — not stage-2-specific as the earlier framing implied — while `descriptor[+0xb]` (stage 4, `CS:0xE44D`, a *signed*-byte symmetric clamp on raw velocity, unrelated to the goal-seek/attack step) is a separate cap entirely; the two must not be conflated despite sitting one byte apart in the same record.

**Shipped-data census** (decompressing all 8 `PALFILS.0{A,B}{1-4}` files with `blast.py` and reading every live System-A descriptor at file offset `0x0d58 + record*0x16` — this base derived from, and cross-checked against, System B's own already-documented `PALFILS +0x11A4` descriptor base: `0xa1ac`(`DS`) `− 0x11a4`(file) `= 0x9008`, so System A's `DS:0x9d60` base lands at file offset `0x9d60 − 0x9008 = 0x0d58`, and `0x0d58 + 50×0x16 = 0x11a4` exactly matches System B's own start — a self-consistent check, not an assumed offset). Per-file live-record counts (9/9/10/9/9/9/10/9, 74 total) match this document's own already-established census exactly, confirming the offset math. Across those 74 live records: `descriptor[+0xc]` (this field) takes values `{1,2,3,4,5,6,7,8,10}`, matching the "always 1..10" figure the dangling reference had already asserted; `descriptor[+0xb]` (stage 4's separate clamp) takes the narrower `{3,4,5,6,7,8,10}` — both plausible small per-tick pixel-step speed tiers, often but not always equal on the same record (e.g. one live record reads `{+0xb:6, +0xc:1}`), confirming they are independent bytes, not a duplicated field.

### `UNKNOWN_sysA_entity_0xa` — CLOSED: write-only, and a correction to this document's own immediately-prior session `[STATIC]`

⚠️ **This corrects a misattribution this document made one session ago, in the very pass that closed `UNKNOWN_sysA_entity_0xc` above.** That pass's own table row for entity `+0xa` read: "read only by stage 6 (`CS:0xE6D4`) as a shift count into a bitmask at `DS:0xd95a`," attributed to System A because the read sits inside `FUN_1000_e659`, which System A's own pipeline does call (`CS:0xE031`). That attribution never checked *whether System A's own call reaches that specific branch* — it doesn't, and the read belongs to a different struct entirely. This is the exact same "same offset, different struct" trap `UNKNOWN_sysA_0x16_refill` and `UNKNOWN_sysA_entity_0xc` (above) already warn about, caught here one field later because it wasn't checked the first time.

`FUN_1000_e659` is shared, generic code — this document's own resolved-items index already establishes this ("`CS:0xE659` ... genuinely generic code shared by both real entity pipelines"). `get_xrefs_to` on it finds exactly **two** callers in the whole image: `CS:0xE031` (System A's pipeline entry, `FUN_1000_e001`) and `CS:0xEDC0` (`FUN_1000_edb8`, called from `FUN_1000_ed38` — this document's own already-documented **System B** per-group entity loop). A global byte, `DS:0x3c2`, tells the shared function which caller it's in — `search_instructions` finds exactly **three** references in the whole image: `CS:0xDF3A` (`FUN_1000_df39`, System A's own per-frame group-loop head) sets it to `0`; `CS:0xED16` (`FUN_1000_ed15`, System B's own per-frame head) sets it to `0xFF` (−1); `CS:0xE69E` (inside `FUN_1000_e659` itself) is the only reader, `CMP byte[0x3c2],0 / JS 0xE6D4`. Since each per-frame head sets this flag once and nothing else touches it for the whole duration of that system's own per-entity walk, **the `JS` to `CS:0xE6D4` (the `[DI+0xa]`-reading branch) can only ever be taken when `FUN_1000_e659` is running under System B's own call, never System A's** — confirmed independently by reading `FUN_1000_edb8` itself, which (immediately after its own `CALL 0x1000:e659`) runs `MOV SI,0xdbe0 / MOV AX,[DI+0xa] / SHL AX,1 / SHL AX,1 / ADD SI,AX / MOV AX,[SI] / CALL AX` — the identical `DS:0xdbe0` movement-mode dispatch this document's own `UNKNOWN_sysB_sprite_formula` closure already documents, proving `DI` at this point is a **System-B** entity pointer and `[DI+0xa]` there is System B's own movement-mode index (the same field selecting walk/hop/fall in that closure), not anything belonging to System A's `DS:0x0e96` array. So `CS:0xE6D4`'s own read is System B reading System B's own field a second time (once to pick a movement handler, once more to look up whether that mode has a fixed facing in the `DS:0xd95a` bitmask) — chasing what that bitmask itself encodes is a genuine System-B lead, disclosed but not pursued here as out of scope for a System-A entity-record question.

With that read reattributed, System A's own entity `+0xa` has exactly **one** access anywhere in the image: `CS:0xEBD3`, inside `FUN_1000_ebb9` (the group-wide reroll/strategy reset already documented under `UNKNOWN_ebb9_reroll_effect`) — `MOV word[SI+0xa],0x1`, in the same per-member loop (`SI` walking from `DS:0x294`, the already-documented "current group's entity base" shadow global, stride `0x28`) that also zeroes `+0x19`/`+0x25` and unsets `+0x24`. So System A's `+0xa` is **write-only**: every surviving member of a group is stamped to the constant `1` whenever that group's rank-1 entity dies and triggers a synchronized reset, but nothing in System A's own reachable pipeline ever reads the field back — the materialise loop never initializes it either (confirmed by this document's own full read of `FUN_1000_de7d` above), so a group that never reaches its first `EBB9` reset carries whatever residual byte was left in that array slot by a previous occupant, moot in practice since no code path consults it. This is the same "written, never read" shape already established for `+0x1a`, just produced by a later-life group event instead of materialise-time.

`UNKNOWN_sysA_0x29c_cache` — **CLOSED negative: dead, orphaned code `[STATIC, exhaustive]`.** `CS:0xE328`–`0xE335` is a self-contained three-instruction cache (`[di]→0x29c`, `[di+2]→0x29e`, `RET`) sitting immediately before, and falling straight through into, `CS:0xE336` — stage 2's own already-fully-documented entry point. But `get_xrefs_to(1000:e328)` returns **zero references** anywhere in the image, and every real caller of stage 2 (the pipeline entry `CS:0xE001`) reaches it with `CALL 0x1000:e336` directly, *past* this three-instruction prologue. So `DS:0x29c`/`0x29e` are never actually written by any code path the game can reach — this is a second orphaned dead-code fragment in this same code region, in the same family as the already-documented `UNKNOWN_cfcc_1ca5_orphan`.

The hero carries **three weapon slots**, each holding a weapon index or a negative value when empty:

| slot | weapon idx | projectiles | tag base |
|---|---|---|---|
| A | `DS:0xdd10` | `DS:0xdd12` | 1 (`0x95e8`) |
| B | `DS:0xdda2` | `DS:0xdda4` | **`0x0a`** (`0x9674`) |
| C | `DS:0xde34` | `DS:0xde36` | `0x13` (`0x96df`) |

⚠️ **Slot B's tag base is 10, not absent** — an earlier revision of this table left it blank. The three slots are a **uniform `0x92` stride** (`0xdda2 − 0xdd10 == 0xde34 − 0xdda2`), and with the shared `add dx,3` per sub-slot the whole tag space is regular: **`tag = 1 + slot*9 + subslot*3`** → 1/4/7, 10/13/16, 19/22/25. **No tag is ever 0**, which is exactly what lets the tag word double as the record's free flag.

Those are exactly the three words trigger predicates COND3/COND4 test (`0x3ea8`/`0x3ec1`) — independent confirmation that they are the weapon inventory. Per slot the routine computes the record with an explicit `idx*16 + idx*64` (**stride `0x50`**, so it indexes `PWEAPONS` directly), reads **`+0x0a` = the maximum simultaneous projectiles**, and walks up to **three** sub-slots at stride `0x18`, stopping after `maxShots` attempts. A sub-slot is free when `[di]`, `[di+8]` and `[di+0x10]` are **all** zero (`0x9724`) — the same `x|y` emptiness idiom used by the open list and the ledge records, not three sub-projectiles.

**The shipped data corroborates `+0x0a` exactly**: across all 11 weapons it is only ever **1 or 3**, which is precisely what a 3-iteration unrolled loop can consume. A 2 or a 7 would refute the reading.

⚠️ **CORRECTION — the asymmetry is between slot A and the other two, not between C and the other two.** An earlier revision of this section called both guards a slot-C special case. **Slots B *and* C** each carry the max-shots sign guard (`0x966f`, `0x96da`) *and* the `DS:0x33e` interlock (`0x969a`, `0x9705`), byte-for-byte identical: `cmp bp,1 / jnz fire / cmp byte [0x33e],0 / jnz skip`. **Slot A has neither** — it is instead the sole *writer* of `DS:0x33e` (`0x963b`), setting it when its own max-shots is 1 and it allocated. So the rule is: **if the slot-A weapon is single-shot and fires this frame, no other single-shot weapon fires with it**; multi-shot weapons are exempt on both sides of the test. `UNKNOWN_weapon_slot_c_interlock` (the *reason*) stands; the shape does not.

⚠️ **The return value is inverted, and there is a lockout.** `ax = cx`, where `cx` starts at 1 and is zeroed by `xor cx,cx` on any successful allocation — so **`0` means something fired**. `DS:0x351` is a top-of-function lockout (`0x95cb`) that returns 1 *before* clearing `DS:0x33e` or the three live pointers.

**The allocator does not spawn.** It records only the free sub-slot pointer in `DS:0x1bc`/`0x1be`/`0x1c0` and the tag in `DS:0x1c2`/`0x1c4`/`0x1c6`; `0x9734`/`0x97ce` (the **right/left spawners**) read those back. Eight player states are firing variants (5, 6, 20, 21, 22, 23, 24, 25).

(The `0xaad1`–`0xab3f` routine formerly listed here as a "pixel-mask collision scan" is decoded — it is the damage-grid scanner, and it is not a pixel mask; see *Projectile collision*.)

### The death/respawn reset set — CLOSED: two divergent paths, not one reset `[PROVEN]`

`FUN_1000_09bb` (`CS:0x09BB`–`0x0AAF`, reached from the main loop's own death test at `CS:0x01C4`/`0x01C9` when the health bar goes negative) is **not itself "the reset"** — re-reading it in full shows it is the **death-animation tick driver**: it re-runs the ordinary per-tick projectile/hazard/entity calls (`CALL 0x9455`, `CALL 0xAD88`, `CALL 0xB1C2`/`0xB3CE`/`0xB4E7`/`0x1280`/`0x3CC7` — the identical block the main loop itself runs at `CS:0x0223`–`0x0239`, confirming these hazard walkers really do run continuously, dead or not), then drives a small state machine on **`DS:0x24c`** (a previously-undocumented step counter, 0..0x12) that seeds a **5-record death-burst particle array** at `DS:0xd76e` from a template at `DS:0xd752` (world position of death, screen-converted with a `+8` Y bias — `CS:0x0A3B`–`0x0A5E`), then applies simple position += velocity, velocity++ (gravity) physics to those 5 records and draws each via the shared entity blitter `CS:0x3569`, sprite `= 0x5b + [0x24c]` — the same `0x5b`-base sprite-id convention this document already documents for entity death frames, here reused for the *hero's own* death burst.

**Once the animation counter reaches `0x12` (18 ticks ≈ 1.2 s at 15 Hz), it jumps to `CS:0x0930` — the real fork point:**

```
0930  [0x6c] = 0xff ; [0x6d] = 0xff     ; a display-dirty pair (new — not previously documented)
093A  dec word [0x224]                   ; LIVES -= 1 — this document's own previously-flagged
                                          ;   "not traced to this path" loose end; now traced exactly here
093E  js 0x0943                          ; lives went negative -> GAME OVER (below)
0940  jmp 0x0845                         ; lives remain -> RESPAWN (already extensively documented:
                                          ;   FUN_1000_0845, health restore from [0x250], the
                                          ;   14-entry arrival-zone table at SS:0x365a, camera
                                          ;   re-init via FUN_1000_2189, state 4, [0x32]:=0)
```

**So the respawn-with-lives-remaining path was already comprehensively documented** (health/position/camera/invulnerability, all under *`UNKNOWN_camera_init`* and *`DS:0x8b4c`*'s reach into `FUN_1000_0845`) — nothing new needed there. **The genuinely undocumented half was GAME OVER** (`CS:0x0943` onward, lives negative):

```
0943  SS:[0x40a] = 0xc0                  ; a UI/display parameter
094A  call 0x0929                        ; local helper, not chased further
094D  callf [0x531e]                     ; sound driver export 10 (music-control range, ROL-only)
0952  sfx 0x6413 (call 0x22ca)           ; play a sound effect
095A  call 0x22d0                        ; a second sound-related call
095D  cx=0x96(150) : { call 0x357f ; call 0x358d }   ; 150-iteration palette fade loop
0968  ax=0x15e ; call 0x2516             ; unrelated to the file-loader's own DS:0x15e filename
                                          ;   pointer — here it's a plain parameter, not chased further
096E  [0x38d]=0 ; [0x33]=0               ; two flags cleared
0978  callf [0x5326]  (ax=4)             ; sound driver export 12 (music-control range)
0980  callf [0x530e]  (al=0x80)          ; sound driver export 6 (music-control range)
0987  call 0x318f
098A  call 0x359d  (ax=1)
0990  call 0x32c0
0993  jmp 0x2c82                         ; -> the ATTRACT-MODE DEMO CYCLER
```

**Game over does not reset hero/world state at all — it exits straight to the attract-mode cycler** (`FUN_1000_2c82`, this document's own already-documented 6-state title/high-score/demo loop). This matches this session's own live DOSBox observation: dying with no lives left dropped straight into the `TOP TEN GODS` high-score screen and on into demo playback, exactly this code path. **The actual "new game" reset — `world:=1`, money zeroed, weapon slots cleared, health/lives to their starting values — happens later and separately**, only once the player picks "BEGIN QUEST" from the menu again (`CS:0x0473`/`CS:0x8DD9` for health/lives/weapon-slot clear, `CS:0x0498`/`CS:0x8D80` for money/score/inventory, both already documented under *Weapon pickup* and *`UNKNOWN_key_pickup`*). So "the death/respawn reset set" was never one function to find — it is these two already-largely-documented forks, now both fully pinned.

### `UNKNOWN_projectile_record` — CLOSED: 8 bytes, not 24 `[PROVEN]`

**A projectile is `{ u16 tag, u16 x, u16 y, u16 dir }`.** The `0x18` the allocator strides is *three consecutive records*, which is why the free test (`0x9724`) reads `[di]`, `[di+8]` and `[di+0x10]` — it is checking the tag word of each. The spawn handler then writes those three words-of-four in sequence (`mov [di],dx / add di,2 / stosw / mov [di],bx / add di,2 / mov word [di],<dir>`), filling one, two or three of them.

Slot geometry follows: `0x92 − 2 = 144 = 18 × 8`, so each slot has **18 record positions**, of which the allocator's three-deep unrolled loop can reach only the **first 9** (groups at `+0x00`, `+0x18`, `+0x30`).

The 18 is not inferred from the stride alone. The clear routine `CS:0x9177` does `mov cx,0x48 / xor ax,ax / mov [si],ax / add si,2 / loop` — **exactly 72 words = 144 bytes** — from each slot's base + 2, called for all three slots by `CS:0x914c` (level start, and `CS:0x94ce` on a new weapon pickup). So the whole 144-byte region is one array of projectile records and is not shared with anything else. `UNKNOWN_projectile_area_upper` narrows further still: the **mover also walks exactly nine** (`CS:0x9c6d mov cx,0x9`), so the upper 9 are untouched by *both* sides and the open question is only why 144 bytes were reserved for 72.

**The spawn is data-driven through a jump table at `DS:0xd88c`.** The emitters read a **byte** from the weapon record — `+0x16` firing right (`0x987f`), `+0x12` firing left (`0x98b5`) — double it, and `call` through it. ⚠️ Because the load-time pass byte-swaps the first 32 bytes *as words*, the native byte at `0x16` is the **file** byte at `0x17`; reading file `0x16`/`0x12` yields 0 for every weapon.

| | |
|---|---|
| table | **16 entries** `[PROVEN]` — see the correction below |
| parity | **even = left-facing, odd = right-facing** — pinned by the table itself: entry 12 is `sub bx,8 / jmp 0x991c` (left body), entry 13 `sub bx,8 / jmp 0x98d1` (right) |
| shipped | left ∈ {0,2,4,6,8,10,14}, right ∈ {1,3,5,7,9,11,15} — **right == left + 1 in all 44 records**; max 15, so the table has **no unused tail at all** |

⚠️ **CORRECTION — the spawn table is 16 entries, not 22.** An earlier revision of this section guessed 22 by noticing that entries 22+ hold the potion handlers. There are in fact **three adjacent tables**, each with its own single consumer, and the boundaries are pinned by the code that loads them:

| base | width | loaded at | role |
|---|---|---|---|
| `DS:0xd88c` | 16 | `0x9886`, `0x98bc` | **spawn** handlers, indexed by weapon `+0x12`/`+0x16` |
| `DS:0xd8ac` | 6 | `0x949d` | **mover** handlers, indexed by weapon `+0x1A` |
| `DS:0xd8b8` | — | `0x1822`, `0x6f32` | the potion handlers |

Reading them as one table made the six movers look like unreachable spawn handlers, which is exactly why `UNKNOWN_projectile_mover` stayed open a pass longer than it needed to.
| decoded | 0/1 (base) and 12/13 (raised muzzle). 2/3, 6/7, 8/9, 10/11, 14/15 are `UNKNOWN_projectile_handlers` |

Handler 1 (right) does `add ax,0x10 / sub bx,0xc` and writes dirs **1, 0, 2**; handler 0 (left) does `sub bx,0xc` and writes **4, 3, 5** — the two triples are a clean +3 apart, and note the *write order* puts the odd code first. Each also stores the facing back into weapon `+0x0e` (`1` right, `0xFFFF` left) — **which resolves what `+0x0e` selects between `+0xc` and `+0x1e` for: it is the facing.**

⚠️ **Handler 13 is not handler 1 with a different Y.** It jumps to `0x98d1`, *past* `add ax,0x10`, so it never applies the +0x10 its same-facing sibling does. Mirroring 1 to build 13 puts every shot 16 px off.

⚠️ **`bp = [si+8] − [si+6] + 1` is not a fixed projectile count.** Only 1 and 2 are distinguishable (`dec bp / jz` twice); everything else falls through to three. Port it as the branch — and see the next section, because both operands are runtime state.

### `UNKNOWN_weapon_08` — CLOSED: it is the weapon's PICKUP COUNT `[STATIC]`

> **`[STATIC]`, deliberately.** This closure rests on a *negative* result — "these are the only writers" — from a search that is incomplete by construction, and it was used to overturn port behaviour shipped on the same pass. **To promote:** watchpoint `DS:0xe2be + n*0x50`, pick one weapon up twice, and confirm the word goes `base → base+1 → base+2` while `+0x06` never moves.

`+0x08` is not a stat, it is mutable state, and it has **exactly three writers** in the whole image:

| site | effect |
|---|---|
| `CS:0x9115` | `[rec+8] := [rec+6]` — a **new** weapon: count := base |
| `CS:0x94e8` | `inc [rec+8]` — picking up one you **already hold** |
| `CS:0x9451` | `inc [rec+8]` — a bulk power-up applied to all three slots (`CS:0x9426`) |

The same pickup path also resets **`+0x04` to 0** unconditionally and **`+0x02` to 0** when it reads 3 (`CS:0x910d`, `CS:0x9118`), so those two are runtime state as well — `UNKNOWN_weapon_02` / `UNKNOWN_weapon_04`, **both CLOSED** by the mover work under *`UNKNOWN_projectile_mover`* below: `+0x02` is the 3-entry draw-style index into `DS:0xdf26` (this pickup reset is a range guard, not a second field), and `+0x04` is the weapon's current animation frame, with `+0x1c` its frame count. Neither is parsed by the port.

All three are reachable only from the pickup dispatcher `CS:0x94a7`, which branches on whether `bx` already matches one of the three slot words.

**`+0x06` (Power) has no runtime writer at all.** This is the keystone of the base/counter reading, so it was established by an **exhaustive** scan rather than a windowed one: every write instruction in the image with displacement 6 or 8, in *any* addressing form, is 190 instructions, and only `si`/`di`/`bp` bases occur — **no two-register (`[bx+si+…]`) write form exists at all** for these displacements, so that blind spot is theoretical here rather than actual. Of the 190, five have a `0xe2b6` load within 200 lines; three are the `+0x08` writers above, one (`0x9A74`) writes a *projectile's* `+6` through `di`, and the last (`0xC50B`) is a **false positive** — its `si` is `0xd030`, a different 15-record array of stride `0x0a`. So Power is immutable, which also closes the standing question of whether it can be upgraded.

`0x9A74` is worth keeping: handler 9's body writes `[di+0] = tag`, `[di+2] = x`, `[di+4] = y`, `[di+6] = 0x2f` — **the same four fields in the same order as handlers 0/1, from unrelated code.** That is an independent corroboration of the 8-byte record layout. It also shows the `dir` word is *not* confined to 0–5: handler 9 writes 47, so the `{1,0,2}`/`{4,3,5}` triples are handlers 0/1's codes, not the field's domain.

So `[si+8] − [si+6] + 1` reads as **1 + the number of EXTRA pickups**, clamped to three by the `dec bp / jz` chain. **Collect the same weapon repeatedly and it fires more projectiles at once, up to 3.**

The shop confirms the reading independently, from the other side: `CS:0x6fde` refunds `([+8] − [+6]) × (value + 1) / 2` — proportional to the extras collected, which is only meaningful if the difference counts pickups. (`mul bx / sar dx,1 / rcr ax,1` into the 32-bit total at `DS:0x194`.)

⚠️ **The pin and the pickup counter COMPOSE — neither alone describes the volley.** The loader re-pins `+0x08` to the EXE-image value for all 11 records on every **sublevel-`'a'`** load (`CS:0x35e9`, gated `cmp byte [0x43],0`), while the weapon slots are cleared only by `CS:0x914c` — whose two callers, `CS:0x473` (after the world wraps to 1 and the money total is zeroed) and `CS:0x8dd9` (health `0x18`, lives 2), are **full game restarts, not level transitions**. So a weapon is *carried* between worlds while its count is reset underneath it, and a carried weapon's volley becomes `1 + (imageCount − thatWorld's Power)`. For the axe entering world 3 that is `1 + (4 − 12)` → a **3-projectile spread**, where freshly picking the same axe up gives one. ~~`UNKNOWN_carried_weapon_volley`~~ — **observable half CLOSED `[PROVEN]` live (2026-09-29); intent retired as unprovable.** In `PJOYL3`'s world 3A the axe (index 7) was put in slot A with no pickup, which is exactly the carried state: the axe record's `+6` = 12 (world 3's Power) and `+8` = 4. Every volley then spawned **three** records, directions 1/0/2 (straight, up, down). The control, `+8 := +6` (what a fresh pickup leaves, `CS:0x9115`), spawned **one** (`tools/attract-capture/volley_live.py`). `bp` is computed at `CS:0x98D1` and the `dec bp / jz` pair sits at `0x98EF`/`0x9905`. `PWEAPONS.003`'s own axe `+8` is also 4, so this run doesn't separately prove the load-time pin. The port models both paths.

⚠️ **This still overturns the per-weapon volley table.** A port must NOT derive the volley size from the shipped files or from the pinned EXE values: `CS:0x9115` overwrites `+0x08` the instant a weapon is picked up, so **every weapon starts at one projectile whatever was loaded**, and the loaded state is never fired from. An earlier revision of the port derived a per-world spread from the files (including "the axe fires 3 in worlds 3–4"); that was reading state the pickup path discards. The pinning section below is still correct about what the *loader* leaves in the table — it simply never reaches gameplay.

### ⚠️ THREE `PWEAPONS` fields are pinned at the EXE-image value, not two `[STATIC]`

> **Tag discipline, deliberately applied.** The *divergence* between file and image is `[PROVEN]` — both byte sets were read and diffed. But **"the game therefore uses the image value" is a reading of a push/pop loop, not an execution**, so this section is `[STATIC]` under this document's own rules. That matters more than usual here, because this reading was used to **overturn behaviour already shipped in the port on the same pass** — precisely the case the project directive names when it says static analysis can mislead.
>
> **To promote it:** breakpoint `CS:0x3692` (the restore store, `mov [si],ax`). It should hit **11 times**, with `SI` walking `0xe5de → 0xe2be` in `−0x50` steps and `AX` carrying the byte-swapped image values. World-independent, so it settles on level 1 without reaching world 3 or 4.

This document recorded `+0x0c` and `+0x1e` as pinned and **missed `+0x08`** — which is exactly the field the volley branch above subtracts from. The loader `CS:0x35e9` (sublevel `'a'` only, `cmp byte [0x43],0 / jnz`) brackets the file load with **two independent mechanisms**:

| fields | mechanism |
|---|---|
| `+0x0c`, `+0x1e` | `CS:0x35b7` copies both out of all 11 records to a scratch at `DS:0x2f76`; `CS:0x35d0`, called at the very end of `CS:0x366d`, copies them back |
| **`+0x08`** | `CS:0x367a`–`0x3682` **pushes** it from all 11 records, calls the loader, then pops and stores it back with a compensating `xchg al,ah` (`CS:0x368f`) so the later 32-byte swap pass returns it to its native value |

The save/restore ordering is unambiguous at the call-graph level: `CS:0x2a79 call 0x35b7` (save) sits **immediately before** `CS:0x2a80 call 0x35e9` (the loader, which ends by calling `0x35d0` to restore), and each of `0x35b7`/`0x35d0`/`0x35e9` has **exactly one caller**. So each `PWEAPONS` file's own copies of all three fields are discarded. Image values, `DS:0xe2b6 + n*0x50`:

```
+0x08   1, 5, 3, 4, 8, 1, 6, 4, 5, 3, 3
+0x0c   331, 339, 343, 347, 363, 369, 373, 377, 385, 426, 437
+0x1e   0, 0, 0, 0, 366, 0, 375, 0, 0, 0, 0
```

**This cost the port a wrong result before it was caught.** Seven of the 44 file records disagree with the image at `+0x08`, all in `PWEAPONS.003`/`.004` — the same authoring drift already recorded for the sprite fields. Reading `+0x08` from the file makes four world-4 weapons fire the wrong number of projectiles **and invents a two-projectile volley that no shipped weapon ever fires**: with the field read correctly the volley size is only ever **1 or 3**, and the `2` branch at `CS:0x9905`, while real code, is **unreachable in shipped data**. An earlier revision of this section claimed weapon 8 (`hunter`) in `.004` was "the only fixture exercising the middle branch" — that fixture was an artefact of reading the discarded value.

The genuine discriminating fixture is the **axe**: 1 projectile in worlds 1–2 and **3 in worlds 3–4**, driven by `Power` (4/4/12/12), which is *not* pinned, against a fixed `+0x08` of 4. Two corroborations that these are the right bytes: `+0x0c` lands in 331–437, inside the `POBJ2` descriptor range (#331–#449), and `+0x1e` is zero for every weapon except the two that visibly have a second sprite — `lightning bolt` and `spear`.

⚠️ **Table entries 4, 5 and 18 are NULL**, and weapon 3 (**`flame`**) points at 4/5 — a `call cx` with `cx = 0` would jump to `CS:0x0000`. **It is unreachable in the shipped game**: a census of all 200 object records in all eight maps finds **55 weapon pickups of 9 distinct types**, and **type 3 is not among them**. (That 55/9 matches this document's independently recorded figure.) Type 9, `magic axe`, is also unplaced but its handlers 14/15 are real code. The consistent reading is a **cut weapon whose handler was never written**. A port should refuse rather than emulate the wild jump.


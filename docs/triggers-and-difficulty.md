# Difficulty, trigger predicates/verbs, and levers

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## Difficulty: authored per-trigger, plus one progression scalar `[PROVEN]`

GODS is widely described as having "adaptive difficulty". That is **true in effect but not in mechanism** — there is no global evaluator anywhere in `GAME.EXE`. Two real systems produce the effect:

**1. A progression-driven difficulty scalar `DS:0x365`.** Exactly 10 references. Initialised to 0 (1 when `[0x42]==4`), incremented on level completion (`1000:0445`, clamped to `[2,4]`), and **consumed** as a difficulty multiplier at only two adjacent instructions inside damage resolution (`1000:ab56`/`ab63`) — though it is also read by its own clamp logic at `0x449`/`0x455`, so "two reads in the whole binary" (an earlier claim here) was wrong; there are four reads across ten reference sites. Net damage multiplier by value: **1.00, 0.75, 0.50, 0.25, 0.25** — i.e. **the hero deals less damage as the scalar rises**; see the correction below for why the shift is the amount *forgiven* rather than the amount dealt, ⚠️ and why those figures are the **asymptotic** ratio rather than what a creature touch actually costs. Its inputs are **level progression only** — never health, lives, deaths, time or score. Corroborated by the game's own hint text: `"and the game gets more difficult too"`.

**2. Performance conditions authored into individual trigger records.** The section-4 trigger table genuinely gates spawns on how the player is doing — as level data, per trigger. Decoded examples:

- `PLEV1A #28` — `ACT=0 spawn(type=54)`, message `"help bonus"`, conditions `score ≤ 24*5000` **and** `timer/17 > 24*5` → help for a slow, low-scoring player.
- `PLEV1A #6` — `ACT=0 spawn(type=5)`, message `"speed bonus"`, condition `timer/17 ≤ 12*5` → reward for a fast player.
- Other `"help bonus"` triggers gate on **health** `[0x192]` and lives `[0x224]` — see *`UNKNOWN_DS_0192` — CLOSED*.

⚠️⚠️ **A CORRECTION TO A CORRECTION — the shifted value is NOT the damage** `[PROVEN]`. This section has now held the multipliers two different ways, and **both were wrong**, because both were read off `shr bx,cl` in isolation. The full bracket, re-read here instruction by instruction:

```
ab56  cmp byte [0x365],0 / jz 0xab92    ; scalar 0 -> the simple path
ab5d  push bp                           ; save the target's HP
ab5e  sub bp,bx                         ; bp = HP - RAW      <-- SUBTRACT FIRST
ab60  mov cx,3
ab63  sub cl,[0x365]                    ; cl = 3 - scalar   (a BYTE subtract)
ab67  jns 0xab6b / ab69 sub cx,cx       ; clamp at 0
ab6b  push bx                           ; save RAW
ab6c  shr bx,cl                         ; bx = RAW >> cl    (LOGICAL shift)
ab6e  push si / mov si,sp
ab71  cmp bx,[ss:si+0x2]                ; vs the saved RAW
ab76  jnz 0xab82                        ; the shift changed it -> keep bx
ab78  mov cx,bx / shr bx,1 / sub cx,bx / sar cx,1 / add bx,cx   ; else bx = 3/4 RAW
ab82  add sp,0x2 / ab85 pop cx          ; cx = the saved HP
ab86  add bp,bx                         ; bp = (HP - RAW) + bx  <-- ADDED BACK
ab88  js 0xab98 / ab8a jz 0xab98        ; <= 0 -> the death path
ab8c  sub cx,bp / mov bx,cx             ; the damage REPORTED is HP - newHP
ab92  sub bp,bx                         ; scalar 0: the full raw damage
```

`bp` is the target's HP, in and out (`0xffa2` loads it, `0xffb4` writes it back). The routine subtracts the **raw** damage at `0xab5e` and adds the **shifted** value back at `0xab86` — so the shift is the amount **forgiven**, not the amount dealt. Applied damage is `raw − (raw >> cl)`:

| scalar | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| `cl` | — | 2 | 1 | 0 | 0 |
| forgiven | — | raw/4 | raw/2 | ¾ raw | ¾ raw |
| **multiplier** | **1.00** | **0.75** | **0.50** | **0.25** | **0.25** |

which is the *original* table, with the intuitive direction: **as the scalar rises the hero deals less damage.** The clamp was re-read too — `0x0445 inc byte [0x365]`, then `0x0449 cmp 2 / jnl` raises it to 2 and `0x0455 cmp 4 / jl` caps it at 4 — so the sequence a player meets is **0, 2, 3, 4, 4** → a monotone **1.00 → 0.50 → 0.25 → 0.25**. **Enemies are toughest at the end**, which is also the only reading consistent with the game's own hint text *"and the game gets more difficult too"*.

⚠️ **The multipliers above are ASYMPTOTIC, and at shipped damage magnitudes they are not what the hero meets** `[PROVEN]`. `forgiven` is an integer shift, so the clean fraction only lands when `raw` is divisible by the relevant power of two; otherwise it floors and the applied damage is proportionally **higher**. That is not academic, because System-B contact damage is `((HP + 1) >> 5) + 5` — i.e. `raw` runs **5..13**, squarely in the deviating range:

| `raw` | 5 | 6 | 8 | 10 | 13 | 1000 |
|---|---|---|---|---|---|---|
| applied at scalar 3 | 2 | 2 | 2 | 3 | 4 | 250 |
| **effective multiplier** | **0.40** | **0.33** | **0.25** | **0.30** | **0.31** | 0.25 |

So the endgame scalar forgives roughly a **third**, not three quarters, of a typical creature touch. The clean table is the limit (mean ratio over `raw` 1..4000 is 1.0000 / 0.7508 / 0.5006 / 0.2509 / 0.2509) — **a port must implement the shift, not the fraction.**

⚠️ **And there is a SECOND, UNCLAMPED incrementer** `[PROVEN]`. The byte pattern `FE 06 65 03` (`inc byte [0x365]`) occurs **exactly twice** in the image: `CS:0x0445`, which is followed by the `cmp 2 / jnl` … `cmp 4 / jl` clamp pair this section already records, and **`CS:0xD5F7`, which is followed immediately by `C3` (`RET`)** — it increments and returns, with no clamp at all. It cannot change any multiplier: `cl` saturates at 0, so every scalar from 3 upward gives the same result.

`UNKNOWN_365_second_incrementer` — **CLOSED negative: `CS:0xD5F7` is unreachable dead code `[STATIC, exhaustive]`.** Both `get_xrefs_to(1000:d5f7)` and a `search_instructions` sweep for the operand `d5f7` return zero hits — no near `CALL`/`JMP` anywhere in the image targets it. A separate raw byte-pattern search for the little-endian word `F7 D5` across all four initialized code blocks (152384 bytes, the whole image) also returns zero matches, so the address isn't parked in any jump table, dispatch table, or computed-call slot either — every other instance of a computed call in this codebase (trigger ACTION/CONDITION tables, the sound-driver export tables, the graphics export table, `DS:0xd95c`, `DS:0xdbe0`, …) stores its target as exactly this kind of raw little-endian word, so this sweep is the same check that would have found it. **No code path in the shipped `GAME.EXE` can ever reach `CS:0xD5F7`** — it is a second, harmless-if-called-but-never-called copy of the same `inc byte[0x365]` instruction sequence, sitting in the image without ever being wired to anything.

> **The transferable lesson, worth more than the numbers:** an instruction that looks like it computes the answer may be computing a *correction* to it. Reading `shr bx,cl` and asking "what multiplier is this?" produced a confident wrong answer twice, in opposite directions. The `push bp` / `sub bp,bx` … `add bp,bx` bracket is the evidence, and it is 40 bytes away from the shift.

`bx` is the raw damage from `DS:0x1ea` and `bp` the target's HP, restored from `DS:0x1ec` at `0xac53`.

⚠️ **This whole bracket belongs to the WEAPON-vs-CREATURE grid scan, not the hero-contact box test — a genuine ambiguity in how this section was worded, not just a reader's mistake, since it stood next to *"The damage routine CS:0xac59"* with no explicit disambiguation and the debris section elsewhere in this document (under `CS:0x8b4c`) went on to wrongly say `0xAC4C` sits "inside the shared contact/damage routine `CS:0xac59`".** Traced the full call chain fresh, since getting this wrong would have misdirected a port's `attackHero()`:

```
CS:0xa9e4  call 0xac59            ; the hero-contact BOX TEST (a small, self-contained
                                   ; routine with its own early RETs at 0xACBB/0xACD7/…) —
                                   ; already documented under "The damage routine CS:0xac59"
CS:0xa9e7  cmp bp,0 / jns 0xa9ef  ; bp UNCHANGED on a REJECT (no overlap) — ac59 never
                                   ; touches bp on that path, only on a HIT
CS:0xa9ec  jmp 0xabc0             ; HIT -> sound, return (this document's own existing note)
CS:0xa9ef  ...                    ; REJECT -> the DAMAGE-GRID SCAN begins here, using the
                                   ; SAME bp untouched by ac59 — i.e. the creature's own HP
                                   ; (CS:0xff93 sets it once, at 0xffa2, before EITHER path runs)
...        (CS:0xaad1-0xab3f, "the scanner", already documented)
CS:0xab40  call 0x9320            ; a HIT -> the tag decode, sets DS:0x1ea
CS:0xab56  ...                    ; THIS bracket — applies the scalar to raw damage from
                                   ; DS:0x1ea against the SAME bp (creature HP)
```

So `CS:0xac59` (hero-contact) and this bracket (weapon-vs-creature) are **two different consumers of one shared `bp`**, not one routine — `ac59` is CALLED and RETURNS before the scan even starts, and everything from `0xa9ef` onward (the scan, the tag decode, this bracket, and the `CS:0xABDA-0xAC58` tail including the `CS:0xAC4C` debris spark) is a separate, larger body of code that happens to sit at LOWER addresses than `ac59` despite running AFTER it. The practical upshot for a port: **the difficulty scalar and the "hit lands, target survives with reduced HP" mechanic apply ONLY to a weapon hitting a creature, never to a creature touching the hero** — `attackHero()`/`CS:0xac59` needs no difficulty-scalar or survival logic of its own; that model belongs entirely to the grid-scan side (`creatureScansGrid` in `gods-web`, which already implemented it correctly before this correction was written — the only piece genuinely missing was the `CS:0xAC4C` debris spark on the survive case, now closed, see *`DS:0x8b4c` — debris*).

So a port reproduces this by **evaluating the shipped trigger records**, not by writing a balance function.

### Trigger verbs decoded so far

First-pass ACTION-verb table, superseded by the complete decode below (*The 15 trigger ACTION verbs* / *The 17 trigger CONDITION predicates* — `UNKNOWN_map_trigger_verbs` is CLOSED). Kept for the verb-count census (across 756 live records: `203/4/75/75/3/134/25/60/48/18/7/6/8/77/13`):

| Slot | Meaning |
|---|---|
| ACT 0 | spawn object, `arg` = object type |
| ACT 6 | kill category-4 objects near the record's point |
| ACT 7 / 8 | write `word [0x2f8c + n*6 + 4]` (a flag array **no condition reads**) |
| COND 1 / 2 | inventory check — 4 compares against `DS:0x17e`…`0x184` |
| COND 9 / 10 | level timer — `uint32/17` vs `arg*5` |
| COND 11 / 12 | lever bit — `test byte [0xa5f8 + dx*6 + 4],1` |

## The 17 trigger CONDITION predicates `[PROVEN]`

Table `SS:0x35b0` (file `0x22B10`). The handlers occupy `1000:3bc1` and `1000:3e69`–`1000:4019` **contiguously with no gaps**, which independently confirms the set is complete.

**Result convention:** each slot byte (`DS:0x3a3`/`0x3a4`/`0x3a5`) is pre-initialised to `0xFF`; a predicate signals **FAIL by writing 0** and PASS by doing nothing. The three are ANDed and tested for the **sign bit**. Clearing is monotone, so no handler ever needs to write `0xFF`.

| # | Addr | Reads | PASS when |
|---|---|---|---|
| 0 | `3bc1` | — | **always** (a bare `RET`; the "unused slot") |
| 1 / 2 | `3e69` / `3e88` | inventory `0x17e`…`0x184` | arg **is** / **is not** in inventory |
| 3 / 4 | `3ea8` / `3ec1` | `0xdd10`, `0xdda2`, `0xde34` | arg **matches** / **matches none** of the 3 slots |
| 5 / 6 | `3edb` / `3ef7` | event word `[0x932c + (arg−1)*4]` | word **< 0** / **≥ 0** |
| 7 / 8 | `3f13` / `3f21` | **health** `[0x192]` | value **>** / **<** arg |
| 9 / 10 | `3f2f` / `3f51` | 32-bit timer `[0x11e]:[0x120]` | `timer/17` **>** / **<** `arg*5` |
| 11 / 12 | `3f6c` / `3f87` | `byte [0xa5f8 + arg*6 + 4]` | lever bit0 **set** / **clear** |
| 13 / 14 | `3fbe` / `3ff1` | BCD score `[0x3b5]`…`[0x3b8]` | threshold **<** / **>** score |
| 15 / 16 | `3fa2` / `3fb0` | lives `[0x224]` | lives **>** / **<** arg |

**Every pair is strict — equality FAILS both members.** Getting a polarity backwards would invert level logic, so a port must copy the table rather than infer it.

Two implementation notes: the dispatcher at `1000:3a58` has **no bounds check** on `cond_kind`; and the FAIL store is a **word**, so slot *n* also zeroes byte *n+1*. Because clearing is monotone the spill can never change a verdict, so **a port may safely use byte writes**.

`COND0` accounts for 1207 of the 2268 condition slots in shipped data — most records use fewer than three conditions. Its argument is ignored, so nonzero args on those slots are dead editor data.

## The 15 trigger ACTION verbs `[PROVEN]`

Table `SS:0x3592` (file `0x22AF2`). The evaluator **tail-jumps** into the handler (`1000:3a56 jmp bp`), and runs three shared steps first: show `[di+0x14]`'s message (guarded by the *sign* of `DS:0xac00[id]` plus an empty-string test — **not** `id != 0`); `call 0x3aeb` key-consume, only for actions {2,3,4,7,8}; `call 0x3a69` inventory-consume, only when action bit15 is set.

| # | Addr | Arg `[di+0x12]` | Effect | n |
|---|---|---|---|---|
| 0 | `3da1` | object type | spawn object into `DS:0x8314` via allocator `0x38d7` | 203 |
| 1 | `3e08` | weapon idx (stored `+0xC0`) | spawn weapon pickup | 4 |
| 2 | `4276` | — | **open a 2×3 door** — writes plane A and clears plane B (passable) | 75 |
| 3 | `3d56` | packed dest `(col<<8)\|row` | create teleport zone in `DS:0x8f68` | 75 |
| 4 | `3d12` | zone arg | create level-exit zone in `DS:0x8f68` | 3 |
| 5 | `3d08` | event index | `jmp 0x6029` — dispatch a `DS:0x932c` event | 134 |
| 6 | `3bd1` | — | kill ≤2 category-4 objects near the point | 25 |
| 7 | `4144` | — | gate open: `DS:0x2f8c[n].state=1`, plane A/B updated | 60 |
| 8 | `4180` | — | gate close: `DS:0x2f8c[n].state=0` | 48 |
| 9 | `42e7` | — | **close a 2×3 door** | 18 |
| 10 | `3e3f` | weapon id | clear whichever of `0xdd10`/`0xdda2`/`0xde34` matches | 7 |
| 11, 12, 13 | `3bcf`, `3bd0`, `3bc1` | — | **three separate single `C3` bytes** — no-ops | 6, 8, 77 |
| 14 | `3bc2` | — | zero the 32-bit level timer | 13 |

`ACT13`'s 77 records are not inert: 52 carry real text (`"treasure room"`, `"you need the treasure key"`), so it is the **message / precondition-gate** verb. `ACT11`/`ACT12`'s 14 records have no text and are genuinely inert in the shipped data.

**Clean negatives:** no action verb calls the random source `0x3836`, and none writes the lever table, the descriptors, or the entity array.

### `UNKNOWN_planeB_id_range` — RESOLVED `[PROVEN]`

`0x6022` (`sub al,3`) **falls straight through** into `0x6029` (`mov si,0x932c`), and its only other caller is the per-frame plane-B scan at `0x5fd7`–`0x601e`, which calls it only when `byte[si] > 2`. Therefore:

> **A plane-B cell value `v ≥ 3` is an event id**, dispatching `DS:0x932c` record `v − 3`.

That explains the census exactly: plane B's `0`/`1`/`2` are empty/solid/climbable (97 % of cells), and the thin spread over 3–254 is per-cell **event ids**, as suspected. `ACT5` reaches the same table with `arg − 1`, so `arg = planeB − 2`.

### ⚠️ The selector dispatch is **1-BASED** — `handler = SS:0x3570[selector − 1]` `[PROVEN]`

This is the most consequential correction in the document. An earlier revision said "the selector indexes the jump table at `SS:0x3570`; entry [2] is `0x39ae`". The **entry** was right; the inference that *selector value 2* reaches it was wrong. `CS:0x603A` does a `dec ax` first:

```
6022  push si
6025  mov al,[si] / 6027 sub al,3        ; -> event record index
6029  mov si,0x932c
602C  shl ax,1 (x2) / add si,ax          ; 4-byte records
6032  mov ax,[si]                        ; selector
6034  or ax,ax / js 0x6047 / jz 0x6047   ; consumed (0xFFFF) / empty (0) -> skip
603A  DEC AX                             ; <-- the 1-based bias
603B  shl ax,1 / mov di,0x3570 / add di,ax
6042  mov ax,[ss:di] / call ax           ; NO upper-bound check
```

So the trigger evaluator is **selector 3, not 2** — which dissolves the `PLEV3A` paradox (it dispatches 82 triggers, not zero). Getting this wrong makes selector 4, a System-B entity-group spawn, look like the trigger evaluator. **Apply the correction exactly once.**

| sel | idx | handler | effect | param |
|---|---|---|---|---|
| 1 | 0 | `0xb908` | spawn from PALFILS `+0x0000` (`DS:0x9008`) → runtime `DS:0xb6b8` | < 100 |
| 2 | 1 | `0xad06` | spawn from PALFILS `+0x0718` (`DS:0x9720`) → runtime `DS:0xaec0` | < 100 |
| **3** | 2 | `0x39ae` | **trigger evaluator** (the 100 × 24 B table at `DS:0x7004`) | < 100 |
| 4 | 3 | `0xde08` | activate **System-B** entity group → `SS:0x36b4` | < 50 |
| 5 | 4 | `0xde42` | activate **System-A** entity group → `SS:0x3768` | < 50 |
| 6 | 5 | `0x38f5` | progress / position marker (param never read) | 0 |
| 7–10 | 6–9 | `0x75fc/7600/7605/760a` | four entry points into one body, `CX = sel − 7` | < 25 |
| 11 | 10 | `0xc49c` | install per-world scripted routine via `SS:0x537a[world−1]` | 0 |

**The table is 11 entries.** The immediate `0x3570` occurs exactly once file-wide (`CS:0x603D`); the words from index 11 belong to a different table at `SS:0x3586` whose sole consumer is `CS:0xAE7C`.

**The shipped data forces the same reading independently.** Across all 2024 records in the 8 `PALFILS` files the selector census is `0:281 1:137 2:406 3:727 4:217 5:57 6:8 7:80 8:74 9:26 10:3 11:8` — **maximum 11, exactly the table size**, which under 0-based would dispatch into the foreign table. And each selector's maximum param lands exactly where its handler's table requires: `1/2/3 → 99` (three different 100-entry tables), `4 → 49` (a 50-record window), `7–10 → 23/23/13/1` (a 25-record window). Selector 0 is an **empty slot**, dropped by the `jz`.

**Endianness.** On disk the records are big-endian. The original packs each field to one byte (`CS:0x386E`, `lodsw / xchg al,ah / stosb`, 506 words) into a master at `DS:0x8114`, then unpacks to native words (`CS:0x3880`). No shipped field exceeds 255 (verified: 0 of 4048), so reading the big-endian `u16` directly is equivalent.

Three further consequences `[PROVEN]`:

- **Dying re-arms every consumed event.** `CS:0x3880` is called from level load (`CS:0x0095`) *and* from the respawn path (`CS:0x485E`), restoring the pristine master and wiping all `0xFFFF` consume markers.
- **Records 251 and 252 are hard-patched** on every unpack to `{11,0}` and `{6,0}` (`CS:0x3894`), discarding whatever `PALFILS` holds. All 8 shipped files already read exactly that, so it is a no-op on shipped data.
- **Trigger actions write plane B**, so the event map is not immutable. `ACT2` zeroes three cells (`0x42D1`–`0x42E3`), `ACT9` sets them to 1, `ACT7`/`ACT8` write one each. A door opening can erase an event cell permanently.

### `PALFILS` feeds the trigger system `[PROVEN]`

The 7000-byte front region — previously `UNKNOWN_alfils_record_fields` — is not one array. `1000:2aa6` copies it (`rep movsb`, `cx=0x1b58`) to **`DS:0x9008`**, and three known tables are windows into it:

| PALFILS off | DS addr | Stride | Count | Consumer / role |
|---|---|---|---|---|
| `0x0000` | `0x9008` | 8 | 100 | spawn table; runtime `DS:0xb6b8` stride `0x1c`, 5 slots |
| `0x0324` | `0x932c` | 4 | 253 | **event records**, dispatched via `SS:0x3570` |
| `0x0718` | `0x9720` | `0x10` | 100 | spawner `0xad0d`; runtime `DS:0xaec0` stride `0x20` |
| `0x0D58` | `0x9d60` | `0x16` | **50** | **System-A group descriptors** → runtime `SS:0x3768` stride `0xe4`, 10 slots |
| `0x11A4` | `0xa1ac` | `0x16` | **50** | **System-B group descriptors** → runtime `SS:0x36b4` stride `0x12`, 10 slots |
| `0x15F0` | `0xa5f8` | 6 | 64 | **levers** `{x, y, object_type}`, BE→native at `0x2acf`; `+4` bit0 = state |
| `0x1770` | `0xa778` | 6 | 30 | `{key, x, y}` lookup at `0x6241` |
| `0x1824` | `0xa82c` | 6 | **20** | **trap doors** — see below |
| `0x189C` | `0xa8a4` | `0x1c` | 25 | selector-7–10 line-barrier table — see below |
| `0x1B58` | `0xab60` | 2 | 40 | hint **trigger values** (BE `i16`) |
| `0x1BA8` | arena `DS:[0x14c]` | `0x28` | 40 | hint **text**, ASCIIZ |

**The accounting closes:** `804 + 1012 + 1600 + 1100 + 1100 + 384 + 180 + 120 + 700 = 7000 = 0x1B58`, and `+80 + 1600 + 80 = 8760`. Every region abuts the next exactly, and each count was taken from a loop immediate in code, not fitted to the data. **6996 of the 7000 front bytes are accounted for**; the only gaps are `UNKNOWN_palfils_0320` — see below — and `UNKNOWN_palfils_tail` (the 80-byte all-zero tail at `0x21E8`).

### `0x189C`, selectors 7–10 — a second, independent line-barrier system, CLOSED `[PROVEN]`

⚠️ **Corrects the row's own earlier phrasing.** "Handed to the driver via `DS:0x7a`" was the extent of what was known before this pass — `CS:0x2963 mov word[0x7a],0xa8a4` (and two more sites, `CS:0x2AE0`/`CS:0x76A8`) genuinely stash this table's base pointer there, but nothing downstream of `[0x7a]` was ever traced, and the phrase reads more like a driver-export hand-off than what this actually is.

**Selectors 7–10 (`sel−7 = idx 6–9`) share ONE body**, `CS:0x75FC`/`0x7600`/`0x7605`/`0x760A` → `CS:0x760D`–`0x7679`, entered with `CX = sel−7` (0–3) and the triggering event's own `param` field (`[si+2]`) as the table index:

```
75FC  sub cx,cx          ; sel 7 -> CX=0
7600  mov cx,1           ; sel 8 -> CX=1
7605  mov cx,2           ; sel 9 -> CX=2
760A  mov cx,3           ; sel 10 -> CX=3
760D  mov ax,[si+2]      ; index = event param
7612  di = 0xa8a4 + ax*0x1c
761B  ax = [di+6] | [di+0xa] | [di+0xe] | [di+0x12]   ; liveness: X of all 4 target points
7627  jnz 762a / else RET
762A  [si] = 0xffff      ; consume the event
7635  self-modify CS:[767a] 0xc3->0x90  ; ARM the per-frame rescan gate (same idiom as CS:0xAD88)
7669  call 78c2          ; dispatch table25[+0x16+CX] -> obstacle "type" handler
765a  n = table25[+5]+1; [0x1f0] = n
7670  call 7a2a          ; the SEED — see below
```

**The 28-byte record** (fields confirmed by cross-referencing all 8 shipped `PALFILS` files against their own event tables — see below):

| off | width | field |
|---|---|---|
| `+0x00` | BE u16 | source X |
| `+0x02` | BE u16 | source Y |
| `+0x04` | byte | not read by this code path — `UNKNOWN_189c_field04` |
| `+0x05` | byte | step budget seed; `n = value+1`, written to `word[0x1f0]` |
| `+0x06/+0x08` | BE u16 pair | target point 0 (used by **selector 7**) |
| `+0x0a/+0x0c` | BE u16 pair | target point 1 (used by **selector 8**) |
| `+0x0e/+0x10` | BE u16 pair | target point 2 (used by **selector 9**) |
| `+0x12/+0x14` | BE u16 pair | target point 3 (used by **selector 10**) |
| `+0x16..+0x19` | 4 bytes | obstacle "type", one per selector 7/8/9/10 — signed byte, `CS:0x78C2` doubles it and indexes an SS-table at `2f3d:35ec` |
| `+0x1a` | byte | low 3 bits = width in cells −1; bit 7 = skip the plane-B solid stamp (`FUN_1000_77d6`'s own test) |
| `+0x1b` | byte | extra rows −1 |

**The mechanism**, read from `CS:0x760D`–`0x7679` and the per-frame rescan at `CS:0x767B`–`0x76FF` (gated by a self-modifying `nop`/`ret` at `CS:0x767A`, the same idiom already documented for `CS:0xAD88`): this is a **second, independent Bresenham line stepper**. `CS:0x7A2A` is the seed — same shape as the already-documented line-hazard seed `CS:0xDCE1` (classic `dx`/`dy`/sign/`err` math, one of 4 near-identical loop bodies chosen by axis-major/direction, its own entry address written into the runtime slot as a resume pointer) — but its own 4 loop-body addresses (`0x7a4d`/`0x7a90`/`0x7ae8`/`0x7b2c`) are distinct from `0xdce1`'s (`0xdd04`/`0xdd43`/`0xdd95`/`0xddd3`). Per-tick resume is `FUN_1000_7845`, which calls the **shared** walker `CS:0x7A0B` — the exact function the already-documented line-hazard system's own per-tick resume already uses — so this system reuses that one shared walker with its OWN seed. The runtime mirror table is `DS:0x1ca6`, stride `0x18` (24 bytes), 25 slots, `+4` sign bit = free/active.

Each step along the line: `FUN_1000_7720` bounds-checks against a fixed on-screen box and a second, class-relative box (`[si+0x1a]`/`[si+0x1b]` scaled) and sets `byte[0x395]=0xff` on overlap (a hero-hit/hit-test flag); `FUN_1000_77d6` stamps a `width×height` block of plane-B cells solid (skipped when `+0x1a` bit 7 is set); `FUN_1000_7779` draws a matching `width×height` grid of sprites through the shared graphics-export-1 thunk `CS:0x3569` (`FUN_1000_3569`, the same export selector-2's own draw already uses).

**The obstacle "type" dispatch, `UNKNOWN_189c_type_dispatch` — CLOSED `[PROVEN]`.** `2f3d:35ec` (Table 2 — **not** `1000:35ec`, which resolves into code and returns garbage) holds exactly 11 valid entries, `0x78e9`/`0x790e`/`0x7933`/`0x794e`/`0x7969`/`0x7984`/`0x790e`(repeat)/`0x799f`/`0x79ba`/`0x79d5`/`0x79f0` (types 0–10) — plus a 12th, deliberate sentinel one word *before* the table, `2f3d:35ea` = `0x78dc`, reached because the dispatcher (`CS:0x78C2`) loads the type byte with `CBW` (sign-extend) before doubling it: a **type value of `0xFF`/`-1`** lands exactly on `table[-1]`. All 12 are now disassembled — see *The full `+0x16..+0x19` type enum* below.

**The full `+0x16..+0x19` type enum:**

| type | handler | reads point | on x==0, falls to | behaviour (`DI+4`) |
|---|---|---|---|---|
| 0 | `0x78e9` | *(cycles — see `UNKNOWN_189c_motion` below)* | — | cycle forward |
| 1 | `0x790e` | *(cycles)* | — | cycle backward |
| 2 | `0x7933` | point 0 | → type 3 | settle |
| 3 | `0x794e` | point 1 | → type 4 | settle |
| 4 | `0x7969` | point 2 | → type 5 | settle |
| 5 | `0x7984` | point 3 | → type 2 (wraps) | settle |
| 6 | `0x790e` | *(cycles, same as type 1)* | — | cycle backward |
| 7 | `0x799f` | point 0 | → type 10 | settle |
| 8 | `0x79ba` | point 1 | → type 7 | settle |
| 9 | `0x79d5` | point 2 | → type 8 | settle |
| 10 | `0x79f0` | point 3 | → type 9 (wraps) | settle |
| `0xFF` | `0x78dc` | — | — | disable/cancel (see `UNKNOWN_189c_motion`) |

Types 2-5 and 7-10 are two independent 4-member fallback rings (forward-search from point 0, backward-search from point 1) that both always resolve to `DI+4=2` ("settle") once a non-degenerate point is found — they differ only in *which* point a given type prefers before falling back, letting a level author wire any selector to "the first populated point starting here" without caring which of the record's 4 slots are actually filled. See `UNKNOWN_189c_motion` for what `DI+4` controls and the full cycle-vs-settle behaviour this drives.

**Cross-checked against shipped data.** Decompressing all 8 `PALFILS` files and joining the `0x0324` event table (records with selector ∈ {7,8,9,10}) against this table: **live indices span exactly 0–23** (never 24 — matches this document's own already-published selector census, "7–10 → 23/23/13/1" max param), 84 genuinely-authored records total. Most records populate only point 0 (and often point 1); points 2/3 are frequently `(0,0)` or visibly-uninitialized bytes (repeating `0x2020`/`0xffff`, ASCII space pairs) on records whose triggering selector never reaches 9/10 in that file — consistent with selectors 9/10 being rarely authored (the event census already showed selector 10 placed only twice across all 8 files). Observed live-record ranges: step budget `n` ∈ {1..12}, width ∈ {1..5} cells, rows ∈ {1..4}, `solid=false` only on single-point (zero-length, stationary) records. This reads as **scripted, trigger-activated wall/barrier hazards** — a short Bresenham-drawn line from a fixed point, stamped solid and sprite-filled, one to four selectable directions per emitter — plausibly the mechanism behind GODS's scripted diagonal energy-wall obstacles.

Traced from the disassembly (`GAME.EXE`, Ghidra) and cross-validated against all 8 shipped `PALFILS.0{A,B}{1-4}` files (`blast.py` decompression + a byte-level join against the event table).

#### Now confirmed live under DOSBox — and it fires on frame one of the game `[PROVEN]`

The `[STATIC]` tag above was retired by a live trace, prompted by a rendering difference between `gods-web` and the real game. **`PLEV1A`'s very first path job is armed by the hero's own spawn cell**, so this system is running in every frame the player ever sees:

- Plane B at `PLEV1A` **(col 2, row 59) = world (64, 944) holds 225** — and `(64, 944)` is exactly world 1's hardcoded spawn point (`DS:0xe8ca`). A plane-B value ≥ 3 dispatches event `v − 3` = **222**. The probe's own rounding puts the hero there: `CS:0x5FB2` takes `col = (X + 16) >> 5 = (64+16) >> 5 = 2` and `row = Y >> 4 = 944 >> 4 = 59` (see *The plane-B event probe rounds X but floors Y* in `docs/camera-and-world-nav.md`) — **not** the `(X + 0x10, Y + 0x28)` hot point, which would land in row 61 and miss the cell entirely.
- **Observed with zero game input.** Booting `GODS.EXE` through the intro to `GAME.EXE` and reading memory without ever sending an arrow key: hero still at `DS:0x17a/0x17c = (64, 944)`, camera `DS:0xa/0xc = (0, 864)` (the opening view), runtime slot 2 already live, and live plane B at (col 5, row 52) already `1`. So this barrier is on screen in the level's very first frame, before the player can act — which is why it shows in any screenshot of the opening area.
- `PALFILS.0A1` event #222 = `{selector 8, param 2}` → `CS:0x7600` (`CX = 1`) → record **2** of this table: `src = (160, 832)`, selector-8 target point = `(160, 832)` — **zero-length, stationary**, `width = 1` cell, `rows = 1`, step budget seed `0` (`n = 1`).
- Live at that moment, the runtime mirror `DS:0x1ca6` slot 2 (`+ 2*0x18 = DS:0x1cd6`) reads `a0 00 40 03 02 ff 4d 7a …` — `(160, 832)`, the `+4` word's sign bit set (active), and the resume pointer **`0x7a4d`**, which is the first of the four loop-body addresses this section already predicted for the `CS:0x7A2A` seed. Every other slot reads the free pattern `ff ff ff ff ff 00 …`.
- **Both documented effects were observed.** `FUN_1000_77d6`'s plane-B stamp: the `.MAP` file has plane B `= 0` at (col 5, row 52) and **live memory has `1`** (record 2 has `+0x1a` bit 7 clear, so the stamp is not skipped). `FUN_1000_7779`'s sprite grid: one tile-sized masonry graphic is drawn at world (160, 832) every frame.
- **Three-way live probe, each step decisive.** (1) Overwriting live plane A at (col 5, row 52) with a ladder tile and forcing a full off-screen redraw left the masonry unchanged — so it is *not* a plane-A tile. (2) The same edit applied at (col 8, row 52) *did* change on screen, proving the redraw path reads `DS:0x3004` and that the probe was valid. (3) Writing the free pattern into `DS:0x1cd6` made the masonry disappear on the next frame and revealed plane A's real tile underneath. Record 2's selector-8 type is `3`; this live capture is also the exact byte-for-byte evidence that closed `UNKNOWN_189c_motion` below — this session's static model of `FUN_1000_794e`/`FUN_1000_7845` reproduces all eight of these bytes (`a0 00 40 03 02 ff 4d 7a`) from nothing but the static record and the type-3 handler, without having been fitted to them.

**A second, independent confirmation on the same level.** `PLEV1A`'s other path-job entry point is plane B (col 3, row 39) = world (96, 624) = **77** → event #74 = `{selector 8, param 0}` → record **0**, predicted barrier at `(1, 480)`. Teleporting the hero to exactly (96, 624) — chosen so the probe's own rounding lands on that cell — made runtime slot **0** go live reading `01 00 e0 01 02 ff 4d 7a` = `(1, 480)`, active, same resume pointer `0x7a4d`. Predicted from the tables before it was read, so this is a genuine second hit, not a re-description of the first.

**Census of what a port that skips this system loses: 99 plane-B cells across the 8 shipped levels dispatch a path job, naming 83 distinct events** — cells/distinct events per level: `1A` 2/2, `1B` 7/5, `2A` 11/6, `2B` 12/8, `3A` 2/2, `3B` 21/19, `4A` 21/20, `4B` 23/21. The two figures differ because `CS:0x762A` consumes the event record (`[si] = 0xffff`) on dispatch, exactly like selectors 1/2/4/5 — so the six `PLEV2A` cells that all name event #24 arm **one** barrier between them, not six. 83 is the count of barriers a port must reproduce; 99 is the count of places the player can arm one. They are not decoration: each can both draw sprites and stamp plane-B cells solid, so omitting them changes collision as well as pixels.

#### `UNKNOWN_189c_motion` — CLOSED: settle or cycle, chosen per-selector by the type byte `[PROVEN]`

**Reaching a target point is not the end of a record's life — `FUN_1000_7845` (the per-tick resume, called every frame for every non-free runtime slot by the rescan loop `CS:0x76BB`–`0x76F5`) checks a runtime field, `DI+4`, to decide what happens next.** Disassembled in full: the arm dispatcher (`CS:0x75FC`–`0x7679`), the type trampoline (`CS:0x78C2`), all 12 type handlers (`CS:0x78DC`–`0x7A0A`), the shared walker (`CS:0x7A0B`) and seed (`CS:0x7A2A`), and the rescan loop itself.

`DI+4` is a **behaviour-class sentinel that the type handler writes, not the type byte itself** (this resolves the earlier live capture's own "type is 3 but the runtime byte reads 2" mismatch — they were never the same field):

| `DI+4` after arrival | Meaning | Set by |
|---|---|---|
| `0` | cycle **forward** through the record's points | type 0 (`0x78E9`) |
| `1` | cycle **backward** | types 1 and 6 (`0x790E`, shared) |
| `2` | **settle** — arrived at a single resolved point, stop forever | types 2/3/4/5/7/8/9/10 |
| `0xFF` | **disabled** — this arm request is cancelled outright | type `0xFF` (`0x78DC`) |

**Settle path** (`DI+4 > 1`, `FUN_1000_7845` at `CS:0x788E`–`0x78AD`): on the tick the Bresenham walk's remaining-distance counter (`[0x1ee]`) goes negative, the record **snaps exactly to its target point's literal coordinates** (`word[DI]`/`word[DI+2] := word[SI+6+4·(DI+5−1)]` — this overrides any Bresenham rounding drift) and sets `byte[DI+5] = 0xFF`. The very next entry to `FUN_1000_7845` for this slot hits `CMP byte[DI+5],0 / JS` at the top and returns immediately, forever — the record holds its position with no further computation, exactly the model `gods-web`'s `line-barriers.js` already implements.

**Cycle path** (`DI+4 ≤ 1`): instead of halting, `FUN_1000_78E9`/`0x790E` bump `DI+5` (the "which of the 4 points" index, 1-based) by `+1`/`-1`, **wrapping** at the 1..4 boundary, then re-seed the same Bresenham walker (`CALL 0x7A2A`) toward the *new* point — the barrier immediately starts walking again. The new point is chosen through the **same validating cascade** types 2-5/7-10 use (`0x35EE`/`0x35F8`-indexed, cascading past any point whose `x == 0`), so a cycling record with only 2 of its 4 points populated correctly ping-pongs between just those two rather than ever detouring through `(0,0)`.

**Sentinel path** (`DI+4 = 0xFF`, `CS:0x78DC`): the type-`0xFF` handler sets `DI+4 = 0xFF` and **decrements the active-obstacle counter** `byte[0x364]` that the arm dispatcher had just incremented — undoing the arm — then falls through to the arm routine's unconditional `CALL 0x7A2A` with `CX := AX, DX := BX` (source coordinates copied onto themselves as the "target"), forcing a degenerate zero-length seed rather than leaving garbage in those registers. `DI+4 = 0xFF` is also exactly the rescan loop's own "slot is free" test (`CS:0x76BF JS`), so a `0xFF`-typed arm request is skipped by every future frame — a genuine, deliberate "consume the event, but don't actually create a barrier" verb, not a bug.

**`UNKNOWN_189c_fresh_arm_index` — CLOSED `[PROVEN]`: what `DI+5` reads on a FRESH arm, before `FUN_1000_78E9`/`0x790E`'s own bump.** The arm dispatcher itself answers this — disassembled in full this session, `CS:0x75FC`–`0x7679`. Two paths converge at `CS:0x765A` depending on whether the runtime slot's OWN `DI+4` was already non-negative at arm time (`CS:0x7648 CMP byte[DI+4],0 / JS 0x7655` — negative/`0xFF` means "never armed," so the source position comes from the record's own static `srcX`/`srcY` at `[SI]`/`[SI+2]`; non-negative means "already active," so the new leg's source is the slot's OWN current position at `[DI]`/`[DI+2]` instead, letting a re-armed barrier continue from wherever it currently sits rather than teleporting back to its static spawn). But **regardless of which path was taken, `CS:0x7665` (`MOV byte[DI+5],0x0`) unconditionally zeroes `DI+5` right before `CALL 0x78C2` dispatches through the type trampoline** — the same single instruction for every arm, settle or cycle alike, with no data-dependent branch of its own. Live-confirmed this session: a breakpoint at `CS:0x7669` (immediately after that write) caught `PLEV1A` record 2's own first-ever arm (`DS:0x1CD6`) — the slot read `x=0xFFFF, y=0xFFFF, DI+4=0xFF` (the genuine "never-armed" sentinel state) immediately beforehand, and `DI+5` read `0x00` immediately after, at that live address, matching the disassembly exactly. Composed with `FUN_1000_78E9`/`0x790E`'s own already-disassembled arithmetic (pure register ops, no further dependency): a fresh forward-cycle (type 0) computes `bVar1 = 0 + 1 = 1`; a fresh backward-cycle (types 1/6) computes `bVar1 = 0 − 1`, which as a signed byte wraps to `4`. `gods-web`'s own `bump1Based(0, direction)` is therefore the PROVEN starting arithmetic, not an inference from an assumed-zeroed slot.

**Cross-checked against all 8 shipped `PALFILS` files' own event tables** (which `(record, selector)` pairs are *actually* named by a live event, not merely present in the 25-record table): of **183 real selector-7–10 dispatches**, **148 are settle-type**, **7 are cycle-type** (type 0 only — types 1/6's backward cycle is real, disassembled code, but is never assigned to any of the 4 type slots across all 25 records in any of the 8 files: code-confirmed, data-unexercised), and **28 use the `0xFF` disable sentinel**.

**Reachability of the 7 shipped cyclers, joined against each level's own plane-B array and `ACT5` trigger table** (same method this document's own `UNKNOWN_palfils_0320` section already established — a table entry existing is not proof it is ever dispatched): **5 of 7 are genuinely reachable, real, moving barriers** —

- `PALFILS.0A2`/`PLEV2A` records 9 and 10 (event indices 197, 208) — plane B `200` at (col 25, row 5) and `211` at (col 6, row 9)
- `PALFILS.0B2`/`PLEV2B` the same two records (worlds A/B share this table's content) — same plane-B cells
- `PALFILS.0B1`/`PLEV1B` record 0 (event 232) — plane B `235`, at **two** cells, (col 70, row 9) and (col 74, row 9)

All 5 are **2-point ping-pongs** (only 2 of the record's 4 target-point slots are non-zero; the cascade transparently skips the other 2) — e.g. `0A2` record 9 patrols between `(1056, 96)` and `(832, 96)`. **The other 2 shipped cycle dispatches are dead content**: `PALFILS.0A4`/`PLEV4A` and `PALFILS.0B4`/`PLEV4B` each have one record 12 (event index 166) with a genuine **4-point patrol** (all 4 targets non-zero, e.g. `(3489,80)→(3488,128)→(3439,103)→(3447,95)`) — but neither `PLEV4A.MAP` nor `PLEV4B.MAP` has a plane-B cell valued 169 or an `ACT5` record with arg 167 anywhere in their 100 trigger records or 8192 plane-B cells, so this more elaborate variant is placed in the static table and never wired to anything a player can reach — the same "authored, never dispatched" shape as `UNKNOWN_palfils_0320` and the world-2 chest-key surplus.

`+0x04` (the byte between the record's source point and its step-budget seed) is still unread by every function this closure examined — `UNKNOWN_189c_field04` stays open, now confirmed against a *complete* read of this system rather than just the arm dispatcher.

**Now implemented in `gods-web`**, `game/line-barriers.js` — the gap that surfaced this whole live-trace (`PLEV1A`'s opening screen missing the left-hand cap of the long platform at row 52) is fixed. Faithful: the plane-B dispatch, the record layout, the selector-indexed target point, and the plane-B solid stamp. The **settle** model is now proven correct, not a safe guess, for 148 of 183 shipped dispatches. **Cycling is also now implemented** (a later pass): the 5 reachable ping-pongs (worlds 1B/2A/2B) travel the real Bresenham line between their points at `stepSeed+1` px/tick, snapping exactly onto each target on arrival, verified against real shipped data (`PALFILS.0A2` record 9 visits both `(1056,96)` and `(832,96)`) — plus a census confirming every one of the 183 real dispatches' type bytes falls in `{-1, 0, 2, 3, 4, 5}`, so `classifyType`'s catch-all "disabled" default for anything else is a defensive fallback that never actually fires on shipped data. The `DI+5` fresh-arm starting index is also now `[PROVEN]` live (see `UNKNOWN_189c_fresh_arm_index` above), closing the one gap the cycling implementation had shipped with. Still disclosed, not built: the system's placement in the per-tick frame order is not pinned to an exact `CS:` call site. **The exact sprite** `FUN_1000_7779` draws is also still unresolved (the type enum's *meaning* is now fully decoded, but not what atlas frame each type's handler ultimately blits) — the port continues to borrow the level's own adjacent solid tile rather than guess an atlas index with no evidentiary basis.

### `UNKNOWN_palfils_0320` — mechanism CLOSED, live-reachability CLOSED (negative) `[PROVEN]`

The 4 bytes are byte-identical `00 02 00 00` in all 8 shipped `PALFILS.0{A,B}{1-4}` files, landing at runtime `DS:0x9328` via the front-region copy `CS:0x2AA3 mov si,0x0 / CS:0x2AA6 mov di,0x9008 / CS:0x2AA9 mov cx,0x1b58 / CS:0x2AAC rep movsb`. No instruction in `GAME.EXE`, `TGAME.EXE`, or any of the other shipped executables references linear address `DS:0x9328`/`0x9329`/`0x932A` via a direct immediate operand — the lone `CS:0x9328`-shaped hits in both binaries are unrelated code addresses (inside the grid damage-tag decoder), not data references.

**But three handlers reach it anyway, via an off-by-one.** `COND5` (`CS:0x3EDB`), `COND6` (`CS:0x3EF7`), and `ACT5` (`CS:0x3D08 → CS:0x6029`) all compute `si = 0x932c + (arg−1)*4` into the PALFILS event table; because the arithmetic is 16-bit, an `arg` of `0` — or, equivalently mod 65536, `16384`/`32768`/`49152` — underflows to exactly `DS:0x9328`. (Checked exhaustively: brute-forcing all 65536 possible `arg` values confirms `{0, 16384, 32768, 49152}` is the complete aliasing set, and none of the three other values occurs anywhere in the 800 shipped `.MAP` trigger records for either handler family.) These 4 bytes are structurally "PALFILS event record −1."

For `COND5`/`COND6` an `arg` of 0 is harmless — it just makes the predicate test the mystery word's sign (`0x0200` is positive, so `COND5` fails and `COND6` passes, silently; zero shipped records use either with an aliasing arg). For `ACT5` it is a genuine wild jump. `CS:0x6029` reads the mystery bytes as a *native* word — they are never byte-swapped, since the pack/unpack loop at `CS:0x386E`/`CS:0x3880` starts exactly at `0x932c` (`mov si/di,0x932c`, `cx=0x1fa`=506 words) and never touches `0x9328` — giving `0x0200` = 512. **Because that value is neither zero nor negative, it fails to trip the routine's own `or ax,ax / js 0x6047 / jz 0x6047` "consumed/empty" guard**, and execution falls through to `dec ax / shl ax,1 / mov di,0x3570 / add di,ax / mov ax,[ss:di] / call ax`, landing on `SS:0x396E` — 1022 bytes past the legitimate 11-entry `SS:0x3570` selector table, and, by address arithmetic against this document's own `SS:0x3768`/stride-`0xE4`/10-slot System-A group-runtime span (`[0x3768, 0x4050)`), inside that live runtime array rather than any jump table. The call target is therefore whatever entity-group runtime data happens to sit there at the moment — an unguarded, data-dependent wild call.

**Shipped data comes within one wiring step of hitting this.** A full census of all 8 `.MAP` files' 800 trigger records finds exactly one record anywhere with `ACT5` and an aliasing arg: **`PLEV3A.MAP` record #50** — `cond0: kind=2 (item NOT held) arg=23 ("chest key")`, `action=5 arg=0` — "if the player lacks chest key 23, run `ACT5(0)`." But reaching record #50 at all requires a `PALFILS.0A3` event record `{selector=3, param=50}`, which exists at event index 95 (of 78 live `selector=3` records in that file) — and the *only* two ways to ever dispatch event index 95 are a plane-B cell valued 98 (`95+3`) or another `ACT5` with `arg=96` (`95+1`). **Neither exists in `PLEV3A`'s shipped data**: 0 of its 8192 plane-B cells equal 98, and none of its 20 `ACT5` records use `arg=96`. So the wild-jump path is real and structurally proven — and it fails to fire only because the level-editor never wired an entry point to event index 95, not because of anything about the 4 mystery bytes.

**Conclusion:** in every shipped play scenario these 4 bytes are dead padding — not because their specific value blocks anything (it does not; `0x0200` is exactly the kind of value that would let the wild call proceed if the code path were ever reached), but because the one code path able to read them as data is never dispatched with shipped level content. Their value never varies with level content, unlike every record around them (including the very next 4 bytes, event record #0, which differs across files), ruling out "duplicated first record." A plausible origin — unprovable from these bytes alone — is a level-export-tool artifact: a phantom "index-0 / base" slot the tool's own internal array representation always emits ahead of the real table. `UNKNOWN_palfils_0320_intent` — deliberate guard vs. tooling artifact — is not decidable from static bytes alone.

### `DS:0xa82c` — trap doors `[PROVEN]`, formerly `UNKNOWN_alfils_a82c`

`1000:40c0`, `cx=0x14`: **20 records of `{u16 x, u16 y, u16 open}`** that patch the map at level load — plane-A tile from `[0x152]`/`[0x154]`, and **plane-B solidity as `open XOR 1`**:

```
40E2  cmp dx,0 / js skip        ; 0xFFFF terminates
40E9  call 0x379b               ; di = plane A + (Y<<3) + (X>>5)
40F1  mov bl,[0x152] / mov [di],bl    ; open != 0
40F9  mov bl,[0x154] / mov [di],bl    ; open == 0
40FF  add di,0x2000             ; -> plane B
4103  xor dl,1 / mov [di],dl    ; solidity = open XOR 1
```

This is the mechanism behind the message `"a trap door closes beneath you"`.

Verified independently: `0x9008 + 0x324/0x15f0/0x1824` land exactly on `0x932c`/`0xa5f8`/`0xa82c`, and `PALFILS.0A1+0x15f0` decodes to 36 live lever records whose `{x, y, type}` match `PLEV1A`'s object records exactly (entry 0 = `(424, 592, 24)` = object #15). A byte-swap pass at `1000:2acf` (`cx=0xc0` = 64×6 bytes) converts the lever table BE→native.

**The lever "state" is bit 0 of the object type**, not a separate flag: types 24/25 = lever off/on, 26/27 = switch off/on, so `xor byte [...+4],1` flips state and graphic together. Conditions 11/12 test that same bit.

## Levers and triggers — no bitfields `[PROVEN]`

A lever is a `POBJECTS` **category 3** object. State lives in a **64-entry × 6-byte `{x, y, state}` table at `DS:0xa5f8`**, toggled one bit at a time (`xor byte [...+4],1`) by the player-overlap handler around `1000:1087`, and read by trigger conditions 11 and 12 (`test byte [0xa5f8 + dx*6 + 4],1`).

Multi-lever puzzles are real — a census of the 756 live trigger records finds 17 with three lever conditions, and levers {45,46,47} on `LEV3A/3B` appear in five records with five polarity patterns selecting five different actions. But the combination logic is **the trigger table's three AND-ed predicates**, not a bitfield indexed into a solution matrix: an exhaustive search of the handler and toggle regions found **zero** bitfield idioms (`or reg,reg`, `or [abs],r16`, `rcl`/`rcr`, `xlat`).

Trigger actions cannot set levers — `DS:0xa5f8` is written only by the player toggle — so lever puzzles cannot chain into one another.

### The lever/switch toggle, `CS:0x1045`-`0x10D6` — full trace, and a correction `[PROVEN]`

⚠️ **Correction to the paragraph above: it is not a "player-overlap handler".** `CS:0x1045` is reached from exactly one place, `CS:0x49F2`, inside player **state 26 (idle)**'s own fire dispatch (`CS:0x49EA test byte[0x382],0x80`) — see *Which states can fire a weapon*, above, which already names this but had not traced the routine's own body past the `xor` at `0x10C5`. The hero must be standing still (not walking, jumping, falling, or on a ladder) and holding FIRE; walking into a lever does nothing at all. Read in full this pass, including its two previously-untraced callees:

```
1045  cmp byte[0x346],0 / jz 104f     ; DEBOUNCE LATCH, identical shape to the
104c    jmp 10dc (return)             ;   weapon fire latch DS:0x351: cleared
                                      ;   every tick fire is NOT held (CS:0x49F9
                                      ;   mov byte[0x346],0), set the instant this
1059  cmp byte[0x3a2],0 / jns 10dc    ;   scan is even attempted (0x1060), whether
1060  mov byte[0x346],1              ;   or not it finds anything to toggle
                                      ; DS:0x3a2 >= 0 -> a delayed animated toggle
                                      ;   is already in progress -> bail (see below)
1065  si=0x8314 ; cx=0xc8             ; walk all 200 live object records
106b    cmp word[si+6],0 / jz next     ; +6 (flag6) must be nonzero — on screen
1071    cmp word[si+4],0 / js next      ; +4 (type) must be live
1087    cmp descriptor(type).category,3 / jnz next   ; CATEGORY 3 ONLY
1094    call 0x115b                     ; lever-table lookup — below
1099    or dx,dx / js next               ; NOT a real lever -> skip
109d    call 0x10dd                      ; hero-proximity box — below
10a0    jc next                          ; too far -> skip
10a2..10b8  sprite in {0x120,0x122,0x124,0xe8}?  -> arm the delayed animation
10c5    else: xor byte[obj.type],1  AND  xor byte[lever.type],1   ; BOTH structures
10ce    play sfx 0x62b
10d6    ret                              ; ONE toggle per press — no loop-continue
```

`CS:0x115b` (previously unread) is a linear search of the 64-entry `DS:0xa5f8` lever table for an EXACT `{x,y}` match against the candidate object, using `DX`'s sign as the found/not-found flag (the loop's own countdown register, left non-negative on a match, driven to `−1` by the unconditional `dec dx` on every failed attempt through all 64 records):

```
115b  si=0xa5f8 ; dx=0x3f(63)
1161  cmp ax,[si] / jnz 116a ; cmp bx,[si+2] / jz 1170   ; {x,y} match -> RET (dx unchanged, >= 0)
116a  si+=6 ; dec dx ; jns 1161                            ; next record
1170  ret                                                    ; exhausted -> dx = -1
```

`CS:0x10dd` (previously unread) is the hero-proximity box — WORLD space, and genuinely asymmetric on both axes:

```
10df  bx=heroWorldX ; ax=objWorldX+4
10e6  cmp bx,ax / jg reject          ; heroX >  objX+4   -> reject
10ea  bx+=0x18 ; cmp bx,ax / jl reject  ; heroX+24 < objX+4 -> reject
                                      ; => heroX in [objX-20, objX+4]
10f4  bx=heroWorldY ; ax=objWorldY+0x10
10fb  cmp bx,ax / jg reject          ; heroY >  objY+16  -> reject
10ff  bx+=0x30 ; cmp bx,ax / jl reject  ; heroY+48 < objY+16 -> reject
                                      ; => heroY in [objY-32, objY+16]
1106  clc / ret                       ; accept
```

Both operands share `X` in screen space (camera cancels — equivalent to world space) but the caller keeps `Y` in world space throughout this part of the object walk for category>=3 objects (see `UNKNOWN_ss432_indirect`, above), which is why no camera term appears on the Y side.

**The four special sprites — `0x120`/`0x122`/`0x124`/`0xe8` (POBJECTS types 118/120/122/62) — get a delayed, animated toggle instead of the instant `xor`**, already documented above under `UNKNOWN_lever_special_types`'s own `FUN_1000_1d01` trace, now cross-referenced from the trigger side rather than the draw side: `CS:0x10BA` arms it (`[0x20e]:=`the object, `[0x3a2]:=0`), and the draw routine advances `DS:0x3a2` once per FRAME (not once per press) through the per-world 5-entry table at `DS:0xe01e`, toggling both the object AND the lever-table record at phase 3 of 5, re-arming (idle) after phase 5. **Placed 18 times across the 8 shipped maps** (5/4/2/2/0/3/0/2 — types 118, 62, 62, 62, none, 120, none, 122 respectively), a small but real mechanic, previously known only as a draw-side animation with no traced trigger.

**Ported in the sibling `gods-web` repo** as `game/levers.js`, verified live in the browser: a real idle+FIRE press flips an ordinary lever's sprite (a visible orange handle appearing/disappearing), end to end through the actual input pipeline, not just a unit test.

## How levers neutralize hazards — `ACT6`, live-confirmed on world 1 `[PROVEN]`

Full deep-dive requested on world 1 specifically (`PLEV1A`/`PLEV1B`): which of the 15 action verbs actually *removes* a hazard when lever-gated, disassembled to the instruction, censused against both shipped level-A/B files with a full reachability check (not just "a record exists"), and confirmed live under DOSBox by forcing the real handler against the real running level.

### `ACT6`, `CS:0x3BD1`–`0x3CC6` — full trace `[PROVEN]`

The verb table above already named `ACT6` "kill ≤2 category-4 objects near the point" from its 25-record census; this pass disassembled the body itself (Ghidra had no function defined over it — one of the un-disassembled gaps this document already flags elsewhere — so read via `disassemble_bytes`, not `decompile_function`):

```
3BD2  AX,BX := record.x, record.y            ; DI+0xc/DI+0xe, the trigger record's own point
3BDC  [0x214]=x-0xC  [0x216]=y-0xC            ; min corner  (a ±12px / 25×25 box, NOT a radius)
3BE2  [0x218]=x+0xC  [0x21A]=y+0xC            ; max corner
3BF7  byte[0x3A6] := 0                        ; kill counter, this invocation
3BFC  SI=0x8314 (runtime objects) DI=0x2A4E (descriptors); CX=0xC8 (200)
3C1B    skip if word[SI+4] < 0                ; dead slot
3C21    DI = 0x2A4E + type*10 ; skip unless byte[DI+4] == 4   ; CATEGORY 4 ONLY
3C48    skip unless [0x214]<=obj.x<=[0x218] AND [0x216]<=obj.y<=[0x21A]
3C65    word[SI+4] := 0xFFFF ; word[SI+6] := 0                ; KILL (type 0x60 gets one extra
                                                                ;  cosmetic y-8 on its effect sprite;
                                                                ;  every other category-4 type, incl.
                                                                ;  the type-50 "spike", kills identically)
3C78    queue a 4-slot effect record (DS:0x8C3C) at (obj.x-8, obj.y[-8 if type 0x60]) ; call CS:0x22CA (AX=0xF22)
3CB6    INC byte[0x3A6] ; == 2 ? stop early : continue the 200-object scan
```

#### The queued record is a SMOKE PUFF — `CS:0x3CC7`, sprites 108–114 `[PROVEN]`

The `3C78` line above said "queue a 4-slot effect record" and stopped there; what *consumes* `DS:0x8C3C` was never chased. It is a seven-frame animation, and it is why a neutralised hazard visibly **goes up in smoke** instead of just vanishing:

```
3CC7  si = 0x8c3c ; cx = 4
3CCD  cmp word [si],0 / js next      ; a NEGATIVE first word = free slot
3CD2  ax = [si+2] ; bx = [si+4]      ; the stored point, WORLD space
3CD8  ax -= [0xa] ; bx -= [0xc]      ; -> screen, recomputed every tick
3CE0  dx = [si] ; add dx,0x6c        ; sprite = 108 + frame
3CE5  [0x4]=ax [0x6]=bx [0x8]=dx / 3CF2 call 0x3569   ; graphics EXPORT 1
3CF7  inc byte [si]                  ; frame++ — AFTER the blit
3CF9  cmp byte [si],0x7 / jl next    ; seven frames, 0..6
3CFE  mov word [si],0xffff           ; spent -> free
3D02  add si,6 / loop 0x3ccd         ; a FULL 4-slot pass, no early out
```

Three callers (`get_xrefs_to`): `CS:0x0239` in the main loop, `CS:0x0A0E` inside the death routine (so puffs keep animating while the hero dies) and `CS:0x92A7`. `DS:0x8C3C` has exactly **three** references program-wide (`search_instructions` on the operand): `CS:0x3C06` (ACT6's own free-slot search), `CS:0x3CC7` (this walker) and `CS:0x8EC2` (level load, which frees all four slots) — so **ACT6 is the sole producer**; this is not a shared particle pool.

**The artwork confirms the frame count independently.** Cutting ids 108–114 out of the shipped atlases gives `PALWAYS2[69..71]` then `PALWAYS3[0..3]`, sized `32×32, 32×32, 32×32, 32×32, 32×29, 32×18, 32×17` — a pale dome that swells into a cloud, browns, then flattens and scatters, the shrinking heights being the dispersal. **Sprite 115 is an unrelated green box**, so an off-by-one in `cmp 7` would draw furniture: the compare and the art agree on seven frames.

Unlike the sibling debris pool (`DS:0x8b4c`) this walker has **no live-count fast-out, no off-screen cull and no contact test** — the only `CALL` in the body is the blit — and it draws through **export 1** (`CS:0x3569`) where debris uses export 2.

**Two details of the seeding side matter to a port**, both in `CS:0x3C02`–`0x3C18`: the free-slot search runs **once per invocation**, and each kill then writes at the cursor and does `add bp,6` *without searching again*. So (1) with all four slots busy, `CS:0x3C15 sub bp,6` backs up and **overwrites the last slot** rather than dropping the puff, and (2) a second kill in one invocation takes the *next* slot whether or not it is free. If the cursor is already on the last slot, that second write lands one record past the array at `DS:0x8C54` — which is not spare space: the main loop parks a pointer there every frame (`CS:0x0218 mov word [0x1d2],0x8c54`).

**Now implemented in `gods-web`** as `game/kill-smoke.js`, with that out-of-array store clamped rather than reproduced (the same call this port already made for `ACT8`). Before it the port filled the four slots and drew nothing, so a lever-neutralised spike blinked out of existence — the gap was reported from play, not spotted in the bytes.

So the doc's "≤2" figure is now instruction-proven, not inferred: the outer loop always walks up to 200 live objects, but a hard counter (`DS:0x3A6`) stops the function the instant a **second** category-4 kill lands. The "near the point" radius is exactly **±12 px on each axis**, centered on the *trigger record's own* `(x, y)` — not the hazard object's. The kill itself writes `0xFFFF` into the object's type word and zeros its flag word, the identical dead-object convention used everywhere else in this codebase (`CS:0x9000`'s sign test, already documented). This is a pure verb-level effect — it does not touch score, inventory, or the lever table itself (confirmed by reading the full body: no reference to `DS:0x17e`, `0x194`, or `0xa5f8` anywhere in `0x3BD1`–`0x3CC6`).

### The census: lever-gated `ACT6` records that actually reach a shipped hazard, world 1 `[PROVEN]`

A naive grep for "lever condition + `ACT6`" risks the exact mistake this document already made once for `PLEV3A` record #50 (a structurally-real wild jump that never fires because nothing in the shipped data dispatches it — see *`UNKNOWN_palfils_0320`*, above). So this pass ran the full reachability chain before trusting any hit: decompressed `PLEV1A.MAP`/`PLEV1B.MAP` and `PALFILS.0A1`/`0B1`, decoded all 100 trigger records and all 253 `PALFILS` event records per file, and for every trigger record with a `COND 11`/`12` (lever) slot, checked whether some event record is `{selector 3, param = that record}` **and** whether that event id is actually dispatchable — either a plane-B cell equal to `event+3`, or another `ACT5` action elsewhere in the same file with `arg = event+1` (the exact two-way OR the trigger evaluator itself uses, `CS:0x6022`/`0x6029`, both documented above). Every `ACT6` hit below cleared that check.

**`PLEV1A`** — 5 lever-gated, reachable, live-object-matching `ACT6` records, against 13 shipped type-50 ("spike") objects:

| rec# | lever condition(s) | point | kills (exact object match) |
|---|---|---|---|
| 1 | lever 0 **off** ∧ lever 1 **off** ∧ lever 2 **on** | (137, 624) | obj `(137, 624)` type 50 |
| 2 | lever 0 **off** ∧ lever 1 **off** ∧ lever 2 **on** | (158, 624) | obj `(158, 624)` type 50 |
| 7 | lever 3 **on** | (443, 960) | obj `(443, 960)` type 50 |
| 8 | lever 3 **on** | (462, 960) | obj `(462, 960)` type 50 |
| 11 | lever 4 **on** | (83, 719) | obj `(83, 720)` type 50 (1px, inside the ±12 box) |

**`PLEV1B`** — 2 more, against the **same 13 type-50 objects**: a full 1200-byte diff of the two files' object regions found 53 of 200 records genuinely differ between the level-halves (mostly levers and scenery, placed independently per half — e.g. lever 0 sits at world (424,592) on `1A` but (3367,592) on `1B`), but every one of the 13 type-50 records is byte-identical, same index and same `{x,y}`, in both files:

| rec# | lever condition(s) | point | kills |
|---|---|---|---|
| 39 | lever 11 **on** | (1740, 960) | obj `(1740, 960)` type 50 |
| 55 | lever 12 **off** ∧ event cond (`5, 165`) | (1610, 800) | obj `(1610, 800)` type 50 |

(Condition polarity re-confirmed this pass, not just carried over from the verb table above: `CS:0x3F6C` — `ret` on a **clear** bit, i.e. `COND11` only passes when the bit is **set** — and `CS:0x3F87` is the mirror image, passing only when **clear**. Both handlers read `DS:0xa5f8 + arg*6 + 4` directly, `arg` used verbatim as the 0–63 lever-table index.)

Two distinct authored shapes, both real: a **3-lever AND-combo** (records 1/2) that clears a pair of spikes only when levers 0 and 1 are *off* and lever 2 is *on*, and plain **single-lever ON switches** (records 7/8, 11, 39) each clearing one or two spikes outright. Records 1/2's lever bank (`0`/`1`/`2` at world (424,592)/(201,592)/(234,592)) is the **same bank** already documented under *`UNKNOWN_chest_key_surplus`* in `CLAUDE.md` — `PLEV1A` triggers #3/#4, 25 px away at (393,597)/(368,594), spawn the world's one iron chest (type 16) and its key (type 23) when levers 0 **and** 2 are both *on*. **Lever 0 has opposite required polarity in the two paths** (off for the hazard-clear records, on for the chest/key records), so the reward path and the hazard-clearing path are **mutually exclusive at any given instant** — not just "different combinations," but a puzzle bank where arming one payoff structurally disarms the other. `PLEV1A`/`PLEV1B` place 13 type-50 objects total; 7 of them (5 reachable from `1A`'s own trigger table, 2 more from `1B`'s) are lever-removable. The rest have no `ACT6` wiring in either file's live trigger data — they are permanent.

**Trap doors are not lever-driven — clean negative.** `CS:0x40C0` (the `DS:0xa82c` trap-door patcher, documented above) has exactly two callers file-wide (`get_function_callers`): `FUN_1000_2A37` (the level/PALFILS loader) and `FUN_1000_8C34`, itself called only from `FUN_1000_006F` and shown by decompile to be a **level-(re)start reset** — it zeroes the hero's inventory/score/state block and re-runs the same handful of level-init routines (`0x41BC`, `0x40C0`, `0x9196`, …) every time. Neither caller is a trigger action, the lever toggle, or a per-frame tick, so trap-door state is fixed at level load and cannot be a lever-neutralization mechanism, unlike `ACT6`.

### Confirmed live under DOSBox `[PROVEN]`

Booted fresh by passing `GODS.EXE`'s own path as the DOSBox launch target (auto-mounts its parent directory as `C:` and runs it, reaching `GAME.EXE` without typing through the shell). The title screen's attract-mode demo cycles through several levels unpredictably (already known to be awkward for live input — see the `docs/dynamic-trace-and-runtime-data.md` boot trace), so rather than fight that timing, this pass raced to read `DS:0x7004`'s record-1 signature the moment real gameplay started; it matched `PLEV1A` exactly. Located `ACT6` in the live image with a `mem_scan` on its own opening bytes (unique hit), confirming the running code segment. With the emulator paused mid-frame inside `GAME.EXE`'s own segment:

- Read the live runtime object array (`DS:0x8314`, 200 × 8-byte `{x,y,type,flag}`, confirmed by the same `CX=0xC8` bound the disassembly uses): slot 32 held `(137, 624, type=50, flag=0)` — alive — and slot 33 `(158, 624, type=50, flag=0)`, its 21px-distant neighbor.
- Overwrote 8 live code bytes at the CPU's current (unrelated) instruction with a self-contained `MOV DI,0x701C` (the live address of `PLEV1A`'s own trigger record #1, already sitting in the running game's own trigger table) / `CALL ACT6` / `JMP $`, so the **real handler ran against the real record** rather than a synthetic one.
- After the forced call: slot 32 read `(137, 624, type=0xFFFF, flag=0)` — **dead**, by the exact convention the disassembly predicted — and slot 33 was **unchanged** (`type=50`), confirming the ±12px box excludes the 21px-distant neighbor exactly as computed statically.

This closes the loop, but with each leg's confidence kept honest rather than blended: the lever toggle and the `COND11`/`COND12` read (`CS:0x1045`, `0x3F6C`/`0x3F87`) and the reachability of trigger record #1 (the static census above) are `[PROVEN]` **statically** — the forced call skipped over that plumbing rather than exercising it, since it injected a direct `CALL` into `ACT6` instead of waiting on the real lever-toggle-then-walk-over-the-plane-B-cell input sequence. What the DOSBox session adds, and what was not previously confirmed by disassembly alone, is the **action leg**: that `ACT6`, invoked with the real record data from a live, running `PLEV1A`, actually reaches into the real runtime object array and kills the intended object — observed directly, not inferred from the decompile.


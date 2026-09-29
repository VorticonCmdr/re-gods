# Destructible blocks, the world-2 nest, and enemy projectiles/debris

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## Destructible blocks — `UNKNOWN_destructible_tile` CLOSED `[PROVEN]`

This is the mechanism behind *"maces break blocks"* — and it **vindicates** this document's earlier correction rather than reopening it. `PWEAPONS +0x48` really is *"stopped by terrain"*; the mace's advantage is a **`+50` at `CS:0x74AF`**, in a different routine reached through a different call.

### The trigger, and a world gate the data confirms

```
A7EF  cmp byte [ds:bp+0],1 / jnz         ; the cell must be SOLID
A800  cmp byte [di],0x6d / jnz 0xa816    ; plane A must read 0x6d
A806  cmp byte [0x42],3 / jl  0xa816     ; and the world must be >= 3
A810  call 0x73ec                        ; si = the WEAPON record, bp = plane-B cell
```

⚠️ **The world gate matches the shipped maps exactly.** Tile `0x6d` appears in every level, but its plane-B solidity does not:

| | cells | solid |
|---|---|---|
| `PLEV1A` / `1B` | 6 / 6 | **0** |
| `PLEV2A` / `2B` | 11 / 14 | **0** |
| `PLEV3A` / `3B` | 15 / 8 | **all** |
| `PLEV4A` / `4B` | 120 / 103 | **all** |

**246 of 246 solid across worlds 3–4, against 0 of 37 across worlds 1–2.** The authors used `0x6d` decoratively early and as breakable masonry late.

### The queue, `DS:0xd0c6` — 40 × 6 bytes

`{u16 worldX, u16 worldY, i16 hp}`, free when X is negative, cleared by `CS:0x74CD` (`mov cx,0x78 / rep stosw` = 240 bytes = 40 × 6 exactly). Coordinates are **reconstructed from the plane-B pointer**, not passed in: `col = (bp−0x5004) & 0x7f`, `row = ((bp−0x5004) & 0xff80) >> 7`, then `×32` and `×16`.

⚠️ Note `shr` in the append (`0x741F`) against `sar` in the removal (`0x7574`) for the same quantity. Both operands are non-negative, so they agree — recorded because a reader diffing the two will wonder.

### The damage — `CS:0x743E`, and the mace's +50

```
7481  pop dx / 7482 xchg dx,si       ; si = the WEAPON record
7484  mov ax,[si+8]                  ; its PICKUP COUNT = its damage
7487  xchg dx,si                     ; si = the QUEUE record again
7489  DS:0x33f picks which slot fired -> bx = that weapon index
74AA  cmp bl,0xa / jnz / 74AF add ax,0x32     ; <-- THE MACE BONUS, +50
74B2  sub [si+4],ax                           ; hp -= damage
74B5  cmp word [si+4],0xff38 / jl / 74C2 mov word [si+4],0   ; < -200 -> ZERO
74BE  pop ax / jmp 0x7439            ; DISCARD the return address and unwind
                                     ; out of 0x73EC, skipping the append
```

⚠️ **The two `xchg`es cancel**, so `0x74B2` lands on the *queue* record. Corroborated at the use site: the updater reads `[si+4]` with `si` walking `0xd0c6` at stride 6. Read one `xchg` and not the other and the subtract lands on `PWEAPONS +0x04`, the projectile animation frame.

⚠️ **hp counts DOWN from −1 and "breaking" is hp ≥ 0**, so a block absorbs **200 cumulative damage**. And ⚠️ **the first shot does none** — `0x73EC` calls `0x743E` *before* appending, so on an unqueued cell the scan finds nothing and the first hit only creates the record.

Only the six weapons whose `+0x48` **byte** is nonzero ever reach this path:

| weapon | dmg/hit | shots to break |
|---|---|---|
| **mace** | 3 + 50 = **53** | **5** |
| time bomb | 20 | 11 |
| fireball | 5 | 41 |
| flame | 4 | 51 |
| throwing star | 2 | 101 |
| knife | 1 | 201 |

⚠️ `+0x48` is a **byte** (`cmp byte [si+0x48],0`). Read as a big-endian `u16` it picks up `+0x49`, and the hunter and magic axe wrongly appear to collide — a mistake made and caught while porting this.

⚠️ **Shooting an already-breaking block queues a DUPLICATE.** `0x746E` requires the matched record's hp to be **negative** before applying damage; once breaking, hp is a frame index, so the scan finds no match and `0x73EC` appends a second record for the same cell.

### The break, the restore, and both capacity quirks

`CS:0x7500` is `C3` (RET), **patched to `0x90` by `CS:0x7433`** when the first block is queued — the same self-modifying enable the player state machine's `[cs:0x71d]` gate uses — and re-disabled at `0x7508` when `[0x3c0]` reaches 0. It is called at **`CS:0x01DF`**, before the mode dispatch and so before the object pass, the projectiles and the player.

Four frames advancing on **every other frame** (`DS:0x36c`, toggled by `not` at `CS:0x0172`) — about **0.53 s** at 15 Hz. ⚠️ `DS:0x158`, the sprite base, is **read once and written nowhere** in any of the eight binaries at either alignment, so it is 0 and the drawn sprite is the frame index itself. A port reproducing that is reproducing an **uninitialised read**, exactly as the plane-A out-of-range note does.

`CS:0x7566` then appends the plane-B pointer to a **100 × 4-byte restore list at `SS:0x46b0`** — ⚠️ **`SS`, not `DS`**, on two independent counts: every access is `[bp+0]`, which defaults to `SS`, and the clear at `0x75E1` does `push ss / pop es` — and writes **plane B = 0** (passable) and **plane A = 1**. ⚠️ **Plane A becomes 1, not 0**: under the proven 1-based rule that is tile index 0, not "empty".

| quirk | site | effect |
|---|---|---|
| queue full (40) | `0x7403` | the hit is dropped silently |
| restore list full (100) | `0x759A` | returns **before touching either plane** — the block finishes its animation, frees its queue slot, and **stays solid**. `PLEV4A` has 120 destructible cells against 100 entries, so this is reachable in shipped data |

`CS:0x74DB` is the restore — plane A `0x6d`, plane B `1` — and its two callers (`CS:0x69B1`, `CS:0x8E40`) each follow it immediately with the queue clear. **Broken blocks come back on level load or restart.**

### `UNKNOWN_block_breaker_8bca` — CLOSED: the `DS:0xcfcc` falling hazard `[PROVEN]`

⚠️ **And closing it corrected a claim made in this document one pass earlier.** That pass said the second block-breaker was the *debris* array `DS:0x8b4c`. It is not, and the reason is exactly the failure this document's own rule — *"resolve the segment FIRST; a `DS` offset read as `1000:<off>` returns unrelated code bytes"* — exists to prevent:

```
CS:0x8b4a   2E C6 06 56 8B C3    mov byte [cs:0x8b56],0xc3
                     ^^^^^ an IMMEDIATE inside that instruction; CS:0x8b4c is
                           its modrm byte, mid-instruction, not an array
CS:0x8b57   BE CC CF             mov si,0xcfcc     <- the walker's REAL base
```

`CS:0x8b4a` is a **self-modifying gate** that writes `RET` at `CS:0x8b56`. The walker that reaches `0x8BCA` starts at `CS:0x8b57` and walks **`DS:0xcfcc`, ten records of ten bytes** (`0x8B5A cx=0xa`, `0x8C1C add si,0xa`) — a system this document already mentions in passing as *"`0x8687` (a 10-slot system at `DS:0xcfcc`)"*. `DS:0x8b4c` is a different array entirely, and it is **inert** (see below).

**The hazard falls, breaks blocks, and touches the hero once:**

```
8B6D  dx = [si+6] ; bx = [si+2] ; bx += dx ; [si+2] = bx    ; y += vy
8B78  cmp byte [0x36d],0 / jnz 0x8b8d
8B7F  inc word [si+6] / cmp word [si+6],0x10 / jng / mov 0x10   ; gravity, cap 16
8B8D  di = 0x3004                                    ; PLANE A
8B92  col = ((X + 5) & 0xffe0) >> 5                  ; FLOORED on X+5
8BA4  row = (Y & 0xfff0) << 3
8BB1  add di,0x100                                   ; = 2 TILE ROWS DOWN
8BB5  cmp byte [di],0x6d / jnz 0x8bcd
8BBA  mov word [si+0x8],0xfa                         ; damage 250, into ITS OWN record
8BBF  mov byte [0x33f],0
8BC4  add di,0x2000 / mov bp,di / 8BCA call 0x73ec
8BCD  [0x1e2] = 5 ; [0x1e4] = 0x10                   ; a 5 x 16 box
8BD9  mov bp,[si+0x4]                                ; ⚠️ DEAD — overwritten
8BDF  mov bp,3 / call 0xac59
8BE5  or bp,bp / jns / 8BE9 mov word [si],0xffff     ; a reported hit FREES it
```

⚠️ **No solidity check and no world gate on this path.** `0x8B57`–`0x8BCA` contains no plane-B read and no reference to `DS:0x42` — the `cmp byte [0x42],3` belongs to the *projectile* caller at `0xA806`, and `CS:0x73EC` itself has no world test. The hazard tests one plane-A byte and nothing else, so it **falls through solid geometry**.

⚠️ **The probe is two tile rows below the hazard's own row** (`+0x100 / 128 = 2`), and the column is floored on `X + 5` rather than rounded. `UNKNOWN_hazard_probe_lookahead` — why two rows is not established.

⚠️ **`CS:0x8BD9` is a dead load**, overwritten by `mov bp,3` two instructions later. It reads like a per-record strength that was hard-coded and never removed.

### ⚠️ Two corrections to the destructible-block section above `[PROVEN]`

**1. `CS:0x7484` is POLYMORPHIC, and `DS:0x33f` is NOT the damage source.** That section said *"`0x7489` DS:0x33f picks which slot fired → bx = that weapon index"* and described `[si+8]` as "the weapon's pickup count". The two reads are independent:

```
7484  mov ax,[si+0x8]     ; THE DAMAGE — +0x08 of whatever struct the CALLER
                          ; of CS:0x73EC held in SI
7489  DS:0x33f 0/1/2 -> bx = [0xdd10] / [0xdda2] / [0xde34]
74AA  cmp bl,0x0a         ; BX's ONLY consumer, image-wide
74AF  add ax,0x32
```

So `DS:0x33f` selects which **slot is tested for holding weapon 10**, and nothing else. On the projectile path the two coincide — `SI` is the `PWEAPONS` record (pinned by `0xA7B7` reading `[si+0x48]` through the same `SI`), so `[si+8]` *is* that weapon's pickup count and `DS:0x33f` *is* the slot that fired it. The equivalence breaks on the hazard, which supplies its **own 250** at `0x8BBA` and forces `DS:0x33f = 0` purely to test slot A. (`0x8BBF` never restores it; benign, because `CS:0x9455` rewrites it before every `call 0x9477`.)

**2. On the hazard path the mace bonus is behaviourally inert.** HP seeds at −1 and the first damaging touch applies 250 → −251, already past the −200 threshold, so the clamp trips whether the value was 250 or 300. **Two touches destroy a block either way** — one to enqueue, one to damage.

### `UNKNOWN_hazard_emitter_placement` — CLOSED: the hazard is CUT CONTENT `[PROVEN]`

The emitter is reached only through the **per-world sprite-class tables at `DS:0xdf80`** — four worlds × **two** tables of six 12-byte records `{u16 spriteBase, u16 (always 1), u16 handlerA, u16 w, u16 h, u16 handlerB}`, with an all-`0xFFFF` record meaning an empty class slot. `call 0xbd38` and `call 0xbd0b` occur **zero** times image-wide, so there is no other way in.

**Which table belongs to which entity system is proven by an invariant, not assumed.** Across all 8 `PALFILS` files, every class index a descriptor uses (`+0x07`) lands on a **non-empty** record under the binding *table 0 = System A (`+0x0D58`), table 1 = System B (`+0x11A4`)*. It is discriminating because it fails the other way round: World 2's System-B descriptors use **class 4**, and only table 1 has a class 4 in world 2 — table 0's is `0xFFFF`.

| | table 0 = **System A** | table 1 = **System B** |
|---|---|---|
| handler family | `0xbc4b` | `0xb03c` / `0xb670` |
| world 1 classes used | 0, 2 | 0, 1 |
| world 2 | 0, 2 | 1, **4** |
| world 3 | 0, 1, 2 | 0, 2 |
| world 4 | **0 only** | 0, 2 |

**The hazard is world 4 / System A / class 3** (`DS:0xe23e`) — the only record in any of the eight tables carrying the handler pair `0xbd38`/`0xbd0b`, and its sprite base `0x213` = 531 matches `CS:0xBD68`'s `add bp,0x213` exactly. **System A in world 4 uses class 0 and nothing else**, in both `PALFILS.0A4` and `.0B4`.

⚠️ **So nothing instantiates it.** And the pattern of empty slots across the eight tables is the signature of a built-then-unplaced feature rather than an unbuilt one. There are **exactly four `0xFFFF` records in all 48**, and **all four are System A** — System B has no holes at all:

```
w1 sysA class 3     w2 sysA class 4     w3 sysA class 3     w4 sysA class 4
```

The hole **moves**: class 3 in worlds 1 and 3, class 4 in worlds 2 and 4. So System-A class 3 is *empty* in worlds 1 and 3, *populated* in worlds 2 and 4 — and **used in none of the four**. World 4's populated-but-unused class 3 is the hazard.

**This is the fourth cut feature in the game**, after the `flame` weapon (null spawn *and* mover handlers), the iron chest (six keys ship for a chest placed nowhere) and the entire familiar chain (three potions, none placed).

⚠️ The earlier suspicion that "the descriptor window may be wrong" is **refuted**: the window is right, and the all-zero world-4 result is the finding. `0A1`/`0B1` and `0A4`/`0B4` agree while `0A2`/`0B2` and `0A3`/`0B3` differ, which is what a correct window over real level data looks like.

⚠️ **Correction, found while chasing an unrelated enemy-shot emitter pair (`CS:0xBDC5`/`0xBDD6`, see *The five other emitter-pair owners* below).** "Table 0 = System A" / "table 1 = System B" describes correctly which *pointer* (`DS:0x1fe` vs `DS:0x1fc`, `CS:0xAD62`'s own loader) each table hangs off — but it does **not** mean these tables are read by the System-A/System-B *roaming-entity* pipelines this document documents elsewhere (`CS:0xe001` / `CS:0xed15`). World 4's own class 2 — the record immediately before the cut hazard at class 3, same table, `DS:0xe23e − 0x16` — is live, placed, and fully traced this pass: its `handlerA`/`handlerB` pair (`0xbddb`/`0xbd71`) is reached exclusively through the **selector-1 `PGOD0x.PAT` spawn system** (`DS:0xb6b8` group slot → `DS:0xb744` sub-record, walked by `CS:0xb987`), which merely *looks up* this per-world class table via the same `[0x1fe]` pointer System A's own `CS:0xe199` resolver uses — it is a second, independent consumer, not the entity array itself. Since class 3 (the hazard) sits in the identical table, reached the identical way, **its own would-be runtime consumer is almost certainly this same selector-1/PAT mechanism, not a bare System-A entity record** — consistent with, and a plausible explanation for, why it was never wired to any placed object: nothing in any shipped `PGOD0x.PAT` file's directory points a class at index 3. `handler family: 0xbc4b` in the table above is table 0's *default* `handlerB` (11 of 14 live entries across all four worlds) — a generic "fire a shot in the direction I last moved" behaviour, not a fixed per-table constant; see below for what it and its System-B counterpart (`0xb03c`/`0xb670`) actually do.

### `UNKNOWN_b1c2` — CLOSED: three more dead hazard systems sharing the same cut sprite `[PROVEN]`

`FUN_1000_b1c2` (real entry `1000:b1c1`, a one-byte falling-through prologue) is a **10-slot × 8-byte array walker at `DS:0xaccc`**: `{i16 worldX, i16 worldY, u16 type(0..3), i16 lifetime}`. A record is free when `worldX` is negative. Per live record it drifts `worldY += 2` each tick unless a ground probe (`CALL 0x1000:b27f` → `0x1000:37b3`, the same `0x5004 + (X>>5) + (Y<<3)` plane-B formula used everywhere else in this document) finds a solid cell immediately below, in which case the increment is reverted (net 0 — the piece has landed and stops sinking). The `type` field cycles `0..3` on the shared every-other-frame toggle (`DS:0x36c`) and indexes a **4-entry sprite table at `DS:0xdf44`**, read live: **`531, 532, 533, 532`** — a small wobble/settle loop, not a monotonic run. It draws via the shared export-2 masked blitter (`CALL 0x1000:356e`) and, every tick, calls **`CS:0xdb4e`** — the same shared hero-hit-and-damage helper the `DS:0xd2be` Bresenham line-hazard pool uses (see *A sixth system: `DS:0xd2be`*) — with `BP` = the record pointer. A lifetime counter (`w3`) counts down; at negative it frees the slot. The three call sites this document already had on record (`CS:0x022D`, `0x0a02`, `0x929b`) are exactly the main loop, the death/respawn reset chain, and the attract-mode mirror — confirmed via `get_xrefs_to`, matching what was already written.

**The base sprite 531 = `0x213` is the same constant already established for the world-4/System-A/class-3 cut hazard** (`CS:0xBD68`'s `add bp,0x213`, immediately above) — not a coincidence: `FUN_1000_b1c2` is a *third*, independent piece of that same never-shipped "falling rock" content, not a new, unrelated feature.

**And it, along with two siblings, is provably unreachable — closing the question further than "what does it do."** `DS:0xaccc` has exactly two writers in the whole image: `FUN_1000_b1c2` itself (updating fields of an *already-live* record) and `FUN_1000_b263` (the level-init clear, called once from `FUN_1000_8c34`, which stamps every one of the 10 slots dead — `{0xFFFF, 0, 0, 0}` — and zeroes the "any active" flag `DS:0x1f8`). `DS:0x1f8` itself has exactly three references total: the entry gate's read, `FUN_1000_b1c2`'s own end-of-pass write-back (which can only ever report what it just walked), and `FUN_1000_b263`'s force-to-zero. **No code anywhere ever writes a live record into `DS:0xaccc` or sets `DS:0x1f8` from outside this closed loop** — an exhaustive operand search for both addresses across the whole program (`search_instructions`, 15,000+ instructions scanned) turns up nothing else. The array is permanently empty; the walker runs every frame, forever, and does nothing.

**Two structurally identical siblings, found chasing the same call site, are the same story with a self-modifying twist.** `CS:0x0230`/`0x0233` (right after `b1c2` in the main loop) call `FUN_1000_b3ce` (12 slots, `DS:0xad1c`, stride 10) and `FUN_1000_b4e7` (30 slots, `DS:0xad94`, stride 10 — the two arrays are contiguous, `0xad1c + 12*10 = 0xad94` exactly). Both open with a literal `RET` (`0xC3`) as their **first byte** — a self-modifying gate, disabled by default — and both are considerably more developed than `b1c2`: real physics (`vy` grows every other frame = gravity, `vx` decays toward 0 = drag), the same plane-B ground probe, a **5×5 hero-hit test via `CALL 0x1000:ac59`** (the actual hero-contact box test, not just `db4e`), a cull rectangle (screen `X∈(−16,352)`, `Y∈(−16,192)`), sprite = `(type field) + 0x213` directly (so sprites 531–534, the same range `b1c2`'s own table draws from), and — on a successful hit — a **moving debris spark via `CALL 0x1000:a633`** carrying the particle's own current velocity (the identical mechanism the magic axe's expiry debris uses). Each walker **self-disarms** once its own slot count empties (`cmp [0x1fa],0 / jnz keep-running`, else re-write its own entry byte back to `0xC3`).

**The only code that ever writes a *non-RET* byte to either gate is `FUN_1000_b3b2` — and it writes `RET`, not `NOP`.** `FUN_1000_b3b2` (called once, from `FUN_1000_8c34`, the level-init routine, alongside `b263`) clears all 42 records across both arrays in one pass (`CX=0x2a`, stride 10, starting at `0xad1c`) and then explicitly force-disables **both** gates (`MOV AL,0xC3` / `MOV CS:[0xb3ce],AL` / `MOV CS:[0xb4e7],AL`). An exhaustive operand search for `0xb3ce` and `0xb4e7` across the whole program finds exactly one write to each — this same disabling pair — and no enabling write (`0x90`) anywhere. So, exactly like `b1c2`'s array: **`b3ce` and `b4e7` are called every frame, hit the `RET` at their own first byte instantly, and can never do anything in the shipped game**, because nothing ever arms them and nothing ever seeds a live record even if they were armed.

**Net finding: this is the sixth identified cut feature in the project** (after the `flame` weapon, the iron chest, the familiar potion chain, the world-4/System-A/class-3 environmental hazard, and the dead damage-grid tag `0xFD`) — a small family of three "falling rock/rubble" particle systems (a settle/idle variant at `DS:0xaccc`, and two burst-with-physics variants at `DS:0xad1c`/`DS:0xad94`) built with full collision, damage, and debris-on-hit behaviour, sharing sprite atlas slot `531` with the already-documented unplaced environmental hazard, and never wired to any spawn trigger, descriptor, or scripted-sequence entry point in the shipped release.

### ⚠️⚠️ CORRECTION, a later session — this whole "cut feature" finding is WRONG: both pools are fed by the selector-2 spawner, live in shipped data `[PROVEN]`

**All three "no writer anywhere" claims above are refuted, and by the same reusable mechanism the `b03c` "zero xrefs" claim was.** Reading the two 32×32-class System-B `handlerA`/`handlerB` pairs `CS:0xB144`/`CS:0xB290` (world 2, live selector-2 classes 2/5/6/7) and `CS:0xB2C7`/`CS:0xB2F3` (world 3, live selector-2 class 3) — both reachable from real shipped `PALFILS +0x0718` dispatches, see *the selector-2 spawner* section below — instruction-by-instruction:

- **`CS:0xB144`** (`handlerA`) is an 8-tick, tock-gated animation (frame 0 frozen until kicked by `handlerB`; frame advances 1→2→3, resets past 3). **At the exact tick frame reaches 3**, it jumps to `CS:0xB169`, which searches `DS:0xaccc`'s 10 slots for a free one (`word[si] < 0`) and, on success, writes a **live record**: `worldX = entity.x + 0xa`, `worldY = entity.y + 0x12`, `type := 1`, `lifetime := 0x37` (55), and — critically — **`word[DS:0x1f8] := 1`**, the pool's own "any active" flag. This directly refutes *"No code anywhere ever writes a live record into `DS:0xaccc` or sets `DS:0x1f8`"* two paragraphs above. The earlier exhaustive sweep searched for direct-immediate writes to the literal addresses `0xaccc`/`0x1f8`; it could never find this, because `CS:0xB16B` loads the base into `SI` first (`MOV SI,0xaccc`) and every subsequent write is through `[SI]`/`[SI+2]`/`[SI+4]` — one register-indirection away from the literal, the same blind-spot shape that hid `b03c` from `get_xrefs_to` (a data-table reference instead of a direct call) and hid the `.DAT` atlas's `word2` reader from a naive scan. **The lesson generalizes: an "exhaustive operand search for `<address>`" only catches direct-immediate encodings; a base loaded into a register and indexed off is invisible to it.** Any other "closed negative, exhaustive" claim in this document that used only that method (not a base-register trace) should be treated as unverified against register-indirect writes.
- **`CS:0xB290`** (`handlerB`) is reload-gated (`slot.reloadByte`, the class descriptor's own fire-rate byte) — on expiry it does `word[di+4] := 1` (kicks the frame counter from its frozen 0 to 1, the ONLY way `B144`'s own frame can ever leave 0) and reseeds the reload timer with the same `(0x10-reloadByte)<<2` formula this document already establishes for `CS:0xB670`. So the pair is a genuine periodic attack: every reload cycle, a 3-tick wind-up animation ends with a falling-rock drop at the entity's own position.
- **`CS:0xB2C7`/`CS:0xB2F3`** (world 3's own class-3 pair, 24×24) are structurally identical to `B144`/`B290` (same reload-gate/frame-kick shape in `B2F3`; `B2C7`'s own frame-3 branch goes to `CS:0xB311` instead of `CS:0xB169`), but **`CS:0xB311` feeds the OTHER two pools** — and arms their gates: `CS:0xB354`/`CS:0xB359` write `0x90` (`NOP`) over `CS:0xb3ce`'s and `CS:0xb4e7`'s own first-byte `RET` gates, **unconditionally, every time this branch fires** — directly refuting *"The only code that ever writes a non-RET byte to either gate is `FUN_1000_b3b2` — and it writes RET"* and *"nothing ever arms them"* above. `CS:0xB311` then searches `DS:0xad1c`'s 12 slots (shared with `DS:0xad94`, contiguous) for TWO free ones (`word[si+4] < 0`), writing each with `worldX = entity.x+3`, `worldY = entity.y+0xb`, `state := 0` (alive), and a `{vx,vy}` pair read from a small 2-entry table at `DS:0xdf54` (4 bytes each) — a two-piece rubble burst, not a single drop.

**So this is NOT the sixth cut feature — it is a live, previously-mis-cited hazard-drop attack, fed by exactly the two selector-2 classes (`world 2 idx 2/5/6/7`, `world 3 idx 3`) this document's earlier pass over the same handler pairs called "worth a check, not a conclusion... [b290/b2f3] look reload-only... no emitter call" and left unconfirmed.** The falling-rock walkers themselves (`FUN_1000_b1c2`, `FUN_1000_b3ce`, `FUN_1000_b4e7`) are read correctly above (physics, cull, hero-hit, debris-on-hit) — only their reachability claim was wrong. `gods-web`'s `selector2.js` now ports both trigger pairs (see *the selector-2 spawner* section) as descriptors returned up to the caller; the walker pools themselves (gravity/drag/ground-probe/hero-hit/debris) are a separate module, `rockfall.js`.

### The main-loop call order for the three walkers, and the `DS:0x34` gate correction — `[PROVEN]`

Fresh disassembly of the main loop around `CS:0x022D` settles two things a prior pass of `selector2.js` had left as `NOT VERIFIED` guesses.

**The three calls are sequential, not interleaved, and each runs to full completion before the next starts:**

```
CS:0x022D  CALL 1000:b1c2      ; the settle/idle pool, DS:0xaccc — runs ENTIRELY first
CS:0x0230  CALL 1000:b3ce      ; the ad1c burst walker (12 slots) — runs ENTIRELY second
CS:0x0233  CALL 1000:b4e7      ; the ad94 burst walker (30 slots) — runs ENTIRELY third
```

All three calls are gated behind the SAME test, `CMP byte[0x34],0x0 / JNZ 0x23c` — i.e. all three are skipped together whenever the scripted-cutscene engine (`DS:0x34`, see *`DS:0x34` is 0 in normal play — CLOSED*) is active. **This corrects `selector2.js`'s own inline comment**, which had guessed the gate was `DS:0x2fa` ("freezes aliens") — it is not; `DS:0x2fa` has no bearing on whether these three walkers run at all.

**The sequential ordering is the resolution of an apparent "double movement" bug.** Because `b3ce` (ad1c) completes fully before `b4e7` (ad94) starts, a child freshly written into the ad94 half by `b3ce`'s own shatter-on-landing path is walked, moved, and drawn by `b4e7` **later in the same tick** — one tick of visible motion the instant it's created, not a stutter or a duplicate-step bug. This is the original's own confirmed behavior; a port that runs the two halves as one unified loop over all 42 slots gets the *architecture* wrong (ad94-shaped children run through ad1c-shaped logic or vice versa) even before this timing detail matters.

### `FUN_1000_db4e` — the settle pool's own hero-damage routine, fully decoded `[PROVEN]`

`1000:db4e`–`1000:dbbf`, called with `BP` = the record pointer. A **second, entirely separate** hero-damage routine from the already-documented `attackHero`/`CS:0xac59` — different box test, different damage, different invulnerability behavior, different debris.

```
db4e  test byte[hero.state - CROUCH_LO] in range / crouching -> heroTop = hero.y + 0x18   ; CROUCH_LO..CROUCH_HI states raise the top by 0x18 (0x14 for ac59's own box — DIFFERENT constant)
db68  cmp hotY, heroTop / jl reject          ; POINT-vs-BOX, not box-vs-box
db79  cmp hotX, hero.x / jl reject
db7d  cmp hotX, hero.x+0x20 / jg reject
db8a  cmp hotY, hero.y+0x30 / jg reject
db95  cmp word[0x172],0 / jnz THROUGH        ; invulnerable -> PASS THROUGH, no consume, no damage
db99  sub word[0x192],2                       ; flat -2 off the health TARGET (chases down like every other source)
dba0  mov word[bp+?],0xffff                   ; consume the CALLER'S record (BP-relative — the caller decides which field)
dbb2  spawn a STATIONARY debris spark (velocity forced to 0,0 internally, regardless of what the caller's own velocity was)
dbbf  ret
```

Two confirmed callers, each supplying a different hot point and getting a differently-positioned debris spark:

| caller | hot point | debris spawn point |
|---|---|---|
| the settle pool, `CS:0xB236` | `(worldX, worldY+6)` | `(worldX-8, worldY)` |
| the ad94 fragment walker, `CS:0xB5A6` | `(worldX+8, worldY+6)` | `(worldX, worldY)` |

⚠️ **`db4e`'s crouch raise (`0x18`) does not match `ac59`'s (`0x14`)** — two hero-hit routines in the same game, both crouch-aware, with different magic constants. ⚠️ **`db4e`'s invulnerability behavior is the opposite of `ac59`'s**: `ac59` still reports "hit" (and the caller still kills its attacker) while suppressing only the health subtraction; `db4e` skips the whole branch — no consume, no debris, the hazard passes straight through as if it were never there. ⚠️ **Every `db4e` hit produces a stationary spark, unconditionally** — the caller's own velocity is irrelevant; this is unlike `CS:0xa633`'s other callers, several of which pass the projectile's real velocity through for a moving spark.

Ported as `combat.js`'s `db4eHit(hotX, hotY, hero, health, opts)`, with `DB4E_CROUCH_TOP_RAISE = 0x18` exported alongside it. Wired into both callers: `RockSettlePool.step()` (previously had **no** hero-damage mechanism at all — a genuine gap this session closed) and `RockBurstPool`'s ad94 half.

### `FUN_1000_b4e7` — the ad94 fragment walker, fully decoded, and its 5 divergences from `b3ce` `[PROVEN]`

94 instructions, `1000:b4e7`–`1000:b5e4`, walking 30 slots at `DS:0xad94` (stride 10, contiguous with `b3ce`'s own 12 slots at `DS:0xad1c`). Shares `b3ce`'s tock-gated animation/gravity polarity (`cmp byte[0x36d],0 / jnz skip` — advance only when `0x36d==0`) and its ground-probe formula's general shape, but diverges in five confirmed ways:

1. **Position update (`x+=vx, y+=vy`) runs unconditionally every tick**, not gated behind the tock test the way `b3ce`'s own animation/gravity step is.
2. **Both scrolling off-screen and landing on solid ground funnel into the SAME exit code** (`CS:0xB5C2`) — free the record and drop a **moving** debris spark carrying the fragment's own current `{vx,vy}`. `b3ce`'s ad1c half instead silently culls off-screen fragments with **no** debris at all — only its own landing path shatters/drops debris.
3. **Ground probe is `col=(x+5)>>5, row=(y-2)&~0xf`, testing the SAME cell** — unlike `b3ce`'s own `(x+8)>>5, (y+4)&~0xf, +MAP_COLS` (one row below).
4. **Landing never shatters, ever.** Where `b3ce`'s ad1c half can shatter a landed fragment into three fresh children (written into the ad94 half — see the sequential-ordering note above), `b4e7`'s own landing just frees the slot through the same `CS:0xB5C2` exit as #2.
5. **Hero-hit test is `db4e`** (`CS:0xB5A6`), not `ac59` — see the previous section.

No drag on ad94's `vx` — unlike ad1c, which decays `vx` toward 0 each tock tick.

Ported as `RockBurstPool`'s two private methods, `#stepAd1c` (the pre-existing ad1c-shaped logic, now correctly scoped to slots `0..AD1C_SLOTS`) and `#stepAd94` (new, slots `AD1C_SLOTS..end`), called in the confirmed original order (`#stepAd1c` then `#stepAd94`) from one public `step()`.

### `UNKNOWN_cfcc_pool_sharing` — one pool, two tenants `[PROVEN]`

`DS:0xcfcc`'s ten 10-byte slots are shared by **two independent subsystems**, each with its own first-fit allocator, its own walker, and its own self-modifying enable gate:

| allocator | arms | walker | disarm | role |
|---|---|---|---|---|
| `CS:0x8B0E` (`x += 11`) | `[cs:0x8b56] = 0x90` | `CS:0x8B57` | `CS:0x8B4A` | the falling hazard — **CUT** |
| `CS:0x8619` (`x += 3`, `y −= 0x18`, **STC on failure**) | `[cs:0x8687]` | `CS:0x8688` | `CS:0x8681` | the **world-2 nest creature** — *placed 32 times*; see below |

They read `+0x04`/`+0x06` with incompatible meanings and nothing interlocks them. ⚠️ **The reason the conflict cannot arise is STRUCTURAL, not incidental** — an earlier revision said "only because the hazard half is never instantiated", which is the weaker half of the truth. **The two allocators are gated to different worlds**: `CS:0x8611 cmp byte [0x42],2` for the nest against world 4 for the hazard. Even if the hazard were placed, the two could never coexist.

⚠️ **Correction — `DS:0x3b2` is NOT shared state.** An earlier revision of this section called it "one shared counter". All six references in the image are `CS:0x868E`/`0x869B`/`0x8796` (the nest) and `CS:0x8B5D`/`0x8B69`/`0x8C26` (the hazard), and **each walker sets it to 0 at the top of its own pass**, increments once per live record, and reads it only at the bottom of that same pass to decide whether to unhook its own gate. Nothing survives between the two. The genuine sharing hazard is the **records**.

**`UNKNOWN_cfcc_bottom_row_overrun` — CLOSED negative: the overrun is real arithmetic on a permanently-cut allocator `[STATIC]`.** The `row + 2` overrun belongs to the falling hazard's own allocator, `CS:0x8B0E` — the row directly above in this document's own table, already marked **CUT**. Its sole path in is a **direct** `CALL 0x1000:8b0e` at `CS:0xBD4E`, inside `FUN_1000_bd38` — this document's own already-documented `handlerA` for the world-4/System-A/class-3 environmental hazard (*`UNKNOWN_hazard_emitter_placement`*, above), fired only once its own internal counter `[di+0xe]` reaches exactly 9. Since no shipped System-A descriptor in any of the 8 `PALFILS` files ever selects class 3 in world 4 (the census that closed that hazard as cut), `FUN_1000_bd38` itself can never run, so `CS:0x8B0E` can never be called, so its own unbounded `row + 2` probe can never execute at all in the shipped game — the overrun is real, provable arithmetic, but on code that is doubly unreachable (once through the already-proven-dead class selector, and this call site confirms there is no second path in).

## `UNKNOWN_cfcc_cotenant` — CLOSED: a PLACED world-2 enemy `[PROVEN]`

The pool's other tenant is the **opposite** of the hazard. It is reachable, it is placed **32 times**, and the port had nothing for it — which makes it the first genuinely *missing* enemy this project has found rather than another cut one.

It was missed because it arrives by a route nothing else here uses: **not** the plane-B selector table, **not** the entity group descriptors, but the **object array**. A map object whose `POBJECTS` category is 4 is routed by **sprite id** through a chain of `cmp cx,imm / jz` arms, and one arm calls an allocator.

```
CS:0x1511  ax=[si] (world X)  bx=[si+2] (world Y)  cx=[si+4] (type)
CS:0x1526  mov [ss:0x432],bx        ; the world Y is SAVED here
CS:0x15F1  sub ax,[0xa]             ; X becomes SCREEN.  Y is NOT touched.
CS:0x160D  cmp byte [di+0x4],3 / jl ; category < 3 leaves
CS:0x1613  mov cx,[ss:0x432] / mov bx,cx    ; bx RESTORED to the world Y
CS:0x161D  cmp byte [di+0x4],4 / jnz        ; CATEGORY 4 -> jmp 0x1b5b
CS:0x1CC6  cmp cx,0x11d / jz 0x1c91         ; sprite 285 = object TYPE 115
CS:0x1C91  call 0x8611
```

⚠️ **So `ax` is SCREEN X and `bx` is WORLD Y at the call**, which is why the allocator does `add ax,[0xa]` with no matching `add bx,[0xc]`. The missing-looking instruction was never needed: `CS:0x1613` puts the world Y back deliberately, from a copy saved before any adjustment. A port that "fixes the asymmetry" moves every creature by the scroll offset.

~~`UNKNOWN_ss432_indirect`~~ — **CLOSED `[STATIC, exhaustive]` (2026-09-29), promoted from `[WF]` by re-reading the bytes.** The two instructions are as quoted below (`CS:0x1526` = `36 89 1E 32 04`, `CS:0x1613` = `36 8B 0E 32 04`). No `[bp+…]`-based form (SS by default, no prefix) carries displacement `0x432`. The only SS-relative neighbours are the word at `SS:0x430` (`CS:0x1494`/`0x14B1`, bytes `0x430`–`0x431`) and the byte at `SS:0x434` (the barrier rescan's record counter), and neither overlaps `0x432`–`0x433`. The stack can't reach it either: `GAME.EXE` sets `SP = 0x400` at entry (`CS:0x0018`), so pushes and interrupt frames live below `SS:0x400`. The six `DS:0x432` hits are a different segment (`DS` ≠ `SS`), the hiscore scratch pair. Original text: `SS:0x432` has exactly two references in the whole image, this write and this read (`CS:0x1526` = `36 89 1E 32 04`, `CS:0x1613` = `36 8B 0E 32 04`, both `SS`-overridden). The six other `[0x432]` hits in the binary are `DS`-relative (`A1 32 04`/`A3 32 04`, the DS default with no override prefix) and are a *different* variable — so this scratch word is genuinely private to this one save/restore pair, on the bytes checked. That check is an immediate-operand scan only, though: a pointer parked in a register with an SS-default base (e.g. `[bp+n]`) would not name `0x432` in its encoding at all, and is this project's standing blind spot for this kind of claim.

**Reachability, from the shipped data:** object **type 115** (sprite `170 + 115 = 285 = 0x11d`) is placed **16× in `PLEV2A`, 16× in `PLEV2B`, and zero times in the other six maps** — matching the allocator's own `cmp byte [0x42],2` exactly. The census was run after the world gate was read, and could have contradicted it.

### ⚠️ A shipped bug: the caller tests the wrong flag, so a nest fires ONCE

`CS:0x8611` signals failure with **STC**, exactly like its sibling allocator `CS:0x7F0D` — and the sibling's caller tests it correctly:

```
CS:0x1C7D  call 0x7f0d  /  CS:0x1C80  jc 0x1ce0     <- carry.  Right.
CS:0x1C91  call 0x8611  /  CS:0x1C94  jz 0x1ce0     <- ZERO.   Wrong.
```

ZF is 0 on **all three** return paths: success (`CS:0x8657 add [si],ax` lands the timer in `0x28..0x37`), pool-full (an occupied slot's `x` is non-zero, and neither `loop` nor `stc` touches ZF) and wrong-world (the `cmp` failed by construction). So `jz` is never taken and the fall-through always runs `CS:0x1C98 mov word [si+4],0xffff` — **the object is marked dead whatever happened.**

Two consequences a port must reproduce: **a nest yields at most one creature ever**, so 16 placements cap a sublevel at 16; and a nest activating while the ten slots are full is **consumed with nothing spawned**. The intended `jc` would have left it to retry.

### The record, and the state machine

10 bytes: `{ i16 worldX, i16 worldY, i16 state, i16 hp, i16 timer }`, free when **`x` is negative**. Seeds: `x = screenX + camX + 3`, `y = worldY − 0x18`, `state = −4`, `hp = 60`, `timer = 0x28 + (rand & 0xf)`.

**`sprite = 0x204 + state`, applied unchanged across the whole signed range** (`CS:0x88B4` while hatching, `CS:0x8765` alive). State runs `[−4, +4]`, so the creature owns the **nine consecutive frames 512–520**. Under world 2's load order those are `PLEVEL2B` frames 8–16, and rendered they read exactly as the state machine predicts:

| state | sprite | |
|---|---|---|
| −4 … −1 | 512–515 | four frames growing upward out of nothing |
| 0 | 516 | aiming left |
| 1 | 517 | fired left — **one tick only** |
| 2 | 518 | the dead band — a **symmetric upright** pose |
| 3 | 519 | aiming right |
| 4 | 520 | fired right — **one tick only** |

That is a genuine cross-check, not a restatement: the left/right assignment was derived from the signs of two `cmp bx,ax / jl` branches with no reference to the art, and the art then puts the symmetric frame on exactly the state the dead band writes. Frame 521 is visibly a different creature.

**The hatch is gated on visibility, and that is the spawn gate.** While `state == −4` the timer only ticks inside the window `x ∈ [−24, 320]`, `y ∈ [8, 176]` (`CS:0x8850`–`0x8869`, all four compares signed and inclusive); off screen `CS:0x88DE` resets it to `0x27`. So a nest the player never approaches never opens, and one they walk away from re-arms — which is why there is no separate "activated" flag. ⚠️ That window is a **seventh** distinct cull rectangle, and the only one whose Y floor is positive.

States `−3 … −1` advance one step **every other frame**, gated on `DS:0x36c` (the toggle `CS:0x0172` flips with `NOT`). ⚠️ When the increment carries state to 0 the handler does **not** return — `CS:0x8840 jmp 0x86b1` runs the live AI in the *same* tick.

⚠️ **The hitbox changes with state, by a factor of nine**: `8 × 8` at `(x+8, y+15)` while hatching (`CS:0x8883`) against `24 × 24` flush at `(x, y)` alive (`CS:0x8740`). One box for both makes the whole emergence a free kill. ⚠️ The blitter changes mid-hatch too — `CS:0x88AF cmp dx,0xffff / jnl` sends `state ≥ −1` to export 1 and everything below to export 2.

### The fire logic — asymmetric twice over

```
86C1  ax = [si]              ; entity X
86C3  bx = [0x17a] ; add bx,0x20
86CA  cmp bx,ax / jl 0x8703  ; heroX + 32 < entityX  -> hero LEFT, fire left
86CE  sub bx,0x38            ; bx is now heroX - 24  -- CUMULATIVE
86D1  cmp bx,ax / jl 0x8736  ; heroX - 24 < entityX  -> the DEAD BAND
86D5  mov word [si+4],3      ; else                  -> hero RIGHT, fire right
```

⚠️ **`sub bx,0x38` is applied to the already-biased `bx`.** Read as a fresh offset from `heroX` it gives −56 and widens the band from 56 px to 88. The band is `heroX − entityX ∈ [−32, +24)` — **32 left, 24 right, inclusive on the left and exclusive on the right.**

Muzzles are asymmetric too: right `(x + 0x18, y + 6)`, left `(x − 6, y + 6)`. Only the direction word `DS:0x206` (±5) is a clean mirror. ~~`UNKNOWN_cfcc_muzzle_asymmetry`~~ — **measured (2026-09-29), and the "why" retired as intent.** The shot sprites `0x45`/`0x48` are 16 px wide and opaque across all 16. The fired frames aren't mirrors of each other: in 517 (fired left) the head's tip is at x = 0 (rows 1–3), and in 520 (fired right) it is at x = 19, with the upright 518 centred near x = 12. So the left shot, spanning `[x − 6, x + 9]`, starts 6 px beyond the head and overlaps 10 px back into it, while the right one, `[x + 24, x + 39]`, starts 4 px clear of the tip. Neither the art nor the other muzzle is mirrored, so there's no mechanical reading, and the choice is the author's.

**Timers.** `CS:0x86BB cmp word [si+8],0x28 / jg` runs the aim logic only at or below 40; the reload is **42**, which is *greater*, so for two ticks after every shot the creature holds its fired pose without re-aiming. The steady period is 43 ticks (the shot lands when the `dec` goes negative) ≈ 2.9 s at 15 Hz.

⚠️ **But the FIRST shot comes after 40, not 43** — the emerge handler reloads `0x27` = **39**, which is *below* the gate, so the aim path runs immediately. The two numbers differ purely because the reload straddles the gate in opposite directions.

⚠️ **And the timer FREEZES in the dead band.** `CS:0x8736` writes state 2 and falls straight through with **no `dec`** — only the two aiming branches decrement. Since the `> 40` gate decrements *before* the aim test, a creature whose hero has stood in the band since its last shot sits at exactly **40** and needs 41 more frames once the hero leaves. A port that ticks the timer unconditionally fires the instant the player steps out.

⚠️ **The random part of the seed is probably never observed.** All four cull branches of state −4 target `CS:0x88DE`, which forces the timer to 39 on **every** off-screen frame — and the activation box (±64/±48 around the screen) is *larger* than the emerge window, so an approaching nest is normally allocated while still culled and the `0x28 + (rand & 0xf)` is overwritten before it is ever decremented. An earlier revision of this section claimed the randomisation exists "to stop sixteen nests firing in lockstep"; that is **not supported**. ~~`UNKNOWN_cfcc_dormant_seed_observable`~~ — **CLOSED `[PROVEN]` live (2026-09-29): the seed is observed after a camera cut, and only then.** In ordinary scrolling the activation box allocates a nest while it is still culled. `gods-web`'s replay of the world-2 demos (exact against DOSBox) shows three allocations, all reset to 39 on their first tick. A respawn is different. With `DS:0x32 = 0`, `FUN_1000_0845` re-inits the camera (`CS:0x08D3`) and forces the activation recompute (`CS:0x08EB`). A nest near the checkpoint can then be allocated already inside the hatch window. Live in `PJOYL2` (`gods-web/tools/attract-capture/nest_live.py`: the health poke is the only non-original step, and the respawn at 2A's checkpoint (2816, 576) is the game's own), the next tick allocated the nest at (2750, 544), on screen at (78, 40), with timer **53** = `0x28 + 13`. It counted 52 → 34 for 19 ticks, until the camera scrolled it out of the window and it was reset to 39. Offline, 12 checkpoint/nest pairs in 2A and 8 in 2B put a nest inside the window at a respawn cut. ⚠️ World 2B's attract demo runs a scripted camera (`DS:0x32 = 4`), which skips the respawn's camera re-init (`CS:0x08C5`), so it can't show a cut.

**Freeze covers only the middle third of the dispatch.** `CS:0x86B1 cmp word [0x2fa],0 / jnz 0x873b` lands past the aim and fire logic but **before** the contact test and the draw. And because HP and state are tested *earlier* — at `CS:0x869F` and `CS:0x86A8` — ⚠️ **the dormant countdown keeps ticking, the rise keeps advancing and the death animation keeps running while "freezes aliens" is active.** Only `CS:0x86BB`–`0x8736` stops. A frozen creature still hurts the hero, still takes damage, still draws and still counts live.

**The companion draw, `CS:0x8806`,** blits sprite `0x11d` — the object's own sprite — at `(x−3, y+0x18)` on *every* path. The creature carries its own plinth, which is why the dispatcher can mark the object dead immediately without it vanishing.

⚠️ **Those offsets cancel the allocator's exactly.** The seed is `x + 3`, `y − 0x18`; the pedestal draw is `x − 3`, `y + 0x18`. So **the plinth is drawn precisely on the placed object** and the creature's own record sits 3 px right and 24 px above it. That is a self-check on both readings at once — and it matters, because ⚠️ **the aim compare uses the creature's X, not the object's**, so the dead band is centred 3 px right of where the art sits.

### Death, and the brood

Entered when HP goes negative. Each tick draws `state + 0x6c` **twice**, at `(x−4, y−8)` and `0x18` lower, then `inc state`. Sprites 108–114 are `PALWAYS2#69..71` then `PALWAYS3#0..3` — the sequence **crosses an atlas boundary**, which only the cumulative descriptor numbering makes work.

⚠️ **A creature killed MID-RISE does reset to 0.** `CS:0x88C6`/`0x88DB jmp 0x877e` means the emerge draw shares the live path's tail, so `CS:0x8784 mov word [si+4],0` applies to it too — otherwise the death handler would start negative and draw sprite `0x6c − 3`, three frames before the death cloud. `CS:0x8789` then calls `0x87EF`, the reward and the score award, both `[PROVEN]` live (2026-09-28; the score by a trace of `CS:0x8A2F`/`0x8A32` around the `call 0xC8B`, where `[0x3B6]` went from `0x07` to `0x32` at `PJOYL2` cursor 1888 — the score is the 4-byte BCD at `0x3B5`, and `0x0C8B` adds `dl` into its hundreds byte): `0x87EF → 0x8A27` spawns a **popup id `0x2D`** (object type `0x22`) at `(x+4, y+0x18)` with Y-velocity `0xFFFA` (−6) via `CS:0xBF5F`, then **unconditionally** `clc / call 0xC8B`, which enters the BCD score chain at `[0x3b6]` with `dl = 0x25` = **2500 points**. ⚠️ An earlier reading said the popup is *skipped* when the slot is busy (`[0x1a0] ≥ 0`); `CS:0xBF64`/`0xBF6B` jumps to `CS:0xC041` instead, so the item becomes a world object at once. Live in `PJOYL2`: the nest dies at cursor 1888, and its reward lands as object type `0x22` at x 3306 at 1899, bounces (`0x504`–`0x507`) and is picked up at 2070 (`gods-web/tools/attract-capture/joyl2.objfall.peek.json`). `gods-web` had the state write but not this call, so no nest ever dropped anything; now fixed (`game/nest.js`).

### `UNKNOWN_bf5f_popup_id` — CLOSED: a general floating-item-icon popup, and id `0x3D` is deliberately special-cased to respawn a spike `[STATIC]`

`CS:0xBF5F`–`0xBF7F` is the popup *spawner* (single-slot, `DS:0x1a0` holds the id or `0xFFFF` when free — `CS:0xBF80`'s own sibling entry is the per-tick *updater*, which floats the popup by its stored Y-velocity and, once `id ≥ 0xB` (11), fetches a sprite for it):

```
bf5f  cmp cx,0x3d / jz 0xbf59        ; id == 0x3D (61) -> DIVERT, see below
bf64  cmp word[0x1a0],0 / js 0xbf6e  ; slot already busy?
bf6b    jmp 0xc041                   ; BUSY -> forward straight into the respawn routine instead
bf6e  [0x226]=AX / [0x228]=BX / [0x22a]=0xfffa(-6)   ; seed world position + Y-velocity -6
bf7b  [0x1a0] = CX                   ; id becomes the "popup active" flag
bf7f  ret

bf80  cmp word[0x1a0],0 / js 0xbf7f  ; UPDATER: inactive -> nothing to do
bf87..bf92  world -> screen, Y += velocity, CX := the stored id
bf96  cmp cx,0xb / jl 0xc004         ; id < 11 -> a PLAIN NUMERIC popup (score-style, CS:0xc004, not chased further)
bf9b  sub cx,0xb                     ; id >= 11 -> POBJECTS TYPE = id - 11
bf9e  si = 0x2a4e + type*10          ; the runtime object-descriptor table, stride 10 — already documented elsewhere
bfab  cx = word[si]                  ; descriptor +0 = sprite id (170+type)
bfb9  cmp cx,0x117(279) / jz 0xbff1  ; two hardcoded special sprites get bespoke draw handling, not chased further
bfbf  cmp cx,0x118(280) / ...
      [otherwise: draw the fetched sprite floating up from the world position]
```

**The `id == 0x3D` divert is not a rejection — it's a deliberate second path.** `CS:0xBF59` (`and bx,0xfff0 / jmp 0xc041`) snaps the popup's Y to a 16-px tile boundary and jumps straight into `CS:0xC041` — this document's own already-documented **"steal-and-carry" respawn routine**, which allocates a fresh `DS:0x8314` object slot and drops a live object of type `(id − 11)` back into the world at the given position. `0x3D − 11 = 50`, and **`POBJECTS` type 50 is `"spike"`** (decompressed and read directly: `PWEAPONS`/`POBJECTS.001` record 50 → name `"spike"`, the one *named* category-4 object this document already flagged). So the world-2 nest's own death award (`popup id 0x2D`) and a spike hazard share this one entry point, but they take genuinely different branches: **a spike (id `0x3D`) is re-dropped into the world as a real, solid object instead of floating up as a collectible-style icon** — matching what a spike trap should do on reset (become a physical hazard again, not a score popup). The busy-slot fallback (`CS:0xBF6B`) reaches the identical respawn routine for the *same* reason: if a popup is already in flight, a second request is treated as "drop a real object" rather than losing the request.

**Popup id `0x2D` (45) itself is the ordinary case** — `45 − 11 = 34`, and **`POBJECTS` type 34 is `"jewel"`** (same direct read; empty description). So the world-2 nest's death award floats a jewel-icon popup up from the kill point at `(x+4, y+0x18)`, falling under gravity (`Y += −6` per tick, uncapped in the bytes read here), while the BCD score chain separately and unconditionally credits the player 2500 points — the popup is purely a visual flourish layered on top of the score award, not the mechanism that grants it.

**`UNKNOWN_bf5f_special_sprites` — CLOSED: the two special-cased sprites are the same alternate-blitter treatment, just raised and drawn through export 1 instead of export 2 `[PROVEN]`**

```
bfb9  cmp cx,0x117(279) / jz 0xbff1     ; sprite 279
bfbf  cmp cx,0x118(280) / jz 0xbff1     ; sprite 280
      [otherwise: [0x4]=ax / [0x6]=bx / [0x8]=cx / CALL 0x1000:356e]   ; the GENERIC case — export 2
...
bff1  bx -= 0x8                          ; raise the draw point 8px
bff4  [0x4]=ax / [0x6]=bx / [0x8]=cx
bfff  call 0x1000:3569                   ; export 1 — the OTHER masked-sprite blitter, not export 2
```

`sprite − 170` gives `POBJECTS` types **109** and **110**; decompressing `POBJECTS.001` and reading both records directly: **type 109 = `"magical gem"`, type 110 = `"treasure chest"`** — both category 2, both with an empty description, distinct from the ordinary treasure-category chest (type 16, category 1, description `"iron"`) this document already documents being scattered by the hidden trap object. So these two are a **second pair of dedicated popup-only icon sprites** — a gem and a chest — routed through export 1 (the sibling masked blitter, differing from export 2 only in clip bounds per this document's own driver-export table) with their draw point raised 8px, presumably because these two icons are taller than the ordinary floating pickups and would otherwise clip or sit visually low against the generic export-2 path.

**`UNKNOWN_bf5f_special_sprite_callers` — CLOSED negative: no live path ever awards id `0x94`/`0x95`, and tracing why surfaced a THIRD group-elimination-reward mechanism `[STATIC, exhaustive]`**

`CS:0xBF5F` has exactly **10** callers program-wide (`get_xrefs_to`, exhaustive). Nine pass a literal, already-attributable id via `MOV CX,imm16` — this document's own already-documented `0x2D` (jewel, the world-2 nest's death award) and `0x3D` (the spike-respawn divert) among them, plus three more read here for the first time: `CS:0x0DAA` (`CX=0x12`=18 → type 7), `CS:0xD605` (`CX=0x1F`=31 → type 20, `"world key"`, from a scripted-event routine seeding a fixed screen position rather than the shared `[0x202]`/`[0x204]` death-position cache), and the already-documented System-A/B/PAT/nest sites. **A program-wide `search_instructions` sweep for any `MOV`-shaped load of the literal `0x94` found zero hits anywhere in the image** — no static site ever loads either target id as an immediate.

The tenth caller, `CS:0xAEFA` inside `FUN_1000_aebb`, is the only one that passes a **computed** id (`MOV CL, byte[SI+0x1E]`, zero-extended) — and chasing it surfaced a mechanism this document had not previously documented: **the selector-2 spawn system (`DS:0xaec0`, already documented under *the five other emitter-pair owners*) has its own group-elimination-reward pattern**, structurally parallel to System-B's `FUN_1000_ed38`/`0xf030` (*`UNKNOWN_f030_item_drop`*, above) but with its own globals: `SS:0x42a` tallies dead entities for the currently-processing slot, `[si+4]` (copied from the class's own `+0x10` field at materialise time, `CS:0xAE02`–`0xAE06`) is the batch's total entity count, and once `SS:0x42a` reaches it, `CS:0xAEFA` fires a popup at the shared `[0x202]`/`[0x204]`-derived position using `[si+0x1e]` as the id, then latches `[si+0x1e] := 0xFF` (`CS:0xAEFD`) so the reward can never re-fire for that slot. Once **every** slot's entities are fully dead, `CS:0xAF0A` deactivates the whole selector-2 runtime slot (`[si+6] := 0`) for reuse.

**But `[si+0x1e]` is never set to anything meaningful.** An exhaustive `search_instructions` sweep for every `[SI+0x1E]`/`[DI+0x1E]` access in the image finds **exactly two** touching this field within `FUN_1000_aebb` itself (the read at `0xAEF0` and the `0xFF`-latch write at `0xAEFD`) and **no other writer anywhere** — not in the allocator `CS:0xAD0D`–`0xAD61` (which copies the class's `+0xC`/`+0xD`/`+0x11`/`+0x13` bytes into other runtime offsets, per this document's own already-documented copy list, but never into `+0x1E`), and not in either level-init clear (`CS:0x0045`, the one-time entity-storage-pointer seed touching only `[si+0]`; `CS:0x9040`, the per-level clear touching only `[si+6]`). So `[si+0x1e]` is left holding whatever was in memory the first time a given slot is ever used, and — because it is set to the terminal `0xFF` sentinel the very first time the reward fires and never reset afterward by any code path — it can only ever equal `0xFF` or genuinely uninitialised memory, never a deliberately-authored reward id. Consistent with this project's own established convention that fresh memory here reads zero in practice, the observed effect is that this reward mechanism's `CX` is `0` on every real firing — landing in `CS:0xBF5F`'s own `id < 0xB` branch (the "plain numeric popup," not the object-icon path) every time, never reaching the `id ≥ 0xB` object-sprite branch at all.

So the closure is a clean exhaustive negative on two independent fronts: no static call site ever loads `0x94`/`0x95` as a literal, and the one computed-id call site is provably wired to a field nothing ever sets to a real value. **Popup ids `0x94`/`0x95` — the magical-gem and treasure-chest icons — are unreachable in the shipped game**, joining this project's own established family of wired-but-inert content (alongside the `DS:0x432`/`0x436`/`0x43a` hiscores validation block this same session already closed) — real, correctly-implemented code on both the reward-tracking side and the popup-rendering side, with the one connecting field never populated.

⚠️ **CORRECTION, a later session — `[si+0x1e]` DOES have a real writer; the allocator claim above does not survive a fresh trace.** Porting the selector-2 spawner (`gods-web/src/game/selector2.js`) required re-reading `CS:0xAD0D`–`0xAD61` instruction by instruction, tracking `DI` through every `STOSW`/`MOVSW` from its `ADD DI,0x6` entry (`CS:0xAD2C`) to its `RET` (`CS:0xAD61`) rather than trusting the earlier pass's own field inventory. That trace lands the allocator's own closing `LODSB`/`STOSB` pair exactly on slot `+0x1E`:

```
ad42  movsw                     ; slot+0x10..0x11 := class[8..9] RAW  (entity count / per-batch state seed)
ad43  lodsw / mov bx,ax         ; class[0xa..0xb] BE -> BX, the class-table index (held, not stored yet)
ad48  movsw                     ; slot+0x12..0x13 := class[0xc..0xd] RAW  (facingSelect / reloadByte)
ad49  lodsb                     ; AL := class[0xe]              — the FIFTEENTH byte of the 16-byte record
ad4a  mov si,word[0x1fc]        ; SI reassigned to the class_table pointer — does NOT touch AL
...   (five MOVSWs copy class_table[cls]'s own fields to slot+0x14..+0x1d — AL untouched throughout)
ad60  stosb                     ; slot+0x1e := AL                — class[0xe], still the byte read at ad49
```

The earlier pass's own DI-offset count stopped one step early: it credited the allocator with copying only `+0xC`/`+0xD`/`+0x11`/`+0x13`, treating `CS:0xAD49`'s `LODSB` as the record's last consumed byte, and missed that `AL` survives untouched through the five subsequent class-table copies to be stored at `CS:0xAD60`. **So the reward id is genuine, level-authored PALFILS data** — `+0xE` of the 16-byte selector-2 class descriptor (`DS:0x9720`, PALFILS `+0x0718`) — not a stale, always-`0xFF`/uninitialised field, and the "lands in the plain-numeric-popup branch every time" conclusion two paragraphs up does not hold. `gods-web/src/game/selector2.js` reads it as `rewardItemId` and implements the full `CS:0xBF5F` split (`id < 0xB` → a plain popup value, `id >= 0xB` → `POBJECTS` type `id-0xB`). The **0x94/0x95-specific** half of this closure is unaffected and stands exactly as written: no static site anywhere loads either literal, so those two particular sprite ids remain unreachable by any path — this correction is narrowly about whether `[si+0x1e]` itself ever carries a real, non-sentinel value, and it does.

⚠️ **From a LIVE state, death inherits it; it does not reset.** `CS:0x87DA` is `cmp ...,4 / jnz` — an *equality* test — and `CS:0x87E9` frees at ≥ 7:

| killed in state | ticks dying | broods? |
|---|---|---|
| 0 | 7 | yes |
| 3 | 4 | yes |
| **4** | 3 | **NO** — it increments straight past 4 |

State 4 lasts exactly one tick, so the window is narrow, but a port written with `>= 4` loses it.

**The brood, `CS:0x88E5`.** ⚠️ **3 or 4 children, not 2 or 3** — `mov dx,2 / add dx,(rand & 1)` with `dec dx / jns` at the bottom runs one pass more than the seed suggests. (Fourth time this project has been caught by that shape, after the starburst particles, hits-to-break and the block's first shot.) Target array `DS:0x8014`, **16 records of 16 bytes**, free when `+4` is negative, exactly the 256 bytes `CS:0x8676` fills. Children inherit the parent's `x, y` by `movsw / movsw` and then add `0x18` to y.

⚠️ **The two seeded signed fields use different random shapes**, drawn in this order:

```
CS:0x8913  and ax,3 / neg ax / sub ax,2      -> +0xa, always -2..-5
CS:0x8921  mov bx,ax / and ax,3 / or bx,bx / jns / neg ax
                                             -> +0x8, MAGNITUDE from the mask,
                                                SIGN from the untouched word
```

A single `(rand & 3) − 2` reproduces neither: wrong range, wrong symmetry, and it never reaches −3 or +3. ⚠️ They are **not labelled** here — a small signed pair, one symmetric and one strictly negative, on something bursting out of a corpse is *consistent* with `{vx, vy}`, but the consumer is `CS:0x894E`, which is out of scope.

⚠️ A full brood array **abandons the whole burst** (`CS:0x8904` leaves the per-record walk), not just one child.

### Live confirmation: the full spawn→hatch→fire→death lifecycle, watched under DOSBox `[PROVEN]`

Traced live in a fresh session (DS segment `4970`, real gameplay, not the demo). Located all 16 shipped `PLEV2A` nest positions by decompressing the map (`blast.py`) and reading the object section at the correct offset (`header_len + 0x4000` — the earlier attempt in this same session used a bare `0x4000` and produced garbage types, a reminder that the header length is per-file and must be measured, not assumed 4 or 46 by default) — types match the document's own already-recorded 16/16 count exactly. Walked the hero to the nest at map coordinates `(3297, 392)`.

**Spawn/hatch:** by the time the pool was next read, `DS:0xcfcc` slot 0 held `{x=3302, y=368, state=3, hp=60, timer≈37}` — the seed position matches the documented `+3`/`-0x18` pedestal offset from the placed object exactly (`3297+3=3300≈3302`, `392-24=368` exact), and `hp=60` matches the documented seed. State 3 (aim right) is consistent with the hero standing to the nest's right at the moment of the read — the hatch phase itself (states −4..−1) passed between polls and wasn't caught mid-transition, but the seed values and post-hatch state are exactly as documented.

**Aim/fire cycle:** the timer field was watched decrementing every ~0.1–0.3 s of real time (37→5→2→34→31, consistent with 15 Hz ticks and the documented reload-after-fire jump past the aim gate), while `hp` stayed at 60 (untouched) throughout — confirming the aim/reload timer runs independently of damage state.

**Forced death:** a single isolated `debug_pause` → `mem_write` (hp field, `+6` in the 10-byte record, set to `0xFFFF`) → `debug_continue` cycle was used to force the death path (per the document's own already-established "death entered when HP goes negative"). Within well under 1 second of real time the record's `state` field was observed at `7` — the documented free threshold — and the slot's `x` had reverted to `0xFFFF` (freed), matching the documented 7-tick death-draw-then-free sequence (7 ticks ≈ 0.47 s at 15 Hz). `DS:0x39` (the PIT tick counter) was confirmed still cycling normally immediately after, and the screen was rendering live gameplay throughout — this single isolated write did **not** reproduce the earlier session's freeze, reconfirming that the freeze risk is tied to *rapid, repeated* pause/write/continue cycling, not to an isolated one.

This is the first live, real-input (non-demo) confirmation of the nest's documented spawn-seed values, aim/reload timing, and forced-death-to-free timing, closing the loop on what was previously a purely `[STATIC]`/inferred lifecycle for the live-fire and death portions specifically (the hatch phase itself remains inferred from the code, not directly observed transitioning).

### Where it sits in the frame, and the pool lifecycle

The main loop calls all three of these pools' gate bytes, in this order:

```
CS:0x027F  call 0x894d    ; the DS:0x8014 brood gate
CS:0x0282  call 0x8687    ; THIS creature
CS:0x0285  call 0xed15    ; System-B entities
CS:0x0291  call 0x8b56    ; the DS:0xcfcc falling hazard (cut)
```

`CS:0x8661` (from `CS:0x69C0` and `CS:0x8E4F`, level init) disarms both gates, fills `DS:0x8014` with `0xFFFF` **in world 2 only**, then `mov si,0xcfcc / jmp 0x7f48` to clear the pool. ⚠️ That jump lands **inside a third pool's clear routine** — `CS:0x7F45` is `mov si,0xce64` falling into the same loop — and the shared tail `CS:0x7F55` disarms the `DS:0xce64` walker as a side effect. ~~`UNKNOWN_ce64_pool`~~ — **CLOSED**, see *`UNKNOWN_ce64_pool` — CLOSED* below.

⚠️ **`DS:0x8014` is itself shared, by world.** `CS:0x7CBD` gates on `cmp byte [0x42],1`; `CS:0x7EB6` is not a separate gate but one instruction *inside* the world-1 populator `FUN_1000_7e9b` (see the full closure just below), which performs the identical world-1 test as part of its own plane-A scan; and `CS:0x7E62` uses the populated records to write **plane A** (`mov si,0x3004 / mov [si],bl`). The two tenants are mutually exclusive by world, which is exactly why nothing interlocks them and why the level-init clear is world-gated.

### `UNKNOWN_8014_world1` — CLOSED: a hidden-statue "wakes up and attacks" mechanic, exclusive to world 1 sublevel B `[STATIC]`

⚠️ **Correction to an earlier pass of this section, caught by a live DOSBox check that came back empty.** Live-reading `DS:0x8014` on `PLEV1A` (world 1, sublevel `'a'`) found the table entirely `0xFFFF` — not a bug in the reading, but the actual shipped behaviour: this content is **sublevel-`'b'`-exclusive**, not merely world-1-exclusive as first written. Tracing why closes the record layout and the trigger's coordinate units in the same pass.

**The real populator is `FUN_1000_7e9b`, called from `FUN_1000_2a37`** (the central `.MAP`/`PALFILS` loader this document already credits with those loads) — a fourth, previously-unexamined reference to `0x8014` this pass's `search_instructions` turned up alongside the three already on record:

```
7E9B  DS = ES = 0x1ffd                  ; the game's own real DS segment (not just this doc's Ghidra base)
7EA2  SI = 0x3004 ; DI = 0x8014 ; BP = 0
7EAB  cmp byte[0x43],0 / jz 0x7ec7      ; SUBLEVEL != 'a' ? if 'a' (0), skip the scan entirely
7EB2  cx = 0x2000                        ; else: scan ALL 8192 plane-A cells
7EB5    lodsb                            ; al = this cell's tile
7EB6    cmp byte[0x42],1 / jnz 7ec5      ; world != 1 -> no match, next cell
7EBD    cmp al,0x23 / jz 7ed4            ; tile 0x23 -> MATCH (variant A)
7EC1    cmp al,0x24 / jz 7ed4            ; tile 0x24 -> MATCH (variant B)
7EC5  loop 7eb5
7EC7  cmp bp,0x20 / jz 0x7ed3(ret)       ; (the 'a'/non-world-1 path falls straight here with bp=0)
7ECC  ax=0xffff ; cx=4 ; stosw x4        ; write ONE all-dead 8-byte terminator record, then RET
```

**So on sublevel `'a'`, or any world but 1, `DS:0x8014` is forced to a single dead record and nothing else ever runs** — exactly what the live read on `PLEV1A` showed. Only on world 1 sublevel `'b'` does the function scan the freshly-loaded plane A for tiles `0x23`/`0x24` (up to 32 hits) and, for each, compute and store:

```
7ED9  bx = (matched cell offset) ; row = bx >> 7 (plane A stride 128)  -> [DI+2]
7EEA  col = (matched cell offset) & 0x7f                                -> [DI]
7EF0  [DI+4] = 0                 ; NOT FIRED
7EF8  [DI+6] = the matched tile id (0x23 or 0x24), from AL             ; STOSW using stale AH
```

**This corrects the record layout** this document's earlier pass guessed at: `DS:0x8014` (world 1, sublevel B) is `{i16 tileCol, i16 tileRow, i16 fired, i16 matchedTileId}` — **tile-grid coordinates (0..127, 0..63), not world pixels**, and the 4th field is the matched tile id, not a duplicate of the 3rd. `CS:0x7E62` (level init, `FUN_1000_7e58`, called from the outer level-init `FUN_1000_8c34`) then re-stamps the map using that **stored** tile id (`[DI+6]`, not a hardcoded constant) at the record's plane-A position — a two-row stamp (`base`, `base+10`) — which is what makes a level *reload* restore any statue that had already woken up back to its original, undisturbed tile.

**`CS:0x7CBD` (the trigger) now resolves cleanly, including its own long-flagged residual.** It processes one `0x8014` record per tick via a cursor at `DS:0x24e`, skipping already-fired records (`[si+4] != 0`). The proximity test compares the **camera position shifted into the same tile-grid units** (`camera_x >> 5`, i.e. ÷32; `camera_y >> 4`, i.e. ÷16 — the game's own standard 32×16 tile size) against the record's own **already-tile-grid** `[si]`/`[si+2]` — **so `UNKNOWN_8014_trigger_box_units` is closed: there is no unit mismatch, both sides of the comparison are in tile-grid coordinates all along**, which only became legible once the populator (not just the trigger) was read. If the hero is currently overlapping a `0x30×0x30` px box around the record (tested via `CS:0xac59`, bracketed by the `CS:[0x71d]` self-modifying player-state gate and a `DS:0x250` health snapshot, exactly as this document documents for the respawn path), the statue defers rather than fires that tick. Otherwise it fires: marks `[si+4] = 0xFFFF`, rewrites the plane-A pair to tile `0xd`, and allocates into `DS:0xcdec` with `worldX = tileCol × 32`, `worldY = tileRow × 16` — the tile→pixel conversion this document's earlier pass had already correctly inferred for the *output*, now traced to its actual source — seeding one of two initial states depending on which tile (`0x23` vs `0x24`) matched.

**`DS:0xcdec` (`FUN_1000_7b68`/`CS:0x029A`) is the awakened statue's live behaviour: a 10-slot, 12-byte, world-1/sublevel-B-exclusive homing hazard.** `{i16 worldX, i16 worldY, i16 state, i16 animFrame/deathCounter, i16 stepX, i16 stepY}`, free when `state == 0`. While alive (`state` in `0..0x10` and the "freezes aliens" potion `DS:0x2fa` inactive) it **ratchet-steers toward the hero** — the identical clamped ±1-per-tick catch-up shape this document's own camera code uses — draws via the shared entity blitter `CS:0x3569` with an idle/walk sprite table at `DS:0xdf68`, and calls the shared **hero-contact-and-damage-grid-scan routine `CS:0xa9e4`** (via the `FUN_1000_7c7c` wrapper this document's `UNKNOWN_sfx_id_space` closure already found — the `DS:0x35e` bracket around it selects the ROL-only alternate death sound `0x49` for this creature specifically). On death (`state` goes negative) it plays an **18-tick burst-and-fall animation**, sprite `= 0x5b + deathCounter` — the identical `0x5b`-base sprite convention this document already documents for entity death frames, shared with the hero's own death burst (`DS:0x24c`, under *The death/respawn reset set*) — before freeing the slot.

**`UNKNOWN_dxf68_sprite_table` — CLOSED.** Read live (DOSBox, `DS` segment `4970` this run, verified against the documented fallback-palette constant beforehand): the first 8 words are **`450, 451, 452, 451, 456, 457, 458, 457`** — two 4-frame ping-pong idle cycles (`0,1,2,1` shape twice, offset by 6 sprites), both drawn from atlas base **450** — this document's own already-established `level1` group base (`always`(170) + `objects`(280) = 450, the same atlas this document separately proves holds `PLEVEL<N><X>.PI1`'s 60-frame 32×32 creature strip). So the awakened statue's idle animation is cut straight from the `level1` creature sheet, with two distinct 3-unique-frame cycles — almost certainly the two tile-`0x23`/tile-`0x24` variants each getting their own idle loop, six sprites apart in the same strip.

So the mechanism this document had recorded only as "`DS:0x8014` is shared by world, and `CS:0x7E62` writes plane A" is a small, complete, previously uncatalogued **scripted enemy exclusive to world 1, sublevel B**: a decorative two-tile statue baked into the map, discovered by scanning the level's own plane A for one of two tile ids at load time, that — once scrolled on-screen and the hero isn't already touching it — replaces its own art, spawns a hero-homing, damage-dealing creature with a full death animation, and resets back to dormant stone on the next level load. Tagged `[STATIC]` — read from the bytes across four functions and cross-checked for internal consistency (units, field layout, and the live DOSBox negative-result on sublevel A), but not yet watched firing on `PLEV1B` itself; a live visit there would promote it to `[PROVEN]`.

### What category 4 is, from the data side

Types **50, 73, 96, 97, 115, 117, 130** are category 4, identically in all four `POBJECTS` files. **Six of the seven have an empty name and an empty description**; the exception is type 50, named `"spike"`. That fits: categories 0–3 are potion / treasure / keys / levers — all things the hero picks up and all named — while category 4 holds things that are *done to* the hero. A category-4 object is also rejected by the walk-in pickup path (`CS:0x17E6 jg` sends category ≥ 2 away), so it never needs text. `POBJECTS` categories 4 and 5 remain `UNKNOWN` as enums, but this is what 4 looks like.

**Category 4 is also the trigger system's own deletion target.** Trigger `ACT6` (`CS:0x3BD1`) kills up to 2 category-4 objects inside a ±12px box around the firing trigger's point — the mechanism behind lever-neutralized spikes on world 1 (7 of `PLEV1A`/`PLEV1B`'s 13 type-50 objects, live-confirmed under DOSBox); see *How levers neutralize hazards* in `docs/triggers-and-difficulty.md`.

### The retracting spike hazard — types 50/117/130, `CS:0x1B72`/`0x1AF6` `[PROVEN]`

Undocumented before this pass: the paragraph above named all seven category-4 types and stopped once the two already-known members (the world-2 nest, type 115, and the world-3 `ce64` creature, type 96, both below) were matched. Reading `CS:0x1B5D`-`0x1B6F`'s own sprite dispatch (`170+type`, since these are ordinary stamped map objects) past those two turns up a third, previously-unchased mechanism, shared by three of the remaining five types:

```
1b5d  cmp cx,0x11f / jz 1b72     ; type 117 -> the SHARED animated body
1b63  cmp cx,0x12c / jz 1af6     ; type 130 -> its OWN, simpler body
1b69  cmp cx,0xdc  / jz 1b72     ; type  50 ("spike") -> the SAME shared body
1b6f  jmp 1c77                   ; else -> ce64/nest/etc (below)
```

**Shipped census** (re-derived from this project's own 8 maps): type 50 places **13/13/11/11** across worlds 1-2 (48 total — the single most common category-4 object in the game); type 117 places **4** times, world 3B only; type 130 places **9/8** across world 4 (17 total). Type 73, the only category-4 type with zero placements anywhere, is not chased further.

**The retract/extend motion is a GLOBAL ping-pong counter, `DS:0x39b`**, shared by every type-50/117 object in a level at once — they animate in lockstep, not independently:

```
CS:0x1447  inc byte[0x39b] / and byte[0x39b],0x1f   ; 0..31, once per tick (the
                                                     ;   SAME per-object-pass
                                                     ;   function, FUN_1000_1432,
                                                     ;   that stepPickups already
                                                     ;   drives in the gods-web port)
CS:0x1B83  dl=[0x39b] ; test dl,0x10
           if SET:   dl &= 0xef ; result = 15 - dl     (16..31 -> 15..0)
           if CLEAR: dl &= 0xef ; result = dl           ( 0..15 ->  0..15)
```

— a 0..15..0 triangle wave over 32 ticks (~2.1s at 15Hz), verified by direct computation over all 32 raw values.

The hazard's own "tip" Y (world space) is `obj.y + 15 - pingpong` (`CS:0x1BA3`-`0x1BA8`: `+0x1f`, `-pingpong`, `-0x10`). The BASE sprite (`170+type`) draws 16px below that (`CS:0x1BE1 add bx,0x10` undoes the `-0x10` for the DRAW only, not the hitbox test — `objY+31-pingpong`); the OVERLAY sprite draws back at the tip Y (`CS:0x1C10 sub word[0x6],0x10`) — the overlay is the part that visually reaches toward the hero.

**THE HITBOX**, `CS:0x1BAB`-`0x1BD8` — X genuinely cancels the camera (both operands get `-camX`); Y is compared directly, because this whole walk keeps category>=3/4 objects' Y in world space (see `UNKNOWN_ss432_indirect`, above):

```
heroX in [objX - 24, objX + 8]
heroY in [tipY  - 40, tipY]
```

`CS:0x1BD1 cmp word[0x172],0 / jnz reject ; CS:0x1BD8 sub word[0x192],2` — **a flat 2 HEALTH TARGET (`DS:0x192`) EVERY TICK** the hero overlaps and is not invulnerable. There is no debounce, no one-touch-and-consume, and this path **never goes through the shared `CS:0xac59`/`CS:0xa9e4` contact routine** every creature in this game uses — it is a genuinely different threat model: a hero who lingers takes 2 damage per 15Hz tick (30/s), enough to run a full 24-point health bar to zero in well under a second.

**The overlay sprite** is a SECOND, per-type animation, on its own global counter, drawn 16px above the base sprite (branching on the ORIGINAL sprite id, not the just-computed draw position):

```
type 50  (0xdc):  DS:0x39c, wraps mod 4 (AND 0x3)   -> table DS:0xdffe
                    {220, 313, 314, 315}   (170+50, then 3 more frames)
type 117 (0x11f): DS:0x39f, wraps mod 6 (AND, CMP 6) -> table DS:0xe006
                    {287, 416, 417, 418, 419, 420}   (170+117, then 5 more)
```

Both tables read live (`read_memory("1ffd:dffe", 36)`); `DS:0xe012` (type 130's own table, below) sits immediately after `DS:0xe006`'s 6 words, and `DS:0xe01e` (the just-documented special-lever animation table) sits immediately after THAT — three tables end to end with zero slack, a three-way boundary cross-check.

**Type 130 — `CS:0x1AF6`-`0x1B58` — is its own, simpler body**: no ping-pong on the hitbox at all (fixed at `obj.y + 16`), a single sprite from its own 6-entry table (`DS:0xe012`, SHARING `DS:0x39f` with type 117's own overlay counter — the two are read independently since type 130 has no ordinary/overlay split of its own):

```
{300, 421, 422, 423, 424, 425}   (170+130, then 5 more frames)
```

Its hitbox, `CS:0x1B12`-`0x1B41` (screen-space X — both operands share one camera-relative frame, equivalent to world space exactly like the shared body above): `heroX in [objX-20, objX+20]`, `heroY in [objY-40, objY+24]`. Same flat -2 health, same invulnerability gate, same total absence of debounce.

⚠️ **A trap this project's own port caught before it landed**: `CS:0x1B0B push bx` / `CS:0x1B46 pop bx` brackets the `+0x10` used for type 130's hitbox test — the sprite itself draws at the object's own PLAIN `(x, y)`, never at `(x, y+16)`. A port that reuses the mutated hitbox coordinate for the draw call renders the sprite 16px too low.

**Ported in the sibling `gods-web` repo** as `game/spikes.js`, verified live in the browser: the two-part (base+overlay) sprite renders correctly as a hanging spike, and standing a hero inside the box drained a full 24-point health target to 0 in under a second, exactly as the undebounced-damage reading predicts.

**A category-4 spike draws INLINE within the ordinary object walk — there is no "draw all spikes last" pass** `[PROVEN]`. `CS:0x1432` (the per-object-pass function that also drives the ping-pong counter at `CS:0x1447`) calls `CS:0x1534` once per object; `CS:0x1534` dispatches on the object's own category, and category 4 goes straight to `CS:0x1B5B` — the spike draw body traced above — at THAT object's own position in the single array-order walk over `POBJECTS`' already-sorted (graphics export 32) records. It is not pulled out to a separate pass the way `gods-web`'s `game/objects.js` `sortForDraw` rank-1 band ("ordinary objects, incl. category 4, middle") already documents category 4 as belonging to. A first cut of the `gods-web` port (caught and fixed this session, not shipped) special-cased spikes into their own unconditional post-loop draw, which silently put every spike permanently in front of any same-rank object with a HIGHER original array index — e.g. `PLEV1A`'s own type-5 object at `(493,954)`, array index 27, sorts AFTER (and so should draw in front of) both nearby type-50 spikes at `(462,960)`/`(443,960)`, indices 6/7; the old separate-pass code drew it behind them instead. Confirmed by tracing `CS:0x1534`'s callers (`get_xrefs_to` on `1000:1534`: one `CALL` and one conditional jump, both from `FUN_1000_1432`) and by a full census of `PLEV1A`'s live objects near both spikes, re-derived from the shipped `.MAP` bytes, not asserted from prose.

⚠️ **That interleaving fix was NOT the cause of the visual bug it was chased to explain.** The actual report — two live DOSBox screenshots of this exact scene, provided by the maintainer — showed, first, the port drawing a spurious SECOND crown 16px below the animated one with a shaft continuing straight through two rows of solid floor tile, and then, after a first attempted fix, a shaft still sinking into that same floor tile at low ping-pong even with the duplicate crown gone. Both are resolved together, by the SAME underlying geometry, not two separate bugs:

**The base sprite's BOTTOM EDGE is PINNED at `objY+32`; it does not slide as a fixed-size block, it grows/shrinks from that fixed floor anchor.** `[PROVEN]` by pixel dump: sprite 220 (170+50, and 287 for type 117 — both shipped 16x32) is a COMPLETE standalone crown+shaft image, not a shaft alone — rows 0-15 are their own full crown shape, rows 16-31 a plain shaft. The overlay (16 tall, animated, `CS:0x1C10`) and the base (32 tall, `CS:0x1BE1`) draw at ADJACENT, non-overlapping world-Y ranges (`[tipY,tipY+16)` then `[tipY+16,tipY+48)`), so a FULL-height base composites overlay-crown, then base's-own-top-16-rows as a second static crown, then base's-own-bottom-16-rows as shaft (48px where the original shows far less) — the first bug. Drawing a FIXED 16-row window (the frame's bottom half) fixes the duplicate crown, but that window's bottom edge is `objY+31-pingpong+16 = objY+47-pingpong`, which is NOT constant — at low ping-pong (near-retracted) it sinks up to 15px into `PLEV1A` row 62 (`y=992`, a uniform floor-slab tile immediately below the two live spikes at `y=960`) — the second bug. The fix that reproduces BOTH screenshots at every ping-pong phase checked live (0, 5, 15): draw only `pingpong+1` rows, starting a FIXED 16 rows into the frame (skipping the duplicate crown), at the SAME `objY+31-pingpong` top — this keeps the bottom edge at the constant `objY+32` for every phase, matching a spike that visibly grows out of / shrinks back into a fixed hole in the floor. `gods-web`'s `game/spikes.js` `spikeSprites()` now tags the base record `{ srcRowOffset: 16, rows: pingpong + 1 }`.

**A third bug, in the OVERLAY, not the base, produced a periodic flicker the maintainer caught after the geometry fix above shipped: the shaft alternated in front of / behind the floor tile on every 4th tick (type 117: every 6th), except at maximum extension.** Frame 0 of `SPIKE_OVERLAY`/`SPIKE117_OVERLAY` — read live off `DS:0xdffe`/`0xe006` at the very start of this project's work on this hazard — is `220`/`287`, the SAME sprite id as the base's own full 16x32 frame, not a dedicated 16x16 one; the overlay record never carried a crop at all (only the base did, from the fix above), so on that one frame in four/six the "overlay" drew the FULL 32-row image at `overlayY = objY+15-pingpong`, whose bottom (`objY+47-pingpong`) overshot the `objY+32` floor boundary by `15-pingpong` px at every pingpong below maximum — zero overshoot only at `pingpong=15`, matching "except when fully extended" exactly. `spikeSprites()`'s overlay record now also carries `{ srcRowOffset: 0, rows: 16 }` — a no-op for the genuinely-16-tall frames 1-3/1-5, and on frame 0 it caps to sprite 220/287's own top 16 rows, which is its own separate, complete crown shape (the same rows the base crop above skips PAST). Live-verified by forcing the exact failing state (`frame39c=0`, mid pingpong) directly in the browser.

`UNKNOWN_spike_base_crop_mechanism` — **CLOSED `[PROVEN]`.** The prior pass's blocker was never a missing fact about `GAME.EXE` — it was an unverified ASSUMPTION about a function it never actually read. `CS:0x1B72 CALL 0x1AD6` sits between the sprite-id dispatch (`CX = word[DI]` = `170+type`, e.g. `220`/`287`) and the `SI = 0x1e00 + CX*8` computation (`CS:0x1B7E-0x1B81`), and the prior pass assumed it might transform `CX` from a sprite id into a raw type — which would have broken the address match with export 2's own lookup. Reading `FUN_1000_1AD6` in full (13 instructions) shows it only tests `AX`/`BX` against screen bounds to bump an on-screen-object tally at `DS:0x39a`; **it references `AX` and `BX` only — `CX` never appears in the function at all.** `CX` is untouched across the call, so `SI` was always `0x1e00 + spriteId*8`, not `0x1e00 + type*8` as the open question's own framing (and the prior pass) assumed.

That is exactly the address `VGA.EXE`'s own export-2 consumer computes for the base draw. Read directly (`VGA.EXE:0x1BDB-0x1BE8`, the code `CS:0x1C01 CALL 0x356e`'s far-call thunk reaches): `SI = word[0xe] + word[8]*8` — `word[0xe]` is the already-`[PROVEN]` `0x1e00` (`CS:0x294B`), and `word[8]` is set at `CS:0x1BFD MOV word[8],CX` from the SAME `CX = word[DI]` (`CS:0x1BED`, re-read fresh right before the call) that fed `GAME.EXE`'s own `SI` computation. Both sides compute `0x1e00 + spriteId*8` for the identical `spriteId` — they are provably the same 8-byte record, not merely a plausible-looking coincidence.

**The descriptor layout, read directly from `VGA.EXE`'s own consumer (`1BDB`-`1C0F`):** `+0` = the table `SI` is computed from, but the descriptor itself is `{+2: rows−1, +4: source data offset, +6: source data segment}` — `AX = word[SI+2]; INC AX` (`1BEA-1BEE`) is the row count, `SI := word[SI+4]` (`1C0B`) is the pixel-data read pointer, and `DS := word[SI+6]` (`1C1F`) is that pointer's segment. `CS:0x1B9F`'s word-write of `DX` (ping-pong, 0-15) into `+2` therefore makes the base draw exactly `pingpong+1` rows — the port's `pingpong+1` geometry isn't just empirically correct, it is the literal arithmetic the original executes. `CS:0x1BE4`'s `+0x20` into `+4` (undone at `CS:0x1C0B`, back in `GAME.EXE`, unrelated same-mnemonic coincidence with `VGA.EXE`'s own `0x1C0B`) skips exactly 16 rows (32 bytes = 16 rows × 2 bytes/row at this sprite's 16px width) of source data — the "start 16 rows into the frame" half of the geometry, also literal, not inferred.

**A load-bearing side effect of the SAME finding also explains `CS:0x1C15`'s otherwise-unmotivated `MOV byte SS:[SI+0x2],0x10`.** Since `GAME.EXE`'s own `SI` (fixed at `0x1e00+220*8` for a type-50 object, never recomputed after the base draw) is left untouched going into the overlay dispatch (`CS:0x1C1A`-`0x1C6C`, both the type-50 and type-117 bodies read fully this pass), and that dispatch's frame-0 entry (`DS:0xdffe[0]`/`DS:0xe006[0]`) reuses the identical sprite id `220`/`287` as the base — `VGA.EXE` re-derives the SAME `0x1e00+220*8` address for that overlay call too. `CS:0x1C15` is not a "restore to resting state" (220's true resting height is 31, for its full 32-row frame — `0x10` is a deliberate, specific value, not the natural one) — it is a **second, smaller crop applied ahead of time**, so that when the overlay call reuses the base's own sprite id on the one frame in four/six it does, it reads a small height rather than the leftover `pingpong` value or the sprite's natural 32-row height. This is the native-code mechanism behind the "third bug" fix `gods-web`'s own `spikeSprites()` already applies heuristically (see below).

✅ **Residual below — CLOSED `[STATIC]` (ranked item 42): the 17th row is real but invisible.** On a frame-0 tick the overlay re-reads sprite 220/287's descriptor with height `0x10`, so `INC AX` gives 17 rows. It draws them from the sprite's top (`+4` was restored at `CS:0x1C0B`), starting at `objY+15−pingpong`. Its 17th row is therefore **frame row 16**, landing on screen row `objY+31−pingpong`. The base draw that ran just before it (`CS:0x1C01`) starts at **the same frame row 16** (`+0x20` source bytes = 16 rows in) on **the same** screen row `objY+31−pingpong`, and it always draws at least one row (`pingpong+1 ≥ 1`). So the extra row blits pixels already on screen, with identical source bytes and an identical masked blit. The result is pixel-identical to a 16-row draw, and `gods-web`'s `rows: 16` is exact in effect.

⚠️ **One small, honest residual this closure surfaced, not chased further:** `CS:0x1C15` writes a **byte** (`0x10`), while `CS:0x1B9F` writes a **word**. Harmless in the sense that the target word's high byte is already `0` (last set by `0x1B9F`'s own word-write of `DX`, whose high byte is always `0` for ping-pong ∈ `[0,15]`), so the resulting word `VGA.EXE` reads is cleanly `0x0010 = 16`, not spilled garbage. But `16`, fed through the same `INC AX` every other draw uses, gives **17 rows**, not a clean 16 — a one-row bleed past the crown's own top-16-row boundary on the specific tick the overlay's frame counter (`DS:0x39c`/`0x39f`) reads `0`. Whether this is visible (or absorbed by the overlay's own masked-blit clip, not traced this pass) was not checked live; `gods-web`'s own fix uses a clean `rows: 16` for this case, one row short of what this reading of the original predicts. Not registered as a new `UNKNOWN_*` — a footnote, the same posture as `UNKNOWN_pgods_mus_cue_dispatch`'s own `PGODSRLG.RL` residual.

Two earlier candidates from the prior pass — `SS:[0x408]`'s inter-bitplane stride (numeric no-op for a naturally-32-tall sprite) and `SS:[0x40a]`'s fixed vertical clip (10 write sites, all constant 160/192/200, none exceeded here) — stay ruled out. The GEOMETRY (`pingpong+1` rows, bottom pinned at `objY+32`) was already `[PROVEN]` by the two-screenshot, multi-phase match; the register wiring producing it is now `[PROVEN]` too, by direct disassembly of the actual consuming code in `VGA.EXE`.

#### A spike that appears when an enemy dies — selector-2 class 30, and why it does not sink `[PROVEN]` live

**Where this came from.** A user report showed a type-50 spike in `PLEV1A` at about (664,368), with its shaft drawn over the floor bricks. No map object, trigger spawn or System A/B reward puts a spike there.

**The source is a selector-2 reward.** `PLEV1A`/`PLEV1B` event 78 (cell 608,352) arms selector-2 class 30. That class's `+0x0E` elimination-reward byte is **61 (0x3D)**.
- `CS:0xBF5F` special-cases that id: `cmp cx,0x3d / jz 0xBF59`.
- `0xBF59` does `and bx,0xFFF0` and jumps straight to the `CS:0xC041` landing, with no arc.
- `CS:0xC041` makes it object type `0x3D − 0xB` = **50**, a live spike, at the last dying position + 8, snapped to its 16-px row. Killing that enemy therefore places a spike trap, by design.

**Only world 1 has it.** Class 30 carries reward 61 in every world 1–3 PALFILS. But a plane-B cell dispatches class 30 only in `PLEV1A`/`1B` (event 78) and in `PLEV4A`/`4B` (event 134, cell 1024,784), and world 4's class 30 carries reward 32 (type 21, a chest key).

Live in `PLEV1B` (`gods-web/tools/attract-capture/sel2drop.py`, `sel2contact.py`):
- The allocator ran with `AX = 0x1E`, and slot `+0x1E` = `0x003D`.
- The hero touched the entity at (704,368) and killed it.
- The toss was entered with `CX = 0x3D`, `BX = 0x178`, and the landing ran with `BX = 0x170`.
- The object was `(708, 368, type 50, flag 1)`.

**Why it stays put.** `CS:0xC041` writes `0xFF` to the dirty byte for every landing (`mov bp,0x438 / add bp,dx / mov byte [bp],0xFF`, in **SS**). The per-object walker then really does run the fall for the spike: `CS:0x151B` `js 0x1534`, and live the y reached 372 at `CS:0x15F1`. Two instructions undo it:
- `CS:0x1516` `mov ss:[0432],bx` saves y before the dirty test.
- At `CS:0x15F1`, a non-weapon (`cmp cx,0xC0 / jl`) of category ≥ 3 (`cmp byte [di+4],3`) does `mov cx,ss:[0432] / mov [si+2],cx`.

The bounce path ends at the same `0x15F1` (`jmp 0x15F1` at `CS:0x142A`). Live, the spike held y = 368 for 30+ ticks with SS dirty = `0xFF`.

**The port bug.** `gods-web` had modelled this restore only as an up-front gate at activation (`isFallEligible`). `dropCarriedItem` arms the fall regardless of category, so the spike fell to 384 and its pinned base, at `objY+32` = 416, overlapped the 16-px floor tile. That is exactly the reported screenshot. The port now applies the `0x15F1` restore inside `stepObjectFall`.

**Static placement check of every other spike** (types 50/117/130: map objects plus `ACT0` spawns, base at `objY+32`):
- No spike has solid ground inside its body.
- Four sit 1 px above the floor because of authored odd y values: `PLEV2A` #2 (3405,415), `PLEV3B` (3305,735) and #25 (3361,655), and `PLEV4A` (2351,623).
- `PLEV4B`'s type-130 column at (641,400) stands 16 px higher than `PLEV4A`'s at (641,416).
- None of these move, so the port draws them where the original does.

### `pobjects-cat-4-5` — category 5 census `[PROVEN]` (membership); meaning closed in the entry below

Decompressed all four `POBJECTS.00{1-4}` (`blast.py`) and read every 48-byte record directly (not via the game's own id-based type formula, which is unsafe for world 4 — see below). **Category 5 has exactly 22 members, identical across all four worlds once the already-documented world-4 `+5` id drift is corrected for**: types `49, 55, 64, 65, 66, 67, 68, 81, 82, 95, 102, 103, 104, 105, 106, 107, 108, 111, 112, 113, 114, 131`. Confirmed self-consistent two ways: worlds 1–3 (base id `170+type`) agree on this set exactly, and world 4's own raw ids (base `175`) read as this same set **minus 5** on every one of the 22 records (`54,60,69,70,71,72,73,86,87,100,107,108,109,110,111,112,113,116,117,118,119,136`), which is precisely the already-documented world-4 `+0x08`/`+0x0c`/`+0x1e`/id authoring-drift pattern applied consistently — not a different, world-specific category-5 roster.

**Every single category-5 record has an empty name, an empty description, and `Value = 0`** — a stronger blank-field pattern than category 4's (which has one named, valued member, `"spike"`). Sprite ids for the 22 types (`170 + type`, or `302+` if ≥`0xC0` — none are) run `219, 225, 234, 235, 236, 237, 238, 251, 252, 265, 272, 273, 274, 275, 276, 277, 278, 281, 282, 283, 284, 301`. No dedicated `cmp cx,<sprite>` dispatch site for any of these 22 values was found in the portion of the object-array walk read this pass (`CS:0x1511`–`0x1CC6`, the same chain that resolved the world-2 nest at sprite `0x11d`/285); a full sweep of every `CMP CX,imm16`/`CMP AX,imm16` in that walker for all 22 sprite ids was not run, so absence of a dedicated handler is not exhaustively proven, only not found where category 4's hits were found.

The one behavioural fact this document already had — category 5 draws behind ordinary objects in the same swap-suppression rule as category 3 (`CS:0x0731 cmp word[si+0x4],5 / jz 0x775 -> no swap`) — still stands and is the only established consequence. Given the total blankness (no name, no description, no value, unlike category 4's one exception), category 5 is at least as plausible a candidate for "purely structural/never-instantiated" filler as it is for a second creature-hazard category; the enum's *meaning* remains open, only its *membership* is now settled.

### `pobjects-cat-5-meaning` — CLOSED: a purely visual, category-level dispatch — never a creature/hazard category `[STATIC]`

⚠️ **The prior search above missed the actual dispatch because it looked for the wrong shape.** It searched for a `CMP CX,<sprite>` chain — the mechanism category 4 uses — inside the object-array walker. Category 5 doesn't use that mechanism at all; it has its own **category-level branch**, reached one step earlier in the same walker, that neither this document nor a plain `CMP`-operand sweep (also re-run this session, zero genuine hits for any of the 22 sprite ids, confirming the chain-search really was empty) could find, because it dispatches through a **jump table**, not a compare chain.

**The branch, read fresh from `CS:0x1600`–`0x162E`:**

```
160D  cmp byte[di+0x4],3 / jl 0x162e     ; category < 3 leaves this region entirely
161D  cmp byte[di+0x4],4 / jnz 0x1626    ; category 4 -> its own cmp-cx-sprite chain (jmp 0x1b5b)
1626  jle 0x162b                          ; category 3 -> jmp 0x1d01 (not traced this pass)
1628  jmp 0x19ba                          ; category 5 -> HERE
```

**`CS:0x19BA` is a proper sprite-id-keyed jump table**, not a compare chain:

```
19ba  si = 0xdfb0 ; dx = [di]  (di = descriptor+0 = the SPRITE ID, per the already-documented stamp loop)
19bf  cx = 0xd                 ; 13 entries
19c2  cmp dx,[si] / jz 0x19ce  ; match -> read handler
19c6  add si,4 / loop 0x19c2
19cb  sub si,2                 ; no match in all 13 -> fall through to the default pointer
19ce  si = [si+2] / cx = dx / jmp si     ; CX carries the sprite id INTO the handler
```

Read directly (`read_memory`, `1ffd:dfb0`, 56 bytes): the table is exactly **13 × 4-byte `{sprite_id, handler}` entries** (`0xdfb0`–`0xdfe3`), immediately followed by a **bare 2-byte default-handler pointer** at `0xdfe4`–`0xdfe5` (`0x19D5`) — not a 14th `{sprite,handler}` pair (the loop's `CX=13` never lets the compare touch that address, so there is no unused sprite-match field to speak of). The very next bytes, `0xdfe6` onward, are already the start of a different, unrelated table (below) — zero slack, the same kind of boundary cross-check this document uses elsewhere. The 13 keyed sprite ids decode to object types `{49, 55, 81, 82, 95, 106, 107, 108, 111, 112, 113, 114, 131}` — all 13 genuine category-5 members, confirming this table belongs to category 5 specifically. The other 9 members (`64, 65, 66, 67, 68, 102, 103, 104, 105`) have no entry and fall to the default pointer.

**Every one of the six distinct handler bodies reachable from this table was read to its own terminating jump (`POP BP / POP SI / JMP 0x1000:14ad`, back into the object-walk loop), and none of them touch anything beyond three per-call scratch words (`[0x4]`/`[0x6]`/`[0x8]`, screen-x/screen-y/sprite-id) and a graphics-export thunk call:**

| handler | members (types) | behaviour |
|---|---|---|
| `0x19D5` (default) | `64,65,66,67,68,102,103,104,105` | convert world→screen, draw the base sprite once, via graphics **export 2** |
| `0x1A1F` | `49,95,106,107,108,111,112,131` | identical shape, via graphics **export 1** instead |
| `0x1A36` | `82` | **replaces** the drawn sprite with `DS:0xdff6[frame]` — `{252,327,328,327}`, i.e. base→alt→alt2→alt, one draw, export 2 |
| `0x1A58` | `55` | draws the base sprite (export 2), then a second, **animated** sprite 16px **above** it from `DS:0xdfe6[frame]` = `{316,317,318,317}` (export 2) |
| `0x1A97` | `81` | same shape as `0x1A58`, own table `DS:0xdfee[frame]` = `{324,325,326,325}` |
| `0x19EC` | `113,114` | draws the base sprite (export 1), then a second, **fixed** sprite 32px to the **right** — `448` for type 113, `449` for type 114 — (export 2) |

`frame` in every animated handler is computed identically: `((worldX >> 5) + tick) & 3`, where `tick` is a shared global byte (`DS:0x39d`, read by all three animated handlers) and `worldX >> 5` is the object's own position phase — the exact same "position-phased, globally-ticked, 4-entry ping-pong table" idiom this document already established for the destructible spike's overlay animation (`DS:0x39c`/`DS:0x39f`, *The overlay sprite*, above) — `0x39d` sits directly between those two already-documented counters. Every one of the three animated tables reads as a 4-frame cycle that returns to its own first value on the 4th step (`{a,b,c,b}` or `{a,b,c,b}` shape), the same back-and-forth flicker shape as the spike overlay.

**Graphics exports 1 and 2 are already characterized in `docs/drivers-and-memory.md`'s own export table: "Masked sprite blits (descriptor consumers; differ in clip bounds)."** So the one behavioural difference among the six handlers that isn't animation or a second tile — which export a given handler calls — is a known, already-documented distinction (clip bounds), not a new unknown.

**Placement, re-derived independently as a data census, not inferred:** decompressing and parsing all 8 `.MAP` files' 200 six-byte object records (`blast.py` + a fresh parse this session) gives per-map live-object counts of `130/136/170/171/118/115/130/150` (total `1120`, `92` distinct types) — an exact match to this document's own already-published figures (*`UNKNOWN_object_sprite`*, above), which cross-validates the parse. Of category 5's 22 types, **12 are genuinely placed in shipped levels**: `49(×1), 55(×2), 64(×3), 68(×3), 81(×4), 95(×1), 103(×1), 108(×1), 111(×3), 112(×3), 113(×2), 114(×2)` — mostly in world 2 (`PLEV2A`/`PLEV2B`), with single instances in worlds 1, 3 and 4. This overturns the framing two paragraphs above: category 5 is not "at least as plausible a candidate for never-instantiated filler" — it is placed, shipped content, not cut.

**Conclusion.** Category 5 is not a second creature/hazard category — every code path reachable from a category-5 object, without exception, does nothing but resolve a draw position, optionally pick a frame from a small animation table or add a second fixed tile, and call a masked-sprite-blit export. No hero state, health, inventory, score, damage grid, or trigger system is referenced anywhere in this dispatch. That is the category's meaning: **purely visual background scenery, several of its members self-animating** (flicker-style 4-frame cycles, or a fixed two-tile composite), sharing a category-level draw-only dispatch distinct from category 4's per-type gameplay handlers. `[STATIC]` — read from bytes, not executed; a DOSBox visual confirmation (rendering one of the 12 placed instances, e.g. type 81 at `PLEV2A` world coords `(3973,64)`) would promote this to `[PROVEN]` but was not run this pass.

### `UNKNOWN_ce64_pool` — CLOSED: a sixth creature type, world 3 only, and it is the real reason `DS:0x34` ever reduces starburst/aura damage `[STATIC]`

`DS:0xce64` is a **third** 10-slot × 10-byte pool, independent of the `DS:0xcfcc` nest/hazard pool it merely shares a clear-loop tail with. Its own allocator is `CS:0x7F0D` (re-read here byte-for-byte, not decompiled):

```
7f0f  mov si,0xce64 / mov cx,0xa        ; walk 10 slots
7f15  cmp word [si],0 / js 0x7f23       ; free when x is negative
7f1a  add si,0xa / loop 0x7f15
7f21  stc / ret                          ; all ten busy -> fail
7f23  add ax,[0xa]                       ; screen -> world X
7f27  mov [si],ax / mov [si+2],bx        ; seed x, y
7f2c  mov word [si+4],0xc8               ; hp/"strength" := 200
7f31  mov word [si+6],0                  ; wander-state := 0
7f36  mov word [si+8],0xa                ; timer := 10
7f3b  mov byte cs:[0x7f5c],0x90          ; ARM the update entry (NOP = enabled)
7f43  clc / ret
```

`CS:0x7F0D` has **exactly one caller**, `CS:0x1C7D` — the same category-4 object-type dispatch chain the nest's `CS:0x8611` hangs off, one arm earlier:

```
1c77  cmp cx,0x10a / jnz 0x1cc6         ; sprite 0x10a = 266
1c7d  call 0x7f0d
1c80  jc 0x1ce0                          ; (this sibling tests the carry correctly, unlike the nest's `jz` bug)
```

`sprite = 170 + type` (this document's own formula) makes `0x10a` **object type 96** — one of the seven category-4 types already catalogued in *What category 4 is, from the data side* (`50, 73, 96, 97, 115, 117, 130`), unnamed like the other six. Decompressing all eight `.MAP`s (`blast.py`) and reading the 200 six-byte object records of each (per this document's own `.MAP` format) finds type 96 placed **1× in `PLEV3A` and 5× in `PLEV3B`, zero elsewhere** — live, shipped, world-3-only content, not cut.

**The per-tick update, armed by `CS:0x7f5c`** (a `RET`/`NOP` self-modifying gate at the routine's own entry, same trick as `CS:0xAD88`): free-slot test, then `cmp word[si+4],0 / jns` (hp still ≥ 0, else a separate death branch at `CS:0x8076`), then `cmp word[0x2fa],0 / jnz <skip to draw>` — **this creature honours the "freezes aliens" potion**, exactly like System A/B. Past that gate sits a wander-state counter (`[si+6]`, a timer at `[si+8]` reloaded with `10 + rand()&0x1f` on expiry) that, every third advance, diverts into a separate screen-cull-and-`CALL 0x80b4`(→`0xc8b`, the BCD score entry with `dl=0x10`) branch at `CS:0x803a` — an attack/score mechanic not chased further here.

**The tail every live slot runs, `CS:0x7fb5`–`0x7fdd`, is what matters for damage numbers.** It loads `{x, y, hp}` from the record (`hp` doubling as the creature's own "strength"), sets a `0x20 × 0x28` hit box, and brackets the shared hero-contact-and-self-damage-scan call with a **save/force/restore** of `DS:0x34`:

```
7fcf  mov dl,byte [0x34]        ; save the incoming value
7fd3  push dx
7fd4  mov byte [0x34],0x1       ; FORCE DS:0x34 = 1
7fd9  call 0x1000:a9e4          ; the shared hero-contact test + damage-grid self-scan
7fdc  pop dx
7fdd  mov byte [0x34],dl        ; restore it
```

This is a **second, previously undocumented writer of `DS:0x34 = 1`**, and it has nothing to do with the "scripted sequence" framing below — it is a call-scoped reentrancy flag around exactly one call, used by exactly one creature type.

**Why it changes damage numbers.** `CS:0xa9e4` (`call 0xac59` for the hero-hit box test, then — only when that test did *not* report a hit — proceeds to round the creature's own box to screen space and scan the damage grid) can, if this creature happens to be standing on a stamped cell, fall into the tag decode `CS:0x9320`. Re-reading that decode's negative-tag ladder byte-for-byte confirms this document's existing table exactly, including the `DS:0x34` gates:

```
93a8  mov word [0x1ea],0x2710        ; tag 0xFE (invulnerability aura): 10000 by default
93b0  cmp byte [0x34],0 / jz 0x93bd
93b7  mov word [0x1ea],0x0            ; ... but 0 whenever DS:0x34 != 0
93cc  cmp byte [0x34],0 / jz 0x93dd
93d3  mov word [0x1ea],0x32           ; tag 0xFC (starburst): 50 whenever DS:0x34 != 0
93dd  mov word [0x1ea],0x2710         ; ... else (DS:0x34 == 0) the usual 10000
```

So **while this creature's own contact-test call is in flight, any starburst or invulnerability-aura hit *against it* resolves to the reduced value (50 / 0) instead of 10000** — every time, in completely ordinary play, whenever an object-96 creature (world 3 only) is standing on a stamped cell at the moment its update runs.

**The mode-1/2 "scripted sequence" (below) can never reach this same branch.** Both call sites for this creature's per-frame update — `CS:0x029D` (normal play) and its attract-mode mirror `CS:0x92DE` — sit inside a block gated `cmp byte[0x34],0 / jnz <skip>`, exactly like every other entity-AI call in the main loop (see *the `DS:0x34` gate reference below*). So this creature's own `DS:0x34=1` bracket can only ever fire when `DS:0x34` is *already* 0 at the top of the frame — the scripted-sequence mode and this creature's bracket are temporally disjoint, never nested, never racing. And because mode 1/2 freezes *every* entity contact-test call (the only path that ever reaches `CS:0x9320`), the "reduced damage" arm of `CS:0x93A8`/`CS:0x93CC` is **structurally unreachable via the scripted sequence** — the *only* live path to it is this one creature's bracket.

**Net correction to the starburst/aura damage claim below:** "10000 in normal play" is correct for the hero and for every other creature type, but **object type 96 (world 3, 6 shipped placements) is permanently capped at 50 damage from a starburst and is fully immune to the invulnerability aura**, by ordinary code, with no cutscene involved. A port that gives every creature the same starburst/aura damage number reproduces the wrong answer for this one enemy.

### `UNKNOWN_ce64_death_branch` — partly CLOSED: the death draw reuses the world-2 nest's own sprite convention `[STATIC]`

`CS:0x8076`–`0x8096` is the object-96 creature's death-frame draw, and it is a byte-for-byte structural match to the world-2 nest's own death handler (*Death, and the brood*, above — `"Each tick draws state + 0x6c twice"`):

```
8076  ax = [si] ; bx = [si+2]        ; world X/Y from the DS:0xce64 record
807b  ax -= 4 ; bx -= 8               ; the SAME (−4,−8) offset the nest's death draw uses
8081  bp = [si+6]                     ; the wander-state field, repurposed post-death — same pattern this
8084  bp += 0x6c                      ;   document already documents for every other entity's death counter
8087  ax -= [0xa] ; bx -= [0xc]       ; world -> screen
808f  [0x4]=ax ; [0x6]=bx ; [0x8]=bp  ; the shared entity-blitter's draw-call arguments
```

So object 96's death cloud is drawn with **exactly the nest's own `sprite = state + 0x6c` formula**, off the same wander-state field this document already documents as the record's runtime state — the two creature types visually share one death-burst effect. Immediately before it, `CS:0x8068`–`0x8073` is a sibling arm with a different offset (`bx −= 0xa`) that calls `CS:0x80BB` instead of drawing directly — plausibly the *alive* draw, gated on hp by a comparison this pass's linear disassembly window didn't include (the true branch point wasn't located, so this is inferred from the arms' shapes, not proven). `UNKNOWN_ce64_identity` — the game never names object type 96, so it has no in-project label yet — and the creature's own attack/wander AI (`CS:0x803a` onward) remains untraced beyond this draw pair; the specific `CALL 0x80b4`/`0xc8b` citation from an earlier pass was not re-located at that exact address this session and should be treated as unverified until re-read.

**`UNKNOWN_ce64_identity` — mechanism CLOSED `[STATIC]` (2026-09-29); the name stays unprovable, like `UNKNOWN_nest_identity`.** The update loop, `CS:0x7F5D`–`0x8039` behind the gate `CS:0x7F5C`, read in full:
- **Wander cycle.** The freeze word `[0x2fa]` skips the wander. State 0 counts the timer `+8` down (`0x7F8A`). On underflow it reloads `0x28 + (rand & 0x1F)` = 40..71 (`0x7F8F`–`0x7F9A`) and goes to state 1. States 1 → 2 → 3 step once per tick. Reaching 3 jumps to `0x803A`, and the next tick's 4 resets to 0 (`0x7FB0`).
- **The attack.** `0x803A` tests the screen position (x ∈ [−32, 320], y ∈ [−8, 200]) and calls `0x80BB` with (x, y − 10). ⚠️ **So the "sibling arm" `bx −= 0xa` → `CS:0x80BB` above is the spit spawn, not an alive draw.**
- **Contact.** The box is 0x20 × 0x28 at (x − 8, y − 8) with `DS:0x34` forced to 1 (`0x7FC3`–`0x7FDD`). A kill sets state 0 and calls `0x80B4` (`dl = 0x10` → the score adder `0x0C8B`).
- **Drawing.** The alive draw is at (x, y) with no offset, sprite `SS:[0x3602 + state × 2]` through export 1. ~~`UNKNOWN_ce64_sprite_table`~~ is **CLOSED `[PROVEN]`**: read live and from the `GAME.EXE` image, `SS:0x3602` = 266, 445, 446, 447 (then the brood's 535, 536, 537, 536 at `SS:0x360A`). So state 0 is the object's own sprite and 1–3 the wind-up (`POBJ2` 114–116, loaded only by world 3's object mask). Death (hp < 0, `0x8076`) draws `state + 0x6C` at (x − 4, y − 8) and frees at 7.
- **The spit.** Its pool is `DS:0xCEC8`, 10 records of 12 bytes, capped by `[0x3B0]` = 10. It spawns with `[si+9] = 0xF6` and `[si+6] = −10`. The mover `0x810D` runs legs of speed `(rand & 7) + 2` toward the hero (measured from x + 4, y + 12) for `(rand & 7) + 3` ticks, pausing `rand & 15` between legs, and draws sprite `0x1ED` + {0, 4, 8 by direction} + frame `& 3`. `gods-web`'s `ce64.js` matched this spec already, and its sprite table is now the real one.

### `UNKNOWN_8014_brood` — CLOSED: the walker confirms the record layout and adds a hitbox and a sprite table `[STATIC]`

`CS:0x894E` walks all 16 `DS:0x8014` slots (`CX=0x10`), and its own bytes settle several previously-open pieces at once:

```
894e  si = 0x8014 ; cx = 0x10
895a  cmp word[si+4],0 / jns 0x8963 / jmp 0x8a07   ; +4 < 0 -> FREE slot, skip (confirms the existing "free when +4 negative" claim)
8963  inc byte[0x3af]                               ; a live-count, reset to 0 at the top of every pass
8967  cmp word[si+6],0 / jns 0x8970 / jmp 0x8a33    ; +6 < 0 -> a separate branch, not chased further
8970  cmp word[si+0xc],0 / jz 0x8979 / jmp 0x8ab1   ; +0xc != 0 -> a THIRD branch, not chased further
8979  cmp word[0x2fa],0 / jnz 0x8983 / call 0x8a6c  ; "freezes aliens" honoured, else CALL a movement routine
8983  ax=[si] ; bx=[si+2] ; bp=[si+6]                ; world X/Y, and +6 loaded as the BP-in/BP-out "strength"
898b  [0x1e2]=0x18(24) ; [0x1e4]=0x10(16)            ; a 24x16 HITBOX, distinct from the nest's own 24x24/8x8 pair
8997  call 0x1000:a9e4                                ; the SHARED hero-contact-and-damage-grid-scan thunk
899a  [si+6] = bp                                     ; strength written back — the familiar BP round-trip convention
899d  dx = [si+4] ; dx <<= 1                          ; the lifetime/frame field, DOUBLED -> a WORD index
89a2  di = 0x360a + dx                                ; SS:0x360A — the sprite table this residual asked about
89a7  dx = word[ss:di]                                 ; the fetched sprite id
89aa  cmp word[si+8],0 / js 0x89b3 / add dx,3          ; +8's SIGN selects a +3 sprite-id variant
```

So the brood record is `{ i16 worldX, i16 worldY, i16 frame(also the free/lifetime sentinel), i16 strength, +0x8 X-velocity, +0xa Y-velocity, +0xc a "falling" sub-state flag, ... }`, each brood child takes hero-contact damage through the **same shared `CS:0xa9e4` thunk** every other creature uses (with its own 24×16 box), and its sprite is `SS:0x360A[frame]`, optionally `+3` when `[si+8]` is non-negative — the identical "table lookup, ±3 variant by a sign test" shape this document already documents elsewhere for other small creatures.

**`UNKNOWN_8014_field_0x6_branch` / `UNKNOWN_8014_field_0xc_branch` — CLOSED: `+0x6` gates a death-burst draw, `+0xc` toggles between ground-bounce and ballistic-fall movement `[STATIC]`**

`CS:0x8A33` (the `+0x6 < 0` arm) is a **death-burst draw**, structurally the same shape this document already documents for the world-2 nest and the hero's own death burst:

```
8a33  ax=[si] ; bx=[si+2] ; dx=[si+4]        ; world X/Y, and the frame counter
8a3b  ax -= [0xa] ; bx -= [0xc]               ; -> screen
8a43  ax -= 4 ; bx -= 0x11 ; dx += 0x6c        ; the standard 0x6c-base death-cloud sprite offset
8a4d  [0x4]=ax ; [0x6]=bx ; [0x8]=dx ; call 0x3569   ; draw
8a5c  inc word[si+4] / cmp 7 / jl 0x8a07       ; frame++, capped at 7 -> exactly like the nest's own death timer
8a65  [si+4] = 0xffff                          ; done -> FREE the slot (this document's own already-documented sentinel)
```

⚠️ **Corrected, `[PROVEN]` against a live `DS:0x8014` peek (`PJOYL2` 1898–1909).**
- **Ground bounce** probes at `y+4` and reverses on a wall at the probe *or on a missing floor* one row below (a ledge). It does not reverse on a floor, as the bullet below reads it.
- **Landing** adds one pixel to the floored row (`and 0xfff0 / inc`), not a full tile row, and forces `vx` to ±2 by its sign (`CS:0x8AF8`–`0x8B06`).
- **Order.** The brood runs before the nests in the main loop (`CS:0x027F` before `0x0282`), so children spawned this tick first move next tick.

**The alive tail, `CS:0x89E6`–`0x8A03`: the kill score, the frame cycle and the sprites — `[PROVEN]` live (2026-09-28).** After the contact call writes the strength back and the child is drawn, `CS:0x89E6` tests `[si+6]`: negative (killed this tick) scores **1000** (`mov dl,0x10` → `CS:0x0C8B` at `0x89F8`) and zeroes the frame (`0x89FB`). Every alive tick then runs `inc word[si+4] / and 3` (`CS:0x8A00`), so the frame cycles 0–3 and a killed child's death burst starts at frame 1. The alive sprite is `SS:0x360A[frame]` (`0x217, 0x218, 0x219, 0x218`, a ping-pong; read live and identical in the static image), plus 3 when `[si+8]` is not negative. This closes `UNKNOWN_brood_score` (the award is on the alive path, not the death branch `CS:0x8A33` that the earlier search read) and `UNKNOWN_brood_sprite_table`. Live: `PJOYL2`'s three brood kills at 1912, 1913 and 1928 score +1000 each; `gods-web/tools/attract-capture/brood_live.py` dumps `DS:0x8014` for cursors 1880–1935 and the port matches all 56 ticks (`brood-compare.js`, Roland mode as the running DOSBox).

`CS:0x8A6C` and `CS:0x8AB1` are the two **movement** variants selected by `+0xc`, both sharing the plane-B pointer helper `CS:0x8A93` (the already-established floored `0x5004 + (x&~0x1f)>>5 + (y&~0xf)<<3` formula):

- **`+0xc == 0` — ground bounce, `CS:0x8A6C`**: `world X += [si+8]` (a bare linear X-velocity, no accel/cap), then probes the plane-B cell at the new position (mirrored, `+0x18`/none depending on the velocity's sign — the muzzle-style facing offset this document sees everywhere). If either the probed cell or the one 128 bytes below it (`[di+0x80]`, one tile row down) reads solid, `NEG word[si+8]` — a plain **wall bounce**, reflecting the velocity rather than stopping it.
- **`+0xc != 0` — ballistic fall, `CS:0x8AB1`**: `world X += [si+8]`, `world Y += [si+0xa]`, then `[si+0xa]` (Y-velocity) is incremented and **capped at 8** (`inc / cmp 8 / jle / dec` — a **seventh** distinct gravity rule in this document's own running collection, alongside the hero's `4+v`/cap 10, System-B's `v` then `++`/cap 16, the time bomb's stepped `++`/cap 4, the magic axe's `+=2`/cap 8, the starburst's every-8th-frame `++`, and the chest loot's `++`/cap 4). It then probes a point `(+0xc, +0xf)` past the new position: if the cell one row **above** that point is solid, or if the cell itself is **not** solid, the child keeps falling (`jmp 0x8983`, the shared continuation); only when the probed cell **itself** is solid does it land — `Y` snaps to the tile row below (`and 0xfff0 / inc`, the standard tile-row-plus-one snap this document sees on several other landings) and both `+0xc` (falling flag) and `+0xa` (Y-velocity) are cleared, returning the child to the ordinary ground-bounce movement on the next tick.

So `+0x8`'s earlier-documented role as "a sign-tested facing/variant flag" for the sprite table (`CS:0x89AA`) and its role here as the **X-velocity** are the same field, not two different ones: a brood child moving left naturally reads a negative `[si+8]`, and the sprite table's `+3` variant is exactly the left-facing frame — the sign test is a facing readout of the velocity itself, the same pattern this document documents for every other entity in the game.

**`UNKNOWN_cfcc_1ca5_orphan` — CLOSED: genuinely dead code, both the "no caller" and "no fallthrough" halves proven `[STATIC, exhaustive]`.** `CS:0x1CA5`–`0x1CC3` is a complete, self-contained "convert to screen space and draw via export 2" body (`push` five registers, `SUB BX,[0xc]`, stage `[0x4]`/`[0x6]`/`[0x8]`, `CALL 0x1000:356E`, `pop` the five registers, `JMP 0x1000:14AD`) — structurally a full object-draw routine, not a fragment. Both ways in are closed: `get_xrefs_to(1000:1ca5)` returns **zero** references of any kind, and a raw byte-pattern search for the little-endian word `A5 1C` across all 152,384 bytes of the program's 4 initialized code blocks — the same check this document uses elsewhere to certify an address unreachable even via a jump/dispatch table — also returns **zero** matches, so the block isn't parked in any table either. And the instruction immediately before it, `CS:0x1CA2`, is itself an **unconditional** `JMP 0x1000:14AD` — the exact same address this dead block's own tail jumps to — so even straight-line fallthrough from the preceding code skips over it entirely. The block is real, valid, compiled code that no execution path in the shipped binary can ever reach by any of the three routes (call, jump-table, or fallthrough) — a stray leftover, in the same family as this document's other confirmed-dead code fragments (the `CS:0xD5F7` unreachable `DS:0x365` incrementer, `CS:0xF544`'s dead export-40 thunk).

**`UNKNOWN_cfcc_7f48_shared_tail` — CLOSED: harmless, deliberate code-reuse, not a bug `[STATIC]`.** `FUN_1000_7f45` (`CS:0x7F45`–`0x7F5C`) is the `DS:0xce64` pool's own **complete, dedicated** reset: `SI := 0xce64`, clear all 10 records (`CX=10`, `AX=0xFFFF`, stride 10), then force-disarm its own update gate (`MOV byte CS:[0x7f5c], 0xC3`). `get_xrefs_to` shows this whole routine is called **directly, exactly once**, from `CS:0x8E4C` — inside `FUN_1000_8c34`, this document's own already-documented level-init routine.

`CS:0x8661` (the `DS:0xcfcc`-pool clear this document already documents, called from `CS:0x69C0`/`CS:0x8E4F` — the latter sitting **immediately after** `CS:0x8E4C` in the same level-init call sequence) reuses the *tail* of this same clear loop by jumping into its middle at `0x7F48` with `SI` already set to `0xcfcc` — so it clears the `cfcc` pool's own 10 records using the identical loop body, then, as a side effect of running off the end of that loop, **also** re-executes the `CS:[0x7f5c] := 0xC3` disarm write. Since `FUN_1000_7f45`'s own direct call has *already* fully cleared and disarmed `DS:0xce64` a few instructions earlier in the same level-init routine, this second disarm write is redundant but **harmless** — it doesn't touch `DS:0xce64`'s own records (the jumped-in path skips the `MOV SI,0xce64` at `0x7F45` itself, so `SI` stays `0xcfcc` throughout) and it can never race against a live creature, since `ce64`'s own allocator `CS:0x7F0D` is what re-arms the gate (`MOV byte,0x90`) on the next genuine spawn. So this is ordinary code-sharing — reusing one small clear-loop body for two adjacent level-init steps — not an accidental cross-wire.

Still open here: **`UNKNOWN_nest_identity`** — the game never names type 115, so "nest" is the port's label (unprovable in principle). The seed, pool-full, muzzle and cull items and `UNKNOWN_ss432_indirect` were closed on 2026-09-29 (ranked item 62).

~~`UNKNOWN_cfcc_pool_full_in_play`~~ — **mechanism CLOSED `[PROVEN]` live (2026-09-29).** With the ten slots filled with inert records, a respawn's forced recompute activated nest object 59 (3297, 776). It was consumed (type `0xFFFF`, `CS:0x1C98`), and no pool record appeared in the 30 ticks logged. So the eleventh nest a player activates while ten are alive is lost for good. The attract demos never exceed one live nest; whether players leave ten alive is behaviour, not bytes.

**Two measurements worth keeping.** Swept over every camera position, at most **4** of `PLEV2A`'s nests and **5** of `PLEV2B`'s fit inside one activation box — so the ten slots are not a per-screen budget. They are a **cumulative** one: `CS:0x87E9` is the only `mov word [si],0xffff` in the whole `0x8611`–`0x894D` range, so **nothing frees a slot but death** — not scroll-off, not a timeout. The reachable failure is a player who leaves ten alive and then activates an eleventh, which is destroyed permanently.

The port is `gods-web/src/game/nest.js`, with 18 assertions in the verification suite and 23 injected porting mistakes all killed.

## `UNKNOWN_nest_shot` — CLOSED, and it opened a whole subsystem `[PROVEN]`

What the nest fires turns out not to be nest-specific. `CS:0x1FE7` (left) and `CS:0x2039` (right) are **the mechanism by which every shooting enemy in the game shoots**, and the port had no model of it at all. Six left/right emitter pairs call them:

```
CS:0x8725 / 0x86F7   the world-2 nest creature
CS:0xB07D / 0xB08F   CS:0xB6C8 / 0xB6EA   CS:0xBCBE / 0xBCCA
CS:0xBDC5 / 0xBDD6   CS:0xE6BB / 0xE6CF   -- five further behaviour handlers
```

The array is **`DS:0x8954`, 20 records of 8 bytes**: `{ i16 worldX, i16 worldY, i16 vx, i16 state }`, free when `state` is negative, seeded 0. ⚠️ The emitter tests `js` for free and the updater `jns` for alive — the same word in opposite senses.

**The emitter converts to screen, culls, then `pop bx / pop ax` to recover the world coordinates before storing**, so the record holds world position and the cull is a screen test. ⚠️ **The two cull rectangles differ and are not mirrors**: Y is identical (`screenY ∈ [−4, 191]`) but X is `[8, 328]` firing left against `[−8, 312]` firing right — each shifted 16 px *away* from the direction of travel. That is an eighth and a ninth distinct cull rectangle. ~~`UNKNOWN_cfcc_spawner_cull_reason`~~ — **measured (2026-09-29), "why" retired as intent.** Against the 16-px shots and the updater's despawn (left kept while `x > −16`, right while `x < 320`), neither "fully on screen at spawn" nor a despawn-derived margin fits both windows. The left window accepts x = 328, a shot entirely past the right edge, which then flies in, while the right window stops at 312. The windows are read correctly; the reason isn't recoverable from the bytes.

### ⚠️ This is a SECOND, completely separate damage path

Everything this document records about hurting the hero runs through `CS:0xac59` (the box test with the `BP`-in-`BP`-out convention) via the `CS:0xa9e4` thunk, and through the 8×8 occupancy grid at `DS:0x16ca`. **An enemy shot uses neither.** `CS:0x4501` — two callers, both inside the shot updater — is a bespoke inline box test:

```
4504  ax += 0x0a ; bx += 0x04          ; the shot's hot point
450A  ax += [0xa] ; bx += [0xc]        ; -> WORLD
4512  cx = [0x17c]                     ; the hero box TOP
4516  cmp byte [0x377],0x12 / jl / cmp 0x13 / jg
4524  add cx,0x18                      ; CROUCHING -> raise it 24
4527  cmp bx,cx / jl reject            ; the box is 32 x 48, INCLUSIVE
452B  cmp ax,[0x17a] / jl reject
4538  cmp ax,[0x17a]+0x20 / jg reject
4543  cmp bx,[0x17c]+0x30 / jg reject
4547  cmp word [0x172],0 / jnz reject  ; INVULNERABLE
454E  sub word [0x192],2               ; a FLAT 2, off the TARGET
4553  mov word [si+6],0xffff           ; the shot is consumed
4561  call 0xa633 with cx = dx = 0     ; a STATIONARY debris puff
```

Three consequences a port reusing the contact path gets wrong:

1. **The difficulty scalar does not apply.** `DS:0x365` is consumed at exactly two instructions, `CS:0xab56`/`0xab63`, inside the `CS:0xac59` resolution. `CS:0x4501` never goes near it, so enemy shots hit for the same amount in world 1 and world 4.
2. **It writes the target `DS:0x192`, not the bar** — so the bar chases down afterwards like every other source.
3. ⚠️ **Invulnerability makes the shot pass THROUGH.** `CS:0x4547`'s `jnz` skips *both* the subtract and the `[si+6] = 0xffff` that consumes it, so the projectile keeps flying. That is the opposite of the contact path, where `CS:0xACCC`'s `jnz` skips only the subtract and the creature still dies.

⚠️ **This also attributes a site this document listed without attribution.** The crouch section names three sites running the identical range test — `CS:0x4516` (+0x18), `CS:0xAC92` (+0x14), `CS:0xDB68` (+0x18). **`CS:0x4516` is this one**, and it belongs to the enemy-*shot* path rather than to `CS:0xac59`. The raises genuinely differ: **crouching helps by 24 px against a shot and by 20 px against contact.**

### Flight, terrain and the fade

`CS:0x20A8` steps `x += vx` and branches on the **sign of the velocity** — and a velocity of exactly **zero is not "stationary", it is the impact state** (`CS:0x2072`).

⚠️ **The terrain stop seeds the fade BY DIRECTION, and that is why there are two free tests.**

```
2158  cmp word [si+4],0 / js 0x2165
215E  mov word [si+6],4        ; flying RIGHT -> state 4
2165  mov word [si+6],1        ; flying LEFT  -> state 1
216A  mov word [si+4],0        ; and the VELOCITY is zeroed
```

So a left-stopped shot fades 1, 2 and frees at **3**; a right-stopped one fades 4, 5 and frees at **6**. Both `jz`s are live and the fade cannot be collapsed to a `>=`. `CS:0x216A` is also the writer that makes `CS:0x20B6`'s zero-velocity arm reachable at all.

The sprite numbering falls straight out and is self-checking: **`0x45, 0x46, 0x47` left flight + two fade frames, `0x48, 0x49, 0x4A` right** — six consecutive descriptors, three per direction, which is why the left flight sprite and the fade base are the same number. Despawn edges are asymmetric too — `0x140` on the right against `−0x10` on the left.

⚠️ **The terrain probe rounds unlike anything else, and the straddle is NOT a gate.**

```
2143  cmp byte [di],1   / jz  stop     ; the shot's own cell — ALWAYS tested
2148  dx = x & 0x1f
214D  cmp dl,0x18       / jng fly      ; STRICTLY greater; 0x18 does not straddle
2152  cmp byte [di+1],1 / jnz fly      ; the NEXT cell right
```

Stop when `[di] == 1`, **or** when the shot straddles past 24 px *and* `[di+1] == 1`. Reading it as "a cell of 1 stops the shot, gated by a straddle test" — which an earlier draft of the port did — lets a shot fly straight through a wall it entered head-on.

The cursor itself is `(x & ~0x1f, (y + 2) & ~0xf)` — a **+2 Y bias**. Collected, there are now **four distinct pixel-to-cell rules**: floored (entity), rounded-to-nearest (hero and export 40), `+8` on both axes (the hero's projectile terrain stop), and `+2` on Y only here. One shared helper is wrong three times.

### ⚠️ The two projectile systems sit on OPPOSITE sides of the player

```
CS:0x020F  the HERO's shots move and stamp     -- BEFORE the state machine
CS:0x0254  the player state machine EMITS
CS:0x0282  the nest walker           0x0285  the entities   -- both EMIT
CS:0x02BA  the ENEMY shots move and hit        -- AFTER every emitter
```

So a hero shot cannot hit anything on its spawn tick, while an enemy shot moves and can reach the hero **on the very tick it is fired**. Giving both systems one ordering is wrong for one of them whichever you pick.

`UNKNOWN_enemy_shot_other_emitters` — CLOSED, and it splits into three real mechanisms plus one false lead. (`UNKNOWN_enemy_shot_impact_writer`, briefly open in the port, is **closed**: `CS:0x216A` is the writer.)

The port is `gods-web/src/game/enemy-shots.js`, with 9 assertions and 14 injected porting mistakes all killed.

### The five other emitter-pair owners, closed `[PROVEN]`

All five were confirmed to be exactly `call 0x1fe7` / `call 0x2039` (the same two shared emitters documented above), and split into three genuinely different mechanisms — none of them the world-2 nest.

**Two (`CS:0xB07D`/`0xB08F`, `CS:0xB6C8`/`0xB6EA`) belong to a previously-undocumented per-tick driver for the already-known **selector 2** spawn system.** This document's own selector table already names `0xad06` as "spawn from PALFILS `+0x0718` (`DS:0x9720`) → runtime `DS:0xaec0`" — what was missing was the runtime *driver*. It is `CS:0xAD88`, a self-modifying `nop`/`ret` gate (enabled at `CS:0x18E70` → `0x90`, disabled at `CS:0x1C4AA` → `0xc3`) called from three main-loop sites (`CS:0x0223`, `0x09F8`, `0x9291` — `0x0223` sits right after the documented hunter-target-list reset, so this driver is a genuinely new addition to the per-tick call order). It walks all 10 `DS:0xaec0` slots (32-byte stride) and, per slot, calls `[si+0x16]` ("handlerA") unconditionally and `[si+0x1c]` ("handlerB") unless `DS:0x2fa` ("freezes aliens") is set. Both handler words are copied verbatim from the spawning class's 12-byte record — `class_table[cls]+4` and `class_table[cls]+10` — by the allocator `CS:0xAD0D`–`0xAD61`, which also raw-copies the class's own **`+0xC`/`+0xD`** source bytes into the new slot's `+0x12`/`+0x13`. `CS:0xB03C` (fires left via `0xB07D`) and `CS:0xB670` (fires right via `0xB6C8`) are exactly the `handlerB` wired into `DS:0x1fc`'s table (the **`b` = System-B-pointer** class table, per `CS:0xAD62`) for a specific run of classes — World 1 idx 5/6/7, World 2 idx 3, World 4 idx 3 (never World 3) — each reading those two raw bytes back as a facing-select flag (`[si+0x12]`, `0` = fire, nonzero = divert to a different, unread attack routine at `CS:0xDBC6`/`0xB63F`) and a fire-rate/reload divisor (`[si+0x13]`, reload `= (0x10−value)<<2` ticks). Confirmed live in shipped data: `PALFILS.0{A,B}{1,2,4}`'s `+0x0718` window places exactly the classes this table wires up.

**Two (`CS:0xBCBE`/`0xBCCA`, `CS:0xBDC5`/`0xBDD6`) belong to the already-closed `PGOD0x.PAT` / **selector 1** spawn table**, and close `UNKNOWN_pat_class_fields`'s handler-pointer half (see above). `CS:0xBC4B` — the sub-record's `[si+0x14]` handler — is the **default/most-common** behaviour: fire-rate-gated (`DS:0x230`/`0x232`, the class's own byte-6 nibbles), it compares the sub-record's own pre-tick vs. post-tick X (`DS:0x200` vs. `[di]`, both already-established PAT fields) to fire *in whichever direction the object last moved*, through the same two shared emitters. It is wired to **11 of the System-A table's 14 live class entries** across all four worlds (World 2 and 3: every entry; World 1: 2 of 3; World 4: 2 of 4) — the most common secondary behaviour for a PAT-spawned object, never a primary (`handlerA`) one. `CS:0xBDC5`/`0xBDD6` is different: it is **World 4's own class-index-2 record's dedicated pair** — `handlerA = CS:0xBDDB` (a walk/chase-vs-attack dispatcher reading facing bit3 of `[di+0xe]`) arming `handlerB = CS:0xBD71`, which reload-gates into `CS:0xBD9F`, a fire routine using `[di+0xe]`'s bit3 directly as the facing test rather than a movement comparison. **World 4 class index 3 — one record later in the identical table — is the already-documented cut hazard** (`0xbd38`/`0xbd0b`); this pins down for the first time *which* runtime mechanism would have driven it had it ever been placed (see the correction above).

**One (`CS:0xE6BB`/`0xE6CF`) is genuinely generic, shared code inside the real System-A/System-B entity pipelines — `CS:0xE659`.** Unlike the four above, this one really is called from both documented architectures: it is System A's own pipeline **stage 6** (`CS:0xE001`'s sixth call, already catalogued as "recompute the facing/muzzle direction `DS:0x206`") *and* the first thing System B's per-frame entity driver (`CS:0xEDB8`) does, before its `DS:0xdbe0` movement-mode dispatch. It self-gates on the group descriptor's own `+0x6` byte (low nibble = fire-rate enable, matching this document's already-published field) and a reload timer at `[di+0xe]` (present, at that offset, in *both* systems' entity records despite their differing strides). A non-firing branch (bits 4–5 of `+0x4`/`+0x5` nonzero) diverts to a different, unread spawn path (`CS:0xE5E4`, again touching `CS:0xDBC6`). Direction is read off the entity's own current motion: System A tests the sign of its stage-2 velocity field `[di+0x12]`; System B bit-tests a small constant, `DS:0xd95a = 0x0015` (binary `00010101`), indexed by the entity's current `DS:0xdbe0` movement-mode `[di+0xa]` — bits 0/2/4 (walk/fall/hop-left) are set, 1/3/5 (the right-facing mirrors) are clear, an exact, self-consistent match to the already-documented mode table. Across the shipped `PALFILS` group descriptors, 71 of 344 live records (fire-rate nonzero *and* not diverted) reach this shared code — 12 System-A (worlds 1–3 only; **System A never reaches it in world 4**, every world-4 System-A firer diverting to `CS:0xE5E4` instead) and 59 System-B (present in every world).

### The selector-2 spawner, CS:0xAD88/CS:0xAD0D, closed end to end `[PROVEN]`

A later session read the whole system this document had only partially named above ("a previously-undocumented per-tick driver for the already-known selector 2 spawn system") — the allocator, the driver, both `handlerA` bodies, the fire routine, the cull dispatch and the group-elimination reward — instruction by instruction, and ported it (`gods-web/src/game/selector2.js`).

**The allocator, `CS:0xAD0D`–`0xAD61`**, reached from selector 2's own dispatch (`0xad06`) with `AX` = a 0-based index into the 100-record, 16-byte PALFILS `+0x0718` window (`DS:0x9720`). It finds a free one of the 10 `DS:0xaec0` runtime slots (32-byte stride, free when `+6==0`) and copies the class record's fields in verbatim, byte-swap convention exactly matching each field's own `LODSW`/`XCHG AH,AL`/`STOSW` (native) vs. `MOVSW` (raw, unswapped) choice:

```
class[0x0..0x1] BE u16 -> slot+8    spawnX, world X, CONSTANT for the whole batch
class[0x2..0x3] BE u16 -> slot+0xa  spawnY, constant for the whole batch
class[0x4..0x5] RAW    -> slot+0xc  entityFacing (first byte, sign-extended per-entity) / drawStyle (second byte)
class[0x6..0x7] BE u16 -> slot+0xe  per-entity STAGGER STEP, accumulated cumulatively (entity 0 = 0, entity 1 = step, entity 2 = 2*step, ...)
class[0x8..0x9] RAW    -> slot+0x10 entityCount (first byte, also the materialise loop bound) / entityState0 (second byte)
class[0xa..0xb] BE u16 -> BX (held) the CURRENT WORLD's own SYSTEM-B per-world class-table index (DS:0x1fc)
class[0xc..0xd] RAW    -> slot+0x12 facingSelect (first byte) / reloadByte (second byte)
class[0xe]      byte   -> slot+0x1e rewardItemId — see the correction just above this section
```

then copies `class_table[cls]` (the SAME 12-byte `{spriteBase, one, handlerA, w, h, handlerB}` record `spawn.js`'s own `CLASS_TABLES_B` already transcribes) wholesale into slot `+0x14`..`+0x1d` — `handlerA` at `+0x16`, `handlerB` at `+0x1c`, confirmed by reading raw bytes for all 5 reachable classes: world1 idx5/6/7 and world2 idx3 all hold `{spriteBase, handlerA=0xB60E, w:24,h:24, handlerB=0xB670}`; world4 idx3 holds `{spriteBase=0x223(547), handlerA=0xB5E9, w:24,h:24, handlerB=0xB670}` — matching `CLASS_TABLES_B[1][5]`/`[2][3]`/`[4][3]` exactly. **The allocator does NOT materialise entities** — it only arms the slot (`+6:=2`, bit1 set, bit0 clear); materialisation happens on the driver's own next tick.

**The driver, `CS:0xAD88`**, self-modifying-gated at its own entry (the same trick `CS:0xf5c`/`CS:0x8687` use), walks all 10 slots every tick. A slot with bit1 set and bit0 clear MATERIALISES: it spawns `entityCount` entities (14-byte stride) all at the SAME `(spawnX, spawnY)`, applies the cumulative stagger, seeds each entity's own reload timer to `(16 - reloadByte) << 2`, and sets bit0 (fully materialised). A fully-materialised slot processes each entity by `state`: `0` = dead (tallied), `<0` = dying (an 8-tick fade, sprites `0x6c..0x72`, caching the slot's own "last dying position" on the FIRST dying tick), `>0` = alive (`handlerB` fires unless frozen, `handlerA` animates unconditionally, then a cull check, then the SAME shared hero-contact-and-damage-grid-scan thunk `CS:0xa9e4` every other creature in this game uses — **no `DS:0x34` bracket**, so a hero-touch is an ordinary one-touch kill, not the ce64-style `mode:1` reduced-damage case).

**`handlerA` — two bodies, both ONLY touch the entity's own animation frame; neither ever moves x/y** (confirmed for both sampled addresses) — these are stationary shooting turrets, not roaming creatures:
- `CS:0xB60E` (worlds 1/2): sprite = a per-WORLD 4-word ping-pong table at `DS:0x1a2` (populated once at level-init, `CS:0x8EF9`/`CS:0x8F16`: world1 `{0x214,0x215,0x216,0x215}`, world2 `{0x20d,0x20e,0x20f,0x20e}` — the SAME `{base,base+1,base+2,base+1}` 3-unique-frame ping-pong idiom this document documents everywhere else) `+3` when `entityFacing==0`. Frame-advance is asymmetric: `frame!=0` ALWAYS advances (`CS:0xB629` skips the gate entirely); `frame==0` advances only when `reloadByte!=0` AND the entity's own reload timer reads exactly 1 (i.e. the tick just before it fires).
- `CS:0xB5E9` (world 4 only): sprite = a HARDCODED `0x223 + frame` (+4 when `entityFacing==0`) — not read from the class table, even though it happens to equal it for the one sampled class. The OPPOSITE frame gate from B60E: `frame==0` NEVER advances on its own; `frame!=0` advances only on the `DS:0x36d` tock tick (a FOURTH tock toggle in this document's collection, separate from the usual `DS:0x36c`). The only way this class's frame ever leaves 0 is `handlerB`'s own world-4-only kick on every shot fired.

**`handlerB`, `CS:0xB670`** (the ONLY handlerB any sampled class points at — `CS:0xB03C`, its documented sibling, has zero xrefs anywhere in the image and is apparently dead code): fire-rate-gated on `reloadByte`, decrements the entity's own reload timer, and on reaching exactly 0 reseeds it to `(16-reloadByte)<<2` and dispatches on `facingSelect`. Nonzero diverts to `CS:0xB63F` → `CS:0xdbc6`, seeding a Bresenham line-hazard fragment (`gods-web/src/game/line-hazard.js`'s `LineHazards.spawn`, NOT `spawnJittered`/`spawnAtHero` — `CS:0xDBC6`'s own target is a bare, unjittered `heroX+8, heroY+6`, and the caller's own `BP:=1` is dead since `CS:0xDBD4` overwrites `BP` before ever reading it) with step count `n = (reloadByte>>1)+2` (`CS:0xB654-B65E`, confirmed by reading `CS:0xDBE8`'s own write of that value into the new slot's `+0x12` field). Zero fires an ordinary shot through the shared emitter (`CS:0x1FE7`/`CS:0x2039`, `enemy-shots.js`'s `EnemyShots.fire`), speed `(reloadByte>>2)+4`, direction from `entityFacing` (`==0` → left, negated; `!=0` → right). **The muzzle offsets for the two branches use OPPOSITE polarities on `entityFacing`** — the ordinary shot's left branch is `x+0xa, y+0xc` (world4: `y+8`) and its right branch is `x+0xe, y+0xc` (world4, via a `JNZ`-not-taken FALL-THROUGH that applies BOTH an inner and outer add: `x+0x12, y+8`) — while the hazard branch's `facing==0` case KEEPS the LARGER offset (`x+0x16, y+0xd`) and `facing!=0` SUBTRACTS (`x+0x16-0x1c = x-6`). A port that assumes one muzzle formula for both branches is wrong for one of them.

**The cull dispatch, `SS:0x3586`, 6 entries** — a table this document already named ("the words from index 11 belong to a different table at SS:0x3586 whose sole consumer is CS:0xAE7C") without decoding it: indices 0/1 never cull; 2/3/4/5 each test exactly ONE screen edge (left `<-0x70`, right `>0x190`, top `<-0x48`, bottom `>0xe8`) and fall through to the shared contact/draw body when in bounds — not a 4-way clip box. A culled entity is marked dead (`state:=0`) AND its group's own reward id is immediately spent (`0xFF`, no popup) — a culled batch member forfeits the group reward opportunity, unlike a killed one.

**The group-elimination reward, `CS:0xAED0`–`0xAF0F`**, fires once a slot's dead-plus-dying tally reaches its total entity count, using `class[0xE]`/slot `+0x1e` as a `CS:0xBF5F` popup id (`<0xB` → a plain numeric popup, `>=0xB` → `POBJECTS` type `id-0xB`) at the slot's own cached last-dying position `+8` on both axes — see the correction immediately above this section for why that id field is genuinely populated, not always `0xFF`. Full deactivation (`+6:=0`, slot freed for reuse) requires a SEPARATE, later tick: the tally used for the reward check counts each entity's state AS OBSERVED AT THE TOP of its own turn, so an entity that transitions from dying to `state==0` during the SAME tick still counts toward `dyingCount`, not `deadCount`, for that tick — the slot cannot free itself on the exact tick its last member finalises.

`gods-web/src/game/selector2.js`, 39 assertions, all passing against the full 870-row suite.

⚠️⚠️ **CORRECTION, a later session — the `rewards` array is now DRAINED and RENDERED, not just computed.** `main.js` pops every entry into the same single-slot `popup.js` (`CS:0xBF5F`/`0xBF80`) System-B's own group-elimination reward uses — one shared popup slot across both mechanisms, matching the original's own single `DS:0x1a0` popup state. Before this pass the array was correctly computed but grew forever with no consumer; see the port note under `UNKNOWN_f030_item_drop` above for the full picture (popup.js, and what remains unported — the per-kill carried-item popup, and `UNKNOWN_popup_cull`'s own disclosed cull/lifetime gap).

### ⚠️⚠️ CORRECTION, a later session — the system above covers only ONE of at least SIX live `handlerA`/`handlerB` families, and the "`CS:0xB03C` is dead" claim is REFUTED `[PROVEN]`

**The census that produced the paragraph above sampled only the classes reachable by the ORIGINAL port's own narrow `HANDLER_FOR[world]` model — a per-WORLD lookup — and that model is wrong.** A fresh, direct read of all four worlds' `DS:0xdf80`-pointed per-world class tables (`DS:0x1fc`, 12 bytes/record, `{spriteBase, one, handlerA, w, h, handlerB}`, LITTLE-ENDIAN native words — NOT the byte-swapped-BE convention PALFILS records use) shows every world has SEVERAL distinct classes with DIFFERENT handler pairs, and a live-dispatch census against real shipped `PALFILS +0x0718` records (classIndex values actually referenced: world1 `{0,1,2,3,5}`, world2 `{0,1,2,3}`, world3 `{3,4}`, world4 `{1,2,3,4,5}`) shows **every one of those extra classes is genuinely live in shipped data**, not merely present-but-unreferenced:

| world | classIndex | spriteBase | handlerA | w×h | handlerB |
|---|---|---|---|---|---|
| 1 | 0 | 462 | `0xB70E` | 32×32 | `0xB03C` |
| 1 | 1 | 480 | `0xB718` | 32×32 | `0xB03C` |
| 1 | 2,3 | 498 | `0xB722` | 32×32 | `0xB03C` |
| 1 | 5,6,7 | 532 | `0xB60E` | 24×24 | `0xB670` |
| 2 | 0 | 450 | `0xB704` | 32×32 | `0xB03C` |
| 2 | 1 | 468 | `0xB71D` | 32×32 | `0xB03C` |
| 2 | 2 | 521 | `0xB144` | 32×32 | `0xB290` |
| 2 | 3 | 525 | `0xB60E` | 24×24 | `0xB670` |
| 2 | 5,6,7 | 521 | `0xB144` | 24×24 | `0xB290` |
| 3 | 0,1,4,5,6 | 450 | `0xB709` | 32×32 | `0xB03C` |
| 3 | 2 | 468 | `0xB6FA` | 32×32 | `0xB03C` |
| 3 | 3 | 516 | `0xB2C7` | 24×24 | `0xB2F3` |
| 4 | 0 | 450 | `0xB6F5` | 32×32 | `0xB03C` |
| 4 | 1,4,5,6 | 486 | `0xB83D` | 32×32 | `0xB03C` |
| 4 | 2 | 468 | `0xB6F0` | 32×32 | `0xB03C` |
| 4 | 3 | 547 | `0xB5E9` | 24×24 | `0xB670` |

(All four tables re-read and confirmed by direct `read_memory`, not decompile, this session.) So **`CS:0xB03C` is the MAJORITY handlerB across every world in shipped data** — the "zero xrefs anywhere in the image, apparently dead code" claim two paragraphs above is **refuted**: `get_xrefs_to` only finds direct `CALL`/`JMP` instructions and is blind to a reference stored as a data-table field (`class_table[cls].handlerB`) that the driver loads into a register and calls indirectly (`CS:0xAD0D`'s own copy of `handlerA`/`handlerB` into the runtime slot, then `CS:0xAE5F`/`CS:0xAE53`-style indirect calls) — the exact same blind spot that hid the `DS:0xaccc`/`DS:0xad1c` hazard-pool writers from an "exhaustive operand search for the address" one section above. **Any future `get_xrefs_to`-only "zero callers, dead code" claim in this document should be treated as provisional until a data-table reference has also been ruled out.**

**`CS:0xB03C`/`CS:0xB017`** (the second handlerB family, 32×32) is structurally parallel to `CS:0xB670` — same fire-gate shape (`cmp slot.reloadByte,0`, `dec reloadTimer`, reseed `(16-reloadByte)<<2` on expiry), same `facingSelect` divert (nonzero → hazard via `CS:0xB017`, muzzle `x+0x10,y+0`, `n=(reloadByte>>1)+2`, same as `B63F`) — but with its OWN, DIFFERENT muzzle constants for the ordinary-shot branch: LEFT `x-8,y+0` (`CS:0xB07D`→`CS:0x1FE7`), RIGHT `x+0x20,y+0` (`CS:0xB08F`→`CS:0x2039`), and **no world-4 special case anywhere** (unlike `B670`, which has one on both muzzle axes).

**The `handlerA` family for every 32×32 class** (`B70E/B718/B722/B704/B71D/B6FF/B709/B6FA/B6F5/B83D` — ten distinct entry stubs, one hardcoded sprite-base load each, all jumping into one shared body, `CS:0xB725`) is now fully read, closing the standing question of whether these bigger classes roam. **They do not — confirmed by the complete absence of any `[di+0]`/`[di+2]` (x/y) write anywhere in the shared body `CS:0xB725`-`0xB7FE`.** The body is: an 8-frame tock-gated (`DS:0x36c`) animation cycle; then, gated on the entity's own facing byte (`[di+0xa]`), a **wall-avoidance/hero-visibility facing-flip**: if facing==0, probe plane-B at `[si-1]`/`[si+0x7f]`/`[si+0xff]` (mirroring the hero's own left-wall-probe convention) and flip facing (`XOR [di+0xa],1`) if any is solid; then, gated on X sub-tile alignment (`(x+4)&0x1f==0`) and a class-descriptor flag (`[si+0x12]`, presumably `facingSelect` reused), probe plane-B at the HERO's own rounded tile column (three rows) and flip facing again if that column is fully open. So these are **stationary turrets with smart facing** (face away from a wall; face toward the hero's column when the path there is clear) — the same "bigger stationary turret" family as `B60E`/`B5E9`, not roamers. Sprite = `class_base + frame + facing*9` (`CS:0xB796`'s own shared tail).

⚠️⚠️ **CORRECTION, a later session — the formula above was wrong by one, and the port shipped it wrong for a full pass.** A fresh `disassemble_bytes` of `CS:0xB796`-`0xB7A6` (not a re-read from memory of the summary above) gives: `DX := [DI+0xa]` (facing) / `CX += DX` (facing added **once**, before any shift) / `DX <<= 1` three times (`DX := facing*8`) / `CX += DX` / `CX += BP` (spriteBase). Net `spriteBase + frame + facing + facing*8 = spriteBase + frame + facing*9`, not `facing*8` — the `ADD CX,DX` at `CS:0xB79A`, run *before* the three `SHL`s, was missed by the pass that first wrote the "facing*8" line. Caught by an `advisor()` review that flagged this handler was also never exercised by any test driving a live `'32x32'`-classed entity through `SelectorTwoSpawns` (every existing selector-2 test happens to drive `b60e`/`b5e9`/`b144`/`b2c7` classes instead) — the SAME review also caught that `selector2.js`'s own call site passed only `entity` to `handlerA_32x32`, never `slot`, so `entity.spriteBase` (a field that has never existed on the entity — `spriteBase` lives on the slot) was `undefined` and every 32×32 class, the **majority** family across every world, drew sprite `NaN` for the whole time this file's per-class dispatch has existed. Both are now fixed in `gods-web/src/game/selector2.js`, along with a THIRD bug the same fresh read turned up: the shared body's own frame-advance gate (`CS:0xB736-B744`, `cmp byte[0x36c],0/jz<skip>`) advances when the byte is **nonzero**, not when it is zero — `selector2.js`'s own `stepAnim8` had the polarity inverted (an easy trap; `statue.js`'s own header already documents that this same `cmp.../jz` shape is NOT globally one polarity, and must be re-verified per call site rather than assumed from another module's own reading of a *different* `DS:0x36c` test).

⚠️⚠️ **CORRECTION, a later session — "THEY DO NOT [roam]" IS WRONG. The 32×32 shared body genuinely moves the entity, and this is very likely the answer to a live user report that monsters near the world-1 spawn point "are definitely moving in the original game."** The claim above rested on "no `[di+0]`/`[di+2]` write anywhere in the shared body" — true of the body's own instructions, but it misses that the body's *caller* commits the body's own return value into those fields regardless. Prompted by an `advisor()` review of exactly this gap (it named the claim above as **sampled** — checked only against `handlerA_b60e`/`handlerA_b5e9`, never this, the majority family — and flagged it as the strongest remaining candidate for what a "monsters don't move" complaint is pointing at), a fresh `disassemble_bytes` of `CS:0xB725`-`0xB800` plus the driver `FUN_1000_ad88` (decompiled) settles it:

```
CS:0xB744  cmp word[di+0xa],0 / jnz 0xb773       ; facing==0 -> LEFT, else RIGHT
; LEFT:
CS:0xB74A  sub ax,4                               ; ax := entity.x - 4   -- UNCONDITIONAL
CS:0xB74D  mov dx,ax / and dx,0x1f / jnz 0xb796   ; probe only when the NEW x is tile-aligned
CS:0xB754  call 0xb8d0                             ; si := plane-B ptr(ax,bx), i.e. the entity's OWN tile
CS:0xB757  cmp [si-1],1    / jz 0xb76d             ; row0 (one column further left) solid -> flip
CS:0xB75D  cmp [si+0x7f],1 / jz 0xb76d             ; row1 solid -> flip
CS:0xB763  cmp [si+0xff],1 / jnz 0xb76d            ; row2 NOT solid (open ledge) -> flip
CS:0xB76D  xor word[di+0xa],1                       ; FLIP FACING
; RIGHT (CS:0xB773-B794) mirrors this exactly: +4, probe [si+1]/[si+0x81]/[si+0x101]
CS:0xB796  (tail) ... RET with AX = the (possibly flip-triggering, but ALWAYS ±4'd) new x
```

And the driver, `FUN_1000_ad88` (decompiled):
```c
uVar9 = puVar11[1];                 // save Y BEFORE the calls
if (*(int*)0x2fa == 0) (*(code*)puVar10[0xe])();   // handlerB (verified via CS:0xB03C/B670: preserves AX/BX)
uVar5 = (*(code*)puVar10[0xb])();   // handlerA — returns the (possibly moved) X in AX
*puVar11 = uVar5;                   // entity.x := handlerA's own return value
puVar11[1] = uVar9;                 // entity.y := the ORIGINAL y, restored — Y NEVER changes
```

So **X is committed from AX unconditionally, on every tock!=0 tick, regardless of whether the alignment-gated wall probe even ran** — `SUB AX,4`/`ADD AX,4` happens before the alignment check, and every path from there (misaligned skip, flip, or no-flip) reaches the tail with AX already carrying the ±4 step. Only Y is pinned. **The majority selector-2 turret family — including world 1's own classIndex 2/3 (spriteBase 498, `CS:0xB722`), spawned within a few hundred pixels of the world-1 hero spawn point — paces back and forth 4px per tock tick (≈30px/s) in its current facing direction, turning around via the 3-row wall/ledge probe above.** This is not the same claim as "stationary turrets with smart facing" — it is genuine translation, not merely a facing flourish, and it directly contradicts this project's own earlier, disputed conclusion that the near-spawn selector-2 enemies are "genuinely stationary."

A second, `facingSelect`-gated flip toward the hero's own tile column (`CS:0xB7A9`-`B834`, reached only when the wall/ledge probe above does not already flip) was read fresh, twice, and NOT confidently resolved: its own exit condition repeatedly decrements the entry-time slot pointer (`SI`, ~`0xaec0`+) and compares it against a freshly computed plane-B pointer (`DI`, ~`0x5004`+) — two operands in memory regions too far apart to plausibly become equal by single-byte decrements within any bounded iteration count, looped at `CS:0xB7E3 JZ 0xb7cd`. `UNKNOWN_sel2_32x32_hero_column_flip_loop` — flagged rather than guessed. **Ported** (`gods-web/src/game/selector2.js`, `stepPace32x32`, wired into `#stepAlive` and threaded through `SelectorTwoSpawns.step`'s own `opts.planeB`, `main.js` passing `level.map.planeB`): the pace-and-commit and the wall/ledge-avoidance flip, matching the bytes above exactly. **Not ported:** the hero-column flip, for the reason above.

**`CS:0xB144`/`CS:0xB290`** (world 2's own idx2/5/6/7) and **`CS:0xB2C7`/`CS:0xB2F3`** (world 3's own idx3) are **NOT** non-attacking as an earlier pass of this document speculated ("look reload-only... no emitter call... worth a check, not a conclusion") — both pairs are periodic **hazard-drop** attacks feeding the two "falling rock" pools this document elsewhere (wrongly) calls permanently cut content; see the correction under *`UNKNOWN_b1c2`* above for the full mechanism (`B144`/`B2C7`'s own frame-3 branch spawns into `DS:0xaccc` / arms-and-feeds `DS:0xad1c`+`DS:0xad94` respectively).

**Net correction:** the selector-2 system is not one handler family reused across four worlds — it is (at least) six distinct `handlerA`/`handlerB` families (`B60E`/`B670`, `B5E9`/`B670`, `B70E`-stub-family/`B03C`+`B017`, `B144`/`B290`, `B2C7`/`B2F3`), dispatched per-**class**, not per-world, and `HANDLER_FOR[world]` in `selector2.js` was consequently wrong for the large majority of shipped selector-2 spawns (every class except the single `B60E`/`B5E9` class each world happens to also have). `gods-web/src/game/selector2.js` now resolves `handlerA`/`handlerB` per `(world, classIndex)` directly off the class table (the same table `CLASS_TABLES_B` already parses for `base`/`w`/`h`) instead of `HANDLER_FOR`.

### `CS:0xE99F` / `CS:0xEFA2` are not enemy-shot code at all — a "steal-and-carry" pickup mechanic `[PROVEN]`

The false lead: both loaders start `mov si,0x8954`, but that literal is a coincidence of layout, not a shared array. `0x8314 + 200×8 = 0x8954` — the enemy-shot array's documented base is simply the **exclusive upper bound** of the 200-record, 8-byte **object array** at `DS:0x8314` (`CS:0x8FEF`'s already-documented expansion of the map's object table). Both routines walk *backward* from that bound (`sub si,0x8` first, then decrementing) through the object array, never the shot array; the resemblance to the shot record's own `{x,y,vx/type,state/flag}` shape is because both arrays happen to use a similar 8-byte, sign-tested layout, not because they're the same data. (This refutes a plausible-looking hypothesis about the enemy shot's own fade sequence repurposing its velocity word as a "signal" for these two routines to match against — a full re-read of the terrain-stop/fade code found the shot's `[si+4]` is written exactly once during termination, always to literal `0`, nowhere else; E99F/EFA2 never read the shot array in the first place.)

What they actually do: search the object array for a **live, currently-on-screen, matching object** — matching a caller-supplied type (`bp`), world X (`cx`) and world Y (`dx`) exactly — and if found, **kill that map object** (`[si+4]:=0xFFFF`, `[si+6]:=0`, this document's own already-documented "mark dead" idiom) and copy its type and position into the calling *entity's* own record. `CS:0xE99F` (called once, from `CS:0xE90E`, itself called once from `CS:0xE88C` — this document's own already-documented `DS:0xd95c[2]` "marker-seek" strategy handler) is **System A**: it writes the stolen object's X/Y into `[di+0x20]`/`[di+0x22]` and its type into `[di+0x10]`, and System A's own per-frame draw bracket (`CS:0xE0C1`–`0xE0E8`) then **eases** those coordinates halfway toward the carrying entity every tick, drawing the carried item as a second sprite that visibly drifts to follow. `CS:0xEFA2` (reached only through `CS:0xEF01`, called once from `CS:0xEDDA` — inside System B's own documented per-frame driver, right after its `DS:0xdbe0` mode dispatch) is the **System B** mirror: it writes to `[di+0x14]`/`[di+0x16]`/`[di+0x10]` instead, but only `[di+0x10]` (the type) survives past the same tick — System B recomputes the carried item's screen position **fresh every frame** from a fixed per-class attach-point offset (`CS:0xEEBA`, via the same `DS:0x1fc` class-table pointer this document's `CS:0xf0ae` sprite formula already reads), a rigidly-attached icon rather than an eased drift. Both gates are the same: `EF01`/`E88C` only run while `DS:0x3cd`/the group's own goal-strategy is specifically **2**, this document's already-documented "attracts monsters" marker-seek strategy — so a creature can only steal a nearby marked pickup while it is actively drawn toward the marker list. One asymmetry: System B's marker match explicitly excludes type `0x45` (69, the hint tablet) via a check System A's own marker loop lacks.

Both systems eventually **drop** the carried item probabilistically (a per-tick 1-in-128 roll, gated by bits of the group descriptor's own `+0x4`/`+0x5` word — `0` = never carries this far, `2` = always keeps it, `1`/`3` = the roll applies) through one shared respawn routine, `CS:0xC041`, which allocates a fresh `DS:0x8314` object slot (`CS:0x38D7`, the same allocator this document already documents elsewhere) and writes the carried type back in as a new, live object at the *carrier's* current position — closing the loop: steal a placed pickup, carry it, and (usually) put a fresh copy back down somewhere else. `cx`'s discriminated encoding into `CS:0xC041` (weapon index `<0xB` recovered via `+0xC0`, ordinary type `≥0xB` recovered via `−0xB`) is exactly matched by both callers' own construction of it, closing what would otherwise have looked like an arbitrary bias constant.

### `UNKNOWN_eeba_class_offsets` — CLOSED: a per-class, per-world signed byte-pair offset table at `DS:0xdc00` `[STATIC]`

`CS:0xEEBA` computes `si = [0x1fc] + cls*12` (System B's per-world class table, the same `+0x7`-indexed lookup `CS:0xf0ae`'s sprite formula uses), then:

```
eecd  cx = word[0x8] - word[si]      ; a caller-supplied value MINUS the class's own sprite base (word[si] = class_table[cls].spriteBase)
eed3  cx <<= 1
eed5  si = 0xdc00 + cx                ; table1 = DS:0xdc00, 2-byte stride, indexed by (carried-sprite − classSpriteBase)
eeda  dl = [0x42] - 2 ; dh = 0        ; world (1..4) minus 2
eee3  dx <<= 1 (x3) ; si += dx        ; += (world-2)*8
eeeb  dx <<= 1 (x2) ; si += dx        ; += (world-2)*32   -> total += (world-2)*40
eef1  dx = ax                          ; caller's world X
eef3  al = signed_byte(si[0]) ; dx += ax     ; dX offset
eef7  al = signed_byte(si[1]) ; bx += ax     ; dY offset
eefd  si = [bp+2]                      ; restore the entity pointer
ef00  ret
```

So the table is genuinely a **per-class, per-world signed `{dx, dy}` byte pair**, added to a caller-supplied world position (`AX`/`BX`) to produce the carried item's draw offset — exactly the "rigidly-attached icon" behaviour this document's own *steal-and-carry* section already describes for System B, now with the table itself decoded rather than merely located. `CX = word[0x8] − word[si]` (`si` = `class_table[cls]` base) is what indexes it, and `DS:0x8` was flagged as `UNKNOWN_ds_0008_writer_link` — a shared scratch word whose relevant writer was not traced to its caller.

**`UNKNOWN_ds_0008_writer_link` — CLOSED: `DS:0x8` is the standard shared draw-call sprite-id argument, and the offset is keyed to the CARRIER's own animation phase, not to which item is carried `[STATIC]`.** `DS:0x8` is not a dedicated variable at all — a program-wide `search_instructions` sweep finds **94 write sites** to it across the whole image, the overwhelming majority of the shape `MOV [0x8], <reg>` immediately preceding a `CALL` into the shared masked-blitter exports (`CS:0x3569`/`0x356E`): it is the third argument of this codebase's universal `{screenX=[0x4], screenY=[0x6], spriteId=[0x8]}` draw-call convention, already established elsewhere in this document for exactly this reason.

Tracing `CS:0xEEBA`'s own caller (`get_xrefs_to`: exactly one, `CS:0xEE18`, inside `FUN_1000_ee00` — System B's already-documented "alive → draw" dispatcher) settles the timing: `FUN_1000_ee00` calls `0xEEBA` at `CS:0xEE18`, and **its own local write to `[0x8]`** (`CS:0xEE40`, staging the args for the *literal* draw call at `CS:0xEE44`) happens **20 bytes later, after** the `0xEEBA` call already returned. So at the moment `0xEEBA` reads `DS:0x8`, that slot still holds whatever the **entity's own sprite-formula resolver** last wrote — this document's own already-documented `CS:0xEDD5` (System B, `FUN_1000_edb8`) or `CS:0xE09E` (System A, `FUN_1000_e001`), both of which store the *carrying entity's own currently-computed sprite id* into `DS:0x8` before the shared contact-and-draw dispatch chain (`CS:0xFF93 → CS:0xEE00`) ever runs — the identical write this document's own `UNKNOWN_hunter_negative_tag` closure already traces for the hunter's target-list key.

So `CX` in `CS:0xEEBA` is **not** "which item is carried" — it is **the carrying creature's own current sprite id**, and `CX − class_table[cls].spriteBase` is exactly the small, animation-relative quantity this document's own sprite-formula work already bounds to `0..17` (the 18-slot `MODE_ANIM`/frame spacing). The 40-byte-per-world block (20 `{dx,dy}` pairs) comfortably covers that range with room to spare — far more sense than indexing by carried-item identity, which would need far more than 20 slots. **The carried icon's draw offset therefore wobbles in sync with the carrying creature's own current animation frame**, not with what it is carrying — a small idle-jiggle effect keyed to gait/hop phase, not an item-specific icon placement.

### `UNKNOWN_marker_record_field4_gating_scope` — CLOSED: every category 0/1/2 touch appends a marker, not just type 45 `[STATIC]`

Reading the object-touch dispatcher (`CS:0x15F1`–`0x1652`, the same function this document already credits with the category-4 dispatch at `CS:0x161D`/`0x1CC6`) end to end: the category split at `CS:0x160D` (`cmp byte[di+4],3 / jl 0x162e`) sends **every category < 3 touch — potions (0), treasure (1), AND keys (2)** — through `0x162e` and straight into the marker-append body at `CS:0x1632` (`inc byte[0x398]`, clamp at 20). The type-45-specific branch (`cmp dx,0x2d / jnz 0x1652`) only gates the *extra* behaviour — resetting the marker cursor to the array base and forcing the global strategy override `DS:0x399` — not the append itself. So **any potion, treasure, or key the hero touches appends a marker record**, and only the `"attracts monsters"` potion additionally rewinds the cursor and forces every System-B enemy onto the marker-seek strategy. `CS:0xC041` (called two arms later, per the trigger case above) is reached from this same dispatcher for the *weapon* path.

### `UNKNOWN_c041_176b_purpose` — CLOSED: a generic "spawn N copies" bulk helper `[PROVEN]`

`CS:0x1764`–`0x177A` is a small, reusable subroutine, not part of the pickup dispatcher itself — it sits between the already-documented chest-loot burst spawner (`CS:0x12CF`→`0x12EA`/`0x1756`, whose own tail ends at `CS:0x1763`) and the main pickup contact test (`CS:0x177D`), and `get_xrefs_to` confirms it is called from **two unrelated places**: three times in a row from `FUN_1000_16f9` (this document's own already-documented "routine reached only for sprite `0x118`" — `280 − 170 = 110`, and `POBJECTS` type 110 reads `"treasure chest"`, a *second*, differently-triggered chest-shaped object distinct from the category-1 chest mechanism) and once from `CS:0xCCC6` (not chased further). Its body:

```
1764  push ax,dx           ; save the base position/count
1766  push ax,bx,cx,dx,bp   ; re-push all FIVE call args every iteration — CS:0xC041 consumes and PRESERVES them via its own push/pop
176b  call 0x1000:c041      ; the shared object-respawn allocator, already documented
176e  pop bp,dx,cx,bx,ax    ; restores the SAME values pushed at 0x1766 — the call itself doesn't touch the caller's copies
1773  add ax,bp             ; X += BP, the CALLER's own fixed per-iteration step (NOT the allocator's return — see below)
1775  dec dx / jns 0x1766   ; loop DX+1 times
1778  pop dx,ax
177a  ret
```

So `CS:0x1764` is a **generic "spawn `DX+1` copies of object `CX`, starting at `(AX,BX)` and stepping X by a fixed `BP` each time" loop**, built on the already-documented single-object respawn routine.

### `UNKNOWN_16f9_burst_counts` — CLOSED: a hidden "treasure vault" object that scatters 28 items in three waves `[STATIC]`

`FUN_1000_16F9` (the sprite-`0x118`/`POBJECTS` type-110 `"treasure chest"` handler) is a one-shot trap, not a passive pickup:

```
1700  cmp byte[0x360],0 / jnz 0x175c    ; a ONE-SHOT LATCH — already fired -> do nothing
1707  bx += 8 ; ax += 8                  ; nudge the touch-test box
170d  call 0x1000:177d                   ; the GENERIC pickup contact test (this document's own "the contact test")
1710  jnc 0x175c                         ; not touched this tick -> leave
1712  mov byte[0x360],1                  ; LATCH — never fires again
1717  ax=0xd40 bx=0x320 cx=0x15(21) dx=9 bp=0x10   ; wave 1: 10 copies of type 21, X step 16
1726  call 0x1000:1764
1729  ax += 8 ; bx += 0x12               ; move the spawn origin down-right for the next wave
172f  cx=0x10(16) dx=8                    ; wave 2: 9 copies of type 16, same X step (bp unchanged, still 0x10)
1735  call 0x1000:1764
1738  bx += 0x12
173b  cx=0x12(18) dx=8                    ; wave 3: 9 copies of type 18
1741  call 0x1000:1764
```

Reading the three spawned `POBJECTS` types directly (decompressed `POBJECTS.001`): **type 21 = `"chest key"`, type 16 = `"treasure chest"` (description `"iron"`), type 18 = `"door key"`.** So touching this hidden object once scatters **10 chest keys, 9 iron treasure chests, and 9 door keys** — 28 objects in total — across three horizontal rows (`Y` stepping `0x12`=18px between waves, `X` stepping `0x10`=16px within each wave). This is the first documented dynamic source of **iron chests** (`POBJECTS` type 16) — this document's own chest census records **zero** iron chests placed statically in any of the eight shipped `.MAP` files, so every iron chest a player can ever see comes from this trap object firing, not from level data. **But no shipped map places one.** Decompressing all eight `.MAP` files and scanning every one of their 200×8 object records for `type == 110` finds **zero hits in all eight levels.** So this is a **seventh cut feature**, in the same family as the `flame` weapon, the unplaced familiar potions, and the world-4 System-A environmental hazard: fully implemented — contact test, one-shot latch, three-wave 28-item scatter — and permanently unreachable in the shipped release, because the level editor never placed the one object that triggers it.

**`CS:0xCCC6`'s own call is a scripted reward, part of the same world-1 cutscene machinery this document already documents.** Its full body:

```
ccb2  word[0x250] += 0xa                                   ; the already-documented respawn-restore slot, incremented here
ccb7  ax=0xb8a(2954) bx=0x70(112) cx=0x35(53) dx=9 bp=0x17(23)
ccc6  call 0x1000:1764                                       ; spawn 10 copies of POBJECTS type 53 at (2954,112), X-step 23
ccc9  call 0x1000:ccdb
cccc  ret

ccdb  ax=word[0]  ; es=ax                                    ; ES from a fixed low DS:0x0 word (not chased further)
cce0  ax=0xa986 ; bp=0x52a2 ; callf [bp+0]                    ; (0x52a2-0x5252)/4 = 20 -> graphics EXPORT 20 (rect save/restore), already documented
```

`POBJECTS` type 53 reads `"weapon arc" / "wide"` — one of the three already-documented arc potions. So this scripted event **showers the player with 10 wide-weapon-arc potions**, at a world position (`2954, 112`) close to (though not identical to) the already-documented world-1 scripted-camera-pan target `(0xb60, 0x78)` = `(2912, 120)`, strongly suggesting the two belong to the same scripted world-1 sequence (installed via trigger ACTION selector 11's `SS:0x537a`-indexed per-world routine, this document's already-documented `DS:0x34`/`0x375` cutscene engine) — plausibly a pre-boss power-up reward. `CS:0xCCCD`–`0xCCDB` is a small sibling check reached from elsewhere in that same routine: it compares the lives count `DS:0x224` against the just-incremented `DS:0x250` threshold and sets a flag `DS:0x34A` when lives are sufficient — read together with the `+0xa` increment at `CCB2`, this looks like a **per-attempt cost gate** (each pass through this scripted step costs a "life" against a rising threshold), but the flag's own consumer and the surrounding scripted-sequence context were not traced further this pass.

The marker record's own trailing bytes (beyond the `{x, y}` that `0xf7bb`'s consumer reads) were not located this pass — the write site past `CS:0x1652` continues into a `PUSH DI / PUSH DS` sequence consistent with the shared message-display call this document documents elsewhere, not an obvious marker-array store, so `UNKNOWN_marker_record`'s original question (what the record's other two bytes hold) stays open.

## `DS:0x8b4c` — debris, and it is inert `[PROVEN]`

**20 records of 12 bytes**, cleared at `CS:0x8E91`. The whole per-record body `CS:0x1F8C`–`0x1FD6` contains **exactly one call** — `0x1FC0 call 0x356e`, the masked sprite blit (`0x356E` is `mov bp,0x525a`, and `(0x525a − 0x5252)/4` = **graphics export 2**, not the export-1 blitter the alive-entity draw uses). No `0xac59`, no damage-grid stamp, no plane pointer. **Debris cannot hurt anything and cannot touch the map.**

```
+0x00  u16  alive: 0 alive, 0xFFFF free      +0x06  i16  X velocity — READ ONLY
+0x02  i16  world X                          +0x08  i16  Y velocity — READ ONLY
+0x04  i16  world Y                          +0x0A  u16  sprite id AND lifetime
```

⚠️ **No gravity and no drag** — `0x1F99`/`0x1F9E` *read* the velocities and never write them, so debris flies in a straight line for its whole life. Every other particle system here accelerates (hero, enemy, time bomb, magic axe, chest loot, starburst, and the `DS:0xcfcc` hazard), so "obviously it should fall" is the wrong instinct.

⚠️ **The sprite word IS the lifetime**: seeded `0x3A`, drawn raw, incremented, freed at `0x45`. The draw precedes the increment, so ids `0x3A`..`0x44` are all drawn — **eleven ticks**. There is **no cull** of any kind.

**Three producer shapes**, differing only in what the *caller* passes — all three store **world** coordinates, pinned by the consumer subtracting the scroll at `0x1FA9`:

| entry | input | velocity | callers |
|---|---|---|---|
| `0xA00D` | world | the projectile's `dir` word, **hi → vx, lo → vy** | 1 (the hunter's no-target arm) |
| `0xA633` | screen, + scroll added inside | `cx`/`dx` | **5** — see below |
| `0xA81A` | screen, + scroll added inside | **zero** — a stationary impact puff | 0 (fall-through from `0xA810`) |

`0xA00D`'s hi/lo split is a second, independent routine agreeing with the hunter mover's reversed packing at `0x9F41`. `UNKNOWN_debris_identity` — "debris" is a label; the bytes prove only an 11-frame inert visual effect. ~~`UNKNOWN_8b4c_indirect_write`~~ — **CLOSED `[STATIC, exhaustive]` (2026-09-29).** Every operand in the `GAME.EXE`, `VGA.EXE`, `ADL.EXE` and `ROL.EXE` listings whose value falls anywhere in the array (`0x8b4c`–`0x8c3b`, displacement forms included) was enumerated. There are five data references, all `mov si/di,0x8b4c` (`CS:0x1F7B` the consumer, `0x8E91` the clear, `0xA00E`/`0xA63A`/`0xA81A` the producers), plus three `CS:0x8b56` code-patch hits that aren't data. None of the five stores its pointer anywhere, and the drivers name nothing in the range. The consumer (`CS:0x1F8C`–`0x1FD6`, read in full) writes only `+0x2`/`+0x4` (the position), `+0xA` (the frame) and `+0x0` (the free), so the velocities are written only by the producers at spawn.

⚠️ **Correction — `0xA633`'s caller count was wrong, and it stood uncorrected for two sessions.** "ELEVEN callers" was never paired with an address list anywhere in this document — a genuine gap the project's own evidence discipline exists to catch, caught only when the `gods-web` port went to wire the remaining producers and the named callers ("block-breaking, the familiar's death, the starburst chain") turned out not to be real. Traced fresh in Ghidra with two independent methods agreeing (`get_xrefs_to` and `search_instructions` on the exact operand `a633`, both against `GAME.EXE`, `instructions_scanned: 14010`): **exactly five** direct near-`CALL`s to `1000:a633`.

| site | in | what |
|---|---|---|
| `CS:0x4561` | `FUN_1000_4501` | the enemy-shot hero-hit puff, already documented above under *"The hero hit, CS:0x4501"* |
| `CS:0xA7A1` | the magic axe's own mover, `0x9f38`/`0xa678` | fires on the tick the axe's **lifetime** expires (`0xA737 dec word [si+4] / js 0xa799`, already documented under *Mover 5*), carrying the axe's **own current velocity** (`cx=[si]`, `dx=[si+2]`, the SAME 6-byte `{vx,vy,lifetime}` record) rather than a stationary puff — a moving spark, then the projectile record is cleared (`mov word [di],0`) |
| `CS:0xAC4C` | the WEAPON-vs-CREATURE grid-scan tail, `CS:0xa9ef`-`0xac58` — **NOT** inside `CS:0xac59` (see the correction under *Difficulty*) | on the branch where a hit lands and the **target survives** — reached via `0xab90`/`0xab96`, i.e. from *inside* the difficulty-scalar bracket this document already documents at `CS:0xab56`-`0xab98` (`abda: mov [0x1ec],bp` stores the survivor's new HP; `bx`=reported damage; `ac00`-`ac4c` rolls two `0x3836` draws jittered by `DS:0x1e6`/`0x1e8`, the box width/height, and calls `0xa633` with `cx=dx=0` — a **stationary hit-spark** at a random point inside the target's own hitbox). The **death** branch (`bp` forced to `0xFFFF`, reached via `CS:0xab88`/`0xab8a jz 0xab98`) does **not** go through here. ⚠️ An earlier revision of this row said `CS:0xAC4C` sits "inside the shared contact/damage routine `CS:0xac59`" and gated it on `attackHero()` not modelling a difficulty-scalar/survival distinction — both wrong: `ac59` is hero-contact only and needs no such model, and the survival logic already lived in `gods-web`'s `creatureScansGrid` before this was corrected. **Closed** — `gods-web`'s `hitSparkAxis`/`creatureScansGrid` now drop the spark |
| `CS:0xDBBB` `CS:0xDC2F` | a **previously undocumented** pool | see below |

**A sixth system: `DS:0xd2be`, 20 slots × 22 bytes — `UNKNOWN_d2be_pool` CLOSED `[PROVEN]`.** It is a pool of fragments that fly along a Bresenham line from an entity's position toward the hero, and it is fed by a previously-undocumented divert inside the shared System-A/B facing-and-fire routine.

**The spawn trigger.** `CS:0xE659` (this document's own "the shared enemy-shot emitter", already recorded under *The five other emitter-pair owners*) reads `cx = (desc+0x4 >> 4) & 3` — call it `attackBits`. `attackBits == 0` fires an ordinary shot through the documented `CS:0x1FE7`/`0x2039` emitter; **any other value (`CS:0xE68D jz e692 / jmp e5e4`) diverts to `CS:0xE5E4` instead**, which spawns into this pool:

| `attackBits` | source | target |
|---|---|---|
| 1 | entity position, exact (no muzzle offset) | hero position, jittered: two independent `CS:0x3836` draws, `(rand() & 0x3f) - 0x1f` per axis — **range `[-31, +32]`, asymmetric** |
| 2 or 3 | entity position, **X muzzle `+0x10`** — a THIRD muzzle-offset constant in this game, next to the shared emitter's own `-8`/`+32` | hero position, exact: `(heroX+8, heroY+6)` |

`n` — the per-spawn/per-frame step count, the field this document's own group-descriptor table had left `[WF]` — is the **high nibble of `desc+0x6`** in both variants; the low nibble is the ordinary fire-rate divisor `CS:0xE659` already reads. A shipped-data census (`blast.py` over all 8 `PALFILS` files, both entity systems, both descriptor windows) found this genuinely reachable and live: **89 of 344 live descriptors** set nonzero `attackBits` AND a nonzero fire-rate nibble (`attackBits ∈ {1: 53, 2: 36}` — **3 never occurs**), concentrated in worlds 3-4, matching this document's separate finding that every world-4 System-A firer diverts to `CS:0xE5E4`. `n` itself is never 0 or 1 in the census (`n ∈ {2,3,4,5,6,8,10}`) — see the N==0 note below.

**⚠️ The most consequential finding: this is a RAY, not a segment — it does NOT stop at the target.** `CS:0xdce1` (the SEED, called once at spawn via `CS:0xdbc6`/`0xdbd4`) computes the classic Bresenham parameters (`dx`,`dy` unsigned magnitudes, per-axis sign, `err` seeded to `major>>1`) and picks one of FOUR near-identical loop bodies depending on x-major/y-major × leftward/rightward — `0xdd04`, `0xdd43`, `0xdd95`, `0xddd3`. It writes the CHOSEN loop's own entry address into the record's `+0x00` word as a "resume pointer", and the per-tick walker `CS:0x7a0b` loads saved register state from the record and does `DI=[DI+0] / JMP DI` to resume mid-loop.

The seed's four loops and `7A0B`'s four loops are **byte-identical in their relative encoding — except for one thing**: `7A0B`'s loops ALSO test whether the major-axis distance counter (`[0x1ee]`, decremented once per Bresenham step) has gone negative, and exit early if so; **the seed's loops do not.** Since the seed's own finalize re-writes the SAME `0xdd04`-family constant every time it runs, `JMP DI` always lands back in the **seed's** copy — so every real per-tick resume executes the seed's unconditional loop, which burns exactly `n` steps and stops, with **no destination check at all**. `[0x1ee]` is loaded, decremented, and stored back every call, and nothing ever branches on it. So the fragment keeps flying past the target, at `n` grid-steps per frame, until solid terrain, the hero, or the off-screen cull stops it — never because it "arrived".

**⚠️ N == 0 would hang.** `DEC [0x1f0] / J.. loop` wraps on an input of 0 (`0 - 1 = 0xFFFF`, ~65536 iterations) — the low nibble of `desc+0x6` has its own zero-guard (`CS:0xe666 al&=0xf / jz e6be`), the HIGH nibble does not. The census above (89/89 reachable descriptors) shows this never happens in shipped data — `n` is always 2..10.

**The per-tick body, `CS:0xdc49`-`0xdcd0` (walker) + `CS:0xdb4e` (hero-hit):**
1. Advance `n` Bresenham steps (always `n` — see the ray-not-segment finding).
2. Solid-terrain probe, `CS:0xdc68`-`0xdc8d`: `col = floor((x+3)/32)`, `row = floor((y+3)/16)` — a **fifth** distinct pixel-to-cell rounding rule in this game (`+3` on BOTH axes; this document's collection so far has floored/rounded-nearest/`+8`-both/`+2`-Y-only). Solid → consume, drop a **stationary** debris puff at world `(x-3, y-3)` (`CS:0xdc1b`/`0xdc1e` — its own constant, not "undo the probe bias"), no draw.
3. Screen-space cull, `CS:0xdca2`/`0xdca7`: `screenX < 0x13c(316)` and `screenY < 0xbc(188)`, both floored at 0 by a sign test — matching this document's own earlier estimate exactly. Outside it → consume WITHOUT debris (`CS:0xdcdb`), no draw.
4. Else, hero-hit test `CS:0xdb4e`: hot point `(x+6, y+4)` world, against a `0x20 × 0x30` box with the crouch top-raise at `+0x18` (matching `CS:0x4501`'s magnitude, **not** `CS:0xac59`'s `+0x14`). Hit → consume, flat `-2` off the health **target** (chases down like every other source), a stationary debris puff at world `(x-2, y-2)` — a **fourth** distinct debris-offset constant in this subsystem alone. **Invulnerable → pass through** (`CS:0xdb99`/`0xdb9e`, same shape as `CS:0x4547`): no consume, no damage, no debris, keeps flying.
5. Draw, **regardless of whether step 4 just consumed the record** — the sprite/position are staged before the `db4e` call, and the draw (`CS:0xdccb`, export 2, the same blitter debris uses) runs unconditionally once a record survives steps 2-3. Sprite = `0x4b + (DS:0x36c & 1)` — 75/76, the same every-other-frame toggle the world-2 nest's hatch animation reads, immediately after the enemy-shot sprite range (`0x45`-`0x4A`) — discriminating, not decorative.

Cleared once per level load, `CS:0xdbfb`, called from `CS:0x8e37` inside the level-init routine (`FUN_1000_8c34`) alongside the other particle pools. Stepped from the main loop at `CS:0x02BD`, immediately after the enemy-shot step (`CS:0x02BA`) and before the health-bar chase (`CS:0x02C6`).

⚠️ `FUN_1000_b1c2` is `db4e`'s OTHER caller (`CS:0xb236`) and is **not** this pool — it is its own separate, permanently-dead 10-slot hazard at `DS:0xaccc`, sharing sprite atlas slot 531 with the already-documented world-4 cut hazard. See *`UNKNOWN_b1c2` — CLOSED*, above (under *`UNKNOWN_hazard_emitter_placement`*).

Ported as `gods-web/src/game/line-hazard.js`. **The spawning side is now wired for System A**: `entity-a.js`'s `stageFacingAndFire` (this document's `CS:0xE659`) reads `attackBits` and returns a hazard-spawn descriptor instead of a muzzle when it is nonzero, and `main.js` routes it to `spawnJittered`/`spawnAtHero`. ⚠️ **System B has no fire logic at all in this port** — `CS:0xE659` is shared by both entity systems, but this port has never given System B's own per-frame driver (`CS:0xEDB8`) a call into it (a pre-existing gap, not introduced by this pass); the majority of the census's 89 live descriptors (65 System B, 24 System A) belong to System B and so still fire nothing.

⚠️⚠️ **CORRECTION, a later session — this is stale.** `gods-web/src/game/entity.js` now exports `fireB(e, desc)` (`CS:0xE659`'s own port, read in full: reload-timer gate, `attackBits` divert, the shared muzzle/hazard shape), called from `EntityB.tick()` itself — **before** the `DS:0xdbe0` mode dispatch, matching this document's own "`CS:0xE659` runs BEFORE the mode dispatch for System B (unlike System A's stage 6, which runs last)" ordering exactly. `main.js`'s own per-entity loop over `enemies` (System B) reads the returned muzzle/hazard and routes it into the shared `EnemyShots`/`LineHazards` pools identically to System A's own call site, incrementing `firedByB`/`firedHazardsByB`. So System B does fire, through both channels (ordinary shots and the `attackBits`-gated line-hazard divert) — the gap this paragraph names was closed in a session between when this paragraph was written and now.


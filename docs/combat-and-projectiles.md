# Projectile collision and weapon pickup

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## Projectile collision — an occupancy grid, not a hit test `[PROVEN]`

**There is no pairwise projectile-vs-creature test anywhere in `GAME.EXE`.** That is why every search for one failed. Collision is mediated by a shared **8×8-pixel occupancy grid in SCREEN space at `DS:0x16ca`**: every live projectile stamps its own tag byte there on its *draw* path, and every creature then scans the grid over its own bounding box and reacts to the first nonzero cell. The two halves never reference each other — only the grid.

```
CS:0x01CC  call 0xACF6     clear the grid
CS:0x020F  call 0x9455     projectiles move and draw -> each STAMPS its tag
CS:0x0285  call 0xED15     System-B entities -> CS:0xFF93 -> CS:0xA9E4 SCANS
```

⚠️ **`[WF]` provenance note.** This was produced by an 11-agent workflow. The five load-bearing pieces below — the clear, the stamp, the scanner, the scanner's rounding and the tag decode — **were re-read on the bytes in this project** and are `[PROVEN]`. The death/score path, the 3×3 stamp variant, the stamp-site census and the remaining movers are `[WF]` and are marked where they appear.

### The grid `[PROVEN]`

| property | value | proof |
|---|---|---|
| cleared | 1600 bytes at `DS:0x1666`, once per frame | `0xACF6 mov cx,0x320 / mov di,0x1666 / rep stosw` |
| element | 1 byte per **8×8 screen pixels** | both axes shifted by 3 at stamp and scan |
| row stride | **`0x30` = 48 bytes = 384 px** | `6*(y & ~7)` = `48*(y>>3)` |
| origin | `DS:0x16ca` = screen (0,0) | 100 bytes into the cleared region — margin above/left |
| write window | `[0x1696, 0x1c42)` | `0xA87A cmp si,0x1696 / jl`, `0xA880 cmp si,0x1c42 / jnl` |

Index at both ends: `si = 0x16ca + (x >> 3) + 6*(y & ~7)`.

⚠️ **But the stamp FLOORS and the scan ROUNDS half-up.** `0xA863` shifts `x` with `sar` and masks `y` with `and 0xfff8`; `0xAA09` does `add ax,4 / add bx,4 / and 0xfff8` on **both** first. They agree only on exact multiples of 8. **One shared helper for both misplaces every stamp by up to half a cell.**

### The scanner — and CLAUDE.md's own name for it was wrong `[PROVEN]`

An earlier revision of this file called `0xaad1`–`0xab3f` "the pixel-mask collision scan". **It is not a pixel mask.** All 60 bytes of the compare chain at `0xAAF7`–`0xAB32` are `cmp byte [si],0 / jnz 0xab40 / inc si` — no `TEST`, no `AND`, no shift, no bit index. It is **rectangle-vs-rasterised-occupancy at 8×8 granularity**, and sub-cell precision does not exist anywhere in this system.

The computed `jmp` is a variable-length loop on a fixed unrolled chain:

```
AAC2  dx = [0x1e4] >> 3 ; dec dx ; jns / sub dx,dx     ; rows-1, floored at 0
AAD3  cx = [0x1e2] >> 3 ; dec cx ; js/jnz -> cx = 1    ; columns, minimum 1
AAE5  di = 0xab33                                      ; the END of the chain
AAE8  dx = 0x30 - cx                                   ; row advance
AAED  shl cx,1 / sub di,cx / shl cx,1 / sub di,cx      ; di -= 6*cx
AAF5  jmp di                                           ; enter so exactly cx compares run
AB33  add si,dx / dec al / jns 0xaaf5                  ; next row
AB3F  ret                                              ; NO HIT
```

Each unit is exactly **6 bytes**, so the chain holds **10 columns = 80 px maximum** — a wider box simply cannot reach past column 10. `DS:0x1e2`/`0x1e4` are the caller's width/height globals, set to `0x20`/`0x20` for a System-B creature at `0xFF93`.

⚠️ **The scanner has no bounds check of its own** — there is no compare against the buffer limits anywhere in `0xAAAA`–`0xAB3F`. It stays in range only because the caller's clips and the largest shipped creature box happen to keep it there. Change a clip constant and the safety vanishes silently. A port should clamp.

### `UNKNOWN_weapon_08` enlarged — it is also the DAMAGE `[PROVEN]`

The tag decode `CS:0x9320` turns a grid cell back into a weapon:

```
9323  al = [si]                  ; the cell = the projectile's tag
9325  cbw / or ax,ax / js        ; NEGATIVE -> a non-projectile source
932A  si = 0xdd10 ; cmp al,9 / jng     ; each slot owns NINE tags
9331  si = 0xdda2 ; al -= 9
933A  si = 0xde34 ; al -= 9
933F  dec al / shl ax,1 ×3       ; (tag-1)*8 = the record's byte offset
9347  bx = [si]                  ; the slot's weapon index
934B  di = 0xe2b6 + weapon*0x50
935E  ax = [di+0x8]              ; <-- THE DAMAGE
9361  [0x1ea] = ax               ; which 0xAB45 then reads as `bx`
```

**Damage is weapon `+0x08` — the pickup count — not Power (`+0x06`).** Since a new pickup sets `count := Power` (`CS:0x9115`), **Power is the weapon's STARTING damage**, and every duplicate pickup adds exactly 1 to it. So a duplicate buys **both** an extra projectile *and* +1 damage each — which is also why the shop refunds on `(count − base)`.

This joins cleanly to what this document already recorded: `0xAB45 mov bx,[0x1ea]` and `0xAB56 cmp byte [0x365],0` are the difficulty-scalar site already documented, with "`bx` the raw damage from `DS:0x1ea` and `bp` the target's HP". The tail was known; what was missing was that the **entry is a grid scan**.

### Weapon `+0x49` — the knife does NOT pierce: single-hit weapons are CONSUMED on their first hit `[PROVEN]`

`FUN_1000_9320` (the tag decoder above) does not end at `0x9361`. Read to its actual `RET` at `0x938A`, the fall-through past the damage store contains a second, previously-unwired mechanism:

```
9364  ax = [0x198] - [0x1ba] ; jg 0x9399         ; the par bonus, see below
9399  ax >>= 3 (sar ×3) ; [0x1ea] += ax ; jmp 936d
936D  cmp byte [0x34],0 / jz 0x937c              ; sfx gate, see below
9374  push ax / mov ax,0x21d / call 0x22ca / pop ax   ; ⚠️ 0x21D, not 0xF22 (see below)
937C  cmp byte ptr [di+0x49],0x0                 ; <-- DI is STILL the weapon record from 0x934B-935C
9380  jz 0x9387                                  ;     (0xe2b6 + weapon*0x50), untouched since the damage read
9382  mov word ptr [si+0x2],0x0                  ; <-- DESPAWN, but [si] here is NOT the grid pointer
9387  sub ax,ax                                  ;     — see the SI derivation below
9389  pop di / ret
```

⚠️⚠️ **Corrected again (2026-09-28), on the bytes and live. The sound is `0x21D`, and `DS:0x34` is set for every guardian fight.** `CS:0x9375` is `B8 1D 02`, `mov ax,0x21d`: the same clink as the terrain stop (`CS:0xA7F7`), not the kill sound `0x0F22` the paragraph below says. And `DS:0x34` is 1 for the whole of every guardian fight (selector 11, `docs/guardians.md`), not only in the ending machine and ce64's bracket. So every weapon hit on a guardian clinks: live under ROL in `PJOYG1` the game plays `0x21D` on the guardian-hit ticks. The world-4 boulder brackets `[0x34]` = 0 around its own `A9E4` (`CS:0xCAB1`–`0xCABD`), so a hit on the boulder is silent. `gods-web` now plays it in `main.js`'s `decodeTag` whenever the decode runs with `DS:0x34` set, which covers the guardians and ce64's bracket alike.

**The par bonus, `CS:0x9364`–`0x939F`, ported.** `DS:0x198` is the world's par, `DS:0xE66C[world − 1]` = 0, 14, 22, 34 (read live), written only at level init (`CS:0x8E0E`). `DS:0x1BA` is the weapon total `CS:0x94F5` computes: each armed slot adds its `+6` base, up to two more bases while `count − base` lasts, then the remaining extras. Its only callers are the pickup (`CS:0x94D1`, `0x94F0`) and the power potion (`CS:0x62DD`). So it is one process-wide word that goes stale across a world's weapon reload and a full restart. An ordinary weapon hit gains `(par − total) >> 3` when that is positive. In `gods-web` this is `weapons.js`'s `recomputeWeaponTotal` / `hitBonus`. All six attract demos still replay exactly, including windows where the bonus is 1 or 2.

⚠️ **Corrected, a later session: this is not "unrelated," and — for one specific creature — it is NOT dead in normal play.** `CS:0x936D` is a THIRD emitter of the same `0x0f22` id the death branch (`CS:0xAB98`) and the hero-contact branch (`CS:0xABC0`) already play, gated on `DS:0x34` rather than those two branches' `DS:0x35e`. This block is fall-through: it runs after EVERY successful tag decode (`FUN_1000_9320` is called once per weapon hit, from `CS:0xAB41`, before the caller even checks whether the target survives), regardless of whether that hit kills. `DS:0x34` is 0 in normal play EXCEPT during the world-ending cutscene machine (where the entity-AI/damage-scan that could reach this is itself frozen, so it can't fire there either) and around exactly one other bracket: `CS:0x7FD4`, inside the world-3 `DS:0xce64` creature's own contact call (see `docs/consumables-and-treasure.md`'s `DS:0x34` section). That bracket wraps the SAME `a9e4` call this tag decode is reached from — so for that one creature specifically, `0x22` plays on **every weapon hit that damages it, lethal or not**, not only on a kill. This is a genuine, narrow exception to the "a non-lethal weapon hit is silent" finding elsewhere in this document — scoped to exactly the one creature type `DS:0x34` ever brackets. `gods-web` does not model this: `ce64.js`'s own `decodeTag(tag, 1)` mode flag carries no `DS:0x34` equivalent, so this port's ce64 creature is silent on a non-lethal hit like every other creature, not distinctively noisier. Disclosed, not fixed — reproducing it needs threading a `DS:0x34`-equivalent through the decode call, which nothing in this port does today.

**`[si+0x2]` is the exact projectile record that scored the hit, not a copy and not the grid.** `SI` was set at `0x932A/0x9331/0x933A` to the SLOT BASE (`0xdd10`/`0xdda2`/`0xde34`) and then, at `0x9349 add si,ax` (the one instruction the project's earlier reading of this function stopped short of — it quoted `0x9347 bx=[si]` and `0x934B di=...` as adjacent, skipping the `ADD SI,AX` between them), advanced by `(tag-1)*8` — the same offset `0x933F-0x9345` computes. Since a slot's actual record array starts at `slot_base + 2` (the leading word is the slot's own weapon index, per this document's existing record layout), `SI = slot_base + (tag-1)*8 = record_address − 2`, so `[SI+2]` lands exactly on that record's own `+0` field — its TAG. `MOV word ptr [SI+2], 0` is therefore the identical despawn shape as `CS:0x9d91` (common-mover cull) and `CS:0xA85B` (terrain stop): it zeroes the live projectile's tag, freeing its slot immediately (the allocator's free test reads that same word).

This fires on **any** ordinary weapon-tag hit (tag 1..27; the negative-tag special sources FF/FE/FD/FC never reach this code — they return earlier, at `0x938A`/`0x9398`/`0x93BE`/`0x93CB`/`0x93DC`), gated only on the HIT weapon's own `+0x49` byte, and **unconditionally** — it does not check the damage dealt or whether the target's HP crossed zero. A weapon with `+0x49` set is consumed by the very first creature it damages, kill or not.

**Read directly off all four shipped `PWEAPONS.00{1-4}` files (`blast.py`), byte-identical across every world:**

| weapon | `+0x48` breaksTerrain | `+0x49` consumedOnHit |
|---|---|---|
| knife | 0xFF | **0xFF** |
| time bomb | 0xFF | 0x00 |
| fireball | 0xFF | **0xFF** |
| flame | 0xFF | **0xFF** |
| lightning bolt | 0x00 | 0x00 |
| throwing star | 0xFF | 0x00 |
| spear | 0x00 | 0x00 |
| axe | 0x00 | 0x00 |
| hunter | 0x00 | **0xFF** |
| magic axe | 0x00 | **0xFF** |
| mace | 0xFF | 0x00 |

**The knife is a single-hit, non-piercing weapon in the shipped game** — along with fireball, flame, hunter and magic axe. Time bomb, lightning bolt, throwing star, spear, axe and mace persist through a hit and can strike more than one creature per shot. This has nothing to do with `+0x48` (terrain collision, documented above) — the two flags are independent; the knife has BOTH set (stops at a wall, and is consumed by a creature hit), while e.g. the mace breaks terrain but pierces creatures, and the axe does neither.

⚠️ **This corrects the `UNKNOWN_tag_fd` closure above**, which read `FUN_1000_9320` only as far as `0x9361` and stated the projectile tag byte "has exactly one writer... and exactly one other, which zeroes it on despawn" (`CS:0x9d91`/`0xA85B`). `CS:0x9382` is a **third** writer, conditioned on the hit weapon's `+0x49` flag. This does not change that closure's conclusion about `0xFD` specifically (that tag still never reaches the grid, by any producer), but the "exactly one other" phrasing was incomplete — the fuller and now-correct count is: the fire-slot allocator (creates), the common mover's cull (`0x9d91`), the terrain-stop path (`0xA85B`), and the grid-tag decoder's `+0x49` despawn (`0x9382`), each independently gated.

`gods-web` ported since early in this project's history that it decompresses `+0x48` and `+0x49` as two separate byte fields rather than one big-endian word (`weapons.js`'s `breaksTerrain`/`consumedOnHit`), but `+0x49` sat parsed and completely unread until this session — every weapon, knife included, incorrectly kept flying through every creature it hit. `collision.js` now exports `hitConsumesProjectile`/`despawnConsumedHit`, and `main.js`'s shared `decodeTag` closure (the one function every grid consumer — the hero's own scan, ce64, pat-objects, selector2, statue — is threaded through) calls `despawnConsumedHit` right after `damageForTag`, mirroring `CS:0x9382` living inside the same decode in the original.

The `cmp al,9` split independently re-confirms the tag layout: 9 tags per slot, `(tag−1)*8` addressing 8-byte records — records 0..8, the same **nine** the allocator reaches and the mover walks. Three independent routines agree on nine.

### Other grid users — the `[WF]` note was checked, and half of it was wrong `[PROVEN]`

An earlier revision of this block, tagged `[WF]` and explicitly marked *not re-read*, said: *"`0xFC` debris (`0xA549`)"*. **`CS:0xA549` is inside the STARBURST updater**; debris is a different, 20-record array at `DS:0x8b4c` (cleared at `CS:0x8E91`, appended at `CS:0xA816` on the projectile's terrain-stop path). The tag *value* was right and the *source* was wrong. This is the first time that block has been checked on the bytes.

**And "negative tags deal no damage" was wrong for three of the four.** The ladder at `CS:0x938B` peels one `inc ax` per tag:

| tag | `ax` | site | damage |
|---|---|---|---|
| `0xFF` | −1 | `0x938E` | `[0x1ea] = DS:0x210` — **the familiar's power** |
| `0xFE` | −2 | `0x93A8` | **10000**, or 0 when `DS:0x34 != 0` — the invulnerability aura |
| `0xFD` | −3 | `0x93C2` | **0**, always — CLOSED, see *`UNKNOWN_tag_fd`* below |
| `0xFC` | −4 | `0x93CC` | **10000**, or 50 when `DS:0x34 != 0` — the **starburst** |

⚠️ **10000 against creature HP that tops out at 255 is an instant kill**, and no difficulty scalar can forgive it — the scalar forgives at most three quarters. The 3×3 stamp variant `0xA8B8` nudges *before* its bounds check where `0xA860` nudges *after*, so the two clip differently at the grid edge.

### `UNKNOWN_tag_fd` — CLOSED: no producer exists in `GAME.EXE`, which makes a real, matching consumer permanently dead too `[STATIC, exhaustive]`

**The producer is provably absent, on BOTH ways a byte can ever reach the grid, not just the immediate-constant one.** `DS:0x16ca` has exactly two write mechanisms in this binary:

**1. Direct immediate stores** — the shape both the familiar (`CS:0xC2E7`, `MOV AL,0xFF` then four `MOV byte ptr[DI+n],AL`, inside `FUN_1000_c2b6`) and the invulnerability aura (`CS:0xA9DA`/`0xA9DF`, `MOV byte ptr[SI+disp8],0xFE`, inside `FUN_1000_a9ae` — a fourth, previously-undocumented stamp shape, reached from the aura's own per-frame particle updater `CS:0xA931`) actually use. Swept exhaustively for the byte value `0xFD`, confirming the encodings first against the two known producers (`C6 44 D0 FE` / `C6 44 30 FE` read straight off `CS:0xA9DA`/`0xA9DF`, so the pattern shape is verified, not guessed):

- Every `MOV r8, imm8` encoding (opcodes `B0`–`B7`, all eight 8-bit registers) with `imm8 = 0xFD`: **zero hits** (`MOV AL,0xFD` etc.).
- Every `MOV byte ptr[mem], imm8` (opcode `C6`) addressing form with `imm8 = 0xFD` — absolute, bare `[BX]`, bare `[DI]`, `[BP+disp8]`, `[SI+disp8]`, `[DI+disp8]`, `[SI+disp16]`, `[DI+disp16]`, `[BX+SI]`, `[BX+DI]`, `[BP+SI]`, `[BP+DI]` — **zero hits**, all twelve ModRM shapes.
- All 122 `MOV DI, imm16` loads in the image were enumerated and their targets checked; none points at a fixed memory byte holding `0xFD` the way `CS:0xA549` points at `DS:0xdcfe` holding `0xFC`.

Coverage: 152,384 bytes across the program's 4 initialized code blocks — the same span every other exhaustive byte-pattern sweep in this document covers (8 uninitialized data blocks are skipped, as always, and none of them can hold code). The only three literal `0xFD` bytes anywhere in the image are *reads*, not writes: `CS:0x166B` (an unrelated loop bound inside `FUN_1000_1534`), `CS:0xD7DC` (a step-index compare inside a scripted-sequence world routine, testing a signed cursor against `−3`, unrelated to the damage grid), and the one that matters, next.

**2. Register-copy stores — the shared stampers `CS:0xA860` (2×2) and `CS:0xA8B8` (3×3).** Neither writes an immediate: both do `MOV CL, byte ptr[DI]` once, then copy `CL` into every covered grid cell (`A8B8`'s body was fully re-read here for the first time — it is byte-for-byte the same `CL←[DI]` shape as `A860`, just 3×3 instead of 2×2). So the real question for this path is not "does `0xFD` appear as a literal" but "can `DI` ever point at a byte holding `0xFD` when either stamper runs" — and every caller of both is enumerated, not sampled: `A860` has exactly 3 static callers (`get_xrefs_to`, confirmed complete) — the starburst's fixed `DI=0xdcfe` (always `0xFC`), and two sites inside `FUN_1000_a7b6`; `A8B8` has **zero** static callers and is reached only through the draw-style jump table (`DS:0xdf26` entries 1/2), where `DI` is set by the common projectile mover to the projectile's own record. In every non-starburst case `DI` is a projectile record, and that record's tag byte (offset 0) has exactly one writer in the whole image — the fire-slot allocator's `tag = 1 + slot*9 + subslot*3` (1..25 in shipped use, structurally bounded ≤27) — and exactly one other, which zeroes it on despawn. No arithmetic on that formula reaches anywhere near 253 (`0xFD`).

**The consumer is real, and it is now found.** `CS:0xE5B9`, inside `FUN_1000_e4e2`, is reached from `CS:0xE48D` inside `CS:0xE487` — System A's own pipeline **stage 3**, "descriptor-gated (`[si+0xf]`) special action (attack/leap)" (see *System A has its own movement layer*), gated on `[si+0xf] != 0`. `FUN_1000_e4e2` computes the entity's own damage-grid cell — the identical `SI = 0x16ca + …` formula every other grid consumer uses, with the same nearest-column-but-floored-row split the hero's own event probe (`CS:0x5fab`) uses — then walks a per-class **reach table**: a signed-word offset stream at `DS:0xda08` paired with a `{dx,dy}` displacement stream at `DS:0xda68`, budgeted by `CH = (0x10 − descriptor[+0xf]) & 0xf` ticks off a starting allowance of `0x2f` (47), probing `[grid_cell + reach_offset]` at each step. An occupied cell (any nonzero tag) is normally treated as a found target, and the accumulated `{dx,dy}` is returned to the caller, which arms the entity's attack/leap (`[di+0x16] := 0xa`, a 10-tick windup, `[di+0x25] := 0`). **`CS:0xE5B9` singles out exactly one tag for different treatment: `CMP BL,0xFD / JZ` skips the accumulation and keeps scanning** — a cell tagged `0xFD` is deliberately *not* a valid target, unlike every other nonzero tag (weapon 1–27, or the special sources FC/FE/FF). ⚠️ **Correction — this exclusion is not universal.** `FUN_1000_e4e2` actually runs one of *two* parallel scan loops depending on the entity's own state, and only one of them ever reaches `CS:0xE5B9`; see *`UNKNOWN_e4e2_reach_table` — CLOSED* below for the full mechanism and why it doesn't change the practical conclusion.

**Put together, this is the game's fifth cut feature**, in the same family as the `flame` weapon's null spawn/mover handlers, the unplaced iron chest, the unplaced familiar-chain potions, and the world-4 falling hazard (`DS:0xcfcc` class 3). The tag decoder's `0xFD` branch (`CS:0x93BF`–`0x93CB`, forced zero damage) and this scan's `0xFD` special case were both built to recognize a fourth kind of grid occupant — plausibly something System A's attack/leap logic was meant to detect but path around rather than target (a decoy, a corpse, a friendly) — and nothing in the shipped `GAME.EXE` ever stamps it. Both halves of the mechanism are intact and wired, and permanently unreachable together. `UNKNOWN_e4e2_reach_table` — the class-indexed reach/displacement tables at `DS:0xda08`/`DS:0xda68` themselves, and which System-A classes reference them, are not traced past this.

⚠️ **Tag discipline, deliberately applied.** "No producer" here means every static write mechanism was traced to its complete set of callers and shown to be bounded away from `0xFD` — it is not proof that no runtime bug (memory corruption, an unrelated array's overrun) ever leaves a stray `0xFD` in a projectile record's tag byte or directly in the grid. **To promote to `[PROVEN]`:** a DOSBox watchpoint on `DS:0x16ca`–`0x1CE5` (the grid) for the byte value `0xFD` across a full playthrough would settle it; not run this pass.

### `UNKNOWN_e4e2_reach_table` and `UNKNOWN_hunter_negative_tag` — CLOSED: one global two-ring probe, not per-class tables `[STATIC]`

Both open items rested on a premise the full disassembly of `FUN_1000_e4e2` refutes: **the reach-offset and displacement tables are not class-indexed, or per-entity at all.** `CS:0xE4EE`/`CS:0xE4F4` reset both stream cursors to the same fixed immediates — `0xda08` and `0xda68` — on **every** call, and the caller (`CS:0xE48D`, inside stage 3 `CS:0xE487`) passes no per-class offset into any register beforehand (confirmed by disassembling `CS:0xE487`–`E4E1` in full: `SI` is the group descriptor, untouched before the call). Every System-A entity that reaches this stage scans the *identical* hardcoded pattern; the only thing that varies per entity is how far into it the scan gets to go.

**The 48-word reach-offset table at `DS:0xda08` is a two-ring spiral around the entity's own grid cell**, read directly off the raw bytes and verified by exact arithmetic on all 48 entries (row stride 48 = `0x30`, matching the grid's own documented stride):

| ring | entries | shape (offsets from the entity's own 4×4-cell / 32×32px box) |
|---|---|---|
| 1 | 0–19 (20 cells) | row−1 sweep cols −1..+4 (6) + col−1 strip rows 0..+3 (4) + col+4 strip rows 0..+3 (4) + row+4 sweep cols −1..+4 (6) |
| 2 | 20–47 (28 cells) | row−2 sweep cols −2..+5 (8) + col−2 strip rows −1..+4 (6) + col+5 strip rows −1..+4 (6) + row+5 sweep cols −2..+5 (8) |

20+28 = 48, exactly the table's own size — every entry is accounted for, and the table ends exactly where it should (`0xda08 + 96 = 0xda68`, the displacement table's own base). `CS:0xE4FE`–`E503` computes `CH = (0x10 − descriptor[+0xf]) & 0xf`, the per-scan-tick decrement subtracted from a fixed budget `CL = 0x2f` (47, the same starting allowance this document already recorded). A **larger** `descriptor[+0xf]` (the same field that gates stage 3's entry) gives a **smaller** `CH`, so the scan survives more ticks and reaches further into the spiral before the budget goes negative. **`descriptor[+0xf]` is a reach *depth* into one universal search pattern, not a selector into a per-class table** — which is also the answer to "which System-A classes reference them": none individually; every entity that reaches stage 3 walks the same 48-entry sequence, just to a depth its own descriptor allows.

⚠️ **The displacement stream at `DS:0xda68` does not walk in lockstep with the reach-offset stream, and accumulates at most two hits per call.** Its own 48 pairs (96 words, `da68`–`db27`, bounded exactly — the words immediately following, `0xdb30/0xdb58/0xdba8/0xdba8`, are the already-documented Strategy-3 waypoint pointer table at `DS:0xdb28`) sit un-consumed (`ADD word ptr [0x2a8],AX` with `AX=0`) until the first occupied cell is found. That first hit always reads pair 0 (`[0xda68]`/`[0xda6a]`) cleanly, then sets `AX:=1` (`CS:0xE5C3`/`E5D6`). From then on the cursor drifts forward **one byte per further scan tick** (not one 4-byte pair) until a second hit, whose read lands at whatever byte offset the elapsed tick count left it at — almost never a clean pair boundary. A third or later hit is never accumulated at all: `TEST AX,0x2 / JNZ` (`CS:0xE5BE`/`E5D1`) skips it once `AX` reaches 2. Read exactly as coded, not tidied up: the mechanism only ever cleanly uses displacement pair 0, and a second accumulation, when one happens, reads a data-dependent, usually-misaligned byte offset into the same table.

⚠️ **Superseded — see the closure below.** The paragraph below stops short of checking whether the scan actually returns on a hit; it doesn't, which changes the reachability and severity conclusions. Left in place for the record, not as the current answer.

`UNKNOWN_e4e2_displacement_drift` — **root cause identified, intent still not provable `[STATIC]`.** Re-read the full entry sequence (`CS:0xE4E2`–`0xE585`) fresh rather than starting from the found-handler alone: `AX` is explicitly zeroed once, right before the Loop A/Loop B dispatch (`CS:0xE555 xor ax,ax`), and `DS:0x2a8` is reset to the table base `0xda68` once, at function entry (`CS:0xE4F4`) — both confirmed fresh per call, so the drift can't accumulate *across* calls, only within one 47-tick scan. But **`ADD word[0x2a8],AX` at `CS:0xE5A2`/`0xE57B` runs on every scan tick, hit or miss, not only when a displacement is consumed** — `AX` is doing double duty as both "how many hits found so far" (0/1/2, tested and capped via `TEST AX,2`) and, unintentionally, "how many bytes to advance the displacement cursor this tick." That is a textbook single-variable-reuse bug shape: the cursor should plausibly have advanced a fixed 4 bytes *only* on a hit, via its own dedicated step, not ridden along on the hit-counter every tick regardless of whether anything was found. This doesn't prove authorial intent — nothing in a binary can — but it identifies a concrete, specific mechanical explanation for the drift that "deliberate jitter" doesn't need and wouldn't naturally produce (jitter has no obvious reason to accelerate from a 1-byte to a 2-byte step partway through, or to keep advancing on ticks that found nothing). It can never matter for `0xFD` specifically, since `0xFD` never reaches the grid at all (see above) — this is offered as the closest this binary gets to an answer, not as proof.

⚠️ **`UNKNOWN_e4e2_displacement_drift` — CLOSED this session: reachable in ordinary play, severity bounded, intent retired as unprovable in principle `[STATIC]`.** CLAUDE.md's own open-questions summary of this item ("sits inside an already-proven-dead code path either way … zero port impact") conflated this drift with the separate, genuinely-dead `0xFD`-exclusion finding above. It was never checked directly. Fresh full disassembly of `CS:0xE4E2`–`0xE5E2` this session (both found-handlers, not just the shared tail) settles the one fact that discriminates the two readings: **does the scan return on the first hit, or keep going?**

It keeps going, in both loops — there is no early `RET` in either found-handler:

- **Loop A** (`CS:0xE5D1`): `TEST AX,0x2` / `JNZ 0x1000:E57B` skips accumulation once 2 hits are already banked, but either way falls into `CS:0xE57B` — the identical `ADD [0x2a8],AX; SUB CL,CH; JNS`-loop-back tail a *miss* takes.
- **Loop B** (`CS:0xE5B9`): same shape — the `CMP BL,0xFD`/`JZ` and `TEST AX,0x2`/`JNZ` cases both jump to `CS:0xE5A2`, the miss path's own tail.

Both loops terminate **only** when the tick budget underflows (`SUB CL,CH` at `E57F`/`E5A6` going negative, caught by `JNS` failing) — after up to 48 ticks, never after a particular hit. So **the drift fires whenever an ordinary (non-`0xFD`) scan finds a SECOND occupied cell before its budget runs out — nothing to do with the dead tag, and not a rare case.** Every grid stamper this document already characterizes covers ≥4 cells (`CS:0xA860`'s 2×2, `CS:0xA8B8`'s 3×3, the familiar's 4-cell `C2B6`), sitting inside ring 1's 20 cells at 1-cell range from the scanning entity's own box — a stamped footprint next to an attacking entity routinely supplies 2+ of those 20 probed cells, both walked in the SAME sequential sweep (`row−1`, then `col−1`, then `col+4`, then `row+4` — see the reach-table breakdown above). *Finding* two hits is therefore the ordinary case, not an edge case.

⚠️ **But commonness and severity are anti-correlated — the severity bound below inverts the naive read.** A single compact footprint's two probed cells land on nearby probe *ticks* (frequently adjacent, since a contiguous 2×2/3×3 stamp sits within one run of the sequential sweep), which drifts the second read by only 1–2 bytes — a small, one-word-shifted misalignment (reading pair 0's own `dy` half as if it were a fresh `dx`), not the worst case below. The LARGE drift (tens of bytes) needs the two hits spread far apart in scan order — near-opposite ends of the 48-cell spiral — which requires two cells from *separate* stamps (not one compact footprint) landing early and late in the walk. So: **the common two-hit case is a small, near-adjacent misread; the severe, far-drifted misread is the rarer shape**, not the other way around.

**Both hits are summed, not "first hit wins."** `CS:0xE5C4`–`E5CF` (Loop B) and `CS:0xE5D6`–`E5E2` (Loop A) each do `ADD BP,word[SI]` / `ADD DX,word[SI+2]` against a running accumulator, not an overwrite — so when 2 hits occur, the returned `{CX,DX}` (`MOV CX,BP` at `E5AA`) is hit 1's clean pair-0 read **plus** hit 2's drifted, usually-misaligned read, summed before the caller's `×2`/clamp/blend into the entity's velocity.

**Severity is bounded statically, no live trace needed.** What matters for "does this ever read out of bounds" is the cursor value *at the moment of a read*, not wherever the cursor ends up after the whole scan finishes (nothing reads the table again once 2 hits are banked, even though the cursor keeps ticking upward under it). Only two reads ever happen: hit 1's, always at cursor 0 (clean — the doc already established this above), and hit 2's, at whatever the cursor drifted to in between. That drift is maximized by the widest possible gap between the two hits: hit 1 on the very first tick (cursor 0, clean) and hit 2 on the very last tick the budget allows. At the shallowest decrement `CH=1` (the deepest `descriptor[+0xf]` allows), the scan runs a maximum of 48 ticks (`CL=0x2f`=47, decremented by 1 each tick, `JNS` keeps looping while the result stays ≥0 — 48 iterations before it goes negative). With hit 1 on tick 1 and hit 2 on tick 48, 46 ticks separate them, each advancing the cursor by 1 byte (the post-hit-1 step, `AX=1`) before hit 2's own read: cursor at hit 2's read = 1 + 46 = **47**. The displacement table spans exactly 192 bytes (`0xda68`–`0xdb27`, 48 × 4-byte `{dx,dy}` entries), with the already-documented Strategy-3 waypoint table starting immediately after at `0xdb28`; a 4-byte read at offset 47 needs up to offset 50, both comfortably inside the 192-byte span. 47 ≪ 192: the drifted read always lands well inside the displacement table itself — a misaligned read of a `dy`-as-`dx`-shaped entry, never an overrun into the waypoint table or anything else adjacent.

**One loose thread, noted but not weighed into the closure:** immediately before the Loop A/B dispatch, `CS:0xE54C`–`E553` computes `DI := CH*4` (the scan-depth budget, ×4) and then never reads `DI` again anywhere in the function — it's overwritten by the entity-pointer restore at `CS:0xE5AC` before return. `CH*4` is a *depth*-scaled quantity, not a *per-hit* step of 4 the way the displacement cursor would need — a different quantity from what the drift would need to be fixed, not a near-miss of it — so this is at most "there's an unused computation nearby," not evidence about the drift's own cause. Flagged for completeness, carries no weight below.

**What this closes, and what it doesn't.** Reachability and severity are now settled `[STATIC]`: this fires in ordinary shipped play (not confined to the dead `0xFD` path — that remains a separate, genuinely dead sub-feature of the same function), and its worst-case effect is a misaligned-but-in-bounds table read feeding into real attack/leap steering, not memory corruption. CLAUDE.md's prior "zero port impact" framing is corrected by this entry. Authorial intent — whether this was a real mistake or deliberate — is retired here as **unprovable in principle**, not as merely unresolved: it is a question about the missing author's state of mind, and no further disassembly, live trace, or shipped-data census can move it. `gods-web`'s own `stageAttack` (`entity-a.js`) already faithfully reproduces the drift *mechanism* (cursor start, unconditional per-tick advance, first-hit-clean/second-hit-drifted shape) and runs it live in that port's tick pipeline — but it diverges from the original in the actual *outcome* two ways, both confirmed by reading its source this session: it `break`s the scan once `found.length >= 2` rather than continuing to the tick budget (harmless — nothing after the 2nd hit is ever read or applied in the original either), and its returned steering delta uses only `found[0]` (`entity-a.js:833`–`834`), never summing in `found[1]`. So the drifted second-hit read is computed and tracked (available for inspection) but never actually reaches the port's velocity, unlike the original, which sums both hits into the value it blends into the entity's velocity. Noted here for a future `gods-web` pass, not part of this closure.

⚠️ **Correction to the tag_fd closure above: the `0xFD` exclusion at `CS:0xE5B9` only fires on ONE of two parallel scan loops.** `CS:0xE557`–`E567` branches on entity fields `[di+0xa]` and `[di+0x24]` (the latter is the already-documented sticky per-entity strategy-mode byte from `CS:0xE6E4`): when **both** are nonzero the scan runs the **Loop A** body (`CS:0xE569`–`E583`), whose grid probe (`CMP byte ptr [BX+SI],0x0` at `CS:0xE576`) never loads the tag byte into any register at all — it tests the memory operand directly against zero — and whose found-handler (`CS:0xE5D1`) has **no tag-value check whatsoever**: any nonzero cell, `0xFD` included, counts as a hit. The `CMP BL,0xFD` exclusion lives only in **Loop B**'s found-handler (`CS:0xE5B9`, reached from `CS:0xE59C`'s `MOV BL,byte ptr [BX+SI]`), which runs when either field is zero. So the tag decoder's dead `0xFD` branch is guarded against being *targeted* only in the non-sticky case — an entity already committed to a strategy (Loop A) would treat a hypothetical `0xFD` cell as an ordinary target. This doesn't change the practical conclusion (nothing in shipped `GAME.EXE` ever writes `0xFD` to the grid, so neither loop ever actually encounters one), but it means "the exclusion" is not a single, uniform piece of code — it's specific to the less-common branch, and a description that doesn't name Loop A overstates how deliberately the cut feature was fenced off.

**The caller, `CS:0xE487`–`E4E1`, turns the returned `{CX,DX}` into a velocity delta, not a raw position** — new material, not previously documented. On a nonzero result (`OR AX,DX` / `JZ` rejects an all-zero return) it arms the windup (`[di+0x16]:=0xa`, `[di+0x25]:=0`, both already documented), doubles `CX`/`DX` (`SHL ..,1`), clamps each to `±descriptor[+0xc]` (a **new** System-A group-descriptor field, signed byte, sign-extended and negated into a floor `BX = -descriptor[+0xc]`), then **adds a baseline velocity pair from `DS:0x298`/`DS:0x29a`** before writing the sum into the stage-2 velocity fields `[di+0x12]`/`[di+0x14]` — exactly the fields this document already names as System A's own accelerate-toward-goal output, confirming stage 3 "may override the velocity" by *blending into* stage 2's result rather than replacing it outright.

⚠️ **`UNKNOWN_DS_0298` — CLOSED `[PROVEN]`.** The writer is `CS:0xE001` itself, the pipeline dispatcher: right after stage 1 (`CALL 0xE6E4`) and before stage 2 runs, `CS:0xE017`–`0xE021` does `DX=[di+0x12] / [0x298]=DX` then `DX=[di+0x14] / [0x29a]=DX` — a **snapshot of the entity's own velocity fields, taken before stage 2 overwrites them this tick.** So the "baseline pair" stage 3 blends into isn't a separate constant at all — it's the entity's *own* velocity as it stood at the start of the tick, cached in a global scratch pair specifically so stage 3 (which runs after stage 2 has already updated `[di+0x12]`/`[di+0x14]`) can add its steering delta on top of the pre-stage-2 value rather than the post-stage-2 one. A port that has stage 3 read the live (already-updated) velocity fields instead of this cached snapshot will double-apply stage 2's own contribution on any tick both stages fire.

⚠️ **`UNKNOWN_sysA_descriptor_0c` — CLOSED (shipped-data census) `[PROVEN]`.** Decompressed all 8 `PALFILS.0{A,B}{1-4}` files (`blast.py`) and read the System-A descriptor table (`+0x0D58`, stride `0x16`, live when `+0x00 != 0`) at field `+0xc` as a signed byte, for all 74 live records: values are **`{1:8, 2:12, 3:11, 4:7, 5:8, 6:14, 7:4, 8:5, 10:5}`** — every one strictly positive (1..10), never 0, never negative, and clustered low (median 4, mode 6). So in shipped play the per-class steering-step cap this field sets is always a small positive value; the "signed, sign-extended and negated" handling in the code is defensive generality the data never actually exercises. Worlds 1, 2 and 4 have byte-identical value sets between their `A`/`B` sublevels (expected, since sublevels of the same world share one entity roster); only world 3's sublevels diverge (`0A3`'s tail `6,8,10,6` against `0B3`'s `4,3,6,6`).

⚠️⚠️ **Correction, 2026-09-28, `[PROVEN]` live — the stored key is NOT the sprite id; it is the box's right edge.** The paragraphs below read `CX` at the *call* into `CS:0xA9E4` and missed that the clip prologue overwrites it before the append: `CS:0xAA30` sets `CX = [0x1e4] + BX` (the box's bottom) unless the box is clipped at the top, and `CS:0xAA69` then sets `CX = [0x1e2] + AX` (its right edge, less 0x150 past the right side) unless it is clipped at the left. So for any creature not clipped at the left the key is the rounded screen x + the box width; the caller's `CX` survives only a top-and-left clip. The record's x/y are likewise the rounded, **clipped** screen position, and a box that clips away entirely is never appended (the `CS:0xAB3B` exits precede `CS:0xAA86`). Live (DOSBox, `PJOYL1` attract, `DS:0x343` poked to 0, execute breakpoint at `CS:0xAA9A`): a 32-wide box at world (420, 832), camera (256, 864), caller `CX` = 32, was stored as `{168, −16, 200}`. So the hunter (and the familiar) home on the creature reaching furthest right on screen. The max-scan reading below stands. **`gods-web` also never homed at all:** its scanner pushed `{x, y}` with no key, so `pickTarget` always returned `null`; fixed with `collision.js`'s `targetEntry`, and `stepHunterArray` now adds the camera at pick time (`CS:0x9E5D`).

**`UNKNOWN_hunter_negative_tag` closes alongside it, for an unrelated reason: the hunter's target-list "key" is not a distance, an HP value, or anything derived from the damage-grid tag ladder at all — it is the entity's own currently-computed SPRITE ID.** `CS:0xAA8D` (the target-list append, gated on `DS:0x343`) writes `{AX, BX, CX}` unconditionally for every creature scanned this frame, and `CX` at that point is untouched since whichever of two identical mechanisms last set it, confirmed by full disassembly of both:

- **System B** (`FUN_1000_edb8`, `CS:0xEDD3`): `CALL AX` into the `DS:0xdbe0` movement-mode handler (walk/fall/hop), whose tail — confirmed on all three RET paths of the walk-left handler at `CS:0xF11F`–`E4` (`CS:0xF156`, `F16D`, `F1E4`, each immediately preceded by `CALL 0x1000:F0AE`) — ends by calling the already-documented sprite-formula routine `CS:0xF0AE` (`sprite = class_base + MODE_ANIM[mode] + frame`), which leaves the computed sprite id in `CX`. `CS:0xEDD5` stores it to `DS:0x8`; the subsequent `CALL 0x1000:EF01` (the steal-and-carry mechanic) leaves `CX` untouched on every early-exit path (confirmed by reading `FUN_1000_ef01` in full — its common case is `CMP [0x3cd],2 / JNZ RET` before touching any register), so `CX` reaches `CS:0xEDF4`'s `CALL 0x1000:FF93` → `CS:0xA9E4`'s `CALL 0x1000:AC59` unchanged.
- **System A** (`FUN_1000_e001`, `CS:0xE0AA`): the mirror image, one register-width instruction apart — `CS:0xE094 CALL 0x1000:E199` (System A's own already-documented sprite-formula resolver) leaves the class sprite base in `CX`, `CS:0xE09E` stores it to the same `DS:0x8` scratch word, and `CS:0xE0AA`'s `CALL 0x1000:FF93` passes it through the identical way.

Since `FUN_1000_ff93` itself never touches `CX`/`DX` (confirmed by its full disassembly), both entity systems hand the hunter's target list a **sprite id**, not a priority score. Sprite ids are always small positive values (every documented class base is in the low hundreds; the highest, `always+objects = 450`, plus a bounded `MODE_ANIM`/frame offset, stays far under the 16-bit sign boundary), so the theoretical worry behind the item's name — a *negative* key reaching the signed "keep the smaller one" comparison at `CS:0x9E36` (`cmp dx,[si] / jnl`) — cannot arise from legitimate class data, and the key never touches the grid's tag decode (`CS:0x9320`) at all. What the bytes actually show is odder: **the hunter homes on whichever on-screen creature happens to have the lowest computed sprite index this frame** — an authoring-order artifact of the sprite atlas layout, not a distance, threat, or health heuristic.

⚠️ **Correction: "lowest" above is wrong — it's the LARGEST.** A fresh, independent full disassembly of `CS:0x9E36` (24 instructions, done again this session without relying on the prose above) confirms what a later correction elsewhere in this same document (*Mover 4 — hunter*, below) already found, but which was never propagated back up to this paragraph: the running-best `DX` seeds at `0xFFFF` (signed −1, lower than any real key can be) and `CMP DX,[SI]` / `JGE 0x1000:9E45` **skips** — keeps the OLD best, does not replace — exactly when `DX >= [SI]`; it replaces only when `DX < [SI]`, walking the running best UP, never down. **The hunter homes on the on-screen creature with the LARGEST computed sprite index this frame, not the lowest.** Read "lowest"/"minimum" as "largest"/"maximum" everywhere above; see `UNKNOWN_hunter_key_intent` below for what this unlocks.

`UNKNOWN_hunter_key_intent` — **CLOSED: the question it originally posed (deliberate cheap tie-break vs. abandoned distance calculation) is now answered `[STATIC]`.** The earlier "narrowed, not fully closed" pass argued from its own mis-stated minimum-scan reading; corrected above to a maximum-scan, the fix itself supplies the missing evidence.

**The seed alone is structural proof of which direction was intended.** `DX` starts at `0xFFFF` (signed −1) — a value no real key (sprite ids are always non-negative) can ever be smaller than. Under a MINIMUM-scan reading, nothing could ever beat −1 downward, `CS:0x9E36` would fall straight through to `CMP DX,0 / JS` on every call, and the routine would never select a target at all — the mis-stated reading describes code that could not do the one thing this routine is for. Seeding at the lowest-possible sentinel only makes sense if the comparison is built to walk the best *upward* from it, which is exactly what `CMP DX,[SI] / JGE 0x1000:9E45` does. The author's own choice of seed already tells you which direction their own comparison ran; nothing here needed to be inferred from the branch mnemonic alone.

**The post-hit zero-out is a second, independent piece of evidence pointing the same way — correctly scoped.** `CS:0x9E6C` (`MOV word ptr DS:[BP+0x0],0x0`) zeroes the JUST-PICKED record's own key field after each hit; the doc already reads this as "so a second hunter shot searching the same list this tick scores that creature worst rather than re-picking it — a natural spread-across-live-targets side effect." Precisely: a zeroed key loses to *any* competitor with a positive key (`0` beats only the `−1` seed, not a live creature), which is what makes it prefer an unclaimed target whenever more than one creature is on screen — not an absolute guarantee against ever being re-picked (a lone remaining creature, or an all-zeroed remainder, would still win). Under the old, mis-stated MINIMUM-scan reading, this same zero-out would have been **self-defeating**: zeroing to the lowest legal value would make that creature win every subsequent MIN comparison, re-selecting the SAME target over and over — the opposite of "spread." So the search direction and the post-hit side effect are not two independent choices that happen to coexist; they are two halves of one coherent "cycle fire across live targets" mechanism, and only the corrected (maximum) reading makes both halves compose correctly.

Between them, the seed and the zero-out are stronger evidence for **deliberate, finished design** than "no dead arithmetic" alone (the prior pass's whole basis): a stub or an abandoned distance calculation has no reason to seed itself for a specific search direction *and* carry a disqualification side-effect that only works in combination with that direction. What stays permanently outside what this binary can answer is a narrower question this correction surfaces, not the original one going unresolved: **why sprite id specifically was chosen as the ranking key** — a deliberate value judgement (a later-drawn or more-advanced-animation creature counted as more "significant"?) or simply the cheapest value already sitting in a register at the point this was written. That residual is retired here as unprovable in principle — the same disposition given to `UNKNOWN_e4e2_displacement_drift` — because it is a question about the missing author's reasoning, not about the bytes, and no further disassembly or shipped-data census can move it.

⚠️ **A theoretical hazard, checked and closed negative.** `CH = (0x10 − descriptor[+0xf]) & 0xf` is **zero** when `descriptor[+0xf]` is exactly `0` or `0x10` (16), which would make `SUB CL,CH` a no-op every tick and the scan never terminate. `0` is already excluded by the stage-3 entry gate; a shipped `16` is not ruled out by the code, so this was checked directly against data: `blast.py`-decompressing all 8 `PALFILS.0{A,B}{1-4}` files and reading `DS:0x9d60 + rec*0x16 + 0xf` for every record whose own `+0x0` (entity count) is nonzero reproduces this document's own already-published liveness census exactly (`9/9/10/9/9/9/10/9` live of 50 per file — the same figures recorded under *the enemy sprite*), confirming the offset scheme, and the 74 live `+0xf` values are `{0, 6, 9, 10, 12, 13, 14, 15}` — **maximum 15, and 0 only ever appears on non-participating descriptors that never reach stage 3 in the first place.** No shipped System-A descriptor can hit the `CH=0` case.

⚠️ **A workflow lane's own conclusion was refuted by its verifier and is worth not re-deriving:** "System-B creatures are one-touch kills". No instruction decrements entity `+0x08` in memory — but `0xFFA2` loads it into `BP`, `0xA9E4` modifies **BP in place**, and `0xFFB4` writes it back. Creature HP does deplete across frames, and projectile kills award score by the same path as contact kills. `[WF]` — the register round-trip matches the `bp` in/out convention this document already documents for `0xac59`, but the score path itself was not re-read here.

### Three more movers, and an engine feature hiding inside one `[PROVEN]`

**Mover 1, `CS:0x9d97` — fireball.** The common mover plus a per-projectile Y accumulator that *accelerates*:

```
9DBF  si = 0xdefc
9DC2  dx = [di] ; sub dl,[0x340] / dec dl    ; -> index within the slot, 0..8
9DCA  shl dx,1 / add si,dx
9DCE  add bx,[si]                            ; add the accumulator to Y
9DD0  inc word [si]                          ; AND BUMP IT
```

`DS:0xdefc` is **nine words** — one per projectile record — sitting exactly `0x12` bytes below the velocity table at `0xdf0e`, which is what pins its size. Because the entry is incremented every tick the drop grows by one each frame rather than staying constant; that is the fireball's arc. It also calls the terrain-aware stamp `0xa7b6` **directly** (no draw-style dispatch) and re-tests the tag afterwards, so a shot the wall just consumed is not also drawn.

**Mover 4, `CS:0x9ef7` — hunter, and it does home.** But the interesting part is not the weapon:

> ⚠️ **The target list is built by the COLLISION SCANNER, not by the weapon.** During the per-frame creature scan, `CS:0xAA8D` appends `{x, y, key}` — six bytes — to a list growing from `DS:0x8c54` (`mov word [0x1d2],0x8c54`, `CS:0x0218`) and bumps the count `DS:0x33c` (initialised to `0xFF` = −1 at `CS:0x021E`, so N creatures leave it at N−1). `CS:0x9e36` then walks that list and takes the entry with the **largest** key.
>
> ⚠️ **Correction, found porting this mover.** This line used to say "the smallest key… `cmp dx,[si] / jnl` keeps only a strictly smaller one" — a misreading of the mnemonic that survived uncorrected. Traced with a concrete example rather than from the mnemonic alone: `dx` (the running best) seeds at `0xFFFF` (signed −1, the lowest value any real non-negative key can beat), and `JNL`/`JGE` **skips** (keeps the OLD best, does not replace) exactly when `dx >= [si]` — so it replaces only when `dx < [si]`, walking the running best **UP** toward the largest key, never down. Walked by hand against keys `[5, 3]` in scan order: record 1 (key 5) beats the −1 seed and becomes best; record 2 (key 3) then loses (`5 >= 3`, skip) — final best is 5, not 3. `CS:0x9e6c mov word [bp],0` then zeroes the WINNING record's own key, so a second hunter shot searching the same list this tick scores that creature worst rather than re-picking it — a natural "spread across live targets" side effect.

So the hunter can only chase creatures the scan actually visited **this frame**, and ordering matters: run the mover before the scan and it homes on last frame's creatures. That also gives the damage grid a second consumer — it is not only a hit test.

⚠️ **For this mover `dir` is a PACKED SIGNED VELOCITY PAIR, not a table index — and the halves are the reverse of the obvious:**

```
9F3E  cx = [di+6]
9F41  dl = cl (LOW) ; cl = ch (HIGH)
9F46  al = cl / cbw / cx = ax     ; cx = sign_extend(HIGH)
9F4B  al = dl / cbw / dx = ax     ; dx = sign_extend(LOW)
9F51  ax += cx                    ; X += the HIGH byte
9F53  bx += dx                    ; Y += the LOW byte
```

**X comes from the high byte, Y from the low one.** The debris spawner at `CS:0xA039` reads the same word the same way round, which corroborates it. Reading them the natural way mirrors every hunter shot diagonally. This is also why a `dir` of `0x2f` is meaningful to one mover and meaningless to another — **`dir` is per-mover, and there is no global encoding**.

The turn rate is a third use of the pickup count: `CS:0x9f12` computes `[si+8] − [si+6] − 2` clamped to `[1, 2]`. Note the `− 2`: the rate only rises at **four** extras, well past the two that already max the volley — so `+0x08` keeps paying after the projectile count stops. It now drives **volley size, damage per hit, and turn rate**.

`UNKNOWN_projectile_movers` narrows to `0xa678` (magic axe) and the tail of `0xa058` (time bomb).

### Mover 3, `CS:0xa058` — the time bomb, and `dir` is a FUSE `[PROVEN]`

⚠️ **For this mover the `dir` word is not a direction at all — it is a countdown**, decremented once per tick in the shared tail:

```
A261  dec word [di+0x6]
A06B  cmp dx,0 / jns fly / jmp 0xa273      ; negative -> leave the flight path
A273  cmp dx,0xffff / jz 0xa27b            ; EXACTLY -1 is the trigger
A27C  sfx 0x1022 ; si = 0x8eda ; cx = 0x0a   ; ten fragments
```

⚠️ **CORRECTED, a later session (a Ghidra re-read while wiring this mover into `gods-web`'s `Arsenal.step()`).** This used to read "sfx 0x22" — unlike every other bare-low-byte sfx citation this project has already corrected (`0x1c`→`0x041c`, `0x1d`→`0x21d`, `0x09`→`0x209`), that one had never actually been re-checked against a fresh `MOV AX,imm` read; it was taken at face value and then repeated by `gods-web`'s own `audio-bus.js` as a disclosed non-wire. `CS:0xA27C` is `mov ax,0x1022`: the FULL word passed to `call 0x22ca` is **`0x1022`**, not `0x22`. `gods-web` now wires this id, and its own time-bomb mechanic (spawn handlers 8/9, plus the mover here) end to end — see `projectiles.js`'s `stepTimeBomb`/`spawnTimeBombVolley` and `docs/consumables-and-treasure.md`'s "Entries 8/9" section. That same pass also found the mover's OTHER sound: the landing/bounce thud is `sfx 0x0609` (`CS:0xA165`, wall bounce; `CS:0xA1D7`, the tick after landing) — already known from this document's own bounce-table cross-check, just not previously tied to a sound id.

⚠️ **Also corrected the same session**: this section's "vx decays every 4th tick" (`CS:0xA130`) used to imply its own independent schedule. A full disassembly of the whole mover (`CS:0xA058`-`0xA24D`) shows the vx-decay gate (`CS:0xA129`/`0xA176`) reads the SAME mutated register the gravity gate (`CS:0xA0A3`) already left at `(fuse + 2) & 3` — gravity and vx-decay fire on the IDENTICAL ticks, not offset ones.

The spawn handler seeds `0x2f` = **47 ticks ≈ 3.1 s at 15 Hz** — a literal time bomb. Only exactly `−1` detonates; anything more negative takes the `0xa326` path instead. Sprite is `0x153 + (fuse & 3)`, and `0x153` = 339 = **`PINNED_SPRITE[1]`**, the time bomb's own descriptor — a second routine agreeing with the pinned table without reading it.

> **This settles `dir` for good: it has NO global meaning.** The common mover uses it as an index into the 6-entry velocity table; the hunter unpacks it as two signed bytes (X in the high half); the time bomb counts it down. `0x2f` is a 3-second fuse in one mover and out of range in another. A port with one `dir` helper is wrong twice over.

Flight uses the globals `DS:0x1c8` (vx), `0x1ca` (vy), `0x1cc` (state) rather than per-projectile storage — safe only because the time bomb's max-shots is 1.

⚠️ **The despawn is real but its site is still unlocated — confirmed live, contradicting a same-session static read.** A full static disassembly of this mover's own body (`CS:0xA058`–`0xA420`, every instruction) found no write that clears `[DI]` (the record's own tag) anywhere — only the shared globals above and the ten-fragment array at `DS:0x8eda` (a separate, 10-byte-stride array; its own despawn, `CS:0xA41C`, only ever touches a fragment record... ⚠️ WRONG, corrected by ranked item 39: `CS:0xA41C` writes `[DI]`, the weapon's OWN record, and IS the despawn). That reading was reported as "no despawn found for the time bomb" in this session's earlier pass.

**A live DOSBox session then refuted the "never" framing directly.** Mounting this directory, launching `gods`, patching the hero's slot A to weapon 1 (`DS:0xdd10`) with a freshly-zeroed 144-byte area, and firing: the record's `dir` field (`DS:0xdd14`) reached exactly `0xFFFE` (−2) — the identical frozen post-detonation value the static trace predicts (`CS:0xA2D8`'s one extra `DEC` past the `−1` trigger) — and the record's **own tag (`DS:0xdd12`) read back as 0**, not the nonzero nothing-ever-clears-it value the static pass concluded. So something does clear it. The likely site is the far call at `CS:0xA2A8` (`CALLF [BP+0]`, `BP:=0x52e2` — a call into a different code segment, not traced this session) reached from the detonation sequence, or a caller-side path outside this mover entirely; neither was located.

**Whether a second throw then succeeds was NOT settled.** With the tag reading 0 and the record group's other two tags also 0 (satisfying the documented group free-test), a second fire attempt — tried several times, including with generous (1.5 s+) press/release margins to rule out the input latch (`DS:0x351`) — never produced a new live record. But this negative sits on a confounded test: the weapon was armed via a raw memory patch (the slot word plus a manual area-clear) rather than through the real pickup routine (`FUN_1000_94a7`), and on two earlier, less-careful attempts in the same session, firing this hand-armed weapon outright reset the slot to `0xFFFF` (unequipped) — a side effect a genuine pickup-and-fire sequence has no documented reason to produce, and which did not recur once the area was cleared, pointing at missing pickup-side state rather than the mover itself. **`UNKNOWN_timebomb_refire` — CLOSED `[PROVEN]` live in DOSBox (ranked item 39): yes, one pickup throws repeatedly, one bomb at a time.** The despawn site this note couldn't find is **`CS:0xA41C mov word [di],0x0`**. The static pass above misattributed it to a fragment record, but `DI` is the bomb's own record for the whole post-detonation path (pushed and popped around both loops). It runs on the first tick on which the live count `BP` is 0, counting fragments (`DS:0x8EDA`, 10 × 10 bytes, live while `+8 ≥ 0`) plus smoke puffs (`DS:0x8F3E`, 7 × 6 bytes, live while their counter is in `0..6`).

- **Fragments.** `CS:0xA289` sets all 10 fragments dead at detonation. Only the far call at `CS:0xA2A8`, taken when the weapon has extra pickups (`[si+8]−[si+6] ≠ 0`), can revive them. That call was not traced.
- **Smoke.** `CS:0xA2DC`–`0xA2FA` keeps the last `n = extra + 2` puffs (at most 7) and disables the rest (counter `−10000`). The kept counters start at `0, −2, −4, …`.
- **Hold.** A plain pickup therefore frees the record on tick `2(n−1)+7 = 9` after the detonation tick.

**Live, with the weapon armed through the real pickup routine** (`FUN_1000_94a7`, `BX=DX=1`, reached by temporarily retargeting the `CALL` at `CS:0x01F2`; it landed in slot B, `DS:0xDDA2`), and a write watchpoint on the record tag `DS:0xDDA4`:

1. The first throw wrote tag 10 (spawn handler, `CS:0x9A6E`).
2. After detonation (`CS:0xA27B`), the tag cleared at `CS:0xA41C` with `DI=0xDDA4` and `BP=0`. At that instant, every disabled puff's counter had advanced exactly 10 times (`−10000 → −9990`), and the two kept puffs read `−99`/`−97`: detonation tick + 9, as predicted.
3. A second fire spawned into the same record again (tag 10), with the weapon still held. A third throw repeated the whole cycle.

The weapon is not consumed. The earlier failed refire came from the hand-patched armament, as that note already suspected. `gods-web` now holds the record for `timeBombHoldTicks(extra)` after detonation instead of clearing it at once (`projectiles.js`/`hero-fire.js`). Fragment revival for `extra > 0` stays unmodelled and is disclosed.

(Original open-question text, now resolved:) **UNKNOWN_timebomb_refire** — does the shipped game let a player throw a second time bomb from the same pickup, and if so, what clears the record — is open, narrowed to "somewhere reachable from `CS:0xA2A8`'s far call or the pickup path `FUN_1000_94a7` sets up that this session's synthetic armament didn't reproduce," not resolved.

⚠️ **Updated, a later session: the time bomb is now wired end to end in `gods-web` (spawn handlers 8/9, the mover, both sound ids), but `UNKNOWN_timebomb_refire` itself is still open, deliberately not fabricated.** `stepTimeBomb` still returns `status: 'spent'` without clearing `p.tag` on its own — that part of this note stands: the real despawn site (`CS:0xA2A8`'s far call, or wherever `FUN_1000_94a7` clears it) is still unlocated, and guessing at "clear it once spent" would invent a mechanism this project never actually found. What changed: `Arsenal.step()` (`hero-fire.js`) now clears the record's tag itself the instant it detonates (`status === 'explode'`, not `'spent'`) — a disclosed, one-shot workaround to stop `BOMB_DETONATE_SFX`/the fragment count from re-firing every tick forever, not a claim about what the original's own clear site does or when. Whether the original then lets the SAME weapon be re-armed is exactly as unsettled as before; this port currently cannot either way (nothing resets `s.bombState` except a fresh throw, and the allocator needs the sub-slot's records to read empty to free it) — the same practical answer as before this pass, arrived at for a different, disclosed reason.

| | |
|---|---|
| gravity | `A0A8 inc [0x1ca]` capped at **4**, and only when `(fuse + 2) & 3 == 0` — a *stepped* fall, and a **third** distinct gravity rule |
| vx decay | `A130/0x176 dec/inc [0x1c8]` toward zero — ⚠️ CORRECTED: shares gravity's OWN gate above, `(fuse + 2) & 3 == 0`, not an independent 4th-tick counter |
| wall | `A16C neg word [0x1c8]` — **negates**, unlike the axe's fixed ±4 |
| land | `A234 and bx,~0xf` ; `[0x1ca] = 0` ; `[0x1cc] = 0x64` |

⚠️ Its wall probe rounds x with **`add cx,0xf`** (`CS:0xA139`) — neither the `+8` the terrain-stop path uses nor a plain floor. Three different roundings now live in this subsystem.

⚠️ **Expanded, a later session (full disassembly of `CS:0xA058`-`0xA24D`, not just the previously-cited fragments, while wiring `gods-web`'s `Arsenal.step()`):** the `+0xf` rounding applies moving RIGHT only (`CS:0xA139`); moving LEFT (`CS:0xA181`-`0xA186`) skips it and floors plainly — a FOURTH rounding, not a third, and it differs by direction within this ONE mover. The wall probe (`CS:0xA158`/`0xA15D`) then tests BOTH the probed cell and the cell one row below it — a wall or an unsupported ledge both bounce it, playing `sfx 0x0609`. The ordinary per-tick GROUND test (`CS:0xA1F0`-`0xA248`, distinct from the wall probe above) lands when the cell below is solid and the current cell is not, or — only in the right half of the X sub-tile — when the diagonal down-right neighbour is solid and its same-row neighbour is not (the same "which corner" shape `docs/entity-ai-pathfinding.md`'s pathfinder and the magic axe's own `axeWallAt` already use elsewhere). Landing itself is silent; the thud (`sfx 0x0609`) plays the FOLLOWING tick, when the landed sentinel (`[0x1cc] == 0x64`) transitions to phase 0. A THIRD, more elaborate branch (`CS:0xA0B9`-`0xA0F1`) runs only on the specific tick the bomb's Y crosses a tile-row boundary, testing two rows below plus its own separate diagonal case — `gods-web` discloses this one as unmodeled (see `projectiles.js`'s `bombGroundAt`) rather than reproducing an edge case reachable on only one specific tick. Also newly found: a per-bounce-phase repeat of the same thud, gated on a byte table at `SS:0x5450` — in the STACK segment, not the code/data segment every other cited table in this project lives in, so its live contents aren't statically recoverable from the EXE image the way `DS:0xdf2c` below is; also disclosed as unmodeled.

**`DS:0xdf2c` is a 24-byte signed Y-delta table — the damped settling bounce after landing**, indexed by `DS:0x1cc` and reset past 23:

```
-4 -3 -2 -1 0 1 2 3 4 | -3 -2 -1 0 1 2 3 | -2 -1 0 1 2 | -1 0 1
```

Four arcs of falling amplitude (4, 3, 2, 1), so the bomb visibly settles rather than stopping dead.

⚠️ **Correction, 2026-09-28 — the mover splits on vx, and the "third branch" is the only landing a thrown bomb has** `[STATIC]`, ported (`gods-web` `stepTimeBomb`). Read in full, `CS:0xA094` branches on `[0x1c8]`:

| vx | `[0x1cc]` | what runs |
|---|---|---|
| ≠ 0 (`A09E`) | any | gravity on the `(fuse+2)&3` gate; if `y+vy` crosses a 16-px row, test the cells at the **old** (x, y): two rows below solid and one row below open, or (x & 0x1f ≥ 0x10) the same pair one column right. That lands at once (`A0F1`): y = (y+vy) & ~0xf, x unmoved, vx = vy = `[0x1cc]` = 0, **thud now, no settling bounce**. Otherwise move, decay vx, and run the wall probe. |
| 0 | < 0 (`A1EC`) | y += vy with **no** gravity step, then the ordinary ground test above: land silently into `0x64` |
| 0 | 0 | at rest, nothing moves (`A191`) |
| 0 | `0x64` (`A1D7`) | thud, y −= 4, `[0x1cc]` = 1 |
| 0 | 1..23 (`A194`) | thud when `SS:0x5450[n]` ≠ 0, y += `DS:0xdf2c[n]`; after n = 23, `[0x1cc]` = 0 (rest) |

So the ordinary ground test never runs while a bomb is still moving sideways, entry 0 of `DS:0xdf2c` is never read, the bounce nets +4 (undoing the landing tick's −4), and the bomb then rests; it does not cycle the table. `SS:0x5450` **is** in the image (file `0x249B0`; the SS base is file `0x1F560`, the same base `SS:0x5024`'s world-4 body-part table was read from): 24 bytes, nonzero only at 9, 16 and 21, the first step of arcs 2–4. The statements above that the row-crossing branch is a rare edge case, and that `SS:0x5450` can't be read from the EXE, were both wrong.

**All six movers are now decoded.** `UNKNOWN_projectile_movers` is CLOSED.

### `UNKNOWN_hunter_turn` — CLOSED: the steering, the spawn handlers, the stamp, and why the tag is born negative `[PROVEN]`

The steering itself, past `CS:0x9f5b`, is a per-axis accelerate-toward-goal with a fall-through quirk:

```
9F61  cmp ax,[ss:0x420] / jl 0x9f72     ; left of goal -> accelerate toward it
9F68  sub cx,bp                          ; else decelerate by the turn rate
9F6A  cmp cx,-6 / jnl 0x9f72
9F6F  mov cx,-6                          ; pinned to the −6 floor...
9F72  add cx,bp                          ; ...and the rate is ADDED BACK — falls through
9F74  cmp cx,6 / jng done / mov cx,6     ; ceiling, same shape
```

⚠️ **The low clamp falls through into the increment.** A plain `clamp(v − rate, −6, 6)` sits flat at −6; the real code pins to −6 and then re-adds the rate, so at rate 1 the velocity oscillates −6, −5, −6, −5… forever rather than settling. Same shape on Y (`CS:0x9f83`–`0x9f94`). The goal is offset `+6` on both axes first (`CS:0x9f55`/`0x9f5b`), so the hunter aims **into** the creature's body, not its corner.

**The spawn handlers, table indices 10 (left, `CS:0x9aca`) and 11 (right, `CS:0x9a82`) — previously undecoded — are the hunter's own 3-shot fan, not a `DIRS` lookup:**

```
9A82  neg dx                 ; RIGHT: dx (tag, IN) flips negative
9A84  sub bx,0xc              ; muzzle Y, same -0xc every base handler uses
9A87  bp = [si+8] - [si+6] + 1 ; the volley count, same formula as 0/1
9A8E  [di]=dx / [di+2]=ax(stosw) / [di+4]=bx / [di+6]=0xb00   ; entry 0: vx=+11,vy=0
9AA0  dec bp / jz done
9AA3  dec dx ; [di]=dx / ... / [di+6]=0xb07                   ; entry 1: vx=+11,vy=+7
9AB6  dec bp / jz done
9AB9  dec dx ; [di]=dx / ... / [di+6]=0xbf9                   ; entry 2: vx=+11,vy=-7
```

`9AA0` mirrors it at `CS:0x9aca` (left), with `add ax,0x10` before the write (matching handler 1's own muzzle asymmetry — only ONE arm of a pair ever touches X) and dirs `0xf500/0xf507/0xf5f9` (vx=−11). **Neither arm writes weapon `+0x0e`** (the facing field handlers 0/1 both set) — a genuine, unexplained asymmetry.

⚠️ **The record's own TAG is written NEGATIVE from birth** (`neg dx` then `dec dx` per entry) — not a stray bug, but load-bearing: `CS:0x9EFA`'s own dispatch reads the sign of `[di]` as a state flag:

```
9EFA  cmp word [di],0 / jnz 0x9f02   ; tag==0 -> empty slot, skip entirely
9F02  js 0x9e9e                       ; tag<0  -> COAST (ballistic, below)
       [falls through]                ; tag>=0 -> SEARCH (0x9f04, CS:0x9e36)
```

So a freshly-spawned hunter shot's FIRST tick takes the COAST arm, not the search. That arm (`CS:0x9E9E`–`0x9EFA`) applies the packed `[di+6]` literal the spawn handler just wrote as **plain ballistic motion** (no steering), **damps it toward zero one unit per axis per tick** (drag), and once BOTH components reach exactly zero, writes the sentinel `[di+6] = 0x0F00` (unreachable by any steered velocity, since steering clamps to ±6 on both axes). ⚠️ **Correction — the tag is NOT negated on this same tick.** An earlier revision of this section said reaching the sentinel "does a single `neg word [di]` — flipping the tag positive for the first time"; re-reading `CS:0x9E74`–`0x9E94` in full shows the sentinel tick only writes `0x0F00` and returns (`jmp 0x9fa3`) — the flip happens later, once the cooldown below expires. From the next tick on, `[di+6] >= 0xF00` keeps re-entering `CS:0x9E74` every tick until that fires; nothing else ever re-negates the tag once it finally does, so the hunter homes for the rest of its life once the delay elapses.

### `UNKNOWN_hunter_coast_reaim` — CLOSED: a fixed ~0.8 s delay, not a periodic cooldown `[PROVEN]`

`CS:0x9E74`–`0x9E94` is reached every tick the COAST arm's own dispatch (`cmp cx,0xf00 / jge 0x9e74`) finds `[di+6]` already at-or-past the rest sentinel:

```
9E74  cx += 0x100                    ; [di+6]'s HIGH byte, a tick counter, +1 per tick since the sentinel
9E78  [di+6] = cx                     ; write back
9E7B  pop dx / push dx                ; dx = the value FUN_1000_9ef7 pushed at its own entry — see below
9E7D  add dl,2 / and dl,3             ; dl = (dl+2) & 3
9E83  shl dl,1 / shl dl,1             ; dl <<= 2
9E87  xchg dl,dh                      ; reassemble into dx
9E89  add dx,0xf00                    ; dx = the RE-AIM THRESHOLD
9E8D  cmp cx,dx / jge 0x9e94          ; reached it? -> re-aim (below); else keep coasting
9E94  [di+6] = 0 ; neg word [di]      ; clear the counter AND flip the tag positive -> SEARCH from next tick
```

⚠️ **The `dl` byte this pass called "cycling" is not — it is a fixed constant, because its input never varies.** `9E7B`'s `pop dx` retrieves the value `FUN_1000_9ef7` (this mover's own dispatch entry, `CS:0x9EF7`–`0x9EFD`) pushes **unconditionally at the top of every call**: `MOV CX,0x9` (literal 9), immediately followed by `PUSH CX` inside the COAST-arm prologue at `CS:0x9E9E`, with nothing on the path in between touching `CX`. `get_xrefs_to` confirms `CS:0x9E9E` has exactly one caller (`CS:0x9F02`, the `JS` inside this same dispatch) and `CS:0x9E74` has exactly one caller (`CS:0x9EAC`, the `JGE` two lines above) — one calling context, `CX` always `9`. Working the arithmetic through: `dl = (9+2)&3 = 3`, shifted left twice = `12`, swapped into `dh`, giving `dx = 0x0C00`; `+ 0xF00 = 0x1B00` (6912) — a **fixed** threshold, not one that varies tick to tick or call to call.

**So the wait is a plain fixed-length timer, dressed up in a bit-shuffle that always produces the same answer.** `[di+6]` climbs `0xF00 → 0x1000 → 0x1100 → …` by `0x100` per tick from the moment it first hits the sentinel; reaching `0x1B00` takes exactly `(0x1B00 − 0xF00) / 0x100 = 12` further ticks. **At the documented 15 Hz game-logic rate, that is exactly 0.8 s.** A hunter shot that has fully decayed to a stop coasts in place for 0.8 s before its tag flips positive and it starts homing — not a periodic re-check, a one-shot delay. The elaborate `(dl+2)&3` construction is most plausibly a generic reload/delay helper's shape, reused here with a hardcoded parameter that happens to make the "cyclic" part of it inert; nothing in this call site ever exercises a second value.

**The stamp, `CS:0x9FC8`, and why the tag's sign has to be flipped for it:**

```
9FC8  cmp word [di],0 / jns 0x9fd6      ; tag non-negative -> just stamp
9FCD  neg word [di]                     ; NEGATIVE -> flip positive...
9FCF  call 0xa7b6                       ; ...the SAME shared terrain-aware
9FD2  neg word [di]                     ; stamp every other mover uses...
9FD4  jmp 0x9fd9                        ; ...then flip back
9FD6  call 0xa7b6                       ; already non-negative -> stamp directly
```

So the tag's magnitude is always the ordinary 1..27 slot tag the shared damage grid and `CS:0x9320`'s tag decode expect; the SIGN is a private state flag (ballistic vs. homing) that would corrupt both if it ever reached the grid unflipped, so it is normalised for exactly the instant the shared stamp needs it. `CS:0xa7b6` internally re-tests `weapon+0x48` (`breaksTerrain`, `0` for the hunter — it is one of the five weapons that pass straight through terrain), so hunter shots never stop at walls, only stamp.

**The cull, `CS:0x9FB3`–`0x9FC6`, is a third shape**: `x ∈ (−16, 320]`, `y ∈ (−16, 192]`, narrower than the common mover's `(−32, 320)`, and — unlike every other mover — going out of it only skips the stamp+draw (`jmp 0x9fd9`), never despawns. A hunter shot that leaves the screen keeps flying and can come back.

Together this closes `UNKNOWN_hunter_turn` fully: steering, the two spawn handlers, the stamp, the cull, and the tag's sign are all read to the byte. The coast phase's re-aim delay is closed too — see *`UNKNOWN_hunter_coast_reaim` — CLOSED*, above: a fixed 0.8 s timer, not a periodic cooldown, and it never changes whether a shot stamps or homes, only how long the opening spread lasts before it does.

### Mover 5, `CS:0xa678` — the magic axe bounces `[PROVEN]`

The only mover with per-projectile velocity **state**. `DS:0xdec6` — which sits exactly where slot C's projectile area ends (`0xde34 + 0x92`) — holds **nine 6-byte records `{i16 vx, i16 vy, i16 lifetime}`**, walked in lockstep with the 8-byte projectile records:

```
A77A  add di,0x8      ; the projectile record
A77D  add si,0x6      ; its velocity/lifetime record
A780  dec bp / js     ; bp starts at 8 -> NINE iterations
```

⚠️ **The wall probe is gated on the sub-tile position**, so outside a narrow window the axe moves without testing for a wall at all:

```
A69D  cmp dx,0xc / jng move    ; moving right: only when (x & 0x1f) > 12
A6A9  mov cx,0xfffc            ; vx := -4
A6B8  cmp dx,4  / jnl move     ; moving left:  only when (x & 0x1f) < 4
A6C4  mov cx,0x4               ; vx := +4
```

**And WHICH cell gets tested is decoded too, `CS:0xA5A5` (right) / `CS:0xA5D9` (left).** Both take X **and** Y — a probe that drops Y (as an earlier revision of the `gods-web` port's own `wallAt(x, dir)` signature did) cannot reproduce this. The tile cell is the usual `0x5004 + (x&~0x1f)>>5 + ((y&~0xf)<<3)`, and the NEIGHBOUR tested depends on the Y sub-tile remainder:

```
A5C6  and bx,0xf / jz 0xa5d2        ; y HAS a sub-tile remainder ->
A5CB  cmp byte [si+0x81],1 / jz     ;   test row+1, col+1 (diagonal)
A5D2  cmp byte [si+0x1],1           ; y remainder == 0 -> same row, col+1
```

⚠️ Read the offsets literally, not by the comment gloss above them: `+0x81` (129 = 128+1) is tested when the Y remainder is **nonzero**, and it is **row+1, col+1** — a diagonal look-ahead, not "the same row". `+0x1` (same row, col+1) is tested when the remainder is **zero**. The left probe mirrors it at `si-1` (same row) / `si+0x7f` (row+1, col−1). `ZF` on return is the comparison result (`byte == 1` → wall); the caller's own `jnz` after the `call` reads "not a wall → keep flying".

⚠️ **And the bounce is a fixed ±4, not a reflection** — an incoming +12 leaves as −4.

⚠️ **A FOURTH distinct gravity rule.** `A703 add cx,2 / cmp cx,8 / jng / sub cx,2`. Collected, no two alike:

| | rule | cap |
|---|---|---|
| hero | `dY = 4 + v`, `v++` | 10 |
| System-B enemy | `dY = v` *then* `v++` | 16 |
| time bomb | `v++` | 4 |
| **magic axe** | **`v += 2`** | **8** |

Lifetime is `A737 dec word [si+0x4] / js` — **decrement then test the sign**, so a life of 2 survives two ticks and dies on the third. Sprite is `0x1aa + ((weaponFrame + phase) mod 6) + 1`, and **`0x1aa` = 426 = `PINNED_SPRITE[9]`**, the magic axe's own pinned descriptor — an independent check on that table from a routine that never reads it. Bounces play sfx `0x209` — `CS:0xa7ad` is the `push ax` guarding the call; the id itself is the full word at `CS:0xa7ae mov ax,0x209`, not the bare low byte `0x09` this line used to gloss it as (⚠️ corrected, a later session, the same bug class as `TERRAIN_SFX` above and `FIRE_SFX` before it — see that paragraph's own citation). `[STATIC]`.

**On expiry, `CS:0xA7A1 call 0xa633` drops a debris spark** carrying the state record's OWN current `{vx, vy}` (`cx=[si]`, `dx=[si+2]`) — a MOVING spark, not the stationary puffs the terrain-stop and enemy-shot-hits-hero paths drop, and notably **after** that same tick's own gravity clamp has already run (the instruction order is position-update → gravity → cull → lifetime-test), so the spark's `vy` is the post-gravity value. This closes one of the five `CS:0xA633` callers catalogued under *`DS:0x8b4c` — debris* above.

**The spawn handlers, table indices 14 (left, `CS:0x9bc1`) / 15 (right, `CS:0x9b15`) — previously undecoded — are now read in full.** Same muzzle/volley-count shape as every other pair, but `dy = -0x10` (twice the common `-0xc`) and, unusually, **neither `dx` nor `dir` is mirrored by facing** — both handlers open `add ax,0x10 / sub bx,0x10`, and both write `dir = {1, 0, 2}` to every entry regardless of facing:

```
9B40  [di]=tag(dx) / [di+2]=x(stosw,ax) / [di+4]=y(bx) / [di+6]=dir(1, then 0, then 2)
9B52  [si]=4                    ; state.vx := +4  (RIGHT, CS:0x9b15); LEFT (0x9bc1) writes -4
9B59  cx=[0xdf14] ; [si+2]=cx   ; state.vy := the LIVE PROJECTILE_VELOCITY[dir].vy
9B62  [si+4]=0x32               ; state.life := 50
```

`dir` carries no meaning here to mirror, because `stepMagicAxe`'s own body never reads a projectile's `dir` field — movement comes entirely from the paired `DS:0xdec6` state record, which these same handlers seed. The state slot index is computed from the entry's own TAG (`(tag-1) mod 9`-shaped, via two `cmp cx,0xa / sub cx,9` folds), landing on the exact array position the mover will later walk to by loop index, since the tag numbering and the record's physical slot share one numbering. ⚠️ `DS:0xdf14` etc. are read out of the SAME mutable `DS:0xdf0e` velocity table the weapon-arc potions overwrite (already documented above) — so a magic axe's initial `vy` genuinely depends on whichever arc potion is active the moment it's thrown, and a port must read that table live at spawn time rather than bake a constant.

`UNKNOWN_projectile_movers` is **CLOSED** — see the time bomb above.

⚠️ **This line used to also claim `UNKNOWN_hunter_turn` closed, pointing at the turn-RATE formula (`CS:0x9f12`, the `[si+8]-[si+6]-2` clamp).** That was premature: the turn rate is a scalar multiplier, not "the hunter's steering arithmetic" the item actually named — the per-axis accelerate-toward-goal logic (`CS:0x9f61` onward) was still unread at the time. It is now genuinely closed, along with the two spawn handlers, the stamp, and why the tag is born negative — see *`UNKNOWN_hunter_turn` — CLOSED* right after the hunter mover section above.

### The move→stamp link, and a long-standing claim corrected `[PROVEN]`

**The grid stamp is on the projectile's DRAW path, not in the move loop.** The common mover ends by tail-jumping through a **three-entry draw-style table at `DS:0xdf26`**, indexed by weapon `+0x02`, and it is those branches that stamp:

```
9CF1  cx = [si+0x2] / shl cx,1 / mov di,0xdf26 / add di,cx / mov cx,[di] / jmp cx
  [0] 0x9cff  ->  call 0xa7b6  (terrain-aware 2x2)  then one blit
  [1] 0x9d0c  ->  call 0xa8b8  (3x3)                then one blit
  [2] 0x9d19  ->  call 0xa8b8 at y-0x10             then TWO blits, branching on facing
```

The table is **three** entries — `DS:0xdf2c` onward holds signed byte pairs, a different table — and weapon `+0x02` is **0..2 across all 44 shipped records**, the table's exact width. That also settles the tension flagged earlier: the pickup path zeroing `+0x02` when it reads 3 (`CS:0x9118`) is a **range guard**, not a second meaning for the field.

**This was the real break in the port**, not the fire entry: a reimplementation that moves projectiles but never stamps leaves the damage grid empty every frame, so nothing can ever be hit however complete the rest of the chain is.

#### ⚠️ `PWEAPONS` `+0x48` is "stopped by terrain", NOT "breaks blocks"

This document has carried `+0x48` = *"projectile breaks solid terrain — the `maces break blocks` flag"* as a `[STATIC]` inference from field position. **The bytes refute it.**

```
A7B7  cmp byte [si+0x48],0 / jnz
A7BD  jmp 0xa860                        ; flag CLEAR -> just stamp, keep flying
A7C0  cx = x + [0xa] + 8 ; and 0xffe0   ; ⚠️ +8 on BOTH axes before the mask
      dx = y + [0xc] + 8 ; and 0xfff0
      bp = 0x5004 + (cx>>5) + (dx<<3)
A7EF  cmp byte [ds:bp+0],1 / jnz 0xa860 ; not solid -> stamp, keep flying
A7F6  push ax / mov ax,0x21d / call 0x22ca / pop ax   ; play sfx 0x21d
A816  append a debris record to the 20-slot array at DS:0x8b4c
A85B  mov word [di],0                   ; DESPAWN THE PROJECTILE
```

⚠️ **CORRECTED, a later session (surfaced while wiring `gods-web`'s TERRAIN_SFX).** This section used to gloss the sound as "sfx 0x1d" — the low byte only. Fresh disassembly at `CS:0xA7F7` reads `mov ax,0x21d`: the FULL word passed to `call 0x22ca` is **`0x21d`**, the same id-numbering convention this document already uses everywhere else (e.g. the hero's own hurt/footstep ids). `gods-web`'s `TERRAIN_SFX` had been exported as the bare low byte `0x1d` since this port's SFX ids were first added — never matching any `SFX_VOICES` key, so it would have played nothing the moment it was wired, the exact same bug class `projectiles.js`'s `FIRE_SFX` was already corrected for (bare `0x1c` → full word `0x041c`). `[STATIC]`: a `MOV` immediate read fresh this session, not cross-checked live.

**There is no write to plane A or plane B anywhere on that path.** The projectile is consumed by the wall; the wall is untouched. So the flag means the shot *collides with* terrain, and a weapon with `+0x48 == 0` flies **straight through walls**. Shipped: knife, time bomb, fireball, flame, throwing star and mace collide; **lightning bolt, spear, axe, hunter and magic axe pass through**.

Block destruction is a much narrower, separate mechanism: only when the plane-A tile is **`0x6d`** *and* the world is **≥ 3** does `CS:0xA810` call `0x73ec`, which appends the cell to a 40-entry queue at `DS:0xd0c6`. `UNKNOWN_destructible_tile` is **CLOSED** — see *Destructible blocks* below for what that queue then does.

⚠️ Note the **`+8` on both axes** before the tile masks. A port using a plain `x>>5, y>>4` picks a different cell near a boundary; a wall at the correctly-rounded cell stops the shot while one at the naive cell does not.

### The fire cycle — semi-automatic, and allocate is 3 ticks before emit `[PROVEN]`

**`DS:0x351` is not a per-frame latch.** Its per-frame clear is conditional:

```
019D  test byte [0x382],0x80    ; fire bit held?
01A2  jnz 0x1a9                 ; HELD -> do NOT clear
01A4  mov byte [0x351],0        ; RELEASED -> clear
```

The allocator bails returning 1 when the latch is set (`0x95cb`) and sets it on entry (`0x95d5`). So the latch clears only on a tick where fire is *not* held: **one volley per button press.** Holding fire does nothing until you release. A port that clears it every frame gives the hero a 15 Hz autocannon.

**The state machine enters a fire state only on allocator success, and success is 0** (`CS:0x5ca8`, walk-right; the other seven mirror it):

```
5CA8  test byte [0x382],0x80 / jz  keepWalking
5CAF  call 0x95ca
5CB2  cmp ax,0x0 / jnz keepWalking      ; the INVERTED return, in live use
5CB7  jmp 0x5d3d
```

That is independent confirmation of the inverted convention — not merely inferred from the allocator's own `xor cx,cx`.

**⚠️ Allocation and emission are on different ticks.** `CS:0x5d3d` sets state 5 with phase 0, and the handler emits at **phase 3**:

```
5D46  inc cl
5D48  cmp cl,3 / jnz                    ; PHASE 3 ONLY:
5D4E    call 0x9734                     ;   emit (0x97ce facing left)
5D52  cmp cl,5 / jl stay
5D57  test byte [0x382],0x80 / jz leave ; at phase 5, re-check fire
5D5E  call 0x95ca                       ;   and chain another
```

So the press *reserves* a sub-slot and the projectile *appears* three ticks later — **200 ms at 15 Hz**, visible, and part of why the game feels deliberate.

### `UNKNOWN_fire_state_bodies` — CLOSED: all eight decoded `[PROVEN]`

⚠️ **The four families are NOT variants of one pattern.** Decoding walk+fire and mirroring it into the other three gets the emit phase wrong in **six of the eight states** and the animation wrong in two.

| family | states | emits at | animation | epilogue |
|---|---|---|---|---|
| walk + fire | 5, 6 | **phase 3** | table `DS:0xd950` | **`0x5e9f`** — skips the phase store |
| jump + fire | 20, 21 | phase 1 | `[0x356]` inc/dec flag | `0x5e9b` |
| fall + fire | 22, 23 | phase 1 | `[0x356]` inc/dec flag | `0x5e9b` |
| ladder + fire | 24, 25 | phase 1 | bare `inc` | `0x5e9b` |

**Walk is the odd one out on both counts.**

⚠️ **The persisted phase and the rendered phase are different values.** `CS:0x5d68` stores the raw counter into `DS:0x36b` *first*, then overwrites `CL` from the table and jumps to **`0x5e9f`** — one instruction past the epilogue's own `mov [0x36b],cl` at `0x5e9b`. Storing the remapped value instead freezes the cycle, because the next tick's `inc cl` would then run on a sprite offset rather than a counter.

The table at `DS:0xd950`, read as a byte at `[phase*2]`, is the symmetric recoil **2, 1, 0, 1, 2**. Entry 5 holds 21 and is **never read**: `cmp cl,5 / jl` diverts before the lookup, so `cl` is only ever 0..4 there.

| state | exits at | to | with `cl` | note |
|---|---|---|---|---|
| 5 / 6 | 5 | 1 / 0 | 2 | at phase 5 re-checks fire and **chains** (`cl := 0`) if it can allocate |
| 20 / 21 | 3 | 9 / 8 | 5 | `[0x358] += 2` so the jump arc continues; past `0x2e` → state 12 |
| 22 / 23 | 3 | 12 / 11 | 0 | runs the **full fall physics** — `+4`, gravity `0x48b0`, `+= [0x1b2]`, fall-damage |
| 24 / 25 | 3 | 14 | **3 / 1** | restores Y from `[0x1b6]`; `[0x378]` = 1 / 0xff |

⚠️ **The ladder pair is asymmetric** — 24 exits with `cl = 3` (`CS:0x5471`) and 25 with `cl = 1` (`CS:0x54a3`), though both return to state 14. Mirroring one into the other gets the exit pose wrong.

⚠️ **TWO CORRECTIONS to the table above, both found by reading the tails when wiring the states into the port** `[PROVEN]`. Decoding a handler's head and inferring its tail is exactly the shortcut this project keeps paying for:

**1. The jump pair's exit phases DIFFER — 20 leaves with 5, 21 with 6.**

```
CS:0x53F2  mov cl,5 / mov byte [0x377],9      state 20 -> state 9  with cl = 5
CS:0x52D5  mov cl,6 / mov byte [0x377],8      state 21 -> state 8  with cl = 6
```

The row above listed `5 / 5`, by mirroring. The bytes agree with this document's *own* separate finding about the jump handlers — state 8 (jump left) uses **6** as its catch-all airborne frame while state 9 (jump right) stores **5** in both arms — so handing state 8 a `cl` of 5 renders a frame that state never produces on its own. **A fourth asymmetry in a family that has one at every level.**

**2. The ladder pair's exit phase is CONDITIONAL, not a constant.**

```
546C  mov byte [0x377],0x0e     ; state 14, both
5471  mov cl,3                  ; 25 does `mov cl,1` at 0x54A3
5473  test byte [0x359],0x1
5478  jnz 0x547e                ; the saved entry phase is ODD  -> keep 3 (or 1)
547A  mov cl,[0x359]            ; the saved entry phase is EVEN -> restore it
547E  mov ax,[0x1b6] / mov [0x17c],ax    ; and restore Y
```

`DS:0x359` is written by the entry (`CS:0x55ED mov [0x359],cl`) — the same tick that nudges Y up 4 when that phase is even. So on an even entry the hero both moves *and* gets his climb position handed back untouched; the constant only applies on an odd one. Treating `exitCl` as unconditional loses the climb's animation position on half of all ladder shots.

#### The four ENTRY patterns — `UNKNOWN_fire_state_entry` CLOSED `[PROVEN]`

All four share a core, and each adds its own guard:

```
test byte [0x382],0x80 / jz  keepGoing      ; the fire bit
call 0x95ca / cmp ax,0 / jnz keepGoing      ; the allocator — 0 IS success
mov byte [0x377],<state>
```

| family | entry | extra guard |
|---|---|---|
| walk `CS:0x5ca8` | `cl = 0` | — |
| fall `CS:0x4c04` | `cl = 1`, **`[0x356] = 1`** | — |
| jump `CS:0x51cb` | `cl = 1`, **`[0x356] = 1`** | **two** arc guards straddling the allocator — see below |
| ladder `CS:0x55d6` | `cl = 0` | `cmp byte [0x378],0 / jz` — zero skips; **negative** takes the left variant. Saves Y into `[0x1b6]` (which the exit restores), stores `cl` into `[0x359]`, and nudges Y up 4 when `cl` is even |

⚠️ **The jump family has TWO guards, and they sit on opposite sides of the allocator** `[PROVEN]`. An earlier revision of this section named only the upper one, and the port then evaluated it *before* the allocator by analogy with the ladder:

```
51C4  cmp byte [0x358],0x4 / jl 0x51f5      ; LOWER guard — BEFORE the call
51CB  test byte [0x382],0x80 / jz 0x51f5
51D2  call 0x95ca                           ; <-- the allocator; SETS DS:0x351
51D5  cmp ax,0x0 / jnz 0x51f5
51DA  cmp byte [0x358],0x2c / jnl 0x51f5    ; UPPER guard — EIGHT BYTES PAST IT
51E1  mov byte [0x377],0x14                 ; state 20
51ED  add byte [0x358],0x2
```

Two consequences a port misses by reading only `0x51DA`:

1. **The cursor must also be ≥ 4** — the same `cmp [0x358],4` that gates horizontal motion during a jump. So firing is locked out at **both** ends of the arc, not just the end: the hero cannot shoot during the jump's 4-tick wind-up.
2. **A press late in a jump is CONSUMED.** Because the upper guard runs *after* `call 0x95ca`, the allocator has already set the latch `DS:0x351` before the rejection. The player must release and press again. Guarding first — which the ladder genuinely does, `0x55D6` preceding `0x55DF` — leaves the latch clear and lets the very next tick fire.

Both compares read `[0x358]` **before** the entry's own `add byte [0x358],0x2` at `0x51ED`, so they see the pre-advance cursor. `CS:0x4FC5`/`0x4FDB` are the byte-identical mirror in state 8.

#### `UNKNOWN_fire_state_356` — CLOSED: the entries are its writers `[PROVEN]`

`CS:0x4c20` and `CS:0x51e8` set `DS:0x356` to 1 as part of entering a fall or jump fire state. The handler then **decrements** the phase on that first tick instead of incrementing, and clears the flag. So with entry at `cl = 1` the sequence is **1, 0, 1, 2, 3** — a visible wind-up dip before the shot.

⚠️ **The fall and jump families therefore do NOT emit on their first tick**, even though their emit phase is 1: the shot lands on the *second* time the phase reads 1. Modelling the entry as `cl = 0` with a plain increment fires a tick early and loses the dip entirely.

**The fire chain is now complete end to end**: press → latch → allocate → enter a state → wind up → emit → spawn → move → stamp → scan → damage.

### Which states can fire a weapon — and the two that mean something else `[PROVEN, exhaustive]`

All **12** `call 0x95ca` sites in the image, mapped to states through the `DS:0xd818` dispatch table:

| site | state | | site | state |
|---|---|---|---|---|
| `0x4C0E` | 11 fall left | | `0x55DF` | the ladder-fire entry (right) |
| `0x4D10` | 12 fall right | | `0x5605` | the ladder-fire entry (left) |
| `0x4FD3` | 8 jump left | | `0x5839` | 14 ladder-from-stand |
| `0x51D2` | 9 jump right | | `0x585F` | 14 (the mirror) |
| `0x5A6B` | 0 walk left | | `0x5D5E` | 5 — the **chain** re-fire |
| `0x5CAF` | 1 walk right | | `0x5DA5` | 6 — the chain mirror |

⚠️ **The idle state cannot shoot, and neither can the crouch pair.** Both test the *same* fire bit and route it elsewhere:

```
state 26 (idle)   CS:0x49EA  test byte [0x382],0x80 / jz
                  CS:0x49F2  call 0x1045   -> mov si,0x8314 / mov cx,0xc8
                                              200 object records, stride 8
                             CS:0x1087      cmp byte [di+0x4],0x3 / jnz  <- CAT 3
                             CS:0x10C5      xor byte [si+0x4],0x1        <- TOGGLE
                                                                  -> LEVER/SWITCH
states 18/19      CS:0x4B27 / 0x4B9C       -> jmp 0x612F, which reads the
                                              4-slot inventory at DS:0x17e
                                              through the selector DS:0x366
                                                                  -> INVENTORY USE
```

So **fire means three different things depending on the hero's state**: shoot while moving, throw a switch while standing, use an item while crouching. A port that lets a stationary hero shoot has invented a control scheme — and one that doesn't know this will "fix" the missing shot.

⚠️ **CORRECTION — `CS:0x1045` is the LEVER toggle, not object pickup.** An earlier revision of this section (written one pass before the pickup path was traced) called it "the 200-record object-pickup walk", on the strength of the array walk and the `DS:0x2a4e` index alone. Reading the body through kills that: it keeps **only category 3** and ends in `xor byte [si+0x4],0x1`. Category 3 is levers/switches, and flipping bit 0 of the type is exactly the lever toggle this document records elsewhere (types 24/25 = lever off/on, 26/27 = switch off/on) — the two findings are the same mechanism seen from two directions. Four object types are special-cased out of the toggle (`cmp word [di],0x120 / 0x122 / 0x124 / 0xe8`, i.e. sprite ids 288/290/292/232, object types 118/120/122/62) and instead set `DS:0x20e` and clear `DS:0x3a2`.

**`UNKNOWN_lever_special_types` — CLOSED.** These four are still genuine category-3 lever/switch objects (confirmed by decompressing all four `POBJECTS.00{1-4}` and reading the actual records: type `{62,118,120,122}` — `{237,293,295,297}` under world 4's `+5` id drift — are category 3 in every world, but unlike the ordinary lever/switch pairs they carry **no name and no description** in any world). They aren't toggled instantly; touching one arms a **delayed, animated toggle**, consumed by the object-draw routine `FUN_1000_1d01`:

```
1D0E  cmp [0x3a2],0 / js 1d86         ; armed? (CS:0x10BA/0xBE set [0x20e]=the object, [0x3a2]=0 on touch)
1D15  is THIS drawn object's type one of the 4 special ones?
1D2D  si=[0x20e]                       ; the touched special-lever object
1D31  does its screen position match the object CURRENTLY being drawn?  (so only that one object animates)
1D46  si = 0xe01e + (world-1)*0xa      ; a per-world, 5-word animation-frame table
1D5B  si += [0x3a2]*2 ; cx=[si]        ; sprite for this phase
1D67  inc [0x3a2]
1D6B  cmp [0x3a2],3 / jnz 1d7a
1D72    si=[0x20e] ; xor [si+4],1      ; <-- THE ACTUAL STATE TOGGLE, at phase 3 of 5
1D7A  cmp [0x3a2],5 / jnz 1d86
1D81    [0x3a2] = 0xff                 ; done -> re-arm the entry gate for next time
1D86  draw with the phase's sprite
```

So these four are **lever/switch variants with a visible multi-frame swing animation** rather than an instant flip — the underlying `xor [si+4],1` toggle is identical to the ordinary lever mechanism, just fired mid-animation instead of on contact. Read live (DOSBox) the four worlds' tables at `DS:0xe01e` are **`{410,411,289,411,410}` / `{329,330,233,330,329}` / `{412,413,291,413,412}` / `{414,415,293,415,414}`** — and the middle (phase-2) sprite in each is *exactly* that world's own special type's sprite id **+1** (`289=288+1`, `233=232+1`, `291=290+1`, `293=292+1`) — i.e. the swing animation's peak frame is drawn as the object's own *toggled* sprite, landing precisely on the tick the state actually flips. A clean, fully self-consistent, cross-world-verified mechanism: a dramatic animated lever, not a plain one.

The distinction matters twice: **real pickup has no fire gate at all** (it happens on contact, `CS:0x177d`), and a port that binds pickup to the fire button makes half the map uncollectable while making levers operate by walking into them.

## Weapon pickup — how the hero arms himself `[PROVEN]`

Since `CS:0x914c` leaves all three slots at `0xFFFF`, this is the *only* way a weapon enters play.

**The contact test, `CS:0x177d`:**

```
177D  cmp word [0x19a],0 / js reject   ; the BAR, and STRICTLY negative
1787  cx = [0x17a] ; dx = [0x17c]      ; hero world position
178F  cx -= [0xa] ; dx -= [0xc]        ; -> hero SCREEN position
1799  add ax,0x8 / add bx,0x8          ; the OBJECT's screen position + 8
179F  sub cx,0x4  / 17A2 add di,0x24   ; the X window
17A5  cmp ax,cx / jl reject  /  17A9 cmp ax,di / jg reject
17AD  di = dx ; sub dx,4 ; add di,0x34 ; the Y window
17B5  cmp bx,dx / jl reject  /  17B9 cmp bx,di / jng ACCEPT
```

Both sides go to screen space and are then differenced, so the camera cancels. Folding the `+8` in gives an **inclusive window of `objX − heroX ∈ [−12, +28]`, `objY − heroY ∈ [−12, +44]`** — 40 × 56, wider than the hero's 32 × 48 body and reaching further below than above.

⚠️ The gate is `js`, i.e. **strictly** negative: a bar of exactly 0 still allows a pickup. That is the same shape as the damage guard and the *opposite* of the death test, which fires at `<= 0`. Three neighbouring reads of `DS:0x19a` with three different boundaries.

**The type split, `CS:0x17C7`:** `cmp cx,0xC0` — at or above, `jmp 0x1924` (the weapon path); below, the descriptor's **category** decides (`cmp byte [di+0x4],1`: `jg` rejects, `jz` → treasure at `0x184E`, else potions/consumables fall through at `0x17EE`).

⚠️ **A dead slot is `0xFFFF`, which is also `>= 0xC0`.** `CS:0x9000` tests the **sign** rather than comparing against `0xFFFF`, and a port that writes `type >= 0xC0` first matches every consumed or unused record — measured, **535** of them across the eight maps instead of the 55 real pickups, all sitting at `(0, 0)`, so a hero near the map origin collects seventy phantom weapons at once. Sign first.

**The weapon path, `CS:0x1924` → `CS:0x94a7`:** mark the object dead (`[si+4] = 0xFFFF`, `[si+6] = 0`), `weapon = type − 0xC0`, dispatch, then sfx `0x0638`. **There is no full-slots check** — `CS:0x17D0` is the only reference to `CS:0x1924` and it jumps there unconditionally, which is safe because the selector always yields a slot.

⚠️ **The two outcomes are different events.** Already holding it → `CS:0x94E8 inc word [di+0x8]` only: the count rises (so volley *and* per-hit damage rise) and the projectile area is untouched. A **new** weapon instead re-bases the count to Power (`CS:0x90F9`) and **clears that slot's 144 bytes** (`CS:0x9177`) — swapping weapons destroys your shots in flight. That clear is also why pickup must run at `CS:0x0206`, *before* the projectile step at `CS:0x020F`: run it after and a weapon you no longer hold gets one more move and one more stamp.

**The slot selector, `CS:0x953e`:**

| order | rule | site |
|---|---|---|
| 1 | weapon **2 (fireball) is hard-wired to slot C**, and the same write sets `DS:0x340 = 0x12` | `0x954F`, `0x95AE` |
| 2 | the new weapon's **`+0x00 == 0` → slot A** | `0x9554` → `0x95A2` |
| 3 | slot B empty (negative) → B | `0x9559` |
| 4 | slot C empty → C | `0x9560` |
| 5 | both full → replace whichever of B/C has the **lower** `+0x08`; `jl` is strict, so a **tie keeps B and replaces C** | `0x9580`–`0x9596` |

Rule 1 explains itself: `DS:0x340` is the tag base the fireball's mover subtracts at `CS:0x9DC2` to get a per-projectile index, and slot C's tags are 19–27, so `0x12` is right only if the fireball is in slot C. Pinning the weapon to the slot is what makes that constant safe.

**`+0x00` is genuine file data, not a pinned field** — the loader's save/restore pairs read displacement `+0x0c`/`+0x1e` (`CS:0x35b7`/`0x35d0`) and `+0x08` (`CS:0x367a`), never 0. Measured across **all four** files it reads `0/1/1/1/1/0/0/0/1/1/0`, byte-identical in every world — so unlike `+0x08`, which diverges in `.003` and `.004`, the slot rule does not drift. Slot A is reserved for **knife, throwing star, spear, axe, mace**.

**Re-derived from the shipped bytes:** the eight maps place **3/4/0/2/7/2/14/23 = 55** weapon pickups — matching the figure this document recorded from a different tool. Note `PLEV2A` places **none at all**.

### Consumables (category 0) — the handler index is a RANK, not the type `[PROVEN]`

The category-0 branch at `CS:0x17EE` marks the object dead, then computes an index by **counting on the spot**:

```
1801  ax = cx                       ; the object type
1804  si = 0xef78                   ; the 132-byte category table
1807  bx = 0 ; dx = bx
180B  or cx,cx / jz 0x1818          ; type 0 -> rank 0 (and `loop` at cx=0
180F  cmp bl,[si] / jnz / inc dl    ;   would otherwise run 65536 times)
1815  inc si / loop 0x180f          ; count the category-0 entries, types 0..type-1
1818  shl dx,1
1822  si = 0xd8b8 + dx / si = [si] / call si
```

So `DS:0xd8b8` is indexed by the type's **rank among category-0 types**, counted **strictly below** it — a dense re-index, not the type. Two independent facts pin the width: the shipped category table has exactly **23** zero entries, and the table at `DS:0xd8b8` holds exactly **23** plausible code offsets before running into unrelated data (`0x50, 0x50, 0x50, 0x50, 0x05, 0x4f, …`).

### All 23 decoded — `UNKNOWN_consumable_handlers` CLOSED `[PROVEN]`

Every one is confirmed by its own `POBJECTS` text. That is what makes the set checkable: nothing about a handler address says what it should do, and the 48-byte record carries a 16-byte name and a 24-byte description for every type.

| rank | type | handler | name / description | effect | placed |
|---|---|---|---|---|---|
| 0 | 0 | `0x6327` | health / restores energy | **+12 health** | 15 |
| 1 | 2 | `0x62da` | power potion / increases weapon power | `0x9426` **+1 pickup count on ALL three weapons**, then `0x94f5` | 4 |
| 2 | 3 | `0x62d7` | power potion (12000) | enters one instruction above rank 1 → calls `0x9426` **twice** | 2 |
| 3 | 35 | `0x6350` | health / restores energy | **+24 health** | 18 |
| 4 | 36 | `0x61f7` | starburst | `0xa461` at (heroX+8, heroY+32) — an 80-slot particle array at `DS:0x8cfa` | 5 |
| 5 | 37 | `0x62bf` | shield / **reduces damage** | `[0x34c] = 1` — **and nothing reads it. A shipped no-op.** | 3 |
| 6 | 38 | `0x62c8` | shield / invulnerabilty | `0xa90b`: `[0x19c] = 255`, `[0x172] = 1` | 5 |
| 7 | 39 | `0x61cf` | familiar | `0xc2f6` — summon, or +1000 energy and +1 power | **0** |
| 8 | 40 | `0x61d6` | magic wings / effects familiar | `inc [0x304]`, then the same | **0** |
| 9 | 41 | `0x61df` | power claws / effects familiar | `[0x210] += 2`, then the same | **0** |
| 10 | 42 | `0x62ec` | extra life | sfx `0x6416`, `inc word [0x224]` (lives), display dirty | 10 |
| 11 | 43 | `0x5e9b` | magic potion / slows monsters | ⚠️ **no handler — see below** | **0** |
| 12 | 44 | `0x620d` | magic potion / freezes aliens | `[0x2fa] = 0xAA` | **0** |
| 13 | 47 | `0x62b5` | magic potion / giant jump | `[0x174] = 0x154` | 3 |
| 14 | 51 | `0x95b5` | weapon arc / standard | copy `SS:0x3612` → `DS:0xdf0e` | 10 |
| 15 | 52 | `0x62a1` | weapon arc / intense | copy `SS:0x362a` | 5 |
| 16 | 53 | `0x62ab` | weapon arc / wide | copy `SS:0x3642` | 4 |
| 17 | 54 | `0x6217` | teleport stone | sets `[0x370]`, `[0x3a8]`, `[0x22e]` | 14 |
| 18 | 69 | `0x63d5` | tablet / reveals clues | the `PALFILS` hint system, already documented | 46 |
| 19 | 70 | `0x6306` | food / restores energy | **+2 health** | **0** |
| 20 | 71 | `0x6393` | food / restores energy | **+4 health** | **0** |
| 21 | 72 | `0x63b4` | food / restores energy | **+3 health** | 4 |
| 22 | 83 | `0x61e9` | shop potion / summons the shopkeeper | `[0x363] = 0x41`, `[0x375] = 0`; **returns `dx = 2`** | 8 |

⚠️ **SEVEN OF THE 23 TYPES ARE PLACED ZERO TIMES** across all eight maps — 39, 40, 41, 43, 44, 70, 71. **Decoded is not the same as reachable**, and that includes the *entire* familiar chain.

**The earlier "ranks 11 and 14 point into unrelated routines" flag resolved two different ways.** Rank 14's `0x95b5` is `mov si,0x3612 / call 0x95bc / ret` — the default-argument entry of the arc copier, i.e. the potion that puts the **standard** arc back. Rank 11's `0x5e9b` really is the player state machine's epilogue, and that is the finding — see below.

#### The return value is a MESSAGE TIER, not a success flag `[PROVEN]`

```
182D  or dx,dx / jz 0x183c        ; 0   -> no message at all
1831  dec dx   / jz 0x1839        ; 1   -> show the message
1834  mov byte [0x394],0          ; >=2 -> clear DS:0x394 first
1839  call 0x4609                 ;        then show it
```

21 handlers return 1; only the shop potion returns 2. A refusal returns 1 as well, so the caller cannot tell it from a success.

#### The three weapon arcs — the sharpest confirmation in the set `[PROVEN]`

All three potions call the same copier `CS:0x95BC` (`di = 0xdf0e / mov cx,0xc / ss lodsw / stosw`), which **overwrites** the six-entry projectile velocity table this document already records at `DS:0xdf0e`. They differ only in the source, and the three sources are adjacent 24-byte tables (`0x3612 + 0x18 + 0x18`):

| potion | `SS` | dirs `{vx, vy}` |
|---|---|---|
| **standard** | `0x3612` | `(±12, ∓3 / 0 / ±3)` — what the game boots with |
| **intense** | `0x362a` | `(±12, ∓1 / 0 / ±1)` — a tight bundle |
| **wide** | `0x3642` | `(±10, ∓10 / 0 / ±10)` — a broad fan, and slower in X |

Y-spreads of **3 / 1 / 10** against descriptions **standard / intense / wide**. Nothing about the addresses says which is which; the numbers do.

#### ⚠️ Invulnerability: the potion and the spawn share a helper and differ by 170 frames `[PROVEN]`

`CS:0xA90B` sets `[0x19c] = 255`, seeds four aura phase offsets at `DS:0x1d8`, and sets `[0x172] = 1` — the flag the damage gate `0xACCC` reads. `[0x19c]` is decremented once per frame at `0xA99B` (from the per-frame call at `CS:0x026F`), clearing `[0x172]` at zero.

**But `CS:0x085D` — inside the respawn block that also sets health target 24 and bar 1 — calls the same helper and then immediately does `sub word [0x19c],0xaa`.** ⚠️ *Corrected (ranked item 51): it is the respawn block only (`FUN_1000_0845`, reached solely by `jmp 0x845` at `CS:0x0940`), not a level start. The level loader clears `[0x172]` (`CS:0x8CC7`) and parks `[0x19c]` at `0xFFFF` (`CS:0x8E22`); `[PROVEN]` live at a world-2 level entry's `CS:0x0126`: `[0x172] = 0`, `[0x19c] = 0xFFFF`. So a new level starts with no protection. The aura also starts the loop sound `0x0280` (`CS:0x0907` at respawn, `CS:0x62CC` for the potion), stopped at `CS:0xA9AA` when it runs out.* So a spawn gets `255 − 170 = 85` frames and the potion gets the full 255: at 15 Hz, **5.7 s of spawn protection against 17 s of shield**. Reading `0xA90B` alone and not chasing the `sub` puts a confidently wrong 17 s on both.

And this is not purely defensive — `0xACCC`'s `jnz` skips only the health subtraction, so while `[0x172]` is set **the hero takes no damage and still kills everything he touches**.

#### Two handlers land on globals this document already knew from the other side `[PROVEN]`

- **`[0x2fa] = 0xAA`** (type 44, *"freezes aliens"*) — decremented once per frame at `CS:0x0186`, floored at `0x018C`, and read by **eighteen** sites including `0xEDB8`, the System-B movement gate recorded here long before this handler was decoded, plus `0xAD8D`/`0xAE53` in System A. 170 frames = **11.3 s**, both entity systems.
- **`[0x174] = 0x154`** (type 47, *"giant jump"*) — `CS:0x4F6F` subtracts each of the 23 arc deltas from Y **twice** while that word is set. This document recorded the doubling as *"the double-jump power-up word"* without knowing what set it. 340 frames = **22.7 s**.

#### ⚠️ *"shield … reduces damage"* is a shipped no-op `[STATIC, exhaustive]`

`CS:0x62BF` is `mov byte [0x34c],1` — and **nothing reads `DS:0x34c`.** Held to the `.DAT` word2 standard, not the weaker base-address one:

- the immediate `4C 03` occurs **four** times across all twelve shipped binaries, and every one is `C6 06 4C 03 imm` — a byte write (`0x62BF` and `0xC57B` set 1, `0x656E` and `0x8E11` clear);
- a **word** access based one byte low would read `0x34c` as its high half and encode `4B 03`. That pair occurs four times too, and all four are again byte writes, to the neighbouring `0x34b`.

Neither alignment yields a reader anywhere. The only remaining escape is an address computed into a register rather than encoded. **Three of these ship across the eight maps and none of them reduces any damage.**

#### ⚠️ *"slows monsters"* has no handler at all `[PROVEN]`

Rank 11's table word is `0x5e9b`, the **player state machine's epilogue**. Calling it from the object walk runs a spurious phase store, event probe, camera update, sprite selection and hero draw, then returns. Two facts make *cut item* the reading rather than *undecoded effect*: type 43 is placed in **zero** maps, and **the epilogue never sets `DX`** — which `CS:0x182D` reads to pick the message tier. All 22 other handlers set it.

#### The teleport stone `[PROVEN]`

`CS:0x6217` sets three variables: `[0x370] = 1` ("a teleport is pending", consumed by the per-frame check at `CS:0x0324`), `[0x3a8] = 1` (the kind), and `[0x22e]` = the destination packed as `(col << 8) | row`. `CS:0x0FDF` unpacks exactly that — `bl = al` (row), `al = ah`, `shl ax,5` (col × 32).

The destination comes from the **30-record `{key, x, y}` table at `DS:0xa778`** — the `PALFILS +0x1770` window this document had recorded only as "a lookup at `0x6241`" — searched by a key read through `DS:0x20a`, with world 2 sublevel `'a'` and hero x in `[0x5c0, 0x640]` hard-coded to `0x202e`. ⚠️ **The same three variables are written by the ACT3 teleport-zone trigger at `CS:0x4AA5`**, which is what confirms the meaning: the stone and the zone are one mechanism reached two ways.

⚠️ **CORRECTION — the potion gate is `bar < 0`, not `bar == 0`.** This document recorded *"each gated on `cmp word [0x19a],0` — a potion does nothing while the bar reads zero"*. Every site is `cmp word [0x19a],0 / **jns** <effect>`, so it proceeds while the bar is **non-negative** and refuses only once it has gone negative. **A potion still works at a bar of exactly zero.** That is the same non-strict shape as the damage guard and the pickup gate, and the opposite of the death test which fires at `<= 0` — four reads of `DS:0x19a`, three different boundaries.

⚠️ **The 24 cap is a CONVERSION, not a clamp.** Overflow falls through to `CS:0x6377`:

```
6377  sub ax,0x18            ; ax is the PRE-clamp target
637A  shl ax,1  (x5)         ; excess * 32
6384  cmp word [0x168],0 / js 0x638f
638B  add [0x168],ax         ; banked — unless [0x168] is negative
```

⚠️ **But the bank has a gate, and in shipped play it never opens.** `0x6384`'s `js` skips the credit whenever `[0x168]` is **negative** — and `UNKNOWN_DS_0168` is now **CLOSED: it is the FAMILIAR'S ENERGY.** All the behaviours line up: 1000 on summon (`0xC347`), +1000 for a second potion (`0xC2FD`), drained by damage (`0xAB4D`), −1 when it dies or is dismissed (`0xC470`). `0xC440` is the dismiss, and its callers are `CS:0x047D` and `CS:0x8DDF` — **the two full restarts** — so the value is −1 from the start. The only thing that lifts it is a *"familiar"* potion, **type 39, placed zero times in all eight maps**.

So the banking is real code that no shipped level can reach: **over-healing is discarded.** An earlier revision of this document (and of the port) stated the banking as what over-healing does; that was reading the arithmetic without its guard. The `0x9129` hunter-target-list gate fits the same reading — the list is built while a familiar is alive **or** a hunter is held, because a live familiar needs targets for the same reason the hunter does. **`[0x168]` is not the shop total** — that is `DS:0x194`.

⚠️ **The object is marked dead BEFORE the handler runs** (`0x17F6` precedes `0x1829`), and the refuse path returns the same `dx = 1` as success (`0x6209` against `0x638F`). So **a potion taken at negative health is still consumed** and still shows its message, and the caller cannot tell the two apart.

**Treasure (category 1) is a different mechanism**, not more of this one — see the next section. `UNKNOWN_treasure_pickup` is **CLOSED**.


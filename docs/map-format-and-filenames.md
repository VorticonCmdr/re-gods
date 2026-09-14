# The .MAP level format and the two filename tables

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## The `.MAP` level format `[PROVEN]`

Cracked, with its parser located: **`GAME.EXE FUN_1000_36f8`** (`1000:36f8`–`1000:3730`) plus helpers `FUN_1000_373e` / `FUN_1000_374b` / `FUN_1000_3731`. It loads via the shared loader using the filename pointer at `DS:0x15e`.

> Correction to an earlier steer: `FUN_1000_2a37` builds a name from the `lev?*.map` template but the load it actually performs is template entry `+0xAA` = `PALFILS.0*?`. It is **not** the map load path.

```
u16 BE  count
u16 BE  UNKNOWN_map_header_word     (6 or 7 across the eight files)
count × u16 BE                      UNKNOWN_map_header_table
--- bulk: EXACTLY 21824 bytes ---
+0x0000  16384 B  two parallel 8192-byte tile planes, 128 cols × 64 rows
                    plane A (+0x0000) = tile graphic byte
                    plane B (+0x2000) = per-cell attribute / ID  (NOT boolean - see below)
+0x4000   1200 B  200 × 6-byte object records { u16 x, u16 y, u16 type }
+0x44B0   1840 B  message block: 40 × u32 BE offsets, then a NUL-terminated
                    string pool starting at +0x4550
+0x4BE0   2400 B  TRIGGER / EVENT TABLE — 100 records x 24 bytes (see below)
```

The four section sizes are hardcoded immediates in the parser (`0x2000` words, `0x258`, `0x730`, `0x4b0`) and sum to 21824 exactly — the same for all eight files, with only the variable header making total sizes differ (21834–21874).

### `UNKNOWN_map_header_word` and `UNKNOWN_map_header_table` — CLOSED: both are unread by the parser `[PROVEN]`

`CS:0x3711`–`0x3724`, the very start of `FUN_1000_36f8` after the shared-loader call, is the whole header handler:

```
3711  mov si,0x0
3714  lodsw si            ; AX := count (byte-swapped, native), SI auto-advances to 2
3717  add si,0x2          ; SI := 4   -- the SECOND +2, skipping the header_word FIELD ITSELF
371a  shl ax,1            ; AX := count*2
371c  add si,ax           ; SI := 4 + count*2   == exactly the header's total byte length
371e  mov di,0x3004        ; plane A destination
3721  mov cx,0x2000
3724  rep movsw es:di,si   ; the bulk copy starts at SI — i.e. AT the computed skip
```

**Neither the header word (offset 2) nor any entry of the header table (offset 4..4+count×2) is ever loaded into a register.** The `add si,0x2` is a blind constant advance past the header-word field, not a read of it, and the table is skipped by pure arithmetic (`count*2`) with no loop that touches its bytes. This is the identical shape this document already established for `POBJECTS +0x02` (dead, copied verbatim) and the `.DAT` word2 field (dead, proven never read) — a third instance of the same authoring pattern: **the map header is entirely unread by the shipped parser**, both the single word and the variable-length table. `count` (offset 0) is the only header field the code actually consumes, and only as an arithmetic skip length, never compared or stored anywhere.

This also confirms exactly *which* function threads `DS:0x15e` (the `.map` filename pointer `FUN_1000_36f8` consumes): `FUN_1000_2a37`'s own tail, `CS:0x2B0D`–`0x2B1B`, sets `SI := 0x298a` (the filename-template base, offset **0** — not `+0xAA`, which is the PALFILS entry a few instructions earlier at `CS:0x2A89`), stores it to `DS:0x15e`, then `call 0x1000:36f8` directly. So `FUN_1000_2a37` performs *both* loads in sequence — PALFILS first (`+0xAA`, `CS:0x2A97`), then the `.map` file (`+0`, `CS:0x2B1B`) — which sharpens this document's own earlier "correction" (*"the load it actually performs is template entry `+0xAA`… It is **not** the map load path"*): that was true of the code the earlier pass was looking at, but the same function goes on, a dozen instructions later, to also be the map load path. Both readings are needed to describe `FUN_1000_2a37` correctly.

The port already parses and exposes both fields (`gods-web/src/formats/map.js`) without interpreting them; this closure says that is the correct behaviour — there is nothing to interpret.

**Tiles are 32×16 pixels, so a level world is 128×64 tiles = 4096×1024 px.** Proven from the accessor's index math (`x` masked to a multiple of 32, `y` to 16, row stride 128) and corroborated by the data: object-record `x` maxes at 3946–4048 (< 4096) and `y` at 936–984 (< 1024).

Object `type` is validated against `< 0xC0` and indexes the objects table at `DS:0x2a4e`; consumed slots are marked dead with `0xFFFF` (tested by **sign**, `CS:0x9000 cmp word [si+0x4],0 / jns` — not by comparing to `0xFFFF`).

### `UNKNOWN_object_sprite` — CLOSED: `sprite = 170 + type` `[PROVEN]`

```
sprite = type < 0xC0 ?  170 + type
                     :  302 + (type - 0xC0)      // weapon pickup
```

drawn at `(x, y)`, top-left, no offset.

**The stamp loop, `CS:0x2234`** (file `0x23C4`) — the sprite index is written by the EXE, not read from the file:

```
2234  mov si,0xef78      ; the 132-byte category table
2237  mov di,0x2a4e      ; runtime descriptor array, stride 10
223A  mov cx,0x84        ; 132 object types
223D  mov bx,0xaa        ; 170  <-- the base
2240  mov [di],bx        ;   descriptor +0 = sprite index
2242  lodsb / cbw
2244  mov [di+0x4],ax    ;   descriptor +4 = category, sign-extended
2247  add di,0xa / inc bx / loop 0x2240
```

Weapons: `CS:0x1DC6 sub cx,0xc0 / add cx,0x12e` (302).

The map's big-endian `type` can index directly because **`CS:0x373E` byte-swaps the whole object section at load** — `mov di,0x7964 / mov cx,0x258 / lodsw / xchg al,ah / stosw / loop`, 600 words = 200 records × 3 fields.

**Four independent confirmations:**

1. `POBJECTS`' own big-endian `+0` id field reads `170 + type` — type 8 → 178 (`"pile of coins"`), 50 → 220 (`"spike arc"`), 69 → 239 (`"tablet…reveals clues"`, the known hint trigger).
2. The category table at `DS:0xef78` is **byte-identical to `POBJECTS` `+4` read big-endian, 528/528** across all four worlds, and `cat[24..27] = 3,3,3,3` — exactly the lever/switch off/on pairs this document established separately. Its 132 entries have the histogram `{2:45, 0:23, 5:22, 3:18, 1:17, 4:7}` (sums to 132). *(A workflow report gave `{0:83, …}`, which sums to 192 — it counted past the end of the 132-entry table. The figures above are re-derived here.)*
3. Rendering every shipped type beside its `POBJECTS` text: the five `"* key"` records draw as keys, `"gold mask"` draws a gold mask, `"ceramic vase with blue stripe"` draws a striped vase, and `"spike arc"` is the one 16×32 frame in the set.
4. All 1120 live objects across the 8 maps (130/136/170/171/118/115/130/150), 92 distinct types, 55 weapon pickups of 9 distinct types, map to sprite indices 170–312 — entirely inside the `objects` group (`POBJ1` #170–#330, `POBJ2` #331–#449).

⚠️ **`POBJECTS.004` uses base 175 — every record shifted +5.** That is the *same authoring drift* already recorded here for `PWEAPONS.004`'s `+0xc`/`+0x1e`, in the same file. It never takes effect because the stamp loop overwrites descriptor `+0` unconditionally — which is precisely what makes `CS:0x2234` load-bearing rather than a redundant re-derivation. **A port that reads the sprite index from the file draws every world-4 object 5 sprites off.**

`UNKNOWN_object_stamp_gap`: the loop stamps only 132 types, so a type in `132..191` would read an unstamped descriptor. Zero shipped objects fall in that gap.

**Draw order is three-way, not a two-way category split** `[PROVEN]`. Graphics export 32 (`VGA:0x06F0`) bubble-swaps adjacent pairs, and a swap pushes a record *later*:

```
06FD  cmp ax,0    / js  0x743   -> SWAP  (dead slot)
0702  cmp ax,0xc0 / jnl 0x743   -> SWAP  (weapon pickup)
072B  cmp word [si+0x4],3 / jz 0x775   -> no swap (k is cat 3)
0731  cmp word [si+0x4],5 / jz 0x775   -> no swap (k is cat 5)
0737  cmp word [di+0x4],3 / jz 0x743   -> SWAP  (k+1 is cat 3)
```

Settled order: **cat 3 and cat 5 behind → ordinary objects → weapons and dead slots on top.** A stable cat-3/cat-5 partition leaves the 55 weapon pickups where they started and gets their z-order wrong. Message-pool strings read as e.g. `"a trap door closes beneath you"`, `"you need the treasure key"`, `"the temple of the gods"`.

**Plane B is not a boolean flag** `[PROVEN by census]`. Across all 8 maps (65,536 cells): `0` = 54.9%, `1` = 39.5%, `2` = 2.7% — those three cover 97%, and rendered, `1` traces solid masonry while `2` forms vertical runs aligning with ladders in plane A. The remaining ~3% spreads thinly over **almost the whole byte range 3–254, only 2–15 occurrences each**, plus `255` appearing 108 times. That is the distribution shape of **per-cell entity/trigger IDs**, not an attribute enum — plausibly the link mechanism joining doors to keys and levers to gates (`POBJECTS` categories 2 and 3 are exactly keys and levers/switches). `UNKNOWN_planeB_id_range` is **CLOSED** — a cell value `v >= 3` is an **event id**, dispatching `DS:0x932c` record `v - 3`; see *`UNKNOWN_planeB_id_range` — RESOLVED* above, which confirms this census rather than overturning it.

### Section 4 is the trigger / event table `[PROVEN]`

Formerly `UNKNOWN_map_section4`. **100 records of 24 bytes** (`2400 = 100 × 24`), loaded by `FUN_1000_3731` to **`DS:0x7004`** with every `u16` byte-swapped BE→native (`0x4b0` = 1200 *words*). The object table lands immediately after at `DS:0x7964` (`0x7004 + 2400 = 0x7964`).

```
+0x00  u16 cond0_kind   u16 cond0_arg
+0x04  u16 cond1_kind   u16 cond1_arg
+0x08  u16 cond2_kind   u16 cond2_arg   // three conditions, AND-ed; an unused slot passes
+0x0C  u16 x                            // world pixels, observed max 4032 (< 4096)
+0x0E  u16 y                            // world pixels, observed max  984 (< 1024)
+0x10  u16 action                       // bit15 = flag; (action & 0x7fff) indexes SS:0x3592
+0x12  u16 action_arg
+0x14  u16 message_id                   // indexes the 40-entry message table at DS:0xac00
+0x16  u16 reserved                     // ALWAYS 0 in all 800 shipped records
```

The evaluator is at **`1000:39ae`**, in one of Ghidra's un-disassembled gaps — it has no function entry, so `decompile_function` fails and only `ndisasm` reaches it. It computes `record = 0x7004 + index*24` via an explicit **`mov bl,0x18` / `mul bl`** — the stride is proven by the code, not inferred:

```
39B6  mov ax,[si+0x2]        ; record index
39B9  mov di,0x7004
39BC  mov bl,0x18            ; stride = 24
39BE  mul bl
39C2  mov byte [0x3a3],0xff  ; three condition results, 0xFF = "unused / passes"
39C7  mov byte [0x3a4],0xff
39CC  mov byte [0x3a5],0xff
39D1  mov cx,[di]     mov dx,[di+0x2]   call 0x3a58   ; cond 0
39DC  mov cx,[di+0x4] mov dx,[di+0x6]   call 0x3a58   ; cond 1
39E6  mov cx,[di+0x8] mov dx,[di+0xa]   call 0x3a58   ; cond 2
39F0  mov al,[0x3a3]  and al,[0x3a4]  and al,[0x3a5]
39FB  js  fire                                        ; sign bit survives AND => fire
39FE  mov word [si],0xffff                            ; consume the slot
```

**Two dispatch tables, and they live in `SS` (`0x2f3d`), not `DS`** — the code reads them with `mov ax,[bp+0]`, which defaults to `SS`. Reading them as `DS` yields all zeros, so the segment choice is verifiable, not assumed:

| Table | `SS` offset | Entries | Indexed by |
|---|---|---|---|
| Action handlers | `0x3592` | **15** | `action & 0x7fff` |
| Condition handlers | `0x35b0` | **17** | `cond_kind` |

All 15 and all 17 entries are plausible near-code offsets (`0x3bc1`–`0x4276`), and the two tables are exactly adjacent — `0x3592 + 15*2 = 0x35b0`.

**Three independent cross-checks between the data and the code all land exactly**, which is why this is `[PROVEN]` rather than a plausible fit:

- `message_id` observed max across all 8 maps = **39**; the message table it indexes has **40** entries.
- `action & 0x7fff` observed max = **14**; the action jump table has exactly **15** slots.
- `cond*_kind` observed max = **16**; the condition table has **17** slots.
- The `+0x16` word is zero in **800/800** records, matching a reserved field.

Statistical structure discovery agreed with the disassembly before the disassembly was read: a stride sweep over all divisors of 2400 found stride 12 gave the only all-zero columns, and even/odd 12-byte halves then showed disjoint ranges (even ≤ 255 everywhere, odd carrying coordinate-scale values with an always-zero tail word) — i.e. one 24-byte record with two halves.

**Condition kind 1 is an object reference** (`0x3a69`/`0x3a94`): when the action's bit 15 is set, every condition slot whose kind is `1` has its arg used as an object id into the **10-byte** runtime descriptor table at `DS:0x2a4e` (`si = 0x2a4e + id*2 + id*8`), and the descriptor's `+0x4` category word is tested against `2` and `0`. Given the documented `POBJECTS` category map (`2` = keys), this is very likely the **key/door and lever/gate link mechanism** that the plane-B census pointed at — but the *gameplay* meaning is inferred from the category table, so treat `cond_kind == 1 → object id` as `[PROVEN]` and "it means keys" as likely, not proven. `UNKNOWN_map_trigger_verbs` is CLOSED — the remaining 16 condition kinds and 15 action kinds are decoded below, in *The 17 trigger CONDITION predicates* and *The 15 trigger ACTION verbs*; note their table there identifies `cond_kind` 1/2 as a plain inventory-contents check (`0x3e69`/`0x3e88`, arg tested against `DS:0x17e`…`0x184`), while `0x3a69`/`0x3a94` here is a *different* routine — the ACTION side's bit-15 inventory-consume post-processing, which happens to re-read a firing record's own kind-1 slots by the same field layout.

Plane A ↔ plane B correlation is independently strong — weighted dominant-B purity 0.79–0.95 against an independence baseline of 0.54–0.75 — confirming **both** planes decode correctly, since a wrong decode of either would destroy the correlation.

## The two filename tables `[STATIC — fully recovered from raw bytes]`

**File↔memory mapping for `GAME.EXE`: `file_offset = linear_address − 0xFE70`** (MZ header 25 paragraphs = 0x190; Ghidra image base segment `0x1000`). Verified byte-for-byte.

⚠️ **Use the right segment.** That formula takes a *linear* address, so you must resolve `segment:offset` first — and the three segments are used for different things: `CS=0x1000` (code), `DS=0x1ffd` (Table 1 and the data cluster), `SS=0x2f3d` (Table 2, the driver vector tables). A `DS` offset must be read as `1ffd:<off>` (file = `off + 0x10160`), **never** as `1000:<off>` — that resolves to a different linear address and silently returns unrelated code bytes. This has already produced at least one wrong turn in earlier analysis.

> `list_strings` returns only *defined* strings and **misses most of both tables**. Always dump raw bytes.

### Table 2 — `2f3d:581e`, the real asset manifest: 105 records

Reader is `FUN_1000_2619`. **Addressed via `SS`, not `DS`** — which is why `get_xrefs_to` finds nothing (entry sets `SS=0x2f3d`, `DS=0x1ffd`).

Records are **packed and variable-length**, not fixed-width:

```
record := ASCIIZ filename , 1..2 disk-id bytes , 0xFF
table  := record* , 0xFF          // sentinel at 2f3d:5ddc
```

**The bytes between filenames are floppy DISK NUMBERS, not load addresses or lengths.** Values are only 0..4: `1` = boot disk (engine, drivers, fonts, music, hiscores), `2` = worlds 1–2, `3` = worlds 3–4, `4` = intro font + payoff screen, `0` = no disk check (UI chrome), `2,3` = present on both. `FUN_1000_270a` validates the id against the floppy's **DOS volume-label** last character; `FUN_1000_2792` patches the `?` in `"GODS DISK ?"` for the swap prompt.

Reader quirks worth mirroring in a port: on a multi-id list with no match it returns the **last** id, not the first; it reads at most 3 value bytes per record; and it treats any byte with the **high bit set** as the list terminator, while end-of-table is an exact `CMP 0xFF`.

Three records are dead: `psmlfnt. pi1` at `2f3d:5869` is **malformed** (ASCII space where the extension's first char belongs) and can never match a file; `psmlfnt.dat` is **duplicated** (`5941` and `5b11`). All carry id 0, so the effect is benign.

### Table 1 — `1ffd:e994`, DS-relative: two ASCIIZ blocks split by `0xFFFF` at `1ffd:ea73`

- **Block A (`e994`–`ea70`)** — 20 wildcard/template names. **Eight match nothing on disk**: `\pcgods.dat`, `level?.spr`, `switches.0*?`, `intel.0*?`, `god?*.evt`, `\LEVEL.?`, `mblocks.0*?`, `teleport.0*?`. No `.SPR` or `.EVT` file exists at all — those are almost certainly **leftovers from the Atari ST/Amiga original or an internal level-editor toolchain**.

  ⚠️ **Two of the ten previously listed as dead are LIVE**: `trapdoor.0*?` and `hints.0*?` name real, running systems whose data was **folded into `PALFILS`** (`+0x1824` = 20 trap-door cells; `+0x1B58`/`+0x1BA8` = 40 hint triggers + text). They are template names for data that *moved*, not data that vanished. The earlier "`PCGODS.DAT` = hard-disk archive" hypothesis is **not supported**: no code path opening it was found, and it sits among nine other equally dead templates.
- **Block B (`ea75`–`eb4f`)** — 22 logical names/stems that resolve **once the `P` prefix is applied**: `backscr.pi1`→`PBACKSCR.PI1`, `payoff.pi1`→`PPAYOFF.PI1`, `joyl1.dat`→`PJOYL1.DAT`, stems `always`/`objects`/`guard?`/`introft`, plus the driver names.

Immediately after: two pointer arrays — `1ffd:eb50` (5 sound-driver names) and `1ffd:eb5a` (4 world names → `THE CITY`, `THE TEMPLE`, `THE LABYRINTH`, `THE UNDERWORLD`).

Runtime name construction uses the bare extension literals `.pi1` at `1ffd:0058` and `.dat` at `1ffd:005d`.

### Reconciliation

103 distinct names are referenced **and** present on disk. Only **two** literal references miss: `pjoypos.dat` and the malformed `psmlfnt. pi1`.

`UNKNOWN_asset_owner` — **CLOSED.** Of six assets originally unowned by any readable binary, three were resolved by live trace (`PONE.PI1`, `PSTBACK.PI1` belong to `INTROV.EXE` under any sound config; `PTITLE.RL` surfaces only when sound = Roland). The last three — `PDEMOSB4.SB`, `PGODMUS2.MUS`, `PMUSIC.MUS` — are now resolved by **static unpacking of the intro executables** (see *Unpacking the PKLITE binaries*): all three names appear as literals in `INTROE/INTROT/INTROV.EXE`. Every shipped asset now has a named owner.


# The camera, the plane-B event probe, and randomness

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## The camera `[PROVEN]`

Not a separate system — it is part of the state machine's per-tick epilogue, at `0x5ea4`–`0x5f76`, between the event probe and sprite selection. `DS:0x0a`/`DS:0x0c` are the scroll origin (the same pair the entity code uses for screen position).

```
5EA4  ax = [0x17a] - [0xa]        ; hero X on screen
5EAF  bx = [0x17c] - [0xc]        ; hero Y on screen
5EB3  cmp byte [0x32],0 / jz      ; UNKNOWN_camera_alt_path — the other branch
                                  ; calls 0x5e22 and skips the camera entirely
5EC0  cmp ax,0x50 / jg            ; ax <= 80  -> sub [0xa],4, clamp at 0
5ED4  dx = 0x140 - 0x70 = 0xd0    ; ax >= 208 -> add [0xa],4, clamp at 0xec0
5F33  cmp bx,0x50 / jng           ; bx > 80 -> dx = (bx-80)>>1 (SAR); if dx==0
                                  ;            inc [0xc]; add [0xc],dx; cap 0x360
5F59  cmp bx,0x20 / jnl           ; bx < 32 -> mirror, floor at 0
```

- **Horizontal: a hard dead zone, panned at a flat 4 px/tick.** Note the asymmetry — the left test is `<=` and the right `>=`, so the zone is **open on the left**: screen X in `(80, 208)`. Writing it closed makes the camera jitter on the boundary. `0xec0 + 320 = 4096` = the world width, exactly.
- **Vertical: proportional catch-up at half the excess, minimum 1 px**, dead zone screen Y in `[32, 80]` inclusive at both ends. The clamp `0x360 = 864` is exactly `1024 − 160`, i.e. it guarantees the **160-scanline** playfield region never runs past the bottom of the world.

⚠️ **Correction to an earlier revision of this file, which read "the playfield is 160 px tall".** 160 is the height of the *backdrop region*, not an established visible height. The three measurable facts, and what they do and don't settle:

| | measured | from |
|---|---|---|
| backdrop save/restore region | **160 scanlines** | `VGA:0x10E8 mov cx,0x1b80` = 7040 B ÷ 44 B/row |
| tile renderer coverage | **11 cols × 9 rows = 352 × 144 px** | `VGA:0x113D mov word [ss:0x400],0xa` and `0x1136 mov word [ss:0x402],0x8`, both `dec`/`jns` so N+1 iterations; the row advance `add dx,0x294` (660) plus the inner loop's own 44 = 704 = 44×16, one tile row |
| camera Y clamp | `0x360` = `1024 − 160` | `VGA` n/a — `GAME:0x5F51` |

**There is no hardware split screen.** `VGA.EXE` touches the CRTC at exactly two sites — `0xEB9` (start address, indices `0x0C`/`0x0D`) and `0xF39` (index `0x13`, Offset). Index `0x18` (Line Compare) is never written, so the status panel is drawn into the same page as the playfield rather than being a hardware-split region.

### `UNKNOWN_playfield_height` — CLOSED: the visible playfield is the full 160-row backdrop `[PROVEN]`

Measured live under DOSBox (`dosbox-automation` debug build, `GAME.EXE`, real gameplay — not the demo/attract mode) by fetching the raw 320×200 composed framebuffer directly (`GET /api/v1/video/frame?mode=raw`, the same bytes `screen_capture(mode:"raw")` returns) and reading it pixel-by-pixel. Two independent captures — a fresh level-1 spawn room and a ladder room several screens away, entirely different tile art in both — show the **identical** boundary: ordinary playfield tile art through row 159, then **row 160 is a bright, near-uniform decorative border strip spanning the full screen width** (sampled RGB triples like `(255,255,255)`/`(182,182,219)` at every column checked, in both captures), with the black HUD background and its icons/digits starting at row 161. The transition is exact to the pixel and reproducible across rooms/levels.

**So the visible playfield is exactly 160 scanlines (rows 0–159), matching the backdrop save/restore region — not the 144 px of tile-renderer coverage.** The status panel occupies the bottom 40 rows (160–199), with row 160 itself belonging to the HUD's own decorative frame, not the playfield. This settles which of the three previously-tabulated candidate figures (160-row backdrop / 144-row tile coverage / `0x360` camera clamp) is the real viewport: **160**, consistent with (and now independently confirming) the camera clamp `0x360 = 1024 − 160` already established from the code. The 16 px gap between the 144-row tile-compositing pass and the 160-row visible playfield (rows 144–159) is real but is a *different* quantity than "viewport height" — it's how much of the visible playfield the per-frame tile loop actually redraws, not how tall the playfield is; that band is presumably left showing the saved backdrop image, un-refreshed by tile compositing most frames. A port should size its camera-visible viewport at 160 px tall, not 144.
- **A scripted nudge exists** at `0x5ef1`: on world 3 sublevel `'a'`, once the hero enters the box `x ∈ [0x340, 0x400]`, `y ∈ [0x2a0, 0x330]`, a latch at `DS:0x3d5` is set and `camY −= 4` with `bx −= 0x14` applies on every later tick.

  **Live confirmation** `[PROVEN]`: reached world 3 sublevel A under DOSBox (via the safe breakpoint-at-`CS:0x2d9e` world-jump technique, patching `DS:0x42:=3`/`DS:0x43:=0` at the live level-load instruction), then, since the level's own plane/camera data was already correctly loaded, placed the hero directly inside the documented box with a single isolated write to `DS:0x17a`/`DS:0x17c` (`x=900`, `y=700`, both within `[0x340,0x400]`/`[0x2a0,0x330]`) — a position write rather than a raw EIP hijack, since only the hero's own coordinates were touched and the level state was untouched. `DS:0x3d5` read `0x01` (set) on the very next poll, confirming the box's screen coordinates and the latch mechanism exactly as documented. The read-back hero Y had already settled to 784 (gravity, still inside the box's Y range) with no further movement, and the camera's own Y origin (`DS:0xc`) held steady at a value consistent with the hero already sitting in the vertical dead zone, so the small continuous `-4`/tick nudge wasn't independently distinguishable from ordinary dead-zone rest in this observation — the latch-set event itself, the part explicitly named for live verification, is confirmed.

### `UNKNOWN_camera_alt_path` — CLOSED: a scripted pan-to-target camera mode `[PROVEN]`

`DS:0x32` is a small-integer mode selector for the camera epilogue, read at `CS:0x5EB3` (`!= 0` → skip the whole hero-follow camera and `call 0x5e22` instead) and twice more *inside* `0x5e22` itself (`cmp byte[0x32],2 / jg`, at `CS:0x5E4C` and `CS:0x5E84`).

**`CS:0x5e22` is a second, independent camera-mover**, pushing the scroll origin `[0xa]`/`[0xc]` toward a *fixed* target pair `DS:0x2ec`/`DS:0x2ee` instead of toward the hero:

```
5E22  bp := 0                              ; a per-call "both axes reached" counter
5E24  dx = [0x2ec] ; cmp dx,[0xa] / jz 5E53 ; X already at target -> count it, skip the step
5E2E  jg 5E37 (target > current -> ADD [0xa],4)  else  SUB [0xa],4     ; flat ±4/tick, same rate as the normal camera's X
5E3C  re-test dx==[0xa]; if so, SNAP [0xa]:=dx exactly (overshoot correction),
        then cmp byte[0x32],2 / jg 5E54 (skip the count when the mode is > 2) else INC bp
5E54  dx = [0x2ee] - [0xc]                  ; Y delta
        jg (target below) / else (target above): SAR dx,1 (halve, floor -1 on the
        odd remainder — the IDENTICAL proportional-catch-up shape the normal camera's
        own Y axis uses), ADD [0xc],dx
5E7A  re-test [0x2ee]==[0xc]; if so and byte[0x32]<=2, INC bp (Y counted as reached)
```

So `0x5e22` is not a stub — it is the *general form* of the documented per-tick camera (flat ±4 X, proportional-halving Y), just aimed at a scripted world-space point instead of the hero's screen position, and it tracks how many axes have converged in `bp` (unread by the caller in the bytes examined here, so its consumer is not chased further).

**`DS:0x32` values 1 and 3 are both set by the same per-world scripted-sequence machinery this document already documents** (`DS:0x34`/`DS:0x375` cutscene engine, `CS:0xC49C` installer, `SS:0x537a` per-world entry table): two call sites, `CS:0xCBCE`/`CS:0xCBD4` (target `0xb60,0x78`) and `CS:0xCD7B`/`CS:0xCD81` (target `0xa0,0x354`), each set `DS:0x2ec`/`DS:0x2ee` and then `cmp byte[0x32],0 / jnz skip / mov byte[0x32],1` (turn the alt-camera on, once, if not already on); a third site, `CS:0xCC07`, sets it to **3** after a scripted countdown (`DS:0x250`) expires and a driver export call runs, immediately followed by a self-modifying gate patch (`mov byte cs:[0xcbc7],0xc3`) disabling the routine that reached it — a one-shot step in a larger scripted sequence.

**`DS:0x32` is reset to 0 on hero spawn/respawn**, `CS:0x8D43`–`0x8D53`, inside the same routine this document already cites for state-4 spawn-idle and the health-bar refill (`CS:0x8d6`/`CS:0x84B`): `cmp byte[0x32],0 / jz skip`, else show a message (`DX = filename-template+0x4a`, the same `call 0x37e3` used for the .MAP/PALFILS message path) and then unconditionally `mov byte[0x32],0` — so any in-flight scripted pan is cut short and the camera returns to normal hero-follow the instant the hero dies or a level (re)loads reaches this point.

A port implementing only the dead-zone hero-follow camera diverges exactly during these per-world scripted sequences (values 1/3, targets `(0xb60,0x78)`/`(0xa0,0x354)` in the two sites read here) and is safe everywhere else, since `DS:0x32` starts at 0 (BSS) and is force-reset on every spawn.

### `UNKNOWN_camera_init` — CLOSED: the level-load camera origin is `spawnPos − (0x90, 0x48)`, clamped `[PROVEN]`

The real-gameplay half of this question — as opposed to the attract-mode teleport positions this document already had — is `FUN_1000_2189` (`CS:0x2189`–`0x21C1`), reached from three genuine gameplay contexts, none of them the demo cycler:

```
2189  ax -= 0x90 ; bx -= 0x48                 ; spawn/arrival point -> camera offset
218f  cmp ax,0 / jns / xor ax,ax              ; floor X at 0
2196  cmp bx,0 / jns / xor bx,bx              ; floor Y at 0
219d  cmp ax,0xec0 / jl / mov ax,0xec0        ; ceiling X at 0xec0  (world width - 320)
21a5  cmp bx,0x360 / jl / mov bx,0x360        ; ceiling Y at 0x360  (world height - 160)
21ae  mov [0xa],ax / mov word [0xc],bx        ; SET the scroll origin
21b5  cmp byte [0x3d5],0 / jz 0x21c1
21bc  sub word [0xc],0x20                     ; world-3 scripted-nudge latch: an extra -32 Y
21c1  ret
```

The clamp bounds are byte-for-byte the `0xec0`/`0x360` this document already establishes for the hero-follow camera's own per-tick clamp (*The camera*, above) — level-load init and per-tick tracking share one pair of world-edge limits, not two independently-authored ones. The `(0x90, 0x48)` offset is deliberate: it places the spawn point at screen `(144, 72)`, squarely inside the documented dead zone (`X ∈ (80, 208)`, `Y ∈ [32, 80]`) — so the first frame after a camera reset needs no catch-up snap, because the hero already sits where the per-tick clamp would leave him undisturbed.

**Three real callers, all previously untraced:**

| site | when | gate |
|---|---|---|
| `CS:0x8CA7`, inside `FUN_1000_8c34` | fresh level load | none — unconditional, the routine's first substantive act after clearing the phase flags and setting state 4 |
| `CS:0x08D3`, inside `FUN_1000_0845` | respawn after death (lives remain) | `cmp byte [0x32],0 / jnz` — skipped while a scripted alt-camera pan (see `UNKNOWN_camera_alt_path` above) is in control |
| `CS:0x100F`, inside `FUN_1000_0fac` | teleport-stone arrival | none — unconditional |

**The level-load call chain, traced end to end:**

```
CS:0x0092  FUN_1000_006f (main loop prologue)  -> CALL FUN_1000_8c34, unconditional on every level (re)entry
CS:0x8C48  FUN_1000_8c34                        -> [0x17a]/[0x17c] (hero pos) := [0x15a]/[0x15c]
CS:0x8C99                                        -> [0x16e]/[0x170]           := [0x15a]/[0x15c]  (2nd copy)
CS:0x8CA7                                        -> CALL FUN_1000_2189([0x15a],[0x15c])
```

`DS:0x15a`/`0x15c` — the level's own spawn point — is **not** derived from the `.MAP`/`PALFILS` data. It comes from a small, previously-undocumented **hardcoded per-world table at `DS:0xe8ca`: 4 records of `{u16 x, u16 y}`**, indexed by `DS:0x42` (world 1–4) inside `FUN_1000_2a37` (`CS:0x2AB5`–`0x2ACC`, the same function this document already credits with the `.MAP`/`PALFILS` loads). Read directly off the image:

| world | spawn `(x, y)` | camera `(x, y)` after the clamp |
|---|---|---|
| 1 | `(64, 944)` | `(0, 864)` — X floors at 0, Y ceilings at `0x360` |
| 2 | `(3888, 112)` | `(3744, 40)` — inside both ranges, no clamp |
| 3 | `(64, 48)` | `(0, 0)` — both floor |
| 4 | `(384, 496)` | `(240, 424)` — inside both ranges, no clamp |

All four spawn points fall inside the documented 4096×1024 world bounds, which is itself a check on the read — a wrong table offset or wrong world index would put at least one of the four outside `[0,4096)×[0,1024)`.

**Respawn recomputes from the hero's actual (possibly zone-adjusted) landing position, not the level's static spawn table.** `FUN_1000_0845` — reached only by `JMP` from `CS:0x0940`, itself the tail of the death-reset chain at `CS:0x09BB` (called from the main loop's death test, `CS:0x01C4`/`0x01C9`) — this closes this document's own previously-flagged loose end: *"the lives decrement `0x93A dec word [0x224]` was **not** traced to this path"* is exactly `CS:0x093A`, now traced. `FUN_1000_0845` starts from the second spawn-point copy `[0x16e]`/`[0x170]` that `FUN_1000_8c34` stashed at level-load time, adjusts it through a small `SS:0x365a`-resident, 14-entry, stride-6 arrival-zone table keyed by a plane-B probe at the rounded landing tile, and only then calls `FUN_1000_2189` with the final, possibly-nudged position. So a respawn's camera can differ from the level's own opening camera when the zone table nudges the landing tile.

**`UNKNOWN_respawn_zone_table` — CLOSED: an outward-radiating search for a plane-B cell tagged `0xFF`, and it identifies what that tag value is for `[PROVEN]`**

```
0873  ax=[0x16e] ; bx=[0x170]           ; the level-load spawn-point copy
087a  ax+=0x10 ; bx+=0x8 ; ax&=0xffe0 ; bx&=0xfff0   ; round to the tile origin (32x16)
0886  si = 0x5004 + (ax>>5) + ((bx&0xfff0)<<3)        ; the plane-B pointer at that tile — cx/dx keep the ROUNDED PIXEL origin
08a1  bp=0xd(13) ; di=0x365a                          ; 14 candidate zone entries, stride 6
08a7  bx = word SS:[di]                                ; this entry's own plane-B OFFSET (signed)
08aa  cmp byte[bx+si],0xff / jz 0x8b5                  ; the probed cell reads EXACTLY 0xFF -> found, use this entry
08af  di+=6 ; dec bp ; jns 0x8a7                        ; else try the next entry — falls through to the LAST entry if none match
08b5  cx += word SS:[di+2] ; dx += word SS:[di+4]       ; add the entry's own {dX,dY} to the rounded tile origin
08bd  [0x17a]=cx ; [0x17c]=dx                            ; final respawn position
```

⚠️ **Correction, live-verified in DOSBox a later session: the table is 15 records (90 bytes), not 14 (84).** The 14 records below are real and correctly transcribed — they are the CHECKED candidates, tried in order via `CS:0x08AA`'s `cmp byte[bx+si],0xff`. But the loop's own exit condition (`bp` seeded to `13`, `dec bp`/`jns 0x8a7` — 14 iterations) advances `di` ONE STEP PAST entry 13 before falling through to `0x8b5`, landing on a 15th record this document never transcribed: `{offset:0, dx:0, dy:0}` — a deliberate, clean all-zero sentinel, not adjacent garbage (confirmed by reading `SS:0x365a` for the full 90 live bytes, not just the 84 this table assumed). It is never itself tested for `0xFF`; the loop simply stops and applies it directly. So the TRUE fallback, when none of the 14 candidates below match, is **no offset at all** — land exactly on the rounded spawn tile — not entry 13's real `(-32, +48)`, which the next paragraph had wrongly credited as the fallback. Found by forcing a world-1 death live (writing `DS:0x192`/`0x19a` to 0 to trip the death test without combat) and reading `DS:0x17a`/`0x17c` after respawn: the hero landed at exactly `(64, 944)` — the rounded spawn tile, zero offset — not `(32, 992)` as the old (wrong) reading of this table would predict. This is not academic: `gods-web`'s own port, built on the 14-entry reading, had every world-1 death (PLEV1A has no `0xFF` cell near its own static spawn) landing at `(32, 992)` — row 62 of a 64-row map, where the hero's own 48px-tall ground probe reads 3 rows below (row 65) and finds nothing, because that row does not exist. The hero fell through the bottom of the level. Fixed in `gods-web/src/game/death.js`'s `ARRIVAL_ZONE_TABLE` (now 15 entries) and `docs/triggers-and-difficulty.md`'s own cross-reference — see there for the closure writeup.

Reading the table directly (`SS:0x365a`, 84 bytes, 14 × `{i16 planeBOffset, i16 dx, i16 dy}`) gives a clean, self-explaining search order — an outward ring radiating from the landing tile, checked in this exact sequence:

| # | plane-B offset | `{dx, dy}` | cell relative to landing tile |
|---|---|---|---|
| 0 | `+1` | `(32, 0)` | one right |
| 1 | `-1` | `(-32, 0)` | one left |
| 2 | `-128` | `(0, -16)` | one row up |
| 3 | `-127` | `(32, -16)` | one row up, one right |
| 4 | `-129` | `(-32, -16)` | one row up, one left |
| 5 | `+128` | `(0, 16)` | one row down |
| 6 | `+129` | `(32, 16)` | one row down, one right |
| 7 | `+127` | `(-32, 16)` | one row down, one left |
| 8 | `+256` | `(0, 32)` | two rows down |
| 9 | `+257` | `(32, 32)` | two rows down, one right |
| 10 | `+255` | `(-32, 32)` | two rows down, one left |
| 11 | `+384` | `(0, 48)` | three rows down |
| 12 | `+385` | `(32, 48)` | three rows down, one right |
| 13 | `+383` | `(-32, 48)` | three rows down, one left |

So on death, the hero's respawn is nudged to the **nearest tile in this small, downward-biased search pattern that the level marks with plane-B value `0xFF`** — which identifies, for the first time in this document, what the `0xFF`/255 outlier in the plane-B census means (*"255 appearing 108 times"*, under *Plane B is not a boolean flag*): it is a level author's explicit **"valid respawn arrival tile"** marker, distinct from the `≥3` event-id range and from ordinary `0`/`1`/`2` terrain codes. The search checks immediate left/right first, then one row up, then progressively up to three rows *down* with left/right diagonals at each row — clearly biased toward finding solid ground below the death point rather than above it. **If none of the 14 entries match, the loop falls through to a 15th, all-zero sentinel record — no offset at all, landing exactly on the rounded spawn tile** (corrected above; the search does NOT reapply entry 13's own real `(-32, +48)`, which is a meaningful checked candidate, not the fallback).

A port that seeds the scroll origin to `(0,0)` or to the raw, unclamped spawn point on every level load will visibly snap on the first frame in three of the four worlds (1, 2 and 4 — world 3's spawn point happens to clamp to `(0,0)` either way, so it alone matches by accident).

### `UNKNOWN_level_exit_destination` — CLOSED: a prior pass's own bit-dispatch mapping was wrong, and the real advance rule is now confirmed against every shipped `.MAP` `[PROVEN]`

This was the standing question of which of the 8 shipped `.MAP` files loads after a real (non-attract-mode) level-exit trigger fires, and whether anything advances the world/sublevel at all. It is now closed, and closing it required **correcting** rather than extending a previous pass's own work: that pass's manual bit-shift trace of `FUN_1000_694d`'s 32-iteration dispatch loop was wrong, and the error is exactly why it concluded "no code anywhere writes `DS:0x42`/`DS:0x43` from the real-gameplay level-exit flow" — a claim this section now refutes with a live, shipped-data-confirmed counterexample.

**The bit-dispatch mapping was mis-derived, and re-simulating it by hand (then verifying against a raw read of the table) gives a different, larger answer.** `FUN_1000_694d` pre-shifts the tested word (`DX`, read from a destination record's own `+0x1e` field) left by 4, then runs 32 iterations of `SHL DX,1` / test-carry / conditional-call, walking the 32-entry function-pointer table at `SS:0x35aa`–`0x35e8` in **decreasing** address order. Because the pre-shift discards the original value's top 4 bits, only the first 12 iterations can ever test a real (nonzero) bit: **iteration N (1-indexed) tests original bit `(12−N)`, calling the table slot at `0x35e8 − 2*(N−1)`.** So the correct mapping for the three slots the earlier pass named is **bits 11, 10, 9** — not 11, 6, 1 as previously claimed. The bit-11 slot (`0x35e8` → `FUN_1000_4828`) happened to be right in the earlier pass; bits 6 and 1 were not — the true owners of those iteration positions are bit 10 (`0x35e6` → `FUN_1000_69d7`) and bit 9 (`0x35e4` → `FUN_1000_6992`). This was verified two independent ways: a from-scratch manual `SHL`/carry simulation against the known `+0x1e` values below, and a direct raw-memory read of the table contents at `SS:0x35aa`–`0x35e8` (32 words, matching the already-documented dispatch shape exactly).

**Two further table slots matter and were previously undisassembled.** Continuing the same formula past the three already-named slots: iteration 11 (bit 1) is table slot `0x35e8 − 2*10 = 0x35d4`, holding **`FUN_1000_6b00`** — the already-documented world-increment-and-wrap function (`AL=[0x42] / INC AL / wrap 5→1 / [0x42]:=AL / [0x43]:=0`), previously believed reachable *only* from the attract-mode demo cycler. Iteration 4 (bit 8) is table slot `0x35e2`, holding **`FUN_1000_6ad4`** (freshly disassembled this pass — see the correction under *Keys are NOT collected by walking into them*, above: it clears the hero's 4-slot key inventory on a world-B completion).

**`DS:0x178` has two independent writers, not one.** `zones.js`'s own ACT4/level-exit handler already documents the first: an exit zone resolves its `arg` (2–5) into one of 4 pointers at `DS:0xe67c` and stores the pointer into `DS:0x178`, setting `DS:0x36a` ("exit pending"). The second writer is **`FUN_1000_8c34`** (`CS:0x8D22`–`0x8D31`, inside the level-load master routine this document already documents extensively under *`UNKNOWN_camera_init`*): `DS:0x178 := word[DS:0xe674 + (world-1)*2]` — a **world-indexed**, not arg-indexed, 4-entry pointer table, read unconditionally at every level (re)load. Reading `DS:0xe674` directly (16 bytes) gives 8 words: `0xe684, 0xe70e, 0xe7ba, 0xe820, 0xe6ea, 0xe796, 0xe7fe, 0xe8a8` — the **last four are byte-for-byte `DS:0xe67c`'s own four pointers** (the arg-indexed `EXIT_DESTINATIONS` table `zones.js` already ports), so `DS:0xe674` is a contiguous 8-pointer block: first 4 are its own world-indexed table, last 4 are simply a second reference to the arg-indexed table sitting immediately after it in memory. That much was already known going into this pass.

**The score-tally/bonus screen, `FUN_1000_6553`–`0x67b7` (220 instructions), fully disassembled:**

```
6553  mov si,word ptr [0x178]         ; the resolved destination record (from EITHER writer above)
6557  add word ptr [0x178],0x22       ; advance the STORED pointer by 34 bytes — see below, this does NOT track record boundaries
655e  mov dx,word ptr [si + 0x1e]     ; a field 30 bytes into the record — new, not part of the {param,always0,param2,text} shape zones.js already ports
6562  cmp word ptr [si + 0x4],0x0
6565  jnz 0x656e
656b  jmp 0x694d                       ; bail-out when the record's own +0x4 (="always0" in zones.js's naming) is nonzero — never true for the shipped LEVEL/GAME records, all of which read 0 there
656e  ... [full tally UI: time bonus from lives [0x224], health bonus [0x192], money/score digit
       display, "cha-ching" sfx 0x52f looped]
67b0  pop si
67b1  mov dx,word ptr [si + 0x1e]     ; re-read the SAME field, from the SAME (now-advanced) SI
67b4  call 0x1000:694d
67b7  ret
```

**`FUN_1000_694d`–`0x6972` (19 instructions) is a 32-iteration bit-dispatch loop over a function-pointer table at `SS:0x35aa`–`0x35e8`**, walked backward, and — per the correction above — the live entries actually reached from the shipped destination records' own `+0x1e` values are:

| bit | table slot | handler | role |
|---|---|---|---|
| 11 | `0x35e8` | `FUN_1000_4828` | sets `DS:0x43:=1` (sublevel B) and jumps into the level loader mid-body — **never fires**, see below |
| 10 | `0x35e6` | `FUN_1000_69d7` | password generator/display for the just-completed world (see below) |
| 9 | `0x35e4` | `FUN_1000_6992` | per-level-runtime-pool reset |
| 8 | `0x35e2` | `FUN_1000_6ad4` | clears the hero's 4-slot key inventory (category ≠ 0) — see the correction under *Keys are NOT collected by walking into them*, above |
| 1 | `0x35d4` | `FUN_1000_6b00` | **world-advance**: `[0x42]++` wrapped 5→1, `[0x43]:=0` |

⚠️ **The `SS:0x35aa` table physically overlaps this document's own already-documented 17-entry CONDITION-predicate dispatch table at `SS:0x35b0`** — confirmed by reading the raw bytes and comparing against the known `3bc1, 3e69, 3e88, ...` sequence, offset by 3 words. A structural curiosity (two dispatch tables sharing/adjoining memory), not previously noted.

**`FUN_1000_6992`–`0x69d5` (the bit-9 handler) is a full register-preserving per-level-runtime-pool reset**: it re-runs a subset of `FUN_1000_8c34`'s own per-level-init call sequence (`0x9026, 0xb0c3, 0xdbfb, 0x1221, 0x75a9`, a `world!=3`-gated destructible-block restore/clear pair `0x74db`/`0x74cd`, then `0x7e58, 0x80f7, 0x7f45, 0x8661, 0xde34, 0xde6f, 0xb263`) — i.e. it resets destructible blocks, System-A entity groups, and hazard walkers. `1000:69d6` is a lone `RET` byte; `1000:69d7` begins the distinct password-generator routine at bit 10 (see below).

**`FUN_1000_6ad4` (bit 8, freshly disassembled this pass) is a world-transition inventory-scrub, not previously catalogued anywhere in this document:**

```
6ad4  si = 0x17e ; cx = 4                        ; the 4-slot key inventory, already documented
6ada  ax = [si] ; or ax,ax / js 0x6af7           ; empty slot (0xFFFF) -> skip
6ae0  di = 0x2a4e + ax*2 + ax*8                   ; the runtime object descriptor, stride 10 (already-documented formula)
6aed  cmp word[di+4],0 / jz 0x6af7                ; descriptor category == 0 (potion) -> LEAVE IT
6af3  mov word[si],0xffff                         ; else (a KEY, or any non-potion category) -> CLEAR the slot
6af7  si += 2 ; loop 0x6ada                       ; next slot
6afc  call 0x1000:228e                            ; presumably the inventory-panel redraw
6aff  ret
```

`get_xrefs_to(1000:6ad4)` returns **zero** direct references — it is reached only through this register-indirect table dispatch, exactly the blind spot that let this document's earlier "the inventory survives every level change" closure stand uncorrected; see that correction above.

**`FUN_1000_69d7` (bit 10) is the password-generator/display routine this document already partially documented** — reads current world `[0x42]`, indexes the 4-word password-string pointer table `DS:0x42a`, and — only if that slot is currently empty — generates a fresh password and displays it. **Its own random-generation helper, `CS:0x6A6B`, was disassembled fresh this pass and is NOT a stub**: it draws three values through the shared mixer (`FUN_1000_2375`) and random source (`FUN_1000_3836`), each divided by `0x9d9` (2521) and incremented — a `random/2521 + 1` range-reduction that yields a near-uniform value in **1..26**, exactly this project's already-established 1-based hiscore-name alphabet (`A=1…Z=26`). So the generated password is composed of real, valid alphabet-encoded characters — the same encoding the `"ENTER A PASSWORD"` grid-entry screen's own comparison already expects — refuting the concern that this might be a dead/garbage producer the entry screen could never match. This **overturns** this document's earlier closure under *The password / level-select screen*, which stated flatly "nothing in this binary ever generates or grants a player a real password": something does, and it does so correctly.

**Which of the table's bits fire depends on a previously-undocumented record field, `+0x1e`, now read directly off all four `EXIT_DESTINATIONS` records (confirmed by `read_memory`, not decompiled):**

| record | address | `+0x1e` | bit 1 (`6b00`, advance) | bit 8 (`6ad4`, clear keys) | bit 9 (`6992`, pool reset) | bit 10 (`69d7`, password) | bit 11 (`4828`) |
|---|---|---|---|---|---|---|---|
| `LEVEL ONE` | `0xe6ea` | `0x0502` | ✓ | ✓ | — | ✓ | — |
| `LEVEL TWO` | `0xe796` | `0x0502` | ✓ | ✓ | — | ✓ | — |
| `LEVEL THREE` | `0xe7fe` | `0x0702` | ✓ | ✓ | ✓ | ✓ | — |
| `GAME` | `0xe8a8` | `0x0000` | — | — | — | — | — |

So **every real "LEVEL" exit advances the world, clears the key inventory, and generates/shows that world's password**; only finishing world 3 additionally resets the runtime pools (bit 9), and the never-wired "GAME" record (see the shipped-arg census below) fires none of the five handlers at all. `FUN_1000_4828` (bit 11) never fires from any of the four real destination records — see the correction under `UNKNOWN_sublevel_b_entry_point`, elsewhere in this document.

**The shipped `.MAP` census, run against the real ACT4 (level-exit) trigger records in all 8 files, confirms the mechanism end to end.** Decompressing all 8 maps (`blast.py`) and scanning every one of their 100 trigger records for `action & 0x7fff == 4` finds **exactly 3 live ACT4 records in the entire game**, one per world-B sublevel, and no others:

| map | record | `x,y` | `arg` |
|---|---|---|---|
| `PLEV1B` | #11 | `(3808, 384)` | **2** |
| `PLEV2B` | #95 | `(448, 960)` | **3** |
| `PLEV3B` | #84 | `(1184, 160)` | **4** |

`arg=5` never appears in any shipped record — world 4 has no level-exit trigger at all, consistent with it being the last world. Reading `DS:0xe67c` directly (the arg-indexed `EXIT_DESTINATIONS` table, `zones.js`'s own already-ported pointer array) confirms `arg−2` indexes it in exactly the order the record names imply: entry 0 (`arg=2`) → `0xe6ea` = **`LEVEL ONE`**, entry 1 (`arg=3`) → `0xe796` = **`LEVEL TWO`**, entry 2 (`arg=4`) → `0xe7fe` = **`LEVEL THREE`**, entry 3 (`arg=5`, never dispatched by shipped data) → `0xe8a8` = **`GAME`**. So finishing `PLEV1B` dispatches `LEVEL ONE`'s own bit set (world 1→2), finishing `PLEV2B` dispatches `LEVEL TWO`'s (world 2→3), finishing `PLEV3B` dispatches `LEVEL THREE`'s (world 3→4, plus the extra pool reset) — the world number embedded in the trigger's own `arg` and the world number the destination record's own name implies are the SAME world, i.e. **each world's completion trigger names that same world's own completion record**, not the next one; the actual advance is performed entirely by `FUN_1000_6b00`'s own `INC AL`, not by which record was dispatched.

**Net result: `UNKNOWN_level_exit_destination` is closed.** The real advance rule is: an ACT4 zone (present only in each world's own sublevel B, and only for worlds 1–3) resolves its `arg` into one of the 4 `EXIT_DESTINATIONS` records; the tally screen (`FUN_1000_6553`, below) reads that record's `+0x1e` field and dispatches through `FUN_1000_694d`'s bit table; bit 1 (set on every real "LEVEL" record) calls `FUN_1000_6b00`, which increments `DS:0x42` (wrapping 5→1) and zeroes `DS:0x43` — **so every real level exit advances the world by exactly one and forces sublevel A**, never sublevel B, and there is no per-record "go to a specific world" jump (the wrap is always `+1`, and reaching world 4 from `LEVEL THREE` is coincidental to `INC AL` rather than an explicit target). This refutes the prior pass's own "no code anywhere writes `DS:0x42`/`DS:0x43`" closure — that pass's bit-mapping error (bits 11/6/1 instead of 11/10/9) meant it was checking the wrong `+0x1e` bits against the known field values and concluding, wrongly, that nothing interesting ever fires.

⚠️ Below is the previously-published record-stream structural finding, which stands independently of the bit-mapping correction above (it concerns `DS:0x178`'s own pointer arithmetic, not the dispatch table) — **`DS:0xe674` and `DS:0xe67c` are two entry points into one shared, non-uniform-stride record stream — and the `ADD word[0x178],0x22` below does *not* track that stream's own record boundaries.** A 204-byte raw read starting at `0xe6ea` (`LEVEL ONE`'s own pointer target) decodes as a sequence of back-to-back records, each `{u16 param, u16 always0, u16 param2, char text[24]}` (30 bytes) followed by 2 or 3 trailing `u16` words:

| offset | address | record | param | param2 | trailer | size |
|---|---|---|---|---|---|---|
| 0 | `0xe6ea` | `LEVEL ONE` | 12 | 2500 | `+0x1e=0x0502, +0x20=0, +0x22=0xFFFF` (**3** words) | 36 |
| 36 | `0xe70e` | `WORLD ONE` | 6 | 500 | `+0x1e=0x0180, +0x20=0` (**2** words) | 34 |
| 70 | `0xe730` | `WORLD TWO` | 10 | 500 | `+0x1e=0x03C1, +0x20=8` | 34 |
| 104 | `0xe752`(calc) | *(blank text)* | 11 | 0 | `+0x1e=0x0180, +0x20=0` | 34 |
| 138 | `0xe776`(calc) | *(blank text)* | 15 | 0 | `+0x1e=0x0280, +0x20=0` | 34 |
| 172 | `0xe796` | `LEVEL TWO` | 16 | 2500 | — | — |

Every offset in the "address" column is arithmetic (`0xe6ea + offset`), not a second independent read, and **two of them land exactly on already-known pointers**: offset 36 (`0xe70e`) is `DS:0xe674`'s own world-2 entry, and offset 172 (`0xe796`) is `DS:0xe67c`'s own arg-3 (`LEVEL TWO`) entry — both hit precisely, with zero slack, which is what makes this a discriminating result rather than a coincidental byte pattern. **So the two tables' pointers are entry points into one pool of records that both world-load and level-exit share**, not two independently-authored tables as the header comment in `zones.js` previously implied.

⚠️ **This refutes the natural reading of `FUN_1000_6553`'s own `ADD word[0x178],0x22`.** `LEVEL ONE`'s record is **36 bytes**, not 34 — it carries a third trailer word (`+0x22 = 0xFFFF`) that `WORLD ONE`/`WORLD TWO`/the two blank records do not. Advancing the stored pointer by a flat `0x22` (34) from a 36-byte record lands **2 bytes short of the true next record**, inside `LEVEL ONE`'s own trailing `0xFFFF` word rather than at `WORLD ONE`'s header. So `[0x178] += 0x22` is not "walk to the next record in this stream" — record sizes are not uniform, and the arithmetic doesn't respect the boundaries this pass just mapped. Whatever that increment is actually for (the tally screen re-reads `[SI+0x1e]` a second time afterward, from the *advanced* `SI` — see the `67b1` line above — so it does do *something* meaningful with the shifted pointer) is now a narrower, still-open question, not the world/sublevel answer.

**Residuals, narrower than before:** the `DS:0x178`/`+0x22` pointer arithmetic's own purpose (it is not a record-cursor advance, per the refutation below, and what it actually threads through the tally screen's second `+0x1e` read is unresolved); why the world-indexed `DS:0xe674` table's own 4 entries resolve to text reading `WORLD ONE`/`WORLD TWO`/two blank records rather than something more obviously purposeful (likely just level-load flavour, distinct from the exit-side mechanism this section closes); and two further table slots this pass did not chase — bits 0/2–7/12+ and their handlers (`FUN_1000_6ad0`, `FUN_1000_6973`, `FUN_1000_6b21`, `FUN_1000_6bed`), none of which are ever set by any of the 4 shipped `+0x1e` values and so cannot matter for real gameplay, only for completeness of the dispatch table's own documentation.

The resolved mechanism (`FUN_1000_6b00`'s world-advance, `FUN_1000_6ad4`'s key-inventory clear, `FUN_1000_69d7`'s password generation, `FUN_1000_6992`'s pool reset — all four gated on the correct `+0x1e` bits of the correct, arg-selected destination record) is what a port's `zones.js` should implement in place of the "cycles the 8 shipped `.MAP` files in a fixed order" placeholder; see the project's own backlog memory for the port-side follow-up.

### The tally/bonus screen body and the password-reveal overlay, `CS:0x656e`–`0x6a5a` — fully disassembled and live-confirmed `[PROVEN]`

This section closes the bracketed, un-cited summary an earlier pass of this doc left for `FUN_1000_6553`'s own body (`656e`–`67b0`): `[full tally UI: time bonus from lives [0x224], health bonus [0x192], money/score digit display, "cha-ching" sfx 0x52f looped]`. By this project's own evidence-discipline rule, a bracket like that is an admission, not a citation. It is now fully disassembled and cross-checked live under DOSBox — a fresh boot straight into world 1, paused mid-frame, then `DS:0x178`/`DS:0x36a` set by hand to the `LEVEL ONE` destination record (the same isolated-write technique already used elsewhere in this document for the world-3 camera latch), continued, and screenshotted at each stage. No scripted play was needed.

**Correction to this section's own earlier citation of the `+0x4`/`+0x1e` record layout.** `CS:0x6562 cmp word[SI+4],0x0` was previously read as testing a field the header table above calls "always0" (`+2`, per the earlier `param`/`always0`/`param2`/`text` framing) and described as skippable "never true for the shipped records." A direct decompile of `FUN_1000_6553` refutes the field mapping, not the practical conclusion: the four fields are `+0` param, `+2` a genuinely-always-zero field the function never reads, and **`+4` is `param2`** (2500/2500/2500/25000, matching this doc's own already-published `param2` column) — so `CS:0x6565`'s `jnz 0x656e` fires on `param2 != 0`, which is true for all four shipped records, and the tally body always runs on a real exit exactly as previously concluded, just for the right reason.

**The three bonuses, confirmed both by decompile and by a live pixel match:**

| bonus | formula | source | live capture |
|---|---|---|---|
| time | `lives[0x224] × 2000`, added once if lives≠0 | `FUN_1000_67b8` | `"2 X 2000"` |
| health | `clamp(health[0x192],0,∞) × 80`, added once if health≠0 | `FUN_1000_67b8` | `"24 X 80"` |
| money | `floor(money32[0x194:0x196] / 8)`, added once if nonzero (⚠️ only the low word of the quotient is added — the high word is dropped; unproven unsafe at shipped money totals, just unguarded) | a real 32-bit divide, three `RCR DX:AX` — **not** the 3×`SAR` bug already documented elsewhere in this project | not exercised (money was 0 at capture) |

All three feed one shared 32-bit accumulator, `DS:0x234:0x236`. The screenshot (world 1, lives=2, health=24) shows `"LEVEL ONE COMPLETED"`, the two bonus lines above with their own icons, and `"BONUS 005920"` — `2×2000 + 24×80 = 5920`, an exact match, live pixels against the disassembled arithmetic. **No `PPAYOFF.PI1` (or any other) background blit exists anywhere in `FUN_1000_6553`'s own body** — confirmed both statically (no export-3/4 graphics-load pair in the disassembly; the function's two `CALLF` sites resolve to sound exports 10/11 via `(slot-0x52f6)/4`, not graphics) and live: the capture shows the tally text drawn directly over the still-visible game world (the hero and level tiles are visible underneath), not over a dedicated backdrop. `PPAYOFF.PI1`'s own consumer remains unlocated — a residual, not resolved by this pass.

**The bonus pool then counts DOWN, not up, while the HUD digits count up in lockstep.** A loop (`0x66fd`–`0x6798`) decrements the shared accumulator by 90/tick (dropping to 10, then 1, near zero so it lands exactly on 0), drawing it at a fixed position (x=172–252, six 16px-spaced digit cells, y=136, sprite=`digit+0x9c`) via `FUN_1000_67da` — a dedicated copy of the generic digit blitter, not a call into the shared one. Each successful step also calls `FUN_1000_0bbf`/`FUN_1000_0ab1`, the **same status-panel score/money digit blitters** `docs/drivers-and-memory.md` already names, so the HUD's own score/money figures visibly climb while the bonus pool drains — the live capture's post-tally HUD reads `005920`, i.e. the whole bonus landed in the displayed total. The `0x52f` "cha-ching" sfx (`FUN_1000_22ca(0x52f)`, the same generic sound-export call `zones.js` already cites for the teleport chime) fires once after each of the three static bonus-adds and once every 3rd countdown step — a fixed cadence, not a continuous loop despite the word "looped" in the earlier bracketed summary. `FUN_1000_6553`'s own body is fully open-loop otherwise: two hardcoded busy-waits (`FUN_1000_64d7`, 30 ticks after the time-bonus add, 50 ticks at the very end) plus one wait per countdown step, no keypress anywhere — duration scales with the size of the bonus pool.

**The password reveal is real, and it is a separate, input-gated overlay — not part of `6553`'s own body.** `6553`'s tail (`67b0`–`67b7`) hands off through the already-documented bit-dispatch (`FUN_1000_694d`) into `FUN_1000_6b00` (world-advance) and — earlier in dispatch order, since bit 10 is iteration 2 of the 32-iteration walk while bit 1 is iteration 11, so `DS:0x42` still holds the just-completed world when this runs — `FUN_1000_69d7` (bit 10, password-gen). Read in full (`1000:69d7`–`0x6a5a`, 45 instructions):

```
69d7  SI := word[0x42a + (world-1)*2]         ; this world's own password-slot pointer
69e3  CMP byte[SI],0 / JNZ 0x6a48 (RET)        ; slot already filled -> nothing to do
69e8  CALL 0x6a6b                              ; generate: AX/BX carry the 3 raw 1-26 codes
69eb  word[SI]  := BX                          ; chars 1-2
69ed  byte[SI+2]:= AL                          ; char 3
69f1  CALL 0x921b                              ; ONE ordinary game tick+render (keeps the
                                                ;   world visibly moving/drawing underneath)
69f7  CL := byte[0x42] + 1 + 0x5d              ; = (completedWorld+1) + 0x9c after 224e's
                                                ;   own "+0x3f" glyph bias -- lands EXACTLY
                                                ;   on the digit-sprite base (0x9c=156) this
                                                ;   same document's tally-body section just
                                                ;   established; a second, independent check
                                                ;   on the dispatch-order claim above
6a00  byte[0xed28] := CL                       ; patches the digit into a fixed template
6a04-6a2f  draw 3 lines via FUN_1000_646f (walks a NUL-terminated string, glyph=byte+0x3f
           via FUN_1000_224e -- the STATUS-PANEL font convention, not PSMLFNT's identity
           map), reading a template pool at 1ffd:0xed22 directly off the image:
             "LEVEL   PASSWORD\0"   (0xed22, the middle space patched at ed28 with the digit)
             "   \0"                (0xed33, the 3-char password slot, converted from raw
                                      1-26 codes to real 'A'-'Z' ASCII by FUN_1000_6a5b
                                      in between the first and second draw)
             "FIRE TO CONTINUE\0"   (0xed37)
6a35  SI := 0x43e                              ; CLOSES UNKNOWN_ds_43e_palette (see below)
6a3a  CALL 0x3596                              ; palette fade-in, this document's own
                                                ;   already-established 8-pass thunk
6a3d  CALL 0x24f0                              ; flush stale keyboard input
6a40  CALL 0x252c                              ; BLOCKS: wait for FIRE press, then release
                                                ;   (two poll loops on byte[0x382] bit 7) --
                                                ;   this is the actual "FIRE TO CONTINUE" gate
6a43  CALL 0x3211 / JC 0x6a49                  ; disk-save path, see aside below
```

Live-confirmed by the same forced sequence: after the tally screen's countdown finished, the next capture reads `"LEVEL 2 PASSWORD"` / `"PME"` / `"FIRE TO CONTINUE"`, drawn over the same still-visible game world, and firing/releasing space actually advanced play (into a `"LOADING THE TEMPLE"` interstitial, then live world-2 gameplay) — an end-to-end confirmation of the whole chain from a single forced write, not three separate guesses. This closes the question left open by the tally-body section above ("does anything draw the password") and **overturns the framing in `zones.js`'s own header comment**, which says "there is no 'ENTER A PASSWORD' screen here to type this back into" as if the game never shows it — it does, just not as a dedicated screen: it is a HUD-style overlay shown once, the first time a world is freshly completed, gated on an actual keypress. Port-side, `zones.js`'s `generatePassword()` is a reasonable simplification of `FUN_1000_6a6b` (three `random/2521+1` draws) but does **not** reproduce that function's own up-to-100-retry uniqueness check against the other two stored passwords — a known, minor divergence, not chased further.

**`UNKNOWN_ds_43e_palette` — CLOSED.** This document previously found a sixth palette-fade call site with `si=0x43e` (instead of the five other sites' `si=0x86`) and left its own source table untraced. It is exactly this password-reveal fade (`6a35`/`6a3a` above) — closed by this same live trace, not a separate pass.

**Aside, `[STATIC]`, not pursued further per this pass's own scope:** `FUN_1000_3211`/`FUN_1000_27e5` (reached only when `DS:0x384 > 1`) XOR-obfuscate the 3 password slots into a second 16-byte block (`DS:0x526`–`0x534`) and write it out; on failure (`JC` back in `69d7`), a template at `1ffd:0xed48` — `"\x11\x11 disk error - password not saved..."` — posts through the already-documented `CS:0x434e` priority mailbox. `DS:0x384` is almost certainly the already-known "installed to hard disk" mode this project's own top-level `CLAUDE.md` already cites from `READ.ME` ("high-score/password saving work only when installed to hard disk, not from the low-density 3.5\" floppy"). None of this has a port-side equivalent — a browser port has no disk write to fail — so it is recorded here for completeness and not carried into `zones.js`.

## The plane-B event probe rounds X but floors Y `[PROVEN]`

`0x5fab`, called from the epilogue at `0x5ea0`:

```
5FB2  add ax,0x10 / and ax,0xffe0     ; col = (X + 16) >> 5   -- NEAREST column
5FB8  and bx,0xfff0                   ; row = Y >> 4          -- FLOORED
5FBE  sar ax,1 (x5) / shl bx,1 (x3) / si = 0x5004 + ax + bx
5FD2  cmp byte [si],2 / jna           ; skip unless > 2
```

The asymmetry is deliberate: the hero is 32 px wide so his **centre** picks the column, while Y is floored to the row his head is in. A port using `X >> 5` fires **every** plane-B event 16 px late — measured across all 8 shipped levels, all 1923 event cells shift by exactly 16 px.

### It's not one cell, and it's not edge-triggered `[PROVEN]`

A closer read of the full body, `CS:0x5FAB`–`0x6021` (prompted by a report that a lever-gated hazard-kill "should work but doesn't" — see the lever/`ACT6` census in `docs/triggers-and-difficulty.md`), found this document's own earlier framing of "the probe" as a single `(col, row)` lookup was incomplete:

```
5FD2  cmp byte[si],2 / jna 5fda / call 0x6022         ; cell (col, row)      — the one already documented
5FDA  si += 0x80 ; cmp/jna/call                        ; cell (col, row+1)
5FE6  si += 0x80 ; cmp/jna/call                        ; cell (col, row+2)
5FF2  ax = heroX & 0x1f ; cmp ax,0x10 / jl 0x6021       ; skip the rest unless the hero is past
                                                        ;   the halfway point of his own 32px column
5FFD  si += 0xfeff  (== si -= 0x101 == -2 rows, -1 col) ; cell (col-1, row)
6001  cmp/jna/call                                     ; cell (col-1, row)
600D  si += 0x80 ; cmp/jna/call                        ; cell (col-1, row+1)
6019  si += 0x80 ; cmp/jna/call                        ; cell (col-1, row+2)
```

So every frame this probes **3 cells** (the hero's own column, one and two rows below it) and, whenever the hero is past the midpoint of his own tile, **3 more** in the adjacent column — up to 6 cells, not 1 — each independently dispatched (`CALL 0x6022`) if its value is `> 2`. `CS:0x5EA0` itself has **zero callers** (`get_xrefs_to`) — it's reached purely by fall-through from the preceding camera/hero-position epilogue, which is unconditional, per-frame code — so this whole scan runs **every single tick**, for every frame the hero spends anywhere near an event cell, with **no comparison against a previous frame's cell anywhere in the body**. Re-dispatching an already-fired event is harmless only because the trigger evaluator itself is idempotent (`CS:0x39FE` marks the event record `0xFFFF` on first success, and `CS:0x6034`'s `or ax,ax/js/jz` skips a consumed or empty record on every later attempt) — so the *design* tolerates being re-tried 15 times a second, and the game relies on exactly that: a trigger's conditions can start false and become true while the hero never leaves the tile (e.g. flips a lever while standing right next to it), and the very next frame's re-scan catches the change.

**A port that gates this on cell-entry (`if (currentCell === lastCell) return`) is not faithful** — it will miss exactly that case: flip a lever while standing on or beside the dispatch cell without stepping off and back on, and the kill/spawn/etc. never (re-)fires, even though the original would catch it on the next frame. This was caught because `gods-web`'s own `events.js` `step()` has exactly that gate, commented "edge-triggered, like the original" — which this pass shows is not so; see the port-side note below.

#### The three rows are the hero's body, and adjacent-row triggers fire together — confirmed live `[PROVEN]`

Rows `R`, `R+1`, `R+2` span 48 px, which is exactly the hero's height (the same 48 px the lever toggle's own proximity box uses, `heroY ∈ [objY−32, objY+16]`). So the scan covers the hero's whole body, and **two triggers on adjacent rows both fire on the same tick**. That is not a corner case — it is how `PLEV1A`'s lever-3 spike pair is authored: trigger #7 hangs off a plane-B cell on **row 59** (value 40) and trigger #8 off one on **row 60** (value 42), and a hero standing on that ledge (world `y = 944`) has row 59 at his head and row 60 at his waist. One probe removes both spikes.

Verified under DOSBox rather than inferred, on a level already past those triggers: both event records were re-armed by hand (`DS:0x932c + 37*4` and `+ 39*4` restored to `{3,7}` and `{3,8}`), the hero was placed at `(416, 944)` with lever 3's bit set, and **exactly one** probe was run — breakpoints on the body's entry (`CS:0x5FAB`) and its `RET` (`CS:0x6021`), so no other frame could interfere. Both records came back consumed (`0xFFFF`) from that single invocation, and `SI` ended at `0x6E91` = plane-B base + col 13 + row 61 × 128, the exact end of a three-row walk. `416 & 31 = 0`, so the left-column arm was correctly skipped.

**This is the second half of the same port bug.** `gods-web` probed one cell, so it killed the spike at the hero's head and left the one at his waist — reported from play as "there are two spike hazards but only one gets removed". Fixed in `game/events.js`; the regression check drives `step()` itself and asserts both spikes die from a single call.

## Randomness — a replayed table, not a PRNG `[PROVEN]`

`GAME.EXE` has only 14 `MUL`/`IMUL` instructions total, all register-operand: **there is no LCG or multiply-based generator.**

1. **Seed** (`1000:236c`, once at init): `sub ah,ah / int 1Ah / mov [0x122],dx` — the low word of the BIOS tick count. **Wall-clock seeded, so the original is not reproducible run-to-run.** `get_xrefs_to` on `1000:236c` finds exactly one caller, `FUN_1000_229a` (`1000:22ac`), itself called exactly once, from `entry` (`1000:0042`) — so `[0x122]` is **never reseeded again for the life of the process**. Every later table regen (one per level load) and every password draw (`FUN_1000_6a6b`, below) consumes from wherever the mixer chain was left by whatever ran before it.
2. **Mixer** `FUN_1000_2375` — a hand-rolled bytewise `RCR`/`XOR` shuffle over `[0x122]`. **`UNKNOWN_random_mixer` — CLOSED, `[PROVEN]` live in DOSBox.** This was never actually a registered `UNKNOWN_*` in this project's own ledger — it lived only as an inline TODO in `gods-web/src/game/random.js` ("the MIXER is NOT ported... UNKNOWN_random_mixer"), an untracked loose end of the same shape as items 20/21 in `docs/open-questions-history.md`. Full disassembly (`1000:2375`-`23a5`, 26 instructions):
   ```
   2377  mov ax,[0x122]        ; AX = seed
   237a  mov dl,al             ; DL = low byte
   237c  mov cl,ah             ; CL = high byte
   237e  mov al,cl             ; AL = high byte too
   2380  rcr al,1
   2382  xor cl,al             ; clears CF
   2384  rcr al,1
   2386  rcr al,1
   2388  xor cl,al             ; clears CF
   238a  rcr al,1
   238c  xor dl,al             ; clears CF
   238e  rcr al,1
   2390  rcr al,1
   2392  and al,1              ; clears CF
   2394  shl dl,1
   2396  rcl cl,1              ; consumes SHL's carry-out
   2398  add al,dl
   239a  mov dl,al
   239c  mov ah,cl
   239e  mov al,dl
   23a0  mov [0x122],ax        ; new seed
   23a5  ret
   ```
   Bit-exactness of an `RCR`/`RCL` chain depends entirely on what sets `CF` going in. Tracing every flag-producing instruction between the function's three call sites and the mixer's own first `RCR` shows `CF_in = 0` for **every single call** the table generator makes (258 of them: `XOR DX,DX` precedes the loop's first call, `OR DX,AX` precedes every later one, `CMP DX,0` precedes the first forced-zero call, and `AND AX,0xFE` precedes the second) — so for this consumer the function is a pure, external-state-free map from the 16-bit seed to the next one. (Its only other caller, the password generator `FUN_1000_6a6b`, has `CF_in=0` for two of its three calls too; the third follows a `DIV`, whose `CF` this project has not pinned down — moot for the table, and password generation is not ported.)

   **Live verification.** Breakpointed `FUN_1000_37f6`'s own entry (live `CS 0x036D`, resolved by a `mem_scan` byte-signature match on the mixer's own 49 bytes rather than trusted from an arbitrary pause — a bare pause landed mid-driver code with zero relation to `GAME.EXE` on the first attempt, a useful reminder that CS at a random stop is not evidence of anything). Read the real entry seed, `[0x122] = 0x6189`. Ran to the function's `RET` and dumped the live 512-byte table at segment `0x136A` offset `0x7e14` (the live equivalent of `1ffd:7e14` — confirmed the SAME segment serves both `DS` and `ES` here, so the earlier framing "1ffd" for the DS-relative `[0x122]` and "1ffd:7e14" for the ES-relative table were always the same live segment, not merely Ghidra's shared numbering). Running the disassembled algorithm above 256 times from `0x6189`, then applying the two forced-zero draws exactly as `FUN_1000_37f6` does, reproduces **all 512 bytes byte-for-byte**, forced zeros (at byte offsets 190 and 380 in this capture) included. Ported verbatim as `mix16()` in `gods-web/src/game/random.js`, with a regression check (`GodsRandom(0x6189)` against this exact capture) in `gods-web/src/verify/checks.js`.

   **A genuine, newly-discovered property of the algorithm**: any seed `< 128` produces a pure *doubling* sequence in the table's early entries. With the seed's high byte at 0, the whole `RCR`/`XOR` chain reduces to a no-op (everything XORs against 0), and the only real arithmetic left is `SHL DL,1` — so each mix just doubles the low byte until it first reaches ≥ 128 (about 7-8 draws), only then does the chain genuinely mix. `[0x122]` in the real game is a live BIOS tick count, uniform over 0..0xFFFF, so this fires on well under 1% of boots and was presumably never noticed; it is a real weakness of this 1991 hand-rolled shuffle, not a port bug — confirmed by hand-deriving the closed form for the H=0 case and checking it against `mix16()`'s own output, not separately observed live against `GAME.EXE` in this specific regime. Also newly confirmed, and rigorous rather than merely plausible: a brute-force sweep of all 65536 possible seeds through `mix16()` finds exactly ONE input maps to 0 — 0 itself — so the "0 is a fixed point, and only 0 can reach it" retry-hang property under *Table*, below, is exact, not just an unverified corollary of "0 is a fixed point."
3. **Table** `FUN_1000_37f6` — 256 words into `1ffd:7e14`, regenerated **once per level load** (called from `1000:2b2a`, right after the `.MAP` loader). The draw cursor `[0x160]` is reset to 0 immediately after the 256-word fill succeeds (`CMP DX,0` / `JNZ` on an `OR`-accumulator over every drawn word), **before** the two forced zeros are written — so a port that reads the cursor between fill and forced-zero would see it mid-reset. Retried (re-enters from the top, continuing the same mixer chain — *not* restarting from the original seed) if the fill comes out entirely zero; live-tracing this session showed that is a real, if narrow, hang risk in `GAME.EXE` itself, since 0 is a genuine fixed point of the mixer (see above) — a boot whose BIOS tick count happens to be exactly 0 makes this function retry forever. Then exactly two more mixer draws pick the entries forced to zero: the first `AND AX,0xFE` (byte offset 0..254, i.e. word index 0..127 only — the first half of the table only), the second `AND AX,0x1FE` (byte offset 0..510, any of the 256 words) — so "1-2 entries forced to zero" is exact: two draws, one net zeroed entry only when they collide on the same word index.
4. **Draw** `FUN_1000_3836` — **59 call sites**, the game's only random source: return `[0x7e14 + [0x160]]`, then `[0x160] = ([0x160] + 2) & 0x1FF`.


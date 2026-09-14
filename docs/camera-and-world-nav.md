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

So on death, the hero's respawn is nudged to the **nearest tile in this small, downward-biased search pattern that the level marks with plane-B value `0xFF`** — which identifies, for the first time in this document, what the `0xFF`/255 outlier in the plane-B census means (*"255 appearing 108 times"*, under *Plane B is not a boolean flag*): it is a level author's explicit **"valid respawn arrival tile"** marker, distinct from the `≥3` event-id range and from ordinary `0`/`1`/`2` terrain codes. The search checks immediate left/right first, then one row up, then progressively up to three rows *down* with left/right diagonals at each row — clearly biased toward finding solid ground below the death point rather than above it. ⚠️ **If none of the 14 entries match, the loop still applies entry 13's own `{dx,dy}`** (`di` simply reaches its last value when `bp` goes negative, and `0x8b5` runs unconditionally) — so a level with no `0xFF` tile anywhere near a given death point silently offsets the respawn by `(-32, +48)` from the rounded landing tile regardless, rather than falling back to the raw landing position.

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

## The plane-B event probe rounds X but floors Y `[PROVEN]`

`0x5fab`, called from the epilogue at `0x5ea0`:

```
5FB2  add ax,0x10 / and ax,0xffe0     ; col = (X + 16) >> 5   -- NEAREST column
5FB8  and bx,0xfff0                   ; row = Y >> 4          -- FLOORED
5FBE  sar ax,1 (x5) / shl bx,1 (x3) / si = 0x5004 + ax + bx
5FD2  cmp byte [si],2 / jna           ; skip unless > 2
```

The asymmetry is deliberate: the hero is 32 px wide so his **centre** picks the column, while Y is floored to the row his head is in. A port using `X >> 5` fires **every** plane-B event 16 px late — measured across all 8 shipped levels, all 1923 event cells shift by exactly 16 px.

## Randomness — a replayed table, not a PRNG `[PROVEN]`

`GAME.EXE` has only 14 `MUL`/`IMUL` instructions total, all register-operand: **there is no LCG or multiply-based generator.**

1. **Seed** (`1000:236c`, once at init): `sub ah,ah / int 1Ah / mov [0x122],dx` — the low word of the BIOS tick count. **Wall-clock seeded, so the original is not reproducible run-to-run.**
2. **Mixer** `FUN_1000_2375` — a hand-rolled bytewise `RCR`/`XOR` shuffle over `[0x122]`.
3. **Table** `FUN_1000_37f6` — 256 words into `1ffd:7e14`, regenerated **once per level load** (called from `1000:2b2a`, right after the `.MAP` loader), retried if all-zero, then 1–2 entries forced to zero.
4. **Draw** `FUN_1000_3836` — **59 call sites**, the game's only random source: return `[0x7e14 + [0x160]]`, then `[0x160] = ([0x160] + 2) & 0x1FF`.


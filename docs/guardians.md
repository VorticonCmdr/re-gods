# Guardians (trigger selector 11, `DS:0x34`)

This file inherits the evidence tags and citation conventions from `CLAUDE.md`.

## Selector 11 — `CS:0xC49C` `[PROVEN]`

Selector 11 consumes its event (`mov word [si],0xffff`) and then does the following:

```
C4A0  [0x375] = 0xFF
C4A5  [0x34]  = 1                 ; guardian mode
C4AA  cs:[0xAD88] = 0xC3          ; the selector-2 turret walker becomes a bare RET
C4B0  call 0xC505                 ; free the 15 x 10-byte pool DS:0xD030 (+6 := -1)
C4B3  jmp [SS:0x537A + (world-1)*2]
```

The per-world entries are w1 `0xC4C6`, w2 `0xC54C`, w3 `0xC516` and w4 `0xC5EA`. Each one installs these:

| Slot | Meaning |
|---|---|
| `[0x284]` | the per-tick driver |
| `[0x286]` | a hook |
| `[0x288]` | the respawn re-entry |
| `[0x28A]` | health |
| `[0x28C]` / `[0x28E]` | x / y |
| `[0x290]` | frame |
| `[0x292]` | an SS-relative script pointer |

Each entry also NOPs one of the three world gates, `CS:0xD211`, `0xDA62` or `0xD557`.

## What `DS:0x34` switches in the main loop `[PROVEN]` (`FUN_1000_006F`; `CS:0x9240` is a copy)

| Site | Effect when `[0x34]` ≠ 0 |
|---|---|
| `CS:0x01E5` | calls `[0x286]` |
| `CS:0x01FC` | outside world 2, skips the object pass: activation `0x1187`, the walk `0x1432`, the popup `0xBF80`, the chest burst `0x132D` |
| `CS:0x0223` | `0xAD88` is already patched to RET by `C4AA` |
| `CS:0x0226` | skips the rock pools `0xB1C2`/`0xB3CE`/`0xB4E7`, `0x1280` and kill smoke `0x3CC7` |
| `CS:0x0272` | skips the whole enemy suite (System A/B, nests, statues, PAT, ce64, the flash pool...) and calls `[0x284]`, then `0xD211`, `0xDA62` and `0xD557` |

The `0x0272` test runs after the player, whose epilogue fires the plane-B event. So a guardian installed this tick already drives this tick. The `0x01FC`, `0x0223` and `0x0226` tests run earlier and see the old value.

Respawn (`CS:0x086D`) calls `[0x288]` while `[0x34]` is set.

**The turret patch outlives the guardian `[PROVEN]` live.** A byte search of `GAME.EXE` for `88 AD` finds exactly two writers of `cs:[0xAD88]`: `C4AA` (`0xC3`, RET) and `CS:0x8E70` (`0x90`, NOP). `0x8E70` is straight-line code in the per-level init `FUN_1000_8C34`, whose only caller is `CS:0x0092`, the level-entry prologue. The respawn path does not reach it, and neither does the A→B switch at `FUN_1000_484E`. So the selector-2 turrets stop moving, firing and drawing when selector 11 fires, and stay that way after the guardian dies (`[0x34] = 0`) until the next level load. Before this was found, `gods-web` gated its turrets on the guardian being alive and kept drawing their last frame while they were skipped. Both are now fixed (`turretWalkerRet` in `main.js`). Live (2026-09-28): during `PJOYG2`'s world-2 fight `cs:[0xAD88]` read `C3`, stayed `C3` through the menu phase of the next demo, and read `90` from `PJOYL3`'s world-3 load on. In the world-4 fight (`w4worm.py`'s setup) the death was forced (`C978` → `jmp C758`): `[0x34]` went to 0 and `cs:[0xAD88]` still read `C3` forty ticks later, on the same level.

## World 1 `[PROVEN]`

This section is ported as `gods-web/src/game/guardian.js`. Per tick it matches the `PJOYG1` capture in health, x, frame, live-spit count and spit checksum.

- **Entry (`C4C6`):** driver `0xD866`, respawn `0xC4E9`, health 1500, spawn position (0xF20, 0x230). The script is at `SS:0x53C2`: 70 steps of (frame, signed dx), terminated by `0xFF`. `gods-web` generates it from live memory with `tools/gen-guardian-data.py`.
- **Driver (`D866`):**
  - On ticks where `[0x36C]` = 0, it reads the next script step, adds dx to x and loops at the terminator.
  - Frame 16 spawns a spit on the following tick (`0xD9F8`). A script tick that lands on 16 does not spawn one.
  - Frames 3, 9 and 10 play sfx `0x1E39`.
  - It draws sprites `0x1C2 + 2·frame` and `+1` (two 32-px halves).
  - `CS:0xA9E4` runs at (x+16, y) with a 0x30×0x60 box and bp = health. With `[0x34]` set the contact is never reported, so the grid scan always follows it.
  - Negative health → `0xD923` (seven random-offset bursts, a 10-item treasure burst, `[0x34]`=0, the level-end countdown). The death is not ported yet.
- **Spit mover (`DA63`, behind the `DA62` gate):**
  - Record: `{x, y, vy(+4), frame(+6), vx(+8)}`. A spit spawns at (x, y+0x16) with vy 8, vx −6.
  - **Movement:** each tick x += vx, y += vy, then vy++.
  - **Terrain:** while falling it probes plane B. Inside a solid cell it bursts (`0xA633`). On solid ground it bounces (vy −11) and splits into a free record whose vx is the parent's vx −1 (+1 back on an odd random draw). This is the demo's first random draw after the guardian appears, at `PJOYG1` cursor 122.
  - **Screen:** screen x ≤ −16 or > 0x168 frees the record.
  - **Hero:** `0xDB4E` at hot point (x+10, y+8) costs the hero 2 and frees the record.

## World 3 `[PROVEN]` structure, ported

The port matches the `PJOYG3` hero for the whole demo; the random stream matches to cursor 838.

- **Entry (`C516`):**
  - driver `0xD53B`
  - respawn `0xC533`
  - health 0x8CA
  - spawn position (0x2C0, 0x70)
  - script `SS:0x5468` (generated from live memory)

  The respawn does **not** free the pool. It restarts the script but keeps the health and the shots already in flight.
- **Script (`D778`):** 3-byte records (frame, signed dx, signed dy), one record per tick.
  - Command `0xFD` lifts the hero 16 px, starts the camera-x shake counter `[0x2D2]` = 8 (±4 on `[0x36C]`, applied at `CS:0x01CF` before the snapshot) and does `[0x270]` −= 8. It plays sfx `0x4B39`.
  - Any other command byte (`0xFE`) rewinds the pointer 0x5D bytes unless the guardian's tick-start x is right of the hero.
  - x is clamped to [0x60, 0x2C0].
  - Entering frame 0, 8 or 0x19 plays sfx `0x2839`.
- **Shots (`D609`/`D6DE`):**
  - They use the `DS:0xD030` pool and are moved by the driver itself.
  - A shot fires on the tick the frame *becomes* 0x1D (left) or 0x27 (right).
  - Each tick: vy += 1, and the frame cycles on `[0x36C]`=0. Screen y ≥ 0xC0 frees the record.
  - A hero hit (`DB4E`) costs 2+2 and draws 8 randoms for two sparks.
- **Hit box (`D5C0`):** `A9E4` at (x+0xC, y), 0x28×0x58.
- **Not ported:** the death (`D923`) and the corpse gate (`D557`).

## World 2 `[STATIC]`, ported; the hero matches `PJOYG2` to cursor 415

Spec source: a disassembly of the live code segment, re-read by hand for `CE87`, `D1BA`–`D2DD`, `D2DE`–`D3A2`, `D3A3`–`D530` and VGA export 37.

- **Entry (`C54C`):**
  - driver `0xCD7B`
  - respawn `0xC57B`
  - arm health `[0x2D4]` 2000, body health `[0x2D6]` 2400; `[0x28A]` = max(0, arm) + body
  - the `D211` gate NOPed
  - position (0x280, 0x370)
  - head offset (−28, −30)
  - arm angles `[0x2E0/2E2/2E4]` = 0x100/0x130/0x150, all speeds +0x18

  The respawn resets all of this except the healths, the jaw counter `[0x2F0]` and `[0x32]`.
- **The scripted camera `[0x32]` (`CS:0x5E22`):**
  - The driver sets the target (0xA0, 0x354) and sets `[0x32]` = 1 if it is 0.
  - While `[0x32]` ≠ 0, the player epilogue (`CS:0x5EB3`) runs `5E22` instead of the normal camera, with no dead zones and no clamps. X moves a flat 4 px per tick; Y halves toward the target.
  - `[0x32]` counts 1→2 on arrival, then 2→3→4.
  - `CS:0x08C5` skips the respawn camera re-init while it is set.
  - Because the probe (`5FAB`) runs before the camera step, the pan starts the tick after the install.
- **Movement (`CE87`):**
  - Once `[0x32]` > 2 and the guardian sits on its target, it retargets: the hero, or the first marker (`DS:0xB5DC`) of type 0x6D. It then applies (+0x70, −0x3C) and, right of x = 0x80, the lean (bx sar 2 added to y, bx sar 3 subtracted from x). Two random draws add ±16.
  - It moves 1/4 of the distance per tick, with the leftward step capped at 12.
  - During a fireball burst it retargets every tick and does not move.
- **Head (`CF52`):**
  - Script `SS:0x5742`: 24 records (dx, dy, frame), stepped on `[0x36D]`=0 and read every tick.
  - Frame 2 spawns a fireball every tick, into the first free record of 8 in `DS:0xD030`; the burst counter `[0x2DE]` caps it at 7. The second fireball plays `0x3C29`.
  - Neck balls at the body anchor, the midpoint and the head anchor.
  - Jaw: `[0x2F0]` steps on `[0x36D]`=0; when it wraps to 0 it plays `0x0B26`. Table `SS:0x57D0`.
- **Arm (`D3A3`/`D49C`):**
  - P0 = (x+0x3C, y+0x1F); P1/P2/P3 come from SINCOS.DAT at the three angles, before this tick's advance. An angle's speed flips when the new angle is ≤ 0x100 or ≥ 0x258.
  - Ten Bezier samples (BEZIER.DAT, `w = bswap(w) >> 1`, samples 0, 20, …, 180) are evaluated by graphics export 37: Σ (c·p) >> 15, 16-bit.
- **Claw (`D2DE`):**
  - Its frame comes from `DS:0xDC78`/`0xDC8C`, indexed by (angle A − 0x100) / 0x18 and chosen by the sign of A's speed.
  - Frame 1 on a `[0x36C]` tick fires a zap into the line-hazard pool (`DBC6`, n = 6). It first makes two jitter draws (y, then x), even when the pool is full. The zap starts at the t=0.9 arm point and aims at the jittered hero +8/+6.
- **Hits (`CD9D`):**
  - `A9E4` runs over six body boxes (head, three neck balls, jaw, body), then, while the arm lives, over REC6 and the ten 8×8 arm points. A part already dead still contact-damages and plays `0xF22`.
  - While arm ≥ body, the arm gives `arm sar 1` to the body every tick.
  - REC6's x,y (`SS:0x4870`) has no writer found, so the port uses 0, the screen's top-left (`UNKNOWN_w2_rec6_xy`).
- **Fireball gate (`D212`):**
  - Each tick x −= 7, y += 5. The size t goes 7→0 on `[0x36D]`=0; the phase is `[0xD092]`+i mod 3.
  - Screen y ≥ 0xB0 frees the record and draws 2 randoms for a spark.
  - A `DB4E` hit costs 2. While the hero is invulnerable, a fireball passes through him.
- **Not ported:** the death (`CE78` → `D923`).
- **`UNKNOWN_w2_rec6_xy` is closed, `[PROVEN]` live.** `SS:0x4870/0x4872` read (0, 0) throughout a live `PJOYG2` fight (cursors 383–385). REC6 really is a 16×16 box at the screen's top-left corner.
- **The attract demo is not repeatable across cycles, `[PROVEN]` live.** Nothing initialises the jaw counter `[0x2F0]`, so each `PJOYG2` fight starts where the previous cycle's fight left it. That changes REC4's height and so which shots hit. Evidence:
  - Three live DOSBox runs of `PJOYG2`, all fed the same injected random table, first disagree with one another at cursors 380, 385 and 429.
  - The port starts the jaw at 0, the static-image value, which is the first fight after boot. It matched one run (cursors 368–388) field for field, `[0x2F0]` included.
  - Seeding the port's jaw to the value another run implies carries it to cursor 429 against both of the other runs.

  ~~At least one more carried value is involved (`UNKNOWN_w2_attract_carryover`)~~ — **closed.** It was a port bug: shots froze during the hero's death burst, whereas the death driver `CS:0x09BB` keeps stepping them. With that fixed and the jaw seeded (3 for the live run, 2 for the older capture), `PJOYG2` matches DOS exactly for the whole demo.

## The deaths, worlds 1–3 `[PROVEN]` live, ported

Each world has its own way in: world 1 via `D91E js`, world 2 via `CE78`, world 3 via `D5E3` → `D5E5`. The shared `CS:0xD923` then:
- **Turns off the running starburst.** `[0x34D]` = 0.
- **Sets off seven starbursts.** Two draws each: by = (r & 0x3F) + 0x10, then bx = r & 0x3F; each burst is at (x+bx, y+by).
- **Sets `[0x374]`** = 0xFC.
- **Ends guardian mode.** `[0x34]` = 0.
- **Throws ten items** from the aligned list `DS:0xD90E` at (x+0x18, y+0x28) through `CS:0xD992`, the chest burst's record format, with two draws per item.
- **Arms the score gate.** `[0x3BE]` = world × 20, and `CS:0xD9CA` is un-RETed.
- **Plays sfx `0x6422`.**

The gate (main loop `CS:0x02D5`) then pays +500 a tick for those ticks, starting on the death tick, and restores the level music.
- **World 2** first pops item 0x1F at (0x160, 0x380) (`CS:0xCE78`).
- **World 3** afterwards un-RETs the corpse gate `CS:0xD557`: the body falls, vy +1 capped at 0x10, to y = 0x70 and stays. It then pops item 0x1F at (0x220, 0x80) and increments the difficulty scalar `[0x365]` (`CS:0xD5F7`, reached by fall-through; see `docs/triggers-and-difficulty.md`).

Proven by forcing deaths live, patching the code for one tick (`gods-web/tools/attract-capture/forcedeath.py`): world 1 via `D866 → D923`, world 3 via `D5C0 → D5E5`. The port matched DOS for 6–8 ticks in the random cursor, starburst array, treasure burst, `[0x374]`, `[0x3BE]`, score and popup arc.

## World 4 (`CS:0xC5EA`) `[PROVEN]` live, ported

Read from the live code dump, every routine disassembled in full (`C5EA`–`CD7A`); the spec a subagent drafted (`[WF]`) was re-read against those bytes and matched, with one arithmetic slip (the death treasure lands at x = 0xBA0 + 0x18 = **0xBB8**, not 0xBBA). No demo reaches this fight. `gods-web/src/game/guardian4.js`.

- **Entry** `C5EA` sets base y `[0x250]` = 0x180, health `[0x28A]` = 6000, the driver `C978`, the respawn re-entry `C624`, the hook `CBC7` (un-RETed) and RETs the ending gate `CC67`. **`C624`** (also run on every respawn) frees the boulder, sets the thrower countdown `[0x2E0]` = 120, the worm health `[0x30E]` = 750, rewinds the `PBUMLIST` cursor `[0x310]` = `SS:0x4F20` and lays out the worm with delays 0xAA + 2r. It does **not** reset `[0x3DB]` (worm destroyed), `[0x250]` or the health.
- **The rise, hook `CBC8`** (main loop `CS:0x01E5`, before the object pass; not in the hero's death ticks). It points the scripted camera at (0xB60, 0x78), saves the clean background block (graphics export 19, `VGA:0x0D9D`), draws `0x1D0` twice and ten body parts `0x1C2`+k from `SS:0x5024` {dx, dy, kind}, then `[0x250]` −= 2. Below 0xB0 it clamps, sets `[0x32]` = 3 and calls export 18 (`VGA:0x10AD`), which snapshots the screen and sets `[0x32]` = 4; the hook RETs itself. That is **105 hook calls**. From then on export 0 blits the snapshot instead of the tiles, so **the body is never drawn again**: it lives in the frozen background.
- **The driver `C978`**, in random-draw order: sfx `0x05C5` on its first call; `[0x2E0]`−−, and while negative the thrower `CB44` (pose `0x1CC`/`0x1CE` at fixed screen x 0x40/0x60; at phase 3 it launches the boulder if none is alive; phase ≥5 resets the countdown to 40: a **56-call cycle**, first launch on driver call 128); the boulder `C9D7`; the worm `C655`; the body box `C9A5`.
- **The body takes no weapon damage.** `C9A5` calls `A9E4` (0x40 × 0x60 at (0xB90, `[0x250]`), bp = health) and `pop dx`s the result away. It still contact-damages the hero.
- **The rise's sound.** The driver's first call plays `0x05C5` (`CS:0xC985`), and the rise end stops it: `CS:0xCBFC` `mov al,0xC5 / call 0x22D6`, sound export 5, which is *stop sound* in `ADL.EXE` (see `docs/drivers-and-memory.md`). Ported (`hook`'s `stopSfx`, `WebAudioBus.stop`).
- **The boulder `C9D7`** (record `DS:0xD030`): rolls +6 x a call, falls 1 to a floor at `[0x250]`+0x49, frames `0x1DB`+0..4, with a launch overlay `0x1D1`–`0x1D3` while x ≤ 0xBBC. Its `A9E4` forces `[0x34]` = 0 (so contact kills it) and **never loads bp**: it gets whatever graphics export 1 returned for the last sprite (0 once anything was blitted, `0x5256` when culled). `A9E4` preserves AX on every exit, so the following `sub ax,[0xa]` is the boulder's x. Past screen x 0x110, or when killed, it bursts: frame `0x1E0` (0x1E1 is never drawn) and two zaps (`DBC6`) aimed at screen (0x148, 0x4F).
- **The worm `C655`**: eight 14-byte records at `DS:0xCF40`, all on **one** path, the last record of `PGOD04.PAT` (start (0xBC0, 0xE6), 456 signed-nibble step bytes, two steps a call). Record 1 draws the head (`C870`): one `PBUMLIST.BIN` byte a call, `id = 0x1E2 + (b&7)` (+0x11, +1 more for bit 4), offset from `SS:0x5382` by `b&7`, anchored on the previous segment processed (`[0x2F2]/[0x2F4]`); left of screen x 0x81 it is clipped at y 0x41. Segments are `0x1F2` (export 2), hidden when left of 0x81 and below 0x41. All eight share the health `[0x30E]`; a kill sets `[0x3DB]` and every segment explodes (two draws each, `0x5B`+17 frames). `[0x3DA]` counts +1 per finished record and −1 per finished explosion: **+8** (all reached the end) starts a new worm with the same health (delays 0x46 + 2r); **−8** costs the guardian **1000** (`C776`) and starts a new worm at 1000. The 7th destroyed worm takes 6000 below zero.
- **The death `C758`**: `[0x28C]` = 0xBA0, `[0x28E]` = `[0x250]`, the shared `D923` (score gate `[0x3BE]` = 80), un-RET `CC67`, and `C64C` zeroes the timer `[0x11E]`. It runs **inside** the worm step, so `C9A5`'s body test (now with `[0x34]` = 0 and bp < 0: kill sound `0x0F22`) comes after the death's draws. No popup, no difficulty bump.
- **The ending, `CC67`** (main loop `CS:0x01E2`, every live-hero tick): at timer 149 it sets `[0x36A]` (the tally, which there reads the chain's final `"GAME"` record, 25000 bonus, no bits); from 200 on one message every 64 ticks, `DS:0xEF4C` → *"you have destroyed" / "the last great guardian." / "reluctantly, the gods bestow" / "upon you the greatest gift -" / "immortality" / "collect your gift"*, each with the mailbox barrier `[0x394]` cleared; once the last has finished (`[0x393]` = 0) it drops **ten extra lives** (object id 0x35 = type 42) at (0xB8A + 0x17k, 0x70) through `C041` and stores lives + 10 in `[0x250]`; when the hero has banked them all, `[0x34A]` = 1 — the game-completion path `CS:0x037A`. Every tick it also pastes the saved clean block back (export 20), erasing the frozen guardian.
- **Sprites.** The guardian one-shot (`CS:0x053B`) loads `guard<N>` from the cursor `DS:0x130..0x134`, which `CS:0x2BB1` saved after `objects`: it **overwrites `level<N>`'s creature sprites from descriptor 0x1C2** (all four worlds; `gods-web` had been drawing guardians with creature frames). Checked against the art: PGUARD41 = body parts, thrower skulls, boulder 0x1DB–0x1DF and burst rings 0x1E0/0x1E1; PGUARD42 = heads, the segment at 0x1F2, more heads. Palette words 2–15 equal the level's, and `CS:0x055D`/`0x0563` re-apply the slot-0/1 override.

**Live confirmation** (`gods-web/tools/attract-capture/w4live.py`, `w4compare.mjs`). A `joyg` attract load stopped at `CS:0x2A37` with `[0x42]` patched to 4 loads 4A (so `PGOD04.PAT` lands in `SS:0x500`), and the cycler's own `0x2DF1` reload then enters 4B. With playback off (`[0x3BD]` = 0) and the hero written onto the selector-11 cell (0xC60, 0xC0), 600 fight ticks were logged at `CS:0x0154` and replayed through the port: **0 differences** in the thrower, three boulder launches (driver calls 128 + 56k) with hero contact, the worm path and head cursor (record 0 first steps on call 172, `PBUMLIST` from call 174), contact damage (5 per boulder, 28 per worm segment), the 18 death ticks (driver without hook) and the respawn (`C624`, then `921B`'s driver call). The install tick runs the driver but not the hook, and the rise ends on hook call 105. Weapon hits on the worm and a worm escape were not exercised (the hero had no input and died first).

**The worm's escape and hits, live** (`w4worm.py`, `w4wormcompare.mjs`, 2026-09-28). The same setup, with the hero's health rewritten to 24 at every tick start so he never dies. Each tick logs the damage grid at the driver's entry (`CS:0xC978`), `DS:0x160` there and every decode: the hit cell `[SI]` at `CS:0xAB41` and the damage `DS:0x1EA` at `CS:0xAB45`. ⚠️ AL at `AB41` is the scan's row counter, not the tag.
- **Escape** `[PROVEN]`: with no hits, all eight records reached the path's end at t = 413 and `C700` restarted the worm with waits 70, 72, … 84 and the same health. The port matches for 699 ticks with 0 differences.
- **The hero's shots** (FIRE held every other tick through `[0x383]`): they only hit the body's box. `C9A5` discards its result, so the health doesn't move. All 21 decodes fall on the same ticks in the port.
- **Worm hits** `[PROVEN]`: tag `0xFC` was written under a live worm segment at `CS:0xC978` on ticks 790–999. With `[0x34]` set it decodes to 50 damage (a starburst particle). The worm's health fell 750 → 712 → … → 66 → −1, and every segment exploded with two random draws. The `−8` count cost the guardian 1000 and restarted the worm at 1000 health. This happened twice (6000 → 4000), with an escape in between. Replayed with the logged grid and random stream, including the hit sparks' draws and ADL's draw for the kill sound `0x0F22`: 1099 ticks, 0 differences.
- ⚠️ In this setup the scripted camera pans about 4 px a tick from the level start and reaches the fight around t = 690. So anything that needs the worm on screen happens late.

- **The boulder's bp** (formerly `UNKNOWN_w4_boulder_bp`) — **closed**. It is 0 in every reachable case: the camera is pinned at (0xB60, 0x78) from about tick 96, before the first launch, so every boulder and overlay draw is on-screen and above the 0xA0 clip line, and export 1 returns 0. Live, every boulder contact cost exactly 5 = `((0+1)>>5)+5`. So a boulder dies to any weapon hit or to contact. Export 1's full `bp` return is now read (`VGA:0x1D07`–`0x1EB4`, `[STATIC]`) and ported as `guardian4.js`'s `export1Bp`: the thunk's `BP` = `0x5256` survives a cull (x ≤ −0x20, x ≥ 0x140, y ≥ 0xC0, or y ≤ −0x30 while `[0x34]` = 0); otherwise `BP` = the sprite's rows (`desc+2` + 1), returned as-is when the sprite is clipped away whole (above the top, or at/below the `SS:0x40A` clip line, 0xA0 in play) and counted down to 0 by any draw. `[0x34]` is 1 at every boulder draw (the driver only runs while it is set, `CS:0x0272`, and the death that clears it runs later, in the worm step).
- **Camera versus rise** (formerly `UNKNOWN_w4_camera_vs_rise`) — **closed: there is no stale snapshot.** The camera arrives mid-rise (mode 2 at tick 95, then 4 at tick 96, while y is still 0xC0). Graphics export 0 ends in `VGA:0x115F` `cmp [0x32],2 / jnz / jmp 0x10AD`: on a mode-2 frame it renders the tiles and then falls into export 18, which snapshots them into `ADBA:0` and sets `[0x32]` = 4. From then on the background is that clean snapshot, for **any** scripted camera (world 2's too). The rise end (`CC07` sets 3, then export 18) re-snapshots with the body drawn on it, and export 19's clean-block saves come from the clean snapshot.
- **The restore block** (formerly `UNKNOWN_w4_restore_block`) — **closed.** Export 0 renders 11 tiles × 32 px into a 352-px (44-byte) back buffer from column `camX & ~31` and row `camY`, with the display's fine scroll `camX & 0x1C`. With the camera at (0xB60, 0x78) both offsets are 0, so export 19/20's 13 bytes × 112 rows at 0x9A4 are screen x 32–135, y 56–167 (world 0xB80–0xBE7, 0xB0–0x11F). Every opaque pixel the rise draws lies inside it: part 6 reaches x 0xBEF, but its last 8 columns are transparent in `PGUARD41`. A forced live death erased the body completely.
- **The respawn tick.** `CS:0x08F5` calls the alternate tick body `921B` on every respawn. It is a whole tick (tape poller, player, hook, driver) minus the level timer, the `[0x2FA]`/`[0x174]` countdowns, the camera shake, `CC67`, the brood `894D`, the statue `7CBD`/`7B68`, `D9CA`, the message countdown `4569` and the tally check. ⚠️ An earlier note here said the port was missing "one extra hook and driver call per respawn". That was wrong: `921B` runs the tape poller, so the port's first tick after a respawn *is* its counterpart by cursor. `gods-web` now skips those systems on that tick.
- **The ending, live** (`w4death.py`, `w4ending.py`). The death was forced for one call (`C978` → `jmp C758`). `[0x3BE]` = 80 paid +500 a tick from the death tick. At n = 149 the tally ran, taking the chain's current record. The messages posted at n = 200 + 64i, each shown 30 ticks (`[0x393]`); the gifts dropped at n = 551, with `[0x250]` = lives + 10. The nearest gift reached the hero at n = 575.
- **Game completion, `CS:0x037A`** `[PROVEN]` live (`w4payoff.py`), ported (`gods-web/src/game/payoff.js`).
  1. Export 8 fades out. The `introft` group loads from the level cursor `DS:0x130` (over descriptor 0x1C2), and `PPAYOFF.PI1` loads into segment 0x2888 and is blitted. Its own palette is byte-swapped into `DS:0xDCE` and faded in by export 9.
  2. Eight pages from `DS:0xEF58`: *the way to mount olympus / lies open*, *you may now claim your place / among the gods*, *enjoy your life / it will last forever* (twice), *so what will you do / with this gift_*, *journey again to the city / if you dare*, *this time your task will / be harder*, *press fire to continue*. Each page has two lines at y 12 and 30, x = 164 − 4·len (`0x04C5`), drawn as sprite `ch + 0x1CB` (= `PINTROFT` record `ch + 9`, the intro's story font), 8 px apart. A page holds until the 60 Hz `[0x39]` reaches 250 (about 4.2 s live). The port's page 1 is pixel-exact against the DOSBox screen.
  3. The game waits for fire (`[0x382]` bit 7).
  4. Export 8 fades out again, and the game **restarts at world 1A**, keeping score and lives. The difficulty goes up by one, clamped to 2..4. Money (`[0x194/0x196]`), keys (`[0x17E..0x184]`), weapons (`914C`), the arc (`95B5`) and the familiar (`C440`) are reset, and `CC67` is RETed again. Live: `[0x365]` 1 → 2, lives 10, score kept.

**Three loose ends, closed:**
- **`[0x2F0]` is one word for both guardians** `[PROVEN]` live, ported. World 4's rise writes its base y there on every hook call (`CBCB`), leaving 0xB0, and nothing else resets it. World 2's jaw masks it to 0..3 only on a stepping tick (`D0F5`/`D0F9`, when `[0x36D]` = 0). On any other tick `D115` indexes `SS:0x57D0 + 4·[0x2F0]` unmasked, past the 4-entry table into Table 2's static filename records.
  - Live: the value 0xB0 carried from the world-4 fight into the next `joyg2` fight. That fight's first call happened to be a stepping one (→ 1).
  - Forcing 0xB0 on a non-stepping call made the jaw draw sprite 0x763A at y 24945 (entry 0xB0 = `"xtra"`, i.e. +0x7478, +0x6172). Export 1 culls it, and REC4 moves with it. The next stepping call gave 1.
  - `gods-web`'s `guardian-jaw-oob.js` is generated from the image for every value the rise can leave (even, 0xB0..0x180), and the image equals live memory over that range. A few of those entries would land on-screen with descriptors past the loaded atlases; the original blits their garbage and the port draws nothing.
- **`[0x250]` and the statue** — no clobber. `7CBD` starts `cmp byte [0x42],1 / jnz 0x7D1F`, so the statue's `[0x250]` writes (`7D26`, `7D6A`) run only in world 1. The ending runs with `[0x42]` = 4, and after the completion restart `CC67` is RET again.
- **The restart's other writes.** `[0x70]`/`[0x71]` = 0xFF are the score's HUD dirty flags (as at `CS:0x0CAA` and `0x19AF`); the port redraws the HUD every frame. `[0x366]`/`[0x367]` = 3 set the inventory selector to slot 3. The image holds 0, and only the in-game cycling (`0x6171` → `0x1F65`) writes it otherwise. So only a completed game starts with the highlight on slot 3, and `gods-web` now does too.

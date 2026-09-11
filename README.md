# gods-web

An evidence-grounded HTML5/JS port of **GODS** (The Bitmap Brothers, DOS 1991).
Vanilla JS, no framework. Vite + npm.

```bash
npm install
npm run dev       # stages assets, serves on :5173
npm run verify    # headless invariant run (no browser needed)
npm run build
```

The original release directory (`../Gods`) is treated as **read-only**. `npm run assets`
copies out; nothing is ever written back.

## The rule this project runs on

Every constant in this codebase must trace to a specific offset in the disassembly or
a validated observation of the real game. Anything that cannot be cited is either
omitted or rendered as a visible placeholder — never invented-but-plausible.

Two consequences you will see in the source:

- Magic numbers carry their evidence inline, e.g.
  `WALK_STEP = 4  // CS:4960 add word [0x17a],4`.
- Where behaviour is genuinely unknown it says so. `game/player.js` implements only
  the proven kinematics; states whose animation phase is not decoded hold at phase 0
  and are listed in `UNMODELLED_PHASE_STATES` rather than being animated plausibly.
  Nothing that cannot be cited is drawn: a sprite index the model cannot justify
  falls back to a visible marker and bumps an on-screen counter.
- A check that cannot fail is not evidence. Rows that report a *measurement* rather
  than assert one render as `note`, never as a green tick — a tick beside an open
  `UNKNOWN_` reads as resolved.

## Assets are decompressed in the browser

The shipped `P*` files are staged in their original **PKWARE DCL-compressed** form and
decoded at load time by `formats/dcl.js`. This is deliberate: pre-extracting to
PNG/JSON would launder every format claim through an offline tool. Decoding the
shipped bytes in-process is what makes the claims checkable.

## The verification panel

The page runs its invariants at load and shows them live. They re-derive published
figures from the original bytes rather than restating them:

| Check | Value |
|---|---|
| DCL consumes its input exactly | 8/8 maps |
| `.PI1` size | exactly 32034 B (4 planes; 5 would need 40034) |
| `.MAP` bulk | exactly 21824 B |
| Live trigger records | **756** |
| Condition slots / unused (`COND0`) | **2268 / 1207** |
| Max condition kind / action verb | **16 / 14** (17- and 15-entry tables) |
| Action verb histogram | `203/4/75/75/3/134/25/60/48/18/7/6/8/77/13` |

The histogram and counts were originally produced by a separate C port
(`gods_trigger.c`, 9/9 mutants killed). The JS reaching the same numbers from raw
bytes is a genuine cross-check, not a restatement.

`npm run verify` runs the same suite headlessly, plus a jump-table symmetry check and
a physics smoke test (terminal fall speed must be exactly 14 px/tick).

## The 15 trigger ACTION verbs

The port evaluated all 17 condition predicates for a long time and then threw the
verdict away, so nothing a trigger decided ever happened: no door opened, no gate
moved, and no level could end — ACT4 *is* the level-exit zone. `game/trigger-actions.js`
executes all 15 verbs (`SS:0x3592`), reached the way the original reaches them —
`CS:0x3A56 jmp bp` tail-jumps into the handler after three shared steps: the
message, the key-consume (verbs 2,3,4,7,8 only) and the inventory-consume (bit 15
of the action word only).

End to end on `PLEV1A`, dispatching every plane-B event cell with the keys and
levers the doors ask for: **23 plane-A cells and 14 plane-B cells change**, four
doors open, six trap doors move, two teleport zones appear. With no keys and no
levers, nothing opens — the conditions are the lock.

Four findings this needed, none of them in the notes beforehand:

- **`DS:0x2f8c` is the trapdoor table.** `CS:0x40C0` is one routine that both
  patches the map and byte-swaps the 20 PALFILS `+0x1824` records into it, so
  ACT7/ACT8 open and close *trap doors* — the mechanism behind the shipped
  message *"a trap door closes beneath you"*.
- **ACT8's miss guard is dead, and shipped data reaches it.** `CS:0x410c` reports
  failure with `stc`, and ACT7 correctly tests `jc`; ACT8 tests `js`, which the
  helper never sets. Measured: 8 of 60 ACT7 records miss and correctly do nothing,
  while **5 of 48 ACT8 records** close a door anyway — and, because
  `0x2f8c + 20*6 == 0x3004` exactly, the original's stray write lands on plane A
  cells 4–5. That out-of-array store is clamped here and reported; the rest is
  reproduced.
- **The door tiles are per-world**, loaded by the only writer of `DS:0x14e`
  (`CS:0x2C64`, 6 words from `DS:0xe8da`). Self-checking twice over: under the
  1-based plane-A rule all four worlds' constants form a clean 2×3 rectangle on
  the 10-column sheet, and every shipped ACT2 door cell already holds exactly
  what ACT9 writes — the level data confirms the decode from the other side.
- **`ACT2`'s `add ax,0xc` is annihilated** by a second `& 0xffe0` twelve bytes
  later, so open and close land on the same cell.

`node tools/mutate-actions.mjs` injects 15 plausible mis-ports and reports which
the suite catches: **14 killed**. The survivor is equivalent on shipped data —
re-keying the ACT5 consume onto the trigger index instead of the event record,
which cannot differ because 0 of 727 selector-3 triggers is named by more than
one record. The suite asserts that equivalence rather than claiming a kill.

**The zone array is now read too** (`src/game/zones.js`, wired into `main.js`'s
tick loop and covered by `checkZones` — 17 assertions, including a real-data
pass over all 8 shipped maps' own ACT3/ACT4 records). `CS:0x4A6D` (the
hero-vs-zone scan) and `CS:0x0FDF-0x1042` (the teleport execution) are ported
at the byte level: standing in a teleport zone's box moves the hero to the
packed destination and re-enters state 4, the same "spawn / arrival idle"
pose this project already names at level start and respawn.

A level-exit zone (ACT4) resolves a real destination record — decoded
directly from `DS:0xe6ea`/`0xe796`/`0xe7fe`/`0xe8a8`, four `{param, param2,
text}` records reading `"LEVEL  ONE"`, `"LEVEL  TWO"`, `"LEVEL  THREE"` and
`"GAME"` — but the original's own rule for which of the 8 shipped `.MAP`
files loads next (`CS:0x0FAC`'s hand-off through `DS:0x178`/`0x36a` into
`FUN_1000_8c34`, the level-load master routine) was not traced far enough to
port. **This is an honest placeholder, not a proven mechanism**: the build
advances to the next level in the fixed `1A→1B→2A→…→4B→1A` cycle and shows
the recovered destination text, which is enough to make multi-level play
possible without overclaiming precision this pass does not have.
`UNKNOWN_zone_scan_caller` (CS:0x4A6D's own caller in the original is not
located — it sits in the player-state-machine's un-Ghidra'd gap) and
`UNKNOWN_level_exit_destination` both stand.

## The hero

Drawn with real sprites, selected by the ported state machine (`game/states.js`):

```
sprite = anim_base[state] + sign_extend(phase)   // CS:0x5f77-0x5f89
then remap 0x34->0x19, 0x36->0x23, 0x37->0x26    // CS:0x5f8b
```

Three details a port gets wrong by default, all asserted in the suite:

- **`CBW` sign-extends `AL`**, so phase `0xFF` is `−1`. Widening it as unsigned
  indexes descriptor #307 and draws a font glyph.
- **The phase persists across ticks** in `DS:0x36b` — the dispatcher's first
  instruction is `mov cl,[0x36b]`. Recompute it per frame and every animation
  freezes on frame 1.
- **The remap table is not decoration.** Its three inputs are exactly the phase-0
  sprite of idle, fall-left and fall-right, so skipping it draws the wrong sprite in
  the three states the hero spends most of its time in.

The jump animation runs the real four-case phase chain from `CS:0x4E6C`/`0x5064`.
Two asymmetries are load-bearing and both are asserted: jump-**left** has two
distinct airborne frames where jump-**right** has one, and a jump that starts **on a
ladder** seeds phase `0x0D`/`0x0C` so the hero leaves it in a different pose —
`44,44,38,37…` rather than `31,31,36,37…`. Climbing down is **6 px/tick** against 4
going up (`CS:0x5663`, reached only when the input byte equals exactly `0x02`).

`npm run hero` renders every sprite the state machine can select, as a labelled
sheet; `npm run frame` composites a full game frame. Both write a PPM, no browser
needed — the point is that the mapping can be *looked at*, not only asserted.

## Enemies

Placed by the real chain, not by hand: a plane-B cell dispatches selector 4 →
`CS:0xde08` activates a group slot → `CS:0xec60` materialises `count` entities at
`desc[0x12] * 32, desc[0x13] * 16`. `npm run enemies` walks a level's every event
cell through the real `EventRunner` and renders what comes out.

```
sprite = class_base + MODE_ANIM[mode] + frame        // CS:0xf0ae
MODE_ANIM = [0, 9, 8, 17, 8, 17, 8, 17]              // DS:0xdbe0
```

Enemy physics is **not** the hero's and the port keeps them apart: gravity is `v`
applied *before* the increment and clamped at 16 (hero: `4 + v`, capped at 10), and
the ground test is `planeB == 1` **exactly** — so an enemy falls straight through a
ladder column, where `>= 1` would have it stand on one.

Two quirks are reproduced rather than fixed: an activation arriving when all ten
runtime slots are busy is **lost forever** (the event is consumed before the slot
search), and a group with `count == 0` never frees its slot.

### They hunt

`CS:0xf586` is a cost-bounded graph search whose single output word is the **first
move of the best path found** — 0/1 walk left/right, 2–7 hop left/right at one of
three reaches. `game/pathfind.js` holds the frame, `pathfind-producers.js` the four
stages that explore. `npm run hunt` demonstrates it on real `PLEV1A` geometry:

```
OPEN corridor   256 -> 20 px    verdict 1 (walk right)
WALLED 6 tiles  5/5 searches report NO PATH
MIRROR          256 -> 16 px    verdict 0 (walk left)
```

The negative half matters as much as the positive — a pursuit test that only passes
on an open field proves very little. In between, a **two-tile** wall gets *hopped*
(verdict 7, the seed-13 long arc) rather than treated as impassable.

It is **not a breadth-first queue**, though it looks like one: push is first-fit from
slot 0, and pop is a cyclic cursor that does not advance past the slot it just
emptied, so the counter is charged twice per expansion. Cost never orders anything.
`queue.shift()` changes the expansion order and can change the verdict.

Three traps the port encodes, none visible in a "does it pursue" test:

- **The search runs only from the two walk modes, only on a tile crossing, only on
  ground.** Applying a verdict outside that gate re-seeds the hop cursor every frame
  and freezes the entity in mid-air.
- **The arc simulator carries its cell pointer and sub-tile offsets as explicit
  state**, and they go out of phase with the world position on a landing snap or a
  ceiling bonk. Recomputing the cell from X/Y each step diverges silently.
- **`SS:0x1c70` is both the goal marks and the closed set** — one signed byte array,
  `-1` for goal and the reach cost otherwise.

All four seed strategies are implemented, and one of them turned out not to be an
AI variant at all: **strategy 2 is the `"attracts monsters"` potion**. Picking up
object type 45 sets `DS:0x399`, which forces every enemy's pathfinder onto a marker
list — they stop heading for the hero and head for the markers instead.

The gap that mattered was the *fallback*: with no markers placed, strategy 2 does not
go inert, it retries the descriptor's other nibble (`CS:0xf799 -> 0xf71a`). Since
markers only exist after that potion, the fallback is the common case — implementing
it took hero-relative coverage from **72.5% to 97.4%** of shipped descriptors.

Strategy 3 paints the **first on-screen** waypoint from a static per-world list
(worlds 3 and 4 share one). Every shipped coordinate lies inside the 128×64 map,
which is what makes that decode self-checking.

### And they hurt

`game/combat.js`. Touching the hero costs him health **and kills the creature** —
`CS:0xff93` passes the entity's own state word in as the attack's strength, and the
damage routine writes `0xFFFF` back through it, so a negative state is *dying*. One
touch each; they are not persistent hazards.

The health system is **two variables, and conflating them changes the game**:

```
DS:0x192  the target, capped at 24
DS:0x19a  the displayed bar, which chases it ONE UNIT PER FRAME
```

Death, the damage guard, and every potion read the **bar**. So a fatal hit doesn't
kill — the player has the bar's 24-frame descent (1.6 s at 15 Hz) to drink something.
The suite asserts that rescue window *and* its deadline: a potion works mid-descent
and is refused once the bar reads zero, because all five potion sites are gated on
`cmp word [0x19a],0`.

**A correction this port made.** The project's notes had contact damage as
`(raw >> 4) + 5`. The bytes are **five** `D1FA` at `CS:0xACBF`–`0xACC7`, so it is
`((raw + 1) >> 5) + 5`. Since the strength is the enemy's own HP and shipped HP runs
to 255, the two readings disagree on **27 of 31** shipped values — at HP 255 the old
note costs 21 of 24 health per touch instead of 13.

## Objects

```
sprite = type < 0xC0 ?  170 + type  :  302 + (type - 0xC0)     // weapon pickup
```

The base is stamped by the EXE at `CS:0x2234` (`mov bx,0xaa`), not read from the
file — which matters, because **`POBJECTS.004` uses base 175**, every record shifted
+5, the same authoring drift already recorded for `PWEAPONS.004`. Read the index
from the file and world 4 draws every object 5 sprites off.

`npm run objects` renders every type a world actually places, beside the name that
type carries in `POBJECTS`. Across 43 types in world 1 the five `"* key"` records
draw as keys, `"gold mask"` draws a gold mask, and `"spike arc"` is the one 16×32
frame — captions and pictures agreeing is not something a wrong base survives.

Draw order is **three-way**, from graphics export 32: cat-3/cat-5 behind, ordinary
objects next, weapons and dead slots on top. A stable two-way partition leaves the
55 shipped weapon pickups where they started.

## Weapons and difficulty

`PWEAPONS.00x` is 11 records of 0x50 bytes. Field `+0x0a` is the **maximum
simultaneous projectiles**, and the shipped data corroborates that reading exactly:
across all 11 weapons it is only ever **1 or 3**, which is precisely what the fire
routine's 3-iteration unrolled loop can consume. A 2 or a 7 would refute it.

The hero has **three** weapon slots (`DS:0xdd10` / `0xdda2` / `0xde34`) — the same
three words the trigger predicates COND3/COND4 test, which is independent
confirmation they are the inventory.

**The interlock is not a slot-C quirk.** An earlier pass here recorded it that way.
Slots B *and* C carry the identical `DS:0x33e` test; slot A carries neither guard and
is instead its only *writer*. So the rule is: if the slot-A weapon is single-shot and
fires, no other single-shot weapon fires with it. Why remains
`UNKNOWN_weapon_slot_c_interlock` — the shape does not.

## Projectiles: spawned, not yet moving

A projectile is **8 bytes** — `{ tag, x, y, dir }`. The `0x18` the allocator strides
is *three* of them, which is why its free test reads `[di]`, `[di+8]` and `[di+0x10]`.
Spawn is data-driven: the emitter reads a byte from the weapon record (`+0x16` right,
`+0x12` left) and calls through a table at `DS:0xd88c`, where **even entries are
left-facing and odd are right-facing** — and across all 44 shipped records the right
index is *exactly* the left index + 1.

Two traps the port encodes rather than smooths over:

- **Handler 13 is not handler 1 mirrored.** It jumps past its sibling's `add ax,0x10`,
  so building it by mirroring puts every shot 16 px off.
- **The volley size is runtime state, not a weapon stat.** `+0x08` is the weapon's
  *pickup count* and `+0x06` its immutable base, so `[si+8] − [si+6] + 1` is
  `1 + extra pickups`, clamped to three. Collect the same weapon again and it fires
  more at once. A new pickup sets
  count := base, so **every weapon starts at one projectile whatever the files hold**;
  deriving the volley from them arms each weapon at its end-game spread. The shop
  agrees from the other side: it refunds `(count − base) × (value+1) / 2`.
- **`+0x08` is pinned at the EXE-image value** — one of *three* fields the loader
  saves across the file read, by two separate mechanisms. The project's notes had
  recorded two of the three and missed this one. It cost a wrong result here before
  it was caught: seven of the 44 file records disagree with the image, and reading
  the file value fires the wrong projectile count for four world-4 weapons *and*
  invents a two-projectile volley no shipped weapon ever fires. Read correctly, the
  volley is only ever 1 or 3; the 2-branch is real code but unreachable. The genuine
  fixture is the **axe** — 1 projectile in worlds 1–2, 3 in worlds 3–4, driven by
  `Power`, which is *not* pinned.

**A cut weapon.** Table entries 4 and 5 are null, and weapon 3 — `flame` — points at
them; the original would `call` address 0. It is unreachable: a census of all 200
object records in all eight maps finds 55 weapon pickups of 9 distinct types, and
flame is in none of them. The port refuses rather than emulating the jump.

### And they fly

The main loop walks the three slots (`CS:0x9455`) and dispatches on weapon `+0x1A`
through a **separate six-entry mover table** — not the spawn table. Reading those two
as one 22-entry table is what kept the mover hidden for a pass: it made the six
movers look like unreachable spawn handlers.

The common mover (6 of 11 weapons) walks nine records at stride 8 and adds a velocity
from a six-entry table indexed by the projectile's `dir`:

```
dir 0  +12,-3     dir 3  -12,-3      (up)
dir 1  +12, 0     dir 4  -12, 0      (level)
dir 2  +12,+3     dir 5  -12,+3      (down)
```

That closes the loop on the spawn order. The handlers write dirs **1,0,2** and
**4,3,5** — *level first*, then up, then down — so a single shot flies straight and
the extras fan out. It also confirms the facing assignment independently: every
right-facing code carries `+12`, every left-facing one `−12`.

The cull bounds are **exclusive** (`jl 0x140`, `jg 0xffe0`), so a projectile landing
exactly on the edge despawns — tested at the boundary, because a flight test from an
arbitrary position never lands on it and cannot tell `>=` from `>`.

### And they hurt — via a grid, not a hit test

**There is no pairwise projectile-vs-creature test in the original.** That is why
searching for one kept failing. Collision runs through a shared **8×8-pixel occupancy
grid in screen space**: each live projectile stamps its own tag byte on its draw path,
and each creature scans the grid over its own box and takes the first nonzero cell.
The two halves never reference each other.

Two traps the port encodes:

- **The stamp floors to a cell; the scan rounds half-up.** They agree only on exact
  multiples of 8, so one shared helper misplaces every stamp.
- **It is not a pixel mask**, despite the project's own notes calling it one for
  months. All 60 bytes of the compare chain are `cmp byte [si],0 / jnz / inc si` —
  no test, no mask, no bit index. Sub-cell precision does not exist here.

The tag decodes back to a weapon, and **the damage is the weapon's pickup count**, not
its Power. Since a new pickup sets count := Power, Power is the *starting* damage and
every duplicate adds 1 — so collecting the same weapon again buys both an extra
projectile and more damage per hit.

### The eight firing states

Decoded and ported. The trap here is that **the four families are not variants of one
pattern** — decoding walk+fire and mirroring it gets the emit phase wrong in six of the
eight states:

| family | states | emits at | animation |
|---|---|---|---|
| walk + fire | 5, 6 | **phase 3** | table `DS:0xd950`, the recoil `2,1,0,1,2` |
| jump + fire | 20, 21 | phase 1 | inc/dec flag |
| fall + fire | 22, 23 | phase 1 | inc/dec flag, plus the full fall physics |
| ladder + fire | 24, 25 | phase 1 | bare inc |

Walk+fire also stores the *raw* phase and renders a *remapped* one, jumping one
instruction past the epilogue's own phase store. Persisting the remapped value freezes
the cycle, because the next tick's `inc` would run on a sprite offset. And the ladder
pair exits asymmetrically — `cl = 3` for one, `1` for the other.

### The chain now connects

The stamp lives on the projectile's **draw** path — the mover tail-jumps through a
three-entry draw-style table indexed by weapon `+0x02` — not in the move loop. That
was the real break: a port that moves projectiles but never stamps leaves the grid
empty every frame and nothing is ever hit, however complete the rest looks.

`npm run verify` now tests the whole chain end to end: fire → allocate → spawn → move
→ stamp → scan → damage. It passes only if every link is connected.

**A long-standing claim, corrected.** This project's notes carried weapon `+0x48` as
"projectile breaks solid terrain — the maces break blocks flag". The bytes say the
opposite: on a solid cell the projectile is **despawned**, and there is no write to
either map plane on that path. The wall is untouched. So `+0x48` means the shot is
*stopped by* terrain — and the five weapons with it clear (lightning bolt, spear, axe,
hunter, magic axe) fly straight through walls. Actual block destruction is far
narrower: plane-A tile `0x6d`, worlds 3–4 only.

### Three movers, and an engine feature hiding in one

**Fireball** is the common mover plus a per-projectile accumulator that *accelerates* —
nine words, one per record, incremented every tick — which is what gives it an arc
rather than a constant drift.

**Hunter homes**, but the notable part isn't the weapon: its target list is built by
the **collision scanner**. Each creature the scan visits appends `{x, y, key}` to a
per-frame list, and the hunter takes the smallest key. So the damage grid has a second
consumer, and ordering matters — move before scan and it chases last frame's creatures.

Two traps: for the hunter `dir` is a *packed signed velocity pair* with **X in the high
byte** (reading it the natural way mirrors every shot diagonally), and its turn rate is
`extras − 2` clamped to 1..2 — so weapon upgrades keep paying after the projectile
count has already maxed out.

**The magic axe bounces**, and carries its own `{vx, vy, lifetime}` in a companion
array. Its wall probe is gated on the sub-tile position — outside a narrow window it
moves without testing at all — and the bounce is a fixed ±4, not a reflection: an
incoming +12 leaves as −4.

It also brings the count of distinct gravity rules in this engine to **four**, no two
alike: hero `4 + v` capped 10, enemy `v` then `++` capped 16, time bomb `++` capped 4,
axe `+2` capped 8. Sharing one implementation is wrong every time.

**The time bomb's `dir` is a fuse** — 47 ticks, about 3.1 seconds, then ten fragments.
Which settles the field for good: `dir` has **no global meaning**. The common mover
indexes a velocity table with it, the hunter unpacks it as two signed bytes, the bomb
counts it down. One `dir` helper is wrong twice over.

It also lands with a 24-byte damped bounce table (four arcs, amplitude 4→1), so it
visibly settles rather than stopping dead — and brings the engine's distinct gravity
rules to five.

All six movers are now decoded and ported.

### The chain is complete

All four entry patterns are decoded, and one of them closed a second unknown: the fall
and jump entries are what *write* `DS:0x356`, the flag that makes the handler count the
phase **down** on its first tick. So those families enter at phase 1, dip to 0, and
emit on the second phase 1 — a wind-up. Entering at 0 with a plain increment fires a
tick early and loses it.

Jumping has a guard the others don't: the arc cursor must be under 44, so the hero
can't fire late in a jump.

**press → latch → allocate → enter a state → wind up → emit → spawn → move → stamp →
scan → damage** is now continuous, and `npm run verify` tests it end to end.

### Wired into the running build

Every module above existed before this pass and nothing called any of them. They are
now on the frame, and connecting them turned up four things no isolated test could
have found.

**Two defects in the ported fire states, both from inferring a tail.** State 21 exits
with phase **6**, not 5 (`CS:0x52D5 mov cl,6`) — this port had mirrored state 20. And
the ladder pair's exit phase is *conditional*: `CS:0x5473` restores the phase the entry
saved in `DS:0x359` when it is even, using its own constant only when it is odd.

**Fire means three different things.** All 12 allocator call sites map to states
0, 1, 8, 9, 11, 12, 13, 14 plus the two chain re-fires. Idle tests the same bit and
calls `CS:0x1045`, a walk over the 200 map object records — that is **object pickup**;
the crouch pair jump to `CS:0x612F`, which reads the inventory. So the hero must be
*moving* to shoot, and a stationary hero with fire held picks things up instead.

**Firing while walking halts you.** State 5's body has no X step at all, and the entry
sits before the walk step and jumps past it, so a shot costs the whole 5-tick cycle.

**The per-tick order is load-bearing, and now lives in `src/game/frame.js`.**
Projectiles move and stamp at `CS:0x020F`, *before* the player at `CS:0x0254`, so a
shot cannot hit anything on its spawn tick. While that order was inline in `main.js` a
mutation that swapped the two **survived the entire suite** — the check asserted the
property against a loop it had written itself. Extracting the order into a module the
suite can drive is what turns it into a real check.

⚠️ **The hero starts unarmed, and that is not a gap.** `CS:0x914c` writes `0xFFFF` into
all three slot words, and its only callers are the two full game restarts. A weapon can
only come from one of the 55 weapon pickups the maps place — **and he now collects
them.** See *Arming the hero* below.

⚠️ **Only 5 of the 11 weapons can spawn.** Handlers 12/13 are decoded but no shipped
weapon references them, so the decoded set `{0,1,12,13}` covers knife, lightning bolt,
throwing star, axe and mace. The other six are counted at the call site rather than
thrown — a raise on the fire button is a worse failure mode than a counter, the same
reasoning as the out-of-range `dir`.

### The collision geometry, finished

Two things were flagged as divergences and are now ported — and one of them was hiding
a live defect.

**The axe and the lightning bolt were under-hitting on every shot.** Draw styles 1 and 2
stamp **3×3** (24×24 px) via `CS:0xA8B8`; only style 0 stamps 2×2. This port routed all
three to the 2×2, and both of those weapons are style 1 *and* among the five it can
actually spawn — so they covered less than half the grid area they should.

The two stamps are not one routine with a size parameter: **the nudge and the bounds
check are in opposite orders.** The 3×3 nudges then checks, the 2×2 checks then nudges,
so at `y = 236` the 2×2 stamps and the 3×3 refuses on the same input.

**The scan's clip prologue** (`CS:0xA9EF`–`0xAA83`) shrinks a creature's box against the
screen edges before scanning, and returns *no hit at all* when it shrinks away. Two
details worth having:

- **Each axis clips once.** Both near-edge paths `jmp` past the far-edge test, so it is
  an if/else per axis — applying both clamps diverges on a box that exceeds both edges.
- **The horizontal test reads the near edge where the vertical reads the far one.**
  `0xAA36` is `81 F9` = `cmp cx,0xd0` against the computed bottom; `0xAA6F` is `3D` =
  `cmp ax,0x150` against the *left* edge, even though the instruction before it computed
  the right edge into CX and ignored it. The right-edge clip therefore only fires once
  the box is already off-screen — effectively dead. Reproduced verbatim, because tidying
  an asymmetry has cost this project twice already.

**And the hunter's target list is gated on holding the hunter.** `DS:0x343` blocks the
append unless a slot holds weapon 8, so the list the weapon homes on is empty on every
frame the hero isn't carrying one.

⚠️ **Still open in this subsystem:** what the destructible-tile queue does, the
unproduced `0xFD` grid tag, and the per-projectile animation frame.

### Arming the hero

Walking over a weapon pickup arms him, through the original's own slot selector. Four
things this turned up.

**`CS:0x1045` is the LEVER toggle, not object pickup.** This project — and this README,
one pass ago — called it "the 200-record object-pickup walk", on the strength of the
array walk alone. The body keeps **only category 3** and ends in
`xor byte [si+0x4],0x1`: category 3 is levers/switches and flipping bit 0 of the type is
the lever toggle documented separately, so the two findings are one mechanism seen twice.
Real pickup has **no fire gate at all** — it happens on contact at `CS:0x177d`.

**A dead slot is `0xFFFF`, which is also `>= 0xC0`.** `CS:0x9000` tests the *sign*
instead of comparing with `0xFFFF`. Writing the obvious `type >= 0xC0` matches every
consumed or unused record — 535 of them across the eight maps instead of 55, all sitting
at `(0,0)`, so a hero near the map origin would collect seventy phantom weapons at once.
The check that caught this was one I'd written to confirm the count of 55; it reported
535 and the bug was in the port, not the check.

**The slot selector has five rules and a hard-wired special case.** Fireball always takes
slot C, and the same instruction sets `DS:0x340 = 0x12` — the tag base its mover
subtracts at `CS:0x9DC2`, which is only correct *because* the weapon is pinned to that
slot. Two facts explaining each other. Otherwise: `+0x00 == 0` reserves slot A, then the
first empty of B/C, then whichever of B/C has the lower pickup count — `jl` is strict, so
a **tie replaces C**.

**Picking up a weapon you already hold is a different event.** It only increments the
count (so volley *and* damage rise) and leaves the projectile area alone. A *new* weapon
re-bases the count to Power and **clears the slot**, destroying shots in flight. That
clear is why pickup runs at `CS:0x0206`, before the projectile step at `CS:0x020F` — run
it after and a weapon you no longer hold gets one more frame of collision.

### Health potions

The consumable branch is ported too, and the interesting part is the dispatch: **the
handler index is not the object type.** `CS:0x1801` counts, on the spot, how many
category-0 types sit strictly below this one, and uses that **rank** to index a table at
`DS:0xd8b8`. Two independent facts pin the table's width at 23: the shipped category
table has exactly 23 zero entries, and the table holds exactly 23 plausible code offsets
before running into unrelated data.

All **23 are now decoded**, each confirmed against its own `POBJECTS` name and
description — which is what makes the set checkable, since nothing about a handler
address says what it should do.

The sharpest confirmation is the three **weapon arc** potions. All three call one
copier that *overwrites* the six-entry projectile velocity table, differing only in
which of three adjacent 24-byte `SS` tables it reads. Their Y-spreads are **3 / 1 / 10**
against descriptions **standard / intense / wide**.

Two more land on globals this project already knew from the consuming side: *"freezes
aliens"* writes the `DS:0x2fa` gate the System-B entity driver reads (170 frames, 11.3 s,
and it stops System A too), and *"giant jump"* writes the `DS:0x174` word the jump arc
already doubled on. The **power potion** raises the pickup count on every held weapon at
once — so it buys volley size, damage *and* hunter turn rate, and type 3 enters one
instruction above type 2 to apply it twice.

- **⚠️ `"shield … reduces damage"` is a shipped no-op.** `CS:0x62BF` writes `DS:0x34c`
  and nothing reads it. Held to the `.DAT` word2 standard: the immediate `4C 03` occurs
  four times across all twelve shipped binaries and every one is a byte write; a word
  access one byte low would encode `4B 03`, and those four are byte writes too. Three of
  these potions ship and none of them reduces any damage.
- **⚠️ `"slows monsters"` has no handler.** Its table word is the player state machine's
  *epilogue*. It is placed zero times, and it never sets `DX` — which the caller reads to
  pick the message tier. All 22 others do.
- **⚠️ Invulnerability and spawn protection share a helper and differ by 170 frames.**
  Both call `CS:0xA90B` (255 frames), but the spawn path immediately subtracts 170. So
  the potion is 17 s and a respawn is 5.7 s. Finding the helper and not chasing the `sub`
  puts a confidently wrong number on both.
### Maces break blocks — and it isn't the flag everyone assumes

This project once read `PWEAPONS +0x48` as "breaks blocks" from field position, then
corrected it on the bytes to "is **stopped by** terrain". That correction stands. The
mace's advantage is a **`+50` at `CS:0x74AF`**, in a different routine reached through a
different call — so the folklore was right about the mace and the old note was still
wrong about which byte says so.

A solid cell whose **plane-A tile reads `0x6d`**, in **world ≥ 3**, goes into a 40-entry
damage queue. Each later shot subtracts the weapon's pickup count, +50 for the mace, and
at **200 cumulative damage** the block plays four break frames and disappears.

The world gate is confirmed by the data, not just the code: tile `0x6d` is solid in
**246 of 246** cells across worlds 3–4 and **0 of 37** across worlds 1–2.

| weapon | dmg/hit | shots |
|---|---|---|
| **mace** | 53 | **5** |
| time bomb | 20 | 11 |
| fireball | 5 | 41 |
| knife | 1 | 201 |

- **⚠️ The first shot does no damage** — it only creates the queue record. So "4 damaging
  hits" is *five shots*, and quoting one as the other is off by one on every weapon.
- **⚠️ Plane A becomes 1, not 0.** Under the 1-based rule that is tile index 0, and a port
  writing 0 draws the wrong tile.
- **⚠️ The restore list is `SS:0x46b0`, not `DS`** — every access is `[bp+0]`, and the
  clear does `push ss / pop es`.
- **⚠️ Two capacity quirks, both reproduced.** A full queue drops the hit; a full restore
  list returns *before touching either plane*, so the block finishes its animation and
  stays solid. `PLEV4A` has 120 destructible cells against 100 restore entries, so the
  second is reachable in shipped data.
- Shooting an already-breaking block queues a **duplicate** rather than doing more damage,
  because the dedup requires hp to still be negative.

### The starburst is a chain reaction

The *starburst* potion throws eight particles out in a compass rose from an 8-pair
template whose 16 bytes end exactly where the hero's weapon slots begin — which is what
pins the count at eight rather than the seven the loop counter literally holds. They fly,
fall, **stamp the damage grid**, and each one can set off a whole new burst from where it
is.

Nothing guards that recursion. What bounds it is an **age ceiling**: the spawner refuses
once an active burst is 190 old, and the re-burst chance decays from 380/65536 to zero
over the 95 frames the age takes to climb. ⚠️ A *chained* burst inherits the age while
resetting only its ten-frame window — reset the age too and the effect never stops. The
port reproduces that gate rather than adding a recursion guard, and asserts termination
directly by running a burst to quiescence.

- **⚠️ It one-shots.** A particle carries grid tag `0xFC`, which decodes to **10000**
  against creature HP that tops out at 255. No difficulty scalar can forgive that.
- **⚠️ Three of the four negative grid tags were being reported as zero damage.** The
  ladder gives the familiar's power, 10000, nothing, and 10000 — and this port returned
  0 for all of them, making the starburst and the invulnerability aura inert.
- **⚠️ The `0xFC` "debris" label was wrong**, and it came from a note this project had
  explicitly marked as never re-read. `CS:0xA549` is the *starburst*; debris is a
  different 20-record array.
- A **sixth** distinct gravity rule (one step every eighth frame, and the only uncapped
  one) and a **sixth** cull rectangle. No two of either are alike.
- Chained particles are stepped in the **same frame** they are created, because the
  spawner is first-fit and the new slots land ahead of the walk cursor.

- **⚠️ Seven of the 23 types are placed ZERO times** — including the whole familiar
  chain. Decoded is not the same as reachable, so the port records placement counts and
  wires only what ships.

**A correction this forced:** over-healing was documented here as "banked at 32 a point".
The bank is gated on `DS:0x168 >= 0` — now closed as the **familiar's energy**, which is
`-1` at both full restarts and can only be lifted by a potion no map places. The banking
is real code that shipped play cannot reach; over-healing is discarded.

### Treasure, and a chest that opens

`CS:0x184E` is the category-1 arm, and it is a three-way branch. Ordinary treasure pays
the descriptor's `+6` — **`POBJECTS`' Value field, promoted this pass from inference to
decompile** — into a 32-bit money total and `value >> 3` into a packed-BCD score. Types
12/14/16 are locked chests, and the key is `21 + (type-12)/2`.

That arithmetic is checkable rather than plausible: `POBJECTS` types 12..17 are three
`"treasure chest"` pairs whose *description* is the material (`gold` 3000, `steel` 2000,
`iron` 1000), and 21/22/23 are the **only three records in the file named `"chest key"`**.
A dropped `>> 1` lands on `"world key"` instead.

**Even is closed, odd is open**, with the transition `or cx,1` — the same bit-0 convention
as levers 24/25. All 8 maps place only the *even* types, so a chest always starts closed,
and the odd arm exists purely to stop a re-touch paying out twice.

Opening one throws **ten treasure items** out on a ballistic arc that settles into real,
collectable objects. That is a fifth distinct gravity rule: `vy++` capped at **+4** with a
horizontal decay none of the other four have.

- **The loot table is a shipped bug.** `DS:0xd8e6` is authored at a 20-byte stride —
  bounded on both sides by known structures (`0xd922` is the hero's jump arc, so the
  region is exactly `3 × 20`), and at that stride all three lists open `80 80 80 80 5`.
  `CS:0x12D7` strides **16**. The decisive evidence is a second caller, `CS:0x1756`,
  which enters the same spawner with `0xd90e` hard-coded — `2 × 20`, correctly aligned.
  The port reproduces the ×16 verbatim, because it is invisible: list 0 is at offset 0
  and correct either way, list 1 misaligned is a pure *rotation* of the authored one, and
  list 2 genuinely differs but type 16 is placed in **zero** shipped maps.
- **A burst item with nowhere to land is stranded, not retried.** `CS:0x13BA` skips both
  the settle *and* the liveness flag, so the updater can switch itself off with records
  still in flight.
- **The score shift is `SAR`, not a divide.** No shipped value is negative, so `/8` passes
  every data-driven test and is still wrong.

⚠️ **Keys are not implemented, and the original does not collect them by walking either.**
Category ≥ 2 returns from the walk with carry *set* and neither call site treats that as a
pickup. Keys go in through **crouch + fire** (`CS:0x6069`) — a fourth meaning for that
button. So the running build seeds the three chest keys, labelled as a dev seed in the
status line, exactly as the weapon picker is.

⚠️ **The attract-mode demo grants itself weapons — don't read that as a starting
loadout.** `CS:0x8FD2` collects weapon 2 five times and weapon 6 three times; its only
callers sit inside the `DS:0x3e6` attract-mode branch and fall through to setting the
joystick-playback flag. Those are the demo's weapons, beside its scripted camera.

### A correction to a correction

The progression scalar's damage multipliers have now been recorded two different ways
in this project, and **both were wrong**, because both were read off `shr bx,cl` alone.
The instruction that looks like it computes the damage is computing a *correction* to
it: `CS:0xAB5E` subtracts the raw damage and `CS:0xAB86` adds the shifted value
**back**, so the shift is what the scalar *forgives*.

| scalar | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| forgiven | — | raw/4 | raw/2 | ¾ raw | ¾ raw |
| multiplier | 1.00 | 0.75 | 0.50 | 0.25 | 0.25 |

That is the *original* table, with the intuitive direction: as the scalar rises the
hero deals **less** damage. The clamp sequence is `0, 2, 3, 4, 4`, so the curve a
player meets is a monotone **1.00 → 0.50 → 0.25 → 0.25** and enemies are toughest at
the **end** — the only reading consistent with the game's own hint text, *"and the game
gets more difficult too"*.

The lesson is worth more than the numbers: the evidence was a `push`/`pop` bracket 40
bytes away from the instruction being read.

## Three corrections this port surfaced

**Palette.** The panel immediately failed 8 palette checks, which turned out to be a
real error in the project's notes rather than a bug. "Every `.PI1` has ST 3-bit
palette words" holds for **32 of 44** files and fails for exactly **12** — the
`PBITS*` and `PXTRA*` tile sheets, every one with the high nibble set. Tile sheets
carry no usable palette, so the level palette comes from `PLEVEL<N><X>.PI1`.
`UNKNOWN_level_palette_source` is still open, but no longer a blind choice: that
palette and the hero atlas disagree on 7 of 16 entries and the hero's frames use 6 of
those 7, so his rendering correctly under it is discriminating evidence.

**Selector dispatch.** This port used `SELECTOR_TRIGGER = 2`, from a note reading
"`SS:0x3570` entry [2] is `0x39ae`". The entry was right; the inference that
*selector value* 2 reaches it was not — `CS:0x603A` does a `dec ax` first, so the
trigger evaluator is **selector 3**. The port's own fire count moved **82 → 202**,
which is what proves the fix reached the trigger chain rather than just a constant.

**Event probe column.** `CS:0x5fb2` rounds X to the *nearest* column
(`add ax,0x10 / and ax,0xffe0`) while flooring Y. This port used `x >> 5`. Measured
across all 8 levels through the real `EventRunner`: the trigger list is identical,
but every one of the 82 fires moves 16 px earlier — a **timing** correction, not a
coverage one. The first version of that check claimed coverage; it was wrong and the
measurement said so.

## Timing — 15 Hz, not 50

The most commonly mis-stated fact about this game. 50 Hz is the **music** rate; game
logic runs at **15 Hz**. Derivation in `engine/clock.js`, in short: the sound ISR's
`inc byte [0x39]` sits *before* the 5-of-6 music divider, so `[0x39]` counts at the
full 60.0011 Hz PIT rate; the main loop calls graphics export 14 with `AL = 3` (the
only value ever written to `[0x3d6]`), and export 14 waits for `[0x39] > 3` then
clears it. One frame = 4 PIT ticks = 15.000 Hz.

## Status

Done: asset pipeline, level rendering (both tile sheets, 1-based plane A), the ported
camera (dead zone `(80, 208)` open on the left, proportional vertical catch-up, the
world-3 scripted nudge), 15 Hz clock, trigger engine, hero kinematics and hero
sprites, teleport zones (real destination unpack, no reload needed) and level-exit
zones (real destination text, placeholder level sequencing — see the trigger
section above).

Deliberately not done, with the reason:

| | why not |
|---|---|
| enemy **hunting** | **done** — `src/game/pathfind.js` + `pathfind-producers.js`. Enemies chase, hop obstacles, and correctly give up when walled off. What is *not* done: seed strategies 2 and 3 (`UNKNOWN_seed_2` / `_3`). Weighted over every `rnd` value across all 270 live descriptors, **27.5%** of groups pick one of those and fall back to no goal. `npm run hunt` demonstrates the chase on real level geometry |
| enemy **combat** | contact damage, the kill, **and the hero's own fire path** are done (`game/combat.js`, `hero-fire.js`, `frame.js`). Still open: the death *animation* (a fixed `0x6c..0x73` block that does not use the class chain), and the group-clear reward drop |
| weapon **pickup** | **done** (`game/pickup.js`) — walking over a type >= 0xC0 object arms the hero through the original's slot selector. The HUD picker stays because `PLEV2A` places no weapons at all |
| **consumables** | **all 23 decoded** (`game/consumables.js`), each confirmed against its own `POBJECTS` text. Wired: health, power potion, invulnerability, extra life, freeze, giant jump, the three weapon arcs, shop. Decoded but not wired: the familiar chain (placed **zero** times), teleport (needs level transitions), the tablet (already ported). Type 43 has no handler at all |
| **treasure** | **done** (`game/treasure.js`) — value into money and `value >> 3` into the BCD score, locked chests against their keys, and the ten-item burst that settles into real objects. Not done: **keys**, which the original takes on crouch + fire (`CS:0x6069`), so the build seeds them |
| System-A entities | a steering pipeline, not a mode machine — no ported equivalent |
| ladder animation | the phase ping-pongs 0↔3 with the step sound only at the turn-arounds; which arm is up and which is down is not settled — `UNKNOWN_ladder_anim_phase` |
| status panel | `UNKNOWN_playfield_height`: the backdrop region is 160 scanlines and the tile renderer covers 144, and `VGA.EXE` never writes CRTC index `0x18`, so there is no hardware split to read the boundary from |
| **destructible blocks** | **done** (`game/destructible.js`) — tile `0x6d` in worlds 3-4, the 40-entry damage queue, the mace's +50, the four-frame break at half speed, and the restore on level load |
| **debris** | **done** (`game/debris.js`) — 20 chunks, straight-line, 11 ticks, and provably **inert**: its whole body makes one call, the blitter |
| the `DS:0xcfcc` hazard | decoded and **proven CUT** — it is world 4 / System A / class 3 in the `DS:0xdf80` class tables, and no shipped descriptor selects it. Not ported, because it cannot happen. The game's fourth cut feature, after the `flame` weapon, the iron chest and the familiar chain |
| sound | drivers and the SMF containers are decoded, nothing wired |

## Layout

```
src/formats/   dcl.js pi1.js map.js atlas.js descriptors.js   shipped-byte decoders
src/engine/    clock.js                      15 Hz fixed step
src/game/      states.js                     the 29-state table + sprite selection
               player.js                     kinematics, phase, wall probes
               camera.js                     the ported scroll origin
               objects.js                    type -> sprite, category, z-order
               entity.js                     System-B enemy locomotion
               trigger.js  events.js         plane B -> event -> trigger
               weapons.js  fire-states.js    the allocator and the 8 fire states
               projectiles.js collision.js   spawn, the 6 movers, the damage grid
               hero-fire.js                  the arsenal: slots, latch, emit, step
               pickup.js                     contact -> slot selection -> armed
               frame.js                      THE PER-TICK CALL ORDER (see above)
src/render/    renderer.js                   320x200 indexed software renderer
src/verify/    checks.js                     the live invariant suite
tools/         copy-assets.mjs               stage the shipped files
               verify-node.mjs   npm run verify
               hero-sheet.mjs    npm run hero     every hero sprite, labelled
               frame-node.mjs    npm run frame    one composited game frame
               object-sheet.mjs  npm run objects  every object type + its name
               render-node.mjs   npm run world    a whole 4096x1024 level
```

`src/game/states.js` is the file to read first if you want the evidence: it carries
the 29-state table, the per-tick contract, and how the left/right split was proven
four independent ways — including the one derivation that never assumes what an
input bit means.

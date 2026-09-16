# The player state machine and health

> Extracted from `Gods/CLAUDE.md` to keep the top-level ledger navigable. The evidence-discipline tag legend (`[PROVEN]`/`[STATIC]`/`[WF]`/`[UNKNOWN]`) is defined once in `CLAUDE.md` and applies unchanged here.

## The player state machine `[PROVEN]`

Lives almost entirely in the 5208-byte Ghidra gap `1000:49ca`–`1000:5e21`, which is why earlier passes never found it — **use `ndisasm`, not Ghidra, for this region.** Entry `FUN_1000_4993`, called once per frame from `1000:0254`. Dispatch at `1000:49bf` indexes a **29-entry `{u16 anim_base, u16 handler}` table at `DS:0xd818`** and does `jmp ax`.

| `DS` | Meaning |
|---|---|
| `0x17a` / `0x17c` | hero X / Y — **integer world pixels, no sub-pixel bits** |
| `0x1b2` | fall velocity (1…10) |
| `0x176` | fall-damage accumulator |
| `0x345` | air-control step counter (capped at 3) |
| `0x358` | jump-arc cursor |
| `0x377` | state index into the `0xd818` table |
| `0x382` | packed input: bit0 up, bit1 down, bit2 left, bit3 right, bit7 fire |
| `0x17e`–`0x184` | **4-slot inventory**, `0xFFFF` = empty |
| `0x192` | **hero HEALTH**, capped at `0x18` = 24 — see below. An earlier revision labelled it *ammo*; that was wrong. |
| `0x19a` | the **displayed health bar**, which chases `0x192` — see below |

**Dispatcher gates — two paths skip the entire state machine.** The dispatch is not a straight line from `0x4993` to `0x49bf`; 34 bytes in between matter:

```
499D  sub ah,ah / cmp al,0x12 / jz / cmp al,0x13 / jz
49A7  call 0x1e06                    ; runs for every state EXCEPT 0x12/0x13
49AA  cmp byte [cs:0x71d],0x90       ; CS-resident SELF-MODIFYING-CODE gate (0x90 = NOP)
49B0  jnz / jmp 0x5e9b               ; -> whole state machine skipped
49B5  cmp byte [0x363],0
49BA  js  0x49bf / jmp 0x5e9b        ; handler runs only when [0x363] < 0
```

**Sprite id = `anim_base + sign_extend(cl)`**, with three hard remaps at `0x5f8b` (`0x34→0x19`, `0x36→0x23`, `0x37→0x26`). `[0x377]` is re-read at `0x5f77` *after* the handler wrote it, so on a transition the sprite uses the **destination** state's `anim_base`.

### The per-tick contract, and `DS:0x36b` — the animation phase `[PROVEN]`

`CL` is **not** a scratch register. It is persisted across ticks in `DS:0x36b`: `FUN_1000_4993`'s very first instruction is `mov cl,[0x36b]`, and the epilogue's very first is `mov [0x36b],cl`. A port that recomputes `cl` each frame freezes every animation on frame 1. Only 10 references binary-wide; initialised to 0 at `0x8db`/`0x1018`.

```
4993  mov cl,[0x36b]              ; animation phase in
4997..49c9                        ; the two gates, then `jmp ax` into the handler
<handler>                         ; may write [0x377] (state) and CL (phase)
5E9B  mov [0x36b],cl              ; phase out
5EA0  call 0x5fab                 ; plane-B event probe
5EA4..5F76                        ; camera update  (see "The camera", below)
5F77  bl=[0x377] / bx*=4 / si=0xd818 / al=cl / cx=[bx+si] / cbw / ax+=cx
5F8B  the three remaps
5FA7  call 0x6049                 ; draw
```

`CBW` sign-extends **AL**, so `cl = 0xFF` is `−1`, not 255. A port that widens `cl` as unsigned indexes descriptor #307 instead of #51 and draws a font glyph.

### The 29 states, decoded `[PROVEN]`

Formerly `UNKNOWN_player_state_semantics`. Flow closures were computed from all 29 entry points (following both arms of every branch, stopping at `jmp 0x5e9b`) and cross-referenced with every `mov byte [0x377],imm` to give the full transition graph.

| # | base | meaning | # | base | meaning |
|---|---|---|---|---|---|
| 0 | 0 | **walk left** | 15 | 25 | ladder drop check |
| 1 | 11 | **walk right** | 16 | 29 | land right |
| 2 | 8 | turn left→right | 17 | 31 | land left |
| 3 | 8 | turn right→left | 18 | 29 | **crouch, facing right** |
| 4 | 9 | spawn / arrival idle pose | 19 | 31 | **crouch, facing left** |
| 5 | 19 | walk right + fire | 20 | 45 | jump right + fire |
| 6 | 22 | walk left + fire | 21 | 48 | jump left + fire |
| 7 | 9 | **no-op — a bare `RET`** | 22 | 45 | fall right + fire |
| 8 | 31 | **jump left** | 23 | 48 | fall left + fire |
| 9 | 29 | **jump right** | 24 | 39 | ladder fire right |
| 10 | 25 | fall (ladder family) | 25 | 42 | ladder fire left |
| 11 | 55 | **fall left** | 26 | 52 | **idle** |
| 12 | 54 | **fall right** | 27 | 51 | stub → walk left |
| 13 | 25 | climb (from walk) | 28 | 53 | stub → walk right |
| 14 | 25 | climb (from stand) | | | |

**How left/right was proven without assuming any input bit.** Handlers share code by tail-jumping, so a site inside two closures proves nothing — but four X-step sites sit in exactly **one** closure each: `4EB9 sub [0x17a],4` only in closure(8), `50B5 add [0x17a],4` only in closure(9), `524F sub` only in closure(21), `536C add` only in closure(20). The transition graph gives `0 → 8` and `1 → 9` at take-off, forcing state 0 into the −X family and state 1 into the +X family.

Three further derivations agree independently: state 26 dispatches input bit2 → 27 → 0 and bit3 → 28 → 1 (matching bit2 = left); leaving walk-left writes `mov cl,0xff` (`5AF9`) and walk-right `mov cl,0x1` (`5B0F`), which against `base(26) = 52` render **51 and 53** — exactly the `anim_base` values of stubs 27 and 28; and the extracted frames *look* left- and right-facing.

⚠️ **A trap in the disassembly.** State 0's body contains both `sub [0x17a],4` (`5AA8`) **and** `add [0x17a],4` (`5AD3`). The `add` is **not** a second direction — it sits under `cmp cl,7 / jng / mov cl,7` (`5ACC`–`5AD1`) and *undoes* the step when the walk-cycle phase clamps. Counting signs instead of reading context yields "state 0 walks both ways".

**The walk cycle is 8 frames** (`5AD8 inc cl` / `5ADA and cl,7`), with the footstep sound (`mov ax,0x20e / call 0x22ca`) fired at phases **2 and 6** — two steps per cycle, at opposite phases.

**What the three remaps are for** `[PROVEN]`. Their inputs are exactly the phase-0 sprite of the three states the hero spends most of its time in: `52 = base(26)` idle → **25**, `54 = base(12)` fall right → **35**, `55 = base(11)` fall left → **38**. Base 52 exists to generate 51/52/53 for stop-left / standing / stop-right; the middle one is then redirected. **The hero's frames are not a contiguous block**, and a port that skips the remap draws the wrong sprite in three of the commonest states. All three redirects land on 32×48 frames.

### ⚠️ Releasing a walk key does NOT normally enter idle — a shipped port bug, found live `[PROVEN]`

An earlier revision of this document (and of `gods-web`) read the paragraph above as saying every release converges on state 26's single symmetric sprite 25 — "a direction-neutral standing pose." **That is true of state 26's own body, but wrong as an account of when the hero actually reaches state 26.** Reported live in the browser: the maintainer tested the real DOS game in DOSBox and found the hero "doesn't face the player but it doesn't turn away either — it keeps looking in the direction last given," directly contradicting the port's behaviour of always snapping to the back-view idle sprite on release.

Fresh disassembly of the release path (`CS:0x5af2`–`0x5b35`, state 0's own exit, and its mirror `CS:0x5b08`–`0x5b33` for state 1) settles it:

```
5AF2  test byte [0x382],0x1 / jz 0x5b1e   ; UP held at the instant of release?
5AF9    mov cl,0xff                        ; YES -> seed the idle-entry phase...
5AFB    mov byte [0x377],0x1a(26)          ; ...and ONLY HERE does state become 26
5B1E  cmp cl,0 / jnz 0x5b26                ; UP NOT held -> state 26 is NEVER entered
5B26    mov cl,0x39(57)                     ; cl was nonzero -> lock a facing sentinel
        [0x377] is NOT written -- state stays 0 (WALK_L)
```

and the mirror for state 1 (walk right): `CS:0x5B0F`/`0x5B11` (UP held → state 26, `cl:=1`) vs. `CS:0x5B2B`/`0x5B33` (UP not held → state stays 1, `cl:=0x2d`=45).

So **state 26 (idle) is reached from a release only when UP happens to be held at that exact instant** — the far rarer case. In the ordinary case (UP not held), the state never changes: the hero freezes inside WALK_L or WALK_R forever, rendering `anim_base(0)+57=57` or `anim_base(1)+45=56` — genuine, *facing-specific* "stopped" sprites, not idle's back-view 25. Confirmed live under DOSBox (`DS:0x136A` this session): releasing RIGHT after auto-walking left `DS:0x377=1` (state stayed WALK_R) with `DS:0x36b=0x2D`, the exact `CS:0x5b33` constant; releasing LEFT similarly landed on `DS:0x377=0`, `DS:0x36b=0x39` — both screenshots show the hero visibly still facing the direction it had walked, matching the report exactly.

`gods-web`'s `_ground()` previously forced `stateIndex = S.IDLE` unconditionally on every release. Fixed to gate on `input.up` exactly as above; three new assertions in `checks.js` cover both facings and the true UP-held idle-entry path. `node tools/verify-node.mjs`: 592/592 rows pass.

### States 4, 7, 18 and 19 `[PROVEN]`

**18 and 19 are the crouch / inventory pair** — proven by the dispatcher gate rather than inferred. `CS:0x499A` special-cases exactly these two states, skipping the panel-retract call:

```
499A  mov al,[0x377] / sub ah,ah
499F  cmp al,0x12 / jz 0x49aa       ; state 18
49A3  cmp al,0x13 / jz 0x49aa       ; state 19
49A7  call 0x1e06                   ; panel retract — EXACTLY ONE caller file-wide
```

They are the only two states in which the 4-slot inventory panel stays extended. 18 faces right (base 29, exits to state 1), 19 faces left (base 31, exits to state 0).

**The hitbox is shorter while crouching** `[PROVEN]` — three sites each run the identical range test and then raise the hero's box **top** edge:

```
4516  cmp byte [0x377],0x12 / jl / cmp 0x13 / jg / 4524 add cx,0x18   ; cx = [0x17c]
AC92  same test                                   / ACA0 add bx,0x14
DB68  same test                                   / DB76 add bp,0x18  ; bp = [0x17c]
```

A port that omits it makes crouching purely cosmetic — the dodge stops working.

**The crouch-entry write zeros the animation phase, unconditionally** `[PROVEN]` — fresh disassembly of both DOWN-check handlers, walked in full while fixing a `gods-web` bug where the gate itself only checked *live* input and so never fired once a walk key had been released:

```
598a  call 0x5b38 / jc 0x59e5          ; an object at the crouch hot point -> straight to crouch
598f..59a9                              ; ladder/col+1 priority + direction test, see below
59e5  mov byte [0x377],0x13             ; state := 19 (CROUCH_L)
59ea  mov byte [0x341],0x0
59ef  xor cl,cl                         ; <- phase ZEROED, not carried over
59f1..59fb                              ; two more latch clears, jmp 0x5e9b
```

State 1's mirror (`CS:0x5bd2`) lands on the identical shape at `CS:0x5c29`–`0x5c33`, writing state 18 (CROUCH_R) and zeroing `cl` the same way. So the handoff-frame sprite is always `anim_base(18 or 19) + 0` — **29 or 31** — regardless of what `cl` held on the entering tick, not the "destination base, stale cl" convention documented elsewhere in this file for states that don't touch `cl` at all. This one does.

**The ladder-descend-vs-crouch direction gate is a genuine, confirmed ASYMMETRY between states 0 and 1 — not a shared rule** `[PROVEN]`, found chasing the same bug:

```
state 0 (CS:0x598f-0x59e5), sub = X & 0x1f:
  sub < 0xc                       -> check col-0 climbable only, no direction test
  sub in [0xc, 0x20), col+1 climbable -> test LEFT|RIGHT (0x382 & 0xc):
                                        held -> crouch (59e5) ; not held -> descend, col=1, +0x20 snap (59ab)
  sub in [0xc, 0x14], col+1 not climbable -> fall to col-0 test, no direction test
  sub in (0x14, 0x20), col+1 not climbable -> crouch directly, col-0 never checked

state 1 (CS:0x5bd7-0x5c29), sub = X & 0x1f:
  sub in [0xc, 0x20), col+1 climbable -> descend UNCONDITIONALLY (col=1, +0x20 snap) — no direction test at all
  otherwise (sub < 0xc, or col+1 not climbable with sub <= 0x14) -> test LEFT|RIGHT FIRST:
                                        held -> crouch outright, col-0 never checked
                                        not held -> check col-0 climbable -> descend (col=0, no snap) or crouch
  sub in (0x14, 0x20), col+1 not climbable -> crouch directly
```

State 0 gates its **col+1** branch on direction; state 1 gates its **col-0** branch instead — the handlers are not mirrors here despite being mirrors everywhere else in this pair. `gods-web`'s existing `climbableThreeBelowCol` (the col-0/col-1 sub-tile priority alone, thresholds `0xc`/`0x14`) is correct and unaffected; only the direction gate is unported, and stays that way — a first attempt at porting it assumed one shared rule, shipped with the polarity backwards, and was caught and reverted before the two-handler asymmetry above was found. Left as a disclosed cut: with no direction held (the only case newly reachable by the gate-fix itself), both states' behavior already matches the ungated col-priority code exactly.

**State 4 (base 9) is the spawn / arrival idle pose.** Eleven instructions, reading only LEFT and RIGHT — no up, down or fire — and otherwise falling into state 15's ground check. Exactly three entrants (`C6 06 77 03 04`, 3 hits file-wide): `CS:0x8c3e` (level start), `CS:0x8d6` (respawn, in the same routine that does `mov word [0x192],0x18`), `CS:0x1022` (teleport arrival).

⚠️ **The turn animation is not a symmetric ramp.** An earlier plausible reading had state 2 ramping `cl` 1..3 and state 3 ramping −1..−3. The bytes say otherwise: state 2 does `inc cl / cmp cl,3 / jnl → mov cl,6 / mov [0x377],1`; state 3 does `dec cl / js → mov cl,6 / mov [0x377],0`. Because the epilogue re-reads `[0x377]` *after* the handler, the handoff frame renders the **destination** base. Actual sequences:

| path | entry `cl` | rendered sprites |
|---|---|---|
| state 0 → 2 | 0 | **9, 10, 17** |
| state 4 → 2 (`cl=2`) | 2 | **17** |
| state 1 → 3 (`cl=2`) | 2 | **9, 8, 6** |
| state 4 → 3 (`cl=0`) | 0 | **6** |

There is no `cl` of −1..−3, and no sprite 11, 7 or 5. The `0 → 2` and `1 → 3` rows are now `[PROVEN]` — re-disassembled fresh in a later session (instruction-by-instruction, `CS:0x5dbb`–`0x5ddb` and `CS:0x5dde`–`0x5dfb`, entry sites `CS:0x5979`/`CS:0x5bc1`) while porting these states into `gods-web`, and the hand-computed render sequences from those bytes match this table exactly. The `4 → 2` / `4 → 3` rows (state 4's own direct entry into the turn states) remain `[WF]` — out of scope for that pass, not re-read.

⚠️ **That same re-read found the reversal-cancel branch each handler opens with, which this table's derivation didn't need and so never mentioned.** Before the `cl` ramp, state 2 (`CS:0x5dbb`) does `TEST [0x382],0x4 (LEFT) / JZ 0x5dca`; if LEFT is held it jumps straight to `MOV [0x377],3` (reverse into state 3, mid-turn) rather than running the ramp at all that tick. State 3 (`CS:0x5dde`) mirrors it, testing RIGHT (`0x8`). `gods-web` does not port this cancel branch — a disclosed simplification; a turn there runs to completion (2–3 ticks, ~200ms) regardless of input.

**State 7 is a bare `RET` at `0x593a`.** Handlers are entered by `jmp` with the caller's return address still on the stack, so this returns *past* the `0x5e9b` epilogue — skipping the phase store, the event probe, the camera update, sprite selection **and** the draw. It is a freeze, not a pose; its `anim_base` of 9 is never read. States 27 and 28 are three instructions each and transition immediately, so their bases are never read either.

### The wall probes and the map cursor `[PROVEN]`

`0x496a` builds the plane-B cursor with no rounding at all:

```
si = 0x5004 + ((X & 0xFFE0) >> 5) + ((Y & 0xFFF0) << 3)     ; col = X>>5, row = Y>>4, stride 128
```

Walking probes three cells spanning the hero's 3-row height, but only at certain sub-cell positions — **and the two directions differ**:

| dir | gate | cells probed |
|---|---|---|
| left (`5A84`) | `(X & 0x1f) == 0` | `[si-1]`, `[si+0x7f]`, `[si+0xff]` |
| right (`5CCB`) | `(X & 0x1f) < 8` | `[si+1]`, `[si+0x81]`, `[si+0x101]` |

Any probed cell `== 1` aborts the step entirely (`jmp` to the epilogue without moving); outside those windows the step is unconditional. The asymmetry matches the straddle threshold used elsewhere — the hero's body is ~24–25 px wide inside a 32 px cell, so moving right it must be tested one step *before* it overlaps column+1.

### The ladder controls `[PROVEN]`, and `UNKNOWN_climb_down_rate` — CLOSED

The `add [0x17c],6` at `0x5663` is not a snap, as an earlier revision of this file guessed — it is the **climb-down step**, and the branch that reaches it is unambiguous because the test is a full-byte `cmp`, not a `test`:

```
54CD  cmp byte [0x382],0x2 / jnz 54D7
54D4    jmp 0x564b            ; input == EXACTLY 0x02 (DOWN alone) -> the climb block
```

Inside that block the Y step is `add word [0x17c],0x6`, reached from **both** arms of the animation ping-pong. So **climbing down is 6 px/tick**, against 4 px going up — deliberately asymmetric.

The rest of state 13's input dispatch decodes just as cleanly:

| input | effect |
|---|---|
| DOWN alone (`0x02`) | climb down 6 px (`0x5663`) |
| RIGHT + FIRE | `mov byte [0x378],1` → the ladder-fire path (`0x55cf`) |
| RIGHT + UP | `jmp 0x5907` → **jump right off the ladder**, seeding `cl = 0x0C` |
| RIGHT + DOWN, after `[0x353]` reaches 2 | dismount right: `mov [0x377],1 / mov cl,6 / add word [0x17a],8 / sub word [0x17c],4`, gated on three wall probes |
| LEFT … | the mirror, from `0x5560` |

Note the dismount needs `inc byte [0x353] / cmp byte [0x353],2 / jng` — a **two-tick hold** before it fires, so a tap of RIGHT+DOWN does not throw the hero off a ladder.

**The animation ping-pongs 0↔3** (`0x565C inc cl / cmp cl,3 / jg`, `0x5688 dec cl / jz`) with a climb-step sound fired **only at the two turn-arounds**, not per tick, from the call site at `0x5931`. Leaving the ladder at the bottom exits to state 26 with `xor cl,cl` and `and word [0x17c],0xfff0` — a Y snap to the tile row, which *is* what `0x5679` does.

⚠️ **CORRECTED, a later session (surfaced while wiring `gods-web`'s footstep/climb audio).** This line used to read "the climb-step sound `0x5931`" — but `0x5931` is not a sound id, it is the CS: address of `FUN_1000_5931`, a 9-byte thunk (`push ax / mov ax,0x240 / call 0x22ca / pop ax / ret`). `get_function_xrefs` on that address finds exactly four callers: `CS:0x5681`/`0x5690` (state 13, descend) and `CS:0x58cd`/`0x58dc` (state 14, ascend) — the same four turn-around sites this section already names. The real sound id — the word actually passed to the sound-effect export at `0x22ca` — is **`0x240`**. `[STATIC]`: read as a `MOV` immediate in the disassembly, not cross-checked against a second binary the way the spike-crop closure was.

`UNKNOWN_ladder_up_branch` — the plain climb-UP branch was not isolated to a single site; the `sub word [0x17c],4` sites at `55F6`/`561C` sit inside the *fire* paths and are gated on `test cl,0x1` (even phases only).

### The ladder-ENTRY X snap is conditional, not unconditional — a shipped port bug, found live `[PROVEN]`

Reported live in the browser as visual clipping: *"instead of standing on top the character stands in it"*, screenshotted at a ladder next to a blue-grey brick wall with a green spiral-pattern decorative block — `PLEV1A`. Reproduced deterministically by driving the port's own `Clock.onTick`/`onRender` directly (bypassing `requestAnimationFrame`, which Chrome throttles hard for an automation-controlled tab) and walking the hero to world `x=224` — a real ladder column in `PLEV1A` — then pressing UP.

**The port's climb-entry code applied `this.x = (this.x + 0x20) & 0xFFE0` unconditionally on every ladder entry.** The five real sites doing this add-then-mask (`ADD word [0x17a],0x20` immediately followed by `AND word [0x17a],0xFFE0`) are `CS:0x4A36` (idle's own UP handler), `CS:0x59AB`/`CS:0x5BF3` (descend-onto-ladder, walk-left/right), and `CS:0x5A3C`/`CS:0x5C80` (climb-up entry, walk-left/right) — all disassembled fresh this pass, not taken on trust from the existing citation elsewhere in this file (which sits in the unrelated *jump animation phase* section and does not by itself establish which climb-entry branch it belongs to).

**The `ADD` only ever runs on the col+1 (one column to the right) match.** Every one of the five sites is reached through a two-way branch on the sub-tile position (`X & 0x1f`), and the branch that matches the hero's *own* column (`cmp byte [SI],2` / `cmp byte [SI+0x180],2`, no `+1`) jumps **directly past the `ADD`** into the `AND` alone — e.g. `CS:0x4a61 jz 0x1000:4a3b`, where `0x4a3b` is the `AND`, two bytes past the `ADD` at `0x4a36`. Confirmed identically at `CS:0x5a2f jz 0x1000:5a41` (skipping `0x5a3c`) and at `CS:0x59e3 jz 0x1000:59b0` (skipping `0x59ab`). So the real rule is:

| which test matched | X update |
|---|---|
| the hero's **own** column (`sub < 0x10`, testing `[SI]`/`[SI+0x180]`) | `X &= 0xFFE0` — floor to the **same** tile, no advance |
| the column **one to the right** (`sub >= 0x10`, testing `[SI+1]`/`[SI+0x181]`) | `X += 0x20` **then** `X &= 0xFFE0` — advance a full tile |

Applying the `+0x20` unconditionally — as the port did — takes an entry that matched in the hero's own column and shoves it one whole tile **past** the ladder, into whatever the next column holds. At `PLEV1A`'s first ladder (`x=224`, the tile origin, sub `= 0`, matching the own-column branch) that lands at `x=256`, a solid pillar: `climbableHere` then fails on every subsequent up-tick (256 is never marked climbable there), so the hero froze at `y=944` indefinitely while the sprite rendered visibly embedded in the wall beside the ladder instead of standing on/climbing it — exactly the reported symptom, and also why holding the key produced no motion at all when reproducing this live (a second, unrelated finding along the way: `requestAnimationFrame` in a Chrome tab under remote-control automation is throttled independently of tab-visibility APIs, and neither a synthetic `KeyboardEvent` nor a real click reliably un-throttles it session-to-session — stepping the port's `Clock` callbacks directly is the reliable way to drive deterministic ticks in that environment).

**Fix** (`gods-web/src/game/player.js`): `climbableHere`/`climbableThreeBelow` now have column-returning variants (`climbableHereCol`, `climbableThreeBelowCol`) instead of a bare boolean, and a `ladderSnapX(x, col)` helper applies the `+0x20` only when `col === 1`. Both climb-entry call sites in `_ground` (`climbableThreeBelow` for descend-onto-ladder, `climbableHere` for climb-up) were switched to the column-aware versions. Three new assertions in `checks.js` cover it: entry from the ladder's own column no longer overshoots into an adjacent solid column and the hero actually climbs afterward, and entry approaching from the left (the genuine col+1 case) still correctly advances onto the ladder — a regression guard so the fix doesn't overcorrect the real forward-snap case. `node tools/verify-node.mjs`: 584/584 rows pass (up from 581); `node tools/lint-checks.mjs` passes.

### The sideways ladder-dismount genuinely never tile-snaps — re-verified live, and it is not a bug `[PROVEN]`

The maintainer separately reported "there is no clipping bug when dismounting a ladder and jumping onto a platform" — apparently contradicting the port's own dismount code (`this.x += dir*8; this.y -= 4;`, no `AND` anywhere). Re-disassembled all four dismount sites fresh (state 13/14 × left/right) and re-tested live under DOSBox:

```
57A6  mov byte [0x377],1  ; state:=WALK_RIGHT
57AB  mov cl,6
57AD  add word [0x17a],8  ; X: plain add, no snap
57B2  sub word [0x17c],4  ; Y: plain sub, no snap
57B7  jmp 0x5e9b
```

byte-identical (mirrored) at the other three sites. **There is no snap — the original really does produce a non-16-aligned Y**, confirmed live: mounting a ladder at `y=944` and dismounting after 3 climb steps landed at `y=934` (`938-4`, `934 mod 16 = 6`). The reason no clipping is ever *seen* is the self-correcting pipeline already documented elsewhere in this file: if the landing tile is open (the common case), the hero free-falls one 15 Hz tick and the fall-landing snap (`AND [0x17c],0xfff0`) corrects Y before it is ever rendered — confirmed live twice, both times settling back to a clean `y=944`. If the landing tile is instead solid, the walk state's own coarse ground check (`CS:0x593e`, floored row) accepts the unaligned Y with **no correction at all**, which would leave the hero's feet embedded up to 15 px — a real, still-unfalsified potential clipping case that neither this session nor the live test happened to hit (every tested dismount landed over open space).

**So `gods-web`'s existing dismount code (no snap) already matches the original exactly — no fix needed.** `_ground`'s `solidThreeBelow`-gated fall entry and `_fall`'s own `y &= 0xfff0` landing snap already reproduce the same self-correction the original relies on.

**A separate, genuine divergence was found in the same pass and left unfixed.** The original seeds a high initial animation phase on *every* ladder-mount transition — `CL:=0x1a` (idle-UP-mount, `CS:0x4a45`; walk-UP-climb-mount, newly found at `CS:0x5a4b-0x5a50`; walk-descend-left-mount, newly found at `CS:0x59ba-0x59bf`) or `CL:=0x1c` (walk-descend-right-mount, newly found at `CS:0x5c02-0x5c07` — asymmetric against the left-approach mirror) — which routes the very next tick into a high-`cl` continuation that performs **one automatic `CLIMB_STEP`-sized Y move with zero player input** before real input is ever read. Confirmed live: an idle-UP mount at `y=944` read back as `y=938` one tick later with no key held. `gods-web`'s `_ground` sets `this.phase = 0` on all four of these same transitions and applies no compensating step, so the port's climb sequence starts from a different residue class than the original's from the very first tick — which could itself explain some *other* future clipping report, since it shifts every subsequent climb-phase alignment by one step. `UNKNOWN_ladder_mount_free_tick` — not fixed this pass: the port's `_climb` ping-pong logic is built around a `0..3`-range `cl`, not the original's `cl>=0x14` redirect mechanism, so reusing the normal per-tick path with a seeded high phase would need its own verification against the port's tick/tock architecture before landing a fix, and the asymmetric `0x1a`-vs-`0x1c` seed on the two descend-approach directions was not itself traced to a confirmed differing effect.

### `UNKNOWN_ladder_anim_phase` — CLOSED: `cl=1` is left-foot-forward, `cl=3` is right-foot-forward `[PROVEN]`

The residual (named in `gods-web/README.md`'s own status table) was purely which of the climb cycle's four `cl` values (sprites `anim_base(25)+cl` = 25/26/27/28) render which foot forward — not a movement-direction question, since the DOWN-only climb block applies the same `add [0x17c],6` regardless of phase (see above).

**Rendered from the validated atlas** (`tools/hero-sheet.mjs`-style extraction of `PALWAYS1` frames 25–28, the exact bytes the game's own atlas loader produces): the four frames are **not** a plain walk-style cycle — they alternate between two symmetric "neutral" poses and two asymmetric "reaching" poses:

| `cl` | sprite | pose |
|---|---|---|
| 0 | 25 (32×48) | legs extended/spread, both arms down — symmetric |
| **1** | 26 (32×48) | **screen-left arm raised, screen-left leg bent/forward** — reaching |
| 2 | 27 (32×43, shorter) | legs compressed/crouched, both arms down — symmetric, the cycle's other extreme |
| **3** | 28 (32×48) | **screen-right arm raised, screen-right leg bent/forward** — the mirror of `cl=1` |

**Confirmed live**, not just from the extracted atlas: paused `GAME.EXE` under the DOSBox debugger mid-climb (state 14, same `anim_base=25`), read `DS:0x36b` (the persisted animation phase) and `DS:0x377` (state) directly out of guest memory, and captured the exact composed frame at each reading. `cl=3`, captured live, shows the hero's screen-right arm raised and screen-right leg forward — pixel-identical in silhouette to the atlas-rendered sprite 28. `cl=2`, captured live a few ticks later (hero's Y had advanced, confirming real climbing motion, not a frozen state), shows the symmetric crouched pose — matching sprite 27 exactly, right down to the shorter frame height. Both checks used `DS` segment 4970 for this run (verified correct beforehand by reading the documented constant fallback-palette table at `DS:0x86` and getting an exact byte-for-byte match against the sixteen `0x0RGB` words already recorded in this document).

Since viewed from behind (climbing away from camera, no left/right mirroring the way a face-on sprite would have), screen-left/right corresponds directly to the hero's own left/right. **So `cl=1` is the left-foot-forward frame and `cl=3` is the right-foot-forward frame**, with `cl=0`/`cl=2` as the two feet-together passing poses at the ping-pong's ends (extended) and middle (crouched) respectively.

### `UNKNOWN_hero_sprite_anchor` — CLOSED `[PROVEN]`

The draw at `0x6049` computes `heroX − [0x1ae]`, `heroY − [0x1b0]`, which looks like a per-sprite trim offset. It is not. **All three writers of that pair** (`0x023f`, `0x0a14`, `0x92ad`) do the identical four instructions — `mov ax,[0xa] / mov [0x1ae],ax / mov ax,[0xc] / mov [0x1b0],ax` — immediately before `call 0x4993`. They are a **snapshot of the scroll origin taken before the state machine runs**, so the draw is plain screen-space conversion against the *previous* frame's camera.

**The sprite anchor is therefore exactly `(X, Y)`, top-left, with no offset.** Corroborated by the pickup test at `0x6069`, which uses `(X + 0x10, Y + 0x28)` as the hero's hot point — the centre-bottom of a 32×48 box anchored at `(X, Y)`.

**No handler in `0x4993`–`0x5e22` calls any graphics or sound driver export** (scanned for both thunk forms, zero hits) — all rendering is deferred to the epilogue's `call 0x6049`.

Handlers are entered by `jmp`, not `call`, with `CL` preloaded and the caller's return address still on the stack; they exit via `jmp 0x5e9b`. No handler offset repeats, but handlers **share code by tail-jumping into each other's bodies**, so a port cannot treat the 29 states as independent routines.

X/Y are proven integer by the map-pointer routine `1000:496a`: `col = (X & 0xFFE0) >> 5`, `row_stride = (Y & 0xFFF0) << 3` over map plane B at `0x5004` — 32×16 tiles, 128 columns, matching the `.MAP` format exactly.

**Movement constants.** Walk is a bare `add`/`sub word [0x17a],4`; **there is no X-velocity variable in the binary** — no acceleration to model. Gravity (`1000:48b0`) is `inc word [0x1b2]` clamped to `10`; falling advances `dY = 4 + v` = 5…14 px/tick. `GAME.EXE` contains **zero x87 instructions** (checked across Ghidra's listing *and* all 76 code gaps, plus zero `CD 34`–`CD 3D` FPU-emulator traps), so every constant is integer.

### The jump animation phase `[PROVEN]` — formerly `UNKNOWN_jump_anim_phase`

Both jump handlers open with a four-case chain on the incoming `CL` and the arc cursor `DS:0x358`, read **before** this frame's `+= 2`:

```
state 8, jump LEFT (base 31), CS:0x4E6C          state 9, jump RIGHT (base 29), CS:0x5064
  cl == 0x0D -> cursor < 4 ? 0x0D : 7              cl == 0x0C -> cursor < 4 ? 0x0C : 5
  cl == 6    -> 6                                  cl == 5    -> 5
  cl == 0    -> cursor < 4 ? 0 : 5                 cl == 0    -> cursor < 4 ? 0 : 4
  else       -> 6                                  else       -> 5
```

⚠️ **The asymmetry is real — do not mirror it.** State 8's `0x0D` exit stores **7** while its catch-all stores **6**, so jump-left has two distinct airborne frames; state 9 stores **5** in both places and has one.

**Where the high phases come from:** `0x0C`/`0x0D` are set *only* when jumping **off a ladder** — `CS:0x5912 mov cl,0xc` (right) and `CS:0x5927 mov cl,0xd` (left), both inside state 14 and both followed by `mov byte [0x358],0`. A ground take-off instead does `xor cl,cl / mov byte [0x358],0` (`CS:0x5A17`). That is the entire reason two entry phases exist: **the hero leaves a ladder in a visibly different pose.**

Resulting sprite sequences, all inside the hero range:

| take-off | sprites |
|---|---|
| ground, left | 31, 31, 36, 37, 37, … |
| ground, right | 29, 29, 33, 34, 34, … |
| ladder, left | **44**, 44, 38, 37, 37, … |
| ladder, right | **41**, 41, 34, 34, … |

The two leading frames are the crouch, which independently matches the arc table's leading zeros.

**The jump ignores gravity entirely — it is table-driven.** `1000:4f6f` walks a 23-entry `int16` delta table at `DS:0xd922`, subtracting each from Y (twice, when the double-jump power-up word `[0x174]` is set):

```
0 0 0 0 6 6 5 4 4 3 2 1 1 0 -1 -1 -2 -3 -4 -4 -5 -6 -6
```

Exactly symmetric — 4 ticks of wind-up, 32 px rise, apex, 32 px descent, then state `0x0b` (fall). **A port must copy this table; simulating it with gravity will not match.** Air control is a budget rather than a lockout: the rise is fully committed, and the fall allows 3 steering steps (12 px) before `DS:0x345` caps out.

### The jump has a ceiling-ejection check — `CS:0xE4E`, previously undocumented `[PROVEN]`

Found live: the maintainer tested the real DOS game and reported "when standing below a platform and jumping the character doesn't clip through the platform either." `gods-web`'s `_jump()` had no ceiling test at all — it applied the delta table unconditionally every tick — so the port's hero could rise straight through a low platform's underside. This document's own jump-animation prose above never mentioned a ceiling test either; it turns out to exist, shared by both jump handlers, and was simply never noticed.

```
4E4E  call 0x1000:496a         ; rebuild the plane-B cursor from the CURRENT (post-delta) X/Y
4E5x  cmp byte [si],1 / jz hit ; solid at the hero's own cell?
      (X&0x1f)>=8 -> also test [si+1]     ; the same straddle rule solidHere() already uses
```

Called **unconditionally every tick**, from both `CS:0x4F89` (state 8, jump left) and `CS:0x5188` (state 9, jump right), immediately after that tick's Y delta is applied — it is a penetration-ejection check, not a rise-only look-ahead, so it fires just as readily on the arc's downward half. On a hit:

```
4F8C  and word [0x17c],0xfff0   ; floor to the tile row the hero is now inside...
4F92  add word [0x17c],0x10     ; ...then push ONE FULL ROW further down (the AND
                                 ;   alone would move the hero UP, into the ceiling)
4F97  mov byte [0x377],0xb/0xc  ; force FALL_LEFT/FALL_RIGHT
4F9C  mov word [0x176],0        ; fall-damage zeroed here too (NOT just fallV/airSteps —
                                 ; a port routing this through a generic "enter fall"
                                 ; helper that omits this reset diverges)
      mov byte [0x345],0 ; mov word [0x1b2],0 ; xor cl,cl
      jmp 0x5e9b               ; skips the cursor advance AND the fire-guard this tick
```

⚠️ **The X-step runs BEFORE the Y delta, not after.** `CS:0x4E94`–`0x4EB9` (the wall-probe/X-step) executes using the hero's **pre-delta** Y — before the delta table at `CS:0x4F6F` is even reached. A port that applies the Y delta first and then walks tests the wrong row near a 16px boundary (up to 12px off during a double jump). `solidHere()` in `gods-web/src/game/player.js` was already byte-identical to `CS:0x4E4E`'s own straddle logic; it just had no call site in `_jump()`. Fixed: `_jump()` now walks before applying the delta, then calls `solidHere` after, matching the response above exactly. Confirmed live: an unobstructed jump still rises the documented symmetric 32 px; a jump under an injected low ceiling rises only as far as the tile boundary and bounces cleanly into a fall, never showing the hero's sprite inside the solid tile. `node tools/verify-node.mjs`: assertions added covering both the unobstructed arc and the ceiling-bounce case.

Two adjacent findings from the same pass, **not yet ported** (real gaps, flagged for future work rather than fixed here):
1. Holding UP or DOWN while airborne, tile-aligned, over a climbable cell drops the hero straight into climb state 13/14 mid-jump (`Y &= 0xfff8`, a multiple of **8**, not 16) — refuting this project's own earlier claim that climb is only ever entered from the ground/idle handlers.
2. `_fireTick`'s jump-family branch (states 20/21) needs the identical ceiling check (added — see the fix in `player.js`), but faithfully matching the original also requires reordering `_fireTick` so movement runs before the emit decision, since a ceiling-hitting tick in the original never emits a shot; that reorder was **not** made this pass, to avoid an unverified restructuring beyond the reported bug's scope.

### The jump has a mid-arc EARLY-LANDING check too — `CS:0x4E2D`, now ported `[PROVEN]`

⚠️ **Corrects a claim this document itself made one pass earlier** (in the list above, now removed): an early revision recorded this check as having thresholds "asymmetric between the two handlers (state 8: `>=0x16` then `>=0x12`; state 9: `>=0x16` twice)". A full, fresh instruction-by-instruction disassembly of both handler bodies this pass (`1000:4e6c`–`1000:4fab` for state 8, `1000:5064`–`1000:51a3` for state 9) finds **exactly one** such check in each, both gated on the **identical** threshold `cmp byte [0x358],0x16`. The asymmetry claim does not survive a real read; it was refuted, not confirmed.

Reported live in the browser as two related clipping bugs: *"the ladder dismount clipping bug happens when the hero doesn't climb up the ladder all the way but instead jumps off earlier"* and *"the other clipping bug is when I try to jump onto the other platform (left) from the platform I am currently standing on"*. Both trace to the same missing mechanism.

```
4F49  cmp byte [0x358],0x16 / jl 0x4f6f    ; jumpCursor < 22 -> skip, go straight to the arc delta
4F50  call 0x1000:4e2d                      ; the ground probe — see below
4F53  cmp ch,0 / jz 0x4f6f                  ; not landed -> fall through to the normal arc path
4F58  mov byte [0x377],0x11                 ; state := 17 ("land left"), anim_base 31 (== JUMP_L's base)
4F5D  and word [0x17c],0xfff0               ; Y-snap to the tile row
4F62  xor cl,cl                             ; phase := 0
4F64  mov byte [0x357],0x0
4F69  call 0x1000:4c54                      ; landing sound effect
4F6C  jmp 0x1000:5e9b                       ; epilogue — the arc delta for THIS tick is never applied
```

State 9 (jump right) mirrors it exactly at `CS:0x5148`–`0x516B`, same threshold, transitioning to state `0x10` ("land right", base 29) instead. `CS:0x4E2D` is the shared probe, and it is **byte-identical in shape** to `solidThreeBelow` — `[si+0x180]` (3 rows below), with the straddle test `(X&0x1f)>=8 -> also test [si+0x181]`:

```
4E2D  call 0x1000:496a          ; rebuild the plane-B cursor from the CURRENT (pre-delta) X/Y
4E30  xor ch,ch
4E32  cmp byte [si+0x180],1 / jz 0x4e4b     ; solid 3 rows below?
4E39  mov ax,[0x17a] / and ax,0x1f / cmp ax,8 / jl 0x4e4d
4E44  cmp byte [si+0x181],1 / jnz 0x4e4d    ; the straddle neighbor
4E4B  inc ch
4E4D  ret
```

Two things matter for a port, both confirmed by tracing the caller sequence exactly rather than assumed from the probe's shape alone:

- **The order.** The probe runs AFTER that tick's own horizontal walk step (`CS:0x4E94`–`0x4EB9` / `CS:0x508C`–`0x50B5`) but BEFORE that tick's arc delta is read from `DS:0xd922` — so it tests the position the hero is ABOUT to occupy horizontally this tick, at the Y it still holds from last tick. A port that probes after applying the delta lands a tick late, at the wrong row.
- **`0x16` (22) is NOT "past the apex".** `i = cursor>>1 = 11`, and `JUMP_DELTAS[11]` is `+1` — the table is still RISING through `i=13` (peak at `i=12`/`13`, both `+0`/`+1` net). The check is live for the last two rising ticks as well as the whole descent, not gated on direction.
- **The jump's own Y never dips below the launch height until the very last delta is applied** — `JUMP_DELTAS` sums to exactly 0 over all 23 entries (`0+0+0+0+6+6+5+4+4+3+2+1+1+0-1-1-2-3-4-4-5-6-6=0`), so the arc returns to the exact launch Y and no lower. Consequently this check can only ever catch a platform **at or above** the launch height — exactly the "clear a gap onto a similar or slightly higher ledge" geometry the reported bug describes. A platform genuinely lower than launch height is caught by the pre-existing FALL landing check instead, once the scripted arc completes and transitions out of JUMP.

**Fix** (`gods-web/src/game/player.js`, `_jump()`): a new exported constant `JUMP_ARC_EARLY_LAND_CURSOR = 0x16` gates a `solidThreeBelow` probe inserted between the horizontal walk step and the arc-delta application, matching the instruction order above exactly. On a hit: `Y &= 0xfff0`, transition straight to `ST.GROUND`/`S.IDLE` (this port has no separate one-tick landing pose for states 16/17 — the same simplification `_fall()`'s own landing already makes, so the two landing paths now agree). The old `_jump()` had no landing test of any kind mid-arc — only the unrelated `solidHere` ceiling-ejection check (opposite direction, penetration not landing) — so it ran the full scripted 23-entry arc regardless of what was underfoot, walking further past a reachable ledge every remaining tick before ever testing the ground via FALL, which is exactly the "hero clips past the platform" symptom reported. Six new `checks.js` assertions cover: landing mid-arc on a higher platform instead of sailing over it, a regression guard that a jump over genuinely open air still completes the full arc into FALL, the exact threshold boundary (`jumpCursor` one tick before 0x16 does not land; at 0x16 it does, on the identical ground), and a ladder jump-off at a non-tile-aligned Y catching a nearby ledge mid-arc and landing tile-aligned. `node tools/verify-node.mjs`: 566/566 assertions pass (up from 560); `node tools/lint-checks.mjs` passes.

Not yet confirmed live in DOSBox for this specific mechanic (the port fix rests on the disassembly alone, tagged `[STATIC]` for the live-observation half of this project's evidence standard). To promote: an execute breakpoint at `877:0x4f50` (state 8) or `877:0x514f` (state 9) should hit, with `CH=1` in the return register on the tick the hero lands short of the arc's scripted end — i.e., before `DS:0x358` reaches `0x2e`.

**Ladder snap** rounds to the **tile origin**, not the tile centre: `add word [0x17a],0x20` / `and word [0x17a],0xFFE0` — the `AND` can only yield a multiple of 32.

## `UNKNOWN_DS_0192` — CLOSED: health, and a bar that lags it `[PROVEN]`

Two variables, not one, and conflating them is why this stayed open. **`DS:0x192` is the health TARGET** (max 24); **`DS:0x19a` is the DISPLAYED bar**, which chases the target one unit per frame — and the bar, not the target, is what everything else tests.

The chase routine is `FUN_1000_0dff`, called once per frame from the main loop at `0x02c6` (plus three other sites):

```
0DFF  mov ax,[0x19a]              ; displayed
0E02  cmp ax,[0x192]              ; vs target
0E06  jg  0xe10                   ; too high -> tick DOWN
0E08  jl  0xe2a                   ; too low  -> tick UP
0E0A  mov byte [0x3ad],0          ; equal: clear the one-shot latch / RET

0E10  dec word [0x19a]            ; DOWN one unit
0E15  cmp byte [0x3ad],0 / jnz    ; latch: play the hurt sound ONCE per descent,
0E1D  mov ax,0xe42 / call 0x22ca  ;   not once per tick
0E24  inc byte [0x3ad]

0E2A  mov byte [0x3ad],0          ; UP one unit, clamped at 24
0E2F  inc ax / cmp ax,0x18 / jng / mov ax,0x18 / mov [0x19a],ax
```

**Level start fills the bar visibly**: `0x84B mov word [0x192],0x18` then `0x851 mov word [0x19a],0x1` — target full, display 1, so it animates up over 23 frames.

| what | site | effect |
|---|---|---|
| combat damage | `0xACD3 sub [0x192],dx` | `dx = ((raw + 1) >> 5) + 5`, gated on `[0x172] == 0` (invulnerability) — see the correction below |
| fall damage | `0x4C4A`, `0x4CC1`, `0x4D4F` `sub [0x192],ax` | one site inside each of the three fall handlers |
| potions | `0x6310 +2`, `0x63BE +3`, `0x639D +4`, `0x6339 +0xc`, `0x6362 +0x18` | each followed by `cmp 0x18 / mov 0x18`, and each gated on `cmp word [0x19a],0` — **a potion does nothing while the bar reads zero** |
| respawn restore | `0x7D26 mov bp,[0x250] / 0x7D2A mov [0x192],bp` | `DS:0x250` holds the value to restore |
| the death test | `0x1BD cmp word [0x19a],0` → `jns`/`jnz`, else `jmp 0x9bb` | **reads the BAR, not the target** |

That last row matters for a port: because the bar lags by up to 24 frames (1.6 s at 15 Hz), a hit that takes the target to 0 does not kill immediately — the player has the bar's descent to drink a potion. Draining the target instantly would change the game.

`0x9bb` is a 17-call reset sequence ending `mov word [0x1d2],0x8c54 / mov byte [0x33c],0xff`; that it is specifically death-and-respawn is `[STATIC-INFERENCE]` from its shape — the lives decrement `0x93A dec word [0x224]` was **not** traced to this path.

**Consequence for the trigger table:** conditions 7 and 8 (`0x3F13`/`0x3F21`, `[0x192] >` / `< arg`) are **health** conditions. So the `"help bonus"` triggers that this document described as gating on *ammo* actually gate on the player being hurt — which is a far more sensible design and is the real mechanism behind GODS' reputation for adaptive difficulty.

⚠️ **Two corrections to the rows above.**

**1. The damage shift is `>> 5`, not `>> 4`.** `CS:0xACBE` is `inc dx` followed by **five** `D1FA` (`sar dx,1`) at `0xACBF`, `0xACC1`, `0xACC3`, `0xACC5`, `0xACC7` — ten bytes, closing exactly at `0xACC9 add dx,5`. So `damage = ((raw + 1) >> 5) + 5`.

This is not pedantry, because for System-B contact the `raw` strength is **the enemy's own HP** and shipped HP runs to 255:

| HP | 2 | 15 | 45 | 100 | 255 |
|---|---|---|---|---|---|
| `>> 5` (the bytes) | 5 | 5 | 6 | 8 | **13** |
| `>> 4` (the old note) | 5 | 6 | 7 | 11 | **21** |

The two disagree on **27 of the 31 distinct HP values that ship**. Against a maximum health of 24, the wrong reading makes one touch from a late-game creature cost 21 of 24 rather than 13 — very nearly instant death.

**2. Death fires when the bar reaches ZERO, not below.** Both branches of the test reach the same reset:

```
01BD  cmp word [0x19a],0
01C2  jns 0x1c7  / 01C4 jmp 0x9bb      ; bar <  0 -> death
01C7  jnz 0x1cc  / 01C9 jmp 0x9bb      ; bar == 0 -> death
```

So the condition is `bar <= 0`. Note the damage routine's own guard is `js` — it skips only when the bar is **negative** — so at a bar of exactly zero a hit still lands.

### The damage routine `CS:0xac59` `[PROVEN]`

Reached from 18+ sites through the `CS:0xa9e4` thunk plus four direct callers (`0x07ef`, `0x7d6e`, `0x8be2`, `0xb49f`).

⚠️ **The calling convention has a trap.** The routine opens `push ax / push cx / push dx / push bx` and then does `0xAC84 pop ax / 0xAC85 push ax` — which pops the **fourth** thing pushed, i.e. **BX**. Read literally as "pop ax restores ax", the routine appears to test the attacker's X against the hero's *Y* box, which is nonsense. The real convention is **`ax` = attacker X, `bx` = attacker Y, `bp` = strength**.

The box test is the same shape on both axes:

```
ac64  bx = heroX ; cx = bx ; bx += 0x0a ; cx += 0x16    ; hero core [X+10, X+22]
ac70  dx = [0x1e2] >> 1                                 ; half the attacker's width
ac76  ax += dx ; bx -= dx ; cx += dx
ac7c  cmp ax,bx / jl reject / cmp ax,cx / jg reject
```

which reduces to `heroX + 10 − w <= atkX <= heroX + 22`, and identically for Y over `[heroY + 8, heroY + 38]`. **Crouching (states 18/19) raises the top edge by 20** (`0xACA0 add bx,0x14`), so the dodge is real geometry rather than decoration.

⚠️ **`bp` is IN AND OUT.** Every caller tests its *sign* after the call (`0x07F2 or bp,bp / js`, `0xB4A2`, `0xA9E7`). The routine writes `bp = 0xFFFF` only when **`DS:0x34 == 0`** (`0xACDB`/`0xACE2`); the reject path leaves it untouched. So a hit with `DS:0x34 != 0` still damages the hero but reads as "no hit" to the caller. `UNKNOWN_DS_0034` — written 0/1/2 from eight sites, initialised to 0 at `CS:0x009e`, meaning unestablished. A port that returns a plain boolean loses this gate.

Also note `[0x1e2]`/`[0x1e4]` are **globals set by each caller immediately before calling**, not parameters — a stale-value hazard the moment two attackers are tested in one frame.

### Entity contact — `CS:0xff93`, shared by BOTH entity systems `[PROVEN]`

```
ff93  mov word [0x1e2],0x20 / mov word [0x1e4],0x20   ; a 32x32 creature
ffa2  mov bp,[di+0x8]              ; STRENGTH = the entity's own state word
ffa5  add ax,[0xa] / add bx,[0xc]  ; the caller passes SCREEN coords
ffaf  call 0xa9e4                  ; -> 0xac59
ffb4  mov [di+0x8],bp              ; AND WRITES IT BACK
ffb7  or bp,bp / js 0xffbf / ret
ffbf  mov word [di+0x4],0xffff / mov word [di+0x6],0   ; start the death frames
```

**Touching the hero costs him health AND kills the creature.** The entity's state word and the damage strength are literally the same word passing through one routine in both directions: the routine stores `0xFFFF` into it on a reported hit, the caller writes it straight back, and a negative state is *dying*. So creatures are not persistent contact hazards — each one gets one touch.

`0x7d6e` is **not** an attack despite calling the same routine: it saves `[0x192]` into `[0x250]` (the respawn-restore slot, read back at `0x7D26`) and brackets its call by patching the self-modifying gate `[cs:0x71d]` to `0x90`. It sits inside the death/respawn region.

⚠️ **`CS:0xff93` has two callers, one per entity system** — `CS:0xedf4` (System B, below) and a site inside System A's pipeline `CS:0xe001`. Contact *and* the draw `CS:0x3569` are shared; see *`UNKNOWN_sysA_movement_layer` — CLOSED*. An earlier revision of this heading said "System-B contact", which is why the System-A pipeline looked like it had no contact test of its own.

**The System-B caller is the per-frame entity driver, `CS:0xedf4`** — contact is tested every frame, immediately after the movement-mode handler runs:

```
edb8  cmp word [0x2fa],0 / jnz            ; a global gate
edc3  si = 0xdbe0 + [di+0xa]*4 / call ax  ; run the movement mode
eddd  ax = [di] ; bx = [di+2]
ede2  ax -= [0xa] ; bx -= [0xc]           ; world -> SCREEN
edea  [0x4] = ax ; [0x6] = bx             ; (these feed the draw call)
edf4  call 0xff93                         ; which adds the scroll back on
edf7  cmp word [di+0x8],0 / jns 0xee00
edfd  jmp 0xf02a                          ; NEGATIVE -> the death path
ee00  call 0x3569                         ; alive -> draw
```

The screen conversion at `0xede2` and the world conversion inside `0xff93` are a **round trip** — they exist because `[0x4]`/`[0x6]` are also the draw call's arguments, so a port may pass world coordinates directly.

### `UNKNOWN_creature_death_anim` — CLOSED: the death path draws through the SAME call as the alive path `[STATIC]`

`CS:0xF02A` — reached only from `CS:0xEDFD` on a negative `[di+0x8]` — is two instructions:

```
f02a  call 0x1000:efe7      ; a small helper, read below
f02d  jmp  0x1000:ee00      ; UNCONDITIONAL -> the SAME draw call the alive branch uses (-> CALL 0x3569)
```

So the earlier framing — *"`0xf02a` is unread, so a port should stop drawing a dying creature"* — is **wrong, and the opposite of what the bytes do**: a dying System-B entity is never skipped from the draw. It falls straight into the identical `CALL 0x3569` the live path takes, run through **whatever sprite formula the caller staged into `[0x4]`/`[0x6]`/`[0x8]` before the jump** — see the correction immediately below for what that formula actually is; it is not the ordinary one every other reading of `CS:0xf0ae` uses. A port that special-cases "stop drawing on death" diverges from the original, which relies on the death-sequence counter (not a skip) to produce the death animation's frames through the normal draw path.

⚠️⚠️ **CORRECTION, a later session — `CS:0xF02A` and the real fade (`CS:0xF030`) are TWO DIFFERENT DRAWS, and only the first uses "the ordinary formula"; the fade itself does not.** A fresh `disassemble_bytes` of `CS:0xF030`–`0xF0AB` (not a re-read of this section's own prior summary) settles it precisely, and corrects a claim that had stood uncorrected for a full session and was carried into a port as a result:

```
ff20  cmp word[di+8],-2 / jz ff4b        ; -2 = waiting
ff26  cmp word[di+8],-3 / jz ff2f        ; -3 = materialising-countdown/reactivate
ff2c  jmp f030                            ; ANY OTHER NEGATIVE (i.e. the DYING sentinel, -1) -> the fade

f030  inc word[0x1f4]                     ; a per-GROUP dying tally, not the entity's own frame
f034  cmp word[di+4],0 / jns f06e          ; [di+4] still NEGATIVE (i.e. exactly -1, the kill-tick value
                                           ;   CS:0xFFBF seeded) -> ONE-SHOT: cache position, maybe drop
                                           ;   a per-kill popup via CS:0xBF5F using [di+0x10] -- then fall
                                           ;   through to f06e regardless
f06e  inc word[di+4]                      ; UNCONDITIONAL every f030 call
f071  cmp word[di+4],7 / jl f084          ; still < 7 -> draw the fade frame
f077    [di+8]:=0 ; [di+6]:=0 ; jmp ed72   ; >= 7 -> FINALISE, no draw this tick
f084  ax=[di]-[0xa] ; bx=[di+2]-[0xc]      ; world -> screen (identical to the alive path)
f091  cx = [di+4]                          ; the frame counter, now 0..6
f094  cx += 0x6c                           ; <-- A FLAT CONSTANT, NOT a class_table[cls] lookup
f097  [0x4]=ax ; [0x6]=bx ; [0x8]=cx
f0a5  call 0x1000:3569                     ; the SAME draw call the alive branch uses
```

So **only** `[0x4]`/`[0x6]`/`[0x8]` differ between the two draws — the `CALL 0x3569` is genuinely shared, exactly as the paragraph above says — but the sprite value staged into `[0x8]` is `0x6c + [di+4]` for the fade (frames 0..6, the universal `0x6c`-base death-cloud range this document already documents for the world-2 nest, the ce64 creature, the world-1 statue and the hero's own death burst), **not** `class_base + MODE_ANIM[mode] + frame`. That ordinary formula genuinely is what `CS:0xF02A` uses (`jmp 0x1000:ee00`, the alive path's own draw prologue, reached only on the exact tick contact kills the entity — `[di+4]` is still `-1` at that point, one below the entity's current `animBase`) — so the "ordinary formula" claim was correct for `F02A` specifically, but this section's own prose generalised it to the WHOLE death sequence, which is wrong for every tick after the first. `[di+4]` is not merely "the death-sequence counter" in the abstract; it is a **negative-starting, then-0..6-counting** state variable whose sign gates the one-shot popup and whose magnitude (once non-negative) selects a `0x6c`-based sprite, finalising the entity at exactly 7. `gods-web`'s `entity.js` now ports this precisely (`DEATH_SPRITE_BASE = 0x6c`, `DEATH_FRAMES = 7`), with the kill-tick's own `F02A`-style draw left to the render pass (which already has `mode`/`cls` in scope and naturally sees `frame === -1` before `tick()` ever runs the fade, since this port's own contact code runs after its per-entity `tick()` loop each frame). The per-kill popup (`CS:0xBF5F` via `[di+0x10]`) remains unported — no popup-rendering module exists in this project yet, the same disclosed gap `selector2.js`'s own group-elimination reward already carries.

`CS:0xEFE7` itself (the helper called first) reads a byte at `[SI+1]`, halves it (`SHR 1`), adds 1, divides by 10 (`DIV BL, BL=0xa`), and packs the quotient/remainder into a nibble pair (`SHL AL,1 ×4` then `OR AL,BL`) — the same divide-by-10, pack-two-digits shape this document's own BCD score routine (`CS:0x1950`) uses. `[SI]` here is not the entity pointer `DI` (which stays reserved for the draw call) — `UNKNOWN_efe7_source` narrows to exactly what `SI` points at and what the packed byte feeds; plausibly a per-kill score/popup award (consistent with, but not full confirmation of, this document's existing `[WF]` note that "kills award score by the same path as contact kills").

**`UNKNOWN_efe7_source` — CLOSED: `SI` is the group descriptor, and `[SI+1]` is the creature's own HP stat `[STATIC]`.** `CS:0xedf4`'s dispatch (the block quoted just above) reaches this code with `SI` still holding the per-frame entity driver's own **group descriptor** pointer — the same register this document already establishes throughout the System-B section (`DS:0xa1ac`, stride `0x16`) — and offset `+0x1` is this document's own already-documented **"hit points per entity"** field in that exact descriptor. So `CS:0xEFE7` is a **kill score-award routine**, and it scales with how tough the creature was: `award ∝ (HP >> 1) + 1`, packed into BCD and added via the shared score entry `CS:0x0C8B` (`clc / call 0x1000:0c8b` at `CS:0xF011` — the identical entry this document's starburst section already documents receiving `dl = 0x25` for 2500 points).

The routine does not stop at one digit: `CS:0xF014 or ah,ah / jz 0xf026` tests whether the earlier `div` quotient overflowed a single BCD nibble (`CS:0xEFFB cmp al,9 / jle f004` already special-cased that at the top, carrying the excess into `AH`), and if so packs a **second** BCD byte (`AH << 4`, low nibble forced to 0) and issues a **second** `call 0x1000:0c8b` — adding a higher-order digit position the same way the starburst's own score award does. So a sufficiently tough System-B creature's death award spans two BCD digit-positions, not one, exactly mirroring the multi-call pattern this document already has for other score sources.

⚠️ **Invulnerability makes the hero a battering ram.** `0xACCC`'s `jnz` skips **only** the `sub` at `0xACD3`; the `DS:0x34` test and the `bp = 0xFFFF` store at `0xACDB`/`0xACE2` sit after the branch rejoins. So while `[0x172]` is set the hero takes no damage *and still kills everything he touches*.


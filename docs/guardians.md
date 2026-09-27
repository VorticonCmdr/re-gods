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

Worlds 2–4 are not ported. The world-2 and world-3 drivers are `0xCD7B` and `0xD53B`; world 3 has a script interpreter at `0xD7A3`.

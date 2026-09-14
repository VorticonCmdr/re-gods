# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Evidence discipline.** This directory is a reverse-engineering target, not a source repo. Every claim in this project is tagged with how it was established. Do not add unverified claims — label unknowns `UNKNOWN_<identifier>` instead.
> `[PROVEN]` = verified by executing something (decompressed the bytes, ran the code, or traced it live under DOSBox).
> `[STATIC]` = read out of the binary (strings/disassembly) but **not** confirmed at runtime.
> `[WF]` = **produced by a subagent workflow and not yet re-read by the maintainer.** Plausible and adversarially reviewed, but nobody in this project has personally executed a check on it. That workflow's own error rate was demonstrably nonzero — fifteen of its findings were refuted on bytes by its own verifiers, and a histogram it reported was wrong. **Treat `[WF]` as a lead, not a fact, and promote it to `[PROVEN]` only by reading the bytes.**
> `[UNKNOWN]` = not established.
>
> **The DOSBox bridge is working** (mount `C:\Users\...\Gods`, launch with `gods`). The full launcher chain — `GODS.EXE` → `INTROV.EXE` → `GAME.EXE`, config parse, drive-check bypass, EXEC patching, overlay loads, first Table-2 asset open — has been traced live with `INT 21h` breakpoints and matches the static disassembly exactly, down to individual register values. See `docs/dynamic-trace-and-runtime-data.md`. The game renders and plays correctly through this path.

## What this is

A complete file dump of the DOS release of **GODS** (The Bitmap Brothers / Millennium Interactive, 1991/92) — raw floppy-disk contents, `GODS.INI` records "Version 1.0". 140 files, **no source code, build system, or tests**. There is nothing to build, lint, or test; treat all work here as software archaeology.

`READ.ME` (the game's own release notes) states SoundBlaster/Roland music and high-score/password saving work only when installed to hard disk, not from the low-density 3.5" floppy.

## Where the reverse-engineering findings live

This project has accumulated thousands of lines of disassembly-level findings — every `CS:`/`DS:` citation, every disassembled excerpt, every live-DOSBox confirmation. To keep this file navigable, that material lives under `docs/`, split by subsystem, so a session only has to load the topic it actually needs. Every doc file inherits the evidence-discipline tags and citation conventions defined above (exact `CS:`/`DS:` hex offsets, the `1ffd:<off>` vs `1000:<off>` segment-resolution rule, etc.) without restating them — read this file's own header first if a doc file's tags or address forms are unfamiliar.

| Doc | Covers |
|---|---|
| [`docs/asset-formats.md`](docs/asset-formats.md) | The DCL compression container; `.PI1`/`.DAT`/`.JOY{G,L}` decompressed layouts; the `PALFILS`/`POBJECTS`/`PWEAPONS` fixed-size record tables |
| [`docs/execution-and-boot.md`](docs/execution-and-boot.md) | The `GODS.EXE` → `INTROV.EXE` → `GAME.EXE` launch chain, `WIBBLE.EXE`, unpacking the PKLITE-packed binaries, 15 Hz frame pacing |
| [`docs/player-state-machine.md`](docs/player-state-machine.md) | The 29 player states (walk/jump/fall/ladder/crouch/fire), and hero health vs. the displayed health bar that chases it |
| [`docs/camera-and-world-nav.md`](docs/camera-and-world-nav.md) | The hero-follow camera and its dead zones, scripted camera pans, the plane-B event probe, the replayed random-number table |
| [`docs/entity-ai-pathfinding.md`](docs/entity-ai-pathfinding.md) | The three entity-record structs, the three enemy-AI questions a port needs answered, and the enemy pathfinder's cost-bounded graph search |
| [`docs/triggers-and-difficulty.md`](docs/triggers-and-difficulty.md) | The progression difficulty scalar, all 17 trigger CONDITION predicates, all 15 trigger ACTION verbs, and levers |
| [`docs/drivers-and-memory.md`](docs/drivers-and-memory.md) | `GAME.EXE`'s memory layout and the 41-graphics-export + 13-sound-export driver interface |
| [`docs/map-format-and-filenames.md`](docs/map-format-and-filenames.md) | The `.MAP` level format (planes, objects, trigger table) and the two filename tables (Table 1 / Table 2) |
| [`docs/dynamic-trace-and-runtime-data.md`](docs/dynamic-trace-and-runtime-data.md) | The live DOSBox launch trace, `GODS.INI`, `HISCORES.BIN`, and every format re-validated by reconstruction |
| [`docs/entity-systems-spawning.md`](docs/entity-systems-spawning.md) | The full enemy-spawn chain: System A and System B entity pipelines, group descriptors, sprite formulas, steal-and-carry |
| [`docs/combat-and-projectiles.md`](docs/combat-and-projectiles.md) | The projectile occupancy-grid collision system and weapon pickup |
| [`docs/destructible-and-hazards.md`](docs/destructible-and-hazards.md) | Destructible blocks, the world-2 nest creature, enemy-fired projectiles, and inert debris |
| [`docs/consumables-and-treasure.md`](docs/consumables-and-treasure.md) | The starburst potion's chain reaction, treasure/chest mechanics, and object fall physics |
| [`docs/open-questions-history.md`](docs/open-questions-history.md) | The full ranked open-questions list and the resolved-items index — historical record of what's been closed and how |

## Open questions

Every `UNKNOWN_*` this project has tracked has been closed; see `docs/open-questions-history.md` for the full closure history (dozens of items, each with its own resolution — several closed only as "authorial intent is unprovable in principle," which is this project's own standard for as-resolved-as-bytes-allow, not a loose end).

`UNKNOWN_chest_key_surplus` (world 2 half) — **CLOSED**, see `docs/consumables-and-treasure.md`. The prior pass only checked static object placement and trigger *conditions* referencing key 23; it never checked trigger *actions* that spawn objects. A fresh census of all 800 records' action-verb-0 (spawn object) entries found exactly one iron-chest spawn and one key-23 spawn in the whole game — `PLEV1A` triggers #3/#4, 25px apart, gated on the identical three conditions (two levers plus an event check). So key 23 / iron chest 16 has a real, designed, shipped use: a lever-puzzle-gated dynamic spawn in world 1 — which the earlier static-placement census could never have found. Checked four independent ways (static census, condition census re-derived this session, the new action-spawn census, and the separate "using a key consumes it" path at `CS:0x3AEB`, shown to be a subset of the condition census rather than a new avenue), world 2's two key-23 pickups have zero consumers anywhere in the shipped game. Why they were placed at all is retired as unprovable in principle, the same disposition as the two items below.

`POBJECTS` category 5's enum **meaning** — **CLOSED**, see `docs/destructible-and-hazards.md`. The prior search looked for a `CMP CX,<sprite>` chain (category 4's own dispatch shape) and missed category 5's actual mechanism: a category-level branch, one step earlier in the same object-array walker, into a sprite-id-keyed **jump table** (`CS:0x19BA`, `DS:0xdfb0`, 13 entries + a default). All six reachable handler bodies were read to their terminating jump this session: every one does nothing but resolve a draw position, optionally animate a 4-frame table (the same position-phased, globally-ticked idiom already documented for the destructible spike's overlay) or add a second fixed tile, then call a masked-sprite-blit graphics export (exports 1/2, already characterized in `docs/drivers-and-memory.md`). No hero state, health, inventory, score, damage grid, or trigger is referenced anywhere in the dispatch. A fresh map census also found 12 of the 22 types genuinely placed in shipped levels (mostly world 2), overturning the earlier "as plausible a candidate for never-instantiated filler" framing. Category 5 is purely visual background scenery, some of it self-animating.

`UNKNOWN_e4e2_displacement_drift` — **CLOSED**, see `docs/combat-and-projectiles.md`. A prior pass wrongly filed this as living inside the dead `UNKNOWN_tag_fd` path with "zero port impact"; a fresh full disassembly of both found-handlers (`CS:0xE4E2`–`0xE5E2`) this session showed neither loop returns on a hit — both scan to the end of their tick budget regardless — so the register-reuse drift (one register doing double duty as hit-counter and displacement-cursor step) fires on any ordinary two-hit scan, which the game's own grid-stamp footprint sizes make routine. But commonness and severity are inverted from the naive read: a single compact footprint's two hits land on *nearby* scan ticks, drifting the read by only 1–2 bytes (small misalignment); the large drift (up to 47 of the table's 192 bytes, bounded statically, never out of bounds) needs two hits far apart in scan order — the rarer shape, not the common one. Authorial intent is retired as unprovable in principle, not left pending — it's a question about the missing author's state of mind that no further bytes can answer.

`UNKNOWN_hunter_key_intent` — **CLOSED**, see `docs/combat-and-projectiles.md`. A prior pass mis-stated its own evidence as a minimum-scan ("homes on the lowest computed sprite id"); a fresh disassembly of `CS:0x9E36` this session showed it's a **maximum**-scan instead (seeded at `0xFFFF`, replaces only on a strictly larger key — the seed alone is structural proof of the intended direction, since a minimum-scan seeded there could never select anything). That correction resolves the item's original question: the already-documented post-hit key zero-out (disqualifying the just-hit target from being re-picked) only composes correctly with a maximum-scan — under the old, wrong minimum-scan reading it would have been self-defeating (the zeroed target would win every future comparison instead of losing). Seed-plus-side-effect together are stronger evidence of deliberate, finished design than "no dead arithmetic" alone. What can't be recovered from bytes is *why* sprite id specifically was chosen as the ranking key — retired as unprovable in principle, the same disposition as the item above.

## Tooling

Moved to the `gods-re-tooling` skill (`.claude/skills/gods-re-tooling/SKILL.md`) — Ghidra MCP, DOSBox MCP, `blast.py`, and the `gods-web` port's verification tooling, with the same gotchas as before. Load it when actually running any of those tools.

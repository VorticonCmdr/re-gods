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

## Open questions — still genuinely unresolved

Every other `UNKNOWN_*` this project has tracked has been closed; see `docs/open-questions-history.md` for the full closure history (dozens of items, each with its own resolution). What remains open:

1. `UNKNOWN_chest_key_surplus` (world 2 half) — the two key-23 pickups in `PLEV2A`/`PLEV2B` have no trigger reference anywhere in either map's 100 records. World 4's copy of this same surplus was resolved (a shipped trigger message confirms the key serves some other purpose, not the unplaced iron chest); world 2's is still a genuine open data question.
2. `POBJECTS` category 5's enum **meaning** — its 22-member *membership* is settled (identical across all four worlds once the world-4 id drift is corrected for, every record blank name/description/`Value=0`), but no dedicated code consumer was found for any of its 22 sprite ids in the object-array walk, so what the category actually represents is still open.
3. `UNKNOWN_hunter_key_intent` — the hunter weapon homes on whichever on-screen creature currently has the lowest computed sprite id. The search routine's own shape (a minimal, complete "find the minimum" scan with no dead arithmetic) reads more like a deliberate cheap tie-break than an abandoned distance calculation, but intent can't be proven from bytes alone.
4. `UNKNOWN_e4e2_displacement_drift` — a likely single-variable-reuse bug in System A's attack-reach scan (one register does double duty as both a hit-counter and, unintentionally, the displacement-table cursor's per-tick step size). The mechanical cause is identified; authorial intent isn't provable. Sits inside an already-proven-dead code path either way (see `UNKNOWN_tag_fd` in the history doc), so it has zero port impact.

## Tooling

Moved to the `gods-re-tooling` skill (`.claude/skills/gods-re-tooling/SKILL.md`) — Ghidra MCP, DOSBox MCP, `blast.py`, and the `gods-web` port's verification tooling, with the same gotchas as before. Load it when actually running any of those tools.

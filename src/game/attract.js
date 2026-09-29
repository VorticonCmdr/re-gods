/* attract.js — the 6-state `joyl`/`joyg` attract-mode cycler.
 *
 * `[PROVEN]` — full disassembly of `CS:0x2DA6`-`0x2DEE`, this session (while
 * porting the title-screen/attract-mode system), not previously read in
 * this project past the summary docs/dynamic-trace-and-runtime-
 * data.md's "The title screen" section already carried:
 *
 *   2DA6  AL = [0x3e6] ; INC [0x3e6]           ; state, then advance for next time
 *   2DAD  CMP AL,5 / JNZ 2db6 ; else [0x3e6]:=0  ; wraps 5 -> 0
 *   2DB6  TEST AL,1 / JNZ 2dd5                 ; ODD state -> joyg; EVEN -> joyl
 *
 *   even (joyl):  2DBA  AL >>= 1 ; AL += '1'    ; state 0/2/4 -> '1'/'2'/'3'
 *                 2DC7  [0x3bd]:=1 (playback) ; [0x282]:=0 (tape cursor)
 *                 2DD2  JMP 0x2cc4              ; the MENU's own redraw-poll head
 *
 *   odd (joyg):   2DD5  AL = (AL-1)>>1 ; PUSH AX ; AL += '1'  ; 0/1/2 -> '1'/'2'/'3'
 *                 2DE5  POP AX ; [0x42]:=AL (WORLD, still 0-based)
 *                 2DE9  [0x3e7]:=1 ; JMP 0x1000:6b00           ; -> world++, wrap 5->1, gameplay
 *
 * So the 6 states are, in order: joyl1, joyg1(world1), joyl2, joyg2(world2),
 * joyl3, joyg3(world3), then wraps back to joyl1 — an infinite loop with no
 * further `DS:0x3d7`/idle-cycle-count gate once inside it (that gate is only
 * checked on the path INTO the cycler, `CS:0x2CB3`-`0x2CC1`, main.js's own
 * idle-timer wiring). The only way out, in the original as in this port, is
 * real player input.
 *
 * `joyl`'s own ticks feed the SAME per-frame input the menu polls
 * (`DS:0x382`) — `docs/passwords.md`'s "the recorded demo navigating this
 * same title menu with fake joystick input" — so a `joyl` segment is not
 * "menu-only": once its own recording selects BEGIN QUEST (or a password),
 * the recording keeps feeding the identical ongoing byte stream as REAL
 * GAMEPLAY input, until that SAME file's own `0xFF` terminator, not a
 * separate joyg-style segment boundary. `formats/joy.js`'s `decodeJoyRecording`
 * already returns one flat `ticks` array shaped identically whether the
 * consumer is the menu (`TitleMenu.step`/`PasswordEntry.step`) or the
 * player (`main.js`'s own `input` object) — this module's own job is just
 * "which file, and does entering it force a level load," not per-tick
 * input interpretation, which main.js's existing uiState dispatch already
 * does correctly for either consumer with zero attract-mode-specific code.
 *
 * `joyg`'s own tick 0 is NOT the ordinary level-spawn position — it jumps
 * straight into a fixed mid-level showcase camera/hero position
 * (`FUN_1000_8c34`, `CS:0x8FBE`-`0x8FC3`) rather than the normal BEGIN-QUEST
 * spawn. `JOYG_SHOWCASE_SPAWN` below is that table, first established (and,
 * for world 1, live-confirmed byte-for-byte against a DOSBox capture) in
 * `tools/replay-diff.mjs` — duplicated here rather than imported, since that
 * is a Node-only offline verification script outside this bundle; both are
 * the one table this project has for this data, kept in sync only by this
 * cross-reference, the same convention `game/kill-smoke.js`'s own header
 * already uses for a different shared constant.
 *
 * DISCLOSED, not traced this pass: the exact low-level mechanism by which
 * the ORIGINAL notices a joyg recording has run out (hit its own `0xFF`)
 * mid-gameplay and jumps back to `CS:0x2CAF`'s dispatch head — this module
 * (and main.js's own tick loop) instead advances to the next cycler state
 * the functional moment `formats/joy.js`'s own decoded `ticks` array is
 * exhausted, which reproduces the OBSERVABLE behaviour (the demo keeps
 * cycling) without claiming the specific DS:/CS: address that does it in
 * `GAME.EXE` itself.
 */

export const CYCLE = [
  { kind: 'joyl', n: 1 },
  { kind: 'joyg', n: 1, world: 1 },
  { kind: 'joyl', n: 2 },
  { kind: 'joyg', n: 2, world: 2 },
  { kind: 'joyl', n: 3 },
  { kind: 'joyg', n: 3, world: 3 },
];

/** CS:0x8FBE-0x8FC3 (`tools/replay-diff.mjs`'s own citation) — the joyg
 *  entry's fixed showcase hero/camera position, keyed by world. Sublevel is
 *  always 'B' (`formats/joy.js`'s `JOYG_SUBLEVEL`). All three are
 *  live-confirmed: tick 0 of tools/attract-capture/joyg{1,2,3}.raw.json
 *  reads exactly these hero/camera values. */
export const JOYG_SHOWCASE_SPAWN = {
  1: { heroX: 0xd60, heroY: 0x260, camX: 0xce0, camY: 0x200 }, // (3424,608)/(3296,512)
  2: { heroX: 0xa0, heroY: 0x3c0, camX: 0xa0, camY: 0x340 },   // (160,960)/(160,832)
  3: { heroX: 0x60, heroY: 0x50, camX: 0, camY: 0 },           // (96,80)/(0,0)
};

/**
 * CS:0x8F3B-0x8FC3 (full disassembly this pass, one level up from where
 * `verify/checks.js`'s own pre-existing "the attract-mode grant is NOT a
 * starting loadout" note had left it — that note found the WHAT [pickup
 * dispatcher calls, not a boot-time field write] but not which world gets
 * which): gated behind the SAME one-shot `DS:0x3e7` flag as the showcase
 * spawn table above, and reached by the SAME three `DS:0x3e6` branches
 * (world 1 = state 2, world 2 = state 4, world 3 = state 0 — the cycler's
 * own post-increment values, `nextState`'s own arithmetic one step earlier).
 * `{weapon, count}` pairs, each `count` a separate `CALL FUN_1000_94a7`
 * (`pickup.js`'s `pickUpWeapon`, the SAME dispatcher a real map pickup
 * uses) — world 1 gets a unique 3-weapon set (`CS:0x8F5F`-`0x8F79`); worlds
 * 2 and 3 share one 2-weapon set (`FUN_1000_8fd2`, `CS:0x8FD2`-`0x8FE4`).
 * Weapon indices per `WEAPON_NAMES` (`game/weapons.js`): 2 = fireball,
 * 4 = lightning bolt, 5 = throwing star, 6 = spear. ⚠️ Fireball and spear's
 * own spawn handlers (2/3, 6/7) are still undecoded in this port
 * (`hero-fire.js`'s own `DECODED_HANDLERS`) — granting them is still
 * faithful (the showcase really is armed with them), but firing drops
 * those specific shots, counted not silently skipped, same as any other
 * undecoded-handler weapon a real player equips. */
export const JOYG_SHOWCASE_LOADOUT = {
  1: [{ weapon: 2, count: 3 }, { weapon: 5, count: 5 }, { weapon: 4, count: 1 }],
  2: [{ weapon: 2, count: 5 }, { weapon: 6, count: 3 }],
  3: [{ weapon: 2, count: 5 }, { weapon: 6, count: 3 }],
};

/** The 0-based filename for `CYCLE[state]` — `PJOYL{n}.DAT`/`PJOYG{n}.DAT`. */
export const fileNameFor = (entry) => `PJOY${entry.kind === 'joyl' ? 'L' : 'G'}${entry.n}.DAT`;

/** CS:0x2DA9/0x2DAD-0x2DB1 — advance and wrap. */
export const nextState = (state) => (state + 1) % CYCLE.length;

/* copy-assets.mjs — stage the shipped GODS files this port reads.
 *
 * The original release directory is treated as READ-ONLY throughout this
 * project. Nothing is ever written there; this script only copies out.
 *
 * The files are copied in their ORIGINAL, still-DCL-compressed form. The port
 * decompresses them in the browser at load time. That is deliberate: it means
 * every format claim is exercised against the shipped bytes rather than
 * laundered through an offline extraction step.
 */
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC  = resolve(here, '..', '..', 'Gods');
const DEST = resolve(here, '..', 'public', 'game');

const WANTED = [
  // level tile sheets + level maps (milestone 1)
  ...['1A','1B','2A','2B','3A','3B','4A','4B'].flatMap((k) => [
    `PBITS${k}.PI1`,   // tile sheet (note: its palette words are NOT ST 3-bit)
    `PLEV${k}.MAP`,    // level
    `PLEVEL${k}.PI1`,  // per-level palette source (3-bit clean) AND, despite the
    `PLEVEL${k}.DAT`,  // name, the per-world CREATURE atlas: the `level<N>` load
                       // group occupies descriptors #450+, which is exactly where
                       // the enemy sprite-class bases start.
  ]),
  // second tile sheet — ships ONLY for the four levels whose tile count > 120
  'PXTRA1B.PI1','PXTRA2A.PI1','PXTRA3A.PI1','PXTRA4B.PI1',
  // per-level hint text / event + lever tables
  ...['0A1','0A2','0A3','0A4','0B1','0B2','0B3','0B4'].map((k) => `PALFILS.${k}`),
  // sprite atlases. The `always` GROUP is PALWAYS1/2/3 + PGODFONT in that
  // order, and all four are needed even to draw only the hero: descriptor
  // numbering is cumulative across the group, so a missing atlas shifts every
  // later index. The hero occupies descriptors #0..#57, which spans PALWAYS1
  // (39 frames) and the first 19 of PALWAYS2.
  'PALWAYS1.PI1','PALWAYS1.DAT','PALWAYS2.PI1','PALWAYS2.DAT',
  'PALWAYS3.PI1','PALWAYS3.DAT','PGODFONT.PI1','PGODFONT.DAT',
  // the `objects` group: POBJ1 (161 frames, descriptors #170..#330) then
  // POBJ2 (119, #331..#449). Both are needed: a map object's sprite is
  // `170 + type` and shipped types reach 191, which lands in POBJ2.
  'POBJ1.PI1','POBJ1.DAT','POBJ2.PI1','POBJ2.DAT',
  'PSMLFNT.PI1','PSMLFNT.DAT',
  // object category codes: record +4 (BE u16). Verified byte-identical to
  // the EXE's own table at DS:0xef78 for all 132 records in all 4 worlds
  // (528/528), so the port reads the shipped asset, not the executable.
  'POBJECTS.001','POBJECTS.002','POBJECTS.003','POBJECTS.004',
  'PWEAPONS.001','PWEAPONS.002','PWEAPONS.003','PWEAPONS.004',
  // PGOD0x.PAT — the selector-1 scripted-movement/shooting objects
  // (game/pat-objects.js). Loaded only on sublevel 'a' (CS:0x3855's own
  // `cmp byte [0x43],0 / jnz` gate), one file per world.
  'PGOD01.PAT','PGOD02.PAT','PGOD03.PAT','PGOD04.PAT',
  // The world-2 guardian's arm (game/guardian.js): SINCOS.DAT and BEZIER.DAT,
  // both raw (no DCL). BEZIER.DAT is loaded only in world 2 (CS:0x0570).
  'SINCOS.DAT','BEZIER.DAT',
  // The world-4 guardian's worm head list (game/guardian4.js), DCL, loaded
  // at CS:0x0588 into SS:0x4F20.
  'PBUMLIST.BIN',
  // The status panel (game/status-panel.js). PSTATUS.PI1 is the boot-time
  // placeholder (Table 2 disk id 1); PSTAT3.PI1 is loaded once when real
  // gameplay starts and overwrites it (disk ids 2,3 — the world data disks),
  // and is what a player actually sees during play. Both are full 320x200
  // DEGAS images whose only real content is rows 160-199 — the rest is
  // never converted (CS:0x2a23's own SI=0x6422 skips straight to it).
  'PSTATUS.PI1','PSTAT3.PI1',
  // PBACKSCR.PI1 — the title screen's own full-320x200 background, drawn
  // behind the menu/password grid (game/title-menu.js). A GAME.EXE-owned
  // asset (Table 1 Block B, "backscr.pi1"); confirmed against a live
  // DOSBox capture of the real title screen, not merely inferred from its
  // palette — see title-menu.js's own header.
  'PBACKSCR.PI1',
  // INTROV.EXE's own pre-game sequence (game/intro.js): PSTBACK.PI1 (the
  // "GODS" logo card's stone-wall/helmet backdrop — despite the name
  // overlap with the status panel, this is a DIFFERENT, INTROV-owned file),
  // PONE.PI1 (the hero-portrait backdrop behind the 8-page story crawl),
  // and PINTROFT.PI1/.DAT (the intro's own 3-in-1 font atlas: credits caps,
  // the "GODS" logo wordmark glyphs, and the story-poem font — same
  // 2+10*count descriptor schema as every other P*.DAT, see formats/
  // atlas.js). All three confirmed live in DOSBox and by direct decode —
  // see intro.js's own header.
  'PSTBACK.PI1','PONE.PI1','PINTROFT.PI1','PINTROFT.DAT',
  // INTROV.EXE's intro music under the shipped GODS.INI (Sound Blaster,
  // driver id 4): PGODMUS2.MUS (FM, a word-dictionary-compressed SMF —
  // audio/mus-container.js's expandBlob) PLUS PDEMOSB4.SB, an 11-clip
  // sample-music sequence (formats/sb-voice.js). PPLAYER.BIN's AH=1 start
  // handler (0000:01c4) launches both. PPLAYER.BIN itself is staged only
  // for the note->rate table the SB sequencer reads (0000:2992).
  // PMUSIC.MUS (the AdLib-config track) is kept for the dev music picker.
  'PMUSIC.MUS', 'PGODMUS2.MUS', 'PDEMOSB4.SB', 'PPLAYER.BIN',
  // #11 audio, music half. GAME.EXE's own only music-related string literals
  // are `pgods.mus`/`gods.mus` (Table 2/Table 1) — a raw byte scan of both
  // GAME.EXE and TGAME.EXE found no reference at all to any of the other
  // ten shipped .MUS/.RL files, which belong to the pre-game INTRO
  // executables instead (game/audio's own header has the full citation).
  'PGODS.MUS',
  // Not loaded by GAME.EXE (see PGODS.MUS's own comment above) — staged only
  // so checkMusic() can re-derive its container shape itself instead of
  // resting on an un-re-run Python census. PGODSRLB-G share the same shape
  // (checked once this session, not restaged here — see checkMusic()'s own
  // note for exactly what that claim rests on).
  'PGODSRLA.RL',
  // Recorded attract-mode joystick input (game/formats/joy.js). `joyg`
  // decodes into real GAMEPLAY ticks — used both by the replay-diff harness
  // (tools/replay-diff.mjs, checking the port's physics against a live
  // DOSBox trace of the same fixed input) and by the attract-mode cycler
  // (game/attract.js). `joyl` drives the title-menu loop with the SAME
  // format instead (docs/asset-formats.md) — staged for the cycler too, a
  // later addition than replay-diff.mjs's own original three-file staging.
  'PJOYG1.DAT','PJOYG2.DAT','PJOYG3.DAT',
  'PJOYL1.DAT','PJOYL2.DAT','PJOYL3.DAT',
  // NOT HISCORES.BIN — deliberately. Unlike every other file in this list,
  // it is not pristine shipped data: it is mutable runtime state this
  // project's own DOSBox sessions have already overwritten with real play
  // data (see git history — it no longer holds the shipped 9-Greek-gods
  // table). Staging the live working-tree copy would make gods-web's own
  // "default hiscore table" reflect whatever happens to be on THIS
  // machine, not a real player's first launch. game/formats/hiscores.js
  // hardcodes the true shipped defaults instead (from `git show
  // HEAD:HISCORES.BIN`, cross-checked against Gods/docs/dynamic-trace-and-
  // runtime-data.md's own decode).
];

if (!existsSync(SRC)) {
  console.error(`[assets] source directory not found: ${SRC}`);
  process.exit(1);
}
mkdirSync(DEST, { recursive: true });

let copied = 0, missing = [], bytes = 0;
for (const name of WANTED) {
  const s = join(SRC, name);
  if (!existsSync(s)) { missing.push(name); continue; }
  copyFileSync(s, join(DEST, name));
  bytes += statSync(s).size;
  copied++;
}

console.log(`[assets] ${copied}/${WANTED.length} files -> public/game (${(bytes / 1024).toFixed(1)} KB)`);
if (missing.length) console.warn(`[assets] MISSING: ${missing.join(', ')}`);

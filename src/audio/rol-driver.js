/* rol-driver.js — ROL.EXE, the Roland sound driver, as game logic.
 *
 * `[STATIC]`, ROL.EXE (not packed; image = file + 0x200). The driver is a
 * shim over PPLAYER.BIN, the same sequencer the AdLib driver uses, started
 * with only the MPU-401 bit (ROL:0x7F `mov al,4`). Its 13 exports:
 *
 *   0 0x036 init      loads PPLAYER.BIN and "godsrle.rl", PPLAYER AH=0,
 *                     DS:0x85 = 2, DS:0xA8 = 5 SFX slots, slots freed
 *   1 0x2C1 / 2 0x2F8 timer install / remove (PIT 0x4DAE = 60 Hz, 5 of 6 ticks
 *                     run PPLAYER AH=2, so the sequencer runs at 50 Hz)
 *   3 0x376 play SFX  (below)
 *   4 0x55D stop the three looping sounds (0x80, 0x97, 0xC5), then wait until
 *           slots 1-4 are silent. Its 200-pass counter (CS:0x746) never runs
 *           out: the retry `jnz 0x55D` jumps above the line that reloads it.
 *           ADL.EXE's export 4 (ADL:0x33D) does the same over all 5 slots,
 *           with no counter at all. The game waits either way.
 *   5 0x519 stop SFX  AH=4 with the remapped blob index
 *   6 0x0FC music on  if idle: PPLAYER AH=1 AL=0x80 BL=0 (blob 0, looping),
 *                     volume := AL, CS:0x32 := 0xFF
 *   7 0x160 fade out  if playing: CS:0x32 := 1, target := 0
 *   8 0x128 volume    PPLAYER AH=6 on volume slots 5..8 (MIDI channels 6..9)
 *   9 0x17C fade to   target := AL, down (1) or up (0xFF)
 *  10 0x19C mute      volume 0, level and target kept, CS:0x32 := 0
 *  11 0x1C4 unmute    back to the kept level
 *  12 0x0A5 load      wait up to 300 retraces for CS:0x32 = 0, PPLAYER AH=3
 *                     (stop everything), patch AL + 'a' into "godsrl?.rl",
 *                     reload it
 *
 * GAME.EXE only ever sends export 12 a context 0..6 (seven call sites,
 * docs/drivers-and-memory.md), so the file is PGODSRL + 'A'..'G':
 *   0..3  worlds 1-4, at level load (CS:0x00D8)
 *   4     the title menu and game over (CS:0x097B, CS:0x2CA3)
 *   5     a guardian fight (CS:0x05AB, entered from CS:0x0321 on DS:0x35C)
 *   6     the shop (CS:0x6C1B, FUN_1000_6c19)
 *
 * Every .RL file holds 63 blobs: blob 0 is that context's music, blobs 1..62
 * are the SFX, byte-identical in all seven files.
 */

/** CS:0x6F4 — sound id (AL & 0x7F) -> RL blob. 74 entries, ids 0x00..0x49. */
export const ROL_SFX_REMAP = Uint8Array.of(
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
  0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1a, 0x1f, 0x20,
  0x21, 0x22, 0x02, 0x02, 0x02, 0x1a, 0x23, 0x33, 0x29, 0x2a, 0x2a, 0x2c, 0x2c, 0x2f, 0x26, 0x1a,
  0x1a, 0x1a, 0x1b, 0x1b, 0x1b, 0x37, 0x37, 0x38, 0x20, 0x3a, 0x3b, 0x1d, 0x02, 0x02, 0x22, 0x26,
  0x3d, 0x39, 0x31, 0x31, 0x31, 0x18, 0x23, 0x23, 0x2d, 0x30,
);

/**
 * CS:0x634 — per RL blob, 3 bytes: MIDI channels (= SFX slots) it needs, a
 * random-variant routine (1-based index into CS:0x73E, 0 = none), and the
 * volume PPLAYER scales its note velocities by (AH=6, CS:0x46F).
 */
export const ROL_SFX_RECORDS = [
  [9, 0, 0x80], [2, 0, 0x20], [1, 2, 0xa0], [1, 0, 0xa0], [1, 0, 0x96], [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x80],
  [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x64], [1, 0, 0x64], [1, 0, 0x64], [1, 0, 0x64], [1, 0, 0x64], [1, 2, 0x80],
  [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x87], [3, 0, 0x80], [3, 0, 0x80], [5, 0, 0x80], [1, 0, 0x80], [1, 0, 0x91],
  [1, 0, 0xff], [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x02], [1, 0, 0x02],
  [1, 0, 0x8c], [1, 0, 0xc8], [1, 0, 0xb4], [1, 1, 0xb4], [1, 0, 0x80], [1, 0, 0xff], [1, 0, 0x80], [1, 0, 0x80],
  [1, 0, 0x80], [3, 0, 0x80], [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0x32], [1, 0, 0xb4], [1, 0, 0x80], [1, 0, 0x80],
  [1, 0, 0x6e], [1, 1, 0x80], [1, 0, 0x80], [1, 4, 0x96], [1, 0, 0x96], [1, 0, 0x96], [1, 0, 0x96], [1, 0, 0x96],
  [1, 0, 0x80], [1, 0, 0xb4], [1, 0, 0x80], [1, 0, 0x80], [1, 0, 0xdc], [1, 0, 0x80], [1, 1, 0x80], [1, 0, 0x80],
];

/** Export 4's stops (ROL:0x572-0x581, ADL:0x34B-0x35A): the looping sounds. */
export const EXPORT4_LOOP_IDS = [0x80, 0x97, 0xc5];
/** ROL export 4 checks slots 1..4 only (ROL:0x58E `mov si,0xAA / add si,2`, cl = [0xA8]-1). */
export const ROL_WAIT_SLOTS = [1, 2, 3, 4];

/** DS:0xA8 := 5 (ROL:0x95) — SFX slots, and so MIDI channels 1..5. */
export const ROL_SFX_SLOTS = 5;
/** PPLAYER.BIN's track contexts (DS:0x5EA, 9 entries); AH=1 fails when all are busy. */
export const PPLAYER_CONTEXTS = 9;
/** Music volume slots (ROL 0x131-0x150: AH=6 AL=5..8), i.e. MIDI channels 6..9. */
export const MUSIC_VOLUME_SLOTS = [5, 6, 7, 8];

export const MUSIC_CONTEXT = Object.freeze({ TITLE: 4, GUARDIAN: 5, SHOP: 6 });
/** Export 12's context for a world (CS:0x00D3-0x00D6 `mov al,[0x42] / dec al`). */
export const worldMusicContext = (world) => world - 1;
export const rlFileForContext = (ctx) => `PGODSRL${String.fromCharCode(0x41 + ctx)}.RL`;
/** ROL init loads "godsrle.rl" (ROL:0x27), so context 4 is what is loaded first. */
export const ROL_INITIAL_CONTEXT = 4;

/** CS:0x376 `call 0x5BB`: the remapped blob, bit 7 of the id carried over. */
export function rolRemap(id) {
  const i = id & 0x7f;
  if (i >= ROL_SFX_REMAP.length) return -1;         // past CS:0x73E: code bytes, never sent
  return ROL_SFX_REMAP[i] | (id & 0x80);
}

/**
 * CS:0x5FF — the driver's own shift-register random number, seeded at init
 * from the BIOS tick count (ROL:0x36-0x40, `mov cx,[0040:006C]`). CF is 0 on
 * entry (the caller's `add di,cx` at CS:0x3CD cannot carry), and every
 * `xor`/`and` in the body clears it again.
 */
export class RolRandom {
  constructor(seed = 0) { this.state = seed & 0xffff; }
  next() {
    let dl = this.state & 0xff, cl = this.state >> 8, al = cl, cf = 0;
    const rcr = () => { const out = al & 1; al = (al >> 1) | (cf << 7); cf = out; };
    rcr(); cl ^= al; cf = 0;                         // 0609-060D
    rcr(); rcr(); cl ^= al; cf = 0;                  // 060F-0613
    rcr(); dl ^= al; cf = 0;                         // 0615-0617
    rcr(); rcr(); al &= 1;                           // 0619-061D
    cf = dl >> 7; dl = (dl << 1) & 0xff;             // 061F shl dl,1
    cl = ((cl << 1) | cf) & 0xff;                    // 0621 rcl cl,1
    al = (al + dl) & 0xff;                           // 0623
    this.state = (cl << 8) | al;
    return this.state;
  }
}

/** CS:0x73E's four routines: how far past its base blob a sound may land. */
export function rolVariantOffset(kind, rng) {
  if (!kind) return 0;
  const r = rng.next(), al = r & 0xff, ah = r >> 8;
  switch (kind) {
    case 1: return al & 1;                           // 05D5
    case 2: return (al & 1) + (ah & 1);              // 05DD
    case 3: return al & 3;                           // 05EA
    case 4: return (al & 3) + (ah & 1);              // 05F2
    default: return 0;
  }
}

/**
 * Export 3's slot allocator (CS:0x376-0x4D3) and export 5 (CS:0x519).
 *
 * The five slot words at DS:0xAA are `blob | priority << 8`, 0x00FF = free.
 * A sound needs `voices` ADJACENT slots (its blob's channels 1, 2, ... are
 * moved up by the first slot's index, PPLAYER `0x2ACF add cl,[bp+0x8A]`):
 *
 *   pass 1 (0x41A)  the first run of slots whose priority byte is 0
 *   pass 2 (0x3E9)  else the first run where the new priority >= the slot's
 *                   and the slot's blob byte is not 0x80..0xFE (a looping
 *                   sound is never taken over)
 *
 * A taken-over sound is NOT stopped: the stop at 0x50D is unreachable (0x4F2
 * returns before it), so the old track plays on and only loses its slot.
 * An id with bit 7 set (0x4B1) is refused while any slot already holds the
 * same byte, and PPLAYER loops it (`0000:0CEA`, the `[bp+0x8D]` flag).
 *
 * `isPlaying(blob)` is PPLAYER AH=5: does any track still play that blob.
 * The driver asks it for every held slot at most once per music tick
 * (DS:0xD2, cleared by the timer at ROL:0x2A3) and frees the silent ones.
 */
export class RolSfxDriver {
  constructor(rng = new RolRandom()) {
    this.rng = rng;
    this.slots = new Array(ROL_SFX_SLOTS).fill(0x00ff);
    this.refreshed = false;                          // DS:0xD2
  }

  /** ROL:0x2A3 — the timer's per-tick clear of DS:0xD2. */
  musicTick() { this.refreshed = false; }

  /** CS:0x525. */
  refresh(isPlaying) {
    if (this.refreshed) return;
    for (let i = 0; i < this.slots.length; i++) {
      const lo = this.slots[i] & 0xff;
      if (lo !== 0xff && !isPlaying(lo & 0x7f)) this.slots[i] = 0x00ff;
    }
    this.refreshed = true;
  }

  /**
   * @param {number} id the GAME.EXE sound word (priority << 8 | id)
   * @param {(blob:number)=>boolean} isPlaying
   * @returns {?{blob:number, loop:boolean, firstSlot:number, voices:number, volume:number}}
   *   what to hand PPLAYER (AH=1 AL=blob BL=firstSlot, then AH=6 per slot),
   *   or null when the sound is dropped
   */
  play(id, isPlaying) {
    const remapped = rolRemap(id);
    if (remapped < 0) return null;
    this.refresh(isPlaying);
    const priority = (id >> 8) & 0xff;
    const base = remapped & 0x7f;
    const rec = ROL_SFX_RECORDS[base];
    if (!rec) return null;
    const [voices, variant, volume] = rec;
    const lo = (remapped + rolVariantOffset(variant, this.rng)) & 0xff;   // 0x3CA-0x3D2 `add dl,..`
    const word = lo | (priority << 8);
    const find = (free) => {
      let run = 0, first = 0;
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i], sPri = s >> 8, sLo = s & 0xff;
        const ok = free ? sPri === 0
          : priority >= sPri && !((sLo << 24 >> 24) < -1);              // 0x3E9 `jc`, 0x3ED `jl`
        if (!ok) { run = 0; continue; }
        if (run === 0) first = i;
        if (++run === voices) return first;
      }
      return -1;
    };
    let first = find(true);
    if (first < 0) first = find(false);
    if (first < 0) return null;
    if ((lo & 0x80) && this.slots.some((s) => (s & 0xff) === lo)) return null;   // 0x4B1
    for (let i = 0; i < voices; i++) this.slots[first + i] = word;
    return { blob: lo & 0x7f, loop: (lo & 0x80) !== 0, firstSlot: first, voices, volume };
  }

  /** Export 5 (CS:0x519): the blob to stop (PPLAYER AH=4 by blob index). */
  stopBlob(id) {
    const remapped = rolRemap(id);
    return remapped < 0 ? -1 : remapped & 0x7f;
  }

  /** Export 4 (CS:0x55D): the blobs it stops before its wait (0x80, 0x97, 0xC5). */
  static loopBlobs() { return EXPORT4_LOOP_IDS.map((id) => rolRemap(id) & 0x7f); }
}

/**
 * Exports 6-12's music state, stepped by the 50 Hz timer.
 *
 * CS:0x32 is the fade mode: 0 idle, 0xFF playing (or rising), 1 falling.
 * CS:0x35 the current volume, CS:0x33 the target. The timer calls the step
 * (CS:0x1DD) twice per sequencer tick (ROL:0x2A8/0x2AB). Its `not byte
 * [cs:0x34] / jz` looks like a skip-every-other-call toggle, but NOT does not
 * set flags: ZF still holds the `cmp [cs:0x32],0` just before, which was
 * nonzero, so the jump is never taken and a fade moves 2 steps per tick —
 * 0x80 to silence in 64 ticks (1.28 s).
 *
 * Every change reaches PPLAYER as AH=6 on the four music volume slots. The
 * MPU path applies it only at note-on (`0000:2C30`: velocity * vol * 2 >> 8,
 * clamped to 127), so a fade dims new notes and leaves held ones alone.
 */
export class RolMusic {
  constructor() {
    this.context = ROL_INITIAL_CONTEXT;
    this.mode = 0;          // CS:0x32
    this.volume = 0;        // CS:0x35
    this.target = 0;        // CS:0x33
    this.events = [];       // {type:'start'|'stop'|'volume'|'load', ...} for the player
  }

  #setVolume(v) {                                    // CS:0x128
    this.volume = v; this.target = v;
    this.events.push({ type: 'volume', volume: v });
  }

  /** Export 6. While export 12 still waits (see `load`), it runs after it. */
  start(vol) {
    if (this.pending) { this.pending.deferredStart = vol; return; }
    if (this.mode !== 0) return;
    this.events.push({ type: 'start', context: this.context });
    this.#setVolume(vol);
    this.fadeTo(vol);
    this.mode = 0xff;
  }

  /** Export 7. */
  fadeOut() {
    if (this.mode === 0) return;
    this.mode = 1; this.target = 0;
  }

  /** Export 8. */
  setVolume(vol) { this.#setVolume(vol); }

  /** Export 9. */
  fadeTo(vol) {
    this.target = vol;
    this.mode = vol < this.volume ? 1 : 0xff;
  }

  /** Export 10. */
  mute() {
    const { volume, target } = this;
    this.#setVolume(0);
    this.volume = volume; this.target = target;
    this.mode = 0;
  }

  /** Export 11. */
  unmute() {
    this.mode = 0xff;
    const v = this.volume;
    this.#setVolume(v);
  }

  /**
   * Export 12. The driver busy-waits (ROL:0xB2-0xC4: up to 300 retraces,
   * ~4.3 s) while CS:0x32 is nonzero, and the game waits with it. After a
   * fade-out (CS:0x0533, 0x2C82, 0x6C0E, 0x6D8F, 0xD9DE) that is the fade,
   * heard to silence. Music that is simply playing (CS:0x32 = 0xFF, e.g. the
   * title's at BEGIN QUEST, CS:0x00D8) plays on for the whole 300 retraces,
   * then stops. `pending` defers the reload the same way; `load` returns how
   * many 50 Hz ticks the game should stall for it (main.js `soundStall`).
   */
  load(ctx) {
    if (this.mode === 0) { this.#doLoad(ctx); return 0; }
    const ticksLeft = RETRACE_WAIT_TICKS;
    this.pending = { ctx, ticksLeft };
    return this.mode === 1 ? Math.min(ticksLeft, Math.ceil(this.volume / 2) + 1) : ticksLeft;
  }

  #doLoad(ctx) {
    this.pending = null;
    this.mode = 0;
    this.context = ctx;
    this.events.push({ type: 'load', context: ctx });  // PPLAYER AH=3 first: every track stops
  }

  /** One 50 Hz tick: ROL:0x29C-0x2AB. */
  tick() {
    this.#step(); this.#step();
    if (this.pending) {
      if (this.mode === 0 || --this.pending.ticksLeft <= 0) {
        const { ctx, deferredStart } = this.pending;
        this.#doLoad(ctx);
        if (deferredStart !== undefined) this.start(deferredStart);
      }
    }
  }

  #step() {                                          // CS:0x1DD
    if (this.volume === this.target || this.mode === 0) return;
    if (this.mode === 1) {
      this.volume--;
      if (this.volume === 0) {
        this.mode = 0;
        this.events.push({ type: 'stop' });          // AH=4 AL=0: stop blob 0
        return;
      }
      const t = this.target; this.#setVolume(this.volume); this.target = t;
    } else {
      this.volume = (this.volume + 1) & 0xff;
      const t = this.target; this.#setVolume(this.volume); this.target = t;
    }
  }

  /** Drain the events for the player. */
  take() { const e = this.events; this.events = []; return e; }
}

/** ROL:0xB2 `mov ax,0x12c`: export 12's wait, 300 retraces (70 Hz), in 50 Hz ticks. */
export const RETRACE_WAIT_TICKS = Math.round(300 * 50 / 70);

/**
 * Every driver's export 3 (ADL:0x15A, ROL:0x376, TDY:0x185, BPR:0x187, all
 * the same bytes): `cmp al,0x28 / jnz / cmp word [0xEA],0 / jz / mov byte
 * [0x11A],5`. The drivers run with GAME.EXE's DS, so this writes GAME's own
 * DS:0x11A — the DOS exit code (CS:0x22FD `mov ah,0x4C / mov al,[0x11A] /
 * int 21h`) — and GODS.EXE answers 5 with "Protection failure." (its
 * AH=4Dh dispatch at 1000:0168). Id 0x28 has one producer, the tally
 * fanfare 0x7928 (CS:0x6806). So it is a copy-protection trap keyed on
 * DS:0xEA. It cannot fire in the shipped game: DS:0xEA is 0 in the image, no
 * instruction in GAME.EXE or any driver names it, and live in DOSBox a
 * write watch on both bytes stayed silent through boot, menu and a minute of
 * attract play while the driver tick word below it (DS:0xE8) counted on.
 * And the one exit the menu offers (CS:0x2D87) sets the code to 1 first.
 * @returns {?number} the exit code the driver would store, or null
 */
export const DS_00EA = 0;
export function protectionExitCode(id, ds00ea = DS_00EA) {
  return (id & 0xff) === 0x28 && ds00ea !== 0 ? 5 : null;
}

/** CS:0x0370: level music volume, 0x80 less 0x14 in world 2. */
export const levelMusicVolume = (world) => (world === 2 ? 0x80 - 0x14 : 0x80);

/* roland-player.js — the Roland (MT-32) sound path, browser side.
 *
 * Wires ROL.EXE's logic (rol-driver.js) and PPLAYER.BIN's MPU track player
 * (roland-sequencer.js) to the MT-32 stand-in (mt32-synth.js), on the
 * AudioContext clock at the drivers' own 50 Hz. The game calls it the way
 * GAME.EXE calls the sound exports:
 *
 *   play(id) / stop(id)         exports 3 and 5
 *   music.start(vol) ...        exports 6-12 (see rol-driver.js)
 *
 * Scheduling follows music-player.js: a timer runs every 20 ms and steps the
 * 50 Hz ticks that fall inside a short look-ahead, so a note's audio time is
 * exact even when the timer is late.
 */

import { dclDecompress } from '../formats/dcl.js';
import { parseMusContainer, expandBlob } from './mus-container.js';
import { parseMt32Bank } from './mt32-bank.js';
import { Mt32Synth } from './mt32-synth.js';
import { RolSfxDriver, RolMusic, RolRandom, MUSIC_VOLUME_SLOTS, rlFileForContext } from './rol-driver.js';
import { RolandSequencer, parseRolandTrack } from './roland-sequencer.js';

const TICK_S = 1 / 50;
const LOOKAHEAD_S = 0.06;
const TIMER_MS = 20;

export class RolandPlayer {
  /**
   * @param {(url:string)=>Promise<Uint8Array>} fetchRaw the port's asset fetch
   * @param {() => AudioContext} getContext the shared AudioContext
   */
  constructor(fetchRaw, getContext) {
    this.fetchRaw = fetchRaw;
    this.getContext = getContext;
    this.sfx = new RolSfxDriver(new RolRandom(Date.now() & 0xffff));   // ROL:0x3B, BIOS ticks
    this.music = new RolMusic();
    this.seq = new RolandSequencer();
    this.tracks = new Map();        // context -> parsed blob 0 (music)
    this.sfxTracks = null;          // blob index -> parsed track (identical in every .RL)
    this.bank = null;
    this.synth = null;
    this.ready = this.#load();
    this.t0 = 0; this.ticks = 0; this.timer = null;
  }

  async #load() {
    const title = dclDecompress(await this.fetchRaw('game/PTITLE.RL')).data;
    this.titleTrack = parseRolandTrack(expandBlob(parseMusContainer(title)[0]));
    for (let ctx = 0; ctx < 7; ctx++) {
      const blobs = parseMusContainer(dclDecompress(await this.fetchRaw(`game/${rlFileForContext(ctx)}`)).data);
      this.tracks.set(ctx, parseRolandTrack(expandBlob(blobs[0])));
      if (!this.sfxTracks) this.sfxTracks = blobs.map((b, i) => (i === 0 ? null : parseRolandTrack(expandBlob(b))));
    }
    /* Last: #ensureRunning keys on it, so no call runs against half-loaded tracks. */
    this.bank = parseMt32Bank(title);
  }

  #ensureRunning() {
    if (!this.bank) return false;
    const ctx = this.getContext();
    if (!this.synth) {
      this.synth = new Mt32Synth(ctx, this.bank);
      this.t0 = ctx.currentTime + 0.05;
      this.ticks = 0;
    }
    if (!this.timer) this.timer = setInterval(() => this.#pump(), TIMER_MS);
    return true;
  }

  #emit = (msg) => this.synth && this.synth.message(msg, this.t0 + this.ticks * TICK_S);

  #pump() {
    const ctx = this.getContext();
    const horizon = Math.floor((ctx.currentTime + LOOKAHEAD_S - this.t0) / TICK_S);
    /* A long stall (a background tab) skips time rather than replaying it. */
    if (horizon - this.ticks > 50) this.ticks = horizon - 1;
    while (this.ticks < horizon) {
      this.ticks++;
      this.#musicEvents(this.music.take());
      this.music.tick();
      this.#musicEvents(this.music.take());
      this.sfx.musicTick();
      this.seq.tick(this.#emit);
    }
  }

  #musicEvents(events) {
    for (const e of events) {
      if (e.type === 'volume') for (const s of MUSIC_VOLUME_SLOTS) this.seq.setVolume(s, e.volume);
      else if (e.type === 'stop') this.seq.stopBlob(0, this.#emit);
      else if (e.type === 'load') this.seq.stopAll(this.#emit);
      else if (e.type === 'start') {
        const track = this.tracks.get(e.context);
        if (track) this.seq.play(0, track, 0, true);   // ROL:0x10C AH=1 AL=0x80 BL=0
      }
    }
  }

  /** Export 3. */
  play(id) {
    if (!this.#ensureRunning() || !this.sfxTracks) return;
    const r = this.sfx.play(id, (blob) => this.seq.isPlaying(blob));
    if (!r) return;
    const track = this.sfxTracks[r.blob];
    if (!track) return;                              // blob 63+: PPLAYER AH=1 refuses it
    if (!this.seq.play(r.blob, track, r.firstSlot, r.loop)) return;
    for (let i = 0; i < r.voices; i++) this.seq.setVolume(r.firstSlot + i, r.volume);
  }

  /** Export 5. */
  stop(id) {
    if (!this.synth) return;
    const blob = this.sfx.stopBlob(id);
    if (blob >= 0) this.seq.stopBlob(blob, this.#emit);
  }

  /** Exports 6-12, by name. */
  musicOp(op, arg) {
    if (!this.#ensureRunning()) { this.ready.then(() => this.musicOp(op, arg)); return; }
    switch (op) {
      case 'start': this.music.start(arg); break;
      case 'fadeOut': this.music.fadeOut(); break;
      case 'setVolume': this.music.setVolume(arg); break;
      case 'fadeTo': this.music.fadeTo(arg); break;
      case 'mute': this.music.mute(); break;
      case 'unmute': this.music.unmute(); break;
      case 'load': this.music.load(arg); break;
      default:
    }
  }

  /**
   * INTROV.EXE's Roland branch: PTITLE.RL loaded and PPLAYER started with the
   * MPU bit (introv 0x13F2-0x1421, which uploads the bank), then AH=1 AL=0
   * BL=0 (introv 0x14B7): blob 0, not looping, at the default volumes.
   * `offsetTicks` joins it part-way through.
   */
  playTitle(offsetTicks = 0) {
    if (!this.#ensureRunning()) { this.ready.then(() => this.playTitle(offsetTicks)); return; }
    this.seq.stopAll(this.#emit);
    this.seq.play(0, this.titleTrack, 0, false);
    if (offsetTicks > 0) this.seq.skipAhead(this.seq.tracks[this.seq.tracks.length - 1], offsetTicks, this.#emit);
  }

  /** Stop every track at once (leaving the intro, switching drivers). */
  silence() {
    if (this.synth) this.seq.stopAll(this.#emit);
  }
}

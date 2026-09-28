/* roland-sequencer.js — PPLAYER.BIN's track player, MPU-401 output path.
 *
 * `[STATIC]`, PPLAYER.BIN (DCL-decompressed, `ndisasm`). ROL.EXE starts
 * PPLAYER with only the MPU bit set, so every track event goes through the
 * `0000:2ABE` channel-message handler instead of the OPL one:
 *
 *   2ABE-2AD8  channel := status & 0x0F + [bp+0x8A] (the BL given to AH=1);
 *              a result of 11 or more is dropped
 *   2AE5       note off (8x) -> `0x2C58`, sent as 8x ch note 0
 *   2AF2/2BD9  note on  -> velocity * vol[ch-1] * 2 >> 8, clamped to 127
 *              (`0x2C30`; vol is the AH=6 table at 0x1634), sent as 9x
 *   2B28       control change and 2B59 program change, sent as they are
 *   2B9D       pitch bend, sent as it is
 *   2B14/2B86  key pressure and channel pressure: stored, never sent
 *   2C89       AH=4 stop: CC 123 (all notes off) on each channel the track
 *              used ([bp+0x8E], one bit per channel 1..9)
 *
 * A track started with AL bit 7 set loops: at its end `0000:0CEA` re-starts
 * the same blob (`call 0x1321` with AL|0x80). Nine track contexts exist
 * (`0x5EA`); AH=1 fails when all are in use.
 *
 * Timing: PPLAYER steps every track once per 50 Hz tick. This module keeps
 * that grid: an event's time is its SMF time rounded down to a whole tick.
 */

import { PPLAYER_CONTEXTS } from './rol-driver.js';

const TICK_HZ = 50;

/**
 * Every MIDI event of a single-track SMF, with its 50 Hz tick. `smf-parser.js`
 * keeps only notes and tempo; the MT-32 needs program, controller and bend
 * messages too.
 * @returns {{events:Array<{tick:number,status:number,a:number,b:number}>, endTick:number}}
 */
export function parseRolandTrack(smf) {
  const v = new DataView(smf.buffer, smf.byteOffset, smf.byteLength);
  const headerLen = v.getUint32(4, false);
  const division = v.getUint16(12, false);
  let p = 8 + headerLen + 8;                       // MThd, then MTrk + length
  const raw = [];
  let tick = 0, running = 0, endTick = 0;
  const vlq = () => { let x = 0, c; do { c = smf[p++]; x = (x << 7) | (c & 0x7f); } while (c & 0x80); return x; };
  while (p < smf.length) {
    tick += vlq();
    let s = smf[p];
    if (s >= 0x80) { p++; if (s < 0xf0) running = s; } else s = running;
    if (s === 0xff) {
      const type = smf[p++]; const len = vlq();
      if (type === 0x51) raw.push({ tick, tempo: (smf[p] << 16) | (smf[p + 1] << 8) | smf[p + 2] });
      p += len;
      if (type === 0x2f) { endTick = tick; break; }
      continue;
    }
    if (s === 0xf0 || s === 0xf7) { p += vlq(); continue; }
    const hi = s & 0xf0;
    const a = smf[p++];
    const b = (hi === 0xc0 || hi === 0xd0) ? 0 : smf[p++];
    raw.push({ tick, status: s, a, b });
  }
  /* Tempo map -> seconds -> 50 Hz ticks. */
  let usPerQuarter = 500000, lastTick = 0, seconds = 0;
  const toTick50 = (t) => {
    seconds += ((t - lastTick) * usPerQuarter) / division / 1e6;
    lastTick = t;
    return Math.floor(seconds * TICK_HZ + 1e-9);
  };
  const events = [];
  for (const e of raw) {
    const t50 = toTick50(e.tick);
    if (e.tempo !== undefined) { usPerQuarter = e.tempo; continue; }
    events.push({ tick: t50, status: e.status, a: e.a, b: e.b });
  }
  return { events, endTick: toTick50(endTick) };
}

/**
 * The nine-context player. `emit(msg)` receives what goes out of the MPU:
 * `{status, a, b}` with the channel already moved and the velocity scaled.
 */
export class RolandSequencer {
  constructor() {
    this.tracks = [];
    /* 0x1634, AH=6. The image holds 0x80 in all 11; only the OPL init
     * (0x1122) refills it, so on the MPU path 0x80 (x1.0) is the default. */
    this.volume = new Uint8Array(11).fill(0x80);
    this.now = 0;
  }

  /** AH=6 (`0000:0551`). */
  setVolume(slot, vol) { if (slot >= 0 && slot < this.volume.length) this.volume[slot] = vol; }

  /**
   * AH=1: start `track` (from parseRolandTrack) as `blob`, channels moved up
   * by `offset`. It plays from the next tick.
   * @returns {boolean} false when all nine contexts are busy
   */
  play(blob, track, offset, loop) {
    if (this.tracks.length >= PPLAYER_CONTEXTS) return false;
    this.tracks.push({ blob, track, offset, loop, cursor: 0, origin: this.now + 1, channels: new Set() });
    return true;
  }

  /** AH=5 (`0000:04EF`, AL bit 7 clear): does a track play this blob. */
  isPlaying(blob) { return this.tracks.some((t) => t.blob === blob); }

  #release(t, emit) {
    for (const ch of t.channels) emit({ status: 0xb0 | ch, a: 123, b: 0 });   // 0x2C89
  }

  /** AH=4 by blob index (`0000:0437`). */
  stopBlob(blob, emit) {
    this.tracks = this.tracks.filter((t) => {
      if (t.blob !== blob) return true;
      this.#release(t, emit);
      return false;
    });
  }

  /** AH=3 (`0000:03EC`): every track. */
  stopAll(emit) {
    for (const t of this.tracks) this.#release(t, emit);
    this.tracks = [];
  }

  /** One 50 Hz tick (PPLAYER AH=2, `0000:0C94`). */
  tick(emit) {
    this.now++;
    const done = [];
    for (const t of this.tracks) {
      const { events, endTick } = t.track;
      while (t.cursor < events.length && t.origin + events[t.cursor].tick <= this.now) {
        this.#send(t, events[t.cursor++], emit);
      }
      if (t.cursor >= events.length && t.origin + endTick <= this.now) {
        if (t.loop) { t.cursor = 0; t.origin = this.now + 1; }   // 0x0CF1 re-start
        else done.push(t);
      }
    }
    if (done.length) this.tracks = this.tracks.filter((t) => !done.includes(t));
  }

  #send(t, e, emit) {
    const hi = e.status & 0xf0;
    const ch = (e.status & 0x0f) + t.offset;
    if (ch >= 11) return;                          // 0x2AD3
    if (hi === 0xa0 || hi === 0xd0) return;        // stored, never sent
    if (ch >= 1 && ch <= 9) t.channels.add(ch);
    if (hi === 0x90 && e.b > 0) {
      let vel = e.b;
      if (ch >= 1 && ch <= 9) vel = Math.min(127, (this.volume[ch - 1] * e.b * 2) >> 8);
      emit({ status: 0x90 | ch, a: e.a, b: vel });
      return;
    }
    if (hi === 0x80 || hi === 0x90) { emit({ status: 0x80 | ch, a: e.a, b: 0 }); return; }
    emit({ status: hi | ch, a: e.a, b: e.b });
  }
}

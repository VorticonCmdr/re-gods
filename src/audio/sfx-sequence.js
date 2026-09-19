/* sfx-sequence.js — turns one `PGODS.MUS` SFX blob into a schedulable note
 * sequence: real pitches, real durations, real per-channel instruments.
 *
 * ⚠️ This module exists because of a CORRECTED finding. `Gods/docs/drivers-
 * and-memory.md` used to state, `[PROVEN]`-tagged, that this whole class of
 * sound effect "genuinely has no pitch of its own" — that it only configures
 * timbre and sounds at whatever frequency its OPL2 channel already happens
 * to hold. That conclusion came from two live DOSBox captures which
 * breakpointed `PPLAYER.BIN`'s OPL2 register-write primitive and logged
 * every write, never seeing a frequency register (0xA0-0xA8/0xB0-0xB8)
 * touched. The captures were real; the inference from them was not. Each
 * capture continued ~17 times — exactly the synchronous two-operator
 * instrument-load burst that fires at trigger time — and stopped before the
 * 50 Hz sequencer tick that plays the blob's own note events afterwards.
 * That sequencer (`FUN_0000_0cc6` -> `FUN_0000_0ce0` -> `FUN_0000_0d21`,
 * the running-status MIDI walker) is already documented in that same file;
 * it was believed to serve only the 3 non-SMF "type 2" blobs. It serves
 * these too.
 *
 * What the bytes show, and why it is not ambiguous: every one of the 70 SMF
 * blobs is a complete little MIDI sequence, and the `FF 7F` TAG=1 instrument
 * metas are TICK-POSITIONED and CHANNEL-BOUND (body byte 5 = channel). The
 * channels carrying instrument records are exactly the channels the notes
 * are written on — blob 34 (the kill sound) has notes on channels 0/1/2 and
 * exactly three TAG=1 records, for channels 0/1/2 — and blobs 60/66 change a
 * channel's instrument partway through their own sequence. Vestigial
 * exporter data does not do that. Each decoded sequence also matches its
 * game event semantically: blob 25 (menu cursor) is one very short, very
 * high note; blob 56 (treasure pickup) is an ascending arpeggio followed by
 * a quieter echo of itself; blob 39 (starburst) is a 1.5 s, 49-note
 * descending sweep with a decaying velocity ramp; blob 60 (hero death) is
 * five channels of low drones.
 *
 * Velocity: applied here as a plain gain scale, which is an APPROXIMATION,
 * not a decode. The real driver folds velocity into `FUN_0000_1640`'s
 * total-level multiply along with two per-channel tables that are BSS
 * (populated only at runtime, read all-zero statically) — see
 * `formats/sfx-instrument.js`'s header. Velocity is one input to that
 * undecoded multiply; scaling gain by it is the honest neutral substitute,
 * the same spirit as the un-scaled base level itself.
 */

import { parseSmf, notesFromEvents, buildTempoMap, ticksToSeconds } from './smf-parser.js';
import { splitInstrumentPayload, instrumentToRegisters } from '../formats/sfx-instrument.js';

/**
 * @param {Uint8Array} blob  One `PGODS.MUS` blob, already checked with `isSmf`.
 * @returns {{ notes: Array<{timeSec:number, durSec:number, channel:number, note:number, velocity:number, registers:object|null}>, durationSec:number } | null}
 */
export function buildSfxSequence(blob) {
  if (!blob || blob.length < 4 || blob[0] !== 0x4d || blob[1] !== 0x54 || blob[2] !== 0x68 || blob[3] !== 0x64) return null; // 'MThd'
  const { division, events } = parseSmf(blob);
  const tempoMap = buildTempoMap(events, division);
  const toSec = (tick) => ticksToSeconds(tick, tempoMap, division);

  /* Per-channel instrument, replayed in tick order so a note picks up
   * whichever record was most recently installed on ITS channel. A TAG=1
   * meta with no channel-mates still lands here; a blob whose very first
   * note precedes any meta on that channel gets `null` and is skipped by
   * the caller rather than silently borrowing another channel's timbre. */
  const current = new Map();
  const instrumentAt = [];   // parallel to `events`, the channel map snapshot key
  for (const e of events) {
    if (e.type === 'sfxMeta' && e.tag === 1) {
      const split = splitInstrumentPayload(e.payload);
      if (split) current.set(e.channel, instrumentToRegisters(split));
    } else if (e.type === 'noteOn') {
      instrumentAt.push({ tick: e.tick, channel: e.channel, note: e.note, registers: current.get(e.channel) || null });
    }
  }

  const notes = [];
  let durationSec = 0;
  for (const n of notesFromEvents(events)) {
    /* Match this paired note back to the instrument snapshot taken at its
     * own noteOn. FIFO per (channel, note) mirrors `notesFromEvents`'s own
     * pairing, so a retrigger before its matching off still lines up. */
    const idx = instrumentAt.findIndex((s) => s.tick === n.tick && s.channel === n.channel && s.note === n.note);
    const registers = idx >= 0 ? instrumentAt.splice(idx, 1)[0].registers : null;
    const timeSec = toSec(n.tick);
    const durSec = Math.max(0.01, toSec(n.tick + n.durationTicks) - timeSec);
    notes.push({ timeSec, durSec, channel: n.channel, note: n.note, velocity: n.velocity, registers });
    durationSec = Math.max(durationSec, timeSec + durSec);
  }
  notes.sort((a, b) => a.timeSec - b.timeSec);
  return { notes, durationSec };
}

/** MIDI note number -> Hz. Equal temperament, A4 (69) = 440. */
export function noteToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/* smf-parser.js — a Standard MIDI File reader for `PGODS.MUS`'s own blobs.
 *
 * `Gods/docs/drivers-and-memory.md`: 70 of `PGODS.MUS`'s 73 blobs open with
 * `MThd` and are complete SMFs, division `0x01A4` (420) — this session's own
 * fuller census (format/ntrks/division/tempo-event-count per blob, not just
 * the `MThd` magic) confirms all 70 are format 0, exactly 1 track, division
 * 420, exactly one Set-Tempo meta event apiece. This parser is written to
 * the general SMF grammar (multi-track, multiple tempo changes) rather than
 * hardcoded to that degenerate shape, since nothing about the container
 * FORMAT guarantees it stays that way, but every real file this project has
 * actually read reduces to the simple case.
 *
 * Deliberately NOT attempted: the 3 non-SMF blobs in `PGODS.MUS` (indices
 * 19/20/40) use the separate, only-partially-decoded `mus_type2` re-encoding
 * `drivers-and-memory.md` documents under `UNKNOWN_mus_type2` — `isSmf`
 * (mus-container.js) is how a caller tells them apart and skips them.
 */

function readVlq(d, i) {
  let v = 0;
  for (;;) {
    const b = d[i++];
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) break;
  }
  return [v, i];
}

/**
 * One track chunk's worth of events, starting right after its own `MTrk` +
 * length header.
 *
 * ⚠️ `declaredEnd` (`start + the chunk's own length field`) is NOT trusted as
 * the track's true end. Checked this session against all 70 real SMF blobs
 * in `PGODS.MUS`: EVERY one of them declares a length exactly 4 bytes short
 * of its actual content — the trailing `00 FF 2F 00` (a zero delta-time then
 * the End-of-Track meta event) sits just past the chunk's own declared
 * length, uniformly, in all 70. A real authoring quirk in this specific
 * exporter, not a parser bug: verified by walking every blob and finding
 * `declaredEnd` is short by precisely 4 in every case, matching the byte
 * length of the omitted event exactly. So this walk trusts the actual `FF
 * 2F` marker to end a track, using `bufferEnd` only as a hard safety cap for
 * a track that never reaches one, and reports how many bytes it REALLY
 * consumed so the caller can correctly locate the next chunk (relevant only
 * to a hypothetical multi-track file — every real blob here is single-track,
 * where this only affects whether the walk needs a few extra bytes it
 * already has via `bufferEnd`).
 * @returns {{events: Array, consumedEnd: number}}
 */
function parseTrack(d, start, declaredEnd, bufferEnd) {
  const events = [];
  let i = start;
  let tick = 0;
  let running = null;
  let consumedEnd = declaredEnd;
  while (i < bufferEnd) {
    let delta;
    [delta, i] = readVlq(d, i);
    tick += delta;
    let status = d[i];
    if (status === 0xff) {
      i++;
      const mtype = d[i++];
      let length;
      [length, i] = readVlq(d, i);
      if (mtype === 0x51) {
        const usPerQuarter = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
        events.push({ tick, type: 'tempo', usPerQuarter });
      } else if (mtype === 0x2f) {
        events.push({ tick, type: 'end' });
        i += length;
        consumedEnd = i;
        break;   // the REAL track boundary, regardless of the declared length
      }
      i += length;
      running = null;
    } else if (status === 0xf0 || status === 0xf7) {
      i++;
      let length;
      [length, i] = readVlq(d, i);
      i += length;
      running = null;
    } else {
      if (status & 0x80) { running = status; i++; }
      else status = running;   // running-status: reuse the last real status byte
      const hi = status & 0xf0;
      const channel = status & 0x0f;
      const d1 = d[i++];
      const twoByte = hi !== 0xc0 && hi !== 0xd0;
      const d2 = twoByte ? d[i++] : 0;
      if (hi === 0x90 && d2 > 0) events.push({ tick, type: 'noteOn', channel, note: d1, velocity: d2 });
      /* A NoteOn with velocity 0 is the standard MIDI idiom for NoteOff —
       * `PLAYER.BIN`'s own dispatcher (drivers-and-memory.md) treats command
       * nibble 1 as NoteOn unconditionally and never mentions this special
       * case, but every blob here IS a real, idiomatic SMF (not PLAYER.BIN's
       * own compressed re-encoding), so ordinary SMF-authoring conventions
       * apply, not PLAYER.BIN's own parser quirks. */
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) events.push({ tick, type: 'noteOff', channel, note: d1, velocity: d2 });
    }
  }
  return { events, consumedEnd };
}

/**
 * Parse one SMF blob (as returned by `mus-container.js`'s `parseMusContainer`,
 * checked with its own `isSmf` first) into a flat, tick-ordered event list.
 * @param {Uint8Array} blob starts at `MThd`
 * @returns {{ division:number, format:number, events: Array }}
 */
export function parseSmf(blob) {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const headerLen = view.getUint32(4, false);
  const format = view.getUint16(8, false);
  const ntrks = view.getUint16(10, false);
  const division = view.getUint16(12, false);
  let p = 8 + headerLen;
  const perTrack = [];
  for (let t = 0; t < ntrks; t++) {
    const tlen = view.getUint32(p + 4, false);
    const tstart = p + 8;
    const { events, consumedEnd } = parseTrack(blob, tstart, tstart + tlen, blob.length);
    perTrack.push(events);
    p = consumedEnd;
  }
  /* Format 1: merge all tracks into one absolute-tick timeline. A stable
   * sort keeps each track's own internal order and, for a tie, orders by
   * track index — undocumented for this format since every real blob this
   * project has is format 0/ntrks=1, where this merge is a no-op. */
  const events = perTrack
    .flatMap((track, idx) => track.map((e) => ({ ...e, _track: idx })))
    .sort((a, b) => (a.tick - b.tick) || (a._track - b._track))
    .map(({ _track, ...e }) => e);
  return { division, format, events };
}

/**
 * Pair `noteOn`/`noteOff` events (matched FIFO per channel+note, so a
 * retrigger before the matching off still pairs correctly in issue order)
 * into notes with an explicit tick duration.
 * @returns {Array<{tick:number, durationTicks:number, channel:number, note:number, velocity:number}>}
 */
export function notesFromEvents(events) {
  const pending = new Map();   // `${channel}:${note}` -> queue of open noteOns
  const notes = [];
  for (const e of events) {
    const key = `${e.channel}:${e.note}`;
    if (e.type === 'noteOn') {
      if (!pending.has(key)) pending.set(key, []);
      pending.get(key).push(e);
    } else if (e.type === 'noteOff') {
      const queue = pending.get(key);
      const on = queue && queue.shift();
      if (on) notes.push({ tick: on.tick, durationTicks: e.tick - on.tick, channel: on.channel, note: on.note, velocity: on.velocity });
    }
  }
  return notes;
}

/**
 * Build a tempo timeline from `parseSmf`'s own `events` (already tick-sorted):
 * for each tempo change, the elapsed wall-clock seconds AT that tick, given
 * every earlier segment's own tempo. SMF's own default (no Set-Tempo event
 * before the first note) is 500000 us/quarter = 120 BPM — never exercised by
 * `PGODS.MUS`'s real blobs, which all carry an explicit tempo at tick 0, but
 * correct per the format for a hypothetical blob that omits it.
 */
export function buildTempoMap(events, division) {
  const changes = events.filter((e) => e.type === 'tempo');
  const map = [{ tick: 0, usPerQuarter: 500000, seconds: 0 }];
  for (const { tick, usPerQuarter } of changes) {
    const prev = map[map.length - 1];
    if (tick === prev.tick) { prev.usPerQuarter = usPerQuarter; continue; }
    const seconds = prev.seconds + ((tick - prev.tick) * prev.usPerQuarter) / division / 1e6;
    map.push({ tick, usPerQuarter, seconds });
  }
  return map;
}

/** Convert an absolute tick to elapsed seconds using a tempo map from `buildTempoMap`. */
export function ticksToSeconds(tick, tempoMap, division) {
  let seg = tempoMap[0];
  for (const entry of tempoMap) {
    if (entry.tick > tick) break;
    seg = entry;
  }
  return seg.seconds + ((tick - seg.tick) * seg.usPerQuarter) / division / 1e6;
}

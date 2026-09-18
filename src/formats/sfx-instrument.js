/* sfx-instrument.js — extracts real OPL2 SFX instrument data from PGODS.MUS
 * blobs, and turns it into real 0x388/0x389 register values.
 *
 * This is the JS port of `Gods/extract_sfx_instruments.py` — see that
 * script's own header and `Gods/docs/drivers-and-memory.md`'s
 * `UNKNOWN_sfx_instrument_source` entry for the full disassembly/live-
 * DOSBox-capture citation trail. Summary: `PPLAYER.BIN`'s OPL2 SFX handler
 * (`FUN_0000_1321`) selects a `PGODS.MUS` blob by DIRECT INDEX — the low
 * byte of whatever id `GAME.EXE`'s sound-export call passes, masked to 7
 * bits (`AL & 0x7f`), live-confirmed exact (28/28 bytes) against two
 * independently-captured DOSBox sessions. Each blob's `FF 7F` sequencer-
 * specific meta opens with a 6-byte micro-record at a HEADER-LENGTH-
 * INDEPENDENT blob offset of 46 (confirmed identical across every one of
 * the 70 real blobs, lengths 103–649), whose TAG=1 payload — 28 raw bytes
 * starting at blob offset 52 — splits into a 13-byte operator-1 block, a
 * 13-byte operator-2 block, and 2 trailing wave-select bytes.
 *
 * Register formulas (all disassembled in Ghidra, not guessed): every field
 * except total output level (registers 0x40/0x43) is a direct, proven
 * bit-packed copy of the stored bytes. Total level needs a runtime
 * volume/velocity-scaling multiply (`DAT_0000_1491`/`DAT_0000_1634`) this
 * project has not decoded — `instrumentToRegisters` substitutes the
 * stored base level UN-scaled, audibly louder/quieter than the original
 * for that one field only.
 *
 * The three non-SMF "type 2" blobs (19/20/40, `ADL.EXE`'s own voice-
 * count-9 records) are NOT covered — they read through `PPLAYER.BIN`'s
 * indexed byte accessor instead of a literal walk, a parser this project
 * has not written. `extractInstrument` returns `null` for them.
 */

const MICRO_RECORD_OFFSET = 46;
const PAYLOAD_OFFSET = 52;

/**
 * @param {Uint8Array} blob  One `PGODS.MUS` container blob (mus-container.js's own `.data`).
 * @returns {{ op1: Uint8Array, op2: Uint8Array, waves: Uint8Array } | null}
 */
export function extractInstrument(blob) {
  if (blob.length < 4 || blob[0] !== 0x4d || blob[1] !== 0x54 || blob[2] !== 0x68 || blob[3] !== 0x64) return null; // 'MThd'
  if (blob.length < PAYLOAD_OFFSET + 28) return null;
  if (blob[MICRO_RECORD_OFFSET + 2] !== 0x3f) return null;
  const payload = blob.subarray(PAYLOAD_OFFSET, PAYLOAD_OFFSET + 28);
  return {
    op1: payload.subarray(0, 13),
    op2: payload.subarray(13, 26),
    waves: payload.subarray(26, 28),
  };
}

function operatorRegisters(rec, waveByte) {
  return {
    reg20: ((rec[9] ? 0x80 : 0) | (rec[10] ? 0x40 : 0) | (rec[5] ? 0x20 : 0) | (rec[11] ? 0x10 : 0) | (rec[1] & 0xf)),
    reg40: ((rec[0] << 6) | (rec[8] <= 0x3f ? 0x3f - rec[8] : 0)), // level UNSCALED, see module header
    reg60: ((rec[3] << 4) | (rec[6] & 0xf)),
    reg80: ((rec[4] << 4) | (rec[7] & 0xf)),
    regE0: (waveByte & 3),
  };
}

/**
 * @param {{op1: Uint8Array, op2: Uint8Array, waves: Uint8Array}} instrument
 * @returns {{ op1: {reg20,reg40,reg60,reg80,regE0}, op2: {...}, regC0: number }}
 */
export function instrumentToRegisters({ op1, op2, waves }) {
  // 0xC0 (feedback/connection) is channel-level, not operator-level; the
  // real driver's own DAT_0000_1409 gate makes the FIRST operator of each
  // channel the one that writes it — op1 plays that role here.
  const regC0 = (op1[2] << 1) | (op1[12] === 0 ? 1 : 0);
  return {
    op1: operatorRegisters(op1, waves[0]),
    op2: operatorRegisters(op2, waves[1]),
    regC0,
  };
}

/**
 * @param {number} sfxId  The full id passed to `WebAudioBus.play` / `SFX_VOICES`'s own keys.
 * @param {Uint8Array[]} pgodsBlobs  `PGODS.MUS`'s own parsed container blobs.
 * @returns {{op1,op2,regC0} | null}
 */
export function lookupSfxInstrument(sfxId, pgodsBlobs) {
  const blobIndex = sfxId & 0x7f;
  if (blobIndex >= pgodsBlobs.length) return null;
  const inst = extractInstrument(pgodsBlobs[blobIndex]);
  if (!inst) return null;
  return instrumentToRegisters(inst);
}

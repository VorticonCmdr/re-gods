/* mt32-bank.js — the MT-32 sound bank the Roland intro uploads.
 *
 * `[STATIC]`, PPLAYER.BIN (DCL-decompressed) and PTITLE.RL. The in-game
 * `PGODSRL{A..G}.RL` files carry only MIDI: their program changes name
 * patches such as 7 or 25 that are the game's OWN sounds ("xplo1",
 * "Heartbeat"), not MT-32 factory presets. Those patches are uploaded once,
 * by the intro, from the tail of PTITLE.RL; the MT-32 keeps them until it is
 * switched off, so GAME.EXE never sends them again.
 *
 * The upload (PPLAYER.BIN AH=0 with the MPU-401 bit, `0000:29DD`):
 *
 *   29FA-2A2D  reset the MPU, UART mode, CC 123 (all notes off) on 16 channels
 *   2A39-2A4C  bx = count*4 + 2; if bx + 2 >= the first blob's offset there
 *              is no bank (every PGODSRL?.RL: count 63, first blob at 256)
 *   2A4E-2A69  else the u32 at file+bx+2 is the bank's offset
 *              (PTITLE.RL: count 1, u32 at 8 = 0x8048)
 *   2A6D       0x2D93 system area   10 00 00 / 01 / 04 / 0D / 16 (1+3+9+9+1)
 *   2A75       0x2D3E patch temp    03 00 00 + 16*part, 8 parts x 16
 *   2A7D       0x2CFB timbres       08 (2*i) 00, 64 x 246 (0xF6)
 *   2A85       0x2D19 patches       05 xx xx, 128 x 8
 *   2A8D       0x2D69 rhythm setup  03 01 10 + 4*i, 85 keys (24..108) x 4
 *
 * Each block goes out as a Roland DT1 SysEx (`0x2DFF`: F0 41 10 16 12,
 * address, data, checksum, F7), the data read sequentially from the bank.
 * The five sizes add up to 17259 bytes, exactly PTITLE.RL's length after
 * 0x8048.
 */

const SYSTEM_BYTES = 23;
const PATCH_TEMP_BYTES = 8 * 16;
const TIMBRE_BYTES = 0xf6;
const TIMBRE_COUNT = 64;
const PATCH_COUNT = 128;
const RHYTHM_KEYS = 85;
export const RHYTHM_FIRST_KEY = 24;
export const MT32_BANK_BYTES = SYSTEM_BYTES + PATCH_TEMP_BYTES
  + TIMBRE_COUNT * TIMBRE_BYTES + PATCH_COUNT * 8 + RHYTHM_KEYS * 4;   // 17259

/**
 * PPLAYER.BIN 0x2A39-0x2A69: where a container's bank starts, or -1.
 * @param {Uint8Array} data a DCL-decompressed .RL/.MUS container
 */
export function bankOffset(data) {
  const count = data[0] | (data[1] << 8);
  const bx = count * 4 + 2;
  const first = data[2] | (data[3] << 8);
  if (bx + 2 >= first) return -1;                    // 2A45-2A4C `jns`
  return (data[bx + 2] | (data[bx + 3] << 8) | (data[bx + 4] << 16) | (data[bx + 5] << 24)) >>> 0;
}

/** One MT-32 partial (58 bytes). Field names follow the MT-32 manual. */
function parsePartial(p) {
  return {
    pitchCoarse: p[0], pitchFine: p[1], pitchKeyfollow: p[2], bender: p[3],
    waveform: p[4], pcmWave: p[5], pulseWidth: p[6], pwVeloSens: p[7],
    penvDepth: p[8], penvVeloSens: p[9], penvTimeKeyfollow: p[10],
    penvTime: [p[11], p[12], p[13], p[14]],
    penvLevel: [p[15], p[16], p[17], p[18], p[19]],       // L0 L1 L2 sustain end
    lfoRate: p[20], lfoDepth: p[21], lfoModSens: p[22],
    tvfCutoff: p[23], tvfResonance: p[24], tvfKeyfollow: p[25],
    tvfBiasPoint: p[26], tvfBiasLevel: p[27], tvfEnvDepth: p[28],
    tvfEnvVeloSens: p[29], tvfEnvDepthKeyfollow: p[30], tvfEnvTimeKeyfollow: p[31],
    tvfEnvTime: [p[32], p[33], p[34], p[35], p[36]],
    tvfEnvLevel: [p[37], p[38], p[39], p[40]],            // L1 L2 L3 sustain
    tvaLevel: p[41], tvaVeloSens: p[42],
    tvaBias: [p[43], p[44], p[45], p[46]],
    tvaEnvTimeKeyfollow: p[47], tvaEnvTimeVeloFollow: p[48],
    tvaEnvTime: [p[49], p[50], p[51], p[52], p[53]],
    tvaEnvLevel: [p[54], p[55], p[56], p[57]],            // L1 L2 L3 sustain
    /** WG byte 4: bit 1 = a PCM (ROM sample) partial, bit 0 = sawtooth. */
    isPcm: (p[4] & 2) !== 0,
    isSaw: (p[4] & 1) !== 0,
  };
}

/** One 246-byte timbre: 14 common bytes, then four 58-byte partials. */
export function parseTimbre(t) {
  const name = String.fromCharCode(...t.subarray(0, 10)).replace(/\s+$/, '');
  const partialMute = t[12];
  const partials = [];
  for (let k = 0; k < 4; k++) {
    partials.push({ ...parsePartial(t.subarray(14 + 58 * k, 14 + 58 * (k + 1))),
      enabled: ((partialMute >> k) & 1) === 1 });
  }
  return {
    name, structure12: t[10], structure34: t[11], partialMute,
    /** 1 = "no sustain": the envelopes run to their end while the key is held. */
    noSustain: t[13] === 1,
    partials,
  };
}

/**
 * Split PTITLE.RL's bank into its five blocks.
 * @param {Uint8Array} data the decompressed container (PTITLE.RL)
 * @returns {?object} null when the container carries no bank
 */
export function parseMt32Bank(data) {
  const at = bankOffset(data);
  if (at < 0 || at + MT32_BANK_BYTES > data.length) return null;
  let p = at;
  const take = (n) => { const s = data.subarray(p, p + n); p += n; return s; };
  const sys = take(SYSTEM_BYTES);
  const system = {
    masterTune: sys[0], reverbMode: sys[1], reverbTime: sys[2], reverbLevel: sys[3],
    partialReserve: [...sys.subarray(4, 13)], channels: [...sys.subarray(13, 22)],
    masterVolume: sys[22],
  };
  const pt = take(PATCH_TEMP_BYTES);
  const patchTemp = [];
  for (let i = 0; i < 8; i++) {
    const r = pt.subarray(16 * i, 16 * i + 16);
    patchTemp.push({ timbreGroup: r[0], timbreNumber: r[1], keyShift: r[2], fineTune: r[3],
      benderRange: r[4], outputLevel: r[8], panpot: r[9] });
  }
  const timbres = [];
  for (let i = 0; i < TIMBRE_COUNT; i++) timbres.push(parseTimbre(take(TIMBRE_BYTES)));
  const patches = [];
  for (let i = 0; i < PATCH_COUNT; i++) {
    const r = take(8);
    patches.push({ timbreGroup: r[0], timbreNumber: r[1], keyShift: r[2], fineTune: r[3],
      benderRange: r[4], assignMode: r[5], reverb: r[6] });
  }
  const rhythm = new Map();
  for (let i = 0; i < RHYTHM_KEYS; i++) {
    const r = take(4);
    rhythm.set(RHYTHM_FIRST_KEY + i, { timbre: r[0], outputLevel: r[1], panpot: r[2], reverb: r[3] });
  }
  return { offset: at, system, patchTemp, timbres, patches, rhythm };
}

/**
 * The MT-32's ROM timbres, by the manual's names: groups A and B (patch
 * timbre groups 0 and 1, 64 each) and the rhythm set R1..R30 (rhythm timbre
 * numbers 64..93). The game's patches point at a handful of these. Their
 * sound lives in the synth's ROM, which this port does not have, so only the
 * name is known; mt32-synth.js picks a stand-in voice from it.
 */
export const MT32_PRESET_NAMES = [
  'AcouPiano1', 'AcouPiano2', 'AcouPiano3', 'ElecPiano1', 'ElecPiano2', 'ElecPiano3', 'ElecPiano4', 'Honkytonk',
  'Elec Org 1', 'Elec Org 2', 'Elec Org 3', 'Elec Org 4', 'Pipe Org 1', 'Pipe Org 2', 'Pipe Org 3', 'Accordion',
  'Harpsi 1', 'Harpsi 2', 'Harpsi 3', 'Clavi 1', 'Clavi 2', 'Clavi 3', 'Celesta 1', 'Celesta 2',
  'Syn Brass1', 'Syn Brass2', 'Syn Brass3', 'Syn Brass4', 'Syn Bass 1', 'Syn Bass 2', 'Syn Bass 3', 'Syn Bass 4',
  'Fantasy', 'Harmo Pan', 'Chorale', 'Glasses', 'Soundtrack', 'Atmosphere', 'Warm Bell', 'Funny Vox',
  'Echo Bell', 'Ice Rain', 'Oboe 2001', 'Echo Pan', 'DoctorSolo', 'Schooldaze', 'BellSinger', 'SquareWave',
  'Str Sect 1', 'Str Sect 2', 'Str Sect 3', 'Pizzicato', 'Violin 1', 'Violin 2', 'Cello 1', 'Cello 2',
  'Contrabass', 'Harp 1', 'Harp 2', 'Guitar 1', 'Guitar 2', 'Elec Gtr 1', 'Elec Gtr 2', 'Sitar',
  'Acou Bass1', 'Acou Bass2', 'Elec Bass1', 'Elec Bass2', 'Slap Bass1', 'Slap Bass2', 'Fretless 1', 'Fretless 2',
  'Flute 1', 'Flute 2', 'Piccolo 1', 'Piccolo 2', 'Recorder', 'Pan Pipes', 'Sax 1', 'Sax 2',
  'Sax 3', 'Sax 4', 'Clarinet 1', 'Clarinet 2', 'Oboe', 'Engl Horn', 'Bassoon', 'Harmonica',
  'Trumpet 1', 'Trumpet 2', 'Trombone 1', 'Trombone 2', 'Fr Horn 1', 'Fr Horn 2', 'Tuba', 'Brs Sect 1',
  'Brs Sect 2', 'Vibe 1', 'Vibe 2', 'Syn Mallet', 'Windbell', 'Glock', 'Tube Bell', 'Xylophone',
  'Marimba', 'Koto', 'Sho', 'Shakuhachi', 'Whistle 1', 'Whistle 2', 'Bottleblow', 'Breathpipe',
  'Timpani', 'MelodicTom', 'Deep Snare', 'Elec Perc1', 'Elec Perc2', 'Taiko', 'Taiko Rim', 'Cymbal',
  'Castanets', 'Triangle', 'Orche Hit', 'Telephone', 'Bird Tweet', 'OneNoteJam', 'WaterBells', 'JungleTune',
];

export const MT32_RHYTHM_NAMES = [
  'Acou BD', 'Acou SD', 'Acou HiTom', 'AcouMidTom', 'AcouLowTom', 'Elec SD', 'Clsd HiHat', 'OpenHiHat2',
  'Crash Cym', 'Ride Cym', 'Rim Shot', 'Hand Clap', 'Cowbell', 'Mt HiConga', 'High Conga', 'Low Conga',
  'Hi Timbale', 'LowTimbale', 'High Bongo', 'Low Bongo', 'High Agogo', 'Low Agogo', 'Tambourine', 'Claves',
  'Maracas', 'SmbaWhis L', 'SmbaWhis S', 'Cabasa', 'Quijada', 'OpenHiHat1',
];

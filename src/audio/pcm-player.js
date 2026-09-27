/* pcm-player.js — browser-only playback of raw 8-bit unsigned PCM (the
 * decoded shape `formats/sb-voice.js` produces from PDEMOSB4.SB). Same
 * lazy-AudioContext convention as `music-player.js`/`audio-bus.js`'s own
 * `WebAudioBus` — browsers refuse to start an AudioContext before a real
 * user gesture, so this is created on the first `.play()` call, not at
 * construction.
 */

export class PcmPlayer {
  #ctx = null;
  #source = null;

  #ensureContext() {
    if (!this.#ctx) {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.#ctx = new Ctor();
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    return this.#ctx;
  }

  /**
   * @param {Uint8Array} pcm8u  8-bit unsigned mono PCM samples.
   * @param {number} sampleRateHz
   */
  play(pcm8u, sampleRateHz) {
    const ctx = this.#ensureContext();
    const buffer = ctx.createBuffer(1, pcm8u.length, sampleRateHz);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm8u.length; i++) channel[i] = (pcm8u[i] - 128) / 128;
    this.stop();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    this.#source = source;
  }

  /**
   * Schedule a whole `formats/sb-voice.js` sequence. Each event starts its
   * clip at `tick / tickHz` seconds and cuts the previous one off — the
   * driver halts the running DMA before every new note (`0000:26a8`).
   * @param {{clips: Uint8Array[], events: Array<{tick:number, clip:number, rateHz:number}>}} seq
   * @param {number} tickHz  the sequencer's tick rate (50)
   * @param {number} [offsetTicks=0]  skip this many ticks of the sequence
   */
  playSequence({ clips, events }, tickHz, offsetTicks = 0) {
    const ctx = this.#ensureContext();
    this.stop();
    const buffers = new Map();
    const bufferFor = (clip, rateHz) => {
      const key = `${clip}@${rateHz}`;
      if (!buffers.has(key)) {
        const pcm = clips[clip];
        const b = ctx.createBuffer(1, pcm.length, rateHz);
        const ch = b.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] - 128) / 128;
        buffers.set(key, b);
      }
      return buffers.get(key);
    };
    const t0 = ctx.currentTime + 0.05 - offsetTicks / tickHz;
    this.#seqSources = [];
    let prev = null;
    for (const e of events) {
      const when = t0 + e.tick / tickHz;
      if (when < ctx.currentTime) continue;
      const src = ctx.createBufferSource();
      src.buffer = bufferFor(e.clip, e.rateHz);
      src.connect(ctx.destination);
      src.start(when);
      if (prev) prev.stop(when);
      prev = src;
      this.#seqSources.push(src);
    }
  }

  #seqSources = [];

  stop() {
    if (this.#source) {
      try { this.#source.stop(); } catch { /* already ended */ }
      this.#source = null;
    }
    for (const s of this.#seqSources) { try { s.stop(); } catch { /* not started/ended */ } }
    this.#seqSources = [];
  }
}

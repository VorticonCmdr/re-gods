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

  stop() {
    if (this.#source) {
      try { this.#source.stop(); } catch { /* already ended */ }
      this.#source = null;
    }
  }
}

/* Chord audio synth: Karplus-Strong plucked strings, strummed top-to-bottom.
 *
 * Standard guitar tuning, low E -> high E:
 *   E2=82.41, A2=110.0, D3=146.83, G3=196.0, B3=246.94, E4=329.63
 *
 * For each non-muted string i in `frets`, frequency = openFreq[i] * 2^(fret/12).
 * Generate a 1 s mono AudioBuffer per pitch (cached), then schedule six
 * AudioBufferSourceNodes with a 5 ms stagger to feel like a downstroke.
 *
 * Public API:
 *   const audio = new ChordAudio(audioCtx);
 *   audio.play(time, frets);
 */
(function () {
  const TUNING_HZ = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
  const BUFFER_SECONDS = 1.2;
  const STRING_STAGGER_S = 0.006;   // 6 ms between strings = ~30ms total strum
  const STRING_GAIN = 0.16;
  const MASTER_GAIN = 0.7;          // per-strum bus attenuation
  const LOWPASS_HZ = 3800;

  class ChordAudio {
    constructor(audioCtx) {
      this.ctx = audioCtx;
      // Cache: bucketed by frequency rounded to 0.1 Hz.
      this.bufferCache = new Map();
    }

    play(time, frets) {
      if (!this.ctx) return;
      const ctx = this.ctx;

      // Per-strum filter + master bus. Created fresh each call so a single
      // bad filter state can't kill audio for the whole session. All nodes
      // are torn down once the last source ends.
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = LOWPASS_HZ;
      filter.Q.value = 0.4;

      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;

      filter.connect(master);
      master.connect(ctx.destination);

      const gains = [];
      let activeCount = 0;

      for (let i = 0; i < 6; i++) {
        const fret = frets[i];
        if (fret === null || fret === undefined) continue;
        const freq = TUNING_HZ[i] * Math.pow(2, fret / 12);
        const buffer = this._getBuffer(freq);

        const src = ctx.createBufferSource();
        src.buffer = buffer;

        const gain = ctx.createGain();
        gain.gain.value = STRING_GAIN;
        gains.push(gain);

        src.connect(gain).connect(filter);
        src.start(time + i * STRING_STAGGER_S);
        src.stop(time + i * STRING_STAGGER_S + BUFFER_SECONDS + 0.05);
        activeCount++;

        src.onended = () => {
          try { src.disconnect(); } catch (_) {}
          activeCount--;
          if (activeCount === 0) {
            for (const g of gains) { try { g.disconnect(); } catch (_) {} }
            try { filter.disconnect(); } catch (_) {}
            try { master.disconnect(); } catch (_) {}
          }
        };
      }

      // All strings muted — nothing scheduled, so tear down the empty graph.
      if (activeCount === 0) {
        filter.disconnect();
        master.disconnect();
      }
    }

    _getBuffer(freq) {
      const key = Math.round(freq * 10);
      let buf = this.bufferCache.get(key);
      if (buf) return buf;

      const sampleRate = this.ctx.sampleRate;
      const N = Math.max(2, Math.round(sampleRate / freq));
      const totalSamples = Math.floor(sampleRate * BUFFER_SECONDS);

      buf = this.ctx.createBuffer(1, totalSamples, sampleRate);
      const data = buf.getChannelData(0);

      // Seed N+1 samples of bandlimited noise (indices 0..N inclusive).
      // The 2-tap feedback reads data[i-N] and data[i-N-1]; the loop starts
      // at i=N+1, so the earliest second tap is data[0] — always in range.
      // Seeding N+1 (not just N) ensures data[N] is real noise, not a zero
      // that would punch a hole in the resonance every N samples.
      let prev = 0;
      for (let i = 0; i <= N; i++) {
        const noise = (Math.random() * 2 - 1) * 0.5;
        const smoothed = 0.5 * (noise + prev);
        data[i] = smoothed;
        prev = noise;
      }

      // Karplus-Strong feedback loop. Both taps are always in-range because
      // the seed covers 0..N and the loop starts at N+1.
      const decay = 0.498;
      for (let i = N + 1; i < totalSamples; i++) {
        data[i] = decay * (data[i - N] + data[i - N - 1]);
      }

      // Light fade-out at the tail to avoid clicks if cut early.
      const fadeStart = totalSamples - Math.floor(sampleRate * 0.05);
      for (let i = fadeStart; i < totalSamples; i++) {
        const t = (i - fadeStart) / (totalSamples - fadeStart);
        data[i] *= 1 - t;
      }

      this.bufferCache.set(key, buf);
      return buf;
    }
  }

  window.ChordAudio = ChordAudio;
})();

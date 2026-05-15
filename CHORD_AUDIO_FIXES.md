# Chord audio fixes

Record of every change made to get the in-app chord playback working and sounding like an acoustic strum.

All changes are in two files:
- [`static/js/chord-audio.js`](static/js/chord-audio.js) — the Karplus-Strong synth engine
- [`static/js/practice.js`](static/js/practice.js) — the metronome beat callback that decides when to strum

---

## Symptom progression

1. **Initial:** Pressing Start produced only metronome ticks, no chord audio (or a muffled noise burst).
2. After a partial fix: a single sharp noise on the first beat of the session, then silence. Console showed `BiquadFilterNode: state is bad, probably due to unstable filter caused by fast parameter automation` warnings.
3. After all fixes: a clean acoustic-style downstroke on the first beat of every bar that rings out under the following metronome ticks.

---

## Fix 1 — Karplus-Strong buffer was NaN-poisoned

**Where:** `chord-audio.js`, inside `_getBuffer(freq)`.

**The bug:** The feedback loop was

```js
for (let i = N; i < totalSamples; i++) {
  data[i] = decay * (data[i - N] + data[i - N - 1]);
}
```

At `i = N`, the second tap is `data[-1]`. JavaScript `Float32Array` returns `undefined` on a negative index, and `undefined + number = NaN`. The single NaN then re-entered the delay line every N samples, eventually corrupting most of the buffer. When that buffer was played, the AudioBufferSourceNode emitted NaN samples, which is what triggered the downstream filter to go into the "state is bad" state.

**The fix:** Seed `N + 1` samples (indices `0..N` inclusive) instead of `N`, and start the feedback loop at `i = N + 1` so both taps are always backed by real data:

```js
let prev = 0;
for (let i = 0; i <= N; i++) {        // seed one extra sample
  const noise = (Math.random() * 2 - 1) * 0.5;
  data[i] = 0.5 * (noise + prev);
  prev = noise;
}
for (let i = N + 1; i < totalSamples; i++) {   // start one sample later
  data[i] = KS_DECAY * (data[i - N] + data[i - N - 1]);
}
```

A naive earlier attempt that just shifted the loop to `N + 1` without extending the seed left `data[N] = 0`, which punched a zero into the delay line every N samples and broke resonance — that was the "muffled noise" stage.

---

## Fix 2 — One shared filter silenced the whole session

**Where:** `chord-audio.js`, `play(time, frets)`.

**The bug:** A first refactor moved the lowpass `BiquadFilterNode` into the constructor as `this._filter`, shared across every strum, to avoid creating a new filter per call. Once Chrome flagged that filter as having a bad internal state (probably from the NaN samples in Fix 1, or from amplitude transients), it muted the filter's output. Every subsequent strum then routed through a permanently-silenced filter.

**The fix:** Build the filter graph **per strum** and tear it down via `onended` so each strum starts with a clean state and there is no leak.

```js
play(time, frets) {
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
    const src = ctx.createBufferSource();
    src.buffer = this._getBuffer(/* ...freq... */);
    const gain = ctx.createGain();
    gain.gain.value = STRING_GAIN;
    gains.push(gain);

    src.connect(gain).connect(filter);
    src.start(time + i * STRING_STAGGER_S);
    src.stop(time + i * STRING_STAGGER_S + BUFFER_SECONDS + 0.05);
    activeCount++;

    src.onended = () => {
      src.disconnect();
      if (--activeCount === 0) {
        for (const g of gains) g.disconnect();
        filter.disconnect();
        master.disconnect();
      }
    };
  }

  if (activeCount === 0) { filter.disconnect(); master.disconnect(); }
}
```

A `MASTER_GAIN = 0.7` was added as headroom so the filter's input sum stays well below unity even when all six strings are sounding.

---

## Fix 3 — Strum timing

**Where:** `practice.js`, `onBeat(beatIdx, audioTime)`.

The strum-trigger condition went through two iterations and landed at the original "once per bar":

```js
// final:
if (this.chordAudio && this.audioMode !== "tick"
    && beatIdx % this.beatsPerBar === 0) {
  this.chordAudio.play(audioTime, chord.frets);
}
```

One strum on the downbeat of each bar, ringing out under the subsequent metronome ticks. A future "Strumming Patterns" tab will replace this with full down/up patterns.

---

## Fix 4 — Make it sound like an acoustic guitar

Final tuning of the synth constants in `chord-audio.js`:

| Constant | Old | New | Effect |
|---|---|---|---|
| `BUFFER_SECONDS` | `1.2` | `3.5` | The audio buffer is now long enough to actually *hold* a multi-second decay. The old buffer was cutting the note short regardless of decay settings. |
| `KS_DECAY` | `0.498` | `0.4995` | Closer to the K-S sustain limit of `0.5`. Fundamental loop gain rises from ~0.996 to ~0.999, so amplitude halves every ~0.7 s instead of every ~0.17 s. |
| `STRING_STAGGER_S` | `0.006` | `0.012` | Total downstroke spans ~70 ms instead of ~36 ms — feels like a hand sweeping across strings rather than a near-block chord. |
| Tail fade length | 50 ms | 150 ms | The natural decay melts into silence instead of being clipped off when the source ends. |

---

## Files touched

| File | Purpose |
|---|---|
| [`static/js/chord-audio.js`](static/js/chord-audio.js) | Fixed K-S seeding/loop bounds, per-strum filter graph with cleanup, longer buffer + slower decay + wider strum stagger. |
| [`static/js/practice.js`](static/js/practice.js) | Strum trigger condition (once per bar downbeat). |

No data model, API, or template changes were required.

---

## How to verify

1. Run the Flask app, open the page, hard-refresh (`Ctrl + Shift + R`).
2. Pick any chord (G works well), set BPM 80, 4/4, press **Start**.
3. Expected: a single clean downstroke at the top of each bar, audibly ringing under the next two or three ticks.
4. Open DevTools Console — should be empty of `BiquadFilterNode: state is bad` warnings.
5. Switch the Sound toggle between **Tick / Chord / Both** and confirm the chord mutes/unmutes correctly.

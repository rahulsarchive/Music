# Chord audio fixes — Revision 2

Revision 2 layers per-string character on top of the stable Karplus-Strong
engine from Revision 1 (see [`CHORD_AUDIO_FIXES.md`](CHORD_AUDIO_FIXES.md)).
The goal: make each string sound like *that string* — wound bass strings ring
longer and warmer, plain treble strings decay quicker and brighter, every note
starts with an audible pick attack.

This document records:

1. The current architecture of the synth (post-Revision-2).
2. The big-bang rewrite that was attempted first and broke audio in multiple ways.
3. The incremental four-step fix that replaced it.

---

## Architecture: how a chord becomes sound

All audio lives in [`static/js/chord-audio.js`](static/js/chord-audio.js).
Strums are triggered from [`static/js/practice.js`](static/js/practice.js) —
the metronome's `onBeat(beatIdx, audioTime)` callback calls
`chordAudio.play(audioTime, frets)` on the downbeat of every bar.

### Public API

```js
const audio = new ChordAudio(audioCtx);
audio.play(time, frets);   // frets = 6 entries, low E → high E; null = muted
```

### Signal flow per strum

```
   string 0 ─▶ gain[0] ┐
   string 1 ─▶ gain[1] ┤
   string 2 ─▶ gain[2] ┤                                  per-strum nodes,
   string 3 ─▶ gain[3] ┼─▶ filter ─▶ master ─▶ destination  torn down by the
   string 4 ─▶ gain[4] ┤                                  last src.onended
   string 5 ─▶ gain[5] ┘
```

Each string is an `AudioBufferSourceNode` whose buffer is a 3.5-second
pre-rendered Karplus-Strong waveform at that string's tuned frequency. The
lowpass filter (3800 Hz, Q=0.4) and the master gain (0.7) are both created
fresh per `play()` call and disconnected on the last `src.onended`.

### Per-string parameters (low E → high E)

| Index | Open freq (Hz) | Decay     | Seed smooth | Pick strength | String gain |
|-------|----------------|-----------|-------------|---------------|-------------|
| 0 (E2)| 82.41          | 0.49985   | 1.00        | 0.15          | 0.18        |
| 1 (A2)| 110.00         | 0.49980   | 0.95        | 0.14          | 0.17        |
| 2 (D3)| 146.83         | 0.49970   | 0.80        | 0.12          | 0.15        |
| 3 (G3)| 196.00         | 0.49960   | 0.65        | 0.12          | 0.15        |
| 4 (B3)| 246.94         | 0.49940   | 0.40        | 0.13          | 0.16        |
| 5 (E4)| 329.63         | 0.49920   | 0.20        | 0.15          | 0.17        |

**Decay** drives sustain length. The KS feedback is the *sum* form
`data[i] = decay * (data[i-N] + data[i-N-1])`, so per-loop amplitude factor
is ~2·decay. Values near 0.5 give loop gains near 1.0; larger values =
slower fade. Real bass strings sustain longer than treble.

**Seed smooth** controls brightness via mixing raw noise with FIR-averaged
noise: `seed = smooth * averaged + (1 - smooth) * noise`. 1.0 = full
averaging (darkest, matches the Revision-1 single-coefficient code). 0.0 =
raw white noise (brightest). Wound bass strings get full smoothing (warm),
plain treble strings let more high-frequency energy through.

**Pick strength** is the peak amplitude of a 5-ms linearly-decaying impulse
layered onto the seed. Models the pick striking the string — a short
percussive click before the KS resonance takes over.

**String gain** is the per-string mixer attenuation. Bass and treble project
slightly more than mid strings.

### Strum timing

```js
const STRING_STAGGER_S = 0.012;   // 12 ms inter-string offset
const STAGGER_JITTER_S = 0.004;   // ±2 ms per-string per-strum

const jitter = (Math.random() - 0.5) * STAGGER_JITTER_S;
const startTime = time + i * STRING_STAGGER_S + jitter;
```

The 12 ms stagger spans ~70 ms across all six strings — feels like a hand
sweeping down rather than a near-block chord. The ±2 ms jitter (rolled per
string, per strum) prevents successive strums from sounding identical.

### Buffer generation (`_getBuffer(freq, stringIndex)`)

For each non-muted string:

1. `N = round(sampleRate / freq)` — KS delay-line length in samples.
2. **Seed `N + 1` samples** (indices `0..N` inclusive):
   - Generate raw white noise `noise ∈ [-0.5, 0.5]`.
   - Compute the FIR average `averaged = 0.5 * (noise + prev)`.
   - Mix per `SEED_SMOOTH[stringIndex]`.
   - Layer a linearly-decaying pick impulse for the first 5 ms, scaled by
     `PICK_STRENGTH[stringIndex]`.
3. **Karplus-Strong feedback loop** from `i = N + 1` to end:
   ```js
   data[i] = decay * (data[i-N] + data[i-N-1]);
   ```
4. **Tail fade** — 150 ms linear ramp to zero at the end of the buffer.

Buffers are cached by `Math.round(freq * 10) + "_" + stringIndex`. The
string index is part of the key because the same pitch on two different
strings now produces different buffers (different decay, smoothing, pick).

### Critical invariants — break these and audio dies

- **Every `BiquadFilterNode` is per-strum and torn down on the last
  `onended`.** Chrome can mark a biquad's state as "bad" from amplitude
  transients and permanently mute its output. A persistent shared biquad
  silences every subsequent strum for the rest of the session. This applies
  to *any* biquad type, not just the lowpass — see Revision-1 Fix 2 and
  Revision-2 Failure 1 below.
- **The seed window is `N + 1` samples, not `N`.** The KS loop's far tap
  reads `data[i-N-1]`, which at `i = N+1` is `data[0]` — always in range.
  Seeding only N samples leaves `data[N] = 0`, punching a zero into the
  delay line every N samples and destroying resonance.
- **The KS feedback formula is the sum form** `decay * (a + b)`, not a
  weighted-average form. Per-loop gain is ~2·decay, so decay values are
  near 0.5. Switching to an average form silently changes per-loop gain to
  ~decay (halving it), which makes buffers decay in ~120 ms instead of
  seconds.

---

## What didn't work: the big-bang rewrite

The first Revision-2 attempt rewrote `chord-audio.js` in a single edit that
added all four planned upgrades plus a body-resonance EQ and a convolution
reverb. Two things broke.

### Failure 1: persistent BiquadFilterNodes silenced the session

The body-resonance design used two persistent peaking biquads (95 Hz and
210 Hz) on a shared `inputBus` that every strum routed through. Chrome
flagged them as `state is bad` on the first strum's amplitude transient and
muted them for the rest of the session — every subsequent strum was silent.

This is the same failure mode as Revision-1 Fix 2 (a single shared lowpass
filter going bad). `CHORD_AUDIO_FIXES.md` had been read before the rewrite
and the mistake still happened — the rule applies to *any* `BiquadFilterNode`,
not just the lowpass.

**Fix attempted:** moved the body filters into `play()` so they're per-strum
and disconnected on `onended`. This unblocked subsequent strums.

### Failure 2: wrong KS loop math

After Failure 1 was fixed, audio still sounded dead — short blips on each
downbeat that died almost immediately.

Root cause: the KS feedback was rewritten from the sum form to a per-string
"allpass" weighted average:

```js
// Original (sum):    data[i] = decay * (data[i-N] + data[i-N-1]);
// Broken (average):  data[i] = decay * (a*data[i-N] + (1-a)*data[i-N-1]);
```

The sum form has per-loop gain ≈ 2·decay (≈ 0.999 with decay = 0.4995).
The weighted-average form has per-loop gain ≈ decay (≈ 0.5 with the same
constant). Buffers went silent in ~120 ms instead of seconds.

A companion bug in the `decayTime()` helper computed `decay²` instead of
the actual loop gain, masking the issue by clamping all buffer lengths down.

### Decision: roll back and re-do incrementally

The combination of "first beat then silence" plus broken synthesis math
made the big-bang change unrecoverable in place. The file was rolled back
to commit `29c3ff3` (Revision-1 working state) and the safe subset was
re-applied one change at a time, verifying audibly after each step.

---

## What was applied: the four-step incremental fix

Each step changes only data values or scalar code paths — no signal-graph
changes, no formula redesign. Easy to bisect if anything went wrong.

### Step 1 — Per-string decay (Tier 1a)

```diff
- const KS_DECAY = 0.4995;
+ const KS_DECAY = [0.49985, 0.49980, 0.49970, 0.49960, 0.49940, 0.49920];
```

- `_getBuffer(freq)` → `_getBuffer(freq, stringIndex)`
- Cache key includes string index: `Math.round(freq * 10) + "_" + stringIndex`
- KS loop reads `decay = KS_DECAY[stringIndex]`
- `play()` passes `i` to `_getBuffer`

**Effect:** bass strings ring ~3+ seconds; treble strings die in ~1.5 s.
Largest realism gain of all four steps.

### Step 2 — Per-string brightness (Tier 1b)

Added `SEED_SMOOTH = [1.00, 0.95, 0.80, 0.65, 0.40, 0.20]`. The seed loop
mixes raw noise with the averaged form per
`smooth = SEED_SMOOTH[stringIndex]`:

```js
const seed = smooth * averaged + (1 - smooth) * noise;
```

At `smooth = 1.0` the math is identical to Revision-1 (so low E is
audibly unchanged). Lower values let more high-frequency energy into the
seed.

**Effect:** plain treble strings get audible zing; bass strings stay warm.

### Step 3 — Per-string gain + stagger jitter (Tier 1c)

```diff
- const STRING_GAIN = 0.16;
+ const STRING_GAIN = [0.18, 0.17, 0.15, 0.15, 0.16, 0.17];
+ const STAGGER_JITTER_S = 0.004;
```

`startTime` is computed once per string and reused for both `src.start()`
and `src.stop()`:

```js
const jitter = (Math.random() - 0.5) * STAGGER_JITTER_S;
const startTime = time + i * STRING_STAGGER_S + jitter;
src.start(startTime);
src.stop(startTime + BUFFER_SECONDS + 0.05);
```

**Effect:** bass and treble project slightly more than mid strings;
successive strums sound less mechanically identical.

### Step 4 — Pick-attack impulse (Tier 2b, safe portion only)

Added `PICK_ATTACK_S = 0.005` and
`PICK_STRENGTH = [0.15, 0.14, 0.12, 0.12, 0.13, 0.15]`. The seed loop
layers a linearly-decaying impulse onto the existing seed:

```js
const attackSamples = Math.floor(sampleRate * PICK_ATTACK_S);
// inside the seed loop:
const impulse = i < attackSamples ? (1 - i / attackSamples) * pick : 0;
data[i] = seed + impulse;
```

**Edge case:** at high E (329 Hz) the seed window (~134 samples) is shorter
than the 5 ms impulse window (~220 samples), so the impulse doesn't fully
decay before the seed ends. Practical effect is slightly more pick attack
on high E — desirable for a plain treble string, so it's left alone.

**Effect:** every note has an audible pluck transient before the KS
resonance takes over. Sounds *struck* rather than *faded in*.

---

## What was deliberately skipped

Three Tier-2/3 items from the original improvement plan were *not* applied
in Revision 2 — they were the source of the big-bang failures and need
re-design before another attempt:

- **Tier 2a — allpass loop filter.** The weighted-average form silently
  halved per-loop gain. To revisit, the decay values must compensate (e.g.,
  decay ≈ 0.999 directly, not 0.5) and the math must be verified
  analytically before coding.
- **Tier 2c — dynamic buffer length.** The `decayTime()` helper used
  `decay²` instead of the actual loop gain. Needs re-derivation.
- **Tier 3 — body resonance + reverb.** Persistent biquads broke audio.
  Any future attempt must route through per-strum biquads only, or use
  non-biquad nodes (gain, convolver) for the persistent portions.

The improvement plan that scoped all of this is at
[`chord-audio-improvement-plan.md`](chord-audio-improvement-plan.md).

---

## Files

| File | What changed in Revision 2 |
|------|----------------------------|
| [`static/js/chord-audio.js`](static/js/chord-audio.js) | Steps 1–4 above. Net +27 / -5 lines vs commit `29c3ff3`. |

No data model, API, or template changes.

---

## How to verify

1. Hard refresh the page, or use DevTools → right-click reload →
   **"Empty Cache and Hard Reload"**. Flask serves `chord-audio.js`
   without cache busting, so a regular refresh may keep the old file.
   Confirm the new file is loaded by searching the Sources panel for the
   string `SEED_SMOOTH`.
2. Set BPM 60, 4/4. Pick chords that exercise different ranges:
   - **G** or **Em** — full low-string ring; verify bass sustain
   - **D** — emphasizes treble strings; verify high-string zing
   - **A** — mid-string heavy; verify clean pick attack
3. Listen for:
   - Bass strings still ringing under the second tick of the next bar
   - High strings already faded by the second tick
   - Audible pick transient at the start of every note
   - Successive bars not sounding mechanically identical
4. Open DevTools Console — should be empty of
   `BiquadFilterNode: state is bad` warnings.

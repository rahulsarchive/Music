# Chord Audio Improvement Plan

## Context

The current `chord-audio.js` uses a basic Karplus-Strong (KS) algorithm to synthesize guitar chord sounds in the browser. It works, but sounds noticeably synthetic because:
- All 6 strings share one decay rate, so bass and treble strings sound equally short-lived
- All strings are seeded with identical noise character — no wound/plain distinction
- No pick transient — strings feel "activated" rather than struck
- Completely dry — no room, no body, no warmth
- Fixed 12 ms strum stagger — metronomic, not human

Goal: acoustic steel-string character, all tiers implemented, mobile-safe (short IR + feature guards).

---

## Critical File

`static/js/chord-audio.js` — the only file that changes. Public API (`new ChordAudio(ctx)`, `.play(time, frets)`) is unchanged.

---

## Implementation Plan

### Tier 1 — Per-String Parameters (~25 lines changed)

Replace scalar constants with per-string arrays (index 0 = low E, 5 = high E).

**1a. Per-string decay** — the single biggest realism jump.

```js
const KS_DECAY = [0.49985, 0.49980, 0.49970, 0.49960, 0.49940, 0.49920];
// Low E sustains 3+ seconds; high E dies in ~1.5 s
```

Cache key becomes `Math.round(freq * 10) + '_' + stringIndex` to avoid collisions. `_getBuffer(freq)` → `_getBuffer(freq, stringIndex)`. Call site in `play()` passes `i`.

**1b. Per-string seed smoothing (brightness)**

```js
const SEED_SMOOTH = [0.65, 0.60, 0.50, 0.45, 0.38, 0.32];
// High value = warmer/rounder (wound bass strings); low = brighter (plain treble strings)
```

In the seed loop: `data[i] = SEED_SMOOTH[si] * noise + (1 - SEED_SMOOTH[si]) * prev;`

**1c. Per-string gain + strum jitter**

```js
const STRING_GAIN = [0.18, 0.17, 0.15, 0.15, 0.16, 0.17];
// Bass and treble strings slightly louder than mid strings

const STAGGER_JITTER_S = 0.004; // ±2 ms random jitter at schedule time
// Applied in play(), not baked into the buffer — safe for lookahead scheduler
const startTime = time + i * STRING_STAGGER_S + (Math.random() - 0.5) * STAGGER_JITTER_S;
```

---

### Tier 2 — Synthesis Improvements (~35 lines)

**2a. Two-point allpass (loop filter tuning)**

Replace the two-tap average in the KS loop with a per-string allpass coefficient that passes slightly more high-partial energy on treble strings:

```js
const KS_ALLPASS = [0.42, 0.43, 0.45, 0.45, 0.47, 0.48];
// Replace:  data[i] = KS_DECAY * (data[i-N] + data[i-N-1]);
// With:     data[i] = KS_DECAY[si] * (C * data[i-N] + (1-C) * data[i-N-1]);
```

Crisper initial attack, slightly more piano-like harmonic texture.

**2b. Pick-attack excitation**

Layer a decaying impulse on the seed to model the pick strike:

```js
const PICK_STRENGTH = [0.15, 0.14, 0.12, 0.12, 0.13, 0.15];
const ATTACK_SAMPLES = Math.floor(sampleRate * 0.005); // 5 ms
// In seed loop:
const impulse = i < ATTACK_SAMPLES ? (1 - i / ATTACK_SAMPLES) * PICK_STRENGTH[si] : 0;
data[i] = smoothed + impulse;
```

Gives each string an audible "pluck" transient at onset before KS resonance takes over.

**2c. Dynamic buffer length per string**

```js
function decayTime(freq, decay, sampleRate) {
  const N = Math.round(sampleRate / freq);
  const loopsPerSec = sampleRate / N;
  const dbPerLoop = 20 * Math.log10(decay * decay);
  return -60 / (dbPerLoop * loopsPerSec);  // seconds to reach -60 dB
}
const bufLen = Math.min(4.0, Math.max(1.5, decayTime(freq, KS_DECAY[si], sampleRate)));
```

Halves memory for treble strings (1.8 s vs 3.5 s). No audible change; cache population is faster.

---

### Tier 3 — Reverb and Body Resonance (~60 lines)

**3a. Algorithmically generated convolution reverb (mobile-safe)**

IR is computed once at construction in an `OfflineAudioContext` — no sample files needed. IR length is capped at 300 ms for mobile safety.

```js
// New constants
const IR_LENGTH_S  = 0.30;   // 300 ms — mobile safe
const IR_DECAY_S   = 0.08;   // RT60-style decay
const DRY_MIX      = 0.80;
const WET_MIX      = 0.22;
```

`_buildIR()` — new async method called from constructor:
1. Create `OfflineAudioContext(2, irLen, sampleRate)`
2. Fill both channels with `noise * exp(-i / (decay_samples))` (exponential decay)
3. Apply a `BiquadFilter` (peaking, 240 Hz, +6 dB, Q=0.9) to the IR for body warmth
4. Render, store as `this.irBuffer`; connect `this.convolver.buffer = this.irBuffer`

`_buildPersistentGraph()` — new sync method called from constructor:
- Creates `this.convolver` (`ConvolverNode`, normalize=false)
- Creates `this.wetGain` (`GainNode`, value = WET_MIX)
- `this.convolver → this.wetGain → ctx.destination`
- Stores both as instance fields for the session lifetime

Mobile guard in `play()`:
```js
// Only connect reverb wet path if IR is ready (async build may not have finished)
if (this.convolver && this.irBuffer) {
  master.connect(this.wetGain);  // dry/wet split at master output
}
```

Also reduce `MASTER_GAIN` from `0.7` → `0.55` to compensate for added reverb energy.

**3b. Body resonance filters**

Two persistent `BiquadFilterNode`s on the master bus, created in `_buildPersistentGraph()`:

```js
// Acoustic guitar body modes: ~95 Hz (top plate), ~210 Hz (air/Helmholtz resonance)
bodyMode1: peaking, 95 Hz,  Q=12, gain=+4.5 dB
bodyMode2: peaking, 210 Hz, Q=8,  gain=+3.0 dB
```

Signal chain:
```
[per-strum] → master → bodyMode1 → bodyMode2 → destination
                     ↘ wetGain → convolver (→ destination, already connected)
```

Notes near 95 Hz and 210 Hz sustain slightly longer and sound fuller — the characteristic acoustic guitar "body bump."

---

## Revised `chord-audio.js` Architecture

```
Constants block (per-string arrays)
│
ChordAudio
├── constructor(audioCtx)
│   ├── this.bufferCache = new Map()
│   ├── this.irBuffer = null
│   ├── _buildPersistentGraph()   ← sync; body filters + convolver wet bus
│   └── _buildIR()                ← async; fills this.irBuffer, connects convolver
│
├── play(time, frets)
│   ├── Create per-strum: filter + master (gain) + dryGain
│   ├── For each string: src + gain → filter → master
│   ├── Routing: master → bodyMode1 → bodyMode2 → destination
│   └── If IR ready: master → wetGain (→ convolver → destination, already wired)
│
├── _getBuffer(freq, stringIndex)
│   ├── Cache key: `${Math.round(freq * 10)}_${stringIndex}`
│   ├── Dynamic buffer length via decayTime()
│   ├── Seed loop: SEED_SMOOTH + PICK_STRENGTH impulse
│   └── KS loop: KS_DECAY[si] + KS_ALLPASS[si]
│
└── _buildPersistentGraph() / _buildIR()
```

---

## Implementation Order

1. **Tier 1 all at once** — `_getBuffer` signature change, per-string arrays, cache key, stagger jitter (one coherent diff)
2. **Tier 2b** — pick attack (modifies seed loop, builds on Tier 1's per-string arrays)
3. **Tier 2a** — allpass (single-line KS loop change)
4. **Tier 2c** — dynamic buffer length (self-contained helper, touches only `_getBuffer`)
5. **Tier 3a** — reverb (new constructor methods, signal chain change in `play()`)
6. **Tier 3b** — body modes (append to `_buildPersistentGraph`, adjust routing in `play()`)

---

## Verification

1. **Start the dev server**, open a practice session
2. **Play a chord** — should hear: distinct pick attack, bass strings ring longer, treble strings decay faster
3. **Compare dry/wet** — comment out `master.connect(this.wetGain)` temporarily to confirm reverb is audible
4. **Test on mobile** (or Chrome DevTools throttled CPU) — confirm no audio glitches; IR guard means the first strum may be dry, subsequent ones wet (300 ms build time)
5. **Muted strings** — verify `null`/`undefined` frets still produce silence, teardown still fires
6. **Chord progression** — play a multi-chord progression to confirm cache accumulates and no pitch collisions between strings

# Guitar Practice Tracker 🎸

A single-user local webapp for tracking guitar practice, building reusable
practice routines, and playing along to a metronome with synthesized chord
audio.

## Run

```
pip install -r requirements.txt
python app.py
```

Then open <http://127.0.0.1:8765> in your browser.

On first run, the SQLite DB at `data/practice.db` is created and seeded with
26 chords, 30 progressions, and a starter chord-category set.

## Features

### Practice

- Pick a single chord or a progression, set BPM (40–240) and time signature
  (4/4, 3/4, 6/8).
- 4-bar horizontal playhead synced to a Web Audio metronome — audio and visual
  are locked to `audioContext.currentTime` so they stay in sync regardless of
  framerate.
- For progressions: configurable bars-per-chord (1, 2, or 4); the chord
  display advances with the beat.
- Add **custom chords** — click positions on the fretboard or type
  `x 3 2 0 1 0` style notation. Frets 0–24 supported.
- Build **custom progressions** — pick chords from the list, drag to reorder,
  set time signature and bars/chord.

### Practice session builder

- Create named, reusable **practice sessions** — ordered lists of items, each
  with its own target (chord or progression), duration, BPM, time signature,
  and bars/chord.
- Each item runs its own per-item timer; the chord overlay updates per bar.
- Check items off as you go; completion state persists in the DB.
- Sessions can be renamed, deleted, and replayed.

### Categories

- Group chords or progressions into custom **categories** (e.g. "open
  chords", "barre", "12-bar variants") for quick filtering in the picker.
- Category membership is many-to-many — a chord can live in several
  categories.

### Sound

Three audio modes; selection persists across reloads via `localStorage`.

- **Tick only** — classic metronome click.
- **Chord only** — Karplus-Strong plucked-string synth strums the current
  chord on the downbeat of every bar. No tick.
- **Both** — tick + chord. Good for ear training.

The synth uses per-string parameters (decay, brightness, pick attack, gain)
so bass strings ring longer and warmer while plain treble strings decay
quicker and brighter. Each strum is staggered ~70 ms across six strings with
±2 ms jitter to feel like a hand sweeping down. See
[`CHORD_AUDIO_FIXES.md`](CHORD_AUDIO_FIXES.md) and
[`CHORD_AUDIO_FIXES_V2.md`](CHORD_AUDIO_FIXES_V2.md) for engine details.

### History & stats

- **GitHub-style heatmap** of the last 365 days (one cell per day, shaded
  by total minutes).
- **Progress chart** — bar chart with days / weeks / months range toggles.
- **Summary metrics**: current streak, longest streak, average minutes per
  day (last 30 days), most active hour of day, this-week total.
- **Sessions list** with date, duration, BPM, target, and optional notes.
- All-sessions modal is paginated (10/page) and supports session delete.
- Per-chord stats: total practice time and last-used BPM, shown in the
  chord picker.

## Database

SQLite at `data/practice.db`. Auto-migrates on every startup via a seed
version system, so existing data is preserved across upgrades.

Core tables:

| Table | Purpose |
|---|---|
| `chord` | Built-in and custom chords (frets + finger positions as JSON) |
| `progression` + `progression_chord` | Ordered chord sequences |
| `chord_category` + `chord_category_member` | Custom chord grouping |
| `progression_category` + `progression_category_member` | Custom progression grouping |
| `session` | Logged practice sessions (timing, BPM, target, notes) |
| `practice_session` + `practice_session_item` | Named reusable routines |

To wipe and start fresh:

```
del data\practice.db   # Windows
rm data/practice.db    # Mac/Linux
python app.py
```

## Project layout

```
app.py                       # Flask app: routes, models, seed/migration
seed.py                      # Initial data: chords, progressions, categories
templates/index.html         # Single-page UI (modal-driven)
static/js/
  app.js                     # Boot — wires all modules
  practice.js                # Practice flow, picker, mode toggle
  metronome.js               # Web Audio scheduler + playhead SVG
  chord-audio.js             # Karplus-Strong synth (see CHORD_AUDIO_FIXES*.md)
  chord-diagram.js           # Fretboard SVG rendering
  chord-builder.js           # Custom chord editor
  progression-builder.js     # Drag-reorder progression sequencer
  practice-session-builder.js  # Named-routine CRUD and item runner
  history.js                 # Heatmap, progress chart, metrics, sessions list
static/css/                  # Single light theme
data/practice.db             # SQLite (auto-created)
```

## Notes

- Single-user, runs locally — no auth, no multi-tenancy.
- No external network calls. All audio is synthesized in-browser, all data
  stays on disk.
- Hard-refresh (`Ctrl + Shift + R`) after pulling JS changes — Flask's
  default static handler doesn't cache-bust.

# Guitar Practice Tracker 🎸

A single-user local webapp for tracking guitar practice sessions and practicing along to a metronome.

## Run

```
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:8765 in your browser.

On first run, the SQLite DB at `data/practice.db` is created and seeded with 26 chords, 30 progressions, and a full 16-module beginner curriculum.

## Features

### Practice
- Pick a chord or progression, set BPM (40–240) and time signature (4/4, 3/4, 6/8).
- 4-bar horizontal playhead synced to Web Audio metronome — audio and visual are locked together.
- For progressions: configurable bars-per-chord (1, 2, or 4); chord display auto-advances with the beat.
- Add custom chords — click positions on the fretboard or type `x 3 2 0 1 0` style notation.
- Build custom progressions — select chords from the list, drag to reorder, set time sig and bars/chord.

### Sound modes
- **Tick only** — classic metronome click.
- **Chord only** — Karplus-Strong plucked-string synth strums the current chord on every downbeat. No tick.
- **Both** — tick + chord together. Great for ear training.
- Mode persists across sessions via localStorage.

### Routines (Justin Guitar–inspired curriculum)
- **Grade 1 + Grade 2** with ~16 modules and ~70 exercises.
- Each card shows target chord/progression, BPM, duration, and time signature.
- Click **Start** → practice area auto-configured and metronome starts immediately.
- Completion checkboxes persist in the DB. Module and grade progress bars update live.
- _Note_: inspired by Justin Guitar's free beginner course at [justinguitar.com/beginner](https://www.justinguitar.com/beginner). Exact lesson transcripts are not reproduced — treat this as a structured practice guide in the spirit of his method.

### History
- GitHub-style calendar heatmap of the last 365 days.
- Recent sessions list with date, duration, BPM, target, and optional notes.
- Sticky header shows "this week" minutes and current practice streak.

## Database

SQLite at `data/practice.db`. Auto-migrates on every startup via a seed version system:
- **v1** (first boot on fresh DB): 26 chords + 7 progressions.
- **v2** (always checked on boot): +23 progressions (1-minute change drills + classic songs) + 16 routine modules with ~70 exercises.

To wipe and start fresh:
```
del data\practice.db   # Windows
rm data/practice.db    # Mac/Linux
python app.py
```

# Guitar Practice Tracker

A single-user local webapp for tracking guitar practice sessions and practicing along to a metronome.

## Run

```
pip install -r requirements.txt
python app.py
```

Then open http://127.0.0.1:8765 in your browser.

On first run, the SQLite DB at `data/practice.db` is created and seeded with ~25 chords and a handful of pop/folk + classic rock progressions.

## Features

- Pick a chord or progression, set BPM (40–240) and time signature (4/4, 3/4, 6/8).
- 4-bar horizontal playhead synced to Web Audio metronome clicks.
- For progressions: configurable bars-per-chord (1, 2, or 4); auto-advances with the beat.
- Add custom chords — click positions on the fretboard or type `x 3 2 0 1 0` style notation.
- All practice sessions logged with duration, BPM, target, and optional notes.
- Landing page shows GitHub-style heatmap of the last year plus recent sessions.

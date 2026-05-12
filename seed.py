"""Seed default chords and progressions into the SQLite DB.

Run automatically the first time `app.py` is launched if the DB is empty.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

# Each chord: (display_name, frets, fingers)
# Order: low E, A, D, G, B, high E.  null = muted, 0 = open.
CHORDS: list[tuple[str, list, list]] = [
    ("C",       [None, 3, 2, 0, 1, 0],     [None, 3, 2, None, 1, None]),
    ("D",       [None, None, 0, 2, 3, 2],  [None, None, None, 1, 3, 2]),
    ("E",       [0, 2, 2, 1, 0, 0],        [None, 2, 3, 1, None, None]),
    ("G",       [3, 2, 0, 0, 0, 3],        [3, 2, None, None, None, 4]),
    ("A",       [None, 0, 2, 2, 2, 0],     [None, None, 1, 2, 3, None]),
    ("Am",      [None, 0, 2, 2, 1, 0],     [None, None, 2, 3, 1, None]),
    ("Dm",      [None, None, 0, 2, 3, 1],  [None, None, None, 2, 3, 1]),
    ("Em",      [0, 2, 2, 0, 0, 0],        [None, 2, 3, None, None, None]),
    ("A7",      [None, 0, 2, 0, 2, 0],     [None, None, 1, None, 2, None]),
    ("B7",      [None, 2, 1, 2, 0, 2],     [None, 2, 1, 3, None, 4]),
    ("C7",      [None, 3, 2, 3, 1, 0],     [None, 3, 2, 4, 1, None]),
    ("D7",      [None, None, 0, 2, 1, 2],  [None, None, None, 2, 1, 3]),
    ("E7",      [0, 2, 0, 1, 0, 0],        [None, 2, None, 1, None, None]),
    ("G7",      [3, 2, 0, 0, 0, 1],        [3, 2, None, None, None, 1]),
    ("Cmaj7",   [None, 3, 2, 0, 0, 0],     [None, 3, 2, None, None, None]),
    ("Dmaj7",   [None, None, 0, 2, 2, 2],  [None, None, None, 1, 1, 1]),
    ("Em7",     [0, 2, 0, 0, 0, 0],        [None, 2, None, None, None, None]),
    ("Am7",     [None, 0, 2, 0, 1, 0],     [None, None, 2, None, 1, None]),
    ("Dm7",     [None, None, 0, 2, 1, 1],  [None, None, None, 2, 1, 1]),
    ("F",       [1, 3, 3, 2, 1, 1],        [1, 3, 4, 2, 1, 1]),
    ("Bm",      [None, 2, 4, 4, 3, 2],     [None, 1, 3, 4, 2, 1]),
    ("B",       [None, 2, 4, 4, 4, 2],     [None, 1, 2, 3, 4, 1]),
    ("Dsus4",   [None, None, 0, 2, 3, 3],  [None, None, None, 1, 2, 3]),
    ("Asus2",   [None, 0, 2, 2, 0, 0],     [None, None, 1, 2, None, None]),
    ("Cadd9",   [None, 3, 2, 0, 3, 0],     [None, 2, 1, None, 3, None]),
    ("A7sus4",  [None, 0, 2, 0, 3, 0],     [None, None, 1, None, 3, None]),
]

# Each progression: (name, time_signature, bars_per_chord, [chord display_names])
PROGRESSIONS: list[tuple[str, str, int, list[str]]] = [
    ("I-V-vi-IV in C (C-G-Am-F)",  "4/4", 1, ["C", "G", "Am", "F"]),
    ("I-IV-V in G (G-C-D)",        "4/4", 1, ["G", "C", "D"]),
    ("vi-IV-I-V (Am-F-C-G)",       "4/4", 1, ["Am", "F", "C", "G"]),
    ("50s progression (C-Am-F-G)", "4/4", 1, ["C", "Am", "F", "G"]),
    ("House of the Rising Sun",    "4/4", 1, ["Am", "C", "D", "F", "Am", "C", "E", "E"]),
    ("Knockin' on Heaven's Door",  "4/4", 2, ["G", "D", "Am", "Am", "G", "D", "C", "C"]),
    ("Wonderwall verse",           "4/4", 1, ["Em7", "G", "Dsus4", "A7sus4"]),
]


def seed(db_path: Path) -> None:
    """Populate chord/progression tables. Idempotent — skips if already seeded."""
    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        existing = conn.execute("SELECT 1 FROM chord LIMIT 1").fetchone()
        if existing:
            return

        chord_ids: dict[str, int] = {}
        for display_name, frets, fingers in CHORDS:
            cur = conn.execute(
                "INSERT INTO chord (name, display_name, frets, fingers, is_custom) "
                "VALUES (?, ?, ?, ?, 0)",
                (display_name, display_name, json.dumps(frets), json.dumps(fingers)),
            )
            chord_ids[display_name] = cur.lastrowid

        for name, ts, bpc, chord_names in PROGRESSIONS:
            cur = conn.execute(
                "INSERT INTO progression (name, time_signature, bars_per_chord, is_custom) "
                "VALUES (?, ?, ?, 0)",
                (name, ts, bpc),
            )
            pid = cur.lastrowid
            for pos, cn in enumerate(chord_names):
                if cn not in chord_ids:
                    raise RuntimeError(f"Progression {name!r} references unknown chord {cn!r}")
                conn.execute(
                    "INSERT INTO progression_chord (progression_id, position, chord_id) "
                    "VALUES (?, ?, ?)",
                    (pid, pos, chord_ids[cn]),
                )

        conn.commit()


if __name__ == "__main__":
    from app import DB_PATH, init_db
    init_db()
    seed(DB_PATH)
    print(f"Seeded {DB_PATH}")

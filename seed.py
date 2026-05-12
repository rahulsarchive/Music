"""Seed default chords, progressions, and routines into the SQLite DB.

seed_v1: 26 chords + 7 progressions. Inserted only when chord table is empty.
seed_v2: extra progressions + Justin Guitar-inspired routines (Grade 1 + 2).
         Idempotent — guarded by meta.seed_version.

Both run on every app startup via app.ensure_seeded().
"""
from __future__ import annotations

import json
import sqlite3

# ----------------------------------------------------------------------------
# v1 data
# ----------------------------------------------------------------------------

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
PROGRESSIONS_V1: list[tuple[str, str, int, list[str]]] = [
    ("I-V-vi-IV in C (C-G-Am-F)",  "4/4", 1, ["C", "G", "Am", "F"]),
    ("I-IV-V in G (G-C-D)",        "4/4", 1, ["G", "C", "D"]),
    ("vi-IV-I-V (Am-F-C-G)",       "4/4", 1, ["Am", "F", "C", "G"]),
    ("50s progression (C-Am-F-G)", "4/4", 1, ["C", "Am", "F", "G"]),
    ("House of the Rising Sun",    "4/4", 1, ["Am", "C", "D", "F", "Am", "C", "E", "E"]),
    ("Knockin' on Heaven's Door",  "4/4", 2, ["G", "D", "Am", "Am", "G", "D", "C", "C"]),
    ("Wonderwall verse",           "4/4", 1, ["Em7", "G", "Dsus4", "A7sus4"]),
]


# ----------------------------------------------------------------------------
# v2 data
# ----------------------------------------------------------------------------

# Additional progressions added in v2.
PROGRESSIONS_V2: list[tuple[str, str, int, list[str]]] = [
    # One-minute change drills (Justin Guitar's signature exercise)
    ("Change drill: A <-> D",       "4/4", 1, ["A", "D"]),
    ("Change drill: A <-> E",       "4/4", 1, ["A", "E"]),
    ("Change drill: D <-> E",       "4/4", 1, ["D", "E"]),
    ("Change drill: Em <-> Am",     "4/4", 1, ["Em", "Am"]),
    ("Change drill: Am <-> E",      "4/4", 1, ["Am", "E"]),
    ("Change drill: C <-> G",       "4/4", 1, ["C", "G"]),
    ("Change drill: G <-> Em",      "4/4", 1, ["G", "Em"]),
    ("Change drill: C <-> Am",      "4/4", 1, ["C", "Am"]),
    ("Change drill: D <-> G",       "4/4", 1, ["D", "G"]),
    ("Change drill: D <-> Em",      "4/4", 1, ["D", "Em"]),
    ("Change drill: Am <-> Dm",     "4/4", 1, ["Am", "Dm"]),
    ("Change drill: C <-> F",       "4/4", 1, ["C", "F"]),
    # Songs and classic progressions
    ("Three Little Birds (A-D-A-E)",   "4/4", 1, ["A", "D", "A", "E"]),
    ("Zombie (Em-C-G-D)",              "4/4", 1, ["Em", "C", "G", "D"]),
    ("With or Without You (D-A-Bm-G)", "4/4", 1, ["D", "A", "Bm", "G"]),
    ("Let It Be (C-G-Am-F)",           "4/4", 1, ["C", "G", "Am", "F"]),
    ("Stand By Me (C-Am-F-G)",         "4/4", 2, ["C", "Am", "F", "G"]),
    ("Sweet Home Alabama (D-Cadd9-G)", "4/4", 1, ["D", "Cadd9", "G"]),
    ("12-bar blues in E",              "4/4", 1,
        ["E", "E", "E", "E", "A", "A", "E", "E", "B7", "A", "E", "B7"]),
    ("12-bar blues in A",              "4/4", 1,
        ["A", "A", "A", "A", "D", "D", "A", "A", "E", "D", "A", "E"]),
    ("Doo-wop in G (G-Em-C-D)",        "4/4", 1, ["G", "Em", "C", "D"]),
    ("ii-V-I in C (Dm-G-C-C)",         "4/4", 1, ["Dm", "G", "C", "C"]),
]


# Routines: list of modules. Each module: dict with grade, title, description,
# exercises. Each exercise:
#   (title, instructions, target_type, target_name,
#    bpm, duration_seconds, time_signature, bars_per_chord)
# target_type is 'chord', 'progression', or None.
# target_name is looked up at seed time; None means reference-only.
ROUTINES: list[dict] = [
    # --- Grade 1 ---
    {
        "grade": 1, "title": "Module 0: Before You Begin",
        "description": "Guitar basics — how to hold and tune the instrument before you start playing.",
        "exercises": [
            ("Tuning your guitar", "Use a clip-on tuner or phone app. Tune low to high: E A D G B E.",
             None, None, 80, 120, "4/4", 1),
            ("Holding the guitar", "Sit with the guitar on your right leg, neck slightly raised.",
             None, None, 80, 60, "4/4", 1),
            ("Holding the pick", "Grip lightly between thumb and curled index finger.",
             None, None, 80, 60, "4/4", 1),
            ("Reading chord boxes", "6 vertical lines = strings (low E left). Horizontal lines = frets.",
             None, None, 80, 60, "4/4", 1),
            ("Reading TAB", "6 horizontal lines = strings (high E top). Numbers = fret to press.",
             None, None, 80, 60, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 1: First Steps (A & D)",
        "description": "Your first two chords and your first chord change.",
        "exercises": [
            ("Practice the A chord",
             "Three fingers in the 2nd fret. Press near the fret wire. Strum 5 strings (mute low E).",
             "chord", "A", 60, 60, "4/4", 1),
            ("Practice the D chord",
             "Triangle shape on strings 1-3. Strum 4 strings.",
             "chord", "D", 60, 60, "4/4", 1),
            ("One-minute change: A <-> D",
             "Count how many clean changes you make in 60 seconds. Beat your score each session.",
             "progression", "Change drill: A <-> D", 60, 60, "4/4", 1),
            ("First song in A and D",
             "Three Little Birds uses A, D, and E. Start by playing A and D only.",
             "progression", "Three Little Birds (A-D-A-E)", 70, 180, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 2: 8 Essential Beginner Chord Grips",
        "description": "Lock in the eight open chords every beginner needs: A, D, E, Em, Am, Dm, D7, G.",
        "exercises": [
            ("Practice A",   "Three fingers cramped in fret 2. Curl them so you don't mute strings.",
             "chord", "A", 65, 60, "4/4", 1),
            ("Practice D",   "Push fingers right up against the frets for a clean tone.",
             "chord", "D", 65, 60, "4/4", 1),
            ("Practice E",   "All three fingers in fret 1 and 2. Strum all six strings.",
             "chord", "E", 65, 60, "4/4", 1),
            ("Practice Em",  "Easiest open chord: two fingers in fret 2 on strings A and D.",
             "chord", "Em", 65, 60, "4/4", 1),
            ("Practice Am",  "Same shape as E, shifted one string up.",
             "chord", "Am", 65, 60, "4/4", 1),
            ("Practice Dm",  "Mute low E and A. Three fingers form a triangle on strings 1-3.",
             "chord", "Dm", 65, 60, "4/4", 1),
            ("Practice D7",  "Like D, but the index moves to the high E string.",
             "chord", "D7", 65, 60, "4/4", 1),
            ("Practice G",   "The big stretch chord. Use fingers 2-3-4 to keep finger 1 free.",
             "chord", "G", 65, 60, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 3: Capo, Minor Chords & Up Strums",
        "description": "Understand minor chords, get one-minute changes between them, and learn the capo.",
        "exercises": [
            ("Practice Em",
             "Two fingers, sounds sad. Strum all six strings.",
             "chord", "Em", 65, 60, "4/4", 1),
            ("Practice Am",
             "Three fingers, classic 'sad chord' grip.",
             "chord", "Am", 65, 60, "4/4", 1),
            ("One-minute change: Em <-> Am",
             "Pivot on the index finger - it doesn't move between the two chords.",
             "progression", "Change drill: Em <-> Am", 60, 90, "4/4", 1),
            ("What are minor chords?",
             "Minor = sad/sombre. Major = bright/happy. The difference is one note (the third).",
             None, None, 80, 60, "4/4", 1),
            ("Using a capo",
             "A capo raises the pitch of every string. Same shapes, different key.",
             None, None, 80, 60, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 4: Metronome, Stretches & THE Strumming Pattern",
        "description": "Add Dm to your kit and start strumming along with a steady pulse.",
        "exercises": [
            ("Practice Dm",
             "Same triangle as D, but the high E is fretted at 1 with the index.",
             "chord", "Dm", 60, 60, "4/4", 1),
            ("One-minute change: Am <-> Dm",
             "Both use fingers 1, 2, 3. Try to lift and place all three together.",
             "progression", "Change drill: Am <-> Dm", 60, 60, "4/4", 1),
            ("Stretches for guitarists",
             "Wrist rolls, finger fans, and forearm stretches before and after practice.",
             None, None, 80, 60, "4/4", 1),
            ("Strum 'Old Faithful' over Let It Be",
             "D - DU - UDU per bar. Keep your hand moving even when you don't strum.",
             "progression", "Let It Be (C-G-Am-F)", 70, 240, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 5: More Chords (C and G7)",
        "description": "C is the trickiest open chord; G7 is your gateway to country and blues.",
        "exercises": [
            ("Practice C",
             "Three fingers spread across three frets. Curl your fingers to avoid muting.",
             "chord", "C", 60, 60, "4/4", 1),
            ("Practice G7",
             "Like G with the high E played at fret 1 instead of fret 3.",
             "chord", "G7", 60, 60, "4/4", 1),
            ("One-minute change: C <-> G",
             "Anchor the ring finger on the A string fret 3 (it stays put for both shapes).",
             "progression", "Change drill: C <-> G", 60, 60, "4/4", 1),
            ("One-minute change: C <-> Am",
             "Top two fingers don't move - just lift the third finger off.",
             "progression", "Change drill: C <-> Am", 60, 60, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 6: Time Signatures & 6/8 Strumming",
        "description": "Step outside 4/4: feel a waltz in 3/4 and a slow ballad in 6/8.",
        "exercises": [
            ("Knockin' in 3/4",
             "Same chords, three beats per bar. Counts 'one-two-three'.",
             "progression", "Knockin' on Heaven's Door", 90, 180, "3/4", 2),
            ("Knockin' in 6/8",
             "Six pulses per bar grouped in two. Counts 'ONE-two-three-FOUR-five-six'.",
             "progression", "Knockin' on Heaven's Door", 80, 240, "6/8", 2),
            ("What is a time signature?",
             "Top number = beats per bar. Bottom number = which note value gets one beat.",
             None, None, 80, 60, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 7: Strumming Mechanics, Dynamics, Up Strums",
        "description": "Stop being a robot - add accents, ghost strums, and groove.",
        "exercises": [
            ("Strum I-V-vi-IV in C",
             "Keep your strumming hand moving constantly. Loud on beat 1, soft on the rest.",
             "progression", "I-V-vi-IV in C (C-G-Am-F)", 80, 240, "4/4", 1),
            ("Strum the 50s progression",
             "Try a slow eighth-note strum and emphasize beats 2 and 4 like a snare.",
             "progression", "50s progression (C-Am-F-G)", 90, 180, "4/4", 1),
            ("Strumming mechanics",
             "Strum from the wrist, not the elbow. Loose grip on the pick.",
             None, None, 80, 60, "4/4", 1),
            ("Dynamics and accents",
             "Hit some strums harder than others - that's where the groove lives.",
             None, None, 80, 60, "4/4", 1),
        ],
    },
    {
        "grade": 1, "title": "Module 8: How to PASS Grade 1",
        "description": "Three song-form tests. If you can play these cleanly in time, you've passed Grade 1.",
        "exercises": [
            ("Play Three Little Birds",
             "Smooth A-D-A-E loop with no pauses.",
             "progression", "Three Little Birds (A-D-A-E)", 90, 240, "4/4", 1),
            ("Play Knockin' on Heaven's Door",
             "Two bars per chord. Hold each chord steady - no rushing the change.",
             "progression", "Knockin' on Heaven's Door", 80, 300, "4/4", 2),
            ("Play Zombie",
             "Em-C-G-D loop. The classic 90s alt-rock progression.",
             "progression", "Zombie (Em-C-G-D)", 90, 300, "4/4", 1),
        ],
    },
    # --- Grade 2 ---
    {
        "grade": 2, "title": "Module 9: The F Chord",
        "description": "The dreaded F. Tackle the full barre or one of the easier 3-string voicings.",
        "exercises": [
            ("Practice F",
             "Index finger barres strings 1 and 2 at fret 1. Keep the thumb behind the neck.",
             "chord", "F", 60, 90, "4/4", 1),
            ("One-minute change: C <-> F",
             "The hardest beginner change. Move three fingers together as one shape.",
             "progression", "Change drill: C <-> F", 50, 120, "4/4", 1),
            ("Play Let It Be",
             "C - G - Am - F. Now you can play it properly with the F.",
             "progression", "Let It Be (C-G-Am-F)", 75, 240, "4/4", 1),
        ],
    },
    {
        "grade": 2, "title": "Module 10: Fingerpicking Basics",
        "description": "Put the pick down. Thumb plays bass, fingers play melody.",
        "exercises": [
            ("Travis picking primer",
             "Thumb alternates between two bass strings. Fingers fill in on top.",
             None, None, 80, 60, "4/4", 1),
            ("Fingerpick Em7",
             "Easiest chord to start with - only two fingers on the fretboard.",
             "chord", "Em7", 70, 120, "4/4", 1),
            ("Fingerpick the Wonderwall verse",
             "Pick instead of strum. Same chords, totally different mood.",
             "progression", "Wonderwall verse", 80, 240, "4/4", 1),
        ],
    },
    {
        "grade": 2, "title": "Module 11: Major Scale & Improvisation",
        "description": "Your first scale, your first solo.",
        "exercises": [
            ("G major scale, shape 1",
             "Two octaves starting on the low E string. Memorize the pattern.",
             None, None, 80, 120, "4/4", 1),
            ("Finding root notes",
             "Every chord has a root. Find the root of each chord on the low E string.",
             None, None, 80, 60, "4/4", 1),
            ("Improvise over I-IV-V in G",
             "Use the G major scale. Aim for the root note when each chord changes.",
             "progression", "I-IV-V in G (G-C-D)", 90, 300, "4/4", 1),
        ],
    },
    {
        "grade": 2, "title": "Module 12: Power Chords & Palm Muting",
        "description": "Two-finger chords that work everywhere. Add palm muting and you have rock.",
        "exercises": [
            ("Power chord shapes",
             "Root + 5th. Two notes, movable, sounds great with distortion.",
             None, None, 80, 60, "4/4", 1),
            ("Strum 12-bar blues in E",
             "Use E5, A5, B5 power chords. Strict downstrokes for the rock feel.",
             "progression", "12-bar blues in E", 100, 240, "4/4", 1),
            ("Palm-muting technique",
             "Rest the side of your strumming-hand palm on the strings near the bridge.",
             None, None, 80, 60, "4/4", 1),
        ],
    },
    {
        "grade": 2, "title": "Module 13: 7th Chord Grips & Blues",
        "description": "Dominant 7ths - the sound of the blues.",
        "exercises": [
            ("Practice A7", "Like A, but lift the ring finger off.",
             "chord", "A7", 65, 60, "4/4", 1),
            ("Practice D7", "Triangular shape, but the high E moves to fret 2.",
             "chord", "D7", 65, 60, "4/4", 1),
            ("Practice E7", "Like E, but lift the ring finger off.",
             "chord", "E7", 65, 60, "4/4", 1),
            ("Play 12-bar blues in A",
             "The classic 12-bar form. A7 - D7 - E7. The shuffle.",
             "progression", "12-bar blues in A", 90, 240, "4/4", 1),
            ("Play 12-bar blues in E",
             "Same form, different key. Use E7, A7, B7.",
             "progression", "12-bar blues in E", 90, 240, "4/4", 1),
        ],
    },
    {
        "grade": 2, "title": "Module 14: Slash Chords",
        "description": "Chord/bass. C/G means a C chord with G in the bass.",
        "exercises": [
            ("What are slash chords?",
             "The letter after the slash is the bass note. Used for smooth bass lines.",
             None, None, 80, 60, "4/4", 1),
            ("D/F# concept",
             "D chord with F# (low E string, fret 2) in the bass. Wrap your thumb over.",
             None, None, 80, 60, "4/4", 1),
            ("Strum Sweet Home Alabama",
             "D - Cadd9 - G is the signature riff. Sounds great with picking too.",
             "progression", "Sweet Home Alabama (D-Cadd9-G)", 100, 240, "4/4", 1),
        ],
    },
    {
        "grade": 2, "title": "Module 15: How to PASS Grade 2",
        "description": "Three big tests. Cleanly played, in time, no stops.",
        "exercises": [
            ("Play With or Without You",
             "Four-chord loop, simple but exposing - any timing wobble is obvious.",
             "progression", "With or Without You (D-A-Bm-G)", 90, 300, "4/4", 1),
            ("Play Let It Be",
             "Including the F. No skipping or substituting easier chords.",
             "progression", "Let It Be (C-G-Am-F)", 75, 300, "4/4", 1),
            ("12-bar blues at speed",
             "Blues in A at 110 bpm. The shuffle should feel locked in.",
             "progression", "12-bar blues in A", 110, 300, "4/4", 1),
        ],
    },
]


# ----------------------------------------------------------------------------
# Seeding
# ----------------------------------------------------------------------------

def _chord_ids(conn: sqlite3.Connection) -> dict[str, int]:
    return {r["display_name"]: r["id"] for r in conn.execute(
        "SELECT id, display_name FROM chord"
    ).fetchall()}


def _progression_ids(conn: sqlite3.Connection) -> dict[str, int]:
    return {r["name"]: r["id"] for r in conn.execute(
        "SELECT id, name FROM progression"
    ).fetchall()}


def _insert_progression(conn: sqlite3.Connection, name: str, ts: str, bpc: int,
                        chord_names: list[str], chord_ids: dict[str, int]) -> int:
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
    return pid


def seed_v1(conn: sqlite3.Connection) -> None:
    """Insert original 26 chords + 7 progressions on a fresh DB."""
    conn.row_factory = sqlite3.Row
    if conn.execute("SELECT 1 FROM chord LIMIT 1").fetchone():
        return

    for display_name, frets, fingers in CHORDS:
        conn.execute(
            "INSERT INTO chord (name, display_name, frets, fingers, is_custom) "
            "VALUES (?, ?, ?, ?, 0)",
            (display_name, display_name, json.dumps(frets), json.dumps(fingers)),
        )

    chord_ids = _chord_ids(conn)
    for name, ts, bpc, chord_names in PROGRESSIONS_V1:
        _insert_progression(conn, name, ts, bpc, chord_names, chord_ids)


def seed_v2(conn: sqlite3.Connection) -> None:
    """Insert v2 progressions + routines. Idempotent."""
    conn.row_factory = sqlite3.Row
    version_row = conn.execute(
        "SELECT value FROM meta WHERE key='seed_version'"
    ).fetchone()
    current = int(version_row["value"]) if version_row else 0
    if current >= 2:
        return

    chord_ids = _chord_ids(conn)
    prog_ids = _progression_ids(conn)

    # Insert progressions whose names aren't already taken.
    for name, ts, bpc, chord_names in PROGRESSIONS_V2:
        if name in prog_ids:
            continue
        pid = _insert_progression(conn, name, ts, bpc, chord_names, chord_ids)
        prog_ids[name] = pid

    # Insert routines. If routine_module table is empty, populate fully.
    has_modules = conn.execute("SELECT 1 FROM routine_module LIMIT 1").fetchone()
    if not has_modules:
        for mpos, mod in enumerate(ROUTINES):
            cur = conn.execute(
                "INSERT INTO routine_module (grade, position, title, description) "
                "VALUES (?, ?, ?, ?)",
                (mod["grade"], mpos, mod["title"], mod.get("description") or ""),
            )
            mid = cur.lastrowid
            for epos, ex in enumerate(mod["exercises"]):
                title, instructions, t_type, t_name, bpm, dur, ts, bpc = ex
                target_id = None
                if t_type == "chord":
                    target_id = chord_ids.get(t_name)
                    if target_id is None:
                        raise RuntimeError(
                            f"Routine {mod['title']!r} exercise {title!r} "
                            f"references unknown chord {t_name!r}"
                        )
                elif t_type == "progression":
                    target_id = prog_ids.get(t_name)
                    if target_id is None:
                        raise RuntimeError(
                            f"Routine {mod['title']!r} exercise {title!r} "
                            f"references unknown progression {t_name!r}"
                        )
                conn.execute(
                    "INSERT INTO routine_exercise "
                    "(module_id, position, title, instructions, target_type, target_id, "
                    " default_bpm, default_duration_seconds, "
                    " default_time_signature, default_bars_per_chord) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (mid, epos, title, instructions, t_type, target_id,
                     bpm, dur, ts, bpc),
                )

    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('seed_version', '2') "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value"
    )


# Back-compat shim for any old callers.
def seed(db_path) -> None:
    """Legacy single-shot seed function."""
    from contextlib import closing as _closing
    with _closing(sqlite3.connect(db_path)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        seed_v1(conn)
        seed_v2(conn)
        conn.commit()


if __name__ == "__main__":
    from app import DB_PATH, init_db
    init_db()
    seed(DB_PATH)
    print(f"Seeded {DB_PATH}")

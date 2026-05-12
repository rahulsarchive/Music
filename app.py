"""Guitar Practice Tracker — Flask backend.

Single-user local server. Bind to 127.0.0.1 only.
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "data" / "practice.db"

app = Flask(__name__)


# ---------- DB helpers ----------

def get_db() -> sqlite3.Connection:
    if "db" not in g:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS chord (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                frets TEXT NOT NULL,
                fingers TEXT NOT NULL,
                is_custom INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS progression (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                time_signature TEXT NOT NULL DEFAULT '4/4',
                bars_per_chord INTEGER NOT NULL DEFAULT 1,
                is_custom INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS progression_chord (
                progression_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                chord_id INTEGER NOT NULL,
                PRIMARY KEY (progression_id, position),
                FOREIGN KEY (progression_id) REFERENCES progression(id) ON DELETE CASCADE,
                FOREIGN KEY (chord_id) REFERENCES chord(id)
            );

            CREATE TABLE IF NOT EXISTS session (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at TEXT NOT NULL,
                ended_at TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                bpm INTEGER NOT NULL,
                time_signature TEXT NOT NULL,
                bars_per_chord INTEGER NOT NULL DEFAULT 1,
                target_type TEXT NOT NULL,
                target_id INTEGER NOT NULL,
                notes TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_session_started ON session(started_at);

            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS routine_module (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                grade INTEGER NOT NULL,
                position INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT
            );

            CREATE TABLE IF NOT EXISTS routine_exercise (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                title TEXT NOT NULL,
                instructions TEXT,
                target_type TEXT,
                target_id INTEGER,
                default_bpm INTEGER NOT NULL DEFAULT 80,
                default_duration_seconds INTEGER NOT NULL DEFAULT 60,
                default_time_signature TEXT NOT NULL DEFAULT '4/4',
                default_bars_per_chord INTEGER NOT NULL DEFAULT 1,
                completed_at TEXT,
                FOREIGN KEY (module_id) REFERENCES routine_module(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_re_module ON routine_exercise(module_id);
            """
        )
        conn.commit()


def _row_to_chord(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "display_name": row["display_name"],
        "frets": json.loads(row["frets"]),
        "fingers": json.loads(row["fingers"]),
        "is_custom": bool(row["is_custom"]),
    }


# ---------- Routes ----------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/chords", methods=["GET"])
def list_chords():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM chord ORDER BY is_custom, display_name COLLATE NOCASE"
    ).fetchall()
    return jsonify([_row_to_chord(r) for r in rows])


@app.route("/api/chords", methods=["POST"])
def create_chord():
    data = request.get_json(force=True)
    display_name = (data.get("display_name") or "").strip()
    frets = data.get("frets")
    fingers = data.get("fingers") or [None] * 6

    if not display_name:
        return jsonify({"error": "display_name required"}), 400
    if not isinstance(frets, list) or len(frets) != 6:
        return jsonify({"error": "frets must be 6-element list"}), 400
    for f in frets:
        if f is not None and (not isinstance(f, int) or f < 0 or f > 24):
            return jsonify({"error": "fret values must be null or int 0..24"}), 400
    if not isinstance(fingers, list) or len(fingers) != 6:
        return jsonify({"error": "fingers must be 6-element list"}), 400

    db = get_db()
    # Build a unique internal name even if display_name collides.
    base = f"{display_name}_custom"
    suffix = 1
    name = f"{base}_{suffix}"
    while db.execute("SELECT 1 FROM chord WHERE name=?", (name,)).fetchone():
        suffix += 1
        name = f"{base}_{suffix}"

    cur = db.execute(
        "INSERT INTO chord (name, display_name, frets, fingers, is_custom) VALUES (?, ?, ?, ?, 1)",
        (name, display_name, json.dumps(frets), json.dumps(fingers)),
    )
    db.commit()
    row = db.execute("SELECT * FROM chord WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(_row_to_chord(row)), 201


@app.route("/api/chords/<int:chord_id>", methods=["DELETE"])
def delete_chord(chord_id: int):
    db = get_db()
    row = db.execute("SELECT is_custom FROM chord WHERE id=?", (chord_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    if not row["is_custom"]:
        return jsonify({"error": "cannot delete seed chord"}), 400
    # Don't delete if referenced by any progression
    ref = db.execute(
        "SELECT 1 FROM progression_chord WHERE chord_id=? LIMIT 1", (chord_id,)
    ).fetchone()
    if ref:
        return jsonify({"error": "chord is used by a progression"}), 400
    db.execute("DELETE FROM chord WHERE id=?", (chord_id,))
    db.commit()
    return ("", 204)


@app.route("/api/progressions", methods=["GET"])
def list_progressions():
    db = get_db()
    progs = db.execute(
        "SELECT * FROM progression ORDER BY is_custom, name COLLATE NOCASE"
    ).fetchall()
    result = []
    for p in progs:
        chord_rows = db.execute(
            """
            SELECT c.* FROM progression_chord pc
            JOIN chord c ON c.id = pc.chord_id
            WHERE pc.progression_id = ?
            ORDER BY pc.position
            """,
            (p["id"],),
        ).fetchall()
        result.append(
            {
                "id": p["id"],
                "name": p["name"],
                "time_signature": p["time_signature"],
                "bars_per_chord": p["bars_per_chord"],
                "is_custom": bool(p["is_custom"]),
                "chords": [_row_to_chord(c) for c in chord_rows],
            }
        )
    return jsonify(result)


@app.route("/api/progressions", methods=["POST"])
def create_progression():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    chord_ids = data.get("chord_ids")
    if not name or not isinstance(chord_ids, list) or not chord_ids:
        return jsonify({"error": "name and chord_ids required"}), 400

    time_signature = data.get("time_signature") or "4/4"
    if time_signature not in ("4/4", "3/4", "6/8"):
        return jsonify({"error": "time_signature must be 4/4, 3/4, or 6/8"}), 400
    try:
        bars_per_chord = int(data.get("bars_per_chord", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "bars_per_chord must be an integer"}), 400
    if bars_per_chord not in (1, 2, 4):
        return jsonify({"error": "bars_per_chord must be 1, 2, or 4"}), 400

    db = get_db()
    cur = db.execute(
        "INSERT INTO progression (name, time_signature, bars_per_chord, is_custom) "
        "VALUES (?, ?, ?, 1)",
        (name, time_signature, bars_per_chord),
    )
    pid = cur.lastrowid
    for pos, cid in enumerate(chord_ids):
        db.execute(
            "INSERT INTO progression_chord (progression_id, position, chord_id) VALUES (?, ?, ?)",
            (pid, pos, int(cid)),
        )
    db.commit()
    return jsonify({"id": pid}), 201


@app.route("/api/progressions/<int:prog_id>", methods=["DELETE"])
def delete_progression(prog_id: int):
    db = get_db()
    row = db.execute(
        "SELECT is_custom FROM progression WHERE id=?", (prog_id,)
    ).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    if not row["is_custom"]:
        return jsonify({"error": "cannot delete seed progression"}), 400
    ref = db.execute(
        "SELECT 1 FROM session WHERE target_type='progression' AND target_id=? LIMIT 1",
        (prog_id,),
    ).fetchone()
    if ref:
        return jsonify({"error": "progression has logged sessions"}), 400
    # progression_chord rows cascade-delete via FK.
    db.execute("DELETE FROM progression WHERE id=?", (prog_id,))
    db.commit()
    return ("", 204)


@app.route("/api/routines", methods=["GET"])
def list_routines():
    db = get_db()
    modules = db.execute(
        "SELECT * FROM routine_module ORDER BY grade, position"
    ).fetchall()
    result = []
    for m in modules:
        exercises = db.execute(
            """
            SELECT e.*,
                   CASE e.target_type
                       WHEN 'chord' THEN (SELECT display_name FROM chord WHERE id=e.target_id)
                       WHEN 'progression' THEN (SELECT name FROM progression WHERE id=e.target_id)
                   END AS target_name
            FROM routine_exercise e
            WHERE e.module_id = ?
            ORDER BY e.position
            """,
            (m["id"],),
        ).fetchall()
        result.append({
            "id": m["id"],
            "grade": m["grade"],
            "position": m["position"],
            "title": m["title"],
            "description": m["description"],
            "exercises": [dict(e) for e in exercises],
        })
    return jsonify(result)


@app.route("/api/routines/exercises/<int:ex_id>/complete", methods=["POST"])
def set_exercise_completed(ex_id: int):
    data = request.get_json(force=True)
    completed = bool(data.get("completed", True))
    db = get_db()
    row = db.execute("SELECT 1 FROM routine_exercise WHERE id=?", (ex_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    if completed:
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE routine_exercise SET completed_at=? WHERE id=?", (now, ex_id)
        )
    else:
        db.execute(
            "UPDATE routine_exercise SET completed_at=NULL WHERE id=?", (ex_id,)
        )
    db.commit()
    updated = db.execute(
        "SELECT id, completed_at FROM routine_exercise WHERE id=?", (ex_id,)
    ).fetchone()
    return jsonify({"id": updated["id"], "completed_at": updated["completed_at"]})


@app.route("/api/sessions", methods=["GET"])
def list_sessions():
    limit = min(int(request.args.get("limit", 50)), 500)
    db = get_db()
    rows = db.execute(
        """
        SELECT s.*,
               CASE s.target_type
                   WHEN 'chord' THEN (SELECT display_name FROM chord WHERE id=s.target_id)
                   WHEN 'progression' THEN (SELECT name FROM progression WHERE id=s.target_id)
               END AS target_name
        FROM session s
        ORDER BY s.started_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/sessions", methods=["POST"])
def create_session():
    data = request.get_json(force=True)
    required = ["started_at", "ended_at", "duration_seconds", "bpm",
                "time_signature", "target_type", "target_id"]
    for k in required:
        if k not in data:
            return jsonify({"error": f"{k} required"}), 400
    if data["target_type"] not in ("chord", "progression"):
        return jsonify({"error": "target_type must be 'chord' or 'progression'"}), 400

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO session
            (started_at, ended_at, duration_seconds, bpm, time_signature,
             bars_per_chord, target_type, target_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["started_at"],
            data["ended_at"],
            int(data["duration_seconds"]),
            int(data["bpm"]),
            data["time_signature"],
            int(data.get("bars_per_chord", 1)),
            data["target_type"],
            int(data["target_id"]),
            data.get("notes") or None,
        ),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/stats/heatmap", methods=["GET"])
def heatmap():
    days = min(int(request.args.get("days", 365)), 1000)
    db = get_db()
    rows = db.execute(
        """
        SELECT date(started_at) AS d, SUM(duration_seconds) AS total
        FROM session
        WHERE started_at >= date('now', ?)
        GROUP BY date(started_at)
        """,
        (f"-{days} days",),
    ).fetchall()
    return jsonify([{"date": r["d"], "total_seconds": r["total"]} for r in rows])


@app.route("/api/stats/summary", methods=["GET"])
def summary():
    db = get_db()
    # Total minutes this week (since Monday) and current streak.
    week_total = db.execute(
        "SELECT COALESCE(SUM(duration_seconds), 0) AS s FROM session "
        "WHERE date(started_at) >= date('now', 'weekday 0', '-6 days')"
    ).fetchone()["s"]

    # Streak: count consecutive days back from today with any session.
    days = db.execute(
        "SELECT DISTINCT date(started_at) AS d FROM session ORDER BY d DESC"
    ).fetchall()
    streak = 0
    today = datetime.now(timezone.utc).date()
    from datetime import timedelta
    cursor = today
    day_set = {row["d"] for row in days}
    # If no session today, the streak counts from yesterday backwards.
    if cursor.isoformat() not in day_set:
        cursor = cursor - timedelta(days=1)
    while cursor.isoformat() in day_set:
        streak += 1
        cursor = cursor - timedelta(days=1)

    return jsonify({"week_seconds": int(week_total), "streak_days": streak})


def ensure_seeded() -> None:
    init_db()
    # Lazy import so seed.py can import app.DB_PATH back if needed.
    from seed import seed_v1, seed_v2
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        seed_v1(conn)
        seed_v2(conn)
        conn.commit()


if __name__ == "__main__":
    ensure_seeded()
    # 127.0.0.1 only — single-user local app.
    app.run(host="127.0.0.1", port=8765, debug=False)

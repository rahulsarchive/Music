"""Guitar Practice Tracker — Flask backend.

Single-user local server. Bind to 127.0.0.1 only.
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from datetime import date as date_cls, datetime, timedelta, timezone
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

            CREATE TABLE IF NOT EXISTS chord_category (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS chord_category_member (
                category_id INTEGER NOT NULL,
                chord_id INTEGER NOT NULL,
                PRIMARY KEY (category_id, chord_id),
                FOREIGN KEY (category_id) REFERENCES chord_category(id) ON DELETE CASCADE,
                FOREIGN KEY (chord_id) REFERENCES chord(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS progression_category (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS progression_category_member (
                category_id INTEGER NOT NULL,
                progression_id INTEGER NOT NULL,
                PRIMARY KEY (category_id, progression_id),
                FOREIGN KEY (category_id) REFERENCES progression_category(id) ON DELETE CASCADE,
                FOREIGN KEY (progression_id) REFERENCES progression(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS practice_session (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS practice_session_item (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                target_type TEXT NOT NULL,
                target_id INTEGER NOT NULL,
                duration_seconds INTEGER NOT NULL DEFAULT 120,
                bpm INTEGER NOT NULL DEFAULT 80,
                time_signature TEXT NOT NULL DEFAULT '4/4',
                bars_per_chord INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY (session_id) REFERENCES practice_session(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_psi_session ON practice_session_item(session_id);
            """
        )
        # Migrations
        psi_cols = [r[1] for r in conn.execute("PRAGMA table_info(practice_session_item)").fetchall()]
        if "completed_at" not in psi_cols:
            conn.execute("ALTER TABLE practice_session_item ADD COLUMN completed_at TEXT")
        if "ramp_start_bpm" not in psi_cols:
            conn.execute("ALTER TABLE practice_session_item ADD COLUMN ramp_start_bpm INTEGER")
        if "ramp_end_bpm" not in psi_cols:
            conn.execute("ALTER TABLE practice_session_item ADD COLUMN ramp_end_bpm INTEGER")
        if "ramp_curve" not in psi_cols:
            conn.execute("ALTER TABLE practice_session_item ADD COLUMN ramp_curve TEXT")

        sess_cols = [r[1] for r in conn.execute("PRAGMA table_info(session)").fetchall()]
        if "accuracy" not in sess_cols:
            conn.execute("ALTER TABLE session ADD COLUMN accuracy REAL")

        ps_cols = [r[1] for r in conn.execute("PRAGMA table_info(practice_session)").fetchall()]
        if "target_minutes" not in ps_cols:
            conn.execute("ALTER TABLE practice_session ADD COLUMN target_minutes INTEGER")
        if "streak_days" not in ps_cols:
            conn.execute("ALTER TABLE practice_session ADD COLUMN streak_days INTEGER DEFAULT 0")
        if "last_completed_at" not in ps_cols:
            conn.execute("ALTER TABLE practice_session ADD COLUMN last_completed_at TEXT")
        conn.commit()


def _row_to_chord(row: sqlite3.Row) -> dict:
    d = {
        "id": row["id"],
        "name": row["name"],
        "display_name": row["display_name"],
        "frets": json.loads(row["frets"]),
        "fingers": json.loads(row["fingers"]),
        "is_custom": bool(row["is_custom"]),
    }
    keys = list(row.keys())
    if "total_practice_seconds" in keys:
        d["total_practice_seconds"] = row["total_practice_seconds"] or 0
    if "last_bpm" in keys:
        d["last_bpm"] = row["last_bpm"]
    if "sessions_count" in keys:
        d["sessions_count"] = row["sessions_count"] or 0
    if "last_practiced_at" in keys:
        d["last_practiced_at"] = row["last_practiced_at"]
    if "accuracy_30d" in keys:
        d["accuracy_30d"] = row["accuracy_30d"]
    if "bpm_trend_raw" in keys:
        raw = row["bpm_trend_raw"]
        if raw:
            vals = [int(x) for x in str(raw).split(",")]
            vals.reverse()
            d["bpm_trend"] = vals
        else:
            d["bpm_trend"] = []
    return d


# ---------- Routes ----------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/chords", methods=["GET"])
def list_chords():
    db = get_db()
    rows = db.execute(
        """
        SELECT c.*,
               COALESCE(SUM(s.duration_seconds), 0) AS total_practice_seconds,
               COUNT(s.id) AS sessions_count,
               MAX(s.started_at) AS last_practiced_at,
               AVG(CASE WHEN s.started_at >= datetime('now', '-30 days')
                        AND s.accuracy IS NOT NULL THEN s.accuracy END) AS accuracy_30d,
               (SELECT s2.bpm FROM session s2
                WHERE s2.target_type='chord' AND s2.target_id=c.id
                ORDER BY s2.started_at DESC LIMIT 1) AS last_bpm,
               (SELECT GROUP_CONCAT(bpm_val) FROM (
                   SELECT bpm AS bpm_val FROM session s3
                   WHERE s3.target_type='chord' AND s3.target_id=c.id
                   ORDER BY s3.started_at DESC LIMIT 10
               ) t) AS bpm_trend_raw
        FROM chord c
        LEFT JOIN session s ON s.target_type='chord' AND s.target_id=c.id
        GROUP BY c.id
        ORDER BY c.is_custom, c.display_name COLLATE NOCASE
        """
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
    row = db.execute(
        """
        SELECT c.*, 0 AS total_practice_seconds, NULL AS last_bpm
        FROM chord c WHERE c.id=?
        """,
        (cur.lastrowid,)
    ).fetchone()
    return jsonify(_row_to_chord(row)), 201


@app.route("/api/chords/<int:chord_id>", methods=["DELETE"])
def delete_chord(chord_id: int):
    db = get_db()
    row = db.execute("SELECT 1 FROM chord WHERE id=?", (chord_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    ref = db.execute(
        "SELECT 1 FROM progression_chord WHERE chord_id=? LIMIT 1", (chord_id,)
    ).fetchone()
    if ref:
        return jsonify({"error": "chord is used by a progression — remove it from the progression first"}), 400
    db.execute("DELETE FROM chord WHERE id=?", (chord_id,))
    db.commit()
    return ("", 204)


@app.route("/api/progressions", methods=["GET"])
def list_progressions():
    db = get_db()
    progs = db.execute(
        """
        SELECT p.*,
               COALESCE(SUM(s.duration_seconds), 0) AS total_practice_seconds,
               COUNT(s.id) AS sessions_count,
               MAX(s.started_at) AS last_practiced_at,
               (SELECT s2.bpm FROM session s2
                WHERE s2.target_type='progression' AND s2.target_id=p.id
                ORDER BY s2.started_at DESC LIMIT 1) AS last_bpm,
               (SELECT GROUP_CONCAT(bpm_val) FROM (
                   SELECT bpm AS bpm_val FROM session s3
                   WHERE s3.target_type='progression' AND s3.target_id=p.id
                   ORDER BY s3.started_at DESC LIMIT 10
               ) t) AS bpm_trend_raw
        FROM progression p
        LEFT JOIN session s ON s.target_type='progression' AND s.target_id=p.id
        GROUP BY p.id
        ORDER BY p.is_custom, p.name COLLATE NOCASE
        """
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
        raw = p["bpm_trend_raw"]
        bpm_trend: list = []
        if raw:
            vals = [int(x) for x in str(raw).split(",")]
            vals.reverse()
            bpm_trend = vals
        result.append(
            {
                "id": p["id"],
                "name": p["name"],
                "time_signature": p["time_signature"],
                "bars_per_chord": p["bars_per_chord"],
                "is_custom": bool(p["is_custom"]),
                "chords": [_row_to_chord(c) for c in chord_rows],
                "total_practice_seconds": p["total_practice_seconds"] or 0,
                "sessions_count": p["sessions_count"] or 0,
                "last_practiced_at": p["last_practiced_at"],
                "last_bpm": p["last_bpm"],
                "bpm_trend": bpm_trend,
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
        "SELECT 1 FROM progression WHERE id=?", (prog_id,)
    ).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    ref = db.execute(
        "SELECT 1 FROM session WHERE target_type='progression' AND target_id=? LIMIT 1",
        (prog_id,),
    ).fetchone()
    if ref:
        return jsonify({"error": "progression has logged sessions"}), 400
    db.execute("DELETE FROM progression WHERE id=?", (prog_id,))
    db.commit()
    return ("", 204)


# ---------- Chord Categories ----------

@app.route("/api/chord-categories", methods=["GET"])
def list_chord_categories():
    db = get_db()
    cats = db.execute("SELECT * FROM chord_category ORDER BY name").fetchall()
    result = []
    for c in cats:
        chord_ids = db.execute(
            "SELECT chord_id FROM chord_category_member WHERE category_id=?",
            (c["id"],)
        ).fetchall()
        result.append({
            "id": c["id"],
            "name": c["name"],
            "chord_ids": [r["chord_id"] for r in chord_ids]
        })
    return jsonify(result)


@app.route("/api/chord-categories", methods=["POST"])
def create_chord_category():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    db = get_db()
    try:
        cur = db.execute("INSERT INTO chord_category (name) VALUES (?)", (name,))
        db.commit()
        return jsonify({"id": cur.lastrowid, "name": name, "chord_ids": []}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "category already exists"}), 409


@app.route("/api/chord-categories/<int:cat_id>", methods=["DELETE"])
def delete_chord_category(cat_id: int):
    db = get_db()
    row = db.execute("SELECT 1 FROM chord_category WHERE id=?", (cat_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    db.execute("DELETE FROM chord_category WHERE id=?", (cat_id,))
    db.commit()
    return ("", 204)


@app.route("/api/chord-categories/<int:cat_id>/chords", methods=["POST"])
def add_chord_to_category(cat_id: int):
    data = request.get_json(force=True)
    chord_id = data.get("chord_id")
    if not chord_id:
        return jsonify({"error": "chord_id required"}), 400
    db = get_db()
    if not db.execute("SELECT 1 FROM chord_category WHERE id=?", (cat_id,)).fetchone():
        return jsonify({"error": "category not found"}), 404
    if not db.execute("SELECT 1 FROM chord WHERE id=?", (int(chord_id),)).fetchone():
        return jsonify({"error": "chord not found"}), 404
    try:
        db.execute(
            "INSERT INTO chord_category_member (category_id, chord_id) VALUES (?, ?)",
            (cat_id, int(chord_id))
        )
        db.commit()
    except sqlite3.IntegrityError:
        pass
    return ("", 204)


@app.route("/api/chord-categories/<int:cat_id>/chords/<int:chord_id>", methods=["DELETE"])
def remove_chord_from_category(cat_id: int, chord_id: int):
    db = get_db()
    db.execute(
        "DELETE FROM chord_category_member WHERE category_id=? AND chord_id=?",
        (cat_id, chord_id)
    )
    db.commit()
    return ("", 204)


# ---------- Progression Categories ----------

@app.route("/api/progression-categories", methods=["GET"])
def list_progression_categories():
    db = get_db()
    cats = db.execute("SELECT * FROM progression_category ORDER BY name").fetchall()
    result = []
    for c in cats:
        prog_ids = db.execute(
            "SELECT progression_id FROM progression_category_member WHERE category_id=?",
            (c["id"],)
        ).fetchall()
        result.append({
            "id": c["id"],
            "name": c["name"],
            "progression_ids": [r["progression_id"] for r in prog_ids]
        })
    return jsonify(result)


@app.route("/api/progression-categories", methods=["POST"])
def create_progression_category():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    db = get_db()
    try:
        cur = db.execute("INSERT INTO progression_category (name) VALUES (?)", (name,))
        db.commit()
        return jsonify({"id": cur.lastrowid, "name": name, "progression_ids": []}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "category already exists"}), 409


@app.route("/api/progression-categories/<int:cat_id>", methods=["DELETE"])
def delete_progression_category(cat_id: int):
    db = get_db()
    row = db.execute("SELECT 1 FROM progression_category WHERE id=?", (cat_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    db.execute("DELETE FROM progression_category WHERE id=?", (cat_id,))
    db.commit()
    return ("", 204)


@app.route("/api/progression-categories/<int:cat_id>/progressions", methods=["POST"])
def add_progression_to_category(cat_id: int):
    data = request.get_json(force=True)
    prog_id = data.get("progression_id")
    if not prog_id:
        return jsonify({"error": "progression_id required"}), 400
    db = get_db()
    if not db.execute("SELECT 1 FROM progression_category WHERE id=?", (cat_id,)).fetchone():
        return jsonify({"error": "category not found"}), 404
    if not db.execute("SELECT 1 FROM progression WHERE id=?", (int(prog_id),)).fetchone():
        return jsonify({"error": "progression not found"}), 404
    try:
        db.execute(
            "INSERT INTO progression_category_member (category_id, progression_id) VALUES (?, ?)",
            (cat_id, int(prog_id))
        )
        db.commit()
    except sqlite3.IntegrityError:
        pass
    return ("", 204)


@app.route("/api/progression-categories/<int:cat_id>/progressions/<int:prog_id>", methods=["DELETE"])
def remove_progression_from_category(cat_id: int, prog_id: int):
    db = get_db()
    db.execute(
        "DELETE FROM progression_category_member WHERE category_id=? AND progression_id=?",
        (cat_id, prog_id)
    )
    db.commit()
    return ("", 204)


# ---------- Practice Sessions ----------

@app.route("/api/practice-sessions", methods=["GET"])
def list_practice_sessions():
    db = get_db()
    today_str = datetime.now(timezone.utc).date().isoformat()
    sessions = db.execute(
        "SELECT * FROM practice_session ORDER BY created_at DESC"
    ).fetchall()
    result = []
    for s in sessions:
        items = db.execute(
            """
            SELECT psi.*,
                   CASE psi.target_type
                       WHEN 'chord' THEN (SELECT display_name FROM chord WHERE id=psi.target_id)
                       WHEN 'progression' THEN (SELECT name FROM progression WHERE id=psi.target_id)
                   END AS target_name
            FROM practice_session_item psi
            WHERE psi.session_id = ?
            ORDER BY psi.position
            """,
            (s["id"],),
        ).fetchall()
        items_list = [dict(i) for i in items]
        total_today = sum(
            i["duration_seconds"]
            for i in items_list
            if i.get("completed_at") and i["completed_at"].startswith(today_str)
        )
        result.append({
            "id": s["id"],
            "name": s["name"],
            "created_at": s["created_at"],
            "target_minutes": s["target_minutes"],
            "streak_days": s["streak_days"] or 0,
            "last_completed_at": s["last_completed_at"],
            "total_done_seconds_today": total_today,
            "items": items_list,
        })
    return jsonify(result)


@app.route("/api/practice-sessions", methods=["POST"])
def create_practice_session():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    cur = db.execute(
        "INSERT INTO practice_session (name, created_at) VALUES (?, ?)",
        (name, now)
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "name": name, "created_at": now, "items": []}), 201


@app.route("/api/practice-sessions/<int:session_id>", methods=["PATCH"])
def update_practice_session(session_id: int):
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    db = get_db()
    if not db.execute("SELECT 1 FROM practice_session WHERE id=?", (session_id,)).fetchone():
        return jsonify({"error": "not found"}), 404

    target_minutes = data.get("target_minutes")
    if target_minutes is not None:
        try:
            target_minutes = int(target_minutes)
        except (TypeError, ValueError):
            return jsonify({"error": "target_minutes must be an integer"}), 400

    db.execute(
        "UPDATE practice_session SET name=?, target_minutes=? WHERE id=?",
        (name, target_minutes, session_id),
    )
    db.commit()
    return jsonify({"id": session_id, "name": name, "target_minutes": target_minutes})


@app.route("/api/practice-sessions/<int:session_id>", methods=["DELETE"])
def delete_practice_session(session_id: int):
    db = get_db()
    if not db.execute("SELECT 1 FROM practice_session WHERE id=?", (session_id,)).fetchone():
        return jsonify({"error": "not found"}), 404
    db.execute("DELETE FROM practice_session WHERE id=?", (session_id,))
    db.commit()
    return ("", 204)


@app.route("/api/practice-sessions/<int:session_id>/items", methods=["POST"])
def add_practice_session_item(session_id: int):
    data = request.get_json(force=True)
    target_type = data.get("target_type")
    target_id = data.get("target_id")
    if target_type not in ("chord", "progression"):
        return jsonify({"error": "target_type must be chord or progression"}), 400
    if not target_id:
        return jsonify({"error": "target_id required"}), 400

    db = get_db()
    if not db.execute("SELECT 1 FROM practice_session WHERE id=?", (session_id,)).fetchone():
        return jsonify({"error": "session not found"}), 404

    pos_row = db.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM practice_session_item WHERE session_id=?",
        (session_id,)
    ).fetchone()
    position = pos_row["next_pos"]

    try:
        duration_seconds = int(data.get("duration_seconds", 120))
        bpm = int(data.get("bpm", 80))
        bars_per_chord = int(data.get("bars_per_chord", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "invalid numeric value"}), 400

    time_signature = data.get("time_signature", "4/4")
    if time_signature not in ("4/4", "3/4", "6/8"):
        return jsonify({"error": "invalid time_signature"}), 400

    ramp_start_bpm = data.get("ramp_start_bpm")
    ramp_end_bpm = data.get("ramp_end_bpm")
    ramp_curve = data.get("ramp_curve")
    if ramp_start_bpm is not None:
        try:
            ramp_start_bpm = int(ramp_start_bpm)
            ramp_end_bpm = int(ramp_end_bpm) if ramp_end_bpm is not None else ramp_start_bpm
        except (TypeError, ValueError):
            return jsonify({"error": "ramp bpm values must be integers"}), 400
    if ramp_curve is not None and ramp_curve not in ("linear", "step"):
        return jsonify({"error": "ramp_curve must be 'linear' or 'step'"}), 400

    cur = db.execute(
        """
        INSERT INTO practice_session_item
            (session_id, position, target_type, target_id, duration_seconds, bpm,
             time_signature, bars_per_chord, ramp_start_bpm, ramp_end_bpm, ramp_curve)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (session_id, position, target_type, int(target_id), duration_seconds, bpm,
         time_signature, bars_per_chord, ramp_start_bpm, ramp_end_bpm, ramp_curve),
    )
    db.commit()

    item = db.execute(
        """
        SELECT psi.*,
               CASE psi.target_type
                   WHEN 'chord' THEN (SELECT display_name FROM chord WHERE id=psi.target_id)
                   WHEN 'progression' THEN (SELECT name FROM progression WHERE id=psi.target_id)
               END AS target_name
        FROM practice_session_item psi
        WHERE psi.id = ?
        """,
        (cur.lastrowid,)
    ).fetchone()
    return jsonify(dict(item)), 201


@app.route("/api/practice-sessions/<int:session_id>/items/<int:item_id>", methods=["DELETE"])
def delete_practice_session_item(session_id: int, item_id: int):
    db = get_db()
    if not db.execute(
        "SELECT 1 FROM practice_session_item WHERE id=? AND session_id=?",
        (item_id, session_id)
    ).fetchone():
        return jsonify({"error": "not found"}), 404
    db.execute("DELETE FROM practice_session_item WHERE id=?", (item_id,))
    db.commit()
    return ("", 204)


@app.route("/api/practice-sessions/<int:session_id>/items/<int:item_id>/complete", methods=["POST"])
def set_practice_item_completed(session_id: int, item_id: int):
    data = request.get_json(force=True) or {}
    completed = bool(data.get("completed", True))
    db = get_db()
    row = db.execute(
        "SELECT 1 FROM practice_session_item WHERE id=? AND session_id=?",
        (item_id, session_id)
    ).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    if completed:
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            "UPDATE practice_session_item SET completed_at=? WHERE id=?",
            (now, item_id)
        )
    else:
        db.execute(
            "UPDATE practice_session_item SET completed_at=NULL WHERE id=?",
            (item_id,)
        )
    db.commit()
    updated = db.execute(
        "SELECT id, completed_at FROM practice_session_item WHERE id=?", (item_id,)
    ).fetchone()
    return jsonify({"id": updated["id"], "completed_at": updated["completed_at"]})


# ---------- Routines (kept for backward compat, not shown in UI) ----------

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


# ---------- Sessions ----------

@app.route("/api/sessions", methods=["GET"])
def list_sessions():
    limit = min(int(request.args.get("limit", 50)), 1000)
    offset = max(int(request.args.get("offset", 0)), 0)
    db = get_db()
    total = db.execute("SELECT COUNT(*) AS n FROM session").fetchone()["n"]
    rows = db.execute(
        """
        SELECT s.*,
               CASE s.target_type
                   WHEN 'chord' THEN (SELECT display_name FROM chord WHERE id=s.target_id)
                   WHEN 'progression' THEN (SELECT name FROM progression WHERE id=s.target_id)
               END AS target_name
        FROM session s
        ORDER BY s.started_at DESC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    ).fetchall()
    return jsonify({"items": [dict(r) for r in rows], "total": total})


@app.route("/api/sessions/<int:session_id>", methods=["DELETE"])
def delete_session(session_id: int):
    db = get_db()
    row = db.execute("SELECT 1 FROM session WHERE id=?", (session_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    db.execute("DELETE FROM session WHERE id=?", (session_id,))
    db.commit()
    return ("", 204)


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

    accuracy = None
    if data.get("accuracy") is not None:
        try:
            accuracy = float(data["accuracy"])
            if not (0.0 <= accuracy <= 1.0):
                return jsonify({"error": "accuracy must be between 0.0 and 1.0"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "accuracy must be a number"}), 400

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO session
            (started_at, ended_at, duration_seconds, bpm, time_signature,
             bars_per_chord, target_type, target_id, notes, accuracy)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            accuracy,
        ),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid}), 201


# ---------- Stats ----------

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


@app.route("/api/stats/progress", methods=["GET"])
def progress_stats():
    range_type = request.args.get("range", "days")
    db = get_db()
    today = datetime.now(timezone.utc).date()

    if range_type == "days":
        count = min(int(request.args.get("count", 14)), 90)
        periods = [(today - timedelta(days=i)) for i in range(count - 1, -1, -1)]
        rows = db.execute(
            """
            SELECT date(started_at) AS d, SUM(duration_seconds) AS total_seconds
            FROM session WHERE date(started_at) >= ? GROUP BY d
            """,
            (periods[0].isoformat(),),
        ).fetchall()
        by_key = {r["d"]: r["total_seconds"] for r in rows}
        return jsonify([
            {"label": f"{d.day} {d.strftime('%b')}", "total_seconds": by_key.get(d.isoformat(), 0)}
            for d in periods
        ])

    elif range_type == "weeks":
        days_since_monday = today.weekday()
        current_monday = today - timedelta(days=days_since_monday)
        week_starts = [(current_monday - timedelta(weeks=i)) for i in range(9, -1, -1)]
        rows = db.execute(
            """
            SELECT date(started_at) AS d, SUM(duration_seconds) AS total_seconds
            FROM session WHERE date(started_at) >= ? GROUP BY d
            """,
            (week_starts[0].isoformat(),),
        ).fetchall()
        by_date = {r["d"]: r["total_seconds"] for r in rows}
        return jsonify([
            {
                "label": ws.strftime("%b %d"),
                "total_seconds": sum(
                    by_date.get((ws + timedelta(days=j)).isoformat(), 0) for j in range(7)
                ),
            }
            for ws in week_starts
        ])

    elif range_type == "months":
        year, month = today.year, today.month
        months = []
        for _ in range(10):
            months.append((year, month))
            month -= 1
            if month == 0:
                month = 12
                year -= 1
        months.reverse()
        rows = db.execute(
            """
            SELECT strftime('%Y-%m', started_at) AS ym, SUM(duration_seconds) AS total_seconds
            FROM session WHERE date(started_at) >= ? GROUP BY ym
            """,
            (date_cls(months[0][0], months[0][1], 1).isoformat(),),
        ).fetchall()
        by_month = {r["ym"]: r["total_seconds"] for r in rows}
        return jsonify([
            {
                "label": datetime(y, m, 1).strftime("%b '%y"),
                "total_seconds": by_month.get(f"{y:04d}-{m:02d}", 0),
            }
            for y, m in months
        ])

    return jsonify([])


@app.route("/api/stats/summary", methods=["GET"])
def summary():
    db = get_db()
    today = datetime.now(timezone.utc).date()

    week_total = db.execute(
        "SELECT COALESCE(SUM(duration_seconds), 0) AS s FROM session "
        "WHERE date(started_at) >= date('now', 'weekday 0', '-6 days')"
    ).fetchone()["s"]

    day_rows = db.execute(
        "SELECT DISTINCT date(started_at) AS d FROM session ORDER BY d"
    ).fetchall()
    day_set = {row["d"] for row in day_rows}
    sorted_days = sorted(day_set)

    streak = 0
    cursor = today
    if cursor.isoformat() not in day_set:
        cursor = cursor - timedelta(days=1)
    while cursor.isoformat() in day_set:
        streak += 1
        cursor = cursor - timedelta(days=1)

    longest = 0
    if sorted_days:
        run = 1
        for i in range(1, len(sorted_days)):
            prev = datetime.strptime(sorted_days[i - 1], "%Y-%m-%d").date()
            curr = datetime.strptime(sorted_days[i], "%Y-%m-%d").date()
            if (curr - prev).days == 1:
                run += 1
            else:
                longest = max(longest, run)
                run = 1
        longest = max(longest, run)

    avg_row = db.execute(
        "SELECT COALESCE(SUM(duration_seconds), 0) AS total FROM session "
        "WHERE date(started_at) >= date('now', '-29 days')"
    ).fetchone()
    avg_min_per_day = round(avg_row["total"] / 30 / 60, 1)

    hour_row = db.execute(
        """
        SELECT CAST(strftime('%H', started_at) AS INTEGER) AS hour, COUNT(*) AS cnt
        FROM session GROUP BY hour ORDER BY cnt DESC LIMIT 1
        """
    ).fetchone()
    most_active_hour = int(hour_row["hour"]) if hour_row else None

    return jsonify({
        "week_seconds": int(week_total),
        "streak_days": streak,
        "longest_streak": longest,
        "avg_min_per_day": avg_min_per_day,
        "most_active_hour": most_active_hour,
    })


@app.route("/api/chords/<int:chord_id>/trend", methods=["GET"])
def chord_trend(chord_id: int):
    limit = min(int(request.args.get("limit", 10)), 100)
    db = get_db()
    if not db.execute("SELECT 1 FROM chord WHERE id=?", (chord_id,)).fetchone():
        return jsonify({"error": "not found"}), 404
    rows = db.execute(
        """
        SELECT bpm, accuracy FROM session
        WHERE target_type='chord' AND target_id=?
        ORDER BY started_at DESC LIMIT ?
        """,
        (chord_id, limit),
    ).fetchall()
    rows = list(reversed(rows))
    return jsonify({
        "bpm": [r["bpm"] for r in rows],
        "accuracy": [r["accuracy"] for r in rows],
    })


@app.route("/api/plan/today", methods=["GET"])
def plan_today():
    db = get_db()
    today = datetime.now(timezone.utc).date()
    cutoff_30d = (today - timedelta(days=30)).isoformat()
    cutoff_7d = (today - timedelta(days=7)).isoformat()

    rows = db.execute(
        """
        SELECT c.id, c.display_name,
               COALESCE(SUM(s.duration_seconds), 0) AS total_practice_seconds,
               MAX(s.started_at) AS last_practiced_at,
               AVG(CASE WHEN s.started_at >= ? AND s.accuracy IS NOT NULL
                        THEN s.accuracy END) AS accuracy_30d,
               (SELECT s2.bpm FROM session s2
                WHERE s2.target_type='chord' AND s2.target_id=c.id
                ORDER BY s2.started_at DESC LIMIT 1) AS last_bpm,
               (SELECT s3.bpm FROM session s3
                WHERE s3.target_type='chord' AND s3.target_id=c.id
                  AND s3.started_at <= ?
                ORDER BY s3.started_at DESC LIMIT 1) AS bpm_7d_ago
        FROM chord c
        LEFT JOIN session s ON s.target_type='chord' AND s.target_id=c.id
        GROUP BY c.id
        """,
        (cutoff_30d, cutoff_7d),
    ).fetchall()

    if not rows:
        return jsonify([])

    chords_scored = []
    for r in rows:
        last = r["last_practiced_at"]
        if last:
            try:
                last_date = datetime.fromisoformat(last.replace("Z", "+00:00")).date()
                days_since = (today - last_date).days
            except (ValueError, AttributeError):
                days_since = 999
        else:
            days_since = 999
        accuracy = r["accuracy_30d"] if r["accuracy_30d"] is not None else 0.75
        current_bpm = r["last_bpm"] or 0
        old_bpm = r["bpm_7d_ago"] or 0
        bpm_plateau = bool(current_bpm and current_bpm == old_bpm)
        score = days_since * 2 + (1 - accuracy) * 50 + (10 if bpm_plateau else 0)
        chords_scored.append({
            "id": r["id"],
            "display_name": r["display_name"],
            "score": score,
            "accuracy": accuracy,
            "days_since": days_since,
            "bpm_plateau": bpm_plateau,
        })

    chords_scored.sort(key=lambda x: -x["score"])
    by_accuracy = sorted(chords_scored, key=lambda x: x["accuracy"])
    by_days = sorted(chords_scored, key=lambda x: -x["days_since"])

    seen: set = set()
    items = []

    for chord, urgency, reason in [
        (by_accuracy[0], "high", "Lowest accuracy · last 30d"),
        (by_days[0], "high",
         f"Not practiced in {by_days[0]['days_since']}d"
         if by_days[0]["days_since"] < 999 else "Never practiced"),
    ]:
        if chord["id"] not in seen:
            seen.add(chord["id"])
            items.append({
                "kind": "chord",
                "target_id": chord["id"],
                "target_name": chord["display_name"],
                "reason": reason,
                "urgency": urgency,
                "goal_min": 3,
            })

    for chord in chords_scored:
        if chord["bpm_plateau"] and chord["id"] not in seen and len(items) < 4:
            seen.add(chord["id"])
            items.append({
                "kind": "chord",
                "target_id": chord["id"],
                "target_name": chord["display_name"],
                "reason": "BPM plateau · no progress in 7d",
                "urgency": "med",
                "goal_min": 3,
            })

    for chord in chords_scored:
        if len(items) >= 3:
            break
        if chord["id"] not in seen:
            seen.add(chord["id"])
            items.append({
                "kind": "chord",
                "target_id": chord["id"],
                "target_name": chord["display_name"],
                "reason": "Needs attention",
                "urgency": "med",
                "goal_min": 3,
            })

    # 1 progression suggestion — prefer one containing a high-urgency chord
    prog_row = None
    if seen:
        prog_row = db.execute(
            "SELECT p.id, p.name FROM progression p "
            "JOIN progression_chord pc ON pc.progression_id = p.id "
            "WHERE pc.chord_id IN ({}) ORDER BY RANDOM() LIMIT 1".format(
                ",".join("?" * len(seen))
            ),
            list(seen),
        ).fetchone()
    if not prog_row:
        prog_row = db.execute(
            "SELECT id, name FROM progression ORDER BY RANDOM() LIMIT 1"
        ).fetchone()
    if prog_row:
        items.append({
            "kind": "progression",
            "target_id": prog_row["id"],
            "target_name": prog_row["name"],
            "reason": "Suggested progression",
            "urgency": "low",
            "goal_min": 4,
        })

    return jsonify(items)


@app.route("/api/search", methods=["GET"])
def search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"chords": [], "progressions": [], "routines": []})
    pattern = f"%{q}%"
    db = get_db()
    chords = db.execute(
        "SELECT id, name, display_name FROM chord "
        "WHERE display_name LIKE ? OR name LIKE ? LIMIT 10",
        (pattern, pattern),
    ).fetchall()
    progressions = db.execute(
        "SELECT id, name FROM progression WHERE name LIKE ? LIMIT 10",
        (pattern,),
    ).fetchall()
    routines = db.execute(
        "SELECT id, name FROM practice_session WHERE name LIKE ? LIMIT 10",
        (pattern,),
    ).fetchall()
    return jsonify({
        "chords": [dict(r) for r in chords],
        "progressions": [dict(r) for r in progressions],
        "routines": [dict(r) for r in routines],
    })


def ensure_seeded() -> None:
    init_db()
    from seed import seed_v1, seed_v2
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        seed_v1(conn)
        seed_v2(conn)
        conn.commit()


if __name__ == "__main__":
    ensure_seeded()
    app.run(host="127.0.0.1", port=8765, debug=False)

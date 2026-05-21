# BACKEND_TODO.md — String Time redesign

The new frontend (Studio direction) introduces several features that the
current Flask backend doesn't yet support. Every spot in the JS marked with
`// MOCK:` or `// TODO:` points at one of these. Hand this list to Claude
Code (or implement yourself) — once these ship, remove the corresponding
mocks in `static/js/dashboard.js` and `static/js/practice.js`.

Search the JS for `MOCK:` and `BACKEND_TODO.md` to find call sites.

---

## §1 — Today's plan recommender

The dashboard surfaces 4 "today's plan" items (the most neglected /
lowest-accuracy chords + 1 suggested progression). Currently mocked in
`dashboard.js → buildTodayPlan()`.

### New endpoint

```
GET /api/plan/today

Returns:
[
  {
    "kind": "chord" | "progression",
    "target_id": 12,
    "target_name": "F",
    "reason": "Lowest accuracy · last 30d",
    "urgency": "high" | "med" | "low",
    "goal_min": 4
  },
  ...
]
```

### Suggested algorithm

1. Pull all chords with `total_practice_seconds > 0`.
2. Score each by:
   - `days_since_last_practice` (higher = more urgent)
   - `accuracy` (lower = more urgent — requires §2)
   - `bpm_plateau` (if best_bpm hasn't moved in 7 days)
3. Always include the lowest-accuracy chord (urgency=high) and the
   longest-untouched chord (urgency=high).
4. Add 1–2 "med" picks based on BPM plateau.
5. Add 1 progression suggestion: pick a recent progression containing the
   highest-urgency chord, OR a random unseen progression.

Goal minutes: 3m per chord, 4m per progression by default — make
configurable via a user-settings table later.

---

## §2 — Per-chord accuracy + BPM trend

Currently mocked in `dashboard.js → mockChordAccuracy()` /
`mockChordTrend()`. Powers the accuracy ribbon and BPM-trend sparkline on
every chord card, plus the dashboard's "today's plan" urgency scoring.

### Schema change

```sql
ALTER TABLE session ADD COLUMN accuracy REAL;  -- 0.0..1.0, nullable
```

Optionally also: `mistakes_count INTEGER`. The user inputs accuracy by
self-rating at session end, OR you can compute it from audio analysis later
(out of scope for now — start with a self-rating slider on the play-bar's
stop confirmation).

### New endpoints

```
GET /api/chords/<id>/trend?limit=10

Returns:
{
  "bpm": [70, 72, 75, 75, 78, 80, 80, 82, 85, 88],
  "accuracy": [0.62, 0.65, 0.68, 0.72, 0.75, 0.78, 0.80, 0.83, 0.85, 0.88]
}

GET /api/chords (extend existing)

Add to each chord row:
{
  ...,
  "accuracy_30d": 0.87,        // average accuracy over last 30 days
  "sessions_count": 14,         // COUNT(*) instead of just SUM(duration)
  "last_practiced_at": "2026-05-21T07:14:00Z"
}
```

### Self-rating UI hook

When the play-bar's stop fires (`practice.js → _stop()`), we should show a
quick 5-star or 0–100 slider. Once §2 ships, surface it. For now, sessions
save with `accuracy = NULL` and the frontend mocks values.

---

## §3 — Per-chord & per-progression play count

Extend `GET /api/chords` and `GET /api/progressions` to include:

```
{
  ...,
  "sessions_count": <int>,        // COUNT(session) for this target
  "total_practice_seconds": <int>, // already present for chords; ADD for progressions
  "last_bpm": <int>,               // already present for chords; ADD for progressions
}
```

Currently `progressions` doesn't expose any of these. The new prog-card
shows them as `—` until this ships.

---

## §4 — Tempo ramp on practice-session items

The routine builder UI has a tempo-ramp switch. Currently visual-only.

### Schema change

```sql
ALTER TABLE practice_session_item ADD COLUMN ramp_start_bpm INTEGER;  -- nullable
ALTER TABLE practice_session_item ADD COLUMN ramp_end_bpm INTEGER;    -- nullable
ALTER TABLE practice_session_item ADD COLUMN ramp_curve TEXT;         -- 'linear' | 'step' (default linear)
```

If `ramp_start_bpm` is null, the item uses its fixed `bpm` (current
behavior). If non-null, the metronome ramps from `ramp_start_bpm` to
`ramp_end_bpm` over the item's `duration_seconds`.

### Endpoint changes

POST/PATCH `/api/practice-sessions/<id>/items` should accept and persist
the ramp fields. The frontend (metronome.js) will need to support
mid-session BPM changes — currently `metronome.configure()` is called
once at start.

---

## §5 — Routine goal minutes + streak

The active routine shows a goal ring (e.g. "16/25m, 64% of goal"). Today
this is mocked as a constant 25m.

### Schema change

```sql
ALTER TABLE practice_session ADD COLUMN target_minutes INTEGER;  -- nullable; null = no goal
ALTER TABLE practice_session ADD COLUMN streak_days INTEGER DEFAULT 0;
ALTER TABLE practice_session ADD COLUMN last_completed_at TEXT;  -- ISO timestamp
```

`streak_days` increments each time the routine is completed
(`last_completed_at` was yesterday) and resets if the gap exceeds 1 day.

### Endpoint additions

- `PATCH /api/practice-sessions/<id>` should accept `target_minutes`.
- A new field `total_done_seconds_today` on the `GET` response, computed
  from items completed today.

---

## §6 — Fretboard heatmap (no backend change required)

Frontend computes this from `GET /api/chords` data (frets array +
total_practice_seconds). No new endpoint. Listed here for completeness.

---

## §7 — 14-day chart range

Current `/api/stats/progress?range=days` returns 10 days. The new
dashboard chart prefers 14. Either:

a) Add a `count` query param: `?range=days&count=14`, OR
b) Hardcode bump from 10 to 14 in `app.py → progress_stats`.

Pick whichever is less invasive.

---

## §8 — Sound-mode persistence (already done; verify)

`localStorage` key `gpt_audio_mode` is read by `practice.js`. No backend
change. Rename the localStorage key to `st_audio_mode` for consistency
with the new brand if you like — it's cosmetic.

---

## §9 — Header search (out of scope for now)

The top-right ⌘K search input is **disabled**. When you wire it up:

```
GET /api/search?q=...

Returns:
{
  "chords":       [{id, name, display_name, total_practice_seconds, ...}],
  "progressions": [{id, name, ...}],
  "routines":     [{id, name, ...}]
}
```

Simple LIKE search across name fields is fine for v1.

---

## §10 — Active-play focus mode (frontend-only, no backend)

The design canvas had a fullscreen dark "focus mode" with even bigger
chord typography. The current implementation just goes sticky-dark on the
play bar — a future iteration could add a real focus-mode overlay
triggered by a button on the play bar. No backend dep.

---

## Quick wins (do these first)

1. **§7** — bump days range from 10 to 14.
2. **§3** — add `sessions_count` to `/api/chords` (one line: `COUNT(s.id)`).
3. **§3 (progressions)** — extend `/api/progressions` with practice
   stats (mirror the chord query — JOIN session).

These three remove ~half the `MOCK:` markers immediately. Everything else
can ship incrementally.

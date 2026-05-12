/* History view: heatmap of last 365 days + recent sessions list + summary stats. */
(function () {
  const HEATMAP_DAYS = 364; // 52 weeks * 7 days

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function isoDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function fmtDuration(sec) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  function intensityLevel(sec) {
    if (!sec) return 0;
    // Cube root scaling so short sessions still register.
    const root = Math.cbrt(sec); // 60s -> ~3.9, 600s -> ~8.4, 3600s -> ~15.3
    if (root < 3) return 1;
    if (root < 6) return 2;
    if (root < 10) return 3;
    return 4;
  }

  async function refresh() {
    const [heatmapData, sessions, summary] = await Promise.all([
      fetch("/api/stats/heatmap?days=" + HEATMAP_DAYS).then((r) => r.json()),
      fetch("/api/sessions?limit=50").then((r) => r.json()),
      fetch("/api/stats/summary").then((r) => r.json()),
    ]);
    renderHeatmap(heatmapData);
    renderSessions(sessions);
    renderSummary(summary);
  }

  function renderHeatmap(data) {
    const container = document.getElementById("heatmap");
    container.innerHTML = "";

    const byDate = new Map();
    for (const r of data) byDate.set(r.date, r.total_seconds);

    // Build a grid: columns are weeks (oldest -> newest), rows are days (Sun -> Sat).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Go back HEATMAP_DAYS days. Then align to Sunday.
    const start = new Date(today);
    start.setDate(start.getDate() - HEATMAP_DAYS);
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1);

    const cursor = new Date(start);
    while (cursor <= today) {
      const iso = isoDate(cursor);
      const sec = byDate.get(iso) || 0;
      const level = intensityLevel(sec);
      const isFuture = cursor > today;
      const cell = document.createElement("div");
      cell.className = `hm-cell level-${level}`;
      if (isFuture) cell.style.visibility = "hidden";
      cell.title = sec
        ? `${iso} — ${fmtDuration(sec)}`
        : `${iso} — no practice`;
      // Place into grid by row (day of week) and column (week index).
      cell.style.gridRow = (cursor.getDay() + 1) + ""; // CSS grid is 1-indexed
      container.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  function renderSessions(sessions) {
    const list = document.getElementById("sessions-list");
    list.innerHTML = "";
    if (!sessions.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No sessions yet — pick a chord below and hit Start.";
      list.appendChild(e);
      return;
    }
    for (const s of sessions) {
      const row = document.createElement("div");
      row.className = "session-row";
      const started = new Date(s.started_at);
      const dateStr = started.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      row.innerHTML = `
        <div class="date"></div>
        <div class="target"></div>
        <div class="duration"></div>
        <div class="bpm"></div>
      `;
      row.querySelector(".date").textContent = dateStr;
      row.querySelector(".target").textContent = s.target_name || `(${s.target_type})`;
      row.querySelector(".duration").textContent = fmtDuration(s.duration_seconds);
      row.querySelector(".bpm").textContent = `${s.bpm} bpm`;
      if (s.notes) {
        const n = document.createElement("div");
        n.className = "notes";
        n.textContent = s.notes;
        row.appendChild(n);
      }
      list.appendChild(row);
    }
  }

  function renderSummary(summary) {
    const weekMin = Math.round(summary.week_seconds / 60);
    document.getElementById("stat-week").textContent = `${weekMin}m`;
    document.getElementById("stat-streak").textContent = `${summary.streak_days}d`;
  }

  window.History = { refresh };
})();

/* History view: heatmap of last 365 days + recent sessions list + summary stats. */
(function () {
  const HEATMAP_DAYS = 364;
  const RECENT_LIMIT = 6;

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
    const root = Math.cbrt(sec);
    if (root < 3) return 1;
    if (root < 6) return 2;
    if (root < 10) return 3;
    return 4;
  }

  async function refresh() {
    const [heatmapData, sessions, summary] = await Promise.all([
      fetch("/api/stats/heatmap?days=" + HEATMAP_DAYS).then((r) => r.json()),
      fetch("/api/sessions?limit=" + RECENT_LIMIT).then((r) => r.json()),
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
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
      cell.style.gridRow = (cursor.getDay() + 1) + "";
      container.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  function buildSessionRow(s) {
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
    return row;
  }

  function renderSessions(sessions) {
    const list = document.getElementById("sessions-list");
    const footer = document.getElementById("sessions-footer");
    list.innerHTML = "";

    if (!sessions.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No sessions yet — pick a chord below and hit Start.";
      list.appendChild(e);
      footer.classList.add("hidden");
      return;
    }

    sessions.forEach((s, i) => {
      const row = buildSessionRow(s);
      // Fade the last 2 rows when there are 6
      if (sessions.length >= RECENT_LIMIT && i >= RECENT_LIMIT - 2) {
        row.classList.add("session-fade-" + (i - (RECENT_LIMIT - 2) + 1));
      }
      list.appendChild(row);
    });

    footer.classList.remove("hidden");
  }

  function renderSummary(summary) {
    const weekMin = Math.round(summary.week_seconds / 60);
    document.getElementById("stat-week").textContent = `${weekMin}m`;
    document.getElementById("stat-streak").textContent = `${summary.streak_days}d`;
  }

  // All sessions modal
  function wireAllSessions() {
    const btn = document.getElementById("all-sessions-btn");
    const modal = document.getElementById("all-sessions-modal");
    const closeBtn = document.getElementById("all-sessions-close");

    btn.addEventListener("click", async () => {
      const sessions = await fetch("/api/sessions?limit=500").then((r) => r.json());
      const list = document.getElementById("all-sessions-list");
      list.innerHTML = "";
      if (!sessions.length) {
        const e = document.createElement("div");
        e.className = "empty";
        e.textContent = "No sessions yet.";
        list.appendChild(e);
      } else {
        for (const s of sessions) {
          list.appendChild(buildSessionRow(s));
        }
      }
      modal.classList.remove("hidden");
    });

    closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  }

  document.addEventListener("DOMContentLoaded", wireAllSessions);

  window.History = { refresh };
})();

/* History view: progress chart, metrics panel, recent sessions (6 with fade) + All Sessions modal (paginated, with delete). */
(function () {
  const RECENT_LIMIT = 6;
  const MODAL_PAGE_SIZE = 10;

  let currentRange = "days";
  let chartData = [];
  let resizeTimer = null;

  let modalPage = 0;
  let modalTotal = 0;

  function fmtDuration(sec) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function formatHour(h) {
    if (h === null || h === undefined) return "—";
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12} ${period}`;
  }

  // ── Canvas chart ──────────────────────────────────────────────────────────

  function drawChart(data) {
    const canvas = document.getElementById("progress-chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const PAD = { top: 16, right: 16, bottom: 48, left: 46 };
    const cW = W - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const maxSec = Math.max(...data.map(d => d.total_seconds), 1);
    const maxMin = maxSec / 60;

    const rawTick = maxMin / 4;
    const step = rawTick <= 5 ? 5 : rawTick <= 10 ? 10 : rawTick <= 15 ? 15 : Math.ceil(rawTick / 10) * 10;
    const yMax = step * 4;

    ctx.textBaseline = "middle";
    ctx.font = `11px 'JetBrains Mono', 'Fira Code', monospace`;
    for (let i = 0; i <= 4; i++) {
      const val = step * i;
      const y = PAD.top + cH - (val / yMax) * cH;
      ctx.strokeStyle = i === 0 ? "#cbd5e1" : "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + cW, y);
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "right";
      ctx.fillText(`${val}m`, PAD.left - 6, y);
    }

    const n = data.length;
    const gap = Math.max(3, cW * 0.04 / n);
    const barW = (cW - gap * (n - 1)) / n;

    data.forEach((d, i) => {
      const x = PAD.left + i * (barW + gap);
      const hPx = Math.max(d.total_seconds > 0 ? 2 : 0, (d.total_seconds / 60 / yMax) * cH);
      const y = PAD.top + cH - hPx;

      if (d.total_seconds > 0) {
        const grad = ctx.createLinearGradient(0, y, 0, PAD.top + cH);
        grad.addColorStop(0, "#9333ea");
        grad.addColorStop(0.6, "#7c3aed");
        grad.addColorStop(1, "rgba(2, 132, 199, 0.85)");
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = "#f1f5f9";
      }

      roundRect(ctx, x, y, barW, hPx, 6);
      ctx.fill();

      if (d.total_seconds > 0 && hPx > 4) {
        ctx.shadowColor = "rgba(147, 51, 234, 0.45)";
        ctx.shadowBlur = 12;
        roundRect(ctx, x, y, barW, hPx, 6);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      ctx.font = `10px 'JetBrains Mono', 'Fira Code', monospace`;
      const label = d.label || "";
      const parts = label.split(" ");
      if (parts.length === 2 && barW < 40) {
        ctx.fillText(parts[0], x + barW / 2, PAD.top + cH + 14);
        ctx.fillText(parts[1], x + barW / 2, PAD.top + cH + 26);
      } else {
        ctx.fillText(label, x + barW / 2, PAD.top + cH + 18);
      }
    });

    if (data.every(d => d.total_seconds === 0)) {
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "center";
      ctx.font = `13px 'Plus Jakarta Sans', sans-serif`;
      ctx.fillText("No practice recorded yet — pick a chord and hit start.", W / 2, PAD.top + cH / 2);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h <= 0) return;
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, 0);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  async function loadAndDrawChart(range) {
    const data = await fetch(`/api/stats/progress?range=${range}`).then(r => r.json());
    chartData = data;
    drawChart(data);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  function renderMetrics(summary) {
    const avgEl = document.getElementById("metric-avg-min");
    const timeEl = document.getElementById("metric-active-time");
    const streakEl = document.getElementById("metric-streak");
    const bestEl = document.getElementById("metric-best-streak");
    const weekEl = document.getElementById("stat-week");
    const topStreakEl = document.getElementById("stat-streak");

    if (avgEl) avgEl.textContent = summary.avg_min_per_day != null ? `${summary.avg_min_per_day}m` : "—";
    if (timeEl) timeEl.textContent = formatHour(summary.most_active_hour);
    if (streakEl) streakEl.textContent = `${summary.streak_days}d`;
    if (bestEl) bestEl.textContent = `${summary.longest_streak}d`;
    if (weekEl) weekEl.textContent = `${Math.round(summary.week_seconds / 60)}m`;
    if (topStreakEl) topStreakEl.textContent = `${summary.streak_days}d`;
  }

  // ── Session row builder (shared by recent + modal) ───────────────────────

  function buildSessionRow(s, opts = {}) {
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
      <button class="session-delete" title="Delete session" aria-label="Delete session">✕</button>
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
    row.querySelector(".session-delete").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this session?")) return;
      await fetch(`/api/sessions/${s.id}`, { method: "DELETE" });
      // Refresh chart, metrics, and the recent sessions list
      await refresh();
      // If we were called from the modal, refresh its current page too
      if (opts.onAfterDelete) opts.onAfterDelete();
    });
    return row;
  }

  // ── Recent sessions (main page) ──────────────────────────────────────────

  async function loadRecentSessions() {
    const data = await fetch(`/api/sessions?limit=${RECENT_LIMIT}&offset=0`).then(r => r.json());
    const items = data.items || data; // tolerate both shapes
    renderRecentSessions(items);
  }

  function renderRecentSessions(sessions) {
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
      if (sessions.length >= RECENT_LIMIT && i >= RECENT_LIMIT - 2) {
        row.classList.add("session-fade-" + (i - (RECENT_LIMIT - 2) + 1));
      }
      list.appendChild(row);
    });

    footer.classList.remove("hidden");
  }

  // ── All Sessions modal (paginated) ───────────────────────────────────────

  async function loadAllSessionsPage(page) {
    const offset = page * MODAL_PAGE_SIZE;
    const data = await fetch(`/api/sessions?limit=${MODAL_PAGE_SIZE}&offset=${offset}`).then(r => r.json());
    modalTotal = data.total;
    modalPage = page;
    renderAllSessions(data.items, page);
    renderAllSessionsPagination(page);
  }

  function renderAllSessions(items, page) {
    const list = document.getElementById("all-sessions-list");
    list.innerHTML = "";
    if (!items.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = page === 0 ? "No sessions yet." : "No sessions on this page.";
      list.appendChild(e);
      return;
    }
    for (const s of items) {
      const row = buildSessionRow(s, {
        onAfterDelete: () => {
          const newTotal = modalTotal - 1;
          const maxPage = Math.max(0, Math.ceil(newTotal / MODAL_PAGE_SIZE) - 1);
          loadAllSessionsPage(Math.min(modalPage, maxPage));
        }
      });
      list.appendChild(row);
    }
  }

  function renderAllSessionsPagination(page) {
    const container = document.getElementById("all-sessions-pagination");
    container.innerHTML = "";
    const totalPages = Math.ceil(modalTotal / MODAL_PAGE_SIZE);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.className = "page-btn";
    prevBtn.textContent = "← Prev";
    prevBtn.disabled = page === 0;
    prevBtn.addEventListener("click", () => loadAllSessionsPage(page - 1));

    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Page ${page + 1} of ${totalPages}`;

    const nextBtn = document.createElement("button");
    nextBtn.className = "page-btn";
    nextBtn.textContent = "Next →";
    nextBtn.disabled = page >= totalPages - 1;
    nextBtn.addEventListener("click", () => loadAllSessionsPage(page + 1));

    container.appendChild(prevBtn);
    container.appendChild(info);
    container.appendChild(nextBtn);
  }

  function wireAllSessionsModal() {
    const btn = document.getElementById("all-sessions-btn");
    const modal = document.getElementById("all-sessions-modal");
    const closeBtn = document.getElementById("all-sessions-close");

    btn.addEventListener("click", async () => {
      modalPage = 0;
      modal.classList.remove("hidden");
      await loadAllSessionsPage(0);
    });
    closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  }

  // ── Axis toggle ───────────────────────────────────────────────────────────

  function wireAxisToggle() {
    document.querySelectorAll(".axis-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".axis-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentRange = btn.dataset.range;
        loadAndDrawChart(currentRange);
      });
    });
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (chartData.length) drawChart(chartData);
    }, 120);
  }

  // ── Init / refresh ────────────────────────────────────────────────────────

  async function refresh() {
    const [summary] = await Promise.all([
      fetch("/api/stats/summary").then(r => r.json()),
      loadAndDrawChart(currentRange),
      loadRecentSessions(),
    ]);
    renderMetrics(summary);
  }

  function init() {
    wireAxisToggle();
    wireAllSessionsModal();
    window.addEventListener("resize", onResize);
  }

  window.History = { refresh, init };
})();

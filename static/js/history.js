/* String Time — history module.
 * Renders:
 *   - #sessions-list (recent 6 with fade)
 *   - #all-sessions-modal (paginated)
 *   - 14-day chart canvas #progress-chart (delegated to Dashboard.render14Days)
 *
 * Wires axis-toggle (Days / Weeks / Months) to refresh the chart range.
 */
(function () {
  const RECENT_LIMIT = 6;
  const MODAL_PAGE_SIZE = 10;

  let currentRange = "days";
  let chartData = [];
  let modalPage = 0;
  let modalTotal = 0;

  function fmtDuration(sec) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // ── Chart (re-uses dashboard renderer if available) ─────────────────
  async function loadAndDrawChart(range) {
    const data = await fetch(`/api/stats/progress?range=${range}`).then((r) => r.json());
    chartData = data;
    drawChart(data);
  }

  function drawChart(data) {
    const canvas = document.getElementById("progress-chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const get = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const accent = get("--accent");
    const line = get("--line");
    const ink4 = get("--ink-4");

    const series = (data || []).map((d) => Math.round((d.total_seconds || 0) / 60));
    if (!series.length) return;
    const max = Math.max(1, ...series);
    const peakEl = document.getElementById("recent-peak");
    if (peakEl) peakEl.textContent = `peak ${max}m`;

    const PAD = { t: 10, b: 22, l: 0, r: 4 };
    const step = (W - PAD.l - PAD.r) / series.length;
    const bw = step * 0.7;
    const cH = H - PAD.t - PAD.b;

    ctx.strokeStyle = line;
    ctx.lineWidth = 0.5;
    [0, 0.5, 1].forEach((p) => {
      const y = PAD.t + cH - cH * p;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });

    series.forEach((v, i) => {
      const bh = (v / max) * cH;
      const x = PAD.l + step * i + (step - bw) / 2;
      const y = PAD.t + cH - bh;
      ctx.fillStyle = accent;
      ctx.globalAlpha = i === series.length - 1 ? 1 : 0.45;
      roundRect(ctx, x, y, bw, bh, 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = ink4;
    ctx.font = `10px var(--font-mono), monospace`;
    ctx.textAlign = "center";
    (data || []).forEach((d, i) => {
      if (i % 2 !== 0 && i !== data.length - 1) return;
      const x = PAD.l + step * i + step / 2;
      ctx.fillText((d.label || "").slice(0, 3), x, H - 6);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (h <= 0) return;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ── Session row builder ──────────────────────────────────────────────

  function buildSessionRow(s, opts = {}) {
    const row = document.createElement("div");
    row.className = "session-row";
    row.innerHTML = `
      <div class="date"></div>
      <div class="target"><span class="marker"></span><span class="name"></span></div>
      <div class="bpm"></div>
      <div class="duration"></div>
      <button class="session-delete" title="Delete session" aria-label="Delete session">×</button>
    `;
    row.querySelector(".date").textContent = fmtDate(s.started_at);
    row.querySelector(".marker").classList.add(s.target_type === "progression" ? "prog" : (s.target_type === "session" ? "session" : "chord"));
    row.querySelector(".name").textContent = s.target_name || `(${s.target_type})`;
    row.querySelector(".bpm").textContent = `${s.bpm} bpm`;
    row.querySelector(".duration").textContent = fmtDuration(s.duration_seconds);
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
      await refresh();
      if (opts.onAfterDelete) opts.onAfterDelete();
    });
    return row;
  }

  // ── Recent sessions (dashboard) ──────────────────────────────────────

  async function loadRecentSessions() {
    const data = await fetch(`/api/sessions?limit=${RECENT_LIMIT}&offset=0`).then((r) => r.json());
    const items = data.items || data;
    renderRecentSessions(items);
  }

  function renderRecentSessions(sessions) {
    const list = document.getElementById("sessions-list");
    const footer = document.getElementById("sessions-footer");
    if (!list) return;
    list.innerHTML = "";

    if (!sessions.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "No sessions yet — pick a chord below and hit Start.";
      list.appendChild(e);
      if (footer) footer.classList.add("hidden");
      return;
    }
    sessions.forEach((s, i) => {
      const row = buildSessionRow(s);
      if (sessions.length >= RECENT_LIMIT && i >= RECENT_LIMIT - 2) {
        row.classList.add("session-fade-" + (i - (RECENT_LIMIT - 2) + 1));
      }
      list.appendChild(row);
    });
    if (footer) footer.classList.remove("hidden");
  }

  // ── All sessions modal ────────────────────────────────────────────────

  async function loadAllSessionsPage(page) {
    const offset = page * MODAL_PAGE_SIZE;
    const data = await fetch(`/api/sessions?limit=${MODAL_PAGE_SIZE}&offset=${offset}`).then((r) => r.json());
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
      list.appendChild(buildSessionRow(s, {
        onAfterDelete: () => {
          const newTotal = modalTotal - 1;
          const maxPage = Math.max(0, Math.ceil(newTotal / MODAL_PAGE_SIZE) - 1);
          loadAllSessionsPage(Math.min(modalPage, maxPage));
        }
      }));
    }
  }

  function renderAllSessionsPagination(page) {
    const c = document.getElementById("all-sessions-pagination");
    c.innerHTML = "";
    const totalPages = Math.ceil(modalTotal / MODAL_PAGE_SIZE);
    if (totalPages <= 1) return;
    const prev = document.createElement("button");
    prev.className = "page-btn";
    prev.textContent = "← Prev";
    prev.disabled = page === 0;
    prev.addEventListener("click", () => loadAllSessionsPage(page - 1));
    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Page ${page + 1} of ${totalPages}`;
    const next = document.createElement("button");
    next.className = "page-btn";
    next.textContent = "Next →";
    next.disabled = page >= totalPages - 1;
    next.addEventListener("click", () => loadAllSessionsPage(page + 1));
    c.append(prev, info, next);
  }

  function wireAllSessionsModal() {
    const btn = document.getElementById("all-sessions-btn");
    const modal = document.getElementById("all-sessions-modal");
    const closeBtn = document.getElementById("all-sessions-close");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      modalPage = 0;
      modal.classList.remove("hidden");
      await loadAllSessionsPage(0);
    });
    closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
  }

  function wireAxisToggle() {
    document.querySelectorAll(".axis-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".axis-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentRange = btn.dataset.range;
        loadAndDrawChart(currentRange);
      });
    });
  }

  // ── Init / refresh ───────────────────────────────────────────────────

  async function refresh() {
    await Promise.all([
      loadAndDrawChart(currentRange),
      loadRecentSessions(),
    ]);
  }

  function init() {
    wireAxisToggle();
    wireAllSessionsModal();
  }

  function redrawChart() {
    if (chartData.length) drawChart(chartData);
  }

  window.History = { refresh, init, redrawChart };
})();

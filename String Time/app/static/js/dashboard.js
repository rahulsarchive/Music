/* String Time — dashboard module
 * - View switcher (Today / Library / Routines)
 * - KPI tile rendering
 * - Today's plan (MOCK — needs backend support; see BACKEND_TODO.md)
 * - Year heatmap render
 * - Fretboard density render
 *
 * Backend data dependencies:
 *   GET /api/stats/summary
 *   GET /api/stats/heatmap?days=365
 *   GET /api/chords (used for fretboard density)
 *   GET /api/sessions?limit=14  (last-14-days bar chart and trend)
 *
 * Data NOT in backend yet — currently mocked client-side:
 *   - "Today's plan" recommender (see BACKEND_TODO.md §1)
 *   - Per-chord accuracy + BPM trend (BACKEND_TODO.md §2)
 */
(function () {
  const W = window.Widgets;

  // ---------- View switching ----------
  function wireViewSwitcher() {
    const views = {
      dashboard: document.getElementById("view-dashboard"),
      library:   document.getElementById("view-library"),
      routines:  document.getElementById("view-routines"),
    };
    const navs = document.querySelectorAll(".app-nav a[data-view]");
    function go(name) {
      Object.entries(views).forEach(([k, el]) => el && el.classList.toggle("hidden", k !== name));
      navs.forEach((a) => a.classList.toggle("active", a.dataset.view === name));
      // Trigger reflow/re-render of heatmaps if dashboard becomes visible
      if (name === "dashboard" && window.Dashboard._heatmapData) {
        W.yearHeatmap(document.getElementById("heatmap-year"), window.Dashboard._heatmapData);
      }
    }
    navs.forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      go(a.dataset.view);
    }));
    // Initial
    go("dashboard");
    return go;
  }

  // ---------- Today's date / subline ----------
  function renderTodayHeader(summary, todayMinutes) {
    const dateEl = document.getElementById("today-date");
    const subEl = document.getElementById("today-subline");
    const now = new Date();
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString(undefined, {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
    }
    if (subEl) {
      const goal = 25; // MOCK: user goal — TODO: backend setting
      if (todayMinutes <= 0) {
        subEl.innerHTML = `No practice yet today. Pick something to drill.`;
      } else if (todayMinutes >= goal) {
        subEl.innerHTML = `<span class="st-mono">${todayMinutes}m</span> done — goal hit.`;
      } else {
        subEl.innerHTML = `You're <span class="st-mono">${todayMinutes}m</span> into a <span class="st-mono">${goal}m</span> goal. Keep going.`;
      }
    }
  }

  // ---------- KPI tiles ----------
  function renderKPI(id, val, unit, sub, sparkData, sparkOpts) {
    const tile = document.getElementById(id);
    if (!tile) return;
    const num = tile.querySelector(".kpi-val .num");
    const unitEl = tile.querySelector(".kpi-val .unit");
    const subEl = tile.querySelector(".kpi-sub");
    const sparkHost = tile.querySelector(".kpi-spark");
    if (num) num.textContent = val;
    if (unitEl) unitEl.textContent = unit || "";
    if (subEl) subEl.textContent = sub || "";
    if (sparkHost) {
      sparkHost.innerHTML = "";
      if (sparkData && sparkData.length) {
        W.sparkline(sparkHost, sparkData, sparkOpts || {});
      }
    }
  }

  function renderKPITiles(summary, progressData, todayMinutes) {
    // Today
    const today10 = progressData.slice(-5).map((d) => Math.round(d.total_seconds / 60));
    renderKPI("kpi-today", todayMinutes, "min", `goal 25m`, today10, { mode: "bars", stroke: "var(--accent)" });

    // Streak
    const streakSpark = generateStreakSpark(summary.streak_days || 0);
    renderKPI("kpi-streak", summary.streak_days ?? 0, "days",
      summary.longest_streak ? `best ${summary.longest_streak}d` : "",
      streakSpark, { stroke: "var(--accent)" });

    // This week
    const weekMin = Math.round((summary.week_seconds || 0) / 60);
    const weekStr = weekMin >= 60 ? `${Math.floor(weekMin / 60)}h ${weekMin % 60}m` : `${weekMin}m`;
    const weekSpark = progressData.slice(-7).map((d) => Math.round(d.total_seconds / 60));
    renderKPI("kpi-week", weekStr, "", `${weekMin}m total`, weekSpark, { mode: "bars" });

    // Avg
    renderKPI("kpi-avg", summary.avg_min_per_day ?? "—", "min", "30d", progressData.map((d) => Math.round(d.total_seconds / 60)));

    // Peak hour
    renderKPI("kpi-peak", W.fmtHour(summary.most_active_hour), "", "", null);

    // Topbar streak chip
    const topStreak = document.getElementById("stat-streak");
    if (topStreak) topStreak.textContent = summary.streak_days ?? "0";
  }

  // Cheap mock streak trend — replace with real per-day streak buildup if added to API
  function generateStreakSpark(currentStreak) {
    const out = [];
    let v = Math.max(0, currentStreak - 9);
    for (let i = 0; i < 10; i++) {
      out.push(v);
      v = Math.min(currentStreak, v + 1);
    }
    return out;
  }

  // ---------- Year heatmap ----------
  async function renderHeatmap() {
    const data = await fetch("/api/stats/heatmap?days=365").then((r) => r.json());
    window.Dashboard._heatmapData = data;
    W.yearHeatmap(document.getElementById("heatmap-year"), data);
    // header totals
    const totalSec = data.reduce((s, r) => s + (r.total_seconds || 0), 0);
    const totalSess = data.filter((r) => r.total_seconds > 0).length;
    const el1 = document.getElementById("heatmap-total-sessions");
    const el2 = document.getElementById("heatmap-total-time");
    if (el1) el1.textContent = totalSess;
    if (el2) el2.textContent = W.fmtDuration(totalSec);
    return data;
  }

  // ---------- Today's plan ----------
  /**
   * MOCK recommender — replace once backend ships /api/plan/today.
   * Strategy here: find chords/progressions not practiced in N days OR with lowest practice time.
   */
  function buildTodayPlan(chords, progressions) {
    if (!chords || !chords.length) return [];

    const candidates = chords.map((c) => ({
      kind: "chord",
      target: c,
      time: c.total_practice_seconds || 0,
      lastBpm: c.last_bpm || 0,
    }));

    // Lowest practice time first (3 items)
    candidates.sort((a, b) => a.time - b.time);
    const neglected = candidates.slice(0, 3);

    // Plus 1 progression
    const progPick = progressions && progressions[Math.floor(Math.random() * progressions.length)];
    const plan = neglected.map((c, i) => ({
      ...c,
      urgency: i === 0 ? "high" : i === 1 ? "high" : "med",
      goalMin: 3,
      reason: c.time === 0 ? "Never practiced" : `Only ${Math.round(c.time / 60)}m practiced total`,
      title: c.target.display_name,
    }));
    if (progPick) {
      plan.push({
        kind: "progression",
        target: progPick,
        time: 0,
        urgency: "low",
        goalMin: 4,
        reason: "Suggested progression",
        title: progPick.name,
      });
    }
    return plan;
  }

  function renderTodayPlan(plan) {
    const host = document.getElementById("today-plan");
    if (!host) return;
    host.innerHTML = "";
    if (!plan.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.textContent = "Plan unavailable — add some chords first.";
      host.appendChild(e);
      return;
    }
    plan.forEach((p) => {
      const row = document.createElement("div");
      row.className = "plan-item" + (p.urgency === "high" ? " urgent" : "");
      row.innerHTML = `
        <div class="chord-glyph"></div>
        <div class="body">
          <div class="title"></div>
          <div class="reason"></div>
        </div>
        <div class="goal"></div>
        <span class="dot ${p.urgency}"></span>
      `;
      row.querySelector(".chord-glyph").textContent = p.kind === "chord"
        ? (p.target.display_name || "?").slice(0, 3)
        : "♪";
      row.querySelector(".title").textContent = p.title;
      row.querySelector(".reason").textContent = p.reason;
      row.querySelector(".goal").textContent = `${p.goalMin}m`;
      row.addEventListener("click", () => {
        // Push selection into practice
        const practice = window._practiceInstance;
        if (!practice) return;
        if (p.kind === "chord") {
          const card = document.querySelector(`.chord-card[data-chord-id="${p.target.id}"]`);
          practice._selectChord && practice._selectChord(p.target, card);
        } else {
          const card = document.querySelector(`.prog-card[data-prog-id="${p.target.id}"]`);
          practice._selectProgression && practice._selectProgression(p.target, card);
        }
        // Switch to library view so user sees what got selected, then scroll to play bar
        document.getElementById("play-bar")?.scrollIntoView({ block: "end", behavior: "smooth" });
      });
      host.appendChild(row);
    });

    const summary = document.getElementById("plan-summary");
    if (summary) summary.textContent = `${plan.reduce((s, p) => s + p.goalMin, 0)} min · ${plan.length} items`;
  }

  // ---------- Fretboard density ----------
  function renderFretboardDensity(chords) {
    const svg = document.getElementById("fretboard-heatmap");
    if (!svg) return;
    const stats = W.fretboardHeatmap(svg, chords || []);
    const meta = document.getElementById("fretboard-meta");
    const hot = document.getElementById("fretboard-hot");
    const cold = document.getElementById("fretboard-cold");
    if (meta && stats) {
      meta.textContent = `open position ${Math.round((stats.openShare || 0) * 100)}%`;
    }
    if (hot && chords) {
      const top = [...chords]
        .sort((a, b) => (b.total_practice_seconds || 0) - (a.total_practice_seconds || 0))
        .slice(0, 4)
        .map((c) => c.display_name)
        .join(", ");
      hot.textContent = `Hot: ${top || "—"}`;
    }
    if (cold && chords) {
      const cold4 = [...chords]
        .filter((c) => (c.total_practice_seconds || 0) === 0)
        .slice(0, 3)
        .map((c) => c.display_name);
      cold.textContent = cold4.length ? `Untouched: ${cold4.join(", ")}` : `All chords drilled at least once`;
    }
  }

  // ---------- Per-chord trend (MOCK) ----------
  // TODO: backend should provide GET /api/chords/<id>/trend?limit=10 returning
  // an array of recent session BPM (newest last). Until then, we synthesize
  // a plausible curve from the chord's total_practice_seconds + last_bpm.
  function mockChordTrend(chord) {
    const lastBpm = chord.last_bpm || 80;
    const minBpm = Math.max(40, lastBpm - 20);
    const out = [];
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const noise = (Math.sin(chord.id * 1.7 + i) * 3) | 0;
      out.push(Math.round(minBpm + (lastBpm - minBpm) * t + noise));
    }
    return out;
  }

  // TODO: backend should compute accuracy from session data. Mocked here.
  function mockChordAccuracy(chord) {
    const secs = chord.total_practice_seconds || 0;
    if (secs === 0) return 0;
    // More time → higher accuracy, capped
    const base = 0.55 + Math.min(0.4, secs / (60 * 60 * 3)); // 3h reaches 0.95
    const tagBoost = (chord.frets || []).some((f) => f > 4) ? -0.1 : 0; // barre is harder
    return Math.max(0.4, Math.min(0.99, base + tagBoost));
  }

  // ---------- 14-day chart on dashboard (simple bar chart) ----------
  function render14Days(data) {
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

    const series = (data || []).map((d) => Math.round(d.total_seconds / 60));
    if (!series.length) return;
    const max = Math.max(1, ...series);
    const peak = document.getElementById("recent-peak");
    if (peak) peak.textContent = `peak ${max}m`;
    const PAD = { t: 10, b: 22, l: 0, r: 4 };
    const bw = (W - PAD.l - PAD.r) / series.length * 0.7;
    const step = (W - PAD.l - PAD.r) / series.length;
    const cH = H - PAD.t - PAD.b;

    // gridline
    ctx.strokeStyle = getCss("--line");
    ctx.lineWidth = 0.5;
    [0, 0.5, 1].forEach((p) => {
      const y = PAD.t + cH - cH * p;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });

    series.forEach((v, i) => {
      const bh = (v / max) * cH;
      const x = PAD.l + step * i + (step - bw) / 2;
      const y = PAD.t + cH - bh;
      ctx.fillStyle = i === series.length - 1 ? getCss("--accent") : getCss("--accent");
      ctx.globalAlpha = i === series.length - 1 ? 1 : 0.45;
      roundRect(ctx, x, y, bw, bh, 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // x-axis labels (every other)
    ctx.fillStyle = getCss("--ink-4");
    ctx.font = `10px var(--font-mono), monospace`;
    ctx.textAlign = "center";
    (data || []).forEach((d, i) => {
      if (i % 2 !== 0 && i !== data.length - 1) return;
      const x = PAD.l + step * i + step / 2;
      ctx.fillText((d.label || "").slice(0, 3), x, H - 6);
    });
  }
  function getCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
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

  // ---------- Quick-log + Resume buttons ----------
  function wireHeaderButtons() {
    const quick = document.getElementById("quick-log-btn");
    if (quick) quick.addEventListener("click", () => {
      const p = window._practiceInstance;
      if (p && p.elPlayBtn && !p.elPlayBtn.disabled) {
        p._togglePlay && p._togglePlay();
      } else {
        document.querySelector('.app-nav a[data-view="library"]')?.click();
      }
    });
    const resume = document.getElementById("resume-routine-btn");
    if (resume) resume.addEventListener("click", () => {
      document.querySelector('.app-nav a[data-view="routines"]')?.click();
    });
    const startPlan = document.getElementById("start-plan-btn");
    if (startPlan) startPlan.addEventListener("click", () => {
      const first = document.querySelector("#today-plan .plan-item");
      if (first) first.click();
    });
  }

  // ---------- Top-level refresh ----------
  async function refresh(practice) {
    // Compute today's minutes from sessions
    const todayKey = new Date().toISOString().slice(0, 10);
    const todaySec = await fetch(`/api/sessions?limit=50&offset=0`).then((r) => r.json())
      .then((r) => (r.items || r))
      .then((items) => items
        .filter((s) => (s.started_at || "").slice(0, 10) === todayKey)
        .reduce((a, b) => a + (b.duration_seconds || 0), 0))
      .catch(() => 0);
    const todayMinutes = Math.round(todaySec / 60);

    const [summary, progressData] = await Promise.all([
      fetch("/api/stats/summary").then((r) => r.json()),
      fetch("/api/stats/progress?range=days").then((r) => r.json()),
    ]);

    renderTodayHeader(summary, todayMinutes);
    renderKPITiles(summary, progressData, todayMinutes);
    render14Days(progressData);
    await renderHeatmap();

    // Plan + fretboard depend on chord data which practice owns
    if (practice && practice.chords) {
      renderFretboardDensity(practice.chords);
      const plan = buildTodayPlan(practice.chords, practice.progressions || []);
      renderTodayPlan(plan);
    }
  }

  function init() {
    wireViewSwitcher();
    wireHeaderButtons();
    // Render waveform glyphs in sound-mode buttons
    const wfBoth = document.getElementById("wf-both");
    if (wfBoth) W.waveform(wfBoth, "both");
    // Resize handler — redraw heatmap and chart
    window.addEventListener("resize", debounce(() => {
      if (window.Dashboard._heatmapData) {
        W.yearHeatmap(document.getElementById("heatmap-year"), window.Dashboard._heatmapData);
      }
      // Trigger history chart redraw if visible
      if (window.History && window.History.redrawChart) window.History.redrawChart();
    }, 150));
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  window.Dashboard = {
    init,
    refresh,
    _heatmapData: null,
    mockChordTrend,
    mockChordAccuracy,
  };
})();

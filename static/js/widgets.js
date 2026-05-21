/* String Time — small SVG widget helpers (sparkline, ring, heatmaps, waveform).
 * Pure rendering — no API calls, no state.
 *
 * Public API on window.Widgets:
 *   sparkline(host, data, opts?)       — draw small sparkline SVG inside host (clears host)
 *   ring(host, value, max, opts?)      — draw circular progress ring
 *   yearHeatmap(svgEl, dayValues, opts?) — render 365-cell heatmap into svg
 *   fretboardHeatmap(svgEl, chords)    — render fretboard density from chord data
 *   waveform(host, mode)                — small waveform glyph for sound-mode pill
 *   chordChangeAnimate(currentEl, nextEl) — re-trigger chord-change animation
 *   fmtDuration(seconds)               — "2h 14m" / "42m" / "37s"
 */
(function () {
  const SVG = "http://www.w3.org/2000/svg";
  const el = (n, attrs, parent) => {
    const e = document.createElementNS(SVG, n);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h${rem.toString().padStart(2, "0")}` : `${h}h`;
  }

  function fmtHour(h) {
    if (h === null || h === undefined) return "—";
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}${period}`;
  }

  // ---- Sparkline ------------------------------------------------------------
  function sparkline(host, data, opts = {}) {
    host.innerHTML = "";
    if (!data || !data.length) return;
    const w = opts.w || host.clientWidth || 180;
    const h = opts.h || 22;
    const stroke = opts.stroke || css("--data");
    const fill = opts.fill !== false;
    const showDot = opts.dot !== false;
    const mode = opts.mode || "line";

    const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: "spark" });
    svg.style.display = "block";

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const step = w / Math.max(1, data.length - 1);
    const norm = (v) => h - 1 - ((v - min) / range) * (h - 2);

    if (mode === "bars") {
      const bw = (w / data.length) * 0.66;
      data.forEach((v, i) => {
        const y = norm(v);
        el("rect", {
          x: i * (w / data.length) + ((w / data.length) - bw) / 2,
          y,
          width: bw,
          height: h - y,
          fill: stroke,
          opacity: i === data.length - 1 ? "1" : "0.55",
          rx: "1.5",
        }, svg);
      });
    } else {
      const pts = data.map((v, i) => `${(i * step).toFixed(2)},${norm(v).toFixed(2)}`);
      const linePath = `M${pts.join(" L")}`;
      if (fill) {
        const fillPath = `${linePath} L${w},${h} L0,${h} Z`;
        el("path", { d: fillPath, class: "fill", fill: stroke, "fill-opacity": "0.10" }, svg);
      }
      el("path", { d: linePath, class: "line", fill: "none", stroke, "stroke-width": "1.4" }, svg);
      if (showDot) {
        el("circle", {
          cx: (data.length - 1) * step,
          cy: norm(data[data.length - 1]),
          r: "1.8",
          fill: stroke,
          class: "dot",
        }, svg);
      }
    }

    host.appendChild(svg);
    return svg;
  }

  // ---- Ring progress --------------------------------------------------------
  function ring(host, value, max, opts = {}) {
    host.innerHTML = "";
    const size = opts.size || 60;
    const stroke = opts.stroke || 5;
    const color = opts.color || css("--accent");
    const track = opts.track || css("--line");
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, value / (max || 1)));

    const wrap = document.createElement("div");
    wrap.className = "ring-wrap";
    wrap.style.width = `${size}px`;
    wrap.style.height = `${size}px`;

    const svg = el("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` });
    svg.style.transform = "rotate(-90deg)";
    el("circle", { cx: size / 2, cy: size / 2, r, stroke: track, "stroke-width": stroke, fill: "none" }, svg);
    el("circle", {
      cx: size / 2,
      cy: size / 2,
      r,
      stroke: color,
      "stroke-width": stroke,
      fill: "none",
      "stroke-dasharray": c,
      "stroke-dashoffset": c * (1 - pct),
      "stroke-linecap": "round",
    }, svg);
    wrap.appendChild(svg);

    if (opts.label) {
      const lbl = document.createElement("div");
      lbl.className = "ring-content";
      lbl.innerHTML = opts.label;
      wrap.appendChild(lbl);
    }

    host.appendChild(wrap);
    return wrap;
  }

  // ---- Year heatmap ---------------------------------------------------------
  // dayValues: array of { date: 'YYYY-MM-DD', total_seconds }
  // Renders 365 cells in 7-row × 53-col grid (most recent at right edge).
  function yearHeatmap(svgEl, dayValues, opts = {}) {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    const cell = opts.cell || 10;
    const gap = opts.gap || 2;
    const color = opts.color || css("--accent");
    const empty = opts.empty || css("--bg-sunk");
    const days = opts.days || 365;

    // Build a date → seconds map
    const map = new Map();
    for (const r of (dayValues || [])) {
      if (r.date) map.set(r.date, Math.max(map.get(r.date) || 0, r.total_seconds || 0));
    }

    // 365 days ending today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cells = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      cells.push({ date: key, total: map.get(key) || 0, day: d });
    }

    // Group into weeks (Sun=0 .. Sat=6). Pad first week's leading offset.
    const firstDay = cells[0].day.getDay();
    const padded = Array(firstDay).fill(null).concat(cells);
    const cols = Math.ceil(padded.length / 7);

    const width = cols * (cell + gap) + 24;
    const height = 7 * (cell + gap) + 18;
    svgEl.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svgEl.setAttribute("width", "100%");
    svgEl.setAttribute("height", height);

    // Day-of-week labels (Mon/Wed/Fri)
    ["Mon", "Wed", "Fri"].forEach((lab, idx) => {
      const row = [1, 3, 5][idx];
      el("text", {
        x: 0,
        y: row * (cell + gap) + cell - 1,
        "font-family": "var(--font-mono)",
        "font-size": "9",
        fill: css("--ink-4"),
      }, svgEl).textContent = lab;
    });

    // Cells
    const maxSec = Math.max(1, ...cells.map((c) => c.total));
    padded.forEach((c, i) => {
      if (!c) return;
      const col = Math.floor(i / 7);
      const row = i % 7;
      const intensity = c.total === 0 ? 0 : 0.18 + (c.total / maxSec) * 0.82;
      const fill = c.total === 0 ? empty : color;
      const rect = el("rect", {
        x: col * (cell + gap) + 22,
        y: row * (cell + gap),
        width: cell,
        height: cell,
        rx: "1.5",
        fill,
      }, svgEl);
      if (c.total) rect.setAttribute("opacity", intensity.toFixed(3));
      // Tooltip on hover
      const title = el("title", {}, rect);
      title.textContent = `${c.date} · ${Math.round(c.total / 60)}m`;

      // Month labels at top of first cell of each month
      if (c.day.getDate() === 1 || i === firstDay) {
        const label = c.day.toLocaleString("en-US", { month: "short" });
        if (row <= 2) {
          el("text", {
            x: col * (cell + gap) + 22,
            y: -4,
            "font-family": "var(--font-mono)",
            "font-size": "9",
            fill: css("--ink-4"),
          }, svgEl).textContent = label;
        }
      }
    });
  }

  // ---- Fretboard density ---------------------------------------------------
  // Compute heat per (string, fret) from chord shapes weighted by practice time.
  function fretboardHeatmap(svgEl, chords) {
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
    const w = 360, h = 90, pad = 10;
    const strings = 6, frets = 12;
    svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const sx = (f) => pad + ((w - pad * 2) * f) / frets;
    const sy = (s) => pad + ((h - pad * 2) * s) / (strings - 1);

    // Heat accumulator
    const heat = Array.from({ length: strings }, () => Array(frets + 1).fill(0));
    let totalWeight = 0;
    let openWeight = 0;
    for (const c of (chords || [])) {
      const weight = Math.max(1, (c.total_practice_seconds || 0) / 60);
      totalWeight += weight;
      (c.frets || []).forEach((f, i) => {
        if (f === null || f === -1) return;
        const stringIdx = i; // low E (0) -> high E (5)
        if (f === 0) openWeight += weight / 6;
        if (f >= 0 && f <= frets) heat[stringIdx][f] += weight;
      });
    }
    const maxHeat = Math.max(1, ...heat.flat());

    // Frets
    for (let f = 0; f <= frets; f++) {
      el("line", {
        x1: sx(f), y1: pad - 4, x2: sx(f), y2: h - pad + 4,
        class: f === 0 ? "fb-nut" : "fb-fret",
        stroke: f === 0 ? css("--ink") : css("--line"),
        "stroke-width": f === 0 ? "2" : "0.6",
      }, svgEl);
    }
    // Strings
    for (let s = 0; s < strings; s++) {
      el("line", { x1: pad, y1: sy(s), x2: w - pad, y2: sy(s), class: "fb-string", stroke: css("--ink-4"), "stroke-width": "0.4", opacity: "0.6" }, svgEl);
    }
    // Heat dots
    for (let s = 0; s < strings; s++) {
      for (let f = 0; f <= frets; f++) {
        const v = heat[s][f] / maxHeat;
        if (v > 0.06) {
          const r = 2.5 + v * 5;
          el("circle", {
            cx: f === 0 ? pad : (sx(f - 1) + sx(f)) / 2,
            cy: sy(s),
            r,
            fill: css("--accent"),
            opacity: (v * 0.9).toFixed(3),
            class: "fb-dot",
          }, svgEl);
        }
      }
    }
    // Fret dots (3, 5, 7, 9, 12)
    [3, 5, 7, 9, 12].forEach((f) => {
      el("circle", {
        cx: (sx(f - 1) + sx(f)) / 2,
        cy: h - pad + 6,
        r: "1.5",
        fill: css("--ink-4"),
      }, svgEl);
    });

    // Return summary stats
    const openShare = totalWeight > 0 ? openWeight / totalWeight : 0;
    return { openShare };
  }

  // ---- Waveform glyph (small) ----------------------------------------------
  function waveform(host, mode = "both") {
    host.innerHTML = "";
    const w = 28, h = 11, bars = 14;
    const svg = el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
    for (let i = 0; i < bars; i++) {
      let bh;
      if (mode === "tick") bh = i % 4 === 0 ? h * 0.85 : h * 0.18;
      else if (mode === "chord") bh = (Math.sin(i * 0.7) * 0.4 + 0.55) * h * 0.85;
      else bh = (Math.sin(i * 0.7) * 0.35 + 0.5) * h * 0.7 + (i % 4 === 0 ? h * 0.25 : 0);
      const x = (i + 0.5) * (w / bars);
      el("rect", {
        x: x - 1, y: (h - bh) / 2, width: 2, height: bh, rx: 1, fill: "currentColor",
      }, svg);
    }
    host.appendChild(svg);
  }

  // ---- Chord change animation ----------------------------------------------
  // Re-trigger CSS keyframe by removing and reflowing the class.
  function chordChangeAnimate(currentEl, nextEl) {
    [currentEl, nextEl].forEach((wrap) => {
      if (!wrap) return;
      wrap.classList.remove("flip");
      // force reflow
      void wrap.offsetWidth;
      wrap.classList.add("flip");
    });
  }

  window.Widgets = {
    sparkline, ring, yearHeatmap, fretboardHeatmap, waveform,
    chordChangeAnimate, fmtDuration, fmtHour,
  };
})();

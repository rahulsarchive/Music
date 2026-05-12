/* Chord diagram SVG renderer.
 *
 * renderChord(svgEl, frets, fingers, opts)
 *   frets:   6-element array (low E → high E). null = muted, 0 = open, 1..N = fret.
 *   fingers: 6-element array of null or finger number (1..4) — drawn inside fingered dots.
 *   opts:    { showFingers: bool (default true) }
 *
 * The diagram auto-shifts the visible fret window when the lowest non-zero fret > 4,
 * showing a position label like "5fr" next to the top.
 */
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";

  function _el(name, attrs, parent) {
    const e = document.createElementNS(SVG_NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function _frettedValues(frets) {
    return frets.filter((f) => f !== null && f > 0);
  }

  function renderChord(svgEl, frets, fingers, opts) {
    opts = opts || {};
    const showFingers = opts.showFingers !== false;
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    // viewBox is assumed to be set on the <svg>. Compute scale from it.
    const vb = (svgEl.getAttribute("viewBox") || "0 0 140 170").split(/\s+/).map(Number);
    const W = vb[2];
    const H = vb[3];

    // Determine starting fret for the window.
    const frettedVals = _frettedValues(frets);
    const minFret = frettedVals.length ? Math.min(...frettedVals) : 1;
    const maxFret = frettedVals.length ? Math.max(...frettedVals) : 1;
    let startFret = 1;
    const visibleFrets = 5;
    let showNut = true;
    if (maxFret > visibleFrets) {
      startFret = Math.max(1, minFret);
      showNut = false;
    }

    // Geometry
    const padLeft = W * 0.16;
    const padRight = W * 0.10;
    const padTop = H * 0.18;
    const padBottom = H * 0.08;
    const stringSpacing = (W - padLeft - padRight) / 5; // 6 strings, 5 gaps
    const fretSpacing = (H - padTop - padBottom) / visibleFrets;

    const stringColor = "#bdbdc6";
    const fretColor = "#6b6b78";
    const dotColor = "#ff3d8b"; // accent-pink
    const openColor = "#b5ff3a"; // lime
    const mutedColor = "#8a8a96";
    const textColor = "#e8e8ee";

    // Nut or position label
    if (showNut) {
      _el("rect", {
        x: padLeft - 1,
        y: padTop - 2,
        width: stringSpacing * 5 + 2,
        height: Math.max(3, H * 0.022),
        fill: textColor,
        rx: 1,
      }, svgEl);
    } else {
      _el("text", {
        x: padLeft - 6,
        y: padTop + fretSpacing * 0.6,
        "font-size": Math.round(H * 0.07),
        fill: mutedColor,
        "text-anchor": "end",
        "font-family": "sans-serif",
      }, svgEl).textContent = `${startFret}fr`;
    }

    // Fret lines
    for (let i = 0; i <= visibleFrets; i++) {
      const y = padTop + i * fretSpacing;
      if (showNut && i === 0) continue; // nut is drawn separately
      _el("line", {
        x1: padLeft,
        y1: y,
        x2: padLeft + stringSpacing * 5,
        y2: y,
        stroke: fretColor,
        "stroke-width": 1,
      }, svgEl);
    }

    // Strings (vertical)
    for (let s = 0; s < 6; s++) {
      const x = padLeft + s * stringSpacing;
      _el("line", {
        x1: x,
        y1: padTop,
        x2: x,
        y2: padTop + fretSpacing * visibleFrets,
        stroke: stringColor,
        "stroke-width": 1.2,
      }, svgEl);
    }

    // Markers above strings (O or X)
    const markerY = padTop - H * 0.04;
    const markerFont = Math.round(H * 0.075);
    for (let s = 0; s < 6; s++) {
      const x = padLeft + s * stringSpacing;
      const fret = frets[s];
      if (fret === null) {
        _el("text", {
          x: x,
          y: markerY,
          fill: mutedColor,
          "font-size": markerFont,
          "text-anchor": "middle",
          "font-family": "sans-serif",
          "font-weight": "700",
        }, svgEl).textContent = "×";
      } else if (fret === 0) {
        _el("circle", {
          cx: x,
          cy: markerY - markerFont * 0.35,
          r: markerFont * 0.32,
          fill: "none",
          stroke: openColor,
          "stroke-width": 1.4,
        }, svgEl);
      }
    }

    // Fingered dots
    const dotR = Math.min(stringSpacing, fretSpacing) * 0.38;
    for (let s = 0; s < 6; s++) {
      const fret = frets[s];
      if (fret === null || fret === 0) continue;
      const relFret = fret - startFret + 1; // 1..visibleFrets
      if (relFret < 1 || relFret > visibleFrets) continue;
      const x = padLeft + s * stringSpacing;
      const y = padTop + (relFret - 0.5) * fretSpacing;
      _el("circle", {
        cx: x,
        cy: y,
        r: dotR,
        fill: dotColor,
      }, svgEl);
      if (showFingers && fingers && fingers[s] != null) {
        _el("text", {
          x: x,
          y: y + dotR * 0.45,
          fill: "#1a1a1f",
          "font-size": Math.round(dotR * 1.3),
          "text-anchor": "middle",
          "font-family": "sans-serif",
          "font-weight": "700",
        }, svgEl).textContent = String(fingers[s]);
      }
    }
  }

  // Parses notations like "x 3 2 0 1 0", "x32010", "X,3,2,0,1,0" → array of 6 frets.
  // Returns null if invalid.
  function parseFretString(s) {
    if (!s) return null;
    s = s.trim();
    // If no separators and length is exactly 6 chars where each is x/X or single digit, treat as compact.
    const compact = /^[xX0-9]{6}$/;
    let tokens;
    if (compact.test(s)) {
      tokens = s.split("");
    } else {
      tokens = s.split(/[\s,]+/).filter(Boolean);
    }
    if (tokens.length !== 6) return null;
    const out = [];
    for (const t of tokens) {
      if (t === "x" || t === "X") {
        out.push(null);
      } else {
        const n = parseInt(t, 10);
        if (Number.isNaN(n) || n < 0 || n > 24) return null;
        out.push(n);
      }
    }
    return out;
  }

  function fretsToString(frets) {
    return frets.map((f) => (f === null ? "x" : String(f))).join(" ");
  }

  window.ChordDiagram = { renderChord, parseFretString, fretsToString };
})();

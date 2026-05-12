/* Web Audio metronome engine + 4-bar playhead animation.
 *
 * Uses Chris Wilson's lookahead-scheduler pattern: a setInterval wakes every
 * SCHEDULE_INTERVAL_MS and enqueues clicks via audioCtx.start(time) for any
 * beat falling within the next LOOKAHEAD_S window. Click timing is locked to
 * audioContext.currentTime, not setInterval drift.
 *
 * The visual playhead is computed each animation frame from currentTime, so
 * audio and visual stay in sync regardless of frame rate.
 *
 * Public API:
 *   m = new Metronome({ svg, onBeat })
 *   m.configure({ bpm, beatsPerBar, totalBars })
 *   m.start()
 *   m.stop()
 *   m.isRunning
 */
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SCHEDULE_INTERVAL_MS = 25;
  const LOOKAHEAD_S = 0.1;

  function el(name, attrs, parent) {
    const e = document.createElementNS(SVG_NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  class Metronome {
    constructor({ svg, onBeat }) {
      this.svg = svg;
      this.onBeat = onBeat || (() => {});
      this.bpm = 80;
      this.beatsPerBar = 4;
      this.totalBars = 4;
      this.audioCtx = null;
      this.nextNoteTime = 0;
      this.beatCounter = 0; // total beats since start
      this.startCtxTime = 0;
      this.schedulerId = null;
      this.animId = null;
      this.isRunning = false;
      this.muted = false;

      this._buildSvg();
    }

    _buildSvg() {
      const svg = this.svg;
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      // viewBox 0 0 1000 80
      const W = 1000, H = 80;
      // Background lane
      el("rect", { x: 0, y: 0, width: W, height: H, fill: "#1a1a1f", rx: 6 }, svg);

      // 4 bars with internal beat ticks
      this.bars = [];
      const barW = W / this.totalBars;
      for (let b = 0; b < this.totalBars; b++) {
        const x = b * barW;
        // bar separator (skip leftmost)
        if (b > 0) {
          el("line", { x1: x, y1: 6, x2: x, y2: H - 6, stroke: "#3a3a45", "stroke-width": 1.5 }, svg);
        }
        // bar number label
        el("text", {
          x: x + 8, y: 18,
          fill: "#8a8a96",
          "font-size": 11,
          "font-family": "sans-serif",
          "font-weight": 600,
        }, svg).textContent = `Bar ${b + 1}`;
      }

      // Beat ticks
      this._renderBeatTicks();

      // Playhead line — drawn last so it sits on top
      this.playhead = el("line", {
        x1: 0, y1: 4, x2: 0, y2: H - 4,
        stroke: "#2ee5ff",
        "stroke-width": 2.5,
        opacity: 0.95,
        filter: "drop-shadow(0 0 6px rgba(46, 229, 255, 0.8))",
      }, svg);
      this.playhead.style.transform = "translateX(0px)";
    }

    _renderBeatTicks() {
      // Remove old beat-tick elements
      const old = this.svg.querySelectorAll("[data-tick]");
      old.forEach((n) => n.remove());

      const W = 1000, H = 80;
      const totalBeats = this.totalBars * this.beatsPerBar;
      const beatW = W / totalBeats;
      for (let i = 0; i < totalBeats; i++) {
        const x = i * beatW;
        const isDownbeat = i % this.beatsPerBar === 0;
        const r = isDownbeat ? 6 : 3.5;
        const cy = H / 2 + 6;
        el("circle", {
          cx: x + beatW / 2,
          cy,
          r,
          fill: isDownbeat ? "#ff3d8b" : "#5a5a68",
          opacity: 0.55,
          "data-tick": i,
        }, this.svg);
      }
    }

    configure({ bpm, beatsPerBar, totalBars }) {
      if (bpm != null) this.bpm = Math.max(20, Math.min(300, bpm));
      if (beatsPerBar != null && beatsPerBar !== this.beatsPerBar) {
        this.beatsPerBar = beatsPerBar;
        this._renderBeatTicks();
      }
      if (totalBars != null && totalBars !== this.totalBars) {
        this.totalBars = totalBars;
        this._buildSvg();
      }
    }

    start() {
      if (this.isRunning) return;
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === "suspended") this.audioCtx.resume();

      this.beatCounter = 0;
      this.startCtxTime = this.audioCtx.currentTime + 0.05;
      this.nextNoteTime = this.startCtxTime;
      this.isRunning = true;

      this.schedulerId = setInterval(() => this._scheduler(), SCHEDULE_INTERVAL_MS);
      this._animate();
    }

    stop() {
      if (!this.isRunning) return;
      this.isRunning = false;
      clearInterval(this.schedulerId);
      this.schedulerId = null;
      if (this.animId) cancelAnimationFrame(this.animId);
      this.animId = null;
      this.playhead.style.transform = "translateX(0px)";
      // Reset highlight
      this._highlightBeat(-1);
    }

    _scheduler() {
      if (!this.isRunning) return;
      const secondsPerBeat = 60.0 / this.bpm;
      while (this.nextNoteTime < this.audioCtx.currentTime + LOOKAHEAD_S) {
        const beatIdx = this.beatCounter; // 0,1,2,...
        const beatInBar = beatIdx % this.beatsPerBar;
        this._scheduleClick(this.nextNoteTime, beatInBar === 0);
        // Notify listeners with their *audio time* — they can sync displays.
        const audioTime = this.nextNoteTime;
        try { this.onBeat(beatIdx, audioTime, this.audioCtx); } catch (_) {}
        this.beatCounter++;
        this.nextNoteTime += secondsPerBeat;
      }
    }

    setMuted(muted) {
      this.muted = !!muted;
    }

    _scheduleClick(time, accented) {
      if (this.muted) return;
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = accented ? 1500 : 900;
      osc.type = "square";
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(accented ? 0.4 : 0.25, time + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
      osc.connect(gain).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    }

    _animate() {
      if (!this.isRunning) return;
      const ctxNow = this.audioCtx.currentTime;
      const secondsPerBeat = 60.0 / this.bpm;
      const totalBeats = this.totalBars * this.beatsPerBar;
      const loopSeconds = totalBeats * secondsPerBeat;

      const elapsed = Math.max(0, ctxNow - this.startCtxTime);
      const phase = elapsed % loopSeconds;
      const frac = phase / loopSeconds; // 0..1
      const W = 1000;
      const px = frac * W;
      this.playhead.style.transform = `translateX(${px}px)`;

      // Highlight current beat tick
      const beatInLoop = Math.floor(phase / secondsPerBeat) % totalBeats;
      this._highlightBeat(beatInLoop);

      this.animId = requestAnimationFrame(() => this._animate());
    }

    _highlightBeat(idx) {
      const ticks = this.svg.querySelectorAll("[data-tick]");
      ticks.forEach((t) => {
        const i = Number(t.getAttribute("data-tick"));
        const isDownbeat = i % this.beatsPerBar === 0;
        if (i === idx) {
          t.setAttribute("fill", isDownbeat ? "#b5ff3a" : "#2ee5ff");
          t.setAttribute("opacity", "1");
          t.setAttribute("r", isDownbeat ? "8" : "5");
        } else {
          t.setAttribute("fill", isDownbeat ? "#ff3d8b" : "#5a5a68");
          t.setAttribute("opacity", "0.55");
          t.setAttribute("r", isDownbeat ? "6" : "3.5");
        }
      });
    }
  }

  window.Metronome = Metronome;
})();

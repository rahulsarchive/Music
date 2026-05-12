/* Practice flow: target selection, controls, start/stop, save session. */
(function () {
  const TS_BEATS = { "4/4": 4, "3/4": 3, "6/8": 6 };
  const TOTAL_BARS = 4;

  class Practice {
    constructor() {
      this.chords = [];
      this.progressions = [];
      this.selection = null; // { type: 'chord'|'progression', id, chord, progression }
      this.metronome = null;
      this.session = null; // { startedAtMs, startedAtIso }
      this.timerId = null;
      this.currentChordIndex = 0; // for progressions
      this.beatsPerChord = 4;     // computed from time sig × bars-per-chord
      this.beatsPerBar = 4;

      this._cacheEls();
      this._wireControls();
    }

    _cacheEls() {
      this.elChordGrid = document.getElementById("chord-grid");
      this.elProgGrid = document.getElementById("progression-grid");
      this.elTabs = document.querySelectorAll(".tab");
      this.elBpm = document.getElementById("bpm");
      this.elBpmSlider = document.getElementById("bpm-slider");
      this.elTimeSig = document.getElementById("time-sig");
      this.elBpcWrap = document.getElementById("bars-per-chord-wrap");
      this.elBpc = document.getElementById("bars-per-chord");
      this.elPlayBtn = document.getElementById("play-btn");
      this.elTimer = document.getElementById("timer");
      this.elBarSvg = document.getElementById("bar-svg");
      this.elCurName = document.getElementById("current-chord-name");
      this.elCurSvg = document.getElementById("current-chord-svg");
      this.elNextWrap = document.getElementById("next-wrap");
      this.elNextName = document.getElementById("next-chord-name");
      this.elNextSvg = document.getElementById("next-chord-svg");
      this.elNotesModal = document.getElementById("notes-modal");
      this.elNotesInput = document.getElementById("notes-input");
      this.elNotesSummary = document.getElementById("notes-summary");
      this.elNotesSkip = document.getElementById("notes-skip");
      this.elNotesSave = document.getElementById("notes-save");
    }

    _wireControls() {
      this.elTabs.forEach((t) => {
        t.addEventListener("click", () => this._switchTab(t.dataset.tab));
      });
      // BPM slider <-> input
      this.elBpmSlider.addEventListener("input", () => {
        this.elBpm.value = this.elBpmSlider.value;
        this._configureMetronome();
      });
      this.elBpm.addEventListener("input", () => {
        let v = parseInt(this.elBpm.value, 10);
        if (Number.isNaN(v)) return;
        v = Math.max(40, Math.min(240, v));
        this.elBpmSlider.value = v;
        this._configureMetronome();
      });
      this.elTimeSig.addEventListener("change", () => this._configureMetronome());
      this.elBpc.addEventListener("change", () => this._configureMetronome());
      this.elPlayBtn.addEventListener("click", () => this._togglePlay());

      this.elNotesSkip.addEventListener("click", () => this._saveSession(""));
      this.elNotesSave.addEventListener("click", () => this._saveSession(this.elNotesInput.value));
      this.elNotesModal.addEventListener("click", (e) => {
        if (e.target === this.elNotesModal) this._saveSession("");
      });
    }

    _switchTab(name) {
      this.elTabs.forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === name);
      });
      const isChord = name === "chord";
      this.elChordGrid.classList.toggle("hidden", !isChord);
      this.elProgGrid.classList.toggle("hidden", isChord);
      this.elBpcWrap.classList.toggle("hidden", isChord);
    }

    setMetronome(m) { this.metronome = m; }

    async loadData() {
      const [chords, progs] = await Promise.all([
        fetch("/api/chords").then((r) => r.json()),
        fetch("/api/progressions").then((r) => r.json()),
      ]);
      this.chords = chords;
      this.progressions = progs;
      this._renderChordGrid();
      this._renderProgressionGrid();
    }

    _renderChordGrid() {
      const grid = this.elChordGrid;
      grid.innerHTML = "";
      for (const c of this.chords) {
        const card = document.createElement("div");
        card.className = "chord-card";
        card.innerHTML = `<div class="name"></div><svg class="mini" viewBox="0 0 140 170"></svg>`;
        card.querySelector(".name").textContent = c.display_name;
        const svg = card.querySelector("svg");
        window.ChordDiagram.renderChord(svg, c.frets, c.fingers, { showFingers: false });
        card.addEventListener("click", () => this._selectChord(c, card));
        if (c.is_custom) {
          const del = document.createElement("button");
          del.className = "delete-btn";
          del.textContent = "×";
          del.title = "Delete custom chord";
          del.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete custom chord "${c.display_name}"?`)) return;
            const res = await fetch(`/api/chords/${c.id}`, { method: "DELETE" });
            if (res.ok) {
              await this.loadData();
            } else {
              const err = await res.json().catch(() => ({}));
              alert("Delete failed: " + (err.error || res.status));
            }
          });
          card.appendChild(del);
        }
        grid.appendChild(card);
      }
      // "+ Add custom" tile
      const add = document.createElement("div");
      add.className = "add-card";
      add.innerHTML = `<div class="plus">+</div><div>Add custom</div>`;
      add.addEventListener("click", () => window.__openChordBuilder());
      grid.appendChild(add);
    }

    _renderProgressionGrid() {
      const grid = this.elProgGrid;
      grid.innerHTML = "";
      for (const p of this.progressions) {
        const card = document.createElement("div");
        card.className = "prog-card";
        const chordsHtml = p.chords.map((c) => `<span class="pchip">${escapeHtml(c.display_name)}</span>`).join("");
        card.innerHTML = `<div class="name"></div><div class="progression-chords">${chordsHtml}</div>`;
        card.querySelector(".name").textContent = p.name;
        card.addEventListener("click", () => this._selectProgression(p, card));
        grid.appendChild(card);
      }
    }

    _clearSelectionUi() {
      document.querySelectorAll(".chord-card.selected, .prog-card.selected")
        .forEach((c) => c.classList.remove("selected"));
    }

    _selectChord(chord, card) {
      this._clearSelectionUi();
      card.classList.add("selected");
      this.selection = { type: "chord", id: chord.id, chord };
      this.currentChordIndex = 0;
      this._renderNowPlaying();
      this.elPlayBtn.disabled = false;
      this._configureMetronome();
    }

    _selectProgression(prog, card) {
      this._clearSelectionUi();
      card.classList.add("selected");
      this.selection = { type: "progression", id: prog.id, progression: prog };
      this.currentChordIndex = 0;
      // Preload its preferred time sig and bars/chord if the seed specifies one.
      if (prog.time_signature) this.elTimeSig.value = prog.time_signature;
      if (prog.bars_per_chord) this.elBpc.value = String(prog.bars_per_chord);
      this._renderNowPlaying();
      this.elPlayBtn.disabled = false;
      this._configureMetronome();
    }

    _renderNowPlaying() {
      if (!this.selection) {
        this.elCurName.textContent = "—";
        this.elNextWrap.classList.add("hidden");
        return;
      }
      if (this.selection.type === "chord") {
        const c = this.selection.chord;
        this.elCurName.textContent = c.display_name;
        window.ChordDiagram.renderChord(this.elCurSvg, c.frets, c.fingers);
        this.elNextWrap.classList.add("hidden");
      } else {
        const p = this.selection.progression;
        const i = this.currentChordIndex % p.chords.length;
        const c = p.chords[i];
        const nextC = p.chords[(i + 1) % p.chords.length];
        this.elCurName.textContent = c.display_name;
        window.ChordDiagram.renderChord(this.elCurSvg, c.frets, c.fingers);
        this.elNextName.textContent = nextC.display_name;
        window.ChordDiagram.renderChord(this.elNextSvg, nextC.frets, nextC.fingers, { showFingers: false });
        this.elNextWrap.classList.remove("hidden");
      }
    }

    _configureMetronome() {
      if (!this.metronome) return;
      const bpm = parseInt(this.elBpm.value, 10) || 80;
      const ts = this.elTimeSig.value;
      this.beatsPerBar = TS_BEATS[ts] || 4;
      const bpc = this.selection && this.selection.type === "progression"
        ? (parseInt(this.elBpc.value, 10) || 1) : 1;
      this.beatsPerChord = this.beatsPerBar * bpc;
      this.metronome.configure({ bpm, beatsPerBar: this.beatsPerBar, totalBars: TOTAL_BARS });
    }

    _togglePlay() {
      if (this.metronome.isRunning) this._stop();
      else this._start();
    }

    _start() {
      if (!this.selection) return;
      this._configureMetronome();
      this.currentChordIndex = 0;
      this._renderNowPlaying();

      this.session = {
        startedAtMs: Date.now(),
        startedAtIso: new Date().toISOString(),
      };
      this.elPlayBtn.textContent = "Stop";
      this.elPlayBtn.classList.add("playing");
      this.metronome.start();
      this._tickTimer();
      this.timerId = setInterval(() => this._tickTimer(), 250);
    }

    _stop() {
      if (!this.session) return;
      this.metronome.stop();
      clearInterval(this.timerId);
      this.timerId = null;

      const endedMs = Date.now();
      const durationSec = Math.max(1, Math.round((endedMs - this.session.startedAtMs) / 1000));
      this.elPlayBtn.textContent = "Start";
      this.elPlayBtn.classList.remove("playing");

      this._pendingSession = {
        started_at: this.session.startedAtIso,
        ended_at: new Date(endedMs).toISOString(),
        duration_seconds: durationSec,
        bpm: parseInt(this.elBpm.value, 10) || 80,
        time_signature: this.elTimeSig.value,
        bars_per_chord: this.selection.type === "progression"
          ? (parseInt(this.elBpc.value, 10) || 1) : 1,
        target_type: this.selection.type,
        target_id: this.selection.id,
      };
      this.session = null;
      this._showNotesModal(durationSec);
    }

    _tickTimer() {
      if (!this.session) return;
      const sec = Math.floor((Date.now() - this.session.startedAtMs) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      this.elTimer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    onBeat(beatIdx) {
      // Advance progression chord on chord-boundary beats.
      if (!this.selection || this.selection.type !== "progression") return;
      if (beatIdx === 0) return; // very first beat = first chord, already shown
      if (beatIdx % this.beatsPerChord === 0) {
        this.currentChordIndex = (this.currentChordIndex + 1) % this.selection.progression.chords.length;
        this._renderNowPlaying();
      }
    }

    _showNotesModal(durationSec) {
      const targetName = this.selection.type === "chord"
        ? this.selection.chord.display_name
        : this.selection.progression.name;
      const m = Math.floor(durationSec / 60);
      const s = durationSec % 60;
      this.elNotesSummary.innerHTML =
        `<strong>${escapeHtml(targetName)}</strong> · ${m}m ${s}s · ${this._pendingSession.bpm} bpm · ${this._pendingSession.time_signature}`;
      this.elNotesInput.value = "";
      this.elNotesModal.classList.remove("hidden");
      this.elNotesInput.focus();
    }

    async _saveSession(notes) {
      if (!this._pendingSession) return;
      const payload = { ...this._pendingSession, notes: (notes || "").trim() || null };
      this._pendingSession = null;
      this.elNotesModal.classList.add("hidden");
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert("Failed to save session: " + (err.error || res.status));
        }
      } catch (e) {
        alert("Failed to save session: " + e.message);
      }
      this.elTimer.textContent = "00:00";
      await window.History.refresh();
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.Practice = Practice;
})();

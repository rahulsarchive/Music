/* Practice flow: target selection, controls, start/stop, save session. */
(function () {
  const TS_BEATS = { "4/4": 4, "3/4": 3, "6/8": 6 };
  const TOTAL_BARS = 4;
  const AUDIO_MODE_KEY = "gpt_audio_mode";
  const VALID_AUDIO_MODES = new Set(["tick", "chord", "both"]);

  class Practice {
    constructor() {
      this.chords = [];
      this.progressions = [];
      this.routines = [];
      this.selection = null; // { type: 'chord'|'progression', id, chord, progression }
      this.metronome = null;
      this.chordAudio = null;
      this.session = null; // { startedAtMs, startedAtIso }
      this.timerId = null;
      this.currentChordIndex = 0; // for progressions
      this.beatsPerChord = 4;     // computed from time sig × bars-per-chord
      this.beatsPerBar = 4;
      this.audioMode = this._loadAudioMode();
      this.activeRoutineExerciseId = null;

      this._cacheEls();
      this._wireControls();
      this._applyAudioModeUi();
    }

    _loadAudioMode() {
      const stored = window.localStorage && localStorage.getItem(AUDIO_MODE_KEY);
      return VALID_AUDIO_MODES.has(stored) ? stored : "both";
    }

    _saveAudioMode() {
      try { localStorage.setItem(AUDIO_MODE_KEY, this.audioMode); } catch (_) {}
    }

    _cacheEls() {
      this.elChordGrid = document.getElementById("chord-grid");
      this.elProgGrid = document.getElementById("progression-grid");
      this.elRoutinesTab = document.getElementById("routines-tab");
      this.elRoutinesContent = document.getElementById("routines-content");
      this.elTabs = document.querySelectorAll(".picker > .tabs .tab");
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
      this.elAudioModeBtns = document.querySelectorAll(".audio-mode-btn");
    }

    _wireControls() {
      this.elTabs.forEach((t) => {
        t.addEventListener("click", () => this._switchTab(t.dataset.tab));
      });
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

      this.elAudioModeBtns.forEach((btn) => {
        btn.addEventListener("click", () => this._setAudioMode(btn.dataset.mode));
      });
    }

    _switchTab(name) {
      this.elTabs.forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === name);
      });
      this.elChordGrid.classList.toggle("hidden", name !== "chord");
      this.elProgGrid.classList.toggle("hidden", name !== "progression");
      this.elRoutinesTab.classList.toggle("hidden", name !== "routines");
      // Bars/chord only relevant for progression-shaped selections.
      const showBpc = name === "progression"
        || (this.selection && this.selection.type === "progression");
      this.elBpcWrap.classList.toggle("hidden", !showBpc);
    }

    setMetronome(m) { this.metronome = m; }
    setChordAudio(ca) { this.chordAudio = ca; }

    async loadData() {
      const [chords, progs, routines] = await Promise.all([
        fetch("/api/chords").then((r) => r.json()),
        fetch("/api/progressions").then((r) => r.json()),
        fetch("/api/routines").then((r) => r.json()),
      ]);
      this.chords = chords;
      this.progressions = progs;
      this.routines = routines;
      this._renderChordGrid();
      this._renderProgressionGrid();
      this._renderRoutines();
    }

    _renderChordGrid() {
      const grid = this.elChordGrid;
      grid.innerHTML = "";
      for (const c of this.chords) {
        const card = document.createElement("div");
        card.className = "chord-card";
        card.dataset.chordId = String(c.id);
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
        card.dataset.progId = String(p.id);
        const chordsHtml = p.chords.map((c) => `<span class="pchip">${escapeHtml(c.display_name)}</span>`).join("");
        card.innerHTML = `<div class="name"></div><div class="prog-meta"></div><div class="progression-chords">${chordsHtml}</div>`;
        card.querySelector(".name").textContent = p.name;
        card.querySelector(".prog-meta").textContent = `${p.time_signature} · ${p.bars_per_chord} bar${p.bars_per_chord === 1 ? "" : "s"}/chord`;
        card.addEventListener("click", () => this._selectProgression(p, card));
        if (p.is_custom) {
          const del = document.createElement("button");
          del.className = "delete-btn";
          del.textContent = "×";
          del.title = "Delete progression";
          del.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete progression "${p.name}"?`)) return;
            const res = await fetch(`/api/progressions/${p.id}`, { method: "DELETE" });
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
      const add = document.createElement("div");
      add.className = "add-card";
      add.innerHTML = `<div class="plus">+</div><div>Build progression</div>`;
      add.addEventListener("click", () => window.__openProgressionBuilder());
      grid.appendChild(add);
    }

    _renderRoutines() {
      const wrap = this.elRoutinesContent;
      wrap.innerHTML = "";

      // Grade selector
      const grades = [1, 2];
      const gradeBar = document.createElement("div");
      gradeBar.className = "grade-tabs";
      grades.forEach((g, idx) => {
        const btn = document.createElement("button");
        btn.className = "grade-tab" + (idx === 0 ? " active" : "");
        btn.textContent = `Grade ${g}`;
        btn.dataset.grade = String(g);
        btn.addEventListener("click", () => {
          gradeBar.querySelectorAll(".grade-tab").forEach((b) => b.classList.toggle("active", b === btn));
          wrap.querySelectorAll(".routine-grade").forEach((sec) => {
            sec.classList.toggle("hidden", sec.dataset.grade !== String(g));
          });
        });
        gradeBar.appendChild(btn);
      });
      wrap.appendChild(gradeBar);

      const intro = document.createElement("p");
      intro.className = "routines-intro";
      intro.textContent = "Curriculum inspired by Justin Guitar's free beginner course. Click Start on any exercise to load it into the practice area.";
      wrap.appendChild(intro);

      for (const g of grades) {
        const section = document.createElement("div");
        section.className = "routine-grade";
        section.dataset.grade = String(g);
        if (g !== grades[0]) section.classList.add("hidden");

        const modules = this.routines.filter((m) => m.grade === g);
        const totalEx = modules.reduce((s, m) => s + m.exercises.length, 0);
        const doneEx = modules.reduce(
          (s, m) => s + m.exercises.filter((e) => e.completed_at).length,
          0
        );

        const overview = document.createElement("div");
        overview.className = "grade-overview";
        overview.innerHTML = `<strong>Grade ${g}</strong> · <span class="grade-progress">${doneEx} / ${totalEx} exercises complete</span>`;
        section.appendChild(overview);

        for (const m of modules) {
          section.appendChild(this._renderModule(m));
        }
        wrap.appendChild(section);
      }
    }

    _renderModule(m) {
      const mod = document.createElement("div");
      mod.className = "routine-module";

      const done = m.exercises.filter((e) => e.completed_at).length;
      const total = m.exercises.length;

      const header = document.createElement("button");
      header.className = "module-header";
      header.innerHTML = `
        <span class="caret">▸</span>
        <span class="module-title"></span>
        <span class="module-progress">${done}/${total}</span>
      `;
      header.querySelector(".module-title").textContent = m.title;

      const body = document.createElement("div");
      body.className = "module-body hidden";

      if (m.description) {
        const desc = document.createElement("p");
        desc.className = "module-desc";
        desc.textContent = m.description;
        body.appendChild(desc);
      }

      for (const ex of m.exercises) {
        body.appendChild(this._renderExercise(ex));
      }

      header.addEventListener("click", () => {
        const open = !body.classList.contains("hidden");
        body.classList.toggle("hidden", open);
        header.querySelector(".caret").textContent = open ? "▸" : "▾";
      });

      mod.appendChild(header);
      mod.appendChild(body);
      return mod;
    }

    _renderExercise(ex) {
      const card = document.createElement("div");
      card.className = "exercise-card";
      card.dataset.exId = String(ex.id);
      if (ex.completed_at) card.classList.add("done");

      const left = document.createElement("div");
      left.className = "ex-left";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "ex-check";
      checkbox.checked = !!ex.completed_at;
      checkbox.addEventListener("change", async () => {
        await this._toggleExerciseComplete(ex, checkbox.checked, card);
      });
      left.appendChild(checkbox);

      const text = document.createElement("div");
      text.className = "ex-text";

      const title = document.createElement("div");
      title.className = "ex-title";
      title.textContent = ex.title;
      text.appendChild(title);

      if (ex.instructions) {
        const ins = document.createElement("div");
        ins.className = "ex-instructions";
        ins.textContent = ex.instructions;
        text.appendChild(ins);
      }

      const meta = document.createElement("div");
      meta.className = "ex-meta";
      const parts = [];
      if (ex.target_name) parts.push(`<span class="pchip">${escapeHtml(ex.target_name)}</span>`);
      if (ex.target_type) {
        const mins = Math.round(ex.default_duration_seconds / 60);
        const minLabel = mins >= 1 ? `${mins} min` : `${ex.default_duration_seconds}s`;
        parts.push(`${ex.default_bpm} bpm`);
        parts.push(minLabel);
        parts.push(ex.default_time_signature);
        if (ex.target_type === "progression") {
          parts.push(`${ex.default_bars_per_chord} bar${ex.default_bars_per_chord === 1 ? "" : "s"}/chord`);
        }
      } else {
        parts.push("<em>Reference</em>");
      }
      meta.innerHTML = parts.join(" · ");
      text.appendChild(meta);

      left.appendChild(text);
      card.appendChild(left);

      if (ex.target_type) {
        const startBtn = document.createElement("button");
        startBtn.className = "btn-primary btn-small";
        startBtn.textContent = "Start";
        startBtn.addEventListener("click", () => this.startExercise(ex));
        card.appendChild(startBtn);
      }

      return card;
    }

    async _toggleExerciseComplete(ex, completed, card) {
      try {
        const res = await fetch(`/api/routines/exercises/${ex.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const updated = await res.json();
        ex.completed_at = updated.completed_at;
        card.classList.toggle("done", !!ex.completed_at);
        this._updateRoutineCounters();
      } catch (e) {
        alert("Failed to update completion: " + e.message);
      }
    }

    _updateRoutineCounters() {
      // Recompute module + grade counters in-place.
      this.elRoutinesContent.querySelectorAll(".routine-module").forEach((modEl) => {
        const cards = modEl.querySelectorAll(".exercise-card");
        const total = cards.length;
        const done = modEl.querySelectorAll(".exercise-card.done").length;
        const counter = modEl.querySelector(".module-progress");
        if (counter) counter.textContent = `${done}/${total}`;
      });
      this.elRoutinesContent.querySelectorAll(".routine-grade").forEach((gradeEl) => {
        const cards = gradeEl.querySelectorAll(".exercise-card");
        const total = cards.length;
        const done = gradeEl.querySelectorAll(".exercise-card.done").length;
        const counter = gradeEl.querySelector(".grade-progress");
        if (counter) counter.textContent = `${done} / ${total} exercises complete`;
      });
    }

    startExercise(ex) {
      if (!ex.target_type) return;
      // Stop any currently running session first.
      if (this.metronome && this.metronome.isRunning) this._stop();

      this.activeRoutineExerciseId = ex.id;

      // Configure controls
      this.elBpm.value = ex.default_bpm;
      this.elBpmSlider.value = ex.default_bpm;
      this.elTimeSig.value = ex.default_time_signature;
      this.elBpc.value = String(ex.default_bars_per_chord);

      if (ex.target_type === "chord") {
        const chord = this.chords.find((c) => c.id === ex.target_id);
        if (!chord) { alert("Chord not found"); return; }
        this._switchTab("chord");
        this._clearSelectionUi();
        const card = this.elChordGrid.querySelector(`.chord-card[data-chord-id="${chord.id}"]`);
        if (card) card.classList.add("selected");
        this.selection = { type: "chord", id: chord.id, chord };
      } else {
        const prog = this.progressions.find((p) => p.id === ex.target_id);
        if (!prog) { alert("Progression not found"); return; }
        this._switchTab("progression");
        this._clearSelectionUi();
        const card = this.elProgGrid.querySelector(`.prog-card[data-prog-id="${prog.id}"]`);
        if (card) card.classList.add("selected");
        this.selection = { type: "progression", id: prog.id, progression: prog };
      }

      this.currentChordIndex = 0;
      this._renderNowPlaying();
      this.elPlayBtn.disabled = false;
      this._configureMetronome();
      this._start();
    }

    _clearSelectionUi() {
      document.querySelectorAll(".chord-card.selected, .prog-card.selected")
        .forEach((c) => c.classList.remove("selected"));
    }

    _selectChord(chord, card) {
      this._clearSelectionUi();
      card.classList.add("selected");
      this.selection = { type: "chord", id: chord.id, chord };
      this.activeRoutineExerciseId = null;
      this.currentChordIndex = 0;
      this._renderNowPlaying();
      this.elPlayBtn.disabled = false;
      this.elBpcWrap.classList.add("hidden");
      this._configureMetronome();
    }

    _selectProgression(prog, card) {
      this._clearSelectionUi();
      card.classList.add("selected");
      this.selection = { type: "progression", id: prog.id, progression: prog };
      this.activeRoutineExerciseId = null;
      this.currentChordIndex = 0;
      if (prog.time_signature) this.elTimeSig.value = prog.time_signature;
      if (prog.bars_per_chord) this.elBpc.value = String(prog.bars_per_chord);
      this.elBpcWrap.classList.remove("hidden");
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

    _setAudioMode(mode) {
      if (!VALID_AUDIO_MODES.has(mode)) return;
      this.audioMode = mode;
      this._saveAudioMode();
      this._applyAudioModeUi();
      this._applyMetronomeMuting();
    }

    _applyAudioModeUi() {
      this.elAudioModeBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === this.audioMode);
      });
    }

    _applyMetronomeMuting() {
      if (!this.metronome) return;
      this.metronome.setMuted(this.audioMode === "chord");
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
      this._applyMetronomeMuting();

      // Lazily attach a ChordAudio bound to the metronome's AudioContext.
      if (!this.chordAudio && window.ChordAudio && this.metronome) {
        // Metronome creates its audioCtx on start; ensure it exists.
        if (!this.metronome.audioCtx) {
          this.metronome.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        this.chordAudio = new window.ChordAudio(this.metronome.audioCtx);
      }

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

    onBeat(beatIdx, audioTime) {
      if (!this.selection) return;

      // Determine which chord applies to this beat (deterministic).
      let chord;
      if (this.selection.type === "chord") {
        chord = this.selection.chord;
      } else {
        const chords = this.selection.progression.chords;
        const idx = Math.floor(beatIdx / this.beatsPerChord) % chords.length;
        if (idx !== this.currentChordIndex) {
          this.currentChordIndex = idx;
          this._renderNowPlaying();
        }
        chord = chords[idx];
      }

      // Strum a downstroke on every beat — steady pulse, like a player
      // keeping time. Future strumming-pattern tab will replace this.
      if (this.chordAudio && this.audioMode !== "tick") {
        this.chordAudio.play(audioTime, chord.frets);
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
      const completedExerciseId = this.activeRoutineExerciseId;
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
        } else if (completedExerciseId) {
          // Auto-mark the routine exercise complete after a saved session.
          this._autoCompleteRoutineExercise(completedExerciseId);
          this.activeRoutineExerciseId = null;
        }
      } catch (e) {
        alert("Failed to save session: " + e.message);
      }
      this.elTimer.textContent = "00:00";
      await window.History.refresh();
    }

    async _autoCompleteRoutineExercise(exId) {
      try {
        const res = await fetch(`/api/routines/exercises/${exId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: true }),
        });
        if (!res.ok) return;
        const updated = await res.json();
        for (const m of this.routines) {
          for (const ex of m.exercises) {
            if (ex.id === exId) ex.completed_at = updated.completed_at;
          }
        }
        const card = this.elRoutinesContent.querySelector(`.exercise-card[data-ex-id="${exId}"]`);
        if (card) {
          card.classList.add("done");
          const cb = card.querySelector(".ex-check");
          if (cb) cb.checked = true;
        }
        this._updateRoutineCounters();
      } catch (_) {}
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

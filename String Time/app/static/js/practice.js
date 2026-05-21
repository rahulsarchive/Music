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
      this.chordCategories = [];
      this.progCategories = [];
      this.selection = null;
      this.metronome = null;
      this.chordAudio = null;
      this.session = null;
      this.timerId = null;
      this.currentChordIndex = 0;
      this.beatsPerChord = 4;
      this.beatsPerBar = 4;
      this.audioMode = this._loadAudioMode();
      this.activeChordCategoryId = "all";
      this.activeProgCategoryId = "all";

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
      this.elChordTabContent = document.getElementById("chord-tab-content");
      this.elProgTabContent = document.getElementById("progression-tab-content");
      this.elPracticeBuilderTab = document.getElementById("practice-builder-tab");
      this.elChordGrid = document.getElementById("chord-grid");
      this.elProgGrid = document.getElementById("progression-grid");
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
      this.elAudioModeBtns = document.querySelectorAll(".audio-mode-btn");

      // Chord category controls
      this.elChordCatBar = document.getElementById("chord-category-bar");
      this.elChordCatActions = document.getElementById("chord-cat-actions");
      this.elChordCatActionsLabel = document.getElementById("chord-cat-actions-label");
      this.elChordCatAddBtn = document.getElementById("chord-cat-add-btn");
      this.elChordCatAddChordsBtn = document.getElementById("chord-cat-add-chords-btn");
      this.elChordCatDeleteBtn = document.getElementById("chord-cat-delete-btn");

      // Progression category controls
      this.elProgCatBar = document.getElementById("prog-category-bar");
      this.elProgCatActions = document.getElementById("prog-cat-actions");
      this.elProgCatActionsLabel = document.getElementById("prog-cat-actions-label");
      this.elProgCatAddBtn = document.getElementById("prog-cat-add-btn");
      this.elProgCatAddProgsBtn = document.getElementById("prog-cat-add-progs-btn");
      this.elProgCatDeleteBtn = document.getElementById("prog-cat-delete-btn");
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
      this.elAudioModeBtns.forEach((btn) => {
        btn.addEventListener("click", () => this._setAudioMode(btn.dataset.mode));
      });

      // Chord categories
      this.elChordCatAddBtn.addEventListener("click", () => this._promptNewChordCategory());
      this.elChordCatAddChordsBtn.addEventListener("click", () => this._openChordCatPicker());
      this.elChordCatDeleteBtn.addEventListener("click", () => this._deleteCurrentChordCategory());

      // Progression categories
      this.elProgCatAddBtn.addEventListener("click", () => this._promptNewProgCategory());
      this.elProgCatAddProgsBtn.addEventListener("click", () => this._openProgCatPicker());
      this.elProgCatDeleteBtn.addEventListener("click", () => this._deleteCurrentProgCategory());

      // Chord category picker modal
      document.getElementById("chord-cat-picker-close").addEventListener("click", () => {
        document.getElementById("chord-cat-picker-modal").classList.add("hidden");
      });
      document.getElementById("chord-cat-picker-done").addEventListener("click", () => {
        document.getElementById("chord-cat-picker-modal").classList.add("hidden");
      });

      // Progression category picker modal
      document.getElementById("prog-cat-picker-close").addEventListener("click", () => {
        document.getElementById("prog-cat-picker-modal").classList.add("hidden");
      });
      document.getElementById("prog-cat-picker-done").addEventListener("click", () => {
        document.getElementById("prog-cat-picker-modal").classList.add("hidden");
      });
    }

    _switchTab(name) {
      this.elTabs.forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === name);
      });
      this.elChordTabContent.classList.toggle("hidden", name !== "chord");
      this.elProgTabContent.classList.toggle("hidden", name !== "progression");
      this.elPracticeBuilderTab.classList.toggle("hidden", name !== "practice-builder");

      const showBpc = name === "progression"
        || (this.selection && this.selection.type === "progression");
      this.elBpcWrap.classList.toggle("hidden", !showBpc);
    }

    setMetronome(m) { this.metronome = m; }
    setChordAudio(ca) { this.chordAudio = ca; }

    async loadData() {
      const [chords, progs, chordCats, progCats] = await Promise.all([
        fetch("/api/chords").then((r) => r.json()),
        fetch("/api/progressions").then((r) => r.json()),
        fetch("/api/chord-categories").then((r) => r.json()),
        fetch("/api/progression-categories").then((r) => r.json()),
      ]);
      this.chords = chords;
      this.progressions = progs;
      this.chordCategories = chordCats;
      this.progCategories = progCats;
      this._renderChordCategoryBar();
      this._renderChordGrid();
      this._renderProgCategoryBar();
      this._renderProgressionGrid();
    }

    // ---------- Chord Category Bar ----------

    _renderChordCategoryBar() {
      const bar = this.elChordCatBar;
      // Remove existing category pills (keep the "All" pill and the add button)
      bar.querySelectorAll(".cat-pill:not([data-cat-id='all'])").forEach((el) => el.remove());

      // Re-insert category pills before the add button
      for (const cat of this.chordCategories) {
        const pill = document.createElement("button");
        pill.className = "cat-pill" + (String(this.activeChordCategoryId) === String(cat.id) ? " active" : "");
        pill.dataset.catId = String(cat.id);
        pill.textContent = cat.name;
        pill.addEventListener("click", () => this._selectChordCategory(cat.id));
        this.elChordCatAddBtn.before(pill);
      }

      // Ensure "All" pill is wired
      const allPill = bar.querySelector(".cat-pill[data-cat-id='all']");
      allPill.className = "cat-pill" + (this.activeChordCategoryId === "all" ? " active" : "");
      allPill.onclick = () => this._selectChordCategory("all");
    }

    _selectChordCategory(catId) {
      this.activeChordCategoryId = catId;
      this.elChordCatBar.querySelectorAll(".cat-pill").forEach((p) => {
        p.classList.toggle("active", String(p.dataset.catId) === String(catId));
      });
      if (catId === "all") {
        this.elChordCatActions.classList.add("hidden");
      } else {
        const cat = this.chordCategories.find((c) => String(c.id) === String(catId));
        if (cat) {
          this.elChordCatActionsLabel.textContent = cat.name;
          this.elChordCatActions.classList.remove("hidden");
        }
      }
      this._renderChordGrid();
    }

    async _promptNewChordCategory() {
      const name = prompt("New category name:");
      if (!name || !name.trim()) return;
      const res = await fetch("/api/chord-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        await this.loadData();
        const cat = this.chordCategories.find((c) => c.name === name.trim());
        if (cat) this._selectChordCategory(cat.id);
      } else {
        const err = await res.json().catch(() => ({}));
        alert("Failed: " + (err.error || res.status));
      }
    }

    async _deleteCurrentChordCategory() {
      const cat = this.chordCategories.find((c) => String(c.id) === String(this.activeChordCategoryId));
      if (!cat) return;
      if (!confirm(`Delete category "${cat.name}"? The chords in it will not be deleted.`)) return;
      const res = await fetch(`/api/chord-categories/${cat.id}`, { method: "DELETE" });
      if (res.ok) {
        this.activeChordCategoryId = "all";
        await this.loadData();
      } else {
        alert("Delete failed");
      }
    }

    _openChordCatPicker() {
      const cat = this.chordCategories.find((c) => String(c.id) === String(this.activeChordCategoryId));
      if (!cat) return;
      const modal = document.getElementById("chord-cat-picker-modal");
      document.getElementById("chord-cat-picker-title").textContent = `Add chords to "${cat.name}"`;
      const grid = document.getElementById("chord-cat-picker-grid");
      grid.innerHTML = "";
      for (const chord of this.chords) {
        const inCat = cat.chord_ids.includes(chord.id);
        const chip = document.createElement("button");
        chip.className = "cat-picker-chip" + (inCat ? " selected" : "");
        chip.textContent = chord.display_name;
        chip.addEventListener("click", async () => {
          const isIn = cat.chord_ids.includes(chord.id);
          if (isIn) {
            await fetch(`/api/chord-categories/${cat.id}/chords/${chord.id}`, { method: "DELETE" });
            cat.chord_ids = cat.chord_ids.filter((id) => id !== chord.id);
            chip.classList.remove("selected");
          } else {
            await fetch(`/api/chord-categories/${cat.id}/chords`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chord_id: chord.id }),
            });
            cat.chord_ids.push(chord.id);
            chip.classList.add("selected");
          }
          this._renderChordGrid();
        });
        grid.appendChild(chip);
      }
      modal.classList.remove("hidden");
    }

    // ---------- Progression Category Bar ----------

    _renderProgCategoryBar() {
      const bar = this.elProgCatBar;
      bar.querySelectorAll(".cat-pill:not([data-cat-id='all'])").forEach((el) => el.remove());

      for (const cat of this.progCategories) {
        const pill = document.createElement("button");
        pill.className = "cat-pill" + (String(this.activeProgCategoryId) === String(cat.id) ? " active" : "");
        pill.dataset.catId = String(cat.id);
        pill.textContent = cat.name;
        pill.addEventListener("click", () => this._selectProgCategory(cat.id));
        this.elProgCatAddBtn.before(pill);
      }

      const allPill = bar.querySelector(".cat-pill[data-cat-id='all']");
      allPill.className = "cat-pill" + (this.activeProgCategoryId === "all" ? " active" : "");
      allPill.onclick = () => this._selectProgCategory("all");
    }

    _selectProgCategory(catId) {
      this.activeProgCategoryId = catId;
      this.elProgCatBar.querySelectorAll(".cat-pill").forEach((p) => {
        p.classList.toggle("active", String(p.dataset.catId) === String(catId));
      });
      if (catId === "all") {
        this.elProgCatActions.classList.add("hidden");
      } else {
        const cat = this.progCategories.find((c) => String(c.id) === String(catId));
        if (cat) {
          this.elProgCatActionsLabel.textContent = cat.name;
          this.elProgCatActions.classList.remove("hidden");
        }
      }
      this._renderProgressionGrid();
    }

    async _promptNewProgCategory() {
      const name = prompt("New category name:");
      if (!name || !name.trim()) return;
      const res = await fetch("/api/progression-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        await this.loadData();
        const cat = this.progCategories.find((c) => c.name === name.trim());
        if (cat) this._selectProgCategory(cat.id);
      } else {
        const err = await res.json().catch(() => ({}));
        alert("Failed: " + (err.error || res.status));
      }
    }

    async _deleteCurrentProgCategory() {
      const cat = this.progCategories.find((c) => String(c.id) === String(this.activeProgCategoryId));
      if (!cat) return;
      if (!confirm(`Delete category "${cat.name}"? The progressions in it will not be deleted.`)) return;
      const res = await fetch(`/api/progression-categories/${cat.id}`, { method: "DELETE" });
      if (res.ok) {
        this.activeProgCategoryId = "all";
        await this.loadData();
      } else {
        alert("Delete failed");
      }
    }

    _openProgCatPicker() {
      const cat = this.progCategories.find((c) => String(c.id) === String(this.activeProgCategoryId));
      if (!cat) return;
      const modal = document.getElementById("prog-cat-picker-modal");
      document.getElementById("prog-cat-picker-title").textContent = `Add progressions to "${cat.name}"`;
      const list = document.getElementById("prog-cat-picker-list");
      list.innerHTML = "";
      for (const prog of this.progressions) {
        const inCat = cat.progression_ids.includes(prog.id);
        const chip = document.createElement("button");
        chip.className = "cat-picker-chip" + (inCat ? " selected" : "");
        chip.textContent = prog.name;
        chip.addEventListener("click", async () => {
          const isIn = cat.progression_ids.includes(prog.id);
          if (isIn) {
            await fetch(`/api/progression-categories/${cat.id}/progressions/${prog.id}`, { method: "DELETE" });
            cat.progression_ids = cat.progression_ids.filter((id) => id !== prog.id);
            chip.classList.remove("selected");
          } else {
            await fetch(`/api/progression-categories/${cat.id}/progressions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ progression_id: prog.id }),
            });
            cat.progression_ids.push(prog.id);
            chip.classList.add("selected");
          }
          this._renderProgressionGrid();
        });
        list.appendChild(chip);
      }
      modal.classList.remove("hidden");
    }

    // ---------- Chord Grid ----------

    _renderChordGrid() {
      const grid = this.elChordGrid;
      grid.innerHTML = "";

      let visibleChords = this.chords;
      if (this.activeChordCategoryId !== "all") {
        const cat = this.chordCategories.find((c) => String(c.id) === String(this.activeChordCategoryId));
        if (cat) visibleChords = this.chords.filter((c) => cat.chord_ids.includes(c.id));
      }

      for (const c of visibleChords) {
        grid.appendChild(this._buildChordCard(c));
      }

      const add = document.createElement("div");
      add.className = "add-card";
      add.innerHTML = `<div class="plus">+</div><div>Add custom</div>`;
      add.addEventListener("click", () => window.__openChordBuilder());
      grid.appendChild(add);

      this._updateLibraryStats(visibleChords);
    }

    _buildChordCard(c) {
      const card = document.createElement("div");
      card.className = "chord-card";
      card.dataset.chordId = String(c.id);
      const tag = this._chordTag(c);
      // MOCK: accuracy + bpm trend — see BACKEND_TODO.md §2
      const accuracy = window.Dashboard ? window.Dashboard.mockChordAccuracy(c) : 0;
      const trend = window.Dashboard ? window.Dashboard.mockChordTrend(c) : [];
      const delta = trend.length ? trend[trend.length - 1] - trend[0] : 0;
      const secs = c.total_practice_seconds || 0;
      const timeStr = secs >= 60 ? window.Widgets.fmtDuration(secs) : (secs > 0 ? `${secs}s` : "0m");
      // MOCK plays count — BACKEND_TODO.md §3
      const plays = secs > 0 ? Math.max(1, Math.round(secs / 120)) : 0;
      const accClass = accuracy > 0.9 ? "pos" : accuracy < 0.75 ? "low" : "";
      const accVal = secs > 0 ? Math.round(accuracy * 100) : "—";
      const lastBpm = c.last_bpm ? c.last_bpm : "—";

      card.innerHTML = `
        <div class="cc-head">
          <div>
            <div class="cc-name"></div>
            <span class="cc-tag"></span>
          </div>
          <div class="cc-acc">
            <div class="cc-acc-val ${accClass}">${accVal}</div>
            <div class="st-cap-sm cc-acc-label">acc.</div>
          </div>
        </div>
        <div class="cc-diagram"><svg class="mini" viewBox="0 0 140 170"></svg></div>
        <div class="cc-trend">
          <div class="row">
            <span class="st-cap-sm">BPM TREND · 10 LAST</span>
            <span class="delta ${delta < 0 ? "neg" : ""}">${delta >= 0 ? "+" : ""}${delta}</span>
          </div>
          <div class="cc-spark-host"></div>
        </div>
        <div class="cc-stats">
          <div class="cc-stat"><div class="v st-mono">${timeStr}</div><div class="l">total</div></div>
          <div class="cc-stat"><div class="v st-mono">${lastBpm}</div><div class="l">bpm</div></div>
          <div class="cc-stat"><div class="v st-mono">${plays}</div><div class="l">plays</div></div>
        </div>
      `;
      card.querySelector(".cc-name").textContent = c.display_name;
      card.querySelector(".cc-tag").textContent = tag;
      const svg = card.querySelector("svg.mini");
      window.ChordDiagram.renderChord(svg, c.frets, c.fingers, { showFingers: true, accent: true });
      if (trend.length && window.Widgets) {
        window.Widgets.sparkline(card.querySelector(".cc-spark-host"), trend, { stroke: "var(--accent)", w: 220, h: 22 });
      }
      card.addEventListener("click", () => this._selectChord(c, card));

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.textContent = "×";
      del.title = "Delete chord";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete chord "${c.display_name}"?`)) return;
        const res = await fetch(`/api/chords/${c.id}`, { method: "DELETE" });
        if (res.ok) { await this.loadData(); }
        else { const err = await res.json().catch(() => ({})); alert("Delete failed: " + (err.error || res.status)); }
      });
      card.appendChild(del);
      return card;
    }

    _chordTag(c) {
      const name = (c.display_name || "").toLowerCase();
      if (name.includes("maj7")) return "maj7";
      if (name.includes("sus")) return "sus";
      if (name.includes("add")) return "color";
      if (name.includes("m7")) return "min7";
      if (/[a-g]m\b/.test(name)) return "minor";
      if (name.includes("7")) return "7th";
      const frets = (c.frets || []).filter((f) => f != null && f > 0);
      if (frets.length && Math.min(...frets) >= 1 && (c.frets || []).every((f) => f !== 0 && f !== -1)) return "barre";
      if (frets.some((f) => f > 4)) return "barre";
      return "open";
    }

    _updateLibraryStats(chords) {
      const totalSec = (this.chords || []).reduce((s, c) => s + (c.total_practice_seconds || 0), 0);
      const accs = (this.chords || [])
        .filter((c) => (c.total_practice_seconds || 0) > 0)
        .map((c) => window.Dashboard ? window.Dashboard.mockChordAccuracy(c) : 0);
      const avgAcc = accs.length ? (accs.reduce((a, b) => a + b, 0) / accs.length) : 0;
      const countEl = document.getElementById("library-count");
      const timeEl = document.getElementById("library-total-time");
      const accEl = document.getElementById("library-avg-accuracy");
      if (countEl) countEl.textContent = `·  ${this.chords.length}`;
      if (timeEl && window.Widgets) timeEl.textContent = window.Widgets.fmtDuration(totalSec);
      if (accEl) accEl.textContent = accs.length ? `${Math.round(avgAcc * 100)}%` : "—";
    }

    _buildChordStatsHtml(c) {
      const secs = c.total_practice_seconds || 0;
      if (secs === 0 && !c.last_bpm) return "";
      const mins = Math.floor(secs / 60);
      const timeStr = mins >= 60
        ? `${Math.floor(mins / 60)}h ${mins % 60}m`
        : mins >= 1 ? `${mins}m` : `${secs}s`;
      const bpmStr = c.last_bpm ? `${c.last_bpm} bpm` : "";
      const parts = [];
      if (secs > 0) parts.push(timeStr);
      if (bpmStr) parts.push(bpmStr);
      if (!parts.length) return "";
      return `<div class="chord-stats">${parts.join(" · ")}</div>`;
    }

    // ---------- Progression Grid ----------

    _renderProgressionGrid() {
      const grid = this.elProgGrid;
      grid.innerHTML = "";

      let visibleProgs = this.progressions;
      if (this.activeProgCategoryId !== "all") {
        const cat = this.progCategories.find((c) => String(c.id) === String(this.activeProgCategoryId));
        if (cat) visibleProgs = this.progressions.filter((p) => cat.progression_ids.includes(p.id));
      }

      for (const p of visibleProgs) {
        const card = document.createElement("div");
        card.className = "prog-card";
        card.dataset.progId = String(p.id);
        const chordsHtml = p.chords.slice(0, 12).map((c) => `<span class="pchip">${escapeHtml(c.display_name)}</span>`).join("");
        const more = p.chords.length > 12 ? `<span class="pchip" style="background:transparent;border:none;color:var(--ink-3);">+${p.chords.length - 12}</span>` : "";
        // MOCK progression stats — see BACKEND_TODO.md §3
        const trend = [2, 3, 2, 4, 3, 5, 4, 5, 6, 5];
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <div class="name"></div>
              <div class="prog-meta"></div>
            </div>
          </div>
          <div class="progression-chords">${chordsHtml}${more}</div>
          <div class="pc-stats">
            <div class="pc-stat"><div class="v">—</div><div class="l">total</div></div>
            <div class="pc-stat"><div class="v">—</div><div class="l">last bpm</div></div>
            <div class="pc-stat"><div class="v">—</div><div class="l">plays</div></div>
            <div class="pc-spark"></div>
          </div>
        `;
        card.querySelector(".name").textContent = p.name;
        card.querySelector(".prog-meta").textContent = `${p.time_signature} · ${p.bars_per_chord} bar${p.bars_per_chord === 1 ? "" : "s"}/chord · ${p.chords.length} chords`;
        if (window.Widgets) window.Widgets.sparkline(card.querySelector(".pc-spark"), trend, { stroke: "var(--accent)", w: 60, h: 22 });
        card.addEventListener("click", () => this._selectProgression(p, card));

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
        grid.appendChild(card);
      }

      const add = document.createElement("div");
      add.className = "add-card";
      add.innerHTML = `<div class="plus">+</div><div>Build progression</div>`;
      add.addEventListener("click", () => window.__openProgressionBuilder());
      grid.appendChild(add);
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
      this.elBpcWrap.classList.add("hidden");
      this._configureMetronome();
    }

    _selectProgression(prog, card) {
      this._clearSelectionUi();
      card.classList.add("selected");
      this.selection = { type: "progression", id: prog.id, progression: prog };
      this.currentChordIndex = 0;
      if (prog.time_signature) this.elTimeSig.value = prog.time_signature;
      if (prog.bars_per_chord) this.elBpc.value = String(prog.bars_per_chord);
      this.elBpcWrap.classList.remove("hidden");
      this._renderNowPlaying();
      this.elPlayBtn.disabled = false;
      this._configureMetronome();
    }

    _renderNowPlaying(flash) {
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
      if (flash && window.Widgets) {
        // Slide-in chord change animation
        const cur = document.querySelector(".current-wrap");
        const nxt = document.querySelector(".next-wrap");
        window.Widgets.chordChangeAnimate(cur, nxt);
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
      this._updateBarChordLabels(0);
    }

    _updateBarChordLabels(beatIdxAtLoopStart) {
      if (!this.metronome) return;
      if (!this.selection) { this.metronome.setBarChords([]); return; }
      const labels = [];
      if (this.selection.type === "chord") {
        const name = this.selection.chord.display_name;
        for (let i = 0; i < TOTAL_BARS; i++) labels.push(name);
      } else {
        const chords = this.selection.progression.chords;
        for (let i = 0; i < TOTAL_BARS; i++) {
          const beatAtBarStart = beatIdxAtLoopStart + i * this.beatsPerBar;
          const idx = Math.floor(beatAtBarStart / this.beatsPerChord) % chords.length;
          labels.push(chords[idx].display_name);
        }
      }
      this.metronome.setBarChords(labels);
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

      if (!this.chordAudio && window.ChordAudio && this.metronome) {
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
      this.elPlayBtn.classList.add("playing", "is-stop");
      document.body.classList.add("is-playing");
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
      this.elPlayBtn.classList.remove("playing", "is-stop");
      document.body.classList.remove("is-playing");

      const payload = {
        started_at: this.session.startedAtIso,
        ended_at: new Date(endedMs).toISOString(),
        duration_seconds: durationSec,
        bpm: parseInt(this.elBpm.value, 10) || 80,
        time_signature: this.elTimeSig.value,
        bars_per_chord: this.selection.type === "progression"
          ? (parseInt(this.elBpc.value, 10) || 1) : 1,
        target_type: this.selection.type,
        target_id: this.selection.id,
        notes: null,
      };
      this.session = null;

      // Builder-item end callback fires AFTER saving so the builder can update its UI
      const cb = this._builderItemEndCallback;
      const natural = !!this._builderItemNaturalEnd;
      this._builderItemEndCallback = null;
      this._builderItemNaturalEnd = false;
      this.targetDurationSec = null;

      this._saveSession(payload).then(() => {
        if (cb) cb(natural ? "complete" : "abort");
      });
    }

    _tickTimer() {
      if (!this.session) return;
      const elapsedSec = Math.floor((Date.now() - this.session.startedAtMs) / 1000);

      if (this.targetDurationSec) {
        const remaining = Math.max(0, this.targetDurationSec - elapsedSec);
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        this.elTimer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        if (remaining <= 0) {
          // Natural completion — flag and stop
          this._builderItemNaturalEnd = true;
          this._stop();
        }
      } else {
        const m = Math.floor(elapsedSec / 60);
        const s = elapsedSec % 60;
        this.elTimer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
    }

    onBeat(beatIdx, audioTime) {
      if (!this.selection) return;

      // Refresh the bar chord overlay at the start of each visual 4-bar loop
      const totalBeatsPerLoop = TOTAL_BARS * this.beatsPerBar;
      if (beatIdx % totalBeatsPerLoop === 0) {
        this._updateBarChordLabels(beatIdx);
      }

      let chord;
      if (this.selection.type === "chord") {
        chord = this.selection.chord;
      } else {
        const chords = this.selection.progression.chords;
        const idx = Math.floor(beatIdx / this.beatsPerChord) % chords.length;
        if (idx !== this.currentChordIndex) {
          this.currentChordIndex = idx;
          this._renderNowPlaying(true);
        }
        chord = chords[idx];
      }

      if (this.chordAudio && this.audioMode !== "tick"
          && beatIdx % this.beatsPerBar === 0) {
        this.chordAudio.play(audioTime, chord.frets);
      }
    }

    async _saveSession(payload) {
      try {
        await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (_) {}
      this.elTimer.textContent = "00:00";
      // Reload chord stats
      await this.loadData();
      await window.History.refresh();
    }

    // Called by practice-session-builder when starting an item.
    // Stays on the practice-builder tab; runs the metronome for the item's
    // configured duration and invokes onEnd("complete"|"abort") when done.
    startBuilderItem(item, onEnd) {
      if (this.metronome && this.metronome.isRunning) this._stop();

      this.elBpm.value = item.bpm;
      this.elBpmSlider.value = item.bpm;
      this.elTimeSig.value = item.time_signature;
      this.elBpc.value = String(item.bars_per_chord);

      if (item.target_type === "chord") {
        const chord = this.chords.find((c) => c.id === item.target_id);
        if (!chord) { alert("Chord not found"); return; }
        this.selection = { type: "chord", id: chord.id, chord };
        this.elBpcWrap.classList.add("hidden");
      } else {
        const prog = this.progressions.find((p) => p.id === item.target_id);
        if (!prog) { alert("Progression not found"); return; }
        this.selection = { type: "progression", id: prog.id, progression: prog };
        this.elBpcWrap.classList.remove("hidden");
      }

      // Clear card-grid "selected" state — we're not on those tabs and
      // the builder item is the source of truth for what's playing.
      this._clearSelectionUi();

      this.currentChordIndex = 0;
      this._renderNowPlaying();
      this.elPlayBtn.disabled = false;
      this._configureMetronome();

      this.targetDurationSec = item.duration_seconds;
      this._builderItemEndCallback = onEnd || null;
      this._builderItemNaturalEnd = false;

      this._start();
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

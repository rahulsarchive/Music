/* Custom progression builder modal.
 *
 * Two columns: searchable chord palette on the left, ordered chip list on the
 * right. Drag-and-drop reorder via HTML5 dnd. Save POSTs to /api/progressions.
 */
(function () {
  class ProgressionBuilder {
    constructor({
      modalEl, paletteEl, searchEl, sequenceEl, nameInput,
      tsSelect, bpcSelect, saveBtn, cancelBtn, closeBtn, onSave,
    }) {
      this.modalEl = modalEl;
      this.paletteEl = paletteEl;
      this.searchEl = searchEl;
      this.sequenceEl = sequenceEl;
      this.nameInput = nameInput;
      this.tsSelect = tsSelect;
      this.bpcSelect = bpcSelect;
      this.saveBtn = saveBtn;
      this.cancelBtn = cancelBtn;
      this.closeBtn = closeBtn;
      this.onSave = onSave || (() => {});

      this.chords = [];       // full chord list from /api/chords
      this.sequence = [];     // selected chord refs (in order)
      this.dragIndex = null;

      this.searchEl.addEventListener("input", () => this._renderPalette());
      this.saveBtn.addEventListener("click", () => this._save());
      this.cancelBtn.addEventListener("click", () => this.hide());
      if (this.closeBtn) this.closeBtn.addEventListener("click", () => this.hide());
      this.modalEl.addEventListener("click", (e) => {
        if (e.target === this.modalEl) this.hide();
      });
    }

    async show() {
      // Reset state
      this.sequence = [];
      this.nameInput.value = "";
      this.tsSelect.value = "4/4";
      this.bpcSelect.value = "1";
      this.searchEl.value = "";

      // Refresh chord list
      try {
        const res = await fetch("/api/chords");
        this.chords = await res.json();
      } catch (e) {
        alert("Failed to load chords: " + e.message);
        return;
      }

      this._renderPalette();
      this._renderSequence();
      this.modalEl.classList.remove("hidden");
      this.nameInput.focus();
    }

    hide() {
      this.modalEl.classList.add("hidden");
    }

    _renderPalette() {
      const q = (this.searchEl.value || "").trim().toLowerCase();
      this.paletteEl.innerHTML = "";
      const filtered = q
        ? this.chords.filter((c) => c.display_name.toLowerCase().includes(q))
        : this.chords;
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "palette-empty";
        empty.textContent = "No chords match.";
        this.paletteEl.appendChild(empty);
        return;
      }
      for (const c of filtered) {
        const item = document.createElement("button");
        item.className = "palette-chord";
        item.type = "button";
        item.textContent = c.display_name;
        item.title = "Append to progression";
        item.addEventListener("click", () => {
          this.sequence.push(c);
          this._renderSequence();
        });
        this.paletteEl.appendChild(item);
      }
    }

    _renderSequence() {
      this.sequenceEl.innerHTML = "";
      if (!this.sequence.length) {
        const empty = document.createElement("div");
        empty.className = "sequence-empty";
        empty.textContent = "Click chords on the left to build your progression.";
        this.sequenceEl.appendChild(empty);
        return;
      }
      this.sequence.forEach((c, i) => {
        const chip = document.createElement("div");
        chip.className = "seq-chip";
        chip.draggable = true;
        chip.dataset.idx = String(i);

        const label = document.createElement("span");
        label.textContent = `${i + 1}. ${c.display_name}`;
        chip.appendChild(label);

        const rm = document.createElement("button");
        rm.className = "seq-chip-rm";
        rm.type = "button";
        rm.textContent = "×";
        rm.title = "Remove";
        rm.addEventListener("click", (e) => {
          e.stopPropagation();
          this.sequence.splice(i, 1);
          this._renderSequence();
        });
        chip.appendChild(rm);

        chip.addEventListener("dragstart", (e) => {
          this.dragIndex = i;
          chip.classList.add("dragging");
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        });
        chip.addEventListener("dragend", () => {
          chip.classList.remove("dragging");
          this.dragIndex = null;
        });
        chip.addEventListener("dragover", (e) => {
          e.preventDefault();
          chip.classList.add("drop-target");
        });
        chip.addEventListener("dragleave", () => {
          chip.classList.remove("drop-target");
        });
        chip.addEventListener("drop", (e) => {
          e.preventDefault();
          chip.classList.remove("drop-target");
          const from = this.dragIndex;
          const to = i;
          if (from === null || from === to) return;
          const moved = this.sequence.splice(from, 1)[0];
          this.sequence.splice(to, 0, moved);
          this._renderSequence();
        });

        this.sequenceEl.appendChild(chip);
      });
    }

    async _save() {
      const name = (this.nameInput.value || "").trim();
      if (!name) {
        alert("Please give the progression a name.");
        this.nameInput.focus();
        return;
      }
      if (!this.sequence.length) {
        alert("Add at least one chord.");
        return;
      }
      const payload = {
        name,
        chord_ids: this.sequence.map((c) => c.id),
        time_signature: this.tsSelect.value,
        bars_per_chord: parseInt(this.bpcSelect.value, 10) || 1,
      };
      try {
        const res = await fetch("/api/progressions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert("Save failed: " + (err.error || res.status));
          return;
        }
        this.hide();
        await this.onSave();
      } catch (e) {
        alert("Save failed: " + e.message);
      }
    }
  }

  window.ProgressionBuilder = ProgressionBuilder;
})();

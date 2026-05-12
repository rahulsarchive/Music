/* Boot: wire modules together. */
(function () {
  document.addEventListener("DOMContentLoaded", async () => {
    const practice = new window.Practice();

    const metronome = new window.Metronome({
      svg: document.getElementById("bar-svg"),
      onBeat: (beatIdx, audioTime, ctx) => practice.onBeat(beatIdx, audioTime, ctx),
    });
    practice.setMetronome(metronome);

    const builder = new window.ChordBuilder({
      modalEl: document.getElementById("chord-builder-modal"),
      svgEl: document.getElementById("builder-svg"),
      nameInput: document.getElementById("builder-name"),
      textInput: document.getElementById("builder-text"),
      clearBtn: document.getElementById("builder-clear"),
      saveBtn: document.getElementById("builder-save"),
      closeBtn: document.getElementById("chord-builder-close"),
      onSave: async () => {
        await practice.loadData();
      },
    });
    window.__openChordBuilder = () => builder.show();

    await Promise.all([
      practice.loadData(),
      window.History.refresh(),
    ]);
  });
})();

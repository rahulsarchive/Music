/* Boot: wire modules together. */
(function () {
  document.addEventListener("DOMContentLoaded", async () => {
    const practice = new window.Practice();
    window._practiceInstance = practice;

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
        sessionBuilder.setData(practice.chords, practice.progressions);
      },
    });
    window.__openChordBuilder = () => builder.show();

    const progBuilder = new window.ProgressionBuilder({
      modalEl: document.getElementById("progression-builder-modal"),
      paletteEl: document.getElementById("prog-builder-palette"),
      searchEl: document.getElementById("prog-builder-search"),
      sequenceEl: document.getElementById("prog-builder-sequence"),
      nameInput: document.getElementById("prog-builder-name"),
      tsSelect: document.getElementById("prog-builder-ts"),
      bpcSelect: document.getElementById("prog-builder-bpc"),
      saveBtn: document.getElementById("prog-builder-save"),
      cancelBtn: document.getElementById("prog-builder-cancel"),
      closeBtn: document.getElementById("prog-builder-close"),
      onSave: async () => {
        await practice.loadData();
        sessionBuilder.setData(practice.chords, practice.progressions);
      },
    });
    window.__openProgressionBuilder = () => progBuilder.show();

    const sessionBuilder = new window.PracticeSessionBuilder();

    await Promise.all([
      practice.loadData(),
      window.History.refresh(),
    ]);

    sessionBuilder.setData(practice.chords, practice.progressions);
    await sessionBuilder.load();
  });
})();

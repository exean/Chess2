/* Populates the piece-set selector in the top bar (if present) and persists
 * the user's choice. Included on every page that has a board or might host
 * one in the future. */
(function () {
  if (!window.Chess2Pieces) return;
  const select = document.getElementById('pieces-select');
  if (!select) return;

  function populate() {
    const sets = window.Chess2Pieces.listSets();
    const current = select.value || window.Chess2Pieces.getPreferred();
    select.innerHTML = '';
    for (const s of sets) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    }
    select.value = sets.some((s) => s.id === current) ? current : 'unicode';
  }
  populate();
  window.addEventListener('chess2:pieceset-listchanged', populate);
  select.addEventListener('change', () => {
    window.Chess2Pieces.setPreferred(select.value);
  });
})();

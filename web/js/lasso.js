/**
 * lasso.js — Freehand lasso selection tool
 */

const Lasso = (() => {

  let svg, path, points;
  let isActive = false;

  function init() {
    svg = document.getElementById('lasso-overlay');

    // Create path element for the lasso stroke
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'rgba(79, 142, 247, 0.08)');
    path.setAttribute('stroke', 'rgba(79, 142, 247, 0.8)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-dasharray', '4 2');
    svg.appendChild(path);

    svg.addEventListener('mousedown', _onMouseDown);
    svg.addEventListener('mousemove', _onMouseMove);
    svg.addEventListener('mouseup',   _onMouseUp);
  }

  // ── Mode toggle ───────────────────────────────────────────────────────────────

  function enable() {
    APP.mode = 'lasso';
    svg.style.display = 'block';
    svg.style.cursor  = 'crosshair';
    document.getElementById('lasso-mode-selector').classList.remove('hidden');
  }

  function disable() {
    APP.mode = 'pan';
    svg.style.display = 'none';
    document.getElementById('lasso-mode-selector').classList.add('hidden');
    cancel();
  }

  // ── Draw handlers ─────────────────────────────────────────────────────────────

  function _onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();

    isActive = true;
    APP.isDrawingLasso = true;
    points = [[e.offsetX, e.offsetY]];
    _updatePath();
  }

  function _onMouseMove(e) {
    if (!isActive) return;
    points.push([e.offsetX, e.offsetY]);
    _updatePath();
  }

  function _onMouseUp(e) {
    if (!isActive) return;
    isActive = false;
    APP.isDrawingLasso = false;

    _finishSelection();

    // Clear the lasso path visual
    path.setAttribute('d', '');
    points = [];
  }

  function _updatePath() {
    if (!points || points.length < 2) return;
    const d = 'M' + points.map(p => p.join(',')).join('L') + 'Z';
    path.setAttribute('d', d);
  }

  // ── Selection logic ───────────────────────────────────────────────────────────

  function _finishSelection() {
    if (!points || points.length < 3) return;

    const selected = new Set();

    for (const paper of APP.filteredPapers) {
      const [sx, sy] = Canvas.paperToScreen(paper);
      if (_pointInPolygon(sx, sy, points)) {
        selected.add(paper.arxiv_id);
      }
    }

    switch (APP.lassoMode) {
      case 'replace':
        APP.selectedPapers = selected;
        break;
      case 'add':
        selected.forEach(id => APP.selectedPapers.add(id));
        break;
      case 'subtract':
        selected.forEach(id => APP.selectedPapers.delete(id));
        break;
    }

    Canvas.render();
    UI.updateSelectionInfo();
  }

  /**
   * Ray-casting algorithm: test if point (px, py) is inside polygon.
   * @param {number} px
   * @param {number} py
   * @param {Array<[number,number]>} polygon
   * @returns {boolean}
   */
  function _pointInPolygon(px, py, polygon) {
    let inside = false;
    const n = polygon.length;
    let j = n - 1;

    for (let i = 0; i < n; i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];

      const intersect =
        ((yi > py) !== (yj > py)) &&
        (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);

      if (intersect) inside = !inside;
      j = i;
    }
    return inside;
  }

  /** Cancel in-progress lasso draw. */
  function cancel() {
    isActive = false;
    APP.isDrawingLasso = false;
    if (path) path.setAttribute('d', '');
    points = [];
  }

  return { init, enable, disable, cancel };
})();

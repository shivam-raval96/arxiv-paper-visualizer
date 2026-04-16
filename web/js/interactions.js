/**
 * interactions.js — D3 zoom/pan and mouse event handling
 */

const Interactions = (() => {

  let zoom;

  function init() {
    const canvas = document.getElementById('main-canvas');

    // ── D3 Zoom ───────────────────────────────────────────────────────────────
    zoom = d3.zoom()
      .scaleExtent([0.3, 20])
      .filter(event => {
        // In lasso mode, disable zoom/pan so lasso can capture events
        if (APP.mode === 'lasso') return false;
        // Ignore right-click
        if (event.button === 2) return false;
        return true;
      })
      .on('zoom', event => {
        APP.transform = event.transform;
        Canvas.render();
      });

    // Attach zoom to canvas (D3 selection)
    d3.select(canvas).call(zoom);

    // ── Mouse events ──────────────────────────────────────────────────────────
    canvas.addEventListener('mousemove', _onMouseMove);
    canvas.addEventListener('click',     _onClick);
    canvas.addEventListener('mouseleave', _onMouseLeave);

    // Double-click to reset zoom
    canvas.addEventListener('dblclick', () => {
      d3.select(canvas)
        .transition().duration(300)
        .call(zoom.transform, d3.zoomIdentity);
    });
  }

  /** Reset view to identity transform (animated). */
  function resetView() {
    const canvas = document.getElementById('main-canvas');
    d3.select(canvas)
      .transition().duration(400)
      .call(zoom.transform, d3.zoomIdentity);
  }

  // ── Mouse event handlers ──────────────────────────────────────────────────────
  let _hoverThrottle = null;

  function _onMouseMove(e) {
    if (APP.mode === 'lasso') return;
    if (_hoverThrottle) return;

    // Capture everything from the event synchronously — e.currentTarget
    // becomes null once the browser finishes dispatching the event, so
    // reading it inside requestAnimationFrame throws silently.
    const canvasEl = e.currentTarget;
    const rect     = canvasEl.getBoundingClientRect();
    const sx       = e.clientX - rect.left;
    const sy       = e.clientY - rect.top;

    _hoverThrottle = requestAnimationFrame(() => {
      _hoverThrottle = null;
      const paper = Canvas.hitTest(sx, sy, 12);

      if (paper !== APP.hoveredPaper) {
        APP.hoveredPaper = paper;
        Canvas.render();
      }

      if (paper) {
        UI.showTooltip(paper, sx, sy);
        canvasEl.style.cursor = 'pointer';
      } else {
        UI.hideTooltip();
        canvasEl.style.cursor = 'grab';
      }
    });
  }

  function _onClick(e) {
    if (APP.mode === 'lasso') return;
    // Only handle left clicks that weren't a drag
    if (e.button !== 0) return;

    const rect  = e.currentTarget.getBoundingClientRect();
    const sx    = e.clientX - rect.left;
    const sy    = e.clientY - rect.top;
    const paper = Canvas.hitTest(sx, sy, 12);

    if (paper) {
      APP.activePaper = paper;
      UI.showDetailPanel(paper);
    } else {
      // Click on empty space: deselect active paper
      APP.activePaper = null;
      UI.closeDetailPanel();
    }

    Canvas.render();
  }

  function _onMouseLeave() {
    APP.hoveredPaper = null;
    UI.hideTooltip();
    Canvas.render();
  }

  return { init, resetView };
})();

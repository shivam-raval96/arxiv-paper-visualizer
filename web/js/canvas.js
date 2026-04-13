/**
 * canvas.js — Canvas rendering engine
 */

const Canvas = (() => {

  // ── Category color palette ──────────────────────────────────────────────────
  const CATEGORY_COLORS = {
    'cs.AI':    '#f56c6c',
    'cs.CV':    '#67c3f3',
    'cs.LG':    '#a5d86e',
    'cs.NLP':   '#f5a623',
    'stat.ML':  '#c77dff',
    'math.ST':  '#4ecdc4',
  };
  const DEFAULT_COLOR = '#8890b0';

  const POINT_RADIUS = 5;
  const POINT_RADIUS_HOVER = 7;
  const POINT_RADIUS_SELECTED = 7;

  // ── Module state ─────────────────────────────────────────────────────────────
  let canvas, ctx;
  let width, height;
  let xScale, yScale;
  let _rafId = null;   // requestAnimationFrame handle

  // ── Initialization ────────────────────────────────────────────────────────────
  function init() {
    canvas = document.getElementById('main-canvas');
    ctx = canvas.getContext('2d');

    _resize();
    window.addEventListener('resize', _resize);

    _buildScales();
    _buildLegend();
  }

  function _resize() {
    const container = document.getElementById('canvas-container');
    width  = container.clientWidth;
    height = container.clientHeight;
    canvas.width  = width;
    canvas.height = height;

    // Sync SVG overlay size
    const svg = document.getElementById('lasso-overlay');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    _buildScales();
    render();
  }

  /**
   * Build D3 scales from embedding data extent → canvas pixel space (with padding).
   */
  function _buildScales() {
    if (!APP.allPapers.length) return;

    const PAD = 60; // pixels of padding around the plot

    const xExtent = Data.getEmbeddingExtent(0);
    const yExtent = Data.getEmbeddingExtent(1);

    // Add 10% margin around data extent
    const xMargin = (xExtent[1] - xExtent[0]) * 0.10 || 1;
    const yMargin = (yExtent[1] - yExtent[0]) * 0.10 || 1;

    xScale = d3.scaleLinear()
      .domain([xExtent[0] - xMargin, xExtent[1] + xMargin])
      .range([PAD, width - PAD]);

    yScale = d3.scaleLinear()
      .domain([yExtent[0] - yMargin, yExtent[1] + yMargin])
      .range([height - PAD, PAD]); // inverted: higher y = lower on screen
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────────

  /**
   * Map a paper's embedding to screen coordinates applying the current zoom transform.
   * @returns {[number, number]} [screenX, screenY]
   */
  function paperToScreen(paper) {
    const t = APP.transform;
    const bx = xScale(paper.embedding_2d[0]);
    const by = yScale(paper.embedding_2d[1]);
    return [bx * t.k + t.x, by * t.k + t.y];
  }

  /**
   * Convert screen coords back to data (base canvas) coords.
   */
  function screenToCanvas(sx, sy) {
    const t = APP.transform;
    return [(sx - t.x) / t.k, (sy - t.y) / t.k];
  }

  /**
   * Find the paper closest to (sx, sy) in screen space.
   * Returns the paper if within threshold, else null.
   */
  function hitTest(sx, sy, threshold = 10) {
    const papers = APP.filteredPapers;
    let closest = null;
    let minDist = threshold * threshold; // compare squared distances

    for (const p of papers) {
      const [px, py] = paperToScreen(p);
      const d2 = (px - sx) ** 2 + (py - sy) ** 2;
      if (d2 < minDist) {
        minDist = d2;
        closest = p;
      }
    }
    return closest;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────

  /** Schedule a render on the next animation frame. */
  function render() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(_draw);
  }

  function _draw() {
    _rafId = null;
    if (!ctx) return;

    const t = APP.transform;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary').trim() || '#0f1117';
    ctx.fillRect(0, 0, width, height);

    // Grid
    _drawGrid();

    // Points (save/restore for zoom transform)
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    _drawPoints();
    ctx.restore();
  }

  function _drawGrid() {
    if (!xScale || !yScale) return;
    const t = APP.transform;

    ctx.save();
    ctx.strokeStyle = 'rgba(46, 50, 80, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);

    // X gridlines
    const xTicks = xScale.ticks(6);
    for (const tick of xTicks) {
      const sx = xScale(tick) * t.k + t.x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }

    // Y gridlines
    const yTicks = yScale.ticks(6);
    for (const tick of yTicks) {
      const sy = yScale(tick) * t.k + t.y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  function _drawPoints() {
    if (!xScale || !yScale) return;

    const isSearchActive = APP.searchQuery.length > 0;
    const papers = APP.filteredPapers;

    for (const paper of papers) {
      const bx = xScale(paper.embedding_2d[0]);
      const by = yScale(paper.embedding_2d[1]);

      const isSelected = APP.selectedPapers.has(paper.arxiv_id);
      const isHovered  = APP.hoveredPaper?.arxiv_id === paper.arxiv_id;
      const isActive   = APP.activePaper?.arxiv_id === paper.arxiv_id;
      const isSaved    = APP.savedPapers.has(paper.arxiv_id);
      const isMatch    = !isSearchActive || APP.searchResults.has(paper.arxiv_id);

      const color = CATEGORY_COLORS[paper.category] || DEFAULT_COLOR;

      // Fade non-matching points during search
      const alpha = isSearchActive && !isMatch ? 0.12 : 1.0;

      const radius = isHovered || isActive ? POINT_RADIUS_HOVER
                   : isSelected            ? POINT_RADIUS_SELECTED
                   : POINT_RADIUS;

      ctx.globalAlpha = alpha;

      // Outer selection ring
      if (isSelected || isActive) {
        ctx.beginPath();
        ctx.arc(bx, by, radius + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = isActive ? '#fff' : color;
        ctx.lineWidth = isActive ? 2 : 1.5;
        ctx.stroke();
      }

      // Saved indicator (inner dot)
      if (isSaved) {
        ctx.beginPath();
        ctx.arc(bx, by, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245, 166, 35, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Main dot
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Hover glow
      if (isHovered || isActive) {
        ctx.beginPath();
        ctx.arc(bx, by, radius + 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1.0;
  }

  // ── Legend ────────────────────────────────────────────────────────────────────
  function _buildLegend() {
    const container = document.getElementById('legend-items');
    container.innerHTML = '';

    for (const [cat, color] of Object.entries(CATEGORY_COLORS)) {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.dataset.category = cat;
      item.innerHTML = `
        <div class="legend-dot" style="background:${color}"></div>
        <span>${cat}</span>
      `;
      item.addEventListener('click', () => _legendClick(cat));
      container.appendChild(item);
    }
  }

  function _legendClick(cat) {
    const cats = APP.filters.categories;
    if (cats.has(cat)) {
      cats.delete(cat);
    } else {
      cats.add(cat);
    }
    // Sync checkboxes
    document.querySelectorAll('#category-dropdown input[type=checkbox]')
      .forEach(cb => { cb.checked = cats.has(cb.value); });
    UI.updateCategoryFilterBtn();
    applyFiltersAndRender();
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  return {
    init,
    render,
    hitTest,
    paperToScreen,
    screenToCanvas,
    getCategoryColors: () => CATEGORY_COLORS,
    rebuildScales: _buildScales
  };
})();

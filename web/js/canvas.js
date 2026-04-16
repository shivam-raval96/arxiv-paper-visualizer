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

  // Extra radii on top of Settings.prefs.pointSize
  const POINT_RADIUS_HOVER_EXTRA    = 3;   // hover: slightly enlarged
  const POINT_RADIUS_ACTIVE_EXTRA   = 5;   // clicked: larger + black fill
  const POINT_RADIUS_SELECTED_EXTRA = 2;   // lasso-selected ring

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

    // ResizeObserver fires whenever the container changes size —
    // covers window resize AND the detail panel sliding in/out.
    new ResizeObserver(_resize).observe(document.getElementById('canvas-container'));

    _buildScales();
    _buildLegend();
  }

  function _resize() {
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === width && h === height) return; // no change, skip
    width  = w;
    height = h;
    canvas.width  = width;
    canvas.height = height;

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

    // Background — white normally, dark in dark mode
    ctx.fillStyle = document.documentElement.classList.contains('dark-mode') ? '#0f1117' : '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Points (save/restore for zoom transform)
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    _drawPoints();
    ctx.restore();

    // Cluster labels drawn in screen space (on top, after transform restore)
    if (!Settings || Settings.prefs.showLabels) _drawClusterLabels();
  }

  function _drawClusterLabels() {
    const clusters = APP.clusters;
    if (!clusters || !clusters.length || !xScale || !yScale) return;

    ctx.save();
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const cluster of clusters) {
      const [sx, sy] = _clusterToScreen(cluster.centroid_2d);

      // Don't render if centroid is off-screen
      if (sx < -80 || sx > width + 80 || sy < -30 || sy > height + 30) continue;

      const label = cluster.label;
      const tw = ctx.measureText(label).width;
      const ph = 8, pv = 5;
      const rx = sx - tw / 2 - ph;
      const ry = sy - 10 - pv;
      const rw = tw + ph * 2;
      const rh = 20 + pv * 2;

      // Pill background
      ctx.beginPath();
      _roundRect(ctx, rx, ry, rw, rh, 10);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.10)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label text
      ctx.fillStyle = '#1a1d2e';
      ctx.fillText(label, sx, sy);
    }

    ctx.restore();
  }

  function _clusterToScreen(centroid_2d) {
    const t = APP.transform;
    const bx = xScale(centroid_2d[0]);
    const by = yScale(centroid_2d[1]);
    return [bx * t.k + t.x, by * t.k + t.y];
  }

  /** Draw a rounded rectangle path (polyfill for older Safari). */
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function _drawPoints() {
    if (!xScale || !yScale) return;

    const isSearchActive = APP.searchQuery.length > 0;
    const papers  = APP.filteredPapers;
    const baseR   = (Settings?.prefs.pointSize)   ?? 5;
    const opacity = (Settings?.prefs.pointOpacity) ?? 1.0;
    const hoverId  = APP.hoveredPaper?.arxiv_id;
    const activeId = APP.activePaper?.arxiv_id;

    // Pass 1 — all normal points (skip hover/active so they render on top)
    for (const paper of papers) {
      if (paper.arxiv_id === hoverId || paper.arxiv_id === activeId) continue;
      _drawDot(paper, baseR, opacity, isSearchActive);
    }

    // Pass 2 — hovered point (on top, but below active)
    if (hoverId && hoverId !== activeId) {
      const p = papers.find(p => p.arxiv_id === hoverId);
      if (p) _drawDot(p, baseR, opacity, isSearchActive);
    }

    // Pass 3 — active/clicked point (topmost)
    if (activeId) {
      const p = papers.find(p => p.arxiv_id === activeId);
      if (p) _drawDot(p, baseR, opacity, isSearchActive);
    }

    ctx.globalAlpha = 1.0;
  }

  function _drawDot(paper, baseR, opacity, isSearchActive) {
    const bx = xScale(paper.embedding_2d[0]);
    const by = yScale(paper.embedding_2d[1]);

    const isSelected = APP.selectedPapers.has(paper.arxiv_id);
    const isHovered  = APP.hoveredPaper?.arxiv_id === paper.arxiv_id;
    const isActive   = APP.activePaper?.arxiv_id  === paper.arxiv_id;
    const isSaved    = APP.savedPapers.has(paper.arxiv_id);
    const isMatch    = !isSearchActive || APP.searchResults.has(paper.arxiv_id);

    const color = CATEGORY_COLORS[paper.category] || DEFAULT_COLOR;
    const alpha = isSearchActive && !isMatch ? 0.10 : opacity;

    const radius = isActive   ? baseR + POINT_RADIUS_ACTIVE_EXTRA
                 : isHovered  ? baseR + POINT_RADIUS_HOVER_EXTRA
                 : isSelected ? baseR + POINT_RADIUS_SELECTED_EXTRA
                 : baseR;

    ctx.globalAlpha = alpha;

    // Saved indicator ring (outermost)
    if (isSaved) {
      ctx.beginPath();
      ctx.arc(bx, by, radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 166, 35, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Lasso-selection ring
    if (isSelected && !isActive) {
      ctx.beginPath();
      ctx.arc(bx, by, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Active: white halo so black dot pops against any background
    if (isActive) {
      ctx.beginPath();
      ctx.arc(bx, by, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Main dot — black for active, category color otherwise
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#1a1a1a' : color;
    ctx.fill();

    // Hover: subtle white inner ring
    if (isHovered && !isActive) {
      ctx.beginPath();
      ctx.arc(bx, by, radius + 1, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
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

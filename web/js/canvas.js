/**
 * canvas.js — Canvas rendering engine
 */

const Canvas = (() => {

  // ── Category color palette ──────────────────────────────────────────────────
  // Tableau-inspired categorical palette — distinct, muted, colorblind-friendly
  const CATEGORY_COLORS = {
    'cs.AI':   '#E15759',   // muted red
    'cs.CV':   '#4E79A7',   // steel blue
    'cs.LG':   '#59A14F',   // sage green
    'cs.NLP':  '#F28E2B',   // warm orange
    'stat.ML': '#B07AA1',   // dusty purple
    'math.ST': '#76B7B2',   // teal
  };
  const DEFAULT_COLOR = '#9BA3B8';   // neutral blue-grey

  // Extra radii on top of Settings.prefs.pointSize
  const POINT_RADIUS_HOVER_EXTRA    = 3;   // hover: slightly enlarged
  const POINT_RADIUS_ACTIVE_EXTRA   = 5;   // clicked: larger + black fill
  const POINT_RADIUS_SELECTED_EXTRA = 2;   // lasso-selected ring

  // ── Module state ─────────────────────────────────────────────────────────────
  let canvas, ctx;
  let width, height;
  let xScale, yScale;
  let _rafId = null;   // requestAnimationFrame handle
  let _clusterLabelBoxes = []; // [{rx,ry,rw,rh,cluster}] screen-space hit areas

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

    // Background
    const isDark = document.documentElement.classList.contains('dark-mode');
    ctx.fillStyle = isDark ? '#0f1117'
                 : (Settings?.prefs.warmBg ? '#FAF8F5' : '#ffffff');
    ctx.fillRect(0, 0, width, height);

    // Points (save/restore for zoom transform)
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);
    _drawPoints();
    ctx.restore();

    // Cluster labels drawn in screen space (on top, after transform restore)
    if (!Settings || Settings.prefs.showLabels) _drawClusterLabels();

    // Semantic zoom: paper titles at high zoom
    _drawSemanticLabels();
  }

  function _drawClusterLabels() {
    _clusterLabelBoxes = []; // reset hit areas each frame
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

      // Store hit box for click detection
      _clusterLabelBoxes.push({ rx, ry, rw, rh, cluster });

      // Pill background
      ctx.beginPath();
      _roundRect(ctx, rx, ry, rw, rh, 10);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.90)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label text
      ctx.fillStyle = '#1a1d2e';
      ctx.fillText(label, sx, sy);
    }

    ctx.restore();
  }

  /**
   * Returns the cluster whose label pill contains (sx, sy), or null.
   */
  function hitTestCluster(sx, sy) {
    for (const box of _clusterLabelBoxes) {
      if (sx >= box.rx && sx <= box.rx + box.rw &&
          sy >= box.ry && sy <= box.ry + box.rh) {
        return box.cluster;
      }
    }
    return null;
  }

  /**
   * Semantic zoom: as zoom increases, text cards fade in and gain detail.
   *
   * k 2.0 → 3.0  title fades in beside dot
   * k 3.0 → 5.0  dots shrink, title fully visible
   * k > 4.5       first author line appears
   * k > 7.0       abstract snippet appears
   */
  function _drawSemanticLabels() {
    const k = APP.transform?.k ?? 1;
    if (k < 2.0 || !xScale || !yScale) return;

    // Card alpha: 0 at k=2, 1 at k=3.5
    const alpha = Math.min(1, (k - 2.0) / 1.5);
    if (alpha <= 0) return;

    const papers       = APP.filteredPapers;
    const basePtSize   = Settings?.prefs.pointSize ?? 3;
    const dotScale     = k > 3 ? Math.max(0.15, 1 - (k - 3) / 4) : 1;
    const scaledR      = basePtSize * dotScale; // matches _drawPoints
    const showAuthors  = k > 4.5;
    const showAbstract = k > 7.0;

    const TITLE_FS  = 11;
    const SMALL_FS  = 9;
    const LINE_H    = 13;

    ctx.save();
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';

    for (const paper of papers) {
      const [sx, sy] = paperToScreen(paper);
      // Generous off-screen cull (card can be wide)
      if (sx < -320 || sx > width + 20 || sy < -80 || sy > height + 20) continue;

      const catColor = CATEGORY_COLORS[paper.category] || DEFAULT_COLOR;
      const lx   = sx + scaledR + 6;
      const maxW = Math.max(90, Math.min(260, width - lx - 10));

      // ── Title ──────────────────────────────────────────────────────────────
      ctx.font = `600 ${TITLE_FS}px Inter, -apple-system, sans-serif`;
      let title = paper.title;
      if (ctx.measureText(title).width > maxW) {
        while (title.length > 4 && ctx.measureText(title + '…').width > maxW)
          title = title.slice(0, -1);
        title = title.trimEnd() + '…';
      }
      const titleW = ctx.measureText(title).width;

      // ── Author line ────────────────────────────────────────────────────────
      let authorLine = '';
      let authorW    = 0;
      if (showAuthors && paper.authors?.length) {
        ctx.font = `400 ${SMALL_FS}px Inter, -apple-system, sans-serif`;
        authorLine = (paper.authors[0] || '') +
          (paper.authors.length > 1 ? ' et al.' : '');
        if (ctx.measureText(authorLine).width > maxW)
          authorLine = authorLine.slice(0, 28) + '…';
        authorW = ctx.measureText(authorLine).width;
      }

      // ── Abstract snippet ───────────────────────────────────────────────────
      let abstractSnip = '';
      let abstractW    = 0;
      if (showAbstract && paper.abstract) {
        ctx.font = `400 ${SMALL_FS}px Inter, -apple-system, sans-serif`;
        abstractSnip = paper.abstract.replace(/\s+/g, ' ');
        while (abstractSnip.length > 8 && ctx.measureText(abstractSnip + '…').width > maxW)
          abstractSnip = abstractSnip.slice(0, -1);
        abstractSnip = abstractSnip.trimEnd() + '…';
        abstractW = ctx.measureText(abstractSnip).width;
      }

      // ── Card geometry ──────────────────────────────────────────────────────
      const innerW = Math.max(titleW, authorW, abstractW);
      const boxW   = innerW + 14;
      let   boxH   = TITLE_FS + 10;
      if (authorLine)   boxH += LINE_H;
      if (abstractSnip) boxH += LINE_H + 2;
      const boxY = sy - boxH / 2;

      ctx.globalAlpha = alpha;

      // Card background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.93)';
      ctx.beginPath();
      _roundRect(ctx, lx, boxY, boxW, boxH, 4);
      ctx.fill();

      // Left category color stripe
      ctx.fillStyle = catColor;
      ctx.fillRect(lx, boxY + 3, 2.5, boxH - 6);

      // Title text
      ctx.font      = `600 ${TITLE_FS}px Inter, -apple-system, sans-serif`;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      const textX   = lx + 8;
      let   textY   = boxY + 4;
      ctx.fillText(title, textX, textY);
      textY += TITLE_FS + 2;

      // Author line
      if (authorLine) {
        ctx.font      = `400 ${SMALL_FS}px Inter, -apple-system, sans-serif`;
        ctx.fillStyle = 'rgba(71, 85, 105, 0.85)';
        ctx.fillText(authorLine, textX, textY);
        textY += LINE_H;
      }

      // Abstract snippet
      if (abstractSnip) {
        ctx.font      = `400 ${SMALL_FS}px Inter, -apple-system, sans-serif`;
        ctx.fillStyle = 'rgba(100, 116, 139, 0.80)';
        ctx.fillText(abstractSnip, textX, textY + 2);
      }
    }

    ctx.globalAlpha = 1;
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
    const opacity = (Settings?.prefs.pointOpacity) ?? 1.0;
    const hoverId  = APP.hoveredPaper?.arxiv_id;
    const activeId = APP.activePaper?.arxiv_id;

    // Divide by k so dots stay at a constant screen-pixel size regardless of zoom.
    // Semantic zoom: additionally shrink dots (k > 3) so text cards take over visually.
    const k = APP.transform.k;
    const dotScale = k > 3 ? Math.max(0.15, 1 - (k - 3) / 4) : 1;
    const baseR = ((Settings?.prefs.pointSize) ?? 3) * dotScale / k;

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
    const k  = APP.transform.k;

    const isSelected = APP.selectedPapers.has(paper.arxiv_id);
    const isHovered  = APP.hoveredPaper?.arxiv_id === paper.arxiv_id;
    const isActive   = APP.activePaper?.arxiv_id  === paper.arxiv_id;
    const isSaved    = APP.savedPapers.has(paper.arxiv_id);
    const isMatch    = !isSearchActive || APP.searchResults.has(paper.arxiv_id);

    const color = CATEGORY_COLORS[paper.category] || DEFAULT_COLOR;
    const alpha = isSearchActive && !isMatch ? 0.10 : opacity;

    // All extra radii divided by k so they stay constant in screen pixels
    const radius = isActive   ? baseR + POINT_RADIUS_ACTIVE_EXTRA   / k
                 : isHovered  ? baseR + POINT_RADIUS_HOVER_EXTRA    / k
                 : isSelected ? baseR + POINT_RADIUS_SELECTED_EXTRA / k
                 : baseR;

    ctx.globalAlpha = alpha;

    // Saved indicator ring (outermost)
    if (isSaved) {
      ctx.beginPath();
      ctx.arc(bx, by, radius + 5 / k, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(245, 166, 35, 0.7)';
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
    }

    // Lasso-selection ring
    if (isSelected && !isActive) {
      ctx.beginPath();
      ctx.arc(bx, by, radius + 3 / k, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
    }

    // Main dot — category color always
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Active: black border
    if (isActive) {
      ctx.beginPath();
      ctx.arc(bx, by, radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2 / k;
      ctx.stroke();
    }

    // Hover: subtle white inner ring
    if (isHovered && !isActive) {
      ctx.beginPath();
      ctx.arc(bx, by, radius + 1 / k, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1.5 / k;
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
    rebuildScales: _buildScales,
    hitTestCluster
  };
})();

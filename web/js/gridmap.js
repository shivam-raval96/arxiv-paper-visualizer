/**
 * gridmap.js — No-overlap layout via BSP Grid (DGrid algorithm).
 *
 * Reference: Hilasaca & Paulovich, "Overlap removal of dimensionality
 * reduction scatterplot layouts," IEEE TVCG 2023.
 *
 * Two phases:
 *   1. Recursive binary space partition — split point set along its
 *      longer tight-bbox axis at the spatial median until each leaf
 *      has <= MIN_LEAF points.
 *   2. Per leaf, build a local grid (cell size = point diameter),
 *      then snap each point to its nearest available cell via an
 *      expanding-ring search starting from its original position.
 *
 * Partition boundaries follow the data, so dense clusters subdivide
 * (and expand only as much as needed) while sparse gaps survive as
 * partition edges. Avoids the rectangular artifacts of a global grid
 * and the cluster-blur of force-based collision.
 *
 * Stamps `paper._grid_2d` and `cluster._grid_centroid_2d`.
 * Canvas reads these when Settings.prefs.noOverlap is on.
 */

const Gridmap = (() => {

  const SIM_W   = 1000;   // notional simulation canvas (px)
  const SIM_H   = 700;
  const PAD     = 40;
  const CELL    = 10;     // px — ≈ point diameter + margin
  const MIN_LEAF = 64;    // stop splitting at this leaf size

  let _cacheKey = '';
  let _inFlight = null;
  let _inFlightSig = '';

  function clearCache() {
    _cacheKey = '';
  }

  function _signature(papers) {
    if (!papers.length) return 'empty';
    return papers.length + '|' + papers[0].arxiv_id + '|' + papers[papers.length - 1].arxiv_id;
  }

  function isReady(papers) {
    return _signature(papers) === _cacheKey;
  }

  // ── BSP recursion ───────────────────────────────────────────────────────────

  function _tightBbox(nodes) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of nodes) {
      if (n.px < x0) x0 = n.px;
      if (n.px > x1) x1 = n.px;
      if (n.py < y0) y0 = n.py;
      if (n.py > y1) y1 = n.py;
    }
    return { x0, x1, y0, y1 };
  }

  function _bspSplit(nodes) {
    const out = [];
    const stack = [nodes];
    while (stack.length) {
      const cur = stack.pop();
      if (cur.length <= MIN_LEAF) {
        out.push({ nodes: cur, bbox: _tightBbox(cur) });
        continue;
      }
      const bbox = _tightBbox(cur);
      const w = bbox.x1 - bbox.x0;
      const h = bbox.y1 - bbox.y0;
      const axis = w >= h ? 'px' : 'py';
      cur.sort((a, b) => a[axis] - b[axis]);
      const mid = Math.floor(cur.length / 2);
      stack.push(cur.slice(0, mid));
      stack.push(cur.slice(mid));
    }
    return out;
  }

  // ── Per-leaf snap ───────────────────────────────────────────────────────────

  function _snapLeaf(leaf) {
    const nodes = leaf.nodes;
    if (!nodes.length) return;

    // Pad bbox so boundary points have room
    let x0 = leaf.bbox.x0 - CELL / 2;
    let y0 = leaf.bbox.y0 - CELL / 2;
    let x1 = leaf.bbox.x1 + CELL / 2;
    let y1 = leaf.bbox.y1 + CELL / 2;

    let cols = Math.max(1, Math.ceil((x1 - x0) / CELL));
    let rows = Math.max(1, Math.ceil((y1 - y0) / CELL));

    // Expand grid to guarantee capacity >= n, growing the shorter axis first
    while (cols * rows < nodes.length) {
      const aspect = (x1 - x0) / Math.max(1e-9, (y1 - y0));
      if (cols / Math.max(1, rows) < aspect) cols++;
      else rows++;
    }
    x1 = x0 + cols * CELL;
    y1 = y0 + rows * CELL;

    const occupied = new Uint8Array(cols * rows);

    for (const n of nodes) {
      let cx = Math.floor((n.px - x0) / CELL);
      let cy = Math.floor((n.py - y0) / CELL);
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;

      let placed = false;
      if (!occupied[cy * cols + cx]) {
        occupied[cy * cols + cx] = 1;
        placed = true;
      } else {
        // Expanding-ring search outward from (cx, cy)
        const maxR = cols + rows;
        ring: for (let r = 1; r <= maxR; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
              if (!occupied[ny * cols + nx]) {
                occupied[ny * cols + nx] = 1;
                cx = nx; cy = ny;
                placed = true;
                break ring;
              }
            }
          }
        }
      }
      if (!placed) continue; // shouldn't happen — capacity is guaranteed

      n.gx = x0 + (cx + 0.5) * CELL;
      n.gy = y0 + (cy + 0.5) * CELL;
    }
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  function compute(papers) {
    const sig = _signature(papers);
    if (sig === _cacheKey) return Promise.resolve();
    if (sig === _inFlightSig && _inFlight) return _inFlight;

    if (!papers.length) {
      _cacheKey = sig;
      return Promise.resolve();
    }

    _inFlightSig = sig;
    _inFlight = (async () => {
      try {
        // Build local scales: embedding extent → notional sim canvas
        const xExtent = d3.extent(papers, p => p.embedding_2d[0]);
        const yExtent = d3.extent(papers, p => p.embedding_2d[1]);
        const xMargin = (xExtent[1] - xExtent[0]) * 0.05 || 1;
        const yMargin = (yExtent[1] - yExtent[0]) * 0.05 || 1;

        const xScale = d3.scaleLinear()
          .domain([xExtent[0] - xMargin, xExtent[1] + xMargin])
          .range([PAD, SIM_W - PAD]);
        const yScale = d3.scaleLinear()
          .domain([yExtent[0] - yMargin, yExtent[1] + yMargin])
          .range([SIM_H - PAD, PAD]);

        // Project to px space
        const nodes = papers.map(p => ({
          paper: p,
          px: xScale(p.embedding_2d[0]),
          py: yScale(p.embedding_2d[1]),
          gx: 0, gy: 0,
        }));

        // Phase 1: BSP
        const leaves = _bspSplit(nodes);

        // Phase 2: snap per leaf, yielding to the browser between batches
        for (let i = 0; i < leaves.length; i++) {
          _snapLeaf(leaves[i]);
          if ((i & 31) === 31) await new Promise(r => setTimeout(r, 0));
        }

        // Map back to embedding coords via inverse scales
        for (const n of nodes) {
          n.paper._grid_2d = [xScale.invert(n.gx), yScale.invert(n.gy)];
        }

        // Recompute cluster centroids in adjusted space
        if (APP.clusters && APP.clusters.length) {
          const sums = new Map();
          for (const p of papers) {
            if (p.cluster_id == null || !p._grid_2d) continue;
            let s = sums.get(p.cluster_id);
            if (!s) { s = { x: 0, y: 0, n: 0 }; sums.set(p.cluster_id, s); }
            s.x += p._grid_2d[0];
            s.y += p._grid_2d[1];
            s.n++;
          }
          for (const cluster of APP.clusters) {
            const s = sums.get(cluster.id);
            if (s && s.n > 0) cluster._grid_centroid_2d = [s.x / s.n, s.y / s.n];
          }
        }

        _cacheKey = sig;
      } finally {
        _inFlight = null;
        _inFlightSig = '';
      }
    })();
    return _inFlight;
  }

  return { compute, clearCache, isReady };
})();

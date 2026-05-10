/**
 * gridmap.js — Hybrid BSP + local collision resolution.
 *
 * Phase 1: recursive binary space partition (DGrid-style). Split the
 * point set at the spatial median along its longer tight-bbox axis
 * until each leaf has <= MIN_LEAF points. Partition boundaries follow
 * the data distribution, so dense clusters subdivide and sparse gaps
 * survive as partition edges.
 *
 * Phase 2: instead of snapping to a rigid grid, run a small d3
 * force simulation INSIDE each leaf — forceCollide separates
 * overlapping dots, forceX/forceY anchor each point to its original
 * position. The simulation is confined to a small local neighborhood
 * (no global pressure), so clusters keep their shape rather than
 * inflating into a circle, and there is no axis-aligned grid to
 * produce visible stripes.
 *
 * Stamps `paper._grid_2d` and `cluster._grid_centroid_2d`.
 */

const Gridmap = (() => {

  const SIM_W   = 1000;   // notional simulation canvas (px)
  const SIM_H   = 700;
  const PAD     = 40;
  const RADIUS  = 5;      // px collision radius (≈ point radius + margin)
  const MIN_LEAF = 32;    // stop BSP when leaf <= this many points
  const TICKS    = 60;    // force iterations per leaf
  const ANCHOR_K = 0.30;  // forceX/forceY strength toward original position
  const PACK_FACTOR = 1.4;// area headroom: leaf bbox >= n * π * r² * factor

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

  // ── Per-leaf local force simulation ─────────────────────────────────────────

  function _resolveLeaf(leaf) {
    const nodes = leaf.nodes;
    if (nodes.length === 0) return;
    if (nodes.length === 1) {
      nodes[0].gx = nodes[0].px;
      nodes[0].gy = nodes[0].py;
      return;
    }

    // Ensure leaf bbox has enough area for n disks at RADIUS
    const need = nodes.length * Math.PI * RADIUS * RADIUS * PACK_FACTOR;
    let { x0, y0, x1, y1 } = leaf.bbox;
    let w = Math.max(1, x1 - x0);
    let h = Math.max(1, y1 - y0);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (w * h < need) {
      const scale = Math.sqrt(need / (w * h));
      w *= scale; h *= scale;
      x0 = cx - w / 2; x1 = cx + w / 2;
      y0 = cy - h / 2; y1 = cy + h / 2;
    }
    // Pad by RADIUS so points can sit fully inside without clipping
    const px0 = x0 + RADIUS, px1 = x1 - RADIUS;
    const py0 = y0 + RADIUS, py1 = y1 - RADIUS;

    // d3 simulation nodes seeded at original positions
    const simNodes = nodes.map(n => ({
      ref: n,
      ax: n.px, ay: n.py,
      x:  n.px, y:  n.py,
    }));

    const sim = d3.forceSimulation(simNodes)
      .force('x', d3.forceX(d => d.ax).strength(ANCHOR_K))
      .force('y', d3.forceY(d => d.ay).strength(ANCHOR_K))
      .force('collide', d3.forceCollide(RADIUS).strength(1).iterations(2))
      .alphaDecay(0.06)
      .velocityDecay(0.5)
      .stop();

    for (let t = 0; t < TICKS; t++) sim.tick();

    // Clamp final positions inside the (possibly expanded) leaf bbox.
    // Keeps adjacent leaves from bleeding into each other.
    for (const sn of simNodes) {
      let gx = sn.x, gy = sn.y;
      if (gx < px0) gx = px0; else if (gx > px1) gx = px1;
      if (gy < py0) gy = py0; else if (gy > py1) gy = py1;
      sn.ref.gx = gx;
      sn.ref.gy = gy;
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

        // Phase 2: per-leaf force resolution, yielding to the browser
        for (let i = 0; i < leaves.length; i++) {
          _resolveLeaf(leaves[i]);
          if ((i & 15) === 15) await new Promise(r => setTimeout(r, 0));
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

/**
 * gridmap.js — No-overlap layout via d3.forceCollide().
 *
 * Pulls each paper toward its UMAP position (forceX/forceY anchored to
 * the original embedding) while a collision radius pushes overlapping
 * dots apart. Result mapped back to embedding-space coords so Canvas's
 * own scales still apply.
 *
 * Stamps `paper._grid_2d` and `cluster._grid_centroid_2d`.
 * Canvas reads these when Settings.prefs.noOverlap is on.
 */

const Gridmap = (() => {

  const SIM_W = 1000;     // notional canvas width for simulation (px)
  const SIM_H = 700;      // notional canvas height
  const PAD = 40;
  const TICKS = 200;      // simulation steps
  const COLLIDE_R = 7;    // px in simulation space (≈ rendered dot radius + margin)
  const ANCHOR_STRENGTH = 0.2;

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
        // Build local scales from embedding extent into a notional canvas
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

        // Build nodes seeded at original positions
        const nodes = papers.map(p => ({
          paper: p,
          ax: xScale(p.embedding_2d[0]),
          ay: yScale(p.embedding_2d[1]),
          x:  xScale(p.embedding_2d[0]),
          y:  yScale(p.embedding_2d[1]),
        }));

        const sim = d3.forceSimulation(nodes)
          .force('x', d3.forceX(d => d.ax).strength(ANCHOR_STRENGTH))
          .force('y', d3.forceY(d => d.ay).strength(ANCHOR_STRENGTH))
          .force('collide', d3.forceCollide(COLLIDE_R).strength(1).iterations(2))
          .alphaDecay(0.04)
          .stop();

        // Tick in chunks, yielding to the browser between batches
        const BATCH = 25;
        for (let i = 0; i < TICKS; i += BATCH) {
          const end = Math.min(TICKS, i + BATCH);
          for (let t = i; t < end; t++) sim.tick();
          await new Promise(r => setTimeout(r, 0));
        }

        // Map back to embedding-space coords via inverse scales
        for (const n of nodes) {
          n.paper._grid_2d = [xScale.invert(n.x), yScale.invert(n.y)];
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

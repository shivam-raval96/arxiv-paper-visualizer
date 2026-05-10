/**
 * gridmap.js — No-overlap grid layout via Hungarian assignment.
 *
 * Lazily loads munkres-js (Hungarian, O(n^3)) via dynamic ESM import.
 * For n > CHUNK_LIMIT, recursively median-splits papers into spatial
 * chunks and solves each chunk independently — keeps each Hungarian
 * call bounded while preserving locality.
 *
 * Stamps `paper._grid_2d` on each paper and `cluster._grid_centroid_2d`
 * on each cluster. Canvas reads these when Settings.prefs.noOverlap is on.
 */

const Gridmap = (() => {

  const CHUNK_LIMIT = 500;
  const MUNKRES_URL = 'https://cdn.jsdelivr.net/npm/munkres-js@1.2.2/+esm';

  let _munkres = null;
  let _munkresPromise = null;
  let _cacheKey = '';
  let _inFlight = null;
  let _inFlightSig = '';

  function _loadMunkres() {
    if (_munkres) return Promise.resolve(_munkres);
    if (_munkresPromise) return _munkresPromise;
    _munkresPromise = import(MUNKRES_URL).then(mod => {
      _munkres = mod.default || mod.computeMunkres || mod;
      if (typeof _munkres !== 'function') {
        throw new Error('munkres-js loaded but no callable export found');
      }
      return _munkres;
    });
    return _munkresPromise;
  }

  function clearCache() {
    _cacheKey = '';
  }

  function _signature(papers) {
    if (!papers.length) return 'empty';
    return papers.length + '|' + papers[0].arxiv_id + '|' + papers[papers.length - 1].arxiv_id;
  }

  /**
   * Recursively median-split until each piece <= CHUNK_LIMIT.
   * Alternates split axis (depth even = x, odd = y).
   */
  function _split(papers, depth) {
    if (papers.length <= CHUNK_LIMIT) return [papers];
    const axis = depth % 2;
    papers.sort((a, b) => a.embedding_2d[axis] - b.embedding_2d[axis]);
    const mid = Math.floor(papers.length / 2);
    return [
      ..._split(papers.slice(0, mid), depth + 1),
      ..._split(papers.slice(mid),    depth + 1)
    ];
  }

  /**
   * Solve one chunk: build local grid over chunk bbox, run Hungarian,
   * stamp `_grid_2d` on each paper.
   */
  function _solveChunk(papers, munkres) {
    const n = papers.length;
    if (n === 0) return;

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const p of papers) {
      const x = p.embedding_2d[0], y = p.embedding_2d[1];
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const w = (xMax - xMin) || 1;
    const h = (yMax - yMin) || 1;
    const aspect = w / h;
    const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
    const rows = Math.ceil(n / cols);
    const cellW = w / cols;
    const cellH = h / rows;

    // Build cells; trim to exactly n (last row may be partial)
    const cells = new Array(n);
    let k = 0;
    outer: for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (k >= n) break outer;
        cells[k++] = [xMin + (c + 0.5) * cellW, yMin + (r + 0.5) * cellH];
      }
    }

    // Square cost matrix (n x n), cost = squared euclidean
    const cost = new Array(n);
    for (let i = 0; i < n; i++) {
      const row = new Array(n);
      const px = papers[i].embedding_2d[0];
      const py = papers[i].embedding_2d[1];
      for (let j = 0; j < n; j++) {
        const dx = px - cells[j][0];
        const dy = py - cells[j][1];
        row[j] = dx * dx + dy * dy;
      }
      cost[i] = row;
    }

    const assignment = munkres(cost);
    for (const pair of assignment) {
      const r = pair[0], c = pair[1];
      papers[r]._grid_2d = cells[c];
    }
  }

  /**
   * Compute grid positions for all papers. Stamps `_grid_2d` on each.
   * Also recomputes cluster centroids in grid space.
   * Caches by paper-set signature; safe to call repeatedly.
   */
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
        const munkres = await _loadMunkres();
        const chunks = _split(papers.slice(), 0);

        for (const chunk of chunks) {
          _solveChunk(chunk, munkres);
          // Yield to browser between chunks so UI stays responsive
          await new Promise(r => setTimeout(r, 0));
        }

        // Recompute cluster centroids in grid space
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

  function isReady(papers) {
    return _signature(papers) === _cacheKey;
  }

  return { compute, clearCache, isReady };
})();

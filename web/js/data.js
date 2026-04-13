/**
 * data.js — Data loading and management
 */

const Data = (() => {

  // Try local first (works when running from file:// or same origin),
  // then fall back to GitHub raw CDN.
  const DATA_URLS = [
    './data/papers.json',
    'https://raw.githubusercontent.com/shivam-raval96/arxiv-paper-visualizer/main/web/data/papers.json'
  ];

  /**
   * Load papers from the first available URL.
   * Populates APP.allPapers.
   */
  async function load() {
    let lastError;

    for (const url of DATA_URLS) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        _process(json.papers || []);
        console.log(`Loaded ${APP.allPapers.length} papers from ${url}`);
        return;
      } catch (err) {
        lastError = err;
        console.warn(`Failed to load from ${url}:`, err.message);
      }
    }

    throw new Error(`Could not load papers: ${lastError?.message}`);
  }

  /**
   * Validate, deduplicate, and store papers in APP.allPapers.
   * Skips papers with invalid embedding_2d.
   */
  function _process(papers) {
    const seen = new Set();
    APP.allPapers = papers.filter(p => {
      if (!p.arxiv_id || seen.has(p.arxiv_id)) return false;
      if (!Array.isArray(p.embedding_2d) || p.embedding_2d.length < 2) return false;
      if (!isFinite(p.embedding_2d[0]) || !isFinite(p.embedding_2d[1])) return false;
      seen.add(p.arxiv_id);
      return true;
    });
  }

  /**
   * Return all unique categories present in APP.allPapers.
   */
  function getCategories() {
    return [...new Set(APP.allPapers.map(p => p.category))].sort();
  }

  /**
   * Return the extent [min, max] of embedding_2d values across a given dimension.
   * @param {0|1} dim
   */
  function getEmbeddingExtent(dim) {
    return d3.extent(APP.allPapers, p => p.embedding_2d[dim]);
  }

  return { load, getCategories, getEmbeddingExtent };
})();

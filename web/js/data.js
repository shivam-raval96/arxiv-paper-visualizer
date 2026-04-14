/**
 * data.js — Data loading: manifest, per-month files, state management
 */

const Data = (() => {

  const BASE_URLS = [
    './data/',
    'https://raw.githubusercontent.com/shivam-raval96/arxiv-paper-visualizer/main/web/data/'
  ];

  let _baseUrl = BASE_URLS[0];

  // ── Manifest ──────────────────────────────────────────────────────────────────

  /**
   * Load manifest.json to discover available months.
   * Populates APP.manifest and builds month tabs.
   */
  async function loadManifest() {
    for (const base of BASE_URLS) {
      try {
        const res = await fetch(base + 'manifest.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // Build tab list: daily snapshot first (if present), then monthly tabs
        const tabs = [];
        if (json.yesterday) tabs.push({ ...json.yesterday, isDaily: true });
        tabs.push(...(json.months || []));
        APP.manifest = tabs;

        _baseUrl = base;
        console.log(`Loaded manifest from ${base}: ${APP.manifest.length} tabs`);
        return;
      } catch (e) {
        console.warn(`Manifest not found at ${base}:`, e.message);
      }
    }
    // Fallback: single papers.json
    APP.manifest = [{ key: 'default', label: 'Latest', file: 'papers.json', count: 0 }];
  }

  // ── Per-month paper loading ───────────────────────────────────────────────────

  /**
   * Load a specific month's papers file.
   * Updates APP.allPapers, APP.clusters, APP.currentMonth.
   */
  async function loadMonth(monthKey) {
    const entry = APP.manifest.find(m => m.key === monthKey) || APP.manifest[0];
    if (!entry) throw new Error('No manifest entry for ' + monthKey);

    const res = await fetch(_baseUrl + entry.file);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${entry.file}`);
    const json = await res.json();

    _process(json.papers || []);
    APP.clusters     = json.clusters || [];
    APP.currentMonth = monthKey;
    console.log(`Loaded ${APP.allPapers.length} papers for ${entry.label}`);
  }

  /**
   * Initial load — uses manifest's first (newest) month.
   */
  async function load() {
    await loadManifest();
    const first = APP.manifest[0];
    if (first) await loadMonth(first.key);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function _process(papers) {
    const seen = new Set();
    APP.allPapers = papers.filter(p => {
      if (!p.arxiv_id || seen.has(p.arxiv_id)) return false;
      if (!Array.isArray(p.embedding_2d) || !isFinite(p.embedding_2d[0])) return false;
      seen.add(p.arxiv_id);
      return true;
    });
  }

  function getCategories() {
    return [...new Set(APP.allPapers.map(p => p.category))].sort();
  }

  function getEmbeddingExtent(dim) {
    return d3.extent(APP.allPapers, p => p.embedding_2d[dim]);
  }

  return { load, loadMonth, loadManifest, getCategories, getEmbeddingExtent };
})();

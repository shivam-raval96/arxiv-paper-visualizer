/**
 * main.js — Application entry point and global state management
 */

// ── Global Application State ──────────────────────────────────────────────────
const APP = {
  // Data
  allPapers: [],
  filteredPapers: [],
  selectedPapers: new Set(),   // Set of arxiv_id strings
  savedPapers: new Map(),      // arxiv_id → paper object (from IndexedDB)

  // View state
  currentView: 'daily',        // 'daily' | 'saved' | 'search'
  searchQuery: '',
  searchResults: new Set(),    // arxiv_ids matching current search
  hoveredPaper: null,          // paper object or null
  activePaper: null,           // paper shown in detail panel

  // Filters
  filters: {
    categories: new Set(),
    dateStart: '',
    dateEnd: '',
    author: ''
  },

  // Interaction mode
  mode: 'pan',                 // 'pan' | 'lasso'
  lassoMode: 'replace',        // 'replace' | 'add' | 'subtract'

  // D3 zoom transform (kept in sync by interactions.js)
  transform: d3.zoomIdentity,

  // Lasso path (screen coords)
  lassoPoints: [],
  isDrawingLasso: false,

  // IndexedDB reference
  db: null
};

// ── Initialization ─────────────────────────────────────────────────────────────
async function init() {
  try {
    // 1. Open IndexedDB
    APP.db = await Storage.open();

    // 2. Load saved papers from IndexedDB
    const saved = await Storage.getAll(APP.db);
    saved.forEach(p => APP.savedPapers.set(p.arxiv_id, p));

    // 3. Load papers.json
    await Data.load();

    // 4. Initialize canvas
    Canvas.init();

    // 5. Set up interactions (zoom, hover, click)
    Interactions.init();

    // 6. Set up lasso
    Lasso.init();

    // 7. Bind UI event listeners
    UI.initEventListeners();

    // 8. Initial render
    applyFiltersAndRender();

    // 9. Update saved UI
    UI.updateSavedSidebar();
    UI.updateSavedBadge();

    // 10. Hide loading overlay
    document.getElementById('loading-overlay').style.display = 'none';

  } catch (err) {
    console.error('Initialization failed:', err);
    document.getElementById('loading-text').textContent =
      'Failed to load papers. Please refresh.';
  }
}

// ── Core Rendering Pipeline ───────────────────────────────────────────────────

/**
 * Re-apply all filters to APP.allPapers, then trigger canvas redraw.
 * Call this whenever filters, view, or search changes.
 */
function applyFiltersAndRender() {
  APP.filteredPapers = Search.getVisiblePapers();
  Canvas.render();
  UI.updateSelectionInfo();
}

/**
 * Trigger canvas redraw without re-filtering (e.g., on hover/selection change).
 */
function render() {
  Canvas.render();
}

// ── Keyboard Shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Escape: cancel lasso or deselect
  if (e.key === 'Escape') {
    if (APP.isDrawingLasso) {
      Lasso.cancel();
    } else if (APP.selectedPapers.size > 0) {
      APP.selectedPapers.clear();
      render();
      UI.updateSelectionInfo();
    } else if (APP.activePaper) {
      UI.closeDetailPanel();
    }
    return;
  }

  // L: toggle lasso
  if (e.key === 'l' || e.key === 'L') {
    if (e.target === document.body || e.target === document.getElementById('main-canvas')) {
      UI.toggleLassoMode();
    }
    return;
  }
});

// Close category dropdown when clicking outside
document.addEventListener('click', e => {
  const dropdown = document.getElementById('category-dropdown');
  const btn = document.getElementById('category-dropdown-btn');
  if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);

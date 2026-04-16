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

  // Comparison groups (Set of arxiv_ids + label)
  compareGroupA: null, // { papers: [...], label: string }

  // Cluster metadata (from papers.json)
  clusters: [],

  // Month navigation
  manifest: [],       // [{key, label, file, count}]
  currentMonth: null, // 'YYYY-MM'

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

    // 3. Load shared saved papers (public read, no token needed)
    Shared.loadTokenFromStorage();
    try {
      const sharedPapers = await Shared.fetchShared();
      for (const p of sharedPapers) {
        if (!APP.savedPapers.has(p.arxiv_id)) {
          APP.savedPapers.set(p.arxiv_id, { ...p, isShared: true });
        }
      }
      UI.updateSharedSyncBar(sharedPapers.length);
    } catch (e) {
      console.warn('Could not load shared papers:', e.message);
      UI.updateSharedSyncBar(null, e.message);
    }

    // 4. Load papers.json
    await Data.load();

    // 5. Initialize canvas
    Canvas.init();

    // 6. Set up interactions (zoom, hover, click)
    Interactions.init();

    // 7. Set up lasso
    Lasso.init();

    // 8. Bind UI event listeners
    UI.initEventListeners();
    Settings.init();
    Reader.init();

    // 9. Build month tabs
    UI.buildMonthTabs();

    // 10. Initial render
    applyFiltersAndRender();

    // 11. Update saved UI
    UI.updateSavedSidebar();
    UI.updateSavedBadge();

    // 12. Render insights
    UI.updateInsights();

    // 13. Hide loading overlay
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

// ── Month switching ───────────────────────────────────────────────────────────

async function switchMonth(key) {
  if (key === APP.currentMonth) return;

  const indicator = document.getElementById('month-loading');
  indicator.classList.remove('hidden');

  try {
    await Data.loadMonth(key);

    // Reset transient state
    APP.selectedPapers.clear();
    APP.hoveredPaper  = null;
    APP.activePaper   = null;
    APP.searchQuery   = '';
    APP.searchResults.clear();
    APP.currentView   = 'daily';

    // Reset view toggle UI
    document.querySelectorAll('.view-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === 'daily');
    });

    Canvas.rebuildScales();
    applyFiltersAndRender();
    UI.updateInsights();
    UI.closeDetailPanel();
    UI.buildMonthTabs(); // re-render to update active state
  } catch (err) {
    console.error('Failed to switch month:', err);
  } finally {
    indicator.classList.add('hidden');
  }
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

  // R: toggle reading mode
  if (e.key === 'r' || e.key === 'R') {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!isTyping) {
      if (Reader.isOpen()) {
        Reader.close();
      } else {
        const papers = APP.selectedPapers.size > 0
          ? [...APP.selectedPapers].map(id => APP.allPapers.find(p => p.arxiv_id === id)).filter(Boolean)
          : APP.filteredPapers.slice();
        Reader.open(papers);
      }
    }
    return;
  }

  // Arrow keys: navigate reader when open
  if (Reader.isOpen()) {
    if (e.key === 'ArrowLeft')  { Reader.prev(); return; }
    if (e.key === 'ArrowRight') { Reader.next(); return; }
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

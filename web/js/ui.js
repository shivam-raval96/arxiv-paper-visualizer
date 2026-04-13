/**
 * ui.js — DOM updates for all UI components
 */

const UI = (() => {

  // ── Detail Panel ──────────────────────────────────────────────────────────────

  function showDetailPanel(paper) {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('hidden');

    // Category badge
    const badge = document.getElementById('detail-category-badge');
    const catClass = 'cat-badge-' + paper.category.replace('.', '-');
    badge.className = catClass;
    badge.textContent = paper.category;

    document.getElementById('detail-title').textContent = paper.title;
    document.getElementById('detail-authors').textContent =
      (paper.authors || []).join(', ');
    document.getElementById('detail-date').textContent =
      paper.published ? `Published: ${paper.published}` : '';
    document.getElementById('detail-abstract').textContent =
      paper.abstract || 'No abstract available.';

    // arXiv link
    const link = document.getElementById('detail-arxiv-link');
    link.href = `https://arxiv.org/abs/${paper.arxiv_id}`;

    // Save button state
    _updateDetailSaveBtn(paper);
  }

  function closeDetailPanel() {
    document.getElementById('detail-panel').classList.add('hidden');
    APP.activePaper = null;
  }

  function _updateDetailSaveBtn(paper) {
    const btn = document.getElementById('detail-save-btn');
    if (!paper) return;
    const saved = APP.savedPapers.has(paper.arxiv_id);
    btn.textContent = saved ? 'Saved ✓' : 'Save Paper';
    btn.className   = saved ? 'action-btn active' : 'action-btn primary';
  }

  // ── Saved Sidebar ─────────────────────────────────────────────────────────────

  function updateSavedSidebar(filterQuery = '') {
    const list = document.getElementById('saved-list');
    const q = filterQuery.toLowerCase().trim();

    let papers = [...APP.savedPapers.values()];
    if (q) {
      papers = papers.filter(p =>
        p.title.toLowerCase().includes(q) ||
        (p.authors || []).some(a => a.toLowerCase().includes(q))
      );
    }

    // Sort by savedAt descending
    papers.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

    document.getElementById('saved-sidebar-count').textContent = APP.savedPapers.size;

    if (papers.length === 0) {
      list.innerHTML = `<div class="saved-empty">${
        APP.savedPapers.size === 0
          ? 'No saved papers yet.<br>Click a paper and press "Save Paper".'
          : 'No papers match your filter.'
      }</div>`;
      return;
    }

    list.innerHTML = '';
    for (const paper of papers) {
      const item = document.createElement('div');
      item.className = 'saved-item';
      item.dataset.id = paper.arxiv_id;

      const catClass = 'saved-item-cat cat-badge-' + paper.category.replace('.', '-');

      item.innerHTML = `
        <div class="saved-item-title">${_escape(paper.title)}</div>
        <div class="saved-item-meta">
          <span class="${catClass}">${_escape(paper.category)}</span>
          <span>${paper.published || ''}</span>
        </div>
        <button class="saved-item-remove" aria-label="Remove" title="Remove">×</button>
      `;

      item.querySelector('.saved-item-remove').addEventListener('click', async e => {
        e.stopPropagation();
        await _unsavePaper(paper.arxiv_id);
      });

      item.addEventListener('click', () => {
        // Show in detail panel
        APP.activePaper = paper;
        showDetailPanel(paper);
        Canvas.render();
      });

      list.appendChild(item);
    }
  }

  function updateSavedBadge() {
    document.getElementById('saved-count-badge').textContent = APP.savedPapers.size;
  }

  // ── Selection Info Bar ────────────────────────────────────────────────────────

  function updateSelectionInfo() {
    const total    = APP.filteredPapers.length;
    const selCount = APP.selectedPapers.size;
    const countEl  = document.getElementById('selection-count');
    const addBtn   = document.getElementById('add-selection-btn');
    const deselBtn = document.getElementById('deselect-btn');

    if (selCount > 0) {
      countEl.textContent = `${selCount} selected · ${total} visible`;
      addBtn.classList.remove('hidden');
      deselBtn.classList.remove('hidden');
    } else {
      countEl.textContent = `${total} paper${total !== 1 ? 's' : ''} visible`;
      addBtn.classList.add('hidden');
      deselBtn.classList.add('hidden');
    }
  }

  // ── Tooltip ───────────────────────────────────────────────────────────────────

  function showTooltip(paper, sx, sy) {
    const tt = document.getElementById('tooltip');
    tt.classList.remove('hidden');
    const authors = (paper.authors || []).slice(0, 3).map(_escape).join(', ')
                  + ((paper.authors || []).length > 3 ? ' et al.' : '');
    const arxivUrl = `https://arxiv.org/abs/${paper.arxiv_id}`;

    tt.innerHTML = `
      <div class="tooltip-title">${_escape(paper.title)}</div>
      <div class="tooltip-authors">${authors}</div>
      <div class="tooltip-meta">
        <span class="tooltip-cat">${_escape(paper.category)}</span>
        ${paper.published ? `<span class="tooltip-date">${_escape(paper.published)}</span>` : ''}
      </div>
      <a class="tooltip-link" href="${arxivUrl}" target="_blank" rel="noopener">
        arxiv.org/${_escape(paper.arxiv_id)} ↗
      </a>
    `;

    const container = document.getElementById('canvas-container');
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const tw = tt.offsetWidth  || 280;
    const th = tt.offsetHeight || 80;

    let tx = sx + 14;
    let ty = sy - 10;
    if (tx + tw > cw - 8) tx = sx - tw - 14;
    if (ty + th > ch - 8) ty = sy - th - 4;
    if (ty < 4) ty = 4;

    tt.style.left = `${tx}px`;
    tt.style.top  = `${ty}px`;
  }

  function hideTooltip() {
    document.getElementById('tooltip').classList.add('hidden');
  }

  // ── Lasso toggle ──────────────────────────────────────────────────────────────

  function toggleLassoMode() {
    const btn = document.getElementById('lasso-btn');
    if (APP.mode === 'lasso') {
      Lasso.disable();
      btn.classList.remove('active');
    } else {
      Lasso.enable();
      btn.classList.add('active');
    }
  }

  // ── Category filter button ────────────────────────────────────────────────────

  function updateCategoryFilterBtn() {
    const btn = document.getElementById('category-dropdown-btn');
    if (APP.filters.categories.size > 0) {
      btn.classList.add('active');
      btn.querySelector('.arrow').textContent = `(${APP.filters.categories.size}) ▾`;
    } else {
      btn.classList.remove('active');
      btn.querySelector('.arrow').textContent = '▾';
    }
  }

  // ── Save / Unsave helpers ─────────────────────────────────────────────────────

  async function savePaper(paper) {
    if (APP.savedPapers.has(paper.arxiv_id)) {
      await _unsavePaper(paper.arxiv_id);
    } else {
      await Storage.save(APP.db, paper);
      APP.savedPapers.set(paper.arxiv_id, { ...paper, savedAt: Date.now() });
      _updateDetailSaveBtn(paper);
      updateSavedSidebar();
      updateSavedBadge();
      Canvas.render();
      // Push to shared list in background
      _syncShared('add', paper);
    }
  }

  async function _unsavePaper(id) {
    await Storage.remove(APP.db, id);
    APP.savedPapers.delete(id);
    if (APP.activePaper?.arxiv_id === id) {
      _updateDetailSaveBtn(APP.activePaper);
    }
    updateSavedSidebar();
    updateSavedBadge();
    if (APP.currentView === 'saved') applyFiltersAndRender();
    else Canvas.render();
    // Remove from shared list in background
    _syncShared('remove', id);
  }

  // ── Shared sync ───────────────────────────────────────────────────────────────

  async function _syncShared(action, paperOrId) {
    if (!Shared.getToken()) return; // no token → local-only
    _setSharedSyncBar('syncing');
    try {
      if (action === 'add') {
        await Shared.addPaper(paperOrId);
      } else {
        await Shared.removePaper(paperOrId);
      }
      _setSharedSyncBar('ok');
    } catch (err) {
      console.warn('Shared sync failed:', err.message);
      _setSharedSyncBar('error', err.message);
    }
  }

  function updateSharedSyncBar(count, errMsg) {
    const bar  = document.getElementById('shared-sync-bar');
    const text = document.getElementById('shared-sync-text');
    if (!bar || !text) return;

    if (errMsg) {
      bar.className = 'shared-sync-bar shared-sync-bar--error';
      text.textContent = 'Could not load shared list';
      return;
    }

    const hasToken = !!Shared.getToken();
    if (count === null || count === undefined) {
      bar.className = 'shared-sync-bar';
      text.textContent = hasToken ? 'Shared list ready' : 'Read-only — add a GitHub token in Settings to save for everyone';
      return;
    }
    bar.className = 'shared-sync-bar shared-sync-bar--ok';
    text.textContent = hasToken
      ? `${count} shared paper${count !== 1 ? 's' : ''} — saves sync for all visitors`
      : `${count} shared paper${count !== 1 ? 's' : ''} — add a GitHub token in Settings to contribute`;
  }

  function _setSharedSyncBar(state, msg) {
    const bar  = document.getElementById('shared-sync-bar');
    const text = document.getElementById('shared-sync-text');
    if (!bar || !text) return;
    if (state === 'syncing') {
      bar.className = 'shared-sync-bar shared-sync-bar--syncing';
      text.textContent = 'Syncing…';
    } else if (state === 'ok') {
      bar.className = 'shared-sync-bar shared-sync-bar--ok';
      text.textContent = `Synced — ${APP.savedPapers.size} shared paper${APP.savedPapers.size !== 1 ? 's' : ''}`;
    } else {
      bar.className = 'shared-sync-bar shared-sync-bar--error';
      text.textContent = msg || 'Sync failed';
    }
  }

  // ── Event Listeners ───────────────────────────────────────────────────────────

  function initEventListeners() {
    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        APP.currentView = btn.dataset.view;

        // Show/hide sidebar based on view
        const sidebar = document.getElementById('saved-sidebar');
        if (APP.currentView === 'saved') {
          sidebar.classList.remove('hidden');
          updateSavedSidebar();
        } else {
          sidebar.classList.add('hidden');
        }

        applyFiltersAndRender();
      });
    });

    // Reset zoom
    document.getElementById('reset-view-btn').addEventListener('click', () => {
      Interactions.resetView();
    });

    // Lasso button
    document.getElementById('lasso-btn').addEventListener('click', toggleLassoMode);

    // Lasso mode selector
    document.querySelectorAll('.lasso-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lasso-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        APP.lassoMode = btn.dataset.mode;
      });
    });

    // Category dropdown toggle
    document.getElementById('category-dropdown-btn').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('category-dropdown').classList.toggle('hidden');
    });

    // Category checkboxes
    document.querySelectorAll('#category-dropdown input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) {
          APP.filters.categories.add(cb.value);
        } else {
          APP.filters.categories.delete(cb.value);
        }
        updateCategoryFilterBtn();
        applyFiltersAndRender();
      });
    });

    // Clear categories
    document.getElementById('clear-categories').addEventListener('click', () => {
      APP.filters.categories.clear();
      document.querySelectorAll('#category-dropdown input[type=checkbox]')
        .forEach(cb => cb.checked = false);
      updateCategoryFilterBtn();
      applyFiltersAndRender();
    });

    // Date filters
    const _dateDebounce = _debounce(() => applyFiltersAndRender(), 300);
    document.getElementById('date-start').addEventListener('input', e => {
      APP.filters.dateStart = e.target.value;
      _dateDebounce();
    });
    document.getElementById('date-end').addEventListener('input', e => {
      APP.filters.dateEnd = e.target.value;
      _dateDebounce();
    });

    // Author filter
    const _authorDebounce = _debounce(() => applyFiltersAndRender(), 250);
    document.getElementById('author-input').addEventListener('input', e => {
      APP.filters.author = e.target.value;
      _authorDebounce();
    });

    // Search
    const searchInput = document.getElementById('search-input');
    const searchBtn   = document.getElementById('search-btn');
    const clearBtn    = document.getElementById('clear-search-btn');

    function doSearch() {
      const query = searchInput.value.trim();
      Search.run(query);
      if (query) {
        APP.currentView = 'search';
        clearBtn.classList.remove('hidden');
        // Activate search view button
        document.querySelectorAll('.view-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.view === 'search');
        });
        document.getElementById('saved-sidebar').classList.add('hidden');
      }
      applyFiltersAndRender();
    }

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      APP.searchQuery = '';
      APP.searchResults.clear();
      APP.currentView = 'daily';
      clearBtn.classList.add('hidden');
      document.querySelectorAll('.view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === 'daily');
      });
      applyFiltersAndRender();
    });

    // Detail panel actions
    document.getElementById('close-detail').addEventListener('click', () => {
      APP.activePaper = null;
      closeDetailPanel();
      Canvas.render();
    });

    document.getElementById('detail-save-btn').addEventListener('click', () => {
      if (APP.activePaper) savePaper(APP.activePaper);
    });

    document.getElementById('detail-copy-btn').addEventListener('click', () => {
      if (APP.activePaper) {
        navigator.clipboard?.writeText(APP.activePaper.arxiv_id)
          .then(() => {
            const btn = document.getElementById('detail-copy-btn');
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy arXiv ID', 1500);
          });
      }
    });

    // Selection bar actions
    document.getElementById('add-selection-btn').addEventListener('click', async () => {
      for (const id of APP.selectedPapers) {
        const paper = APP.allPapers.find(p => p.arxiv_id === id);
        if (paper && !APP.savedPapers.has(id)) {
          await Storage.save(APP.db, paper);
          APP.savedPapers.set(id, { ...paper, savedAt: Date.now() });
        }
      }
      updateSavedSidebar();
      updateSavedBadge();
      Canvas.render();
    });

    document.getElementById('deselect-btn').addEventListener('click', () => {
      APP.selectedPapers.clear();
      Canvas.render();
      updateSelectionInfo();
    });

    // Saved sidebar controls
    const _savedSearchDebounce = _debounce(q => updateSavedSidebar(q), 200);
    document.getElementById('saved-search-input').addEventListener('input', e => {
      _savedSearchDebounce(e.target.value);
    });

    document.getElementById('export-saved-btn').addEventListener('click', () => {
      Storage.exportJSON();
    });

    document.getElementById('import-saved-btn').addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });

    document.getElementById('import-file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const count = await Storage.importJSON(APP.db, file);
        updateSavedSidebar();
        updateSavedBadge();
        Canvas.render();
        alert(`Imported ${count} papers.`);
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
      e.target.value = ''; // reset file input
    });

    // Insights panel collapse toggle
    document.getElementById('insights-toggle')?.addEventListener('click', () => {
      const body = document.getElementById('insights-body');
      const btn  = document.getElementById('insights-toggle');
      const hidden = body.classList.toggle('collapsed');
      btn.textContent = hidden ? '▸' : '▾';
    });

    document.getElementById('clear-saved-btn').addEventListener('click', async () => {
      if (!confirm('Clear all saved papers?')) return;
      await Storage.clearAll(APP.db);
      APP.savedPapers.clear();
      updateSavedSidebar();
      updateSavedBadge();
      if (APP.activePaper) _updateDetailSaveBtn(APP.activePaper);
      if (APP.currentView === 'saved') applyFiltersAndRender();
      else Canvas.render();
    });
  }

  // ── Month Tabs ────────────────────────────────────────────────────────────────

  function buildMonthTabs() {
    const container = document.getElementById('month-tabs');
    if (!container) return;
    container.innerHTML = '';
    for (const m of APP.manifest) {
      const btn = document.createElement('button');
      btn.className = 'month-tab' + (m.key === APP.currentMonth ? ' active' : '');
      btn.textContent = m.label;
      btn.title = `${m.count} papers`;
      btn.addEventListener('click', () => switchMonth(m.key));
      container.appendChild(btn);
    }
  }

  // ── Insights Panel ────────────────────────────────────────────────────────────

  function updateInsights() {
    const entry = APP.manifest.find(m => m.key === APP.currentMonth);
    const label = entry?.label || APP.currentMonth || '';

    document.getElementById('insights-title').textContent = `${label} — ${APP.allPapers.length} papers`;

    // Category breakdown
    const catCounts = {};
    for (const p of APP.allPapers) {
      catCounts[p.category] = (catCounts[p.category] || 0) + 1;
    }
    const colors = Canvas.getCategoryColors();
    const statsEl = document.getElementById('insights-stats');
    const sorted = Object.entries(catCounts).sort((a,b) => b[1]-a[1]);
    statsEl.innerHTML = sorted.map(([cat, n]) => {
      const pct = Math.round(n / APP.allPapers.length * 100);
      const color = colors[cat] || '#8890b0';
      return `<div class="insight-cat-row">
        <span class="insight-dot" style="background:${color}"></span>
        <span class="insight-cat-name">${_escape(cat)}</span>
        <div class="insight-bar-wrap">
          <div class="insight-bar" style="width:${pct}%;background:${color}20;border-left:3px solid ${color}"></div>
        </div>
        <span class="insight-cat-count">${n}</span>
      </div>`;
    }).join('');

    // Top clusters
    const clustersEl = document.getElementById('insights-clusters');
    if (!APP.clusters.length) { clustersEl.innerHTML = ''; return; }
    const clusterCounts = {};
    for (const p of APP.allPapers) {
      if (p.cluster_id != null) clusterCounts[p.cluster_id] = (clusterCounts[p.cluster_id]||0)+1;
    }
    clustersEl.innerHTML = '<div class="insight-section-title">Clusters</div>' +
      APP.clusters.map(c => {
        const n = clusterCounts[c.id] || 0;
        const pct = Math.round(n / APP.allPapers.length * 100);
        return `<div class="insight-cluster-row" data-cluster="${c.id}" title="Click to highlight">
          <span class="insight-cluster-label">${_escape(c.label)}</span>
          <div class="insight-bar-wrap">
            <div class="insight-bar" style="width:${pct}%;background:rgba(79,142,247,0.15);border-left:3px solid #4f8ef7"></div>
          </div>
          <span class="insight-cat-count">${n}</span>
        </div>`;
      }).join('');

    // Click cluster row → filter to that cluster
    clustersEl.querySelectorAll('.insight-cluster-row').forEach(row => {
      row.addEventListener('click', () => {
        const cid = parseInt(row.dataset.cluster);
        const ids = new Set(APP.allPapers.filter(p => p.cluster_id === cid).map(p => p.arxiv_id));
        APP.selectedPapers = ids;
        Canvas.render();
        updateSelectionInfo();
      });
    });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────────

  function _debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function _escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    initEventListeners,
    showDetailPanel,
    closeDetailPanel,
    updateSavedSidebar,
    updateSavedBadge,
    updateSelectionInfo,
    showTooltip,
    hideTooltip,
    toggleLassoMode,
    updateCategoryFilterBtn,
    savePaper,
    buildMonthTabs,
    updateInsights,
    updateSharedSyncBar,
  };
})();

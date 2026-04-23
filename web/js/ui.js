/**
 * ui.js — DOM updates for all UI components
 */

const UI = (() => {

  // ── Detail Panel ──────────────────────────────────────────────────────────────

  function showDetailPanel(paper) {
    const panel = document.getElementById('detail-panel');
    // Show detail, hide saved sidebar and empty state
    document.getElementById('saved-sidebar').classList.add('hidden');
    document.getElementById('right-panel-empty').classList.add('hidden');
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

    // Structured metadata
    const existingMeta = document.getElementById('detail-meta-section');
    if (existingMeta) existingMeta.remove();
    const metaHTML = _metaSectionHTML(paper);
    if (metaHTML) {
      document.getElementById('detail-abstract-container').insertAdjacentHTML('afterend', metaHTML);
    }

    // Annotation
    const annotationEl = document.getElementById('detail-annotation');
    if (annotationEl) annotationEl.value = _loadAnnotation(paper.arxiv_id);

    // arXiv link
    const link = document.getElementById('detail-arxiv-link');
    link.href = `https://arxiv.org/abs/${paper.arxiv_id}`;

    // Save button state
    _updateDetailSaveBtn(paper);
  }

  function closeDetailPanel() {
    document.getElementById('detail-panel').classList.add('hidden');
    APP.activePaper = null;
    // Show empty state when not in saved view
    if (APP.currentView !== 'saved') {
      document.getElementById('right-panel-empty').classList.remove('hidden');
    }
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

  // ── Selection Panel (left panel) ─────────────────────────────────────────────

  function updateSelectionPanel() {
    const panel     = document.getElementById('selection-panel');
    const countEl   = document.getElementById('selection-panel-count');
    const list      = document.getElementById('selection-list');
    const selCount  = APP.selectedPapers.size;

    if (selCount === 0) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    countEl.textContent = `${selCount} selected`;

    // Show/hide compare button depending on whether group A is set
    const compareBtn = document.getElementById('sel-compare-btn');
    if (compareBtn) compareBtn.classList.toggle('hidden', !APP.compareGroupA);

    // Look up paper objects for each selected id
    const papers = [...APP.selectedPapers]
      .map(id => APP.allPapers.find(p => p.arxiv_id === id))
      .filter(Boolean);

    list.innerHTML = '';
    for (const paper of papers) {
      const item = document.createElement('div');
      item.className = 'sel-item' + (APP.activePaper?.arxiv_id === paper.arxiv_id ? ' active' : '');
      const authors = (paper.authors || []).slice(0, 2).join(', ')
                    + ((paper.authors || []).length > 2 ? ' et al.' : '');
      item.innerHTML = `
        <div class="sel-item__title">${_escape(paper.title)}</div>
        ${authors ? `<div class="sel-item__authors">${_escape(authors)}</div>` : ''}
      `;
      item.addEventListener('click', () => {
        APP.activePaper = paper;
        showDetailPanel(paper);
        Canvas.render();
        // Highlight the clicked item
        list.querySelectorAll('.sel-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
      });
      list.appendChild(item);
    }
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

  function _firstSentence(text) {
    if (!text) return '';
    const m = text.match(/^[^.!?]*[.!?]/);
    const s = m ? m[0].trim() : text.slice(0, 180);
    return s.length > 220 ? s.slice(0, 217) + '…' : s;
  }

  function showTooltip(paper, sx, sy) {
    const tt = document.getElementById('tooltip');

    const authors = (paper.authors || []).slice(0, 2).map(_escape).join(', ')
                  + ((paper.authors || []).length > 2 ? ' et al.' : '');
    const catClass  = 'cat-badge-' + (paper.category || '').replace('.', '-');
    const firstSent = _firstSentence(paper.abstract || '');
    const tldr      = paper.tldr || '';

    // Structured metadata chips (compact, inline)
    const metaChips = _metaChipsHTML(paper);

    tt.innerHTML = `
      <div class="tt-header">
        <span class="${catClass} tt-cat">${_escape(paper.category || '')}</span>
        <span class="tt-date">${paper.published || ''}</span>
      </div>
      <div class="tt-title">${_escape(paper.title)}</div>
      ${authors ? `<div class="tt-authors">${authors}</div>` : ''}
      ${firstSent ? `<div class="tt-abstract">${_escape(firstSent)}</div>` : ''}
      ${metaChips}
      ${tldr ? `<div class="tt-tldr"><span class="tt-tldr-label">TL;DR</span> ${_escape(tldr)}</div>` : ''}
    `;

    tt.classList.remove('hidden');

    const container = document.getElementById('canvas-container');
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const tw = tt.offsetWidth  || 340;
    const th = tt.offsetHeight || 120;

    let tx = sx + 16;
    let ty = sy - 16;
    if (tx + tw > cw - 8) tx = sx - tw - 16;
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

        // Manage right panel visibility based on view
        const sidebar = document.getElementById('saved-sidebar');
        const detailPanel = document.getElementById('detail-panel');
        const emptyState = document.getElementById('right-panel-empty');
        if (APP.currentView === 'saved') {
          detailPanel.classList.add('hidden');
          emptyState.classList.add('hidden');
          sidebar.classList.remove('hidden');
          updateSavedSidebar();
        } else {
          sidebar.classList.add('hidden');
          if (APP.activePaper) {
            emptyState.classList.add('hidden');
            detailPanel.classList.remove('hidden');
          } else {
            detailPanel.classList.add('hidden');
            emptyState.classList.remove('hidden');
          }
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
        // Restore empty state if no paper is active
        if (!APP.activePaper) {
          document.getElementById('right-panel-empty').classList.remove('hidden');
          document.getElementById('detail-panel').classList.add('hidden');
        }
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
      // Restore right panel state
      document.getElementById('saved-sidebar').classList.add('hidden');
      if (!APP.activePaper) {
        document.getElementById('right-panel-empty').classList.remove('hidden');
        document.getElementById('detail-panel').classList.add('hidden');
      }
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
      updateSelectionPanel();
      updateSelectionTable();
    });

    document.getElementById('clear-selection-btn').addEventListener('click', () => {
      APP.selectedPapers.clear();
      Canvas.render();
      updateSelectionInfo();
      updateSelectionPanel();
      updateSelectionTable();
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

    // ── Cluster panel ─────────────────────────────────────────────────────────
    document.getElementById('cluster-panel-close')?.addEventListener('click', closeClusterPanel);
    document.getElementById('cluster-overlay')?.addEventListener('click', closeClusterPanel);
    document.getElementById('cluster-summary-btn')?.addEventListener('click', _generateClusterSummary);

    document.getElementById('compare-set-a-btn')?.addEventListener('click', () => {
      if (!_activeCluster) return;
      const papers = APP.allPapers.filter(p => p.cluster_id === _activeCluster.id);
      APP.compareGroupA = { papers, label: _activeCluster.label };
      const aLabel = document.getElementById('compare-a-label');
      aLabel.textContent = 'Group A set ✓';
      aLabel.classList.remove('hidden');
      document.getElementById('compare-run-btn').classList.remove('hidden');
      // Also update sel-panel compare button
      document.getElementById('sel-compare-btn')?.classList.remove('hidden');
    });

    document.getElementById('compare-run-btn')?.addEventListener('click', () => {
      if (!_activeCluster || !APP.compareGroupA) return;
      const papers = APP.allPapers.filter(p => p.cluster_id === _activeCluster.id);
      closeClusterPanel();
      showComparePanel({ papers, label: _activeCluster.label });
    });

    document.getElementById('compare-panel-close')?.addEventListener('click', closeComparePanel);
    document.getElementById('compare-overlay')?.addEventListener('click', closeComparePanel);

    // ── Selection panel analysis ──────────────────────────────────────────────
    document.getElementById('sel-analyze-btn')?.addEventListener('click', () => {
      const kwEl = document.getElementById('sel-keywords');
      if (kwEl.classList.contains('hidden')) {
        const papers = [...APP.selectedPapers]
          .map(id => APP.allPapers.find(p => p.arxiv_id === id))
          .filter(Boolean);
        const kws = _extractKeywords(papers, 14);
        kwEl.innerHTML = kws.map(w => `<span class="keyword-pill">${_escape(w)}</span>`).join('');
        kwEl.classList.remove('hidden');
      } else {
        kwEl.classList.add('hidden');
      }
    });

    document.getElementById('sel-set-a-btn')?.addEventListener('click', () => {
      const papers = [...APP.selectedPapers]
        .map(id => APP.allPapers.find(p => p.arxiv_id === id))
        .filter(Boolean);
      APP.compareGroupA = { papers, label: `${papers.length} selected papers` };
      document.getElementById('sel-compare-btn')?.classList.remove('hidden');
      document.getElementById('compare-run-btn')?.classList.remove('hidden');
    });

    document.getElementById('sel-compare-btn')?.addEventListener('click', () => {
      if (!APP.compareGroupA) return;
      const papers = [...APP.selectedPapers]
        .map(id => APP.allPapers.find(p => p.arxiv_id === id))
        .filter(Boolean);
      showComparePanel({ papers, label: `${papers.length} selected papers` });
    });

    // ── Annotation auto-save ──────────────────────────────────────────────────
    const annotationEl = document.getElementById('detail-annotation');
    if (annotationEl) {
      const _annotDebounce = _debounce((text) => {
        if (APP.activePaper) _saveAnnotation(APP.activePaper.arxiv_id, text);
      }, 600);
      annotationEl.addEventListener('input', e => _annotDebounce(e.target.value));
    }

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

    // ── Resize handles ────────────────────────────────────────────────────────
    const leftPanel   = document.getElementById('left-panel');
    const rightPanel  = document.getElementById('right-panel');
    const resizeLeft  = document.getElementById('resize-left');
    const resizeRight = document.getElementById('resize-right');

    if (resizeLeft && leftPanel) {
      resizeLeft.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = leftPanel.offsetWidth;
        const onMove = e => {
          leftPanel.style.width = Math.max(160, Math.min(480, startW + e.clientX - startX)) + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    if (resizeRight && rightPanel) {
      resizeRight.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = rightPanel.offsetWidth;
        const onMove = e => {
          rightPanel.style.width = Math.max(260, Math.min(580, startW - (e.clientX - startX))) + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
  }

  // ── Selection Table Panel ─────────────────────────────────────────────────────

  const TABLE_COLS = [
    { key: 'title',       label: 'Title',        wrap: true  },
    { key: '_authors',    label: 'Authors',       wrap: false },
    { key: 'published',   label: 'Date',          wrap: false },
    { key: 'category',    label: 'Category',      wrap: false },
    { key: '_cluster',    label: 'Cluster',       wrap: false },
    { key: 'methods',     label: 'Methods',       wrap: true  },
    { key: 'models',      label: 'Models / LLMs', wrap: true  },
    { key: 'dataset',     label: 'Datasets',      wrap: true  },
    { key: 'baselines',   label: 'Baselines',     wrap: true  },
    { key: 'evaluations', label: 'Evaluations',   wrap: true  },
    { key: 'insights',    label: 'Insights',      wrap: true  },
    { key: 'comments',    label: 'Comments',      wrap: true  },
    { key: 'tldr',        label: 'TL;DR',         wrap: true  },
  ];

  function _paperTableVal(paper, col) {
    if (col.key === '_authors') {
      const a = paper.authors || [];
      return a.slice(0, 2).join(', ') + (a.length > 2 ? ' et al.' : '');
    }
    if (col.key === '_cluster') {
      const c = (APP.clusters || []).find(c => c.id === paper.cluster_id);
      return c ? c.label : (paper.cluster_id != null ? `#${paper.cluster_id}` : '');
    }
    return paper[col.key] || null;
  }

  function updateSelectionTable() {
    const panel   = document.getElementById('table-panel');
    const countEl = document.getElementById('table-panel-count');
    const thead   = document.getElementById('sel-table-head');
    const tbody   = document.getElementById('sel-table-body');
    const sel     = APP.selectedPapers;

    if (!sel || sel.size === 0) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    countEl.textContent = sel.size;

    // Header (only once or on column change)
    thead.innerHTML = `<tr>${
      TABLE_COLS.map(c => `<th>${_escape(c.label)}</th>`).join('')
    }</tr>`;

    // Rows
    const papers = [...sel]
      .map(id => APP.allPapers.find(p => p.arxiv_id === id))
      .filter(Boolean);

    tbody.innerHTML = '';
    for (const paper of papers) {
      const tr = document.createElement('tr');
      if (APP.activePaper?.arxiv_id === paper.arxiv_id) tr.classList.add('active-row');

      for (const col of TABLE_COLS) {
        const td  = document.createElement('td');
        const val = _paperTableVal(paper, col);
        if (col.wrap) td.classList.add('wrap');
        if (!val) {
          td.classList.add('null-cell');
          td.textContent = '—';
        } else {
          td.textContent = val;
          td.title = val; // full text on hover for truncated cells
        }
        tr.appendChild(td);
      }

      tr.addEventListener('click', () => {
        APP.activePaper = paper;
        showDetailPanel(paper);
        Canvas.render();
        tbody.querySelectorAll('tr').forEach(r => r.classList.remove('active-row'));
        tr.classList.add('active-row');
      });

      tbody.appendChild(tr);
    }
  }

  function _exportTableCSV() {
    const sel = APP.selectedPapers;
    if (!sel || sel.size === 0) return;

    const papers = [...sel]
      .map(id => APP.allPapers.find(p => p.arxiv_id === id))
      .filter(Boolean);

    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = TABLE_COLS.map(c => escape(c.label)).join(',');
    const rows   = papers.map(p =>
      TABLE_COLS.map(c => escape(_paperTableVal(p, c) ?? '')).join(',')
    );

    const csv  = [header, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `arxiv_selection_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function _initTablePanel() {
    // Drag-to-resize from handle
    const panel  = document.getElementById('table-panel');
    const handle = document.getElementById('table-panel-handle');
    let _startY, _startH;

    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return; // don't drag on button clicks
      _startY = e.clientY;
      _startH = panel.offsetHeight;
      const onMove = ev => {
        const delta = _startY - ev.clientY;
        const newH  = Math.max(40, Math.min(window.innerHeight * 0.7, _startH + delta));
        panel.style.height = newH + 'px';
        panel.classList.remove('collapsed');
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    document.getElementById('table-collapse-btn').addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      document.getElementById('table-collapse-btn').textContent = collapsed ? '▴' : '▾';
    });

    document.getElementById('table-close-btn').addEventListener('click', () => {
      APP.selectedPapers.clear();
      panel.classList.add('hidden');
      Canvas.render();
      updateSelectionInfo();
      updateSelectionPanel();
    });

    document.getElementById('table-export-btn').addEventListener('click', _exportTableCSV);
  }

  // ── Month Tabs ────────────────────────────────────────────────────────────────

  function buildMonthTabs() {
    const container = document.getElementById('month-tabs');
    if (!container) return;
    container.innerHTML = '';
    for (const m of APP.manifest) {
      const btn = document.createElement('button');
      const isActive = m.key === APP.currentMonth;
      btn.className = 'month-tab'
        + (isActive   ? ' active'      : '')
        + (m.isDaily  ? ' month-tab--daily' : '');
      btn.textContent = m.label;
      btn.title = `${m.count} papers · ${m.isDaily ? 'Daily snapshot' : 'Monthly archive'}`;
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

  // ── Cluster Summary Panel ─────────────────────────────────────────────────────

  let _activeCluster = null; // cluster currently shown in panel

  function showClusterPanel(cluster) {
    _activeCluster = cluster;
    const papers = APP.allPapers.filter(p => p.cluster_id === cluster.id);

    // Header
    document.getElementById('cluster-panel-name').textContent = cluster.label;
    document.getElementById('cluster-panel-meta').textContent =
      `${papers.length} paper${papers.length !== 1 ? 's' : ''} · Cluster ${cluster.id}`;

    // Keywords
    const kws = _extractKeywords(papers, 16);
    const kwEl = document.getElementById('cluster-keywords');
    kwEl.innerHTML = kws.map(w =>
      `<span class="keyword-pill">${_escape(w)}</span>`
    ).join('');

    // AI summary reset
    const summaryEl = document.getElementById('cluster-summary-text');
    summaryEl.textContent = 'Add your OpenAI key in Settings, then click Generate.';
    summaryEl.className = 'cluster-summary-text';

    // Top 5 most recent papers
    const recent = [...papers]
      .filter(p => p.published)
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, 5);
    const listEl = document.getElementById('cluster-papers-list');
    listEl.innerHTML = recent.map(p => `
      <div class="cluster-paper-item" data-id="${_escape(p.arxiv_id)}">
        <div class="cluster-paper-item__title">${_escape(p.title)}</div>
        <div class="cluster-paper-item__meta">${_escape((p.authors || []).slice(0,2).join(', '))}${(p.authors||[]).length>2?' et al.':''} · ${p.published || ''}</div>
      </div>
    `).join('');

    listEl.querySelectorAll('.cluster-paper-item').forEach(item => {
      item.addEventListener('click', () => {
        const paper = APP.allPapers.find(p => p.arxiv_id === item.dataset.id);
        if (paper) { APP.activePaper = paper; showDetailPanel(paper); Canvas.render(); }
      });
    });

    // Compare buttons state
    const runBtn = document.getElementById('compare-run-btn');
    const aLabel = document.getElementById('compare-a-label');
    if (APP.compareGroupA) {
      runBtn.classList.remove('hidden');
      aLabel.classList.remove('hidden');
      aLabel.textContent = `vs. "${APP.compareGroupA.label}"`;
    } else {
      runBtn.classList.add('hidden');
      aLabel.classList.add('hidden');
    }

    // Show modal
    document.getElementById('cluster-overlay').classList.remove('hidden');
    document.getElementById('cluster-panel').classList.remove('hidden');
  }

  function closeClusterPanel() {
    document.getElementById('cluster-overlay').classList.add('hidden');
    document.getElementById('cluster-panel').classList.add('hidden');
    _activeCluster = null;
  }

  async function _generateClusterSummary() {
    if (!_activeCluster) return;
    const key = Settings.getOpenAIKey();
    if (!key) {
      document.getElementById('cluster-summary-text').textContent =
        'No OpenAI key found. Add it in Settings first.';
      return;
    }
    const papers = APP.allPapers.filter(p => p.cluster_id === _activeCluster.id);
    const titles = papers.map(p => p.title).slice(0, 25);
    const summaryEl = document.getElementById('cluster-summary-text');
    summaryEl.textContent = 'Generating…';
    summaryEl.className = 'cluster-summary-text loading';

    try {
      const prompt =
        'You are a research analyst. Given these arXiv paper titles from a semantic cluster, ' +
        'write ONE concise sentence (max 30 words) describing what this research cluster is about. ' +
        'No preamble, no bullet points.\n\n' +
        titles.map(t => `- ${t}`).join('\n');

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 60, temperature: 0.3,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      summaryEl.textContent = data.choices[0].message.content.trim();
      summaryEl.className = 'cluster-summary-text';
    } catch (err) {
      summaryEl.textContent = `Error: ${err.message}`;
      summaryEl.className = 'cluster-summary-text';
    }
  }

  // ── Group Comparison ──────────────────────────────────────────────────────────

  function showComparePanel(groupB) {
    const A = APP.compareGroupA;
    if (!A) return;

    const kwA = _extractKeywords(A.papers, 18);
    const kwB = _extractKeywords(groupB.papers, 18);

    document.getElementById('compare-a-heading').textContent = A.label;
    document.getElementById('compare-b-heading').textContent = groupB.label;
    document.getElementById('compare-a-count').textContent = `${A.papers.length} papers`;
    document.getElementById('compare-b-count').textContent = `${groupB.papers.length} papers`;

    const setA = new Set(kwA);
    const setB = new Set(kwB);

    const renderKws = (words, otherSet, elId) => {
      document.getElementById(elId).innerHTML = words.map(w => {
        const unique = !otherSet.has(w);
        return `<span class="keyword-pill${unique ? ' keyword-pill--unique' : ''}">${_escape(w)}</span>`;
      }).join('');
    };
    renderKws(kwA, setB, 'compare-keywords-a');
    renderKws(kwB, setA, 'compare-keywords-b');

    document.getElementById('compare-overlay').classList.remove('hidden');
    document.getElementById('compare-panel').classList.remove('hidden');
  }

  function closeComparePanel() {
    document.getElementById('compare-overlay').classList.add('hidden');
    document.getElementById('compare-panel').classList.add('hidden');
  }

  // ── Keyword extraction (TF-weighted, stopwords filtered) ──────────────────────

  function _extractKeywords(papers, topN = 15) {
    const STOP = new Set(
      'the a an of in for and or to with is are this that on from as by at it be was were can we our their been have has which also not its into more than through these such paper papers propose show demonstrate present based using used method approach model models results data task tasks training trained new each between two while both use one first performance existing recent state art large problem abstract introduction we propose furthermore however moreover thus therefore since although despite both where when model models network networks learn learning deep neural image images text'.split(' ')
    );
    const freq = {};
    for (const p of papers) {
      const text = `${p.title} ${p.abstract || ''}`.toLowerCase();
      const words = text.match(/\b[a-z]{4,}\b/g) || [];
      for (const w of words) {
        if (!STOP.has(w)) freq[w] = (freq[w] || 0) + 1;
      }
    }
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([w]) => w);
  }

  // ── Annotations (localStorage) ────────────────────────────────────────────────

  function _loadAnnotation(arxivId) {
    return localStorage.getItem(`paper-note-${arxivId}`) || '';
  }

  function _saveAnnotation(arxivId, text) {
    if (text.trim()) {
      localStorage.setItem(`paper-note-${arxivId}`, text);
    } else {
      localStorage.removeItem(`paper-note-${arxivId}`);
    }
  }

  // ── Paper metadata helpers ────────────────────────────────────────────────────

  /** Render compact meta rows for tooltip (only non-null fields). */
  function _metaChipsHTML(paper) {
    const rows = [
      { label: 'Methods',    val: paper.methods     },
      { label: 'LLMs/Models', val: paper.models     },
      { label: 'Datasets',   val: paper.dataset     },
      { label: 'Eval',       val: paper.evaluations },
    ].filter(r => r.val);
    if (!rows.length) return '';
    return `<div class="tt-meta-rows">${
      rows.map(r =>
        `<div class="tt-meta-row"><span class="tt-meta-label">${r.label}</span><span class="tt-meta-val">${_escape(r.val)}</span></div>`
      ).join('')
    }</div>`;
  }

  /** Render full structured metadata section for detail panel. */
  function _metaSectionHTML(paper) {
    const fields = [
      { key: 'methods',     label: 'Methods'     },
      { key: 'models',      label: 'Models'      },
      { key: 'dataset',     label: 'Dataset'     },
      { key: 'baselines',   label: 'Baselines'   },
      { key: 'evaluations', label: 'Evaluations' },
      { key: 'insights',    label: 'Insights'    },
      { key: 'comments',    label: 'Comments'    },
    ].filter(f => paper[f.key]);

    if (!fields.length) return '';

    return `
      <div id="detail-meta-section" class="detail-meta-section">
        <h3>Paper Metadata</h3>
        <dl class="detail-meta-list">
          ${fields.map(f => `
            <dt class="detail-meta-dt">${f.label}</dt>
            <dd class="detail-meta-dd">${_escape(paper[f.key])}</dd>
          `).join('')}
        </dl>
      </div>`;
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
    initTablePanel: _initTablePanel,
    showDetailPanel,
    closeDetailPanel,
    updateSavedSidebar,
    updateSavedBadge,
    updateSelectionInfo,
    updateSelectionPanel,
    updateSelectionTable,
    showTooltip,
    hideTooltip,
    toggleLassoMode,
    updateCategoryFilterBtn,
    savePaper,
    buildMonthTabs,
    updateInsights,
    updateSharedSyncBar,
    showClusterPanel,
    closeClusterPanel,
    showComparePanel,
    closeComparePanel,
  };
})();

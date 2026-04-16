/**
 * reader.js — Reading mode: distraction-free abstract card stack
 * Hotkey: R  |  Navigate: ← → arrow keys or swipe
 */

const Reader = (() => {
  let _papers = [];
  let _idx = 0;

  // ── Public API ────────────────────────────────────────────────────────────────

  function open(papers) {
    _papers = (papers || []).filter(Boolean);
    if (!_papers.length) return;
    _idx = 0;
    _render();
    document.getElementById('reader-overlay').classList.remove('hidden');
  }

  function close() {
    document.getElementById('reader-overlay').classList.add('hidden');
  }

  function isOpen() {
    return !document.getElementById('reader-overlay').classList.contains('hidden');
  }

  function prev() {
    if (_idx > 0) { _idx--; _render(); }
  }

  function next() {
    if (_idx < _papers.length - 1) { _idx++; _render(); }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function _render() {
    const paper = _papers[_idx];
    if (!paper) return;

    document.getElementById('reader-progress').textContent =
      `${_idx + 1} / ${_papers.length}`;

    const prevBtn = document.getElementById('reader-prev');
    const nextBtn = document.getElementById('reader-next');
    prevBtn.disabled = _idx === 0;
    nextBtn.disabled = _idx === _papers.length - 1;

    // Badge
    const badge = document.getElementById('reader-card-badge');
    badge.textContent = paper.category;
    badge.className = 'cat-badge-' + paper.category.replace('.', '-');
    badge.style.cssText = 'display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;margin-bottom:12px';

    document.getElementById('reader-card-title').textContent    = paper.title;
    document.getElementById('reader-card-authors').textContent  = (paper.authors || []).join(', ');
    document.getElementById('reader-card-date').textContent     =
      paper.published ? `Published: ${paper.published}` : '';
    document.getElementById('reader-card-abstract').textContent =
      paper.abstract || 'No abstract available.';

    document.getElementById('reader-arxiv-link').href = `https://arxiv.org/abs/${paper.arxiv_id}`;

    const saveBtn  = document.getElementById('reader-save-btn');
    const isSaved  = APP.savedPapers.has(paper.arxiv_id);
    saveBtn.textContent = isSaved ? 'Saved ✓' : 'Save Paper';
    saveBtn.className   = isSaved ? 'action-btn active small' : 'action-btn primary small';

    // Re-trigger CSS animation
    const card = document.getElementById('reader-card');
    card.style.animation = 'none';
    void card.offsetWidth; // force reflow
    card.style.animation = '';
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('reader-close').addEventListener('click', close);
    document.getElementById('reader-prev').addEventListener('click', prev);
    document.getElementById('reader-next').addEventListener('click', next);

    document.getElementById('reader-save-btn').addEventListener('click', () => {
      if (_papers[_idx]) {
        UI.savePaper(_papers[_idx]);
        _render();
      }
    });

    // Touch swipe
    let _touchX = 0;
    const overlay = document.getElementById('reader-overlay');
    overlay.addEventListener('touchstart', e => {
      _touchX = e.touches[0].clientX;
    }, { passive: true });
    overlay.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - _touchX;
      if (Math.abs(dx) > 60) { if (dx < 0) next(); else prev(); }
    });
  }

  return { open, close, isOpen, prev, next, init };
})();

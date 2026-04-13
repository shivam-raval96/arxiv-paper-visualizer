/**
 * search.js — Full-text search and multi-criteria filtering
 */

const Search = (() => {

  /**
   * Run a text search across all papers.
   * Updates APP.searchResults and APP.searchQuery.
   * @param {string} query
   */
  function run(query) {
    query = query.trim();
    APP.searchQuery = query;
    APP.searchResults.clear();

    if (!query) return;

    const q = query.toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);

    for (const paper of APP.allPapers) {
      const haystack = [
        paper.title,
        paper.abstract,
        ...(paper.authors || [])
      ].join(' ').toLowerCase();

      // All terms must be present (AND logic)
      if (terms.every(t => haystack.includes(t))) {
        APP.searchResults.add(paper.arxiv_id);
      }
    }
  }

  /**
   * Return papers that should be visible given current view, search, and filters.
   * Handles 'daily', 'saved', and 'search' views.
   */
  function getVisiblePapers() {
    let papers;

    switch (APP.currentView) {
      case 'saved':
        papers = APP.allPapers.filter(p => APP.savedPapers.has(p.arxiv_id));
        break;
      case 'search':
        if (!APP.searchQuery) {
          papers = APP.allPapers.slice();
        } else {
          papers = APP.allPapers.filter(p => APP.searchResults.has(p.arxiv_id));
        }
        break;
      default: // 'daily'
        papers = APP.allPapers.slice();
        break;
    }

    // Apply category filter
    if (APP.filters.categories.size > 0) {
      papers = papers.filter(p => APP.filters.categories.has(p.category));
    }

    // Apply date filter
    if (APP.filters.dateStart) {
      papers = papers.filter(p => p.published >= APP.filters.dateStart);
    }
    if (APP.filters.dateEnd) {
      papers = papers.filter(p => p.published <= APP.filters.dateEnd);
    }

    // Apply author filter
    if (APP.filters.author) {
      const q = APP.filters.author.toLowerCase();
      papers = papers.filter(p =>
        (p.authors || []).some(a => a.toLowerCase().includes(q))
      );
    }

    return papers;
  }

  return { run, getVisiblePapers };
})();

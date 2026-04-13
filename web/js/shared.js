/**
 * shared.js — Shared saved papers via GitHub Contents API
 *
 * The shared list lives at web/data/shared_saved.json in the GitHub repo.
 * Reads are public (no auth, no CDN caching via the API endpoint).
 * Writes require a GitHub Personal Access Token with `contents: write`
 * permission on this repository — entered once in Settings.
 *
 * Concurrency: every write first re-fetches the current file to get the
 * latest SHA and content, then merges, so two users saving at the same time
 * won't clobber each other.
 */

const Shared = (() => {

  const OWNER = 'shivam-raval96';
  const REPO  = 'arxiv-paper-visualizer';
  const PATH  = 'web/data/shared_saved.json';
  const API   = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;

  let _token = '';
  let _sha   = '';   // current blob SHA — required for GitHub PUT updates

  // ── Token management ──────────────────────────────────────────────────────────

  function setToken(t) {
    _token = t.trim();
    if (_token) localStorage.setItem('gh_token', _token);
    else        localStorage.removeItem('gh_token');
  }

  function getToken() { return _token; }

  function loadTokenFromStorage() {
    _token = localStorage.getItem('gh_token') || '';
    return _token;
  }

  // ── Decode GitHub's base64 content (handles Unicode) ──────────────────────────

  function _decode(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
  }

  function _encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  // ── Read ──────────────────────────────────────────────────────────────────────

  /**
   * Fetch the current shared list from GitHub.
   * Always bypasses CDN cache (goes to the API, not the Pages static URL).
   * Updates _sha so subsequent writes don't conflict.
   * Returns array of paper objects.
   */
  async function fetchShared() {
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;

    const res = await fetch(API, { headers });
    if (res.status === 404) { _sha = ''; return []; }
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);

    const meta   = await res.json();
    _sha         = meta.sha;
    const parsed = JSON.parse(_decode(meta.content));
    return Array.isArray(parsed.papers) ? parsed.papers : [];
  }

  // ── Write helpers ─────────────────────────────────────────────────────────────

  async function _push(papers) {
    const body    = JSON.stringify({ papers, updated_at: new Date().toISOString() }, null, 2);
    const payload = { message: 'Update shared saved papers', content: _encode(body) };
    if (_sha) payload.sha = _sha;

    const res = await fetch(API, {
      method: 'PUT',
      headers: {
        'Accept':        'application/vnd.github.v3+json',
        'Authorization': `Bearer ${_token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API ${res.status}`);
    }
    const data = await res.json();
    _sha = data.content.sha;
  }

  // ── Public write operations ───────────────────────────────────────────────────

  /**
   * Add a paper to the shared list.
   * Fetches the latest version first so concurrent saves don't clobber each other.
   */
  async function addPaper(paper) {
    if (!_token) throw new Error('No GitHub token — add one in Settings to share papers.');
    const current = await fetchShared();
    if (current.some(p => p.arxiv_id === paper.arxiv_id)) return; // already there
    await _push([...current, { ...paper, sharedAt: Date.now() }]);
  }

  /**
   * Remove a paper from the shared list by arxiv_id.
   */
  async function removePaper(arxivId) {
    if (!_token) throw new Error('No GitHub token — add one in Settings to share papers.');
    const current = await fetchShared();
    const updated = current.filter(p => p.arxiv_id !== arxivId);
    if (updated.length === current.length) return; // wasn't in the shared list
    await _push(updated);
  }

  return { fetchShared, addPaper, removePaper, setToken, getToken, loadTokenFromStorage };
})();

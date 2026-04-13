/**
 * storage.js — IndexedDB operations for persisting saved papers
 */

const Storage = (() => {

  const DB_NAME    = 'arxiv-paper-visualizer';
  const DB_VERSION = 1;
  const STORE      = 'savedPapers';

  // ── Open database ─────────────────────────────────────────────────────────────

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db    = e.target.result;
        const store = db.createObjectStore(STORE, { keyPath: 'arxiv_id' });
        store.createIndex('savedAt',  'savedAt',  { unique: false });
        store.createIndex('category', 'category', { unique: false });
      };

      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  function save(db, paper) {
    return _tx(db, 'readwrite', store => {
      const record = { ...paper, savedAt: Date.now() };
      store.put(record);
    });
  }

  function remove(db, arxivId) {
    return _tx(db, 'readwrite', store => {
      store.delete(arxivId);
    });
  }

  function getAll(db) {
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readonly');
      const req   = tx.objectStore(STORE).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  function clearAll(db) {
    return _tx(db, 'readwrite', store => store.clear());
  }

  // ── Import / Export ───────────────────────────────────────────────────────────

  function exportJSON() {
    const papers = [...APP.savedPapers.values()];
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), papers }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `arxiv-saved-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importJSON(db, file) {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON file');
    }

    const papers = parsed.papers || parsed; // support both wrapped and bare arrays
    if (!Array.isArray(papers)) throw new Error('Expected array of papers');

    let count = 0;
    for (const p of papers) {
      if (!p.arxiv_id) continue;
      await save(db, p);
      APP.savedPapers.set(p.arxiv_id, { ...p, savedAt: p.savedAt || Date.now() });
      count++;
    }
    return count;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function _tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, mode);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
      fn(tx.objectStore(STORE));
    });
  }

  return { open, save, remove, getAll, clearAll, exportJSON, importJSON };
})();

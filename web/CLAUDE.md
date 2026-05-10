# web/

Static frontend. No build, no bundler, no ES modules. Plain `<script>` tags + IIFEs + global `APP` state. D3 v7 from CDN.

## Load order (`index.html` ~lines 415–425)

Order matters — later files reference earlier ones:
1. `storage.js` — IndexedDB
2. `shared.js` — GitHub API for collaborative saves
3. `data.js` — manifest + paper loading
4. `canvas.js` — rendering
5. `lasso.js` — freehand selection
6. `search.js` — filter/search
7. `ui.js` — DOM panels
8. `interactions.js` — zoom/click
9. `settings.js` — prefs modal
10. `reader.js` — fullscreen reader
11. `main.js` — init, owns `APP`

## Global state: `APP` (defined in `main.js`)

```
allPapers       // current month's papers
filteredPapers  // post-filter/search
selectedPapers  // Set<arxiv_id>, lasso selection
savedPapers     // Map<arxiv_id, paper>, mirrors IndexedDB
currentView     // 'daily' | 'saved' | 'search'
clusters        // [{id, label, centroid}]
manifest        // month tabs
db              // IndexedDB handle
transform       // D3 zoom transform
hoveredPaper, activePaper, compareGroupA  // UI state
mode            // 'pan' | 'lasso'
```

Modules expose public methods via IIFE return; everything else is `_prefixed` private.

## File responsibilities

| File | Role |
|------|------|
| [js/main.js](js/main.js) | Init sequence: openDB → loadSaved → loadPapers → canvas → interactions → lasso → ui → settings → render |
| [js/canvas.js](js/canvas.js) | Canvas2D rendering, `paperToScreen()` zoom transform, `hitTest()`/`hitTestCluster()`, rAF loop, ResizeObserver |
| [js/data.js](js/data.js) | `loadMonth(key)`, manifest discovery, **CDN fallback**: `./data/` → GitHub raw → single file |
| [js/storage.js](js/storage.js) | IndexedDB v1, store `savedPapers` (keyPath `arxiv_id`), indices on `savedAt` + `category`, JSON import/export |
| [js/shared.js](js/shared.js) | Collaborative `shared_saved.json` via GitHub Contents API; reads public, writes need PAT (localStorage); refetches SHA per write to avoid clobber |
| [js/interactions.js](js/interactions.js) | D3 zoom (scale [0.3, 20]), hover throttled by rAF, double-click reset, disabled in lasso mode |
| [js/lasso.js](js/lasso.js) | SVG dashed path overlay, ray-casting point-in-polygon, modes: replace/add/subtract |
| [js/search.js](js/search.js) | AND-logic full-text (title+abstract+authors lowercased), category multi-select, date range, author substring |
| [js/ui.js](js/ui.js) | All DOM panels: detail (right), saved sidebar, selection panel (left), cluster modal, metadata sections, annotations (localStorage) |
| [js/reader.js](js/reader.js) | Fullscreen card stack, ←/→ keys, swipe, `R` toggle, CSS reflow hack via offsetWidth |
| [js/settings.js](js/settings.js) | Visual prefs (pointSize, pointOpacity, showLabels, warmBg, darkMode), OpenAI key (session only), GitHub token (localStorage), regenerate-labels feature |

## Coordinate system

- Embedding space: `embedding_2d: [x, y]` from UMAP (roughly [-15, 15]).
- Screen space: `paperToScreen(paper)` applies D3 linear scales + zoom transform.
- D3 scales are linear, not log — outliers compress small clusters toward edges.

## Category color palette (`canvas.js`)

cs.AI=blue, cs.CV=red, cs.LG=green, cs.CL=amber, stat.ML=violet, math.ST=cyan. Hardcoded.

## Persistence layers

| Layer | Stores |
|-------|--------|
| IndexedDB | saved papers (full objects) |
| localStorage | dark mode, GitHub PAT, per-paper annotations |
| Session memory | OpenAI key (never persisted) |
| GitHub repo | `shared_saved.json` for shared collections |

## Gotchas

- **No async/await** — Promises only, for broad browser support. Don't introduce.
- **Hover throttling** is rAF-based, not debounced. Slow devices skip frames.
- **Lasso polygon** — ray-casting is sensitive to self-intersecting paths.
- **Canvas resize** — ResizeObserver fires on detail-panel slide-out, not just window resize. Don't trigger expensive recompute on every resize.
- **`shared.js` base64** — `_decode/_encode` handles Unicode; don't replace with raw `btoa/atob`.
- **Search** — no phrase quoting, no boolean operators. All terms AND.
- **Cluster IDs not stable across snapshots** (see backend HDBSCAN gotcha). Don't persist `cluster_id` references long-term.
- **Settings prefs (other than dark mode)**: NOT persisted. Reset every session.

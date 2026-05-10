# arxiv-paper-visualizer

2D semantic map of recent arXiv papers. Python pipeline → static JSON → vanilla JS canvas frontend.

## Architecture

```
backend/ (Python pipeline)  →  web/data/*.json  →  web/ (static frontend)
                            ↑
                .github/workflows/daily_update.yml (cron 8 UTC)
```

- **No build step.** Frontend is plain HTML + script tags + D3 v7 CDN.
- **Pipeline order**: fetch_arxiv → embed_papers → reduce_dims → label_clusters. Orchestrated by `backend/main.py`.
- **Output**: `web/data/papers.json` (current) + `papers_YYYY-MM.json` (monthly snapshots) + `manifest.json` (month index) + `shared_saved.json` (collaborative saves).
- **Daily CI**: GitHub Actions runs `main.py --days 1`, commits regenerated JSON. CPU-only PyTorch in CI to keep image small.
- **Deployment**: GitHub Pages, served from `main` branch root. Live URL: https://shivam-raval96.github.io/arxiv-paper-visualizer/web/

## Required env

- `OPENAI_API_KEY` — needed by `embed_papers.py` (primary path) and `label_clusters.py` (no fallback). Pipeline silently degrades to local sentence-transformers for embeddings if absent; cluster labeling step fails.

## Subdirectory docs

- [backend/CLAUDE.md](backend/CLAUDE.md) — Python pipeline internals.
- [web/CLAUDE.md](web/CLAUDE.md) — Frontend architecture, global APP state, module load order.

## Conventions

- **Determinism**: UMAP `random_state=42`. Don't change without coordinating snapshot regen.
- **No migrations**: IndexedDB schema is v1, no version bumps planned. Add fields freely; removing fields breaks existing user state.
- **Snapshots are append-only**: monthly files in `web/data/papers_YYYY-MM.json` are historical. Backups in `data/backups/` before overwrite.
- **Manifest shape**: `{yesterday: {...}, months: [{key, label, file}]}`. `loadMonth(key)` consumes this.

## Gotchas

- `embed_papers.py` writes `embedding` (high-dim) into intermediate JSON; `reduce_dims.py` strips it before frontend output. Don't ship high-dim embeddings to client (bloat).
- `shared.js` GitHub Contents API writes refetch SHA every save → slow but conflict-safe.
- Frontend data loader tries local `./data/` first, GitHub raw CDN as fallback. Adds latency on first-load failure.
- `label_clusters.py` falls back HDBSCAN→k-means silently if <5 clusters found. Check logs, not output shape.

# backend/

Python pipeline: arXiv API → embeddings → 2D coords → cluster labels → `web/data/papers.json`.

## Files

### `main.py` — orchestrator
Chains all 4 steps. CLI:
- `--days N` (default 1) — relative window
- `--month YYYY-MM` — full-month rebuild (writes monthly snapshot, updates `manifest.months[]`)
- `--categories cs.AI,cs.CV,...`
- `--output PATH`

Helpers:
- `_save_dated_snapshot()` — writes `papers_YYYY-MM-DD.json`, updates `manifest.yesterday`.
- `_save_monthly_snapshot()` — updates `manifest.months[]` on full rebuild.
- `_backup_existing()` — copies prior file to `data/backups/` before overwrite.

### `fetch_arxiv.py` — arXiv API
Two modes: relative (`--days`) or explicit (`--date-start/--date-end YYYY-MM-DD`).
- `_fetch_all_pages()` — paginates 200/req, **3s delay between pages** (arXiv ToS).
- `_fetch_by_category()` — fallback for large date ranges; arXiv caps single-query results ~3000.
- `parse_feed()` — Atom XML → arxiv_id, title, authors, abstract, category, published.
- Output: `raw_papers.json` (no embeddings).

### `embed_papers.py` — text → vector
- **Primary**: OpenAI `text-embedding-3-small` (1536-dim) when `OPENAI_API_KEY` set. Batches 100/req, L2-normalizes.
- **Fallback**: local `sentence-transformers/all-MiniLM-L6-v2` (384-dim).
- `build_texts()` — concat title + abstract, truncate 8000 chars.
- Output: `embedded_papers.json` (adds `embedding` array).

### `reduce_dims.py` — UMAP to 2D
- Params: `n_neighbors=15, min_dist=0.1, metric=cosine, random_state=42`. Tuned for arXiv-scale clusters.
- `--save-model` — pickle UMAP for incremental updates (not currently used in CI).
- Strips high-dim `embedding`, adds `embedding_2d: [x, y]`. Snapshot date = max published date.

### `label_clusters.py` — clustering + LLM metadata
Heaviest step. Pipeline:
1. **Cluster**: HDBSCAN, `min_cluster_size = max(10, n//150)`. Falls back to k-means k=8 if <5 clusters. Noise points → nearest centroid.
2. **Cluster labels**: GPT-4o-mini, sample 20 titles per cluster → 2-4 word label.
3. **TL;DR**: regex heuristic (`_extract_tldr`) per paper, max 200 chars. Naive — misses contribs lacking keywords.
4. **Metadata batch**: GPT-4o-mini, **5 papers/request, 8 parallel workers**. Extracts: `dataset, models, methods, baselines, evaluations, insights, comments`. Failures → empty dict, no retry.

Adds to each paper: `cluster_id`, `tldr`, 7 metadata fields. Adds top-level `clusters: [{id, label, centroid}]`.

## requirements.txt
`requests, sentence-transformers, umap-learn, numpy, scikit-learn, openai>=1.30.0`. PyTorch installed separately in CI (CPU-only).

## Gotchas

- **Rate limits**: arXiv 3s/page, OpenAI batched but no exponential backoff — surge can fail silently.
- **HDBSCAN nondeterminism**: cluster IDs not stable across runs even with same data. Don't assume cluster_id continuity between snapshots.
- **`OPENAI_API_KEY` required for label step**. No fallback. Pipeline runs fine through reduce_dims without it.
- **Backups**: only most recent overwrite saved in `data/backups/`. Not a full history.
- **Snapshot date**: derived from `max(published)` not run date. Late-arriving papers can shift date back.

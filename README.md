# arXiv Paper Visualizer

Interactive 2D visualization of arXiv papers using canvas rendering, semantic search, and lasso selection.

## Live Demo

**[shivam-raval96.github.io/arxiv-paper-visualizer](https://shivam-raval96.github.io/arxiv-paper-visualizer/web/)**

## Features

- **2D embedding map** — Papers plotted by semantic similarity (UMAP on sentence-transformer embeddings)
- **Lasso selection** — Draw freehand to select clusters of papers
- **Semantic search** — Full-text search across titles, abstracts, and authors
- **Category filtering** — Multi-select filter by arXiv category
- **Saved papers** — Persistent reading list via IndexedDB (survives page refresh)
- **Detail panel** — Click any paper to see abstract, authors, and arXiv link
- **Export/import** — Save and load your reading list as JSON
- **Daily updates** — GitHub Actions runs the data pipeline every morning at 8 AM UTC

## Project Structure

```
arxiv-paper-visualizer/
├── web/                    # Frontend (static files)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── main.js         # App state & initialization
│   │   ├── canvas.js       # Canvas rendering (D3 + Canvas 2D)
│   │   ├── interactions.js # Zoom, pan, hover, click
│   │   ├── lasso.js        # Freehand selection tool
│   │   ├── search.js       # Text search & filtering
│   │   ├── storage.js      # IndexedDB persistence
│   │   ├── data.js         # Data loading
│   │   └── ui.js           # DOM updates
│   └── data/papers.json    # Latest paper data (updated daily)
├── backend/                # Python data pipeline
│   ├── main.py             # Orchestrator
│   ├── fetch_arxiv.py      # arXiv API fetcher
│   ├── embed_papers.py     # sentence-transformers embedder
│   ├── reduce_dims.py      # UMAP dimensionality reduction
│   └── requirements.txt
└── .github/workflows/
    └── daily_update.yml    # Scheduled pipeline
```

## Quick Start (Frontend)

Open `web/index.html` directly in a browser (no build step required). For local development with the CDN data URL, use a simple HTTP server to avoid CORS issues:

```bash
cd web
python3 -m http.server 8080
# Visit http://localhost:8080
```

## Running the Backend Pipeline

```bash
cd backend
pip install -r requirements.txt
python main.py --days 1 --categories cs.AI,cs.CV,cs.LG
```

This will fetch today's papers, embed them, reduce to 2D, and write `web/data/papers.json`.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `L` | Toggle lasso mode |
| `Esc` | Cancel lasso / deselect / close panel |
| Double-click | Reset zoom |

## Data Format

`web/data/papers.json`:
```json
{
  "date": "2025-04-13",
  "generated_at": "2025-04-13T08:45:00Z",
  "papers": [
    {
      "arxiv_id": "2504.07854",
      "title": "...",
      "authors": ["..."],
      "abstract": "...",
      "category": "cs.AI",
      "published": "2025-04-13",
      "embedding_2d": [0.35, -0.42],
      "relevance_score": 0.87
    }
  ]
}
```

## Deployment

Enable GitHub Pages in repository Settings → Pages → Source: `main` branch, root `/`.

The frontend will be accessible at `https://shivam-raval96.github.io/arxiv-paper-visualizer/web/`.

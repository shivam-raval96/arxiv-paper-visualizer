"""
reduce_dims.py — Reduce paper embeddings from high-D to 2D using UMAP.

Outputs the final papers.json ready for the frontend.
"""

import argparse
import json
import logging
import pickle
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [reduce_dims] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

# UMAP parameters tuned for arXiv paper clusters
UMAP_PARAMS = {
    "n_components": 2,
    "metric": "cosine",
    "n_neighbors": 15,
    "min_dist": 0.1,
    "random_state": 42,
}


def load_embedded(input_path: Path) -> list[dict]:
    data = json.loads(input_path.read_text())
    papers = data.get("papers", data) if isinstance(data, dict) else data
    # Filter out papers without valid embeddings
    valid = [p for p in papers if isinstance(p.get("embedding"), list) and len(p["embedding"]) > 0]
    log.info("Loaded %d papers with embeddings from %s", len(valid), input_path)
    return valid


def reduce(papers: list[dict]) -> np.ndarray:
    """Run UMAP on the embedding matrix. Returns (N, 2) array."""
    try:
        import umap
    except ImportError:
        log.error("umap-learn not installed. Run: pip install umap-learn")
        sys.exit(1)

    matrix = np.array([p["embedding"] for p in papers], dtype=np.float32)
    log.info("Embedding matrix shape: %s", matrix.shape)

    reducer = umap.UMAP(**UMAP_PARAMS)
    log.info("Fitting UMAP (this may take a few minutes for large datasets)...")
    coords_2d = reducer.fit_transform(matrix)
    log.info("UMAP done. Output shape: %s", coords_2d.shape)
    return coords_2d, reducer


def save_output(
    papers: list[dict],
    coords_2d: np.ndarray,
    output_path: Path,
    reducer=None,
    model_path: Path | None = None,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    results = []
    for paper, (x, y) in zip(papers, coords_2d):
        # Strip high-D embedding to keep output small
        stripped = {k: v for k, v in paper.items() if k != "embedding"}
        stripped["embedding_2d"] = [round(float(x), 4), round(float(y), 4)]
        # Relevance score: use existing if present, else placeholder
        if "relevance_score" not in stripped:
            stripped["relevance_score"] = 1.0
        results.append(stripped)

    # Use the most recent paper publication date as the snapshot date so that
    # the dated snapshot filename reflects when the papers were published, not
    # when the pipeline happened to run.
    pub_dates = [p.get("published", "") for p in results if p.get("published")]
    snap_date = max(pub_dates)[:10] if pub_dates else datetime.now(timezone.utc).strftime("%Y-%m-%d")

    payload = {
        "date": snap_date,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "papers": results,
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    log.info("Saved %d papers with 2D coords to %s", len(results), output_path)

    # Optionally save the fitted UMAP model for incremental updates
    if model_path:
        model_path.parent.mkdir(parents=True, exist_ok=True)
        with open(model_path, "wb") as f:
            pickle.dump(reducer, f)
        log.info("Saved UMAP model to %s", model_path)


def main(args=None):
    parser = argparse.ArgumentParser(description="Reduce arXiv paper embeddings to 2D with UMAP")
    parser.add_argument("--input",       default="data/embedded_papers.json",   help="Input JSON")
    parser.add_argument("--output",      default="../web/data/papers.json",      help="Output JSON for frontend")
    parser.add_argument("--save-model",  default=None,                           help="Path to save fitted UMAP model (optional)")
    opts = parser.parse_args(args)

    papers = load_embedded(Path(opts.input))
    if not papers:
        log.error("No embedded papers found")
        sys.exit(1)

    if len(papers) < 2:
        log.error("Need at least 2 papers for UMAP")
        sys.exit(1)

    coords_2d, reducer = reduce(papers)
    _reducer_global = reducer

    save_output(
        papers,
        coords_2d,
        Path(opts.output),
        reducer=reducer,
        model_path=Path(opts.save_model) if opts.save_model else None,
    )


if __name__ == "__main__":
    main()

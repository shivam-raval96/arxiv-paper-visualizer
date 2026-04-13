"""
embed_papers.py — Generate sentence embeddings for arXiv papers.

Uses sentence-transformers to embed title + abstract concatenations.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [embed_papers] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

# allenai/specter2_base is designed for scientific papers; all-MiniLM-L6-v2 is faster.
DEFAULT_MODEL = "allenai/specter2_base"
FALLBACK_MODEL = "all-MiniLM-L6-v2"
BATCH_SIZE = 32


def load_papers(input_path: Path) -> list[dict]:
    data = json.loads(input_path.read_text())
    papers = data.get("papers", data) if isinstance(data, dict) else data
    log.info("Loaded %d papers from %s", len(papers), input_path)
    return papers


def build_texts(papers: list[dict]) -> list[str]:
    """Combine title + abstract for embedding (SPECTER-style)."""
    texts = []
    for p in papers:
        title    = (p.get("title") or "").strip()
        abstract = (p.get("abstract") or "").strip()
        texts.append(f"{title} [SEP] {abstract}" if abstract else title)
    return texts


def embed(texts: list[str], model_name: str) -> np.ndarray:
    log.info("Loading model: %s", model_name)
    try:
        model = SentenceTransformer(model_name)
    except Exception as e:
        log.warning("Could not load %s (%s), falling back to %s", model_name, e, FALLBACK_MODEL)
        model = SentenceTransformer(FALLBACK_MODEL)

    log.info("Embedding %d texts (batch_size=%d)...", len(texts), BATCH_SIZE)
    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    log.info("Embeddings shape: %s", embeddings.shape)
    return embeddings


def save_output(papers: list[dict], embeddings: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    results = []
    for paper, emb in zip(papers, embeddings):
        results.append({**paper, "embedding": emb.tolist()})

    output_path.write_text(json.dumps({"papers": results}, indent=2, ensure_ascii=False))
    log.info("Saved %d embedded papers to %s", len(results), output_path)


def main(args=None):
    parser = argparse.ArgumentParser(description="Embed arXiv papers with sentence-transformers")
    parser.add_argument("--input",  default="data/raw_papers.json",      help="Input JSON path")
    parser.add_argument("--output", default="data/embedded_papers.json", help="Output JSON path")
    parser.add_argument("--model",  default=DEFAULT_MODEL,               help="SentenceTransformer model name")
    opts = parser.parse_args(args)

    papers = load_papers(Path(opts.input))
    if not papers:
        log.error("No papers to embed")
        sys.exit(1)

    texts      = build_texts(papers)
    embeddings = embed(texts, opts.model)

    if len(embeddings) != len(papers):
        log.error("Embedding count mismatch: %d embeddings for %d papers", len(embeddings), len(papers))
        sys.exit(1)

    save_output(papers, embeddings, Path(opts.output))


if __name__ == "__main__":
    main()

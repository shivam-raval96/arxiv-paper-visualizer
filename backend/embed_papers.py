"""
embed_papers.py — Generate embeddings for arXiv papers.

Primary:  OpenAI text-embedding-3-small (requires OPENAI_API_KEY)
Fallback: sentence-transformers all-MiniLM-L6-v2 (local, no API key needed)
"""

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [embed_papers] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

OPENAI_MODEL    = "text-embedding-3-small"  # 1536-dim, fast, cost-effective
OPENAI_DIMS     = 1536
FALLBACK_MODEL  = "all-MiniLM-L6-v2"        # local fallback, 384-dim
OPENAI_BATCH    = 100                        # max texts per API request
OPENAI_RPM_WAIT = 1.0                        # seconds between batches (rate-limit headroom)


# ── Data helpers ──────────────────────────────────────────────────────────────

def load_papers(input_path: Path) -> list[dict]:
    data = json.loads(input_path.read_text())
    papers = data.get("papers", data) if isinstance(data, dict) else data
    log.info("Loaded %d papers from %s", len(papers), input_path)
    return papers


def build_texts(papers: list[dict]) -> list[str]:
    """title + abstract concatenation — matches SPECTER / OpenAI best practices."""
    texts = []
    for p in papers:
        title    = (p.get("title")    or "").strip()
        abstract = (p.get("abstract") or "").strip()
        # Truncate to ~8000 chars to stay inside OpenAI token limits
        combined = f"{title}\n\n{abstract}" if abstract else title
        texts.append(combined[:8000])
    return texts


# ── OpenAI embeddings ─────────────────────────────────────────────────────────

def embed_openai(texts: list[str], api_key: str) -> np.ndarray:
    from openai import OpenAI
    client = OpenAI(api_key=api_key)

    log.info("Embedding %d texts with OpenAI %s (batch=%d)...",
             len(texts), OPENAI_MODEL, OPENAI_BATCH)

    all_embeddings = []
    for i in range(0, len(texts), OPENAI_BATCH):
        batch = texts[i : i + OPENAI_BATCH]
        log.info("  batch %d/%d (%d texts)...",
                 i // OPENAI_BATCH + 1,
                 (len(texts) - 1) // OPENAI_BATCH + 1,
                 len(batch))
        resp = client.embeddings.create(model=OPENAI_MODEL, input=batch)
        # Results are returned in order
        batch_embs = [d.embedding for d in sorted(resp.data, key=lambda x: x.index)]
        all_embeddings.extend(batch_embs)
        if i + OPENAI_BATCH < len(texts):
            time.sleep(OPENAI_RPM_WAIT)

    matrix = np.array(all_embeddings, dtype=np.float32)
    # L2-normalize so cosine similarity == dot product (helps UMAP)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    matrix /= np.where(norms == 0, 1, norms)
    log.info("OpenAI embeddings shape: %s", matrix.shape)
    return matrix


# ── Local fallback ────────────────────────────────────────────────────────────

def embed_local(texts: list[str]) -> np.ndarray:
    from sentence_transformers import SentenceTransformer
    log.info("Loading local model: %s", FALLBACK_MODEL)
    model = SentenceTransformer(FALLBACK_MODEL)
    embeddings = model.encode(
        texts, batch_size=32, show_progress_bar=True,
        convert_to_numpy=True, normalize_embeddings=True,
    )
    log.info("Local embeddings shape: %s", embeddings.shape)
    return embeddings


# ── Output ────────────────────────────────────────────────────────────────────

def save_output(papers: list[dict], embeddings: np.ndarray, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    results = [{**p, "embedding": emb.tolist()} for p, emb in zip(papers, embeddings)]
    output_path.write_text(json.dumps({"papers": results}, indent=2, ensure_ascii=False))
    log.info("Saved %d embedded papers to %s", len(results), output_path)


# ── Entry point ───────────────────────────────────────────────────────────────

def main(args=None):
    parser = argparse.ArgumentParser(description="Embed arXiv papers")
    parser.add_argument("--input",  default="data/raw_papers.json",      help="Input JSON")
    parser.add_argument("--output", default="data/embedded_papers.json", help="Output JSON")
    parser.add_argument("--model",  default=None,
                        help="Override model (OpenAI model name or sentence-transformers name)")
    opts = parser.parse_args(args)

    papers = load_papers(Path(opts.input))
    if not papers:
        log.error("No papers to embed")
        sys.exit(1)

    texts = build_texts(papers)
    api_key = os.environ.get("OPENAI_API_KEY")

    if api_key:
        model = opts.model or OPENAI_MODEL
        log.info("Using OpenAI embeddings (%s)", model)
        embeddings = embed_openai(texts, api_key)
    else:
        log.warning("OPENAI_API_KEY not set — falling back to local sentence-transformers")
        embeddings = embed_local(texts)

    if len(embeddings) != len(papers):
        log.error("Embedding count mismatch: %d vs %d", len(embeddings), len(papers))
        sys.exit(1)

    save_output(papers, embeddings, Path(opts.output))


if __name__ == "__main__":
    main()

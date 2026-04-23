"""
label_clusters.py — Cluster papers and generate LLM labels + structured metadata.

Steps:
  1. HDBSCAN clustering on 2D embeddings (k-means fallback)
  2. GPT-4o-mini cluster label generation
  3. Heuristic TL;DR extraction per paper
  4. Batched GPT-4o-mini structured metadata extraction per paper:
       dataset, models, methods, baselines, evaluations, insights, comments
"""

import argparse
import json
import logging
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from sklearn.cluster import HDBSCAN, KMeans
from openai import OpenAI

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [label_clusters] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

DEFAULT_N_CLUSTERS = 8
TITLES_PER_CLUSTER = 20
METADATA_BATCH_SIZE = 5    # papers per GPT metadata request
METADATA_WORKERS    = 8    # parallel API threads

# Patterns for heuristic TL;DR extraction
_CONTRIBUTION_RE = re.compile(
    r'\b(we propose|we present|we introduce|we develop|we show that|we demonstrate|'
    r'we achieve|we describe|we design|we build|we train|we evaluate|we release|'
    r'our approach|our method|our model|our framework|our system|our algorithm|'
    r'this paper proposes|this paper presents|this paper introduces|'
    r'this work proposes|this work presents|in this paper,|in this work,)\b',
    re.IGNORECASE,
)
_MAX_TLDR = 200


# ── TL;DR heuristic ──────────────────────────────────────────────────────────

def _extract_tldr(abstract: str) -> str:
    """Extract the key contribution/insight sentence from abstract."""
    if not abstract:
        return ''
    sents = [s.strip() for s in re.split(r'(?<=[.!?])\s+', abstract.strip()) if len(s.strip()) > 15]
    if not sents:
        return abstract[:_MAX_TLDR]
    for s in sents:
        if _CONTRIBUTION_RE.search(s):
            return (s[:_MAX_TLDR] + '…') if len(s) > _MAX_TLDR else s
    last = sents[-1]
    return (last[:_MAX_TLDR] + '…') if len(last) > _MAX_TLDR else last


# ── Structured metadata extraction ───────────────────────────────────────────

_META_FIELDS = ('dataset', 'models', 'methods', 'baselines', 'evaluations', 'insights', 'comments')

_META_SYSTEM = (
    "You are a structured metadata extractor for arXiv ML/AI/stats papers. "
    "Given paper abstracts, extract the requested fields accurately and concisely."
)

def _build_meta_prompt(batch: list[dict]) -> str:
    papers_block = "\n\n".join(
        f'[{i+1}] TITLE: {p.get("title", "")}\nABSTRACT: {(p.get("abstract") or "")[:600]}'
        for i, p in enumerate(batch)
    )
    return (
        "Extract structured metadata from the following arXiv paper abstracts.\n"
        "For each paper return a JSON object with these fields:\n"
        '  "dataset"     : datasets used or benchmarked (comma-separated string, or null)\n'
        '  "models"      : model architectures or pretrained models (comma-separated, or null)\n'
        '  "methods"     : key technical methods/algorithms (comma-separated)\n'
        '  "baselines"   : baseline methods compared against (comma-separated, or null)\n'
        '  "evaluations" : evaluation metrics or benchmarks (comma-separated, or null)\n'
        '  "insights"    : single most novel/surprising finding — 1 specific sentence\n'
        '  "comments"    : notable limitation, scope, or caveat (brief, or null)\n\n'
        "Return ONLY a JSON object: {\"papers\": [<obj1>, <obj2>, ...]} "
        f"with exactly {len(batch)} objects in order. "
        "Use null for fields absent from the abstract. "
        "Keep values concise (≤ 15 words per field, except insights ≤ 25 words).\n\n"
        f"{papers_block}"
    )


def _extract_meta_batch(batch: list[dict], client: OpenAI) -> list[dict]:
    """Call GPT for one batch; returns list of metadata dicts (empty dict on failure)."""
    prompt = _build_meta_prompt(batch)
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _META_SYSTEM},
                {"role": "user",   "content": prompt},
            ],
            max_tokens=600,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content.strip()
        parsed  = json.loads(content)
        results = parsed.get("papers", [])
        if not isinstance(results, list):
            results = []
        # Pad if GPT returned fewer items than expected
        while len(results) < len(batch):
            results.append({})
        return results[:len(batch)]
    except Exception as e:
        log.warning("Metadata batch failed (%d papers): %s", len(batch), e)
        return [{} for _ in batch]


def extract_paper_metadata(papers: list[dict], client: OpenAI) -> None:
    """Add structured metadata fields to each paper in-place.

    Papers that already have a non-None 'methods' field are skipped so that
    re-runs don't re-charge API calls unnecessarily.
    """
    to_process = [p for p in papers if p.get("methods") is None]
    if not to_process:
        log.info("All papers already have metadata — skipping extraction")
        return

    batches = [
        to_process[i: i + METADATA_BATCH_SIZE]
        for i in range(0, len(to_process), METADATA_BATCH_SIZE)
    ]
    log.info(
        "Extracting metadata for %d papers (%d batches, %d workers)…",
        len(to_process), len(batches), METADATA_WORKERS,
    )

    completed = 0

    def process(batch):
        results = _extract_meta_batch(batch, client)
        for paper, meta in zip(batch, results):
            if isinstance(meta, dict):
                for field in _META_FIELDS:
                    val = meta.get(field)
                    paper[field] = val if val else None
            else:
                for field in _META_FIELDS:
                    paper[field] = None

    with ThreadPoolExecutor(max_workers=METADATA_WORKERS) as pool:
        futures = {pool.submit(process, b): b for b in batches}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                log.warning("Batch error: %s", e)
            completed += 1
            if completed % 50 == 0 or completed == len(batches):
                log.info("  Metadata: %d/%d batches done", completed, len(batches))

    log.info("Metadata extraction complete")


# ── Clustering ────────────────────────────────────────────────────────────────

def load_papers(path: Path) -> dict:
    return json.loads(path.read_text())


def cluster(papers: list[dict], n_clusters: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """HDBSCAN clustering with k-means fallback. Returns (labels, centroids)."""
    coords = np.array([p["embedding_2d"] for p in papers], dtype=np.float32)
    n = len(coords)

    min_size = max(10, n // 150)
    log.info("HDBSCAN min_cluster_size=%d for %d papers", min_size, n)

    hdb = HDBSCAN(min_cluster_size=min_size, min_samples=5, cluster_selection_epsilon=0.0)
    raw = hdb.fit_predict(coords)

    valid_ids = sorted(set(raw) - {-1})
    n_found   = len(valid_ids)
    n_noise   = int((raw == -1).sum())
    log.info("HDBSCAN found %d clusters, %d noise points", n_found, n_noise)

    if n_found < 5:
        k = n_clusters or max(DEFAULT_N_CLUSTERS, min(40, n // 50))
        log.info("Falling back to k-means with k=%d", k)
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(coords).astype(np.int32)
        return labels, km.cluster_centers_

    centroids = np.array([coords[raw == cid].mean(axis=0) for cid in valid_ids])
    id_map    = {old: new for new, old in enumerate(valid_ids)}
    labels    = np.array([id_map.get(l, -1) for l in raw], dtype=np.int32)

    noise_mask = labels == -1
    if noise_mask.any():
        noise_coords = coords[noise_mask]
        dists = np.linalg.norm(noise_coords[:, np.newaxis] - centroids[np.newaxis, :], axis=2)
        labels[noise_mask] = dists.argmin(axis=1).astype(np.int32)
        log.info("Assigned %d noise points to nearest cluster", noise_mask.sum())

    log.info("Final: %d clusters for %d papers", n_found, n)
    return labels, centroids


# ── Cluster label generation ──────────────────────────────────────────────────

def generate_labels(cluster_titles: dict[int, list[str]], client: OpenAI) -> dict[int, str]:
    """GPT-4o-mini: 2-4 word topic label per cluster."""
    results = {}
    for cid, titles in sorted(cluster_titles.items()):
        sample = titles[:TITLES_PER_CLUSTER]
        prompt = (
            "You are a research topic labeler for arXiv papers. "
            "Given the following paper titles from a semantic cluster, "
            "reply with ONLY a concise 2-4 word topic label. No explanation, no quotes.\n\n"
            + "\n".join(f"- {t}" for t in sample)
        )
        log.info("Generating label for cluster %d (%d titles)…", cid, len(titles))
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=15,
            temperature=0.2,
        )
        label = resp.choices[0].message.content.strip().strip('"').strip("'")
        log.info("  Cluster %d → %r", cid, label)
        results[cid] = label
    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main(args=None):
    parser = argparse.ArgumentParser(description="Cluster papers and label with OpenAI")
    parser.add_argument("--input",      default="../web/data/papers.json")
    parser.add_argument("--output",     default=None)
    parser.add_argument("--n-clusters", type=int, default=DEFAULT_N_CLUSTERS)
    opts = parser.parse_args(args)

    input_path  = Path(opts.input)
    output_path = Path(opts.output) if opts.output else input_path

    data    = load_papers(input_path)
    papers  = data.get("papers", [])
    if not papers:
        log.error("No papers in %s", input_path)
        sys.exit(1)

    valid = [p for p in papers if isinstance(p.get("embedding_2d"), list)]
    if len(valid) < opts.n_clusters:
        log.error("Too few papers with embedding_2d (%d)", len(valid))
        sys.exit(1)

    # ── Cluster ───────────────────────────────────────────────────────────────
    n_clusters_arg = opts.n_clusters if opts.n_clusters != DEFAULT_N_CLUSTERS else None
    labels, centroids = cluster(valid, n_clusters_arg)
    n_found = len(centroids)

    cluster_titles: dict[int, list[str]] = {}
    for i, p in enumerate(valid):
        cluster_titles.setdefault(int(labels[i]), []).append(p["title"])

    # ── OpenAI ────────────────────────────────────────────────────────────────
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        log.error("OPENAI_API_KEY not set")
        sys.exit(1)
    client = OpenAI(api_key=api_key)

    # ── Step A: cluster labels ────────────────────────────────────────────────
    log.info("━━━ Generating cluster labels ━━━")
    label_map = generate_labels(cluster_titles, client)

    clusters = [
        {
            "id":          cid,
            "label":       label_map[cid],
            "centroid_2d": [round(float(centroids[cid][0]), 4),
                            round(float(centroids[cid][1]), 4)],
        }
        for cid in range(n_found)
    ]

    # ── Step B: per-paper TL;DR + cluster_id ─────────────────────────────────
    for i, p in enumerate(valid):
        p["cluster_id"] = int(labels[i])
        if not p.get("tldr"):
            p["tldr"] = _extract_tldr(p.get("abstract", ""))

    # ── Step C: structured metadata (batched GPT) ─────────────────────────────
    log.info("━━━ Extracting structured paper metadata ━━━")
    extract_paper_metadata(valid, client)

    # ── Write ─────────────────────────────────────────────────────────────────
    data["clusters"] = clusters
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    log.info("Wrote %d clusters + metadata to %s", n_found, output_path)


if __name__ == "__main__":
    main()

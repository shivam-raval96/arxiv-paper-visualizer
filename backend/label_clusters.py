"""
label_clusters.py — Cluster papers and generate LLM labels via OpenAI API.

Reads the 2D-reduced papers.json, runs k-means clustering on embedding_2d
coordinates, calls GPT-4o-mini to generate a concise topic label per cluster,
and writes the result back to papers.json.
"""

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import re

import numpy as np
from sklearn.cluster import HDBSCAN, KMeans
from openai import OpenAI

# Patterns that signal a contribution/finding sentence in an abstract
_CONTRIBUTION_RE = re.compile(
    r'\b(we propose|we present|we introduce|we develop|we show that|we demonstrate|'
    r'we achieve|we describe|we design|we build|we train|we evaluate|we release|'
    r'our approach|our method|our model|our framework|our system|our algorithm|'
    r'this paper proposes|this paper presents|this paper introduces|'
    r'this work proposes|this work presents|in this paper,|in this work,)\b',
    re.IGNORECASE,
)
_MAX_TLDR = 200   # chars


def _extract_tldr(abstract: str) -> str:
    """Heuristically extract the key insight/contribution sentence.

    Strategy:
    1. Find the first sentence that matches contribution keywords.
    2. Fall back to the last sentence (often states the key result).
    3. Truncate to _MAX_TLDR chars.
    """
    if not abstract:
        return ''
    sents = [s.strip() for s in re.split(r'(?<=[.!?])\s+', abstract.strip()) if len(s.strip()) > 15]
    if not sents:
        return abstract[:_MAX_TLDR]

    for s in sents:
        if _CONTRIBUTION_RE.search(s):
            return (s[:_MAX_TLDR] + '…') if len(s) > _MAX_TLDR else s

    # Fallback: last sentence
    last = sents[-1]
    return (last[:_MAX_TLDR] + '…') if len(last) > _MAX_TLDR else last

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [label_clusters] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

DEFAULT_N_CLUSTERS = 8
TITLES_PER_CLUSTER = 20   # titles sent to GPT per cluster


def load_papers(path: Path) -> dict:
    data = json.loads(path.read_text())
    return data


def cluster(papers: list[dict], n_clusters: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Cluster papers on embedding_2d coords.

    Uses HDBSCAN to auto-discover fine-grained clusters.  min_cluster_size
    scales with corpus size so larger datasets produce more clusters.
    Falls back to k-means if HDBSCAN yields fewer than 5 clusters.

    Returns (labels, centroids) where labels are 0-indexed int32.
    """
    coords = np.array([p["embedding_2d"] for p in papers], dtype=np.float32)
    n = len(coords)

    # Scale min_cluster_size so we get ~n/150 clusters for large corpora
    min_size = max(10, n // 150)
    log.info("HDBSCAN min_cluster_size=%d for %d papers", min_size, n)

    hdb = HDBSCAN(min_cluster_size=min_size, min_samples=5, cluster_selection_epsilon=0.0)
    raw = hdb.fit_predict(coords)

    valid_ids = sorted(set(raw) - {-1})
    n_found = len(valid_ids)
    n_noise = int((raw == -1).sum())
    log.info("HDBSCAN found %d clusters, %d noise points", n_found, n_noise)

    if n_found < 5:
        # Fallback: k-means with auto-scaled k
        k = n_clusters or max(DEFAULT_N_CLUSTERS, min(40, n // 50))
        log.info("Falling back to k-means with k=%d", k)
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(coords).astype(np.int32)
        log.info("K-means: %d clusters", k)
        return labels, km.cluster_centers_

    # Compute per-cluster centroids
    centroids = np.array([coords[raw == cid].mean(axis=0) for cid in valid_ids])

    # Remap cluster ids to 0-based contiguous integers
    id_map = {old: new for new, old in enumerate(valid_ids)}
    labels = np.array([id_map.get(l, -1) for l in raw], dtype=np.int32)

    # Assign noise points to nearest cluster centroid
    noise_mask = labels == -1
    if noise_mask.any():
        noise_coords = coords[noise_mask]
        dists = np.linalg.norm(noise_coords[:, np.newaxis] - centroids[np.newaxis, :], axis=2)
        labels[noise_mask] = dists.argmin(axis=1).astype(np.int32)
        log.info("Assigned %d noise points to nearest cluster", noise_mask.sum())

    log.info("Final: %d clusters for %d papers", n_found, n)
    return labels, centroids


def generate_labels(cluster_titles: dict[int, list[str]], client: OpenAI) -> dict[int, str]:
    """Call GPT-4o-mini once per cluster to get a 2-4 word topic label."""
    results = {}
    for cid, titles in sorted(cluster_titles.items()):
        sample = titles[:TITLES_PER_CLUSTER]
        prompt = (
            "You are a research topic labeler for arXiv papers. "
            "Given the following paper titles from a semantic cluster, "
            "reply with ONLY a concise 2-4 word topic label. No explanation, no quotes.\n\n"
            + "\n".join(f"- {t}" for t in sample)
        )
        log.info("Generating label for cluster %d (%d titles)...", cid, len(titles))
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


def main(args=None):
    parser = argparse.ArgumentParser(description="Cluster papers and label with OpenAI")
    parser.add_argument("--input",      default="../web/data/papers.json", help="papers.json path")
    parser.add_argument("--output",     default=None,                      help="Output path (default: overwrite input)")
    parser.add_argument("--n-clusters", type=int, default=DEFAULT_N_CLUSTERS, help="Number of clusters")
    opts = parser.parse_args(args)

    input_path  = Path(opts.input)
    output_path = Path(opts.output) if opts.output else input_path

    # Load
    data = load_papers(input_path)
    papers = data.get("papers", [])
    if not papers:
        log.error("No papers found in %s", input_path)
        sys.exit(1)

    # Validate all papers have embedding_2d
    valid = [p for p in papers if isinstance(p.get("embedding_2d"), list)]
    if len(valid) < opts.n_clusters:
        log.error("Only %d papers have embedding_2d; need at least %d", len(valid), opts.n_clusters)
        sys.exit(1)

    # Cluster (n_clusters=None means HDBSCAN auto-detect; only used for k-means fallback)
    n_clusters_arg = opts.n_clusters if opts.n_clusters != DEFAULT_N_CLUSTERS else None
    labels, centroids = cluster(valid, n_clusters_arg)
    n_found = len(centroids)

    # Collect titles per cluster
    cluster_titles: dict[int, list[str]] = {}
    for i, p in enumerate(valid):
        cid = int(labels[i])
        cluster_titles.setdefault(cid, []).append(p["title"])

    # OpenAI labeling
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        log.error("OPENAI_API_KEY environment variable not set")
        sys.exit(1)

    client = OpenAI(api_key=api_key)
    label_map = generate_labels(cluster_titles, client)

    # Build cluster metadata
    clusters = [
        {
            "id": cid,
            "label": label_map[cid],
            "centroid_2d": [round(float(centroids[cid][0]), 4), round(float(centroids[cid][1]), 4)],
        }
        for cid in range(n_found)
    ]

    # Annotate papers with cluster_id and TL;DR
    for i, p in enumerate(valid):
        p["cluster_id"] = int(labels[i])
        if "tldr" not in p:   # don't overwrite if already set
            p["tldr"] = _extract_tldr(p.get("abstract", ""))

    # Write output
    data["clusters"] = clusters
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    log.info("Wrote %d clusters to %s", len(clusters), output_path)


if __name__ == "__main__":
    main()

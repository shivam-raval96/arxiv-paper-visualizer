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

import numpy as np
from sklearn.cluster import KMeans
from openai import OpenAI

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


def cluster(papers: list[dict], n_clusters: int) -> tuple[np.ndarray, np.ndarray]:
    """Run k-means on embedding_2d. Returns (labels, centroids)."""
    coords = np.array([p["embedding_2d"] for p in papers], dtype=np.float32)
    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = km.fit_predict(coords)
    log.info("Clustered %d papers into %d clusters", len(papers), n_clusters)
    return labels, km.cluster_centers_


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

    # Cluster
    labels, centroids = cluster(valid, opts.n_clusters)

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
        for cid in range(opts.n_clusters)
    ]

    # Annotate papers with cluster_id
    for i, p in enumerate(valid):
        p["cluster_id"] = int(labels[i])

    # Write output
    data["clusters"] = clusters
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    log.info("Wrote %d clusters to %s", len(clusters), output_path)


if __name__ == "__main__":
    main()

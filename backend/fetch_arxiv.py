"""
fetch_arxiv.py — Fetch recent papers from the arXiv API.

Outputs a JSON file with raw paper metadata.
"""

import argparse
import json
import logging
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [fetch_arxiv] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

ARXIV_API = "https://export.arxiv.org/api/query"
NS = {"atom": "http://www.w3.org/2005/Atom",
      "arxiv": "http://arxiv.org/schemas/atom"}

DEFAULT_CATEGORIES = ["cs.AI", "cs.CV", "cs.LG", "cs.NLP", "stat.ML", "math.ST"]
MAX_RESULTS_PER_REQUEST = 200
RETRY_DELAY = 5  # seconds


def build_query(categories: list[str], days: int) -> str:
    """Build arXiv search query string."""
    # Category OR filter
    cat_q = " OR ".join(f"cat:{c}" for c in categories)
    # Date filter: submitted in the last `days` days
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    date_q = (
        f"submittedDate:[{start.strftime('%Y%m%d')}000000 "
        f"TO {end.strftime('%Y%m%d')}235959]"
    )
    return f"({cat_q}) AND {date_q}"


def fetch_page(query: str, start: int, max_results: int, retries: int = 3) -> bytes:
    """Fetch one page of results from arXiv API with retry logic."""
    params = urllib.parse.urlencode({
        "search_query": query,
        "start": start,
        "max_results": max_results,
        "sortBy": "submittedDate",
        "sortOrder": "descending",
    })
    url = f"{ARXIV_API}?{params}"
    log.info("Fetching %s (start=%d, max=%d)", ARXIV_API, start, max_results)

    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError) as e:
            log.warning("Attempt %d/%d failed: %s", attempt, retries, e)
            if attempt < retries:
                time.sleep(RETRY_DELAY * attempt)
            else:
                raise


def parse_feed(xml_bytes: bytes) -> list[dict]:
    """Parse Atom XML response into a list of paper dicts."""
    root = ET.fromstring(xml_bytes)
    papers = []

    for entry in root.findall("atom:entry", NS):
        try:
            arxiv_id_raw = entry.findtext("atom:id", "", NS)
            # Extract bare ID from URL like http://arxiv.org/abs/2504.12345v1
            arxiv_id = arxiv_id_raw.split("/abs/")[-1].split("v")[0].strip()

            title = entry.findtext("atom:title", "", NS).replace("\n", " ").strip()

            authors = [
                a.findtext("atom:name", "", NS).strip()
                for a in entry.findall("atom:author", NS)
            ]

            abstract = entry.findtext("atom:summary", "", NS).replace("\n", " ").strip()

            published_raw = entry.findtext("atom:published", "", NS)
            published = published_raw[:10] if published_raw else ""  # YYYY-MM-DD

            # Primary category
            primary = entry.find("arxiv:primary_category", NS)
            category = primary.attrib.get("term", "") if primary is not None else ""

            if not arxiv_id or not title:
                continue

            papers.append({
                "arxiv_id": arxiv_id,
                "title": title,
                "authors": authors,
                "abstract": abstract,
                "category": category,
                "published": published,
            })
        except Exception as e:
            log.warning("Skipping malformed entry: %s", e)

    return papers


def fetch_papers(categories: list[str], days: int) -> list[dict]:
    """Fetch all papers matching the given categories from the past `days` days."""
    query = build_query(categories, days)
    log.info("Query: %s", query)

    all_papers = []
    start = 0

    while True:
        xml_bytes = fetch_page(query, start, MAX_RESULTS_PER_REQUEST)
        batch = parse_feed(xml_bytes)

        if not batch:
            log.info("No more results at start=%d", start)
            break

        all_papers.extend(batch)
        log.info("Fetched %d papers so far", len(all_papers))

        if len(batch) < MAX_RESULTS_PER_REQUEST:
            break  # Last page

        start += MAX_RESULTS_PER_REQUEST
        time.sleep(1)  # Be polite to arXiv

    # Deduplicate by arxiv_id (keep first occurrence)
    seen = set()
    unique = []
    for p in all_papers:
        if p["arxiv_id"] not in seen:
            seen.add(p["arxiv_id"])
            unique.append(p)

    log.info("Total unique papers: %d", len(unique))
    return unique


def save_output(papers: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "papers": papers,
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    log.info("Saved %d papers to %s", len(papers), output_path)


def main(args=None):
    parser = argparse.ArgumentParser(description="Fetch arXiv papers")
    parser.add_argument("--days", type=int, default=1, help="Days to look back (default: 1)")
    parser.add_argument(
        "--categories",
        default=",".join(DEFAULT_CATEGORIES),
        help="Comma-separated arXiv categories",
    )
    parser.add_argument("--output", default="data/raw_papers.json", help="Output JSON path")
    opts = parser.parse_args(args)

    categories = [c.strip() for c in opts.categories.split(",") if c.strip()]
    papers = fetch_papers(categories, opts.days)

    if not papers:
        log.error("No papers fetched — aborting")
        sys.exit(1)

    save_output(papers, Path(opts.output))
    return papers


if __name__ == "__main__":
    main()

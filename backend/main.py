"""
main.py — Orchestrator: runs the full arXiv paper pipeline.

Usage:
    python main.py --days 1 --categories cs.AI,cs.CV,cs.LG,cs.NLP,stat.ML,math.ST
"""

import argparse
import json
import logging
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import fetch_arxiv
import embed_papers
import reduce_dims
import label_clusters

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [main] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

DATA_DIR = Path("data")
BACKUP_DIR = DATA_DIR / "backups"


def _backup_existing(path: Path) -> None:
    """Back up an existing file before overwriting it."""
    if path.exists():
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        dst = BACKUP_DIR / f"{path.stem}_{ts}{path.suffix}"
        shutil.copy2(path, dst)
        log.info("Backed up %s → %s", path, dst)


def run_pipeline(days: int, categories: list[str], output_path: Path) -> None:
    raw_path      = DATA_DIR / "raw_papers.json"
    embedded_path = DATA_DIR / "embedded_papers.json"

    # ── Step 1: Fetch ────────────────────────────────────────────────────────
    log.info("━━━ Step 1/3: Fetching papers ━━━")
    _backup_existing(raw_path)
    fetch_arxiv.main([
        "--days",       str(days),
        "--categories", ",".join(categories),
        "--output",     str(raw_path),
    ])

    # ── Step 2: Embed ────────────────────────────────────────────────────────
    log.info("━━━ Step 2/3: Generating embeddings ━━━")
    _backup_existing(embedded_path)
    embed_papers.main([
        "--input",  str(raw_path),
        "--output", str(embedded_path),
    ])

    # ── Step 3: Reduce ───────────────────────────────────────────────────────
    log.info("━━━ Step 3/4: Reducing to 2D ━━━")
    _backup_existing(output_path)
    reduce_dims.main([
        "--input",  str(embedded_path),
        "--output", str(output_path),
    ])

    # ── Step 4: Cluster + label (requires OPENAI_API_KEY) ───────────────────
    import os
    if os.environ.get("OPENAI_API_KEY"):
        log.info("━━━ Step 4/4: Clustering and labeling with OpenAI ━━━")
        label_clusters.main(["--input", str(output_path)])
    else:
        log.warning("OPENAI_API_KEY not set — skipping cluster labeling (step 4/4)")

    log.info("━━━ Pipeline complete: %s ━━━", output_path)

    # ── Step 5: Save dated snapshot + update manifest ────────────────────────
    _save_dated_snapshot(output_path)


def _save_dated_snapshot(output_path: Path) -> None:
    """
    After the pipeline writes papers.json, save a permanent dated copy
    (papers_YYYY-MM-DD.json) and update manifest.json with a 'yesterday'
    entry pointing to it.  The dated file is never overwritten — it stays
    in the repo as the permanent record for that run date.
    """
    data      = json.loads(output_path.read_text())
    date_str  = data.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    count     = len(data.get("papers", []))

    # --- dated copy ---
    dated_filename = f"papers_{date_str}.json"
    dated_path     = output_path.parent / dated_filename
    shutil.copy2(output_path, dated_path)
    log.info("Saved dated snapshot: %s (%d papers)", dated_path, count)

    # --- manifest update ---
    manifest_path = output_path.parent / "manifest.json"
    manifest      = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"months": []}

    from datetime import date as _date
    try:
        d     = _date.fromisoformat(date_str)
        label = f"{d.strftime('%b')} {d.day}"   # e.g. "Apr 14"  (no leading zero, cross-platform)
    except ValueError:
        label = date_str

    manifest["yesterday"] = {
        "key":     date_str,
        "label":   label,
        "file":    dated_filename,
        "count":   count,
        "date":    date_str,
        "isDaily": True,
    }

    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    log.info("Updated manifest: yesterday → %s", dated_filename)


def main():
    parser = argparse.ArgumentParser(description="arXiv paper visualizer pipeline")
    parser.add_argument("--days",       type=int, default=1,
                        help="Days of papers to fetch (default: 1)")
    parser.add_argument("--categories", default="cs.AI,cs.CV,cs.LG,cs.NLP,stat.ML,math.ST",
                        help="Comma-separated arXiv category list")
    parser.add_argument("--output",     default="../web/data/papers.json",
                        help="Output path for frontend JSON")
    opts = parser.parse_args()

    categories = [c.strip() for c in opts.categories.split(",") if c.strip()]

    try:
        run_pipeline(
            days=opts.days,
            categories=categories,
            output_path=Path(opts.output),
        )
    except KeyboardInterrupt:
        log.warning("Pipeline interrupted by user")
        sys.exit(130)
    except Exception as e:
        log.exception("Pipeline failed: %s", e)
        # If output doesn't exist (first run failure), don't leave a partial file
        sys.exit(1)


if __name__ == "__main__":
    main()

"""
main.py — Orchestrator: runs the full arXiv paper pipeline.

Usage:
    python main.py --days 1 --categories cs.AI,cs.CV,cs.LG,cs.CL,stat.ML,math.ST
"""

import argparse
import json
import logging
import shutil
import sys
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
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


def run_pipeline(
    days: int,
    categories: list[str],
    output_path: Path,
    date_range: tuple[date, date] | None = None,
    month_key: str | None = None,
) -> None:
    """Run the full pipeline.

    ``date_range`` (start, end) overrides ``days`` for the fetch step.
    ``month_key`` (e.g. "2026-04") switches the final save to monthly mode.
    """
    raw_path      = DATA_DIR / "raw_papers.json"
    embedded_path = DATA_DIR / "embedded_papers.json"

    # ── Step 1: Fetch ────────────────────────────────────────────────────────
    log.info("━━━ Step 1/3: Fetching papers ━━━")
    _backup_existing(raw_path)
    fetch_args = ["--categories", ",".join(categories), "--output", str(raw_path)]
    if date_range:
        fetch_args += ["--date-start", date_range[0].isoformat(),
                       "--date-end",   date_range[1].isoformat()]
    else:
        fetch_args += ["--days", str(days)]
    fetch_arxiv.main(fetch_args)

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
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        log.error("OPENAI_API_KEY not set — aborting pipeline (cluster labels required)")
        sys.exit(1)
    log.info("━━━ Step 4/4: Clustering and labeling with OpenAI ━━━")
    label_clusters.main(["--input", str(output_path)])

    log.info("━━━ Pipeline complete: %s ━━━", output_path)

    # ── Step 5: Save snapshot + update manifest ───────────────────────────────
    if month_key:
        _save_monthly_snapshot(output_path, month_key)
    else:
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


def _save_monthly_snapshot(output_path: Path, month_key: str) -> None:
    """Update manifest.months[] with the rebuilt monthly file.

    The pipeline already wrote to ``output_path`` (e.g. papers_2026-04.json),
    so we only need to refresh the manifest entry.
    """
    data  = json.loads(output_path.read_text())
    count = len(data.get("papers", []))

    year, mon = map(int, month_key.split("-"))
    label = date(year, mon, 1).strftime("%b %Y")   # "Apr 2026"

    manifest_path = output_path.parent / "manifest.json"
    manifest      = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"months": []}

    months  = manifest.get("months", [])
    idx     = next((i for i, m in enumerate(months) if m["key"] == month_key), None)
    entry   = {"key": month_key, "label": label, "file": output_path.name, "count": count}

    if idx is not None:
        months[idx] = entry
    else:
        months.insert(0, entry)   # newest first

    manifest["months"] = months
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    log.info("Updated manifest: months[%s] → %d papers", month_key, count)


def main():
    parser = argparse.ArgumentParser(description="arXiv paper visualizer pipeline")
    parser.add_argument("--days",       type=int, default=1,
                        help="Days of papers to fetch (default: 1)")
    parser.add_argument("--month",      default=None,
                        help="Rebuild full-month dataset YYYY-MM (overrides --days)")
    parser.add_argument("--categories", default="cs.AI,cs.CV,cs.LG,cs.CL,stat.ML,math.ST",
                        help="Comma-separated arXiv category list")
    parser.add_argument("--output",     default="../web/data/papers.json",
                        help="Output path for frontend JSON")
    opts = parser.parse_args()

    categories = [c.strip() for c in opts.categories.split(",") if c.strip()]

    try:
        if opts.month:
            # Monthly mode: fetch entire month, write to papers_YYYY-MM.json
            year, mon = map(int, opts.month.split("-"))
            start = date(year, mon, 1)
            last  = monthrange(year, mon)[1]
            # End = yesterday (avoids partial today) or last day of month
            end   = min(date(year, mon, last), date.today() - timedelta(days=1))
            log.info("Monthly mode: %s → %s to %s", opts.month, start, end)
            run_pipeline(
                days=0,
                categories=categories,
                output_path=Path(opts.output),
                date_range=(start, end),
                month_key=opts.month,
            )
        else:
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
        sys.exit(1)


if __name__ == "__main__":
    main()

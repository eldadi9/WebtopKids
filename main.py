"""
main.py — Python CLI wrapper for the Webtop scraper.

Usage:
    python main.py              # runs the scraper and prints JSON
    python main.py --pretty     # pretty-printed output
    python main.py --save FILE  # save output to FILE
"""

import subprocess
import json
import sys
import os
import argparse
from pathlib import Path


SCRIPT = Path(__file__).parent / "webtop_scrape.mjs"


def run_scraper(env: dict | None = None) -> dict:
    """Invoke the Playwright scraper and return parsed JSON."""
    result = subprocess.run(
        ["node", str(SCRIPT)],
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )
    raw = result.stdout.strip() or result.stderr.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": False, "error": raw or "No output from scraper"}


def main():
    parser = argparse.ArgumentParser(description="Webtop scraper CLI")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument("--save", metavar="FILE", help="Save JSON output to file")
    args = parser.parse_args()

    print("Running Webtop scraper...", file=sys.stderr)
    data = run_scraper()

    output = json.dumps(data, ensure_ascii=False, indent=2 if args.pretty else None)

    if args.save:
        Path(args.save).write_text(output, encoding="utf-8")
        print(f"Saved {data.get('count', 0)} items to {args.save}", file=sys.stderr)
    else:
        print(output)

    if not data.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()

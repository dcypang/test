"""Daily sales agent: turns a list of leads into personalised outreach drafts, and reports revenue.

It does NOT send email or scrape anything. You supply leads you are allowed to contact
(e.g. businesses you found on Google Maps whose reviews go unanswered), review the drafts,
and send them from your own mailbox. Sending ~30-50 good emails a day is the growth engine.

Usage:
    python scripts/daily_agent.py leads.csv --limit 40 --sender "Sam from ReplyPilot"

leads.csv columns (only `business` and `email` are required; extra columns are passed to the AI as facts):
    business,email,city,category,rating,unanswered_reviews,recent_review_snippet
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from replypilot.ai import AIError, ReplyWriter  # noqa: E402
from replypilot.db import Store  # noqa: E402

CONTACTED_LOG = Path("outbox/contacted.txt")


def load_contacted() -> set[str]:
    return set(CONTACTED_LOG.read_text().split()) if CONTACTED_LOG.exists() else set()


def run(leads_path: str, limit: int, sender: str, offer_url: str, writer: ReplyWriter) -> Path:
    contacted = load_contacted()
    with open(leads_path, newline="") as f:
        leads = [r for r in csv.DictReader(f) if r.get("email") and r["email"].lower() not in contacted]

    out_dir = Path("outbox")
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{date.today().isoformat()}.csv"
    written = 0
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["email", "business", "subject", "body"])
        for lead in leads[:limit]:
            try:
                text = writer.outreach_email(lead=lead, sender_name=sender, offer_url=offer_url)
            except AIError as e:
                print(f"skip {lead.get('business')}: {e}", file=sys.stderr)
                continue
            subject, _, body = text.partition("\n")
            w.writerow([lead["email"], lead.get("business", ""), subject.removeprefix("Subject:").strip(), body.strip()])
            with open(CONTACTED_LOG, "a") as log:
                log.write(lead["email"].lower() + "\n")
            written += 1
    print(f"Drafted {written} outreach emails -> {out_path}")
    return out_path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("leads", nargs="?", help="CSV of leads; omit to only print the revenue report")
    p.add_argument("--limit", type=int, default=40)
    p.add_argument("--sender", default="The ReplyPilot team")
    p.add_argument("--offer-url", default=os.environ.get("BASE_URL", "http://localhost:8000"))
    args = p.parse_args()

    if args.leads:
        run(args.leads, args.limit, args.sender, args.offer_url, ReplyWriter())

    summary = Store().revenue_summary()
    print("Revenue today:", json.dumps(summary))
    goal = 1000
    if summary["daily_revenue_usd"] < goal:
        gap = goal - summary["daily_revenue_usd"]
        print(f"Gap to ${goal}/day: ${gap:,.2f}  (~{int(gap * 365 / 12 / 79) + 1} more Pro customers)")


if __name__ == "__main__":
    main()

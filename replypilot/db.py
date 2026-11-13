"""SQLite storage for customers (access keys) and daily usage counters."""

from __future__ import annotations

import os
import secrets
import sqlite3
from datetime import date

PLANS = {
    # plan: (monthly price USD, replies per day)
    "free": (0, 3),
    "starter": (29, 50),
    "pro": (79, 300),
    "agency": (249, 2000),
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    access_key TEXT PRIMARY KEY,
    email TEXT,
    plan TEXT NOT NULL,
    stripe_customer TEXT,
    stripe_subscription TEXT UNIQUE,
    active INTEGER NOT NULL DEFAULT 1,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS usage (
    who TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (who, day)
);
"""


class Store:
    def __init__(self, path: str | None = None):
        self.path = path or os.environ.get("REPLYPILOT_DB", "replypilot.db")
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_SCHEMA)

    # --- customers ---------------------------------------------------------
    def upsert_subscription(self, *, email: str, plan: str, stripe_customer: str, stripe_subscription: str) -> str:
        """Create (or return the existing) access key for a Stripe subscription. Idempotent."""
        if plan not in PLANS or plan == "free":
            plan = "starter"
        row = self.conn.execute(
            "SELECT access_key FROM customers WHERE stripe_subscription = ?", (stripe_subscription,)
        ).fetchone()
        if row:
            self.conn.execute(
                "UPDATE customers SET active = 1, plan = ? WHERE stripe_subscription = ?", (plan, stripe_subscription)
            )
            self.conn.commit()
            return row["access_key"]
        key = "rp_" + secrets.token_urlsafe(24)
        self.conn.execute(
            "INSERT INTO customers (access_key, email, plan, stripe_customer, stripe_subscription) VALUES (?,?,?,?,?)",
            (key, email, plan, stripe_customer, stripe_subscription),
        )
        self.conn.commit()
        return key

    def deactivate_subscription(self, stripe_subscription: str) -> None:
        self.conn.execute("UPDATE customers SET active = 0 WHERE stripe_subscription = ?", (stripe_subscription,))
        self.conn.commit()

    def plan_for_key(self, access_key: str) -> str | None:
        row = self.conn.execute(
            "SELECT plan FROM customers WHERE access_key = ? AND active = 1", (access_key,)
        ).fetchone()
        return row["plan"] if row else None

    # --- usage -------------------------------------------------------------
    def consume(self, who: str, limit: int) -> bool:
        """Count one use for `who` today. Returns False (and counts nothing) if the daily limit is reached."""
        today = date.today().isoformat()
        with self.conn:
            row = self.conn.execute("SELECT count FROM usage WHERE who = ? AND day = ?", (who, today)).fetchone()
            used = row["count"] if row else 0
            if used >= limit:
                return False
            self.conn.execute(
                "INSERT INTO usage (who, day, count) VALUES (?, ?, 1) "
                "ON CONFLICT(who, day) DO UPDATE SET count = count + 1",
                (who, today),
            )
        return True

    # --- reporting ---------------------------------------------------------
    def revenue_summary(self) -> dict:
        rows = self.conn.execute(
            "SELECT plan, COUNT(*) AS n FROM customers WHERE active = 1 GROUP BY plan"
        ).fetchall()
        by_plan = {r["plan"]: r["n"] for r in rows}
        mrr = sum(PLANS[p][0] * n for p, n in by_plan.items() if p in PLANS)
        return {"customers_by_plan": by_plan, "mrr_usd": mrr, "daily_revenue_usd": round(mrr * 12 / 365, 2)}

"""SQLite storage for wait-time observations.

One row per (attraction, observation time). The collector appends; the
forecaster reads recent rows to anchor its predictions; the backtester
replays whole days out of here to score strategies against what really
happened.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    obs_date      TEXT    NOT NULL,   -- local date, YYYY-MM-DD
    obs_minute    INTEGER NOT NULL,   -- local minutes since midnight
    obs_utc       TEXT    NOT NULL,   -- ISO-8601 UTC of the poll
    attraction_id TEXT    NOT NULL,
    park          TEXT    NOT NULL,
    wait_min      INTEGER,            -- NULL when the ride is down
    is_open       INTEGER NOT NULL,
    source        TEXT    NOT NULL,
    UNIQUE(obs_date, obs_minute, attraction_id, source)
);
CREATE INDEX IF NOT EXISTS idx_obs_day     ON observations(obs_date, attraction_id, obs_minute);
CREATE INDEX IF NOT EXISTS idx_obs_ride    ON observations(attraction_id, obs_minute);

CREATE TABLE IF NOT EXISTS day_meta (
    obs_date   TEXT PRIMARY KEY,
    park_open  INTEGER,
    park_close INTEGER,
    crowd_index REAL,                 -- 1..10, derived after the fact
    source     TEXT,
    note       TEXT
);

CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_utc TEXT NOT NULL,
    kind       TEXT NOT NULL,         -- 'collect' | 'backtest' | 'plan'
    detail     TEXT
);
"""


@dataclass(frozen=True)
class Observation:
    obs_date: str
    obs_minute: int
    attraction_id: str
    park: str
    wait_min: int | None
    is_open: bool
    source: str
    obs_utc: str = ""

    def with_utc(self) -> "Observation":
        if self.obs_utc:
            return self
        return Observation(
            self.obs_date, self.obs_minute, self.attraction_id, self.park,
            self.wait_min, self.is_open, self.source,
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )


class Store:
    """A SQLite handle that is safe to share across threads.

    The web server answers requests on worker threads, and a sqlite3
    connection may only be used from the thread that opened it, so each
    thread gets its own connection to the same file.
    """

    def __init__(self, path: str | Path = "waits.sqlite3"):
        self.path = str(path)
        self._local = threading.local()
        #: ":memory:" would give every thread its own empty database, so
        #: in-memory stores stay single-connection.
        self._shared = self.path == ":memory:"
        conn = self._connect()
        conn.executescript(SCHEMA)
        conn.commit()

    def _connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=15)
            conn.row_factory = sqlite3.Row
            if not self._shared:
                # Concurrent readers alongside the collector's writes.
                conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn = conn
            if self._shared:
                self._memory_conn = conn
        return conn

    @property
    def _conn(self) -> sqlite3.Connection:
        if self._shared:
            return getattr(self, "_memory_conn", None) or self._connect()
        return self._connect()

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        conn = self._conn
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    # ---- writes -------------------------------------------------------------

    def add_observations(self, obs: Iterable[Observation]) -> int:
        rows = [
            (o.obs_date, o.obs_minute, o.obs_utc, o.attraction_id, o.park,
             o.wait_min, int(o.is_open), o.source)
            for o in (x.with_utc() for x in obs)
        ]
        if not rows:
            return 0
        with self.tx() as c:
            before = c.total_changes
            c.executemany(
                "INSERT OR IGNORE INTO observations "
                "(obs_date, obs_minute, obs_utc, attraction_id, park, wait_min, is_open, source) "
                "VALUES (?,?,?,?,?,?,?,?)",
                rows,
            )
            return c.total_changes - before

    def set_day_meta(self, obs_date: str, park_open: int, park_close: int,
                     crowd_index: float | None = None, source: str = "",
                     note: str = "") -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO day_meta (obs_date, park_open, park_close, crowd_index, source, note) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(obs_date) DO UPDATE SET "
                "park_open=excluded.park_open, park_close=excluded.park_close, "
                "crowd_index=COALESCE(excluded.crowd_index, day_meta.crowd_index), "
                "source=excluded.source, note=excluded.note",
                (obs_date, park_open, park_close, crowd_index, source, note),
            )

    def log_run(self, kind: str, detail: str = "") -> None:
        with self.tx() as c:
            c.execute(
                "INSERT INTO runs (started_utc, kind, detail) VALUES (?,?,?)",
                (datetime.now(timezone.utc).isoformat(timespec="seconds"), kind, detail),
            )

    # ---- reads --------------------------------------------------------------

    def days(self) -> list[str]:
        return [r[0] for r in self._conn.execute(
            "SELECT DISTINCT obs_date FROM observations ORDER BY obs_date")]

    def day_trace(self, obs_date: str) -> dict[str, list[tuple[int, int | None]]]:
        """All observations for one day as {attraction_id: [(minute, wait), ...]}."""
        out: dict[str, list[tuple[int, int | None]]] = {}
        q = ("SELECT attraction_id, obs_minute, wait_min, is_open FROM observations "
             "WHERE obs_date = ? ORDER BY attraction_id, obs_minute")
        for r in self._conn.execute(q, (obs_date,)):
            wait = r["wait_min"] if r["is_open"] else None
            out.setdefault(r["attraction_id"], []).append((r["obs_minute"], wait))
        return out

    def latest_snapshot(self, obs_date: str | None = None) -> dict[str, tuple[int, int | None]]:
        """Most recent reading per attraction as {id: (minute, wait)}."""
        obs_date = obs_date or date.today().isoformat()
        q = ("SELECT attraction_id, obs_minute, wait_min, is_open FROM observations o "
             "WHERE obs_date = ? AND obs_minute = "
             "  (SELECT MAX(obs_minute) FROM observations WHERE obs_date = o.obs_date "
             "   AND attraction_id = o.attraction_id)")
        return {
            r["attraction_id"]: (r["obs_minute"], r["wait_min"] if r["is_open"] else None)
            for r in self._conn.execute(q, (obs_date,))
        }

    def history_profile(self, attraction_id: str, weekday: int | None = None,
                        month: int | None = None) -> list[tuple[int, float]]:
        """Average wait by 15-minute bucket across matching historical days.

        Returns [(bucket_start_minute, mean_wait)]. Used to build the prior
        shape that the live reading is blended against.
        """
        rows = self._conn.execute(
            "SELECT obs_date, obs_minute, wait_min FROM observations "
            "WHERE attraction_id = ? AND is_open = 1 AND wait_min IS NOT NULL",
            (attraction_id,),
        ).fetchall()
        buckets: dict[int, list[int]] = {}
        for r in rows:
            d = date.fromisoformat(r["obs_date"])
            if weekday is not None and d.weekday() != weekday:
                continue
            if month is not None and d.month != month:
                continue
            buckets.setdefault((r["obs_minute"] // 15) * 15, []).append(r["wait_min"])
        return sorted((b, sum(v) / len(v)) for b, v in buckets.items())

    def coverage(self) -> list[dict]:
        q = ("SELECT obs_date, COUNT(*) n, COUNT(DISTINCT attraction_id) rides, "
             "MIN(obs_minute) first_min, MAX(obs_minute) last_min, "
             "GROUP_CONCAT(DISTINCT source) sources "
             "FROM observations GROUP BY obs_date ORDER BY obs_date")
        return [dict(r) for r in self._conn.execute(q)]

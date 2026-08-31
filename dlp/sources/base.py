"""Common plumbing for wait-time sources."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Protocol

from ..store import Observation

USER_AGENT = "dlp-ride-optimizer/1.0 (personal trip planning)"


class SourceError(RuntimeError):
    pass


class Source(Protocol):
    """Anything that can report waits for a given moment."""

    name: str

    def fetch(self, obs_date: str, obs_minute: int) -> list[Observation]:
        """Return observations valid at ``obs_minute`` on ``obs_date``."""
        ...


def get_json(url: str, timeout: int = 20) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT,
                                               "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SourceError(f"{url} -> HTTP {e.code}") from e
    except urllib.error.URLError as e:
        raise SourceError(f"{url} -> {e.reason}") from e
    except json.JSONDecodeError as e:
        raise SourceError(f"{url} -> malformed JSON: {e}") from e


def normalise(name: str) -> str:
    """Loose name key for matching API attraction names to catalog entries."""
    import re
    import unicodedata

    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    # Strip filler words that vary between data providers.
    drop = {"the", "a", "an", "de", "du", "des", "la", "le", "les", "of", "et",
            "and", "l", "d", "ride", "attraction"}
    return " ".join(w for w in s.split() if w not in drop)


def match_attraction(api_name: str, catalog) -> str | None:
    """Best-effort match of a provider's attraction name to a catalog id."""
    target = normalise(api_name)
    if not target:
        return None
    best, best_score = None, 0.0
    for a in catalog:
        cand = normalise(a.name)
        score = _similarity(target, cand)
        if score > best_score:
            best, best_score = a.id, score
    return best if best_score >= 0.62 else None


def _similarity(a: str, b: str) -> float:
    """Token overlap plus a bonus for one string containing the other."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    jaccard = len(ta & tb) / len(ta | tb)
    if a in b or b in a:
        jaccard = max(jaccard, 0.85)
    return jaccard

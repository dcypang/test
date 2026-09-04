"""Common plumbing for wait-time sources."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from difflib import SequenceMatcher
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


#: Attractions whose English and French names share no words. No string
#: similarity can bridge "Snow White" and "Blanche-Neige", so the pairs are
#: simply listed. Keys are normalised names.
ALIASES = {
    "snow white seven dwarfs": "snow_white",
    "snow whites scary adventures": "snow_white",
    "storybook land canal boats": "storybook",
    "land fairy tales": "storybook",
    "swiss family robinson treehouse": "robinson",
    "family robinson treehouse": "robinson",
    "aladdins enchanted passage": "aladdin",
    "enchanted passage aladdin": "aladdin",
    "casey jr circus train": "casey_jr",
    "little circus train": "casey_jr",
    "flying carpets over agrabah": "flying_carpets",
    "magic carpets": "flying_carpets",
    "cars race rally": "cars_rallye",
    "cars four wheel rally": "cars_rallye",
    "dragons lair": "dragon_lair",
    "sleeping beauty castle": "dragon_lair",
    "riverboat landing": "riverboat",
    "molly brown riverboat": "riverboat",
}


def _idf(catalog) -> dict[str, float]:
    """How much evidence each word carries.

    "Main" and "Street" appear all over a park; "Ratatouille" appears once.
    Without this, "Starbucks Main Street" matches the railroad station on the
    strength of two throwaway words.
    """
    cached = getattr(catalog, "_idf_cache", None)
    if cached is not None:
        return cached
    import math
    names = [normalise(a.name).split() for a in catalog]
    n = max(1, len(names))
    df: dict[str, int] = {}
    for toks in names:
        for w in set(toks):
            df[w] = df.get(w, 0) + 1
    idf = {w: math.log(1 + n / c) for w, c in df.items()}
    try:
        catalog._idf_cache = idf
    except AttributeError:
        pass
    return idf


def match_attraction(api_name: str, catalog) -> str | None:
    """Best-effort match of a provider's attraction name to a catalog id."""
    target = normalise(api_name)
    if not target:
        return None
    if target in ALIASES:
        return ALIASES[target]
    idf = _idf(catalog)
    best, best_score = None, 0.0
    for a in catalog:
        score = _similarity(target, normalise(a.name), idf)
        if score > best_score:
            best, best_score = a.id, score
    # A word that appears nowhere in any attraction name is evidence this is
    # a shop or a restaurant, not a ride. "Starbucks Main Street" otherwise
    # matches the railroad station on the strength of "main" and "street".
    best_score *= 1.0 - _unknown_ratio(target, idf)
    return best if best_score >= 0.62 else None


def _unknown_ratio(target: str, idf: dict[str, float]) -> float:
    toks = target.split()
    if not toks:
        return 1.0
    vocab = idf.keys()
    unknown = sum(1 for w in toks
                  if w not in idf and not any(_token_close(w, v) for v in vocab))
    return unknown / len(toks)


def _token_close(x: str, y: str) -> bool:
    """Are two words the same word? Providers mix English and French spellings
    of the same attraction ("adventure" / "aventure"), and a strict comparison
    treats those as unrelated."""
    if x == y:
        return True
    if abs(len(x) - len(y)) > 3 or min(len(x), len(y)) < 4:
        return False
    return SequenceMatcher(None, x, y).ratio() >= 0.85


def _similarity(a: str, b: str, idf: dict[str, float] | None = None) -> float:
    """How likely are these two names the same attraction?

    Three signals, best one wins:

    * token overlap, which handles reordering and extra words;
    * substring containment, for a provider that truncates a long name;
    * fuzzy containment — what fraction of the shorter name's words appear
      in the longer one, allowing near-matches. This is the one that rescues
      "Ratatouille: The Adventure" against "Ratatouille: L'Aventure
      Totalement Toquee de Remy", where the two share exactly one word
      spelled identically.
    """
    ta, tb = a.split(), b.split()
    if not ta or not tb:
        return 0.0
    sa, sb = set(ta), set(tb)
    jaccard = len(sa & sb) / len(sa | sb)
    if a in b or b in a:
        jaccard = max(jaccard, 0.85)

    short, long = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    # Weight each word by how much it distinguishes one attraction from the
    # rest, so matching "main street" counts for far less than "ratatouille".
    weight = lambda w: (idf or {}).get(w, 1.6)
    total = sum(weight(w) for w in short) or 1.0
    hits = sum(weight(w) for w in short
               if any(_token_close(w, v) for v in long))
    contained = hits / total
    # Containment on a one-word name is too easy to hit by accident.
    if len(short) < 2:
        contained *= 0.7
    return max(jaccard, contained)

"""Tests for the park map: geometry, the OSM importer, and name matching."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dlp import osm
from dlp.model import Catalog
from dlp.sources.base import SourceError, match_attraction, normalise

GEOMETRY = Path(__file__).resolve().parent.parent / "dlp" / "data" / "park_geometry.json"


def point_in_polygon(lat: float, lon: float, poly: list[list[float]]) -> bool:
    """Ray casting. Polygons here are simple, so this is enough."""
    inside = False
    n = len(poly)
    for i in range(n):
        y0, x0 = poly[i]
        y1, x1 = poly[(i + 1) % n]
        if (y0 > lat) != (y1 > lat):
            xint = x0 + (lat - y0) * (x1 - x0) / (y1 - y0)
            if lon < xint:
                inside = not inside
    return inside


class TestGeometry(unittest.TestCase):
    def setUp(self):
        self.geo = json.loads(GEOMETRY.read_text())
        self.cat = Catalog.load()

    def test_has_both_parks_and_their_lands(self):
        self.assertEqual(set(self.geo["parks"]), {"DLP", "DAW"})
        for key, park in self.geo["parks"].items():
            self.assertGreaterEqual(len(park["outline"]), 4, key)

    def test_every_land_in_the_catalog_has_a_polygon(self):
        drawn = {l["name"] for l in self.geo["lands"]}
        for a in self.cat:
            self.assertIn(a.land, drawn, f"{a.land} has no shape on the map")

    def test_coordinates_are_at_disneyland_paris(self):
        """A projection bug or a lat/lon swap moves the park to Somalia."""
        pts = [p for l in self.geo["lands"] for p in l["polygon"]]
        pts += [p for k in self.geo["parks"].values() for p in k["outline"]]
        pts += [[a.lat, a.lon] for a in self.cat]
        for lat, lon in pts:
            self.assertTrue(48.855 < lat < 48.885, f"latitude {lat} is not Marne-la-Vallee")
            self.assertTrue(2.755 < lon < 2.795, f"longitude {lon} is not Marne-la-Vallee")

    def test_each_attraction_sits_inside_its_own_land(self):
        """The whole point of generating positions by bearing and radius: a
        ride must be drawn inside the land it belongs to, or the map lies."""
        polys = {(l["park"], l["name"]): l["polygon"] for l in self.geo["lands"]}
        misplaced = []
        for a in self.cat:
            poly = polys.get((a.park, a.land))
            if poly is None:
                continue
            if not point_in_polygon(a.lat, a.lon, poly):
                misplaced.append(f"{a.name} is outside {a.land}")
        self.assertEqual(misplaced, [], "; ".join(misplaced))

    def test_parks_do_not_overlap(self):
        """Disneyland Park and the Studios are a kilometre apart; if their
        outlines intersect, the shared-scale map will draw them on top of
        each other."""
        def box(pts):
            la = [p[0] for p in pts]; lo = [p[1] for p in pts]
            return min(la), max(la), min(lo), max(lo)
        a = box(self.geo["parks"]["DLP"]["outline"])
        b = box(self.geo["parks"]["DAW"]["outline"])
        overlap_lat = min(a[1], b[1]) - max(a[0], b[0])
        overlap_lon = min(a[3], b[3]) - max(a[2], b[2])
        self.assertTrue(overlap_lat <= 0 or overlap_lon <= 0,
                        "park outlines overlap")

    def test_declares_itself_schematic_or_surveyed(self):
        src = self.geo["_meta"]["source"]
        self.assertIn(src, {"schematic", "openstreetmap"})


class TestNameMatching(unittest.TestCase):
    """Providers spell the same ride many ways, and mix English with French."""

    def setUp(self):
        self.cat = Catalog.load()

    def test_matches_the_spellings_providers_actually_use(self):
        cases = {
            "Big Thunder Mountain Railroad": "big_thunder",
            "Ratatouille: The Adventure": "ratatouille",
            "Remy's Ratatouille Adventure": "ratatouille",
            "Indiana Jones and the Temple of Peril": "indiana_jones",
            "Hyperspace Mountain": "hyperspace_mountain",
            "Tower of Terror": "tower_of_terror",
            "it's a small world": "small_world",
            "Crush's Coaster": "crush_coaster",
            "Storybook Land Canal Boats": "storybook",
            "Swiss Family Robinson Treehouse": "robinson",
            "Snow White and the Seven Dwarfs": "snow_white",
            "Blanche-Neige et les Sept Nains": "snow_white",
        }
        for name, want in cases.items():
            self.assertEqual(match_attraction(name, self.cat), want, name)

    def test_shops_and_restaurants_match_nothing(self):
        """A false positive here silently corrupts the wait-time database."""
        for name in ("Starbucks Main Street", "Main Street Bakery",
                     "Cowboy Cookout Barbecue", "Casey's Corner",
                     "Walt's - an American Restaurant", "Plaza Gardens",
                     "Restroom", "Some Unmapped Kiosk"):
            self.assertIsNone(match_attraction(name, self.cat), name)

    def test_accents_and_filler_words_are_ignored(self):
        self.assertEqual(normalise("Le Passage Enchanté d'Aladdin"),
                         normalise("Passage Enchante Aladdin"))


class TestOsmImport(unittest.TestCase):
    def setUp(self):
        self.cat = Catalog.load()

    @staticmethod
    def _way(i, tags, pts):
        return {"type": "way", "id": i, "tags": tags,
                "geometry": [{"lat": a, "lon": b} for a, b in pts]}

    @staticmethod
    def _node(i, tags, lat, lon):
        return {"type": "node", "id": i, "tags": tags, "lat": lat, "lon": lon}

    def _response(self):
        box = lambda la, lo, d: [(la - d, lo - d), (la - d, lo + d),
                                 (la + d, lo + d), (la + d, lo - d), (la - d, lo - d)]
        els = [
            self._way(1, {"tourism": "theme_park", "name": "Disneyland Park"},
                      box(48.8718, 2.7757, 0.004)),
            self._way(2, {"tourism": "theme_park", "name": "Walt Disney Studios Park"},
                      box(48.8674, 2.7820, 0.002)),
            self._way(3, {"natural": "water", "name": "Rivers of the Far West"},
                      box(48.8730, 2.7715, 0.0008)),
            self._way(9, {"highway": "footway"}, [(48.870, 2.7757), (48.8718, 2.7757)]),
        ]
        for i, land in enumerate(["Frontierland", "Fantasyland", "Adventureland",
                                  "Discoveryland", "Worlds of Pixar"]):
            els.append(self._way(20 + i, {"leisure": "park", "name": land},
                                 box(48.872 + i * 0.0006, 2.774 + i * 0.0008, 0.0012)))
        names = ["Big Thunder Mountain", "Phantom Manor", "Pirates of the Caribbean",
                 "Peter Pan's Flight", "it's a small world", "Dumbo the Flying Elephant",
                 "Star Wars Hyperspace Mountain", "Buzz Lightyear Laser Blast",
                 "Star Tours", "Crush's Coaster", "Ratatouille: The Adventure",
                 "The Twilight Zone Tower of Terror", "Indiana Jones et le Temple du Peril",
                 "Some Unmapped Kiosk"]
        for i, n in enumerate(names):
            els.append(self._node(100 + i, {"attraction": "amusement_ride", "name": n},
                                  48.8700 + i * 0.0004, 2.7740 + i * 0.0006))
        return {"elements": els}

    def test_parses_a_response_into_geometry(self):
        res = osm.parse(self._response(), self.cat)
        self.assertEqual(res.counts["parks"], 2)
        self.assertGreaterEqual(res.counts["lands"], 5)
        self.assertGreaterEqual(res.counts["water"], 1)
        self.assertGreaterEqual(len(res.positions), 12)
        self.assertEqual(res.geometry["_meta"]["source"], "openstreetmap")
        self.assertIn("OpenStreetMap", res.geometry["_meta"]["licence"])
        self.assertTrue(res.ok())

    def test_unmatched_names_are_reported_not_guessed(self):
        res = osm.parse(self._response(), self.cat)
        self.assertIn("Some Unmapped Kiosk", res.unmatched)
        self.assertNotIn("Some Unmapped Kiosk", res.positions)

    def test_a_thin_response_is_refused(self):
        """Overpass sometimes returns almost nothing under load. Writing that
        over a working map would be worse than failing."""
        thin = osm.parse({"elements": self._response()["elements"][:3]}, self.cat)
        self.assertFalse(thin.ok())
        with self.assertRaises(SourceError):
            osm.apply(thin)

    def test_apply_writes_both_files(self):
        import tempfile
        res = osm.parse(self._response(), self.cat)
        with tempfile.TemporaryDirectory() as d:
            gpath = Path(d) / "geometry.json"
            apath = Path(d) / "attractions.json"
            apath.write_text(
                (Path(__file__).resolve().parent.parent
                 / "dlp" / "data" / "attractions.json").read_text())
            out = osm.apply(res, geometry_path=gpath, attractions_path=apath)
            self.assertGreater(out["moved"], 5)
            written = json.loads(apath.read_text())
            self.assertIn("openstreetmap", written["_meta"]["coord_source"])
            self.assertEqual(json.loads(gpath.read_text())["_meta"]["source"],
                             "openstreetmap")

    def test_query_covers_the_resort(self):
        q = osm.build_query()
        for tag in ("theme_park", "natural", "highway", "attraction"):
            self.assertIn(tag, q)
        self.assertIn("48.86", q)


if __name__ == "__main__":
    unittest.main(verbosity=2)

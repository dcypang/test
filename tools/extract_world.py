#!/usr/bin/env python3
"""Decode the Natural Earth 110m TopoJSON into compact lon/lat rings.

Input is the `world-atlas` npm package's countries-110m.json (TopoJSON,
delta-encoded and quantized). Output is a JSON array of polygons, each polygon
a flat array [lon0, lat0, lon1, lat1, ...] rounded to 2 decimals, which is
about a kilometre of precision -- well past what 110m source data carries.

    python3 tools/extract_world.py vendor/countries-110m.json data/world.json
"""

import json
import sys


def decode_arcs(topology):
    scale = topology["transform"]["scale"]
    translate = topology["transform"]["translate"]
    arcs = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append((x * scale[0] + translate[0], y * scale[1] + translate[1]))
        arcs.append(points)
    return arcs


def ring_points(arc_indices, arcs):
    points = []
    for index in arc_indices:
        if index >= 0:
            arc = arcs[index]
        else:
            arc = arcs[~index][::-1]
        # Consecutive arcs share an endpoint; drop the duplicate seam.
        points.extend(arc[1:] if points else arc)
    return points


def flatten(points):
    flat = []
    last = None
    for lon, lat in points:
        pair = (round(lon, 2), round(lat, 2))
        if pair == last:
            continue
        last = pair
        flat.extend(pair)
    return flat


def main():
    src, dest = sys.argv[1], sys.argv[2]
    with open(src) as handle:
        topology = json.load(handle)

    arcs = decode_arcs(topology)
    polygons = []
    for geometry in topology["objects"]["countries"]["geometries"]:
        kind = geometry.get("type")
        if kind == "Polygon":
            shapes = [geometry["arcs"]]
        elif kind == "MultiPolygon":
            shapes = geometry["arcs"]
        else:
            continue
        for shape in shapes:
            for ring in shape:
                flat = flatten(ring_points(ring, arcs))
                if len(flat) >= 8:
                    polygons.append(flat)

    with open(dest, "w") as handle:
        json.dump(polygons, handle, separators=(",", ":"))

    points = sum(len(p) // 2 for p in polygons)
    print(f"{len(polygons)} rings, {points} points -> {dest}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Inline the data and fonts into a single self-contained index.html.

The page has to run with no network at all -- it is published as an artifact
under a strict CSP -- so the world geometry, the airport table and every
typeface get folded into the HTML itself.

    python3 tools/build.py
"""

import base64
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "src" / "app.html"
OUT = ROOT / "index.html"

FONTS = {
    "__FONT_BC600__": "barlow-condensed-latin-600-normal.woff2",
    "__FONT_BC700__": "barlow-condensed-latin-700-normal.woff2",
    "__FONT_B400__": "barlow-latin-400-normal.woff2",
    "__FONT_M400__": "ibm-plex-mono-latin-400-normal.woff2",
    "__FONT_M500__": "ibm-plex-mono-latin-500-normal.woff2",
}


def data_uri(path):
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:font/woff2;base64,{encoded}"


def main():
    html = TEMPLATE.read_text()

    replacements = {
        "__WORLD__": (ROOT / "data" / "world.json").read_text().strip(),
        "__AIRPORTS__": (ROOT / "data" / "airports.json").read_text().strip(),
    }
    for token, filename in FONTS.items():
        replacements[token] = data_uri(ROOT / "assets" / "fonts" / filename)

    for token, value in replacements.items():
        if token not in html:
            sys.exit(f"template is missing the {token} placeholder")
        html = html.replace(token, value)

    OUT.write_text(html)
    print(f"index.html -- {len(html) / 1024:.0f} KB")


if __name__ == "__main__":
    main()

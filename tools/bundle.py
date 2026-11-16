#!/usr/bin/env python3
"""Bundle src/ into a single playable file.

  python3 tools/bundle.py                 -> index.html (standalone page)
  python3 tools/bundle.py --fragment OUT  -> also write OUT without the <html> wrapper
"""
import pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
page = (src / 'page.html').read_text()
scripts = ''.join('<script>\n%s\n</script>\n' % (src / f).read_text() for f in ('map-data.js', 'sim.js', 'game.js'))
assert '</script>' not in scripts.replace('\n</script>\n', '')
fragment = page.replace('<!--SCRIPTS-->', scripts)

WRAP = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
html { box-sizing: border-box; padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); }
body { margin: 0; }
[hidden] { display: none !important; }
</style>
'''
(root / 'index.html').write_text(WRAP + fragment + '</html>\n')
print('index.html', len(WRAP + fragment) // 1024, 'KB')
if '--fragment' in sys.argv:
    out = pathlib.Path(sys.argv[sys.argv.index('--fragment') + 1])
    out.write_text(fragment)
    print(out, len(fragment) // 1024, 'KB')

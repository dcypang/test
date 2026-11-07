// Extracts the PAGES story data from the comic page into JSON for the Blender renderer.
// Usage: node blender/export_story.js > blender/story.json
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'great-goo-caper.html'), 'utf8');
const start = html.indexOf('const PAGES = ');
const end = html.indexOf('\n];', start) + 3;
const PAGES = eval('(' + html.slice(start + 'const PAGES = '.length, end - 1) + ')');
const cover = html.match(/const COVER_ITEMS=(\[.*?\]);/);
const out = [];
PAGES.forEach((pg, i) => {
  if (pg.cover) {
    out.push({ id: `p${i + 1}-1`, w: 800, h: 950, bg: 'cover', items: eval(cover[1]) });
  } else {
    pg.panels.forEach((p, j) => out.push({ id: `p${i + 1}-${j + 1}`, w: p.w === 2 ? 800 : 400, h: 300, bg: p.bg, items: p.items || [] }));
  }
});
process.stdout.write(JSON.stringify(out, null, 1));

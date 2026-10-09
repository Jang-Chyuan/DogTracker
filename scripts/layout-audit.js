#!/usr/bin/env node
// Global layout audit (060): reads the screenshots and `uiautomator dump`s
// that scripts/layout-audit.sh takes of every screen fixture and reports
//   a  text outside its parent: a TextView whose bounds reach outside its
//      parent view (outside scroll containers), e.g. a glyph grown past its
//      circle or a label past its pill;
//   b  map showing on a full-screen page: on pages with the 「‹ 標題」 header
//      (or no map in the dump), the top 150 px and bottom 120 px must be the
//      page colour, not map pixels;
//   c  square pills: a small filled element (28–64 dp high, wider than high)
//      whose corner pixels are its own fill, not what is around it;
//   d  6b: Google's default red pin anywhere; white blocks in dark shots.
//
//   node scripts/layout-audit.js <dir> [--dark] [--density 2.75] [--json out.json]
//
// <dir> holds <name>.png and <name>.xml pairs. Exit code 1 when anything is
// flagged. Thresholds are deliberately strict; every hit is meant to be
// looked at.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const args = process.argv.slice(2);
const dir = args[0];
const dark = args.includes('--dark');
const densityAt = args.indexOf('--density');
const density = densityAt > 0 ? Number(args[densityAt + 1]) : 2.75;
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt > 0 ? args[jsonAt + 1] : null;

// ---- the dump --------------------------------------------------------------
function parseDump(xml) {
  const root = { children: [], attrs: {} };
  const stack = [root];
  const re = /<node ([^>]*?)(\/?)>|<\/node>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '</node>') {
      stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const b = (attrs.bounds || '').match(/\d+/g)?.map(Number) || [0, 0, 0, 0];
    const node = { attrs, box: { x1: b[0], y1: b[1], x2: b[2], y2: b[3] }, children: [], parent: stack[stack.length - 1] };
    node.parent.children.push(node);
    if (m[2] !== '/') stack.push(node);
  }
  return root;
}
const walk = (node, fn) => {
  fn(node);
  node.children.forEach(child => walk(child, fn));
};
const inScroll = node => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.attrs?.scrollable === 'true' || /ScrollView|RecyclerView/.test(p.attrs?.class || '')) return true;
  }
  return false;
};

// ---- the picture -------------------------------------------------------------
const px = (png, x, y) => {
  const i = (png.width * Math.min(png.height - 1, Math.max(0, y)) + Math.min(png.width - 1, Math.max(0, x))) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const PAGE = dark ? [[0x17, 0x12, 0x11], [0x26, 0x20, 0x20]] : [[0xff, 0xff, 0xff], [0xfa, 0xf7, 0xf6]];

function bandIsPage(png, y1, y2) {
  let page = 0;
  let total = 0;
  for (let y = y1; y < y2; y += 3) {
    for (let x = 0; x < png.width; x += 3) {
      total += 1;
      const c = px(png, x, y);
      // Page colour, or the status bar's / nav bar's own glyphs (grey-ish text).
      const grey = Math.abs(c[0] - c[1]) < 12 && Math.abs(c[1] - c[2]) < 12;
      if (PAGE.some(p => dist(c, p) < 18) || grey) page += 1;
    }
  }
  return page / total;
}

function pinHits(png) {
  let hits = 0;
  const seen = [];
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      if (dist(px(png, x, y), [129, 17, 17]) > 28) continue;
      if (seen.some(([a, b]) => Math.abs(a - y) < 30 && Math.abs(b - x) < 30)) continue;
      let best = 0;
      for (const r of [8, 12, 18, 24, 30]) {
        let n = 0;
        for (let k = 0; k < 16; k += 1) {
          const t = (k / 16) * 2 * Math.PI;
          if (dist(px(png, Math.round(x + r * Math.cos(t)), Math.round(y + r * Math.sin(t))), [234, 53, 53]) < 45) n += 1;
        }
        best = Math.max(best, n);
      }
      if (best >= 12) {
        hits += 1;
        seen.push([y, x]);
      }
    }
  }
  return hits;
}

function whiteShare(png) {
  let white = 0;
  let total = 0;
  for (let y = Math.round(png.height * 0.06); y < png.height * 0.96; y += 3) {
    for (let x = 0; x < png.width; x += 3) {
      total += 1;
      const c = px(png, x, y);
      if (c[0] > 235 && c[1] > 235 && c[2] > 235) white += 1;
    }
  }
  return white / total;
}

// ---- checks ------------------------------------------------------------------
const results = [];
const names = fs.readdirSync(dir).filter(f => f.endsWith('.xml')).map(f => f.slice(0, -4)).sort();
const counts = { screens: 0, a: 0, b: 0, c: 0, pins: 0, white: 0 };
for (const name of names) {
  const pngPath = path.join(dir, `${name}.png`);
  if (!fs.existsSync(pngPath)) continue;
  counts.screens += 1;
  const png = PNG.sync.read(fs.readFileSync(pngPath));
  const tree = parseDump(fs.readFileSync(path.join(dir, `${name}.xml`), 'utf8'));
  const hits = [];
  let hasMap = false;
  let hasHeader = false;
  walk(tree, node => {
    const a = node.attrs;
    if (a['content-desc'] === 'Google Map') hasMap = true;
    if (/page-back/.test(a['resource-id'] || '')) hasHeader = true;
  });
  // a: text outside its parent
  walk(tree, node => {
    const a = node.attrs;
    if (a.package !== 'com.dogtracker' || !/TextView/.test(a.class || '') || !node.parent?.attrs?.class) return;
    if (inScroll(node)) return;
    const p = node.parent.box;
    const b = node.box;
    const over = Math.max(p.x1 - b.x1, b.x2 - p.x2, p.y1 - b.y1, b.y2 - p.y2);
    if (over > 2 && p.x2 > p.x1 && p.y2 > p.y1) {
      hits.push({ check: 'a', text: a.text || a['content-desc'], overPx: over, box: a.bounds, parent: node.parent.attrs.bounds });
    }
  });
  // b: map strip on full-screen pages
  if (hasHeader || !hasMap) {
    const top = bandIsPage(png, 0, 150);
    const bottom = bandIsPage(png, png.height - 120, png.height);
    if (top < 0.9 || bottom < 0.9) hits.push({ check: 'b', top: +top.toFixed(3), bottom: +bottom.toFixed(3) });
  }
  // c: square pills
  walk(tree, node => {
    const a = node.attrs;
    // Pills are views holding text, not the text itself.
    if (a.package !== 'com.dogtracker' || /TextView/.test(a.class || '')) return;
    const { x1, y1, x2, y2 } = node.box;
    const h = (y2 - y1) / density;
    const w = (x2 - x1) / density;
    if (h < 28 || h > 64 || w <= h * 1.2 || w > 300) return;
    const midY = Math.round((y1 + y2) / 2);
    const fill = px(png, x1 + 3, midY);
    const outside = px(png, x1 - 4, midY);
    const centre = px(png, Math.round((x1 + x2) / 2), midY);
    if (dist(fill, outside) < 20 || dist(centre, outside) < 20) return; // not a filled shape
    const corners = [px(png, x1 + 1, y1 + 1), px(png, x2 - 2, y1 + 1), px(png, x1 + 1, y2 - 2), px(png, x2 - 2, y2 - 2)];
    if (corners.filter(c => dist(c, fill) < 12).length >= 3) {
      hits.push({ check: 'c', text: a.text || a['content-desc'] || a['resource-id'] || a.class, box: a.bounds, heightDp: Math.round(h) });
    }
  });
  // d: 6b
  const pins = pinHits(png);
  if (pins) hits.push({ check: 'pin', pins });
  if (dark) {
    const white = whiteShare(png);
    if (white > 0.03) hits.push({ check: 'white', share: +white.toFixed(3) });
  }
  for (const hit of hits) {
    if (hit.check === 'pin') counts.pins += 1;
    else if (hit.check === 'white') counts.white += 1;
    else counts[hit.check] += 1;
  }
  results.push({ name, hits });
}
for (const r of results.filter(item => item.hits.length)) {
  console.log(r.name);
  r.hits.forEach(hit => console.log(`  ${JSON.stringify(hit)}`));
}
console.log(JSON.stringify(counts));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ counts, results }, null, 1));
process.exitCode = counts.a + counts.b + counts.c + counts.pins + counts.white ? 1 : 0;

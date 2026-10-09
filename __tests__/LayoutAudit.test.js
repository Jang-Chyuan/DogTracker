// 060: scripts/layout-audit.js finds what it is meant to find (a square pill,
// text outside its circle, map pixels over a page's top) and nothing on a
// clean screen.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { PNG } from 'pngjs';

const script = path.join(__dirname, '..', 'scripts', 'layout-audit.js');

function screen(dir, name, { pill = null, textOut = false, mapTop = false, header = false }) {
  const png = new PNG({ width: 1080, height: 2340 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([255, 255, 255, 255], i);
  const fill = (x1, y1, x2, y2, c, round = 0) => {
    for (let y = y1; y < y2; y += 1) {
      for (let x = x1; x < x2; x += 1) {
        if (round) {
          const cx = Math.min(Math.max(x, x1 + round), x2 - round), cy = Math.min(Math.max(y, y1 + round), y2 - round);
          if (Math.hypot(x - cx, y - cy) > round) continue;
        }
        png.data.set([...c, 255], (y * 1080 + x) * 4);
      }
    }
  };
  if (mapTop) fill(0, 0, 1080, 150, [120, 170, 110]);
  if (pill) fill(100, 1000, 500, 1110, [255, 228, 223], pill === 'round' ? 55 : 0);
  fs.writeFileSync(path.join(dir, `${name}.png`), PNG.sync.write(png));
  const node = (attrs, children = '') => `<node ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${children}</node>`;
  const kids = [
    header ? node({ package: 'com.dogtracker', class: 'android.view.ViewGroup', 'resource-id': 'page-back', bounds: '[0,150][200,280]' }) : '',
    pill ? node({ package: 'com.dogtracker', class: 'android.view.ViewGroup', bounds: '[100,1000][500,1110]' }) : '',
    textOut ? node({ package: 'com.dogtracker', class: 'android.view.ViewGroup', bounds: '[600,1000][650,1050]' },
      node({ package: 'com.dogtracker', class: 'android.widget.TextView', text: '!', bounds: '[600,990][650,1070]' })) : '',
  ].join('');
  fs.writeFileSync(path.join(dir, `${name}.xml`),
    `<hierarchy>${node({ package: 'com.dogtracker', class: 'android.widget.FrameLayout', bounds: '[0,0][1080,2340]' }, kids)}</hierarchy>`);
}

test('the layout audit flags square pills, text out of its shape and map over a page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-audit-'));
  screen(dir, 'clean', { pill: 'round', header: true });
  screen(dir, 'square', { pill: 'square', header: true });
  screen(dir, 'glyph', { textOut: true, header: true });
  screen(dir, 'strip', { mapTop: true, header: true });
  let out = '';
  try {
    execFileSync('node', [script, dir, '--json', path.join(dir, 'r.json')]);
  } catch (error) {
    out = error.stdout.toString();
  }
  const { results } = JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8'));
  const checks = name => results.find(r => r.name === name).hits.map(h => h.check);
  expect(checks('clean')).toEqual([]);
  expect(checks('square')).toEqual(['c']);
  expect(checks('glyph')).toEqual(['a']);
  expect(checks('strip')).toEqual(['b']);
  expect(out).toContain('"c":1');
});

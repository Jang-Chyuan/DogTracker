
import assert from 'node:assert/strict';
import { clearLabelOverlap, placeDogLabel, lineHitsBox, labelLineEnd, linesCross, spreadDogIcons } from '../src/map/DogLabelLayout';

test('nearby icons separate without modifying true positions; separated icons stay put', () => {
  const points = Array.from({ length: 8 }, (_, i) => ({ x: 200 + i, y: 200 + i }));
  const saved = JSON.stringify(points), display = spreadDogIcons(points);
  assert.equal(JSON.stringify(points), saved);
  for (let i = 0; i < display.length; i++) for (let j = i + 1; j < display.length; j++) {
    assert.ok(Math.abs(display[i].x - display[j].x) >= 44 || Math.abs(display[i].y - display[j].y) >= 44);
    assert.equal(linesCross(points[i], display[i], points[j], display[j]), false);
  }
  const separate = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  assert.deepEqual(spreadDogIcons(separate), separate);
});

test('crossing and overlapping connectors are rejected; shared origins are allowed', () => {
  assert.equal(linesCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }), true);
  assert.equal(linesCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 }), true);
  assert.equal(linesCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }), false);
});

test('nearby dog positions get labels with mutually noncrossing connectors', () => {
  const points = [{ x: 200, y: 180 }, { x: 195, y: 200 }, { x: 205, y: 220 }, { x: 210, y: 205 }];
  const icons = points.map(p => ({ left: p.x - 19, right: p.x + 19, top: p.y - 19, bottom: p.y + 19 }));
  const placed = [], lines = [];
  for (const point of points) {
    const box = placeDogLabel(point, 65, 30, placed, icons, { left: 0, top: 0, right: 400, bottom: 400 }, lines);
    const end = labelLineEnd(point, box);
    for (const line of lines) assert.equal(linesCross(point, end, line.start, line.end), false);
    placed.push(box); lines.push({ start: point, end });
  }
});

test('clustered labels choose angles without obscuring any connector', () => {
  const point = { x: 200, y: 200 }, placed = [];
  const icons = [{ left: 181, right: 219, top: 181, bottom: 219 }];
  const bounds = { left: 0, top: 0, right: 400, bottom: 400 };
  const lines = [];
  for (let i = 0; i < 6; i++) {
    const box = placeDogLabel(point, 60, 28, placed, icons, bounds, lines);
    placed.push(box); lines.push({ start: point, end: labelLineEnd(point, box) });
  }
  assert.ok(placed.some(box => Math.abs(Math.sin(box.angle) * Math.cos(box.angle)) > 0.1));
  for (let i = 0; i < lines.length; i++) for (let j = 0; j < placed.length; j++) {
    if (i !== j) assert.equal(lineHitsBox(lines[i].start, lines[i].end, placed[j]), false);
  }
});

test('browser DOMRect prototype getters are used for collision detection', () => {
  class BrowserRect {
    get left() { return 10; }
    get right() { return 110; }
    get top() { return 200; }
    get bottom() { return 225; }
  }
  assert.equal(clearLabelOverlap(new BrowserRect(),
    [{ left: 10, right: 110, top: 200, bottom: 225 }]), -31);
});

test('nearby and identical dog labels clear every previously placed label', () => {
  const placed = [];
  for (let i = 0; i < 8; i++) {
    const rect = { left: i % 2 * 10, right: 120 + i % 2 * 10, top: 200, bottom: 225 };
    const shift = clearLabelOverlap(rect, placed);
    const box = { ...rect, top: rect.top + shift, bottom: rect.bottom + shift };
    for (const other of placed) assert.ok(box.bottom + 6 <= other.top);
    placed.push(box);
  }
});

test('separated labels keep their original positions', () => {
  assert.equal(clearLabelOverlap({ left: 200, right: 300, top: 10, bottom: 30 },
    [{ left: 0, right: 100, top: 10, bottom: 30 }]), 0);
});

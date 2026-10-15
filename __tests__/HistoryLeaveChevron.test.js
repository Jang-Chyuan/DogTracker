// 2026-10-14 (user, after #163): the leave chevron read as one symbol with
// the stay's node (the hollow start circle, a numbered stay). It is part of
// the LINE leaving the stay: a gap under the node, a short stretch of the
// movement row's own line (dots on foot, solid by car), the chevron, then the
// line again down to the movement icon; the small departure time is level
// with the chevron. And the track draws only whole dots, none cut by a row's
// edge, a node, the chevron or a movement icon (as the PNG's trackOps).
// Invented days near Taoyuan station only.
import React from 'react';
import Renderer from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import HistoryTimelineList, { placeTrack, trackMarks } from '../src/mapHistory/HistoryTimelineList';
import { AddressLookupContext } from '../src/placement/AddressLookup';
import { size as sizes, type } from '../src/theme/tokens';
import { LEAVE_SHAPE } from '../src/map/LeaveGeometry';
import { exportTimelineRows } from '../src/mapHistory/ExportSnapshot';
import { layoutRow } from '../src/mapHistory/ExportPNG';
import { pngDrawPages } from '../src/mapHistory/ExportDraw';

const MINUTE = 60000;
const dayStart = new Date(2026, 9, 13).getTime();
const { dot, dotGap, leaveGap } = sizes.timeline;

// Invented rows: stay (the start circle) → walk → 停留 1 → drive → 停留 2 →
// walk → stay (the end circle), near Taoyuan station.
const at = (i, extra) => ({ latitude: 24.9892 + i * 0.001, longitude: 121.3138, ...extra });
const stay = (i, start, end, number = null) => at(i, { type: 'stop', number, start, end, durationMs: end - start });
const move = (mode, start, end) => ({ type: 'movement', mode, start, end, durationMs: end - start, distanceM: 900, countedDistanceM: 900 });
const t0 = dayStart + 8 * 60 * MINUTE, m = n => t0 + n * MINUTE;
const NODES = [stay(0, m(0), m(20)), move('walking', m(20), m(30)), stay(1, m(30), m(45), 1), move('driving', m(45), m(53)),
  stay(2, m(53), m(68), 2), move('walking', m(68), m(78)), stay(3, m(78), m(98))];
const model = () => ({ nodes: NODES });

const overlaps = (a, b) => a.top < b.bottom && b.top < a.top + a.height;

describe('trackMarks: whole marks only', () => {
  test.each([[56], [57.3], [31], [100]])('dots in a %sdp row: whole, 7dp apart, inside the row', height => {
    const marks = trackMarks('dots', height);
    expect(marks.length).toBeGreaterThan(0);
    marks.forEach(mark => {
      expect(mark.height).toBe(dot);
      expect(mark.top).toBeGreaterThanOrEqual(dotGap / 2 - 1e-9);
      expect(mark.top + mark.height).toBeLessThanOrEqual(height - dotGap / 2 + 1e-9);
    });
    marks.slice(1).forEach((mark, i) => expect(mark.top - marks[i].top).toBeCloseTo(dot + dotGap));
  });

  test('no dot or dash inside a cleared stretch (the movement icon, a node, the chevron)', () => {
    const clears = [{ top: 0, bottom: 26 }, { top: 39, bottom: 56 }, { top: 70, bottom: 80 }];
    for (const kind of ['dots', 'gap']) {
      const marks = trackMarks(kind, 120, clears);
      expect(marks.length).toBeGreaterThan(2);
      marks.forEach(mark => clears.forEach(clear => expect(overlaps(mark, clear)).toBe(false)));
    }
    // A solid line runs right up to each cleared stretch and on after it.
    expect(trackMarks('solid', 120, clears)).toEqual([
      { top: 26, height: 13 }, { top: 56, height: 14 }, { top: 80, height: 40, toEnd: true }]);
  });

  test('nothing before the row is measured, and nothing for no line', () => {
    expect(trackMarks('dots', 0)).toEqual([]);
    expect(trackMarks(null, 80)).toEqual([]);
  });
});

describe('placeTrack: the chevron on the line, apart from the node', () => {
  const firstLine = type.cardTitle.lineHeight;
  const nodeBottom = firstLine / 2 + sizes.timeline.node.stop / 2;
  const track = placeTrack(firstLine, true);
  const [nodeClear, chevronClear] = track.clears;

  test('a gap under the node, then the line, then the chevron with a gap around it', () => {
    expect(nodeClear.bottom - nodeBottom).toBe(leaveGap);
    expect(track.chevron.top - chevronClear.top).toBe(leaveGap);
    expect(chevronClear.bottom - (track.chevron.top + track.chevron.height)).toBe(leaveGap);
    // The chevron is about 12–14dp wide and its drawn shape fills the chevron box.
    const width = (sizes.timeline.leave * 19) / 24;
    expect(width).toBeGreaterThanOrEqual(12);
    expect(width).toBeLessThanOrEqual(14);
    expect(track.glyphTop + (sizes.timeline.leave * LEAVE_SHAPE.from) / 24).toBeCloseTo(track.chevron.top);
  });

  test.each(['dots', 'solid'])('%s: line above and below the chevron, none through it or the node', kind => {
    const marks = trackMarks(kind, track.minHeight, track.clears);
    const chevronTop = track.chevron.top, chevronBottom = chevronTop + track.chevron.height;
    const above = marks.filter(mark => mark.top + mark.height <= chevronTop);
    const below = marks.filter(mark => mark.top >= chevronBottom);
    expect(above.length + below.length).toBe(marks.length);
    if (kind === 'dots') expect(above.length).toBeGreaterThanOrEqual(2);
    else expect(above[0].height).toBeGreaterThanOrEqual(10);
    expect(below.length).toBeGreaterThanOrEqual(1);
    marks.forEach(mark => expect(mark.top).toBeGreaterThanOrEqual(nodeBottom + leaveGap));
  });

  test('a row that does not leave: the line starts a gap under the node, no chevron', () => {
    const plain = placeTrack(firstLine, false);
    expect(plain.clears).toEqual([{ top: 0, bottom: nodeBottom + leaveGap }]);
    expect(plain.chevron).toBeNull();
    expect(plain.minHeight).toBe(0);
  });
});

test('on screen: chevrons on the line, the departure time level with each, whole dots after layout', async () => {
  const lookup = { lookup: () => null, subscribe: () => () => {} };
  let renderer;
  await Renderer.act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
    <HistoryTimelineList model={model()} color="#1A73E8" />
  </AddressLookupContext.Provider>); });
  const host = id => renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
  const style = node => StyleSheet.flatten(node.props.style) || {};
  const chevrons = host('leave-chevron');
  const times = host('leave-time-box');
  expect(chevrons).toHaveLength(3);
  expect(times).toHaveLength(3);
  // The node's first line (the address's, with the system font scale).
  const expected = placeTrack(style(host('place-node-first-line')[0]).height, true);
  chevrons.forEach((chevron, i) => {
    expect(style(chevron).top).toBeCloseTo(expected.glyphTop);
    // The time is centred on the chevron's drawn shape.
    const box = style(times[i]);
    expect(box.justifyContent).toBe('center');
    expect(box.top + box.height / 2).toBeCloseTo(expected.chevron.top + expected.chevron.height / 2);
  });
  // Lay the tracks out: whole marks only, clear of the chevron.
  const tracks = host('track-line');
  // Under the three stays that are left, and in the three movement rows.
  expect(tracks).toHaveLength(6);
  await Renderer.act(async () => tracks.forEach(track => track.props.onLayout({ nativeEvent: { layout: { height: 80 } } })));
  host('track-line').forEach(track => {
    expect(track.children.length).toBeGreaterThan(0);
    track.children.forEach(mark => {
      const { top, height = 80 - top } = style(mark);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + height).toBeLessThanOrEqual(80);
    });
  });
  await Renderer.act(async () => renderer.unmount());
});

describe('PNG: the chevron on the line, as on screen', () => {
  const rows = exportTimelineRows(model().nodes, () => '虛構地址');
  const measure = (text, size) => String(text).length * size;
  let y = 0;
  const blocks = rows.map(row => {
    const laid = layoutRow(row, measure);
    const block = { type: 'row', row, ...laid, color: '#123456', y };
    y += laid.height;
    return block;
  });
  const page = { width: 1080, height: y + 40, titleLines: [], subtitleLines: [], legend: [], blocks,
    footer: { page: '1', y, height: 40 } };
  const ops = pngDrawPages({ pages: [page] })[0].ops;
  const chevrons = ops.filter(op => op.t === 'icon' && op.name === 'leave');
  const scale = size => [size * LEAVE_SHAPE.from / 24, size * LEAVE_SHAPE.to / 24];
  const pad = 12;

  test('every leaving stay has its chevron, line above and below, none through it', () => {
    expect(chevrons).toHaveLength(rows.filter(row => row.leave).length);
    expect(chevrons.length).toBe(3);
    chevrons.forEach(chevron => {
      const [inTop, inBottom] = scale(chevron.size);
      const top = chevron.y + inTop, bottom = chevron.y + inBottom;
      const cx = chevron.x + chevron.size / 2;
      const track = ops.filter(op => (op.t === 'circle' && op.cx === cx && op.r < 10) || (op.t === 'line' && op.x1 === cx));
      const span = op => (op.t === 'circle' ? [op.cy - op.r, op.cy + op.r] : [op.y1, op.y2]);
      track.forEach(op => { const [a, b] = span(op); expect(b <= top - pad + 0.5 || a >= bottom + pad - 0.5).toBe(true); });
      const near = 60;
      expect(track.some(op => span(op)[1] <= top && span(op)[1] > top - pad - near)).toBe(true);
      expect(track.some(op => span(op)[0] >= bottom && span(op)[0] < bottom + pad + near)).toBe(true);
    });
  });

  test('a gap and the line between the node and the chevron; the departure time level with it', () => {
    blocks.filter(block => block.row.leave).forEach(block => {
      const rowOps = ops.filter(op => op.t === 'circle' && op.r >= 10 && op.cy >= block.y && op.cy < block.y + block.height);
      const node = rowOps[0];
      const chevron = chevrons.find(op => op.y > node.cy && op.y < block.y + block.height);
      const [inTop, inBottom] = scale(chevron.size);
      const chevronTop = chevron.y + inTop;
      const between = ops.filter(op => op.cx === node.cx && op.r < 10 && op.cy > node.cy && op.cy < chevronTop);
      if (block.row.line === 'dots') expect(between.length).toBeGreaterThanOrEqual(2);
      between.forEach(dotOp => expect(dotOp.cy - dotOp.r).toBeGreaterThanOrEqual(node.cy + node.r + pad - 0.5));
      const time = ops.find(op => op.t === 'text' && op.text === block.row.leaveTime && op.y > node.cy);
      expect(time.y + time.h / 2).toBeCloseTo(chevron.y + (inTop + inBottom) / 2);
      // The chevron stays inside its row.
      expect(chevron.y + inBottom + pad).toBeLessThanOrEqual(block.y + block.height);
    });
  });
});

// 2026-10-15 (user, layout A): the chevron says "set off from here" — it
// and its time always come after the place's whole block (address lines,
// then the pill), never beside the pill or a wrapped address line.
describe('layout A: the chevron below the place block', () => {
  const firstLine = type.cardTitle.lineHeight;
  test('placeTrack: after the block\'s last line, however tall; unchanged when the block is short', () => {
    const short = placeTrack(firstLine, true, 20);
    expect(short).toEqual(placeTrack(firstLine, true));
    for (const bottom of [44, 66, 130]) {
      const track = placeTrack(firstLine, true, bottom);
      expect(track.chevron.top).toBeGreaterThanOrEqual(bottom + leaveGap);
      // The text plus the spacer under it make room for the chevron; the
      // row's own minimum never depends on the measurement (no late growth).
      expect(bottom + track.spacer).toBeGreaterThan(track.chevron.top + track.chevron.height + leaveGap);
      expect(track.minHeight).toBe(placeTrack(firstLine, true).minHeight);
      // The line between the node and the chevron is not cleared.
      expect(track.clears[1].top).toBe(track.chevron.top - leaveGap);
    }
  });

  test('on screen: once the place block is laid out, the chevron and its time move below it', async () => {
    const lookup = { lookup: () => '虛構地址很長很長的一段路名一百二十八巷六十四弄三十二號', subscribe: () => () => {} };
    let renderer;
    await Renderer.act(async () => { renderer = Renderer.create(<AddressLookupContext.Provider value={lookup}>
      <HistoryTimelineList model={model()} color="#1A73E8" />
    </AddressLookupContext.Provider>); });
    const host = id => renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === id);
    const style = node => StyleSheet.flatten(node.props.style) || {};
    // The first leaving stay: a two-line address and its pill, 70dp tall.
    const content = host('place-content').find(node => node.props.onLayout);
    await Renderer.act(async () => content.props.onLayout({ nativeEvent: { layout: { x: 0, y: 4, width: 300, height: 70 } } }));
    const chevron = host('leave-chevron')[0], time = host('leave-time-box')[0];
    const shapeTop = style(chevron).top + (sizes.timeline.leave * LEAVE_SHAPE.from) / 24;
    expect(shapeTop).toBeGreaterThanOrEqual(70 + leaveGap - 1e-9);
    // The time's text (centred in its box) starts below the block too.
    const box = style(time);
    expect(box.top + box.height / 2 - type.caption.lineHeight / 2).toBeGreaterThanOrEqual(70 - 1e-9);
    await Renderer.act(async () => renderer.unmount());
  });

  test('PNG: after the address lines and the pill, one or two address lines', () => {
    const measure = (text, size) => String(text).length * size;
    for (const title of ['虛構地址', '虛構地址很長很長的一段路名一百二十八巷六十四弄三十二號附近再長一點']) {
      const rows = exportTimelineRows(model().nodes, () => title);
      let y = 0;
      const blocks = rows.map(row => { const laid = layoutRow(row, measure); const block = { type: 'row', row, ...laid, color: '#123456', y }; y += laid.height; return block; });
      const ops = pngDrawPages({ pages: [{ width: 1080, height: y + 40, titleLines: [], subtitleLines: [], legend: [], blocks,
        footer: { page: '1', y, height: 40 } }] })[0].ops;
      const leaving = blocks.filter(block => block.row.leave);
      expect(leaving.length).toBe(3);
      for (const block of leaving) {
        const chevron = ops.find(op => op.t === 'icon' && op.name === 'leave' && op.y > block.y && op.y < block.y + block.height);
        const shapeTop = chevron.y + (chevron.size * LEAVE_SHAPE.from) / 24;
        const pill = ops.filter(op => op.t === 'rect' && op.y >= block.y && op.y < block.y + block.height).pop();
        expect(pill).toBeDefined();
        expect(shapeTop).toBeGreaterThanOrEqual(pill.y + pill.h + 12 - 0.5);
        const time = ops.find(op => op.t === 'text' && op.text === block.row.leaveTime && op.y > block.y);
        expect(time.y).toBeGreaterThanOrEqual(pill.y + pill.h);
        expect(shapeTop + chevron.size).toBeLessThanOrEqual(block.y + block.height);
      }
    }
  });
});

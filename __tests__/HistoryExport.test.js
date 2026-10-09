// 056: the export of the history screen (H9/H10) — the snapshot of the day
// shown, the PNG pages and their drawing operations, the files and the
// export window's states (產生中, 取消, 匯出失敗, 重試 with the same data).
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { multiDayModel } from '../src/history/screen/HistoryMultiModel';
import { dogHistoryRow, phoneHistoryRow } from '../src/history/HistoryRows';
import { buildExportSnapshot, exportPlaces, placeKey, vehicleTrips } from '../src/mapHistory/ExportSnapshot';
import { buildPNGLayout, layoutRow, wrap, defaultMeasure } from '../src/mapHistory/ExportPNG';
import { pngDrawPages, measuredCharacters, widthMeasure, EXPORT_ICONS } from '../src/mapHistory/ExportDraw';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { buildCSV, CSV_COLUMNS } from '../src/mapHistory/ExportCSV';
import { buildExportFilename } from '../src/mapHistory/ExportFiles';
import { cleanExports, makeExportFiles, useHistoryExport } from '../src/mapHistory/useHistoryExport';
import { AddressLookupContext } from '../src/placement/AddressLookup';
import { colors, routeColors } from '../src/theme/tokens';
import { withAlpha } from '../src/history/screen/HistoryMapModel';

const MINUTE = 60000, SECOND = 1000;
const DAY = new Date(2026, 9, 3).getTime();
const at = minutes => DAY + 8 * 60 * MINUTE + minutes * MINUTE;
const options = { dayStart: DAY, dayEnd: DAY + 86400000, today: false, now: at(400), source: 'all' };

// A day as legs, a fix every 10 s: { walk, speed }, { stay }, { drive, speed }, { gap }.
function legs(list, { from = 0, north = 0, east = 0 } = {}) {
  const out = [];
  let t = at(from) , y = north, x = east, index = 0;
  for (const leg of list) {
    const minutes = leg.walk ?? leg.stay ?? leg.drive ?? leg.gap;
    const until = t + minutes * MINUTE;
    if (leg.gap != null) { t = until; continue; }
    const speed = leg.walk != null ? leg.speed ?? 1 : leg.drive != null ? leg.speed ?? 12 : 0;
    for (; t < until; t += 10 * SECOND, index += 1) {
      y += speed * 10 * 0.8; x += speed * 10 * 0.6;
      const wobble = leg.stay != null ? ((index % 5) - 2) * 1.2 : 0;
      out.push({ time: t, latitude: 24.99 + (y + wobble) / 110540, longitude: 121.31 + x / 101000 });
    }
  }
  return out;
}
const dogRows = (slave, path, source = 'local') => path.map((p, i) => dogHistoryRow({ id: i + 1, slave_id: slave,
  master_id: 7, received_at: p.time, track_at: p.time, slave_lat: p.latitude, slave_lon: p.longitude, satellites: 9,
  hdop: 0.9, rssi: -70, snr: 8, speed_kmh: 3 }, source));
const noHolds = packets => packets;
const DOG_DAY = [{ stay: 10 }, { walk: 20 }, { stay: 15 }, { walk: 8 }, { drive: 4, speed: 12 }, { walk: 10 },
  { gap: 12 }, { walk: 15 }];

function dayOf(subjects, extra = {}) {
  return multiDayModel(subjects.map(([id, rows]) => ({ id, rows, replayHolds: noHolds, subject: extra.subject })),
    { ...options, protagonist: subjects[0][0], rangeOwner: subjects[0][0], ...extra });
}
const look = { 6: { color: routeColors[0], name: '小黑' }, 4: { color: routeColors[1], name: '豆豆' },
  8: { color: routeColors[2], name: '阿福' }, phone: { color: colors.phone, name: '我的路線' } };

describe('the snapshot of the day shown', () => {
  const day = dayOf([[6, dogRows(6, legs(DOG_DAY))]]);
  const model = day.subjects[0].model;
  const snapshot = buildExportSnapshot({ day, range: day.range, subject: 'dog', look,
    addresses: { [placeKey(exportPlaces(model)[0])]: '桃園區中正路 50 號附近' } });
  const subject = snapshot.subjects[0];

  test('the range and the dog: since the range start, until the last packet (never 「現在」)', () => {
    expect(snapshot.since).toBe(day.range.start);
    expect(snapshot.until).toBe(model.points[model.points.length - 1].time);
    expect(subject).toMatchObject({ kind: 'dog', slaveId: 6, name: '小黑', routeColor: routeColors[0] });
    expect(subject.distanceKm).toMatch(/^\d+\.\d km$/);
    expect(Object.isFrozen(snapshot.subjects[0].timeline)).toBe(true);
  });

  test('stays, the ride and the break come from the list, numbered as on screen', () => {
    const numbered = model.nodes.filter(n => n.type === 'stop').map(n => n.number);
    expect(subject.stays.map(s => s.number)).toEqual(numbered);
    expect(subject.rides).toHaveLength(model.nodes.filter(n => n.type === 'movement' && n.mode === 'ride').length);
    expect(subject.gaps).toHaveLength(1);
    expect(subject.timeline.map(row => row.kind === 'section' ? row.lead : row.type))
      .toEqual(model.nodes.map(n => (n.type === 'movement' || n.type === 'gap' ? expect.any(String) : n.type)));
  });

  test('list rows: an address found is the title; otherwise coordinates above the pill; the end says 結束', () => {
    const places = subject.timeline.filter(row => row.kind === 'place');
    expect(places[0]).toMatchObject({ title: '桃園區中正路 50 號附近', missing: '' });
    expect(places[1].title).toMatch(/^\d+\.\d{4}, \d+\.\d{4}$/);
    expect(places[1]).toMatchObject({ missing: '', coordinates: '' });
    expect(places[places.length - 1].pill.text).toBe('結束');
    expect(JSON.stringify(subject.timeline)).not.toContain('現在');
  });

  test('the map layer: the whole route at full strength, its numbers and every time marker', () => {
    expect(subject.map.lines.length).toBeGreaterThan(1);
    expect(subject.map.lines.some(line => line.vehicle)).toBe(true);
    expect(subject.map.places.filter(p => p.kind === 'number').map(p => p.number))
      .toEqual(model.nodes.filter(n => n.type === 'stop' || n.type === 'switch').map(n => n.number));
    expect(subject.map.times[0].end).toBe(true);
  });
});

describe('several dogs', () => {
  const day = dayOf([[6, dogRows(6, legs(DOG_DAY))], [4, dogRows(4, legs([{ walk: 30 }, { stay: 20 }, { walk: 20 }],
    { from: 5, east: 300 }))], [8, dogRows(8, legs([{ walk: 20 }], { from: -300 }))]]);
  const snapshot = buildExportSnapshot({ day, range: day.range, subject: 'dog', look });

  test('a dog without a packet in the range is left out of the title, legend, list and files', () => {
    const layout = buildPNGLayout(snapshot);
    expect(layout.pages[0].title).toBe('DogTracker・狗的歷史（2 隻）');
    expect(layout.pages[0].legend.map(item => item.name)).toEqual(['小黑', '豆豆']);
    expect(buildGPX(snapshot)).not.toContain('阿福');
    expect(buildCSV(snapshot)).not.toContain('"dog-8"');
    expect(buildExportFilename(snapshot, 'png')).toMatch(/^DogTracker_狗的歷史_20261003-\d{4}_20261003-\d{4}\.png$/);
  });

  test('only the ends get times on the map; every page keeps title, legend and page number', () => {
    const layout = buildPNGLayout(snapshot);
    const map = layout.pages[0].blocks.find(block => block.type === 'map');
    expect(map.subjects).toHaveLength(2);
    map.subjects.forEach(subject => expect(subject.times.every(t => t.end)).toBe(true));
    layout.pages.forEach((page, index) => {
      expect(page.height).toBeLessThanOrEqual(2400);
      expect(page.footer.page).toBe(`${index + 1}/${layout.pages.length}`);
      expect(page.legend).toHaveLength(2);
    });
    const sections = layout.pages.flatMap(page => page.blocks.filter(b => b.type === 'section')).map(b => b.title);
    expect(sections.filter(title => !title.endsWith('（續）'))).toEqual(['小黑', '豆豆']);
    // A dog cut by a new page goes on with 「（續）」 at the top of the next one.
    layout.pages.slice(1).forEach(page => {
      const first = page.blocks[0];
      expect(first.type).toBe('section');
    });
  });

  test('CSV rows of both dogs in time order, then by slave_id; 24 columns', () => {
    const lines = buildCSV(snapshot).split('\r\n').filter(Boolean).slice(1);
    const cells = lines.map(line => line.slice(1, -1).split('","'));
    cells.forEach(row => expect(row).toHaveLength(CSV_COLUMNS.length));
    const keys = cells.map(row => [Date.parse(row[2]), Number(row[19])]);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i][0] > keys[i - 1][0] || (keys[i][0] === keys[i - 1][0] && keys[i][1] >= keys[i - 1][1])).toBe(true);
    }
  });
});

describe('the files', () => {
  const day = dayOf([[6, dogRows(6, legs(DOG_DAY))]]);
  const snapshot = buildExportSnapshot({ day, range: day.range, subject: 'dog', look });

  test('GPX: balanced XML, UTC times, the dog track, one ride track, stay waypoints', () => {
    const gpx = buildGPX(snapshot);
    const tags = [...gpx.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)].filter(m => m[2] !== 'xml');
    const stack = [];
    for (const [, close, name, self] of tags) {
      if (self) continue;
      if (close) expect(stack.pop()).toBe(name); else stack.push(name);
    }
    expect(stack).toEqual([]);
    [...gpx.matchAll(/<time>([^<]+)<\/time>/g)].forEach(m => expect(m[1]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/));
    expect(gpx).toContain('<name>小黑-6</name>');
    expect(gpx).toContain('<name>小黑-6 坐車 1（不算距離）</name><type>drive</type>');
    expect(gpx).toMatch(/<name>小黑-6 停留 1・\d+ 分<\/name>/);
  });

  test('my route: GPX and CSV keep the recorded route (not raw_*) in latitude/longitude, raw_* in their own columns', () => {
    const path = legs([{ walk: 20 }, { stay: 15 }, { walk: 10 }]);
    const rows = path.map((p, i) => phoneHistoryRow({ id: i + 1, recorded_at: p.time, location_at: p.time - 400,
      latitude: p.latitude, longitude: p.longitude, accuracy_meters: 5, raw_latitude: p.latitude + 0.001,
      raw_longitude: p.longitude, session_id: 's1' }));
    const phoneDay = dayOf([['phone', rows]], { subject: 'phone' });
    const data = buildExportSnapshot({ day: phoneDay, range: phoneDay.range, subject: 'phone', look });
    const gpx = buildGPX(data), csv = buildCSV(data);
    expect(gpx).toContain('<name>我的路線</name>');
    expect(gpx).toContain(`lat="${path[0].latitude}"`);
    const first = csv.split('\r\n')[1].slice(1, -1).split('","');
    expect(first[0]).toBe('phone');
    expect(Number(first[4])).toBe(path[0].latitude);
    expect(Number(first[10])).toBeCloseTo(path[0].latitude + 0.001, 9);
    expect(first.slice(18)).toEqual(['', '', '', '', '', '']);
    expect(buildExportFilename(data, 'gpx')).toMatch(/^DogTracker_我的路線_/);
    expect(buildPNGLayout(data).pages[0].subtitle).toMatch(/・走了 \d+\.\d km$/);
  });

  test('PNG ops use theme colours only', () => {
    const pages = pngDrawPages(buildPNGLayout(snapshot));
    const allowed = new Set([...Object.values(colors), ...routeColors, withAlpha(routeColors[0], 0.12),
      withAlpha(routeColors[0], 0.33)]);
    const seen = new Set();
    const walk = value => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
        if (typeof item === 'string' && /^(#|rgba)/.test(item)) seen.add(item);
        walk(item);
      });
    };
    walk(pages);
    expect([...seen].filter(colour => !allowed.has(colour))).toEqual([]);
    expect(pages[0].ops.find(op => op.t === 'map').northColor).toBe(colors.critLine);
  });

  test('a very long address is cut after 2 lines only when the row would not fit a page', () => {
    const long = { kind: 'place', type: 'stop', times: ['08:00', '08:20'], title: '很長的地址'.repeat(400),
      coordinates: '24.9900, 121.3100', missing: '', pill: { text: '停 20 分', tone: 'stay' }, note: '' };
    const full = layoutRow(long, defaultMeasure);
    expect(full.titleLines.length).toBeGreaterThan(2);
    const cut = layoutRow(long, defaultMeasure, { truncate: true });
    expect(cut.titleLines).toHaveLength(2);
    expect(cut.titleLines[1].endsWith('…')).toBe(true);
    expect(wrap('八德區介壽路二段 1132 號附近', 40, 400, defaultMeasure).join('|')).toContain('1132');
  });

  test('font widths: every character measured, scaled by size', () => {
    const chars = measuredCharacters(snapshot);
    expect(chars).toContain('停');
    const measure = widthMeasure({ regular: { a: 50 }, bold: { a: 60 } });
    expect(measure('aa', 30)).toBe(30);
    expect(measure('a', 100, true)).toBe(60);
    expect(EXPORT_ICONS.paw.stroke).toMatch(/^M/);
  });
});

// A stand-in for the native exporter.
function fakeExporter(overrides = {}) {
  const calls = { writeText: [], renderPng: [], share: [], cancel: [], removeExports: [] };
  const exporter = {
    calls,
    charWidths: async chars => ({ regular: Object.fromEntries(Array.from(chars).map(c => [c, 60])),
      bold: Object.fromEntries(Array.from(chars).map(c => [c, 64])) }),
    writeText: async (directory, filename, text) => { calls.writeText.push({ directory, filename, text }); return `/cache/${directory}/${filename}`; },
    renderPng: async (id, directory, pages) => { calls.renderPng.push({ id, directory, pages }); return pages.map(p => `/cache/${directory}/${p.filename}`); },
    share: async (paths, mime) => { calls.share.push({ paths, mime }); return 'opened'; },
    cancel: id => calls.cancel.push(id),
    listExports: async () => [{ directory: 'history_exports/old', createdAt: DAY - 86400000 },
      { directory: 'history_exports/today', createdAt: DAY + 1000 }],
    removeExports: async dirs => { calls.removeExports.push(dirs); },
    ...overrides,
  };
  return exporter;
}

describe('making the files', () => {
  const day = dayOf([[6, dogRows(6, legs(DOG_DAY))]]);
  const snapshot = buildExportSnapshot({ day, range: day.range, subject: 'dog', look });

  test('CSV and GPX are one text file each under history_exports/<id>; PNG pages named _1, _2 when several', async () => {
    const exporter = fakeExporter();
    const [csv] = await makeExportFiles(snapshot, 'csv', exporter, { exportId: 'e1', createdAt: DAY });
    expect(csv).toMatch(/^\/cache\/history_exports\/e1\/DogTracker_小黑-6_20261003-\d{4}_20261003-\d{4}\.csv$/);
    expect(exporter.calls.writeText[0].text.startsWith('\uFEFF' + CSV_COLUMNS.join(','))).toBe(true);
    const paths = await makeExportFiles(snapshot, 'png', exporter, { exportId: 'e2', createdAt: DAY });
    const pages = exporter.calls.renderPng[0].pages;
    expect(paths).toHaveLength(pages.length);
    if (pages.length > 1) expect(pages[0].filename).toMatch(/_1\.png$/);
    else expect(pages[0].filename).toMatch(/\d{4}\.png$/);
  });

  test('temporary exports from before today go, today\'s stay', async () => {
    const exporter = fakeExporter();
    await cleanExports(exporter, DAY + 5000);
    expect(exporter.calls.removeExports).toEqual([['history_exports/old']]);
  });
});

describe('the export window (useHistoryExport)', () => {
  const day = dayOf([[6, dogRows(6, legs(DOG_DAY))]]);
  const screen = { dayModel: day, range: day.range, subject: 'dog', look };
  let state;
  function Probe({ exporter, lookup }) {
    state = useHistoryExport({ screen, exporter, now: () => DAY + 5000 });
    return null;
  }
  const lookupOf = () => ({ lookupAddresses: jest.fn(async points => points.map(() => null)) });
  const mount = async props => {
    let renderer;
    await act(async () => {
      renderer = Renderer.create(<AddressLookupContext.Provider value={props.lookup}><Probe {...props} /></AddressLookupContext.Provider>);
    });
    return renderer;
  };

  test('a format chosen: 產生中, the files, then the share sheet; the window closes', async () => {
    const exporter = fakeExporter(), lookup = lookupOf();
    const renderer = await mount({ exporter, lookup });
    act(() => state.open());
    expect(state.phase).toBe('choose');
    let running;
    act(() => { running = state.start('gpx'); });
    expect(state.phase).toBe('generating');
    await act(async () => running);
    expect(lookup.lookupAddresses).toHaveBeenCalledWith(expect.any(Array), { timeoutMs: 5000 });
    expect(exporter.calls.share[0]).toMatchObject({ mime: 'application/gpx+xml' });
    expect(state.phase).toBe('closed');
    act(() => renderer.unmount());
  });

  test('匯出失敗, then 重試 makes the files from the same snapshot (no second lookup)', async () => {
    let fail = true;
    const exporter = fakeExporter();
    const real = exporter.writeText;
    exporter.writeText = async (...args) => { if (fail) throw new Error('disk'); return real(...args); };
    const lookup = lookupOf();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const renderer = await mount({ exporter, lookup });
    act(() => state.open());
    await act(async () => state.start('csv'));
    expect(state.phase).toBe('failed');
    fail = false;
    await act(async () => state.retry());
    expect(state.phase).toBe('closed');
    expect(lookup.lookupAddresses).toHaveBeenCalledTimes(1);
    expect(exporter.calls.share).toHaveLength(1);
    warn.mockRestore();
    act(() => renderer.unmount());
  });

  test('取消 (or the back key) while 產生中: the window closes, a late result never opens the share sheet', async () => {
    let finish;
    const exporter = fakeExporter({ renderPng: (id, directory, pages) => new Promise(resolve => {
      finish = () => resolve(pages.map(p => `/cache/${directory}/${p.filename}`));
    }) });
    const renderer = await mount({ exporter, lookup: lookupOf() });
    act(() => state.open());
    let running;
    await act(async () => { running = state.start('png'); await new Promise(r => setTimeout(r, 0)); });
    expect(state.phase).toBe('generating');
    act(() => { expect(state.back()).toBe(true); });
    expect(state.phase).toBe('closed');
    expect(exporter.calls.cancel).toHaveLength(1);
    await act(async () => { finish(); await running; });
    expect(exporter.calls.share).toHaveLength(0);
    expect(state.back()).toBe(false);
    act(() => renderer.unmount());
  });
});

describe('056 review fixes', () => {
  const minute = MINUTE;
  const fix = (t, extra = {}) => ({ time: t * minute, latitude: 25 + t / 1000, longitude: 121, ...extra });
  const one = extra => ({ since: 0, until: 60 * minute, timeZone: 'UTC',
    subjects: [{ kind: 'dog', name: '小黑', slaveId: 4, rows: [0, 1, 10, 11].map(t => fix(t)), ...extra }] });

  test('a break keeps the fixes at its ends and splits the segment', () => {
    const gpx = buildGPX(one({ gaps: [{ start: minute, end: 10 * minute }] }));
    expect((gpx.match(/<trkpt /g) || [])).toHaveLength(4);
    expect((gpx.match(/<trkseg>/g) || [])).toHaveLength(2);
  });

  test('one ride across 沒有資料 is one trk with two segments; a ride to the last fix keeps it', () => {
    const nodes = [{ type: 'movement', mode: 'ride', start: 0, end: minute }, { type: 'gap', start: minute, end: 10 * minute },
      { type: 'movement', mode: 'ride', start: 10 * minute, end: 11 * minute }];
    const trips = vehicleTrips(nodes, 11 * minute);
    expect(trips).toEqual([{ start: 0, end: 11 * minute + 1 }]);
    const gpx = buildGPX(one({ rides: trips, gaps: [{ start: minute, end: 10 * minute }] }));
    expect(gpx).toContain('小黑-4 坐車 1（不算距離）');
    expect(gpx).not.toContain('坐車 2');
    expect(gpx).not.toContain('<name>小黑-4</name>');
  });

  test('a long name puts the section times on their own line, inside the page', () => {
    const long = '很長的狗名字很長的狗名字很長的狗名字很長';
    const row = { kind: 'place', type: 'departure', times: ['00:00'], title: '地址', coordinates: '', missing: '', pill: null, note: '' };
    const data = { since: 0, until: 60 * minute, timeZone: 'UTC', subjects: [
      { kind: 'dog', name: long, slaveId: 4, distanceKm: '1.0 km', start: 0, end: minute, rows: [fix(0)], timeline: [row] },
      { kind: 'dog', name: '豆豆', slaveId: 5, distanceKm: '1.0 km', start: 0, end: minute, rows: [fix(0)], timeline: [row] }] };
    const sections = buildPNGLayout(data).pages.flatMap(p => p.blocks.filter(b => b.type === 'section'));
    expect(sections[0].oneLine).toBe(false);
    expect(sections[0].height).toBeGreaterThan(72);
    expect(sections[1].oneLine).toBe(true);
  });
});

describe('the PNG is light whatever the phone theme (深色模式「匯出的 PNG 一律用淺色」)', () => {
  const { Appearance } = require('react-native');
  const darkSpec = require('../src/theme/dark-tokens.json');
  const darkLook = { 6: { color: darkSpec.colors.route1, name: '小黑' },
    4: { color: darkSpec.colors.route2, name: '豆豆' }, phone: { color: darkSpec.colors.phone, name: '我的路線' } };

  test('a snapshot taken in dark mode draws light route colours at full strength, solid', () => {
    const spy = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    try {
      const day = dayOf([[6, dogRows(6, legs(DOG_DAY))], [4, dogRows(4, legs([{ walk: 30 }], { from: 5, east: 300 }))]]);
      const snapshot = buildExportSnapshot({ day, range: day.range, subject: 'dog', look: darkLook });
      expect(snapshot.subjects.map(s => s.routeColor)).toEqual([routeColors[0], routeColors[1]]);
      expect(snapshot.subjects[0].map.lines.every(line => !line.dashed)).toBe(true);
      const layout = buildPNGLayout(snapshot);
      const map = layout.pages[0].blocks.find(block => block.type === 'map');
      expect(map.subjects.map(s => s.color)).toEqual([routeColors[0], routeColors[1]]);
      expect(layout.pages[0].legend.map(item => item.color)).toEqual([routeColors[0], routeColors[1]]);
      const json = JSON.stringify(pngDrawPages(layout));
      for (const value of [darkSpec.colors.route1, darkSpec.colors.route2, darkSpec.darkOnly.elevated, darkSpec.colors.bg])
        expect(json.toUpperCase()).not.toContain(value.toUpperCase());
    } finally {
      spy.mockRestore();
    }
  });

  test('my route in dark mode exports the light phone blue', () => {
    const { exportRouteColor } = require('../src/theme/exportPalette');
    expect(exportRouteColor(darkSpec.colors.phone)).toBe(colors.phone);
    expect(exportRouteColor(colors.route3)).toBe(colors.route3);
    expect(exportRouteColor('#123456')).toBe('#123456');
  });
});


test('GPX merges fixes across packet times, prefers local coordinates and keeps different dogs', () => {
  const cloud = { source: 'cloud', slave_id: 4, time: at(0), locationTime: 'gps:777', latitude: 25, longitude: 121 };
  const local = { ...cloud, source: 'local', time: at(1), latitude: 25.1, distance_meters: 42 };
  const snapshot = { since: at(0), until: at(2), subjects: [{ kind: 'dog', slaveId: 4, name: '豆豆',
    rows: [cloud, local] }, { kind: 'dog', slaveId: 6, name: '小黑', rows: [{ ...cloud, slave_id: 6 }] }] };
  const gpx = buildGPX(snapshot);
  expect((gpx.match(/<trkpt /g) || []).length).toBe(2);
  expect(gpx).toContain('lat="25.1"');
  expect(gpx).toContain('小黑-6');
});

test('several dogs setting off together: crowded first/last times keep one label (060, #70)', () => {
  const { thinExportTimes } = require('../src/mapHistory/ExportSnapshot');
  const layer = (shift, start, end) => ({
    lines: [{ coordinates: [[24.989, 121.313 + shift], [25.0, 121.33 + shift]] }],
    points: [],
    places: [],
    times: [
      { label: start, end: true, time: 1, latitude: 24.989, longitude: 121.313 + shift },
      { label: end, end: true, time: 2, latitude: 25.0, longitude: 121.33 + shift },
    ],
  });
  // Two dogs leave the same kennel (a few metres apart) and end 1.5 km apart.
  const layers = thinExportTimes([layer(0, '08:00', '10:00'), layer(0.00005, '08:01', '10:05')]);
  expect(layers[0].times.map(t => t.label)).toEqual(['08:00', '10:00']);
  expect(layers[1].times.map(t => t.label)).toEqual(['', '']);
  // Far apart: everyone keeps their times.
  const apart = thinExportTimes([layer(0, '08:00', '10:00'), layer(0.05, '08:01', '10:05')]);
  expect(apart[1].times.map(t => t.label)).toEqual(['08:01', '10:05']);
});

test('thinning a full day of several dogs: 400 000 points, no argument-limit crash (060)', () => {
  const { thinExportTimes } = require('../src/mapHistory/ExportSnapshot');
  const coordinates = Array.from({ length: 200000 }, (_, i) => [24.98 + i * 1e-7, 121.3 + i * 1e-7]);
  const layer = shift => ({ lines: [{ coordinates }], points: [], places: [],
    times: [{ label: '08:00', end: true, time: 1, latitude: 24.98, longitude: 121.3 + shift }] });
  expect(() => thinExportTimes([layer(0), layer(0.01)])).not.toThrow();
});

import { phoneStayDisplayAnchors, phoneStayDisplayCoordinate } from '../src/history/PhoneStayDisplayAnchors';
import { HISTORY_CONFIG } from '../src/history/HistoryConfig';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { historyStops } from '../src/history/HistoryStops';
import * as stopsModule from '../src/history/HistoryStops';
import * as anchorModule from '../src/history/PhoneStayDisplayAnchors';
import { historyMapPresentation, timeMarkers } from '../src/history/screen/HistoryMapModel';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AddressLookupContext, usePlaceNames } from '../src/placement/AddressLookup';
import { buildExportSnapshot, exportPlaces, placeKey } from '../src/mapHistory/ExportSnapshot';
import { buildGPX } from '../src/mapHistory/ExportGPX';
import { buildCSV } from '../src/mapHistory/ExportCSV';

const config = HISTORY_CONFIG.phone;
const coordinate = metres => ({ latitude: 24.9892 + metres / 111320, longitude: 121.3132 });
const fix = (time, metres, extra = {}) => ({ time, ...coordinate(metres),
  raw_latitude: coordinate(metres).latitude, raw_longitude: coordinate(metres).longitude,
  accuracy: 5, raw_speed_kmh: 0, speed_accuracy_mps: 0.1, phoneStationary: true, ...extra });
const visit = (id, start, metres, extra = {}) => ({ id, type: 'stop', start, end: start + 60000,
  ...coordinate(metres), completed: true, durationMs: 60000,
  points: [0, 20000, 40000, 60000].map(dt => fix(start + dt, metres)), gaps: [], ...extra });
const scene = (positions = [0, 20], extras = []) => {
  const visits = positions.map((m, i) => visit(`visit:${i}`, i * 600000, m, extras[i]));
  const points = visits.flatMap(v => v.points);
  const edges = points.slice(1).map((to, i) => ({ from: points[i], to, start: points[i].time,
    end: to.time, countedDistanceM: 0, mode: 'walking' }));
  return { visits, points, edges };
};
const project = s => phoneStayDisplayAnchors(s.visits, s.points, s.edges, config);

test('confirmed same-place return shares one completed representative without mutating its evidence', () => {
  const s = scene(), before = JSON.stringify(s);
  const result = project(s);
  expect(result.get(s.visits[1].id)).toEqual(coordinate(0));
  expect(result.get(s.visits[1].id)).toBe(result.get(s.visits[0].id));
  expect(JSON.stringify(s)).toBe(before);
});

test.each([
  ['a genuine short 20m walk', s => { s.edges[4].countedDistanceM = 20; }],
  ['wrong-zero confirmed progress', s => { s.points[5].phoneConfirmedMovement = true; }],
  ['missing-speed confirmed progress', s => { s.points[5].raw_speed_kmh = null; s.points[5].phoneConfirmedMovement = true; }],
  ['a vehicle departure', s => { s.edges[4].mode = 'driving'; }],
  ['movement inside the prior visit', s => { s.edges[0].countedDistanceM = 1; }],
  ['late departure inside the next visit', s => { s.edges.at(-1).countedDistanceM = 1; }],
  ['an unfinished previous visit', s => { s.visits[0].completed = false; }],
  ['a prior visit clipped by midnight', s => { s.visits[0].continuesPreviousDay = true; }],
  ['a prior visit continuing beyond midnight', s => { s.visits[0].continuesNextDay = true; }],
  ['an unconfirmed return', s => { s.visits[1].points.forEach(p => { p.phoneStationary = false; }); }],
  ['a coarse return footprint', s => { s.visits[1].points.forEach(p => { p.accuracy = 80; }); }],
])('%s keeps nearby distinct places separate', (name, change) => {
  const s = scene(); change(s); expect(project(s).size).toBe(0);
});

test('a chain cannot extend the first anchor region through a nearby middle place', () => {
  const s = scene([0, 20, 40]);
  const result = project(s);
  expect(result.get(s.visits[1].id)).toEqual(coordinate(0));
  expect(result.has(s.visits[2].id)).toBe(false);
});

test('all confirmation observations must fit, rather than merely their centres', () => {
  const s = scene(); Object.assign(s.visits[1].points[3], fix(660000, 40));
  expect(project(s).size).toBe(0);
});

test('late completion enables a stable anchor; newly appended departure proof withdraws it', () => {
  const s = scene([], []);
  s.visits = [visit('a', 0, 0, { completed: false }), visit('b', 600000, 20)];
  s.points = s.visits.flatMap(v => v.points);
  s.edges = [];
  expect(project(s).size).toBe(0);
  s.visits[0].completed = true;
  expect(project(s).get('b')).toEqual(coordinate(0));
  const departure = fix(680000, 21, { phoneConfirmedMovement: true, phoneStationary: false });
  s.points.push(departure); s.visits[1].points.push(departure); s.visits[1].end = departure.time;
  expect(project(s).has('b')).toBe(false);
});

test('dog or disabled still-place configuration does not gain a phone anchor', () => {
  const s = scene();
  expect(phoneStayDisplayAnchors(s.visits, s.points, s.edges, HISTORY_CONFIG.dog).size).toBe(0);
});

test('production range clipping keeps the whole-day projected marker/address coordinate', () => {
  const rows = [0, 20000, 40000, 60000].map(t => fix(t, t / 4000));
  const projection = jest.spyOn(anchorModule, 'phoneStayDisplayAnchors').mockImplementation(visits =>
    new Map(visits.map(v => [v.id, coordinate(0)])));
  try {
    const model = historyTimeline(rows, { subject: 'phone', dayStart: 0, dayEnd: 86400000,
      range: { start: 40000, end: 60000 } });
    const wholeDayVisits = projection.mock.calls[0][0];
    expect(wholeDayVisits[0].start).toBe(0);
    expect(wholeDayVisits[0].end).toBe(60000);
    // Visits are the same coordinate source later numbered into list locations
    // and supplied to the address resolver; clipping cannot recompute the mean.
    expect(model.points[0].time).toBe(40000);
    expect(model.distanceM).toBe(0);
    const result = historyStops(rows, { subject: 'phone', start: 40000, end: 60000,
      dayStart: 0, dayEnd: 86400000, edges: [{ start: 0, end: 60000, countedDistanceM: 0 }] });
    expect(result.visits[0]).toMatchObject({ ...coordinate(0), start: 40000, end: 60000 });
    expect(result.visits[0].originalRepresentative.latitude).toBeCloseTo(coordinate(12.5).latitude, 12);
    expect(result.visits[0].points[0].latitude).toBe(coordinate(10).latitude);
  } finally { projection.mockRestore(); }
});

test('withdrawing an anchor invalidates native marker geometry, including in-place node mutation', () => {
  const s = scene(), anchors = project(s);
  const locations = s.visits.map((v, i) => ({ ...v, ...anchors.get(v.id), number: i + 1 }));
  const model = { points: [], dayPoints: [], locations, edges: [] };
  const before = historyMapPresentation(model, { color: '#123456', subject: 'phone' }).places;
  Object.assign(locations[1], coordinate(20));
  const after = historyMapPresentation(model, { color: '#123456', subject: 'phone' }).places;
  expect(after).not.toBe(before);
  expect(after[1].coordinate).toEqual(coordinate(20));
  expect(before[1].coordinate).toEqual(coordinate(0));
});

test('unconfirmed recovery visits cannot hide a real short walk between two confirmations', () => {
  const s = scene();
  const recovery = visit('unknown', 200000, 10);
  recovery.points.forEach(p => { p.phoneStationary = false; p.raw_speed_kmh = null; });
  s.visits.splice(1, 0, recovery);
  s.points = s.visits.flatMap(v => v.points);
  expect(project(s).get('visit:1')).toEqual(coordinate(0));
  recovery.points[1].phoneConfirmedMovement = true;
  expect(project(s).size).toBe(0);
});

test('partial context without the completed previous visit cannot invent a shared place', () => {
  const s = scene();
  s.visits.shift(); s.points = s.visits.flatMap(v => v.points); s.edges = [];
  expect(project(s).size).toBe(0);
});

test('an appended departure updates the history address coordinate key despite stable visit identity', () => {
  jest.useFakeTimers();
  const lookup = { lookup: jest.fn(p => String(p.latitude)), subscribe: () => () => {} };
  const s = scene(), shared = project(s);
  const node = { ...s.visits[1], ...shared.get(s.visits[1].id) };
  let names;
  function Probe({ places }) { names = usePlaceNames(places); return null; }
  let tree;
  try {
    act(() => { tree = Renderer.create(<AddressLookupContext.Provider value={lookup}>
      <Probe places={[node]} />
    </AddressLookupContext.Provider>); });
    expect(names[0].text).toBe(String(coordinate(0).latitude));
    lookup.lookup.mockClear();
    s.visits[1].completed = false;
    s.points.at(-1).phoneConfirmedMovement = true;
    expect(project(s).has(node.id)).toBe(false);
    Object.assign(node, coordinate(20));
    act(() => tree.update(<AddressLookupContext.Provider value={lookup}>
      <Probe places={[node]} />
    </AddressLookupContext.Provider>));
    expect(lookup.lookup).toHaveBeenCalledWith(expect.objectContaining(coordinate(20)));
    expect(names[0].text).toBe(String(coordinate(20).latitude));
  } finally { act(() => tree?.unmount()); jest.useRealTimers(); }
});

test('production GPX/CSV retain calculated coordinates while PNG chooses the shared display coordinate', () => {
  const s = scene();
  const original = s.visits.map((v, i) => ({ ...v, number: i + 1 }));
  const projected = original.map(n => ({ ...n, originalRepresentative: coordinate(n.number === 1 ? 0 : 20),
    ...coordinate(0) }));
  const base = { points: s.points, dayPoints: s.points, packets: s.points, edges: [],
    distanceM: 0, nodes: original, locations: original };
  const after = { ...base, nodes: projected, locations: projected };
  const range = { start: 0, end: 660000 };
  const addresses = { [placeKey(coordinate(0))]: '地點 A', [placeKey(coordinate(20))]: '地點 B' };
  const snapshot = model => buildExportSnapshot({ subject: 'phone', range, timeZone: 'UTC', addresses,
    day: { subjects: [{ id: 'phone', model }] } });
  const beforeExport = snapshot(base), afterExport = snapshot(after);
  expect(buildGPX(afterExport)).toBe(buildGPX(beforeExport));
  expect(buildCSV(afterExport)).toBe(buildCSV(beforeExport));
  expect(afterExport.subjects[0].stays[1]).toMatchObject({ ...coordinate(0),
    gpxCoordinate: coordinate(20), address: '地點 A', gpxAddress: '地點 B' });
  expect(afterExport.subjects[0].map.places[1]).toMatchObject(coordinate(0));
  expect(afterExport.subjects[0].timeline[1]).toMatchObject({ ...coordinate(0), title: '地點 A' });
  expect(exportPlaces(after).some(p => placeKey(p) === placeKey(coordinate(20)))).toBe(true);
});

test('shared stay cursor and endpoint use its place, while observations and drag times remain unchanged', () => {
  const s = scene(), before = JSON.stringify(s.points);
  const locations = s.visits.map((v, i) => ({ ...v, number: i + 1,
    originalRepresentative: coordinate(i * 20), ...coordinate(0) }));
  const point = s.points.at(-1);
  const model = { points: s.points, dayPoints: s.points, locations, edges: [] };
  const presentation = historyMapPresentation(model, { color: '#123456', subject: 'phone',
    cursor: { point, label: ['time', 'stay'] } });
  expect(presentation.cursor).toMatchObject({ time: point.time, coordinate: coordinate(0) });
  expect(presentation.points.at(-1)).toMatchObject({ time: point.time, ...coordinate(20) });
  expect(timeMarkers(s.points, { subject: 'phone', stays: locations }).at(-1).coordinate).toEqual(coordinate(0));
  expect(JSON.stringify(s.points)).toBe(before);
});

test('gap, dog cursor and movement keep their observed position', () => {
  const point = fix(620000, 20), locations = [{ ...visit('shared', 600000, 0), originalRepresentative: coordinate(20) }];
  const model = { points: [point], dayPoints: [point], locations, edges: [] };
  for (const options of [{ subject: 'phone', stale: true }, { subject: 'dog', stale: false }]) {
    const shown = historyMapPresentation(model, { color: '#123456', subject: options.subject,
      cursor: { point, stale: options.stale } });
    expect(shown.cursor.coordinate).toEqual(coordinate(20));
  }
  expect(phoneStayDisplayCoordinate(locations, 670000)).toBeNull();
  expect(phoneStayDisplayCoordinate([visit('ordinary', 600000, 0)], point.time)).toEqual(coordinate(0));
  expect(phoneStayDisplayCoordinate([{ ...locations[0], type: 'switch' }], point.time)).toBeNull();
  expect(phoneStayDisplayCoordinate([{ ...locations[0], latitude: NaN }], point.time)).toBeNull();
});

test('timeline end follows an accepted shared stay, retaining its actual time and exported fixes', () => {
  const rows = [600000, 620000, 660000].map(time => fix(time, 20));
  const ordinary = visit('accepted', 600000, 20);
  const projection = jest.spyOn(stopsModule, 'historyStops');
  const build = shared => {
    const node = shared ? { ...ordinary, originalRepresentative: coordinate(20), ...coordinate(0) } : { ...ordinary };
    projection.mockReturnValue({ stops: [node], visits: [node], state: null, typicalMs: null });
    return historyTimeline(rows, { subject: 'phone', dayStart: 0, dayEnd: 86400000,
      range: { start: rows[0].time, end: rows.at(-1).time } });
  };
  try {
    const before = build(false), after = build(true);
    const end = after.nodes.find(n => n.type === 'end');
    expect(end).toMatchObject({ ...coordinate(0), start: 660000, end: 660000,
      originalRepresentative: coordinate(20) });
    expect(after.points).toEqual(before.points);
    expect(after.edges).toEqual(before.edges);
    expect(after.distanceM).toBe(before.distanceM);
    const snapshot = model => buildExportSnapshot({ subject: 'phone', range: model.range,
      day: { subjects: [{ id: 'phone', model }] } });
    expect(buildGPX(snapshot(after))).toBe(buildGPX(snapshot(before)));
    expect(buildCSV(snapshot(after))).toBe(buildCSV(snapshot(before)));
    expect(snapshot(after).subjects[0].timeline.at(-1)).toMatchObject(coordinate(0));
  } finally { projection.mockRestore(); }
});

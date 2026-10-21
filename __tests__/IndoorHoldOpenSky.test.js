import { applyHistoryHolds, createHistoryHolds, createHoldTracker, distanceMeters, HOLD_CONFIG } from '../src/placement/IndoorHold';
import { historyTimeline } from '../src/history/HistoryTimeline';
import { phoneHistoryRow } from '../src/history/HistoryRows';
import { nodePill } from '../src/history/HistoryText';
import { dogMarkers } from '../src/map/DogMarkers';
import { dogCard } from '../src/map/DogCardModel';
import { dogFreshness } from '../src/tracking/DogFreshness';
import { offset } from '../__fixtures__/IndoorScenarios';

// 2026-10-19 (user): a new collar in a yard sees 30+ satellites at HDOP 0.6,
// yet stayed 「室內」 because the only way out was good fixes 80 m from the
// anchor, and the yard is 77 m from the charger. Under a pavilion the hold is
// right, but it is a shelter, not indoors. Invented geometry near Taoyuan
// station; the clocks and satellite counts are the shape of the real day.
const CHARGER = { latitude: 24.9892, longitude: 121.3138 };
const MINUTE = 60000;
const T0 = Date.UTC(2026, 9, 19, 5, 0);
// Rows every 20–60 s with now and then a gap over the 90 s trust gap.
const GAPS = [20, 45, 60, 30, 95, 25, 40, 60, 110, 20, 35, 50];
const cadence = (from, minutes) => {
  const times = [];
  for (let time = from, index = 0; time < from + minutes * MINUTE; index += 1) {
    times.push(time);
    time += GAPS[index % GAPS.length] * 1000;
  }
  return times;
};
// Deterministic small wobble (metres) for row i.
const wobble = (i, metres) => ((i * 7919) % 13 / 12 - 0.5) * 2 * metres;
const row = (time, point, extra) => ({ time, ...point, master_id: 7, slave_id: 108, source: 'cloud', ...extra });
const none = (time, extra = {}) => row(time, { latitude: 0, longitude: 0 }, { satellites: 0, hdop: 655.35, usb_present: 0, ...extra });
const indoor = rows => ({ environment: 'indoor', observedAt: Math.max(...rows.map(r => r.track_at)) });

// Charging indoors: a few good fixes at the charger, then the collar on its
// charger with no fix (the way the hold starts at a charger).
function charging(from, minutes) {
  const rows = [0, 10000, 20000, 30000].map((dt, i) => row(from + dt,
    offset(CHARGER, wobble(i, 3), wobble(i + 5, 3)), { satellites: 15, hdop: 1.5, usb_present: 1 }));
  for (const time of cadence(from + 60000, minutes - 1)) rows.push(none(time, { usb_present: 1 }));
  return rows;
}
// The yard: starts 77 m from the charger and wanders 45–77 m from it.
function yard(from, minutes, { satellites = 34, hdop = 0.6 } = {}) {
  return cadence(from, minutes).map((time, i) => {
    const north = 77 - (i % 9) * 4 + wobble(i, 2);
    return row(time, offset(CHARGER, north, wobble(i + 3, 6)),
      { satellites: satellites + (i % 5) - 2, hdop: Math.round((hdop + (i % 3) * 0.05) * 100) / 100, usb_present: 0, speed_kmh: 0.5 });
  });
}
const outdoor = rows => ({ environment: 'outdoor', observedAt: Math.max(...rows.map(r => r.track_at)) });
function replay(rows, config = HOLD_CONFIG, classify = indoor) {
  const tracker = createHoldTracker(config, { classify });
  return rows.map(r => {
    const event = tracker.push(r);
    return { time: r.time, event, held: tracker.current(r.time) };
  });
}

describe('open sky lets the dog go', () => {
  const unplug = T0 + 40 * MINUTE;
  const rows = [...charging(T0, 40), ...yard(unplug, 40)];

  test('the charger hold before the yard says 充電中', () => {
    const states = replay(rows);
    const lastCharging = states.filter(s => s.time < unplug).at(-1);
    expect(lastCharging.held?.reason).toBe('充電中');
  });

  test('a yard with 30+ satellites is released within the open-sky window (was held all along)', () => {
    const states = replay(rows);
    const yardStates = states.filter(s => s.time >= unplug);
    // Every yard fix is within 80 m of the charger: the old rule never let go.
    expect(rows.filter(r => r.time >= unplug).every(r => distanceMeters(r, CHARGER) < 80)).toBe(true);
    const released = yardStates.find(s => !s.held);
    expect(released).toBeTruthy();
    expect(released.time - unplug).toBeLessThanOrEqual(HOLD_CONFIG.openSkyWindowMs + 2 * MINUTE);
    // Once let go it stays free while the sky stays open.
    expect(yardStates.filter(s => s.time > released.time && s.held)).toEqual([]);
    expect(yardStates.find(s => s.event?.type === 'end').event.why).toBe('open-sky');
  });

  test('the history lets the yard go too, and the charger part stays 充電中', () => {
    const history = applyHistoryHolds(rows, { classify: indoor });
    const lastYard = history.at(-1);
    expect(lastYard.heldReason).toBeUndefined();
    expect(history.filter(p => p.time < unplug && p.heldReason).every(p => p.heldReason === '充電中')).toBe(true);
  });

  test('after unplugging, a hold the sky has not released is 遮蔽處, not 充電中', () => {
    // The same yard under a canopy: weak fixes, nothing releases it, and the
    // model does not say indoor (it said 充電中 until the hold ended).
    const covered = [...charging(T0, 40), ...yard(unplug, 8, { satellites: 6, hdop: 2.6 })];
    const states = replay(covered, HOLD_CONFIG, outdoor);
    const after = states.filter(s => s.time >= unplug + 2 * MINUTE);
    expect(after.every(s => s.held)).toBe(true);
    expect(after.every(s => s.held.reason !== '充電中')).toBe(true);
  });

  test('fewer than six rows in ten minutes is no evidence: the hold stays', () => {
    const sparse = [...charging(T0, 40),
      ...[0, 3, 6, 9, 12, 15, 18].map((m, i) => row(unplug + m * MINUTE, offset(CHARGER, 70, wobble(i, 3)),
        { satellites: 35, hdop: 0.6, usb_present: 0 }))];
    const states = replay(sparse);
    expect(states.filter(s => s.time >= unplug).every(s => s.held)).toBe(true);
  });
});

describe('charging wins over open sky', () => {
  test('on the charger indoors (12–18 satellites, HDOP 1.5) the dog stays 充電中', () => {
    const rows = [...charging(T0, 30), ...cadence(T0 + 30 * MINUTE, 60).map((time, i) => row(time,
      offset(CHARGER, wobble(i, 5), wobble(i + 4, 5)), { satellites: 12 + (i % 7), hdop: 1.5, usb_present: 1 }))];
    const states = replay(rows).filter(s => s.time >= T0 + 2 * MINUTE);
    expect(states.every(s => s.held?.reason === '充電中')).toBe(true);
  });

  test('a charger under open sky (35 satellites, HDOP 0.6) still says 充電中', () => {
    const rows = [...charging(T0, 30), ...cadence(T0 + 30 * MINUTE, 30).map((time, i) => row(time,
      offset(CHARGER, wobble(i, 3), wobble(i + 4, 3)), { satellites: 35, hdop: 0.6, usb_present: 1 }))];
    const states = replay(rows).filter(s => s.time >= T0 + 2 * MINUTE);
    expect(states.every(s => s.held?.reason === '充電中')).toBe(true);
  });
});

describe('older collars are unchanged', () => {
  test('8 satellites at HDOP 1.3 in the yard: the same hold, row by row, as without the open-sky rule', () => {
    const unplug = T0 + 40 * MINUTE;
    const rows = [...charging(T0, 40), ...yard(unplug, 40, { satellites: 8, hdop: 1.3 })];
    const without = { ...HOLD_CONFIG, openSkyMinSatellites: Infinity };
    const shape = states => states.map(s => [s.time, !!s.held, s.held?.coordinate ?? null, s.event?.type ?? null]);
    expect(shape(replay(rows))).toEqual(shape(replay(rows, without)));
    expect(replay(rows).filter(s => s.time >= unplug).every(s => s.held)).toBe(true);
  });
});

describe('a pavilion: no fix, held at the yard, said 遮蔽處', () => {
  const start = T0 + 60 * MINUTE;
  // Free in the yard first, then under the pavilion 15 m away with no fix.
  const rows = [...yard(T0, 60), ...cadence(start, 40).map((time, i) => (i % 8 === 7
    ? row(time, offset(CHARGER, 60 + wobble(i, 8), wobble(i, 8)), { satellites: 6, hdop: 2.8, usb_present: 0 })
    : none(time)))];

  test('the live hold starts and is said 遮蔽處', () => {
    const states = replay(rows);
    const held = states.filter(s => s.time >= start + 5 * MINUTE);
    expect(held.every(s => s.held)).toBe(true);
    const dog = { slaveId: 108, coordinate: held.at(-1).held.coordinate, fixAt: start, fixSource: 'cloud',
      packetAt: held.at(-1).time, packetSource: 'cloud', charging: false,
      heldReason: held.at(-1).held.reason, heldSource: held.at(-1).held.source };
    const now = held.at(-1).time + 5000;
    const [marker] = dogMarkers([dog], { now });
    expect(marker.tag).toBe('狗 108・遮蔽處');
    expect(marker.label.startsWith('狗 108・遮蔽處')).toBe(true);
    const card = dogCard(dog, { freshness: dogFreshness(dog, { now }), now, name: '狗 108', address: '桃園區中正路 1 號附近' });
    expect(card.rows[0]).toMatchObject({ value: '遮蔽處', detail: '桃園區中正路 1 號附近' });
  });

  test('the history node is 「在遮蔽處 X 分」', () => {
    const dayStart = Date.UTC(2026, 9, 18, 16), dayEnd = dayStart + 86400000;
    const model = historyTimeline(rows, { subject: 'dog', dayStart, dayEnd,
      range: { start: rows[0].time, end: rows.at(-1).time }, holdOptions: { classify: indoor } });
    const holds = model.nodes.filter(n => n.type === 'indoor');
    expect(holds.length).toBe(1);
    expect(nodePill(holds[0]).text).toMatch(/^在遮蔽處 \d+ 分$/);
    expect(JSON.stringify(model.nodes.map(nodePill))).not.toContain('室內');
  });
});

describe('review findings (Codex, 2026-10-19)', () => {
  test('sparse open-sky fixes (every 100 s, never backed) still move the anchor on: a later shelter holds at the yard', () => {
    const unplug = T0 + 40 * MINUTE;
    const spot = offset(CHARGER, 70, 0);
    const yardRows = Array.from({ length: 12 }, (_, i) => row(unplug + i * 100000,
      offset(spot, wobble(i, 2), wobble(i + 2, 2)), { satellites: 34, hdop: 0.6, usb_present: 0 }));
    const shelterFrom = unplug + 12 * 100000;
    const shelter = cadence(shelterFrom, 15).map(time => none(time));
    const states = replay([...charging(T0, 40), ...yardRows, ...shelter]);
    expect(states.find(s => s.time >= unplug && !s.held)).toBeTruthy();
    const rehold = states.filter(s => s.time >= shelterFrom + 5 * MINUTE);
    expect(rehold.every(s => s.held)).toBe(true);
    // Held where the dog went quiet (the yard), not back at the charger 70 m away.
    expect(distanceMeters(rehold.at(-1).held.coordinate, spot)).toBeLessThan(15);
  });

  test('rows without a usable HDOP are no open sky', () => {
    const unplug = T0 + 40 * MINUTE;
    const rows = [...charging(T0, 40), ...yard(unplug, 30).map(r => ({ ...r, hdop: 655.35 }))];
    expect(replay(rows).filter(s => s.time >= unplug).every(s => s.held)).toBe(true);
  });

  test('a hold unplugged on the way is two history rows: 充電中, then 在遮蔽處', () => {
    const unplug = T0 + 40 * MINUTE;
    const rows = [...charging(T0, 40), ...cadence(unplug, 30).map(time => none(time))];
    const dayStart = Date.UTC(2026, 9, 18, 16), dayEnd = dayStart + 86400000;
    const model = historyTimeline(rows, { subject: 'dog', dayStart, dayEnd,
      range: { start: rows[0].time, end: rows.at(-1).time }, holdOptions: { classify: outdoor } });
    const holds = model.nodes.filter(n => n.type === 'indoor');
    expect(holds.map(n => nodePill(n).text.replace(/\d.*$/, ''))).toEqual(['充電中 ', '在遮蔽處 ']);
    expect(holds[1].start).toBeGreaterThanOrEqual(unplug);
    expect(holds[1].continuesPreviousDay).toBe(false);
  });

  test('a reason recorded before the change (「室內」) reads 遮蔽處 everywhere', () => {
    const legacy = { type: 'indoor', start: T0, end: T0 + 25 * MINUTE, reason: '室內' };
    expect(nodePill(legacy).text).toBe('在遮蔽處 25 分');
    const dog = { slaveId: 4, coordinate: CHARGER, fixAt: T0, packetAt: T0, charging: false,
      heldReason: '室內', heldSource: 'good' };
    expect(dogMarkers([dog], { now: T0 + 5000 })[0].tag).toBe('狗 4・遮蔽處');
  });

  test('the history pass appended in pieces is the one replayed at once', () => {
    const rows = [...charging(T0, 40), ...yard(T0 + 40 * MINUTE, 40)];
    const whole = applyHistoryHolds(rows, { classify: indoor });
    const holds = createHistoryHolds({ classify: indoor });
    for (let i = 0; i < rows.length; i += 7) holds.append(rows.slice(i, i + 7));
    expect(holds.output).toEqual(whole);
  });
});

// AGENTS.md 修錯流程 5: my route (the phone) is the parallel path. It runs on
// PhoneMotion and never goes through IndoorHold, so neither the open sky nor
// the words reach it.
test('my route never holds and never says 遮蔽處 or 室內', () => {
  const rows = [];
  for (let i = 0; i < 360; i += 1) {
    const time = T0 + i * 5000;
    // Still at home for ten minutes, then a walk north, then still again.
    const north = i < 120 ? 0 : i < 240 ? (i - 120) * 6 : 720;
    rows.push(phoneHistoryRow({ time, ...offset(CHARGER, north + wobble(i, 2), wobble(i + 1, 2)), accuracy: 5,
      speed_kmh: i >= 120 && i < 240 ? 4.3 : 0, motion_state: i >= 120 && i < 240 ? 'moving' : 'stationary', session_id: 's1' }));
  }
  const dayStart = Date.UTC(2026, 9, 18, 16), dayEnd = dayStart + 86400000;
  const model = historyTimeline(rows, { subject: 'phone', source: 'all', dayStart, dayEnd });
  expect(model.points.some(p => p.heldReason)).toBe(false);
  expect(model.nodes.some(n => n.type === 'indoor')).toBe(false);
  expect(JSON.stringify(model.nodes.map(nodePill))).not.toMatch(/遮蔽處|室內/);
});

// 2026-10-19 (user's choice from four mockups): a pavilion for 遮蔽處, a bolt
// for 充電中, on the same receiver-blue disc everywhere a hold is drawn.
describe('the hold icons', () => {
  const { holdIcon, HOLD_ICON_PATHS } = require('../src/placement/HoldIcons');
  const { exportTimelineRows } = require('../src/mapHistory/ExportSnapshot');
  const { EXPORT_ICONS, mapOp } = require('../src/mapHistory/ExportDraw');
  test('a pavilion for any shelter, a bolt on the charger', () => {
    expect(['室內', '窗邊', 'GPS 沒有定位', 'GPS 訊號弱', undefined].map(holdIcon)).toEqual(Array(5).fill('shelter'));
    expect(holdIcon('充電中')).toBe('bolt');
    expect(EXPORT_ICONS.shelter).toBe(HOLD_ICON_PATHS.shelter);
    expect(EXPORT_ICONS.bolt).toBe(HOLD_ICON_PATHS.bolt);
    expect(EXPORT_ICONS.house).toBeUndefined();
  });
  test('the live marker, the export list and the export map carry the icon', () => {
    const dog = reason => ({ slaveId: 4, coordinate: CHARGER, fixAt: T0, packetAt: T0, charging: reason === '充電中',
      heldReason: reason, heldSource: 'good' });
    const [shelterMarker, chargingMarker, freeMarker] = dogMarkers([dog('GPS 沒有定位'), { ...dog('充電中'), slaveId: 6 },
      { ...dog(null), slaveId: 8, heldReason: undefined }], { now: T0 + 5000 });
    expect([shelterMarker.holdIcon, chargingMarker.holdIcon, freeMarker.holdIcon]).toEqual(['shelter', 'bolt', null]);
    const nodes = [{ type: 'indoor', start: T0, end: T0 + 25 * MINUTE, reason: '充電中', latitude: 24.99, longitude: 121.31 },
      { type: 'indoor', start: T0 + 26 * MINUTE, end: T0 + 40 * MINUTE, reason: '室內', latitude: 24.99, longitude: 121.31 }];
    expect(exportTimelineRows(nodes, () => null).filter(item => item.type === 'indoor').map(item => item.holdIcon))
      .toEqual(['bolt', 'shelter']);
    const op = mapOp({ y: 0, width: 100, height: 100, padding: 0, subjects: [] });
    expect(Object.keys(op.holdIcons).sort()).toEqual(['bolt', 'shelter']);
    expect(op.house).toBeUndefined();
  });
});

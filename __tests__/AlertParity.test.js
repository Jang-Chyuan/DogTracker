// 058b: the background alert check (android .../alerts/AlertRules.kt) is a port
// of the JavaScript the app runs in front. This runs scenarios through the
// JavaScript (AlertEvents → AlertScheduler → AlertContent, AlertEngine's saved
// state) and keeps the results in a fixture the Kotlin unit test
// (AlertParityTest.kt) replays through the port: both must agree step by step.
// After a rule change: UPDATE_ALERT_PARITY=1 npm test -- AlertParity
import fs from 'fs';
import path from 'path';
import { stepAlerts, pauseAlertState, persistedAlertState, restoreAlertState } from '../src/alerts/AlertEngine';

const FIXTURE = path.join(__dirname, '../android/app/src/test/resources/alert-parity.json');
const M = 60000;
const T = 1_760_000_000_000;
const near = { latitude: 24.9895, longitude: 121.3140 };

// A dog as both sides take it (the Kotlin AlertDog's fields).
const dog = (slaveId, name, extra = {}) => ({
  slaveId, name, coordinate: near, fixAt: T, packetAt: T, held: false, farFixes: 0,
  batteryPercentage: 80, charging: false, range: { status: 'in', clearing: [], nearBack: 0, cloudOnly: false },
  ...extra,
});
const receiver = (extra = {}) => ({
  enabled: true, running: true, connected: true, disconnectedAt: 0, number: 7, batteryPercentage: 62, ...extra,
});

// The JavaScript's view of the same dog (DogMerge's fields).
const jsDog = value => ({
  slaveId: value.slaveId, name: value.name, coordinate: value.coordinate,
  fixAt: value.fixAt, fixSource: value.range?.cloudOnly ? 'cloud' : 'ble', packetAt: value.packetAt, packetSource: value.range?.cloudOnly ? 'cloud' : 'ble',
  ...(value.held ? { heldReason: '室內', heldSource: 'indoor' } : {}),
  batteryPercentage: value.batteryPercentage, charging: value.charging, range: value.range,
});

const SCENARIOS = [
  {
    name: 'K07: out-of-range status survives 25 hours and a restart until local clearing', preferences: { dogStale: false },
    steps: [
      { at: T, dogs: [dog(4, '豆豆', { range: { status: 'out', cloudOnly: false } })] },
      { at: T + 25 * 60 * M, dogs: [dog(4, '豆豆', { range: { status: 'out', cloudOnly: false } })], action: 'restart' },
      { at: T + 25 * 60 * M + M, dogs: [dog(4, '豆豆', { fixAt: T + 25 * 60 * M + M, packetAt: T + 25 * 60 * M + M })] },
    ],
  },

  {
    name: 'K05: established receiver outage survives a process restart', preferences: {},
    steps: [
      { at: T, dogs: [dog(4, '豆豆')], receiver: receiver({ connected: false, disconnectedAt: T - M }) },
      { at: T + M, dogs: [dog(4, '豆豆')], receiver: receiver({ connected: false, disconnectedAt: T - M }), action: 'restart' },
      { at: T + 2 * M, dogs: [dog(4, '豆豆')], receiver: receiver({ connected: false, disconnectedAt: T - M }) },
      { at: T + 3 * M, dogs: [dog(4, '豆豆')], receiver: receiver() },
    ],
  },

  {
    name: 'K06: a local range episode survives cloud takeover and does not restart on local return',
    preferences: {},
    steps: [
      { at: T, dogs: [dog(4, '豆豆', { range: { status: 'out', cloudOnly: false } })] },
      { at: T + M, dogs: [dog(4, '豆豆', { range: { status: 'out', cloudOnly: true } })] },
      { at: T + 2 * M, dogs: [dog(4, '豆豆', { range: { status: 'out', cloudOnly: false } })] },
      { at: T + 3 * M, dogs: [dog(4, '豆豆')] },
    ],
  },

  {
    name: 'two dogs, the gap, a pause, a new problem during it, the end of the pause',
    preferences: {},
    steps: [
      { at: T, dogs: [dog(4, '豆豆'), dog(5, '小黑')] },
      { at: T + 11 * M, dogs: [dog(4, '豆豆'), dog(5, '小黑', { fixAt: T + 11 * M, packetAt: T + 11 * M })] },
      { at: T + 11 * M + 30000, dogs: [dog(4, '豆豆'),
        dog(5, '小黑', { fixAt: T + 11 * M, packetAt: T + 11 * M, range: { status: 'out', outSince: T + 11 * M,
          judgedAt: T + 11 * M, clearing: [], nearBack: 0, cloudOnly: false } })] },
      { at: T + 12 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 18 }),
        dog(5, '小黑', { fixAt: T + 12 * M, packetAt: T + 12 * M, range: { status: 'out', outSince: T + 11 * M,
          judgedAt: T + 12 * M, clearing: [], nearBack: 0, cloudOnly: false } })] },
      { at: T + 14 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 18 }),
        dog(5, '小黑', { fixAt: T + 14 * M, packetAt: T + 14 * M, range: { status: 'out', outSince: T + 11 * M,
          judgedAt: T + 14 * M, clearing: [], nearBack: 0, cloudOnly: false } })], action: 'pause' },
      { at: T + 15 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 18 }),
        dog(5, '小黑', { fixAt: T + 15 * M, packetAt: T + 15 * M, range: { status: 'out', outSince: T + 11 * M,
          judgedAt: T + 15 * M, clearing: [], nearBack: 0, cloudOnly: false } })] },
      { at: T + 16 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 18 }),
        dog(5, '小黑', { fixAt: T + 16 * M, packetAt: T + 16 * M, batteryPercentage: 9, range: { status: 'out',
          outSince: T + 11 * M, judgedAt: T + 16 * M, clearing: [], nearBack: 0, cloudOnly: false } })],
      storageError: 'SQLITE_FULL: database or disk is full' },
      { at: T + 45 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 18 }),
        dog(5, '小黑', { fixAt: T + 45 * M, packetAt: T + 45 * M, batteryPercentage: 9, range: { status: 'out',
          outSince: T + 11 * M, judgedAt: T + 45 * M, clearing: [], nearBack: 0, cloudOnly: false } })],
      storageError: 'SQLITE_FULL: database or disk is full' },
      { at: T + 46 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 35 }),
        dog(5, '小黑', { fixAt: T + 46 * M, packetAt: T + 46 * M, batteryPercentage: 9 })] },
    ],
  },
  {
    name: 'the receiver drops: one line for it, its quiet dogs not listed; a reminder after 30 minutes',
    preferences: {},
    steps: [
      { at: T, dogs: [dog(4, '豆豆'), dog(5, '小黑')], receiver: receiver() },
      { at: T + 5 * M, dogs: [dog(4, '豆豆'), dog(5, '小黑')],
        receiver: receiver({ connected: false, disconnectedAt: T + 5 * M - 10000 }) },
      { at: T + 5 * M + 25000, dogs: [dog(4, '豆豆'), dog(5, '小黑')],
        receiver: receiver({ connected: false, disconnectedAt: T + 5 * M - 10000 }) },
      { at: T + 11 * M, dogs: [dog(4, '豆豆'), dog(5, '小黑')],
        receiver: receiver({ connected: false, disconnectedAt: T + 5 * M - 10000 }) },
      { at: T + 12 * M, dogs: [dog(4, '豆豆'), dog(5, '小黑')], receiver: receiver() },
      { at: T + 13 * M, dogs: [dog(4, '豆豆'), dog(5, '小黑', { fixAt: T + 13 * M, packetAt: T + 13 * M })],
        receiver: receiver({ batteryPercentage: 15 }) },
      { at: T + 42 * M, dogs: [dog(4, '豆豆'), dog(5, '小黑', { fixAt: T + 42 * M, packetAt: T + 42 * M })],
        receiver: receiver({ batteryPercentage: 15 }) },
      { at: T + 44 * M, dogs: [dog(4, '豆豆'), dog(5, '小黑', { fixAt: T + 44 * M, packetAt: T + 44 * M })],
        receiver: receiver({ batteryPercentage: 15 }) },
    ],
  },
  {
    name: 'switched off in S6: never listed, no vibration; the sound; an indoor dog timed by its packets',
    preferences: { dogStale: false, sound: true, vibrate: false },
    steps: [
      { at: T, dogs: [dog(4, '豆豆'), dog(6, '阿福', { held: true, fixAt: T - 30 * M, packetAt: T })] },
      { at: T + 11 * M, dogs: [dog(4, '豆豆'), dog(6, '阿福', { held: true, fixAt: T - 30 * M, packetAt: T + 11 * M })] },
      { at: T + 12 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 12 }),
        dog(6, '阿福', { held: true, fixAt: T - 30 * M, packetAt: T + 1 * M })] },
      { at: T + 13 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 12 }),
        dog(6, '阿福', { held: true, fixAt: T - 30 * M, packetAt: T + 1 * M })], allowed: false },
    ],
  },
  {
    name: 'everything switched off: no notification at all; the user paused the receiver',
    preferences: { dogStale: false, dogOutOfRange: false, dogBattery: false, receiverBattery: false,
      receiverDisconnectedStorage: false },
    steps: [
      { at: T, dogs: [dog(4, '豆豆', { batteryPercentage: 5 })],
        receiver: receiver({ connected: false, disconnectedAt: T - M }) },
      { at: T + 20 * M, dogs: [dog(4, '豆豆', { batteryPercentage: 5 })], receiver: receiver(),
        pauses: [{ pausedAt: T + M, resumedAt: null }] },
    ],
  },
];

function runScenario(scenario) {
  let state = {};
  const steps = [];
  for (const step of scenario.steps) {
    const rx = step.receiver ?? receiver();
    const input = {
      dogs: step.dogs.map(jsDog),
      receiver: { enabled: rx.enabled, running: rx.running, connected: rx.connected,
        disconnectedAt: rx.disconnectedAt, expectedMasterId: rx.number },
      receiverBattery: rx.batteryPercentage == null ? null : { valid: true, percentage: rx.batteryPercentage },
      storageError: step.storageError ?? null,
      pauses: step.pauses ?? [],
      now: step.at, foreground: false, screen: 'map',
      preferences: scenario.preferences, notificationsAllowed: step.allowed !== false,
    };
    const result = stepAlerts(state, input);
    state = result.state;
    const { effects } = result;
    if (step.action === 'restart') state = restoreAlertState(persistedAlertState(state));
    if (step.action === 'pause') state = pauseAlertState(state, step.at);
    steps.push({
      ...step,
      receiver: rx,
      expect: {
        notification: effects.notification,
        title: effects.content?.title ?? null,
        lines: effects.content?.lines ?? [],
        target: effects.content?.target ?? null,
        delivered: effects.delivered,
        vibration: effects.vibration,
        critical: effects.critical,
        sound: effects.sound,
        state: persistedAlertState(state),
      },
    });
  }
  return { name: scenario.name, preferences: scenario.preferences, steps };
}

test('the background check agrees with the app (fixture for AlertParityTest.kt)', () => {
  const result = JSON.stringify(SCENARIOS.map(runScenario), null, 1) + '\n';
  if (process.env.UPDATE_ALERT_PARITY) fs.writeFileSync(FIXTURE, result);
  expect(fs.readFileSync(FIXTURE, 'utf8')).toBe(result);
});

test('the scenarios cover each kind of alert and each notification command', () => {
  const all = SCENARIOS.map(runScenario).flatMap(scenario => scenario.steps.map(step => step.expect));
  const lines = all.flatMap(step => step.lines).join('\n');
  for (const words of ['不在接收範圍', '沒有新位置', '電量低', '斷線了', '空間不足', '接收器 7 電量低']) {
    expect(lines).toContain(words);
  }
  expect(new Set(all.map(step => step.notification))).toEqual(new Set(['notify', 'update', 'cancel']));
  expect(all.some(step => step.critical)).toBe(true);
  expect(all.some(step => step.sound)).toBe(true);
  expect(all.some(step => step.state.pause)).toBe(true);
});

// K03: packet-level parity covers entering indoors after handover and every
// release path, using the same environment model and foreground checkpoint.
const INDOOR_FIXTURE = path.join(__dirname, '../android/app/src/test/resources/indoor-parity.json');
const north = metres => ({ latitude: near.latitude + metres / 111320, longitude: near.longitude });
const holdRow = (time, metres, extra = {}) => ({ time, master_id: 7, slave_id: 4, source: 'ble',
  ...(metres == null ? { latitude: 0, longitude: 0 } : north(metres)), satellites: 9, hdop: 1, rssi: -55, snr: 8,
  master_latitude: near.latitude, master_longitude: near.longitude, usb_present: 0, ...extra });
const startRows = Array.from({ length: 10 }, (_, i) => holdRow(T + i * 5000, 0));
const indoorRows = [...startRows, holdRow(T + M + 5000, null, { usb_present: 1 })];
const packetCases = [
  { name: 'enter after lock screen: no fix', initial: startRows, rows: [holdRow(T + 2 * M, null)] },
  { name: 'enter while charging with weak fixes', initial: startRows,
    rows: [holdRow(T + M + 10000, 10, { usb_present: 1, satellites: 2, hdop: 5 })] },
  { name: 'release: two far good fixes', initial: indoorRows,
    rows: [holdRow(T + 2 * M, 130), holdRow(T + 2 * M + 10000, 135)] },
  { name: 'release: agreeing good fixes outside', initial: indoorRows,
    rows: [holdRow(T + 2 * M, 90), holdRow(T + 2 * M + 10000, 92), holdRow(T + 2 * M + 20000, 95)] },
  { name: 'release: agreeing good fixes while charging', initial: indoorRows,
    rows: Array.from({ length: 4 }, (_, i) => holdRow(T + 2 * M + i * 10000, 90 + i, { usb_present: 1 })) },
  { name: 'release: six nearby good fixes', initial: indoorRows,
    rows: Array.from({ length: 8 }, (_, i) => holdRow(T + 2 * M + i * 15000, 70, { usb_present: 1 })) },
  { name: 'release: weak fixes far away', initial: indoorRows,
    rows: Array.from({ length: 14 }, (_, i) => holdRow(T + 2 * M + i * 10000, 220 + (i % 2) * 10, { satellites: 2, hdop: 5 })) },
  { name: 'release: travelling weak fixes', initial: indoorRows,
    rows: Array.from({ length: 36 }, (_, i) => holdRow(T + 2 * M + i * 5000, i * 6, { satellites: 2, hdop: 5 })) },
  { name: 'charger keeps weak drift held; later good fixes release', initial: indoorRows,
    rows: [...Array.from({ length: 15 }, (_, i) => holdRow(T + 2 * M + i * 10000, 220, { usb_present: 1, satellites: 2, hdop: 5 })),
      holdRow(T + 5 * M, 140), holdRow(T + 5 * M + 10000, 140)] },
];

function runIndoorCase(scenario) {
  const { createHoldTracker } = require('../src/placement/IndoorHold');
  const tracker = createHoldTracker();
  for (const row of scenario.initial) tracker.push(row);
  const latest = scenario.initial.at(-1);
  const held = tracker.current(latest.time);
  const lastFix = scenario.initial.filter(row => row.latitude !== 0).at(-1);
  const initial = dog(4, '豆豆', { coordinate: held?.coordinate ?? { latitude: lastFix.latitude, longitude: lastFix.longitude },
    held: !!held, fixAt: lastFix.time, packetAt: latest.time, indoorState: tracker.snapshot() });
  const rows = scenario.rows.map(row => {
    tracker.push(row);
    const current = tracker.current(row.time);
    return { row, expect: { held: !!current, coordinate: current?.coordinate ?? (row.latitude !== 0
      ? { latitude: row.latitude, longitude: row.longitude } : initial.coordinate),
      why: tracker.snapshot().previousHold?.why ?? null } };
  });
  return { name: scenario.name, initial, rows };
}

test('K03: native indoor entry and every release path agree with the foreground tracker', () => {
  const results = packetCases.map(runIndoorCase);
  const result = JSON.stringify(results, null, 1) + '\n';
  if (process.env.UPDATE_ALERT_PARITY) fs.writeFileSync(INDOOR_FIXTURE, result);
  expect(fs.readFileSync(INDOOR_FIXTURE, 'utf8')).toBe(result);
  expect(results[0].rows[0].expect.held).toBe(true);
  const released = results.flatMap(value => value.rows.map(row => row.expect.why)).filter(Boolean);
  expect(new Set(released)).toEqual(new Set(['good-fixes-away', 'good-fixes-nearby', 'weak-fixes-away', 'travelling']));
});

// 058b: the background alert check (android .../alerts/AlertRules.kt) is a port
// of the JavaScript the app runs in front. This runs scenarios through the
// JavaScript (AlertEvents → AlertScheduler → AlertContent, AlertEngine's saved
// state) and keeps the results in a fixture the Kotlin unit test
// (AlertParityTest.kt) replays through the port: both must agree step by step.
// After a rule change: UPDATE_ALERT_PARITY=1 npm test -- AlertParity
import fs from 'fs';
import path from 'path';
import { stepAlerts, pauseAlertState, persistedAlertState } from '../src/alerts/AlertEngine';

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
  fixAt: value.fixAt, fixSource: 'ble', packetAt: value.packetAt, packetSource: 'ble',
  ...(value.held ? { heldReason: '室內', heldSource: 'indoor' } : {}),
  batteryPercentage: value.batteryPercentage, charging: value.charging, range: value.range,
});

const SCENARIOS = [
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

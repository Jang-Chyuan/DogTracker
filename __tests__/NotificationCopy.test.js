// Everything that can show in the Android notification shade is plain
// language (2026-10-17): no 「BLE」, characteristic, Master ID, QR, Timeline,
// accuracy thresholds, raw error placeholders. The technical wording stays in
// 診斷 and dumpsys under its own ids.
import fs from 'fs';
import path from 'path';
import resources from '../src/i18n/zh-TW.json';

const root = path.resolve(__dirname, '..');
const kotlin = file => fs.readFileSync(path.join(root, 'android/app/src/main/java/com/dogtracker', file), 'utf8');
const ids = source => [...source.matchAll(/R\.string\.(c\d+)\b/g)].map(match => match[1]);
const jsIds = source => [...source.matchAll(/\bt\(\s*["'](c\d+)["']/g)].map(match => match[1]);

// Files whose strings are all notification text.
const receiverText = kotlin('BleReconnectBackoff.kt');
const notificationOnly = [
  ...ids(receiverText),
  ...ids(kotlin('location/RecordingNotice.kt')),
  ...ids(kotlin('cloud/SearchRelayService.kt')),
  ...ids(kotlin('location/RecordingResumeReceiver.kt')),
  ...jsIds(fs.readFileSync(path.join(root, 'src/alerts/AlertContent.js'), 'utf8')),
];
// Titles and buttons set where the notification is built.
const others = ['c1110', 'c1111', 'c1128', 'c1130', 'c204', 'c171', 'c462', 'c191', 'c477'];
const notificationIds = [...new Set([...notificationOnly, ...others])];

const banned = [
  [/BLE/i, 'BLE'], [/Characteristic/i, 'Characteristic'], [/Master ?ID/i, 'Master ID'], [/\bQR\b/i, 'QR'],
  [/Timeline/i, 'Timeline'], [/[≤≥<>]/, 'threshold sign'], [/km\/h/i, 'km/h'], [/\d\s?(m|公尺)\b/, 'metres'],
  [/\{\{(value\d+|error|message|reason|status|detail)\}\}/, 'raw error placeholder'], [/Exception|error|failed|status/i, 'raw error'],
];

describe('notification copy', () => {
  test('the guard reads the notification files', () => {
    expect(notificationIds.length).toBeGreaterThan(30);
    for (const id of ['c1112', 'c1420', 'c1423', 'c1426', 'c1428', 'c1401', 'c168']) expect(notificationIds).toContain(id);
  });
  test.each(notificationIds)('%s is plain language', id => {
    const text = resources[id];
    expect(typeof text).toBe('string');
    for (const [pattern, label] of banned) {
      if (pattern.test(text)) throw new Error(`${id} (${text}) contains ${label}`);
    }
  });
  test('the old technical notification states are gone from the notification files', () => {
    const retired = ['c1147', 'c1148', 'c1149', 'c1152', 'c1418'];
    for (const id of retired) expect(notificationIds).not.toContain(id);
    for (const id of ['c1147', 'c1148', 'c1149', 'c1152']) expect(resources[id]).toBeUndefined();
  });
  test('the diagnostic wording is kept under its own ids', () => {
    expect(resources.c1418).toMatch(/BLE/);
    expect(resources.c1133).toMatch(/30 m/);
    expect(resources.c1098).toMatch(/Master ID/);
  });
});

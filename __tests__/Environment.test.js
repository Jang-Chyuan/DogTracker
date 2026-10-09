import { t as i18nT } from '../src/i18n';
import { predictEnvironment, environmentLabel, environmentEvidence } from '../src/ml/Environment';
import { mergeDogMarkers } from '../src/map/DogMerge';

const time = Date.parse('2026-10-03T12:00:10Z');
const row = { master_id: 3, slave_id: 7, received_at: time,
  slave_lat: 0, slave_lon: 0, satellites: 0, hdop: 655.35,
  rssi: -80, snr: 3, usb_present: 1, source: 'ble' };

test('USB rule uses every packet of two minutes, and expires independently of GPS', () => {
  const result = predictEnvironment([row, { ...row, received_at: time + 60000 }]);
  expect(result).toMatchObject({ environment: 'indoor', source: 'usb_rule', samples: 2 });
  expect(environmentLabel(result, time + 20000)).toBe('室內（USB 已連接）');
  expect(result.windowEnd - result.windowStart).toBe(120000);
  expect(environmentLabel(result, time + 181000)).toContain('資料已超過 2 分鐘');
  expect(() => predictEnvironment([row, { ...row, received_at: time + 120000 }])).toThrow('UTC time bucket');
  expect(predictEnvironment([row, { ...row, usb_present: 0 }]).source).toBe('random_forest');
});

test('absent telemetry stays unknown and window classification is retained', () => {
  expect(predictEnvironment([{ master_id: 3, slave_id: 7, received_at: time }]).environment).toBe('unknown');
  expect(environmentLabel({ environment: 'window', source: 'random_forest',
    modelConfidence: 0.9, observedAt: time }, time)).toBe('窗邊（信心 90%）');
});

test('low confidence shows a tentative class with probabilities without disguising missing or stale data', () => {
  const result = { environment: 'unknown', modelEnvironment: 'window', modelConfidence: 0.55,
    hasSignal: true, source: 'random_forest', observedAt: time,
    probabilities: { indoor: 0.2, window: 0.55, outdoor: 0.25 } };
  expect(environmentLabel(result, time)).toBe('疑似窗邊（信心 55%，低於 60%）');
  expect(environmentEvidence(result)).toBe('模型機率：室內 20% · 窗邊 55% · 室外 25%');
  expect(environmentLabel({ ...result, hasSignal: false }, time)).toBe(i18nT("c852"));
  expect(environmentLabel(result, time + 120001)).toContain('資料已超過 2 分鐘');
  expect(environmentLabel(null, time)).toBe(i18nT("c846"));
});

test('each slave uses its own newest packet including no-fix dogs', () => {
  const rows = [row, { ...row, slave_id: 8, usb_present: 0 }];
  const packets = rows.map(value => ({ ...value, environment: predictEnvironment([value]) }));
  const dogs = mergeDogMarkers({ point: null, packetRows: packets, now: time });
  expect(dogs).toHaveLength(2);
  expect(dogs[0].environment.source).toBe('usb_rule');
  expect(dogs[1].environment.source).toBe('random_forest');
  const point = { slaveId: 7, masterId: 3, receivedAt: time,
    slaveLat: 0, slaveLon: 0, usbPresent: 1 };
  expect(mergeDogMarkers({ point, packetRows: packets, now: time })[0].environment)
    .toBe(packets[0].environment);
  expect(mergeDogMarkers({ point: { ...point, receivedAt: time + 60000 }, packetRows: packets,
    now: time + 60000 })[0].environment).toBe(packets[0].environment);
  expect(mergeDogMarkers({ point, now: time })[0].environment).toBeNull();
});

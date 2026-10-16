import { HISTORY_CONFIG, measuredSpeedMps, quietFix, samePlaceGap } from '../src/history/HistoryConfig';
import { historyVisits } from '../src/history/HistoryStops';

// 2026-10-15 (user, #200 速度不確定性): a speed whose uncertainty swallows it
// (speed accuracy over 1.5 m/s, lower bound not over 0.5 m/s) — e.g. 0 km/h
// ± 2 m/s indoors — is no speed at all: the same as a fix without one, and
// the same rule the motion detector already used (phoneReliableSpeed).
// Invented fixes by a made-up point near Taoyuan Station.
const config = HISTORY_CONFIG.phone;
const ORIGIN = { latitude: 24.9892, longitude: 121.3138 };
const fix = (seconds, north, extra = {}) => {
  const p = { time: seconds * 1000, latitude: ORIGIN.latitude + north / 111195, longitude: ORIGIN.longitude,
    accuracy: 14, raw_speed_kmh: 0, speed_kmh: 0, speed_accuracy_mps: 0.5, slave_id: 'phone',
    phoneMotionState: 'stationary', phoneStationary: true, phoneConfirmedMovement: false, ...extra };
  return { ...p, raw_latitude: p.latitude, raw_longitude: p.longitude };
};

test('a speed lost in its uncertainty is no speed; one that clears it stays', () => {
  expect(measuredSpeedMps({ raw_speed_kmh: 0, speed_accuracy_mps: 2 })).toBeNull();
  expect(measuredSpeedMps({ raw_speed_kmh: 3.6, speed_accuracy_mps: 5 })).toBeNull();
  expect(measuredSpeedMps({ raw_speed_kmh: 7.2, speed_accuracy_mps: 1.6 })).toBeNull();
  // Lower bound over 0.5 m/s: a speed (a car on coarse fixes).
  expect(measuredSpeedMps({ raw_speed_kmh: 30, speed_accuracy_mps: 2.5 })).toBeCloseTo(30 / 3.6, 9);
  // Within 1.5 m/s: as measured, however slow.
  expect(measuredSpeedMps({ raw_speed_kmh: 0, speed_accuracy_mps: 1.5 })).toBe(0);
  expect(measuredSpeedMps({ raw_speed_kmh: 4, speed_accuracy_mps: 0.4 })).toBeCloseTo(4 / 3.6, 9);
  // No accuracy: as measured (older rows).
  expect(measuredSpeedMps({ raw_speed_kmh: 3.6 })).toBe(1);
});

test('0 km/h ± 2 m/s is quiet, like a fix without a speed', () => {
  const uncertain = fix(0, 0, { phoneStationary: false, phoneMotionState: 'unknown', speed_accuracy_mps: 2 });
  const none = fix(0, 0, { phoneStationary: false, phoneMotionState: 'unknown', raw_speed_kmh: null, speed_kmh: null,
    speed_accuracy_mps: null });
  expect(quietFix(none, config)).toBe(true);
  expect(quietFix(uncertain, config)).toBe(true);
  // A walking speed it is sure of is not quiet.
  expect(quietFix({ ...uncertain, raw_speed_kmh: 4, speed_kmh: 4, speed_accuracy_mps: 0.4 }, config)).toBe(false);
});

test('a break at home ending on a 0 km/h ± 2 m/s fix 43 m off is one stay, as with no speed', () => {
  const before = fix(600, 0);
  const after = extra => fix(4200, 43, { phoneStationary: false, phoneMotionState: 'unknown', ...extra });
  const day = end => [fix(0, 0), before, end, fix(4205, 44), fix(4800, 44)];
  expect(samePlaceGap(before, after({ speed_accuracy_mps: 2 }), config)).toBe(true);
  expect(historyVisits(day(after({ speed_accuracy_mps: 2 })), { subject: 'phone' })).toHaveLength(1);
  expect(historyVisits(day(after({ raw_speed_kmh: null, speed_kmh: null, speed_accuracy_mps: null })),
    { subject: 'phone' })).toHaveLength(1);
});

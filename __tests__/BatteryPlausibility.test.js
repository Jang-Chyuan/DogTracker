// BatteryPlausibility (2026-10-13): one bad packet no longer shows 「0%・偏低」
// on the card, a red 「!」 on the map or a low-battery alert. All packet
// sequences below are fictional.
import {
  advanceBattery, batteryReading, judgeBatteries, plausibleBattery, BATTERY_DROP_PACKETS, BATTERY_DROP_POINTS,
  BATTERY_EMPTY_MAX_MV, BATTERY_MAX_PERCENT,
} from '../src/tracking/BatteryPlausibility';
import { createHoldStore } from '../src/placement/HoldStore';
import { HOLD_CONFIG } from '../src/placement/IndoorHold';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { dogProblems } from '../src/tracking/DogProblems';
import { updateAlertEvents } from '../src/alerts/AlertEvents';
import { dogCard } from '../src/map/DogCardModel';

const T = 1_800_000_000_000;
const S = 1000;
const reading = (seconds, percentage, millivolts = null) => ({ percentage, millivolts, at: T + seconds * S });
const accepted = readings => judgeBatteries(readings)?.accepted?.percentage ?? null;
const after = readings => readings.map((_, index) => accepted(readings.slice(0, index + 1)));

test('the thresholds are named (and await the firmware)', () => {
  expect([BATTERY_MAX_PERCENT, BATTERY_EMPTY_MAX_MV, BATTERY_DROP_POINTS, BATTERY_DROP_PACKETS]).toEqual([100, 3500, 30, 2]);
});

test('one reading on its own: 0..100%, and 0% only with an empty cell', () => {
  expect(plausibleBattery(43, null)).toBe(true);
  expect(plausibleBattery(100, null)).toBe(true);
  expect(plausibleBattery(101, 3900)).toBe(false);
  expect(plausibleBattery(255, null)).toBe(false);
  expect(plausibleBattery(-1, 3300)).toBe(false);
  expect(plausibleBattery(null, 3300)).toBe(false);
  // 0%: no voltage, 0 mV or clearly not empty is a bad packet.
  expect(plausibleBattery(0, null)).toBe(false);
  expect(plausibleBattery(0, 0)).toBe(false);
  expect(plausibleBattery(0, 3501)).toBe(false);
  expect(plausibleBattery(0, 4100)).toBe(false);
  expect(plausibleBattery(0, 3500)).toBe(true);
  expect(plausibleBattery(0, 3300)).toBe(true);
  expect(batteryReading({ battery_percentage: 40, battery_valid: 0 }, T)).toBeNull();
  expect(batteryReading({ battery_percentage: null, battery_valid: 1 }, T)).toBeNull();
  expect(batteryReading({ battery_percentage: '40', battery_mv: '3800', battery_valid: 1 }, T))
    .toEqual({ percentage: 40, millivolts: 3800, at: T });
});

test('a 0% blip, then 43% again: 43% throughout', () => {
  const packets = [reading(0, 43, 3800), reading(5, 0), reading(10, 43, 3800), reading(15, 43, 3790)];
  expect(after(packets)).toEqual([43, 43, 43, 43]);
  // Kept with its own time, so the card can say how old it is.
  expect(judgeBatteries(packets.slice(0, 2)).accepted).toEqual({ percentage: 43, at: T });
});

test('a real gradual drain is followed packet by packet, down to an empty cell', () => {
  const packets = [reading(0, 25, 3700), reading(60, 21, 3660), reading(120, 20, 3650), reading(180, 12, 3580),
    reading(240, 3, 3520), reading(300, 0, 3400)];
  expect(after(packets)).toEqual([25, 21, 20, 12, 3, 0]);
});

test('a real drop is accepted once 2 packets in a row agree; a lone one is not', () => {
  // 80% → 40% (a 40-point drop): the first packet waits, the second confirms.
  const real = [reading(0, 80, 3950), reading(5, 40, 3720), reading(10, 41, 3725), reading(15, 39, 3718)];
  expect(after(real)).toEqual([80, 80, 41, 39]);
  // A lone 10% between 80s: never shown.
  const lone = [reading(0, 80), reading(5, 10), reading(10, 80), reading(15, 79)];
  expect(after(lone)).toEqual([80, 80, 80, 79]);
  // Two low packets that do not agree (more than a few points apart) restart the count.
  const disagree = [reading(0, 80), reading(5, 40), reading(10, 20), reading(15, 21)];
  expect(after(disagree)).toEqual([80, 80, 80, 21]);
  // A drop of exactly 30 points needs no confirming; a rise never does.
  expect(after([reading(0, 70), reading(5, 40), reading(10, 95)])).toEqual([70, 40, 95]);
  // Bad packets in between neither confirm nor break the run.
  expect(after([reading(0, 80), reading(5, 40), reading(10, 0), reading(15, 255), reading(20, 42)]))
    .toEqual([80, 80, 80, 80, 42]);
});

test('the same packet again (equal or older time) changes nothing; nothing believed yet is null', () => {
  const state = judgeBatteries([reading(0, 80), reading(5, 40)]);
  expect(advanceBattery(state, reading(5, 40))).toBe(state);
  expect(advanceBattery(state, reading(3, 41))).toBe(state);
  expect(judgeBatteries([reading(0, 0), reading(5, 255)])).toMatchObject({ accepted: null, judgedAt: T + 5 * S });
  expect(judgeBatteries([])).toBeNull();
});

// The map, the card and the alerts all take DogMerge's judged reading, which
// HoldStore keeps per dog over the same rows as the hold.
describe('on the map, the card and the alerts', () => {
  const row = (seconds, percentage, millivolts = null, extra = {}) => ({ id: seconds, time: T + seconds * S,
    master_id: 7, slave_id: 4, source: 'ble', latitude: 25, longitude: 121, satellites: 9, hdop: 0.9,
    battery_percentage: percentage, battery_valid: 1, battery_mv: millivolts, ...extra });
  const packet = value => ({ slave_id: 4, master_id: 7, received_at: value.time, slave_lat: 25, slave_lon: 121,
    battery_percentage: value.battery_percentage, battery_valid: value.battery_valid, battery_mv: value.battery_mv,
    source: 'ble', usb_present: 0 });
  const merged = rows => {
    const store = createHoldStore(HOLD_CONFIG, { classify: () => null });
    store.ingest({ rows });
    const last = rows[rows.length - 1];
    return mergeDogMarkers({ packetRows: [packet(last)], batteries: store.batteries(), now: last.time, windowMs: 180000 })[0];
  };
  const fresh = { drawn: true, stale: false, basis: 'position', source: 'ble', lastAt: T };

  test('a 0% packet after 43%: 43% on the card, no 「!」, no alert', () => {
    const dog = merged([row(0, 43, 3800), row(5, 43, 3800), row(10, 0)]);
    expect(dog).toMatchObject({ batteryPercentage: 43, batteryAt: T + 5 * S });
    expect(dogProblems(dog, fresh, null).lowBattery).toBe(false);
    const card = dogCard(dog, { freshness: fresh, now: T + 10 * S, name: '小黑' });
    expect(card.rows.find(item => item.key === 'battery')).toMatchObject({ value: '43%', tone: null });
    const events = updateAlertEvents({}, { dogs: [{ ...dog, name: '小黑' }], now: T + 10 * S });
    expect(Object.keys(events.active ?? {}).filter(key => key.startsWith('dog-battery'))).toEqual([]);
  });

  test('without the dog\'s earlier rows the packet alone still is not believed', () => {
    const dog = mergeDogMarkers({ packetRows: [packet(row(10, 0))], now: T + 10 * S, windowMs: 180000 })[0];
    expect(dog.batteryPercentage).toBeNull();
    expect(dogProblems(dog, fresh, null).lowBattery).toBe(false);
  });

  test('a confirmed drop to 15% is low; an invalid packet is no reading, as before', () => {
    const low = merged([row(0, 60), row(5, 15, 3600), row(10, 15, 3600)]);
    expect(low.batteryPercentage).toBe(15);
    expect(dogProblems(low, fresh, null).lowBattery).toBe(true);
    const events = updateAlertEvents({}, { dogs: [{ ...low, name: '小黑' }], now: T + 10 * S });
    expect(Object.keys(events.active).filter(key => key.startsWith('dog-battery'))).toHaveLength(1);
    const unconfirmed = merged([row(0, 60), row(5, 15, 3600)]);
    expect(unconfirmed.batteryPercentage).toBe(60);
    const invalid = merged([row(0, 60), row(5, 40, null, { battery_valid: 0 })]);
    expect(invalid.batteryPercentage).toBeNull();
  });

  test('the newest live packet is judged on top of the store\'s state', () => {
    const store = createHoldStore(HOLD_CONFIG, { classify: () => null });
    store.ingest({ rows: [row(0, 70), row(5, 70)] });
    const merge = value => mergeDogMarkers({ packetRows: [packet(value)], batteries: store.batteries(),
      now: value.time, windowMs: 180000 })[0].batteryPercentage;
    // The store has not seen this one yet: a lone drop to 20% keeps 70%.
    expect(merge(row(10, 20, 3650))).toBe(70);
    store.ingest({ rows: [row(10, 20, 3650)] });
    expect(merge(row(15, 21, 3655))).toBe(21);
  });

  test('a dog\'s alert snapshot hands the judgement to the background check', () => {
    const { alertSnapshot } = require('../src/alerts/AlertNotifications');
    const dog = merged([row(0, 80), row(5, 40)]);
    const [handed] = alertSnapshot([{ ...dog, fixSource: 'ble', packetSource: 'ble' }]).dogs;
    expect(handed).toMatchObject({ batteryPercentage: 80,
      battery: { accepted: { percentage: 80, at: T }, pending: { percentage: 40, at: T + 5 * S, count: 1 } } });
  });
});

// The background check's battery rule (android .../alerts/BatteryPlausibility.kt)
// is a port of src/tracking/BatteryPlausibility.js. This runs fictional packet
// sequences through the JavaScript and keeps the results in a fixture that
// BatteryPlausibilityParityTest.kt replays through the port (the rule itself,
// and the collar's packets through AlertCodec.readPacket and Dogs.apply).
// After a rule change: UPDATE_BATTERY_PARITY=1 npm test -- BatteryPlausibilityParity
import fs from 'fs';
import path from 'path';
import {
  advanceBattery, batteryReading, BATTERY_AGREE_POINTS, BATTERY_DROP_PACKETS, BATTERY_DROP_POINTS,
  BATTERY_EMPTY_MAX_MV, BATTERY_MAX_PERCENT,
} from '../src/tracking/BatteryPlausibility';

const FIXTURE = path.join(__dirname, '../android/app/src/test/resources/battery-plausibility-parity.json');
const T = 1_760_000_000_000;
const S = 1000;

// [seconds, bp, bmv (null: not sent), bv (default 1)]
const CASES = [
  { name: '0% blip then 43%', packets: [[0, 43, 3800], [5, 0, null], [10, 43, 3800], [15, 43, 3790]] },
  { name: '0% with 0 mV and with a full cell', packets: [[0, 43, 3800], [5, 0, 0], [10, 0, 4100], [15, 42, 3795]] },
  { name: 'real gradual drain to an empty cell',
    packets: [[0, 25, 3700], [60, 21, 3660], [120, 20, 3650], [180, 12, 3580], [240, 3, 3520], [300, 0, 3400]] },
  { name: 'real drop confirmed by 2 packets', packets: [[0, 80, 3950], [5, 40, 3720], [10, 41, 3725], [15, 39, 3718]] },
  { name: 'lone drop between normal packets', packets: [[0, 80, null], [5, 10, null], [10, 80, null], [15, 79, null]] },
  { name: 'drop packets that disagree restart the count', packets: [[0, 80, null], [5, 40, null], [10, 20, null], [15, 21, null]] },
  { name: 'exactly 30 points needs no confirming; a rise never does', packets: [[0, 70, null], [5, 40, null], [10, 95, null]] },
  { name: 'bad packets neither confirm nor break a pending drop',
    packets: [[0, 80, null], [5, 40, null], [10, 0, null], [15, 255, null], [20, 42, null]] },
  { name: 'out of range and invalid readings are no reading',
    packets: [[0, 255, null], [5, 101, null], [10, 50, 3800, 0], [15, 50, 3800]] },
  { name: 'a repeated or older packet changes nothing', packets: [[0, 80, null], [5, 40, null], [5, 40, null], [3, 41, null], [8, 39, null]] },
];

function runCase({ name, packets }) {
  let state = null;
  const steps = packets.map(([seconds, bp, bmv, bv = 1]) => {
    const time = T + seconds * S;
    // The collar's own short keys, as BleForegroundService hands them on.
    const packet = { sid: 4, mid: 7, slat: 24.99, slon: 121.31, bp, bv, ...(bmv == null ? {} : { bmv }) };
    state = advanceBattery(state, batteryReading({ battery_percentage: bp, battery_mv: bmv, battery_valid: bv }, time));
    const valid = batteryReading({ battery_percentage: bp, battery_valid: bv }, time) != null;
    return { time, packet, expect: { state,
      // What Dogs.apply (as DogMerge) shows: none for an invalid packet.
      batteryPercentage: valid && state?.accepted ? Math.round(state.accepted.percentage) : null } };
  });
  return { name, steps };
}

test('the background check judges batteries as the app does (fixture for BatteryPlausibilityParityTest.kt)', () => {
  const result = JSON.stringify({
    constants: { maxPercent: BATTERY_MAX_PERCENT, emptyMaxMillivolts: BATTERY_EMPTY_MAX_MV,
      dropPoints: BATTERY_DROP_POINTS, dropPackets: BATTERY_DROP_PACKETS, agreePoints: BATTERY_AGREE_POINTS },
    cases: CASES.map(runCase),
  }, null, 1) + '\n';
  if (process.env.UPDATE_BATTERY_PARITY) fs.writeFileSync(FIXTURE, result);
  expect(fs.readFileSync(FIXTURE, 'utf8')).toBe(result);
});

test('the cases cover a blip, a drain, a confirmed drop and a refused one', () => {
  const shown = Object.fromEntries(CASES.map(runCase).map(item => [item.name,
    item.steps.map(step => step.expect.batteryPercentage)]));
  expect(shown['0% blip then 43%']).toEqual([43, 43, 43, 43]);
  expect(shown['real gradual drain to an empty cell']).toEqual([25, 21, 20, 12, 3, 0]);
  expect(shown['real drop confirmed by 2 packets']).toEqual([80, 80, 41, 39]);
  expect(shown['lone drop between normal packets']).toEqual([80, 80, 80, 79]);
  expect(shown['out of range and invalid readings are no reading']).toEqual([null, null, null, 50]);
});

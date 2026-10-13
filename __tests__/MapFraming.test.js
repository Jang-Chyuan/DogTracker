import {
  coldStartCoordinates, frameAllCoordinates, framedCoordinates, framePadding, lastKnownPhoneFix, phoneFix,
  regionForFrame, SINGLE_POINT_DEGREES,
} from '../src/map/MapFraming';
import { boxesOverlap, mapButtonsBox, mapControlBoxes, markerBox } from '../src/map/MapBoxes';

const marker = (slaveId, latitude, longitude, extra = {}) => ({ slaveId, name: `狗 ${slaveId}`, tag: `狗 ${slaveId}`,
  size: 40, problem: false, stale: false, source: 'ble', coordinate: { latitude, longitude }, ...extra });
const phone = { latitude: 24.99, longitude: 121.31 };

describe('framing', () => {
  test('the phone counts only with a fix from the last 10 minutes', () => {
    const live = (ageSeconds, extra = {}) => ({ running: true, ageSeconds,
      position: { latitude: 24.99, longitude: 121.31, accuracy: 5 }, ...extra });
    expect(phoneFix(live(1))).toEqual(phone);
    expect(phoneFix(live(600))).toEqual(phone);
    expect(phoneFix(live(601))).toBeNull();
    expect(phoneFix(live(1, { running: false }))).toBeNull();
    expect(phoneFix(live(1, { position: { latitude: NaN, longitude: 121 } }))).toBeNull();
    expect(phoneFix(null)).toBeNull();
  });

  test('cold start frames the local dogs and the phone, never a far cloud dog', () => {
    const local = marker(4, 24.991, 121.312);
    const far = marker(8, 24.9, 121.2, { source: 'cloud', stale: true });
    expect(coldStartCoordinates([local, far], phone)).toEqual([local.coordinate, phone]);
    // 框住全部 takes every dog, however far or old, and the phone.
    expect(frameAllCoordinates([local, far], phone)).toEqual([local.coordinate, far.coordinate, phone]);
  });

  test('a dog stored from another receiver is not local', () => {
    const ours = marker(4, 24.991, 121.312, { masterId: 7 });
    const before = marker(6, 24.95, 121.25, { masterId: 3 });
    expect(coldStartCoordinates([ours, before], phone, 7)).toEqual([ours.coordinate, phone]);
    // Receiver unknown: every BLE dog counts.
    expect(coldStartCoordinates([ours, before], null, null)).toEqual([ours.coordinate, before.coordinate]);
  });

  test('no local dog: only the phone (a small square); no phone either: every dog', () => {
    const cloud = [marker(6, 24.95, 121.25, { source: 'cloud' }), marker(8, 24.96, 121.26, { source: 'cloud' })];
    expect(coldStartCoordinates(cloud, phone)).toEqual([
      { latitude: phone.latitude - SINGLE_POINT_DEGREES, longitude: phone.longitude - SINGLE_POINT_DEGREES },
      { latitude: phone.latitude + SINGLE_POINT_DEGREES, longitude: phone.longitude + SINGLE_POINT_DEGREES },
    ]);
    expect(coldStartCoordinates(cloud, null)).toEqual(cloud.map(item => item.coordinate));
    expect(coldStartCoordinates([], null)).toEqual([]);
    expect(framedCoordinates([])).toEqual([]);
  });

  test('padding leaves 24dp beyond the faces\' "!" and their name tags', () => {
    const small = framePadding([marker(4, 0, 0)]);
    expect(small.top).toBe(47);
    expect(small.bottom).toBeGreaterThan(small.top);
    const big = framePadding([marker(4, 0, 0, { size: 56, tag: '一個很長很長的名字・室內' })]);
    expect(big.top).toBe(52);
    expect(big.left).toBeGreaterThan(small.left);
    expect(big.left).toBe(big.right);
  });
});

test('a framed region puts the points inside the padding, its middle shifted for uneven padding', () => {
  const points = [{ latitude: 25, longitude: 121 }, { latitude: 25.01, longitude: 121.02 }];
  const padding = { top: 50, bottom: 100, left: 60, right: 120 };
  const view = { width: 400, height: 600 };
  const region = regionForFrame(points, padding, view);
  const cos = Math.cos((25.005 * Math.PI) / 180);
  // Project back: degrees → dp from the view's top left.
  const toScreen = point => ({
    x: view.width / 2 + ((point.longitude - region.longitude) * cos / region.latitudeDelta) * view.height,
    y: view.height / 2 - ((point.latitude - region.latitude) / region.latitudeDelta) * view.height,
  });
  for (const point of points) {
    const { x, y } = toScreen(point);
    expect(x).toBeGreaterThanOrEqual(padding.left - 0.01);
    expect(x).toBeLessThanOrEqual(view.width - padding.right + 0.01);
    expect(y).toBeGreaterThanOrEqual(padding.top - 0.01);
    expect(y).toBeLessThanOrEqual(view.height - padding.bottom + 0.01);
  }
  // The wider side fills the padded width exactly.
  expect(toScreen(points[1]).x - toScreen(points[0]).x).toBeCloseTo(400 - 180, 5);
  expect(regionForFrame([], padding, view)).toBeNull();
  expect(regionForFrame(points, padding, { width: 0, height: 0 })).toBeNull();
});

test('E08 a dog under the bottom right buttons or the bottom row counts as covered (its card moves it into view)', () => {
  const selected = { ...marker(2, 0, 0), name: '小黑', tag: '小黑・室內', size: 52, selected: true };
  const view = { width: 392, height: 830, top: 100, bottom: 260 };
  expect(boxesOverlap(markerBox(selected, { x: 345, y: 510 }), mapButtonsBox(view))).toBe(true);
  expect(boxesOverlap(markerBox(selected, { x: 35, y: 305 }), mapButtonsBox(view))).toBe(false);
  expect(mapControlBoxes(view)).toHaveLength(1);
  expect(mapControlBoxes({ ...view, bottomRow: 48 }).some(box =>
    boxesOverlap(markerBox(selected, { x: 160, y: 520 }), box))).toBe(true);
  expect(mapControlBoxes(view).some(box =>
    boxesOverlap(markerBox(selected, { x: 160, y: 520 }), box))).toBe(false);
});

test('the last known phone position frames the cold start only when precise and within the same 10 minutes', () => {
  const at = 1_000_000;
  const known = { latitude: 24.99, longitude: 121.31, accuracy: 12, ageSeconds: 30, receivedAt: at };
  expect(lastKnownPhoneFix(known, at)).toEqual({ latitude: 24.99, longitude: 121.31 });
  // Age keeps counting from when it was read.
  expect(lastKnownPhoneFix(known, at + 570_000)).toEqual({ latitude: 24.99, longitude: 121.31 });
  expect(lastKnownPhoneFix(known, at + 571_000)).toBeNull();
  expect(lastKnownPhoneFix({ ...known, ageSeconds: 601 }, at)).toBeNull();
  // A coarse network guess, no accuracy, or no position: not framed.
  expect(lastKnownPhoneFix({ ...known, accuracy: 101 }, at)).toBeNull();
  expect(lastKnownPhoneFix({ ...known, accuracy: null }, at)).toBeNull();
  expect(lastKnownPhoneFix({ ...known, latitude: 91 }, at)).toBeNull();
  expect(lastKnownPhoneFix({ ...known, ageSeconds: -1 }, at)).toBeNull();
  expect(lastKnownPhoneFix(null, at)).toBeNull();
});

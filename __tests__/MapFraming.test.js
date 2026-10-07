import {
  coldStartCoordinates, frameAllCoordinates, framedCoordinates, framePadding, phoneFix, regionForFrame,
  SINGLE_POINT_DEGREES,
} from '../src/map/MapFraming';
import { edgeHints, edgeHintSpeech, edgeHintWidth } from '../src/map/EdgeHints';
import { overlapMenuHeight, overlapMenuPlace } from '../src/map/OverlapPicker';

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
    expect(small.top).toBe(24 + 20 + 6);
    expect(small.bottom).toBeGreaterThan(small.top);
    const big = framePadding([marker(4, 0, 0, { size: 56, tag: '一個很長很長的名字・室內' })]);
    expect(big.top).toBe(24 + 28 + 6);
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

describe('off-screen hints', () => {
  const view = { width: 400, height: 800, top: 100, bottom: 200 };
  test('dogs on screen get no hint; each side with dogs off it gets one', () => {
    const markers = [marker(1, 0, 0), marker(2, 0, 0), marker(3, 0, 0, { problem: true })];
    const points = { 1: { x: 200, y: 300 }, 2: { x: -50, y: 320 }, 3: { x: 460, y: 300 } };
    const hints = edgeHints(markers, points, view);
    expect(hints.map(hint => [hint.side, hint.slaveIds])).toEqual([['left', [2]], ['right', [3]]]);
    expect(hints[0]).toMatchObject({ x: 8, height: 36, extra: 0 });
    // Where the line from the middle of the visible map (200, 350) to the dog
    // leaves it: x = 0, y = 350 − 30 × 200/250.
    expect(hints[0].y + 18).toBeCloseTo(326, 5);
    expect(hints[1].x + hints[1].width).toBe(392);
  });

  test('at most 3 faces, problems first, then 「+N」', () => {
    const markers = [1, 2, 3, 4, 5].map(id => marker(id, 0, 0, { problem: id === 5 }));
    const points = Object.fromEntries(markers.map(item => [item.slaveId, { x: -100 * item.slaveId, y: 400 }]));
    const [hint] = edgeHints(markers, points, view);
    expect(hint.side).toBe('left');
    expect(hint.faces.map(face => face.slaveId)).toEqual([5, 1, 2]);
    expect(hint.extra).toBe(2);
    expect(hint.width).toBe(edgeHintWidth(3, 2));
    expect(hint.slaveIds).toEqual([5, 1, 2, 3, 4]);
  });

  test('a dog under the card is off screen; the hint stays clear of the buttons', () => {
    // Below the visible map (y > 600), to the right: bottom hint left of the buttons.
    const [bottom] = edgeHints([marker(1, 0, 0)], { 1: { x: 390, y: 700 } }, view);
    expect(bottom.side).toBe('bottom');
    expect(bottom.y).toBe(600 - 8 - 36);
    expect(bottom.x + bottom.width).toBeLessThanOrEqual(400 - 16 - 48 - 12);
    // Off the right, low down: above the two buttons.
    const [right] = edgeHints([marker(1, 0, 0)], { 1: { x: 900, y: 590 } }, view);
    expect(right.side).toBe('right');
    expect(right.y + right.height).toBeLessThanOrEqual(600 - 2 * 48 - 12 - 12);
    // Above the visible map: top hint under the top controls.
    const [top] = edgeHints([marker(1, 0, 0)], { 1: { x: 200, y: -300 } }, view);
    expect(top).toMatchObject({ side: 'top', y: 108 });
  });

  test('TalkBack reads the side, the dogs and which have problems', () => {
    expect(edgeHintSpeech('left', [{ name: '小黑' }, { name: '豆豆', problem: true }]))
      .toBe('左邊畫面外有 2 隻狗：小黑、豆豆，其中豆豆有問題，點兩下移過去');
    expect(edgeHintSpeech('right', [{ name: '阿福' }])).toBe('右邊畫面外有 1 隻狗：阿福，點兩下移過去');
  });

  test('no layout, no hints', () => {
    expect(edgeHints([marker(1, 0, 0)], { 1: { x: -5, y: 5 } }, { width: 0, height: 0 })).toEqual([]);
  });
});

describe('overlap menu placement', () => {
  const screen = { width: 400, height: 800, top: 100, bottom: 0 };
  test('above the tapped face, 240dp wide, inside the screen', () => {
    const place = overlapMenuPlace({ x: 390, y: 500, size: 48 }, 3, screen);
    expect(place.height).toBe(overlapMenuHeight(3));
    expect(place.left).toBe(400 - 8 - 240);
    expect(place.top + place.height).toBe(500 - 24 - 8);
  });
  test('below it when there is no room above; 5 rows at most', () => {
    const place = overlapMenuPlace({ x: 20, y: 150, size: 40 }, 7, screen);
    expect(place.left).toBe(8);
    expect(place.height).toBe(5 * 56 + 16);
    expect(place.top).toBeGreaterThan(150);
  });
});

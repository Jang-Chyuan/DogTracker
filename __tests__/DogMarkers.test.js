import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { dogMarkers, nameTags, tagSize } from '../src/map/DogMarkers';
import { dogProblems } from '../src/tracking/DogProblems';
import DogMarkerView, { markerFrame } from '../src/map/DogMarkerView';
import DogAvatar, { STALE_LINE } from '../src/dogs/DogAvatar';
import { colors } from '../src/theme/tokens';

const NOW = new Date(2026, 9, 7, 9, 30).getTime();
const MINUTE = 60000;
const here = { latitude: 24.99, longitude: 121.31 };
const dog = (slaveId, extra = {}) => ({ slaveId, coordinate: here, fixAt: NOW - 5000, fixSource: 'ble',
  packetAt: NOW - 5000, packetSource: 'ble', batteryPercentage: 80, charging: false, ...extra });
const ALIASES = { 4: '豆豆', 6: '小黑' };
const one = (value, options = {}) => dogMarkers([value], { now: NOW, aliases: ALIASES, ...options })[0];

test('a dog with nothing wrong: 40dp, no badge, only its name', () => {
  expect(one(dog(6))).toMatchObject({ size: 40, problem: false, stale: false, indoor: false,
    tag: '小黑', label: '小黑' });
  // A dog without a name is 「狗 8」.
  expect(one(dog(8)).tag).toBe('狗 8');
});

test('every problem draws the same red "!" and the 48dp face; selection adds 8dp', () => {
  const low = one(dog(6, { batteryPercentage: 15 }));
  expect(low).toMatchObject({ size: 48, problem: true, label: '小黑，電量 15%，偏低' });
  const out = one(dog(6), { ranges: { 6: { status: 'out' } } });
  expect(out).toMatchObject({ size: 48, problem: true, label: '小黑，不在接收範圍' });
  const stale = one(dog(6, { fixAt: NOW - 12 * MINUTE }));
  expect(stale).toMatchObject({ size: 48, problem: true, stale: true });
  const all = one(dog(6, { batteryPercentage: 15, fixAt: NOW - 12 * MINUTE }), { ranges: { 6: { status: 'out' } } });
  expect(all.label).toBe('小黑，電量 15%，偏低，不在接收範圍，沒有新位置，最後 09:18');
  expect(one(dog(6), { selectedId: 6 }).size).toBe(48);
  expect(one(dog(6, { batteryPercentage: 15 }), { selectedId: 6 }).size).toBe(56);
  // Amber 快離開 is a card matter, not a map problem.
  expect(one(dog(6), { ranges: { 6: { status: 'near' } } }).problem).toBe(false);
});

test('charging with a low battery is not a problem, but is read out', () => {
  const charging = one(dog(6, { batteryPercentage: 15, charging: true }));
  expect(charging).toMatchObject({ problem: false, size: 40, label: '小黑，充電中 15%' });
  expect(dogProblems({ batteryPercentage: 20 }, null, null).lowBattery).toBe(true);
  expect(dogProblems({ batteryPercentage: 21 }, null, null).lowBattery).toBe(false);
  expect(dogProblems({ batteryPercentage: null }, null, null).any).toBe(false);
});

test('held indoors: house, 「小黑・室內」 whatever held it, and the full spoken label', () => {
  for (const reason of ['室內', '窗邊', '充電中', 'GPS 沒有定位', 'GPS 訊號弱']) {
    expect(one(dog(6, { heldReason: reason, heldSource: 'good' }))).toMatchObject({
      indoor: true, problem: false, tag: '小黑・室內', label: '小黑・室內' });
  }
  const worst = one(dog(6, { heldReason: '充電中', heldSource: 'good', batteryPercentage: 62, charging: true,
    packetAt: new Date(2026, 9, 7, 9, 5).getTime() }), { ranges: { 6: { status: 'out' } } });
  // The design's example sentence, word for word.
  expect(worst.label).toBe('小黑・室內，充電中 62%，不在接收範圍，沒有新資料，最後 09:05');
  expect(worst).toMatchObject({ indoor: true, stale: true, problem: true, size: 48, tag: '小黑・室內' });
  // Riding along is drawn like any other dog.
  expect(one(dog(6, { heldReason: null, heldSource: 'ride' })).indoor).toBe(false);
});

test('a dog that never had a position is not drawn', () => {
  const markers = dogMarkers([dog(9, { coordinate: null, fixAt: null }), dog(4)], { now: NOW, aliases: ALIASES });
  expect(markers.map(marker => marker.slaveId)).toEqual([4]);
});

describe('name tags that run into each other', () => {
  const markers = (...dogs) => dogMarkers(dogs, { now: NOW, aliases: ALIASES });
  test('apart: each its own tag', () => {
    const list = markers(dog(4), dog(6));
    expect(nameTags(list, { 4: { x: 100, y: 100 }, 6: { x: 300, y: 100 } })).toEqual({
      4: { text: '豆豆', group: 1, problem: false }, 6: { text: '小黑', group: 1, problem: false } });
  });
  test('overlapping: one 「3 隻」 tag under the lowest face, with a red dot for any problem', () => {
    const list = markers(dog(4), dog(6, { batteryPercentage: 10 }), dog(8));
    const tags = nameTags(list, { 4: { x: 100, y: 100 }, 6: { x: 110, y: 104 }, 8: { x: 120, y: 112 } });
    expect(tags).toEqual({ 4: null, 6: null, 8: { text: '3 隻', group: 3, problem: true, members: [4, 6, 8] } });
  });
  test('all held indoors: 「2 隻・室內」; one not held: just 「2 隻」', () => {
    const held = extra => dog(extra, { heldReason: '室內', heldSource: 'good' });
    const points = { 4: { x: 100, y: 100 }, 6: { x: 104, y: 102 } };
    expect(nameTags(markers(held(4), held(6)), points)[6]).toEqual({ text: '2 隻・室內', group: 2, problem: false, members: [4, 6] });
    expect(nameTags(markers(held(4), dog(6)), points)[6].text).toBe('2 隻');
  });
  test('the selected dog keeps its own tag and leaves the group; a group of one is no group', () => {
    const list = dogMarkers([dog(4), dog(6)], { now: NOW, aliases: ALIASES, selectedId: 6 });
    expect(nameTags(list, { 4: { x: 100, y: 100 }, 6: { x: 104, y: 100 } })).toEqual({
      4: { text: '豆豆', group: 1, problem: false }, 6: { text: '小黑', group: 1, problem: false } });
  });
  test('chains merge, and without screen positions every dog keeps its tag', () => {
    const list = markers(dog(4), dog(6), dog(8));
    const width = tagSize('豆豆').width;
    const chain = nameTags(list, { 4: { x: 100, y: 100 }, 6: { x: 100 + width - 4, y: 100 },
      8: { x: 100 + 2 * width - 8, y: 100 } });
    expect(Object.values(chain).filter(Boolean)).toEqual([{ text: '3 隻', group: 3, problem: false, members: [4, 6, 8] }]);
    expect(Object.values(nameTags(list, {})).every(tag => tag.group === 1)).toBe(true);
  });
  test('tags grow with the font size', () => {
    expect(tagSize('小黑', 2).height).toBeGreaterThan(tagSize('小黑').height);
    expect(tagSize('小黑').width).toBeGreaterThan(tagSize('ab').width);
  });
});

describe('the marker view', () => {
  const render = async element => {
    let renderer;
    await act(async () => { renderer = Renderer.create(element); });
    return renderer;
  };
  const byId = (renderer, id) => renderer.root.findAll(node => node.props.testID === id && typeof node.type === 'string');
  test('badges: red "!" top right for a problem, house bottom left when held; grey face when stale', async () => {
    const marker = one(dog(6, { heldReason: '室內', heldSource: 'good', packetAt: NOW - 30 * MINUTE }));
    const renderer = await render(<DogMarkerView marker={marker} tag={{ text: marker.tag, group: 1 }} />);
    const problem = byId(renderer, 'dog-badge-problem');
    const house = byId(renderer, 'dog-badge-indoor');
    expect(problem).toHaveLength(1);
    expect(house).toHaveLength(1);
    const style = node => Object.assign({}, ...[node.props.style].flat(3).filter(Boolean));
    expect(style(problem[0])).toMatchObject({ top: -6, right: -6, backgroundColor: colors.problemBadge, width: 16 });
    // Left, 6dp out of the 48dp face, centred a quarter of the face below its centre.
    expect(style(house[0])).toMatchObject({ top: 28, left: -6, backgroundColor: colors.receiver });
    expect(byId(renderer, 'dog-avatar-classic-stale')).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('小黑・室內');
  });
  test('a group tag instead of a name, no tag at all for the others', async () => {
    const marker = one(dog(6));
    const group = await render(<DogMarkerView marker={marker} tag={{ text: '3 隻', group: 3, problem: true }} />);
    expect(byId(group, 'dog-group-tag')).toHaveLength(1);
    expect(byId(group, 'dog-group-problem')).toHaveLength(1);
    const none = await render(<DogMarkerView marker={marker} tag={null} />);
    expect(byId(none, 'dog-name-tag')).toHaveLength(0);
    expect(byId(none, 'dog-group-tag')).toHaveLength(0);
  });
  test('the anchor is the centre of the face, whatever its size', () => {
    for (const size of [40, 48, 56]) {
      const frame = markerFrame(size);
      expect(frame.anchor.x).toBe(0.5);
      expect(frame.anchor.y * frame.height).toBeCloseTo(8 + size / 2);
    }
  });
  test('the default face is the coral illustration; stale turns it staleFace with darker lines', async () => {
    const fresh = await render(<DogAvatar size={40} />);
    const circles = renderer => renderer.root.findAll(node => node.props.testID === 'svg-circle' && node.props.r === 46 && node.props.fill);
    expect(circles(fresh)[0].props.fill).toBe(colors.accent);
    const stale = await render(<DogAvatar size={40} stale />);
    expect(circles(stale)[0].props.fill).toBe(colors.staleFace);
    expect(stale.root.findAll(node => node.props.testID === 'svg-ellipse')[0].props.fill).toBe(STALE_LINE);
  });
});

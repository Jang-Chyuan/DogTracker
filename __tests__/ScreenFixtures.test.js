import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Linking } from 'react-native';
import { buildFixture, FIXTURE_NAMES, fixtureNameFromUrl } from '../src/dev/ScreenFixtures';
import { useScreenFixture } from '../src/dev/useScreenFixture';
import { describeCloud, describeReceiver } from '../src/map/HomeStatus';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { dogFreshness } from '../src/map/DogFreshness';

const NOW = Date.parse('2026-10-02T01:00:00Z');

test('only well-formed fixture links are accepted', () => {
  expect(fixtureNameFromUrl('dogtracker://dev/fixture?name=dogs-aged')).toBe('dogs-aged');
  expect(fixtureNameFromUrl('dogtracker://dev/fixture?name=off')).toBe('off');
  expect(fixtureNameFromUrl('dogtracker://dev/fixture?name=nope')).toBeNull();
  expect(fixtureNameFromUrl('https://example.com/?name=dogs-aged')).toBeNull();
  expect(fixtureNameFromUrl(null)).toBeNull();
});

test('each fixture puts the screen in the state it is named after', async () => {
  const state = async name => {
    const fixture = buildFixture(name, NOW);
    return {
      receiver: describeReceiver(await fixture.readReceiverState.getState(), NOW),
      cloud: describeCloud(fixture.cloudSync, NOW),
      dogs: mergeDogMarkers({ point: {}, cloudRows: fixture.cloudDogs.rows,
        packetRows: fixture.cloudDogs.packets, now: NOW, windowMs: 120000 }),
    };
  };
  expect((await state('all-good')).receiver.show).toBe(false);
  expect((await state('all-good')).cloud.show).toBe(false);
  expect((await state('receiver-disconnected')).receiver.alert.title).toBe('接收器 7 已斷線');
  expect((await state('receiver-quiet')).receiver.label).toBe('接收器 7｜已連線・無新資料');
  const failing = await state('no-receiver-cloud-failing');
  expect([failing.receiver.label, failing.cloud.label]).toEqual(['接收器｜未連接', '雲端｜同步失敗']);
  const aged = (await state('dogs-aged')).dogs.map(dog => [dog.slaveId, dogFreshness(dog, NOW).tier]);
  expect(aged).toEqual([[4, 'fresh'], [6, 'recent'], [8, 'old']]);
  expect(FIXTURE_NAMES).toHaveLength(5);
});

test('outside debug builds the hook never listens and never returns a fixture', async () => {
  const listen = jest.spyOn(Linking, 'addEventListener');
  let result;
  function Probe() {
    result = useScreenFixture(false);
    return null;
  }
  await act(async () => { Renderer.create(<Probe />); });
  expect(result).toBeNull();
  expect(listen).not.toHaveBeenCalled();
  listen.mockRestore();
});

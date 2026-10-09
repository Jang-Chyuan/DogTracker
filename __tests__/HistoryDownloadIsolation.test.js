import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { buildFixture } from '../src/dev/ScreenFixtures';
import { useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import { dayKey } from '../src/history/screen/HistoryScreenDates';

test('K12: adding a cloud-only dog downloads it despite another dog having the day locally; failed dog can retry', async () => {
  const fixture = buildFixture('history-multi-dog');
  const day = dayKey(new Date(fixture.now));
  let downloaded = false, fail = true, screen;
  const read = async request => {
    if (request.slaveId === 4 || downloaded) {
      const result = await fixture.history.readDay({ ...request, slaveId: 4 });
      return { ...result, rows: result.rows.map(row => ({ ...row, slave_id: request.slaveId })) };
    }
    return { rows: [], seed: [], after: { done: true } };
  };
  const readDays = async ({ slaveId }) => slaveId === 4 || downloaded ? [day] : [];
  const cloud = { owner: 'a', download: jest.fn(async ({ slaveId, onDogEnd }) => {
    expect(slaveId).toEqual([6]);
    if (fail) { onDogEnd(6, 'failed'); throw new Error('offline'); }
    downloaded = true; onDogEnd(6, 'done');
  }) };
  function Probe() {
    screen = useHistoryScreen({ target: { subject: 'dog', slaveId: 4 }, read, readDays, cloud, owner: 'a',
      clock: () => fixture.now, memoryScope: 'K12-isolation' });
    return null;
  }
  let renderer;
  await act(async () => { renderer = Renderer.create(<Probe />); });
  await act(async () => screen.addDog({ id: 6 }));
  expect(cloud.download).toHaveBeenCalledTimes(1);
  expect(screen.dogs.find(dog => dog.id === 6).downloadFailed).toBe(true);
  fail = false;
  await act(async () => screen.selectDog(6));
  expect(cloud.download).toHaveBeenCalledTimes(2);
  expect(screen.dogs.find(dog => dog.id === 6).downloadFailed).toBe(false);
  expect(screen.dogs.find(dog => dog.id === 6).hasData).toBe(true);
  await act(async () => renderer.unmount());
});

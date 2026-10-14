import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useOlderHistoryDogs } from '../src/mapHistory/useOlderHistoryDogs';

// Audit F4: the live map's cloud roster is bounded to 14 days, so a dog last
// heard earlier is no longer on the map. The history's 「＋ 加入」 still
// offers it on the days it has rows.
function Probe({ observe, ...props }) {
  observe(useOlderHistoryDogs(props));
  return null;
}

async function render(props) {
  const seen = [];
  let screen;
  await act(async () => { screen = Renderer.create(<Probe observe={value => seen.push(value)} {...props} />); });
  return { seen, screen, update: async next => act(async () => screen.update(<Probe observe={value => seen.push(value)} {...props} {...next} />)) };
}

test('older dogs with rows on the day shown are offered; dogs on the map and days without rows are not', async () => {
  const checkDay = jest.fn(async id => id !== 40);
  const { seen, update, screen } = await render({ active: true, knownDogs: [4, 9, 31, 40], mapDogIds: [4, 31],
    checkDay, day: '2026-10-01' });
  expect(seen.at(-1)).toEqual([9]);
  expect(checkDay.mock.calls.map(([id]) => id)).toEqual([9, 40]);
  // Another day: checked again; nothing is offered until it is.
  checkDay.mockImplementation(async id => id === 40);
  await update({ day: '2026-10-02' });
  expect(seen).toContainEqual([]);
  expect(seen.at(-1)).toEqual([40]);
  // A failed check never offers a dog it could not confirm.
  checkDay.mockImplementation(async () => { throw new Error('read failed'); });
  await update({ day: '2026-10-03' });
  expect(seen.at(-1)).toEqual([]);
  screen.unmount();
});

test('closed history or no older dogs: no checks at all', async () => {
  const checkDay = jest.fn(async () => true);
  const closed = await render({ active: false, knownDogs: [9], mapDogIds: [], checkDay, day: '2026-10-01' });
  const none = await render({ active: true, knownDogs: [4], mapDogIds: [4], checkDay, day: '2026-10-01' });
  expect(closed.seen.at(-1)).toEqual([]);
  expect(none.seen.at(-1)).toEqual([]);
  expect(checkDay).not.toHaveBeenCalled();
  closed.screen.unmount();
  none.screen.unmount();
});

import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useRangeRecompute, RANGE_RECOMPUTE_DELAY_MS } from '../src/mapHistory/useRangeRecompute';

let tree, state;
function Probe({ scope = 'day-1', active = true }) {
  state = useRangeRecompute(scope, active);
  return null;
}
beforeEach(async () => {
  jest.useFakeTimers();
  await act(async () => { tree = Renderer.create(<Probe />); });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  jest.useRealTimers();
});
test('busy publication precedes calculation; rapid newer release replaces queued preview exactly once', async () => {
  const preview = jest.fn(), release = jest.fn();
  await act(async () => state.request(preview));
  expect(state.pending).toBe(true);
  expect(preview).not.toHaveBeenCalled();
  await act(async () => state.request(release));
  await act(async () => jest.advanceTimersByTimeAsync(RANGE_RECOMPUTE_DELAY_MS));
  expect(preview).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(1);
  expect(state.pending).toBe(false);
});
test.each(['date', 'blur', 'cancel', 'unmount'])('%s prevents stale range publication', async kind => {
  const publish = jest.fn();
  await act(async () => state.request(publish));
  await act(async () => {
    if (kind === 'date') tree.update(<Probe scope="day-2" />);
    else if (kind === 'blur') tree.update(<Probe active={false} />);
    else if (kind === 'cancel') state.cancel();
    else tree.unmount();
  });
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(publish).not.toHaveBeenCalled();
  if (kind !== 'unmount') expect(state.pending).toBe(false);
});


test('a callback retained from the old scope cannot enqueue work against the new date/owner', async () => {
  const oldRequest = state.request;
  const publish = jest.fn();
  await act(async () => tree.update(<Probe scope="new-owner-day" />));
  await act(async () => oldRequest(publish));
  expect(state.pending).toBe(false);
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(publish).not.toHaveBeenCalled();
});

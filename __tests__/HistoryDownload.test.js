import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useHistoryDownload } from '../src/mapHistory/useHistoryDownload';
import { downloadCloudHistory } from '../src/cloud/CloudDownload';

jest.mock('../src/cloud/CloudDownload', () => ({ downloadCloudHistory: jest.fn() }));

const START = Date.parse('2026-09-17T00:00:00+08:00');
const END = Date.parse('2026-09-18T00:00:00+08:00');

let renderer;
let hook;
function Probe(props) {
  hook = useHistoryDownload(props);
  return <Text>{hook.message}</Text>;
}
async function mount(props = {}) {
  await act(async () => {
    renderer = Renderer.create(<Probe
      database={{ initialize: jest.fn(async () => {}) }}
      owner="account-a"
      clientFactory={() => ({ from: jest.fn() })}
      {...props} />);
  });
}
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  downloadCloudHistory.mockReset();
});

test('the card downloads the range itself, one request per chosen Master', async () => {
  downloadCloudHistory.mockImplementation(async ({ onProgress }) => { onProgress(400); return 400; });
  const runManual = jest.fn(async work => work(() => true));
  await mount({ sync: { runManual } });
  await act(async () => {
    await hook.run({ startAt: START, endAt: END, masters: [5, 7] });
  });
  // Asking for "every authorised Master" would drag down Masters the user did
  // not pick, so each chosen one is its own request.
  expect(downloadCloudHistory).toHaveBeenCalledTimes(2);
  expect(downloadCloudHistory.mock.calls.map(([call]) => call.masterId)).toEqual([5, 7]);
  expect(downloadCloudHistory.mock.calls[0][0]).toMatchObject({
    owner: 'account-a',
    startAt: new Date(START).toISOString(),
    endBefore: new Date(END).toISOString(),
  });
  // Borrowing the automatic sync's slot is what stops the two racing.
  expect(runManual).toHaveBeenCalledTimes(2);
  expect(hook.busy).toBe(false);
  expect(hook.message).toContain('800 筆');
});

test('an empty answer says so, and a failure keeps what was written', async () => {
  downloadCloudHistory.mockResolvedValue(0);
  await mount();
  await act(async () => { await hook.run({ startAt: START, endAt: END, masters: [7] }); });
  expect(hook.message).toContain('沒有這幾台 Master 的資料');
  downloadCloudHistory.mockRejectedValue(new Error('下載已取消'));
  await act(async () => { await hook.run({ startAt: START, endAt: END, masters: [7] }); });
  expect(hook.message).toContain('已完成的部分留著');
  expect(hook.busy).toBe(false);
});

test('nothing is asked without an account, a database, or a real range', async () => {
  await mount({ owner: null });
  await act(async () => { await hook.run({ startAt: START, endAt: END, masters: [7] }); });
  await mount({ database: null });
  await act(async () => { await hook.run({ startAt: START, endAt: END, masters: [7] }); });
  await mount();
  await act(async () => { await hook.run({ startAt: END, endAt: START, masters: [7] }); });
  expect(downloadCloudHistory).not.toHaveBeenCalled();
});

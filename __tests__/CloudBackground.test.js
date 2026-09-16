import { createCloudExecution } from '../src/cloud/CloudExecution';
import { cloudKeepAlive } from '../src/cloud/CloudBackground';

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
function fixture(nativeEnabled = true) {
  const client = { auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } };
  const sync = { setForeground: jest.fn(), setSession: jest.fn() };
  const native = nativeEnabled ? { start: jest.fn(async () => true), stop: jest.fn() } : null;
  const states = jest.fn();
  const execution = createCloudExecution({ client, sync, native, onState: states });
  return { client, sync, native, states, execution };
}
const user = { user: { id: 'account-a' } };

test('native service keeps the same scheduler and auth refresh enabled after backgrounding', async () => {
  const { execution, sync, client, native, states } = fixture();
  execution.setForeground(true); execution.setSession(user); await flush();
  expect(native.start).toHaveBeenCalledTimes(1);
  execution.setForeground(false);
  expect(sync.setForeground).toHaveBeenLastCalledWith(true);
  expect(states).toHaveBeenLastCalledWith({ backgroundEnabled: true, backgroundError: '' });
  expect(client.auth.stopAutoRefresh).not.toHaveBeenCalled();
  execution.setForeground(true); execution.setSession(user); await flush();
  expect(native.start).toHaveBeenCalledTimes(1);
  execution.setForeground(false); execution.setSession(null);
  expect(native.stop).toHaveBeenCalledTimes(1);
  expect(sync.setForeground).toHaveBeenLastCalledWith(false);
  expect(client.auth.stopAutoRefresh).toHaveBeenCalled();
  execution.dispose();
});

test('a denied service start uses foreground-only sync; no illegal background start', async () => {
  const { execution, sync, native, states } = fixture();
  native.start.mockRejectedValue(new Error('not allowed'));
  execution.setSession(user); await flush();
  expect(native.start).not.toHaveBeenCalled();
  execution.setForeground(true); await flush();
  expect(sync.setForeground).toHaveBeenLastCalledWith(true);
  expect(states.mock.calls.at(-1)[0].backgroundError).toContain('啟動失敗');
  execution.setForeground(false);
  expect(sync.setForeground).toHaveBeenLastCalledWith(false);
  execution.dispose();
});

test('Android timeout stops background sync and returns to foreground to restart', async () => {
  const { execution, sync, native } = fixture();
  execution.setForeground(true); execution.setSession(user); await flush();
  execution.setForeground(false);
  execution.stopped({ reason: 'timeout' });
  expect(sync.setForeground).toHaveBeenLastCalledWith(false);
  expect(native.start).toHaveBeenCalledTimes(1);
  execution.setForeground(true); await flush();
  expect(native.start).toHaveBeenCalledTimes(2);
  execution.dispose();
});

test('logout while starting cannot leave an orphan background service', async () => {
  const { execution, native, states } = fixture();
  let complete;
  native.start.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  execution.setForeground(true); execution.setSession(user); await flush();
  execution.setSession(null); complete(true); await flush();
  expect(native.stop).toHaveBeenCalledTimes(2);
  expect(states.mock.calls.at(-1)[0].backgroundEnabled).toBe(false);
  execution.dispose();
});

test('platforms without the Android service retain foreground-only scheduling', async () => {
  const { execution, sync } = fixture(false);
  execution.setForeground(true); execution.setSession(user); await flush();
  execution.setForeground(false);
  expect(sync.setForeground).toHaveBeenLastCalledWith(false);
  execution.dispose();
});

test('headless task stays alive until its service stops; stale tasks exit', async () => {
  let callback;
  const remove = jest.fn();
  const events = { addListener: jest.fn((_name, listener) => { callback = listener; return { remove }; }) };
  const finished = jest.fn();
  const running = cloudKeepAlive({ runId: 'one' }, { getRunId: async () => 'one' }, events).then(finished);
  await flush(); expect(finished).not.toHaveBeenCalled();
  callback({ runId: 'other' }); await flush(); expect(finished).not.toHaveBeenCalled();
  callback({ runId: 'one' }); await running; expect(remove).toHaveBeenCalled();
  await cloudKeepAlive({ runId: 'old' }, { getRunId: async () => null }, events);
  expect(remove).toHaveBeenCalledTimes(2);
});

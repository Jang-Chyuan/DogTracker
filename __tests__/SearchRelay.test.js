import { runSearchRelay } from '../src/cloudUpload/SearchRelay';
import { createUploadDatabase } from '../src/cloudUpload/UploadDatabase';
import { createUploadService } from '../src/cloudUpload/UploadService';
jest.mock('../src/cloudUpload/UploadDatabase', () => ({ createUploadDatabase: jest.fn() }));
jest.mock('../src/cloudUpload/UploadService', () => ({ createUploadService: jest.fn() }));

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });
function setup() {
  let authChanged;
  const unsubscribe = jest.fn(), close = jest.fn();
  const native = { isSearchCurrent: jest.fn(async () => true), completeSearch: jest.fn() };
  const run = jest.fn(async () => 'idle');
  createUploadDatabase.mockReturnValue({});
  createUploadService.mockReturnValue({ run });
  const deps = { native, connectionFactory: () => ({ close }), clientFactory: () => ({
    auth: { onAuthStateChange: fn => { authChanged = fn; return { data: { subscription: { unsubscribe } } }; } },
  }) };
  return { native, run, close, unsubscribe,
    logout: () => authChanged('SIGNED_OUT', null),
    start: () => runSearchRelay({ owner: 'a', runId: 'r' }, deps) };
}
test('search relay runs without foreground UI and releases resources', async () => {
  const f = setup(); await f.start();
  expect(f.run).toHaveBeenCalledWith('a', expect.any(Function), expect.objectContaining({ signal: expect.anything() }));
  expect(f.native.completeSearch).toHaveBeenCalledWith('r');
  expect(f.close).toHaveBeenCalled(); expect(f.unsubscribe).toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test.each(['logout', 'stopped', 'deadline'])('%s cancels search uploads and cleans timers', async why => {
  const f = setup(); let signal;
  f.run.mockImplementation((_, alive, options) => new Promise(resolve => {
    signal = options.signal; signal.addEventListener('abort', resolve, { once: true });
  }));
  const task = f.start(); await jest.advanceTimersByTimeAsync(1);
  if (why === 'logout') f.logout();
  if (why === 'stopped') f.native.isSearchCurrent.mockResolvedValue(false);
  await jest.advanceTimersByTimeAsync(why === 'deadline' ? 25000 : 1000);
  await task;
  expect(signal.aborted).toBe(true);
  expect(f.native.completeSearch).toHaveBeenCalledWith('r');
  expect(jest.getTimerCount()).toBe(0);
});
test('stale native task never opens the upload database', async () => {
  const f = setup(); f.native.isSearchCurrent.mockResolvedValue(false);
  await f.start(); expect(f.run).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
});

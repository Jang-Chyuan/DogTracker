import { createCloudSessionGate } from '../src/cloud/CloudSession';
import { cloudError, isAuthFailure, isNetworkFailure } from '../src/cloud/CloudErrors';

const OWNER = 'invented-gate-owner';
const session = (id = OWNER) => ({ access_token: `invented-${id}`, user: { id } });
const retryable = () => Object.assign(new Error('Network request failed'), { name: 'AuthRetryableFetchError', status: 0 });
const refused = () => Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'),
  { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' });
const gate = (auth, extra = {}) => createCloudSessionGate({ auth, owner: OWNER, check: () => {}, ...extra });
const refusal = () => cloudError('invented membership refused', { code: 'PGRST303', message: 'JWT expired' }, 401);
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('a client without an auth object (or no stored session) is not gated', async () => {
  await expect(gate(undefined).ready()).resolves.toBeNull();
  await expect(gate({ getSession: async () => ({ data: { session: null }, error: null }) }).ready()).resolves.toBeNull();
});

test('another account\'s session cancels instead of authorizing this owner', async () => {
  const auth = { getSession: jest.fn(async () => ({ data: { session: session('invented-other') }, error: null })) };
  await expect(gate(auth).ready()).rejects.toThrow('下載已取消');
});

test('a refused refresh is an auth failure at once, without waiting', async () => {
  const auth = { getSession: jest.fn(async () => ({ data: { session: null }, error: refused() })) };
  const error = await gate(auth).ready().catch(value => value);
  expect(isAuthFailure(error)).toBe(true);
  expect(auth.getSession).toHaveBeenCalledTimes(1);
});

test('a refresh that never succeeds within the wait is a connection failure, not auth', async () => {
  const auth = { getSession: jest.fn(async () => ({ data: { session: null }, error: retryable() })) };
  const pending = gate(auth, { waitMs: 10000, pollMs: 2000 }).ready().catch(value => value);
  await jest.advanceTimersByTimeAsync(10000);
  const error = await pending;
  expect(isAuthFailure(error)).toBe(false); expect(isNetworkFailure(error)).toBe(true);
  expect(auth.getSession).toHaveBeenCalledTimes(6);
});

test('a transient failure followed by a session proceeds within the same call', async () => {
  const auth = { getSession: jest.fn()
    .mockResolvedValueOnce({ data: { session: null }, error: retryable() })
    .mockResolvedValueOnce({ data: { session: session() }, error: null }) };
  const pending = gate(auth).ready();
  await jest.advanceTimersByTimeAsync(2000);
  expect(await pending).toEqual(session());
});

test('a hung SDK call is bounded by the wait', async () => {
  const auth = { getSession: jest.fn(() => new Promise(() => {})) };
  const pending = gate(auth, { waitMs: 5000 }).ready().catch(value => value);
  await jest.advanceTimersByTimeAsync(5000);
  expect(isNetworkFailure(await pending)).toBe(true);
});

test('a 401 is refreshed and repeated only once per gate', async () => {
  const auth = { refreshSession: jest.fn(async () => ({ data: { session: session() }, error: null })) };
  const subject = gate(auth);
  const work = jest.fn(async () => { throw refusal(); });
  expect(isAuthFailure(await subject.retryRefused(work).catch(value => value))).toBe(true);
  expect(work).toHaveBeenCalledTimes(2); expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(isAuthFailure(await subject.retryRefused(work).catch(value => value))).toBe(true);
  expect(work).toHaveBeenCalledTimes(3); expect(auth.refreshSession).toHaveBeenCalledTimes(1);
});

test('after a 401, a refresh that cannot reach Supabase reports the connection, a refused one the 401', async () => {
  const offline = gate({ refreshSession: async () => ({ data: { session: null }, error: retryable() }) });
  const error = await offline.retryRefused(async () => { throw refusal(); }).catch(value => value);
  expect(isAuthFailure(error)).toBe(false); expect(isNetworkFailure(error)).toBe(true);
  const original = refusal();
  const denied = gate({ refreshSession: async () => ({ data: { session: null }, error: refused() }) });
  expect(await denied.retryRefused(async () => { throw original; }).catch(value => value)).toBe(original);
  const switched = gate({ refreshSession: async () => ({ data: { session: session('invented-other') }, error: null }) });
  await expect(switched.retryRefused(async () => { throw refusal(); })).rejects.toThrow('下載已取消');
});

test('non-auth failures are never retried', async () => {
  const auth = { refreshSession: jest.fn() };
  const failure = new Error('invented server error');
  await expect(gate(auth).retryRefused(async () => { throw failure; })).rejects.toBe(failure);
  expect(auth.refreshSession).not.toHaveBeenCalled();
});

import { listCloudMasters } from '../src/cloud/CloudIncremental';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function membership(read) {
  const calls = [];
  const client = { from: table => {
    const query = {}, call = { table };
    for (const method of ['select', 'eq', 'order', 'range']) query[method] = (...args) => {
      if (method === 'range') call.range = args;
      return query;
    };
    query.abortSignal = signal => { call.signal = signal; calls.push(call); return read(calls.length, call); };
    return query;
  } };
  return { client, calls };
}

test('ignored transport abort releases logical membership immediately and rejects late authority', async () => {
  const held = deferred(), abort = new AbortController();
  const f = membership(() => held.promise), check = jest.fn(() => {});
  const result = listCloudMasters(f.client, 'fiction-owner', abort.signal, check);
  const rejection = result.then(() => { throw new Error('expected cancellation'); }, error => expect(error).toBeInstanceOf(Error));
  await Promise.resolve(); expect(f.calls).toHaveLength(1);
  abort.abort(); await rejection;
  held.resolve({ data: [{ gateway_id: 'master_7' }] }); await Promise.resolve();
  expect(f.calls).toHaveLength(1);
});

test('ignored late transport rejection has a handler after membership is canceled', async () => {
  const held = deferred(), abort = new AbortController(), f = membership(() => held.promise);
  const result = listCloudMasters(f.client, 'fiction-owner', abort.signal, () => {});
  const rejection = result.then(() => { throw new Error('expected cancellation'); }, error => expect(error).toBeInstanceOf(Error));
  await Promise.resolve(); abort.abort(); await rejection;
  held.reject(new Error('private synthetic transport error')); await Promise.resolve();
  expect(f.calls).toHaveLength(1);
});

test('complete membership keeps serial 500-row pages; a full page reads on, a short page ends it', async () => {
  const page = Array.from({ length: 500 }, (_, i) => ({ gateway_id: `master_${i % 2 ? 7 : 17}`, slave_id: i }));
  const f = membership(async n => ({ data: n === 1 ? page : n === 2 ? [{ gateway_id: 'master_27', slave_id: 999 }] : [] }));
  expect(await listCloudMasters(f.client, 'fiction-owner', undefined, () => {})).toEqual([17, 7, 27]);
  // Before: a third request for the terminal empty page at [501, 1000].
  expect(f.calls.map(call => call.range)).toEqual([[0, 499], [500, 999]]);
});

test('a typical account reads its membership in one request, and an empty list in one', async () => {
  const f = membership(async () => ({ data: [{ gateway_id: 'master_7', slave_id: 4 }, { gateway_id: 'master_7', slave_id: 6 }] }));
  expect(await listCloudMasters(f.client, 'fiction-owner', undefined, () => {})).toEqual([7]);
  expect(f.calls).toHaveLength(1);
  const none = membership(async () => ({ data: [] }));
  expect(await listCloudMasters(none.client, 'fiction-owner', undefined, () => {})).toEqual([]);
  expect(none.calls).toHaveLength(1);
});

test('an exactly full last membership page still needs the empty page to prove the end', async () => {
  const page = Array.from({ length: 500 }, (_, i) => ({ gateway_id: 'master_7', slave_id: i }));
  const f = membership(async n => ({ data: n === 1 ? page : [] }));
  expect(await listCloudMasters(f.client, 'fiction-owner', undefined, () => {})).toEqual([7]);
  expect(f.calls.map(call => call.range)).toEqual([[0, 499], [500, 999]]);
});

test('already canceled membership never issues an SDK query', async () => {
  const abort = new AbortController(); abort.abort(); const f = membership(() => Promise.resolve({ data: [] }));
  await expect(listCloudMasters(f.client, 'fiction-owner', abort.signal, () => {})).rejects.toThrow();
  expect(f.calls).toEqual([]);
});

test('scope guard rejects the original error and removes the listener after a successful SDK response', async () => {
  const abort = new AbortController(), remove = jest.spyOn(abort.signal, 'removeEventListener');
  const failure = new Error('synthetic scope mismatch'), f = membership(async () => ({ data: [] }));
  let checks = 0;
  await expect(listCloudMasters(f.client, 'fiction-owner', abort.signal, () => {
    if (++checks === 2) throw failure;
  })).rejects.toBe(failure);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(f.calls).toHaveLength(1);
});

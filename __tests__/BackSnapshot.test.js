import { captureBackSnapshot, backSnapshot } from '../src/alerts/BackSnapshot';
const dog = { id: 8, name: '豆豆', coordinate: { latitude: 25, longitude: 121 }, fixAt: 0, fixSource: 'ble' };
const range = { key: 'range', kind: 'dog-out-of-range', subject: 8, name: '豆豆', startedAt: 150, severity: 5 };
const capture = (now, active = [], dogs = [dog]) => captureBackSnapshot({ now, active, dogs });

test('checkpoint detached, serializable, shares freshness and range rules', () => {
  const active = [{ ...range }];
  const snapshot = captureBackSnapshot({ now: 700000, active, dogs: [{ ...dog, range: { status: 'out' } }] });
  active[0].name = 'changed';
  expect(snapshot.active[0].name).toBe('豆豆');
  expect(snapshot.dogs[0].problems.stale).toBe(true);
  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
});
test('nothing for first return, identical state, backwards time, ordinary position updates or hidden battery latch', () => {
  expect(backSnapshot(null, capture(200))).toBeNull();
  expect(backSnapshot(capture(200), capture(100))).toBeNull();
  expect(backSnapshot(capture(100), capture(200, [], [{ ...dog, fixAt: 200 }]))).toBeNull();
  expect(backSnapshot(capture(100), capture(200, [{ ...range, present: false }]))).toBeNull();
});
test('new, escalated and recovered problems grouped per dog; active before resolved', () => {
  const low = { ...range, key: 'low', kind: 'dog-battery', percentage: 20, level: 1, startedAt: 50 };
  const before = capture(100, [low]);
  const after = capture(200, [range]);
  const result = backSnapshot(before, after);
  expect(result.items.map(item => item.status)).toEqual(['active', 'resolved']);
  expect(result.dogs[0].items).toHaveLength(2);
  expect(result.target.destination.dogId).toBe(8);
  expect(backSnapshot(before, capture(200, [low]))).toBeNull();
  expect(backSnapshot(before, capture(200, [{ ...low, percentage: 10, level: 2 }])).items[0].text).toBe('豆豆 電量低 10%');
  expect(backSnapshot(capture(100, [range]), capture(200, [{ ...range, startedAt: 180 }])).items).toHaveLength(1);
});
test('journal preserves transient away problems, excludes window boundaries and duplicates', () => {
  const events = [{ ...range, type: 'start', at: 150 }, { ...range, type: 'clear', at: 180 }];
  expect(backSnapshot(capture(100), capture(200), events).items).toHaveLength(1);
  expect(backSnapshot(capture(100), capture(200), events).items[0].status).toBe('resolved');
  expect(backSnapshot(capture(150), capture(160), [events[0]])).toBeNull();
  expect(backSnapshot(capture(100), capture(150), [events[0]]).items).toHaveLength(1);
  expect(backSnapshot(capture(100), capture(149), events)).toBeNull();
});
test('removed and never positioned dogs do not falsely recover; device changes remain', () => {
  expect(backSnapshot(capture(100, [range]), capture(200, [], []))).toBeNull();
  expect(backSnapshot(capture(100), capture(200, [range], [{ id: 8 }]))).toBeNull();
  const storage = { key: 's', kind: 'storage', startedAt: 150, storage: { full: true } };
  expect(backSnapshot(capture(100), capture(200, [storage], [])).items[0].dogId).toBeNull();
});
test('severity and stable key order independent of input order, inputs unchanged', () => {
  const stale = { ...range, key: 'stale', kind: 'dog-stale' };
  const before = capture(100);
  const after = capture(200, [stale, range]);
  const saved = JSON.stringify(after);
  expect(backSnapshot(before, after).items.map(item => item.key)).toEqual(['range', 'stale']);
  expect(JSON.stringify(after)).toBe(saved);
});
test('cloud snapshot uses successful download clock; indoor holds use packets', () => {
  const cloudDog = { ...dog, fixSource: 'cloud' };
  const snapshot = captureBackSnapshot({ now: 900000, cloud: { lastDownloadAt: 600000 }, dogs: [cloudDog] });
  expect(snapshot.dogs[0].problems.stale).toBe(false);
  const indoor = captureBackSnapshot({ now: 900000, dogs: [{ ...dog, heldReason: 'indoor', packetAt: 899000 }] });
  expect(indoor.dogs[0].problems.stale).toBe(false);
});
test('dog order follows highest current severity, rather than input dog order', () => {
  const stale = { ...range, key: 's', subject: 9, kind: 'dog-stale' };
  const result = backSnapshot(capture(100), capture(200, [stale, range], [{ ...dog, id: 9 }, dog]));
  expect(result.dogs.map(item => item.id)).toEqual([8, 9]);
});
test('raw merged state can capture alert problems through existing event reducer', () => {
  const before = captureBackSnapshot({ now: 100, dogs: [dog] });
  const after = captureBackSnapshot({ now: 700000, dogs: [dog] });
  expect(backSnapshot(before, after).items[0]).toMatchObject({ kind: 'dog-stale', status: 'active' });
});
test('raw snapshots do not invent a new episode for unchanged stale state', () => {
  expect(backSnapshot(captureBackSnapshot({ now: 700000, dogs: [dog] }),
    captureBackSnapshot({ now: 800000, dogs: [dog] }))).toBeNull();
});

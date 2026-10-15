import { createAtomicDogSnapshot } from '../src/map/AtomicDogSnapshot';

// The cloud part (cloud rows and cloud packets) is held while a download
// publishes or its snapshot is not read yet. This phone's receiver data is
// never held: it used to be, and a download on a slow or dead network then
// stopped the BLE dog, its card and its alerts for most of every 2 minutes.
const ble = (slave, time) => ({ slave_id: slave, source: 'ble', received_at: time });
const cloudPacket = (slave, time) => ({ slave_id: slave, source: 'cloud', track_at: time });
const value = (cloudTime, bleTime, extra = {}) => ({
  rows: [{ slave_id: 7, source: 'cloud', track_at: cloudTime }],
  packets: [ble(4, bleTime), cloudPacket(7, cloudTime)],
  ranges: { 4: { status: 'in', at: bleTime } }, holds: {}, statuses: { 4: { newestAt: bleTime } }, batteries: {},
  loaded: true, cloudCommit: null, ...extra,
});

test('a download holds the cloud rows and packets; this phone\'s receiver data stays live', () => {
  const gate = createAtomicDogSnapshot();
  const initial = gate.select({ owner: 'a', cloudDogs: value(100, 100) }).cloudDogs;
  // Publishing: a newer cloud row is on its way, the receiver keeps reporting.
  const publishing = gate.select({ owner: 'a', cloudDogs: value(200, 150), busy: true }).cloudDogs;
  expect(publishing.rows).toBe(initial.rows);
  expect(publishing.packets.filter(row => row.source === 'cloud')).toEqual([cloudPacket(7, 100)]);
  expect(publishing.packets.filter(row => row.source === 'ble')).toEqual([ble(4, 150)]);
  expect(publishing.ranges[4].at).toBe(150);
  expect(publishing.statuses[4].newestAt).toBe(150);
  // Committed but not read yet: still the accepted cloud part.
  const unread = gate.select({ owner: 'a', cloudDogs: value(200, 160), success: 10 }).cloudDogs;
  expect(unread.rows).toBe(initial.rows);
  expect(unread.packets).toEqual([ble(4, 160), cloudPacket(7, 100)]);
  // Read: the new cloud part all at once.
  const read = value(200, 170, { cloudCommit: 10 });
  const complete = gate.select({ owner: 'a', cloudDogs: read, success: 10 }).cloudDogs;
  expect(complete.rows).toBe(read.rows);
  expect(complete.packets).toEqual([ble(4, 170), cloudPacket(7, 200)]);
  expect(complete.cloudCommit).toBe(10);
});

test('an account switch discards the old account\'s cloud dogs even during a download', () => {
  const gate = createAtomicDogSnapshot();
  expect(gate.select({ owner: 'a', cloudDogs: value(100, 100), busy: true }).cloudDogs.rows).toEqual([]);
  gate.select({ owner: 'a', cloudDogs: value(100, 100, { cloudCommit: 1 }), success: 1 });
  const other = gate.select({ owner: 'b', cloudDogs: { rows: [], packets: [ble(4, 120)], loaded: false }, busy: true }).cloudDogs;
  expect(other.rows).toEqual([]);
  // Signed out or another account: the receiver's own dog is still there.
  expect(other.packets).toEqual([ble(4, 120)]);
  expect(other.loaded).toBe(false);
  expect(gate.select({ owner: null, cloudDogs: { rows: [], packets: [] }, busy: true }).cloudDogs.rows).toEqual([]);
});

test('a cold committed cache is admitted once without claiming a fresh download or leaking across owners', () => {
  const gate = createAtomicDogSnapshot();
  const cached = value(100, 100, { cachedBaseline: true });
  const initial = gate.select({ owner: 'a', cloudDogs: cached, busy: true }).cloudDogs;
  expect(initial.rows).toBe(cached.rows);
  expect(initial.cloudCommit).toBeNull();
  const later = gate.select({ owner: 'a', cloudDogs: value(300, 110, { cachedBaseline: true }), busy: true }).cloudDogs;
  expect(later.rows).toBe(cached.rows);
  expect(gate.select({ owner: 'b', cloudDogs: { loaded: false }, busy: true }).cloudDogs.rows).toEqual([]);
});

test('the same inputs give the same object, so the map does not merge again', () => {
  const gate = createAtomicDogSnapshot();
  const live = value(100, 100);
  const first = gate.select({ owner: 'a', cloudDogs: live }).cloudDogs;
  expect(gate.select({ owner: 'a', cloudDogs: live }).cloudDogs).toBe(first);
  expect(gate.select({ owner: 'a', cloudDogs: live, busy: true }).cloudDogs).toBe(first);
  // No receiver rows: the held cloud packets keep their identity.
  const cloudOnly = { ...live, packets: [cloudPacket(7, 100)] };
  const held = gate.select({ owner: 'a', cloudDogs: cloudOnly }).cloudDogs;
  expect(gate.select({ owner: 'a', cloudDogs: { ...cloudOnly }, busy: true }).cloudDogs.packets).toBe(held.packets);
});

import {
  cloudClock, dogFreshness, lastTimeText, STALE_AFTER_MS, staleSpeech, staleText,
} from '../src/tracking/DogFreshness';

// 2026-10-07 09:30 in Taiwan (the tests run in the machine's zone; times are
// built from local dates so the clock text is the same everywhere).
const NOW = new Date(2026, 9, 7, 9, 30).getTime();
const MINUTE = 60000;
const here = { latitude: 24.99, longitude: 121.31 };
const ble = (minutesAgo, extra = {}) => ({ slaveId: 4, coordinate: here, fixAt: NOW - minutesAgo * MINUTE,
  fixSource: 'ble', packetAt: NOW - minutesAgo * MINUTE, packetSource: 'ble', ...extra });
const cloud = (minutesAgo, extra = {}) => ble(minutesAgo, { fixSource: 'cloud', packetSource: 'cloud', ...extra });

test('a dog from this phone\'s receiver is stale after more than 10 minutes without a position', () => {
  expect(dogFreshness(ble(10), { now: NOW }).stale).toBe(false);
  const old = dogFreshness(ble(10.5), { now: NOW });
  expect(old).toMatchObject({ drawn: true, stale: true, basis: 'position', source: 'ble' });
  expect(staleText(old, NOW)).toBe('沒有新位置・最後 09:19');
  expect(staleSpeech(old, NOW)).toBe('沒有新位置，最後 09:19');
});

test('a packet without a fix does not make an old position current', () => {
  const dog = ble(30, { packetAt: NOW - 5000 });
  expect(dogFreshness(dog, { now: NOW }).stale).toBe(true);
});

test('cloud dogs are judged against the last successful download, not now', () => {
  const sync = { lastDownloadAt: NOW - 8 * MINUTE, failingSince: null };
  // 15 minutes old now, but only 7 minutes older than what the last download
  // knew: not stale until a later download still brings nothing newer.
  expect(dogFreshness(cloud(15), { now: NOW, cloud: sync }).stale).toBe(false);
  expect(dogFreshness(cloud(19), { now: NOW, cloud: sync }).stale).toBe(true);
  // Waiting for the next scheduled download is not a failure.
  expect(dogFreshness(cloud(15), { now: NOW + 20 * MINUTE, cloud: sync }).stale).toBe(false);
});

test('cloud dogs fall back to now before the first download and after 10 minutes of failures', () => {
  expect(cloudClock(null, NOW)).toBe(NOW);
  expect(dogFreshness(cloud(15), { now: NOW, cloud: { lastDownloadAt: null } }).stale).toBe(true);
  const failing = since => ({ lastDownloadAt: NOW - 30 * MINUTE, failingSince: NOW - since * MINUTE });
  expect(cloudClock(failing(10), NOW)).toBe(NOW - 30 * MINUTE);
  expect(cloudClock(failing(11), NOW)).toBe(NOW);
  expect(dogFreshness(cloud(25), { now: NOW, cloud: failing(9) }).stale).toBe(false);
  expect(dogFreshness(cloud(25), { now: NOW, cloud: failing(11) }).stale).toBe(true);
});

test('a dog held indoors is timed by its packets, with the source of its newest packet', () => {
  const held = ble(40, { heldReason: '室內', heldSource: 'good', packetAt: NOW - 2 * MINUTE });
  expect(dogFreshness(held, { now: NOW })).toMatchObject({ stale: false, basis: 'packet' });
  const silent = { ...held, packetAt: NOW - 25 * MINUTE };
  const result = dogFreshness(silent, { now: NOW });
  expect(result).toMatchObject({ stale: true, basis: 'packet', lastAt: NOW - 25 * MINUTE });
  expect(staleText(result, NOW)).toBe('沒有新資料・最後 09:05');
  // Its newest packet came from the cloud: the cloud formula.
  const viaCloud = { ...silent, packetSource: 'cloud' };
  expect(dogFreshness(viaCloud, { now: NOW, cloud: { lastDownloadAt: NOW - 20 * MINUTE } }).stale).toBe(false);
  // Riding along with this phone is not a hold indoors: timed by positions.
  const riding = ble(30, { heldReason: null, heldSource: 'ride', packetAt: NOW - 5000 });
  expect(dogFreshness(riding, { now: NOW })).toMatchObject({ stale: true, basis: 'position' });
});

test('a later upload of old rows does not clear it', () => {
  // The newest position arrived late but is still 12 minutes old.
  expect(dogFreshness(cloud(12), { now: NOW, cloud: { lastDownloadAt: NOW } }).stale).toBe(true);
});

test('while the user has disconnected the receiver its dogs do not go stale; reconnecting gives grace', () => {
  const pausedAt = NOW - 30 * MINUTE;
  // Fine (2 minutes old) when the receiver was switched off.
  const dog = ble(32);
  const one = resumedAt => [{ pausedAt, resumedAt }];
  expect(dogFreshness(dog, { now: NOW, pauses: one(null) }).stale).toBe(false);
  // Back 5 minutes ago: now − max(position, reconnect) = 5 minutes.
  expect(dogFreshness(dog, { now: NOW, pauses: one(NOW - 5 * MINUTE) }).stale).toBe(false);
  expect(dogFreshness(dog, { now: NOW, pauses: one(NOW - 11 * MINUTE) }).stale).toBe(true);
  // Already stale before the pause: the plain formula, no grace.
  const before = ble(45);
  expect(dogFreshness(before, { now: NOW, pauses: one(null) }).stale).toBe(true);
  expect(dogFreshness(before, { now: NOW, pauses: one(NOW - MINUTE) }).stale).toBe(true);
  // Cloud dogs keep their own formula during the pause.
  expect(dogFreshness(cloud(32), { now: NOW, cloud: { lastDownloadAt: NOW }, pauses: one(null) }).stale).toBe(true);
  // A position newer than the pause is not affected by it.
  expect(dogFreshness(ble(12), { now: NOW, pauses: one(NOW - 20 * MINUTE) }).stale).toBe(true);
});

test('pauses chain: a dog still within the grace of one pause is fine when the next one starts', () => {
  // Position at 0, off at 5, back at 35, off again at 36, back at 50; now 55.
  const at = minute => NOW - 55 * MINUTE + minute * MINUTE;
  const dog = ble(55);
  const pauses = [{ pausedAt: at(36), resumedAt: at(50) }, { pausedAt: at(5), resumedAt: at(35) }];
  expect(dogFreshness(dog, { now: NOW, pauses }).stale).toBe(false);
  expect(dogFreshness(dog, { now: at(61), pauses }).stale).toBe(true);
  // Still off after the second pause: no new staleness.
  expect(dogFreshness(dog, { now: NOW, pauses: [pauses[1], { pausedAt: at(36), resumedAt: null }] }).stale).toBe(false);
  // Off again only after the grace ran out: stale stays stale.
  const late = [pauses[1], { pausedAt: at(46), resumedAt: at(50) }];
  expect(dogFreshness(dog, { now: NOW, pauses: late }).stale).toBe(true);
});

test('older than 24 hours is still drawn; a dog that never had a position is not', () => {
  const day = dogFreshness(ble(26 * 60), { now: NOW });
  expect(day).toMatchObject({ drawn: true, stale: true });
  expect(staleText(day, NOW)).toBe('沒有新位置・最後 10/6 07:30');
  expect(dogFreshness({ slaveId: 9, coordinate: null, fixAt: null, packetAt: NOW }, { now: NOW }))
    .toMatchObject({ drawn: false, stale: false });
  expect(STALE_AFTER_MS).toBe(10 * MINUTE);
  expect(lastTimeText(new Date(2026, 9, 1, 14, 32).getTime(), NOW)).toBe('10/1 14:32');
});

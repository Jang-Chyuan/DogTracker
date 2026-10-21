import { createHoldStore, HOLD_LOOKBACK_MS } from '../src/placement/HoldStore';
import { mergeDogMarkers } from '../src/map/DogMerge';
import { dogCard } from '../src/map/DogCardModel';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';

// 2026-10-15 (emulator): at 10:26 the card read 「室內・25 分」 for a dog the
// history showed indoors in one stay since about 07:57. Its indoor drift kept
// five or six satellites at a poor HDOP, so the cold start's seeds (the last
// fixes before the half-hour window with enough satellites) were all weak: the
// live tracker anchored the hold on the window's own weak fixes, its `since`
// inside the window, and the hold did not say it may have begun earlier
// (`fromClipped`), so the card never asked the history. All data made up.
const MINUTE = 60000;
const NOW = new Date('2026-10-15T10:26:00+08:00').getTime();
const INSIDE = new Date('2026-10-15T07:57:00+08:00').getTime();
const HOME = { latitude: 24.99, longitude: 121.31 };
const fresh = { stale: false, basis: 'packet' };

async function kennel({ walkIn = false } = {}) {
  const db = createMemoryConnection();
  await createDogDatabase(db).initialize();
  const insert = (time, lat, lon, sats, hdop) => db.executeAsync(`INSERT INTO dog_status(master_id,slave_id,
    received_at,slave_lat,slave_lon,satellites,hdop,battery_percentage,battery_valid) VALUES(7,6,?,?,?,?,?,80,1)`,
  [time, lat, lon, sats, hdop]);
  const inside = walkIn ? NOW - 12 * MINUTE : INSIDE;
  // Clear fixes outside for ten minutes: at the kennel's door, or (walkIn) a
  // walk back from 400 m away inside the live window.
  for (let time = inside - 10 * MINUTE; time <= inside; time += 30000) {
    const away = walkIn ? (inside - time) / (10 * MINUTE) * 0.004 : 0;
    await insert(time, HOME.latitude + away, HOME.longitude, 9, 0.9);
  }
  // Then indoors: a weak fix every minute (5 satellites, HDOP 3–5) a few
  // metres around the kennel, a packet without a fix in between.
  let i = 0;
  for (let time = inside + 30000; time <= NOW; time += 30000, i += 1) {
    if (i % 2) await insert(time, 0, 0, 0, 655.35);
    else {
      const jitter = ((i * 37) % 11 - 5) * 0.00001;
      await insert(time, HOME.latitude + jitter, HOME.longitude - jitter, 5, 3 + (i % 3));
    }
  }
  return db;
}

async function coldStartDog(db) {
  const cloud = createCloudDatabase(db);
  await cloud.initialize();
  const store = createHoldStore();
  store.ingest(await cloud.holdRows(null, NOW - HOLD_LOOKBACK_MS, null));
  const packet = { slave_id: 6, master_id: 7, received_at: NOW, slave_lat: 0, slave_lon: 0,
    battery_percentage: 80, battery_valid: 1, source: 'ble' };
  const holds = store.holds(NOW);
  return { hold: holds[6], dog: mergeDogMarkers({ packetRows: [packet], holds, now: NOW, windowMs: 180000 })[0] };
}

const position = dog => dogCard(dog, { freshness: fresh, now: NOW, name: '小黑' })
  .rows.find(row => row.key === 'position').value;

describe('a cold start inside a stay held on weak fixes', () => {
  // 2026-10-16: the card no longer times a stay, so it asks the history nothing.
  test('the live hold says it may have begun before its rows; the card says 「遮蔽處」', async () => {
    const db = await kennel();
    try {
      const { hold, dog } = await coldStartDog(db);
      expect(hold).toBeTruthy();
      expect(dog.heldFrom).toBeGreaterThanOrEqual(NOW - HOLD_LOOKBACK_MS);
      expect(hold.fromClipped).toBe(true);
      expect(dog.heldFromClipped).toBe(true);
      expect(position(dog)).toBe('遮蔽處');
    } finally { db.close(); }
  });

  test('a dog the live rows saw walk in keeps its own start', async () => {
    const db = await kennel({ walkIn: true });
    try {
      const { hold, dog } = await coldStartDog(db);
      expect(hold).toBeTruthy();
      expect(hold.fromClipped).toBeUndefined();
      expect(position(dog)).toBe('遮蔽處');
    } finally { db.close(); }
  });
});

// Debug builds only: named screen states the phone cannot reach on demand
// (a dropped receiver, a dog whose fix aged), so each can be opened and
// screenshotted. A fixture replaces only the inputs the map already takes —
// the receiver state reader, the cloud sync state and the cloud rows — so the
// screen drawn is the real one.

const BASE = { latitude: 24.9936, longitude: 121.301 };
const MINUTE = 60000;

function cloudRow(slaveId, now, ageMs, offset, extra = {}) {
  return {
    slave_id: slaveId, master_id: 7, received_at: now - ageMs, track_at: now - ageMs,
    slave_lat: BASE.latitude + offset[0], slave_lon: BASE.longitude + offset[1],
    speed_kmh: 2, battery_percentage: 88, ...extra,
  };
}

const receiving = now => ({
  enabled: true, running: true, connected: true, receiving: true,
  deviceName: 'DogGPS-Master7', lastReceivedAt: now - 3000,
});

const freshDogs = now => [
  cloudRow(4, now, 10000, [0.0006, -0.0004]),
  cloudRow(6, now, 15000, [-0.0005, 0.0007]),
];

const FIXTURES = {
  'all-good': now => ({ receiver: receiving(now), cloud: { ownerId: 'fixture', lastSuccess: now - 5000 }, rows: freshDogs(now) }),
  'receiver-disconnected': now => ({
    receiver: { ...receiving(now), connected: false, receiving: false, lastReceivedAt: now - 5 * MINUTE },
    cloud: { ownerId: 'fixture', lastSuccess: now - 5000 },
    rows: freshDogs(now),
  }),
  'receiver-quiet': now => ({
    receiver: { ...receiving(now), receiving: false, lastReceivedAt: now - 2 * MINUTE },
    cloud: { ownerId: 'fixture', lastSuccess: now - 5000 },
    rows: freshDogs(now),
  }),
  'no-receiver-cloud-failing': now => ({
    receiver: { enabled: false },
    cloud: { ownerId: 'fixture', error: '連線逾時', lastSuccess: now - 10 * MINUTE },
    rows: freshDogs(now),
  }),
  // Dog 4 current, dog 6 four minutes old, dog 8 still talking but its last
  // fix six hours ago (the 2026-09-30 case).
  'dogs-aged': now => ({
    receiver: receiving(now),
    cloud: { ownerId: 'fixture', lastSuccess: now - 5000 },
    rows: [
      cloudRow(4, now, 10000, [0.0006, -0.0004]),
      cloudRow(6, now, 4 * MINUTE + 10000, [-0.0005, 0.0007]),
      cloudRow(8, now, 6 * 60 * MINUTE, [0.0000, 0.0002]),
    ],
    packets: [{ slave_id: 8, master_id: 7, received_at: now - 2000, slave_lat: null, slave_lon: null }],
  }),
};

export const FIXTURE_NAMES = Object.keys(FIXTURES);

// dogtracker://dev/fixture?name=dogs-aged → 'dogs-aged'; ?name=off → 'off'.
export function fixtureNameFromUrl(url) {
  const match = /^dogtracker:\/\/dev\/fixture\?name=([a-z-]+)$/.exec(url || '');
  if (!match) return null;
  return match[1] === 'off' || FIXTURES[match[1]] ? match[1] : null;
}

// What MapScreen receives instead of the live inputs.
export function buildFixture(name, now = Date.now()) {
  const make = FIXTURES[name];
  if (!make) return null;
  const { receiver, cloud, rows, packets = [] } = make(now);
  return {
    name,
    readReceiverState: { getState: async () => receiver },
    cloudSync: cloud,
    cloudDogs: { rows, packets, error: '' },
  };
}

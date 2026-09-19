import { cloudTracks, dogColor, DOG_COLORS } from '../src/map/CloudTracks';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const MINUTE = 60000;
const row = (slave, minutesAgo, lat, lon = 121.5) => ({
  slave_id: slave, master_id: 5, received_at: NOW - minutesAgo * MINUTE,
  slave_lat: lat, slave_lon: lon,
});

test('each dog gets its own path, cut where it stopped reporting', () => {
  const tracks = cloudTracks([
    row(4, 30, 25.001), row(4, 29, 25.002), row(4, 28, 25.0035),
    // Eleven minutes of silence: the dog did not walk that straight line.
    row(4, 17, 25.02), row(4, 16, 25.021),
    row(6, 5, 25.05), row(6, 4, 25.0515),
  ], { since: NOW - 60 * MINUTE });
  expect(tracks.map(track => track.slaveId)).toEqual([4, 6]);
  expect(tracks[0].segments).toHaveLength(2);
  expect(tracks[1].segments).toHaveLength(1);
  // Every drawn point carries its time, like the live route.
  expect(tracks[0].segments[0][0].time).toBe(NOW - 30 * MINUTE);
});

test('rows before the window, without a fix, or alone in a segment are dropped', () => {
  const tracks = cloudTracks([
    row(4, 120, 25.0), row(4, 119, 25.001),
    { ...row(4, 5, 25.01), slave_lat: 0, slave_lon: 0 },
    { ...row(4, 4, 25.02), slave_lat: null },
    row(9, 3, 25.03),
  ], { since: NOW - 60 * MINUTE });
  // Everything that is left is a single point per dog, which is not a line.
  expect(tracks).toEqual([]);
});

test('a long day is capped to the drawing budget, keeping the newest part', () => {
  const rows = Array.from({ length: 300 }, (_, index) =>
    row(4, 300 - index, 25 + index / 100000));
  const tracks = cloudTracks(rows, { since: NOW - 400 * MINUTE, budget: 50 });
  const drawn = tracks[0].segments.flat();
  expect(drawn.length).toBeLessThanOrEqual(50);
  expect(drawn.at(-1).time).toBe(NOW - MINUTE);
});

test('dogs are told apart by colour, and the first one keeps the familiar red', () => {
  expect(dogColor(5)).toBe(DOG_COLORS[0]);
  expect(dogColor(6)).not.toBe(dogColor(7));
});

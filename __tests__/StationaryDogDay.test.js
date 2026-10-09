// 067: a collar that stays indoors all day — fixes wandering 5–50 m with an
// occasional 100 m+ jump, and runs of packets without a fix (satellites 0,
// HDOP 655.35). The same history rules as the phone: one place, no walk.
import { historyTimeline } from '../src/history/HistoryTimeline';
import { dogHistoryRow } from '../src/history/HistoryRows';

const ORIGIN = { latitude: 24.9893, longitude: 121.3135 };
const START = new Date(2026, 0, 5, 7, 0).getTime();
const at = (east, north) => ({ latitude: ORIGIN.latitude + north / 110540,
  longitude: ORIGIN.longitude + east / (111320 * Math.cos((ORIGIN.latitude * Math.PI) / 180)) });

// A seeded wander so the day is the same every run.
function random(seed) {
  let value = seed;
  return () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646; };
}

function stationaryCollarDay() {
  const next = random(42);
  const rows = [];
  for (let i = 0; i < 8 * 120; i += 1) {
    const time = START + i * 30000;
    // 20-minute runs without a fix, three times a day.
    const noFix = [100, 400, 700].some(start => i >= start && i < start + 40);
    const jump = !noFix && i % 97 === 0;
    const radius = jump ? 100 + next() * 40 : 5 + next() * 45;
    const angle = next() * 2 * Math.PI;
    const fix = noFix ? null : at(Math.cos(angle) * radius, Math.sin(angle) * radius);
    rows.push(dogHistoryRow({ id: i + 1, slave_id: 6, master_id: 7, received_at: time, track_at: time,
      slave_lat: fix ? fix.latitude : 0, slave_lon: fix ? fix.longitude : 0,
      satellites: fix ? 4 + Math.floor(next() * 5) : 0, hdop: fix ? 1 + next() * 2 : 655.35,
      speed_kmh: fix ? next() * 2 : 0, rssi: -80, snr: 5 }, 'local'));
  }
  return rows;
}

test('a collar indoors all day: no walk, no 收不到 GPS, the time in one place', () => {
  const rows = stationaryCollarDay();
  const dayStart = new Date(2026, 0, 5).getTime();
  const model = historyTimeline(rows, { subject: 'dog', dayStart, dayEnd: dayStart + 86400000,
    now: dayStart + 86400000, range: { start: dayStart, end: dayStart + 86400000 - 1 } });
  const kinds = model.nodes.map(n => n.type);
  expect(model.nodes.filter(n => n.type === 'gap' && n.reason === 'no-gps')).toHaveLength(0);
  expect(model.distanceM).toBeLessThan(300);
  // The hold takes over within minutes and keeps the rest of the day.
  expect(kinds).toEqual(['departure', 'movement', 'indoor']);
  expect(model.nodes[2].durationMs).toBeGreaterThan(7 * 3600000);
});

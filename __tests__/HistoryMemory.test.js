import { historyGeometry, expireHistory, HISTORY_DEFAULTS } from '../src/mapHistory/HistoryDatabase';
import { budgetHistoryTracks } from '../src/mapHistory/HistoryGeometryBudget';
import { clipTrackTo } from '../src/mapHistory/HistoryPlayback';
import { serializeHistory } from '../src/mapHistory/HistoryExport';
import { stablePhoneDisplay } from '../src/map/PhoneDisplayPosition';

const point = (time, master_id = 5, latitude = 25) => ({ time, master_id, slave_id: 4, latitude, longitude: 121 });
test('interleaved receivers form separate continuous tracks, also in GPX, with original rows intact', () => {
  const rows = Array.from({ length: 6000 }, (_, i) => point(i * 1000, i % 2 ? 7 : 5, i % 2 ? 26 : 25));
  const track = historyGeometry(rows);
  expect(track.segments).toHaveLength(2);
  expect(track.segments.every(part => new Set(part.map(p => p.master_id)).size === 1)).toBe(true);
  expect(track.count).toBe(6000);
  expect(track.sourcePoints).toBe(rows);
  const xml = serializeHistory('gpx', { phone: [], clients: [{ slaveId: 4, rows }], since: 0, until: 6000000 });
  expect(xml.match(/<trkseg>/g)).toHaveLength(2);
  expect(xml.match(/<trkpt /g)).toHaveLength(6000);
  const clipped = clipTrackTo(track, 2500);
  expect(clipped.latest.time).toBe(1000);
});

test('expiry preserves receiver separation and genuine gaps remain disconnected', () => {
  const rows = [point(0), point(1000, 7), point(2000), point(3000, 7), point(150000)];
  const track = historyGeometry(rows);
  expect(track.segments).toHaveLength(3);
  const result = expireHistory({ phone: historyGeometry([]), clients: [track], since: 0, until: 150001 },
    { ...HISTORY_DEFAULTS, hours: 1 }, 3601500);
  expect(result.clients[0].sourcePoints.map(p => p.time)).toEqual([2000, 3000, 150000]);
});

test('native budget shares full-time coverage across every dog without bridging gaps', () => {
  const tracks = Array.from({ length: 5 }, (_, dog) => ({ sourcePoints: [], segments:
    Array.from({ length: 100 }, (unusedSegment, i) => Array.from({ length: 50 }, (unusedPoint, j) => point(dog + i * 200000 + j))) }));
  const limited = budgetHistoryTracks(tracks);
  expect(limited.flatMap(t => t.segments).length).toBeLessThanOrEqual(120);
  expect(limited.flatMap(t => t.segments).flat().length).toBeLessThanOrEqual(4000);
  expect(limited.some(t => t.limited)).toBe(true);
  expect(tracks[0].segments).toHaveLength(100);
  limited.forEach((track, i) => {
    expect(track.segments[0][0]).toBe(tracks[i].segments[0][0]);
    expect(track.segments.at(-1).at(-1)).toBe(tracks[i].segments.at(-1).at(-1));
    expect(track.segments.length).toBe(24);
    expect(track.segments.some(part => part[0].time > i + 8000000 && part[0].time < i + 12000000)).toBe(true);
  });
  const fragmented = budgetHistoryTracks([{ segments: Array.from({ length: 500 }, (_, i) => [point(i * 200000), point(i * 200000 + 1)]) }]);
  expect(fragmented[0].segments).toHaveLength(120);
});

test('dense continuous tracks retain endpoints and representative turns without changing export rows', () => {
  const original = Array.from({ length: 9000 }, (_, i) => ({
    ...point(i * 1000), latitude: 25 + (i % 7) * 0.0001, longitude: 121 + i * 0.000001,
  }));
  const other = [point(0, 7), point(9000000, 7)];
  const tracks = budgetHistoryTracks([{ segments: [original], sourcePoints: original, latest: original.at(-1) },
    { segments: [other], sourcePoints: other, latest: other.at(-1) }]);
  expect(tracks[0].segments[0]).toHaveLength(3998);
  expect(tracks[0].segments[0][0]).toBe(original[0]);
  expect(tracks[0].segments[0].at(-1)).toBe(original.at(-1));
  expect(tracks[0].sourcePoints).toBe(original);
  expect(tracks[0].latest).toBe(original.at(-1));
  expect(tracks[1].segments[0]).toBe(other);
});

test('low speed display jitter is held but cumulative departure, movement and unknown speed pass through', () => {
  const anchor = { latitude: 25, longitude: 121 };
  const small = { latitude: 25.00001, longitude: 121, accuracy: 15, rawSpeedKmh: 0.2 };
  expect(stablePhoneDisplay(anchor, small)).toBe(anchor);
  expect(stablePhoneDisplay(anchor, { ...small, latitude: 25.0001 }).latitude).toBe(25.0001);
  expect(stablePhoneDisplay(anchor, { ...small, rawSpeedKmh: 20 }).latitude).toBe(small.latitude);
  expect(stablePhoneDisplay(anchor, { ...small, rawSpeedKmh: null }).latitude).toBe(small.latitude);
  expect(small.latitude).toBe(25.00001);
});

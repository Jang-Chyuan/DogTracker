import { buildGPX } from '../src/mapHistory/ExportGPX';
import { buildCSV, CSV_COLUMNS } from '../src/mapHistory/ExportCSV';
import { buildPNGLayout, PNG_STYLE } from '../src/mapHistory/ExportPNG';
import { buildExportFilename, buildTempFile, shouldCleanupExport } from '../src/mapHistory/ExportFiles';
import { colors } from '../src/theme/tokens';
const minute = 60000;
const point = (time, extra = {}) => ({ time, location_at: time, latitude: 25, longitude: 121, ...extra });
const dog = (extra = {}) => ({ kind: 'dog', name: '小黑', slaveId: 4, rows: [point(0), point(60 * minute)], ...extra });
const snapshot = (...subjects) => ({ since: 0, until: 60 * minute, timeZone: 'UTC', subjects });
const count = (text, tag) => (text.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('GPX exports raw unsimplified coordinates, UTC, XML escaping and GPX element order', () => {
  const data = freeze(snapshot(dog({ name: '小<&"', rows: [point(0, { latitude: 30, raw_latitude: 25.1, raw_longitude: 121.1, altitude_meters: 10 })],
    stays: [{ start: 0, end: 18 * minute, latitude: 25, longitude: 121, number: 3, address: 'A&B' }] })));
  const gpx = buildGPX(data);
  expect(gpx).toContain('version="1.1"');
  expect(gpx).toContain('lat="25.1" lon="121.1"><ele>10</ele><time>1970-01-01T00:00:00.000Z');
  expect(gpx).toContain('小&lt;&amp;&quot;-4 停留 3・18 分');
  expect(gpx).toContain('<desc>A&amp;B</desc>');
  expect(gpx.indexOf('<wpt')).toBeLessThan(gpx.indexOf('<trk>'));
});

test('walking, indoor drift, release and each ride split tracks at boundaries and >3 minute gaps', () => {
  const data = snapshot(dog({ rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13].map(m => point(m * minute)),
    holds: [{ start: 2 * minute, end: 4 * minute, latitude: 24, longitude: 120 }],
    rides: [{ start: 5 * minute, end: 7 * minute }, { start: 12 * minute, end: 13 * minute }] }));
  const gpx = buildGPX(data);
  expect(count(gpx, 'trk')).toBe(3);
  expect(count(gpx, 'trkseg')).toBe(7);
  expect(count(gpx, 'trkpt')).toBe(11);
  expect(gpx).toContain('小黑-4 坐車 1（不算距離）');
  expect(gpx).toContain('小黑-4 坐車 2（不算距離）');
  expect(count(gpx, 'type')).toBe(2);
});

test('exactly 3 minutes stays connected; missing GPS, sessions, explicit gaps break', () => {
  const data = snapshot(dog({ rows: [point(0), point(3 * minute), point(4 * minute, { latitude: null }), point(5 * minute), point(6 * minute, { session_id: 'new' }), point(7 * minute, { session_id: 'new' })], gaps: [{ start: 6.2 * minute, end: 6.8 * minute }] }));
  expect(count(buildGPX(data), 'trkseg')).toBe(4);
});

test('hold-only exports clip duration, split wpts around no-data and omit unknown address', () => {
  const data = snapshot(dog({ rows: [point(10 * minute, { raw_latitude: null, raw_longitude: null })],
    holds: [{ start: -10 * minute, end: 90 * minute, latitude: 24, longitude: 120 }], gaps: [{ start: 20 * minute, end: 25 * minute }] }));
  data.since = 10 * minute;
  const gpx = buildGPX(data);
  expect(count(gpx, 'trk')).toBe(0);
  expect(count(gpx, 'wpt')).toBe(2);
  expect(gpx).toContain('小黑-4 室內・10 分');
  expect(gpx).toContain('小黑-4 室內・35 分');
  expect(gpx).toContain('1970-01-01T00:10:00.000Z');
  expect(gpx).not.toContain('<desc>');
  expect(buildCSV(data).split('\r\n')).toHaveLength(2);
});

test('stay duration excludes clipped gaps and preserves timeline numbering; phone drive naming', () => {
  const subject = dog({ kind: 'phone', stays: [{ start: -minute, end: 20 * minute, latitude: 25, longitude: 121, number: 4, address: '公園' }],
    gaps: [{ start: 5 * minute, end: 10 * minute }], rides: [{ start: 0, end: minute }] });
  const gpx = buildGPX(snapshot(subject));
  expect(gpx).toContain('停留 4・15 分');
  expect(gpx).toContain('公園・不含中斷 5 分');
  expect(gpx).toContain('<name>我的路線</name>');
  expect(gpx).toContain('<name>開車 1（不算距離）</name><type>drive</type>');
});

test('CSV retains 24 columns, quotes, BOM, missing accuracy and raw GPS sorted by UTC then slave_id', () => {
  const data = freeze(snapshot(dog({ slaveId: 9, rows: [point(2), point(1, { id: 'a,"b', latitude: 30, raw_latitude: 24, raw_longitude: 120 })] }), dog({ slaveId: 2, rows: [point(1, { id: 'first' })] })));
  const csv = buildCSV(data), lines = csv.split('\r\n');
  expect(CSV_COLUMNS).toHaveLength(24);
  expect(lines[0]).toBe('\uFEFF' + CSV_COLUMNS.join(','));
  expect(lines[1]).toContain('"first"');
  expect(lines[2]).toContain('"a,""b"');
  expect(lines[2]).toContain('"24","120",""');
  expect(lines[3]).toContain('1970-01-01T00:00:00.002Z');
  const phone = buildCSV(snapshot(dog({ kind: 'phone', rows: [point(0, { master_id: 8, slave_id: 4, satellites: 9, hdop: 1, rssi: -30, snr: 2 })] })));
  expect(phone.split('\r\n')[1]).toMatch(/^"phone"/);
  expect(phone.split('\r\n')[1]).toMatch(/(?:,"\s*"){6}$/);
});

test('range is inclusive, excludes outside points/empty dogs, uses GPS acquisition time for hold classification', () => {
  const data = snapshot(dog({ rows: [point(-1), point(0), point(60 * minute), point(60 * minute + 1)] }), dog({ slaveId: 3, rows: [point(-1)] }));
  expect(count(buildGPX(data), 'trk')).toBe(1);
  expect(count(buildGPX(data), 'trkpt')).toBe(2);
  const delayed = snapshot(dog({ rows: [point(4 * minute, { location_at: minute }), point(5 * minute, { location_at: 2 * minute })], holds: [{ start: 0, end: 2 * minute, latitude: 25, longitude: 121 }] }));
  expect(count(buildGPX(delayed), 'trkseg')).toBe(2);
});

const timeline = n => Array.from({ length: n }, (_, i) => ({ type: 'stay', address: `地址 ${i}`, label: '停 10 分' }));
test('PNG single subject omits legend/headers, crops pages, only first map, uses light text tokens', () => {
  const layout = buildPNGLayout(freeze(snapshot(dog({ timeline: timeline(30) }))));
  expect(layout.pages.length).toBeGreaterThan(1);
  expect(layout.text).toBe(colors.text);
  expect(layout.textMuted).toBe(colors.textMuted);
  expect(layout.holdText).toBe(colors.receiver);
  expect(PNG_STYLE.timeColumn).toBe(150);
  layout.pages.forEach((page, i) => {
    expect(page.height).toBeLessThanOrEqual(2400);
    expect(page.legend).toEqual([]);
    expect(page.blocks.some(b => b.type === 'section')).toBe(false);
    expect(page.blocks.filter(b => b.type === 'map')).toHaveLength(i === 0 ? 1 : 0);
    expect(page.footer.page).toBe(`${i + 1}/${layout.pages.length}`);
    expect(page.height).toBe(page.footer.y + 60);
  });
});

test('multi-dog pagination keeps section header with first node and resumes only split subjects', () => {
  const layout = buildPNGLayout(snapshot(dog({ timeline: timeline(15) }), dog({ name: '豆豆', slaveId: 5, timeline: timeline(5) })));
  expect(layout.pages[0].title).toContain('2 隻');
  const sections = layout.pages.flatMap(p => p.blocks.filter(b => b.type === 'section'));
  expect(sections.map(s => s.title)).toContain('小黑（續）');
  expect(sections.map(s => s.title)).toContain('豆豆');
  layout.pages.forEach(page => {
    expect(page.legend).toHaveLength(2);
    expect(page.height).toBeLessThanOrEqual(2400);
    page.blocks.forEach((block, i) => { if (block.type === 'section') expect(page.blocks[i + 1].type).toBe('row'); });
  });
  expect(layout.pages[0].blocks[0]).toMatchObject({ padding: 72, timeMarkers: 'endpoints', cursor: null });
});

test('PNG wraps legend, truncates long addresses and moves list to page 2 if first node will not fit', () => {
  const subjects = [1, 2, 3, 4].map(slaveId => dog({ slaveId, name: '很長的名字'.repeat(42), timeline: [{ type: 'stay', address: '地址'.repeat(1000), detail: '說明'.repeat(100) }] }));
  const layout = buildPNGLayout(snapshot(...subjects));
  expect(layout.pages[0].legendHeight).toBeGreaterThan(56);
  expect(layout.pages[0].blocks.map(b => b.type)).toEqual(['map']);
  const rows = layout.pages.flatMap(p => p.blocks.filter(b => b.type === 'row'));
  expect(rows).toHaveLength(4);
  expect(rows[0].addressLines).toHaveLength(2);
  expect(rows[0].addressLines[1]).toMatch(/…$/);
  expect(layout.pages[1].blocks[0].title).not.toContain('（續）');
  expect(layout.pages.every(p => p.height <= 2400)).toBe(true);
});

test('only one active dog uses single layout and filename; no data yields no pages', () => {
  const data = snapshot(dog(), dog({ slaveId: 5, rows: [] }));
  expect(buildPNGLayout(data).pages[0].legend).toEqual([]);
  expect(buildPNGLayout(snapshot()).pages).toEqual([]);
  expect(buildExportFilename(data, 'gpx')).toContain('小黑-4');
});

test('filenames, multi PNG suffix, temp identity and cleanup use local calendar day not elapsed 24h', () => {
  const data = snapshot(dog({ name: '小/黑:*\n' }));
  expect(buildExportFilename(data, 'png', 2)).toBe('DogTracker_小_黑___-4_19700101-0000_19700101-0100_2.png');
  expect(buildExportFilename(snapshot(dog(), dog({ slaveId: 5 })), 'csv')).toContain('_狗的歷史_');
  expect(buildExportFilename(snapshot(dog({ kind: 'phone' })), 'csv')).toContain('_我的路線_');
  expect(buildTempFile(data, 'png', { createdAt: 0, exportId: 'run-1' }).directory).toBe('history_exports/run-1');
  const createdAt = Date.parse('2026-10-03T15:59:00Z');
  expect(shouldCleanupExport({ createdAt }, createdAt + 120000, 'Asia/Taipei')).toBe(true);
  expect(shouldCleanupExport({ createdAt }, createdAt + 30000, 'Asia/Taipei')).toBe(false);
  expect(shouldCleanupExport({ createdAt }, createdAt - 86400000, 'Asia/Taipei')).toBe(false);
  expect(() => buildTempFile(data, 'csv', { createdAt: 0, exportId: '../escape' })).toThrow();
  expect(() => buildExportFilename(data, 'csv', 2)).toThrow();
});

test('invalid or cross-day ranges and unknown formats reject', () => {
  expect(() => buildGPX({ ...snapshot(dog()), since: 5, until: 4 })).toThrow();
  expect(() => buildCSV({ ...snapshot(dog()), until: 86400000 })).toThrow();
  expect(() => buildExportFilename(snapshot(dog()), 'zip')).toThrow();
});

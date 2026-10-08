import { buildGPX } from '../src/mapHistory/ExportGPX';
import { buildCSV, CSV_COLUMNS } from '../src/mapHistory/ExportCSV';
import { buildPNGLayout, PNG_STYLE } from '../src/mapHistory/ExportPNG';
import { buildExportFilename, shouldCleanupExport } from '../src/mapHistory/ExportFiles';
import { captureExportSnapshot, exportAddressState } from '../src/mapHistory/ExportData';
const m = 60000;
const point = (time, extra = {}) => ({ time, location_at: time, latitude: 25, longitude: 121, ...extra });
const dog = (extra = {}) => ({ kind: 'dog', name: '小黑', slaveId: 4, rows: [point(0)], ...extra });
const snap = (...subjects) => ({ since: 0, until: 60 * m, timeZone: 'UTC', subjects });
const count = (text, tag) => (text.match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
const rows = layout => layout.pages.flatMap(page => page.blocks.filter(block => block.type === 'row'));

// Design edges.txt:48:「照停留的跨午夜規則在 00:00 切開」；spec.txt:488:「時間＝照匯出範圍裁切後那段的開始」。
test('midnight hold is clipped independently on each local day with UTC waypoint time', () => {
  const midnight = Date.parse('2026-10-03T16:00:00Z');
  const subject = dog({ rows: [point(midnight - m), point(midnight + m)], holds: [{ start: midnight - 10 * m, end: midnight + 10 * m, latitude: 24, longitude: 120 }] });
  const data = { ...snap(subject), timeZone: 'Asia/Taipei', since: midnight, until: midnight + 10 * m };
  expect(buildGPX(data)).toContain('<time>2026-10-03T16:00:00.000Z</time><name>小黑-4 室內・10 分');
  const previous = { ...data, since: midnight - 10 * m, until: midnight - 1 };
  expect(buildGPX(previous)).toContain('室內・10 分');
  expect(buildExportFilename(data, 'gpx')).toContain('20261004-0000_20261004-0010');
  expect(() => buildGPX({ ...data, since: midnight - 1 })).toThrow('同一天');
});

// Design spec.txt:488:「時間長度也照裁切後算；中間有『沒有資料』斷開時每段各一個」。
test('range touching a hold or stay emits no zero-duration phantom waypoint', () => {
  const interval = { start: -m, end: 0, latitude: 25, longitude: 121, number: 1 };
  expect(count(buildGPX(snap(dog({ holds: [interval], stays: [interval] }))), 'wpt')).toBe(0);
});

// Design spec.txt:488:「多隻狗是一個檔案，每隻狗各自一條移動的 trk 和每次坐車各一個 trk」。
test('multi-dog GPX separates names, stays and numbered rides, excludes empty dog', () => {
  const make = (name, slaveId) => dog({ name, slaveId, rows: [0, 1, 2, 3, 4].map(t => point(t * m)), rides: [{ start: m, end: 2 * m }, { start: 3 * m, end: 4 * m }], stays: [{ start: 0, end: m, latitude: 25, longitude: 121, number: 1 }] });
  const gpx = buildGPX(snap(make('小黑', 4), make('豆豆', 5), dog({ name: '空', rows: [] })));
  expect(count(gpx, 'trk')).toBe(6);
  for (const name of ['小黑-4', '豆豆-5']) {
    expect(gpx).toContain(`<name>${name}</name>`);
    expect(gpx).toContain(`${name} 停留 1・1 分`);
    expect(gpx).toContain(`${name} 坐車 2（不算距離）`);
  }
  expect(gpx).not.toContain('空');
});

// Design spec.txt:488:「我的路線…每一次開車各自一個 trk，名稱依序『開車 1（不算距離）』『開車 2（不算距離）』、type＝drive」。
test('phone driving gaps retain one drive track with disconnected segments', () => {
  const gpx = buildGPX(snap(dog({ kind: 'phone', rows: [0, 1, 2, 6, 7, 8, 9].map(t => point(t * m)), rides: [{ start: m, end: 7 * m }, { start: 8 * m, end: 9 * m }] })));
  expect(count(gpx, 'trk')).toBe(3);
  expect(gpx).toContain('<name>開車 2（不算距離）</name><type>drive</type>');
  expect(count(gpx, 'trkseg')).toBe(6);
});

// Design spec.txt:489:「CSV 每一筆位置…沒值留空…CSV 照樣寫原始座標」；hist.txt:247:「CSV 每一筆位置」。
test('CSV retains GPS-less indoor and vehicle packets, never substitutes displayed phone coordinates', () => {
  const csv = buildCSV(snap(dog({ rows: [point(m, { location_at: null, raw_latitude: null, raw_longitude: null, display_source: 'phone', latitude: 40, longitude: 50 }), point(2 * m, { raw_latitude: 24, raw_longitude: 120, latitude: 40, longitude: 50 })] })));
  const lines = csv.split('\r\n');
  expect(lines).toHaveLength(4);
  const cells = lines[1].slice(1, -1).split('","');
  expect(cells).toHaveLength(24);
  for (const column of ['location_at', 'latitude', 'longitude', 'raw_latitude', 'raw_longitude']) expect(cells[CSV_COLUMNS.indexOf(column)]).toBe('');
  expect(lines[2]).toContain('"24","120"');
  expect(count(buildGPX(snap(dog({ rows: [point(m, { raw_latitude: null, raw_longitude: null, display_source: 'phone' })] }))), 'trkpt')).toBe(0);
});

// Design spec.txt:264:「所有列照時間（UTC）由舊到新；同一時間再照 slave_id 由小到大」。
test('CSV sorts packet recording time even when GPS acquisition is stale', () => {
  const csv = buildCSV(snap(dog({ rows: [point(2 * m, { location_at: 0, id: 'later' })] }), dog({ slaveId: 2, rows: [point(m, { id: 'earlier' })] })));
  expect(csv.indexOf('earlier')).toBeLessThan(csv.indexOf('later'));
});

// Design edges.txt:34:「沒網路就不查…不等 5 秒」；spec.txt:127:「查地址最多等 5 秒，逾時或出錯就當成查不到」。
test('address deadline is immediate offline, missing at 5 seconds or error, resolved before deadline', () => {
  expect(exportAddressState({ online: false })).toMatchObject({ status: 'missing', text: '查不到地址' });
  expect(exportAddressState({ online: true, elapsedMs: 4999 })).toMatchObject({ status: 'pending', remainingMs: 1 });
  expect(exportAddressState({ online: true, elapsedMs: 5000 }).status).toBe('missing');
  expect(exportAddressState({ online: true, failed: true }).status).toBe('missing');
  expect(exportAddressState({ online: true, address: '公園' })).toEqual({ status: 'resolved', address: '公園' });
});

// Design spec.txt:160:「查不到地址時第一行座標用 40px 粗體…寫『查不到地址』30px textMuted」。
test('PNG missing address keeps coordinates, badge and full fallback detail', () => {
  const row = rows(buildPNGLayout(snap(dog({ timeline: [{ type: 'stay', latitude: 24, longitude: 120, label: '停 10 分' }] }))))[0];
  expect(row.addressLines).toEqual(['24, 120']);
  expect(row.detailLines).toEqual(['查不到地址']);
  expect(row.row.label).toBe('停 10 分');
  expect(row.missingAddress).toBe(true);
  expect(PNG_STYLE).toMatchObject({ addressFont: 40, addressWeight: 'bold', detailFont: 30 });
});

// Design spec.txt:483:「地圖：路線、起終點時間、途中時間標記（多隻狗時不畫）、停留編號、比例尺、指北、地圖署名」；spec.txt:486:「路線不依游標變淡…中斷不連線…不畫游標」。
test('PNG map contract specifies all subjects, indoor anchor, solid driving, gaps, compass, scale and attribution', () => {
  const subject = dog({ routeColor: '#123456', holds: [{ start: 0, end: m, latitude: 24, longitude: 120 }] });
  const map = buildPNGLayout(snap(subject)).pages[0].blocks[0];
  expect(map).toMatchObject({ width: 1080, height: 1080, padding: 72, fit: 'all-routes-and-stays', scale: true, north: true, stayNumbers: 'per-subject', holds: 'representative-position', timeMarkers: 'all', endpointTimes: 'actual-last-sample', cursor: null, fadeByCursor: false, attribution: '© Google', attributionPosition: 'bottom-right', fallback: 'blank-with-scale', routeColors: ['#123456'], routeStyle: { movementWidth: 12, driveWidth: 6, drive: 'solid', connectGaps: false, opacity: 1 } });
  expect(map.subjects[0].holds[0]).toMatchObject({ latitude: 24, longitude: 120 });
});

// Design spec.txt:244:「匯出的檔案一律寫實際時刻…不寫『現在』」；spec.txt:486:「終點寫最後一筆的實際時刻」。
test('PNG endpoint time is sample time and not range end or cursor time', () => {
  const layout = buildPNGLayout(snap(dog({ timeline: [{ type: 'end', time: 12 * m, label: '現在' }] })));
  expect(rows(layout)[0].row).toMatchObject({ label: '結束', timeText: '00:12' });
  expect(JSON.stringify(rows(layout))).not.toContain('現在');
});

// Design spec.txt:487:「停住期間的封包也算有資料」；hist.txt:315:「只算這段時間有資料的狗」。
test('hold-only dog counts in PNG legend and sections; empty dog disappears everywhere', () => {
  const data = snap(dog({ timeline: [{ type: 'move', detail: '移動 1 分・0.1 km' }] }), dog({ name: '豆豆', slaveId: 5, rows: [point(m, { raw_latitude: null, raw_longitude: null })], timeline: [{ type: 'hold', label: '室內・40 分', latitude: 24, longitude: 120 }] }), dog({ name: '空', rows: [] }));
  const layout = buildPNGLayout(data);
  expect(layout.pages[0].title).toContain('2 隻');
  expect(layout.pages[0].legend.map(item => item.text)).toEqual(['小黑 0 km', '豆豆 0 km']);
  expect(layout.pages[0].blocks.filter(b => b.type === 'section').map(b => b.title)).toEqual(['小黑', '豆豆']);
  expect(JSON.stringify(rows(layout))).not.toContain('空');
});

// Design spec.txt:482:「移動段一列最少 96px…節點…140px 起；頁尾 60px」；spec.txt:484:「標題 40px 粗體…字型同 App」；spec.txt:392:「點直徑 9px、間距 21px…實線 9px…虛線 6px（18／12）」。
test('PNG dimensions, typography and timeline line styles preserve design values', () => {
  expect(PNG_STYLE).toMatchObject({ width: 1080, maxHeight: 2400, mapHeight: 1080, footerHeight: 60, titleFont: 40, titleWeight: 'bold', fontFamily: 'app', timeColumn: 150, trackColumn: 80, timeFont: 36, nodeSize: 64, movementIcon: 72, legendFont: 28, sectionFont: 36, sectionDetailFont: 28, footerFont: 24, dottedLine: { diameter: 9, gap: 21 }, driveLine: 9, gapLine: { width: 6, dash: [18, 12] } });
  const layout = buildPNGLayout(snap(dog({ timeline: [{ type: 'move' }, { type: 'stay' }] })));
  expect(rows(layout).map(row => row.height)).toEqual([96, 140]);
  expect(layout.pages[0].footer.text).toBe('停留＝待得比這條路線一般地方久很多的地方');
});

// Design spec.txt:485:「排到下一列會超過 2400px 就換張…標題和清單列依內容自動長高」。
test('PNG preserves long details without truncation and rejects a row taller than a page', () => {
  const data = snap(dog({ timeline: [{ type: 'move', detail: '說明'.repeat(100) }] }));
  expect(rows(buildPNGLayout(data))[0].detailLines.length).toBeGreaterThan(2);
  expect(() => buildPNGLayout(snap(dog({ timeline: [{ type: 'stay', detail: '說明'.repeat(2000) }] })))).toThrow('清單列超過可用高度');
});

// Design spec.txt:405:「產生中、或之後按『重試』，都用同一份快照」。
test('captured immutable snapshot preserves held position and address across live updates and retry', () => {
  const live = snap(dog({ holds: [{ start: 0, end: m, latitude: 24, longitude: 120, address: '舊地址' }] }));
  const captured = captureExportSnapshot(live), initial = buildGPX(captured);
  live.subjects[0].holds[0].address = '新地址';
  live.subjects[0].holds[0].latitude = 30;
  live.subjects[0].rows.push(point(m));
  expect(Object.isFrozen(captured.subjects[0].holds[0])).toBe(true);
  expect(buildGPX(captured)).toBe(initial);
  expect(buildGPX(captureExportSnapshot(live))).not.toBe(initial);
});

// Design hist.txt:242:「沒有紀錄…右上匯出變淡」；edges.txt:40:「資料本身不到 1 分鐘…匯出照實際筆數算」。
test('empty day returns no content and single-point short range remains exportable', () => {
  expect(count(buildGPX(snap()), 'trk')).toBe(0);
  expect(buildCSV(snap())).toBe('\uFEFF' + CSV_COLUMNS.join(',') + '\r\n');
  expect(buildPNGLayout(snap()).pages).toEqual([]);
  const data = { ...snap(dog()), until: 0 };
  expect(count(buildGPX(data), 'trkpt')).toBe(1);
  expect(buildCSV(data).split('\r\n')).toHaveLength(3);
});

// Design spec.txt:490:「三種格式同一個主檔名；PNG 多張加 _1、_2；不能當檔名的字換成『_』」。
test('all formats share local filename base and split PNG suffixes', () => {
  const data = snap(dog({ name: 'A<>:"/\\|?*' }));
  const files = ['gpx', 'csv', 'png'].map(format => buildExportFilename(data, format));
  expect(new Set(files.map(file => file.slice(0, -4))).size).toBe(1);
  expect(files[0]).toContain('A_________-4');
  expect(buildExportFilename(data, 'png', 1)).toBe(files[2].replace('.png', '_1.png'));
});

// Design spec.txt:405:「匯出按下那一刻的快照」；temp-file contract: next local calendar day cleanup, never elapsed 24h.
test('cleanup handles year boundary and invalid timestamps safely', () => {
  const createdAt = Date.parse('2026-12-31T15:59:59Z');
  expect(shouldCleanupExport({ createdAt }, createdAt + 1000, 'Asia/Taipei')).toBe(true);
  expect(shouldCleanupExport({ createdAt: NaN }, createdAt)).toBe(false);
});

// Design spec.txt:489:「欄位 source、id、recorded_at、location_at、latitude、longitude、accuracy_meters、altitude_meters、speed_kmh、heading_degrees、raw_latitude、raw_longitude、session_id、raw_speed_kmh、speed_accuracy_mps、motion_state、display_source、display_location_at、master_id、slave_id、satellites、hdop、rssi、snr；沒值留空」。
test('CSV exact design header and all supplied fields survive serialization', () => {
  expect(CSV_COLUMNS.join(',')).toBe('source,id,recorded_at,location_at,latitude,longitude,accuracy_meters,altitude_meters,speed_kmh,heading_degrees,raw_latitude,raw_longitude,session_id,raw_speed_kmh,speed_accuracy_mps,motion_state,display_source,display_location_at,master_id,slave_id,satellites,hdop,rssi,snr');
  const row = point(0, { id: '位置', recorded_at: 0, accuracy_meters: 10, altitude_meters: 20, speed_kmh: 30, heading_degrees: 40, raw_latitude: 24, raw_longitude: 120, session_id: 'session', raw_speed_kmh: 50, speed_accuracy_mps: 2, motion_state: 'moving', display_source: 'collar', display_location_at: 0, master_id: 7, slave_id: 4, satellites: 8, hdop: 1, rssi: -60, snr: 9 });
  const cells = buildCSV(snap(dog({ rows: [row] }))).split('\r\n')[1].slice(1, -1).split('","');
  expect(cells).toEqual(['dog-4', '位置', '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', '24', '120', '10', '20', '30', '40', '24', '120', 'session', '50', '2', 'moving', 'collar', '1970-01-01T00:00:00.000Z', '7', '4', '8', '1', '-60', '9']);
});

// Design edges.txt:49:「GPX trkpt、CSV 寫原始座標（包括室內飄移的點，GPX 另開 trkseg）」；spec.txt:391:「GPS 點照它自己的定位時間歸到那個時間的區間」。
test('dense raw indoor drift is neither simplified nor reassigned by delayed packet time', () => {
  const samples = Array.from({ length: 2000 }, (_, index) => point(10 * m + index, { location_at: index, raw_latitude: 24 + index / 100000, raw_longitude: 120 + index / 100000 }));
  const data = snap(dog({ rows: samples, holds: [{ start: 0, end: 3000, latitude: 25, longitude: 121 }] }));
  const gpx = buildGPX(data);
  expect(count(gpx, 'trkpt')).toBe(2000);
  expect(count(gpx, 'trkseg')).toBe(1);
  expect(gpx).toContain('<wpt lat="25" lon="121">');
  expect(gpx).toContain('lat="24.01999" lon="120.01999"');
  expect(buildCSV(data).split('\r\n')).toHaveLength(2002);
});

// Design spec.txt:485:「排到下一列會超過 2400px 就換張」；hist.txt:318:「剛好從新的一張開始的狗用一般段頭」。
test('exact 2400 pixel page fits and next new dog starts without continuation', () => {
  const timeline = [...Array.from({ length: 9 }, () => ({ type: 'move' })), { type: 'move', detail: 'a\nb\nc\nd\ne\nf' }];
  const single = buildPNGLayout(snap(dog({ timeline })), { measureText: () => 0 });
  // 120 title + 1080 map + 9*96 + (36 + 6*36 + 24) row + 60 footer.
  expect(single.pages).toHaveLength(1);
  expect(single.pages[0].height).toBe(2400);
  const extra = buildPNGLayout(snap(dog({ timeline: [...timeline, { type: 'move' }] })), { measureText: () => 0 });
  expect(extra.pages).toHaveLength(2);
  const multi = buildPNGLayout(snap(dog({ timeline: Array.from({ length: 9 }, () => ({ type: 'move' })) }), dog({ name: '豆豆', slaveId: 5, timeline: [{ type: 'stay' }] })), { measureText: () => 0 });
  expect(multi.pages[1].blocks[0]).toMatchObject({ type: 'section', title: '豆豆' });
  expect(multi.pages[1].legend).toEqual(multi.pages[0].legend);
});

// Design hist.txt:321:「我的路線…標題『DogTracker・我的路線』＋日期起訖、距離；沒有圖例；清單有走路和開車段（開車寫『不算距離』）」。
test('phone PNG preserves walking and driving timeline details without dog sections', () => {
  const layout = buildPNGLayout(snap(dog({ kind: 'phone', distanceKm: 1.4, timeline: [{ type: 'move', detail: '走路 28 分・1.4 km' }, { type: 'drive', detail: '開車 12 分・6.3 km・不算距離' }, { type: 'gap', detail: '沒有資料 00:40–00:50' }] })));
  expect(layout.pages[0].title).toContain('DogTracker・我的路線');
  expect(layout.pages[0].title).toContain('1.4 km');
  expect(layout.pages[0].legend).toEqual([]);
  expect(layout.pages[0].blocks.some(block => block.type === 'section')).toBe(false);
  expect(rows(layout).map(row => row.detailLines.join(''))).toEqual(['走路 28 分・1.4 km', '開車 12 分・6.3 km・不算距離', '沒有資料 00:40–00:50']);
});

// Design hist.txt:9:「匯出選的範圍（同一天）」；spec.txt:489:「CSV 每一筆位置」。
test('CSV selected recording range includes both endpoints and excludes outside packets', () => {
  const data = snap(dog({ rows: [point(-1, { id: 'before' }), point(0, { id: 'start' }), point(60 * m, { id: 'end' }), point(60 * m + 1, { id: 'after' })] }));
  const csv = buildCSV(data);
  expect(csv).toContain('"start"');
  expect(csv).toContain('"end"');
  expect(csv).not.toContain('"before"');
  expect(csv).not.toContain('"after"');
  expect(csv.split('\r\n')).toHaveLength(4);
});

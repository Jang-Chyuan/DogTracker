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

// Design spec.txt:488: | GPX | GPX 1.1，時間用 UTC。狗的歷史：每隻狗一條移動的 trk（名稱「小黑-4」），中斷的地方分成不同的 trkseg；每一次坐車各自一個 trk（「小黑-4 坐車 1（不算距離）」、type＝drive），坐車前後的移動不相連。我的路線：步行的路線一條 trk（名稱「我的路線」，遇到中斷或開車都分成不同的 trkseg，開車前後不相連），每一次開車各自一個 trk，名稱依序「開車 1（不算距離）」「開車 2（不算距離）」、type＝drive（GPX 1.1 的 trk 有 type 欄位）；選定匯出範圍內沒資料的狗不寫 trk；停留是 wpt：名稱「小黑-4 停留 1・18 分」（我的路線「停留 1・18 分」）、時間＝停留開始、desc＝地點（扣過中斷時再加「不含中斷 5 分」）；多隻狗是一個檔案，每隻狗各自一條移動的 trk 和每次坐車各一個 trk（名稱前面是那隻的狗名和訊號源編號，例「小黑-4」「小黑-4 坐車 1（不算距離）」）。停在原處也是 wpt：名稱「小黑-4 室內・40 分」、座標＝停住點、時間＝照匯出範圍裁切後那段的開始（時間長度也照裁切後算；中間有「沒有資料」斷開時每段各一個）、desc＝地址（查不到就不寫）；沿著手機路線畫的那段不寫（原始資料裡沒有項圈座標）；多隻狗時每隻各自輸出（名稱前面是那隻的狗名和訊號源編號）
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

// Design spec.txt:376: | GPX 在停在原處前後分段 | 停住時結束目前的 trkseg；停住期間如果有有效原始 GPS（室內飄移），從第一個點另開一個 trkseg（期間中斷超過 3 分鐘再分段）；放開時再結束、放開後第一個有效 GPS 點開新的 trkseg，讓其他地圖軟體分得出室內飄移的那段
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

// Design spec.txt:222: | 同一隻狗本機和雲端同時有 | 兩筆都留著、各自記來源；先依「資料來源」篩選，「全部」時再把同一訊號源（slave_id）、同一定位時間的合成一筆（顯示本機那筆，因為有離接收器距離）
test('exactly 3 minutes stays connected; missing GPS, sessions, explicit gaps break', () => {
  const data = snapshot(dog({ rows: [point(0), point(3 * minute), point(4 * minute, { latitude: null }), point(5 * minute), point(6 * minute, { session_id: 'new' }), point(7 * minute, { session_id: 'new' })], gaps: [{ start: 6.2 * minute, end: 6.8 * minute }] }));
  expect(count(buildGPX(data), 'trkseg')).toBe(4);
});

// Design spec.txt:319: | 停在原處的 GPX | 有效的原始 GPS 照常寫成 trkpt（停住那段也一樣，包括室內飄移的點）；停住那段另外輸出一個 wpt：座標＝停住點，先照匯出範圍裁切，時間＝裁切後那段的開始，名稱寫裁切後的時間長度（例「小黑-4 室內・40 分」），desc＝地址（查不到就不寫）；中間有「沒有資料」斷開時每段各一個 wpt；整天都沒有有效原始 GPS 時，GPX 只有 wpt
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
  expect(buildCSV(data).split('\r\n')).toHaveLength(3);
});

// Design spec.txt:488: | GPX | GPX 1.1，時間用 UTC。狗的歷史：每隻狗一條移動的 trk（名稱「小黑-4」），中斷的地方分成不同的 trkseg；每一次坐車各自一個 trk（「小黑-4 坐車 1（不算距離）」、type＝drive），坐車前後的移動不相連。我的路線：步行的路線一條 trk（名稱「我的路線」，遇到中斷或開車都分成不同的 trkseg，開車前後不相連），每一次開車各自一個 trk，名稱依序「開車 1（不算距離）」「開車 2（不算距離）」、type＝drive（GPX 1.1 的 trk 有 type 欄位）；選定匯出範圍內沒資料的狗不寫 trk；停留是 wpt：名稱「小黑-4 停留 1・18 分」（我的路線「停留 1・18 分」）、時間＝停留開始、desc＝地點（扣過中斷時再加「不含中斷 5 分」）；多隻狗是一個檔案，每隻狗各自一條移動的 trk 和每次坐車各一個 trk（名稱前面是那隻的狗名和訊號源編號，例「小黑-4」「小黑-4 坐車 1（不算距離）」）。停在原處也是 wpt：名稱「小黑-4 室內・40 分」、座標＝停住點、時間＝照匯出範圍裁切後那段的開始（時間長度也照裁切後算；中間有「沒有資料」斷開時每段各一個）、desc＝地址（查不到就不寫）；沿著手機路線畫的那段不寫（原始資料裡沒有項圈座標）；多隻狗時每隻各自輸出（名稱前面是那隻的狗名和訊號源編號）
test('stay duration excludes clipped gaps and preserves timeline numbering; phone drive naming', () => {
  const subject = dog({ kind: 'phone', stays: [{ start: -minute, end: 20 * minute, latitude: 25, longitude: 121, number: 4, address: '公園' }],
    gaps: [{ start: 5 * minute, end: 10 * minute }], rides: [{ start: 0, end: minute }] });
  const gpx = buildGPX(snapshot(subject));
  expect(gpx).toContain('停留 4・15 分');
  expect(gpx).toContain('公園・不含中斷 5 分');
  expect(gpx).toContain('<name>我的路線</name>');
  expect(gpx).toContain('<name>開車 1（不算距離）</name><type>drive</type>');
});

// Design spec.txt:489: | CSV | 照 main 現在的格式：UTF-8；欄位 source、id、recorded_at、location_at、latitude、longitude、accuracy_meters、altitude_meters、speed_kmh、heading_degrees、raw_latitude、raw_longitude、session_id、raw_speed_kmh、speed_accuracy_mps、motion_state、display_source、display_location_at、master_id、slave_id、satellites、hdop、rssi、snr；沒值留空。停在原處、在車上沒定位時畫在手機位置只改畫法，CSV 照樣寫原始座標。我的路線也用同一個 24 欄表頭：source 填 phone，master_id、slave_id、satellites、hdop、rssi、snr 這些項圈欄位留空
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

// Design spec.txt:391: | GPS 點屬於哪一段 | 停住、放開看封包時間；GPS 點照它自己的定位時間歸到那個時間的區間：定位時間落在停住區間裡的點，算停住期間的原始 GPS（照「GPX 在停在原處前後分段」），不畫在地圖路線上、不算距離
test('range is inclusive, excludes outside points/empty dogs, uses GPS acquisition time for hold classification', () => {
  const data = snapshot(dog({ rows: [point(-1), point(0), point(60 * minute), point(60 * minute + 1)] }), dog({ slaveId: 3, rows: [point(-1)] }));
  expect(count(buildGPX(data), 'trk')).toBe(1);
  expect(count(buildGPX(data), 'trkpt')).toBe(2);
  const delayed = snapshot(dog({ rows: [point(4 * minute, { location_at: minute }), point(5 * minute, { location_at: 2 * minute })], holds: [{ start: 0, end: 2 * minute, latitude: 25, longitude: 121 }] }));
  expect(count(buildGPX(delayed), 'trkseg')).toBe(2);
});

const timeline = n => Array.from({ length: n }, (_, i) => ({ type: 'stay', address: `地址 ${i}`, label: '停 10 分' }));
// Design spec.txt:485: | PNG 分頁 | 分張只看累計高度：排到下一列會超過 2400px 就換張（標題、圖例、段頭、頁尾都算進去）。第 1 張：標題＋圖例（多隻狗時在標題下一列，每隻一個路線色塊＋狗名＋距離，高 56px）＋地圖（1080×1080）＋清單；之後的每張：重複標題、圖例（多隻狗時）、頁碼，只放清單；多隻狗時只有被切開的那隻在下一張開頭寫「〔狗名〕（續）」（剛好從新的一張開始的用一般段頭）；一隻狗沒有段頭，下一張直接接著清單；地圖署名跟著地圖；標題和清單列依內容自動長高；多隻狗：清單依狗分段（每段開頭狗名＋路線色）
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

// Design hist.txt:318: | 時間軸清單 | 一段 | 每隻一段：段頭色條＋狗名＋起訖＋距離，下面是牠的時間軸；某隻的清單被換張切開時，下一張開頭寫「〔狗名〕（續）」；剛好從新的一張開始的狗用一般段頭
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

// Design spec.txt:339: | PNG 第 1 張放不下清單 | 地圖下方剩的高度放不下第一隻狗的段頭＋第一個節點時，第 1 張只放標題、圖例、地圖、頁尾，清單從第 2 張開始
test('PNG wraps legend, preserves long addresses and moves list to page 2 if first node will not fit', () => {
  const subjects = [1, 2, 3, 4].map(slaveId => dog({ slaveId, name: '很長的名字'.repeat(42), timeline: [{ type: 'stay', address: '地址'.repeat(30), detail: '說明'.repeat(10) }] }));
  const layout = buildPNGLayout(snapshot(...subjects));
  expect(layout.pages[0].legendHeight).toBeGreaterThan(56);
  expect(layout.pages[0].blocks.map(b => b.type)).toEqual(['map']);
  const rows = layout.pages.flatMap(p => p.blocks.filter(b => b.type === 'row'));
  expect(rows).toHaveLength(4);
  expect(rows[0].addressLines.length).toBeGreaterThan(2);
  expect(rows[0].addressLines.join('')).toBe('地址'.repeat(30));
  expect(layout.pages[1].blocks[0].title).not.toContain('（續）');
  expect(layout.pages.every(p => p.height <= 2400)).toBe(true);
});

// Design spec.txt:487: | 多隻狗 PNG | 選定匯出範圍內沒資料的狗（停住期間的封包也算有資料）不算進隻數、不畫、沒有清單段；標題「DogTracker・狗的歷史（3 隻）・起訖」；每隻狗一段，段頭寫狗名、路線色、起訖時間、距離；換張時，被切開的那隻在下一張開頭寫「〔狗名〕（續）」
test('only one active dog uses single layout and filename; no data yields no pages', () => {
  const data = snapshot(dog(), dog({ slaveId: 5, rows: [] }));
  expect(buildPNGLayout(data).pages[0].legend).toEqual([]);
  expect(buildPNGLayout(snapshot()).pages).toEqual([]);
  expect(buildExportFilename(data, 'gpx')).toContain('小黑-4');
});

// Design spec.txt:490: | 檔名 | 格式：DogTracker_〔對象〕_〔開始〕_〔結束〕.〔png／gpx／csv〕，開始、結束寫成 20261003-0803；例：DogTracker_我的路線_20261003-0803_20261003-1211.png、DogTracker_小黑-4_20261003-0803_20261003-1211.gpx、DogTracker_狗的歷史_20261003-0800_20261003-1211.csv；三種格式同一個主檔名；PNG 多張加 _1、_2；不能當檔名的字換成「_」
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

// Design hist.txt:9: | 匯出 | 右上一個匯出 icon；匯出選的範圍（同一天）
test('invalid or cross-day ranges and unknown formats reject', () => {
  expect(() => buildGPX({ ...snapshot(dog()), since: 5, until: 4 })).toThrow();
  expect(() => buildCSV({ ...snapshot(dog()), until: 86400000 })).toThrow();
  expect(() => buildExportFilename(snapshot(dog()), 'zip')).toThrow();
});

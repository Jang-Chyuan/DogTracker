import fs from 'fs';
import path from 'path';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { createSettingsDatabase } from '../src/database/SettingsDatabase';
import { createDogDataStore, DOG_DATA_TABLES, UnsentRowsError } from '../src/database/DogDataStore';
import { createUploadDatabase } from '../src/cloudUpload/UploadDatabase';
import {
  DELETE_BODY, OFFLINE_PROBLEM, deleteDialog, unsentQuestion, uploadProblem, useDeleteDogData,
} from '../src/settings/DeleteDogData';
import { settleMovement, settleSeries } from '../src/diagnostics/SpeedBuffer';
import { diagnosticsPage } from '../src/diagnostics/DiagnosticsModel';
import { buildFixture, fixturePageFromUrl, FIXTURE_NOW } from '../src/dev/ScreenFixtures';
import { settingsHome, settingsInput } from '../src/settings/SettingsModel';
import { storageProblem } from '../src/map/TopAlerts';
import { wifiSummary } from '../src/settings/useReceiverWifi';
import WifiSettings from '../src/settings/WifiSettings';
import LiveDataSettings from '../src/settings/LiveDataSettings';
import DiagnosticsSettings from '../src/settings/DiagnosticsSettings';

const text = renderer => JSON.stringify(renderer.toJSON());

// ---- #44's speed buffer (plan §4 item 11), only on S8 now -------------------

test('moving and still settle with a margin, so walking slowly does not flicker', () => {
  expect(settleMovement(null, 2)).toBe('moving');
  expect(settleMovement('moving', 1.2)).toBe('moving');
  expect(settleMovement('moving', 0.8)).toBe('moving');
  expect(settleMovement('moving', 0.4)).toBe('still');
  expect(settleMovement('still', 1.2)).toBe('still');
  expect(settleMovement('still', 1.6)).toBe('moving');
  expect(settleMovement(null, 1.2)).toBe('moving');
  expect(settleMovement(null, 0.8)).toBe('still');
  expect(settleMovement('moving', NaN)).toBeNull();
  expect(settleMovement('moving', null)).toBeNull();
});

test('a series settles oldest first; readings without a speed do not move it', () => {
  // Stopping: 3 → 1.2 (still moving) → 0.4 (still) → 1.2 (stays still).
  expect(settleSeries([3, 1.2, 0.4, 1.2])).toEqual({ state: 'still', lastSpeed: 1.2, readings: 4 });
  expect(settleSeries([0.2, null, 1.4])).toEqual({ state: 'still', lastSpeed: 1.4, readings: 2 });
  expect(settleSeries([null, undefined])).toBeNull();
  expect(settleSeries([])).toBeNull();
});

// ---- S8 診斷 -------------------------------------------------------------------

test('diagnostics-ok: each dog has its environment result; the receiver dog its speed buffer', () => {
  const fixture = buildFixture('diagnostics-ok');
  expect(fixture.openRoute).toBe('diagnostics');
  const page = diagnosticsPage({ packets: fixture.cloudDogs.packets, rows: fixture.raw.ble,
    aliases: fixture.dogAliases, storage: null, now: fixture.now });
  expect(page.storage).toBeNull();
  expect(page.dogs.map(dog => [dog.slaveId, dog.name])).toEqual([[4, '豆豆'], [6, '小黑'], [8, '阿福']]);
  for (const dog of page.dogs) {
    // A model answer (室內／窗邊／室外, or 疑似… under 60%), never the empty wait.
    expect(dog.environment.label).toMatch(/室內|窗邊|室外|無法判斷/);
    expect(dog.environment.evidence).toMatch(/^模型機率：室內 \d+% · 窗邊 \d+% · 室外 \d+%$/);
    expect(dog.environment.window).toMatch(/^09:2\d–09:\d\d・\d+ 筆$/);
  }
  expect(page.dogs[0].environment.source).toBe('接收器');
  expect(page.dogs[1].environment.source).toBe('雲端');
  // 豆豆 walks at 3 km/h on receiver 7; the cloud dogs have no rows of this phone.
  expect(page.dogs[0].movement).toEqual({ label: '移動中', detail: expect.stringMatching(/^最近 3\.0 km\/h・\d+ 筆$/) });
  expect(page.dogs[1].movement).toBeNull();
  expect(page.dogs[0].label).toMatch(/^豆豆，訊號源 4，環境 .+，速度緩衝 移動中$/);
});

test('diagnostics-empty: no dog, no reason; diagnostics-error: the storage reason first', () => {
  const empty = buildFixture('diagnostics-empty');
  expect(diagnosticsPage({ packets: empty.cloudDogs.packets, rows: empty.raw.ble, now: empty.now }))
    .toEqual({ storage: null, dogs: [] });
  const error = buildFixture('diagnostics-error');
  expect(error.openRoute).toBe('diagnostics');
  const page = diagnosticsPage({ packets: error.cloudDogs.packets, rows: error.raw.ble,
    storage: storageProblem(error.storageError), now: error.now });
  expect(page.storage).toEqual({ full: false, reason: '資料存檔失敗：attempt to write a readonly database',
    title: '寫入失敗' });
  expect(diagnosticsPage({ storage: storageProblem('database or disk is full') }).storage.title).toBe('手機空間不足');
});

test('a packet without a fix carries no speed; the newer environment window wins', () => {
  const page = diagnosticsPage({
    rows: [
      { id: 1, slave_id: 5, received_at: 1000, slave_lat: 25, slave_lon: 121, speed_kmh: 2 },
      { id: 2, slave_id: 5, received_at: 2000, slave_lat: 0, slave_lon: 0, speed_kmh: 0 },
    ],
    packets: [
      { slave_id: 5, source: 'cloud', environment: { environment: 'indoor', source: 'random_forest', hasSignal: true,
        modelConfidence: 0.7, probabilities: { indoor: 0.7, window: 0.2, outdoor: 0.1 }, samples: 3,
        observedAt: 1000, windowStart: 0, windowEnd: 120000 } },
      { slave_id: 5, source: 'ble', environment: { environment: 'outdoor', source: 'random_forest', hasSignal: true,
        modelConfidence: 0.9, probabilities: { indoor: 0.05, window: 0.05, outdoor: 0.9 }, samples: 4,
        observedAt: 2000, windowStart: 0, windowEnd: 120000 } },
    ],
    now: 30000,
  });
  expect(page.dogs[0].name).toBe('狗 5');
  expect(page.dogs[0].movement.label).toBe('移動中');
  expect(page.dogs[0].environment).toMatchObject({ label: '室外（信心 90%）', source: '接收器' });
});

test('S8 draws the reason, the three pages and each dog without cutting lines short', async () => {
  const fixture = buildFixture('diagnostics-error');
  const page = diagnosticsPage({ packets: fixture.cloudDogs.packets, rows: fixture.raw.ble,
    aliases: fixture.dogAliases, storage: storageProblem(fixture.storageError), now: fixture.now });
  const opened = [];
  let renderer;
  await act(async () => { renderer = Renderer.create(<DiagnosticsSettings page={page} onOpen={id => opened.push(id)} />); });
  expect(text(renderer)).toContain('attempt to write a readonly database');
  for (const title of ['即時資料', '本機／雲端資料', '記錄清單', '每隻狗的判斷']) expect(text(renderer)).toContain(title);
  for (const id of ['liveData', 'cloudData', 'locationRecords']) {
    await act(async () => renderer.root.findByProps({ testID: `diagnostics-${id}` }).props.onPress());
  }
  expect(opened).toEqual(['liveData', 'cloudData', 'locationRecords']);
  // No judgement line is limited to a number of lines.
  const dog = renderer.root.findByProps({ testID: 'diagnostics-dog-4' });
  expect(dog.findAll(node => node.props.numberOfLines != null)).toHaveLength(0);
  await act(async () => renderer.update(<DiagnosticsSettings page={{ storage: null, dogs: [] }} onOpen={() => {}} />));
  expect(text(renderer)).toContain('還沒有狗的資料');
  await act(async () => renderer.unmount());
});

test('即時資料: rows in a table, columns picked and reset, 讀取失敗 with 重試, the empty state', async () => {
  jest.useFakeTimers();
  const fixture = buildFixture('diagnostics-ok');
  const listHistory = jest.fn(fixture.diagnostics.listHistory);
  let renderer;
  await act(async () => { renderer = Renderer.create(<LiveDataSettings dogDatabase={{ listHistory }} />); });
  expect(listHistory).toHaveBeenCalledWith(100);
  expect(text(renderer)).toContain('接收時間');
  expect(text(renderer)).not.toContain('HDOP');
  const press = async label => act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === label
    && typeof node.props.onPress === 'function')[0].props.onPress());
  await press('選擇欄位（5）');
  await press('HDOP');
  const table = () => JSON.stringify(renderer.root.findByProps({ testID: 'live-data-table' }).findAllByType('Text')
    .map(node => node.props.children));
  expect(table()).toContain('HDOP');
  expect(table()).toContain('0.9');
  await press('恢復預設欄位');
  expect(table()).not.toContain('HDOP');
  await press('收起欄位');
  expect(text(renderer)).toContain('選擇欄位（5）');
  // Cells wrap instead of being cut.
  expect(renderer.root.findByProps({ testID: 'live-data-table' })
    .findAll(node => node.props.numberOfLines != null)).toHaveLength(0);
  // Every second it reads again.
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(listHistory).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());

  const failing = buildFixture('diagnostics-read-failed').diagnostics;
  await act(async () => { renderer = Renderer.create(<LiveDataSettings dogDatabase={{ listHistory: failing.listHistory }} />); });
  expect(text(renderer)).toContain('讀取失敗：database disk image is malformed');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === '重試').length).toBeGreaterThan(0);
  await act(async () => renderer.unmount());

  await act(async () => { renderer = Renderer.create(<LiveDataSettings dogDatabase={{ listHistory: async () => [] }} />); });
  expect(text(renderer)).toContain('還沒有資料');
  await act(async () => renderer.unmount());
  jest.useRealTimers();
});

test('the fixtures open S7 and S8 and their data pages (&page=…)', () => {
  expect(fixturePageFromUrl('dogtracker://dev/fixture?name=all-good&page=advanced')).toBe('advanced');
  expect(fixturePageFromUrl('dogtracker://dev/fixture?name=all-good&page=diagnostics')).toBe('diagnostics');
  expect(fixturePageFromUrl('dogtracker://dev/fixture?name=all-good&page=liveData')).toBe('liveData');
  expect(fixturePageFromUrl('dogtracker://dev/fixture?name=all-good&page=nowhere')).toBeNull();
  const confirm = buildFixture('advanced-delete-confirm');
  expect(confirm.openRoute).toBe('advanced');
  expect(confirm.deletion).toEqual({ unsent: 120, open: true });
  expect(buildFixture('all-good').deletion).toEqual({ unsent: 0, open: false });
  expect(buildFixture('diagnostics-empty').openRoute).toBe('diagnostics');
});

test('the fixtures\' data pages read their own rows: newest first, signed in only, records by page', async () => {
  const ok = buildFixture('diagnostics-ok').diagnostics;
  const live = await ok.listHistory(100);
  expect(live.length).toBeGreaterThan(10);
  expect(live[0].received_at).toBeGreaterThanOrEqual(live[1].received_at);
  const cloud = ok.cloudDatabase;
  expect(await cloud.count('fixture-owner')).toBeGreaterThan(0);
  expect(await cloud.listHistory('someone-else', 0)).toEqual([]);
  expect(JSON.parse((await cloud.listHistory('fixture-owner', 0))[0].raw_payload)).toHaveProperty('payload');
  const session = await ok.cloudClient().auth.getSession();
  expect(session.data.session.user.email).toBe('tim@example.com');
  const first = await ok.readLocationPage(0);
  expect(first.rows).toHaveLength(50);
  expect(first.hasMore).toBe(true);
  const next = await ok.readLocationPage(first.rows[49].id);
  expect(next.rows[0].id).toBe(first.rows[49].id - 1);
  // Signed out with no record: the cloud page is the sign-in hint, no rows.
  const empty = buildFixture('diagnostics-empty').diagnostics;
  expect((await empty.cloudClient().auth.getSession()).data.session).toBeNull();
  expect((await empty.readLocationPage(0)).rows).toEqual([]);
  expect(await empty.listHistory(100)).toEqual([]);
});

// ---- S7 進階 -------------------------------------------------------------------

test('S1 進階 says 「接收器 Wi-Fi、刪除資料」 (c196)', () => {
  const fixture = buildFixture('settings-all-ok');
  const data = settingsInput({ ...fixture, tracking: { point: fixture.tracking.point, realWriteError: null },
    cloudDogs: fixture.cloudDogs }, { now: fixture.now, receiverState: fixture.receiverState });
  const advanced = settingsHome(data).groups.flatMap(group => group.rows).find(row => row.id === 'advanced');
  expect(advanced).toMatchObject({ title: '進階', subtitle: '接收器 Wi-Fi、刪除資料', problem: false });
});

test('S7 Wi-Fi line: the receiver\'s networks, or why there are none', () => {
  expect(wifiSummary({ ssids: ['家裡', '辦公室'] })).toBe('家裡、辦公室');
  expect(wifiSummary({ ssids: [] })).toBe('還沒有存 Wi-Fi');
  expect(wifiSummary({ ssids: null, loading: true })).toBe('讀取中…');
  expect(wifiSummary({ ssids: null, error: 'BLE 已斷線' })).toBe('讀取失敗');
  expect(wifiSummary({ ssids: null, connected: false })).toBe('接收器連上後才能設定');
});

test('接收器 Wi-Fi page: the list, delete asks first, a failed send says why and offers 重試', async () => {
  const wifi = {
    connected: true, ssids: ['家裡', '辦公室'], activeSsid: '家裡', loading: false, error: '',
    reload: jest.fn(), save: jest.fn().mockRejectedValueOnce(new Error('BLE 已斷線')).mockResolvedValue(),
    remove: jest.fn(async () => {}),
  };
  let renderer;
  await act(async () => { renderer = Renderer.create(<WifiSettings wifi={wifi} receiver="接收器 7" />); });
  expect(text(renderer)).toContain('接收器 7 存的 Wi-Fi');
  expect(text(renderer)).toContain('使用中');
  const find = id => renderer.root.findByProps({ testID: id });
  await act(async () => find('wifi-delete-辦公室').props.onPress());
  expect(text(renderer)).toContain('接收器 7 不會再連「辦公室」。');
  expect(wifi.remove).not.toHaveBeenCalled();
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '刪除'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(wifi.remove).toHaveBeenCalledWith('辦公室');
  // The password can be shown; a send without a name asks for one.
  await act(async () => find('wifi-send').props.onPress());
  expect(text(renderer)).toContain('請輸入 Wi-Fi 名稱');
  await act(async () => find('wifi-ssid').props.onChangeText('倉庫'));
  await act(async () => find('wifi-password').props.onChangeText('secret-1'));
  expect(find('wifi-password').props.secureTextEntry).toBe(true);
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '顯示密碼')[0].props.onPress());
  expect(find('wifi-password').props.secureTextEntry).toBe(false);
  await act(async () => find('wifi-send').props.onPress());
  expect(text(renderer)).toContain('傳送失敗：BLE 已斷線');
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === '重試'
    && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(wifi.save).toHaveBeenLastCalledWith('倉庫', 'secret-1');
  expect(text(renderer)).toContain('已傳送到接收器 7');
  // Not connected: nothing can be sent, and it says why.
  await act(async () => renderer.update(<WifiSettings wifi={{ ...wifi, connected: false }} receiver="接收器 7" />));
  expect(text(renderer)).toContain('接收器 7 沒有連線');
  expect(find('wifi-send').props.disabled).toBe(true);
  await act(async () => renderer.unmount());
});

// ---- 刪除全部狗資料 on SQLite ---------------------------------------------------

async function phoneDatabase() {
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  await createCloudDatabase(connection).initialize();
  const history = createHistoryDatabase(connection);
  await history.load();
  await history.loadDogAvatars();
  connection.sqlite.exec(`INSERT INTO map_history_settings VALUES (1, '{"dogAliases":{"4":"豆豆"}}')`);
  await createSettingsDatabase(connection).initialize();
  // The receiver service's upload queue and the phone's own records, as the
  // Android code creates them.
  const kotlin = file => fs.readFileSync(path.join(__dirname, '../android/app/src/main/java/com/dogtracker', file), 'utf8');
  for (const sql of kotlin('BleUploadQueue.kt').matchAll(/db\.execSQL\("(CREATE [^"]+)"\)/g)) connection.sqlite.exec(sql[1]);
  connection.sqlite.exec(/command\("(CREATE TABLE IF NOT EXISTS myLocationTracker[^"]+)"\)/
    .exec(kotlin('location/LocationTrackerStore.kt'))[1]);
  const db = connection.sqlite;
  db.exec("INSERT INTO ble_upload_meta VALUES('phone_id','phone-a')");
  db.prepare('INSERT INTO dog_status (received_at, master_id, slave_id, slave_lat, slave_lon) VALUES (?,7,4,25,121)').run(1000);
  db.prepare(`INSERT INTO supabase_dog_status (owner_user_id, event_id, received_at, master_id, slave_id, slave_lat, slave_lon)
    VALUES ('alice','e1',?,9,6,25,121)`).run(2000);
  db.exec("INSERT INTO cloud_sync_state VALUES ('alice', 9, '2026-10-07T01:00:00Z', NULL, 1)");
  db.exec("INSERT INTO cloud_sync_buckets VALUES ('alice', 9, 0, 3, 1)");
  db.exec("INSERT INTO myLocationTracker (recorded_at, location_at, latitude, longitude) VALUES (1, 1, 24.98, 121.31)");
  db.exec(`INSERT INTO dog_avatars VALUES (4, '{"kind":"art"}')`);
  db.exec(`INSERT INTO app_settings VALUES ('map_preferences', '{}')`);
  db.exec("INSERT INTO ble_upload_settings VALUES ('alice', 7, 'phone')");
  const queue = db.prepare(`INSERT INTO ble_upload_queue (event_id, owner_user_id, master_id, received_at, payload_json,
    fingerprint, status, sent_at, slave_id) VALUES (?, 'alice', 7, 1000, '{}', ?, ?, ?, 4)`);
  queue.run('sent-1', 'f1', 'sent', 5000);
  queue.run('sent-2', 'f2', 'sent', 9000);
  queue.run('wait-1', 'f3', 'pending', null);
  queue.run('refused-1', 'f4', 'blocked', null);
  return connection;
}
const count = (connection, table) => connection.sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
const KEPT = ['myLocationTracker', 'dog_avatars', 'map_history_settings', 'app_settings', 'ble_upload_settings',
  'cloud_sync_state', 'cloud_sync_buckets'];

test('刪除全部狗資料 asks about rows not uploaded; 一起刪除 removes only the dog tables', async () => {
  const connection = await phoneDatabase();
  const store = createDogDataStore(connection);
  const kept = Object.fromEntries(KEPT.map(table => [table, count(connection, table)]));
  // Waiting and refused rows are both not in the cloud yet.
  expect(await store.unsent()).toBe(2);
  await expect(store.deleteAll()).rejects.toBeInstanceOf(UnsentRowsError);
  await expect(store.deleteAll()).rejects.toMatchObject({ count: 2 });
  // Nothing was deleted by the refusal.
  expect(count(connection, 'dog_status')).toBe(1);
  await store.deleteAll({ includeUnsent: true });
  for (const table of [...DOG_DATA_TABLES, 'ble_upload_queue']) expect(count(connection, table)).toBe(0);
  for (const table of KEPT) expect(count(connection, table)).toBe(kept[table]);
  // S3 still knows when alice last uploaded; the phone's upload ID stays.
  const summary = await createUploadDatabase(connection).summary('alice');
  expect(summary.last).toBe(9000);
  expect(await createUploadDatabase(connection).identity()).toBe('phone-a');
  expect(await store.unsent()).toBe(0);
  connection.close();
});

test('after 先上傳, the sent rows go too, and a row queued meanwhile stays', async () => {
  const connection = await phoneDatabase();
  connection.sqlite.exec("UPDATE ble_upload_queue SET status='sent', sent_at=12000 WHERE status <> 'sent'");
  const store = createDogDataStore(connection);
  expect(await store.unsent()).toBe(0);
  // The receiver service queues one more just before the deletion runs.
  const batch = connection.executeBatchAsync;
  connection.executeBatchAsync = jest.fn(async commands => {
    connection.sqlite.exec(`INSERT INTO ble_upload_queue (event_id, owner_user_id, master_id, received_at,
      payload_json, fingerprint, slave_id) VALUES ('late', 'alice', 7, 13000, '{}', 'f9', 4)`);
    return batch(commands);
  });
  await store.deleteAll();
  expect(connection.sqlite.prepare('SELECT event_id FROM ble_upload_queue').all()).toEqual([{ event_id: 'late' }]);
  expect(count(connection, 'dog_status')).toBe(0);
  expect(count(connection, 'supabase_dog_status')).toBe(0);
  expect((await createUploadDatabase(connection).summary('alice')).last).toBe(12000);
  connection.close();
});

test('a phone without the upload queue (never ran the receiver service) deletes the dog tables only', async () => {
  const connection = createMemoryConnection();
  await createDogDatabase(connection).initialize();
  connection.sqlite.exec('INSERT INTO dog_status (received_at, slave_id) VALUES (1, 4)');
  const store = createDogDataStore(connection);
  expect(await store.unsent()).toBe(0);
  await store.deleteAll();
  expect(count(connection, 'dog_status')).toBe(0);
  connection.close();
});

// ---- the confirmation flow -------------------------------------------------------

test('the dialog says what goes and what stays; with rows waiting it asks 先上傳／一起刪除 (c296)', () => {
  expect(deleteDialog({ open: true, phase: 'ask', unsent: 0 })).toMatchObject({
    visible: true, title: '刪除全部狗資料？', body: DELETE_BODY, note: null, confirm: '刪除', secondary: null,
  });
  expect(DELETE_BODY).toContain('只刪這支手機裡的狗位置紀錄和下載紀錄');
  expect(DELETE_BODY).toContain('雲端、手機路線、狗的名字和頭像都不會動');
  expect(deleteDialog({ open: true, phase: 'ask', unsent: 120 })).toMatchObject({
    note: '還有 120 筆沒上傳：先上傳／一起刪除', confirm: '一起刪除', secondary: '先上傳',
  });
  expect(unsentQuestion(3)).toBe('還有 3 筆沒上傳：先上傳／一起刪除');
  expect(uploadProblem('offline', 120)).toBe(OFFLINE_PROBLEM);
  expect(OFFLINE_PROBLEM).toBe('沒有網路，現在不能上傳。連上網路後再試，或選「一起刪除」');
  expect(uploadProblem('signed-out', 5)).toContain('沒有登入 Supabase');
  expect(uploadProblem('failed', 5)).toBe('還有 5 筆沒上傳完，請再試一次，或選「一起刪除」');
});

function flow(actions, initial = null) {
  const result = {};
  function Probe() {
    Object.assign(result, useDeleteDogData(actions, initial));
    return null;
  }
  let renderer;
  act(() => { renderer = Renderer.create(<Probe />); });
  return { result, unmount: () => act(() => renderer.unmount()) };
}

test('nothing waiting: 刪除 deletes without the waiting rows, then starts over', async () => {
  const actions = { countUnsent: jest.fn(async () => 0), uploadAll: jest.fn(), deleteAll: jest.fn(async () => {}),
    onDeleted: jest.fn() };
  const { result, unmount } = flow(actions);
  expect(result.dialog.visible).toBe(false);
  await act(async () => result.start());
  expect(result.dialog).toMatchObject({ visible: true, confirm: '刪除', busy: false });
  await act(async () => result.confirm());
  expect(actions.deleteAll).toHaveBeenCalledWith({ includeUnsent: false });
  expect(actions.onDeleted).toHaveBeenCalledTimes(1);
  expect(result.dialog.visible).toBe(false);
  unmount();
});

test('先上傳 without a network deletes nothing and says so; 一起刪除 then deletes everything', async () => {
  const actions = { countUnsent: jest.fn(async () => 120), uploadAll: jest.fn(async () => 'offline'),
    deleteAll: jest.fn(async () => {}), onDeleted: jest.fn() };
  const { result, unmount } = flow(actions);
  await act(async () => result.start());
  expect(result.dialog.note).toBe('還有 120 筆沒上傳：先上傳／一起刪除');
  await act(async () => result.uploadFirst());
  expect(actions.deleteAll).not.toHaveBeenCalled();
  expect(result.dialog).toMatchObject({ visible: true, problem: OFFLINE_PROBLEM, confirm: '一起刪除' });
  await act(async () => result.confirm());
  expect(actions.deleteAll).toHaveBeenCalledWith({ includeUnsent: true });
  expect(actions.onDeleted).toHaveBeenCalled();
  unmount();
});

test('先上傳 that sends everything deletes right after; closing meanwhile deletes nothing', async () => {
  let left = 120;
  const actions = { countUnsent: jest.fn(async () => left), uploadAll: jest.fn(async () => { left = 0; return 'done'; }),
    deleteAll: jest.fn(async () => {}), onDeleted: jest.fn() };
  const { result, unmount } = flow(actions);
  await act(async () => result.start());
  await act(async () => result.uploadFirst());
  expect(actions.deleteAll).toHaveBeenCalledWith({ includeUnsent: false });
  unmount();

  left = 50;
  let finish;
  const slow = { ...actions, deleteAll: jest.fn(async () => {}),
    uploadAll: jest.fn(() => new Promise(resolve => { finish = resolve; })) };
  const second = flow(slow);
  await act(async () => second.result.start());
  let upload;
  act(() => { upload = second.result.uploadFirst(); });
  expect(second.result.dialog.uploading).toBe(true);
  act(() => second.result.cancel());
  left = 0;
  await act(async () => { finish('done'); await upload; });
  expect(slow.deleteAll).not.toHaveBeenCalled();
  expect(second.result.dialog.visible).toBe(false);
  second.unmount();
});

test('rows queued while the dialog was open turn into the question; a failed deletion says why', async () => {
  const actions = { countUnsent: jest.fn(async () => 0), uploadAll: jest.fn(),
    deleteAll: jest.fn(async () => { throw new UnsentRowsError(3); }), onDeleted: jest.fn() };
  const { result, unmount } = flow(actions);
  await act(async () => result.start());
  await act(async () => result.confirm());
  expect(result.dialog).toMatchObject({ visible: true, note: '還有 3 筆沒上傳：先上傳／一起刪除', problem: null });
  actions.deleteAll.mockRejectedValueOnce(new Error('disk I/O error'));
  await act(async () => result.confirm());
  expect(result.dialog.problem).toBe('刪除失敗：disk I/O error，請再試一次');
  expect(actions.onDeleted).not.toHaveBeenCalled();
  unmount();
});

test('a fixture opens the dialog at once with its rows waiting', () => {
  const { result, unmount } = flow({ countUnsent: async () => 120 }, { unsent: 120 });
  expect(result.dialog).toMatchObject({ visible: true, note: '還有 120 筆沒上傳：先上傳／一起刪除' });
  unmount();
  expect(FIXTURE_NOW).toBe(buildFixture('advanced-delete-confirm').now);
});

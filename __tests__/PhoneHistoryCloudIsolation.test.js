import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { latestArchiveRest, cloudEvent } from '../__fixtures__/LatestArchiveRest';
import { createDogDatabase } from '../src/database/DogDatabase';
import { createCloudDatabase } from '../src/cloud/CloudDatabase';
import { createHistoryDatabase } from '../src/mapHistory/HistoryDatabase';
import { useTrackingSession } from '../src/app/useTrackingSession';
import { createCloudSync } from '../src/cloud/CloudSync';
import { createHistoryCloud } from '../src/mapHistory/HistoryCloud';
import { useHistoryScreen } from '../src/mapHistory/useHistoryScreen';
import HistoryScreen from '../src/mapHistory/HistoryScreen';
import { t } from '../src/i18n';

const NOW = Date.parse('2026-10-10T12:00:00Z'), OWNER = 'invented-owner';
const clock = () => Date.now();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let connection, tracking, screen, factory, engine, cloud, renderer, transport;
const target = { subject: 'phone', slaveId: null };
function PhonePage() {
  screen = useHistoryScreen({ target, read: tracking.historyDatabase.historyDayRows,
    readDays: tracking.historyDatabase.historyDays, owner: OWNER, cloud, clock, memoryScope: 'signed-in-local-route' });
  return <HistoryScreen screen={screen} top={24} bottomInset={0} name="我的路線" />;
}
function Harness({ phone = false }) {
  tracking = useTrackingSession(factory);
  return phone ? <PhonePage /> : null;
}
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW);
  jest.spyOn(console, 'info').mockImplementation(() => {});
  connection = createMemoryConnection(); transport = deferred();
  const real = createDogDatabase(connection); await real.initialize();
  await connection.executeAsync('CREATE TABLE myLocationTracker (id INTEGER PRIMARY KEY,recorded_at INTEGER,latitude REAL,longitude REAL,accuracy_meters REAL)');
  await connection.executeAsync('INSERT INTO myLocationTracker VALUES(1,?,25,121,5)', [NOW - 60000]);
  await connection.executeAsync('INSERT INTO myLocationTracker VALUES(2,?,25.0002,121.0002,5)', [NOW - 30000]);
  const database = createCloudDatabase(connection);
  jest.spyOn(database, 'initialize');
  factory = () => ({ real, cloud: database, history: createHistoryDatabase(connection), close: jest.fn(),
    settings: { initialize: async () => {}, load: async () => ({ mode: 'real' }), save: async () => {} } });
  await act(async () => { renderer = Renderer.create(<Harness />); });
  const network = latestArchiveRest({ events: [cloudEvent(1, NOW - 1000)],
    beforeRead: ({ phase }) => phase === 'packet' ? transport.promise : undefined });
  engine = createCloudSync({ database: tracking.cloudDatabase, client: network.client });
  engine.setSession({ user: { id: OWNER } }); engine.setForeground(true);
  cloud = createHistoryCloud({ database: tracking.cloudDatabase, client: network.client, owner: OWNER,
    runManual: (...args) => engine.runManual(...args), getPublication: () => engine.historyPublication() });
  jest.spyOn(cloud, 'download');
});
afterEach(async () => {
  transport.resolve();
  await act(async () => { renderer?.unmount(); await engine?.dispose(); await jest.advanceTimersByTimeAsync(1); });
  connection.close(); jest.restoreAllMocks(); jest.useRealTimers();
});

test('signed-in 我的路線 reads actual local rows/dates while latest is pending, without archive cancellation or a dog download', async () => {
  const archive = factory().cloud;
  await act(async () => { renderer.update(<Harness phone />); await jest.advanceTimersByTimeAsync(10001); });
  expect(engine.mapPublication().pending).toBe(true);
  expect(engine.historyPublication().latestReadReady).toBe(false);
  expect(archive.initialize).not.toHaveBeenCalled();
  expect(cloud.download).not.toHaveBeenCalled();
  expect(screen.error).toBeFalsy();
  expect(screen.dayModel?.subjects.some(subject => subject.dayRecords)).toBe(true);
  expect(screen.knowledge.local).toContain('2026-10-10');
  expect(screen.download).toBeFalsy();
  expect(screen.map).not.toBeNull();
  expect(JSON.stringify(renderer.toJSON())).not.toContain(t('c576'));
});

test('a logged-in dog read with the default subject still waits and is genuinely deferred; phone day queries bypass only that cloud barrier', async () => {
  let result;
  const dog = tracking.historyDatabase.historyDayRows({ owner: OWNER, slaveId: 6, start: NOW - 3600000, end: NOW })
    .then(() => { result = 'wrongly-read'; }, error => { result = error.message; });
  let phoneRows, phoneDays;
  const localRows = tracking.historyDatabase.historyDayRows({ subject: 'phone', owner: OWNER, start: NOW - 3600000, end: NOW })
    .then(value => { phoneRows = value; }, error => { phoneRows = { error: error.message }; });
  const localDays = tracking.historyDatabase.historyDays({ subject: 'phone', owner: OWNER })
    .then(value => { phoneDays = value; }, error => { phoneDays = { error: error.message }; });
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(result).toBeUndefined();
  await act(async () => jest.advanceTimersByTimeAsync(10001));
  await Promise.all([dog, localRows, localDays]);
  expect(phoneRows).not.toHaveProperty('error');
  expect(phoneRows.rows.map(row => row.time)).toEqual([NOW - 60000, NOW - 30000]);
  expect(phoneDays).toEqual(['2026-10-10']);
  expect(result).toBe(t('c576'));
  expect(factory().cloud.initialize).not.toHaveBeenCalled();
});

import { simplifyRoute } from '../tracking/SimplifyRoute';
import { safePhoneHistoryCoordinate } from './PhoneHistoryCoordinates';
import { coordinate } from '../tracking/RouteSamples';
import { persistCloudDisplayCoordinates, withCloudDisplayLock } from '../cloud/CloudDisplayCoordinates';
import { historyWindow, parseHistoryRange, startOfDay } from './HistoryTime';
import { normalizeDogAliases } from './DogAliases';
import { ensureBleDisplayColumns } from '../ble/BleDisplayCoordinates';
import { budgetHistory, budgetHistoryTracks, groupHistoryStreams } from './HistoryGeometryBudget';

// The single list the app composition binds; a method added here without the
// binding would only be missing on a phone, never in a repository test.
export const HISTORY_DATABASE_METHODS = ['load', 'save', 'read', 'listDevices', 'listDays',
  'hasPhoneTrack'];
// Several dogs can be out with several Masters, so both are lists.
export const HISTORY_PRESET_HOURS = Object.freeze([1, 3, 6, 12, 24]);
export const HISTORY_DEFAULTS = { phone: true, client: true, source: 'ble', hours: 3,
  masters: [7], slaves: [4], timeMode: 'recent', startAt: null, endAt: null };
const idList = value => (Array.isArray(value) ? value : [value])
  .map(Number).filter(id => Number.isInteger(id) && id > 0);
export function validateHistory(value) {
  const p = { ...HISTORY_DEFAULTS, ...value };
  if (p.dogAliases !== undefined) p.dogAliases = normalizeDogAliases(p.dogAliases);
  if (!['recent', 'fixed'].includes(p.timeMode)) throw new Error('時間模式無效');
  // The tab decides whether history is shown, so a stored `enabled` from an
  // older version is dropped rather than obeyed. Single ids from an older
  // version become one-element lists.
  delete p.enabled;
  // A fixed range used to be a start plus a duration typed by hand; convert it
  // once so an upgrade does not lose the saved query.
  if (value?.startDate && p.startAt == null) {
    const [year, month, date] = String(value.startDate).split('-').map(Number);
    const [hour, minute] = String(value.startTime || '00:00').split(':').map(Number);
    const start = new Date(year, (month || 1) - 1, date || 1, hour || 0, minute || 0);
    if (Number.isFinite(start.getTime())) {
      p.startAt = start.getTime();
      p.endAt = start.getTime() + (Number(value.hours) || 3) * 3600000;
    }
  }
  delete p.startDate;
  delete p.startTime;
  if (p.timeMode !== 'fixed') { p.startAt = null; p.endAt = null; }
  if (!HISTORY_PRESET_HOURS.includes(p.hours)) p.hours = HISTORY_DEFAULTS.hours;
  // Checked after the conversion above, so an upgraded query is judged on the
  // range it became.
  if (p.timeMode === 'fixed') parseHistoryRange(p.startAt, p.endAt);
  if (value && p.masters === HISTORY_DEFAULTS.masters && value.master !== undefined)
    p.masters = idList(value.master);
  if (value && p.slaves === HISTORY_DEFAULTS.slaves && value.slave !== undefined)
    p.slaves = idList(value.slave);
  delete p.master;
  delete p.slave;
  p.masters = [...new Set(idList(p.masters))].sort((a, b) => a - b);
  p.slaves = [...new Set(idList(p.slaves))].sort((a, b) => a - b);
  if (!['phone', 'client'].every(key => typeof p[key] === 'boolean') ||
      !['ble', 'cloud'].includes(p.source) || !Number.isFinite(p.hours) || p.hours <= 0 || p.hours > 240 ||
      !p.masters.length || !p.slaves.length)
    throw new Error('請輸入有效設定：時數 0～240（不含 0），並至少選一隻狗與一台 Master');
  return p;
}
const rows = result => result.results || result.rows?._array || [];
export function createHistoryDatabase(db) {
  return {
    async load() {
      await db.executeAsync('CREATE TABLE IF NOT EXISTS map_history_settings (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL)');
      await db.executeAsync('CREATE INDEX IF NOT EXISTS idx_history_client ON dog_status(master_id, slave_id, received_at, id)');
      const saved = rows(await db.executeAsync('SELECT value FROM map_history_settings WHERE id=1'))[0];
      return validateHistory(saved ? JSON.parse(saved.value) : {});
    },
    async save(value) {
      const settings = validateHistory(value);
      await db.executeAsync('INSERT OR REPLACE INTO map_history_settings(id,value) VALUES(1,?)', [JSON.stringify(settings)]);
      return settings;
    },
    /**
     * Which local days actually hold rows for the chosen devices, so the card
     * can offer them instead of making the user query a day to find out it is
     * empty. Platform date pickers cannot mark days themselves.
     */
    async listDays(value, owner) {
      const p = validateHistory(value);
      if (p.source === 'cloud' && !owner) return [];
      const table = p.source === 'ble' ? 'dog_status' : 'supabase_dog_status';
      const time = p.source === 'ble' ? 'received_at' : 'CAST(COALESCE(track_at, received_at) AS INTEGER)';
      const masters = p.masters.map(() => '?').join(',');
      const slaves = p.slaves.map(() => '?').join(',');
      const params = p.source === 'cloud'
        ? [...p.masters, ...p.slaves, owner] : [...p.masters, ...p.slaves];
      const found = rows(await db.executeAsync(
        `SELECT MIN(${time}) AS from_at, MAX(${time}) AS to_at, COUNT(*) AS rows
         FROM ${table}
         WHERE master_id IN (${masters}) AND slave_id IN (${slaves})
         ${p.source === 'cloud' ? 'AND owner_user_id=?' : ''}
         GROUP BY strftime('%Y-%m-%d', ${time} / 1000, 'unixepoch', 'localtime')
         ORDER BY from_at DESC LIMIT 60`, params));
      return found
        .filter(row => Number.isFinite(row.from_at))
        .map(row => ({
          day: startOfDay(row.from_at),
          rows: Number(row.rows || 0),
          from: Number(row.from_at),
          to: Number(row.to_at),
        }));
    },
    /** Whether this phone has ever recorded its own position (GPS Timeline). */
    async hasPhoneTrack() {
      const exists = rows(await db.executeAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='myLocationTracker'"));
      if (!exists.length) return false;
      const found = rows(await db.executeAsync(
        'SELECT id FROM myLocationTracker LIMIT 1'));
      return found.length > 0;
    },
    /**
     * Which Master/Slave pairs this phone actually holds for a source. The card
     * offers these instead of asking the user to type device numbers: both ids
     * can take several values, and a typed number that exists nowhere looks
     * exactly like "no data".
     */
    async listDevices(source, owner) {
      const cloud = source === 'cloud';
      if (cloud && !owner) return [];
      const table = cloud ? 'supabase_dog_status' : 'dog_status';
      const found = rows(await db.executeAsync(
        `SELECT DISTINCT master_id, slave_id FROM ${table}
         ${cloud ? 'WHERE owner_user_id=?' : ''}
         ORDER BY slave_id, master_id LIMIT 60`, cloud ? [owner] : []));
      return found
        .map(row => ({ master: Number(row.master_id), slave: Number(row.slave_id) }))
        // A row without a slave id (Number(null) is 0) is a Master-only packet,
        // not a dog. It sorted first, so the card offered "狗 0" and fell back
        // to it when a source switch dropped the previous pick — which then
        // queried a dog that does not exist and looked like "no data".
        .filter(pair => pair.master > 0 && pair.slave > 0);
    },
    async read(value, owner, now = Date.now(), alive = () => true, raw = false, bounds = null) {
      const queuedAt = Date.now();
      return withCloudDisplayLock(db, async () => {
        const startedAt = Date.now();
        if (startedAt - queuedAt >= 250) console.info(`[History timing] lockWaitMs=${startedAt - queuedAt}`);
        if (!alive()) return null;
        const p = validateHistory(value);
        if (p.client && p.source === 'ble') await ensureBleDisplayColumns(db);
        const { since, until } = bounds || historyWindow(p, now);
        async function scan(table, time, extra, params, lat, lon) {
          const scanStarted = Date.now();
          let cursor = since, id = 0, all = [];
          const columns = table === 'myLocationTracker'
            ? new Set(rows(await db.executeAsync('PRAGMA table_info(myLocationTracker)')).map(column => column.name)) : new Set();
          const displayColumns = columns.has('display_latitude') && columns.has('display_longitude');
          const selectedLat = displayColumns ? `COALESCE(display_latitude, ${lat})` : lat;
          const selectedLon = displayColumns ? `COALESCE(display_longitude, ${lon})` : lon;
          const provenance = ['session_id', ...(raw ? ['raw_latitude', 'raw_longitude', 'raw_speed_kmh', 'speed_accuracy_mps', 'motion_state', 'display_source', 'display_location_at'] : [])]
            .filter(column => columns.has(column)).map(column => ', ' + column).join('');
          while (alive()) {
            // `raw` requests all records for export, not unsmoothed coordinates.
            const cloudDisplay = table === 'supabase_dog_status';
            const bleDisplay = table === 'dog_status';
            const extras = table !== 'myLocationTracker' ? ', master_id, slave_id' + (cloudDisplay || bleDisplay
              ? ', display_latitude, display_longitude, display_version' : '') : raw ? ', location_at, accuracy_meters, altitude_meters, heading_degrees' : '';
            const queryStarted = Date.now();
            const recovery = displayColumns ? `, ${lat} AS pipeline_latitude, ${lon} AS pipeline_longitude${raw ? '' : ', accuracy_meters, location_at'}` : '';
            const page = rows(await db.executeAsync(`SELECT id, ${time} AS time, ${selectedLat} AS latitude, ${selectedLon} AS longitude, speed_kmh ${extras} ${provenance} ${recovery} FROM ${table}
              WHERE ${time} >= ? AND ${time} < ? ${extra} AND (${time} > ? OR (${time} = ? AND id > ?))
              ORDER BY ${time},id LIMIT 1000`, [since, until, ...params, cursor, cursor, id]));
            if (Date.now() - queryStarted >= 250) console.info(`[History timing] table=${table} pageMs=${Date.now() - queryStarted} rows=${page.length}`);
            if (!page.length) break;
            all.push(...(cloudDisplay || bleDisplay ? await persistCloudDisplayCoordinates(db, page, owner, bleDisplay)
              : page.map(safePhoneHistoryCoordinate)));
            const last = page[page.length - 1]; cursor = last.time; id = last.id;
            if (page.length < 1000) break;
          }
          console.info(`[History timing] table=${table} scanMs=${Date.now() - scanStarted} rows=${all.length}`);
          return all;
        }
        // Every selected dog gets an entry, with or without rows: the card lists
        // what was asked for, and "0 筆" is an answer.
        let phone = [], coverage = null;
        const clients = p.slaves.map(slaveId => ({ slaveId, rows: [] }));
        if (p.phone) {
          const exists = rows(await db.executeAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='myLocationTracker'"));
          if (exists.length) phone = await scan('myLocationTracker', 'recorded_at', '', [], 'latitude', 'longitude');
        }
        if (p.client && (p.source === 'ble' || owner)) {
          const table = p.source === 'ble' ? 'dog_status' : 'supabase_dog_status';
          const time = p.source === 'ble' ? 'received_at' : 'CAST(COALESCE(track_at, received_at) AS INTEGER)';
          const masters = p.masters.map(() => '?').join(',');
          const extra = `AND master_id IN (${masters}) AND slave_id=?`
            + (p.source === 'cloud' ? ' AND owner_user_id=?' : '');
          // One query per dog: each keeps its own line and marker on the map, so
          // a track can never mix two dogs.
          for (const entry of clients) {
            const params = p.source === 'cloud'
              ? [...p.masters, entry.slaveId, owner] : [...p.masters, entry.slaveId];
            entry.rows = await scan(table, time, extra, params, 'slave_lat', 'slave_lon');
          }
          const client = clients.flatMap(entry => entry.rows);
          // This screen only reads what the phone already stores: the cloud copy
          // holds what was downloaded, and both tables are trimmed by retention.
          // Without the oldest stored row the map cannot tell "nothing happened"
          // from "never downloaded", and neither could the person reading it.
          const slaves = p.slaves.map(() => '?').join(',');
          const coverageParams = p.source === 'cloud'
            ? [...p.masters, ...p.slaves, owner] : [...p.masters, ...p.slaves];
          const stored = rows(await db.executeAsync(`SELECT MIN(${time}) AS from_at, COUNT(*) AS rows
            FROM ${table} WHERE master_id IN (${masters}) AND slave_id IN (${slaves})
            ${p.source === 'cloud' ? 'AND owner_user_id=?' : ''}`, coverageParams))[0];
          coverage = { source: p.source, rows: Number(stored?.rows || 0),
            from: Number.isFinite(stored?.from_at) ? stored.from_at : null };
          if (raw) return { phone, client, clients, since, until, coverage, message: '' };
        }
        if (!alive()) return null;
        const result = {
          phone: raw ? phone : historyGeometry(phone),
          clients: clients.map(entry => ({
            slaveId: entry.slaveId,
            ...(raw ? { rows: entry.rows } : historyGeometry(entry.rows)),
          })),
          since, until, coverage,
          message: p.client && p.source === 'cloud' && !owner ? '請先登入雲端帳號，才能查看該帳號下載的定位。' : '' };
        const output = raw ? result : budgetHistory(result);
        console.info(`[History timing] totalMs=${Date.now() - startedAt} raw=${raw}`);
        return output;
      });
    },
  };
}

export function historyGeometry(points) {
  let segments = [], segment = [], last = null;
  for (const stream of groupHistoryStreams(points)) {
    segment = []; last = null;
    for (const point of stream) {
      // Preserve actual signal gaps within each receiver/session stream.
      const valid = !!coordinate(point.latitude, point.longitude);
      if (!valid || (last && (point.time - last.time > 120000 || Math.abs(point.longitude - last.longitude) > 180))) {
        if (segment.length) segments.push(segment);
        segment = [];
      }
      if (valid) { segment.push(point); last = point; }
      else last = null;
    }
    if (segment.length) segments.push(segment);
  }
  segments.sort((a, b) => a[a.length - 1].time - b[b.length - 1].time);
  segments = segments.map(part => simplifyRoute(part, 3));
  const validPoints = points.filter(p => coordinate(p.latitude, p.longitude));
  return budgetHistoryTracks([{ segments, latest: validPoints[validPoints.length - 1] || null,
    count: validPoints.length, limited: false,
    times: validPoints.map(point => point.time), sourcePoints: points }])[0];
}

// Expire cached drawings even when the database has no new rows or a read fails.
export function expireHistory(data, preferences, now) {
  if (!data || preferences.timeMode === 'fixed') return data;
  const since = Math.max(data.since, historyWindow(preferences, now).since);
  const clip = track => {
    // Simplified endpoints cannot be time-clipped: removing the first endpoint
    // can erase a whole valid straight section. Always rebuild from source rows,
    // including invalid fixes/session boundaries, before simplifying and capping.
    const points = track.sourcePoints;
    if (!points.length || points[0].time >= since) return track;
    return historyGeometry(points.filter(point => point.time >= since));
  };
  return budgetHistory({ ...data, since, until: Math.max(data.until, since), phone: clip(data.phone),
    clients: (data.clients || []).map(track => ({ ...clip(track), slaveId: track.slaveId })) });
}

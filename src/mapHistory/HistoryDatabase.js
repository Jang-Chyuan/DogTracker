import { simplifyRoute } from '../tracking/SimplifyRoute';
import { historyWindow, parseHistoryStart } from './HistoryTime';

export const HISTORY_DEFAULTS = { enabled: false, phone: true, client: true, source: 'ble', hours: 3, master: 7, slave: 4, timeMode: 'recent', startDate: '', startTime: '00:00' };
export function validateHistory(value) {
  const p = { ...HISTORY_DEFAULTS, ...value };
  if (!['recent', 'fixed'].includes(p.timeMode)) throw new Error('時間模式無效');
  if (p.timeMode === 'fixed') parseHistoryStart(p.startDate, p.startTime);
  if (!['enabled', 'phone', 'client'].every(key => typeof p[key] === 'boolean') ||
      !['ble', 'cloud'].includes(p.source) || !Number.isFinite(p.hours) || p.hours <= 0 || p.hours > 240 ||
      ![p.master, p.slave].every(id => Number.isInteger(id) && id > 0)) throw new Error('請輸入有效設定：時數 0～240（不含 0），裝置編號為正整數');
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
    async read(value, owner, now = Date.now(), alive = () => true, raw = false, bounds = null) {
      const p = validateHistory(value);
      const { since, until } = bounds || historyWindow(p, now);
      async function scan(table, time, extra, params, lat, lon) {
        let cursor = since, id = 0, all = [];
        while (alive()) {
          const extras = raw && table === 'myLocationTracker' ? ', location_at, accuracy_meters, altitude_meters, heading_degrees' : '';
          const page = rows(await db.executeAsync(`SELECT id, ${time} AS time, ${lat} AS latitude, ${lon} AS longitude, speed_kmh ${extras} FROM ${table}
            WHERE ${time} >= ? AND ${time} < ? ${extra} AND (${time} > ? OR (${time} = ? AND id > ?))
            ORDER BY ${time},id LIMIT 1000`, [since, until, ...params, cursor, cursor, id]));
          if (!page.length) break;
          all.push(...page);
          const last = page[page.length - 1]; cursor = last.time; id = last.id;
          if (page.length < 1000) break;
        }
        return all;
      }
      let phone = [], client = [];
      if (p.phone) {
        const exists = rows(await db.executeAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='myLocationTracker'"));
        if (exists.length) phone = await scan('myLocationTracker', 'recorded_at', '', [], 'latitude', 'longitude');
      }
      if (p.client && (p.source === 'ble' || owner)) {
        client = await scan(p.source === 'ble' ? 'dog_status' : 'supabase_dog_status', 'received_at',
          'AND master_id=? AND slave_id=?' + (p.source === 'cloud' ? ' AND owner_user_id=?' : ''),
          p.source === 'cloud' ? [p.master, p.slave, owner] : [p.master, p.slave], 'slave_lat', 'slave_lon');
      }
      return { phone: raw ? phone : historyGeometry(phone), client: raw ? client : historyGeometry(client), since, until,
        message: p.client && p.source === 'cloud' && !owner ? '請先登入雲端帳號，才能查看該帳號下載的定位。' : '' };
    },
  };
}

export function historyGeometry(points) {
  let segments = [], segment = [], last = null;
  for (const point of points) {
    const valid = Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
    if (!valid || (last && (point.time - last.time > 120000 || Math.abs(point.longitude - last.longitude) > 180))) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    if (valid) { segment.push(point); last = point; }
    else last = null;
  }
  if (segment.length) segments.push(segment);
  segments = segments.map(part => simplifyRoute(part, 3));
  // Keep recent segments within a native drawing budget; never join across gaps.
  let budget = 4000;
  const limited = segments.reduce((n, part) => n + part.length, 0) > budget;
  const kept = [];
  for (let i = segments.length - 1; i >= 0 && budget > 0; i -= 1) {
    const part = segments[i].slice(-budget); kept.unshift(part); budget -= part.length;
  }
  const validPoints = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180);
  return { segments: kept, latest: validPoints[validPoints.length - 1] || null, count: validPoints.length, limited };
}

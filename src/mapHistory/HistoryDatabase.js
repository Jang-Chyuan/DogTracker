import { t } from '../i18n';
import { normalizeAvatar } from '../dogs/DogArt';
import { HOLD_CONFIG } from '../placement/IndoorHold';
import { parseHistoryRange } from './HistoryTime';
import { normalizeDogAliases } from './DogAliases';
import { dogHistoryRow, phoneHistoryRow } from '../history/HistoryRows';

// The history list reads this much before the day too: a visit or a drive
// running over midnight, a break before the first fix (判定表「跨午夜」).
export const HISTORY_DAY_CONTEXT_MS = 30 * 60000;
export const HISTORY_DAY_AFTER_MS = 3 * 60000;
const DAY_PAGE = 2000;

// The single list the app composition binds; a method added here without the
// binding would only be missing on a phone, never in a repository test.
export const HISTORY_DATABASE_METHODS = ['load', 'save', 'loadDogAvatars', 'saveDogAvatar',
  'listDevices', 'phoneRouteSince', 'historyDayRows', 'historyDays'];
const AVATAR_TABLE = 'CREATE TABLE IF NOT EXISTS dog_avatars (slave_id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)';
// Several dogs can be out with several Masters, so both are lists.
export const HISTORY_PRESET_HOURS = Object.freeze([1, 3, 6, 12, 24]);
export const HISTORY_DEFAULTS = { phone: true, client: true, source: 'ble', hours: 3,
  masters: [7], slaves: [4], timeMode: 'recent', startAt: null, endAt: null };
const idList = value => (Array.isArray(value) ? value : [value])
  .map(Number).filter(id => Number.isInteger(id) && id > 0);
export function validateHistory(value) {
  const p = { ...HISTORY_DEFAULTS, ...value };
  if (p.dogAliases !== undefined) p.dogAliases = normalizeDogAliases(p.dogAliases);
  if (!['recent', 'fixed'].includes(p.timeMode)) throw new Error(t("c815"));
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
    throw new Error(t("c816"));
  return p;
}
const rows = result => result.results || result.rows?._array || [];
export function createHistoryDatabase(db) {
  // myLocationTracker's speed columns, read once per open database.
  let phoneSpeedColumns = null;
  return {
    async load() {
      await db.executeAsync('CREATE TABLE IF NOT EXISTS map_history_settings (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL)');
      await db.executeAsync('CREATE INDEX IF NOT EXISTS idx_history_client ON dog_status(master_id, slave_id, received_at, id)');
      const saved = rows(await db.executeAsync('SELECT value FROM map_history_settings WHERE id=1'))[0];
      return validateHistory(saved ? JSON.parse(saved.value) : {});
    },
    /**
     * Each dog's face, by collar number, on this phone only (like its name).
     * Separate from the history settings so a photo is not rewritten with
     * every change of the history query. A dog without a row has the default
     * illustration.
     */
    async loadDogAvatars() {
      await db.executeAsync(AVATAR_TABLE);
      return Object.fromEntries(rows(await db.executeAsync('SELECT slave_id, value FROM dog_avatars'))
        // One damaged row must not hide every other dog's face.
        .map(row => { try { return [row.slave_id, normalizeAvatar(JSON.parse(row.value))]; } catch { return [row.slave_id, null]; } })
        .filter(([, avatar]) => avatar));
    },
    // null removes the dog's own face, back to the default illustration.
    async saveDogAvatar(slaveId, avatar) {
      if (!Number.isInteger(slaveId) || slaveId < 1) throw new Error(t("c812"));
      const value = normalizeAvatar(avatar);
      if (avatar != null && !value) throw new Error(t("c813"));
      await db.executeAsync(AVATAR_TABLE);
      if (value) await db.executeAsync('INSERT OR REPLACE INTO dog_avatars(slave_id,value) VALUES(?,?)', [slaveId, JSON.stringify(value)]);
      else await db.executeAsync('DELETE FROM dog_avatars WHERE slave_id=?', [slaveId]);
      return value;
    },
    async save(value) {
      const settings = validateHistory(value);
      await db.executeAsync('INSERT OR REPLACE INTO map_history_settings(id,value) VALUES(1,?)', [JSON.stringify(settings)]);
      return settings;
    },
    /**
     * This phone's own recorded positions from `since` on, after the cursor
     * { time, id } (oldest first, at most `limit`): what 「今天 x km」 adds up.
     * The pipeline's coordinates, not the display animation's.
     */
    async phoneRouteSince(since, cursor = null, limit = 2000) {
      const exists = rows(await db.executeAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='myLocationTracker'"));
      if (!exists.length) return [];
      const time = Math.max(Number(since) || 0, Number(cursor?.time) || 0);
      const id = Number(cursor?.time) >= Number(since) ? Number(cursor?.id) || 0 : 0;
      // The phone's own measured speed (067: drift it did not walk is not
      // counted), when this install's table has the columns.
      if (!phoneSpeedColumns) {
        const names = new Set(rows(await db.executeAsync('PRAGMA table_info(myLocationTracker)')).map(c => c.name));
        phoneSpeedColumns = ['raw_speed_kmh', 'speed_accuracy_mps'].filter(name => names.has(name));
      }
      const optional = value => (value == null ? null : Number(value));
      return rows(await db.executeAsync(
        `SELECT id, recorded_at AS time, latitude, longitude, accuracy_meters AS accuracy${
          phoneSpeedColumns.map(name => `, ${name}`).join('')} FROM myLocationTracker
         WHERE recorded_at >= ? AND (recorded_at > ? OR (recorded_at = ? AND id > ?))
         ORDER BY recorded_at, id LIMIT ?`, [Number(since) || 0, time, time, id, limit]))
        .map(row => ({ id: Number(row.id), time: Number(row.time), latitude: Number(row.latitude),
          longitude: Number(row.longitude), accuracy: optional(row.accuracy),
          raw_speed_kmh: optional(row.raw_speed_kmh), speed_accuracy_mps: optional(row.speed_accuracy_mps) }));
    },
    /**
     * One dog's (or this phone's) rows of one day for the history list
     * (src/history): [start - HISTORY_DAY_CONTEXT_MS, end + HISTORY_DAY_AFTER_MS). `subject` is
     * 'dog' (by collar number, every receiver) or 'phone'; `source` picks the
     * tables — the history screen always reads 'all' (local and cloud merged);
     * 'local' (dog_status) and 'cloud' (the account's supabase_dog_status;
     * nothing signed out) remain for callers that need one side. `after` holds the
     * last id read per table: only rows added since come back (whatever their
     * time, so a download of older rows is seen), and polling re-reads a few
     * rows, not the day. The dog's hold model also gets
     * the last good fixes before the window (`seed`), like the history map.
     * @returns {{ rows, seed, after }}
     */
    async historyDayRows({ subject = 'dog', slaveId = null, start, end, owner = null, after = {} }) {
      const since = Number(start) - HISTORY_DAY_CONTEXT_MS;
      // A few minutes past midnight tell whether the last stay or hold goes on
      // the next day (「接續隔天」); they are not part of this day.
      const until = Number(end) + HISTORY_DAY_AFTER_MS;
      const cursors = { ...after };
      // By id, not time: a cloud download can add rows older than the newest
      // one read (判定表「補下載完成」), and those must be read too.
      async function pages(key, sql, params) {
        const found = [];
        let cursor = cursors[key] ?? { id: -1 };
        for (;;) {
          const page = rows(await db.executeAsync(`${sql} AND id > ? ORDER BY id LIMIT ${DAY_PAGE}`,
            [...params, cursor.id]));
          if (!page.length) break;
          found.push(...page);
          cursor = { id: Number(page[page.length - 1].id) };
          if (page.length < DAY_PAGE) break;
        }
        cursors[key] = cursor;
        return found;
      }
      const table = async name => rows(await db.executeAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).length > 0;
      if (subject === 'phone') {
        if (!(await table('myLocationTracker'))) return { rows: [], seed: [], after: cursors };
        // The CSV export's columns ride along (判定表「CSV」: 照 main 的欄位).
        const phoneColumns = new Set(rows(await db.executeAsync('PRAGMA table_info(myLocationTracker)')).map(c => c.name));
        const phoneExtra = ['location_at', 'accuracy_meters', 'altitude_meters', 'speed_kmh', 'heading_degrees',
          'raw_latitude', 'raw_longitude', 'session_id', 'raw_speed_kmh', 'speed_accuracy_mps', 'motion_state',
          'display_source', 'display_location_at'].filter(name => phoneColumns.has(name)).map(name => `, ${name}`).join('');
        const found = await pages('phone', `SELECT id, recorded_at AS time, latitude, longitude,
          accuracy_meters AS accuracy${phoneExtra} FROM myLocationTracker WHERE recorded_at >= ? AND recorded_at < ?`,
        [since, until]);
        return { rows: found.map(phoneHistoryRow), seed: [], after: cursors };
      }
      const out = [], seed = [];
      const columnsOf = async name => new Set(rows(await db.executeAsync(`PRAGMA table_info(${name})`)).map(column => column.name));
      const optional = (columns, names) => names.filter(name => columns.has(name)).map(name => `, ${name}`).join('');
      const first = !Object.keys(after).length;
      for (const [key, name, time, wanted] of [
        ['local', 'dog_status', 'received_at', true],
        ['cloud', 'supabase_dog_status', 'CAST(COALESCE(track_at, received_at) AS INTEGER)', !!owner],
      ]) {
        if (!wanted || !(await table(name))) continue;
        const columns = await columnsOf(name);
        const extra = optional(columns, ['satellites', 'hdop', 'usb_present', 'rssi', 'snr', 'gps_time', 'track_at', 'speed_kmh', 'distance_meters']);
        const scope = `slave_id = ?${key === 'cloud' ? ' AND owner_user_id = ?' : ''}`;
        const params = key === 'cloud' ? [slaveId, owner] : [slaveId];
        const found = await pages(key, `SELECT id, received_at, master_id, slave_id, slave_lat, slave_lon${extra}
          FROM ${name} WHERE ${scope} AND ${time} >= ? AND ${time} < ?`, [...params, since, until]);
        out.push(...found.map(row => dogHistoryRow(row, key)));
        if (first && columns.has('satellites')) {
          seed.push(...rows(await db.executeAsync(`SELECT ${time} AS time, slave_lat AS latitude, slave_lon AS longitude,
            master_id, satellites${columns.has('hdop') ? ', hdop' : ''} FROM ${name}
            WHERE ${scope} AND ${time} < ? AND satellites >= ?
              AND slave_lat IS NOT NULL AND slave_lon IS NOT NULL AND NOT (slave_lat = 0 AND slave_lon = 0)
            ORDER BY ${time} DESC LIMIT 40`, [...params, since, HOLD_CONFIG.goodMinSatellites])));
        }
      }
      seed.sort((a, b) => a.time - b.time);
      return { rows: out, seed: seed.slice(-40), after: cursors };
    },
    /**
     * The local days (「YYYY-MM-DD」 in the phone's time zone) this phone holds
     * rows of for one dog (any receiver; `source` as historyDayRows) or for
     * my route, oldest first: the history's date row ‹ › steps between them
     * (H3a). Days only the cloud holds come with the calendar (054b).
     */
    async historyDays({ subject = 'dog', slaveId = null, owner = null } = {}) {
      const table = async name => rows(await db.executeAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).length > 0;
      const dayOf = time => `strftime('%Y-%m-%d', ${time} / 1000, 'unixepoch', 'localtime')`;
      const found = new Set();
      const add = list => list.forEach(row => { if (row.day) found.add(String(row.day)); });
      if (subject === 'phone') {
        if (await table('myLocationTracker')) {
          add(rows(await db.executeAsync(`SELECT DISTINCT ${dayOf('recorded_at')} AS day FROM myLocationTracker`)));
        }
      } else {
        if (await table('dog_status')) {
          add(rows(await db.executeAsync(`SELECT DISTINCT ${dayOf('received_at')} AS day FROM dog_status
            WHERE slave_id = ?`, [slaveId])));
        }
        if (owner && await table('supabase_dog_status')) {
          add(rows(await db.executeAsync(`SELECT DISTINCT ${dayOf('CAST(COALESCE(track_at, received_at) AS INTEGER)')} AS day
            FROM supabase_dog_status WHERE slave_id = ? AND owner_user_id = ?`, [slaveId, owner])));
        }
      }
      return [...found].sort();
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
  };
}


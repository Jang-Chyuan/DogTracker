import { t } from '../i18n';
import { normalizeAvatar } from '../dogs/DogArt';
import { HOLD_CONFIG } from '../placement/IndoorHold';
import { parseHistoryRange } from './HistoryTime';
import { normalizeDogAliases } from './DogAliases';
import { dogHistoryRow, phoneHistoryRow } from '../history/HistoryRows';
import { readLocalRetention } from '../database/LocalRetention';

// The history list reads this much before the day too: a visit or a drive
// running over midnight, a break before the first fix (判定表「跨午夜」).
export const HISTORY_DAY_CONTEXT_MS = 30 * 60000;
export const HISTORY_DAY_AFTER_MS = 3 * 60000;
const DAY_PAGE = 2000;

// The single list the app composition binds; a method added here without the
// binding would only be missing on a phone, never in a repository test.
export const HISTORY_DATABASE_METHODS = ['load', 'save', 'loadDogAvatars', 'saveDogAvatar',
  'listDevices', 'phoneRouteSince', 'historyDayRows', 'historyDays', 'historyDogs', 'localRetention'];
// historyDogs lists at most this many dogs (each one is one indexed seek).
export const HISTORY_DOGS_LIMIT = 200;
const AVATAR_TABLE = 'CREATE TABLE IF NOT EXISTS dog_avatars (slave_id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)';
// Each dog's name by collar number, on this phone only. The names used to sit
// inside the history query's JSON row (map_history_settings), so one field
// of the query failing validateHistory hid every name, and the next rename
// wrote the defaults plus that one name back, deleting the others.
const NAME_TABLE = 'CREATE TABLE IF NOT EXISTS dog_names (slave_id INTEGER PRIMARY KEY NOT NULL, value TEXT NOT NULL)';
const SETTINGS_TABLE = 'CREATE TABLE IF NOT EXISTS map_history_settings (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL)';
// One move of the old names per connection, even when two opens race.
const namesMoved = new WeakMap();
const parseJson = text => { try { return JSON.parse(text); } catch { return null; } };
// A save's names: a name is written, an empty one removes that dog's name
// (back to 狗 N). A dog left out of the map keeps the name it has, so a save
// made from preferences that never loaded cannot delete the other names.
function nameChanges(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter(([id]) => /^[1-9]\d*$/.test(id)).flatMap(([id, alias]) => {
    if (alias != null && typeof alias !== 'string') return [];
    const name = normalizeDogAliases({ [id]: alias || '' })[id];
    return name
      ? [{ query: 'INSERT OR REPLACE INTO dog_names(slave_id,value) VALUES(?,?)', params: [Number(id), name] }]
      : [{ query: 'DELETE FROM dog_names WHERE slave_id=?', params: [Number(id)] }];
  });
}
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
// myLocationTracker's optional columns the history logic reads: the raw fix
// PhoneMotion runs on (latitude/longitude are the pipeline's, held on the
// anchor while the phone stands still), the phone's own measured speed (067),
// the detector's state, the recording session and its odometer (2026-10-13).
// 「今天 x km」 (phoneRouteSince) and the history list (historyDayRows) read
// this one list, so both run the same detector on the same fixes and the pill
// says the summary's number (2026-10-15: without the raw fix the pill was up
// to 100 m off the summary on real days).
export const PHONE_MODEL_COLUMNS = Object.freeze(['raw_latitude', 'raw_longitude', 'speed_kmh', 'raw_speed_kmh',
  'speed_accuracy_mps', 'motion_state', 'session_id', 'odometer_m']);
const PHONE_TEXT_COLUMNS = new Set(['motion_state', 'session_id']);
// The CSV export's other columns (判定表「CSV」: 照 main 的欄位), my route only.
const PHONE_EXPORT_COLUMNS = ['location_at', 'accuracy_meters', 'altitude_meters', 'heading_degrees',
  'display_source', 'display_location_at'];
export function createHistoryDatabase(db) {
  // My route's reads go on the connection's own read lane when it has one
  // (TrackingDatabaseConnection.reader, Android): SELECTs only, never queued
  // behind the cloud sync's work on the App's database queue. Coming back
  // to the App and opening 我的路線 waited there 10 s on the phone.
  const route = db.reader || db;
  const routeColumns = async () => new Set(rows(await route.executeAsync(
    "SELECT name FROM pragma_table_info('myLocationTracker')")).map(column => column.name));
  // myLocationTracker's speed columns, read once per open database.
  let phoneSpeedColumns = null;
  // The names' own table. The first open after the upgrade creates it
  // together with the names the history row held, in one transaction, so a
  // crash in between leaves the old row to move again next time.
  function ensureNames() {
    if (!namesMoved.has(db)) {
      namesMoved.set(db, (async () => {
        await db.executeAsync(SETTINGS_TABLE);
        if (rows(await db.executeAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='dog_names'")).length) return;
        const saved = rows(await db.executeAsync('SELECT value FROM map_history_settings WHERE id=1'))[0];
        const old = normalizeDogAliases(saved ? parseJson(saved.value)?.dogAliases : null);
        await db.executeBatchAsync([{ query: NAME_TABLE, params: [] }, ...nameChanges(old)]);
      })().catch(error => { namesMoved.delete(db); throw error; }));
    }
    return namesMoved.get(db);
  }
  async function loadNames() {
    await ensureNames();
    return normalizeDogAliases(Object.fromEntries(
      rows(await db.executeAsync('SELECT slave_id, value FROM dog_names')).map(row => [String(row.slave_id), row.value])));
  }
  return {
    // The history query plus every dog's name (`dogAliases`, from dog_names).
    async load() {
      await db.executeAsync(SETTINGS_TABLE);
      await db.executeAsync('CREATE INDEX IF NOT EXISTS idx_history_client ON dog_status(master_id, slave_id, received_at, id)');
      const dogAliases = await loadNames();
      const saved = rows(await db.executeAsync('SELECT value FROM map_history_settings WHERE id=1'))[0];
      // The names the row held before dog_names existed are not read again.
      const query = { ...((saved && parseJson(saved.value)) || {}) };
      delete query.dogAliases;
      // A stored query that no longer validates (a damaged row, a field from
      // another version) falls back to the defaults; the v3 screen takes its
      // target from the route, and the names do not depend on it.
      let settings;
      try { settings = validateHistory(query); } catch { settings = validateHistory({}); }
      return { ...settings, dogAliases };
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
    // `dogAliases`, when given, writes the names it carries (an empty one
    // removes that name); the dogs it leaves out keep theirs.
    async save(value) {
      const { dogAliases, ...query } = value || {};
      const settings = validateHistory(query);
      await ensureNames();
      await db.executeBatchAsync([
        { query: 'INSERT OR REPLACE INTO map_history_settings(id,value) VALUES(1,?)', params: [JSON.stringify(settings)] },
        ...nameChanges(dogAliases)]);
      return { ...settings, dogAliases: await loadNames() };
    },
    /**
     * This phone's own recorded positions from `since` on, after the cursor
     * { time, id } (oldest first, at most `limit`): what 「今天 x km」 adds up.
     * The pipeline's coordinates (not the display animation's) with the
     * model's columns (PHONE_MODEL_COLUMNS), as historyDayRows reads them.
     */
    async phoneRouteSince(since, cursor = null, limit = 2000) {
      const exists = rows(await route.executeAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='myLocationTracker'"));
      if (!exists.length) return [];
      const time = Math.max(Number(since) || 0, Number(cursor?.time) || 0);
      const id = Number(cursor?.time) >= Number(since) ? Number(cursor?.id) || 0 : 0;
      // Kept once every column is there: the recorder adds a missing one when
      // it opens the table (an app update), possibly after the first read.
      let columns = phoneSpeedColumns;
      if (!columns) {
        const names = await routeColumns();
        columns = PHONE_MODEL_COLUMNS.filter(name => names.has(name));
        if (columns.length === PHONE_MODEL_COLUMNS.length) phoneSpeedColumns = columns;
      }
      // Each column the table has is a key of every row (null when the row
      // has none), as on historyDayRows' rows: the logic tells a recorder
      // that measured nothing (null) from an old one without the column.
      const value = (name, raw) => (raw == null ? null : PHONE_TEXT_COLUMNS.has(name) ? String(raw) : Number(raw));
      return rows(await route.executeAsync(
        `SELECT id, recorded_at AS time, latitude, longitude, accuracy_meters AS accuracy${
          columns.map(name => `, ${name}`).join('')} FROM myLocationTracker
         WHERE recorded_at >= ? AND (recorded_at > ? OR (recorded_at = ? AND id > ?))
         ORDER BY recorded_at, id LIMIT ?`, [Number(since) || 0, time, time, id, limit]))
        .map(row => ({ id: Number(row.id), time: Number(row.time), latitude: Number(row.latitude),
          longitude: Number(row.longitude), accuracy: row.accuracy == null ? null : Number(row.accuracy),
          ...Object.fromEntries(columns.map(name => [name, value(name, row[name])])) }));
    },
    /**
     * One dog's (or this phone's) rows of one day for the history list
     * (src/history): [start - HISTORY_DAY_CONTEXT_MS, end + HISTORY_DAY_AFTER_MS) — for my route
     * also the last row before that window and the first row after it, however far
     * (the list's 「沒有資料」 between them and midnight). `subject` is
     * 'dog' (by collar number, every receiver) or 'phone'; `source` picks the
     * tables — the history screen always reads 'all' (local and cloud merged);
     * 'local' (dog_status) and 'cloud' (the account's supabase_dog_status;
     * nothing signed out) remain for callers that need one side. `after` holds the
     * last id read per table: only rows added since come back (whatever their
     * time, so a download of older rows is seen), and polling re-reads a few
     * rows, not the day. The dog's hold model also gets
     * the last good fixes before the window (`seed`), like the history map.
     * `verify` (my route): a reader that kept its rows while the screen was
     * closed or the app was away first checks that the rows it already read
     * are all still there (a cheap count on the time index); when they are
     * not (刪除我的路線, an edit), the day is read again from the start and
     * the answer says `replaced`: its rows stand for the whole day.
     * @returns {{ rows, seed, after, replaced? }}
     */
    async historyDayRows({ subject = 'dog', slaveId = null, start, end, owner = null, after = {}, signal = null, verify = false }) {
      // A read the screen no longer wants (‹ › moved on) stops before its
      // next query instead of reading the rest of the day.
      const stopped = () => {
        if (!signal?.aborted) return;
        const error = new Error('history read superseded');
        error.name = 'AbortError';
        throw error;
      };
      const since = Number(start) - HISTORY_DAY_CONTEXT_MS;
      // A few minutes past midnight tell whether the last stay or hold goes on
      // the next day (`continuesNextDay`); they are not part of this day.
      const until = Number(end) + HISTORY_DAY_AFTER_MS;
      let cursors = { ...after };
      // By id, not time: a cloud download can add rows older than the newest
      // one read (判定表「補下載完成」), and those must be read too.
      // `span` (my route): first the ids the window's rows lie between (and
      // how many there are), from the time index, then the pages by id
      // within them. Alone, `id > ?` walks the table from the cursor (a year
      // of my route is millions of rows: a day took 0.25 s on a Mac, seconds
      // on a phone). A window whose ids are far apart (a row written while
      // the clock was set a day or a year wrong) is read on the time index
      // and sorted instead: a walk between its ids would cross the table.
      async function pages(key, sql, params, span = null, conn = db) {
        const found = [];
        let cursor = cursors[key] ?? { id: -1 };
        let from = cursor.id, through = null, sparse = false;
        if (span) {
          stopped();
          const ends = rows(await conn.executeAsync(span, [...params, cursor.id]))[0];
          if (ends?.low == null) { cursors[key] = cursor; return found; }
          from = Math.max(cursor.id, Number(ends.low) - 1);
          through = Number(ends.high);
          sparse = through - from > 2 * Number(ends.n) + DAY_PAGE;
        }
        for (;;) {
          stopped();
          const page = rows(await conn.executeAsync(sparse
            ? `${sql} AND +id > CAST(? AS INTEGER) ORDER BY id LIMIT ${DAY_PAGE}`
            : `${sql} AND id > ?${through == null ? '' : ' AND id <= ?'} ORDER BY id LIMIT ${DAY_PAGE}`,
          [...params, from, ...(through == null || sparse ? [] : [through])]));
          if (!page.length) break;
          found.push(...page);
          cursor = { id: Number(page[page.length - 1].id) };
          from = cursor.id;
          if (page.length < DAY_PAGE) break;
        }
        cursors[key] = cursor;
        return found;
      }
      if (subject === 'phone') {
        if (!rows(await route.executeAsync("SELECT name FROM sqlite_master WHERE type='table' AND name='myLocationTracker'")).length) return { rows: [], seed: [], after: cursors };
        // The model's columns (the same as 「今天 x km」's) and the CSV
        // export's (判定表「CSV」: 照 main 的欄位).
        const phoneColumns = await routeColumns();
        const phoneExtra = [...PHONE_EXPORT_COLUMNS, ...PHONE_MODEL_COLUMNS]
          .filter(name => phoneColumns.has(name)).map(name => `, ${name}`).join('');
        const select = `SELECT id, recorded_at AS time, latitude, longitude,
          accuracy_meters AS accuracy${phoneExtra} FROM myLocationTracker`;
        let replaced = false;
        if (verify && cursors.phone) {
          stopped();
          const held = rows(await route.executeAsync(`SELECT COUNT(*) AS n FROM myLocationTracker
            WHERE recorded_at >= ? AND recorded_at < ? AND id <= ?`, [since, until, cursors.phone.id]))[0];
          if (Number(held?.n) !== (cursors.phoneCount ?? 0)) { cursors = {}; replaced = true; }
        }
        const found = await pages('phone', `${select} WHERE recorded_at >= ? AND recorded_at < ?`, [since, until],
          // `+id`: the time index answers it, never a walk of the rowid from the cursor.
          'SELECT MIN(id) AS low, MAX(id) AS high, COUNT(*) AS n FROM myLocationTracker WHERE recorded_at >= ? AND recorded_at < ? AND +id > CAST(? AS INTEGER)',
          route);
        // The window's rows read so far (by id, up to the cursor): what
        // `verify` compares the table with.
        cursors.phoneCount = (cursors.phoneCount ?? 0) + found.length;
        // 2026-10-13: the fixes on the other side of the day, however far —
        // the last one before the context window (once) and, until one is
        // found, the first one after it — so the list can show the time
        // between them and midnight as 「沒有資料」 (historyTimeline).
        const before = [], next = [];
        stopped();
        if (!cursors.phoneBefore) {
          before.push(...rows(await route.executeAsync(`${select} WHERE recorded_at < ?
            ORDER BY recorded_at DESC, id DESC LIMIT 1`, [since])));
          cursors.phoneBefore = true;
        }
        if (!cursors.phoneAfter) {
          if (found.some(row => Number(row.time) >= Number(end))) cursors.phoneAfter = true;
          else {
            next.push(...rows(await route.executeAsync(`${select} WHERE recorded_at >= ?
              ORDER BY recorded_at, id LIMIT 1`, [until])));
            if (next.length) cursors.phoneAfter = true;
          }
        }
        return { rows: [...before, ...found, ...next].map(phoneHistoryRow), seed: [], after: cursors,
          ...(replaced ? { replaced: true } : {}) };
      }
      const out = [], seed = [];
      const columnsOf = async (name, conn) => new Set(rows(await conn.executeAsync(
        `SELECT name FROM pragma_table_info('${name}')`)).map(column => column.name));
      const optional = (columns, names) => names.filter(name => columns.has(name)).map(name => `, ${name}`).join('');
      const first = !Object.keys(after).length;
      for (const [key, name, time, wanted] of [
        ['local', 'dog_status', 'received_at', true],
        ['cloud', 'supabase_dog_status', 'CAST(COALESCE(track_at, received_at) AS INTEGER)', !!owner],
      ]) {
        // This phone's rows read on the route's read lane too (#215): a
        // dog's day reopened waited behind the cloud sync's queue. The
        // downloaded copy stays on the App's queue with its publication fence.
        const conn = key === 'local' ? route : db;
        if (!wanted || !rows(await conn.executeAsync(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).length) continue;
        const columns = await columnsOf(name, conn);
        const extra = optional(columns, ['satellites', 'hdop', 'usb_present', 'rssi', 'snr', 'gps_time', 'track_at', 'speed_kmh', 'distance_meters']);
        const scope = `slave_id = ?${key === 'cloud' ? ' AND owner_user_id = ?' : ''}`;
        const params = key === 'cloud' ? [slaveId, owner] : [slaveId];
        // This phone's rows: the (slave_id, received_at) index finds the day's
        // ids first (span), as for my route. Paged on `slave_id, id` alone,
        // SQLite walked every row the dog has (30 days: 1.1–1.4 s on an
        // emulator, the same queue the day's proof waited on).
        const found = await pages(key, `SELECT id, received_at, master_id, slave_id, slave_lat, slave_lon${extra}
          FROM ${name} WHERE ${scope} AND ${time} >= ? AND ${time} < ?`, [...params, since, until],
        key === 'local' ? `SELECT MIN(id) AS low, MAX(id) AS high, COUNT(*) AS n FROM dog_status
          WHERE slave_id = ? AND received_at >= ? AND received_at < ? AND +id > CAST(? AS INTEGER)` : null, conn);
        out.push(...found.map(row => dogHistoryRow(row, key)));
        if (first && columns.has('satellites')) {
          stopped();
          seed.push(...rows(await conn.executeAsync(`SELECT ${time} AS time, slave_lat AS latitude, slave_lon AS longitude,
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
      // Not a DISTINCT over every row (my route keeps 30 days, a dog 7: up to
      // hundreds of thousands, each converted to local time, on the
      // connection the day's own read waits for): from each day's first row,
      // the time index jumps straight to the next local day's first one.
      const nextDay = `CAST(strftime('%s', t / 1000, 'unixepoch', 'localtime', 'start of day', '+1 day', 'utc') AS INTEGER) * 1000`;
      const firstOfEachDay = (from, time, where) => `WITH RECURSIVE first(t) AS (
          SELECT MIN(${time}) FROM ${from} WHERE ${where}
          UNION ALL SELECT (SELECT MIN(${time}) FROM ${from}
            WHERE ${where} AND ${time} >= MAX(t + 1, ${nextDay})) FROM first WHERE t IS NOT NULL)
        SELECT ${dayOf('t')} AS day FROM first WHERE t IS NOT NULL`;
      if (subject === 'phone') {
        if (rows(await route.executeAsync(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='myLocationTracker'")).length) {
          add(rows(await route.executeAsync(firstOfEachDay('myLocationTracker', 'recorded_at', '1'))));
        }
      } else {
        if (await table('dog_status')) {
          // dog_status(slave_id, received_at DESC) answers each MIN with one seek.
          add(rows(await db.executeAsync(firstOfEachDay('dog_status', 'received_at', 'slave_id = ?'), [slaveId, slaveId])));
        }
        if (owner && await table('supabase_dog_status')) {
          add(rows(await db.executeAsync(`SELECT DISTINCT ${dayOf('CAST(COALESCE(track_at, received_at) AS INTEGER)')} AS day
            FROM supabase_dog_status WHERE slave_id = ? AND owner_user_id = ?`, [slaveId, owner])));
        }
      }
      return [...found].sort();
    },
    /**
     * Every dog this phone holds rows of (this phone's receiver, and this
     * account's downloaded cloud copy), ascending. The history's 「＋ 加入」
     * offers the ones that have rows on the day shown, beside the dogs on the
     * live map: the map only lists dogs heard in the last 14 days
     * (CloudLatest ROSTER_WINDOW_MS), the history reaches older ones. One
     * index seek per dog (slave_id leads both tables' indexes), not a scan.
     */
    async historyDogs({ owner = null } = {}) {
      const table = async name => rows(await db.executeAsync(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).length > 0;
      const found = new Set();
      const walk = async (query, params) => {
        let after = 0;
        while (found.size < HISTORY_DOGS_LIMIT) {
          const next = rows(await db.executeAsync(query, [after, ...params]))[0];
          const slave = Number(next?.slave_id);
          if (!Number.isInteger(slave) || slave <= after) return;
          found.add(slave);
          after = slave;
        }
      };
      if (await table('dog_status')) {
        await walk('SELECT slave_id FROM dog_status WHERE slave_id > ? ORDER BY slave_id LIMIT 1', []);
      }
      if (owner && await table('supabase_dog_status')) {
        await walk(`SELECT slave_id FROM supabase_dog_status WHERE slave_id > ? AND owner_user_id = ?
          ORDER BY slave_id LIMIT 1`, [owner]);
      }
      return [...found].sort((left, right) => left - right).slice(0, HISTORY_DOGS_LIMIT);
    },
    /**
     * The first day this phone keeps my route and the dogs' packets from
     * (設定的「保留到 M/D」; LocalRetention).
     */
    localRetention(now = Date.now()) {
      return readLocalRetention(db, now);
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
      // One index seek per pair, not a DISTINCT over every row: the cloud
      // copy of an account holds about a million rows, and the DISTINCT read
      // them all (minutes on a signed-in emulator, on the queue every other
      // read of the App waits behind) each time the history opened.
      // dog_status(slave_id, master_id); the cloud copy's index leads with
      // (owner_user_id, master_id, slave_id).
      const scope = cloud ? 'owner_user_id = ? AND ' : '';
      const scopeParams = cloud ? [owner] : [];
      const [outer, inner] = cloud ? ['master_id', 'slave_id'] : ['slave_id', 'master_id'];
      const firstOf = async (where, params, order) => rows(await db.executeAsync(
        `SELECT master_id, slave_id FROM ${table} WHERE ${scope}${where} ORDER BY ${order} LIMIT 1`,
        [...scopeParams, ...params]))[0];
      const found = [];
      let row = await firstOf(`${outer} > ?`, [0], `${outer}, ${inner}`);
      while (row && found.length < 60) {
        found.push(row);
        row = await firstOf(`${outer} = ? AND ${inner} > ?`, [row[outer], row[inner] ?? 0], inner)
          ?? await firstOf(`${outer} > ?`, [row[outer]], `${outer}, ${inner}`);
      }
      found.sort((a, b) => Number(a.slave_id) - Number(b.slave_id) || Number(a.master_id) - Number(b.master_id));
      return found
        .map(pair => ({ master: Number(pair.master_id), slave: Number(pair.slave_id) }))
        // A row without a slave id (Number(null) is 0) is a Master-only packet,
        // not a dog. It sorted first, so the card offered "狗 0" and fell back
        // to it when a source switch dropped the previous pick — which then
        // queried a dog that does not exist and looked like "no data".
        .filter(pair => pair.master > 0 && pair.slave > 0);
    },
  };
}


// Two answers about supabase_dog_status kept up to date by SQLite itself
// (triggers, in the very transaction that inserts or deletes a row), instead
// of reading the whole table for them (2026-10-16, about 940,000 rows of one
// account on a signed-in emulator, on the queue every read of the App waits
// behind):
//
// - cloud_row_count: how many rows the table holds, for the download's cap
//   check (CloudStaging, cloud_stage_quota). `COUNT(*)` took 1.1–1.8 s inside
//   the write transaction of every download page. Exact: +1 per row inserted,
//   −1 per row deleted (no statement on this table uses REPLACE, whose
//   deletes would not fire the trigger). Missing until the first download
//   page after the update counts the table once, in that page's transaction.
// - cloud_wifi_latest: each Master's newest row uploaded through its own
//   Wi-Fi (最後上傳成功（經 Wi-Fi）, wifiUploads). The GROUP BY over the
//   account's rows took 2.6–38 s and ran after every download. Rows that were
//   already stored when the trigger came are added in the background, a few
//   thousand ids at a time (cloud_wifi_backfill); until that finishes the
//   old query answers. A deleted row does not lower the answer: the Master
//   did upload then (「刪除全部狗資料」 clears it with the rows).
export const CLOUD_ROW_TABLES = [
  'CREATE TABLE IF NOT EXISTS cloud_row_count (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS cloud_wifi_latest (owner_user_id TEXT NOT NULL, master_id INTEGER NOT NULL,
    received_at INTEGER NOT NULL, PRIMARY KEY (owner_user_id, master_id))`,
  `CREATE TABLE IF NOT EXISTS cloud_wifi_backfill (id INTEGER PRIMARY KEY CHECK(id=1),
    next_id INTEGER NOT NULL, until_id INTEGER NOT NULL)`,
];

// The newest Wi-Fi time of `row`'s Master, raised (never lowered). Two plain
// statements, not an upsert: a trigger's statements take the outer statement's
// conflict policy, and the publication inserts with OR IGNORE — an INSERT OR
// REPLACE here was silently ignored once the Master had a row (Codex review).
const wifiUpsert = row => {
  const wifi = `${row}.upload_source = 'wifi' AND ${row}.owner_user_id IS NOT NULL AND ${row}.master_id IS NOT NULL
      AND ${row}.received_at IS NOT NULL`;
  const same = `owner_user_id = ${row}.owner_user_id AND master_id = ${row}.master_id`;
  return `UPDATE cloud_wifi_latest SET received_at = ${row}.received_at
      WHERE ${same} AND received_at < ${row}.received_at AND ${wifi};
    INSERT INTO cloud_wifi_latest(owner_user_id, master_id, received_at)
      SELECT ${row}.owner_user_id, ${row}.master_id, ${row}.received_at
      WHERE ${wifi} AND NOT EXISTS (SELECT 1 FROM cloud_wifi_latest WHERE ${same})`;
};

export const CLOUD_ROW_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS cloud_rows_inserted_v2 AFTER INSERT ON supabase_dog_status BEGIN
    UPDATE cloud_row_count SET n = n + 1 WHERE id = 1;
    ${wifiUpsert('NEW')};
  END`,
  `CREATE TRIGGER IF NOT EXISTS cloud_rows_deleted_v2 AFTER DELETE ON supabase_dog_status BEGIN
    UPDATE cloud_row_count SET n = n - 1 WHERE id = 1;
  END`,
  // A Wi-Fi row the backfill has not reached yet keeps its time when deleted
  // (the trim right after the update), as a row deleted after it did.
  `CREATE TRIGGER IF NOT EXISTS cloud_rows_wifi_deleted_v2 AFTER DELETE ON supabase_dog_status
    WHEN OLD.upload_source = 'wifi' AND EXISTS (SELECT 1 FROM cloud_wifi_backfill
      WHERE id = 1 AND OLD.id > next_id AND OLD.id <= until_id) BEGIN
    ${wifiUpsert('OLD')};
  END`,
  `CREATE TRIGGER IF NOT EXISTS cloud_rows_wifi_changed_v2
    AFTER UPDATE OF upload_source, received_at, master_id, owner_user_id ON supabase_dog_status
    WHEN NEW.upload_source = 'wifi' BEGIN
    ${wifiUpsert('NEW')};
  END`,
];
const TRIGGER_NAMES = ['cloud_rows_inserted_v2', 'cloud_rows_deleted_v2', 'cloud_rows_wifi_deleted_v2', 'cloud_rows_wifi_changed_v2'];

/**
 * The tables and triggers (initialize, inside its lock). The backfill's
 * range is every row stored before the triggers came: set in the same
 * transaction, so no row is in neither.
 */
export function cloudRowSetup() {
  return [...CLOUD_ROW_TABLES,
    // Never released; a development build had them with an upsert the
    // publication's OR IGNORE defeated (the _v2 triggers replace them).
    'DROP TRIGGER IF EXISTS cloud_rows_inserted', 'DROP TRIGGER IF EXISTS cloud_rows_deleted',
    'DROP TRIGGER IF EXISTS cloud_rows_wifi_changed',
    // An older version of the App emptied the table (刪除全部狗資料) without
    // knowing these: nothing stored means nothing uploaded to show.
    'DELETE FROM cloud_wifi_latest WHERE NOT EXISTS (SELECT 1 FROM supabase_dog_status)',
    ...CLOUD_ROW_TRIGGERS,
    `INSERT OR IGNORE INTO cloud_wifi_backfill(id, next_id, until_id)
      SELECT 1, 0, COALESCE((SELECT MAX(id) FROM supabase_dog_status), 0)`].map(query => ({ query, params: [] }));
}

/**
 * Around a `DELETE FROM supabase_dog_status` of every row (刪除全部狗資料): the
 * triggers stand aside, so SQLite empties the table at once instead of row by
 * row, and the answers start again from an empty table.
 */
export const cloudRowsBeforeClear = () => TRIGGER_NAMES.map(name => ({ query: `DROP TRIGGER IF EXISTS ${name}`, params: [] }));
export const cloudRowsAfterClear = () => [
  ...CLOUD_ROW_TABLES,
  { query: 'DELETE FROM cloud_wifi_latest' },
  { query: 'INSERT OR REPLACE INTO cloud_row_count(id, n) VALUES (1, 0)' },
  { query: 'INSERT OR REPLACE INTO cloud_wifi_backfill(id, next_id, until_id) VALUES (1, 0, 0)' },
  ...CLOUD_ROW_TRIGGERS,
].map(command => (typeof command === 'string' ? { query: command, params: [] } : { params: [], ...command }));

export const WIFI_BACKFILL_IDS = 20000;
export const WIFI_BACKFILL_PAUSE_MS = 250;

/** One step of the backfill: the next WIFI_BACKFILL_IDS ids. Returns whether more remain. */
export async function backfillWifiStep(connection) {
  const rowsOf = result => result?.results || result?.rows?._array || [];
  const state = rowsOf(await connection.executeAsync('SELECT next_id, until_id FROM cloud_wifi_backfill WHERE id = 1'))[0];
  if (!state || Number(state.next_id) >= Number(state.until_id)) return false;
  const from = Number(state.next_id), to = Math.min(Number(state.until_id), from + WIFI_BACKFILL_IDS);
  await connection.executeBatchAsync([
    { query: `INSERT OR REPLACE INTO cloud_wifi_latest(owner_user_id, master_id, received_at)
        SELECT s.owner_user_id, s.master_id, MAX(MAX(s.received_at), COALESCE((SELECT received_at FROM cloud_wifi_latest w
          WHERE w.owner_user_id = s.owner_user_id AND w.master_id = s.master_id), 0))
        FROM supabase_dog_status s
        WHERE s.id > ? AND s.id <= ? AND s.upload_source = 'wifi' AND s.owner_user_id IS NOT NULL
          AND s.master_id IS NOT NULL AND s.received_at IS NOT NULL
        GROUP BY s.owner_user_id, s.master_id`, params: [from, to] },
    // Only forward, and never past a range a clear has reset meanwhile.
    { query: 'UPDATE cloud_wifi_backfill SET next_id = ? WHERE id = 1 AND next_id = ?', params: [to, from] },
  ]);
  return to < Number(state.until_id);
}

/** Whether cloud_wifi_latest holds every stored row's answer. */
export async function wifiLatestReady(connection) {
  const rowsOf = result => result?.results || result?.rows?._array || [];
  try {
    const state = rowsOf(await connection.executeAsync('SELECT next_id >= until_id AS done FROM cloud_wifi_backfill WHERE id = 1'))[0];
    return Number(state?.done) === 1;
  } catch {
    return false;
  }
}

/**
 * The table's row count, in SQL: the maintained counter, or (only before the
 * first download page after the update created it) a count of the table.
 * SQLite's COALESCE stops at the first non-NULL argument.
 */
export const CLOUD_ROWS = '(COALESCE((SELECT n FROM cloud_row_count WHERE id = 1), (SELECT COUNT(*) FROM supabase_dog_status)))';

/**
 * First in a download's write transaction, only while the counter does not
 * exist: count the table once. (Asked first, outside the transaction: SQLite
 * would count the table even when a WHERE NOT EXISTS makes the row useless.)
 * A page racing another one's first count counts once more, harmlessly.
 */
export async function cloudRowCountInit(connection) {
  const rowsOf = result => result?.results || result?.rows?._array || [];
  try {
    if (rowsOf(await connection.executeAsync('SELECT 1 AS present FROM cloud_row_count WHERE id = 1')).length) return [];
  } catch {
    return [];
  }
  return [{ query: `INSERT OR IGNORE INTO cloud_row_count(id, n)
    SELECT 1, COUNT(*) FROM supabase_dog_status WHERE NOT EXISTS (SELECT 1 FROM cloud_row_count WHERE id = 1)`, params: [] }];
}

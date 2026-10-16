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
//   thousand ids at a time (cloud_wifi_progress); until that finishes the
//   old query answers. A deleted row does not lower the answer: the Master
//   did upload then (「刪除全部狗資料」 clears it with the rows).
export const CLOUD_ROW_TABLES = [
  'CREATE TABLE IF NOT EXISTS cloud_row_count (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS cloud_wifi_latest (owner_user_id TEXT NOT NULL, master_id INTEGER NOT NULL,
    received_at INTEGER NOT NULL, PRIMARY KEY (owner_user_id, master_id))`,
  // `generation` moves at every clear: a step read before it writes nothing.
  `CREATE TABLE IF NOT EXISTS cloud_wifi_progress (id INTEGER PRIMARY KEY CHECK(id=1),
    next_id INTEGER NOT NULL, until_id INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 0)`,
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
  // Emptied (also by an older App, which keeps these triggers): nothing
  // stored, nothing uploaded to show, whatever is downloaded afterwards.
  `CREATE TRIGGER IF NOT EXISTS cloud_rows_deleted_v2 AFTER DELETE ON supabase_dog_status BEGIN
    UPDATE cloud_row_count SET n = n - 1 WHERE id = 1;
    DELETE FROM cloud_wifi_latest WHERE NOT EXISTS (SELECT 1 FROM supabase_dog_status);
  END`,
  // A Wi-Fi row the backfill has not reached yet keeps its time when deleted
  // (the trim right after the update), as a row deleted after it did.
  `CREATE TRIGGER IF NOT EXISTS cloud_rows_wifi_deleted_v2 AFTER DELETE ON supabase_dog_status
    WHEN OLD.upload_source = 'wifi' AND EXISTS (SELECT 1 FROM cloud_wifi_progress
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
    // Made again at every start, so a changed definition always applies (the
    // unsuffixed ones were a development build's, never released).
    'DROP TRIGGER IF EXISTS cloud_rows_inserted', 'DROP TRIGGER IF EXISTS cloud_rows_deleted',
    'DROP TRIGGER IF EXISTS cloud_rows_wifi_changed',
    ...TRIGGER_NAMES.map(name => `DROP TRIGGER IF EXISTS ${name}`),
    // An older version of the App emptied the table (刪除全部狗資料) without
    // knowing these: nothing stored means nothing uploaded to show.
    'DELETE FROM cloud_wifi_latest WHERE NOT EXISTS (SELECT 1 FROM supabase_dog_status)',
    ...CLOUD_ROW_TRIGGERS,
    // A development build's progress table, without `generation`.
    'DROP TABLE IF EXISTS cloud_wifi_backfill',
    `INSERT OR IGNORE INTO cloud_wifi_progress(id, next_id, until_id)
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
  { query: 'INSERT OR IGNORE INTO cloud_wifi_progress(id, next_id, until_id) VALUES (1, 0, 0)' },
  { query: 'UPDATE cloud_wifi_progress SET next_id = 0, until_id = 0, generation = generation + 1 WHERE id = 1' },
  ...CLOUD_ROW_TRIGGERS,
].map(command => (typeof command === 'string' ? { query: command, params: [] } : { params: [], ...command }));

// Ids a step reads. The read walks those rows of the table (upload_source
// sits after the raw JSON, so each row is read whole): 20,000 ids took up to
// 28 s on a signed-in emulator. It runs on the read lane, never inside the
// write lock; only the few answers are written.
export const WIFI_BACKFILL_IDS = 2000;
export const WIFI_BACKFILL_PAUSE_MS = 250;

/**
 * One step of the backfill: the next WIFI_BACKFILL_IDS ids, read on
 * `connection.reader` when there is one (no lock, not the App's queue), then
 * written in one short transaction. `locked(work)` runs the write in the
 * connection's JS order. Returns whether more remain.
 */
export async function backfillWifiStep(connection, locked = work => work()) {
  const rowsOf = result => result?.results || result?.rows?._array || [];
  const state = rowsOf(await connection.executeAsync('SELECT next_id, until_id, generation FROM cloud_wifi_progress WHERE id = 1'))[0];
  if (!state || Number(state.next_id) >= Number(state.until_id)) return false;
  const from = Number(state.next_id), to = Math.min(Number(state.until_id), from + WIFI_BACKFILL_IDS);
  const found = rowsOf(await (connection.reader || connection).executeAsync(
    `SELECT owner_user_id, master_id, MAX(received_at) AS time FROM supabase_dog_status
      WHERE id > CAST(? AS INTEGER) AND id <= CAST(? AS INTEGER) AND upload_source = 'wifi'
        AND owner_user_id IS NOT NULL AND master_id IS NOT NULL AND received_at IS NOT NULL
      GROUP BY owner_user_id, master_id`, [from, to]));
  // Every write only while the progress is still where this read began: a
  // clear (or another step) in between makes the whole step a no-op, so an
  // answer read before 刪除全部狗資料 cannot come back after it (Codex review).
  const still = 'EXISTS (SELECT 1 FROM cloud_wifi_progress WHERE id = 1 AND next_id = ? AND generation = ?)';
  const at = [from, Number(state.generation) || 0];
  await locked(() => connection.executeBatchAsync([
    ...found.flatMap(row => {
      const key = [row.owner_user_id, Number(row.master_id)];
      return [
        { query: `UPDATE cloud_wifi_latest SET received_at = ? WHERE owner_user_id = ? AND master_id = ? AND received_at < ? AND ${still}`,
          params: [Number(row.time), ...key, Number(row.time), ...at] },
        { query: `INSERT INTO cloud_wifi_latest(owner_user_id, master_id, received_at) SELECT ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM cloud_wifi_latest WHERE owner_user_id = ? AND master_id = ?) AND ${still}`,
        params: [...key, Number(row.time), ...key, ...at] },
      ];
    }),
    { query: 'UPDATE cloud_wifi_progress SET next_id = ? WHERE id = 1 AND next_id = ? AND generation = ?', params: [to, ...at] },
  ]));
  return to < Number(state.until_id);
}

/** Whether cloud_wifi_latest holds every stored row's answer. */
export async function wifiLatestReady(connection) {
  const rowsOf = result => result?.results || result?.rows?._array || [];
  try {
    const state = rowsOf(await connection.executeAsync('SELECT next_id >= until_id AS done FROM cloud_wifi_progress WHERE id = 1'))[0];
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

import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { initializeHistoryCoverage, invalidateEvictedCoverage } from '../src/cloud/HistoryCoverage';
import { executeHistoryMaterialBatch } from '../src/cloud/HistoryMaterialPublication';

// Frozen pre-optimization SQL oracle. The candidate must preserve the exact
// candidate ids and proof changes while avoiding the empty-set correlated scan.
function previousInvalidation(deletion) {
  const candidates = deletion.replace(/^DELETE FROM supabase_dog_status WHERE id IN/, '');
  return `UPDATE history_download_state SET complete=0 WHERE complete=1 AND EXISTS (
    SELECT 1 FROM supabase_dog_status lost WHERE lost.id IN ${candidates}
    AND lost.owner_user_id=history_download_state.owner AND lost.slave_id=history_download_state.slave_id
    AND (CAST(COALESCE(lost.track_at,lost.received_at) AS INTEGER)>=range_start-1800000
      AND CAST(COALESCE(lost.track_at,lost.received_at) AS INTEGER)<range_end
      OR lost.received_at>=range_start-1800000 AND lost.received_at<received_before))`;
}
function setup() {
  const connection = createMemoryConnection();
  const sql = connection.sqlite;
  sql.exec(`CREATE TABLE supabase_dog_status(id INTEGER PRIMARY KEY,owner_user_id TEXT,slave_id INTEGER,received_at INTEGER,track_at INTEGER,raw_payload TEXT);
    CREATE TABLE history_download_state(owner TEXT,slave_id INTEGER,day TEXT,complete INTEGER,range_start INTEGER,range_end INTEGER,received_before INTEGER,PRIMARY KEY(owner,slave_id,day));
    CREATE INDEX lost_track ON supabase_dog_status(owner_user_id,slave_id,CAST(COALESCE(track_at,received_at) AS INTEGER));
    CREATE INDEX lost_received ON supabase_dog_status(owner_user_id,received_at DESC,id DESC);`);
  // Independent invented integer clocks: ties, missing track time, upload
  // context outside the track interval, multiple owners/dogs and empty proofs.
  const insert = sql.prepare('INSERT INTO supabase_dog_status VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 50; i++) insert.run(i, i % 2 ? 'a' : 'b', i % 3, Math.floor(i / 2) * 1000000,
    i % 5 === 0 ? null : (49 - i) * 1000000, 'synthetic payload');
  const proof = sql.prepare('INSERT INTO history_download_state VALUES(?,?,?,?,?,?,?)');
  for (const owner of ['a', 'b', 'empty']) for (let dog = 0; dog < 4; dog++)
    for (let day = 0; day < 3; day++) proof.run(owner, dog, String(day), 1,
      day * 16000000, (day + 1) * 16000000, (day + 1) * 16000000 + 2000000);
  proof.run('a', 0, 'legacy-unknown', 1, null, null, null);
  proof.run('a', 0, 'already-incomplete', 0, 0, 16000000, 18000000);
  return connection;
}
const deletionAt = cap => `DELETE FROM supabase_dog_status WHERE id IN (
  SELECT id FROM supabase_dog_status ORDER BY received_at DESC,id DESC LIMIT -1 OFFSET ${cap})`;
const snapshot = connection => ({
  rows: connection.sqlite.prepare('SELECT * FROM supabase_dog_status ORDER BY id').all(),
  proof: connection.sqlite.prepare('SELECT * FROM history_download_state ORDER BY owner,slave_id,day').all(),
});

test('empty exact eviction candidates never evaluate per-proof lost-row context', () => {
  const connection = setup();
  let contextReads = 0;
  try {
    connection.sqlite.function('observe_context', value => { contextReads++; return value; });
    const before = snapshot(connection);
    // Instrument only expression evaluation on the real ordinary coverage
    // table. A view has no usable rowid and cannot represent production proof.
    const query = invalidateEvictedCoverage(deletionAt(1000))
      .replace(/\brange_start\b/g, 'observe_context(range_start)');
    connection.sqlite.exec(query);
    // A real SQLite scalar function counts evaluation, not wall-clock speed
    // or a string match of the optimized SQL. The original query fails here.
    expect(contextReads).toBe(0);
    expect(snapshot(connection)).toEqual(before);
  } finally { connection.close(); }
});

test.each([0, 7, 49, 50, 80])('exact eviction/proof output matches the old transaction at cap %s', async cap => {
  const old = setup(), next = setup();
  try {
    const deletion = deletionAt(cap);
    await old.executeBatchAsync([{ query: previousInvalidation(deletion) }, { query: deletion }]);
    await next.executeBatchAsync([{ query: invalidateEvictedCoverage(deletion) }, { query: deletion }]);
    expect(snapshot(next)).toEqual(snapshot(old));
    expect(next.sqlite.prepare("SELECT complete FROM history_download_state WHERE owner='empty'").all()
      .every(row => row.complete === 1)).toBe(true);
  } finally { old.close(); next.close(); }
});

test('failed deletion rolls back proof invalidation and the material revision in the same native transaction', async () => {
  const connection = setup();
  try {
    const before = snapshot(connection);
    connection.sqlite.exec("CREATE TRIGGER reject_retention BEFORE DELETE ON supabase_dog_status BEGIN SELECT RAISE(ABORT,'synthetic trim failure'); END;");
    const deletion = deletionAt(49);
    await expect(executeHistoryMaterialBatch(connection, [
      { query: invalidateEvictedCoverage(deletion) }, { query: deletion },
    ])).rejects.toThrow('synthetic trim failure');
    expect(snapshot(connection)).toEqual(before);
    expect(connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_history_material'").all()).toEqual([]);
  } finally { connection.close(); }
});

test('payload retirement below cap keeps complete proof and does not create a material change', async () => {
  const connection = setup();
  try {
    const before = snapshot(connection).proof;
    const deletion = deletionAt(1000);
    const material = await executeHistoryMaterialBatch(connection, [
      { query: invalidateEvictedCoverage(deletion) }, { query: deletion },
      { query: 'UPDATE supabase_dog_status SET raw_payload = NULL WHERE id<10' },
    ]);
    expect(material).toEqual({ dataRevision: 0, materialChanged: false });
    expect(snapshot(connection).proof).toEqual(before);
    expect(connection.sqlite.prepare('SELECT raw_payload FROM supabase_dog_status WHERE id<10').all()
      .every(row => row.raw_payload === null)).toBe(true);
  } finally { connection.close(); }
});


test('the SQLite plan does not correlate the eviction scan with each proof', () => {
  const connection = setup();
  try {
    const details = query => connection.sqlite.prepare('EXPLAIN QUERY PLAN ' + query).all()
      .map(row => row.detail);
    expect(details(previousInvalidation(deletionAt(7)))
      .some(detail => detail.includes('CORRELATED'))).toBe(true);
    expect(details(invalidateEvictedCoverage(deletionAt(7)))
      .some(detail => detail.includes('CORRELATED'))).toBe(false);
  } finally { connection.close(); }
});

test('ordinary published, staged and upgraded proof tables retain rowid including null days', async () => {
  const connection = createMemoryConnection();
  try {
    connection.sqlite.exec(`CREATE TABLE history_download_state(owner TEXT,slave_id INTEGER,
      day TEXT,complete INTEGER NOT NULL,PRIMARY KEY(owner,slave_id,day))`);
    for (const table of ['history_download_state', 'cloud_auto_history_download_state', 'cloud_manual_history_download_state']) {
      await initializeHistoryCoverage(connection, table);
      connection.sqlite.prepare(`INSERT INTO ${table}(owner,slave_id,day,complete) VALUES('a',6,NULL,1)`).run();
      const row = connection.sqlite.prepare(`SELECT rowid,* FROM ${table}`).get();
      expect(Number.isSafeInteger(row.rowid)).toBe(true);
      expect(row.day).toBeNull();
      expect(connection.sqlite.prepare(`PRAGMA table_info(${table})`).all()
        .some(column => column.name.toLowerCase() === 'rowid')).toBe(false);
      expect(connection.sqlite.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table).sql
        .toUpperCase()).not.toContain('WITHOUT ROWID');
    }
  } finally { connection.close(); }
});

test('null days, owner/dog separation and both half-open context windows preserve proof exactly', async () => {
  const old = setup(), next = setup();
  const populate = connection => {
    connection.sqlite.exec('DELETE FROM supabase_dog_status; DELETE FROM history_download_state');
    const row = connection.sqlite.prepare('INSERT INTO supabase_dog_status VALUES(?,?,?,?,?,?)');
    // Track-only, upload-only, fallback track time, and exact boundaries. The
    // latest tie is retained by id, not an assumed track/upload ordering.
    const events = [[1, 9000000, 3000000], [2, 4000000, 9000000],
      [3, 2200000, null], [4, 6000000, 6000000], [5, 9000000, 2199999],
      [6, 6000000, 9000000], [7, 10000000, 10000000], [8, 10000000, 10000000]];
    for (const [id, received, track] of events) row.run(id, 'a', 6, received, track, 'fiction');
    row.run(9, 'b', 6, 3000000, 3000000, 'other owner');
    row.run(10, 'a', 4, 3000000, 3000000, 'other dog');
    const proof = connection.sqlite.prepare('INSERT INTO history_download_state VALUES(?,?,?,?,?,?,?)');
    for (const day of [null, 'normal']) proof.run('a', 6, day, 1, 4000000, 6000000, 6000000);
    proof.run('a', 6, 'unknown', 1, null, null, null);
    proof.run('a', 6, 'incomplete', 0, 4000000, 6000000, 6000000);
    proof.run('absent', 6, 'other-owner', 1, 4000000, 6000000, 6000000);
    proof.run('a', 99, 'other-dog', 1, 4000000, 6000000, 6000000);
    proof.run(null, 6, 'null-owner', 1, 4000000, 6000000, 6000000);
    proof.run('a', null, 'null-dog', 1, 4000000, 6000000, 6000000);
  };
  try {
    populate(old); populate(next);
    // Exercise each context arm independently, both excluded boundaries and
    // manual-style filtered candidates, not just the global cap subquery.
    for (const id of [1, 2, 3, 4, 5, 6, 9, 10]) {
      const deletion = `DELETE FROM supabase_dog_status WHERE id IN (SELECT id FROM supabase_dog_status WHERE id=${id})`;
      old.sqlite.exec('BEGIN'); next.sqlite.exec('BEGIN');
      old.sqlite.exec(previousInvalidation(deletion));
      next.sqlite.exec(invalidateEvictedCoverage(deletion));
      expect(snapshot(next)).toEqual(snapshot(old));
      const expected = [1, 2, 3].includes(id) ? 0 : 1;
      expect(next.sqlite.prepare("SELECT complete FROM history_download_state WHERE owner='a' AND slave_id=6 AND day IS NULL").get().complete)
        .toBe(expected);
      old.sqlite.exec('ROLLBACK'); next.sqlite.exec('ROLLBACK');
    }
    const deletion = deletionAt(1);
    await old.executeBatchAsync([{ query: previousInvalidation(deletion) }, { query: deletion }]);
    await next.executeBatchAsync([{ query: invalidateEvictedCoverage(deletion) }, { query: deletion }]);
    expect(snapshot(next)).toEqual(snapshot(old));
    expect(snapshot(next).rows.map(row => row.id)).toEqual([8]);
  } finally { old.close(); next.close(); }
});

test.each([0, 7, 49, 50, 80])('all seven material commands keep deletion accounting and revision parity at cap %s', async cap => {
  const old = setup(), next = setup();
  try {
    const deletion = deletionAt(cap);
    const resultOld = await executeHistoryMaterialBatch(old, [
      { query: previousInvalidation(deletion) }, { query: deletion },
    ]);
    const resultNext = await executeHistoryMaterialBatch(next, [
      { query: invalidateEvictedCoverage(deletion) }, { query: deletion },
    ]);
    expect(resultNext).toEqual(resultOld);
    expect(resultNext).toEqual({ dataRevision: cap < 50 ? 1 : 0, materialChanged: cap < 50 });
    expect(snapshot(next)).toEqual(snapshot(old));
    const commands = next.executeBatchAsync.mock.calls[0][0];
    expect(commands).toHaveLength(7);
    expect(commands[4].query).toBe(deletion);
    expect(commands[5].query).toContain('changes()>0');
    // An unchanged subsequent trim must not advance the material revision.
    const again = await executeHistoryMaterialBatch(next, [
      { query: invalidateEvictedCoverage(deletion) }, { query: deletion },
    ]);
    expect(again).toEqual({ dataRevision: resultNext.dataRevision, materialChanged: false });
  } finally { old.close(); next.close(); }
});

import { createMemoryConnection } from '../__fixtures__/SQLiteConnection';
import { invalidateEvictedCoverage } from '../src/cloud/HistoryCoverage';
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
    connection.sqlite.exec(`CREATE VIEW observed_coverage AS SELECT owner,slave_id,day,complete,
      observe_context(range_start) AS range_start,range_end,received_before FROM history_download_state;
      CREATE TRIGGER observed_update INSTEAD OF UPDATE ON observed_coverage BEGIN
        UPDATE history_download_state SET complete=NEW.complete
        WHERE owner=OLD.owner AND slave_id=OLD.slave_id AND day=OLD.day; END;`);
    const before = snapshot(connection);
    connection.sqlite.exec(invalidateEvictedCoverage(deletionAt(1000), 'supabase_dog_status', 'observed_coverage'));
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

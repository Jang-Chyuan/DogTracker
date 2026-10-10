// Call under the shared connection lock. changes() observes the immediately
// preceding material statement inside the same native transaction; progress,
// proof and staging writes cannot accidentally count as history data.
const table = 'cloud_history_material';
const materialWrite = /^\s*(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+supabase_dog_status\b/i;
const prepare = [
  { query: `CREATE TABLE IF NOT EXISTS ${table} (slot INTEGER PRIMARY KEY CHECK(slot=1),revision INTEGER NOT NULL CHECK(revision>=0),changed INTEGER NOT NULL CHECK(changed IN(0,1)))`, params: [] },
  { query: `INSERT OR IGNORE INTO ${table}(slot,revision,changed) VALUES(1,0,0)`, params: [] },
  { query: `UPDATE ${table} SET changed=0 WHERE slot=1`, params: [] },
];
export async function readHistoryMaterial(connection) {
  const result = await connection.executeAsync(`SELECT revision FROM ${table} WHERE slot=1`);
  const revision = (result.results || result.rows?._array || [])[0]?.revision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}
export async function executeHistoryMaterialBatch(connection, commands) {
  if (!commands.some(command => materialWrite.test(command.query))) {
    await connection.executeBatchAsync(commands);
    return null;
  }
  const annotated = [...prepare];
  for (const command of commands) {
    annotated.push(command);
    // Retiring raw JSON does not affect rows read by history or its exports.
    if (materialWrite.test(command.query) && !/^\s*UPDATE supabase_dog_status SET raw_payload = NULL/i.test(command.query))
      annotated.push({ query: `UPDATE ${table} SET changed=1 WHERE slot=1 AND changes()>0`, params: [] });
  }
  annotated.push({ query: `UPDATE ${table} SET revision=revision+changed WHERE slot=1`, params: [] });
  await connection.executeBatchAsync(annotated);
  const result = await connection.executeAsync(`SELECT revision,changed FROM ${table} WHERE slot=1`);
  const row = (result.results || result.rows?._array || [])[0];
  if (!Number.isSafeInteger(row?.revision) || row.revision < 0 || ![0, 1].includes(row.changed)) return null;
  return { dataRevision: row.revision, materialChanged: row.changed === 1 };
}

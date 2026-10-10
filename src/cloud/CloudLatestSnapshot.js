import { withConnectionLock } from '../database/connectionLock';
import { t } from '../i18n';

export function validCloudFix(row) {
  return !!row && Number.isFinite(row.slave_lat) && Number.isFinite(row.slave_lon)
    && row.slave_lat >= -90 && row.slave_lat <= 90 && row.slave_lon >= -180 && row.slave_lon <= 180
    && !(row.slave_lat === 0 && row.slave_lon === 0);
}
const rows = result => result.results || result.rows?._array || [];
const recordValid = (row, slave) => row && row.slave_id === slave && Number.isInteger(row.master_id)
  && typeof row.event_id === 'string' && !!row.event_id && Number.isFinite(row.received_at)
  && Number.isFinite(row.track_at);
const exposed = record => {
  if (!record) return null;
  const { raw_payload: _raw, ...value } = record;
  return { ...value, source: 'cloud', environment: null };
};

// Latest map data is its own small committed table. Archive writers, repairs
// and retention never write it, and a snapshot never advances archive cursors.
export function createLatestSnapshotDatabase(connection, initialize) {
  let readiness;
  const ready = () => {
    if (readiness) return readiness;
    readiness = initialize().then(() => withConnectionLock(connection, async () => {
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_latest_snapshot (
        owner_user_id TEXT NOT NULL, slave_id INTEGER NOT NULL,
        packet_json TEXT NOT NULL, fix_json TEXT, context_json TEXT NOT NULL,
        PRIMARY KEY(owner_user_id,slave_id))`);
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_snapshot_state (
        owner_user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, cutoff INTEGER NOT NULL)`);
    })).catch(error => { readiness = null; throw error; });
    return readiness;
  };
  return {
    async publishLatestSnapshot(owner, snapshot, isCurrent = () => true) {
      if (!owner || !Number.isFinite(snapshot?.cutoff) || !Array.isArray(snapshot?.dogs)) throw new Error(t('c588'));
      const seen = new Set();
      for (const dog of snapshot.dogs) {
        if (!Number.isInteger(dog.slaveId) || seen.has(dog.slaveId)
          || !recordValid(dog.packet, dog.slaveId)
          || (dog.fix != null && (!recordValid(dog.fix, dog.slaveId) || !validCloudFix(dog.fix)))
          || (dog.context != null && !Array.isArray(dog.context))) throw new Error(t('c588'));
        seen.add(dog.slaveId);
      }
      await ready();
      return withConnectionLock(connection, async () => {
        if (!isCurrent()) throw new Error(t('c576'));
        const before = rows(await connection.executeAsync('SELECT revision FROM cloud_snapshot_state WHERE owner_user_id=?', [owner]))[0];
        const revision = Number(before?.revision || 0) + 1;
        const commands = [{ query: 'DELETE FROM cloud_latest_snapshot WHERE owner_user_id=?', params: [owner] }];
        for (const dog of snapshot.dogs) commands.push({
          query: 'INSERT INTO cloud_latest_snapshot(owner_user_id,slave_id,packet_json,fix_json,context_json) VALUES(?,?,?,?,?)',
          params: [owner, dog.slaveId, JSON.stringify(dog.packet), dog.fix ? JSON.stringify(dog.fix) : null,
            JSON.stringify(dog.context || [])],
        });
        commands.push({ query: 'INSERT OR REPLACE INTO cloud_snapshot_state(owner_user_id,revision,cutoff) VALUES(?,?,?)',
          params: [owner, revision, snapshot.cutoff] });
        if (!isCurrent()) throw new Error(t('c576'));
        await connection.executeBatchAsync(commands);
        return revision;
      });
    },
    async readLatestSnapshot(owner) {
      if (!owner) throw new Error(t('c572'));
      await ready();
      // One statement sees the state and every dog from the same transaction,
      // including the state row of a successful empty snapshot.
      const found = rows(await connection.executeAsync(`SELECT s.revision,s.cutoff,d.packet_json,d.fix_json,d.context_json
        FROM cloud_snapshot_state s LEFT JOIN cloud_latest_snapshot d ON d.owner_user_id=s.owner_user_id
        WHERE s.owner_user_id=? ORDER BY d.slave_id`, [owner]));
      if (!found.length) return null;
      return { revision: Number(found[0].revision), cutoff: Number(found[0].cutoff),
        rows: found.filter(row => row.fix_json).map(row => exposed(JSON.parse(row.fix_json))),
        packets: found.filter(row => row.packet_json).map(row => exposed(JSON.parse(row.packet_json))),
        context: found.flatMap(row => row.context_json ? JSON.parse(row.context_json) : []),
      };
    },
  };
}

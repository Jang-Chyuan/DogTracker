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
const contextValid = (row, slave, owner) => recordValid(row, slave)
  && (row.owner_user_id == null || row.owner_user_id === owner)
  && (row.slave_lat == null && row.slave_lon == null || row.slave_lat === 0 && row.slave_lon === 0 || validCloudFix(row));
const decodeContext = text => {
  const value = text ? JSON.parse(text) : [];
  return Array.isArray(value) ? { rows: value, seeds: [] } : value;
};
const exposed = record => {
  if (!record) return null;
  const { raw_payload: _raw, ...value } = record;
  return { ...value, source: 'cloud', environment: null };
};

// Latest map data is its own small committed table. Archive writers, repairs
// and retention never write it, and a snapshot never advances archive cursors.
export function createLatestSnapshotDatabase(connection, initialize, bootstrap = null) {
  let readiness;
  const ready = () => {
    if (readiness) return readiness;
    readiness = initialize().then(() => withConnectionLock(connection, async () => {
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_latest_snapshot (
        owner_user_id TEXT NOT NULL, slave_id INTEGER NOT NULL,
        packet_json TEXT NOT NULL, fix_json TEXT, context_json TEXT NOT NULL,
        PRIMARY KEY(owner_user_id,slave_id))`);
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_snapshot_state (
        owner_user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, cutoff INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'remote')`);
      const columns = rows(await connection.executeAsync('PRAGMA table_info(cloud_snapshot_state)'));
      if (!columns.some(column => column.name === 'origin'))
        await connection.executeAsync("ALTER TABLE cloud_snapshot_state ADD COLUMN origin TEXT NOT NULL DEFAULT 'remote'");
    })).catch(error => { readiness = null; throw error; });
    return readiness;
  };
  return {
    async publishLatestSnapshot(owner, snapshot, isCurrent = () => true) {
      if (!owner || !Number.isFinite(snapshot?.cutoff) || !Array.isArray(snapshot?.dogs)) throw new Error(t('c588'));
      if (snapshot.masterIds != null && (!Array.isArray(snapshot.masterIds) || !snapshot.masterIds.every(Number.isSafeInteger))) throw new Error(t('c588'));
      const seen = new Set();
      for (const dog of snapshot.dogs) {
        const permitted = row => (row.owner_user_id == null || row.owner_user_id === owner)
          && (!snapshot.masterIds || snapshot.masterIds.includes(row.master_id));
        if (!Number.isInteger(dog.slaveId) || seen.has(dog.slaveId)
          || !recordValid(dog.packet, dog.slaveId) || !permitted(dog.packet)
          || (dog.fix != null && (!recordValid(dog.fix, dog.slaveId) || !permitted(dog.fix) || !validCloudFix(dog.fix)))
          || [dog.context, dog.seeds].some(values => values != null && (!Array.isArray(values)
            || !values.every(row => contextValid(row, dog.slaveId, owner) && permitted(row))))) throw new Error(t('c588'));
        seen.add(dog.slaveId);
      }
      await ready();
      return withConnectionLock(connection, async () => {
        if (!isCurrent()) throw new Error(t('c576'));
        const before = rows(await connection.executeAsync('SELECT revision FROM cloud_snapshot_state WHERE owner_user_id=?', [owner]))[0];
        const previous = new Map(rows(await connection.executeAsync('SELECT slave_id,packet_json,context_json FROM cloud_latest_snapshot WHERE owner_user_id=?', [owner]))
          .map(row => [row.slave_id, row]));
        const revision = Number(before?.revision || 0) + 1;
        const commands = [{ query: 'DELETE FROM cloud_latest_snapshot WHERE owner_user_id=?', params: [owner] }];
        for (const dog of snapshot.dogs) {
          const old = previous.get(dog.slaveId);
          const context = dog.context == null && old && JSON.parse(old.packet_json).master_id === dog.packet.master_id
            ? decodeContext(old.context_json) : { rows: dog.context || [], seeds: dog.seeds || [] };
          if (snapshot.masterIds) {
            context.rows = context.rows.filter(row => snapshot.masterIds.includes(row.master_id));
            context.seeds = context.seeds.filter(row => snapshot.masterIds.includes(row.master_id));
          }
          commands.push({
          query: 'INSERT INTO cloud_latest_snapshot(owner_user_id,slave_id,packet_json,fix_json,context_json) VALUES(?,?,?,?,?)',
          params: [owner, dog.slaveId, JSON.stringify(dog.packet), dog.fix ? JSON.stringify(dog.fix) : null,
            JSON.stringify(context)],
          });
        }
        commands.push({ query: 'INSERT OR REPLACE INTO cloud_snapshot_state(owner_user_id,revision,cutoff,origin) VALUES(?,?,?,?)',
          params: [owner, revision, snapshot.cutoff, 'remote'] });
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
      return withConnectionLock(connection, async () => {
        const state = rows(await connection.executeAsync('SELECT revision FROM cloud_snapshot_state WHERE owner_user_id=?', [owner]))[0];
        if (!state && bootstrap) {
          // Upgrade only once from this owner's already published archive. It
          // is an offline cache, never proof of a fresh or complete remote set.
          const cached = await bootstrap(owner);
          const fixes = new Map(cached.fixes.filter(validCloudFix).map(row => [row.slave_id, row]));
          const commands = cached.packets.map(packet => ({
            query: 'INSERT INTO cloud_latest_snapshot(owner_user_id,slave_id,packet_json,fix_json,context_json) VALUES(?,?,?,?,?)',
            params: [owner, packet.slave_id, JSON.stringify(packet), fixes.has(packet.slave_id) ? JSON.stringify(fixes.get(packet.slave_id)) : null,
              JSON.stringify(cached.contexts?.get(packet.slave_id) || { rows: [], seeds: [] })],
          }));
          commands.push({ query: 'INSERT INTO cloud_snapshot_state(owner_user_id,revision,cutoff,origin) VALUES(?,0,?,?)',
            params: [owner, Math.max(0, ...cached.packets.map(row => Number(row.received_at) || 0)), 'cache'] });
          await connection.executeBatchAsync(commands);
        }
        const found = rows(await connection.executeAsync(`SELECT s.revision,s.cutoff,s.origin,d.packet_json,d.fix_json,d.context_json
          FROM cloud_snapshot_state s LEFT JOIN cloud_latest_snapshot d ON d.owner_user_id=s.owner_user_id
          WHERE s.owner_user_id=? ORDER BY d.slave_id`, [owner]));
        if (!found.length) return null;
        return { revision: Number(found[0].revision), cutoff: Number(found[0].cutoff), verified: found[0].origin === 'remote',
          rows: found.filter(row => row.fix_json).map(row => exposed(JSON.parse(row.fix_json))),
          packets: found.filter(row => row.packet_json).map(row => exposed(JSON.parse(row.packet_json))),
          context: found.flatMap(row => decodeContext(row.context_json).rows),
          seeds: found.flatMap(row => decodeContext(row.context_json).seeds),
        };
      });
    },
  };
}

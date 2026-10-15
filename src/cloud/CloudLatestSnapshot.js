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
// The whole remote JSON of a row (CloudTelemetry raw_payload) is for the
// 雲端資料 page's archive rows only. Nothing reads it from the latest map
// set (exposed() drops it), and it is about half of each stored context row
// (audit F8), so it is not stored here.
const withoutPayload = record => {
  if (!record || record.raw_payload === undefined) return record;
  const { raw_payload: _raw, ...value } = record;
  return value;
};
const exposed = record => {
  if (!record) return null;
  const { raw_payload: _raw, ...value } = record;
  return { ...value, source: 'cloud', environment: null };
};
// Each stored dog's context carries a token that changes whenever its
// context does (`context_version`). The live map reads the latest set every
// 10 s, and a silent dog's half hour does not change for hours: a reader that
// passes the tokens it holds (`knownContexts`) gets back, and parses, only
// the contexts that changed (audit F8: every dog's context used to be parsed,
// twice, on every poll). A token is unique across revisions, data deletion
// and app restarts, so a matching one always means the same stored context.
let contextTokens = 0;
const contextToken = () => `${Date.now().toString(36)}.${(contextTokens++).toString(36)}`;

// Latest map data is its own small committed table. Archive writers, repairs
// and retention never write it, and a snapshot never advances archive cursors.
// Successful schema readiness belongs to the actual wrapper lifetime, not a
// process-wide native lock key that a reopened/closed wrapper may reuse.
const latestReadiness = new WeakMap();
export function createLatestSnapshotDatabase(connection, initialize, bootstrap = null, initializeArchive = initialize) {
  const ready = () => {
    if (latestReadiness.has(connection)) return latestReadiness.get(connection);
    const readiness = Promise.resolve().then(initialize).then(() => withConnectionLock(connection, async () => {
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_latest_snapshot (
        owner_user_id TEXT NOT NULL, slave_id INTEGER NOT NULL,
        packet_json TEXT NOT NULL, fix_json TEXT, context_json TEXT NOT NULL,
        PRIMARY KEY(owner_user_id,slave_id))`);
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_snapshot_state (
        owner_user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, cutoff INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'remote')`);
      const columns = rows(await connection.executeAsync('PRAGMA table_info(cloud_snapshot_state)'));
      if (!columns.some(column => column.name === 'origin'))
        await connection.executeAsync("ALTER TABLE cloud_snapshot_state ADD COLUMN origin TEXT NOT NULL DEFAULT 'remote'");
      const dogColumns = rows(await connection.executeAsync('PRAGMA table_info(cloud_latest_snapshot)'));
      if (!dogColumns.some(column => column.name === 'context_version'))
        await connection.executeAsync("ALTER TABLE cloud_latest_snapshot ADD COLUMN context_version TEXT NOT NULL DEFAULT ''");
    })).catch(error => {
      if (latestReadiness.get(connection) === readiness) latestReadiness.delete(connection);
      throw error;
    });
    latestReadiness.set(connection, readiness);
    return readiness;
  };
  return {
    initializeLatest: ready,
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
        const previous = new Map(rows(await connection.executeAsync('SELECT slave_id,packet_json,fix_json,context_json,context_version FROM cloud_latest_snapshot WHERE owner_user_id=?', [owner]))
          .map(row => [row.slave_id, row]));
        const revision = Number(before?.revision || 0) + 1;
        const commands = [];
        if (!snapshot.dogs.length) commands.push({ query: 'DELETE FROM cloud_latest_snapshot WHERE owner_user_id=?', params: [owner] });
        else for (const slave of previous.keys()) {
          if (!seen.has(slave)) commands.push({
            query: 'DELETE FROM cloud_latest_snapshot WHERE owner_user_id=? AND slave_id=?', params: [owner, slave],
          });
        }
        for (const dog of snapshot.dogs) {
          const old = previous.get(dog.slaveId);
          const context = dog.context == null && old && JSON.parse(old.packet_json).master_id === dog.packet.master_id
            ? decodeContext(old.context_json) : { rows: dog.context || [], seeds: dog.seeds || [] };
          const permittedRow = row => !snapshot.masterIds || snapshot.masterIds.includes(row.master_id);
          context.rows = context.rows.filter(permittedRow).map(withoutPayload);
          context.seeds = context.seeds.filter(permittedRow).map(withoutPayload);
          const packetJSON = JSON.stringify(withoutPayload(dog.packet));
          const fixJSON = dog.fix ? JSON.stringify(withoutPayload(dog.fix)) : null;
          const contextJSON = JSON.stringify({ rows: context.rows, seeds: context.seeds });
          // Compare the complete serialized values, including context order and
          // authority filtering. Unchanged latest/context polls need not rewrite
          // large dog rows; their atomic metadata revision/cutoff still advances.
          if (old && old.packet_json === packetJSON && old.fix_json === fixJSON && old.context_json === contextJSON) continue;
          const version = old && old.context_json === contextJSON ? old.context_version : contextToken();
          commands.push({
          query: 'INSERT OR REPLACE INTO cloud_latest_snapshot(owner_user_id,slave_id,packet_json,fix_json,context_json,context_version) VALUES(?,?,?,?,?,?)',
          params: [owner, dog.slaveId, packetJSON, fixJSON, contextJSON, version],
          });
        }
        commands.push({ query: 'INSERT OR REPLACE INTO cloud_snapshot_state(owner_user_id,revision,cutoff,origin) VALUES(?,?,?,?)',
          params: [owner, revision, snapshot.cutoff, 'remote'] });
        if (!isCurrent()) throw new Error(t('c576'));
        await connection.executeBatchAsync(commands);
        return revision;
      });
    },
    async readLatestSnapshot(owner, options = {}) {
      if (!owner) throw new Error(t('c572'));
      await ready();
      if (bootstrap && !options.metadataOnly && !options.positionsOnly && options.bootstrap !== false) {
        const missing = await withConnectionLock(connection, async () => !rows(await connection.executeAsync(
          'SELECT revision FROM cloud_snapshot_state WHERE owner_user_id=?', [owner])).length);
        if (missing) {
          // Both archive readiness AND cache reads may take the archive's long
          // lock. Never hold the latest-store lock across either operation.
          // A remote snapshot can win during either wait; recheck before commit.
          await initializeArchive();
          const stillMissing = await withConnectionLock(connection, async () => !rows(await connection.executeAsync(
            'SELECT revision FROM cloud_snapshot_state WHERE owner_user_id=?', [owner])).length);
          let cached;
          if (stillMissing && (!options.isCurrent || options.isCurrent())) cached = await bootstrap(owner);
          await withConnectionLock(connection, async () => {
            const state = rows(await connection.executeAsync('SELECT revision FROM cloud_snapshot_state WHERE owner_user_id=?', [owner]))[0];
            if (!state && cached && options.bootstrap !== false) {
              // Upgrade only once from this owner's already published archive. It
              // is an offline cache, never proof of a fresh or complete remote set.
              if (options.isCurrent && !options.isCurrent()) return;
              const fixes = new Map(cached.fixes.filter(validCloudFix).map(row => [row.slave_id, row]));
              const commands = cached.packets.map(packet => ({
                query: 'INSERT INTO cloud_latest_snapshot(owner_user_id,slave_id,packet_json,fix_json,context_json,context_version) VALUES(?,?,?,?,?,?)',
                params: [owner, packet.slave_id, JSON.stringify(packet), fixes.has(packet.slave_id) ? JSON.stringify(fixes.get(packet.slave_id)) : null,
                  JSON.stringify(cached.contexts?.get(packet.slave_id) || { rows: [], seeds: [] }), contextToken()],
              }));
              commands.push({ query: 'INSERT INTO cloud_snapshot_state(owner_user_id,revision,cutoff,origin) VALUES(?,0,?,?)',
                params: [owner, Math.max(0, ...cached.packets.map(row => Number(row.received_at) || 0)), 'cache'] });
              await connection.executeBatchAsync(commands);
            }
          });
        }
      }
      // The full joined read below sees the state and every dog together,
      // including the state row of a successful empty snapshot.
      return withConnectionLock(connection, async () => {
        if (options?.positionsOnly === true) {
          // No bootstrap or context decode: this is the small atomic map set.
          const found = rows(await connection.executeAsync(`SELECT s.revision,s.cutoff,s.origin,d.packet_json,d.fix_json
            FROM cloud_snapshot_state s LEFT JOIN cloud_latest_snapshot d ON d.owner_user_id=s.owner_user_id
            WHERE s.owner_user_id=? ORDER BY d.slave_id`, [owner]));
          if (!found.length) return null;
          return { revision: Number(found[0].revision), cutoff: Number(found[0].cutoff), verified: found[0].origin === 'remote',
            rows: found.filter(row => row.fix_json).map(row => exposed(JSON.parse(row.fix_json))),
            packets: found.filter(row => row.packet_json).map(row => exposed(JSON.parse(row.packet_json))) };
        }
        const state = rows(await connection.executeAsync('SELECT revision FROM cloud_snapshot_state WHERE owner_user_id=?', [owner]))[0];
        // The scheduler only needs the old revision bound before fresh HTTP.
        // Revision 0 permits the existing one-time offline upgrade cache, not
        // a remote success; do not bootstrap, decode context or write here.
        if (options?.metadataOnly === true) return { revision: state ? Number(state.revision) : 0 };
        // `knownContexts` ({ slaveId: context_version }): contexts the reader
        // already holds. Those are neither read nor parsed again; the result
        // says which it left out (`contextsKnown`). Without it every dog's
        // context comes back, as before. Both queries run in the same lock.
        const known = options?.knownContexts ?? null;
        const found = rows(await connection.executeAsync(`SELECT s.revision,s.cutoff,s.origin,d.slave_id,d.packet_json,d.fix_json,d.context_version
          FROM cloud_snapshot_state s LEFT JOIN cloud_latest_snapshot d ON d.owner_user_id=s.owner_user_id
          WHERE s.owner_user_id=? ORDER BY d.slave_id`, [owner]));
        if (!found.length) return null;
        const dogs = found.filter(row => row.packet_json);
        const versions = Object.fromEntries(dogs.map(row => [row.slave_id, row.context_version]));
        const wanted = dogs.filter(row => !known || known[row.slave_id] !== row.context_version).map(row => row.slave_id);
        const texts = new Map();
        // One read of the changed dogs only (bound parameters; a dog roster is small).
        for (let index = 0; index < wanted.length; index += 500) {
          const part = wanted.slice(index, index + 500);
          rows(await connection.executeAsync(`SELECT slave_id,context_json FROM cloud_latest_snapshot
            WHERE owner_user_id=? AND slave_id IN (${part.map(() => '?').join(',')})`, [owner, ...part]))
            .forEach(row => texts.set(row.slave_id, row.context_json));
        }
        // Each dog's context parsed once (`contexts`), and all of them together as before.
        const contexts = Object.fromEntries(wanted.map(slave => [slave, decodeContext(texts.get(slave))]));
        const all = Object.values(contexts);
        return { revision: Number(found[0].revision), cutoff: Number(found[0].cutoff), verified: found[0].origin === 'remote',
          rows: found.filter(row => row.fix_json).map(row => exposed(JSON.parse(row.fix_json))),
          packets: dogs.map(row => exposed(JSON.parse(row.packet_json))),
          contexts, contextVersions: versions, contextsKnown: dogs.length - wanted.length,
          context: all.flatMap(context => context.rows), seeds: all.flatMap(context => context.seeds) };
      });
    },
  };
}

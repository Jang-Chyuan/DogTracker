import { executeHistoryMaterialBatch, readHistoryMaterial } from './HistoryMaterialPublication';
import { initializeHistoryCoverage, invalidateEvictedCoverage, coverageContainsTime, HISTORY_CONTEXT_BEFORE_MS } from './HistoryCoverage';
import { t } from '../i18n';
import { withConnectionLock } from '../database/connectionLock';

const tables = [
  ['supabase_dog_status', 'owner_user_id', ['owner_user_id', 'event_id']],
  ['cloud_sync_state', 'owner_user_id', ['owner_user_id', 'master_id']],
  ['cloud_sync_buckets', 'owner_user_id', ['owner_user_id', 'master_id', 'bucket_start']],
  ['history_download_state', 'owner', ['owner', 'slave_id', 'day']],
];
const kinds = ['auto', 'manual'];
// A publication moves its staged telemetry in chunks of this many rows, and
// the staged copies go afterwards, this many a transaction (稽核 A F3).
const CHUNK_ROWS = 1000;
// Same retention as CloudDatabase.saveBucket.
const BUCKET_RETENTION_MS = 48 * 60 * 60 * 1000;
const initialization = new WeakMap();
const metadata = ['track_at', 'upload_source', 'phone_received_at', 'track_time_version'];
const baseFields = [...metadata, 'publication_version'];
const rows = result => result.results || result.rows?._array || [];
const tableName = (kind, table) => `cloud_${kind}_${table}`;
const rewrite = (kind, sql) => tables.reduce((query, [table]) =>
  query.replace(new RegExp(`\\b${table}\\b`, 'g'), tableName(kind, table)), sql);

const time = alias => `CAST(COALESCE(${alias}.track_at,${alias}.received_at) AS INTEGER)`;
const fix = alias => `${alias}.slave_lat IS NOT NULL AND ${alias}.slave_lon IS NOT NULL AND NOT (${alias}.slave_lat=0 AND ${alias}.slave_lon=0)`;
// The newest packet and newest usable fix of every owner/dog are never reclaimed.
function replaceable(table) {
  const newer = fixed => `EXISTS (SELECT 1 FROM ${table} n WHERE n.owner_user_id IS old.owner_user_id
    AND n.slave_id IS old.slave_id ${fixed ? `AND ${fix('n')}` : ''}
    AND (${time('n')}>${time('old')} OR (${time('n')}=${time('old')} AND n.id>old.id)))`;
  return `${newer(false)} AND (NOT (${fix('old')}) OR ${newer(true)})`;
}

// Reclaim only oldest history. The newest packet and newest usable fix of
// every owner/dog remain available even when another dog fills the cache.
function reclaimHistory(table, excess, protectManual = false) {
  return `DELETE FROM ${table} WHERE id IN (SELECT old.id FROM ${table} old
    WHERE ${protectManual ? `NOT EXISTS (SELECT 1 FROM cloud_manual_history_download_state needed
      WHERE needed.complete=1 AND needed.owner=old.owner_user_id AND needed.slave_id=old.slave_id
      AND (${coverageContainsTime(time('old'), 'needed')}
        OR old.received_at>=needed.range_start-${HISTORY_CONTEXT_BEFORE_MS} AND old.received_at<needed.received_before)) AND` : ''} ${replaceable(table)}
    ORDER BY old.received_at,old.id LIMIT MAX(0,${excess}))`;
}

// Staged rows may be dropped before publication only when the publication
// would certainly evict them: at least `cap` newer new rows of the same owner
// are staged with them. Anything else would leave a gap behind the staged
// checkpoint, so it waits for the publish transaction's global eviction.
function reclaimBeyondCap(table, cap) {
  const fresh = alias => `COALESCE(${alias}.had_base,0)<>1`;
  const candidates = '(SELECT id FROM cloud_stage_reclaim)';
  return [
    // One threshold per owner over the cap (normally none): the cap-th newest reception time.
    { query: `INSERT INTO cloud_stage_limit(owner,threshold) SELECT over.owner_user_id,
      (SELECT n.received_at FROM ${table} n WHERE n.owner_user_id=over.owner_user_id AND ${fresh('n')}
        ORDER BY n.received_at DESC,n.id DESC LIMIT 1 OFFSET ?)
      FROM (SELECT owner_user_id FROM ${table} WHERE ${fresh(table)} GROUP BY owner_user_id HAVING COUNT(*)>?) over`, params: [cap - 1, cap] },
    { query: `INSERT INTO cloud_stage_reclaim(id) SELECT old.id FROM ${table} old JOIN cloud_stage_limit l ON old.owner_user_id=l.owner
      WHERE ${fresh('old')} AND old.received_at<l.threshold AND ${replaceable(table)}`, params: [] },
    // Published proof covering such a row no longer holds every cloud row.
    { query: invalidateEvictedCoverage(`DELETE FROM ${table} WHERE id IN ${candidates}`, table), params: [] },
    { query: `DELETE FROM ${table} WHERE id IN ${candidates}`, params: [] },
    { query: 'DELETE FROM cloud_stage_reclaim', params: [] },
    { query: 'DELETE FROM cloud_stage_limit', params: [] },
  ];
}

// UI readers retain their published-table contract. Each network job stores
// only new events, metadata repairs and resumable progress in its own delta.
export function createStagedCloudDatabase(connection, options, createCore) {
  const published = createCore(connection, options);
  const cap = options.maxRows;
  // Published history keeps its existing budget; a failed/cancelled job cannot
  // reclaim published rows. A long automatic pass may stage up to another
  // cache of new rows (beyond that they are certainly evicted on publication),
  // so the hard limit leaves room for that plus a bounded reserve.
  const reserveRows = Math.max(1, Math.floor(cap / 8));
  const budgetRows = 2 * cap + reserveRows;
  const active = new Map();
  const initializationKey = connection.lockKey || connection;
  if (!initialization.has(initializationKey)) initialization.set(initializationKey, { ready: null, columns: null });
  const state = initialization.get(initializationKey);
  const cores = Object.fromEntries(kinds.map(kind => [kind, createCore({
    lockKey: connection.lockKey || connection,
    executeAsync: (query, params) => connection.executeAsync(rewrite(kind, query), params),
    executeBatchAsync: async commands => {
      const writes = commands.filter(command => !/^DELETE FROM supabase_dog_status WHERE id IN/.test(command.query)
        && !/^UPDATE history_download_state SET complete=0 WHERE complete=1 AND EXISTS/.test(command.query));
      const stageUsed = kinds.map(value => `(SELECT COUNT(*) FROM ${tableName(value, 'supabase_dog_status')})`).join('+');
      const used = `(SELECT COUNT(*) FROM supabase_dog_status)+${stageUsed}`;
      // Never reclaim another job's staged rows, nor rows the publication keeps.
      const reclaim = kind === 'auto' ? reclaimBeyondCap(tableName(kind, 'supabase_dog_status'), cap) : [];
      try {
        await connection.executeBatchAsync([
          ...writes.map(command => {
            const query = command.publishedCopy ? command.query : rewrite(kind, command.query);
            if (/^INSERT INTO supabase_dog_status/.test(command.query)) return {
              query: query + ' AND NOT EXISTS (SELECT 1 FROM supabase_dog_status WHERE owner_user_id=? AND event_id=?)',
              params: [...command.params, ...command.params.slice(-2)],
            };
            return { query, params: command.params };
          }),
          ...reclaim,
          { query: `INSERT INTO cloud_stage_quota(used,budget) SELECT ${used},?`, params: [budgetRows] },
          { query: 'DELETE FROM cloud_stage_quota', params: [] },
        ]);
      } catch (error) {
        if (String(error.message).includes('used<=budget')) throw new Error(t("c622"));
        throw error;
      }
    },
  }, { ...options, historyMaterialTracking: false })]));
  const initialize = () => {
    if (state.ready) return state.ready;
    state.ready = published.initialize().then(() => withConnectionLock(connection, async () => {
      await initializeHistoryCoverage(connection);
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS cloud_download_jobs (owner TEXT, kind TEXT, scope TEXT, PRIMARY KEY(owner,kind))');
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS cloud_stage_quota (used INTEGER,budget INTEGER,CHECK(used<=budget))');
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS cloud_stage_limit (owner TEXT PRIMARY KEY,threshold INTEGER)');
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS cloud_stage_reclaim (id INTEGER PRIMARY KEY)');
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_archive_publication (
        owner TEXT PRIMARY KEY, cutoff INTEGER NOT NULL CHECK(cutoff>=0),
        revision INTEGER NOT NULL CHECK(revision>0))`);
      state.columns = Object.fromEntries(await Promise.all(tables.map(async ([table]) => [table,
        rows(await connection.executeAsync(`PRAGMA table_info(${table})`)).map(column => column.name)])));
      for (const kind of kinds) for (const [table] of tables) {
        const definitions = rows(await connection.executeAsync(
          "SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? AND sql IS NOT NULL", [table]));
        for (const definition of definitions.filter(value => value.type === 'table'))
          await connection.executeAsync(rewrite(kind, definition.sql).replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS '));
        // A delta cloned by an older version lacks columns added to published
        // since; overlay reads and publication select every published column.
        const staged = new Set(rows(await connection.executeAsync(`PRAGMA table_info(${tableName(kind, table)})`)).map(column => column.name));
        for (const column of rows(await connection.executeAsync(`PRAGMA table_info(${table})`)))
          if (!staged.has(column.name)) await connection.executeAsync(`ALTER TABLE ${tableName(kind, table)} ADD COLUMN ${column.name} ${column.type || ''}${column.dflt_value != null ? ` DEFAULT ${column.dflt_value}` : ''}`);
        for (const definition of definitions.filter(value => value.type === 'index'))
          await connection.executeAsync(rewrite(kind, definition.sql).replace(/^(CREATE (?:UNIQUE )?INDEX)(?: IF NOT EXISTS)? \S+/i,
            `$1 IF NOT EXISTS cloud_${kind}_${definition.name}`));
        if (table === 'history_download_state') await initializeHistoryCoverage(connection, tableName(kind, table));
        if (table === 'supabase_dog_status') {
          const found = new Set(rows(await connection.executeAsync(`PRAGMA table_info(${tableName(kind, table)})`)).map(column => column.name));
          for (const name of ['had_base', ...baseFields.map(value => `base_${value}`)])
            if (!found.has(name)) await connection.executeAsync(`ALTER TABLE ${tableName(kind, table)} ADD COLUMN ${name}`);
        }
      }
    })).catch(error => { state.ready = null; throw error; });
    return state.ready;
  };
  const kindOf = owner => active.get(owner) || 'auto';
  const job = async (owner, kind) => rows(await connection.executeAsync(
    'SELECT scope FROM cloud_download_jobs WHERE owner=? AND kind=?', [owner, kind]))[0];
  const hasJob = async owner => {
    // History completion markers may be used before the full tracking schema opens.
    if (!state.ready) {
      const found = rows(await connection.executeAsync("SELECT name FROM sqlite_master WHERE name='cloud_download_jobs'"));
      if (!found.length) return false;
    }
    return !!await job(owner, kindOf(owner));
  };
  const names = table => state.columns[table].filter(name => table !== 'supabase_dog_status' || name !== 'id');
  const overlay = (kind, table) => {
    const keys = tables.find(([name]) => name === table)[2];
    const delta = tableName(kind, table);
    const list = state.columns[table].join(',');
    return `(SELECT ${list} FROM ${delta} UNION ALL SELECT ${state.columns[table].map(name => `p.${name}`).join(',')}
      FROM ${table} p WHERE NOT EXISTS (SELECT 1 FROM ${delta} d WHERE ${keys.map(key => `d.${key}=p.${key}`).join(' AND ')}))`;
  };
  async function read(kind, table, selection, condition, params) {
    return rows(await connection.executeAsync(`SELECT ${selection} FROM ${overlay(kind, table)} WHERE ${condition}`, params));
  }
  // Call under the connection lock, once the job row is gone: no reader looks
  // at a delta without its job, so the staged telemetry can go in transactions
  // of their own and the BLE and phone-route writers get the lock between
  // them. A publication used to delete it inside its own transaction, about a
  // third of its time (稽核 A F3).
  async function clearStagedTelemetry(kind, owner) {
    const delta = tableName(kind, 'supabase_dog_status');
    const any = async () => rows(await connection.executeAsync(
      `SELECT 1 AS found FROM ${delta} WHERE owner_user_id=? LIMIT 1`, [owner])).length > 0;
    while (await any()) {
      await connection.executeAsync(`DELETE FROM ${delta} WHERE id IN (SELECT id FROM ${delta}
        WHERE +owner_user_id=? ORDER BY id LIMIT ${CHUNK_ROWS})`, [owner]);
    }
  }
  const result = { ...published, initialize,
    async beginDownload(owner, kind = 'auto', scope = null) {
      if (!owner || !kinds.includes(kind)) throw new Error(t("c572"));
      await initialize();
      await withConnectionLock(connection, async () => {
        // Auto resumes its own prior cursor. A new manual request replaces only
        // an unfinished manual scope; it cannot erase another job's pages.
        if (kind === 'manual') {
          await connection.executeBatchAsync([
            ...tables.slice(1).map(([table, ownerColumn]) => ({ query: `DELETE FROM ${tableName(kind, table)} WHERE ${ownerColumn}=?`, params: [owner] })),
            { query: 'DELETE FROM cloud_download_jobs WHERE owner=? AND kind=?', params: [owner, kind] },
          ]);
        }
        // Without a job, staged telemetry is only what a publication (or the
        // manual reset above) has not finished clearing, e.g. after a crash.
        if (!await job(owner, kind)) await clearStagedTelemetry(kind, owner);
        await connection.executeAsync('INSERT OR IGNORE INTO cloud_download_jobs(owner,kind,scope) VALUES(?,?,?)', [owner, kind, scope]);
      });
      active.set(owner, kind);
    },
    async beginManualScope(owner, slave, day) {
      await result.beginDownload(owner, 'manual', `${slave}:${day}`);
    },
    async readArchivePublication(owner) {
      if (!owner) throw new Error(t('c572'));
      await initialize();
      return withConnectionLock(connection, async () => {
        const value = rows(await connection.executeAsync(
          'SELECT cutoff,revision FROM cloud_archive_publication WHERE owner=?', [owner]))[0];
        if (!value) return null;
        const cutoff = Number(value.cutoff), revision = Number(value.revision);
        if (!Number.isSafeInteger(cutoff) || cutoff < 0 || !Number.isSafeInteger(revision) || revision < 1)
          throw new Error(t('c588'));
        return { owner, cutoff, revision };
      });
    },
    async publishDownload(owner, kind = kindOf(owner), archiveCutoff = null, isCurrent = () => true) {
      // Only a completed automatic target supplies this proof. Legacy calls,
      // selected history windows and latest-position snapshots cannot infer it.
      if (kind === 'auto' && archiveCutoff != null
        && (!Number.isSafeInteger(archiveCutoff) || archiveCutoff < 0)) throw new Error(t('c588'));
      await initialize();
      const publication = await withConnectionLock(connection, async () => {
        if (!isCurrent()) throw new Error(t('c576'));
        if (!await job(owner, kind)) return { dataRevision: await readHistoryMaterial(connection), materialChanged: false };
        const telemetry = tableName(kind, 'supabase_dog_status');
        const fields = names('supabase_dog_status');
        const list = fields.join(',');
        const inserted = fields.map(name => name === 'publication_version' ? 'publication_version+1' : name).join(',');
        const count = Number(rows(await connection.executeAsync(`SELECT COUNT(*) n FROM ${telemetry} WHERE owner_user_id=?`, [owner]))[0].n);
        // Chunks by id, every CHUNK_ROWS-th staged id read before the
        // transaction (nothing else stages while this holds the connection lock).
        const chunks = [];
        for (let after = 0; count > 0;) {
          const edge = rows(await connection.executeAsync(`SELECT id FROM ${telemetry} WHERE +owner_user_id=? AND id>?
            ORDER BY id LIMIT 1 OFFSET ${CHUNK_ROWS - 1}`, [owner, after]))[0];
          if (!edge) { chunks.push({ query: `SELECT id FROM ${telemetry} WHERE +owner_user_id=? AND id>?`, params: [owner, after] }); break; }
          const through = Number(edge.id);
          chunks.push({ query: `SELECT id FROM ${telemetry} WHERE +owner_user_id=? AND id>? AND id<=?`, params: [owner, after, through] });
          after = through;
        }
        const commands = [];
        // COW repairs apply only if the published metadata still matches the
        // captured base. A later completed manual job must win over stale auto.
        const baseMatches = baseFields.map(name => `d.base_${name} IS supabase_dog_status.${name}`).join(' AND ');
        const match = `d.owner_user_id=supabase_dog_status.owner_user_id AND d.event_id=supabase_dog_status.event_id AND d.had_base=1 AND ${baseMatches}`;
        // Apply the same COW identity check as the metadata write. An old
        // repair that lost its base cannot invalidate newer completed proof.
        const oldTime = 'CAST(COALESCE(p.track_at,p.received_at) AS INTEGER)';
        const newTime = 'CAST(COALESCE(d.track_at,d.received_at) AS INTEGER)';
        commands.push({ query: `UPDATE history_download_state SET complete=0 WHERE complete=1 AND EXISTS (
          SELECT 1 FROM ${telemetry} d JOIN supabase_dog_status p ON d.owner_user_id=p.owner_user_id AND d.event_id=p.event_id
          WHERE d.owner_user_id=? AND d.had_base=1 AND ${baseFields.map(name => `d.base_${name} IS p.${name}`).join(' AND ')}
          AND ${oldTime}<>${newTime} AND p.owner_user_id=history_download_state.owner AND p.slave_id=history_download_state.slave_id
          AND (${coverageContainsTime(oldTime, 'history_download_state')} OR ${coverageContainsTime(newTime, 'history_download_state')}))`, params: [owner] });
        // Move bounded chunks inside one transaction: readers see all of it or
        // none. The staged copies stay until it commits (clearStagedTelemetry):
        // deleting them in here cost about a third of the transaction, and the
        // BLE and phone-route writers wait for all of it. The file keeps that
        // much more free space, which the next staging reuses.
        for (const chunk of chunks) {
          commands.push({ query: `INSERT OR IGNORE INTO supabase_dog_status (${list}) SELECT ${inserted} FROM ${telemetry} WHERE id IN (${chunk.query})`, params: chunk.params });
          commands.push({ query: `UPDATE supabase_dog_status SET ${metadata.map(name => `${name}=(SELECT d.${name} FROM ${telemetry} d WHERE ${match})`).join(',')},publication_version=publication_version+1
          WHERE id IN (SELECT p.id FROM ${telemetry} d JOIN supabase_dog_status p ON d.owner_user_id=p.owner_user_id AND d.event_id=p.event_id
            WHERE d.id IN (${chunk.query}) AND d.had_base=1 AND ${baseFields.map(name => `d.base_${name} IS p.${name}`).join(' AND ')})`, params: chunk.params });
        }
        for (const [table, ownerColumn] of tables.slice(1)) {
          const namesList = names(table).join(',');
          commands.push({ query: `INSERT OR REPLACE INTO ${table} (${namesList}) SELECT ${namesList} FROM ${tableName(kind, table)} WHERE ${ownerColumn}=?`, params: [owner] });
        }
        // Staged saveBucket trims only its delta; keep published buckets to the
        // same two days before this owner's newest verified hour.
        commands.push({ query: `DELETE FROM cloud_sync_buckets WHERE owner_user_id=?
          AND bucket_start<(SELECT MAX(bucket_start) FROM cloud_sync_buckets WHERE owner_user_id=?)-${BUCKET_RETENTION_MS}`, params: [owner, owner] });
        const eviction = reclaimHistory('supabase_dog_status', `(SELECT COUNT(*) FROM supabase_dog_status)-${cap}`, kind === 'manual');
        commands.push({ query: invalidateEvictedCoverage(eviction), params: [] });
        if (kind === 'manual') {
          // A completed manual scope may not lose its own rows to the cap and
          // still publish a complete marker. Roll back instead of showing part.
          commands.push({ query: `INSERT INTO cloud_stage_quota(used,budget)
            SELECT 1,0 WHERE EXISTS (SELECT 1 FROM cloud_manual_history_download_state d
              JOIN history_download_state p ON d.owner=p.owner AND d.slave_id=p.slave_id AND d.day=p.day
              WHERE d.owner=? AND d.complete=1 AND p.complete=0)`, params: [owner] });
        }
        commands.push({ query: eviction, params: [] });
        commands.push({ query: 'INSERT INTO cloud_stage_quota(used,budget) SELECT COUNT(*),? FROM supabase_dog_status', params: [cap] });
        commands.push({ query: 'DELETE FROM cloud_stage_quota', params: [] });
        for (const [table, ownerColumn] of tables.slice(1)) commands.push({ query: `DELETE FROM ${tableName(kind, table)} WHERE ${ownerColumn}=?`, params: [owner] });
        commands.push({ query: 'DELETE FROM cloud_download_jobs WHERE owner=? AND kind=?', params: [owner, kind] });
        if (kind === 'auto' && archiveCutoff != null) commands.push({
          query: `INSERT OR REPLACE INTO cloud_archive_publication(owner,cutoff,revision)
            VALUES(?,?,COALESCE((SELECT revision FROM cloud_archive_publication WHERE owner=?),0)+1)`,
          params: [owner, archiveCutoff, owner],
        });
        let material;
        try {
          // Generation may change while waiting for this connection or reads.
          // Once sent, the native transaction itself remains atomic.
          if (!isCurrent()) throw new Error(t('c576'));
          material = await executeHistoryMaterialBatch(connection, commands);
        } catch (error) {
          // Failed readback may follow a committed TX; never retain hold cursors.
          published.invalidatePublished();
          if (String(error.message).includes('used<=budget')) throw new Error(t("c622"));
          throw error;
        }
        if (!material || material.materialChanged) published.invalidatePublished();
        // Committed with its job row gone: clear the staged copies in
        // transactions of their own. A failure leaves them to beginDownload.
        await clearStagedTelemetry(kind, owner).catch(() => {});
        return material;
      });
      if (kind === 'manual') active.delete(owner);
      return publication;
    },
    async publishManualScope(owner, slave, day, isCurrent = () => true) {
      if ((await job(owner, 'manual'))?.scope !== `${slave}:${day}`) throw new Error(t("c576"));
      return result.publishDownload(owner, 'manual', null, isCurrent);
    },
    async loadSyncState(owner, master) {
      if (!await hasJob(owner)) return published.loadSyncState(owner, master);
      await initialize();
      return (await read(kindOf(owner), 'cloud_sync_state', '*', 'owner_user_id=? AND master_id=?', [owner, master]))[0] || null;
    },
    async loadBuckets(owner, master, since) {
      if (!await hasJob(owner)) return published.loadBuckets(owner, master, since);
      await initialize();
      return read(kindOf(owner), 'cloud_sync_buckets', 'bucket_start,cloud_count', 'owner_user_id=? AND master_id=? AND bucket_start>=?', [owner, master, since]);
    },
    async countRange(owner, master, start, end) {
      if (!await hasJob(owner)) return published.countRange(owner, master, start, end);
      await initialize();
      return Number((await read(kindOf(owner), 'supabase_dog_status', 'COUNT(*) count', 'owner_user_id=? AND master_id=? AND received_at>=? AND received_at<?', [owner, master, start, end]))[0].count);
    },
    async pendingTrackTimes(owner) {
      if (!await hasJob(owner)) return published.pendingTrackTimes(owner);
      await initialize();
      const delta = tableName(kindOf(owner), 'supabase_dog_status');
      // Either branch needs at most its newest 200 candidates to contribute
      // to the global newest 200. Filter published shadows before that limit:
      // a completed staged repair must not leave an old pending row visible.
      // Branch ordering lets the existing track-repair indexes seek directly
      // instead of sorting an account-wide overlay on every repair pass.
      return rows(await connection.executeAsync(`SELECT event_id FROM (
        SELECT event_id,received_at FROM (
          SELECT event_id,received_at FROM ${delta}
          WHERE owner_user_id=? AND track_time_version IS NULL AND event_id IS NOT NULL
          ORDER BY received_at DESC LIMIT 200)
        UNION ALL
        SELECT event_id,received_at FROM (
          SELECT p.event_id,p.received_at FROM supabase_dog_status p
          WHERE p.owner_user_id=? AND p.track_time_version IS NULL AND p.event_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${delta} d
            WHERE d.owner_user_id=p.owner_user_id AND d.event_id=p.event_id)
          ORDER BY p.received_at DESC LIMIT 200)
        ) ORDER BY received_at DESC LIMIT 200`, [owner, owner]));
    },
    async repairTrackTimes(owner, changes, requested) {
      if (!await hasJob(owner)) return published.repairTrackTimes(owner, changes, requested);
      await initialize();
      const kind = kindOf(owner), table = tableName(kind, 'supabase_dog_status');
      const copyNames = names('supabase_dog_status');
      const copies = requested.map(id => ({
        publishedCopy: true,
        query: `INSERT OR IGNORE INTO ${table} (${copyNames.join(',')},had_base,${baseFields.map(name => `base_${name}`).join(',')})
          SELECT ${copyNames.join(',')},1,${baseFields.join(',')} FROM supabase_dog_status WHERE owner_user_id=? AND event_id=?`, params: [owner, id],
      }));
      return cores[kind].repairTrackTimes(owner, changes, requested, copies);
    },
  };
  for (const method of ['savePage', 'saveBucket', 'setHistoryDownloadState']) result[method] = async (owner, ...args) => {
    // Incomplete is a durable status, never evidence that partial rows are readable.
    if (method === 'setHistoryDownloadState' && args[2] === false) return published[method](owner, ...args);
    if (!await hasJob(owner)) return published[method](owner, ...args);
    await initialize();
    return cores[kindOf(owner)][method](owner, ...args);
  };
  delete result.invalidatePublished;
  return result;
}

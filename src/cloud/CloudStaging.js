import { t } from '../i18n';
import { withConnectionLock } from '../database/connectionLock';

const tables = [
  ['supabase_dog_status', 'owner_user_id', ['owner_user_id', 'event_id']],
  ['cloud_sync_state', 'owner_user_id', ['owner_user_id', 'master_id']],
  ['cloud_sync_buckets', 'owner_user_id', ['owner_user_id', 'master_id', 'bucket_start']],
  ['history_download_state', 'owner', ['owner', 'slave_id', 'day']],
];
const kinds = ['auto', 'manual'];
const initialization = new WeakMap();
const metadata = ['track_at', 'upload_source', 'phone_received_at', 'track_time_version'];
const baseFields = [...metadata, 'publication_version'];
const rows = result => result.results || result.rows?._array || [];
const tableName = (kind, table) => `cloud_${kind}_${table}`;
const rewrite = (kind, sql) => tables.reduce((query, [table]) =>
  query.replace(new RegExp(`\\b${table}\\b`, 'g'), tableName(kind, table)), sql);

// Reclaim only oldest history. The newest packet and newest usable fix of
// every owner/dog remain available even when another dog fills the cache.
function reclaimHistory(table, excess, staged) {
  const time = alias => `CAST(COALESCE(${alias}.track_at,${alias}.received_at) AS INTEGER)`;
  const fix = alias => `${alias}.slave_lat IS NOT NULL AND ${alias}.slave_lon IS NOT NULL AND NOT (${alias}.slave_lat=0 AND ${alias}.slave_lon=0)`;
  const newer = fixed => `EXISTS (SELECT 1 FROM ${table} n WHERE n.owner_user_id IS old.owner_user_id
    AND n.slave_id IS old.slave_id ${fixed ? `AND ${fix('n')}` : ''}
    AND (${time('n')}>${time('old')} OR (${time('n')}=${time('old')} AND n.id>old.id)))`;
  return `DELETE FROM ${table} WHERE id IN (SELECT old.id FROM ${table} old
    WHERE ${staged ? 'COALESCE(old.had_base,0)<>1 AND' : ''} ${newer(false)}
    AND (NOT (${fix('old')}) OR ${newer(true)})
    ORDER BY old.received_at,old.id LIMIT MAX(0,${excess}))`;
}

// UI readers retain their published-table contract. Each network job stores
// only new events, metadata repairs and resumable progress in its own delta.
export function createStagedCloudDatabase(connection, options, createCore) {
  const published = createCore(connection, options);
  const cap = options.maxRows;
  // A bounded workspace, not a second complete cache. Published history keeps
  // its existing budget; a failed/cancelled job cannot reclaim published rows.
  const reserveRows = Math.max(1, Math.floor(cap / 8));
  const active = new Map();
  const initializationKey = connection.lockKey || connection;
  if (!initialization.has(initializationKey)) initialization.set(initializationKey, { ready: null, columns: null });
  const state = initialization.get(initializationKey);
  const cores = Object.fromEntries(kinds.map(kind => [kind, createCore({
    lockKey: connection.lockKey || connection,
    executeAsync: (query, params) => connection.executeAsync(rewrite(kind, query), params),
    executeBatchAsync: async commands => {
      // Retain the newest staged history within unused cache space plus the reserve.
      const writes = commands.filter(command => !/^DELETE FROM supabase_dog_status WHERE id IN/.test(command.query));
      const stageUsed = kinds.map(value => `(SELECT COUNT(*) FROM ${tableName(value, 'supabase_dog_status')})`).join('+');
      const used = `(SELECT COUNT(*) FROM supabase_dog_status)+${stageUsed}`;
      const reclaim = [kind, ...kinds.filter(value => value !== kind)].map(value => ({
        query: reclaimHistory(tableName(value, 'supabase_dog_status'), `(${used})-${cap + reserveRows}`, true), params: [],
      }));
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
          { query: `INSERT INTO cloud_stage_quota(used,budget) SELECT ${used},?`, params: [cap + reserveRows] },
          { query: 'DELETE FROM cloud_stage_quota', params: [] },
        ]);
      } catch (error) {
        if (String(error.message).includes('used<=budget')) throw new Error(t("c622"));
        throw error;
      }
    },
  }, options)]));
  const initialize = () => {
    if (state.ready) return state.ready;
    state.ready = published.initialize().then(() => withConnectionLock(connection, async () => {
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS history_download_state (owner TEXT, slave_id INTEGER, day TEXT, complete INTEGER NOT NULL, PRIMARY KEY(owner,slave_id,day))');
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS cloud_download_jobs (owner TEXT, kind TEXT, scope TEXT, PRIMARY KEY(owner,kind))');
      await connection.executeAsync('CREATE TABLE IF NOT EXISTS cloud_stage_quota (used INTEGER,budget INTEGER,CHECK(used<=budget))');
      state.columns = Object.fromEntries(await Promise.all(tables.map(async ([table]) => [table,
        rows(await connection.executeAsync(`PRAGMA table_info(${table})`)).map(column => column.name)])));
      for (const kind of kinds) for (const [table] of tables) {
        const definitions = rows(await connection.executeAsync(
          "SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? AND sql IS NOT NULL", [table]));
        for (const definition of definitions) {
          let sql = rewrite(kind, definition.sql);
          if (definition.type === 'table') sql = sql.replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ');
          else if (definition.type === 'index') sql = sql.replace(/^(CREATE (?:UNIQUE )?INDEX)(?: IF NOT EXISTS)? \S+/i,
            `$1 IF NOT EXISTS cloud_${kind}_${definition.name}`);
          else continue;
          await connection.executeAsync(sql);
        }
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
  const result = { ...published, initialize,
    async beginDownload(owner, kind = 'auto', scope = null) {
      if (!owner || !kinds.includes(kind)) throw new Error(t("c572"));
      await initialize();
      await withConnectionLock(connection, async () => {
        // Auto resumes its own prior cursor. A new manual request replaces only
        // an unfinished manual scope; it cannot erase another job's pages.
        if (kind === 'manual') {
          await connection.executeBatchAsync([
            ...tables.map(([table, ownerColumn]) => ({ query: `DELETE FROM ${tableName(kind, table)} WHERE ${ownerColumn}=?`, params: [owner] })),
            { query: 'DELETE FROM cloud_download_jobs WHERE owner=? AND kind=?', params: [owner, kind] },
          ]);
        }
        await connection.executeAsync('INSERT OR IGNORE INTO cloud_download_jobs(owner,kind,scope) VALUES(?,?,?)', [owner, kind, scope]);
      });
      active.set(owner, kind);
    },
    async beginManualScope(owner, slave, day) {
      await result.beginDownload(owner, 'manual', `${slave}:${day}`);
    },
    async publishDownload(owner, kind = kindOf(owner)) {
      await initialize();
      await withConnectionLock(connection, async () => {
        if (!await job(owner, kind)) return;
        const telemetry = tableName(kind, 'supabase_dog_status');
        const fields = names('supabase_dog_status');
        const list = fields.join(',');
        const inserted = fields.map(name => name === 'publication_version' ? 'publication_version+1' : name).join(',');
        const count = Number(rows(await connection.executeAsync(`SELECT COUNT(*) n FROM ${telemetry} WHERE owner_user_id=?`, [owner]))[0].n);
        const chunk = `SELECT id FROM ${telemetry} WHERE owner_user_id=? ORDER BY id LIMIT 1000`;
        const commands = [];
        // COW repairs apply only if the published metadata still matches the
        // captured base. A later completed manual job must win over stale auto.
        const baseMatches = baseFields.map(name => `d.base_${name} IS supabase_dog_status.${name}`).join(' AND ');
        const match = `d.owner_user_id=supabase_dog_status.owner_user_id AND d.event_id=supabase_dog_status.event_id AND d.had_base=1 AND ${baseMatches}`;
        // Move bounded chunks inside one transaction. Clear each delta chunk
        // before the next insert, rather than duplicate a whole first download.
        for (let start = 0; start < count; start += 1000) {
          commands.push({ query: `INSERT OR IGNORE INTO supabase_dog_status (${list}) SELECT ${inserted} FROM ${telemetry} WHERE id IN (${chunk})`, params: [owner] });
          commands.push({ query: `UPDATE supabase_dog_status SET ${metadata.map(name => `${name}=(SELECT d.${name} FROM ${telemetry} d WHERE ${match})`).join(',')},publication_version=publication_version+1
          WHERE id IN (SELECT p.id FROM ${telemetry} d JOIN supabase_dog_status p ON d.owner_user_id=p.owner_user_id AND d.event_id=p.event_id
            WHERE d.id IN (${chunk}) AND d.had_base=1 AND ${baseFields.map(name => `d.base_${name} IS p.${name}`).join(' AND ')})`, params: [owner] });
          commands.push({ query: `DELETE FROM ${telemetry} WHERE id IN (${chunk})`, params: [owner] });
        }
        for (const [table, ownerColumn] of tables.slice(1)) {
          const namesList = names(table).join(',');
          commands.push({ query: `INSERT OR REPLACE INTO ${table} (${namesList}) SELECT ${namesList} FROM ${tableName(kind, table)} WHERE ${ownerColumn}=?`, params: [owner] });
        }
        commands.push({ query: reclaimHistory('supabase_dog_status', `(SELECT COUNT(*) FROM supabase_dog_status)-${cap}`, false), params: [] });
        commands.push({ query: 'INSERT INTO cloud_stage_quota(used,budget) SELECT COUNT(*),? FROM supabase_dog_status', params: [cap] });
        commands.push({ query: 'DELETE FROM cloud_stage_quota', params: [] });
        for (const [table, ownerColumn] of tables) commands.push({ query: `DELETE FROM ${tableName(kind, table)} WHERE ${ownerColumn}=?`, params: [owner] });
        commands.push({ query: 'DELETE FROM cloud_download_jobs WHERE owner=? AND kind=?', params: [owner, kind] });
        try {
          await connection.executeBatchAsync(commands);
        } catch (error) {
          if (String(error.message).includes('used<=budget')) throw new Error(t("c622"));
          throw error;
        }
        published.invalidatePublished();
      });
      if (kind === 'manual') active.delete(owner);
    },
    async publishManualScope(owner, slave, day) {
      if ((await job(owner, 'manual'))?.scope !== `${slave}:${day}`) throw new Error(t("c576"));
      await result.publishDownload(owner, 'manual');
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
      return read(kindOf(owner), 'supabase_dog_status', 'event_id', 'owner_user_id=? AND track_time_version IS NULL AND event_id IS NOT NULL ORDER BY received_at DESC LIMIT 200', [owner]);
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

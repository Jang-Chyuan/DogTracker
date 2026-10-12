import { withConnectionLock } from '../database/connectionLock';
import { t } from '../i18n';

// Shared across JS wrappers of this actual native latest file. A fresh runtime
// reads the durable pending marker, so a crash between the two file commits
// cannot re-bootstrap deleted dogs from an archive that was not cleared yet.
const lifecycles = new WeakMap();
export function createLatestSnapshotLifecycle(connection, snapshot) {
  const key = connection.lockKey || connection;
  let state = lifecycles.get(key);
  if (!state) { state = { epoch: 0, blocked: false, ready: null }; lifecycles.set(key, state); }
  const ready = () => {
    if (state.ready) return state.ready;
    const task = snapshot.initializeLatest().then(() => withConnectionLock(connection, async () => {
      await connection.executeAsync(`CREATE TABLE IF NOT EXISTS cloud_latest_lifecycle (
        id INTEGER PRIMARY KEY CHECK(id=1), epoch INTEGER NOT NULL, deletion_pending INTEGER NOT NULL)`);
      await connection.executeAsync('INSERT OR IGNORE INTO cloud_latest_lifecycle(id,epoch,deletion_pending) VALUES(1,0,0)');
      const result = await connection.executeAsync('SELECT epoch,deletion_pending FROM cloud_latest_lifecycle WHERE id=1');
      const stored = (result.results || result.rows?._array || [])[0];
      if (!stored || !Number.isSafeInteger(stored.epoch) || stored.epoch < 0 || ![0, 1].includes(stored.deletion_pending))
        throw new Error('Latest snapshot lifecycle is invalid');
      state.epoch = Math.max(state.epoch, stored.epoch); state.blocked = state.blocked || stored.deletion_pending === 1;
    }));
    state.ready = task; task.catch(() => { if (state.ready === task) state.ready = null; });
    return task;
  };
  const check = epoch => {
    if (state.blocked || epoch !== state.epoch) throw new Error(t('c1275'));
  };
  return {
    ...snapshot,
    initializeLatest: ready,
    async publishLatestSnapshot(owner, value, isCurrent = () => true) {
      await ready(); const epoch = state.epoch; check(epoch);
      const revision = await snapshot.publishLatestSnapshot(owner, value, () => !state.blocked && state.epoch === epoch && isCurrent());
      check(epoch); return revision;
    },
    async readLatestSnapshot(owner, options = {}) {
      await ready(); const epoch = state.epoch; check(epoch);
      const result = await snapshot.readLatestSnapshot(owner, { ...options,
        isCurrent: () => !state.blocked && state.epoch === epoch && (!options.isCurrent || options.isCurrent()) });
      check(epoch); return result;
    },
    async clearLatestAndRun(work) {
      // Synchronous epoch change fences in-flight HTTP/readback/bootstrap. A
      // native transaction already started still drains before this clear.
      state.blocked = true;
      await ready(); const epoch = ++state.epoch;
      await withConnectionLock(connection, () => connection.executeBatchAsync([
        { query: 'DELETE FROM cloud_latest_snapshot', params: [] },
        { query: 'DELETE FROM cloud_snapshot_state', params: [] },
        { query: 'UPDATE cloud_latest_lifecycle SET epoch=?,deletion_pending=1 WHERE id=1', params: [epoch] },
      ]));
      // Do not hold latest's lock while waiting for the old archive worker.
      await work();
      await withConnectionLock(connection, async () => {
        if (state.epoch !== epoch) throw new Error('Dog data deletion was superseded');
        await connection.executeAsync('UPDATE cloud_latest_lifecycle SET deletion_pending=0 WHERE id=1 AND epoch=?', [epoch]);
        state.blocked = false;
      });
    },
  };
}

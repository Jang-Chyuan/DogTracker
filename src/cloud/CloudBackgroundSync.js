import { AppState, NativeModules } from 'react-native';
import { getCloudClient } from './CloudClient';
import { openTrackingDatabase } from '../database/TrackingDatabaseConnection';
import { createDogDatabase } from '../database/DogDatabase';
import { createCloudDatabase } from './CloudDatabase';
import { downloadMasterIncremental, listCloudMasters } from './CloudIncremental';
import { registerBackgroundSync, withCloudSyncSlot } from './CloudSyncSlot';
import { createUploadDatabase } from '../cloudUpload/UploadDatabase';
import { createUploadService } from '../cloudUpload/UploadService';

function backgroundDatabase() {
  const connection = openTrackingDatabase();
  const database = createCloudDatabase(connection);
  return {
    ...database,
    uploadDatabase: createUploadDatabase(connection),
    initialize: async () => {
      await createDogDatabase(connection).initialize();
      await database.initialize();
    },
    close: () => connection.close(),
  };
}

// WorkManager owns network availability, retry/backoff and the wake-up. This
// task finishes after one bounded pass; it never leaves a 15-minute JS timer.
export async function runBackgroundCloudSync({ runId, owner }, {
  native = NativeModules.CloudBackgroundSync, appState = AppState,
  clientFactory = getCloudClient, databaseFactory = backgroundDatabase,
  now = Date.now, budgetMs = 90000,
} = {}) {
  if (!native) return;
  const abort = new AbortController();
  const unregister = registerBackgroundSync(abort);
  let outcome = 'retry', database, client, authSubscription;
  let timedOut = false;
  const deadline = now() + budgetMs;
  const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, budgetMs);
  const appSubscription = appState.addEventListener('change', state => {
    if (state === 'active') abort.abort();
  });
  const check = async () => {
    if (now() >= deadline) { timedOut = true; abort.abort(); }
    if (appState.currentState === 'active') abort.abort();
    if (abort.signal.aborted) {
      throw new Error('Background sync cancelled');
    }
    if (!await native.isCurrent(runId)) { abort.abort(); throw new Error('Worker stopped'); }
    if (abort.signal.aborted) throw new Error('Background sync cancelled');
  };
  // Constraint changes/onStopped may occur without an AppState event.
  const poll = setInterval(() => { check().catch(() => abort.abort()); }, 2000);
  try {
    await withCloudSyncSlot(async () => {
      await check();
      client = clientFactory();
      client.auth.stopAutoRefresh();
      authSubscription = client.auth.onAuthStateChange((_event, session) => {
        if (session?.user?.id !== owner) {
          native.cancelAccount(runId).catch(() => {});
          abort.abort();
        }
      }).data.subscription;
      // Auth restores/refreshes from secure storage; do not put a JWT in job data.
      const sessionResult = client.auth.getSession();
      let cancelSession;
      const cancelled = new Promise((_, reject) => {
        cancelSession = () => reject(new Error('Session restore cancelled'));
        abort.signal.addEventListener('abort', cancelSession, { once: true });
        if (abort.signal.aborted) cancelSession();
      });
      let result;
      try { result = await Promise.race([sessionResult, cancelled]); }
      finally { abort.signal.removeEventListener('abort', cancelSession); }
      await check();
      if (result.error) throw result.error;
      if (result.data.session?.user?.id !== owner) {
        await native.cancelAccount(runId);
        outcome = 'cancelled'; return;
      }
      database = databaseFactory();
      await database.initialize();
      await check();
      // Share the network-constrained job with BLE relay, leaving time for history.
      // Never publish an owner here: logout/native receiver binding owns that state.
      let uploadRetry = false;
      const upload = createUploadService({ database: database.uploadDatabase, client });
      const uploadAbort = new AbortController();
      const cancelUpload = () => uploadAbort.abort();
      abort.signal.addEventListener('abort', cancelUpload, { once: true });
      const uploadTimeout = setTimeout(cancelUpload, Math.min(30000, Math.max(0, deadline - now())));
      try {
        while (!uploadAbort.signal.aborted) {
          await check();
          const uploadResult = await upload.run(owner, () => !abort.signal.aborted && !uploadAbort.signal.aborted,
            { signal: uploadAbort.signal });
          if (uploadResult === 'retry') { uploadRetry = true; break; }
          if (uploadResult !== 'success') break;
        }
        if (uploadAbort.signal.aborted) uploadRetry = true;
      } finally {
        clearTimeout(uploadTimeout);
        abort.signal.removeEventListener('abort', cancelUpload);
      }
      await check();
      const masters = await listCloudMasters(client, owner, abort.signal, check);
      const cutoff = now();
      for (const masterId of masters) {
        await downloadMasterIncremental({ client, database, owner, masterId, cutoff,
          signal: abort.signal, check, maxPages: 4 });
      }
      await check();
      outcome = uploadRetry ? 'retry' : 'success';
    });
  } catch {
    // Cancellation due to UI/logout is complete; transient failures and time
    // limits retry with WorkManager backoff, keeping every committed page.
    outcome = abort.signal.aborted && !timedOut ? 'cancelled' : 'retry';
  } finally {
    clearTimeout(timeout);
    clearInterval(poll);
    authSubscription?.unsubscribe();
    appSubscription.remove();
    unregister();
    database?.close();
    if (client && appState.currentState !== 'active') client.auth.stopAutoRefresh();
    await native.complete(runId, outcome);
  }
}

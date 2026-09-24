import { NativeModules } from 'react-native';
import { getCloudClient } from '../cloud/CloudClient';
import { openTrackingDatabase } from '../database/TrackingDatabaseConnection';
import { createUploadDatabase } from './UploadDatabase';
import { createUploadService } from './UploadService';

export async function runSearchRelay({ owner, runId }, {
  native = NativeModules.CloudBackgroundSync, clientFactory = getCloudClient,
  connectionFactory = openTrackingDatabase,
} = {}) {
  const abort = new AbortController();
  let connection, subscription;
  const timer = setTimeout(() => abort.abort(), 25000);
  const current = async () => {
    if (!await native.isSearchCurrent(runId, owner)) abort.abort();
  };
  const poll = setInterval(() => { current().catch(() => abort.abort()); }, 1000);
  try {
    await current();
    if (abort.signal.aborted) return;
    const client = clientFactory();
    subscription = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id !== owner) abort.abort();
    }).data.subscription;
    connection = connectionFactory();
    const database = createUploadDatabase(connection);
    await createUploadService({ database, client }).run(owner, () => !abort.signal.aborted,
      { signal: abort.signal });
  } catch {
    // Keep the persistent queue intact; the next native tick can retry.
    console.warn('[Search relay] pass interrupted; pending data retained');
  } finally {
    clearTimeout(timer); clearInterval(poll);
    abort.abort(); subscription?.unsubscribe(); connection?.close();
    await native.completeSearch(runId);
  }
}

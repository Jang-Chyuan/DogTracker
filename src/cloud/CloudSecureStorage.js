import { t } from '../i18n';
import * as Keychain from 'react-native-keychain';
import { beginCloudStorageDiagnostic } from '../diagnostics/CloudAttemptDiagnostics';

// Supabase stores serialized sessions, never the user's login password.
// Each Supabase storage key has its own Keychain/Keystore service namespace.
export function createCloudSecureStorage(vault = Keychain) {
  const options = key => ({ service: `com.dogtracker.supabase.${key}` });
  // One adapter is shared by the foreground and Headless client. Keep only
  // values already read from, or successfully written to, this secure vault.
  // A new process/adapter still restores from Keychain; SDK expiry/refresh and
  // sign-out continue to use the same storage API.
  const entries = new Map();
  const entryFor = key => {
    if (!entries.has(key)) entries.set(key, { epoch: 0, cached: false, value: null, read: null, write: null });
    return entries.get(key);
  };
  function getItem(key) {
    const entry = entryFor(key);
    // Never return a previous session while its durable replacement/removal
    // is pending. Failed writes re-read the actual vault, not their candidate.
    if (entry.write) return entry.write.then(() => getItem(key), () => getItem(key));
    if (entry.cached) return Promise.resolve(entry.value);
    if (entry.read) return entry.read;
    const epoch = entry.epoch;
    const read = (async () => {
      const done = beginCloudStorageDiagnostic('get');
      try {
        const credential = await vault.getGenericPassword(options(key));
        // A slow native read started before logout/account replacement must
        // neither resurrect the cache nor return that old session to callers.
        if (entry.epoch !== epoch) return getItem(key);
        entry.value = credential ? credential.password : null;
        entry.cached = true;
        return entry.value;
      } finally { done?.(); }
    })().finally(() => { if (entry.read === read) entry.read = null; });
    entry.read = read;
    return read;
  }
  function mutate(key, value, operation, apply) {
    const entry = entryFor(key), epoch = ++entry.epoch;
    entry.cached = false; entry.value = null; entry.read = null;
    // Preserve invocation order for the real vault as well as the cache.
    // A failed mutation must not prevent a later logout or replacement.
    const previous = entry.write || Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      const done = beginCloudStorageDiagnostic(operation);
      try {
        const changed = await apply();
        if (changed !== false && entry.epoch === epoch) { entry.value = value; entry.cached = true; }
      } finally { done?.(); }
    }).finally(() => { if (entry.write === write) entry.write = null; });
    entry.write = write;
    return write;
  }
  return {
    getItem,
    setItem(key, value) {
      return mutate(key, value, 'set', async () => {
        const saved = await vault.setGenericPassword('session', value, {
          ...options(key), accessible: vault.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        if (!saved) throw new Error(t("c584"));
      });
    },
    removeItem(key) {
      // Keep the original remove contract, but an unconfirmed reset cannot
      // make the memory cache claim that the durable session was removed.
      return mutate(key, null, 'remove', async () => await vault.resetGenericPassword(options(key)) === true);
    },
  };
}

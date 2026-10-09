import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import { openTrackingDatabase } from '../database/TrackingDatabaseConnection';
import { getCloudClient } from '../cloud/CloudClient';
import { createUploadDatabase } from './UploadDatabase';
import { createUploadService } from './UploadService';

/** A route switch that could not send what was waiting first (S3). */
export class UploadSwitchError extends Error {
  constructor(reason, remaining) {
    super(reason === 'offline' ? t('c256', { count: remaining })
      : reason === 'unauthorized' ? t('c276') : t("c610"));
    this.reason = reason;
    this.remaining = remaining;
  }
}

// `onAuthFailure`: an upload was refused for the sign-in (401); AuthProvider
// decides whether it really ended (判定表「使用中登入失效」).
export function useCloudUpload(ready, owner, foreground, onAuthFailure = null) {
  const db = useRef(null), service = useRef(null);
  const authFailure = useRef(onAuthFailure);
  authFailure.current = onAuthFailure;
  // The account now: a switch started for another one stops (S3).
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ settings: [], settingsOwner: null, masters: [], counts: [],
    pendingByMaster: {}, phoneId: '', error: '' });
  const supported = Platform.OS === 'android' && !!NativeModules.BleBackground?.executeDatabase;
  useEffect(() => {
    if (!ready || !supported) return undefined;
    const connection = openTrackingDatabase();
    db.current = createUploadDatabase(connection);
    try { service.current = createUploadService({ database: db.current, client: getCloudClient() }); }
    catch (error) { setState(s => ({ ...s, error: error.message })); }
    return () => { db.current = null; service.current = null; };
  }, [ready, supported]);
  useEffect(() => {
    if (!db.current) return undefined;
    let alive = true, timer;
    const database = db.current;
    // This update also controls native enqueue while the JS screen is suspended.
    setState(s => s.settingsOwner === owner ? s
      : { ...s, settings: [], settingsOwner: null, counts: [], pendingByMaster: {}, last: null, error: '' });
    const binding = database.owner(owner);
    async function tick() {
      try {
        await binding;
        if (!alive) return;
        const phoneId = await database.identity();
        if (!owner) { if (alive) setState(s => ({ ...s, phoneId })); return; }
        // Show durable routes before a slow upload, including offline resumes.
        const savedSettings = await database.settings(owner);
        if (!alive) return;
        setState(s => ({ ...s, phoneId, settings: savedSettings, settingsOwner: owner }));
        let searchError = '';
        if (foreground) {
          try {
            await NativeModules.CloudBackgroundSync?.configureSearch?.(
              owner, savedSettings.some(s => s.mode === 'phone'));
          } catch (error) { searchError = t("c612", { message: error.message }); }
        }
        if (foreground) {
          const outcome = await service.current?.run(owner, () => alive);
          if (outcome === 'unauthorized' && alive) authFailure.current?.();
        }
        const [settings, summary] = await Promise.all([database.settings(owner), database.summary(owner)]);
        if (alive) setState(s => ({ ...s, phoneId, settings, settingsOwner: owner, ...summary,
          error: searchError || summary.error || '' }));
      } catch (error) { if (alive) setState(s => ({ ...s, error: error.message })); }
      finally { if (alive && foreground) timer = setTimeout(tick, 10000); }
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [ready, supported, owner, foreground, revision]);
  useEffect(() => {
    setState(s => ({ ...s, masters: [] }));
    if (!ready || !owner || !foreground || !supported) return undefined;
    let alive = true;
    (async () => {
      try {
        const { data, error } = await getCloudClient().from('device_members').select('gateway_id').eq('user_id', owner);
        if (error) throw error;
        const masters = [...new Set((data || []).map(m => /^master_(\d+)$/.exec(m.gateway_id)?.[1]).filter(Boolean).map(Number))];
        if (alive) setState(s => ({ ...s, masters }));
      } catch (error) { if (alive) setState(s => ({ ...s, error: t("c611", { message: error.message }) })); }
    })();
    return () => { alive = false; };
  }, [ready, owner, foreground, supported]);
  const settingsReady = !!owner && state.settingsOwner === owner;
  async function setMode(master, mode) {
    await db.current.setMode(owner, master, mode);
    refresh(n => n + 1);
    if (foreground) await NativeModules.CloudBackgroundSync?.configureSearch?.(
      owner, (await db.current.settings(owner)).some(s => s.mode === 'phone'));
  }
  return { ...state, settings: settingsReady ? state.settings : [],
    pendingByMaster: settingsReady ? state.pendingByMaster || {} : {}, settingsReady, owner, supported,
    setMode,
    /**
     * S3 切換上傳方式: what this phone still holds for that receiver is sent
     * first (it needs the network), then the route changes. Nothing is
     * deleted. Throws UploadSwitchError when rows are left.
     */
    async switchMode(master, mode, signal = null) {
      if (!db.current || !service.current) throw new UploadSwitchError('failed', 0);
      const ownerAtStart = owner;
      const same = () => currentOwner.current === ownerAtStart && !signal?.aborted;
      const send = async () => {
        const { result, remaining } = await service.current.flush(ownerAtStart, master, same);
        refresh(n => n + 1);
        if (result === 'unauthorized') authFailure.current?.();
        return { result, remaining };
      };
      if (await db.current.pendingCount(ownerAtStart, master) > 0) {
        const { result, remaining } = await send();
        if (result !== 'done' || remaining > 0) {
          throw new UploadSwitchError(result === 'done' ? 'failed' : result, remaining);
        }
      }
      if (!same()) throw new UploadSwitchError('cancelled', 0);
      await setMode(master, mode);
      // Rows the receiver service queued between the last send and the route
      // change: send them now (the route no longer queues more). Whatever
      // cannot go now stays queued and the normal pass sends it later.
      if (same() && await db.current.pendingCount(ownerAtStart, master) > 0) await send().catch(() => {});
    },
    async retry() { await db.current.retry(owner); refresh(n => n + 1); },
    /**
     * 刪除全部狗資料 →「先上傳」(S7): every row this account still has
     * waiting is sent now, the refused ones tried again too, whatever the
     * receiver or retry time. → 'done' | 'offline' | 'unauthorized' |
     * 'cancelled' | 'signed-out' | 'failed'. Deletes nothing. `alive()` false
     * stops it before the next row.
     */
    async flushAll(alive = () => true) {
      if (!owner) return 'signed-out';
      if (!db.current || !service.current) return 'failed';
      const ownerAtStart = owner;
      // Stops at the next row when the account changes or the caller is gone.
      const same = () => currentOwner.current === ownerAtStart && alive();
      try {
        await db.current.retry(ownerAtStart);
        for (const master of await db.current.pendingMasters(ownerAtStart)) {
          const { result } = await service.current.flush(ownerAtStart, master, same);
          if (result === 'unauthorized') authFailure.current?.();
          if (result !== 'done') return result;
        }
        return 'done';
      } catch {
        return 'failed';
      } finally {
        refresh(n => n + 1);
      }
    },
  };
}

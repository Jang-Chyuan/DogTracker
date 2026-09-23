import { useEffect, useRef, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import { openTrackingDatabase } from '../database/TrackingDatabaseConnection';
import { getCloudClient } from '../cloud/CloudClient';
import { createUploadDatabase } from './UploadDatabase';
import { createUploadService } from './UploadService';

export function useCloudUpload(ready, owner, foreground) {
  const db = useRef(null), service = useRef(null);
  const [revision, refresh] = useState(0);
  const [state, setState] = useState({ settings: [], settingsOwner: null, masters: [], counts: [], phoneId: '', error: '' });
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
      : { ...s, settings: [], settingsOwner: null, counts: [], last: null, error: '' });
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
        if (foreground) await service.current?.run(owner, () => alive);
        const [settings, summary] = await Promise.all([database.settings(owner), database.summary(owner)]);
        if (alive) setState(s => ({ ...s, phoneId, settings, settingsOwner: owner, ...summary }));
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
      } catch (error) { if (alive) setState(s => ({ ...s, error: `無法取得 Master 授權：${error.message}` })); }
    })();
    return () => { alive = false; };
  }, [ready, owner, foreground, supported]);
  const settingsReady = !!owner && state.settingsOwner === owner;
  return { ...state, settings: settingsReady ? state.settings : [], settingsReady, owner, supported,
    async setMode(master, mode) {
      await db.current.setMode(owner, master, mode); refresh(n => n + 1);
    },
    async retry() { await db.current.retry(owner); refresh(n => n + 1); },
  };
}

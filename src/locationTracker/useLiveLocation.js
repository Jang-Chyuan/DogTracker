import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { locationTrackerNative } from './LocationTrackerService';

// One lightweight snapshot per second; SQLite is never polled at display rate.
// 067: a single failed read keeps the last snapshot (the 「今天 x km」 icon
// turned grey as if recording had stopped); only when there has never been a
// snapshot is it 「無法讀取即時定位狀態」.
export function useLiveLocation(active) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!active || !locationTrackerNative?.live) return undefined;
    let alive = true, timer;
    async function poll() {
      try {
        const value = JSON.parse(await locationTrackerNative.live());
        if (alive) setState(value);
      } catch {
        if (alive) setState(value => value ?? { running: false, status: t("c718") });
      } finally { if (alive) timer = setTimeout(poll, 1000); }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [active]);
  return active ? state : null;
}

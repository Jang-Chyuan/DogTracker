import { useEffect, useState } from 'react';
import { locationTrackerNative } from './LocationTrackerService';

// One lightweight snapshot per second; SQLite is never polled at display rate.
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
        if (alive) setState({ running: false, status: '無法讀取即時定位狀態' });
      } finally { if (alive) timer = setTimeout(poll, 1000); }
    }
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [active]);
  return active ? state : null;
}

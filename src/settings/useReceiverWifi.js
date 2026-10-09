import { useCallback, useEffect, useRef, useState } from 'react';

// The receiver's saved Wi-Fi networks (設定 → 進階 → 接收器 Wi-Fi, design S7):
// S7's second line (「家裡、辦公室」) and the Wi-Fi page share one reading.
// The receiver only tells their names, never a password. `service` is the
// BLE service (getWifiList, configureWifi, removeWifi); it is read while
// `active` (S7 or the Wi-Fi page in front) and the receiver is connected.
export function useReceiverWifi(service, { active = false, connected = false } = {}) {
  const [state, setState] = useState({ ssids: null, activeSsid: '', loading: false, error: '' });
  const mounted = useRef(true);
  // Bumped by a new service, a change and every read: only the newest read
  // may set the list (a read started before a deletion must not bring the
  // deleted network back).
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // A new service (a fixture's, or the live one again) starts over.
  useEffect(() => {
    generation.current += 1;
    setState({ ssids: null, activeSsid: '', loading: false, error: '' });
  }, [service]);
  const load = useCallback(async () => {
    if (!service?.getWifiList) return;
    const id = ++generation.current;
    const latest = () => mounted.current && id === generation.current;
    setState(current => ({ ...current, loading: true, error: '' }));
    try {
      const result = await service.getWifiList();
      if (latest()) {
        setState({ ssids: result?.ssids || [], activeSsid: result?.activeSsid || '', loading: false, error: '' });
      }
    } catch (error) {
      if (latest()) setState(current => ({ ...current, loading: false, error: error?.message || '讀取失敗' }));
    }
  }, [service]);
  useEffect(() => {
    if (active && connected) load();
  }, [active, connected, load]);
  return {
    ...state,
    connected,
    reload: load,
    /** Sends one network (name, password) to the receiver, then reads the list again. */
    async save(ssid, password) {
      await service.configureWifi(ssid, password);
      await load();
    },
    async remove(ssid) {
      generation.current += 1;
      await service.removeWifi(ssid);
      generation.current += 1;
      if (mounted.current) {
        setState(current => ({ ...current, loading: false, ssids: (current.ssids || []).filter(item => item !== ssid),
          activeSsid: current.activeSsid === ssid ? '' : current.activeSsid }));
      }
    },
  };
}

/** S7's second line under 接收器 Wi-Fi. */
export function wifiSummary(wifi) {
  if (wifi?.ssids?.length) return wifi.ssids.join('、');
  if (wifi?.ssids) return '還沒有存 Wi-Fi';
  if (wifi?.loading) return '讀取中…';
  if (wifi?.error) return '讀取失敗';
  return wifi?.connected ? '讀取中…' : '接收器連上後才能設定';
}

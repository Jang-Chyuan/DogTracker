import { useCallback, useEffect, useRef, useState } from 'react';

// The receiver's saved Wi-Fi networks (設定 → 進階 → 接收器 Wi-Fi, design S7):
// S7's second line (「家裡、辦公室」) and the Wi-Fi page share one reading.
// The receiver only tells their names, never a password. `service` is the
// BLE service (getWifiList, configureWifi, removeWifi); it is read while
// `active` (S7 or the Wi-Fi page in front) and the receiver is connected.
export function useReceiverWifi(service, { active = false, connected = false } = {}) {
  const [state, setState] = useState({ ssids: null, activeSsid: '', loading: false, error: '' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // A new service (a fixture's, or the live one again) starts over.
  useEffect(() => {
    setState({ ssids: null, activeSsid: '', loading: false, error: '' });
  }, [service]);
  const load = useCallback(async () => {
    if (!service?.getWifiList) return;
    setState(current => ({ ...current, loading: true, error: '' }));
    try {
      const result = await service.getWifiList();
      if (mounted.current) {
        setState({ ssids: result?.ssids || [], activeSsid: result?.activeSsid || '', loading: false, error: '' });
      }
    } catch (error) {
      if (mounted.current) setState(current => ({ ...current, loading: false, error: error?.message || '讀取失敗' }));
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
      await service.removeWifi(ssid);
      if (mounted.current) {
        setState(current => ({ ...current, ssids: (current.ssids || []).filter(item => item !== ssid),
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

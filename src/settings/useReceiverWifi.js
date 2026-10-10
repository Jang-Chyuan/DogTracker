import { t } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';

// The receiver's saved Wi-Fi networks (設定 → 進階 → 接收器 Wi-Fi, design S7):
// S7 and the Wi-Fi page share one reading.
// The receiver only tells their names, never a password. `service` is the
// BLE service (getWifiList, configureWifi, removeWifi); it is read while
// `active` (S7 or the Wi-Fi page in front) and the receiver is connected.
export function useReceiverWifi(service, { active = false, connected = false, receiverKey = null } = {}) {
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
  // The service the answers belong to: a save or deletion that ends after
  // another service came (a fixture's, the live one again) leaves it alone.
  const serviceNow = useRef(service);
  serviceNow.current = service;
  const receiverNow = useRef(receiverKey);
  receiverNow.current = receiverKey;
  // A new service (a fixture's, or the live one again) starts over.
  useEffect(() => {
    generation.current += 1;
    setState({ ssids: null, activeSsid: '', loading: false, error: '' });
  }, [service, receiverKey]);
  const connectedNow = useRef(connected);
  connectedNow.current = connected;
  useEffect(() => {
    if (!connected) {
      generation.current += 1;
      setState(current => ({ ...current, loading: false, error: '' }));
    }
  }, [connected]);
  const load = useCallback(async () => {
    if (!connectedNow.current || !service?.getWifiList || !mounted.current) return;
    const id = ++generation.current;
    const latest = () => mounted.current && connectedNow.current &&
      receiverNow.current === receiverKey && id === generation.current;
    setState(current => ({ ...current, loading: true, error: '' }));
    try {
      const result = await service.getWifiList();
      if (latest()) {
        setState({ ssids: result?.ssids || [], activeSsid: result?.activeSsid || '', loading: false, error: '' });
      }
    } catch (error) {
      if (latest()) setState(current => ({ ...current, loading: false, error: error?.message || t("c440") }));
    }
  }, [service, receiverKey]);
  useEffect(() => {
    if (active && connected) load();
  }, [active, connected, load]);
  return {
    ...state,
    connected,
    reload: load,
    /** Sends one network (name, password) to the receiver, then reads the list again. */
    async save(ssid, password) {
      if (!connectedNow.current) throw new Error(t('c1242'));
      const owner = service;
      await owner.configureWifi(ssid, password);
      if (mounted.current && serviceNow.current === owner && receiverNow.current === receiverKey) await load();
    },
    async remove(ssid) {
      if (!connectedNow.current) throw new Error(t('c1242'));
      const owner = service;
      generation.current += 1;
      await owner.removeWifi(ssid);
      if (!mounted.current || serviceNow.current !== owner || receiverNow.current !== receiverKey || !connectedNow.current) return;
      generation.current += 1;
      setState(current => ({ ...current, loading: false, ssids: (current.ssids || []).filter(item => item !== ssid),
        activeSsid: current.activeSsid === ssid ? '' : current.activeSsid }));
    },
  };
}

/** Receiver identity and Bluetooth link status, shared by S7 and the header. */
export function wifiSummary(wifi, receiver = t('c075'), paired = true) {
  if (!paired) return t('c1245');
  return wifi?.connected ? t('c1241', { receiver }) : t('c1240', { receiver });
}

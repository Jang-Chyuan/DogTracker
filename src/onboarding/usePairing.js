import { t } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, NativeModules, PermissionsAndroid, Platform, ToastAndroid } from 'react-native';
import { sharedBleService } from '../ble/sharedBle';
import { DEFAULT_BLE_CONFIG } from '../ble/BleService';
import { parseMasterQr, MASTER_SERVICE_UUID } from '../qr/MasterQrParser';
import { judgeSwitch, notChangedMessage, snapshotReceiver } from '../settings/ReceiverSwitch';
import { receiverSetUp } from '../settings/SettingsModel';
import { receiverNumber } from '../map/ReceiverState';
import { openSystemSettings } from '../utils/systemSettings';
import { addNearby, CONNECT_TIMEOUT_MS, FIRST_PACKET_MS, pairingDialog, parseReceiverName, SEARCH_MS } from './Pairing';

const NO_IDS = Object.freeze([]);
const normalized = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const openBluetooth = () => openSystemSettings('android.bluetooth.adapter.action.REQUEST_ENABLE');
const openLocationServices = () => openSystemSettings('android.settings.LOCATION_SOURCE_SETTINGS');
const sayNotChanged = message => {
  if (Platform.OS === 'android') ToastAndroid?.show?.(message, ToastAndroid.SHORT);
};

/**
 * D3 連接接收器: the QR code (D3a, D3b), the typed name with the receivers
 * nearby (D3c), connecting (D3d, at most 30 s, 取消) and its dialogs
 * (Pairing.pairingDialog), for every way in (Pairing.pairingFlow).
 *
 * The receiver is found by its advertised name (the QR code's or the typed
 * one) and connected with its number as the expected Master, so the native
 * service drops a packet from another Master at once. A first set up is done
 * when the link stands (D4 waits for nothing); changing receivers
 * ('change') pauses the old link on the way in, waits up to 60 s
 * for the first packet and puts the old receiver back when the change does
 * not happen (判定表「換接收器」).
 *
 * options:
 * - flow            Pairing.pairingFlow(entry, mode)
 * - receiverState   the native state App polls (BleBackground.getState)
 * - service         { receiveData, onStatus }: useReceiverService's handlers
 * - restore(previous) puts a receiver back switched off (useReceiverControl)
 * - asked           the system questions sent before ('nearby', 'location',
 *                   'camera'…; TrackingPreferences.askedPermissions)
 * - onAsked(list)   saves the list once another question is sent
 * - locationServices false when the phone's location switch is off
 * - onConnected({ number, method, previous, kept }) the receiver is in use
 * - onLeave(how)    'later' or 'back' out of D3 (after any restore)
 * - fixture         a screen state to draw (src/dev): nothing is scanned,
 *                   asked or connected
 */
export function usePairing({ flow, receiverState, service = {}, restore, asked = NO_IDS, onAsked, locationServices = null,
  onConnected, onLeave, fixture = null, initialView = 'scan', ble = sharedBleService,
  native = Platform.OS === 'android' ? NativeModules.BleBackground : null, permissions = PermissionsAndroid,
  version = Platform.Version, android = Platform.OS === 'android' }) {
  // Back on D3 from D4 (or the guide resumed with a receiver set up): 「已
  // 連上 接收器 7」 with 下一步 / 換一台; nothing moves on by itself.
  const startConnected = flow.guide && receiverSetUp(receiverState) && !!receiverState?.enabled;
  const [view, setView] = useState(() => fixture?.view ?? (startConnected ? 'connected' : initialView));
  const [camera, setCamera] = useState(fixture?.camera ?? 'checking');
  // D3a is on screen (laid out): only then may the camera question come,
  // never over the page before it.
  const [shown, setShown] = useState(false);
  const [dialog, setDialog] = useState(() => (fixture?.dialog
    ? pairingDialog(fixture.dialog.kind, { mode: flow.mode, ...fixture.dialog }) : null));
  const [target, setTarget] = useState(fixture?.target ?? null);
  const [nearby, setNearby] = useState(() => ({ list: (fixture?.nearby || []).reduce(addNearby, []),
    searching: !!fixture?.searching, done: !!fixture?.done }));
  const [nameSearch, setNameSearch] = useState(null);
  const [input, setInput] = useState(fixture?.input ?? 'DogGPS-Master');
  const [inputError, setInputError] = useState(fixture?.inputError ?? null);
  const connectedNumber = fixture?.connectedNumber ?? receiverNumber(receiverState);

  const alive = useRef(true);
  const attempt = useRef(0);
  const timers = useRef([]);
  const waiting = useRef(null);
  const succeeded = useRef(false);
  const restored = useRef(false);
  // Questions sent while D3 is open (the saved list may lag behind).
  const askedNow = useRef([]);
  const markAsked = id => {
    askedNow.current = [...new Set([...asked, ...askedNow.current, id])];
    Promise.resolve(callbacks.current.onAsked?.(askedNow.current)).catch(() => {});
  };
  const wasAsked = id => asked.includes(id) || askedNow.current.includes(id);
  const latest = useRef(receiverState);
  latest.current = receiverState;
  // The receiver used before a change (taken once, on the way in).
  const previous = useRef(undefined);
  if (previous.current === undefined) previous.current = snapshotReceiver(receiverState);
  const callbacks = useRef({});
  callbacks.current = { onConnected, onLeave, onAsked, restore, service, locationServices };

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (ms, run) => { timers.current.push(setTimeout(run, ms)); };
  const show = (kind, params = {}) => setDialog(pairingDialog(kind, { mode: flow.mode, previous: previous.current,
    ...params }));

  // ---- the way in, the way out ------------------------------------------
  // Changing receivers pauses the old link while scanning: its dogs keep their 「未更新」 clock paused meanwhile.
  useEffect(() => {
    alive.current = true;
    if (!fixture && flow.waitForData && previous.current?.enabled) ble.disconnect();
    return () => {
      alive.current = false;
      attempt.current += 1;
      clearTimers();
      if (!fixture) ble.stopScan?.();
      putBack();
    };
    // On the way in and out only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Putting the receiver used before back: its settings, and its link if it
  // was connected; a previously disconnected receiver remains disconnected.
  // `oldLink` is 'paused' while an attempt has it off, 'back' once restored.
  const oldLink = useRef(flow.waitForData ? 'paused' : 'back');
  const restoring = useRef(Promise.resolve());
  const putOld = () => {
    oldLink.current = 'back';
    const old = previous.current;
    restoring.current = Promise.resolve(callbacks.current.restore?.(old)).then(() => {
      if (old?.enabled) return native?.reconnect?.();
      return null;
    }).catch(() => {});
    return restoring.current;
  };

  // Out of D3 without a new receiver after a change: the old one as it was
  // before, and 「沒有更換，還是接收器 7」 (c294).
  const putBack = () => {
    if (fixture || !flow.waitForData || succeeded.current || restored.current) return;
    restored.current = true;
    if (oldLink.current === 'paused') { ble.disconnect(); putOld(); }
    if (previous.current) sayNotChanged(notChangedMessage(previous.current));
  };

  // An attempt that did not work out (取消, 30 s, another Master): the old
  // receiver comes back at once — nothing on a first set up (the attempted
  // one is forgotten), the one before after 換一台 or a change of receiver
  // (判定表「換接收器」: 「取消、逾時、編號不符 → 恢復舊接收器和更換前的狀態」).
  const undo = () => {
    attempt.current += 1;
    clearTimers();
    waiting.current = null;
    if (fixture) return;
    ble.disconnect();
    putOld();
  };

  const leave = how => {
    const connecting = view === 'connecting';
    if (connecting) undo();
    attempt.current += 1;
    clearTimers();
    waiting.current = null;
    if (!fixture) ble.stopScan?.();
    putBack();
    callbacks.current.onLeave?.(how);
  };

  const succeed = ({ number, method, kept = false }) => {
    clearTimers();
    waiting.current = null;
    succeeded.current = true;
    callbacks.current.onConnected?.({ number, method, previous: previous.current, kept });
  };

  // ---- what Android allows ------------------------------------------------
  const check = name => Promise.resolve().then(() => permissions.check(name)).catch(() => false);
  // Asked once (D2, or here when D2 was skipped): a refusal then says why
  // with 開系統設定 ›, and the system question does not come again.
  const ready = async () => {
    if (!android) return true;
    const names = permissions.PERMISSIONS || {};
    const old = Number(version) < 31;
    const needed = (old ? [names.ACCESS_FINE_LOCATION] : [names.BLUETOOTH_SCAN, names.BLUETOOTH_CONNECT])
      .filter(Boolean);
    const has = async () => (await Promise.all(needed.map(check))).every(Boolean);
    if (!(await has())) {
      const group = old ? 'location' : 'nearby';
      if (!wasAsked(group)) {
        markAsked(group);
        await Promise.resolve().then(() => permissions.requestMultiple(old
          ? [names.ACCESS_FINE_LOCATION, names.ACCESS_COARSE_LOCATION].filter(Boolean) : needed)).catch(() => null);
      }
      if (!(await has())) {
        if (alive.current) show(old ? 'locationDenied' : 'nearbyDenied');
        return false;
      }
    }
    const power = await Promise.resolve(ble.bluetoothState?.()).catch(() => 'Unknown');
    if (power === 'PoweredOff') {
      if (alive.current) show('bluetoothOff');
      return false;
    }
    if (old && callbacks.current.locationServices === false) {
      if (alive.current) show('locationOff');
      return false;
    }
    return true;
  };

  // The camera, asked when D3a needs it (never in D2).
  const checkCamera = useCallback(async ({ ask }) => {
    if (fixture) return;
    if (!android) { setCamera('granted'); return; }
    const name = permissions.PERMISSIONS?.CAMERA;
    if (await check(name)) { if (alive.current) setCamera('granted'); return; }
    if (ask && !wasAsked('camera')) {
      markAsked('camera');
      const answer = await Promise.resolve().then(() => permissions.request(name)).catch(() => null);
      if (alive.current) setCamera(answer === permissions.RESULTS?.GRANTED ? 'granted' : 'denied');
      return;
    }
    if (alive.current) setCamera('denied');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture, android, permissions, asked]);
  useEffect(() => {
    if (view !== 'scan' || fixture || !shown) return undefined;
    checkCamera({ ask: true });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') checkCamera({ ask: false });
    });
    return () => subscription.remove();
  }, [view, fixture, checkCamera, shown]);

  // ---- connecting -------------------------------------------------------
  // `next`: { name, number, method: 'qr' | 'manual', device? }.
  const connect = async next => {
    if (fixture) return;
    const mine = ++attempt.current;
    clearTimers();
    ble.stopScan?.();
    setNameSearch(null);
    setDialog(null);
    if (!(await ready()) || mine !== attempt.current) return;
    // A restore still on its way finishes first; then the old link pauses
    // for the attempt (掃描到比對完成之間舊連線先暫停).
    await restoring.current;
    if (mine !== attempt.current) return;
    if (oldLink.current === 'back' && previous.current?.enabled) ble.disconnect();
    oldLink.current = 'paused';
    setTarget(next);
    setView('connecting');
    const config = { bleName: next.name, serviceUuid: MASTER_SERVICE_UUID, masterId: next.number };
    // 30 s for finding it and the Bluetooth link together (c048).
    later(CONNECT_TIMEOUT_MS, () => {
      if (mine !== attempt.current || waiting.current) return;
      undo();
      setView('stopped');
      show('failed', { number: next.number, method: next.method });
    });
    let device = next.device;
    if (!device) {
      device = await new Promise(resolve => {
        let found = false;
        ble.scan(config, () => {}, candidate => {
          if (found || normalized(candidate?.name || candidate?.localName) !== normalized(next.name)) return;
          found = true;
          resolve(candidate);
        }, () => { if (!found) resolve(null); }, { timeoutMs: CONNECT_TIMEOUT_MS }).catch(() => resolve(null));
      });
      if (mine !== attempt.current) return;
      // Not found within the time: the timer above says 連不上.
      if (!device) return;
    }
    const { receiveData = () => {}, onStatus = () => {} } = callbacks.current.service;
    const ok = await Promise.resolve(ble.connect(device, onStatus, receiveData, config)).catch(() => false);
    if (mine !== attempt.current) return;
    if (!ok) {
      // Stopped early: another Master answered (the service stops on its
      // packet), or the link could not start.
      const state = await Promise.resolve(native?.getState?.()).catch(() => null);
      if (mine !== attempt.current) return;
      const verdict = judgeSwitch(state, next.number, null);
      undo();
      setView('stopped');
      if (verdict && typeof verdict === 'object') show('mismatch', { ...verdict, method: next.method });
      else show('failed', { number: next.number, method: next.method });
      return;
    }
    if (!flow.waitForData) { succeed(next); return; }
    // Changing receivers: the first packet decides (60 s).
    clearTimers();
    waiting.current = { ...next, attempt: mine };
    later(FIRST_PACKET_MS, () => {
      if (mine !== attempt.current || !waiting.current) return;
      show('noData', { number: next.number });
    });
  };

  // The first packet of a receiver being changed to.
  useEffect(() => {
    const wait = waiting.current;
    if (!wait || wait.attempt !== attempt.current) return;
    const verdict = judgeSwitch(receiverState, wait.number, null);
    if (verdict === 'matched') {
      setDialog(null);
      succeed(wait);
    } else if (verdict && typeof verdict === 'object') {
      undo();
      setView('stopped');
      show('mismatch', { ...verdict, method: wait.method });
    }
    // succeed and show read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiverState, ble]);

  const cancel = () => {
    const back = target?.method === 'manual' ? 'manual' : 'scan';
    undo();
    setView(back);
  };

  // ---- D3a: a QR code ---------------------------------------------------
  const onQr = value => {
    if (fixture || dialog || view !== 'scan') return;
    let config;
    try {
      config = parseMasterQr(value);
    } catch {
      show('wrongQr');
      return;
    }
    connect({ name: config.bleName, number: config.masterId, method: 'qr' });
  };

  // ---- D3c: the receivers nearby, a typed name ----------------------------
  const search = async (wanted = null) => {
    if (fixture) return;
    const mine = ++attempt.current;
    clearTimers();
    setNameSearch(wanted ? { name: wanted.name, searching: true } : null);
    setNearby(current => ({ list: wanted ? current.list : [], searching: true, done: false }));
    if (!(await ready()) || mine !== attempt.current) {
      if (mine === attempt.current) { setNearby(current => ({ ...current, searching: false, done: true })); setNameSearch(null); }
      return;
    }
    let connecting = false;
    ble.scan(DEFAULT_BLE_CONFIG, () => {}, device => {
      if (mine !== attempt.current || connecting) return;
      setNearby(current => ({ ...current, list: addNearby(current.list, device) }));
      if (wanted && normalized(device?.name || device?.localName) === normalized(wanted.name)) {
        connecting = true;
        connect({ ...wanted, method: 'manual', device });
      }
    }, () => {
      if (mine !== attempt.current || connecting) return;
      setNearby(current => ({ ...current, searching: false, done: true }));
      if (wanted) {
        setNameSearch(null);
        setInputError(t("c880", { name: wanted.name }));
      }
    }, { timeoutMs: SEARCH_MS }).catch(() => {
      if (mine === attempt.current) setNearby(current => ({ ...current, searching: false, done: true }));
    });
  };
  const openManual = () => {
    setDialog(null);
    setView('manual');
  };
  // Entering D3c starts its 30 s scan.
  useEffect(() => {
    if (view === 'manual' && !fixture) search();
    // Only on entering D3c.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view === 'manual']);

  const searchName = () => {
    const wanted = parseReceiverName(input);
    if (!wanted) { setInputError(t('c262')); return; }
    setInputError(null);
    const seen = nearby.list.find(item => normalized(item.name) === normalized(wanted.name));
    if (seen) connect({ ...wanted, method: 'manual', device: seen.device });
    else search(wanted);
  };
  const pickNearby = item => {
    const wanted = parseReceiverName(item.name);
    if (!wanted) return;
    setInput(wanted.name);
    setInputError(null);
    connect({ ...wanted, method: 'manual', device: item.device });
  };
  const typeName = text => {
    setInput(text);
    if (inputError) setInputError(null);
  };

  // ---- dialogs and back ---------------------------------------------------
  // Where a stopped attempt (its dialog over the connecting page) returns.
  const stoppedBack = () => setView(target?.method === 'manual' ? 'manual' : 'scan');
  const press = id => {
    const kind = dialog?.kind;
    setDialog(null);
    if (view === 'stopped' && !['manual', 'search', 'rescan', 'retry', 'later'].includes(id)) stoppedBack();
    // D3c (again, after its connection failed: entering it searches anew).
    if (id === 'manual' || id === 'search') { openManual(); return; }
    if (id === 'rescan') { setView('scan'); return; }
    if (id === 'retry' && target) { connect(target); return; }
    if (id === 'later') { leave('later'); return; }
    if (id === 'keep' && waiting.current) { succeed({ ...waiting.current, kept: true }); return; }
    if (id === 'restore') { leave('back'); return; }
    if (id === 'open') { (kind === 'locationOff' ? openLocationServices : openBluetooth)(); return; }
    if (id === 'settings') openSystemSettings();
  };
  // Back: a dialog closes first; D3c goes to D3a; connecting stops (取消);
  // then out of D3 (引導中 → D2, otherwise back where it was opened).
  const back = () => {
    if (dialog) {
      // 先換過去／恢復 must be answered by a button; back means 「恢復」.
      if (dialog.kind === 'noData') { press('restore'); return; }
      setDialog(null);
      if (view === 'stopped') stoppedBack();
      return;
    }
    if (view === 'connecting' || view === 'stopped') { cancel(); return; }
    if (view === 'manual') { attempt.current += 1; if (!fixture) ble.stopScan?.(); setView('scan'); return; }
    leave('back');
  };

  return {
    view, camera, dialog, target, nearby, nameSearch, input, inputError, connectedNumber,
    onShown: () => setShown(true),
    waitingForData: !!waiting.current,
    onQr, cancel, search: () => search(), searchName, pickNearby, typeName, press, back,
    closeDialog: () => {
      if (dialog?.kind === 'noData') { press('restore'); return; }
      setDialog(null);
      if (view === 'stopped') stoppedBack();
    },
    openManual, later: () => leave('later'), changeReceiver: () => setView('scan'),
    // 下一步 back on D3 after D4: D4 again.
    next: () => callbacks.current.onConnected?.({ number: connectedNumber, method: null, previous: null, kept: false,
      again: true }),
  };
}

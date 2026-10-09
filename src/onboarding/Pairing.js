// D3 連接接收器 and D4 完成 (design D3a–D3d, D4/D4b; D3 的情況表; 判定表「D3c
// 手動搜尋」「D3c 的返回」「D3c 連不上」「D3 初次連線的等待」「換接收器」「中斷並
// 重新掃描」「連上而且已經收到訊號源」「沒取名字的訊號源」). Pure: names, words and
// dialogs; usePairing runs the scan and the connection.

import { receivedSources } from '../settings/SettingsModel';

export const RECEIVER_PREFIX = 'DogGPS-Master';
// Connecting (finding the receiver and the Bluetooth link) gives up after this.
export const CONNECT_TIMEOUT_MS = 30 * 1000;
// D3c lists the receivers nearby for this long; a name search waits as long.
export const SEARCH_MS = 30 * 1000;
// Changing receivers: after the link, the first packet must come within this.
export const FIRST_PACKET_MS = 60 * 1000;
// 訊號強 from here up (dBm), 訊號弱 below.

/**
 * A typed receiver name as the scan compares it (「手動輸入的格式」: case and
 * every space ignored): 「DogGPS-Master 7」 and 「dogGPS-master7」 are both
 * { name: 'DogGPS-Master7', number: 7 }; anything else is null (c262).
 */
export function parseReceiverName(input) {
  const compact = String(input ?? '').replace(/\s+/g, '');
  const match = /^doggps-master(\d{1,3})$/i.exec(compact);
  if (!match) return null;
  const number = Number(match[1]);
  if (!(number >= 1 && number <= 255)) return null;
  return { name: `${RECEIVER_PREFIX}${match[1]}`, number };
}

/** The receiver number in an advertised name (DogGPS-Master7 → 7), or null. */
export function receiverNumberOf(name) {
  return parseReceiverName(name)?.number ?? null;
}

/** Four phone-style signal bars; unknown scans have no icon. */
export function signalBars(rssi) {
  if (!Number.isFinite(rssi)) return 0;
  return rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1;
}

export function signalBarsLabel(bars) {
  return bars >= 3 ? '訊號強' : bars === 2 ? '訊號中' : bars === 1 ? '訊號弱' : '';
}

/**
 * D3c's list 「附近找到的接收器」: each receiver once (the newest sighting of
 * an id wins), strongest first. Only DogGPS-Master names are kept.
 */
export function addNearby(list, device) {
  const name = device?.name || device?.localName || '';
  if (!device?.id || receiverNumberOf(name) == null) return list;
  const next = [...list.filter(item => item.id !== device.id),
    { id: device.id, name: parseReceiverName(name).name, rssi: Number.isFinite(device.rssi) ? device.rssi : null,
      device }];
  return next.sort((left, right) => (right.rssi ?? -999) - (left.rssi ?? -999) || left.name.localeCompare(right.name));
}

/**
 * The dialogs of D3, as { kind, title, body, buttons: [{ id, label }] } —
 * the last button is the main one (right).
 * - wrongQr       D3b (c032, c033): 手動輸入 / 再掃一次
 * - failed        D3d (c047, c048): from the QR 手動輸入 / 重試; from the
 *                 manual search 回到搜尋 / 重試 (判定表「D3c 連不上」)
 * - mismatch      another Master answered (c267's suggestion): 稍後再說 /
 *                 重新掃描 (QR) or 重新搜尋 (manual); a change of receiver
 *                 also says the old one is still used (c294)
 * - noData        changing receivers, no packet in 60 s (c293): 先換過去 /
 *                 恢復接收器 7 (「不換」 when the old one was disconnected)
 * - bluetoothOff  c260 with 打開; locationOff c265 with 打開 (Android 11 and
 *                 below scan through location)
 * - nearbyDenied  c261, locationDenied c266: 開系統設定 ›
 */
export function pairingDialog(kind, { number = null, expected = null, got = null, method = 'qr',
  previous = null, mode = 'first' } = {}) {
  const cancel = { id: 'cancel', label: '取消' };
  switch (kind) {
    case 'wrongQr':
      return { kind, title: '這不是接收器的 QR Code', body: '請掃接收器機身上的 QR Code（DogGPS-Master 開頭）。',
        buttons: [{ id: 'manual', label: '手動輸入' }, { id: 'rescan', label: '再掃一次' }] };
    case 'failed':
      return { kind, title: number != null ? `連不上接收器 ${number}` : '連不上接收器',
        body: '已經試了 30 秒。請確認接收器有開機、在 10 公尺內。',
        buttons: [method === 'manual' ? { id: 'search', label: '回到搜尋' } : { id: 'manual', label: '手動輸入' },
          { id: 'retry', label: '重試' }] };
    case 'mismatch': {
      const kept = mode === 'change' && previous?.number != null ? `。沒有更換，還是接收器 ${previous.number}` : '';
      return { kind, title: '這不是要連的接收器', body: `要連 ${expected}，收到的是 ${got}，已中斷連線${kept}`,
        buttons: [{ id: 'later', label: '稍後再說' },
          method === 'manual' ? { id: 'search', label: '重新搜尋' } : { id: 'rescan', label: '重新掃描' }] };
    }
    case 'noData': {
      const back = mode === 'change' && previous?.number != null
        ? { id: 'restore', label: `恢復接收器 ${previous.number}` } : { id: 'restore', label: '不換' };
      return { kind, title: `接收器 ${number} 還沒有送資料`, body: null,
        buttons: [back, { id: 'keep', label: '先換過去' }] };
    }
    case 'bluetoothOff':
      return { kind, title: '請打開藍牙', body: null, buttons: [cancel, { id: 'open', label: '打開' }] };
    case 'locationOff':
      return { kind, title: '請打開定位', body: null,
        buttons: [cancel, { id: 'open', label: '打開' }] };
    case 'nearbyDenied':
      return { kind, title: '需要『附近的裝置』才能連接接收器', body: null,
        buttons: [cancel, { id: 'settings', label: '開系統設定 ›' }] };
    case 'locationDenied':
      return { kind, title: '需要位置權限才能找接收器', body: null,
        buttons: [cancel, { id: 'settings', label: '開系統設定 ›' }] };
    default:
      return null;
  }
}

/**
 * How D3 was opened (the stack route's entry and mode) and what that changes:
 * - entry 'onboarding' the first-launch guide (progress bar step 3; back to
 *   D2; 稍後再說 ends the guide on the map; connected → D4)
 * - entry 'map'        A6 「連接接收器」 (connected → back to the map, which
 *   frames the dogs heard and located)
 * - entry 'receiver'   S2, with mode 'first' (no receiver yet), 'change'
 *   (換接收器)
 * - entry 'alert'      a mismatch dialog's 重新掃描／重新搜尋 (back to that page)
 * mode 'change' waits for the first packet before taking the new
 * receiver, and puts the old one back when the change does not happen
 * (reconnects it only if it was connected).
 */
export function pairingFlow(entry = 'onboarding', mode = 'first') {
  const switching = mode === 'change';
  return {
    entry,
    mode: switching ? mode : 'first',
    guide: entry === 'onboarding',
    waitForData: switching,
    restoreConnected: mode === 'change',
  };
}

/**
 * D4 已連上接收器 N: the sources this receiver has sent so far, each only as
 * 「訊號源 4」 (no names yet), in the order S2 lists them; D4b when there are
 * none. `packets` are useCloudDogs' newest packets.
 */
export function pairedPage(number, packets) {
  const sources = receivedSources(packets, number, null).map(source => ({ slaveId: source.slaveId,
    label: `訊號源 ${source.slaveId}` }));
  return {
    title: number != null ? `已連上接收器 ${number}` : '已連上接收器',
    body: sources.length
      ? `收到 ${sources.length} 個訊號源。狗定位後會出現在地圖上，點狗就能改名字和頭像。`
      : '還沒收到訊號源。項圈開機後，訊號源會出現在這裡。',
    sources,
  };
}

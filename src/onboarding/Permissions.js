// D2 「App 需要這些權限」 (design D2a–D2d; 判定表「權限和 Android 版本」「D2 底部
// 按鈕」「引導 D2 權限列」). Pure: which permissions this phone needs, what each
// row says, and the button under them. usePermissionsGuide asks Android.
//
// Android 12 and up: 附近的裝置 (Bluetooth scan and connect) and 精確位置;
// 13 and up also 通知; 11 and below scan Bluetooth through the location
// permission, so only 精確位置 is asked. Background location is never asked
// (位置記錄 runs as a foreground service). The camera is asked in D3, when a
// QR code is scanned.

export const PERMISSION_ROWS = Object.freeze({
  nearby: { title: '附近的裝置', purpose: '連接接收器' },
  location: { title: '精確位置', purpose: '算出狗離你多遠、記錄你的路線' },
  notifications: { title: '通知', purpose: '狗出問題時提醒你（可以不開）' },
});

// The settings action on a row that is not allowed (c027's suggestion, the
// same words as S4 and S6).
export const SYSTEM_SETTINGS = '開系統設定 ›';

/** The rows this Android version (API level) asks for, in the design's order. */
export function neededPermissions(version) {
  const level = Number(version) || 0;
  if (level < 31) return ['location'];
  return level >= 33 ? ['nearby', 'location', 'notifications'] : ['nearby', 'location'];
}

/**
 * The Android permissions behind a row (PermissionsAndroid.PERMISSIONS
 * names): one system question each, asked one after the other.
 */
export function androidPermissions(id, permissions = {}) {
  if (id === 'nearby') return [permissions.BLUETOOTH_SCAN, permissions.BLUETOOTH_CONNECT].filter(Boolean);
  if (id === 'location') return [permissions.ACCESS_FINE_LOCATION, permissions.ACCESS_COARSE_LOCATION].filter(Boolean);
  if (id === 'notifications') return [permissions.POST_NOTIFICATIONS].filter(Boolean);
  return [];
}

/**
 * A row's grant from Android's answers (`granted` maps each permission name to
 * true/false): 'granted', 'approximate' (location with only 大概) or
 * 'denied'.
 */
export function grantOf(id, granted, permissions = {}) {
  if (id === 'location') {
    if (granted[permissions.ACCESS_FINE_LOCATION]) return 'granted';
    return granted[permissions.ACCESS_COARSE_LOCATION] ? 'approximate' : 'denied';
  }
  return androidPermissions(id, permissions).every(name => granted[name]) ? 'granted' : 'denied';
}

/**
 * D2's rows and button. input: { needed (ids), grants ({ id: 'granted' |
 * 'approximate' | 'denied' }, a missing id = not known yet), asked (the ids
 * whose system question was sent, now or on an earlier visit), asking (the
 * id whose system question is open, or null while none is) }.
 *
 * Each row: { id, number, title, detail, state: 'todo' | 'ok' | 'asking' |
 * 'waiting' | 'problem', action (SYSTEM_SETTINGS or null) }. A row allowed is
 * ticked and cannot be pressed; one not allowed after it was asked (or only
 * 大概 location, whenever) is a red 「!」 with 「開系統設定 ›」 — never a
 * second system question. Before the questions it says what it is for.
 *
 * primary: 「全部允許」 before the questions, 「詢問中…」 (disabled) while they
 * run, then only 「下一步」 (also when everything was allowed already); later
 * (「稍後再說」) is there until the questions are over.
 */
export function permissionsPage({ needed, grants = {}, asked = [], asking = null }) {
  const askingAt = asking ? needed.indexOf(asking) : -1;
  const wasAsked = id => asked.includes(id);
  const rows = needed.map((id, index) => {
    const { title, purpose } = PERMISSION_ROWS[id];
    const base = { id, number: index + 1, title, action: null };
    const grant = grants[id];
    if (askingAt >= 0 && index === askingAt) return { ...base, state: 'asking', detail: '詢問中…' };
    if (askingAt >= 0 && index > askingAt && grant !== 'granted') return { ...base, state: 'waiting', detail: '等一下' };
    if (grant === 'granted') return { ...base, state: 'ok', detail: '已允許' };
    if (grant === 'approximate') {
      return { ...base, state: 'problem', detail: '只給了大概位置，算不出距離', action: SYSTEM_SETTINGS };
    }
    if (grant === 'denied' && wasAsked(id)) return { ...base, state: 'problem', detail: '未允許', action: SYSTEM_SETTINGS };
    return { ...base, state: 'todo', detail: purpose };
  });
  const allGranted = needed.length > 0 && needed.every(id => grants[id] === 'granted');
  const known = needed.every(id => grants[id] != null);
  let primary;
  if (askingAt >= 0) primary = { id: 'asking', label: '詢問中…', disabled: true };
  // Nothing left to ask (each one allowed, or asked already): 下一步.
  else if (known && askableIds({ needed, grants, asked }).length === 0) {
    primary = { id: 'next', label: '下一步', disabled: false };
  }
  // Until every row was checked the button waits (a moment at most).
  else primary = { id: 'allowAll', label: '全部允許', disabled: !known };
  return { rows, primary, later: primary.id !== 'next', allGranted };
}

/** The rows 「全部允許」 still asks: not allowed, and never asked before. */
export function askableIds({ needed, grants = {}, asked = [] }) {
  return needed.filter(id => grants[id] !== 'granted' && !asked.includes(id));
}

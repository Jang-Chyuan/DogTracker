// What S3 Supabase 帳號 says (design v3 S3; 「頁面 內容與狀態」 Supabase 帳號;
// 判定表「切換上傳方式」「使用中登入失效」「啟動與恢復登入」). Pure: App hands in
// the account, the download state (useCloudSync), the upload state
// (useCloudUpload) and the page only draws the answer.
//
// The row that has a problem carries the red 「!」, the same thing S1 and the
// gear's red dot count (SettingsModel.settingsInput.cloudFailing): downloads
// failing (failingSince) or the upload reporting an error.

import { formatClock } from '../map/MapFormat';
import { isNetworkFailure } from '../cloud/CloudErrors';

const count = (counts, status) => Number((counts || []).find(row => row.status === status)?.count || 0);

// An upload error in field words: the network ones are 「連不上 Supabase」.
function uploadReason(error) {
  if (!error) return '';
  if (isNetworkFailure({ message: error })) return '連不上 Supabase';
  return error;
}

export const ROUTE_PHONE = '由這支手機上傳';
export const ROUTE_WIFI = '由接收器的 Wi-Fi 上傳';

/**
 * S3. Signed out (by choice, or 登入失效): { signedIn: false, expired,
 * restoring } — 「未登入」 or 「需要重新登入」 with 「登入」 (→ D1), or while the
 * restore waits for Supabase 「暫時連不上，會自動重試」. Signed in:
 * { signedIn, email, download: row, upload: { problem: row|null, pending,
 *   lastText }, routes: [{ master, title, detail, mode, to, pending,
 *   canSwitch }], routesLoading, offline, pendingTotal }.
 * A row: { title, detail, right, problem, retry, label }.
 */
export function accountPage(input) {
  const account = input.account || {};
  if (!account.signedIn) {
    // The sign-in restore could not reach Supabase (or ran past 10 s): the
    // saved sign-in comes back by itself (判定表「啟動與恢復登入」).
    if (input.restoring && !input.signInExpired) return { signedIn: false, expired: false, restoring: true };
    return { signedIn: false, expired: !!input.signInExpired, restoring: false };
  }
  const sync = input.sync || {};
  const upload = input.upload || {};

  // ---- 下載 ----------------------------------------------------------------
  let download;
  if (sync.failingSince != null) {
    const since = `連不上 Supabase・${formatClock(sync.failingSince)} 起`;
    // Not reached Supabase once since the app started (restoring the sign-in
    // without a network): it keeps trying by itself (判定表「啟動與恢復登入」).
    const restoring = sync.lastSuccess == null;
    const title = restoring ? '暫時連不上，會自動重試' : '下載失敗';
    download = { title, detail: since, right: null, problem: true, retry: true,
      label: `${title}，${since}，重試` };
  } else if (sync.lastSuccess != null) {
    const time = formatClock(sync.lastSuccess);
    download = { title: '最後下載成功', detail: null, right: time, problem: false, retry: false,
      label: `最後下載成功 ${time}` };
  } else {
    download = { title: '最後下載成功', detail: null, right: '下載中…', problem: false, retry: false,
      label: '下載中' };
  }

  // ---- 上傳 ----------------------------------------------------------------
  const pending = count(upload.counts, 'pending');
  const blocked = count(upload.counts, 'blocked');
  let problem = null;
  if (blocked > 0) {
    problem = { title: '需處理', detail: '雲端拒收，修正授權後重試', right: `${blocked} 筆`, problem: true, retry: true,
      label: `需處理 ${blocked} 筆，重試` };
  } else if (upload.error) {
    const reason = uploadReason(upload.error);
    problem = { title: '上傳失敗', detail: reason, right: null, problem: true, retry: true,
      label: `上傳失敗，${reason}，重試` };
  }
  const lastText = upload.last ? formatClock(upload.last) : '還沒有';

  // ---- 接收器 N 的上傳方式 -------------------------------------------------
  const settings = upload.settings || [];
  const masters = upload.masters || [];
  const byMaster = upload.pendingByMaster || {};
  const ids = [...new Set([...masters, ...settings.map(setting => Number(setting.master_id))])]
    .filter(Number.isInteger).sort((left, right) => left - right);
  const routes = upload.supported === false || !upload.settingsReady ? [] : ids.map(master => {
    const mode = settings.find(setting => Number(setting.master_id) === master)?.mode === 'phone' ? 'phone' : 'wifi';
    const detail = mode === 'phone' ? ROUTE_PHONE : ROUTE_WIFI;
    // Uploading for a receiver needs this account's authorization for it;
    // going back to its Wi-Fi is always allowed.
    const canSwitch = mode === 'phone' || masters.includes(master);
    return { master, title: `接收器 ${master} 的上傳方式`, detail, mode, to: mode === 'phone' ? 'wifi' : 'phone',
      pending: Number(byMaster[master] || 0), canSwitch,
      label: `接收器 ${master} 的上傳方式，${detail}${canSwitch ? '' : '，這個帳號沒有這台接收器的權限'}` };
  });

  return {
    signedIn: true,
    email: account.email || '',
    download,
    upload: { visible: routes.some(route => route.mode === 'phone'), problem, pending, pendingText: `${pending} 筆`, lastText },
    routes,
    routesLoading: upload.supported !== false && !upload.settingsReady,
    // The phone looks offline: a switch that must send rows first says so
    // before trying (c256).
    offline: (sync.failingSince != null && !!sync.offline) || isNetworkFailure({ message: upload.error || '' }),
    pendingTotal: pending,
  };
}

/**
 * The switch confirmation (S3 切換上傳方式): title, body (what changes and
 * what is sent first: c255), and when it cannot go ahead the reason (c256).
 */
export function switchDialog(route, { offline = false, error = null } = {}) {
  const toPhone = route.to === 'phone';
  const title = toPhone ? '改由這支手機上傳？' : '改由接收器的 Wi-Fi 上傳？';
  const change = toPhone ? '這台接收器改由這支手機上傳。' : '這台接收器改由它自己的 Wi-Fi 上傳，這支手機不再上傳它的資料。';
  const first = route.pending > 0 ? `手機裡還有 ${route.pending} 筆沒上傳，會先上傳。` : '';
  const blockedBy = error
    || (offline && route.pending > 0 ? `要先上傳完 ${route.pending} 筆，請連上網路` : null);
  return { title, body: change + first, blockedBy, confirm: '切換' };
}

/** The sign-out confirmation: what stops, what stays. */
export function signOutDialog(pendingTotal = 0) {
  const waiting = pendingTotal > 0 ? `還有 ${pendingTotal} 筆沒上傳，再登入這個帳號時會繼續上傳。` : '';
  return {
    title: '登出 Supabase 帳號？',
    body: `登出後會停止背景同步，並解除這支手機的上傳綁定（不再替接收器上傳）。手機裡的資料不會刪除。${waiting}`,
    confirm: '登出',
  };
}

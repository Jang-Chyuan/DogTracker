import { t } from '../i18n';
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
  if (isNetworkFailure({ message: error })) return t("c932");
  return error;
}

export const ROUTE_PHONE = t('c219');
export const ROUTE_WIFI = t('c416');

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
    const since = t('c212', { time: formatClock(sync.failingSince) });
    // Not reached Supabase once since the app started (restoring the sign-in
    // without a network): it keeps trying by itself (判定表「啟動與恢復登入」).
    const restoring = sync.lastSuccess == null;
    const title = restoring ? t('c257') : t('c211');
    download = { title, detail: since, right: null, problem: true, retry: true,
      label: t("c912", { title: title, since: since }) };
  } else if (sync.lastSuccess != null) {
    const time = formatClock(sync.lastSuccess);
    download = { title: t("c918"), detail: null, right: time, problem: false, retry: false,
      label: t("c913", { time: time }) };
  } else {
    download = { title: t("c918"), detail: null, right: t('c319'), problem: false, retry: false,
      label: t("c914") };
  }

  // ---- 上傳 ----------------------------------------------------------------
  const pending = count(upload.counts, 'pending');
  const blocked = count(upload.counts, 'blocked');
  let problem = null;
  if (blocked > 0) {
    problem = { title: t("c919"), detail: t("c911"), right: t('c216', { count: blocked }), problem: true, retry: true,
      label: t("c915", { blocked: blocked }) };
  } else if (upload.error) {
    const reason = uploadReason(upload.error);
    problem = { title: t("c920"), detail: reason, right: null, problem: true, retry: true,
      label: t("c916", { reason: reason }) };
  }
  const lastText = upload.last ? formatClock(upload.last) : t("c917");

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
    return { master, title: t('c218', { number: master }), detail, mode, to: mode === 'phone' ? 'wifi' : 'phone',
      pending: Number(byMaster[master] || 0), canSwitch,
      label: ((canSwitch) ? t("c921", { master: master, detail: detail }) : t("c922", { master: master, detail: detail })) };
  });

  return {
    signedIn: true,
    email: account.email || '',
    download,
    upload: { visible: routes.some(route => route.mode === 'phone') || pending > 0 || !!problem, problem, pending, pendingText: t('c216', { count: pending }), lastText },
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
  const title = toPhone ? t("c930") : t("c931");
  const change = toPhone ? t("c926") : t("c927");
  const first = route.pending > 0 ? t("c929", { pending: route.pending }) : '';
  const blockedBy = error
    || (offline && route.pending > 0 ? t('c256', { count: route.pending }) : null);
  return { title, body: change + first, blockedBy, confirm: t("c928") };
}

/** The sign-out confirmation: what stops, what stays. */
export function signOutDialog(pendingTotal = 0) {
  const waiting = pendingTotal > 0 ? t("c925", { pendingTotal: pendingTotal }) : '';
  return {
    title: t("c924"),
    body: t("c923", { waiting: waiting }),
    confirm: t('c209'),
  };
}

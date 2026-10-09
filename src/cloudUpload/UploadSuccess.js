import { t } from '../i18n';
import { formatClock } from '../map/MapFormat';
import { isNetworkFailure } from '../cloud/CloudErrors';

const at = value => {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 ? time : null;
};

export function uploadRouteMode(upload = {}, master) {
  if (!Number.isInteger(master) || upload.supported === false || !upload.settingsReady) return null;
  return (upload.settings || []).find(setting => Number(setting.master_id) === master)?.mode === 'phone'
    ? 'phone' : 'wifi';
}

function success(time, via) {
  if (time == null) return null;
  const text = via === 'wifi'
    ? t('c1230', { time: formatClock(time) })
    : t('c1231', { time: formatClock(time) });
  return { text, label: text, success: true, at: time, via };
}

// S2 and S3 use the same route-specific evidence. Keep the other route's
// success on a separate line so switching never erases the upload history.
export function receiverUploadSuccess(upload = {}, master) {
  const mode = uploadRouteMode(upload, master);
  if (!mode) return null;
  const phone = success(at(upload.lastByMaster?.[master]), 'phone');
  const wifi = success(at(upload.wifiByMaster?.[master]), 'wifi');
  if (mode === 'phone') {
    return phone ? { ...phone, ...(wifi ? { previous: wifi } : {}) } : wifi;
  }
  const text = t('c1232');
  const current = wifi || { text, label: text, success: false, at: null, via: null };
  return { ...current, ...(phone ? { previous: phone } : {}) };
}

// Current phone uploader failure, separate from historical successful sends.
export function phoneUploadProblem(upload = {}, master = null) {
  const blocked = Number(master == null
    ? (upload.counts || []).find(row => row.status === 'blocked')?.count || 0
    : upload.blockedByMaster?.[master] || 0);
  if (blocked > 0) {
    return { title: t('c919'), detail: t('c911'), right: t('c216', { count: blocked }),
      problem: true, success: false, retry: true, label: t('c915', { blocked }) };
  }
  if (!upload.error) return null;
  const reason = isNetworkFailure({ message: upload.error }) ? t('c932') : upload.error;
  return { title: t('c920'), detail: reason, right: null, problem: true, success: false,
    retry: true, label: t('c916', { reason }) };
}

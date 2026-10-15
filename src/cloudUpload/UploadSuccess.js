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
  // A receiver whose cloud route refused this phone: nothing more is queued
  // for it until 重試 (UploadDatabase.refuse).
  const refused = (upload.refusedMasters || []).filter(value => master == null || Number(value) === master);
  if (blocked > 0) {
    const detail = refused.length ? t('c1360', { masters: refused.join('、') }) : t('c911');
    return { title: t('c919'), detail, right: t('c216', { count: blocked }),
      problem: true, success: false, retry: true, label: t('c915', { blocked }) };
  }
  if (refused.length) {
    const reason = t('c1360', { masters: refused.join('、') });
    return { title: t('c919'), detail: reason, right: null, problem: true, success: false,
      retry: true, label: t('c916', { reason }) };
  }
  if (!upload.error) return null;
  const reason = isNetworkFailure({ message: upload.error }) ? t('c932') : upload.error;
  return { title: t('c920'), detail: reason, right: null, problem: true, success: false,
    retry: true, label: t('c916', { reason }) };
}

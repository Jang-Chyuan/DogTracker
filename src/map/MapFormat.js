import { t } from '../i18n';
// Times in the history panels.
export function formatTime(value) {
  return Number.isFinite(value)
    ? new Date(value).toLocaleString('zh-TW', { hour12: false })
    : t("c761");
}

// A moment of today as 「10:12」 (local time).
export function formatClock(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Hermes may lack locale data (toLocaleString), so the 診斷 pages spell
// dates and times out themselves: 「2026/10/07」「09:29:45」.
const two = value => String(value).padStart(2, '0');
export function formatClockSeconds(at) {
  return `${formatClock(at)}:${two(new Date(at).getSeconds())}`;
}
export function formatDate(at) {
  const date = new Date(at);
  return `${date.getFullYear()}/${two(date.getMonth() + 1)}/${two(date.getDate())}`;
}
export const formatDateTime = at => `${formatDate(at)} ${formatClockSeconds(at)}`;
// 1842 → 「1,842」.
export const formatCount = value => String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

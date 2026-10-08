// Times in the history panels.
export function formatTime(value) {
  return Number.isFinite(value)
    ? new Date(value).toLocaleString('zh-TW', { hour12: false })
    : '尚無資料';
}

// A moment of today as 「10:12」 (local time).
export function formatClock(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

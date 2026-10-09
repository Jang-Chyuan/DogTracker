// Times in the history panels.
export function formatTime(value) {
  return Number.isFinite(value)
    ? new Date(value).toLocaleString('zh-TW', { hour12: false })
    : '尚無資料';
}

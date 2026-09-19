// Shared by the sheet, the dog list and the master panel; kept out of
// TrackingSheet so those modules do not have to import the sheet itself.
export function formatTime(value) {
  return Number.isFinite(value)
    ? new Date(value).toLocaleString('zh-TW', { hour12: false })
    : '尚無資料';
}

/**
 * What a row says about a position. Not the coordinates: they are drawn on the
 * map right next to this card, and six decimal places tell nobody anything.
 */
export function positionLabel(position) {
  if (!position) return '尚無有效座標';
  return position.retained
    ? `最後有效位置 ${formatTime(position.receivedAt)}`
    : `最後更新 ${formatTime(position.receivedAt)}`;
}

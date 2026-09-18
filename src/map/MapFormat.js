// Shared by the sheet, the dog list and the master panel; kept out of
// TrackingSheet so those modules do not have to import the sheet itself.
export function positionLabel(position) {
  if (!position) return '尚無有效座標';
  const { latitude, longitude } = position.coordinate;
  return latitude.toFixed(6) + ', ' + longitude.toFixed(6);
}

export function formatTime(value) {
  return Number.isFinite(value)
    ? new Date(value).toLocaleString('zh-TW', { hour12: false })
    : '尚無資料';
}

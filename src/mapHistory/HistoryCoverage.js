const time = value => new Date(value).toLocaleString();

// The history map reads local SQLite only. Automatic sync keeps the last 24
// hours, older days arrive through 設定 → 雲端資料, and both tables are trimmed
// by retention, so a selected range can be missing rows the cloud still holds.
// Saying so is the difference between "the dog was not there" and "this phone
// never downloaded it".
export function coverageNotice(data) {
  const coverage = data?.coverage;
  if (!coverage) return '';
  const place = coverage.source === 'cloud' ? '本機雲端副本' : '本機 BLE 資料';
  const fix = coverage.source === 'cloud'
    ? '更早的資料請到「設定 → 雲端資料」下載該日期。'
    : '每隻 Slave 只保留最新 10,000 筆，較早的已被清除。';
  if (!coverage.rows) {
    return `${place}沒有這台 Master／Slave 的任何紀錄，畫面與匯出都會是空的。${fix}`;
  }
  if (coverage.from != null && coverage.from > data.since) {
    return `${place}最早只到 ${time(coverage.from)}；在那之前的資料不在這支手機上，`
      + `畫面與匯出都不會包含。${fix}`;
  }
  return '';
}

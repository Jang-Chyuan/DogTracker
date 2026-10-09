import { activeSubjects, subjectName } from './ExportData';
const pad = value => String(value).padStart(2, '0');
// `timeZone` null: the phone's own zone (what the screen's clock() shows; the
// app passes null, tests a named zone).
export function localDateParts(time, timeZone = 'UTC') {
  if (timeZone == null) {
    const at = new Date(time);
    return { year: String(at.getFullYear()), month: pad(at.getMonth() + 1), day: pad(at.getDate()),
      hour: pad(at.getHours()), minute: pad(at.getMinutes()), weekday: at.getDay() };
  }
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(time).map(part => [part.type, part.value]));
}
const dateKey = parts => `${parts.year}${parts.month}${parts.day}`;
export function buildExportFilename(snapshot, format, page = null) {
  if (!['gpx', 'csv', 'png'].includes(format)) throw new Error('不支援的匯出格式');
  if (page != null && (format !== 'png' || !Number.isInteger(page) || page < 1)) throw new Error('頁碼無效');
  const subjects = activeSubjects(snapshot);
  const label = subjects.length === 1 ? subjectName(subjects[0]) : '狗的歷史';
  const stamp = time => { const p = localDateParts(time, snapshot.timeZone); return `${dateKey(p)}-${p.hour}${p.minute}`; };
  return `DogTracker_${Array.from(label).map(char => char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char).join('')}_${stamp(snapshot.since)}_${stamp(snapshot.until)}${page == null ? '' : `_${page}`}.${format}`;
}
// Cache directory is selected by the platform. No clock, random ID or I/O here.
// A caller-supplied unique exportId isolates concurrent exports with the same name.
export function buildTempFile(snapshot, format, { createdAt, exportId, page = null }) {
  if (!Number.isFinite(createdAt) || !/^[a-zA-Z0-9_-]+$/.test(exportId || '')) throw new Error('暫存檔識別無效');
  return { directory: `history_exports/${exportId}`, filename: buildExportFilename(snapshot, format, page), createdAt };
}
export function shouldCleanupExport(file, now, timeZone = null) {
  if (!Number.isFinite(file.createdAt) || !Number.isFinite(now)) return false;
  return dateKey(localDateParts(file.createdAt, timeZone)) < dateKey(localDateParts(now, timeZone));
}

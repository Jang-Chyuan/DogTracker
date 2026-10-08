import { activeSubjects, clippedIntervals, exportRows, gpsTime, inInterval, rawCoordinate, subjectName } from './ExportData';
import { mergeHistoryFixes } from '../history/HistorySources';
import { coordinate } from '../tracking/RouteSamples';
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const iso = time => new Date(time).toISOString();
const minutes = ms => Math.round(ms / 60000);
function waypoint(subject, item, piece, hold, gaps) {
  const position = coordinate(item.latitude, item.longitude);
  if (!position) return '';
  const excluded = hold ? 0 : Number.isFinite(item.excludedMs) ? item.excludedMs : gaps.reduce((sum, gap) => sum + Math.max(0, Math.min(piece.end, gap.end) - Math.max(piece.start, gap.start)), 0);
  const prefix = subject.kind === 'phone' ? '' : `${subjectName(subject)} `;
  const name = `${prefix}${hold ? '室內' : `停留 ${item.number}`}・${minutes(piece.end - piece.start - excluded)} 分`;
  const desc = [item.address, excluded ? `不含中斷 ${minutes(excluded)} 分` : null].filter(Boolean).join('・');
  return `<wpt lat="${position.latitude}" lon="${position.longitude}"><time>${iso(piece.start)}</time><name>${xml(name)}</name>${desc ? `<desc>${xml(desc)}</desc>` : ''}</wpt>`;
}
function track(subject, name, type, segments) {
  if (!segments.length) return '';
  return `<trk><name>${xml(name)}</name>${type ? `<type>${type}</type>` : ''}${segments.map(segment => `<trkseg>${segment.map(row => {
    const p = rawCoordinate(row, subject);
    return `<trkpt lat="${p.latitude}" lon="${p.longitude}">${Number.isFinite(row.altitude_meters) ? `<ele>${row.altitude_meters}</ele>` : ''}<time>${iso(gpsTime(row))}</time></trkpt>`;
  }).join('')}</trkseg>`).join('')}</trk>`;
}
export function buildGPX(snapshot) {
  const subjects = activeSubjects(snapshot), wpts = [], tracks = [];
  for (const subject of subjects) {
    const holds = subject.holds || [], rides = subject.rides || [], gaps = subject.gaps || [];
    for (const hold of holds) for (const piece of clippedIntervals(hold, snapshot, gaps)) wpts.push(waypoint(subject, hold, piece, true, gaps));
    for (const stay of subject.stays || []) for (const piece of clippedIntervals(stay, snapshot)) wpts.push(waypoint(subject, stay, piece, false, gaps));
    const groups = new Map();
    // The same collar fix repeated in later packets (or the same packet from
    // this phone and the cloud) is one trkpt (判定表「同一隻狗本機和雲端同時有」).
    // Deduplicated, then in GPS order again (a delayed packet's fix belongs
    // where it was taken, not where it arrived).
    const rows = mergeHistoryFixes(exportRows(subject, snapshot)).sort((a, b) => gpsTime(a) - gpsTime(b));
    let previous = null, previousKey = null, segment = null;
    for (const row of rows) {
      const time = gpsTime(row), p = rawCoordinate(row, subject);
      const ride = rides.findIndex(item => inInterval(time, item));
      const hold = holds.findIndex(item => inInterval(time, item));
      const key = ride < 0 ? 'move' : `ride-${ride}`;
      const state = `${key}/hold-${hold}`;
      // A break (沒有資料) splits the segment; the fixes at its ends stay.
      if (!p) { previous = null; segment = null; continue; }
      const broken = !previous || previousKey !== state || time - gpsTime(previous) > 180000 || row.session_id !== previous.session_id ||
        gaps.some(gap => gap.start >= gpsTime(previous) && gap.start < time) ||
        [...holds, ...rides].some(item => [item.start, item.end].some(boundary => boundary > gpsTime(previous) && boundary <= time));
      if (broken || !segment) {
        segment = [];
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(segment);
      }
      segment.push(row); previous = row; previousKey = state;
    }
    tracks.push(track(subject, subjectName(subject), null, groups.get('move') || []));
    let number = 0;
    rides.forEach((ride, index) => {
      const segments = groups.get(`ride-${index}`) || [];
      if (!segments.length) return;
      number += 1;
      tracks.push(track(subject, `${subject.kind === 'phone' ? '' : `${subjectName(subject)} `}${subject.kind === 'phone' ? '開車' : '坐車'} ${number}（不算距離）`, 'drive', segments));
    });
  }
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="DogTracker" xmlns="http://www.topografix.com/GPX/1/1">', ...wpts.filter(Boolean), ...tracks.filter(Boolean), '</gpx>'].join('\n');
}

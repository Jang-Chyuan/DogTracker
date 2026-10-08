import { colors, routeColors } from '../theme/tokens';
import { activeSubjects, displayName } from './ExportData';
import { localDateParts } from './ExportFiles';

export const PNG_STYLE = {
  width: 1080, maxHeight: 2400, mapHeight: 1080, footerHeight: 60,
  timeColumn: 150, trackColumn: 80, titleFont: 40, addressFont: 40,
  timeFont: 36, detailFont: 30, nodeSize: 64, movementIcon: 72,
  legendFont: 28, sectionFont: 36, footerFont: 24,
  text: colors.text, textMuted: colors.textMuted, background: colors.surface,
  holdText: colors.receiver, manualText: colors.tonalText, warningText: colors.warn,
  dottedLine: { diameter: 9, gap: 21 }, driveLine: 9, gapLine: { width: 6, dash: [18, 12] },
};
// Deterministic conservative measurement; a renderer can supply font measurements.
const defaultMeasure = (text, fontSize) => Array.from(String(text)).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? fontSize : fontSize * 0.6), 0);
function wrap(text, fontSize, width, measure, maxLines = Infinity) {
  const lines = [''];
  for (const char of Array.from(String(text || ''))) {
    if (char === '\n' || measure(lines[lines.length - 1] + char, fontSize) > width) {
      if (lines.length === maxLines) {
        while (measure(lines[lines.length - 1] + '…', fontSize) > width) lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
        lines[lines.length - 1] += '…'; break;
      }
      lines.push(char === '\n' ? '' : char);
    } else lines[lines.length - 1] += char;
  }
  return lines;
}
const clock = p => `${p.hour}:${p.minute}`;
export function buildPNGLayout(snapshot, { measureText = defaultMeasure } = {}) {
  const subjects = activeSubjects(snapshot), multi = subjects.length > 1;
  if (!subjects.length) return { ...PNG_STYLE, pages: [] };
  const start = localDateParts(snapshot.since, snapshot.timeZone), end = localDateParts(snapshot.until, snapshot.timeZone);
  const title = `DogTracker・${multi ? `狗的歷史（${subjects.length} 隻）` : displayName(subjects[0])}・${start.year}/${start.month}/${start.day} ${clock(start)}–${clock(end)}${multi ? '' : `・${subjects[0].distanceKm ?? 0} km`}`;
  const titleLines = wrap(title, 40, 984, measureText), titleHeight = Math.max(120, titleLines.length * 48 + 24);
  const legend = []; let legendX = 48, legendY = 0;
  if (multi) subjects.forEach((subject, index) => {
    const text = `${subject.name || `狗 ${subject.slaveId}`} ${subject.distanceKm ?? 0} km`;
    const width = Math.min(984, measureText(text, 28) + 64);
    if (legendX + width > 1032 && legendX > 48) { legendX = 48; legendY += 56; }
    const lines = wrap(text, 28, width - 40, measureText);
    legend.push({ subjectIndex: index, text, lines, x: legendX, y: legendY, width, height: Math.max(56, lines.length * 34), color: subject.routeColor || routeColors[index % 4], textColor: colors.text, distanceColor: colors.textMuted });
    legendX += width;
    if (lines.length > 1) { legendX = 48; legendY += Math.max(56, lines.length * 34); }
  });
  const legendHeight = multi ? Math.max(...legend.map(item => item.y + item.height)) : 0;
  const baseHeight = titleHeight + legendHeight;
  if (baseHeight + 1080 + 60 > 2400) throw new Error('標題或圖例超過可用高度');
  const pages = [];
  function newPage() {
    const map = pages.length === 0;
    const page = { width: 1080, title, titleLines, titleHeight, legend, legendHeight, blocks: [], height: baseHeight + (map ? 1080 : 0) };
    if (map) page.blocks.push({ type: 'map', y: baseHeight, height: 1080, width: 1080,
      subjects, padding: 72, attribution: '© Google', timeMarkers: multi ? 'endpoints' : 'all', cursor: null, fadeByCursor: false, fallback: 'blank-with-scale' });
    pages.push(page); return page;
  }
  let page = newPage();
  function add(block) { page.blocks.push({ ...block, y: page.height }); page.height += block.height; }
  subjects.forEach((subject, subjectIndex) => {
    const rows = (subject.timeline || []).map(row => {
      const movement = ['move', 'ride', 'drive', 'gap'].includes(row.type);
      const addressLines = wrap(row.address || row.title || (row.latitude != null ? `${row.latitude}, ${row.longitude}` : ''), movement ? 30 : 40, 754, measureText, 2);
      const detailLines = wrap(row.detail || '', 30, 754, measureText, 2);
      return { type: 'row', subjectIndex, row: { ...row, label: row.label === '現在' ? '結束' : row.label }, addressLines, detailLines,
        height: Math.max(movement ? 96 : 140, addressLines.length * (movement ? 36 : 48) + detailLines.length * 36 + (movement ? 24 : 56)) };
    });
    const section = continued => ({ type: 'section', subjectIndex, title: `${subject.name || displayName(subject)}${continued ? '（續）' : ''}`, height: 72, color: subject.routeColor || routeColors[subjectIndex % 4], start: subject.start ?? snapshot.since, end: subject.end ?? snapshot.until, distanceKm: subject.distanceKm ?? 0, stripeWidth: 4, textColor: colors.text, detailColor: colors.textMuted });
    if (!rows.length) return;
    if (page.height + (multi ? 72 : 0) + rows[0].height + 60 > 2400) page = newPage();
    if (multi) add(section(false));
    rows.forEach((row, index) => {
      if (page.height + row.height + 60 > 2400) { page = newPage(); if (multi) add(section(index > 0)); }
      add(row);
    });
  });
  pages.forEach((item, index) => {
    item.footer = { y: item.height, height: 60, text: '停留＝待得比這條路線一般地方久很多的地方', page: `${index + 1}/${pages.length}`, textColor: colors.textMuted };
    item.height += 60;
  });
  return { ...PNG_STYLE, pages };
}

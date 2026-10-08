// The PNG layout (H10a/H10b; 判定表「PNG 尺寸」「PNG 內容」「PNG 分頁」
// 「時間軸清單（匯出 PNG）」): pages 1080px wide of title, legend (several
// dogs), the 1080×1080 map (page 1 only), the list rows and the footer, with
// every text already broken into lines. Pure: `measureText(text, size, bold)`
// gives a text's width in px (the renderer's font widths, ExportDraw);
// ExportDraw turns the layout into drawing operations.
import { colors, routeColors } from '../theme/tokens';
import { activeSubjects, displayName } from './ExportData';
import { localDateParts } from './ExportFiles';

export const PNG_STYLE = {
  width: 1080, maxHeight: 2400, mapHeight: 1080, footerHeight: 60, side: 48,
  timeColumn: 150, trackColumn: 80, titleFont: 40, titleWeight: 'bold', subtitleFont: 28, fontFamily: 'app',
  addressWeight: 'bold', addressFont: 40, addressLine: 52, timeFont: 36, endTimeFont: 28, detailFont: 30,
  detailLine: 42, pillHeight: 52, pillPadding: 20, secondLine: 64, nodeSize: 64, movementIcon: 72,
  legendFont: 28, legendWeight: 'bold', legendHeight: 56, sectionFont: 36, sectionDetailFont: 28,
  sectionWeight: 'bold', sectionHeight: 72, footerFont: 24, placeMin: 140, movementMin: 96, rowGap: 36,
  text: colors.text, textMuted: colors.textMuted, background: colors.surface,
  holdText: colors.receiver, manualText: colors.tonalText, warningText: colors.warn,
  dottedLine: { diameter: 9, gap: 21 }, driveLine: 9, gapLine: { width: 6, dash: [18, 12] },
};
const S = PNG_STYLE;
// The place column: from after the track column to the right margin.
export const PLACE_X = S.timeColumn + S.trackColumn + 24;
export const PLACE_WIDTH = S.width - PLACE_X - S.side;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const FOOTER = '停留＝待得比這條路線一般地方久很多的地方';

// Deterministic conservative measurement for tests; the app passes font widths.
export const defaultMeasure = (text, size) => Array.from(String(text)).reduce((width, char) =>
  width + (char.charCodeAt(0) > 255 ? size : size * 0.6), 0);

/** Lines of `text` no wider than `width` (a CJK text breaks anywhere; a word of Latin letters stays whole when it can). */
export function wrap(text, size, width, measure, { bold = false, maxLines = Infinity } = {}) {
  const lines = [''];
  const chars = Array.from(String(text ?? ''));
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    const line = lines[lines.length - 1];
    if (char === '\n' || (line && measure(line + char, size, bold) > width)) {
      if (lines.length === maxLines) {
        let cut = line;
        while (cut && measure(cut + '…', size, bold) > width) cut = cut.slice(0, -1);
        lines[lines.length - 1] = cut + '…';
        return lines;
      }
      // Keep 「1132」「km」 together: move a word of letters or digits being cut to the next line.
      const word = char !== '\n' && /[\w.]/.test(char) ? line.match(/[\w.]+$/)?.[0] : null;
      if (word && word.length < line.length) {
        lines[lines.length - 1] = line.slice(0, -word.length).replace(/\s+$/, '');
        lines.push(word + char);
      } else lines.push(char === '\n' || char === ' ' ? '' : char);
    } else lines[lines.length - 1] = line + char;
  }
  return lines;
}

const clock = p => `${p.hour}:${p.minute}`;

/** The two title lines: who, then the date, the times and (one subject) the distance. */
export function pngTitle(snapshot, subjects) {
  const start = localDateParts(snapshot.since, snapshot.timeZone), end = localDateParts(snapshot.until, snapshot.timeZone);
  const weekday = start.weekday ?? new Date(Date.UTC(+start.year, +start.month - 1, +start.day)).getUTCDay();
  const date = `${+start.year}/${+start.month}/${+start.day}（${WEEKDAYS[weekday]}）${clock(start)}–${clock(end)}`;
  if (subjects.length > 1) return { title: `DogTracker・狗的歷史（${subjects.length} 隻）`, subtitle: date };
  const one = subjects[0];
  return { title: `DogTracker・${displayName(one)}`, subtitle: `${date}・${one.distanceWord || '移動'} ${one.distanceKm}` };
}

/** One list row laid out: its height and lines (判定表「時間軸清單（匯出 PNG）」). */
export function layoutRow(row, measure, { truncate = false } = {}) {
  if (row.kind === 'section') {
    const text = `${row.lead}${row.time ? ` ${row.time}` : ''}${row.rest}`;
    const lines = wrap(text, S.detailFont, PLACE_WIDTH - S.movementIcon, measure, { bold: false });
    return { lines, height: Math.max(S.movementMin, lines.length * S.detailLine + 54) };
  }
  // 「PNG 一列比一頁還高」: the address is cut after 2 lines (in the PNG only).
  const titleLines = wrap(row.title, S.addressFont, PLACE_WIDTH, measure, { bold: true, maxLines: truncate ? 2 : Infinity });
  // The second line: the pill, then the coordinates / 查不到地址 / 不含中斷, flowing.
  const items = [
    row.pill ? { kind: 'pill', text: row.pill.text, tone: row.pill.tone,
      width: measure(row.pill.text, S.detailFont, true) + S.pillPadding * 2 } : null,
    ...[row.coordinates, row.missing, row.note].filter(Boolean).map(text => ({ kind: 'note', text,
      width: Math.min(PLACE_WIDTH, measure(text, S.detailFont, false)) })),
  ].filter(Boolean);
  const placed = [];
  let x = 0, line = 0;
  for (const item of items) {
    if (x > 0 && x + item.width > PLACE_WIDTH) { x = 0; line += 1; }
    placed.push({ ...item, x, line });
    x += item.width + 20;
  }
  const secondLines = items.length ? line + 1 : 0;
  const height = Math.max(S.placeMin, 8 + titleLines.length * S.addressLine + 8 + secondLines * S.secondLine + S.rowGap);
  return { titleLines, items: placed, secondLines, height };
}

/**
 * The pages. Returns { ...PNG_STYLE, pages: [{ width, height, title, legend,
 * blocks: [{ type: 'map' | 'section' | 'row', y, height, ... }], footer }] }.
 */
export function buildPNGLayout(snapshot, { measureText = defaultMeasure } = {}) {
  const subjects = activeSubjects(snapshot), multi = subjects.length > 1;
  if (!subjects.length) return { ...PNG_STYLE, pages: [] };
  const measure = measureText;
  const head = pngTitle(snapshot, subjects);
  const titleLines = wrap(head.title, S.titleFont, S.width - 2 * S.side, measure, { bold: true });
  const subtitleLines = wrap(head.subtitle, S.subtitleFont, S.width - 2 * S.side, measure);
  const titleHeight = Math.max(120, 32 + titleLines.length * 52 + 8 + subtitleLines.length * 38 + 24);
  // 圖例: a route-colour swatch, the name (bold) and its distance per dog;
  // a row that does not fit goes on to the next (判定表「PNG 圖例放不下」).
  const legend = [];
  let legendX = S.side, legendRow = 0;
  if (multi) subjects.forEach((subject, index) => {
    const name = subject.name, distance = subject.distanceKm;
    const nameWidth = Math.min(S.width - 2 * S.side - 160, measure(name, S.legendFont, true));
    const width = 44 + nameWidth + 12 + measure(distance, S.legendFont, false) + 40;
    if (legendX + width > S.width - S.side && legendX > S.side) { legendX = S.side; legendRow += 1; }
    legend.push({ subjectIndex: index, name, distance, nameWidth, x: legendX, y: legendRow * S.legendHeight,
      width, height: S.legendHeight, color: subject.routeColor || routeColors[index % 4] });
    legendX += width;
  });
  const legendHeight = multi ? (legendRow + 1) * S.legendHeight + 16 : 0;
  const top = titleHeight + legendHeight;
  if (top + S.mapHeight + S.footerHeight > S.maxHeight) throw new Error('標題或圖例超過可用高度');
  const room = S.maxHeight - S.footerHeight;
  const pages = [];
  let page = null;
  function newPage() {
    const first = pages.length === 0;
    page = { width: S.width, title: head.title, subtitle: head.subtitle, titleLines, subtitleLines, titleHeight,
      legend, legendHeight, blocks: [], height: top };
    if (first) {
      page.blocks.push({ type: 'map', y: top, height: S.mapHeight, width: S.width, padding: 72,
        subjects: subjects.map((subject, index) => ({ ...subject.map, color: subject.routeColor || routeColors[index % 4] })),
        holds: subjects.flatMap(subject => subject.holds || []),
        timeMarkers: multi ? 'endpoints' : 'all', cursor: null, fadeByCursor: false,
        attribution: '© Google', scale: true, north: true, fallback: 'blank-with-scale' });
      page.height += S.mapHeight;
    }
    pages.push(page);
  }
  newPage();
  const add = block => { page.blocks.push({ ...block, y: page.height }); page.height += block.height; };
  subjects.forEach((subject, subjectIndex) => {
    const color = subject.routeColor || routeColors[subjectIndex % 4];
    const rows = (subject.timeline || []).map(row => {
      let laid = layoutRow(row, measure);
      if (laid.height > room - top - (multi ? S.sectionHeight : 0)) laid = layoutRow(row, measure, { truncate: true });
      if (laid.height > room - top - (multi ? S.sectionHeight : 0)) throw new Error('清單列超過可用高度');
      return { type: 'row', subjectIndex, color, row, ...laid };
    });
    if (!rows.length) return;
    const span = subject.start != null ? `${clock(localDateParts(subject.start, snapshot.timeZone))}–${clock(localDateParts(subject.end, snapshot.timeZone))}` : '';
    const section = continued => ({ type: 'section', subjectIndex, color, height: S.sectionHeight,
      title: `${subject.name}${continued ? '（續）' : ''}`, detail: `${span}・${subject.distanceKm}` });
    // 判定表「PNG 第 1 張放不下清單」: the header goes with the first row.
    if (page.height + (multi ? S.sectionHeight : 0) + rows[0].height > room) newPage();
    if (multi) add(section(false));
    rows.forEach((row, index) => {
      if (page.height + row.height > room) { newPage(); if (multi) add(section(index > 0)); }
      add(row);
    });
  });
  pages.forEach((item, index) => {
    item.footer = { y: item.height, height: S.footerHeight, text: FOOTER, page: `${index + 1}/${pages.length}` };
    item.height += S.footerHeight;
  });
  return { ...PNG_STYLE, pages };
}

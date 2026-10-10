import { t } from '../i18n';
import { size as tokenSize } from '../theme/tokens';
// The PNG layout (H10a/H10b; 判定表「PNG 尺寸」「PNG 內容」「PNG 分頁」
// 「時間軸清單（匯出 PNG）」): pages 1080px wide of title, legend (several
// dogs), the 1080×1080 map (page 1 only), the list rows and the footer, with
// every text already broken into lines. Pure: `measureText(text, size, bold)`
// gives a text's width in px (the renderer's font widths, ExportDraw);
// ExportDraw turns the layout into drawing operations.
import {
  exportColors as colors,
  exportRouteColors as routeColors,
} from '../theme/exportPalette';
import { activeSubjects, displayName } from './ExportData';
import { localDateParts } from './ExportFiles';

export const PNG_STYLE = {
  width: tokenSize.export.width, maxHeight: tokenSize.export.maxHeight, mapHeight: tokenSize.export.mapHeight, footerHeight: tokenSize.export.footerHeight, side: tokenSize.export.side,
  timeColumn: tokenSize.export.timeColumn, trackColumn: tokenSize.export.trackColumn, titleFont: tokenSize.export.titleFont, titleWeight: tokenSize.export.titleWeight, subtitleFont: tokenSize.export.subtitleFont, fontFamily: tokenSize.export.fontFamily,
  addressWeight: tokenSize.export.addressWeight, addressFont: tokenSize.export.addressFont, addressLine: tokenSize.export.addressLine, timeFont: tokenSize.export.timeFont, endTimeFont: tokenSize.export.endTimeFont, detailFont: tokenSize.export.detailFont,
  detailLine: tokenSize.export.detailLine, pillHeight: tokenSize.export.pillHeight, pillPadding: tokenSize.export.pillPadding, secondLine: tokenSize.export.secondLine, nodeSize: tokenSize.export.nodeSize, movementIcon: tokenSize.export.movementIcon,
  legendFont: tokenSize.export.legendFont, legendWeight: tokenSize.export.legendWeight, legendHeight: tokenSize.export.legendHeight, sectionFont: tokenSize.export.sectionFont, sectionDetailFont: tokenSize.export.sectionDetailFont,
  sectionWeight: tokenSize.export.sectionWeight, sectionHeight: tokenSize.export.sectionHeight, footerFont: tokenSize.export.footerFont, placeMin: tokenSize.export.placeMin, movementMin: tokenSize.export.movementMin, rowGap: tokenSize.export.rowGap,
  text: colors.text, textMuted: colors.textMuted, background: colors.surface,
  holdText: colors.receiver, warningText: colors.warn,
  dottedLine: tokenSize.export.dottedLine, driveLine: tokenSize.export.driveLine, gapLine: tokenSize.export.gapLine,
};
const S = PNG_STYLE;
// The place column: from after the track column to the right margin.
export const PLACE_X = S.timeColumn + S.trackColumn + tokenSize.export.sectionInset;
export const PLACE_WIDTH = S.width - PLACE_X - S.side;
const WEEKDAYS = [t("c444"), t("c687"), t("c688"), t("c689"), t("c690"), t("c691"), t("c692")];

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
  if (subjects.length > 1) return { title: t("c796", { length: subjects.length }), subtitle: date };
  const one = subjects[0];
  return { title: t('c1156', { name: displayName(one) }), subtitle: t('c1157', { date, movement: one.distanceWord || t('c125'), distance: one.distanceKm, exclusion: one.distanceExclusion || '' }) };
}

/** One list row laid out: its height and lines (判定表「時間軸清單（匯出 PNG）」). */
export function layoutRow(row, measure, { truncate = false } = {}) {
  if (row.kind === 'section') {
    const text = `${row.lead}${row.time ? ` ${row.time}` : ''}${row.rest}`;
    const lines = wrap(text, S.detailFont, PLACE_WIDTH - S.movementIcon, measure, { bold: false });
    return { lines, height: Math.max(S.movementMin, lines.length * S.detailLine + tokenSize.export.movementInset) };
  }
  // 「PNG 一列比一頁還高」: the address is cut after 2 lines (in the PNG only).
  const titleLines = wrap(row.title, S.addressFont, PLACE_WIDTH, measure, { bold: true, maxLines: truncate ? 2 : Infinity });
  // The second line: the pill, then the coordinates / 不含中斷, flowing.
  const items = [
    row.pill ? { kind: 'pill', text: row.pill.text, tone: row.pill.tone,
      width: measure(row.pill.text, S.detailFont, true) + S.pillPadding * 2 } : null,
    ...[row.coordinates, row.note].filter(Boolean).map(text => ({ kind: 'note', text,
      width: Math.min(PLACE_WIDTH, measure(text, S.detailFont, false)) })),
  ].filter(Boolean);
  const placed = [];
  let x = 0, line = 0;
  for (const item of items) {
    if (x > 0 && x + item.width > PLACE_WIDTH) { x = 0; line += 1; }
    placed.push({ ...item, x, line });
    x += item.width + tokenSize.export.itemGap;
  }
  const secondLines = items.length ? line + 1 : 0;
  const height = Math.max(S.placeMin, tokenSize.export.rowInset + titleLines.length * S.addressLine + tokenSize.export.rowInset + secondLines * S.secondLine + S.rowGap);
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
  const titleHeight = Math.max(tokenSize.export.headerMin, tokenSize.export.headerTop + titleLines.length * tokenSize.export.titleLine + tokenSize.export.titleGap + subtitleLines.length * tokenSize.export.subtitleLine + tokenSize.export.headerBottom);
  // 圖例: a route-colour swatch, the name (bold) and its distance per dog;
  // a row that does not fit goes on to the next (判定表「PNG 圖例放不下」).
  const legend = [];
  let legendX = S.side, legendRow = 0;
  if (multi) subjects.forEach((subject, index) => {
    const name = subject.name, distance = subject.distanceKm;
    const nameWidth = Math.min(S.width - 2 * S.side - tokenSize.export.legendReserve, measure(name, S.legendFont, true));
    const width = tokenSize.export.legendTextInset + nameWidth + tokenSize.export.legendGap + measure(distance, S.legendFont, false) + tokenSize.export.legendTrailing;
    if (legendX + width > S.width - S.side && legendX > S.side) { legendX = S.side; legendRow += 1; }
    legend.push({ subjectIndex: index, name, distance, nameWidth, x: legendX, y: legendRow * S.legendHeight,
      width, height: S.legendHeight, color: subject.routeColor || routeColors[index % 4] });
    legendX += width;
  });
  const legendHeight = multi ? (legendRow * S.legendHeight + S.legendHeight) + tokenSize.export.legendBottom : 0;
  const top = titleHeight + legendHeight;
  if (top + S.mapHeight + S.footerHeight > S.maxHeight) throw new Error(t("c794"));
  const room = S.maxHeight - S.footerHeight;
  const pages = [];
  let page = null;
  function newPage() {
    const first = pages.length === 0;
    page = { width: S.width, title: head.title, subtitle: head.subtitle, titleLines, subtitleLines, titleHeight,
      legend, legendHeight, blocks: [], height: top };
    if (first) {
      // 128 px keeps every route point clear of the 指北 disc (centre 72 px in
      // from the top-right corner, radius 40) and endpoint labels inside the frame.
      page.blocks.push({ type: 'map', y: top, height: S.mapHeight, width: S.width, padding: tokenSize.export.mapInset,
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
      if (laid.height > room - top - (multi ? S.sectionHeight : 0)) throw new Error(t("c795"));
      return { type: 'row', subjectIndex, color, row, ...laid };
    });
    if (!rows.length) return;
    const span = subject.start != null ? `${clock(localDateParts(subject.start, snapshot.timeZone))}–${clock(localDateParts(subject.end, snapshot.timeZone))}` : '';
    // 段頭: the name (36px bold) and 「08:03–12:11・7.3 km」 (28px) on one line,
    // the times under the name when a long name leaves no room.
    const section = continued => {
      const title = ((continued) ? t("c776", { name: subject.name }) : t('c056', { dogName: subject.name })), detail = `${span}・${subject.distanceKm}${subject.distanceExclusion || ''}`;
      const width = S.width - 2 * S.side - tokenSize.export.sectionTextInset;
      const nameLines = wrap(title, S.sectionFont, width, measure, { bold: true });
      const oneLine = nameLines.length === 1 && measure(`${title}  ${detail}`, S.sectionFont, true) <= width;
      const lines = oneLine ? 1 : nameLines.length + 1;
      return { type: 'section', subjectIndex, color, title, detail, titleLines: nameLines, oneLine,
        height: Math.max(S.sectionHeight, tokenSize.export.sectionInset + lines * tokenSize.export.sectionLine) };
    };
    // 判定表「PNG 第 1 張放不下清單」: the header goes with the first row.
    if (page.height + (multi ? section(false).height : 0) + rows[0].height > room) newPage();
    if (multi) add(section(false));
    rows.forEach((row, index) => {
      if (page.height + row.height > room) {
        newPage();
        if (multi) add(section(index > 0));
      }
      add(row);
    });
  });
  pages.forEach((item, index) => {
    item.footer = { y: item.height, height: S.footerHeight, page: `${index + 1}/${pages.length}` };
    item.height += S.footerHeight;
  });
  return { ...PNG_STYLE, pages };
}

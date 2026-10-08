// The PNG pages as drawing operations for the native renderer
// (HistoryExportPackage.kt): text lines, circles, rectangles, lines, the list
// icons and the map block. Pure: everything is placed here so the Kotlin side
// only paints, and a test can read what each page holds. Colours come from
// the theme tokens only.
import { exportColors as colors } from '../theme/exportPalette';
import { withAlpha } from '../history/screen/HistoryMapModel';
import { PLACE_X, PNG_STYLE as S } from './ExportPNG';

// The list's icons on a 24-unit grid (the same shapes as map/Glyph.js), as
// path data the renderer strokes 2 units wide (dots are filled).
export const EXPORT_ICONS = {
  walk: { stroke: 'M14.8 4.5a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 1 1 3.6 0M10 21l2-6 3 3v3M8 12l2-4 4 1 2 4 2 1M12 15l-1-4' },
  paw: { stroke: 'M8.5 10a2 2 0 1 1-4 0a2 2 0 1 1 4 0M12 5.5a2 2 0 1 1-4 0a2 2 0 1 1 4 0M16 5.5a2 2 0 1 1-4 0a2 2 0 1 1 4 0M19.5 10a2 2 0 1 1-4 0a2 2 0 1 1 4 0M12 12c-3 0-5.5 3.2-5.5 5.4 0 1.6 1.3 2.6 2.8 2.6 1 0 1.7-.5 2.7-.5s1.7.5 2.7.5c1.5 0 2.8-1 2.8-2.6C17.5 15.2 15 12 12 12z' },
  car: { stroke: 'M3 16v-3.5l2-1 2.5-4h7l3.5 4 3 .8V16h-1.5M7.5 16h7M7.8 16.5a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 1 1 3.6 0M18.3 16.5a1.8 1.8 0 1 1-3.6 0a1.8 1.8 0 1 1 3.6 0' },
  dots: { fill: 'M6.6 12a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0M13.6 12a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0M20.6 12a1.6 1.6 0 1 1-3.2 0a1.6 1.6 0 1 1 3.2 0' },
  house: { stroke: 'M4 11l8-7 8 7M6.5 9.5V20h11V9.5' },
};

const TRACK_X = S.timeColumn + S.trackColumn / 2;
const text = (value, x, y, height, size, color, { bold = false, align = 'left', halo = null } = {}) =>
  ({ t: 'text', text: value, x, y, h: height, size, bold, color, align, halo });

// 判定表「PNG 時間軸的線」: dots 9px every 30px, a car 9px solid, no data 6px dashes 18/12.
function trackOps(kind, color, from, to) {
  if (!kind || to <= from) return [];
  if (kind === 'solid') return [{ t: 'line', x1: TRACK_X, y1: from, x2: TRACK_X, y2: to, color, width: S.driveLine }];
  if (kind === 'gap') return [{ t: 'line', x1: TRACK_X, y1: from, x2: TRACK_X, y2: to, color: colors.noDataLine,
    width: S.gapLine.width, dash: S.gapLine.dash }];
  const ops = [];
  const step = S.dottedLine.diameter + S.dottedLine.gap;
  // On one grid down the page, so a row's dots run on into the next row's.
  for (let y = Math.ceil((from - step / 2) / step) * step + step / 2; y < to; y += step) ops.push({ t: 'circle', cx: TRACK_X, cy: y, r: S.dottedLine.diameter / 2, fill: color });
  return ops;
}

// The list's nodes three times the screen's size (判定表「時間軸清單（匯出 PNG）」:
// 停留和停在原處節點 64px).
function nodeOps(row, color, cy) {
  const cx = TRACK_X;
  switch (row.type) {
    case 'departure':
      return [{ t: 'circle', cx, cy, r: 22, fill: colors.surface, stroke: color, strokeWidth: 8 }];
    case 'stop':
    case 'switch':
      return [{ t: 'circle', cx, cy, r: S.nodeSize / 2, fill: color, stroke: colors.surface, strokeWidth: 6 },
        text(String(row.number ?? ''), cx, cy - 20, 40, 32, colors.onRoute, { bold: true, align: 'center' })];
    case 'indoor':
      return [{ t: 'circle', cx, cy, r: S.nodeSize / 2, fill: colors.receiver, stroke: colors.surface, strokeWidth: 6 },
        { t: 'icon', name: 'house', icon: EXPORT_ICONS.house, x: cx - 20, y: cy - 20, size: 40, color: colors.onRoute }];
    case 'resume':
      return [{ t: 'circle', cx, cy, r: 16, fill: colors.surface, stroke: color, strokeWidth: 6 }];
    default:
      return [{ t: 'circle', cx, cy, r: 27, fill: color, stroke: withAlpha(color, 0.33), strokeWidth: 12 }];
  }
}

const PILL_TONES = color => ({
  stay: [withAlpha(color, 0.12), color],
  plain: [colors.pillPlain, colors.textMuted],
  manual: [colors.tonal, colors.tonalText],
  closed: [colors.warnBg, colors.warn],
  indoor: [colors.pillIndoor, colors.receiver],
});

function rowOps(block) {
  const { row, color, y } = block;
  const ops = [];
  if (row.kind === 'section') {
    ops.push(...trackOps(row.line, color, y, y + block.height));
    const muted = row.type === 'gap';
    const textTop = y + (block.height - block.lines.length * S.detailLine) / 2;
    ops.push({ t: 'icon', name: row.icon, icon: EXPORT_ICONS[row.icon], x: PLACE_X, y: textTop + (S.detailLine - 40) / 2, size: 40,
      color: muted ? colors.iconMuted : color });
    // 「移動 28 分・1.4 km」: the duration bold and dark, the rest muted.
    block.lines.forEach((line, index) => ops.push({ t: 'runs', x: PLACE_X + S.movementIcon - 16, y: textTop + index * S.detailLine,
      h: S.detailLine, size: S.detailFont, runs: splitRuns(line, row.time) }));
    return ops;
  }
  const nodeY = y + 8 + S.addressLine / 2;
  ops.push(...trackOps(row.line, color, nodeY, y + block.height));
  ops.push(...nodeOps(row, color, nodeY));
  // Times: the start bold, a stay's end under it, muted.
  ops.push(text(row.times[0], S.timeColumn - 16, y + 8, S.addressLine, S.timeFont, colors.text, { bold: true, align: 'right' }));
  if (row.times[1]) ops.push(text(row.times[1], S.timeColumn - 16, y + 8 + S.addressLine, 40, S.endTimeFont, colors.textMuted, { align: 'right' }));
  block.titleLines.forEach((line, index) => ops.push(text(line, PLACE_X, y + 8 + index * S.addressLine, S.addressLine,
    S.addressFont, colors.text, { bold: true })));
  const secondTop = y + 8 + block.titleLines.length * S.addressLine + 8;
  const tones = PILL_TONES(color);
  for (const item of block.items) {
    const top = secondTop + item.line * S.secondLine;
    if (item.kind === 'pill') {
      const [fill, ink] = tones[item.tone] || tones.plain;
      ops.push({ t: 'rect', x: PLACE_X + item.x, y: top, w: item.width, h: S.pillHeight, r: S.pillHeight / 2, fill });
      ops.push(text(item.text, PLACE_X + item.x + S.pillPadding, top, S.pillHeight, S.detailFont, ink, { bold: true }));
    } else {
      ops.push(text(item.text, PLACE_X + item.x, top, S.pillHeight, S.detailFont, colors.textMuted));
    }
  }
  return ops;
}

// The bold duration inside a movement line, the rest muted.
function splitRuns(line, bold) {
  const at = bold ? line.indexOf(bold) : -1;
  if (at < 0) return [{ text: line, color: colors.textMuted, bold: false }];
  return [{ text: line.slice(0, at), color: colors.textMuted, bold: false },
    { text: bold, color: colors.text, bold: true },
    { text: line.slice(at + bold.length), color: colors.textMuted, bold: false }].filter(run => run.text);
}

function headOps(page) {
  const ops = [{ t: 'rect', x: 0, y: 0, w: page.width, h: page.height, fill: colors.surface }];
  let y = 32;
  page.titleLines.forEach(line => { ops.push(text(line, S.side, y, 52, S.titleFont, colors.text, { bold: true })); y += 52; });
  y += 8;
  page.subtitleLines.forEach(line => { ops.push(text(line, S.side, y, 38, S.subtitleFont, colors.textMuted)); y += 38; });
  for (const item of page.legend) {
    const top = page.titleHeight + item.y;
    ops.push({ t: 'rect', x: item.x, y: top + S.legendHeight / 2 - 6, w: 32, h: 12, r: 6, fill: item.color });
    ops.push(text(item.name, item.x + 44, top, S.legendHeight, S.legendFont, colors.text, { bold: true }));
    ops.push(text(item.distance, item.x + 44 + item.nameWidth + 12, top, S.legendHeight, S.legendFont, colors.textMuted));
  }
  return ops;
}

function sectionOps(block) {
  const top = block.y + 12, height = block.height - 24;
  const ops = [{ t: 'rect', x: S.side, y: top, w: 8, h: height, r: 4, fill: block.color }];
  if (block.oneLine) {
    ops.push({ t: 'runs', x: S.side + 28, y: top, h: height, size: S.sectionFont, runs: [
      { text: block.title, color: colors.text, bold: true },
      { text: `  ${block.detail}`, color: colors.textMuted, bold: false, size: S.sectionDetailFont }] });
    return ops;
  }
  block.titleLines.forEach((line, index) => ops.push(text(line, S.side + 28, top + index * 48, 48, S.sectionFont,
    colors.text, { bold: true })));
  ops.push(text(block.detail, S.side + 28, top + block.titleLines.length * 48, 48, S.sectionDetailFont, colors.textMuted));
  return ops;
}

/** The map block for the renderer: geography it projects itself (it knows the base map's camera). */
export function mapOp(block) {
  return {
    t: 'map', x: 0, y: block.y, w: block.width, h: block.height, padding: block.padding,
    background: colors.mapFallback, halo: colors.mapLabelHalo, text: colors.text, surface: colors.surface,
    indoor: colors.receiver, onRoute: colors.onRoute, attribution: block.attribution, attributionColor: colors.textMuted,
    north: block.north, scale: block.scale, northColor: colors.critLine, house: EXPORT_ICONS.house,
    // Route widths three times the screen's (4dp walk, 2dp car or ride).
    subjects: block.subjects.map(subject => ({
      color: subject.color,
      lines: (subject.lines || []).map(line => ({ coordinates: line.coordinates, width: line.width * 3 })),
      places: subject.places || [],
      times: subject.times || [],
      points: subject.points || [],
    })),
  };
}

/** Every page's operations: [{ width, height, ops }]. */
export function pngDrawPages(layout) {
  return layout.pages.map(page => {
    const ops = headOps(page);
    for (const block of page.blocks) {
      if (block.type === 'map') ops.push(mapOp(block));
      else if (block.type === 'section') ops.push(...sectionOps(block));
      else ops.push(...rowOps(block));
    }
    const footer = page.footer;
    ops.push(text(footer.text, S.side, footer.y, footer.height, S.footerFont, colors.textMuted));
    ops.push(text(footer.page, page.width - S.side, footer.y, footer.height, S.footerFont, colors.textMuted, { align: 'right' }));
    return { width: page.width, height: page.height, ops };
  });
}

/** Every character the pages measure (the renderer gives their widths once). */
export function measuredCharacters(snapshot) {
  const all = new Set();
  const add = value => Array.from(String(value ?? '')).forEach(char => all.add(char));
  for (const subject of snapshot.subjects) {
    add(subject.name); add(subject.distanceKm);
    for (const row of subject.timeline || []) [row.title, row.coordinates, row.missing, row.note, row.pill?.text,
      row.lead, row.time, row.rest].forEach(add);
  }
  add('DogTracker・狗的歷史（續）隻0123456789/:–（一二三四五六日）移動走了 km…');
  return [...all].join('');
}

/** measureText from the renderer's widths (px at size 100, regular and bold). */
export function widthMeasure(widths) {
  return (value, size, bold = false) => {
    const table = bold ? widths.bold : widths.regular;
    let sum = 0;
    for (const char of Array.from(String(value))) sum += table[char] ?? 100;
    return (sum * size) / 100;
  };
}

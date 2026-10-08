// The words of the H1/H2 time-line list and its summary (copy deck c120,
// c121, c124, c127, c130, c137, c140, c159, c306–c308, c315, c316, c331–c341,
// c344). Pure: the list component draws them, tests read them.

const MINUTE = 60000;
const pad = value => String(value).padStart(2, '0');

/** 「08:03」 in the phone's time zone. */
export function clock(ms) {
  const at = new Date(ms);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** List rows: 「28 分」, 「1 時 13 分」 (H1/H2). */
export function listDuration(ms) {
  const minutes = Math.round(Math.max(0, ms) / MINUTE);
  if (minutes < 60) return `${minutes} 分`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} 時${rest ? ` ${rest} 分` : ''}`;
}

/** The summary: 「4 小時 8 分」 (c121). */
export function summaryDuration(ms) {
  const minutes = Math.round(Math.max(0, ms) / MINUTE);
  if (minutes < 60) return `${minutes} 分`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} 小時${rest ? ` ${rest} 分` : ''}`;
}

/** 「1.4 km」: tenths, rounded (判定表「距離的四捨五入」). */
export function km(metres) {
  return `${(Math.round(Math.max(0, metres || 0) / 100) / 10).toFixed(1)} km`;
}

/** 「24.9283, 121.2846」 */
export function coordinates(node) {
  return `${node.latitude.toFixed(4)}, ${node.longitude.toFixed(4)}`;
}

const MODE_WORD = { walking: '走路', driving: '開車', moving: '移動', ride: '坐車' };

/**
 * A movement row (判定表「移動段的文字」): { icon, lead, time, rest } —
 * 「走路 28 分・1.4 km」, 「開車 12 分・6.3 km・不算距離」, 「移動 …」,
 * 「坐車 9 分・4.1 km・不算距離」, 「沒有資料 10:21–10:40」. `time` is bold.
 */
export function sectionText(section) {
  if (section.type === 'gap') {
    return { icon: 'dots', lead: '沒有資料', time: '', rest: ` ${clock(section.start)}–${clock(section.end)}` };
  }
  const vehicle = section.mode === 'driving' || section.mode === 'ride';
  return {
    icon: vehicle ? 'car' : section.mode === 'walking' ? 'walk' : 'paw',
    lead: MODE_WORD[section.mode] || '移動',
    time: listDuration(section.durationMs),
    rest: vehicle ? `・${km(section.distanceM)}・不算距離` : `・${km(section.countedDistanceM)}`,
  };
}

/**
 * A place row's pill (判定表「清單節點的內容」「時間軸清單的其他膠囊」):
 * { text, tone } with tone 'stay' (route colour), 'plain', 'manual' (tonal),
 * 'closed' (warn) or 'indoor' (receiver); null for a switch point.
 */
export function nodePill(node) {
  switch (node.type) {
    case 'departure':
      if (node.continuesPreviousDay) return { text: '接續前一天', tone: 'plain' };
      return node.manual ? { text: '出發（手動）', tone: 'manual' } : { text: '出發', tone: 'plain' };
    case 'stop': {
      const stay = `停 ${listDuration(node.durationMs)}`;
      return { text: node.continuesPreviousDay ? `接續前一天・${stay}` : stay, tone: 'stay' };
    }
    case 'indoor': {
      // 判定表「跨午夜」 for a hold over midnight, as for a stay.
      const inside = `室內・${listDuration(node.end - node.start)}`;
      const text = node.continuesPreviousDay ? `接續前一天・${inside}` : node.continuesNextDay ? `${inside}・接續隔天` : inside;
      return { text, tone: 'indoor' };
    }
    case 'resume':
      return { text: '恢復記錄', tone: 'plain' };
    case 'end':
      if (node.continuesNextDay) return { text: '接續隔天', tone: 'plain' };
      if (node.label === '記錄已關閉') return { text: `記錄已關閉 ${clock(node.closedAt)}`, tone: 'closed' };
      if (node.label === '最後') return { text: `最後 ${clock(node.end)}`, tone: 'plain' };
      return { text: node.label, tone: 'plain' };
    default:
      return null;
  }
}

/** Address above pill + coordinates; missing addresses use coordinates above the pill. */
export function placeLines(node, place = { state: 'none' }) {
  const where = coordinates(node);
  // 「（約 120 m）」 wraps as one piece, never after 「約」.
  if (place?.state === 'found') {
    return { title: place.text.replace(/（約 (\d+) m）/u, '（約\u00A0$1\u00A0m）'), titleMuted: false,
      coordinates: where, missing: '' };
  }
  if (place?.state === 'pending') return { title: '查地址中…', titleMuted: true, coordinates: where, missing: '' };
  return { title: where, titleMuted: false, coordinates: '', missing: '' };
}

/** The left column: one time, or a stay's start and end. */
export function nodeTimes(node) {
  return node.type === 'stop' || node.type === 'indoor'
    ? [clock(node.start), clock(node.end)] : [clock(node.start)];
}

/** 「不含中斷 5 分」 under a stay that was interrupted (判定表「停留清單的中斷說明」). */
export function interruptionText(node) {
  return node.type === 'stop' && node.interruptionMs > 0 ? `不含中斷 ${listDuration(node.interruptionMs)}` : '';
}

/**
 * The summary above the list (H1 「08:03 – 現在」「走了 5.2 km・4 小時 8 分」):
 * { title, detail }. Before the departure is known the title says so
 * (c306–c308); my route says 走了, a dog 移動.
 */
export function summaryText(model, { subject }) {
  const first = model.points[0], last = model.points[model.points.length - 1];
  const end = model.nodes[model.nodes.length - 1];
  const until = end?.type === 'end' && end.label === '現在' ? '現在'
    : end?.type === 'end' && end.label === '最後' ? `最後 ${clock(last.time)}` : clock(last.time);
  const span = `${clock(first.time)} – ${until}`;
  const status = model.departure.manual ? 'confirmed' : model.departure.status;
  const title = status === 'not-departed' ? '還沒出發' : status === 'confirming' ? '確認出發中…'
    : status === 'undetermined' ? '沒辦法自動判斷出發' : span;
  const moved = `${subject === 'phone' ? '走了' : '移動'} ${km(model.distanceM)}・${summaryDuration(model.durationMs)}`;
  return { title, detail: title === span ? moved : `${span}　${moved}` };
}

/** H8: the one line of a day without records (c159, c316). */
export function emptyText({ subject, today, name }) {
  if (subject === 'phone') return today ? '今天還沒有路線' : '這天沒有路線';
  return `這天沒有${name}的紀錄`;
}

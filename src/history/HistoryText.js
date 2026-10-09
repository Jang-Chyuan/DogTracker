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
 * { text, tone } with tone 'stay' (route colour), 'plain',
 * 'closed' (warn) or 'indoor' (receiver); null for a switch point.
 */
export function nodePill(node) {
  switch (node.type) {
    case 'departure':
      return { text: '出發', tone: 'plain' };
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

// ---- TalkBack (設計稿「無障礙」時間軸清單) ------------------------------------

// Spoken words for the list's short forms: 「27 分」→「27 分鐘」, 「1.7 km」→
// 「1.7 公里」, 「・」→「，」.
export const spoken = text =>
  text
    .replace(/(\d+) 分(?!鐘)/gu, '$1 分鐘')
    .replace(/(\d) km/gu, '$1 公里')
    .replace(/(\d) m(?![a-z])/gu, '$1 公尺')
    .replace(/–/gu, ' 到 ')
    .replace(/・/gu, '，')
    .replace(/\s*，\s*/gu, '，')
    .trim();

/**
 * One item per movement or gap: 「開車 12 分鐘，6.3 公里，不算距離」,
 * 「走路 27 分鐘，1.7 公里」, 「沒有資料 10:29 到 10:41」.
 */
export function sectionSpeech(section) {
  const text = sectionText(section);
  return spoken(`${text.lead}${text.time ? ` ${text.time}` : ''}${text.rest}`);
}

/**
 * One item per node: 「停留 2，大湳森林公園東側入口，09:41 到 10:09，28 分鐘」;
 * the others say what they are, where and when (「出發，…，07:02」「室內，…，
 * 09:10 到 09:50，40 分鐘」「現在，…，09:29」). `title` is the row's first line
 * (the address, or the coordinates when none was found).
 */
export function placeSpeech(node, title) {
  const [start, end] = nodeTimes(node);
  const pill = nodePill(node);
  const lead =
    node.type === 'stop'
      ? `停留 ${node.number}`
      : node.type === 'switch'
      ? `換交通方式 ${node.number}`
      : node.type === 'indoor'
      ? '室內'
      : pill?.text ?? '';
  // A stay's own length, interruptions left out (as its pill 「停 25 分」).
  const length =
    node.type === 'stop' && Number.isFinite(node.durationMs)
      ? node.durationMs
      : node.end - node.start;
  const minutes = end ? `${Math.round(length / 60000)} 分鐘` : '';
  return spoken(
    [lead, title, end ? `${start} 到 ${end}` : start, minutes, interruptionText(node)]
      .filter(Boolean)
      .join('，'),
  );
}

import { t } from '../i18n';
import { distanceText } from '../utils/distanceText';
// The words of the H1/H2 time-line list and its summary (copy deck c120,
// c121, c127, c130, c137, c140, c159, c306–c308, c315, c316, c331–c341,
// c344, c1276). Pure: the list component draws them, tests read them.

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
  if (minutes < 60) return t("c653", { minutes: minutes });
  const rest = minutes % 60;
  return ((rest) ? t("c654", { value: Math.floor(minutes / 60), rest: rest }) : t("c655", { value: Math.floor(minutes / 60) }));
}

/**
 * A stay's or an indoor hold's minutes as listDuration, but 「不到 1 分」 (c1276)
 * when they round to none: never 「停 0 分」 or 「室內・0 分」 in its first
 * minute (2026-10-15, as stays since 2026-10-13).
 */
export function stayDuration(ms) {
  return Math.round(Math.max(0, ms || 0) / MINUTE) === 0 ? t('c1276') : listDuration(ms);
}

/** The summary: 「4 小時 8 分」 (c121). */
export function summaryDuration(ms) {
  const minutes = Math.round(Math.max(0, ms) / MINUTE);
  if (minutes < 60) return t("c653", { minutes: minutes });
  const rest = minutes % 60;
  return ((rest) ? t("c669", { value: Math.floor(minutes / 60), rest: rest }) : t("c670", { value: Math.floor(minutes / 60) }));
}

/** 「1.4 km」: tenths, rounded (判定表「距離的四捨五入」). */
export function km(metres) {
  return `${(Math.round(Math.max(0, metres || 0) / 100) / 10).toFixed(1)} km`;
}

/** 「24.9283, 121.2846」 */
export function coordinates(node) {
  return `${node.latitude.toFixed(4)}, ${node.longitude.toFixed(4)}`;
}

const MODE_WORD = { walking: t('c134'), driving: t('c135'), moving: t('c125'), ride: t('c128') };

/** A movement row's glyph (the list's track icon, the map's segment icon). */
export const movementGlyph = mode => (mode === 'driving' || mode === 'ride' ? 'car'
  : mode === 'walking' ? 'walk' : 'paw');

/**
 * A movement row (判定表「移動段的文字」): { icon, lead, time, rest } —
 * 「走路 28 分・1.4 km」, 「開車 12 分・6.3 km」, 「移動 …」,
 * 「坐車 9 分・4.1 km」, 「沒有資料 10:21–10:40」. `time` is bold.
 */
export function sectionText(section) {
  if (section.type === 'gap') {
    // 067: a dog's break — 「收不到 GPS」 (packets without a fix) or
    // 「沒收到訊號」 (no packet); otherwise 「沒有資料」.
    const lead = section.reason === 'uncertain' ? t('c883') : section.reason === 'no-gps'
      ? t('c1169') : section.reason === 'no-signal' ? t('c1170') : t('c089');
    // A day's trailing 「沒有資料」 (2026-10-13) ends at midnight: 24:00.
    const end = section.dayBoundary === 'end' ? '24:00' : clock(section.end);
    return { icon: 'dots', lead, time: '', rest: ` ${clock(section.start)}–${end}` };
  }
  const vehicle = section.mode === 'driving' || section.mode === 'ride';
  const metres = vehicle ? section.distanceM : section.countedDistanceM;
  const duration = section.displayDurationMs ?? section.durationMs;
  // A row that shows a distance never says 「0 分」 (2026-10-13, approved):
  // its clock-aligned minutes can round to 0 while it moved — 「不到 1 分」.
  // Only the words change; the durations stay as they are.
  const distance = distanceText(metres);
  const moved = distance !== distanceText(0);
  const lessThanMinute = moved && Math.round(Math.max(0, duration || 0) / MINUTE) === 0;
  return {
    icon: movementGlyph(section.mode),
    lead: MODE_WORD[section.mode] || t('c125'),
    time: lessThanMinute ? t('c1276') : listDuration(duration),
    rest: `・${distance}`,
  };
}

/**
 * A place row's pill (判定表「清單節點的內容」「時間軸清單的其他膠囊」):
 * { text, tone } with tone 'stay' (route colour), 'plain',
 * 'closed' (warn) or 'indoor' (receiver); null for a switch point.
 */
// A stay's shown minutes round to none (a manual range clipping it to
// seconds): never 「停 0 分」 (2026-10-13).
const noMinutes = stay => stay.type === 'stop' && !stay.continuesPreviousDay
  && Math.round(Math.max(0, stay.displayDurationMs ?? stay.durationMs ?? 0) / MINUTE) === 0;

// 2026-10-15 (user, #200): a stay's own moves are its own — 「停 25 分・45 m」
// — never a walk's hours later; a stay that did not move (rounded to 0 m)
// reads as ever.
const withStayMetres = (text, stay) => {
  const distance = distanceText(stay?.countedDistanceM || 0);
  return distance === distanceText(0) ? text : `${text}・${distance}`;
};

export function nodePill(node) {
  if (node.terminalStay) {
    const endpoint = nodePill({ ...node, terminalStay: null });
    if (endpoint && noMinutes(node.terminalStay)) return endpoint;
    const stay = nodePill(node.terminalStay);
    // An end that runs on past midnight has no capsule of its own: 「停 N 分」.
    return endpoint ? { ...endpoint, text: `${endpoint.text} · ${stay.text}` } : stay;
  }
  switch (node.type) {
    // 2026-10-14 (user): no 「出發」 anywhere. A range that begins moving
    // starts with its hollow start circle, its time and its address — no
    // capsule (the seconds of a stay it set off from are the first move's).
    case 'departure':
      return null;
    case 'stop': {
      // Under half a minute shown on its own: 「停 不到 1 分」 (as c1276 on rows).
      const duration = noMinutes(node) ? t('c1276') : listDuration(node.displayDurationMs ?? node.durationMs);
      // 2026-10-15 (user, #200): a walk round one place is 「在附近走動 1 時 49 分」.
      const stay = node.wandering ? t('c1405', { duration }) : t('c127', { duration });
      return { text: withStayMetres(node.continuesPreviousDay ? t('c332') : stay, node), tone: 'stay' };
    }
    case 'indoor': {
      // 判定表「跨午夜」 for a hold over midnight, as for a stay. A hold that
      // runs on into the next day keeps its minutes (2026-10-13: no 「接續隔天」).
      const inside = t('c344', { duration: stayDuration(node.displayDurationMs ?? node.end - node.start) });
      const text = node.continuesPreviousDay ? t('c332') : inside;
      return { text, tone: 'indoor' };
    }
    case 'resume':
      return { text: t('c335'), tone: 'plain' };
    case 'end':
      // 2026-10-13 (approved): no 「接續隔天」 capsule — it pushed the address
      // onto many lines. The row's time and the next day's own 「接續前一天」
      // already say it; the end row has no capsule.
      if (node.continuesNextDay) return null;
      if (node.label === t("c656")) return { text: t('c331', { time: clock(node.closedAt) }), tone: 'closed' };
      if (node.label === t("c660")) return { text: t('c315', { time: clock(node.end) }), tone: 'plain' };
      if (node.label === t('c130')) return { text: node.label, tone: 'plain' };
      // 2026-10-14 (user): no 「結束」 anywhere — the end row of a range that
      // ends moving is its time, its solid node and its address only.
      return null;
    default:
      return null;
  }
}

/** Address above pill + coordinates; missing addresses use coordinates above the pill. */
export function placeLines(node, place = { state: 'none' }) {
  const where = coordinates(node);
  // 「（約 120 m）」 wraps as one piece, never after 「約」.
  if (place?.state === 'found') {
    return { title: place.text.replace(/（約 (\d+) m）/u, t("c661")), titleMuted: false,
      coordinates: where, missing: '' };
  }
  if (place?.state === 'pending') return { title: t('c329'), titleMuted: true, coordinates: where, missing: '' };
  return { title: where, titleMuted: false, coordinates: '', missing: '' };
}

/** The left column: one time, or a stay's start and end. */
export function nodeTimes(node) {
  return node.terminalStay || node.type === 'stop' || node.type === 'indoor'
    ? [clock(node.start), clock(node.end)] : [clock(node.start)];
}

/** 「不含中斷 5 分」 under a stay that was interrupted (判定表「停留清單的中斷說明」). */
export function interruptionText(node) {
  if (node.terminalStay) return interruptionText(node.terminalStay);
  return node.type === 'stop' && node.interruptionMs > 0 ? t('c337', { duration: listDuration(node.interruptionMs) }) : '';
}

export function vehicleExclusion(model, subject) {
  const mode = subject === 'phone' ? 'driving' : 'ride';
  return (model?.nodes || []).some(node => node.type === 'movement' && node.mode === mode)
    ? ((subject === 'phone') ? t("c673") : t("c672")) : '';
}

/** Same deck wording, with the vehicle exclusion only when it applies. */
export function movementSummary(model, subject) {
  const params = { distance: km(model.distanceM), duration: summaryDuration(model.durationMs) };
  const excluded = !!vehicleExclusion(model, subject);
  if (subject === 'phone') return excluded ? t('c419', { distance: params.distance, duration: params.duration }) : t('c133', { distance: params.distance, duration: params.duration });
  return excluded ? t('c418', { distance: params.distance, duration: params.duration }) : t('c121', { distance: params.distance, duration: params.duration });
}

/**
 * The summary above the list (H1 「08:03 – 現在」「走了 5.2 km・4 小時 8 分」):
 * { title, detail }. Always show the selected time range, including a tentative
 * departure or the whole day; my route says 走了, a dog 移動.
 */
export function summaryText(model, { subject }) {
  const first = model.points[0], last = model.points[model.points.length - 1];
  const end = model.nodes[model.nodes.length - 1];
  const startTime = clock(first.time), endTime = clock(last.time);
  const span = end?.type === 'end' && end.label === t('c130')
    ? t('c120', { time: startTime })
    : end?.type === 'end' && end.label === t("c660")
      ? t('c1154', { time: startTime, time2: endTime })
      : t('c432', { time: startTime, time2: endTime });
  const moved = movementSummary(model, subject);
  return { title: span, detail: moved };
}

/** H8: the one line of a day without records (c159, c316). */
export function emptyText({ subject, today, name }) {
  if (subject === 'phone') return today ? t('c159') : t('c317');
  return t('c316', { dogName: name });
}

// ---- TalkBack (設計稿「無障礙」時間軸清單) ------------------------------------

// Spoken words for the list's short forms: 「27 分」→「27 分鐘」, 「1.7 km」→
// 「1.7 公里」, 「・」→「，」.
export const spoken = text =>
  text
    .replace(/(\d+) 分(?!鐘)/gu, t("c665"))
    .replace(/(\d) km/gu, t("c666"))
    .replace(/(\d) m(?![a-z])/gu, t("c667"))
    .replace(/–/gu, t("c668"))
    .replace(/・/gu, '，')
    .replace(/\s*，\s*/gu, '，')
    .trim();

/**
 * One item per movement or gap: 「開車 12 分鐘，6.3 公里」,
 * 「走路 27 分鐘，1.7 公里」, 「沒有資料 10:29 到 10:41」.
 */
export function sectionSpeech(section, from = null) {
  const text = sectionText(section);
  const leaving = leavesFrom(from, section) ? t('c1336', { place: leftPlace(from) }) : '';
  return spoken(`${leaving}${text.lead}${text.time ? ` ${text.time}` : ''}${text.rest}`);
}

/**
 * 2026-10-14 (user, option B): a movement row right after a stay (a stay, a
 * 室內 hold) leaves it: the list draws a down chevron on the line under the
 * stay (screen and PNG), and TalkBack starts the movement row with
 * 「從停留 2 離開，」. Not after 出發, 恢復記錄 or a break, not into a break.
 */
export function leavesFrom(row, next) {
  return ['stop', 'indoor'].includes(row?.type) && next?.type === 'movement';
}
const leftPlace = row => (row.type === 'indoor' ? t('c114')
  : row.number != null ? t('c136', { duration: row.number }) : t('c136', { duration: '' }).trim());

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
      ? (node.wandering ? t('c1406', { number: node.number ?? '' }) : t('c136', { duration: node.number ?? '' })).trim()
      : node.type === 'switch'
      ? t("c663", { number: node.number })
      : node.type === 'indoor'
      ? t('c114')
      : pill?.text ?? '';
  // A stay's own length, interruptions left out (as its pill 「停 25 分」).
  const length = node.displayDurationMs ?? (
    (node.type === 'stop' || node.terminalStay) && Number.isFinite(node.durationMs)
      ? node.durationMs
      : node.end - node.start);
  // A stay of under a minute is read 「不到 1 分鐘」, as its pill (2026-10-15:
  // TalkBack said 「0 分鐘」 under 「停 不到 1 分」).
  const minutes = !end ? '' : noMinutes(node) ? t('c1276') : t("c664", { value: Math.round(length / 60000) });
  // A stay's own metres (#200), as its pill.
  const stay = node.terminalStay ?? (node.type === 'stop' ? node : null);
  const metres = stay && distanceText(stay.countedDistanceM || 0) !== distanceText(0)
    ? distanceText(stay.countedDistanceM) : '';
  return spoken(
    [lead, title, end ? t("c662", { start: start, end: end }) : start, minutes, metres, interruptionText(node)]
      .filter(Boolean)
      .join('，'),
  );
}

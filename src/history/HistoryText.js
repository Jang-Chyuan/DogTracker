import { t } from '../i18n';
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
  if (minutes < 60) return t("c653", { minutes: minutes });
  const rest = minutes % 60;
  return ((rest) ? t("c654", { value: Math.floor(minutes / 60), rest: rest }) : t("c655", { value: Math.floor(minutes / 60) }));
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

/**
 * A movement row (判定表「移動段的文字」): { icon, lead, time, rest } —
 * 「走路 28 分・1.4 km」, 「開車 12 分・6.3 km・不算距離」, 「移動 …」,
 * 「坐車 9 分・4.1 km・不算距離」, 「沒有資料 10:21–10:40」. `time` is bold.
 */
export function sectionText(section) {
  if (section.type === 'gap') {
    return { icon: 'dots', lead: t('c089'), time: '', rest: ` ${clock(section.start)}–${clock(section.end)}` };
  }
  const vehicle = section.mode === 'driving' || section.mode === 'ride';
  return {
    icon: vehicle ? 'car' : section.mode === 'walking' ? 'walk' : 'paw',
    lead: MODE_WORD[section.mode] || t('c125'),
    time: listDuration(section.durationMs),
    rest: vehicle ? `・${km(section.distanceM)}` : `・${km(section.countedDistanceM)}`,
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
      return { text: t('c124'), tone: 'plain' };
    case 'stop': {
      const stay = t('c127', { duration: listDuration(node.durationMs) });
      return { text: node.continuesPreviousDay ? t("c657", { stay: stay }) : stay, tone: 'stay' };
    }
    case 'indoor': {
      // 判定表「跨午夜」 for a hold over midnight, as for a stay.
      const inside = t('c344', { duration: listDuration(node.end - node.start) });
      const text = node.continuesPreviousDay ? t("c658", { inside: inside }) : node.continuesNextDay ? t("c659", { inside: inside }) : inside;
      return { text, tone: 'indoor' };
    }
    case 'resume':
      return { text: t('c335'), tone: 'plain' };
    case 'end':
      if (node.continuesNextDay) return { text: t('c334'), tone: 'plain' };
      if (node.label === t("c656")) return { text: t('c331', { time: clock(node.closedAt) }), tone: 'closed' };
      if (node.label === t("c660")) return { text: t('c315', { time: clock(node.end) }), tone: 'plain' };
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
    return { title: place.text.replace(/（約 (\d+) m）/u, t("c661")), titleMuted: false,
      coordinates: where, missing: '' };
  }
  if (place?.state === 'pending') return { title: t('c329'), titleMuted: true, coordinates: where, missing: '' };
  return { title: where, titleMuted: false, coordinates: '', missing: '' };
}

/** The left column: one time, or a stay's start and end. */
export function nodeTimes(node) {
  return node.type === 'stop' || node.type === 'indoor'
    ? [clock(node.start), clock(node.end)] : [clock(node.start)];
}

/** 「不含中斷 5 分」 under a stay that was interrupted (判定表「停留清單的中斷說明」). */
export function interruptionText(node) {
  return node.type === 'stop' && node.interruptionMs > 0 ? t('c337', { duration: listDuration(node.interruptionMs) }) : '';
}

export function vehicleExclusion(model, subject) {
  const mode = subject === 'phone' ? 'driving' : 'ride';
  return (model?.nodes || []).some(node => node.type === 'movement' && node.mode === mode)
    ? ((subject === 'phone') ? t("c673") : t("c672")) : '';
}

/**
 * The summary above the list (H1 「08:03 – 現在」「走了 5.2 km・4 小時 8 分」):
 * { title, detail }. Always show the selected time range, including a tentative
 * departure or the whole day; my route says 走了, a dog 移動.
 */
export function summaryText(model, { subject }) {
  const first = model.points[0], last = model.points[model.points.length - 1];
  const end = model.nodes[model.nodes.length - 1];
  const until = end?.type === 'end' && end.label === t('c130') ? t('c130')
    : end?.type === 'end' && end.label === t("c660") ? t('c315', { time: clock(last.time) }) : clock(last.time);
  const span = `${clock(first.time)} – ${until}`;
  const moved = ((subject === 'phone') ? t("c651", { value: km(model.distanceM), value2: vehicleExclusion(model, subject), value3: summaryDuration(model.durationMs) }) : t("c652", { value: km(model.distanceM), value2: vehicleExclusion(model, subject), value3: summaryDuration(model.durationMs) }));
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
      ? t('c136', { duration: node.number })
      : node.type === 'switch'
      ? t("c663", { number: node.number })
      : node.type === 'indoor'
      ? t('c114')
      : pill?.text ?? '';
  // A stay's own length, interruptions left out (as its pill 「停 25 分」).
  const length =
    node.type === 'stop' && Number.isFinite(node.durationMs)
      ? node.durationMs
      : node.end - node.start;
  const minutes = end ? t("c664", { value: Math.round(length / 60000) }) : '';
  return spoken(
    [lead, title, end ? t("c662", { start: start, end: end }) : start, minutes, interruptionText(node)]
      .filter(Boolean)
      .join('，'),
  );
}

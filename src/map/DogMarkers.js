import { t } from '../i18n';
// What each dog's map marker shows (design v3「狗的標記：所有情況」, DESIGN.md
// §15 角標與放大), and which name tags merge into a 「3 隻」 group tag. Pure and
// provider-neutral: the renderer only draws what these return.
import { size as sizes, type } from '../theme/tokens';
import { dogHistoryLabel, dogMapLabel } from '../mapHistory/DogAliases';
import { dogFreshness, isIndoorHold, staleSpeech, staleText } from '../tracking/DogFreshness';
import { RANGE_STATUS } from '../tracking/ReceiverRange';
import { dogProblems } from '../tracking/DogProblems';

// The one word the map uses for a dog held where it was last seen clearly,
// whatever held it (indoors, by a window, charging, weak GPS).
export const INDOOR_WORD = t('c114');

/** The dog's name on the map: its given name, or 「狗 6」. */
export const dogName = (slaveId, aliases) => dogMapLabel(dogHistoryLabel(slaveId, aliases));

/**
 * One marker per drawn dog. A dog that has never had a position is left out
 * (not drawn, no card, no alert).
 *
 * @param dogs merged dogs (DogMerge.mergeDogMarkers)
 * @param options.now the map clock; options.cloud and options.pauses as in
 *   DogFreshness.dogFreshness
 * @param options.ranges receiver-range judgements by dog
 * @param options.aliases the names the handler gave
 * @param options.selectedId the dog whose card is open
 * @param options.catchUpSince 070: the moment the app went away, while a
 *   return to it catches the map up (ResumeCatchUp). Freshness is judged
 *   against that moment instead of now, so no dog turns grey on rows the
 *   reader has not read yet, and every face is `dimmed` meanwhile. null once
 *   the catch-up is through: the plain 10-minute judgement is back.
 */
export function dogMarkers(dogs = [], { now = Date.now(), cloud = null, pauses = [], ranges = {},
  aliases = {}, selectedId = null, catchUpSince = null, previousStale = {} } = {}) {
  const markers = [];
  const catchingUp = Number.isFinite(catchUpSince);
  // Never later than now: a clock that ran backwards must not age a dog.
  const judged = catchingUp ? Math.min(catchUpSince, now) : now;
  for (const dog of dogs) {
    const current = dogFreshness(dog, { now: judged, cloud, pauses });
    const freshness = catchingUp && Object.hasOwn(previousStale, dog.slaveId)
      ? { ...current, stale: previousStale[dog.slaveId] } : current;
    if (!freshness.drawn) continue;
    const range = ranges?.[dog.slaveId];
    const problems = dogProblems(dog, freshness, range);
    markers.push(dogMarker(dog, { freshness, problems, now: judged, range, dimmed: catchingUp,
      name: dogName(dog.slaveId, aliases), selected: dog.slaveId === selectedId }));
  }
  return markers;
}

export function dogMarker(dog, { freshness, problems, name, now, range = null, selected = false,
  dimmed = false }) {
  const indoor = isIndoorHold(dog);
  const base = problems.any ? sizes.marker.attention : sizes.marker.normal;
  const note = problemNote(dog, { freshness, problems, range, indoor, now });
  return {
    slaveId: dog.slaveId,
    coordinate: dog.coordinate,
    // Where its position came from: 'ble' is this phone's own receiver (the
    // cold-start framing frames only those dogs and the phone).
    source: dog.fixSource ?? dog.source ?? null,
    // The receiver that delivered it (another receiver used before this one
    // is not "local" for framing).
    masterId: dog.masterId ?? null,
    name,
    // The overlap menu's second line: what is wrong (crit), or 快離開 (warn),
    // or 室內 (muted); null for a dog with nothing to say.
    note,
    // Only the name; held indoors 「小黑・室內」. Never an address or a reason.
    tag: indoor ? `${name}・${INDOOR_WORD}` : name,
    indoor,
    stale: freshness.stale,
    // 070: drawn at opacity.catchingUp while a return to the app is still
    // reading; its colours are the ones the user left it with.
    dimmed,
    problem: problems.any,
    selected,
    size: base + (selected ? sizes.marker.selectedGrowth : 0),
    label: markerSpeech(dog, { name, indoor, freshness, problems, now }),
  };
}

/**
 * One short line for the overlap menu (頭像＋名字＋問題): the problems, most
 * serious first, in the card's words (「不在接收範圍」「沒有新位置・最後
 * 10:12」「電量 15%・偏低」) as `crit`; otherwise 「快離開接收範圍」 as `warn`;
 * otherwise 「室內」 as `muted`; otherwise null.
 */
export function problemNote(dog, { freshness, problems, range, indoor, now }) {
  const crit = [];
  if (problems.outOfRange) crit.push(t('c078'));
  const stale = staleText(freshness, now);
  if (stale) crit.push(stale);
  if (problems.lowBattery) crit.push(t("c734", { batteryPercentage: dog.batteryPercentage }));
  if (crit.length) return { text: crit.join('，'), level: 'crit' };
  if (range?.status === RANGE_STATUS.NEAR && !indoor) return { text: t('c067'), level: 'warn' };
  if (indoor) return { text: INDOOR_WORD, level: 'muted' };
  return null;
}

/**
 * The marker's one accessibility label (the badges are not read on their own):
 * name, then 室內, charging or low battery, out of range, no new position —
 * 「小黑・室內，充電中 62%，不在接收範圍，沒有新資料，最後 10:05」. A dog
 * without any of these is only its name.
 */
export function markerSpeech(dog, { name, indoor, freshness, problems, now }) {
  const parts = [indoor ? `${name}・${INDOOR_WORD}` : name];
  const battery = Number.isFinite(dog.batteryPercentage) ? `${dog.batteryPercentage}%` : null;
  if (dog.charging) parts.push(battery ? t('c115', { percentage: battery }) : t("c731"));
  else if (problems.lowBattery) parts.push(t("c732", { battery: battery }));
  if (problems.outOfRange) parts.push(t('c078'));
  const stale = staleSpeech(freshness, now);
  if (stale) parts.push(stale);
  return parts.join('，');
}

// ---- name tags that run into each other ------------------------------------

// A name tag's size on screen, in dp, for its text at 13sp bold (CJK glyphs
// are about one em wide, others about half), plus padding and border.
export function tagSize(text, fontScale = 1) {
  let width = 0;
  for (const char of text || '') width += char.codePointAt(0) <= 0x24f ? 7.5 : 13;
  const { paddingH, paddingV, border } = sizes.mapLabel;
  return {
    width: width * fontScale + 2 * (paddingH + border),
    height: type.mapLabel.lineHeight * fontScale + 2 * (paddingV + border),
  };
}

const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// A face is a circle: does it reach into this box?
const faceTouches = (face, box) => {
  const dx = Math.max(box.left - face.x, 0, face.x - box.right);
  const dy = Math.max(box.top - face.y, 0, face.y - box.bottom);
  return dx * dx + dy * dy < face.r * face.r;
};

// The 「3 隻」 group tag's size: 14sp bold on a 32dp capsule (DESIGN.md §15),
// with the 8dp red dot when a dog in it has a problem.
function groupTagSize(text, problem, fontScale = 1) {
  const { width } = tagSize(text, fontScale * type.value.fontSize / type.mapLabel.fontSize);
  const dot = problem ? sizes.groupTag.problemDot + sizes.groupTag.dotGap : 0;
  return { width: width + dot, height: sizes.groupTag.height * Math.max(1, fontScale) };
}

// The widest a name tag gets before it wraps to its second line (D14).
const TAG_MAX_WIDTH = sizes.marker.textWidth + 2 * (sizes.mapLabel.paddingH + sizes.mapLabel.border)
  - sizes.marker.labelSafety;

// The box a tag of this size covers right under a face at `point`.
function tagBox(point, faceSize, { width, height }) {
  const top = point.y + faceSize / 2 + sizes.marker.labelGap;
  return { left: point.x - width / 2, right: point.x + width / 2, top, bottom: top + height };
}

function nameTagSize(text, fontScale) {
  const size = tagSize(text, fontScale);
  if (size.width <= TAG_MAX_WIDTH) return size;
  // Too wide for one line: two lines (DESIGN.md §3.4), as wide as allowed.
  return { width: TAG_MAX_WIDTH, height: size.height + type.mapLabel.lineHeight * fontScale };
}

const groupText = members => t("c733", { length: members.length,
  value: members.every(item => item.marker.indoor) ? `・${INDOOR_WORD}` : '' });

// The tag sits under the lowest face, so it covers none of the others.
const lowest = members => members.reduce((low, item) => (item.point.y > low.point.y
  || (item.point.y === low.point.y && item.marker.slaveId < low.marker.slaveId) ? item : low));

// Two sets of dogs collide when a tag of one covers a tag or a face of the
// other (a face drawn over a tag hides the name as surely as another tag).
const collide = (a, b) => a.tags.some(tag => b.tags.some(other => intersects(tag, other))
  || b.faces.some(face => faceTouches(face, tag)))
  || b.tags.some(tag => a.faces.some(face => faceTouches(face, tag)));

// Name tags merge into 「N 隻」 only when the map is zoomed out this far or
// more (metres per dp; about zoom 16 here, a few streets on screen). Closer
// in, every dog keeps its own tag even when the tags overlap (066: the user
// zoomed in on a kennel and still saw 「5 隻・室內」).
export const GROUP_MIN_METRES_PER_DP = 2;

/** Whether tags may merge at this zoom (unknown zoom: they may). */
export const groupsAtZoom = metresPerDp =>
  !(metresPerDp > 0) || metresPerDp >= GROUP_MIN_METRES_PER_DP;

/**
 * Which name tags are drawn, given where each marker is on screen. A name tag
 * that would run into another dog's tag or face merges with that dog into one
 * group tag 「3 隻」 (「3 隻・室內」 when every dog in it is held indoors),
 * drawn under the lowest of their faces; the others in the group draw no tag.
 * The group tag itself is checked again (it is wider than one name and sits
 * lower), so it never covers a dog left outside it. The selected dog keeps
 * its own tag and is left out of groups (DESIGN.md §9.5); a group of one is
 * just that dog's own tag.
 *
 * @param markers dogMarkers() output
 * @param points screen positions by dog, in dp: { [slaveId]: { x, y } }
 * @returns { [slaveId]: { text, group: number, problem: boolean, members?: slaveId[] } | null }
 *   A group tag's `members`: its dogs, nearest the top of the screen first
 *   (the overlap menu lists them in that order).
 *   null = no tag under this face; dogs without a screen position keep their tag.
 */
export function nameTags(markers, points = {}, fontScale = 1, { group = true } = {}) {
  const result = {};
  const placed = [];
  for (const marker of markers) {
    result[marker.slaveId] = { text: marker.tag, group: 1, problem: false };
    const point = points[marker.slaveId];
    if (marker.selected || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    placed.push({ marker, point, face: { x: point.x, y: point.y, r: marker.size / 2 },
      tag: tagBox(point, marker.size, nameTagSize(marker.tag, fontScale)) });
  }
  if (!group) return result;
  // Union-find over the names as they would be drawn: A over B and B over C
  // is one group, whatever order the dogs come in.
  const parent = placed.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const alone = item => ({ members: [item], tags: [item.tag], faces: [item.face] });
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (collide(alone(placed[i]), alone(placed[j]))) parent[find(i)] = find(j);
    }
  }
  const roots = new Map();
  placed.forEach((item, index) => {
    const root = find(index);
    if (!roots.has(root)) roots.set(root, []);
    roots.get(root).push(item);
  });
  // Each set as drawn: every face, and one tag (the group tag under the
  // lowest face). A group tag that now runs into another set merges that
  // set in too, until nothing drawn covers another dog's name.
  const drawn = members => {
    if (members.length < 2) return alone(members[0]);
    const lead = lowest(members);
    const size = groupTagSize(groupText(members), members.some(item => item.marker.problem), fontScale);
    return { members, faces: members.map(item => item.face), tags: [tagBox(lead.point, lead.marker.size, size)] };
  };
  let sets = [...roots.values()].map(drawn);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < sets.length && !changed; i += 1) {
      for (let j = i + 1; j < sets.length && !changed; j += 1) {
        if (!collide(sets[i], sets[j])) continue;
        const merged = drawn([...sets[i].members, ...sets[j].members]);
        sets = [...sets.slice(0, i), merged, ...sets.slice(i + 1, j), ...sets.slice(j + 1)];
        changed = true;
      }
    }
  }
  for (const { members } of sets) {
    if (members.length < 2) continue;
    const lead = lowest(members);
    for (const item of members) result[item.marker.slaveId] = null;
    result[lead.marker.slaveId] = {
      text: groupText(members),
      group: members.length,
      problem: members.some(item => item.marker.problem),
      members: [...members].sort((left, right) => left.point.y - right.point.y
        || left.marker.slaveId - right.marker.slaveId).map(item => item.marker.slaveId),
    };
  }
  return result;
}

/**
 * The dog whose face is under a tap at `tap` (dp), the nearest when faces
 * overlap; null when the tap is on empty map. `slack` widens each face to a
 * fair finger target (066: a tap on a dog with a card open reached the map
 * as an empty-map tap and closed the card instead of switching it).
 */
export function dogAtPoint(markers, points = {}, tap, slack = 8) {
  if (!tap || !Number.isFinite(tap.x) || !Number.isFinite(tap.y)) return null;
  let best = null;
  for (const marker of markers) {
    const point = points[marker.slaveId];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const distance = Math.hypot(point.x - tap.x, point.y - tap.y);
    if (distance > (marker.size || 0) / 2 + slack) continue;
    if (!best || distance < best.distance) best = { slaveId: marker.slaveId, distance };
  }
  return best ? best.slaveId : null;
}

// ---- the order the faces are drawn in, and which one a tap is on ----------

// Dog markers sit above every other marker (the phone's dot is 30, stops
// 20–26) and below the history cursor (GoogleTrackingMap CURSOR_Z_INDEX).
export const DOG_Z_BASE = 100;

// The layer a face belongs to, bottom to top: plain, carrying a group tag
// (over the faces it covers), with a problem, a problem and a group tag, and
// the open dog on top of everything.
function dogLayer(marker, tag) {
  if (marker.selected) return 4;
  return (marker.problem ? 2 : 0) + (tag?.group > 1 ? 1 : 0);
}

/**
 * Every dog's marker zIndex, all different. Google draws markers of one
 * zIndex in an order of its own and hit-tests them in another (a tap on the
 * face drawn on top opened the dog above it, whose name tag canvas reached
 * under that face), so no two dogs share one. Within a layer the face lower
 * on the screen is drawn over the one above it: it covers that dog's name tag
 * hanging below, never the other way round. Without a screen point for every
 * dog, the southern one counts as lower.
 *
 * @returns { [slaveId]: zIndex }, DOG_Z_BASE and up, in drawing order
 */
export function dogZIndexes(markers = [], points = {}, tags = {}) {
  const screen = markers.every(marker => Number.isFinite(points?.[marker.slaveId]?.y));
  const height = marker => (screen ? points[marker.slaveId].y : -(marker.coordinate?.latitude ?? 0));
  const ordered = markers
    .map(marker => ({ marker, layer: dogLayer(marker, tags?.[marker.slaveId]), y: height(marker) }))
    .sort((a, b) => a.layer - b.layer || a.y - b.y || a.marker.slaveId - b.marker.slaveId);
  return Object.fromEntries(ordered.map((item, index) => [item.marker.slaveId, DOG_Z_BASE + index]));
}

/**
 * The dog whose drawn face or name tag is under a tap at `tap` (dp), looking
 * from the top of the drawing order down: what the finger lands on is what
 * the eye sees there (a face drawn over another dog's tag wins; a tag showing
 * over the empty canvas of a marker drawn above it wins too). null when the
 * tap is on nothing drawn (only some marker's transparent canvas).
 *
 * @param tags nameTags() output; zIndexes dogZIndexes() output
 */
export function dogUnderTouch(markers = [], points = {}, tags = {}, tap, zIndexes = {}, fontScale = 1) {
  if (!tap || !Number.isFinite(tap.x) || !Number.isFinite(tap.y)) return null;
  const ordered = markers
    .filter(marker => Number.isFinite(points?.[marker.slaveId]?.x) && Number.isFinite(points[marker.slaveId].y))
    .sort((a, b) => (zIndexes[b.slaveId] ?? 0) - (zIndexes[a.slaveId] ?? 0));
  for (const marker of ordered) {
    const point = points[marker.slaveId];
    // The face, with the "!" and house badges reaching a little out of it.
    if (Math.hypot(point.x - tap.x, point.y - tap.y) <= (marker.size || 0) / 2 + 2) return marker.slaveId;
    const tag = tags?.[marker.slaveId];
    if (!tag?.text) continue;
    const size = tag.group > 1 ? groupTagSize(tag.text, tag.problem, fontScale) : nameTagSize(tag.text, fontScale);
    const box = tagBox(point, marker.size, size);
    if (tap.x >= box.left && tap.x <= box.right && tap.y >= box.top && tap.y <= box.bottom) return marker.slaveId;
  }
  return null;
}

// What each dog's map marker shows (design v3「狗的標記：所有情況」, DESIGN.md
// §15 角標與放大), and which name tags merge into a 「3 隻」 group tag. Pure and
// provider-neutral: the renderer only draws what these return.
import { size as sizes } from '../theme/tokens';
import { dogHistoryLabel, dogMapLabel } from '../mapHistory/DogAliases';
import { dogFreshness, isIndoorHold, staleSpeech } from '../tracking/DogFreshness';
import { dogProblems } from '../tracking/DogProblems';

// The one word the map uses for a dog held where it was last seen clearly,
// whatever held it (indoors, by a window, charging, weak GPS).
export const INDOOR_WORD = '室內';

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
 */
export function dogMarkers(dogs = [], { now = Date.now(), cloud = null, pauses = [], ranges = {},
  aliases = {}, selectedId = null } = {}) {
  const markers = [];
  for (const dog of dogs) {
    const freshness = dogFreshness(dog, { now, cloud, pauses });
    if (!freshness.drawn) continue;
    const problems = dogProblems(dog, freshness, ranges?.[dog.slaveId]);
    markers.push(dogMarker(dog, { freshness, problems, now,
      name: dogName(dog.slaveId, aliases), selected: dog.slaveId === selectedId }));
  }
  return markers;
}

export function dogMarker(dog, { freshness, problems, name, now, selected = false }) {
  const indoor = isIndoorHold(dog);
  const base = problems.any ? sizes.marker.attention : sizes.marker.normal;
  return {
    slaveId: dog.slaveId,
    coordinate: dog.coordinate,
    name,
    // Only the name; held indoors 「小黑・室內」. Never an address or a reason.
    tag: indoor ? `${name}・${INDOOR_WORD}` : name,
    indoor,
    stale: freshness.stale,
    problem: problems.any,
    selected,
    size: base + (selected ? sizes.marker.selectedGrowth : 0),
    label: markerSpeech(dog, { name, indoor, freshness, problems, now }),
  };
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
  if (dog.charging) parts.push(battery ? `充電中 ${battery}` : '充電中');
  else if (problems.lowBattery) parts.push(`電量 ${battery}，偏低`);
  if (problems.outOfRange) parts.push('不在接收範圍');
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
    height: 16 * fontScale + 2 * (paddingV + border),
  };
}

const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Which name tags are drawn, given where each marker is on screen. Tags that
 * would overlap merge into one group tag 「3 隻」 (「3 隻・室內」 when every dog
 * in it is held indoors), drawn under the lowest of their faces; the others
 * in the group draw no tag. The selected dog keeps its own tag and is left out
 * of groups (DESIGN.md §9.5); a group of one is just that dog's own tag.
 *
 * @param markers dogMarkers() output
 * @param points screen positions by dog, in dp: { [slaveId]: { x, y } }
 * @returns { [slaveId]: { text, group: number, problem: boolean } | null }
 *   null = no tag under this face; dogs without a screen position keep their tag.
 */
export function nameTags(markers, points = {}, fontScale = 1) {
  const result = {};
  const placed = [];
  for (const marker of markers) {
    result[marker.slaveId] = { text: marker.tag, group: 1, problem: false };
    const point = points[marker.slaveId];
    if (marker.selected || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const { width, height } = tagSize(marker.tag, fontScale);
    const top = point.y + marker.size / 2 + sizes.marker.labelGap;
    placed.push({ marker, y: point.y,
      box: { left: point.x - width / 2, right: point.x + width / 2, top, bottom: top + height } });
  }
  // Union-find over overlapping tags: A over B and B over C is one group.
  const parent = placed.map((_, index) => index);
  const find = index => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      if (intersects(placed[i].box, placed[j].box)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  placed.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    // The tag sits under the lowest face, so it covers none of the others.
    const lead = members.reduce((low, item) => (item.y > low.y
      || (item.y === low.y && item.marker.slaveId < low.marker.slaveId) ? item : low));
    const indoor = members.every(item => item.marker.indoor);
    for (const item of members) result[item.marker.slaveId] = null;
    result[lead.marker.slaveId] = {
      text: `${members.length} 隻${indoor ? `・${INDOOR_WORD}` : ''}`,
      group: members.length,
      problem: members.some(item => item.marker.problem),
    };
  }
  return result;
}

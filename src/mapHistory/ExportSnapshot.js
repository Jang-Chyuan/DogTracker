import { t } from '../i18n';
// The export snapshot (H9/H10, 判定表「匯出快照和停在原處」): what the
// history screen shows at the moment a format is chosen — the range, every
// dog shown that has data in it (or my route), local and cloud merged — as
// the plain data the GPX, CSV and PNG builders read (ExportBuilders.md). Pure:
// the hook hands in the day's model (HistoryMultiModel.multiDayModel), the
// dogs' looks and the addresses already looked up.
import { historyMapPresentation, placeMarkers, routeLines, timeMarkers, uncrowded } from '../history/screen/HistoryMapModel';
import { interruptionText, km, nodePill, nodeTimes, placeLines, sectionText, vehicleExclusion } from '../history/HistoryText';
import { captureExportSnapshot } from './ExportData';
import { exportLightTheme, exportRouteColor } from '../theme/exportPalette';

const isSection = node => node?.type === 'movement' || node?.type === 'gap';
const isVehicle = mode => mode === 'driving' || mode === 'ride';
const lineOf = section => (!section ? null : section.type === 'gap' ? 'gap' : isVehicle(section.mode) ? 'solid' : 'dots');
export const placeKey = point => `${point.latitude},${point.longitude}`;

/**
 * The car or ride trips of a list (GPX: one trk per trip): vehicle rows only
 * separated by 沒有資料 rows are one trip (判定表「開車中間有中斷」: 同一段開車，
 * 地圖和 GPX 在中斷處分開 — the break splits its trkseg). A trip still on at
 * the last fix keeps that fix (an interval's end is otherwise the walk's).
 */
export function vehicleTrips(nodes, lastTime) {
  const trips = [];
  let open = null;
  for (const node of nodes) {
    if (node.type === 'movement' && isVehicle(node.mode)) {
      if (open && open.mode === node.mode) open.end = node.end;
      else { open = { start: node.start, end: node.end, mode: node.mode }; trips.push(open); }
    } else if (node.type !== 'gap') open = null;
  }
  return trips.map(({ start, end }) => ({ start, end: end === lastTime ? end + 1 : end }));
}

/** The places of a model whose address the export asks for (as the list does). */
export function exportPlaces(model) {
  return (model?.nodes || []).filter(node => !isSection(node) && Number.isFinite(node.latitude))
    .flatMap(node => node.originalRepresentative ? [node, node.originalRepresentative] : [node]);
}

/**
 * The end of an export: the newest packet in the range (判定表「「現在」和
 * 「最後 12:05」」: 匯出的檔案一律寫實際時刻), never a moving 「現在」.
 */
function lastPacket(models, range) {
  // A loop, not Math.max(...): a day of several dogs is 100 000+ packets.
  let last = -Infinity;
  for (const model of models) {
    for (const p of model.packets || []) if (p.time >= range.start && p.time <= range.end && p.time > last) last = p.time;
  }
  return Number.isFinite(last) ? last : range.end;
}

/**
 * The PNG list rows of one model (判定表「時間軸清單（匯出 PNG）」): the same
 * words as the screen's list (HistoryText), the end written as 「結束」, an
 * address that was not found as coordinates above the pill.
 */
export function exportTimelineRows(nodes, addressOf) {
  return nodes.map((node, index) => {
    if (isSection(node)) {
      const text = sectionText(node);
      return { kind: 'section', type: node.type, mode: node.mode, line: lineOf(node), icon: text.icon,
        lead: text.lead, time: text.time, rest: text.rest, start: node.start, end: node.end };
    }
    const found = addressOf(node);
    const lines = placeLines(node, found ? { state: 'found', text: found } : { state: 'none' });
    let pill = nodePill(node);
    // 匯出的檔案一律寫實際時刻: the end is 「結束」 (its time is in the left column).
    if (node.type === 'end' && (node.label === t('c130') || node.label === t("c660"))) pill = { text: t('c330'), tone: 'plain' };
    const next = nodes[index + 1];
    return { kind: 'place', type: node.type, number: node.number ?? null, times: nodeTimes(node),
      title: lines.title, coordinates: lines.coordinates, missing: lines.missing, pill,
      note: lines.coordinates ? interruptionText(node) : '', line: isSection(next) ? lineOf(next) : null,
      start: node.start, end: node.end, latitude: node.latitude, longitude: node.longitude };
  });
}

/**
 * What the PNG map draws of one subject (判定表「匯出和游標無關」「多隻狗 PNG
 * 的時間標記」): the whole route in the range at full strength (walking 4dp,
 * a car or ride 2dp solid, nothing across a break), the numbered stays and
 * switch points and the indoor houses, and the time markers — all of them
 * for one dog or my route, only the first and last for several dogs.
 */
export function exportMapLayer(model, color, { multi = false, subject = 'dog' } = {}) {
  // Light, whatever the phone's theme (the PNG is a fixed-light file).
  const lines = routeLines(model.edges || [], { color, theme: exportLightTheme, chunkEdges: Infinity });
  const presentation = historyMapPresentation(model, { color, subject, cursor: null, theme: exportLightTheme });
  const places = (presentation?.places || []).length ? presentation.places : placeMarkers(model.locations || []);
  const allIndoor = model.points.length > 0 && model.points.every(p => p.heldReason);
  const stays = (model.locations || []).filter(n => ['stop', 'indoor', 'switch'].includes(n.type));
  const times = multi ? timeMarkers(model.points, { allIndoor, stays, subject }).filter(marker => marker.end)
    : uncrowded(timeMarkers(model.points, { allIndoor, stays, subject }), places);
  // A route of one fix (or one hold) is still a point on the map.
  const single = model.points.length === 1 ? [{ latitude: model.points[0].latitude, longitude: model.points[0].longitude }] : [];
  return {
    color,
    lines: lines.map(line => ({ width: line.width, vehicle: line.vehicle,
      coordinates: line.coordinates.map(p => [p.latitude, p.longitude]) })),
    places: places.map(place => ({ kind: place.kind, number: place.number,
      latitude: place.coordinate.latitude, longitude: place.coordinate.longitude })),
    times: times.map(marker => ({ label: marker.label, end: marker.end, time: marker.time,
      latitude: marker.coordinate.latitude, longitude: marker.coordinate.longitude })),
    points: single.map(p => [p.latitude, p.longitude]),
  };
}

/**
 * The snapshot of the day shown. `day`: multiDayModel's result; `range`:
 * the shared range ({ start, end }); `subject`: 'dog' | 'phone'; `look[id]`:
 * { color, name }; `addresses`: { [placeKey]: text } of the places looked up
 * (missing = not found). Dogs without a packet in the range are left out by
 * the builders (判定表「多隻狗 PNG 沒資料的狗」). Frozen: 產生中 and 重試 use
 * this very copy (判定表「匯出快照和停在原處」).
 */
export function buildExportSnapshot({ day, range, subject, look = {}, addresses = {}, timeZone = null }) {
  if (!day || !range) throw new Error(t("c797"));
  const entries = day.subjects.filter(entry => entry.model);
  const until = lastPacket(entries.map(entry => entry.model), range);
  const since = range.start;
  // 多隻狗 means several with a packet in the range (a held packet counts).
  const multi = entries.filter(entry => (entry.model.packets || [])
    .some(p => p.time >= since && p.time <= until)).length > 1;
  const addressOf = node => addresses[placeKey(node)] || null;
  const subjects = entries.map(entry => {
    const model = entry.model;
    const phone = subject === 'phone';
    // The PNG is always light: a dark-theme route colour goes back to light.
    const color = exportRouteColor(look[entry.id]?.color);
    const nodes = model.nodes || [];
    const first = model.points[0], last = model.points[model.points.length - 1];
    return {
      kind: phone ? 'phone' : 'dog',
      id: entry.id,
      slaveId: phone ? null : Number(entry.id),
      name: phone ? t('c132') : look[entry.id]?.name || t("c798", { id: entry.id }),
      routeColor: color,
      // The rows of the day in the source, deduplicated (historySourceStream's packets).
      rows: model.packets || [],
      holds: nodes.filter(n => n.type === 'indoor').map(n => ({ start: n.start, end: n.end,
        latitude: n.latitude, longitude: n.longitude, address: addressOf(n) })),
      stays: nodes.filter(n => n.type === 'stop').map(n => ({ start: n.start, end: n.end, number: n.number,
        ...(n.originalRepresentative ? { gpxCoordinate: n.originalRepresentative,
          gpxAddress: addressOf(n.originalRepresentative) } : {}),
        latitude: n.latitude, longitude: n.longitude, address: addressOf(n), excludedMs: n.interruptionMs || 0 })),
      rides: vehicleTrips(nodes, last?.time),
      gaps: nodes.filter(n => n.type === 'gap').map(n => ({ start: n.start, end: n.end })),
      distanceKm: km(model.distanceM),
      distanceExclusion: vehicleExclusion(model, subject),
      distanceWord: phone ? t("c671") : t('c125'),
      start: first?.time ?? null,
      end: last?.time ?? null,
      timeline: exportTimelineRows(nodes, addressOf),
      map: first ? exportMapLayer(model, color, { multi, subject }) : null,
    };
  });
  if (multi) thinExportTimes(subjects.map(entry => entry.map).filter(Boolean));
  return captureExportSnapshot({ since, until: Math.max(since, until), timeZone, subjects });
}

// The PNG map is 1080 px wide with 128 px framing on each side (ExportPNG);
// a time label is about 120 px wide and 48 px high there.
const EXPORT_MAP_PX = 1080 - 2 * 128;
const LABEL_APART_PX = 120;
const metresBetween = (a, b) => {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dy = (a[0] - b[0]) * 111320;
  const dx = (a[1] - b[1]) * 111320 * Math.cos(lat);
  return Math.hypot(dx, dy);
};

/**
 * Several dogs' first and last times crowd where they set off together (#70):
 * thinned like the screen's time markers (uncrowded) — a time keeps its label
 * only when no number or label already kept is within a label's width on the
 * exported map. The protagonist (first subject) keeps its labels first, a
 * start before an end. Mutates the layers' `times`; the rings stay (the native
 * drawer draws a ring for every marker, and a label only for these).
 */
export function thinExportTimes(layers) {
  const all = layers.flatMap(layer => [
    ...layer.lines.flatMap(line => line.coordinates),
    ...layer.points,
    ...layer.places.map(place => [place.latitude, place.longitude]),
  ]);
  if (!all.length) return layers;
  // A loop, not Math.min(...all): a full day of several dogs is more points
  // than a call takes arguments.
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const [lat, lon] of all) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  const span = Math.max(
    metresBetween([south, west], [north, west]),
    metresBetween([south, west], [south, east]),
    1,
  );
  const apartM = (span / EXPORT_MAP_PX) * LABEL_APART_PX;
  const kept = layers.flatMap(layer => layer.places.map(place => [place.latitude, place.longitude]));
  for (const layer of layers) {
    for (const marker of [...layer.times].sort((a, b) => a.time - b.time)) {
      const at = [marker.latitude, marker.longitude];
      if (kept.some(other => metresBetween(at, other) < apartM)) marker.label = '';
      else kept.push(at);
    }
  }
  return layers;
}

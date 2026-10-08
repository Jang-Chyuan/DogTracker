// The export snapshot (H9/H10, 判定表「匯出快照和停在原處」): what the
// history screen shows at the moment a format is chosen — the range, every
// dog shown that has data in it (or my route), in the 資料來源 chosen — as
// the plain data the GPX, CSV and PNG builders read (ExportBuilders.md). Pure:
// the hook hands in the day's model (HistoryMultiModel.multiDayModel), the
// dogs' looks and the addresses already looked up.
import { historyMapPresentation, placeMarkers, routeLines, timeMarkers, uncrowded } from '../history/screen/HistoryMapModel';
import { interruptionText, km, nodePill, nodeTimes, placeLines, sectionText } from '../history/HistoryText';
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
  return (model?.nodes || []).filter(node => !isSection(node) && Number.isFinite(node.latitude));
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
 * address that was not found as coordinates + 「查不到地址」.
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
    if (node.type === 'end' && (node.label === '現在' || node.label === '最後')) pill = { text: '結束', tone: 'plain' };
    const next = nodes[index + 1];
    return { kind: 'place', type: node.type, number: node.number ?? null, times: nodeTimes(node),
      title: lines.title, coordinates: lines.coordinates, missing: lines.missing, pill,
      note: interruptionText(node), line: isSection(next) ? lineOf(next) : null,
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
export function exportMapLayer(model, color, { multi = false } = {}) {
  // Light, whatever the phone's theme (the PNG is a fixed-light file).
  const lines = routeLines(model.edges || [], { color, theme: exportLightTheme });
  const presentation = historyMapPresentation(model, { color, cursor: null, theme: exportLightTheme });
  const places = (presentation?.places || []).length ? presentation.places : placeMarkers(model.locations || []);
  const allIndoor = model.points.length > 0 && model.points.every(p => p.heldReason);
  const stays = (model.locations || []).filter(n => ['stop', 'indoor', 'switch'].includes(n.type));
  const times = multi ? timeMarkers(model.points, { allIndoor, stays }).filter(marker => marker.end)
    : uncrowded(timeMarkers(model.points, { allIndoor, stays }), places);
  // A route of one fix (or one hold) is still a point on the map.
  const single = model.points.length === 1 ? [{ latitude: model.points[0].latitude, longitude: model.points[0].longitude }] : [];
  return {
    color,
    lines: lines.map(line => ({ width: line.width, vehicle: line.vehicle,
      coordinates: line.coordinates.map(p => [p.latitude, p.longitude]) })),
    places: places.map(place => ({ kind: place.kind, number: place.number,
      latitude: place.coordinate.latitude, longitude: place.coordinate.longitude })),
    times: times.map(marker => ({ label: marker.label, end: marker.end,
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
  if (!day || !range) throw new Error('請等待歷史資料載入');
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
      name: phone ? '我的路線' : look[entry.id]?.name || `狗 ${entry.id}`,
      routeColor: color,
      // The rows of the day in the source, deduplicated (historySourceStream's packets).
      rows: model.packets || [],
      holds: nodes.filter(n => n.type === 'indoor').map(n => ({ start: n.start, end: n.end,
        latitude: n.latitude, longitude: n.longitude, address: addressOf(n) })),
      stays: nodes.filter(n => n.type === 'stop').map(n => ({ start: n.start, end: n.end, number: n.number,
        latitude: n.latitude, longitude: n.longitude, address: addressOf(n), excludedMs: n.interruptionMs || 0 })),
      rides: vehicleTrips(nodes, last?.time),
      gaps: nodes.filter(n => n.type === 'gap').map(n => ({ start: n.start, end: n.end })),
      distanceKm: km(model.distanceM),
      distanceWord: phone ? '走了' : '移動',
      start: first?.time ?? null,
      end: last?.time ?? null,
      timeline: exportTimelineRows(nodes, addressOf),
      map: first ? exportMapLayer(model, color, { multi }) : null,
    };
  });
  return captureExportSnapshot({ since, until: Math.max(since, until), timeZone, subjects });
}

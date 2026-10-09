// One day of the history screen for one dog, my route, or 2–4 dogs together
// (H1/H7; 判定表「主角」「多隻狗的共同範圍」「多隻狗共用游標」「換主角時的
// 共用時刻」「多隻狗非主角的路線」). Pure: the hook hands in each subject's rows
// (already read for the day, with the context before midnight) and gets back
// the protagonist, the shared range, every subject's timeline in that range
// and the cursor of each. Nothing here reads a clock, a database or React.
import { getTheme } from '../../theme/ThemeProvider';
import { historyTimeline } from '../HistoryTimeline';
import { size as sizes } from '../../theme/tokens';
import { protagonist as pickProtagonist } from './HistoryScreenDogs';
import { screenCursor } from './HistoryScreenCursor';
import { nearestRecord } from './HistoryScreenRange';
import { historyMapPresentation, withAlpha } from './HistoryMapModel';

const isLocal = source => source === 'local' || source === 'ble';

/**
 * Whether `rows` hold any packet of [dayStart, dayEnd) in `source` (判定表
 * 「停住期間的封包算不算『有紀錄』」: a held packet without a fix counts).
 * The cheap question asked of every added dog before any timeline is made.
 */
export function dayHasRecords(
  rows = [],
  { source = 'all', dayStart = -Infinity, dayEnd = Infinity } = {},
) {
  return rows.some(
    row =>
      row.time >= dayStart &&
      row.time < dayEnd &&
      (source === 'all' ||
        (isLocal(source)
          ? isLocal(row.source ?? 'local')
          : row.source === 'cloud')),
  );
}

/**
 * `subjects`: [{ id, rows, replayHolds?, subject? ('dog' | 'phone') }] in
 * the order they were added. `options`: dayStart, dayEnd, today, now,
 * source ('all' | 'local' | 'cloud'), manual (the dragged or remembered
 * range { start, end, following } or null), following (the end follows now),
 * protagonist (the id wanted), rangeOwner (whose automatic range is shared:
 * the protagonist when the screen opened or the day changed — 加入、移除、
 * 換主角都不改範圍; the protagonist when it has no record that day). Returns
 * { protagonist, range, subjects: [{ id, model, dayRecords, hasData }], main,
 *   dayPoints } — `main` is the protagonist's timeline, `range` the shared
 * range the summary and the range bar show (null without a fix), `dayPoints`
 * every subject's fixes of the day together (the range bar snaps to them).
 */
export function multiDayModel(subjects, options) {
  const {
    dayStart,
    dayEnd,
    today = false,
    now,
    source = 'all',
    manual = null,
    following = false,
    closedAt = null,
  } = options;
  if (!subjects.length)
    return {
      protagonist: null,
      range: null,
      subjects: [],
      main: null,
      dayPoints: [],
    };
  const timeline = (s, extra) =>
    historyTimeline(s.rows || [], {
      subject: s.subject || 'dog',
      source,
      dayStart,
      dayEnd,
      today,
      now,
      following,
      closedAt,
      replayHolds: s.replayHolds ?? undefined,
      ...extra,
    });
  const manualRange = manual
    ? { start: manual.start, end: manual.following ? null : manual.end }
    : null;
  // 主角: a dog with records that day first (the wanted one if it has some).
  const dayRecords = subjects.map(s =>
    dayHasRecords(s.rows, { source, dayStart, dayEnd }),
  );
  let main = pickProtagonist(
    subjects.map((s, i) => ({ id: s.id, hasData: dayRecords[i] })),
    options.protagonist,
  );
  const mainIndex = subjects.findIndex(s => s.id === main);
  const ownerIndex = subjects.findIndex(
    (s, i) => s.id === options.rangeOwner && dayRecords[i],
  );
  const leadIndex = ownerIndex >= 0 ? ownerIndex : mainIndex;
  const own = timeline(subjects[leadIndex], { manualRange });
  // 多隻狗的共同範圍: the dragged range, else the protagonist's own (出發 to
  // its last fix; following now today). Each dog is cut to it.
  // `kept`: the range shown when the dog that gave it was removed (移除不改範圍).
  const kept = !manual && options.kept ? options.kept : null;
  const shared = manual
    ? {
        start: manual.start,
        end: manual.following
          ? Math.max(now ?? 0, own.range.end ?? 0)
          : manual.end,
      }
    : kept
    ? {
        start: kept.start,
        end:
          kept.following && following ? Math.max(now ?? 0, kept.end) : kept.end,
      }
    : own.points.length
    ? {
        start: own.range.start,
        end: following ? Math.max(now ?? 0, own.range.end) : own.range.end,
      }
    : null;
  const models = subjects.map((s, i) => {
    if (i === leadIndex && !kept) return own;
    // Nothing that day in this source: no timeline to make (地圖不畫牠).
    if (!dayRecords[i]) return null;
    return timeline(s, {
      range: shared ?? { start: dayStart, end: dayEnd - 1 },
      manualRange,
    });
  });
  const entries = subjects.map((s, i) => ({
    id: s.id,
    model: models[i],
    dayRecords: !!models[i]?.dayRecords,
    hasData: !!models[i]?.points.length,
  }));
  // 「加入的狗這段時間沒資料」: a dog without a fix in the shared range is not
  // the protagonist while another has one (a dragged range can leave the
  // protagonist of the day without one).
  main = pickProtagonist(entries, main);
  const mainEntry = entries.find(e => e.id === main);
  const points =
    !kept && own.points.length ? own.points : mainEntry.model.points;
  const ends = entries
    .filter(e => e.hasData)
    .map(e => e.model.points[e.model.points.length - 1].time);
  const range =
    kept && entries.some(e => e.hasData)
      ? {
          start: kept.start,
          end: kept.following && following ? Math.max(...ends) : kept.end,
          following: !!kept.following && following,
        }
      : !points.length && !manual
      ? null
      : manual
      ? {
          start: manual.start,
          end: manual.following ? Math.max(...ends, manual.start) : manual.end,
          following: !!manual.following && following,
        }
      : {
          start: points[0].time,
          end: points[points.length - 1].time,
          following,
        };
  const dayPoints =
    entries.length === 1
      ? mainEntry.model.dayPoints
      : entries
          .flatMap(e => e.model?.dayPoints || [])
          .sort((a, b) => a.time - b.time);
  return {
    protagonist: main,
    range,
    subjects: entries,
    main: mainEntry.model,
    dayPoints,
  };
}

/**
 * The shared cursor time (null: the protagonist's newest fix in the range),
 * kept inside the range (判定表「範圍縮小後游標在外面」: to its nearer end).
 */
export function sharedCursorTime(day, cursorTime) {
  const points = day.main?.points ?? [];
  if (!day.range) return null;
  if (cursorTime == null)
    return points.length ? points[points.length - 1].time : null;
  return Math.min(Math.max(cursorTime, day.range.start), day.range.end);
}

/**
 * The cursor of every subject at the shared time: { [id]: screenCursor }.
 * One subject keeps the single screen's rule (the nearest fix, a 沒有資料 row
 * waits before the break); with more, each dog without a fix at that time
 * waits at its last fix before it with the grey ring (判定表「多隻狗共用游標」),
 * and the protagonist too (「主角在游標時間沒資料」).
 */
export function multiCursors(
  day,
  time,
  { inGap = false, subject = 'dog' } = {},
) {
  const cursors = {};
  if (time == null) return cursors;
  const single = day.subjects.length === 1;
  for (const entry of day.subjects) {
    const model = entry.model;
    if (!model?.points.length) {
      cursors[entry.id] = null;
      continue;
    }
    const withEdges = { ...model, distanceEdges: model.edges };
    const main = entry.id === day.protagonist;
    if (single) {
      cursors[entry.id] = screenCursor(
        withEdges,
        nearestRecord(model.points, time).time,
        { subject, action: inGap ? 'gap' : 'entry' },
      );
    } else {
      cursors[entry.id] = screenCursor(withEdges, time, {
        subject: 'dog',
        action: main && inGap ? 'gap' : 'shared',
      });
    }
  }
  return cursors;
}

/**
 * What the map draws for the day: the protagonist's route, numbers and
 * times (historyMapPresentation), and for each other dog with a fix in the
 * range a thinner line (3dp; 50% before the cursor, 20% after; rides 2dp)
 * and its face at its cursor point. The camera frames the protagonist's
 * route only (判定表「多隻狗的 PNG 地圖」: 不照 App 裡只框主角).
 * `look[id]`: { color, name, avatar }.
 */
export function multiMapPresentation(day, cursors, look, theme = getTheme()) {
  const { colors } = theme;
  const main = day.subjects.find(s => s.id === day.protagonist);
  if (!main?.model) return null;
  const cursor = cursors[main.id] ?? null;
  const base = historyMapPresentation(main.model, {
    color: look[main.id]?.color ?? colors.route1,
    cursor,
    theme,
  });
  if (day.subjects.length === 1) return base;
  const cursorTime = cursor?.time ?? cursor?.point?.time ?? Infinity;
  const others = day.subjects.filter(s => s.id !== main.id && s.hasData);
  const lines = others.flatMap(s =>
    otherLines(
      s.model.edges || [],
      look[s.id]?.color ?? colors.route2,
      cursorTime,
      theme,
    ),
  );
  const faces = others
    .map(s => {
      const c = cursors[s.id];
      if (!c?.point) return null;
      return {
        id: s.id,
        coordinate: {
          latitude: c.point.latitude,
          longitude: c.point.longitude,
        },
        stale: !!c.stale,
        lines: c.label,
        color: look[s.id]?.color,
        name: look[s.id]?.name,
        avatar: look[s.id]?.avatar ?? null,
      };
    })
    .filter(Boolean);
  return {
    ...base,
    // The others under the protagonist's line.
    lines: [...lines, ...base.lines],
    faces,
    // The protagonist's cursor is a face with its name too (多隻狗時的游標點).
    cursor: base.cursor
      ? {
          ...base.cursor,
          face: {
            name: look[main.id]?.name,
            avatar: look[main.id]?.avatar ?? null,
          },
        }
      : null,
  };
}

// 多隻狗非主角的路線: 3dp, 50% before the cursor and 20% after; a ride 2dp
// at the same opacities; nothing across a break, nothing outside the range.
function otherLines(edges, color, cursorTime, theme = getTheme()) {
  const { opacity } = theme;
  const lines = [];
  let current = null;
  for (const edge of edges) {
    if (edge.gap || edge.mode === 'gap') {
      current = null;
      continue;
    }
    const vehicle = edge.mode === 'driving' || edge.mode === 'ride';
    const width = vehicle ? sizes.route.drive : sizes.route.secondary;
    const stroke = withAlpha(
      color,
      edge.start >= cursorTime
        ? opacity.routeAfterCursor
        : opacity.routeBeforeCursor,
    );
    const key = `${width}:${stroke}`;
    const coordinate = p => ({ latitude: p.latitude, longitude: p.longitude });
    if (current && current.key === key && current.end === edge.start) {
      current.coordinates.push(coordinate(edge.to));
      current.end = edge.end;
      continue;
    }
    current = {
      key,
      width,
      color: stroke,
      dashed: theme.isDark && edge.start >= cursorTime,
      vehicle,
      start: edge.start,
      end: edge.end,
      coordinates: [coordinate(edge.from), coordinate(edge.to)],
    };
    lines.push(current);
  }
  return lines.map(({ key, end, ...line }) => line);
}

// 多隻狗時的游標點 (non-protagonist): a 32dp face and its name.
export const OTHER_FACE = 32;

/**
 * The other dogs' faces as the map's dog markers (DogMarkerView): 32dp, the
 * face drawn on the dog's route colour, a grey dashed ring while it has no
 * data at the cursor's time, and what TalkBack says (c381: 「豆豆的游標，
 * 10:24，已移動 2.1 km，點兩下設為主角」).
 */
export function faceMarkers(faces = []) {
  return (faces || []).map(face => ({
    slaveId: face.id,
    coordinate: face.coordinate,
    size: OTHER_FACE,
    tag: face.name,
    name: face.name,
    problem: false,
    indoor: false,
    stale: false,
    selected: false,
    staleRing: !!face.stale,
    tint: face.color,
    label: face.stale
      ? `${face.name}的游標，這段沒資料，最後 ${
          face.lines?.[0] ?? ''
        }，點兩下設為主角`
      : `${face.name}的游標，${face.lines?.[0] ?? ''}，${
          face.lines?.[1] ?? ''
        }，點兩下設為主角`,
  }));
}

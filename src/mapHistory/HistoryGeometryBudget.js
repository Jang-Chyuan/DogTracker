// Native overlay count matters as much as vertex count. Never bridge omitted gaps.
export const HISTORY_SEGMENT_LIMIT = 120;
export const HISTORY_VERTEX_LIMIT = 4000;

export function groupHistoryStreams(points) {
  const streams = new Map();
  for (const point of points) {
    const key = JSON.stringify([point.master_id ?? null, point.slave_id ?? null, point.session_id ?? null]);
    if (!streams.has(key)) streams.set(key, []);
    streams.get(key).push(point);
  }
  return [...streams.values()];
}

export function budgetHistoryTracks(tracks) {
  const entries = tracks.flatMap((track, index) => track.segments.map(segment => ({ index, segment })))
    .sort((a, b) => b.segment[b.segment.length - 1]?.time - a.segment[a.segment.length - 1]?.time);
  const kept = tracks.map(() => []);
  let vertices = HISTORY_VERTEX_LIMIT, segments = HISTORY_SEGMENT_LIMIT;
  for (const entry of entries) {
    if (!entry.segment.length || !vertices) continue;
    const drawable = entry.segment.length > 1;
    if (drawable && (!segments || vertices < 2)) continue;
    const part = entry.segment.slice(-vertices);
    kept[entry.index].unshift(part);
    vertices -= part.length;
    if (drawable) segments--;
  }
  return tracks.map((track, index) => ({ ...track, segments: kept[index],
    limited: track.limited || kept[index].reduce((n, part) => n + part.length, 0)
      < track.segments.reduce((n, part) => n + part.length, 0) }));
}

export function budgetHistory(data) {
  const [phone, ...clients] = budgetHistoryTracks([data.phone, ...data.clients]);
  return { ...data, phone, clients };
}

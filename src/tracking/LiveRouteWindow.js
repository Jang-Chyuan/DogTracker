import { toRouteSample } from './RouteSamples';
import {
  buildRoutePieces,
  canJoinSamples,
  sameCoordinate,
} from './RouteSegments';
import { simplifyRoute } from './SimplifyRoute';
import {
  DEFAULT_LIVE_ROUTE_MAX_POINTS,
  DEFAULT_LIVE_ROUTE_TOLERANCE_METERS,
  LIVE_ROUTE_CHUNK_SIZE,
} from './LiveRoutePolicy';

const ROLES = ['master', 'slave'];
export const compareRouteKeys = (a, b) =>
  a.receivedAt - b.receivedAt || a.id - b.id;

export function emptyLiveRoute() {
  return {
    masterSegments: [],
    slaveSegments: [],
    rawCount: 0,
    masterPointCount: 0,
    slavePointCount: 0,
    rawBufferCount: 0,
    limited: false,
    startAt: null,
    endAt: null,
  };
}

/**
 * Bounded streaming display cache. Middle chunks contain simplified geometry
 * only. At most the oldest and newest chunks retain raw geometry (not payloads).
 * The oldest chunk is reread when the rolling cutoff enters it; filtering
 * already-simplified vertices would lose valid points at that time boundary.
 */
export function createLiveRouteWindow({
  maxPoints = DEFAULT_LIVE_ROUTE_MAX_POINTS,
  toleranceMeters = DEFAULT_LIVE_ROUTE_TOLERANCE_METERS,
  chunkSize = LIVE_ROUTE_CHUNK_SIZE,
} = {}) {
  if (
    !Number.isInteger(chunkSize) ||
    chunkSize < 1 ||
    chunkSize > LIVE_ROUTE_CHUNK_SIZE
  )
    throw new RangeError('Route chunk size must be between 1 and 1000');
  if (!Number.isInteger(maxPoints) || maxPoints < 1)
    throw new RangeError('Route display budget must be a positive integer');
  if (!Number.isFinite(toleranceMeters) || toleranceMeters < 0)
    throw new RangeError('Route tolerance must be finite and non-negative');
  let chunks = [];
  let cutoff = -Infinity;
  let omittedThrough = -Infinity;
  let version = 0;
  let publishedVersion = -1;
  let published = emptyLiveRoute();

  function isLimited() {
    // Before the first valid row, both sentinels are -Infinity. An empty or
    // failed initial read is not truncation: an actual omission must exist.
    return Number.isFinite(omittedThrough) && omittedThrough >= cutoff;
  }

  function compile(samples) {
    const result = {
      first: samples[0],
      last: samples[samples.length - 1],
      count: samples.length,
      raw: samples,
      maxId: Math.max(...samples.map(sample => sample.id)),
    };
    for (const role of ROLES) {
      result[role] = buildRoutePieces(samples, role).map(piece =>
        simplifyRoute(piece, toleranceMeters),
      );
      result[`${role}Count`] = result[role].reduce(
        (sum, piece) => sum + piece.length,
        0,
      );
    }
    return result;
  }

  function releaseMiddleRaw() {
    chunks = chunks.map((chunk, index) =>
      index > 0 && index < chunks.length - 1 && chunk.raw
        ? { ...chunk, raw: null }
        : chunk,
    );
  }

  function enforceBudget() {
    const overBudget = () =>
      ROLES.some(
        role =>
          // Even empty/constant chunks consume metadata. Charge at least two
          // slots so missing GPS at a high write rate cannot grow an unbounded list.
          chunks.reduce(
            (sum, chunk) => sum + Math.max(2, chunk[`${role}Count`]),
            0,
          ) > maxPoints,
      );
    while (chunks.length && overBudget()) {
      if (chunks.length > 1) {
        omittedThrough = Math.max(
          omittedThrough,
          chunks.shift().last.receivedAt,
        );
      } else {
        const raw = chunks[0].raw;
        const remove = Math.max(1, Math.floor(raw.length / 2));
        omittedThrough = Math.max(omittedThrough, raw[remove - 1].receivedAt);
        chunks = remove === raw.length ? [] : [compile(raw.slice(remove))];
      }
    }
    releaseMiddleRaw();
    version += 1;
  }

  return {
    reset() {
      chunks = [];
      omittedThrough = -Infinity;
      version += 1;
    },

    prepend(rows) {
      const samples = rows
        .filter(
          row => Number.isFinite(row.receivedAt) && row.receivedAt >= cutoff,
        )
        .map(toRouteSample)
        .sort(compareRouteKeys);
      if (!samples.length) return;
      // Keyset pages must be disjoint. A reread/retry cannot duplicate geometry.
      const first = chunks[0]?.first;
      const older = first
        ? samples.filter(sample => compareRouteKeys(sample, first) < 0)
        : samples;
      for (let end = older.length; end > 0; end -= chunkSize)
        chunks.unshift(compile(older.slice(Math.max(0, end - chunkSize), end)));
      enforceBudget();
    },

    append(rows) {
      const samples = rows
        .filter(
          row => Number.isFinite(row.receivedAt) && row.receivedAt >= cutoff,
        )
        .map(toRouteSample)
        .sort(compareRouteKeys);
      if (!samples.length) return true;
      const last = chunks[chunks.length - 1]?.last;
      // A late timestamp belongs inside a compressed chunk. Rebuild from DB,
      // never splice into or simplify an already-simplified line (error compounds).
      if (last && compareRouteKeys(samples[0], last) <= 0) return false;
      let offset = 0;
      while (offset < samples.length) {
        const tail = chunks[chunks.length - 1];
        const available = tail ? chunkSize - tail.count : 0;
        if (available > 0) {
          const part = samples.slice(offset, offset + available);
          chunks[chunks.length - 1] = compile([...tail.raw, ...part]);
          offset += part.length;
        } else {
          const part = samples.slice(offset, offset + chunkSize);
          chunks.push(compile(part));
          offset += part.length;
        }
      }
      enforceBudget();
      return true;
    },

    async advanceCutoff(nextCutoff, readChunk, isCurrent = () => true) {
      if (nextCutoff <= cutoff) return true;
      let next = chunks.filter(chunk => chunk.last.receivedAt >= nextCutoff);
      const first = next[0];
      if (first && first.first.receivedAt < nextCutoff) {
        const raw = first.raw || (await readChunk(first)).map(toRouteSample);
        if (!isCurrent()) return false;
        const inside = raw.filter(sample => sample.receivedAt >= nextCutoff);
        next = inside.length
          ? [compile(inside), ...next.slice(1)]
          : next.slice(1);
      }
      if (!isCurrent()) return false;
      chunks = next;
      cutoff = nextCutoff;
      enforceBudget();
      return true;
    },

    isLimited,

    snapshot() {
      if (version === publishedVersion) return published;
      const result = emptyLiveRoute();
      for (const role of ROLES) {
        const pieces = [];
        let previous = null;
        for (const chunk of chunks) {
          chunk[role].forEach((piece, index) => {
            if (
              index === 0 &&
              pieces.length &&
              canJoinSamples(previous, chunk.first, role)
            ) {
              const target = pieces[pieces.length - 1];
              const start = sameCoordinate(target[target.length - 1], piece[0])
                ? 1
                : 0;
              for (let i = start; i < piece.length; i += 1)
                target.push(piece[i]);
            } else pieces.push([...piece]);
          });
          previous = chunk.last;
        }
        result[`${role}Segments`] = pieces.filter(piece => piece.length > 1);
        result[`${role}PointCount`] = result[`${role}Segments`].reduce(
          (sum, piece) => sum + piece.length,
          0,
        );
      }
      result.rawCount = chunks.reduce((sum, chunk) => sum + chunk.count, 0);
      result.rawBufferCount = chunks.reduce(
        (sum, chunk) => sum + (chunk.raw?.length || 0),
        0,
      );
      result.limited = isLimited();
      result.startAt = chunks[0]?.first.receivedAt ?? null;
      result.endAt = chunks[chunks.length - 1]?.last.receivedAt ?? null;
      published = result;
      publishedVersion = version;
      return published;
    },
  };
}

import { distanceMeters } from './IndoorHold';

// A held dog is drawn where it was last seen clearly, which is often the door
// it walked through. OpenStreetMap building outlines move it into the house:
// a house it stands in or next to draws the dog at the middle of that house.
// Large buildings are left alone, because their middle can be far from the
// dog, and nothing moves further than MAX_MOVE_M.
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const SNAP_CONFIG = Object.freeze({
  searchRadiusM: 40,
  nearDoorM: 25,
  houseMaxAreaM2: 2000,
  maxMoveM: 50,
  timeoutMs: 8000,
  // Places remembered, and how soon a failed lookup may be asked again.
  cacheSize: 500,
  retryAfterMs: 60000,
  // Coordinates sent out are rounded to about 11 m, and so is the cache key.
  precision: 4,
});

function local(origin) {
  const scale = Math.cos(origin.latitude * Math.PI / 180) * 111320;
  return {
    to: point => ({ x: (point.longitude - origin.longitude) * scale, y: (point.latitude - origin.latitude) * 111320 }),
    from: ({ x, y }) => ({ latitude: origin.latitude + y / 111320, longitude: origin.longitude + x / scale }),
  };
}

function areaAndCentroid(ring) {
  let area = 0, x = 0, y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index], b = ring[(index + 1) % ring.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  area /= 2;
  return area ? { area: Math.abs(area), centroid: { x: x / (6 * area), y: y / (6 * area) } } : null;
}

function inside(point, ring) {
  let result = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index], b = ring[previous];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function edgeDistance(point, ring) {
  let best = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index], b = ring[(index + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const share = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(point.x - (a.x + share * dx), point.y - (a.y + share * dy)));
  }
  return best;
}

/** Picks the house to snap into from Overpass `out geom` ways, or null. */
export function chooseBuilding(anchor, ways, config = SNAP_CONFIG) {
  const frame = local(anchor);
  const origin = { x: 0, y: 0 };
  const houses = [];
  for (const way of ways || []) {
    const ring = (way.geometry || []).map(node => frame.to({ latitude: node.lat, longitude: node.lon }));
    if (ring.length < 3) continue;
    const shape = areaAndCentroid(ring);
    if (!shape) continue;
    houses.push({ id: way.id, ring, ...shape, contains: inside(origin, ring), gap: edgeDistance(origin, ring) });
  }
  const within = houses.filter(house => house.contains).sort((a, b) => a.area - b.area)[0];
  // Standing in a big building: stay where the dog was seen.
  if (within && within.area > config.houseMaxAreaM2) return null;
  const chosen = within || houses.filter(house => house.gap <= config.nearDoorM
    && house.area <= config.houseMaxAreaM2).sort((a, b) => a.gap - b.gap)[0];
  if (!chosen || !inside(chosen.centroid, chosen.ring)) return null;
  const coordinate = frame.from(chosen.centroid);
  if (distanceMeters(coordinate, anchor) > config.maxMoveM) return null;
  return { coordinate, buildingId: chosen.id, areaM2: Math.round(chosen.area) };
}

export function snapKey(anchor, config = SNAP_CONFIG) {
  return `${anchor.latitude.toFixed(config.precision)},${anchor.longitude.toFixed(config.precision)}`;
}

/**
 * Looks buildings up once per rounded anchor. lookup() never throws and never
 * waits for the network: it answers from the cache (or undefined while a
 * request is out) and tells subscribers when an answer arrives.
 */
export function createBuildingSnapper({ fetchImpl = typeof fetch === 'function' ? fetch : null,
  config = SNAP_CONFIG } = {}) {
  const cache = new Map();
  const listeners = new Set();
  // Every write keeps the cache bounded; the oldest places go first.
  function put(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > config.cacheSize) cache.delete(cache.keys().next().value);
  }
  async function request(key) {
    const [latitude, longitude] = key.split(',');
    const query = `[out:json][timeout:10];way["building"](around:${config.searchRadiusM},${latitude},${longitude});out geom;`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(OVERPASS_URL, {
        method: 'POST', signal: controller?.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const anchor = { latitude: Number(latitude), longitude: Number(longitude) };
      put(key, { value: chooseBuilding(anchor, body.elements, config) });
    } catch (_) {
      // Offline or refused: draw the dog where it was seen, ask again later.
      put(key, { value: null, failedAt: Date.now() });
    } finally {
      clearTimeout(timer);
      for (const listener of listeners) listener(key);
    }
  }
  return {
    lookup(anchor) {
      if (!anchor) return null;
      const key = snapKey(anchor, config);
      const entry = cache.get(key);
      if (entry?.pending) return undefined;
      if (entry && !(entry.failedAt && Date.now() - entry.failedAt > config.retryAfterMs)) {
        put(key, entry);
        return entry.value ?? null;
      }
      if (!fetchImpl) return null;
      put(key, { pending: true });
      request(key);
      return undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cached(anchor) {
      return anchor ? cache.get(snapKey(anchor, config))?.value ?? null : null;
    },
  };
}

// One cache for the app: the live map asks, the history reuses the answers.
export const buildingSnapper = createBuildingSnapper();

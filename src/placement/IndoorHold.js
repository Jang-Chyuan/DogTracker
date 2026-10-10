import { t } from '../i18n';
import { predictEnvironment, ENVIRONMENT_WINDOW_MS } from '../ml/Environment';
import { rawCoordinate, rawSpeedKmh } from './RawObservation';

// Indoors a collar either loses its fix or keeps one that wanders tens to
// hundreds of metres. Instead of moving the dog to a hand-entered point, the
// map holds it where it was last seen clearly: the good fixes just before the
// signal went bad. Nothing is drawn where the dog has not been measured.
// Every threshold below was set against simulated collars
// (__fixtures__/IndoorScenarios.js), not field logs; they are the first thing
// to revisit once real indoor and under-tree recordings exist.
export const HOLD_CONFIG = Object.freeze({
  // A fix counts as good with this many satellites and this HDOP or better,
  // and only when the row before it, at most trustGapMs earlier, was good too:
  // one good-looking fix among weak ones is usually multipath through a window.
  goodMinSatellites: 5,
  goodMaxHdop: 2,
  trustGapMs: 90000,
  // The same coordinate from another Master within this long is a relayed copy.
  duplicateWindowMs: 60000,
  // How long without a good fix before a hold may start: with no fix at all,
  // with the model saying indoor or the charger plugged in, and otherwise
  // (the model calls a lot of open sky "window", and a bridge is short).
  enterAfterMs: 60000,
  enterIndoorAfterMs: 20000,
  enterWindowAfterMs: 45000,
  // The anchor: the newest group of good fixes within anchorClusterM of each
  // other, from the anchorLookbackMs before the last good fix. An older group
  // wins only if the dog stayed in it (anchorStayMs, ended within
  // anchorRecentMs) and it is twice as large.
  anchorLookbackMs: 600000,
  anchorClusterM: 30,
  anchorFixes: 8,
  anchorStayMs: 60000,
  anchorRecentMs: 120000,
  // The weak fixes after the anchor (the latest five when holding on silence,
  // the last anchorCheckMs otherwise) must lie within anchorCheckM of it, or
  // the dog has already moved on from it.
  anchorCheckMs: 60000,
  anchorCheckM: 100,
  // With the model saying indoor or window, parkedFixes good fixes within
  // parkedRadiusM for a minute start a hold at once (a dog by a window).
  parkedFixes: 4,
  parkedRadiusM: 15,
  // Travelling: travelSlices consecutive slices (travelSliceMs, longer for a
  // sparse collar) of all fixes, each step at least travelStepM the same way,
  // travelTotalM overall. Indoor drift jumps around; a dog keeps going.
  // A travelling dog is not held; a held one is let go once the fixes have
  // travelled travelReleaseM from the anchor.
  travelSlices: 4,
  travelSliceMs: 30000,
  travelStepM: 12,
  travelTotalM: 60,
  travelReleaseM: 80,
  // Good fixes within refineRadiusM refine the anchor, which moves on the map
  // only when the refined median is refineStepM away.
  refineRadiusM: 20,
  refineFixes: 200,
  refineStepM: 15,
  // Good fixes beyond releaseRadiusM let go: two when most rows are good
  // (outdoors); releaseGoodFixes (releaseGoodFixesIndoor while the model or
  // charger says inside) agreeing within releaseAgreeM; two beyond releaseFarM.
  releaseRadiusM: 80,
  releaseGoodFixes: 2,
  releaseGoodFixesIndoor: 3,
  releaseAgreeM: 30,
  // With fresh indoor/window evidence, a brief group of multipath fixes must
  // not free the anchor. Confirm agreement over time, or a continuing walk.
  releaseIndoorMinSpanMs: 30000,
  // Good fixes on a run or in a car do not cluster within releaseAgreeM.
  // A short, mostly direct progression well outside the anchor is stronger
  // departure evidence than waiting for the weak-fix travel slices.
  releaseGoodTravelMinSpanMs: 10000,
  releaseGoodTravelDirectness: 0.8,
  goodShareWindowMs: 60000,
  // Good fixes whose median over nearbyMinSpanMs (at least nearbyFixes, with
  // nearbyGoodShare of rows good) sits beyond nearbyAwayM also let go.
  nearbyWindowMs: 120000,
  nearbyFixes: 6,
  nearbyMinSpanMs: 60000,
  nearbyGoodShare: 0.7,
  nearbyAwayM: 60,
  goodShareOutside: 0.5,
  releaseFarM: 100,
  releaseWindowMs: 180000,
  // Weak fixes let go when, of at least farFixes spanning farMinSpanMs (the
  // window grows for a sparse collar), farShare lie beyond farRadiusM.
  farRadiusM: 150,
  farFixes: 10,
  farShare: 0.75,
  farMinSpanMs: 90000,
  // Without any good fix the anchor is the median of the weak fixes, moved on
  // the map only by weakAnchorStepM or more.
  weakAnchorMin: 3,
  weakPool: 300,
  weakAnchorStepM: 10,
  // A hold starting within stickyMs and stickyRadiusM of where the last one
  // ended reuses its anchor; within cautiousAfterReleaseMs of letting go, the
  // fixes themselves must show the dog stopped.
  stickyMs: 600000,
  stickyRadiusM: 30,
  cautiousAfterReleaseMs: 120000,
  // A history hold reaches back over the drift before it at most retroMaxMs,
  // and never over rows farther than farRadiusM from the anchor.
  retroMaxMs: 180000,
  // An environment result older than this no longer says where the dog is.
  environmentFreshMs: 2 * ENVIRONMENT_WINDOW_MS,
  stationaryTailMs: 120000,
  stationaryTailFixes: 6,
  stationaryTailMaxDelayMs: 180000,
});

const EARTH_RADIUS_M = 6371000;
const radians = degrees => degrees * Math.PI / 180;

export function distanceMeters(a, b) {
  const latitude = radians((a.latitude + b.latitude) / 2);
  const x = radians(b.longitude - a.longitude) * Math.cos(latitude);
  const y = radians(b.latitude - a.latitude);
  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_M;
}

function median(values) {
  // A typed array sorts numbers without a comparator: this runs on most rows.
  const sorted = Float64Array.from(values).sort();
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianPoint(points) {
  return {
    latitude: median(points.map(point => point.latitude)),
    longitude: median(points.map(point => point.longitude)),
  };
}

const finite = value => (value === null || value === undefined || value === '' ? null
  : Number.isFinite(Number(value)) ? Number(value) : null);

// Collars without a fix report 0,0 (seen on hardware 2026-09-18).
export function hasFix(row) {
  const latitude = finite(row?.latitude), longitude = finite(row?.longitude);
  return latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export function fixQuality(row, config = HOLD_CONFIG) {
  if (!hasFix(row)) return 'none';
  const satellites = finite(row.satellites);
  // HDOP arrives divided by 100 (cloud payloads, BLE JSON); 65535 / 655.35
  // means "no HDOP", and nothing real is below 0.3. Any other value of 100 or more can only be the raw ×100
  // integer, which real HDOP never reaches.
  let hdop = finite(row.hdop);
  if (hdop === 65535 || (hdop !== null && Math.abs(hdop - 655.35) < 0.01) || hdop < 0.3) hdop = null;
  else if (hdop !== null && hdop >= 100) hdop /= 100;
  // Rows that never carried quality fields keep the old behaviour: shown as is.
  if (satellites === null && hdop === null) return 'good';
  const enoughSatellites = satellites === null || satellites >= config.goodMinSatellites;
  const sharpEnough = hdop === null || hdop <= config.goodMaxHdop;
  return enoughSatellites && sharpEnough ? 'good' : 'weak';
}

const charging = value => value === 1 || value === true || value === '1';

const REASONS = Object.freeze({
  charging: t("c731"),
  indoor: t('c114'),
  window: t("c853"),
  noFix: t("c882"),
  weak: t("c883"),
});

/**
 * Follows one dog's rows in time order and decides whether the map should
 * hold it at an anchor. Rows: { time, latitude, longitude, satellites, hdop,
 * rssi, snr, usb_present, master_id, slave_id }; latitude/longitude are the
 * raw fix (0,0 or null without one).
 *
 * push() returns an event when the hold starts or ends, so a history pass can
 * also move the rows between the last good fix and the start onto the anchor.
 */
// Another Master's relay of a fix already seen (or the same row twice).
function isCopy(fixes, row, config) {
  return hasFix(row) && fixes.some(fix => row.time - fix.time <= config.duplicateWindowMs
    && row.time >= fix.time && (fix.master !== String(row.master_id ?? '') || fix.time === row.time)
    && fix.latitude === Number(row.latitude) && fix.longitude === Number(row.longitude));
}

export function createHoldTracker(config = HOLD_CONFIG, { classify = predictEnvironment } = {}) {
  const goods = [];
  const weak = [];
  const rawTail = [];
  let lastGoodAt = null;
  let lastTime = -Infinity;
  let usb = false;
  let environment = null;
  let held = null;
  let previous = null;
  let previousHold = null;
  const recentFixes = [];
  // The last LoRa signal this phone's own receiver heard from the dog.
  let bleSignal = null;
  const buckets = new Map();
  let bucketStart = null;

  // Several Masters can hear the dog in the same window. Their LoRa signal
  // says how far each receiver is, not where the dog is, so the window takes
  // the answer of the receiver that heard it best instead of the last one.
  function finishBuckets() {
    let best = null, bestRssi = -Infinity;
    for (const rows of buckets.values()) {
      const signals = rows.map(row => finite(row.rssi)).filter(value => value !== null);
      const rssi = signals.length ? signals.reduce((sum, value) => sum + value, 0) / signals.length : -Infinity;
      try {
        const result = classify(rows);
        if (result && (!best || rssi > bestRssi)) { best = result; bestRssi = rssi; }
      } catch (_) {
        // A malformed window says nothing about the dog; keep the previous answer.
      }
    }
    if (best && (!environment || best.observedAt >= environment.observedAt)) environment = best;
    buckets.clear();
  }

  function trackEnvironment(row) {
    const bucket = Math.floor(row.time / ENVIRONMENT_WINDOW_MS) * ENVIRONMENT_WINDOW_MS;
    if (bucketStart !== null && bucket !== bucketStart) finishBuckets();
    bucketStart = bucket;
    const key = String(row.master_id ?? '');
    if (!buckets.has(key)) buckets.set(key, []);
    const bucketRows = buckets.get(key);
    const last = bucketRows[bucketRows.length - 1];
    // The BLE row and its cloud copy are one observation.
    if (last && last.track_at === row.time && last.slave_lat === (hasFix(row) ? Number(row.latitude) : 0)
      && last.slave_lon === (hasFix(row) ? Number(row.longitude) : 0)) return;
    bucketRows.push({
      master_id: row.master_id, slave_id: row.slave_id, track_at: row.time,
      slave_lat: hasFix(row) ? Number(row.latitude) : 0,
      slave_lon: hasFix(row) ? Number(row.longitude) : 0,
      satellites: row.satellites, hdop: row.hdop, rssi: row.rssi, snr: row.snr,
      usb_present: row.usb_present,
    });
  }

  function evidence(time) {
    if (usb) return 'charging';
    if (environment && time - environment.observedAt >= 0
      && time - environment.observedAt <= config.environmentFreshMs) {
      if (environment.environment === 'indoor') return 'indoor';
      if (environment.environment === 'window') return 'window';
    }
    return null;
  }

  const near = (point, others, radius) => others.filter(other => distanceMeters(point, other) <= radius);

  // The newest group of good fixes that stayed together. A single stray fix
  // (multipath through a window) loses to the group the dog was really in; on
  // a drive, where no two fixes are close, the last one before stopping wins.
  function anchorGroup() {
    if (!goods.length) return null;
    // However long the dog has been inside, the anchor comes from the minutes
    // before its last good fix.
    const lastGood = goods[goods.length - 1].time;
    const recent = goods.filter(good => lastGood - good.time <= config.anchorLookbackMs);
    let best = null;
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const group = near(recent[index], recent, config.anchorClusterM);
      if (!best || group.length > best.length) best = group;
    }
    const latest = recent[recent.length - 1];
    const trailing = near(latest, recent, config.anchorClusterM);
    // Only a group the dog stayed in may outvote the newest fixes: points along
    // a walk are close together too, but each for a few seconds.
    // A slow walk also packs fixes together; a stay starts and ends in one spot.
    const stayed = best.length >= 5 && best[best.length - 1].time - best[0].time >= config.anchorStayMs
      && latest.time - best[best.length - 1].time <= config.anchorRecentMs
      && distanceMeters(best[0], best[best.length - 1]) <= config.anchorClusterM / 2;
    const chosen = stayed && best.length >= trailing.length * 2 ? best : trailing;
    return chosen.slice(-config.anchorFixes);
  }

  // Is the dog going somewhere? Indoor drift jumps back and forth; a walking
  // dog, even a slow one sniffing along, keeps moving the same way. Three
  // half-minute slices of all its fixes must step forward in one direction.
  function travelling(time) {
    const count = config.travelSlices;
    // Sparse collars (one packet every 30 s or more) get longer slices, so each
    // slice still holds two fixes.
    const sliceMs = Math.max(config.travelSliceMs, typicalGap() * 2.2);
    // Runs on most rows: only the fixes of the slices, not the whole pool.
    const fixes = [...goods, ...weak].filter(fix => time - fix.time < count * sliceMs);
    const slices = Array.from({ length: count }, (_, index) => count - 1 - index)
      .map(index => fixes.filter(fix => time - fix.time >= index * sliceMs
        && time - fix.time < (index + 1) * sliceMs));
    if (slices.some(slice => slice.length < 2)) return null;
    const centres = slices.map(medianPoint);
    const steps = centres.slice(1).map((to, index) => {
      const from = centres[index];
      return {
        north: (to.latitude - from.latitude) * 111320,
        east: (to.longitude - from.longitude) * 111320 * Math.cos(from.latitude * Math.PI / 180),
      };
    });
    const total = steps.reduce((sum, step) => ({ north: sum.north + step.north, east: sum.east + step.east }),
      { north: 0, east: 0 });
    const totalLength = Math.hypot(total.north, total.east) || 1;
    // Every step must go the overall way, and the whole walk must be long enough.
    const forward = steps.every(step => (step.north * total.north + step.east * total.east)
      / totalLength >= config.travelStepM);
    const newest = centres[centres.length - 1];
    return { newest, moving: forward && distanceMeters(centres[0], newest) >= config.travelTotalM };
  }

  // strict: nothing but the fixes says the dog stopped, so missing data is not
  // good enough to start a hold.
  function settled(time, strict) {
    if (strict && previousHold && time - previousHold.time <= config.cautiousAfterReleaseMs) {
      // Evidence that released the old hold cannot also prove a new stop.
      // Observe a fresh minute after release before accepting another stay.
      const afterRelease = [...goods, ...weak].filter(fix => fix.time > previousHold.time);
      const first = Math.min(...afterRelease.map(fix => fix.time));
      if (afterRelease.length < config.weakAnchorMin || time - first < config.anchorStayMs) return false;
    }
    const window = goods.filter(good => time - good.time <= 3 * config.travelSliceMs);
    // Good fixes that keep moving belong to a dog on the move.
    if (window.length >= 2
      && distanceMeters(window[0], window[window.length - 1]) > config.travelTotalM * 2) return false;
    const travel = travelling(time);
    if (!travel) return !strict;
    return !travel.moving;
  }

  // The usual time between rows, from the latest fixes of any quality.
  function typicalGap() {
    // Both lists are in time order, so the newest ten are among their tails.
    const latest = [...goods.slice(-10), ...weak.slice(-10)].sort((left, right) => left.time - right.time).slice(-10);
    const gaps = latest.slice(1).map((fix, index) => fix.time - latest[index].time).sort((a, b) => a - b);
    return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  }

  function start(time, reason) {
    const group = anchorGroup();
    let anchor = null, source = null, refine = [];
    const pool = weak.filter(fix => lastGoodAt === null || fix.time > lastGoodAt);
    // Old good fixes only say where the dog was; when the weak fixes of the
    // last minute are far from there, the dog has moved on (under trees, say).
    // Holding on silence alone checks the latest weak fixes since the anchor,
    // however sparse; with the model or charger saying inside, the last
    // minute of them is enough.
    const since = weak.filter(fix => lastGoodAt === null || fix.time > lastGoodAt);
    const lately = reason === REASONS.noFix ? since.slice(-5)
      : since.filter(fix => time - fix.time <= config.anchorCheckMs);
    const stillThere = !group?.length || lately.length < config.weakAnchorMin
      || distanceMeters(medianPoint(lately), medianPoint(group)) <= config.anchorCheckM;
    if (group?.length && !stillThere) return null;
    // Holding on silence is for a dog whose last fixes were good: when weak
    // fixes kept coming for a while after them, the dog was somewhere else by
    // the time it went quiet, and its last fix (what the map already shows)
    // says more than the old good one.
    if (reason === REASONS.noFix && group?.length && since.length
      && since[since.length - 1].time - group[group.length - 1].time > Math.max(config.enterAfterMs, typicalGap() * 3)) {
      return null;
    }
    if (group?.length) {
      anchor = medianPoint(group);
      source = 'good';
      refine = group.slice();
    } else if (pool.length >= config.weakAnchorMin) {
      anchor = medianPoint(pool);
      source = 'weak';
    }
    // Stopping again where the last hold ended keeps that anchor: a hold that
    // was let go by indoor drift should not come back a few metres off.
    if (anchor && previousHold && time - previousHold.time <= config.stickyMs
      && distanceMeters(anchor, previousHold.anchor) <= config.stickyRadiusM) {
      ({ anchor, source } = previousHold);
      refine = previousHold.refine.slice();
    }
    if (!anchor) return null;
    held = {
      anchor, source, reason, refine, weak: pool.slice(-config.weakPool), farGood: [], lately: [], nearby: [],
      // The drift began right after the last good fix, not when it was noticed.
      since: lastGoodAt ?? pool[0]?.time ?? time,
      anchorAt: source === 'good' && group?.length ? group[group.length - 1].time : time,
      startedAt: time,
    };
    return { type: 'start', since: held.since, anchor, source, reason };
  }

  function departure(time) {
    const observed = rawTail.filter(p => p.time <= time);
    const latest = observed.slice(-10);
    const gaps = latest.slice(1).map((p, i) => p.time - latest[i].time).sort((a, b) => a - b);
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const windowMs = Math.min(config.anchorLookbackMs,
      Math.max(config.retroMaxMs, gap * config.travelSlices * 2.2));
    let tail = observed.filter(p => p.time >= held.startedAt && time - p.time <= windowMs);
    // Start after the last observed plateau, not at an arbitrary window
    // boundary: an earlier multipath relocation must not become a walk just
    // because the dog genuinely leaves later.
    let plateauEnd = 0;
    tail.forEach((p, index) => {
      const plateau = tail.slice(0, index + 1).filter(q => p.time - q.time <= config.anchorStayMs);
      if (plateau.length >= 3 && p.time - plateau[0].time >= config.travelSliceMs
        && near(medianPoint(plateau), plateau, 3).length === plateau.length) plateauEnd = index;
    });
    tail = tail.slice(plateauEnd);
    // False zero speeds cannot veto an observed, coherent walk. A sudden
    // relocation followed by a static cluster is not a continuous walk.
    for (let index = 0; index < tail.length - 2; index += 1) {
      const run = tail.slice(index);
      const steps = run.slice(1).map((p, i) => distanceMeters(run[i], p));
      const path = steps.reduce((sum, step) => sum + step, 0);
      const direct = distanceMeters(run[0], run[run.length - 1]);
      if (steps.filter(step => step >= 1).length >= 2 && direct >= config.travelStepM
        && direct >= path * config.releaseGoodTravelDirectness
        && steps.every((step, i) => step <= direct * 0.8 && step / ((run[i + 1].time - run[i].time) / 1000) <= 50)) return run[0].time;
    }
    return null;
  }

  function stationaryTail(time) {
    const tail = rawTail.filter(p => p.time <= time && time - p.time <= config.stationaryTailMs
      && distanceMeters(p, held.anchor) > config.nearbyAwayM);
    if (tail.length < config.stationaryTailFixes || time - tail[0].time < config.anchorStayMs) return false;
    const known = tail.filter(p => p.speedKmh != null);
    const centre = medianPoint(tail);
    return known.length >= config.stationaryTailFixes
      && known.filter(p => p.speedKmh < 1).length >= Math.ceil(known.length * 0.8)
      && near(centre, tail, config.parkedRadiusM).length === tail.length
      && departure(time) == null;
  }

  function deferStationary(time, why) {
    if (!['window', 'indoor'].includes(why) || !stationaryTail(time)) {
      held.stationarySince = null;
      return false;
    }
    held.stationarySince ??= time;
    // A dog may have left between sparse packets and then stopped. Recheck
    // for only a bounded interval rather than treating zero speed as truth.
    return time - held.stationarySince < config.stationaryTailMaxDelayMs;
  }

  function release(time, why) {
    const ended = held;
    const departureSince = departure(time);
    held = null;
    previousHold = { time, why, anchor: ended.anchor, source: ended.source, refine: ended.refine };
    return { type: 'end', time, why, anchor: ended.anchor, departureSince };
  }

  // Long enough to see several rows whatever the packet rate.
  function shareWindow() {
    const times = held.lately.map(entry => entry.time);
    const gaps = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    return Math.max(config.goodShareWindowMs, typical * 4);
  }

  function whileHeld(point, quality, time) {
    held.lately.push({ time, quality });
    // The cadence is fixed during each filter. Keep separate snapshots before
    // and after trimming: sparse observations can change the median gap.
    const retentionWindow = Math.max(shareWindow(), config.goodShareWindowMs);
    held.lately = held.lately.filter(entry => time - entry.time <= retentionWindow);
    // A measured return interrupts departure evidence, even if that return's
    // GPS quality is weak. No-fix packets carry no evidence of a return.
    if (point && distanceMeters(point, held.anchor) <= config.releaseRadiusM) held.farGood = [];
    if (point && distanceMeters(point, held.anchor) <= config.nearbyAwayM) {
      held.nearby = [];
      held.stationarySince = null;
    }
    if (quality === 'good') {
      const away = distanceMeters(point, held.anchor);
      const why = evidence(point.time);
      // Searching around the house: steady good fixes settled somewhere else,
      // even if not far, mean the dog is outside again.
      held.nearby = held.nearby.filter(fix => point.time - fix.time <= config.nearbyWindowMs);
      // Returning within the nearby radius interrupts an attempted departure;
      // separated excursions must not accumulate into one minute outside.
      if (away > config.nearbyAwayM) held.nearby.push(point);
      if (held.nearby.length >= config.nearbyFixes
        && point.time - held.nearby[0].time >= config.nearbyMinSpanMs
        && held.lately.filter(entry => entry.quality === 'good').length >= held.lately.length * config.nearbyGoodShare
        && distanceMeters(medianPoint(held.nearby), held.anchor) > config.nearbyAwayM
        && (!why || near(medianPoint(held.nearby), held.nearby, config.releaseAgreeM).length === held.nearby.length)
        && !deferStationary(time, why)) {
        return release(point.time, 'good-fixes-nearby');
      }
      if (away <= config.refineRadiusM) {
        held.refine.push(point);
        if (held.refine.length > config.refineFixes) held.refine.shift();
        // Small shifts of the median are noise; redrawing them adds up to
        // hundreds of metres of walking that never happened.
        const refined = medianPoint(held.refine);
        if (distanceMeters(refined, held.anchor) >= config.refineStepM) held.anchor = refined;
        held.source = 'good';
        held.farGood = [];
        return null;
      }
      const goodWindow = shareWindow();
      const releaseWindow = Math.max(config.releaseWindowMs, goodWindow * 2);
      held.farGood = held.farGood.filter(fix => point.time - fix.time <= releaseWindow);
      // Between the refine and release radii a fix neither moves nor frees the dog.
      if (away <= config.releaseRadiusM) return null;
      held.farGood.push({ ...point, away });
      const needed = why ? config.releaseGoodFixesIndoor : config.releaseGoodFixes;
      // Stray fixes through a window scatter around the house; a dog that has
      // left gives fixes that agree with each other, or lands well beyond any
      // indoor error.
      const latest = held.farGood.slice(-needed);
      const agree = latest.length === needed
        && near(medianPoint(latest), latest, config.releaseAgreeM).length === needed;
      // Outside, most rows have a good fix; a window gives one now and then.
      const lately = held.lately.filter(entry => point.time - entry.time <= goodWindow);
      const outside = lately.length >= 3
        && lately.filter(entry => entry.quality === 'good').length >= lately.length * config.goodShareOutside;
      const beyond = held.farGood.slice(-2);
      const farAway = beyond.length === 2 && beyond.every(fix => fix.away > config.releaseFarM);
      const agreeingRun = [];
      if (agree) {
        const centre = medianPoint(latest);
        for (let index = held.farGood.length - 1; index >= 0; index -= 1) {
          const fix = held.farGood[index];
          if (distanceMeters(fix, centre) > config.releaseAgreeM) break;
          agreeingRun.push(fix);
        }
      }
      const sustained = agree && point.time - agreeingRun[agreeingRun.length - 1]?.time >= config.releaseIndoorMinSpanMs;
      // A car's good fixes can be fifty metres apart every few seconds, so
      // they never form an agreeing stationary group. Confirm at least three
      // far fixes progressing away, rather than holding the car for minutes.
      let lastInside = -1;
      held.farGood.forEach((fix, index) => { if (fix.away <= config.releaseFarM) lastInside = index; });
      const farRun = held.farGood.slice(lastInside + 1);
      let goodTravel = false;
      if (farRun.length >= config.releaseGoodFixesIndoor) {
        const first = farRun[0], last = farRun[farRun.length - 1];
        const direct = distanceMeters(first, last);
        const path = farRun.slice(1).reduce((sum, fix, index) => sum + distanceMeters(farRun[index], fix), 0);
        goodTravel = last.time - first.time >= config.releaseGoodTravelMinSpanMs
          && direct >= config.travelTotalM && direct >= path * config.releaseGoodTravelDirectness
          && last.away - first.away >= config.travelStepM
          && farRun.slice(1).every((fix, index) => fix.away >= farRun[index].away - config.refineStepM);
      }
      const travel = why ? travelling(time) : null;
      // Outdoors two good fixes away are enough, however far apart a sparse
      // collar sends them; with few good rows they must also agree.
      if (why ? (sustained && !deferStationary(time, why)) || goodTravel || (travel?.moving && distanceMeters(travel.newest, held.anchor) > config.travelReleaseM)
        : (outside && beyond.length === 2) || agree || farAway) {
        return release(point.time, 'good-fixes-away');
      }
      return null;
    }
    if (quality === 'weak') {
      held.weak.push(point);
      if (held.weak.length > config.weakPool) held.weak.shift();
      if (held.source === 'weak') {
        const next = medianPoint(held.weak);
        if (distanceMeters(next, held.anchor) >= config.weakAnchorStepM) held.anchor = next;
      }
      // A plugged-in collar is on a charger or a power bank: over a night in a
      // kennel its drift wanders far one way now and then. Only good fixes let
      // it go; in a car without them the ride-along draws it with the phone.
      if (usb) return null;
      const travel = travelling(time);
      if (travel?.moving && distanceMeters(travel.newest, held.anchor) > config.travelReleaseM) {
        return release(time, 'travelling');
      }
      // Long enough to hold farFixes weak fixes whatever the packet rate.
      const recent = held.weak.slice(-config.farFixes);
      const gaps = recent.slice(1).map((fix, index) => fix.time - recent[index].time).sort((a, b) => a - b);
      const span = Math.max(config.farMinSpanMs, (gaps[Math.floor(gaps.length / 2)] ?? 0) * config.farFixes) * 1.5;
      const last = held.weak.filter(fix => time - fix.time <= span);
      const far = last.filter(fix => distanceMeters(fix, held.anchor) > config.farRadiusM).length;
      if (last.length >= config.farFixes && last[last.length - 1].time - last[0].time >= config.farMinSpanMs
        && far >= Math.ceil(last.length * config.farShare)) {
        return release(point.time, 'weak-fixes-away');
      }
    }
    return null;
  }

  return {
    // Restores what a cold start cannot replay: the last good fixes before the
    // rows that will be pushed next.
    seed(goodRows) {
      // The same packet over BLE and from the cloud must not vouch for itself.
      // Two Masters relaying one fix must not vouch for each other either.
      const candidates = goodRows.filter(row => fixQuality(row, config) === 'good')
        .map(row => ({ ...row, time: Number(row.time) })).sort((left, right) => left.time - right.time);
      const sorted = [], seen = [];
      for (const row of candidates) {
        if (isCopy(seen, row, config) || sorted.some(kept => kept.time === row.time)) continue;
        seen.push({ time: row.time, master: String(row.master_id ?? ''),
          latitude: Number(row.latitude), longitude: Number(row.longitude) });
        sorted.push(row);
      }
      // Same trust rule as live rows: a lone good fix among hours indoors is
      // likely a reflection, so only fixes with a neighbour seed the anchor.
      const backed = sorted.filter((row, index) => [sorted[index - 1], sorted[index + 1]]
        .some(other => other && Math.abs(other.time - row.time) <= config.trustGapMs));
      for (const row of backed) {
        if (row.time < lastTime) continue;
        goods.push({ time: row.time, latitude: Number(row.latitude), longitude: Number(row.longitude) });
        lastGoodAt = row.time;
        lastTime = row.time;
      }
      goods.splice(0, Math.max(0, goods.length - config.anchorFixes * 8));
    },
    push(row) {
      if (!Number.isFinite(row?.time) || row.time < lastTime) return null;
      // What the row says about the receiver and the charger counts even when
      // its coordinate is a copy: the BLE copy carries this phone's signal, and
      // each Master's window is classified from what that Master heard.
      if (row.source === 'ble' && finite(row.rssi) !== null) bleSignal = { rssi: finite(row.rssi), time: row.time };
      if (row.usb_present !== undefined && row.usb_present !== null) usb = charging(row.usb_present);
      trackEnvironment(row);
      // The same packet can arrive over BLE and again from the cloud copy.
      const samePacket = row.time === lastTime && previous && hasFix(row) === !!previous.point
        && (!previous.point || (previous.point.latitude === Number(row.latitude)
          && previous.point.longitude === Number(row.longitude)));
      // Two Masters relay the same GPS measurement, logged up to half a minute
      // apart (seen on 2026-10-03: every M7 row repeated an M9 one). The same
      // coordinate from another Master within a minute is one measurement.
      // A collar standing still can report the very same coordinate twice
      // through one Master, so only a copy from another Master is dropped.
      if (samePacket || isCopy(recentFixes, row, config)) {
        lastTime = row.time;
        return null;
      }
      if (hasFix(row)) {
        recentFixes.push({ time: row.time, master: String(row.master_id ?? ''),
          latitude: Number(row.latitude), longitude: Number(row.longitude) });
        while (recentFixes.length && row.time - recentFixes[0].time > config.duplicateWindowMs) recentFixes.shift();
      }
      lastTime = row.time;
      const measured = fixQuality(row, config);
      const point = measured === 'none' ? null
        : { time: row.time, latitude: Number(row.latitude), longitude: Number(row.longitude), speedKmh: rawSpeedKmh(row) };
      if (point) {
        rawTail.push(point);
        while (rawTail.length && (row.time - rawTail[0].time > config.anchorLookbackMs
          || rawTail.length > config.weakPool)) rawTail.shift();
      }
      // A good fix alone among weak ones is usually multipath through a window:
      // it trusts only when the row before it was good too. The first good fix
      // of a run is then remembered and trusted with the second.
      const backed = previous?.quality === 'good' && row.time - previous.time <= config.trustGapMs;
      const quality = measured === 'good' && !backed ? 'weak' : measured;
      let event = null;
      if (measured === 'good' && backed && previous.point && !previous.trusted) {
        goods.push(previous.point);
        const stray = weak.indexOf(previous.point);
        if (stray >= 0) weak.splice(stray, 1);
        if (held) event = whileHeld(previous.point, 'good', previous.time);
      }
      previous = { time: row.time, quality: measured, point, trusted: quality === 'good' };
      // Both the promoted fix and this one may have been added.
      goods.splice(0, Math.max(0, goods.length - config.anchorFixes * 8));
      if (held) event = whileHeld(point, quality, row.time);
      if (quality === 'good') {
        goods.push(point);
        lastGoodAt = row.time;
      } else if (quality === 'weak') {
        weak.push(point);
        if (weak.length > config.weakPool) weak.shift();
      }
      if (held || event || quality === 'good') return event;
      const quietFor = lastGoodAt === null ? Infinity : row.time - lastGoodAt;
      const why = evidence(row.time);
      // Only recent weak fixes say the dog may be moving under trees; once
      // they stop for a minute the dog has simply lost its fix.
      const weakSinceGood = weak.some(fix => (lastGoodAt === null || fix.time > lastGoodAt)
        && row.time - fix.time < Math.max(config.enterAfterMs, typicalGap() * 3));
      // Hold once the good fixes stop and the dog is not travelling. With only
      // weak fixes and nothing else saying it is inside, the fixes themselves
      // must show the stop, because they may be a dog walking under trees.
      const wait = why === 'window' || !why ? config.enterWindowAfterMs : config.enterIndoorAfterMs;
      // Only "indoor" and the charger are trusted on their own; "window" is
      // what the model also says under trees, so the fixes must show the stop.
      const recentlyReleased = previousHold && row.time - previousHold.time <= config.cautiousAfterReleaseMs;
      const cautious = !why || why === 'window' || recentlyReleased;
      // By a window good fixes keep coming, all in one spot, with drift in
      // between: that spot is the anchor, no need to wait for silence.
      const recentGood = goods.filter(good => row.time - good.time <= config.anchorRecentMs
        && (!previousHold || good.time > previousHold.time));
      const parked = why && quality === 'weak' && recentGood.length >= config.parkedFixes
        && recentGood[recentGood.length - 1].time - recentGood[0].time >= config.anchorStayMs
        && near(medianPoint(recentGood), recentGood, config.parkedRadiusM).length === recentGood.length;
      if ((parked && (!recentlyReleased || settled(row.time, true)))
        || ((why || weakSinceGood) && quietFor >= wait && settled(row.time, cautious))) {
        event = start(row.time, REASONS[why ?? 'weak']);
      } else if (!weakSinceGood && quietFor >= config.enterAfterMs && !travelling(row.time)?.moving
        && (!recentlyReleased || settled(row.time, true))) {
        // Silence after a walk is a dog under trees until the fixes stop moving.
        event = start(row.time, REASONS.noFix);
      }
      return event;
    },
    current(time = lastTime) {
      if (!held) return null;
      const why = evidence(time);
      return {
        coordinate: held.anchor,
        source: held.source,
        reason: why ? REASONS[why] : held.reason,
        since: held.since,
        anchorAt: held.anchorAt,
      };
    },
    snapshot: () => JSON.parse(JSON.stringify({ goods, weak, rawTail, lastGoodAt, lastTime: Number.isFinite(lastTime) ? lastTime : null,
      usb, environment, held, previous, previousHold, recentFixes, bleSignal,
      buckets: Object.fromEntries(buckets), bucketStart })),
    environment: () => environment,
    // The good fixes it knows, to seed a replacement when rows arrive late.
    goodFixes: () => goods.slice(),
    lastTime: () => lastTime,
    // What a ride-along check needs: when the dog last had a good fix, and how
    // strongly this phone's receiver last heard it.
    status: () => ({ lastGoodAt, bleRssi: bleSignal?.rssi ?? null, bleRssiAt: bleSignal?.time ?? null }),
  };
}

/**
 * History rows of one dog, oldest first, displayed through the same tracker
 * as the live map. Held rows are drawn at the anchor and carry `heldReason`;
 * the rows between the last good fix and the moment the hold started move
 * there too, so the history never shows the drift the live map showed briefly.
 */
export function applyHistoryHolds(points, options) {
  const holds = createHistoryHolds(options);
  holds.append(points);
  return holds.output;
}

/**
 * The same pass, kept open: the history screen re-reads its window every few
 * seconds, and only the rows added since need to go through the tracker.
 */
export function createHistoryHolds({ seed = [], config = HOLD_CONFIG, classify } = {}) {
  const tracker = createHoldTracker(config, classify ? { classify } : undefined);
  tracker.seed(seed);
  const output = [];
  return {
    output,
    append(points) {
      for (const source of points) {
        const point = { ...source };
        const index = output.length;
        output.push(point);
        const event = tracker.push({ ...point, ...rawCoordinate(point) });
        if (event?.type === 'end' && event.departureSince != null) {
          // The tracker confirms departure once. Restore only its observed
          // candidate, not an independently classified history movement.
          for (let back = index - 1; back >= 0 && output[back].time >= event.departureSince; back -= 1) {
            const earlier = output[back];
            if (!earlier.heldReason) continue;
            const raw = rawCoordinate(earlier);
            if (!hasFix(raw)) continue;
            Object.assign(earlier, raw, { speed_kmh: rawSpeedKmh(earlier) });
            delete earlier.heldReason;
            delete earlier.heldSince;
            delete earlier.heldSource;
          }
        }
        if (event?.type === 'start') {
          const anchor = event.anchor;
          let from = index;
          for (let back = index - 1; back >= 0; back -= 1) {
            const earlier = output[back];
            const rawPoint = rawCoordinate(earlier);
            if (earlier.time <= event.since || earlier.heldReason
              || point.time - earlier.time > config.retroMaxMs) break;
            if (hasFix(rawPoint) && distanceMeters(rawPoint, anchor) > config.farRadiusM) break;
            from = back;
          }
          for (let fill = from; fill < index; fill += 1) hold(output[fill], tracker.current(point.time));
        }
        const current = tracker.current(point.time);
        if (current) hold(point, current);
      }
    },
  };
}

function hold(point, current) {
  if (!current) return;
  if (point.heldReason) return;
  const raw = rawCoordinate(point);
  if (!Object.prototype.hasOwnProperty.call(point, 'raw_latitude')) point.raw_latitude = raw.latitude;
  if (!Object.prototype.hasOwnProperty.call(point, 'raw_longitude')) point.raw_longitude = raw.longitude;
  if (!Object.prototype.hasOwnProperty.call(point, 'raw_speed_kmh')) point.raw_speed_kmh = rawSpeedKmh(point);
  point.latitude = current.coordinate.latitude;
  point.longitude = current.coordinate.longitude;
  point.heldReason = current.reason;
  point.heldSince = current.since;
  point.heldSource = current.source;
  point.speed_kmh = null;
}

// What the live map's camera frames (design v3 §9.8「框圖與相機」, 判定表
// 「冷啟動」「框住全部」, DESIGN.md §9.8). Pure and provider-neutral: the map
// renderer only fits the coordinates and padding these return.
//
// - Cold start (and a data source switch, which is a new start): the dogs this
//   phone's own receiver has a position for, and the phone. A far cloud dog is
//   not in that first view; 「框住全部」 shows it. With neither (no local dog,
//   no phone fix) there is nothing local to look at, so every dog is framed
//   rather than the whole of Taiwan.
// - 「框住全部」: every dog on the map, however far or old, and the phone.
// - The frame leaves room for each face's "!" above it and its name tag below,
//   then 24dp (layout.framePadding) around that.
import { layout, size as sizes } from '../theme/tokens';
import { tagSize } from './DogMarkers';

// The phone is 「沒有定位」 once its newest fix is older than this (design:
// 手機超過 10 分鐘沒 GPS).
export const PHONE_FIX_MAX_AGE_S = 10 * 60;
// Roughly 150 m around a single point: Android fits a one-point box at maximum
// zoom.
export const SINGLE_POINT_DEGREES = 0.0015;

const valid = point => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude)
  && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
const plain = point => ({ latitude: point.latitude, longitude: point.longitude });

/**
 * The phone's position for framing and 「我的位置」, or null when the phone
 * has no fix (not recording, no position, or older than 10 minutes).
 * @param livePhone useLiveLocation's snapshot: { running, position, ageSeconds }
 */
export function phoneFix(livePhone) {
  if (!livePhone?.running || !valid(livePhone.position)) return null;
  if (!(Number.isFinite(livePhone.ageSeconds) && livePhone.ageSeconds <= PHONE_FIX_MAX_AGE_S)) return null;
  return plain(livePhone.position);
}

/** One point becomes a small square around it; more points stay as they are. */
export function framedCoordinates(points) {
  if (points.length !== 1) return points;
  const [{ latitude, longitude }] = points;
  return [
    { latitude: latitude - SINGLE_POINT_DEGREES, longitude: longitude - SINGLE_POINT_DEGREES },
    { latitude: latitude + SINGLE_POINT_DEGREES, longitude: longitude + SINGLE_POINT_DEGREES },
  ];
}

/**
 * The cold-start frame: local dogs (from this phone's receiver) and the phone;
 * only the phone when no local dog has a position; every dog when the phone
 * has no fix either.
 * @param markers DogMarkers.dogMarkers output (each with `source`, `masterId`)
 * @param phone phoneFix() or null
 * @param receiverId this phone's receiver number (ReceiverState.receiverNumber),
 *   or null when unknown: a dog stored from another receiver is not local
 */
export function coldStartCoordinates(markers = [], phone = null, receiverId = null) {
  const local = markers.filter(marker => marker.source === 'ble' && valid(marker.coordinate)
    && (receiverId == null || marker.masterId == null || marker.masterId === receiverId))
    .map(marker => plain(marker.coordinate));
  const points = [...local, ...(phone ? [phone] : [])];
  if (points.length) return framedCoordinates(points);
  return frameAllCoordinates(markers, null);
}

/** 「框住全部」: every dog on the map and the phone. */
export function frameAllCoordinates(markers = [], phone = null) {
  const points = markers.filter(marker => valid(marker.coordinate)).map(marker => plain(marker.coordinate));
  if (phone) points.push(phone);
  return framedCoordinates(points);
}

/**
 * Edge padding (dp) for fitting dog markers: 24dp beyond the largest face's
 * "!" above, its widest name tag below and to the sides.
 */
export function framePadding(markers = [], fontScale = 1) {
  const base = layout.framePadding;
  let face = sizes.marker.normal;
  let half = face / 2;
  let tagHeight = 0;
  for (const marker of markers) {
    face = Math.max(face, marker.size || 0);
    const tag = tagSize(marker.tag, fontScale);
    half = Math.max(half, tag.width / 2);
    tagHeight = Math.max(tagHeight, tag.height);
  }
  const above = face / 2 + sizes.badge.offsetLarge;
  const below = face / 2 + sizes.marker.labelGap + tagHeight;
  return {
    top: Math.ceil(base + above),
    bottom: Math.ceil(base + below),
    left: Math.ceil(base + half),
    right: Math.ceil(base + half),
  };
}

/**
 * The region to animate to so `points` fill the map with `padding` (dp)
 * around them: Google's animateToRegion takes a duration (motion.camera,
 * 300 ms), fitToCoordinates does not. `view` is the map's visible size in dp
 * (inside its own map padding). A local flat projection: fine for a town or a
 * county, the scale of a search.
 */
export function regionForFrame(points, padding, view) {
  if (!points?.length || !(view?.width > 0 && view?.height > 0)) return null;
  const lats = points.map(point => point.latitude);
  const lons = points.map(point => point.longitude);
  const south = Math.min(...lats), north = Math.max(...lats);
  const west = Math.min(...lons), east = Math.max(...lons);
  const center = { latitude: (south + north) / 2, longitude: (west + east) / 2 };
  const cos = Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  const innerWidth = Math.max(1, view.width - padding.left - padding.right);
  const innerHeight = Math.max(1, view.height - padding.top - padding.bottom);
  // Latitude degrees per dp; a longitude degree is 1/cos as long on screen.
  const scale = Math.max((east - west) * cos / innerWidth, (north - south) / innerHeight, 1e-7);
  // The points' middle goes to the middle of the padded area, which sits off
  // the map's middle when the padding is uneven.
  const offsetX = (padding.left - padding.right) / 2;
  const offsetY = (padding.top - padding.bottom) / 2;
  return {
    latitude: center.latitude + offsetY * scale,
    longitude: center.longitude - (offsetX * scale) / cos,
    latitudeDelta: view.height * scale,
    longitudeDelta: (view.width * scale) / cos,
  };
}

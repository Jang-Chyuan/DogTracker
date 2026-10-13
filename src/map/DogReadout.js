import { t } from '../i18n';
import { distanceText } from '../utils/distanceText';
// Which way and how far a dog is from the phone, as plain values. Pure: no
// React, no clock of its own. (From PR #40's dog rows; the card A3 uses it.)

const EARTH_METRES = 6371000;
const rad = degrees => (degrees * Math.PI) / 180;

/** Great-circle distance (m) and initial bearing (degrees, 0 = north, clockwise). */
export function bearingAndDistance(from, to) {
  const φ1 = rad(from.latitude);
  const φ2 = rad(to.latitude);
  const Δφ = rad(to.latitude - from.latitude);
  const Δλ = rad(to.longitude - from.longitude);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const metres = 2 * EARTH_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { metres, bearing };
}

/** 「10 m」「120 m」「1.2 km」: the app's one distance formatter (utils/distanceText). */
export const formatDistance = distanceText;

// Eight compass words for TalkBack, which cannot see the arrow.
const COMPASS = [t("c738"), t("c739"), t("c740"), t("c741"), t("c742"), t("c743"), t("c744"), t("c745")];
export function compassWord(bearing) {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

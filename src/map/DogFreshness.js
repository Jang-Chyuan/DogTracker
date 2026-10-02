// How old a dog's last valid position is decides how the live map draws it.
// Measured from the last valid fix, not the last packet: a collar can keep
// talking for hours without a GPS fix (dog 8 on 2026-09-30).
//
//   fresh   ≤ 2 min        normal marker
//   recent  2 min – 10 min amber marker, dashed ring, "最後位置・4 分鐘前"
//   old     10 min – 24 h  hollow grey marker, "最後位置 16:32", not framed by the camera
//   gone    > 24 h or no fix at all: not on the live map (history has it)
export const FRESH_MS = 2 * 60000;
export const RECENT_MS = 10 * 60000;
export const KEEP_MS = 24 * 3600000;

function clock(at) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function dogFreshness(dog, now) {
  // DogMerge sets lastPositionAt to the time of the last valid fix.
  const at = dog?.coordinate ? dog.lastPositionAt : null;
  if (!Number.isFinite(at)) return { tier: 'gone', label: null };
  const age = now - at;
  if (age <= FRESH_MS) return { tier: 'fresh', label: null };
  if (age <= RECENT_MS) {
    return { tier: 'recent', label: `最後位置・${Math.floor(age / 60000)} 分鐘前` };
  }
  if (age <= KEEP_MS) return { tier: 'old', label: `最後位置 ${clock(at)}` };
  return { tier: 'gone', label: null };
}

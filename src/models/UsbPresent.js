// Missing telemetry stays unknown; never infer USB from battery validity.
export function usbPresent(value) {
  if (value == null) return null;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new Error('usbPresent must be boolean or 0/1');
}

/**
 * The one rule for 「the collar is on USB power」 (充電中, 2026-10-16), for a
 * stored row or packet (usb_present, or the wire's usbPresent): 1 / true. The
 * 電量 row, the map, the card's 活動量 row and A4 all ask this. Unknown
 * (missing) is not charging.
 */
export function isCharging(row) {
  const value = row?.usb_present ?? row?.usbPresent;
  return value === 1 || value === true || value === '1';
}

/** The same rule in SQL, over a usb_present column (`c.usb_present`). */
export const chargingSql = (column = 'usb_present') => `${column}=1`;

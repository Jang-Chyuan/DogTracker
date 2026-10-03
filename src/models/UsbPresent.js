// Missing telemetry stays unknown; never infer USB from battery validity.
export function usbPresent(value) {
  if (value == null) return null;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new Error('usbPresent must be boolean or 0/1');
}

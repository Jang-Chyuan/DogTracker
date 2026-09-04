export function scanForDevices(
  bleManager,
  _serviceUuid,
  onDevice,
  onError,
  onFinished,
  timeoutMs = 10000,
) {
  bleManager.stopDeviceScan();
  const seen = new Set();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    bleManager.stopDeviceScan();
    onFinished?.();
  };

  const timeout = setTimeout(finish, timeoutMs);
  // Some compatible Masters advertise only their local name and expose the
  // service UUID after connecting. Scan without an OS-level service filter;
  // BleService still applies the exact QR-provided device name before use.
  bleManager.startDeviceScan(null, null, (error, device) => {
    if (error) {
      finish();
      onError(error);
      return;
    }
    if (!device || seen.has(device.id)) return;
    seen.add(device.id);
    onDevice(device);
  });

  return finish;
}

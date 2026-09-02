export function scanForDevices(
  bleManager,
  serviceUuid,
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
  bleManager.startDeviceScan([serviceUuid], null, (error, device) => {
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

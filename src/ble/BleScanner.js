export function scanForDevice(bleManager, deviceName, serviceUuid, onDevice, onError) {
  bleManager.stopDeviceScan();
  const timeout = setTimeout(() => {
    bleManager.stopDeviceScan();
    onError(new Error('找不到裝置'));
  }, 10000);

  bleManager.startDeviceScan([serviceUuid], null, (error, device) => {
    if (error) {
      clearTimeout(timeout);
      onError(error);
      return;
    }

    if (!device || (device.name !== deviceName && device.localName !== deviceName)) return;

    clearTimeout(timeout);
    bleManager.stopDeviceScan();
    onDevice(device);
  });

  return () => {
    clearTimeout(timeout);
    bleManager.stopDeviceScan();
  };
}

import { captureMapRead } from '../cloud/CloudPublication';

// The card is a separate DB reader: retain its cloud rows per dog as well as
// the marker snapshot. While a download publishes, the card keeps the cloud
// rows it accepted last (a dog opened for the first time then has none yet),
// but this phone's own receiver rows are read as usual: the BLE dog's
// activity and battery never wait for the cloud.
export function createAtomicDogCardReader(database, owner, getMapPublication = null) {
  const accepted = new Map();
  let busy = false, blocked = false, success = null, released = null, epoch = 0;
  const holding = () => busy || !!getMapPublication?.()?.busy;
  return {
    update(nextBusy, nextSuccess) {
      if (busy !== nextBusy || success !== nextSuccess) {
        epoch++;
        if (nextBusy) blocked = true;
        else if (released !== nextSuccess) { blocked = false; released = nextSuccess; }
        busy = nextBusy;
        success = nextSuccess;
      }
    },
    async read(slaveId, since) {
      const previous = accepted.get(slaveId);
      const fence = captureMapRead(getMapPublication, owner, success);
      const version = epoch;
      // Local rows only (no owner) while the cloud side is held.
      const cloudOpen = !holding() && !blocked && fence.open;
      const rows = await database.dogCardRows(cloudOpen ? owner ?? null : null, slaveId, since);
      const acceptsCloud = cloudOpen && !holding() && version === epoch && !blocked && fence.valid();
      const cloud = acceptsCloud ? rows.cloud : previous?.cloud ?? [];
      const cloudBattery = acceptsCloud
        ? rows.battery?.filter(row => row.source === 'cloud') ?? []
        : previous?.battery?.filter(row => row.source === 'cloud') ?? [];
      const value = { local: rows.local, cloud,
        battery: [...(rows.battery?.filter(row => row.source !== 'cloud') ?? []), ...cloudBattery] };
      accepted.set(slaveId, value);
      return value;
    },
  };
}

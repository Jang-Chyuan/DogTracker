import { captureMapRead } from '../cloud/CloudPublication';

// The card is a separate DB reader: retain its cloud rows per dog as well as
// the marker snapshot. A dog opened for the first time during download uses
// its accepted marker readings, rather than querying partial cloud rows.
export function createAtomicDogCardReader(database, owner, getMapPublication = null) {
  const accepted = new Map();
  let busy = false, blocked = false, success = null, released = null, epoch = 0;
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
      if (busy || getMapPublication?.()?.busy) return previous ?? { local: [], cloud: [], battery: [] };
      const fence = captureMapRead(getMapPublication, owner, success);
      const version = epoch;
      const rows = await database.dogCardRows(blocked || !fence.open ? null : owner ?? null, slaveId, since);
      if (busy || getMapPublication?.()?.busy) return previous ?? { local: [], cloud: [], battery: [] };
      const acceptsCloud = version === epoch && !blocked && fence.valid();
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

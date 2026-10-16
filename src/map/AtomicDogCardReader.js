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
  // Older activity rows, for a rest followed back (useDogCardReadings): both
  // tables or none. While a download publishes, null (asked again later),
  // never this phone's rows alone: the rest would look shorter than it is.
  // The accepted rows above are left as they are.
  async function readEarlier(slaveId, since, until) {
    const fence = captureMapRead(getMapPublication, owner, success);
    const version = epoch;
    const open = () => !holding() && !blocked && fence.open;
    if (owner && !open()) return null;
    const rows = await database.dogCardRows(owner ?? null, slaveId, since, until);
    if (owner && !(open() && version === epoch && fence.valid())) return null;
    return { local: rows.local, cloud: owner ? rows.cloud : [], since, until };
  }
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
    async read(slaveId, since, until = null) {
      if (until != null) return readEarlier(slaveId, since, until);
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
        battery: [...(rows.battery?.filter(row => row.source !== 'cloud') ?? []), ...cloudBattery],
        // Where the activity rows begin (the 活動量 row's lookback edge).
        since: rows.since ?? since };
      accepted.set(slaveId, value);
      return value;
    },
  };
}

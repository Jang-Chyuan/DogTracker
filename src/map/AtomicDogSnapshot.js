// The live map's cloud dogs change all at once: while a download is
// publishing, or its accepted snapshot is not read yet (`success` ahead of
// `cloudCommit`), or a return to the app is still catching up, the map keeps
// the cloud rows and cloud packets it accepted last, so a partly read download
// never becomes dogs and a dog never jumps between two downloads.
//
// Only the cloud part is held. This phone's own receiver data stays live: its
// packets (source 'ble'), and the holds, receiver-range judgements, statuses
// and batteries that HoldStore works out from them as they arrive. The BLE
// dog's position (the tracking feed's point) is merged in MapScreen from the
// live feed as well. The whole set used to be held, BLE included: a download
// on a slow or dead network (up to 120 s each attempt, 65 s of it waiting for
// the sign-in) then stopped this phone's dog, its card and its alerts for
// most of the time, although nothing of it comes from the cloud.
//
// The phone marker is outside this snapshot too.
const isCloud = row => row?.source === 'cloud';
const EMPTY_CLOUD = Object.freeze({ rows: [], packets: [], loaded: false, cloudCommit: null,
  cloudPublication: null, cachedBaseline: false });

function cloudPart(value) {
  if (!value) return EMPTY_CLOUD;
  return { rows: value.rows ?? [], packets: (value.packets ?? []).filter(isCloud), loaded: !!value.loaded,
    cloudCommit: value.cloudCommit ?? null, cloudPublication: value.cloudPublication ?? null,
    cachedBaseline: !!value.cachedBaseline };
}

export function createAtomicDogSnapshot() {
  let owner, initialized = false, held = EMPTY_CLOUD, last = null;
  return {
    /**
     * @param options.cloudDogs useCloudDogs' current value (cloud and local)
     * @param options.busy a download is publishing or catching up
     * @param options.success the download whose snapshot must be read first
     * @returns {{ cloudDogs }} the live value with its cloud part held
     */
    select({ owner: nextOwner, cloudDogs, busy, success = null }) {
      if (!initialized || owner !== nextOwner) {
        initialized = true;
        owner = nextOwner;
        held = EMPTY_CLOUD;
        last = null;
      }
      const waitingForRead = success > 0 && cloudDogs?.cloudCommit !== success;
      if ((!busy && !waitingForRead) || (!held.loaded && cloudDogs?.loaded && cloudDogs?.cachedBaseline)) {
        const next = cloudPart(cloudDogs);
        // Same accepted cloud content: keep the identities the map memoizes on.
        held = held.rows === next.rows && held.loaded === next.loaded && held.cloudCommit === next.cloudCommit
          && held.cloudPublication === next.cloudPublication && held.cachedBaseline === next.cachedBaseline
          && held.packets.length === next.packets.length && held.packets.every((row, index) => row === next.packets[index])
          ? held : next;
      }
      const live = cloudDogs ?? {};
      if (last && last.live === live && last.held === held) return last.value;
      const local = (live.packets ?? []).filter(row => !isCloud(row));
      const value = { cloudDogs: { holds: {}, statuses: {}, ranges: {}, batteries: {}, ...live, ...held,
        packets: local.length ? [...local, ...held.packets] : held.packets } };
      last = { live, held, value };
      return value;
    },
  };
}

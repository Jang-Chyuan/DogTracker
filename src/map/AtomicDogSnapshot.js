// The phone marker is deliberately outside this snapshot. Receiver dog packets
// resume immediately outside a download; partial cloud pages never become dogs.
export function createAtomicDogSnapshot() {
  let owner, initialized = false, snapshot;
  return {
    select({ owner: nextOwner, dogs, cloudDogs, busy, success = null }) {
      if (!initialized || owner !== nextOwner) {
        initialized = true;
        owner = nextOwner;
        snapshot = { dogs: [], cloudDogs: { rows: [], packets: [], holds: {}, statuses: {}, ranges: {}, loaded: false } };
      }
      const waitingForRead = success > 0 && cloudDogs?.cloudCommit !== success;
      if (!busy && !waitingForRead) snapshot = { dogs, cloudDogs };
      return snapshot;
    },
  };
}

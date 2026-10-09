import { useCallback, useEffect, useState } from 'react';

/**
 * Every dog's face on this phone, by collar number, loaded once the local
 * database is ready. `save(slaveId, avatar | null)` writes one and updates
 * the map, list and panels together.
 */
export function useDogAvatars(database, ready) {
  const [avatars, setAvatars] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ready || !database?.loadDogAvatars) return undefined;
    let alive = true;
    database.loadDogAvatars()
      .then(value => { if (alive) setAvatars(value || {}); })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [database, ready]);
  const save = useCallback(async (slaveId, avatar) => {
    try {
      const value = await database.saveDogAvatar(slaveId, avatar);
      setAvatars(current => {
        const next = { ...current };
        if (value) next[slaveId] = value; else delete next[slaveId];
        return next;
      });
      setError('');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, [database]);
  return { avatars, error, save };
}

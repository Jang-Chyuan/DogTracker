const values = new Map();
export const ACCESSIBLE = { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' };
export const getGenericPassword = jest.fn(async ({ service }) => values.get(service) || false);
export const setGenericPassword = jest.fn(async (username, password, { service }) => {
  values.set(service, { username, password });
  return { service };
});
export const resetGenericPassword = jest.fn(async ({ service }) => { values.delete(service); return true; });

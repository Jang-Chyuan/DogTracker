import { getCloudClient } from '../cloud/CloudClient';

// Keep one client/session shared with cloud downloads, BLE uploads and
// WorkManager. Lazy initialization preserves existing configuration handling.
export const getSupabase = getCloudClient;
export default getSupabase;

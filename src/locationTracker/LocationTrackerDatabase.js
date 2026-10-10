import { t } from '../i18n';
import { NativeModules } from 'react-native';
import { forgetRanges } from '../history/screen/RangeMemory';
import { locationTrackerNative } from './LocationTrackerService';

export const LOCATION_PAGE_SIZE = 50;
export const LOCATION_RECORD_LIMIT = 80000;

// Android shares DogStatusStore's SQLite owner with BLE and cloud data.
export async function readLocationPage(before = 0) {
  if (!locationTrackerNative) throw new Error(t("c699"));
  const result = JSON.parse(await locationTrackerNative.page(before));
  return {
    ...result,
    hasMore: result.rows.length > LOCATION_PAGE_SIZE,
    rows: result.rows.slice(0, LOCATION_PAGE_SIZE),
  };
}

export async function deletePhoneRoutes() {
  if (!locationTrackerNative) throw new Error(t("c699"));
  await locationTrackerNative.deleteAll();
  forgetRanges();
  await NativeModules.HistoryExport?.clearExports?.();
}

import { safePhoneHistoryCoordinate } from '../src/mapHistory/PhoneHistoryCoordinates';
import { historyGeometry } from '../src/mapHistory/HistoryDatabase';

test('distant animation falls back to the pipeline without modifying source data', () => {
  const row = Object.freeze({ latitude: 25.02, longitude: 121.02, pipeline_latitude: 25,
    pipeline_longitude: 121, accuracy_meters: 2, location_at: 10000, display_source: 'animated' });
  expect(safePhoneHistoryCoordinate(row)).toMatchObject({ latitude: 25, longitude: 121,
    display_source: 'pipeline-recovered', display_location_at: 10000 });
  expect(row.latitude).toBe(25.02);
  const normal = { ...row, latitude: 25.00001, longitude: 121.00001 };
  expect(safePhoneHistoryCoordinate(normal)).toBe(normal);
});

test('recovery does not bridge missing fixes or session boundaries', () => {
  const points = [
    { latitude: 25, longitude: 121, time: 1000, session_id: 'a' },
    { latitude: 25.001, longitude: 121, time: 200000, session_id: 'a' },
    { latitude: 25.002, longitude: 121, time: 201000, session_id: 'b' },
  ].map(safePhoneHistoryCoordinate);
  expect(historyGeometry(points).segments).toHaveLength(3);
});

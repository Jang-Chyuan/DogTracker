import {
  dogStatusRow,
  trackingPoint,
} from '../__fixtures__/TrackingPointFixtures';
import {
  emptyTrackingPoint,
  mapDogStatusRow,
} from '../src/models/TrackingPoint';

describe('mapDogStatusRow', () => {
  test('maps the dog_status SQLite schema to the UI model', () => {
    expect(mapDogStatusRow(dogStatusRow)).toEqual(trackingPoint);
  });

  test('provides stable empty values for an absent row', () => {
    expect(mapDogStatusRow(null)).toEqual(emptyTrackingPoint);
  });

  test('does not interpret BLE payload aliases', () => {
    expect(mapDogStatusRow({
      id: 1,
      received_at: 1000,
      mid: 3,
      sid: 7,
      slat: 25.033,
      slon: 121.5654,
      dst: 82.4,
      bp: 76,
    })).toMatchObject({
      masterId: null,
      slaveId: null,
      slaveLat: null,
      slaveLon: null,
      distanceMeters: null,
      batteryPercentage: null,
    });
  });

  test('maps SQLite zero flags to false', () => {
    expect(mapDogStatusRow({
      activity_valid: 0,
      battery_valid: 0,
      master_battery_valid: 0,
    })).toMatchObject({
      activityValid: false,
      batteryValid: false,
      masterBatteryValid: false,
    });
  });
});

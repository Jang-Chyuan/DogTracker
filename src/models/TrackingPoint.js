/**
 * UI-facing tracking data read from a local tracking table.
 *
 * @typedef {Object} TrackingPoint
 * @property {number | null} id
 * @property {number | null} receivedAt
 * @property {number | null} masterId
 * @property {number | null} slaveId
 * @property {number | null} slaveLat
 * @property {number | null} slaveLon
 * @property {number | null} masterLat
 * @property {number | null} masterLon
 * @property {number | null} distanceMeters
 * @property {number | null} speedKmh
 * @property {number | null} satellites
 * @property {number | null} hdop
 * @property {string | null} activity
 * @property {boolean} activityValid
 * @property {number | null} batteryMillivolts
 * @property {number | null} batteryPercentage
 * @property {boolean} batteryValid
 * @property {number | null} masterBatteryMillivolts
 * @property {number | null} masterBatteryPercentage
 * @property {boolean} masterBatteryValid
 * @property {number | null} rssi
 * @property {number | null} snr
 * @property {string | null} gpsTime
 * @property {string | null} activityTime
 * @property {string | null} type
 * @property {number | null} sequence
 * @property {number | null} length
 * @property {string | null} rawPayload
 */

export const emptyTrackingPoint = Object.freeze({
  id: null,
  receivedAt: null,
  masterId: null,
  slaveId: null,
  slaveLat: null,
  slaveLon: null,
  masterLat: null,
  masterLon: null,
  distanceMeters: null,
  speedKmh: null,
  satellites: null,
  hdop: null,
  activity: null,
  activityValid: false,
  batteryMillivolts: null,
  batteryPercentage: null,
  batteryValid: false,
  masterBatteryMillivolts: null,
  masterBatteryPercentage: null,
  masterBatteryValid: false,
  rssi: null,
  snr: null,
  gpsTime: null,
  activityTime: null,
  type: null,
  sequence: null,
  length: null,
  rawPayload: null,
});

/**
 * Maps the known dog_status SQLite schema to the UI-facing model.
 * This function intentionally does not accept BLE field names.
 *
 * @param {Record<string, unknown>} row
 * @returns {TrackingPoint}
 */
export function mapDogStatusRow(row) {
  const value = row || {};
  return {
    id: value.id ?? null,
    receivedAt: value.received_at ?? null,
    masterId: value.master_id ?? null,
    slaveId: value.slave_id ?? null,
    slaveLat: value.slave_lat ?? null,
    slaveLon: value.slave_lon ?? null,
    masterLat: value.master_lat ?? null,
    masterLon: value.master_lon ?? null,
    distanceMeters: value.distance_meters ?? null,
    speedKmh: value.speed_kmh ?? null,
    satellites: value.satellites ?? null,
    hdop: value.hdop ?? null,
    activity: value.activity ?? null,
    activityValid: value.activity_valid === 1 || value.activity_valid === true,
    batteryMillivolts: value.battery_mv ?? null,
    batteryPercentage: value.battery_percentage ?? null,
    batteryValid: value.battery_valid === 1 || value.battery_valid === true,
    masterBatteryMillivolts: value.master_battery_mv ?? null,
    masterBatteryPercentage: value.master_battery_percentage ?? null,
    masterBatteryValid: value.master_battery_valid === 1
      || value.master_battery_valid === true,
    rssi: value.rssi ?? null,
    snr: value.snr ?? null,
    gpsTime: value.gps_time ?? null,
    activityTime: value.activity_time ?? null,
    type: value.packet_type ?? null,
    sequence: value.sequence ?? null,
    length: value.packet_length ?? null,
    rawPayload: value.raw_payload ?? null,
  };
}

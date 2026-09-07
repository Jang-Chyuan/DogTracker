import { dogStatusRow } from './TrackingPointFixtures';

// Test-only DB rows. No runtime generator, timer, or simulated movement.
export function createDemoRow(sequence, receivedAt) {
  const { id, ...fields } = dogStatusRow;
  return {
    ...fields,
    received_at: receivedAt,
    master_id: 1,
    slave_id: 1,
    master_lat: 25.0175,
    master_lon: 121.325,
    slave_lat: 25.018,
    slave_lon: 121.3256,
    sequence,
    gps_time: new Date(receivedAt).toISOString(),
    activity_time: new Date(receivedAt).toISOString(),
    packet_type: 'demo',
    packet_length: null,
    raw_payload: null,
  };
}

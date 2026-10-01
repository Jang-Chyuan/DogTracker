import { openTrackingDatabase } from './TrackingDatabaseConnection';
import { createDogDatabase } from './DogDatabase';
import { createSettingsDatabase } from './SettingsDatabase';
import { createCloudDatabase } from '../cloud/CloudDatabase';
import { createHistoryDatabase } from '../mapHistory/HistoryDatabase';

// All local tables share dogtracker.sqlite; only this owner closes the connection.
export function createLocalDatabases() {
  const connection = openTrackingDatabase();
  // Migrations wait for configuration and removal of obsolete simulated rows.
  // Android serializes SQL with BLE writes inside its single native owner.
  const configured = Promise.resolve().then(async () => {
    await connection.executeAsync('PRAGMA busy_timeout=5000');
    await connection.executeAsync('DROP INDEX IF EXISTS idx_demo_dog_status_received_at');
    await connection.executeAsync('DROP TABLE IF EXISTS demo_dog_status');
    await connection.executeAsync('DROP TABLE IF EXISTS demo_metadata');
  });
  const prepare = database => ({
    ...database,
    async initialize() {
      await configured;
      return database.initialize();
    },
  });
  return {
    real: prepare(createDogDatabase(connection)),
    settings: prepare(createSettingsDatabase(connection)),
    cloud: prepare(createCloudDatabase(connection)),
    history: createHistoryDatabase(connection),
    close() {
      connection.close();
    },
  };
}

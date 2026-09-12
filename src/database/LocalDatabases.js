import { openTrackingDatabase } from './TrackingDatabaseConnection';
import { createDemoDatabase } from '../demo/DemoDatabase';
import { createDogDatabase } from './DogDatabase';
import { createSettingsDatabase } from './SettingsDatabase';

// Both tables live in dogtracker.sqlite. Only this owner closes the connection;
// the Demo adapter cannot write to or clear the hardware-owned dog_status table.
export function createLocalDatabases() {
  const connection = openTrackingDatabase();
  // All three migrations must wait for this, including Demo/settings which
  // otherwise race initialization. Android additionally serializes every SQL
  // command/transaction with BLE writes inside its single native owner.
  const configured = Promise.resolve().then(() =>
    connection.executeAsync('PRAGMA busy_timeout=5000'),
  );
  const prepare = database => ({
    ...database,
    async initialize() {
      await configured;
      return database.initialize();
    },
  });
  return {
    real: prepare(createDogDatabase(connection)),
    demo: prepare(createDemoDatabase(connection)),
    settings: prepare(createSettingsDatabase(connection)),
    close() {
      connection.close();
    },
  };
}

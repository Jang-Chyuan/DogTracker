import { open } from 'react-native-nitro-sqlite';
import { createDemoDatabase } from '../demo/DemoDatabase';
import { createDogDatabase } from './DogDatabase';
import { createSettingsDatabase } from './SettingsDatabase';

// Both tables live in dogtracker.sqlite. Only this owner closes the connection;
// the Demo adapter cannot write to or clear the hardware-owned dog_status table.
export function createLocalDatabases() {
  const connection = open({ name: 'dogtracker.sqlite', location: 'databases' });
  return {
    real: createDogDatabase(connection),
    demo: createDemoDatabase(connection),
    settings: createSettingsDatabase(connection),
    close() {
      connection.close();
    },
  };
}

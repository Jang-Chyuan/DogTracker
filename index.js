/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { runBackgroundCloudSync } from './src/cloud/CloudBackgroundSync';
import { runSearchRelay } from './src/cloudUpload/SearchRelay';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('DogTrackerCloudHistory', () => runBackgroundCloudSync);
AppRegistry.registerHeadlessTask('DogTrackerSearchRelay', () => runSearchRelay);

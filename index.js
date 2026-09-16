/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { cloudKeepAlive } from './src/cloud/CloudBackground';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('DogTrackerCloudKeepAlive', () => cloudKeepAlive);

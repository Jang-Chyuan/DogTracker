import React, { useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useTrackingSession } from './src/app/useTrackingSession';
import HardwareScreen from './src/screens/HardwareScreen';
import { handleRootBack } from './src/app/handleRootBack';
import { ui } from './src/components/ScreenUI';
import DemoScreen from './src/demo/DemoScreen';
import MapScreen from './src/screens/MapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CloudScreen from './src/cloud/CloudScreen';
import LocationTrackerScreen from './src/locationTracker/LocationTrackerScreen';
import { useMapHistory } from './src/mapHistory/useMapHistory';
import { useHistoryDownload } from './src/mapHistory/useHistoryDownload';
import { useCloudSync } from './src/cloud/useCloudSync';
import { useCloudDogs } from './src/cloud/useCloudDogs';
import BottomNavigation, {
  NAV_HEIGHT,
} from './src/components/BottomNavigation';
import { usePhoneLocation } from './src/gps/usePhoneLocation';
import { GOOGLE_MAP_PROVIDER } from './src/map/GoogleMapProvider';



export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <TrackerApp />
    </SafeAreaProvider>
  );
}

function TrackerApp() {
  const tracking = useTrackingSession();
  const cloudSync = useCloudSync(tracking.cloudDatabase, tracking.ready.real);
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState({ name: 'map', parent: null });
  const navigate = (name, parent = null) => setRoute({ name, parent });
  const isMap = route.name === 'map';
  const isHistory = route.name === 'history';
  // Both tabs draw on the same persistent map layer; only one of them is live.
  const showsMap = isMap || isHistory;
  const history = useMapHistory(tracking.historyDatabase, tracking.ready.real,
    tracking.foreground && isHistory, cloudSync.ownerId);
  // The history card downloads a cloud range it does not hold, through the same
  // writer and the same exclusive slot as the cloud page.
  const historyDownload = useHistoryDownload({
    database: tracking.cloudDatabase, sync: cloudSync, owner: cloudSync.ownerId,
  });
  const phone = usePhoneLocation(tracking.foreground, undefined, showsMap);
  // Kept reading while the history tab is open: disabling it empties the rows,
  // so the cloud dogs would blink off the home map on every visit.
  const cloudDogs = useCloudDogs(tracking.cloudDatabase, cloudSync.ownerId,
    tracking.ready.real && tracking.foreground && showsMap && tracking.mode === 'real',
    undefined,
    // The cloud dogs' path is only read while the card is drawing paths.
    tracking.preferences.value.showTrails
      ? tracking.preferences.value.windowMinutes * 60000 : null);

  useEffect(() => {
    // HardwareScreen owns its nested scan/connect/menu back stack.
    if (route.name === 'hardware') return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (route.name === 'map') handleRootBack();
        else setRoute({ name: route.parent || 'map', parent: null });
        return true;
      },
    );
    return () => subscription.remove();
  }, [route]);

  let content;
  switch (route.name) {
    case 'locationTracker':
      content = <LocationTrackerScreen foreground={tracking.foreground} />;
      break;
    case 'cloud':
      content = <CloudScreen database={tracking.cloudDatabase} sync={cloudSync} />;
      break;
    case 'demo':
      content = (
        <DemoScreen
          tracking={tracking}
          onMap={() => navigate('map')}
          onBack={() => navigate('settings')}
        />
      );
      break;
    case 'settings':
      content = (
        <SettingsScreen
          tracking={tracking}
          onHardware={() => navigate('hardware', 'settings')}
          onDemo={() => navigate('demo', 'settings')}
          onCloud={() => navigate('cloud', 'settings')}
          onLocationTracker={() => navigate('locationTracker', 'settings')}
        />
      );
      break;
    case 'history':
      // The history card is drawn over the map layer, like the live card.
      content = null;
      break;
    case 'hardware':
      content = null;
      break;
    default:
      content = null;
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={showsMap ? [] : ['top', 'bottom', 'left', 'right']}
    >
      <StatusBar barStyle={showsMap ? 'dark-content' : 'light-content'} />
      {!showsMap && (
        <View style={styles.header}>
          <Text style={styles.brand}>DogTracker</Text>
          <Text
            style={[
              styles.source,
              tracking.mode === 'demo' && styles.demoSource,
            ]}
          >
            {!tracking.preferences.ready
              ? '讀取設定中…'
              : tracking.mode === 'demo'
              ? 'DEMO · 模擬資料'
              : '正式 · SQLite'}
          </Text>
        </View>
      )}
      <View
        testID="persistent-map-layer"
        pointerEvents={showsMap ? 'auto' : 'none'}
        accessibilityElementsHidden={!showsMap}
        importantForAccessibility={showsMap ? 'auto' : 'no-hide-descendants'}
        style={[
          StyleSheet.absoluteFill,
          styles.mapLayer,
          !showsMap && styles.hiddenMapLayer,
        ]}
      >
        <MapScreen
          history={history}
          historyDownload={historyDownload}
          tracking={tracking}
          phone={phone}
          cloudDogs={cloudDogs}
          historical={isHistory}
          active={showsMap}
          bottomInset={insets.bottom + NAV_HEIGHT + 20}
          mapProvider={GOOGLE_MAP_PROVIDER}
        />


      </View>
      {tracking.ready.real && (
        <HardwareScreen
          dogDatabase={tracking.hardwareDatabase}
          onStorageError={tracking.reportNativeWriteError}
          active={route.name === 'hardware'}
          onBack={() => navigate('settings')}
        />
      )}
      {!showsMap && route.name !== 'hardware' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            key={route.name}
            contentContainerStyle={styles.container}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {tracking.realWriteError ? (
              <View style={ui.card}>
                <Text accessibilityRole="alert" style={ui.error}>
                  正式資料儲存失敗：{tracking.realWriteError}
                </Text>
                <Text style={ui.hint}>
                  部分硬體資料未能儲存。讀取正常不代表寫入正常；此提示會在下一筆成功寫入後清除，失敗資料不會自動重送。
                </Text>
              </View>
            ) : null}
            {content}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      <BottomNavigation
        selected={route.parent || route.name}
        onNavigate={navigate}
        floating={showsMap}
        bottomInset={insets.bottom}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0f172a' },
  mapLayer: { backgroundColor: '#0f172a' },
  hiddenMapLayer: { opacity: 0, zIndex: -1 },
  keyboardView: { flex: 1 },
  container: { padding: 20, paddingBottom: 28 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomColor: '#334155',
    borderBottomWidth: 1,
  },
  brand: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  source: { color: '#93c5fd', fontSize: 14, marginTop: 4 },
  demoSource: { color: '#c4b5fd' },
});

import React, { useEffect, useRef, useState } from 'react';
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
import { createBleService } from './src/ble/BleService';
import { ui } from './src/components/ScreenUI';
import DemoScreen from './src/demo/DemoScreen';
import MapScreen from './src/screens/MapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import WifiSettingsScreen from './src/screens/WifiSettingsScreen';
import { getErrorMessage } from './src/utils/errors';
import BottomNavigation, {
  NAV_HEIGHT,
} from './src/components/BottomNavigation';
import { usePhoneLocation } from './src/gps/usePhoneLocation';
import { GOOGLE_MAP_PROVIDER } from './src/map/GoogleMapProvider';

const DATABASE_SAVE_INTERVAL_MS = 1000;

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <TrackerApp />
    </SafeAreaProvider>
  );
}

function TrackerApp() {
  const [bleService] = useState(createBleService);
  const [bleStatus, setBleStatus] = useState('未連線');
  const lastSavedAtRef = useRef(0);
  const tracking = useTrackingSession();
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState({ name: 'map', parent: null });
  const navigate = (name, parent = null) => setRoute({ name, parent });
  const isMap = route.name === 'map';
  const phone = usePhoneLocation(tracking.foreground, undefined, isMap);

  useEffect(
    () => () => {
      try {
        bleService.disconnect();
      } catch (error) {
        console.error('BLE 關閉失敗:', error);
      }
    },
    [bleService],
  );

  useEffect(() => {
    if (route.name === 'map') return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setRoute({ name: route.parent || 'map', parent: null });
        return true;
      },
    );
    return () => subscription.remove();
  }, [route]);

  const connectToDogGps = async () => {
    try {
      await bleService.connect(setBleStatus, (nextData, payload) => {
        const now = Date.now();
        if (now - lastSavedAtRef.current >= DATABASE_SAVE_INTERVAL_MS) {
          lastSavedAtRef.current = now;
          tracking
            .saveRealStatus(nextData, payload)
            .then(insertId => console.log('SQLite 寫入成功:', insertId))
            .catch(error => console.error('儲存 BLE dataset 失敗:', error));
        }
      });
    } catch (error) {
      setBleStatus(`連線失敗：${getErrorMessage(error)}`);
      console.error('BLE 連線失敗:', error);
    }
  };

  let content;
  switch (route.name) {
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
          bleStatus={bleStatus}
          onConnect={connectToDogGps}
          onWifi={() => navigate('wifi', 'settings')}
          onDemo={() => navigate('demo', 'settings')}
        />
      );
      break;
    case 'wifi':
      content = (
        <WifiSettingsScreen
          bleService={bleService}
          onBack={() => navigate('settings')}
        />
      );
      break;
    default:
      content = null;
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={isMap ? [] : ['top', 'bottom', 'left', 'right']}
    >
      <StatusBar barStyle={isMap ? 'dark-content' : 'light-content'} />
      {!isMap && (
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
        pointerEvents={isMap ? 'auto' : 'none'}
        accessibilityElementsHidden={!isMap}
        importantForAccessibility={isMap ? 'auto' : 'no-hide-descendants'}
        style={[
          StyleSheet.absoluteFill,
          styles.mapLayer,
          !isMap && styles.hiddenMapLayer,
        ]}
      >
        <MapScreen
          tracking={tracking}
          phone={phone}
          active={isMap}
          bottomInset={insets.bottom + NAV_HEIGHT + 20}
          mapProvider={GOOGLE_MAP_PROVIDER}
        />
      </View>
      {!isMap && (
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
        floating={isMap}
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

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
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState({ name: 'map', parent: null });
  const navigate = (name, parent = null) => setRoute({ name, parent });
  const isMap = route.name === 'map';
  const phone = usePhoneLocation(tracking.foreground, undefined, isMap);

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
        />
      );
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
      {tracking.ready.real && (
        <HardwareScreen
          dogDatabase={tracking.hardwareDatabase}
          onStorageError={tracking.reportNativeWriteError}
          active={route.name === 'hardware'}
          onBack={() => navigate('settings')}
        />
      )}
      {!isMap && route.name !== 'hardware' && (
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

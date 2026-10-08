import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
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
import MapScreen from './src/screens/MapScreen';
import { useFixtureEdits, useScreenFixture } from './src/dev/useScreenFixture';
import { applyScreenFixture } from './src/dev/ScreenFixtures';
import SettingsScreen from './src/screens/SettingsScreen';
import CloudScreen from './src/cloud/CloudScreen';
import LocationTrackerScreen from './src/locationTracker/LocationTrackerScreen';
import { useDefaultLocationRecording } from './src/locationTracker/useDefaultLocationRecording';
import { useMapHistory } from './src/mapHistory/useMapHistory';
import { useDogAvatars } from './src/dogs/useDogAvatars';
import { useHistoryDownload } from './src/mapHistory/useHistoryDownload';
import { useCloudSync } from './src/cloud/useCloudSync';
import { useCloudDogs } from './src/cloud/useCloudDogs';
import { useCloudUpload } from './src/cloudUpload/useCloudUpload';
import { usePhoneLocation } from './src/gps/usePhoneLocation';
import { GOOGLE_MAP_PROVIDER } from './src/map/GoogleMapProvider';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { useTodayRoute } from './src/locationTracker/useTodayRoute';
import { layout } from './src/theme/tokens';
import { useNotificationPermission } from './src/app/useNotificationPermission';



export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <AuthGate><TrackerApp /></AuthGate>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export function AuthGate({ children }) {
  const { loading, user } = useAuth();
  // Signing in is optional (v3 D1): signed out, the app opens on the map with
  // this phone's own receiver data, and 設定 → 雲端資料 is where to sign in.
  // The launch screen covers session restore and stays until the map has
  // loaded (GoogleTrackingMap), signed in or not, so there is no blank or
  // "restoring" page in between.
  const account = useAccountGeneration(user?.id || null);
  if (loading) return <SafeAreaView style={[authStyles.container, authStyles.loading]}>
    <Text accessibilityLiveRegion="polite" style={ui.text}>正在恢復登入狀態…</Text>
  </SafeAreaView>;
  // A direct switch to another account discards the previous account's
  // navigation state; signing in or out keeps the page the user is on.
  return <React.Fragment key={account}>{children}</React.Fragment>;
}

// Counts direct switches from one account to another. Signing in from the
// signed-out app (also after signing out of another account) keeps the page
// the user signed in on: every account-bound hook follows the owner itself.
function useAccountGeneration(userId) {
  const last = useRef(null), generation = useRef(0);
  if (userId !== last.current) {
    if (userId && last.current) generation.current += 1;
    last.current = userId;
  }
  return generation.current;
}

// The pages off the map, by route: the header's 「‹ 標題」.
const PAGE_TITLES = {
  settings: '設定',
  cloud: '雲端資料',
  locationTracker: '手機位置記錄',
  hardware: '硬體連線',
};

const authStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  loading: { padding: 24 },
});

function TrackerApp() {
  const auth = useAuth();
  const tracking = useTrackingSession();
  const cloudSync = useCloudSync(tracking.cloudDatabase, tracking.ready.real);
  const upload = useCloudUpload(tracking.ready.real, cloudSync.ownerId, tracking.foreground);
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState({ name: 'map', parent: null });
  // The hardware page keeps its own back stack: its header back is passed in.
  const [hardwareBack, setHardwareBack] = useState(0);
  // The dog whose history 看軌跡 opened: back on the live map, its card opens
  // again (design: history from a dog's card returns to that card).
  const [cardHistory, setCardHistory] = useState(null);
  const [openDogRequest, setOpenDogRequest] = useState(null);
  const navigate = (name, parent = null) => {
    if (name === 'map' && route.name === 'history' && cardHistory != null) {
      setOpenDogRequest({ slaveId: cardHistory, key: Date.now() });
    }
    if (name !== 'history') setCardHistory(null);
    setRoute({ name, parent });
  };
  const isMap = route.name === 'map';
  const isHistory = route.name === 'history';
  // Both tabs draw on the same persistent map layer; only one of them is live.
  const showsMap = isMap || isHistory;
  // Each dog's face (dog_avatars); the default illustration until one is set.
  const dogAvatars = useDogAvatars(tracking.historyDatabase, tracking.ready.real);
  const history = useMapHistory(tracking.historyDatabase, tracking.ready.real,
    tracking.foreground && isHistory, cloudSync.ownerId);
  // The history card downloads a cloud range it does not hold, through the same
  // writer and the same exclusive slot as the cloud page.
  const historyDownload = useHistoryDownload({
    database: tracking.cloudDatabase, sync: cloudSync, owner: cloudSync.ownerId,
  });
  const phone = usePhoneLocation(tracking.foreground, undefined, showsMap);
  useDefaultLocationRecording(tracking.foreground, phone);
  // 「今天 x km」: today's recorded route of this phone, while the live map
  // is in front.
  const liveTodayRoute = useTodayRoute(tracking.historyDatabase, tracking.ready.real,
    tracking.foreground && isMap);
  // Cache eligibility is separate from polling visibility. Background/navigation
  // pauses reads; logout invalidates the account-bound cache.
  // Debug builds only: a named screen state (dogtracker://dev/fixture?name=…)
  // replaces the live map's inputs. Always null in release builds.
  const fixture = useScreenFixture();
  const cloudDogs = useCloudDogs(tracking.cloudDatabase, cloudSync.ownerId,
    tracking.ready.real,
    undefined, null, { active: tracking.foreground && showsMap && !fixture, revision: cloudSync.revision });
  const fixtureEdits = useFixtureEdits(fixture);
  const notificationsDenied = useNotificationPermission(tracking.foreground);
  const mapInputs = applyScreenFixture(isHistory ? null : fixture,
    { tracking, phone, cloudDogs, cloudSync, history, dogAvatars, todayRoute: liveTodayRoute,
      // The gear's red dot: the upload failing or the sign-in expired.
      cloudProblem: !!auth.expired || (!!cloudSync.ownerId && !!upload.error),
      notificationsDenied }, fixtureEdits);
  // A top card's button (A2/A6): where it takes the user. Back returns to the map.
  const alertAction = id => {
    if (id === 'receiver-settings' || id === 'connect-receiver' || id === 'storage-reason') navigate('hardware', 'map');
    else if (id === 'sign-in') navigate('cloud', 'map');
    else if (id === 'storage-settings') {
      Linking.sendIntent('android.settings.INTERNAL_STORAGE_SETTINGS').catch(() => Linking.openSettings());
    }
  };
  // Background work that keeps going when the map is left (返回鍵 on the
  // map): this phone uploads for a receiver and still has rows waiting.
  const uploading = (upload.settings || []).some(setting => setting.mode === 'phone')
    && (upload.counts || []).some(row => row.status === 'pending' && Number(row.count) > 0);

  useEffect(() => {
    // HardwareScreen owns its nested scan/connect/menu back stack.
    if (route.name === 'hardware') return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (route.name === 'map') handleRootBack({ uploading });
        else navigate(route.parent || 'map');
        return true;
      },
    );
    return () => subscription.remove();
    // navigate reads route and cardHistory, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, cardHistory, uploading]);

  let content;
  switch (route.name) {
    case 'locationTracker':
      content = <LocationTrackerScreen foreground={tracking.foreground} />;
      break;
    case 'cloud':
      content = <CloudScreen database={tracking.cloudDatabase} sync={cloudSync}
        onLater={() => navigate(route.parent || 'map')} />;
      break;
    case 'settings':
      content = (
        <SettingsScreen
          tracking={tracking}
          onHardware={() => navigate('hardware', 'settings')}
          onCloud={() => navigate('cloud', 'settings')}
          onLocationTracker={() => navigate('locationTracker', 'settings')}
          account={{ signedIn: !!auth.user, email: auth.user?.email || '', expired: auth.expired }}
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
        // No bottom tabs (v3): every page off the map says where it is and
        // goes back the way the back key does (「‹ 標題」).
        <View style={styles.header}>
          <Pressable
            testID="page-back"
            accessibilityRole="button"
            accessibilityLabel={`返回，${PAGE_TITLES[route.name] || '設定'}`}
            onPress={() => (route.name === 'hardware' ? setHardwareBack(value => value + 1)
              : navigate(route.parent || 'map'))}
            hitSlop={8}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Text style={styles.brand}>{`‹ ${PAGE_TITLES[route.name] || '設定'}`}</Text>
          </Pressable>
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
          history={mapInputs.history}
          historyDownload={historyDownload}
          tracking={mapInputs.tracking}
          phone={mapInputs.phone}
          cloudDogs={mapInputs.cloudDogs}
          cloudOwner={mapInputs.cloudSync.ownerId}
          cloudSync={mapInputs.cloudSync}
          dogAvatars={mapInputs.dogAvatars}
          historical={isHistory}
          active={showsMap}
          // No bottom tabs (v3): the map's buttons sit 16dp above the
          // screen's bottom edge.
          bottomInset={insets.bottom + layout.screenEdge}
          mapProvider={GOOGLE_MAP_PROVIDER}
          fixture={isHistory ? null : fixture}
          todayRoute={mapInputs.todayRoute}
          onOpenSettings={() => navigate('settings')}
          signedIn={!!mapInputs.cloudSync.ownerId}
          cloudProblem={mapInputs.cloudProblem}
          notificationsDenied={mapInputs.notificationsDenied}
          onAlertAction={alertAction}
          openDogRequest={openDogRequest}
          onOpenHistory={slaveId => {
            setCardHistory(slaveId);
            setRoute({ name: 'history', parent: null });
          }}
        />


      </View>
      {tracking.ready.real && (
        <HardwareScreen
          upload={upload}
          dogDatabase={tracking.hardwareDatabase}
          onStorageError={tracking.reportNativeWriteError}
          active={route.name === 'hardware'}
          onBack={() => navigate(route.parent || 'settings')}
          backRequest={hardwareBack}
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
            {content}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
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
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderBottomColor: '#334155',
    borderBottomWidth: 1,
  },
  back: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
  brand: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
});

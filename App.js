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
import CloudDataScreen from './src/cloud/CloudDataScreen';
import LocationTrackerScreen from './src/locationTracker/LocationTrackerScreen';
import AccountSettings from './src/settings/AccountSettings';
import { accountPage } from './src/settings/AccountModel';
import SettingsHome from './src/settings/SettingsHome';
import ReceiverSettings from './src/settings/ReceiverSettings';
import PhoneSettings from './src/settings/PhoneSettings';
import AlertSettings from './src/settings/AlertSettings';
import { alertsPage } from './src/alerts/AlertPreferences';
import { useAlertPreferences } from './src/settings/useAlertPreferences';
import SettingsLinks, { SETTINGS_LINKS } from './src/settings/SettingsLinks';
import { phonePage, receiverPage, settingsHome, settingsInput } from './src/settings/SettingsModel';
import { useReceiverControl } from './src/settings/useReceiverControl';
import { useRecordingSwitch } from './src/settings/useRecordingSwitch';
import { useReceiverState } from './src/map/useReceiverState';
import { useMapClock } from './src/map/useMapClock';
import NativeTrackingPlatform from './specs/NativeTrackingPlatform';
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
import { colors, layout, touch, type } from './src/theme/tokens';
import { usePhonePermissions } from './src/app/usePhonePermissions';
import { trackReceiverWait } from './src/map/TopAlerts';



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
  // this phone's own receiver data, and 設定 → Supabase 帳號 is where to sign in.
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
  receiver: '接收器',
  phone: '手機',
  cloud: 'Supabase 帳號',
  alerts: '提醒',
  diagnostics: '診斷',
  advanced: '進階',
  locationRecords: '記錄清單',
  cloudData: '本機／雲端資料',
};
// The old hardware pages, by what they were opened for.
const HARDWARE_TITLES = { scan: '連接接收器', qr: '連接接收器', wifi: '接收器 Wi-Fi', data: '即時資料' };
const pageTitle = route => (route.name === 'hardware' ? HARDWARE_TITLES[route.entry?.screen] || '連接接收器'
  : PAGE_TITLES[route.name] || '設定');
// The v3 settings pages (light); the old pages keep their dark look until
// their v3 pages replace them (051–053).
const LIGHT_PAGES = new Set(['settings', 'receiver', 'phone', 'cloud', 'alerts', 'diagnostics', 'advanced']);
// Where each settings home row leads.
const SETTINGS_ROUTES = { receiver: 'receiver', phone: 'phone', account: 'cloud', alerts: 'alerts',
  diagnostics: 'diagnostics', advanced: 'advanced' };

// Android's own settings pages.
const openNotificationSettings = () => Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS',
  [{ key: 'android.provider.extra.APP_PACKAGE', value: 'com.dogtracker' }]).catch(() => Linking.openSettings());
const openLocationServices = () => Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS')
  .catch(() => Linking.openSettings());
const openBatterySettings = () => Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')
  .catch(() => Linking.openSettings());
const appVersion = (() => {
  try { return NativeTrackingPlatform?.appVersion?.() || ''; } catch { return ''; }
})();

const authStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  loading: { padding: 24 },
});

function TrackerApp() {
  const auth = useAuth();
  const tracking = useTrackingSession();
  // An upload or download refused for the sign-in (401) asks AuthProvider
  // whether it ended (判定表「使用中登入失效」).
  const cloudSync = useCloudSync(tracking.cloudDatabase, tracking.ready.real, undefined, auth.reportAuthFailure);
  const upload = useCloudUpload(tracking.ready.real, cloudSync.ownerId, tracking.foreground,
    auth.reportAuthFailure);
  const insets = useSafeAreaInsets();
  // The pages opened from the map, newest last; back (the key or 「‹ 標題」)
  // returns to the one before.
  const [stack, setStack] = useState([{ name: 'map' }]);
  const route = stack[stack.length - 1];
  // The hardware page keeps its own back stack: its header back is passed in.
  const [hardwareBack, setHardwareBack] = useState(0);
  // The dog whose history 看軌跡 opened: back on the live map, its card opens
  // again (design: history from a dog's card returns to that card).
  const [cardHistory, setCardHistory] = useState(null);
  const [openDogRequest, setOpenDogRequest] = useState(null);
  const open = (name, extra = {}) => setStack(current => [...current, { name, ...extra }]);
  const goBack = () => {
    if (route.name === 'history' && cardHistory != null) {
      setOpenDogRequest({ slaveId: cardHistory, key: Date.now() });
    }
    setCardHistory(null);
    setStack(current => (current.length > 1 ? current.slice(0, -1) : current));
  };
  // A hardware page opened for `screen` ('scan', 'qr', 'wifi', 'data').
  const openHardware = screen => open('hardware', { entry: { screen, key: Date.now() } });
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
    tracking.foreground && (isMap || route.name === 'phone'));
  // Cache eligibility is separate from polling visibility. Background/navigation
  // pauses reads; logout invalidates the account-bound cache.
  // Debug builds only: a named screen state (dogtracker://dev/fixture?name=…)
  // replaces the live map's inputs. Always null in release builds.
  const fixture = useScreenFixture();
  const cloudDogs = useCloudDogs(tracking.cloudDatabase, cloudSync.ownerId,
    tracking.ready.real,
    undefined, null, { active: tracking.foreground && (showsMap || route.name === 'receiver') && !fixture, revision: cloudSync.revision });
  const fixtureEdits = useFixtureEdits(fixture);
  const permissions = usePhonePermissions(tracking.foreground);
  const mapInputs = applyScreenFixture(isHistory ? null : fixture,
    { tracking, phone, cloudDogs, cloudSync, history, dogAvatars, todayRoute: liveTodayRoute,
      // The gear's red dot: the upload failing or the sign-in expired.
      cloudProblem: !!cloudSync.ownerId && !!upload.error,
      signInExpired: !!auth.expired,
      permissions, upload,
      account: { signedIn: !!auth.user, email: auth.user?.email || '' } }, fixtureEdits);
  // ---- the receiver, for the map and the settings pages ------------------
  const settingsOpen = LIGHT_PAGES.has(route.name) || route.name === 'hardware';
  const settingsClock = useMapClock(tracking.foreground && settingsOpen && !fixture);
  const now = fixture ? fixture.now : settingsClock;
  const receiverState = useReceiverState(tracking.foreground && !isHistory, fixture?.readReceiverState);
  const receiverWait = useRef(null);
  receiverWait.current = trackReceiverWait(receiverWait.current, receiverState,
    fixture ? fixture.now : Date.now());
  const receiverControl = useReceiverControl({ receiverState, onRescan: () => openHardware('qr') });
  // A top card's button (A2/A6): where it takes the user. Back returns to the map.
  const alertAction = id => {
    if (id === 'receiver-settings') open('receiver');
    else if (id === 'connect-receiver') openHardware('scan');
    // Until S8 (051), 診斷 lists the reason above its old pages.
    else if (id === 'storage-reason') open('diagnostics');
    else if (id === 'sign-in') open('cloud');
    else if (id === 'storage-settings') {
      Linking.sendIntent('android.settings.INTERNAL_STORAGE_SETTINGS').catch(() => Linking.openSettings());
    }
  };
  // A settings fixture opens its page (settings-*, receiver-*, phone-*).
  const fixturePage = fixture?.openRoute ?? null;
  const fixtureName = fixture?.name ?? null;
  useEffect(() => {
    if (!fixturePage) return;
    setStack(fixturePage === 'settings' ? [{ name: 'map' }, { name: 'settings' }]
      : [{ name: 'map' }, { name: 'settings' }, { name: fixturePage }]);
  }, [fixtureName, fixturePage]);
  // ---- what the settings pages say ---------------------------------------
  const recordingSwitch = useRecordingSwitch(tracking.foreground && route.name === 'phone' && !fixture);
  const settingsData = settingsInput(mapInputs, { now, receiverState, receiverWait: receiverWait.current,
    recording: recordingSwitch });
  // S6's switches, saved with the tracking preferences (a fixture's only in
  // memory). Nothing sends alerts yet: 058 reads the same AlertPreferences.
  const alertPreferences = useAlertPreferences(settingsData.alerts, mapInputs.tracking.saveTrackingPreferences);

  // Background work that keeps going when the map is left (返回鍵 on the
  // map): this phone uploads for a receiver and still has rows waiting.
  const uploading = (upload.settings || []).some(setting => setting.mode === 'phone')
    && (upload.counts || []).some(row => row.status === 'pending' && Number(row.count) > 0);

  useEffect(() => {
    // HardwareScreen owns its nested scan/connect back stack.
    if (route.name === 'hardware') return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (route.name === 'map') handleRootBack({ uploading });
        else goBack();
        return true;
      },
    );
    return () => subscription.remove();
    // goBack reads route and cardHistory, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, cardHistory, uploading]);

  let content = null;
  let page = null;
  switch (route.name) {
    case 'locationRecords':
      content = <LocationTrackerScreen foreground={tracking.foreground} />;
      break;
    case 'cloud':
      // S3: signed out it is the sign-in form (「稍後再說」 goes back). A
      // fixture's page writes nothing and signs nobody out.
      page = <AccountSettings page={accountPage(settingsData)} onLater={goBack}
        dialog={fixture?.dialog ?? null}
        onSignOut={fixture ? async () => {} : async () => {
          await auth.signOut();
          // A6 comes back after signing out (判定表「A6 的 ✕ 什麼時候重來」).
          tracking.saveTrackingPreferences?.({ noDataCardDismissed: false })?.catch?.(() => {});
        }}
        onRetryDownload={fixture ? () => {} : () => cloudSync.retry?.()}
        onRetryUpload={() => mapInputs.upload?.retry?.()?.catch?.(() => {})}
        onSwitch={(master, mode) => mapInputs.upload.switchMode(master, mode)} />;
      break;
    case 'cloudData':
      content = <CloudDataScreen database={tracking.cloudDatabase} sync={cloudSync} phoneId={upload.phoneId} />;
      break;
    case 'settings': {
      const home = settingsHome(settingsData);
      page = <SettingsHome home={home} version={appVersion}
        onOpen={id => open(SETTINGS_ROUTES[id])}
        onStorage={() => alertAction(home.storage?.full ? 'storage-settings' : 'storage-reason')} />;
      break;
    }
    case 'receiver':
      page = <ReceiverSettings page={receiverPage(settingsData)}
        onDisconnect={receiverControl.disconnect} onReconnect={receiverControl.reconnect}
        onRescan={() => { receiverControl.disconnect(); openHardware('qr'); }}
        onChange={() => openHardware('qr')} onConnect={() => openHardware('qr')} />;
      break;
    case 'alerts':
      // 「開系統設定 ›」 opens this app's notification settings.
      page = <AlertSettings key={fixtureName ?? 'live'} page={alertsPage(alertPreferences.value, settingsData.permissions)}
        onChange={alertPreferences.change} onNotificationSettings={openNotificationSettings}
        initiallyOpen={!!fixture?.alertsOpen} />;
      break;
    case 'phone':
      page = <PhoneSettings page={phonePage(settingsData)}
        onRecording={on => settingsData.recording.toggle?.(on)}
        onPermissions={() => Linking.openSettings()} onLocationServices={openLocationServices}
        onBattery={openBatterySettings} />;
      break;
    case 'diagnostics':
    case 'advanced':
      page = <SettingsLinks links={SETTINGS_LINKS[route.name]}
        storage={route.name === 'diagnostics' ? settingsData.storage : null}
        onOpen={id => (id === 'records' ? open('locationRecords') : id === 'cloudData' ? open('cloudData')
          : openHardware(id))} />;
      break;
    default:
      break;
  }
  const light = LIGHT_PAGES.has(route.name);

  return (
    <SafeAreaView
      style={[styles.safeArea, light && styles.page]}
      edges={showsMap ? [] : ['top', 'bottom', 'left', 'right']}
    >
      <StatusBar barStyle={showsMap || light ? 'dark-content' : 'light-content'}
        backgroundColor={light ? colors.surface : undefined} />
      {!showsMap && (
        // No bottom tabs (v3): every page off the map says where it is and
        // goes back the way the back key does (「‹ 標題」).
        <View style={[styles.header, light && styles.lightHeader]}>
          <Pressable
            testID="page-back"
            accessibilityRole="button"
            accessibilityLabel={`返回，${pageTitle(route)}`}
            onPress={() => (route.name === 'hardware' ? setHardwareBack(value => value + 1) : goBack())}
            hitSlop={8}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Text style={[styles.brand, light && styles.lightBrand]}>{`‹ ${pageTitle(route)}`}</Text>
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
          onOpenSettings={() => open('settings')}
          signedIn={!!mapInputs.cloudSync.ownerId}
          cloudProblem={mapInputs.cloudProblem}
          signInExpired={mapInputs.signInExpired}
          notificationsDenied={mapInputs.permissions.notificationsDenied}
          nearbyDenied={mapInputs.permissions.nearbyDenied}
          receiver={{ state: isHistory ? null : receiverState, wait: receiverWait.current }}
          onAlertAction={alertAction}
          openDogRequest={openDogRequest}
          onOpenHistory={slaveId => {
            setCardHistory(slaveId);
            open('history');
          }}
        />


      </View>
      {tracking.ready.real && (
        <HardwareScreen
          dogDatabase={tracking.hardwareDatabase}
          onStorageError={tracking.reportNativeWriteError}
          active={route.name === 'hardware'}
          entry={route.name === 'hardware' ? route.entry : null}
          onBack={goBack}
          onConnected={goBack}
          onConnectFailed={receiverControl.switchFailed}
          onQrTarget={receiverControl.watchSwitch}
          onMismatch={receiverControl.reportMismatch}
          backRequest={hardwareBack}
        />
      )}
      {light && <View style={styles.page}>{page}</View>}
      {!showsMap && !light && route.name !== 'hardware' && (
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
  // The v3 pages: a light 56dp header 「‹ 標題」 over the page colour.
  lightHeader: { backgroundColor: colors.surface, borderBottomWidth: 0, minHeight: touch.subpageHeader,
    justifyContent: 'center', paddingHorizontal: 8 },
  lightBrand: { ...type.title, color: colors.text },
  page: { flex: 1, backgroundColor: colors.surface },
});

import {
  ThemeProvider,
  useTheme,
  useStyles,
  makeStyles,
} from './src/theme/ThemeProvider';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Linking,
  Pressable,
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
import { handleRootBack } from './src/app/handleRootBack';
import MapScreen from './src/screens/MapScreen';
import { useFixtureEdits, useScreenFixture } from './src/dev/useScreenFixture';
import { applyScreenFixture } from './src/dev/ScreenFixtures';
import {
  AddressLookupContext,
  addressLookup,
} from './src/placement/AddressLookup';
import CloudDataScreen from './src/cloud/CloudDataScreen';
import LocationTrackerScreen from './src/locationTracker/LocationTrackerScreen';
import AdvancedSettings from './src/settings/AdvancedSettings';
import DiagnosticsSettings from './src/settings/DiagnosticsSettings';
import LiveDataSettings from './src/settings/LiveDataSettings';
import WifiSettings from './src/settings/WifiSettings';
import { useReceiverWifi } from './src/settings/useReceiverWifi';
import { useDeleteDogData } from './src/settings/DeleteDogData';
import { diagnosticsPage } from './src/diagnostics/DiagnosticsModel';
import { useRecentRows } from './src/diagnostics/useRecentRows';
import { sharedBleService } from './src/ble/sharedBle';
import { receiverNumber } from './src/map/ReceiverState';
import { formatClock } from './src/map/MapFormat';
import AccountSettings from './src/settings/AccountSettings';
import { accountPage } from './src/settings/AccountModel';
import SettingsHome from './src/settings/SettingsHome';
import ReceiverSettings from './src/settings/ReceiverSettings';
import PhoneSettings from './src/settings/PhoneSettings';
import AlertSettings from './src/settings/AlertSettings';
import { alertsPage } from './src/alerts/AlertPreferences';
import { useAlertPreferences } from './src/settings/useAlertPreferences';
import { useAlertEngine } from './src/alerts/useAlertEngine';
import { useNativeAlertState } from './src/alerts/useNativeAlertState';
import {
  alertSnapshot,
  handOverAlerts,
  notificationDestination,
  saveAlertState,
} from './src/alerts/AlertNotifications';
import { pauseAlertState } from './src/alerts/AlertEngine';
import { offMapAlerts } from './src/alerts/OffMapAlerts';
import {
  closeAlertCard,
  isAlertReturn,
  openAlertTarget,
  openTrackFrom,
} from './src/alerts/ReturnSnapshot';
import { AlertBadge, N3Card } from './src/map/TopAlertCards';
import AlertPreview from './src/dev/AlertPreview';
import {
  phonePage,
  receiverPage,
  settingsHome,
  settingsInput,
} from './src/settings/SettingsModel';
import { useReceiverControl } from './src/settings/useReceiverControl';
import { useRecordingSwitch } from './src/settings/useRecordingSwitch';
import { useReceiverState } from './src/map/useReceiverState';
import { useMapClock } from './src/map/useMapClock';
import NativeTrackingPlatform from './specs/NativeTrackingPlatform';
import { useDefaultLocationRecording } from './src/locationTracker/useDefaultLocationRecording';
import { useMapHistory } from './src/mapHistory/useMapHistory';
import { historyTargetOf } from './src/mapHistory/useHistoryScreen';
import { useDogAvatars } from './src/dogs/useDogAvatars';
import { useHistoryCloudSource } from './src/mapHistory/HistoryCloud';
import { useCloudSync } from './src/cloud/useCloudSync';
import { useCloudDogs } from './src/cloud/useCloudDogs';
import { useCloudUpload } from './src/cloudUpload/useCloudUpload';
import { usePhoneLocation } from './src/gps/usePhoneLocation';
import { GOOGLE_MAP_PROVIDER } from './src/map/GoogleMapProvider';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { useTodayRoute } from './src/locationTracker/useTodayRoute';
import { layout, touch, type, space, size as sizes } from './src/theme/tokens';
import { usePhonePermissions } from './src/app/usePhonePermissions';
import { trackReceiverWait } from './src/map/TopAlerts';
import { holdSplash, launchInto } from './src/app/hideSplash';
import SplashOverlay from './src/app/SplashOverlay';
import {
  GUIDE_STEP_OF,
  guideStack,
  launchScreen,
  leaveSignIn,
  ONBOARDING_DONE,
  ONBOARDING_PAIRED,
  ONBOARDING_RECEIVER,
  ONBOARDING_SIGN_IN,
  signInStack,
} from './src/app/Launch';
import { useReceiverService } from './src/ble/useReceiverService';
import PermissionsScreen from './src/onboarding/PermissionsScreen';
import { usePermissionsGuide } from './src/onboarding/usePermissionsGuide';
import PairingScreen from './src/onboarding/PairingScreen';
import PairedScreen from './src/onboarding/PairedScreen';
import { usePairing } from './src/onboarding/usePairing';
import { pairedPage, pairingFlow } from './src/onboarding/Pairing';
import LoginScreen from './src/screens/LoginScreen';
import StartFailedScreen, {
  START_FAILED_TITLE,
} from './src/screens/StartFailedScreen';

export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <AuthProvider>
          <AuthGate>
            <TrackerRoot />
          </AuthGate>
        </AuthProvider>
        {/* D0's copy over everything until the first screen is ready. */}
        <SplashOverlay />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

export function AuthGate({ children }) {
  const { user } = useAuth();
  // Signing in is optional (v3 D1). The app starts at once, while the sign-in
  // is restored: the launch screen (D0) covers both, and TrackerApp decides
  // what opens first (Launch.launchScreen) — the map, D1, or the failure
  // screen — so there is no blank or "restoring" page in between.
  const account = useAccountGeneration(user?.id || null);
  // A direct switch to another account discards the previous account's
  // navigation state; signing in or out keeps the page the user is on.
  return <React.Fragment key={account}>{children}</React.Fragment>;
}

// Counts direct switches from one account to another. Signing in from the
// signed-out app (also after signing out of another account) keeps the page
// the user signed in on: every account-bound hook follows the owner itself.
function useAccountGeneration(userId) {
  const last = useRef(null),
    generation = useRef(0);
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
  liveData: '即時資料',
  cloudData: '本機／雲端資料',
  locationRecords: '記錄清單',
  wifi: '接收器 Wi-Fi',
  // Debug builds only: the alert engine's preview (src/dev/AlertPreview).
  alertPreview: '提醒預覽',
};
// Pages of their own, without the 「‹ 標題」 header: the first-use pages
// (D1 登入, D2 權限, D3 連接接收器, D4 完成) and D0's failure screen.
const FULL_PAGES = new Set([
  'signIn',
  'permissions',
  'pair',
  'paired',
  'startFailed',
]);
const pageTitle = route => PAGE_TITLES[route.name] || '設定';
// The v3 settings pages (light).
const LIGHT_PAGES = new Set([
  'settings',
  'receiver',
  'phone',
  'cloud',
  'alerts',
  'diagnostics',
  'advanced',
  'liveData',
  'cloudData',
  'locationRecords',
  'wifi',
  'alertPreview',
]);
// The page under each settings page (a fixture opens the whole way there).
const PARENT_PAGES = {
  liveData: 'diagnostics',
  cloudData: 'diagnostics',
  locationRecords: 'diagnostics',
  wifi: 'advanced',
  alertPreview: 'alerts',
};
// A fixture on a page of the guide opens it as the guide has it (D2 → D3 →
// D4, with the progress bar).
const GUIDE_FIXTURE_PAGES = ['permissions', 'pair', 'paired'];
const stackTo = page => {
  if (page === 'map') return [{ name: 'map' }];
  // A history fixture (054a) opens the history page over the map.
  if (page === 'history') return [{ name: 'map' }, { name: 'history' }];
  if (page === 'settings') return [{ name: 'map' }, { name: 'settings' }];
  if (GUIDE_FIXTURE_PAGES.includes(page)) {
    return [
      { name: 'map' },
      ...GUIDE_FIXTURE_PAGES.slice(
        0,
        GUIDE_FIXTURE_PAGES.indexOf(page) + 1,
      ).map(name => ({ name, entry: 'onboarding' })),
    ];
  }
  const parent = PARENT_PAGES[page];
  return [
    { name: 'map' },
    { name: 'settings' },
    ...(parent ? [{ name: parent }] : []),
    { name: page },
  ];
};
// Where each settings home row leads.
const SETTINGS_ROUTES = {
  receiver: 'receiver',
  phone: 'phone',
  account: 'cloud',
  alerts: 'alerts',
  diagnostics: 'diagnostics',
  advanced: 'advanced',
};

// Android's own settings pages.
const openNotificationSettings = () =>
  Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
    { key: 'android.provider.extra.APP_PACKAGE', value: 'com.dogtracker' },
  ]).catch(() => Linking.openSettings());
const openLocationServices = () =>
  Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() =>
    Linking.openSettings(),
  );
const openBatterySettings = () =>
  Linking.sendIntent(
    'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
  ).catch(() => Linking.openSettings());
const appVersion = (() => {
  try {
    return NativeTrackingPlatform?.appVersion?.() || '';
  } catch {
    return '';
  }
})();

// 刪除全部狗資料 (S7) starts every reader of the deleted tables over: the live
// feed, the downloaded dogs and their indoor holds, the history and activity
// caches. TrackerApp mounts again on the page the user was on (`resume`).
function TrackerRoot() {
  // Deciding what opens first starts now: D0 waits for it (hideSplash.js).
  useState(holdSplash);
  const [session, setSession] = useState({ generation: 0, resume: null });
  return (
    <TrackerApp
      key={session.generation}
      resume={session.resume}
      onRestart={resume =>
        setSession(current => ({ generation: current.generation + 1, resume }))
      }
    />
  );
}

function TrackerApp({ resume = null, onRestart }) {
  const { isDark } = useTheme();
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const auth = useAuth();
  const tracking = useTrackingSession();
  // An upload or download refused for the sign-in (401) asks AuthProvider
  // whether it ended (判定表「使用中登入失效」).
  const cloudSync = useCloudSync(
    tracking.cloudDatabase,
    tracking.ready.real,
    undefined,
    auth.reportAuthFailure,
    auth.isDiscarded,
  );
  const upload = useCloudUpload(
    tracking.ready.real,
    cloudSync.ownerId,
    tracking.foreground,
    auth.reportAuthFailure,
  );
  const insets = useSafeAreaInsets();
  // The pages opened from the map, newest last; back (the key or 「‹ 標題」)
  // returns to the one before.
  const [stack, setStack] = useState(() => resume?.stack ?? [{ name: 'map' }]);
  const route = stack[stack.length - 1];
  // What the start opened on (Launch.launchScreen), once decided: { key:
  // 'live' or the fixture shown, screen }.
  const [launch, setLaunch] = useState({ key: null, screen: null });
  // D3 keeps its own back steps (a dialog, D3c → D3a, 取消): App's back key
  // asks it first.
  const pairBack = useRef(null);
  // The history screen's own back steps (range bar, panel at 75%).
  const historyBack = useRef(null);
  // Back on the map from D3 opened by A6: frame the new receiver's dogs.
  const [frameRequest, setFrameRequest] = useState(null);
  // The dog whose history 看軌跡 opened: back on the live map, its card opens
  // again (design: history from a dog's card returns to that card).
  const [cardHistory, setCardHistory] = useState(null);
  const [openDogRequest, setOpenDogRequest] = useState(null);
  const open = (name, extra = {}) =>
    setStack(current => [...current, { name, ...extra }]);
  const goBack = () => {
    // Leaving the history: back to the card it was opened from. (A page an
    // alert opened over the history returns to it, card memory kept.)
    if (route.name === 'history') {
      if (cardHistory != null)
        setOpenDogRequest({ slaveId: cardHistory, key: Date.now() });
      setCardHistory(null);
    }
    setStack(current => (current.length > 1 ? current.slice(0, -1) : current));
  };
  // The stack as last rendered, for callbacks that run later (a card closing).
  const stackNow = useRef(stack);
  stackNow.current = stack;
  // The history screen's snapshot taker (MapScreen sets it while history shows).
  const historySnapshot = useRef(null);
  // The dog whose card an alert opened (until that card closes).
  const alertCardDog = useRef(null);
  // D3 連接接收器 from `entry` (Pairing.pairingFlow): S2 ('receiver', with
  // its mode), A6 ('map'), a mismatch dialog ('alert'; `view` 'manual' when
  // the receiver was typed in) or the guide ('onboarding').
  const openPairing = (entry, mode = 'first', view = 'scan') =>
    open('pair', { entry, mode, view, key: Date.now() });
  const isMap = route.name === 'map';
  const isHistory = route.name === 'history';
  // Both tabs draw on the same persistent map layer; only one of them is live.
  const showsMap = isMap || isHistory;
  // Each dog's face (dog_avatars); the default illustration until one is set.
  const dogAvatars = useDogAvatars(
    tracking.historyDatabase,
    tracking.ready.real,
  );
  const history = useMapHistory(
    tracking.historyDatabase,
    tracking.ready.real,
    tracking.foreground && isHistory,
    cloudSync.ownerId,
  );
  // The history's calendar asks the cloud which days hold a dog's rows and
  // downloads a day only the cloud holds (054b), through the same writer and
  // the same exclusive slot as the sync.
  const historyCloud = useHistoryCloudSource({
    database: tracking.cloudDatabase,
    sync: cloudSync,
    owner: cloudSync.ownerId,
  });
  // The first location question waits for the map itself: never under the
  // launch screen or over D1 (D2 asks for permissions in the guide, 053).
  const phone = usePhoneLocation(
    tracking.foreground,
    undefined,
    showsMap && launch.key !== null,
  );
  useDefaultLocationRecording(tracking.foreground, phone);
  // 「今天 x km」: today's recorded route of this phone, while the live map
  // is in front.
  const liveTodayRoute = useTodayRoute(
    tracking.historyDatabase,
    tracking.ready.real,
    tracking.foreground && (isMap || route.name === 'phone'),
  );
  // Cache eligibility is separate from polling visibility. Background/navigation
  // pauses reads; logout invalidates the account-bound cache.
  // Debug builds only: a named screen state (dogtracker://dev/fixture?name=…)
  // replaces the live map's inputs. Always null in release builds.
  const fixture = useScreenFixture();
  const cloudDogs = useCloudDogs(
    tracking.cloudDatabase,
    cloudSync.ownerId,
    tracking.ready.real,
    undefined,
    null,
    {
      active: tracking.foreground && !fixture,
      revision: cloudSync.revision,
    },
  );
  const fixtureEdits = useFixtureEdits(fixture);
  const permissions = usePhonePermissions(tracking.foreground);
  // The history page shows live data unless a history fixture (054a) is on.
  const historyFixture = !!fixture?.history;
  const mapInputs = applyScreenFixture(
    isHistory && !historyFixture ? null : fixture,
    {
      tracking,
      phone,
      cloudDogs,
      cloudSync,
      history,
      historyCloud,
      dogAvatars,
      todayRoute: liveTodayRoute,
      // The gear's red dot: the upload failing or the sign-in expired.
      cloudProblem: !!cloudSync.ownerId && !!upload.error,
      signInExpired: !!auth.expired,
      // The sign-in restore still waits for Supabase (S3 「暫時連不上…」).
      restoring: !!auth.restoring,
      permissions,
      upload,
      account: { signedIn: !!auth.user, email: auth.user?.email || '' },
    },
    fixtureEdits,
  );
  // ---- the receiver, for the map and the settings pages ------------------
  const settingsOpen = LIGHT_PAGES.has(route.name);
  const settingsClock = useMapClock(
    tracking.foreground && settingsOpen && !fixture,
  );
  // A fixture's fake clock, moved on by the alert preview (debug only).
  const [alertClockOffset, setAlertClockOffset] = useState(0);
  const [alertBackground, setAlertBackground] = useState(false);
  useEffect(() => {
    setAlertClockOffset(0);
    setAlertBackground(false);
  }, [fixture?.name]);
  const now = fixture ? fixture.now + alertClockOffset : settingsClock;
  // Read on every page while in front: the alerts judge 接收器斷線 there too
  // (the history map itself draws no receiver: MapScreen gets null).
  const receiverState = useReceiverState(
    tracking.foreground,
    fixture?.readReceiverState,
  );
  const receiverWait = useRef(null);
  receiverWait.current = trackReceiverWait(
    receiverWait.current,
    receiverState,
    fixture ? fixture.now : Date.now(),
  );
  // A receiver set up in D3 that turns out to be another Master: 重新掃描 /
  // 重新搜尋 opens D3 again over the page the user is on.
  const receiverControl = useReceiverControl({
    receiverState,
    onRescan: method =>
      openPairing('alert', 'first', method === 'manual' ? 'manual' : 'scan'),
  });
  // The receiver's background work (it was the old scan page's): restoring
  // the service, the JS-side packets, the native storage error.
  const receiverService = useReceiverService({
    dogDatabase: tracking.hardwareDatabase,
    enabled: tracking.ready.real,
    onStorageError: tracking.reportNativeWriteError,
  });
  // A top card's button (A2/A6): where it takes the user. Back returns to the map.
  const alertAction = id => {
    if (id === 'receiver-settings') open('receiver');
    else if (id === 'connect-receiver') openPairing('map');
    // 診斷 (S8) starts with the reason.
    else if (id === 'storage-reason') open('diagnostics');
    // A6 「登入 Supabase」: D1, back on the map afterwards.
    else if (id === 'sign-in') open('signIn', { entry: 'map' });
    else if (id === 'storage-settings') {
      Linking.sendIntent('android.settings.INTERNAL_STORAGE_SETTINGS').catch(
        () => Linking.openSettings(),
      );
    }
  };
  // A settings fixture opens its page (settings-*, receiver-*, phone-*).
  const fixturePage = fixture?.openRoute ?? null;
  const fixtureName = fixture?.name ?? null;
  useEffect(() => {
    if (!fixturePage) return;
    setStack(stackTo(fixturePage));
  }, [fixtureName, fixturePage]);

  // ---- the start (D0): what opens first ----------------------------------
  // Decided once, under the launch screen: the map, D1 (first launch, or the
  // restore found the sign-in refused) or 「手機裡的資料打不開」. A fixture
  // with a `launch` shows its own start.
  const preferences = tracking.preferences;
  const liveLaunch = {
    databaseReady: tracking.ready.real,
    databaseError: tracking.errors.real,
    preferencesSettled: preferences.ready || !!preferences.error,
    onboarding: preferences.ready
      ? preferences.value.onboarding
      : ONBOARDING_DONE,
    authSettled: !auth.loading,
    signedIn: !!auth.user,
    expiredAtStart: !!auth.expiredAtStart,
  };
  const launchInput = fixture?.launch ?? liveLaunch;
  const decided = launchScreen(launchInput);
  const launchKey = fixture?.launch ? fixtureName : 'live';
  useEffect(() => {
    if (decided === 'splash' || launch.key === launchKey) return;
    // A fixture's start left for another state: back on the map.
    const leaving = launch.key !== null && launchKey === 'live';
    setLaunch({ key: launchKey, screen: decided });
    // (A fixture opening a settings page has set its own stack.)
    if (leaving && fixturePage) return;
    if (decided === 'failed') setStack([{ name: 'startFailed' }]);
    else if (decided === 'expired') setStack(signInStack(decided));
    // The guide continues at its saved step (D1, D2 or D3).
    else if (decided === 'onboarding') {
      setStack(
        guideStack(launchInput.onboarding, {
          signedIn: !!launchInput.signedIn,
        }),
      );
    } else if ((fixture?.launch || leaving) && !fixturePage)
      setStack([{ name: 'map' }]);
    if (leaving) return;
    if (launchKey !== 'live') {
      // A fixture opened at a cold start lets the launch screen go too (its
      // D1 and failure screen by their own onLayout).
      if (decided === 'map') launchInto(fixturePage ? 'page' : 'map');
      return;
    }
    // The map lets the launch screen go after its first framing; D1 and the
    // failure screen once they are laid out (onLayout below).
    if (decided === 'map') {
      launchInto('map');
      // Signed in from before the guide existed (an update): it is passed.
      if (liveLaunch.onboarding === ONBOARDING_SIGN_IN) {
        Promise.resolve(
          tracking.saveTrackingPreferences?.({ onboarding: ONBOARDING_DONE }),
        ).catch(() => {});
      }
    }
    // liveLaunch and fixture are read at the moment of the decision only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decided, launchKey, launch.key]);

  // ---- a notification tapped (058b) --------------------------------------
  // The merged alert's body opens its most severe problem, 「打開地圖」 the
  // live map; the 「常駐」 notifications their page (AlertNotifications
  // .notificationDestination). At a cold start it waits for the map; the
  // first-launch guide is not interrupted. Back from a page returns to the
  // map, as from a top card.
  const [notificationRequest, setNotificationRequest] = useState(null);
  useEffect(() => {
    const take = url => {
      const destination = notificationDestination(url);
      if (destination) setNotificationRequest({ ...destination, key: Date.now() });
    };
    let alive = true;
    Promise.resolve()
      .then(() => Linking.getInitialURL())
      .then(url => alive && take(url))
      .catch(() => {});
    const subscription = Linking.addEventListener?.('url', event => take(event?.url));
    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);
  // What the live map is asked to open (MapScreen waits until the dog is
  // there): a dog's card, 「打開地圖」's framing, my route.
  const [mapRequest, setMapRequest] = useState(null);
  // An alert's target (a notification, an N3 card, 「⚠ N」; ReturnSnapshot):
  // from the history or a settings page it opens over a snapshot of that
  // page, which back returns to; elsewhere on the live map.
  const openAlert = (target, key = Date.now()) => {
    if (!target) return;
    if (target.screen === 'system-storage') {
      Linking.sendIntent('android.settings.INTERNAL_STORAGE_SETTINGS').catch(
        () => Linking.openSettings(),
      );
      return;
    }
    const current = stackNow.current;
    const top = current[current.length - 1];
    const result = openAlertTarget(current, target, {
      snapshot: top?.name === 'history' ? historySnapshot.current?.() ?? null : null,
      settingsPages: LIGHT_PAGES,
      key,
    });
    // Leaving every page for the live map forgets the card history came from.
    if (result.stack.length === 1) setCardHistory(null);
    setStack(result.stack);
    if (result.dogId != null) {
      // Its 看軌跡 is a new errand: back from that history goes to the live
      // map, not to the card (also when opened on the live map itself).
      alertCardDog.current = result.dogId;
      setMapRequest({ screen: 'map', dogId: result.dogId, key });
    }
  };
  const appliedNotification = useRef(null);
  useEffect(() => {
    const request = notificationRequest;
    if (!request || launch.screen !== 'map') return;
    if (appliedNotification.current === request.key) return;
    appliedNotification.current = request.key;
    // 「打開地圖」 and the 「常駐」 notification's my route: the live map.
    if (request.screen === 'open-map' || request.screen === 'my-route') {
      setCardHistory(null);
      setStack([{ name: 'map' }]);
      setMapRequest(request);
      return;
    }
    openAlert(
      request.screen === 'map' ? { screen: 'map', dogId: request.dogId } : { screen: request.screen },
      request.key,
    );
    // openAlert reads the stack as rendered (stackNow).
  }, [notificationRequest, launch.screen]);
  // The guide's step, saved as it moves forward (a fixture's in memory only).
  const saveGuideStep = step => {
    Promise.resolve(
      mapInputs.tracking.saveTrackingPreferences?.({ onboarding: step }),
    ).catch(() => {});
  };
  // D1's ways out (判定表「D1 的四種入口」): 'done', 'later', 'back'.
  const leaveSignInPage = how => {
    const result = leaveSignIn(route.entry, how);
    if (result.exit) {
      BackHandler.exitApp();
      return;
    }
    if (result.next) {
      saveGuideStep(result.next);
      // Signed in, D1 has nothing left to show: back from D2 does not
      // return to it (it leaves the app, as on D1).
      if (how === 'done')
        setStack(current => [
          ...current.slice(0, -1),
          { name: 'permissions', entry: 'onboarding' },
        ]);
      else open('permissions', { entry: 'onboarding' });
      return;
    }
    if (route.entry === 'expired') setLaunch(current => ({ ...current, screen: 'map' }));
    goBack();
  };
  // The guide ends on the map (D3 「稍後再說」, D4 「開始使用」); A6 shows when
  // there is no dog data.
  const finishGuide = () => {
    saveGuideStep(ONBOARDING_DONE);
    setLaunch(current => ({ ...current, screen: 'map' }));
    setStack([{ name: 'map' }]);
  };
  // Back in the guide: the step before (saved, so a restart continues there),
  // or out of the app from its first page.
  const guideBack = () => {
    if (stack.length <= 2) {
      BackHandler.exitApp();
      return;
    }
    const before = stack[stack.length - 2];
    const step = GUIDE_STEP_OF[before.name];
    if (step && !fixture) saveGuideStep(step);
    goBack();
  };
  // D2 → D3 (下一步 and 稍後再說 alike). The map does not ask for location by
  // itself afterwards: D2 asked, or the user chose to leave it (S4 has it).
  const permissionsNext = () => {
    if (route.entry === 'onboarding' && !fixture) {
      saveGuideStep(ONBOARDING_RECEIVER);
      Promise.resolve(
        NativeTrackingPlatform?.claimLocationPermissionPrompt?.(),
      ).catch(() => {});
    }
    openPairing(route.entry === 'onboarding' ? 'onboarding' : 'receiver');
  };
  // D3 set up a receiver (or 下一步 back on D3): D4 in the guide, otherwise
  // back where D3 was opened. Its first packet is still watched for another
  // Master (a first set up, or a change taken before its first packet).
  const pairConnected = ({ number, method, previous, kept, again }) => {
    const flow = pairingFlow(route.entry, route.mode);
    if (!again && number != null && !fixture && (!flow.waitForData || kept)) {
      receiverControl.watchSwitch(number, {
        previous: kept ? previous : null,
        session: null,
        method,
      });
    }
    if (flow.guide) {
      saveGuideStep(ONBOARDING_PAIRED);
      open('paired', { entry: 'onboarding' });
      return;
    }
    if (route.entry === 'map')
      setFrameRequest({ key: Date.now(), receiverId: number });
    goBack();
  };
  // Out of D3 without a new receiver: 稍後再說 ends the guide; otherwise back
  // where it was opened (the guide's back goes to D2).
  const pairLeave = how => {
    if (route.entry === 'onboarding') {
      if (how === 'later') finishGuide();
      else guideBack();
      return;
    }
    goBack();
  };
  // 「重試」 on the failure screen opens the database again (a fixture's keeps
  // failing, as it would).
  const retryStart = () => {
    if (!fixture) onRestart?.({ stack: [{ name: 'map' }] });
  };
  const startFailure = launchInput.databaseError || '';
  // ---- what the settings pages say ---------------------------------------
  const recordingSwitch = useRecordingSwitch(
    tracking.foreground && route.name === 'phone' && !fixture,
  );
  // S6's switches, saved with the tracking preferences (a fixture's only in
  // memory). The alert engine below reads the same AlertPreferences.
  const alertPreferences = useAlertPreferences(
    mapInputs.tracking?.preferences?.value?.alerts,
    mapInputs.tracking.saveTrackingPreferences,
    fixtureName ?? 'live',
  );

  // ---- the alerts (058a) ---------------------------------------------------
  // MapScreen hands over its merged dogs (onAlertInput); the engine judges
  // them with the receiver, the storage and the cloud clock every few
  // seconds while the app is in front, vibrates, and keeps the merged
  // notification's content (sent by 058b's native module). A fixture runs
  // its own engine on its fake clock (the preview moves it on), never saving.
  const alertInput = useRef(null);
  const onAlertInput = useCallback(input => {
    alertInput.current = input;
  }, []);
  // The live alert state is kept natively, shared with the receiver's
  // background check (058b); read again whenever that moved it on.
  const nativeAlertState = useNativeAlertState(tracking.foreground && !fixture);
  const alertSource = fixture
    ? fixtureName
    : preferences.ready && nativeAlertState.ready
    ? `live#${nativeAlertState.revision}`
    : 'live-loading';
  const alertPause = fixture?.alertPause ?? null;
  // Where the alerts are judged from: N3 slides down over the history and
  // the settings pages only (AlertScheduler).
  const settingsPage = LIGHT_PAGES.has(route.name);
  const alertScreen = isMap
    ? 'map'
    : isHistory
    ? 'history'
    : settingsPage
    ? 'settings'
    : 'other';
  // A fixture opening on a page judges its first alerts there (its N3),
  // once it is open (later the user may go anywhere).
  // (Each opening of a fixture, also the same one again, waits anew.)
  const settledFixture = useRef(null);
  if (fixturePage && route.name === fixturePage)
    settledFixture.current = fixture;
  const fixtureSettled = !fixturePage || settledFixture.current === fixture;
  const alerts = useAlertEngine({
    running:
      tracking.foreground &&
      launch.key !== null &&
      fixtureSettled &&
      alertSource !== 'live-loading',
    source: alertSource,
    initial: fixture ? null : nativeAlertState.state,
    clock: () => (fixture ? now : Date.now()),
    readInput: () => {
      const input = alertInput.current;
      // Everything read first: a half-read start would clear problems and
      // alert them again.
      if (
        !input ||
        input.source !== (fixture ? fixtureName : 'live') ||
        !input.ready ||
        receiverState === undefined
      )
        return null;
      // What the background check needs once the app is off screen.
      if (!fixture) handOverAlerts(alertSnapshot(input.dogs, alertPreferences.value));
      return {
        dogs: input.dogs,
        receiverBattery: input.receiverBattery,
        receiver: receiverState,
        storageError: mapInputs.tracking.realWriteError,
        cloud: {
          lastDownloadAt: mapInputs.cloudSync?.lastDownloadAt ?? null,
          failingSince: mapInputs.cloudSync?.failingSince ?? null,
        },
        pauses: Array.isArray(receiverState?.receiverPauses)
          ? receiverState.receiverPauses
          : [],
      };
    },
    preferences: alertPreferences.value,
    notificationsAllowed: !mapInputs.permissions?.notificationsDenied,
    screen: alertScreen,
    foreground: tracking.foreground && !alertBackground,
    save: fixture
      ? null
      : value =>
          saveAlertState(value, nativeAlertState.revision).catch(() => false),
    // alerts-paused: paused `since` before the fixture's now, until `until`.
    setup: alertPause
      ? (state, at) =>
          pauseAlertState(state, at - alertPause.since, at + alertPause.until)
      : null,
  });

  // ---- N3 and 「⚠ N」 off the live map (058c) ------------------------------
  // The card AlertScheduler handed over shows its 5 s (real time, also on a
  // fixture), then collapses into 「⚠ N」; a tap on either opens its problem
  // over a snapshot of this page (openAlert).
  const [alertNow, setAlertNow] = useState(Date.now);
  const n3 = alerts.card;
  useEffect(() => {
    setAlertNow(Date.now());
    if (!n3) return undefined;
    const left = n3.expiresAt - Date.now();
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setAlertNow(Date.now()), left + 20);
    return () => clearTimeout(timer);
  }, [n3]);
  const offMap = offMapAlerts({
    active: alerts.active,
    card: n3,
    now: Math.max(alertNow, n3 ? n3.deliveredAt : 0),
    screen: alertScreen,
  });
  // The card on screen, kept while it slides up into 「⚠ N」.
  const [n3Shown, setN3Shown] = useState(null);
  const n3Leaving = !!n3Shown && n3Shown.id !== offMap.card?.id;
  useEffect(() => {
    if (offMap.card) setN3Shown(offMap.card);
  }, [offMap.card]);
  const n3Gone = useCallback(
    id => setN3Shown(current => (current?.id === id ? null : current)),
    [],
  );
  const [n3Height, setN3Height] = useState(0);
  // History: 8dp under the top capsule row; a settings page: 8dp under its
  // title row (N3 提醒卡的位置).
  const n3Top = insets.top + layout.belowStatusBar + sizes.floatingButton + space.s;
  const pressN3 = card => {
    setN3Shown(null);
    openAlert(card.target);
  };
  const pressAlertBadge = badge => openAlert(badge.target);
  // A card an alert opened, closed (back, swiped down, the empty map): back
  // to the page under it (ReturnSnapshot.closeAlertCard).
  const alertCardOpen = useRef(null);
  const cardChanged = useCallback(opened => {
    const current = stackNow.current;
    const top = current[current.length - 1];
    const fromAlert = isAlertReturn(top) && top.name === 'map';
    if (opened) {
      alertCardOpen.current = fromAlert ? top.key : null;
      return;
    }
    // Closed (or gone with the map, e.g. a page opened over it): no card's
    // back step is left; only a close on the alert's own map returns.
    const wasOpen = alertCardOpen.current;
    alertCardOpen.current = null;
    alertCardDog.current = null;
    if (fromAlert && wasOpen === top.key) setStack(closeAlertCard(current));
  }, []);

  // The preview's 「+N 分」 is judged at once.
  const tickAlerts = alerts.tick;
  useEffect(() => {
    if (alertClockOffset) tickAlerts();
  }, [alertClockOffset, tickAlerts]);

  const settingsData = settingsInput(mapInputs, {
    now,
    receiverState,
    receiverWait: receiverWait.current,
    recording: recordingSwitch,
    alertPause: alerts.pause,
  });

  // ---- S7 進階, S8 診斷 -----------------------------------------------------
  // A fixture's rows, Wi-Fi and deletion stand in for the real ones; nothing
  // it shows reads or writes this phone's data.
  const sources = fixture?.diagnostics ?? null;
  const listRecent =
    sources?.listHistory ?? tracking.hardwareDatabase.listHistory;
  const wifi = useReceiverWifi(fixture?.wifiService ?? sharedBleService, {
    active:
      tracking.foreground &&
      (route.name === 'advanced' || route.name === 'wifi'),
    connected: !!receiverState?.connected,
  });
  const receiverName =
    receiverNumber(receiverState) != null
      ? `接收器 ${receiverNumber(receiverState)}`
      : '接收器';
  // When the last deletion went through (「已刪除・10:21」 on S7).
  const [deletedAt, setDeletedAt] = useState(resume?.deletedAt ?? null);
  useEffect(() => {
    setDeletedAt(resume?.deletedAt ?? null);
  }, [fixtureName, resume]);
  const deletion = useDeleteDogData(
    fixture
      ? {
          countUnsent: async () => fixture.deletion.unsent,
          // A fixture has no network to upload on (判定表「先上傳」但沒網路).
          uploadAll: async () => 'offline',
          deleteAll: async () => {},
          onDeleted: () => setDeletedAt(fixture.now),
        }
      : {
          countUnsent: tracking.countUnsentUploads,
          uploadAll: alive =>
            upload.flushAll?.(alive) ?? Promise.resolve('failed'),
          deleteAll: options => tracking.deleteDogData(options),
          onDeleted: async () => {
            // A6 comes back after 刪除全部狗資料 (判定表「A6 的 ✕ 什麼時候重來」).
            await Promise.resolve(
              tracking.saveTrackingPreferences?.({
                noDataCardDismissed: false,
              }),
            ).catch(() => {});
            onRestart?.({ stack, deletedAt: Date.now() });
          },
        },
    fixture?.deletion?.open ? { unsent: fixture.deletion.unsent } : null,
    fixtureName,
  );
  const recentRows = useRecentRows(
    listRecent,
    tracking.foreground && route.name === 'diagnostics',
  );

  // Background work that keeps going when the map is left (返回鍵 on the
  // map): this phone uploads for a receiver and still has rows waiting.
  const uploading =
    (upload.settings || []).some(setting => setting.mode === 'phone') &&
    (upload.counts || []).some(
      row => row.status === 'pending' && Number(row.count) > 0,
    );

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        // The live map an alert opened over a kept page: its card's own back
        // steps first (A4, A5, closing the card returns via cardChanged);
        // without a card, back to that page.
        if (route.name === 'map' && isAlertReturn(route)) {
          if (alertCardOpen.current === route.key) return false;
          setStack(current => closeAlertCard(current));
          return true;
        }
        if (route.name === 'map') handleRootBack({ uploading });
        else if (route.name === 'signIn') leaveSignInPage('back');
        // D3's own steps first (a dialog, D3c, a connection), then out.
        else if (route.name === 'pair') pairBack.current?.();
        // The history's own layers first (the range bar, the panel at 75%).
        else if (route.name === 'history' && historyBack.current?.())
          return true;
        else if (route.entry === 'onboarding') guideBack();
        // Nothing under the failure screen: back leaves the app.
        else if (route.name === 'startFailed') BackHandler.exitApp();
        else goBack();
        return true;
      },
    );
    return () => subscription.remove();
    // goBack reads route and cardHistory, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, cardHistory, uploading, stack.length]);

  let page = null;
  switch (route.name) {
    case 'signIn':
      // D1, from any of its four entries (Launch.signInStack).
      page = (
        <LoginScreen
          key={`${route.entry}-${fixtureName ?? 'live'}`}
          step={route.entry === 'onboarding' ? 1 : null}
          expired={
            route.entry === 'expired' ||
            (route.entry === 'cloud' && !!mapInputs.signInExpired)
          }
          onDone={() => leaveSignInPage('done')}
          onLater={() => leaveSignInPage('later')}
          onLayout={() => launchInto('page')}
        />
      );
      break;
    case 'permissions':
      // D2, in the guide (step 2 of 4).
      page = (
        <PermissionsRoute
          key={fixtureName ?? 'live'}
          tracking={mapInputs.tracking}
          fixture={fixture}
          step={route.entry === 'onboarding' ? 2 : null}
          onNext={permissionsNext}
          onLayout={() => launchInto('page')}
        />
      );
      break;
    case 'pair':
      // D3, from the guide, S2, A6 or a mismatch dialog (Pairing.pairingFlow).
      page = (
        <PairRoute
          key={`${route.key ?? 'guide'}-${fixtureName ?? 'live'}`}
          route={route}
          tracking={mapInputs.tracking}
          receiverState={receiverState}
          service={receiverService}
          restore={receiverControl.restore}
          locationServices={mapInputs.phone?.services}
          fixture={fixture}
          backRef={pairBack}
          onConnected={pairConnected}
          onLeave={pairLeave}
          onLayout={() => launchInto('page')}
        />
      );
      break;
    case 'paired':
      // D4 / D4b: what this receiver has sent so far.
      page = (
        <PairedScreen
          page={pairedPage(
            receiverNumber(receiverState),
            mapInputs.cloudDogs?.packets,
          )}
          step={route.entry === 'onboarding' ? 4 : null}
          onStart={finishGuide}
          onLayout={() => launchInto('page')}
        />
      );
      break;
    case 'startFailed':
      page = (
        <StartFailedScreen
          onRetry={retryStart}
          onDiagnostics={() => open('diagnostics')}
          onLayout={() => launchInto('page')}
        />
      );
      break;
    case 'locationRecords':
      page = (
        <LocationTrackerScreen
          key={fixtureName ?? 'live'}
          foreground={tracking.foreground}
          readPage={sources?.readLocationPage}
        />
      );
      break;
    case 'cloud':
      // S3: signed out it is the sign-in form (「稍後再說」 goes back). A
      // fixture's page writes nothing and signs nobody out.
      page = (
        <AccountSettings
          page={accountPage(settingsData)}
          onSignIn={() => open('signIn', { entry: 'cloud' })}
          dialog={fixture?.dialog ?? null}
          onSignOut={
            fixture
              ? async () => {}
              : async () => {
                  await auth.signOut();
                  // A6 comes back after signing out (判定表「A6 的 ✕ 什麼時候重來」).
                  tracking
                    .saveTrackingPreferences?.({ noDataCardDismissed: false })
                    ?.catch?.(() => {});
                }
          }
          onRetryDownload={fixture ? () => {} : () => cloudSync.retry?.()}
          onRetryUpload={() => mapInputs.upload?.retry?.()?.catch?.(() => {})}
          onSwitch={(master, mode) => mapInputs.upload.switchMode(master, mode)}
        />
      );
      break;
    case 'cloudData':
      page = sources ? (
        <CloudDataScreen
          key={fixtureName}
          database={sources.cloudDatabase}
          sync={mapInputs.cloudSync}
          phoneId="fixture-phone"
          clientFactory={sources.cloudClient}
        />
      ) : (
        <CloudDataScreen
          key="live"
          database={tracking.cloudDatabase}
          sync={cloudSync}
          phoneId={upload.phoneId}
        />
      );
      break;
    case 'liveData':
      page = (
        <LiveDataSettings
          key={fixtureName ?? 'live'}
          dogDatabase={
            sources
              ? { listHistory: sources.listHistory }
              : tracking.hardwareDatabase
          }
        />
      );
      break;
    case 'wifi':
      page = (
        <WifiSettings
          key={fixtureName ?? 'live'}
          wifi={wifi}
          receiver={receiverName}
        />
      );
      break;
    case 'settings': {
      const home = settingsHome(settingsData);
      page = (
        <SettingsHome
          key={fixtureName ?? 'live'}
          home={home}
          onEnableDiagnostics={() => mapInputs.tracking.saveTrackingPreferences({ diagnosticsEnabled: true })}
          version={appVersion}
          onOpen={id => open(SETTINGS_ROUTES[id])}
          onStorage={() =>
            alertAction(
              home.storage?.full ? 'storage-settings' : 'storage-reason',
            )
          }
        />
      );
      break;
    }
    case 'receiver':
      page = (
        <ReceiverSettings
          page={receiverPage(settingsData)}
          onDisconnect={receiverControl.disconnect}
          onReconnect={receiverControl.reconnect}
          onRescan={() => {
            receiverControl.disconnect();
            openPairing('receiver', 'rescan');
          }}
          onChange={() => openPairing('receiver', 'change')}
          onConnect={() => openPairing('receiver')}
        />
      );
      break;
    case 'alerts':
      // 「開系統設定 ›」 opens this app's notification settings.
      page = (
        <AlertSettings
          key={fixtureName ?? 'live'}
          page={alertsPage(
            alertPreferences.value,
            settingsData.permissions,
            alerts.pause,
            now,
          )}
          onChange={alertPreferences.change}
          onNotificationSettings={openNotificationSettings}
          onResume={alerts.resume}
          initiallyOpen={!!fixture?.alertsOpen}
        />
      );
      break;
    case 'phone':
      page = (
        <PhoneSettings
          page={phonePage(settingsData)}
          onRecording={on => settingsData.recording.toggle?.(on)}
          onPermissions={() => Linking.openSettings()}
          onLocationServices={openLocationServices}
          onBattery={openBatterySettings}
        />
      );
      break;
    case 'diagnostics':
      page = (
        <DiagnosticsSettings
          // Opened from D0's failure screen without the flag: no 隱藏診斷
          // (design 判定表「診斷的入口」); with it, hiding returns to D0.
          canHide={settingsData.diagnosticsEnabled}
          onHide={async () => {
            const saved = await mapInputs.tracking.saveTrackingPreferences({ diagnosticsEnabled: false });
            // Back to the screen S8 was opened from (S1 without its row,
            // the map from a storage card, or D0).
            if (saved || launch.screen === 'failed') goBack();
          }}
          page={diagnosticsPage({
            packets: mapInputs.cloudDogs?.packets,
            rows: sources ? fixture.raw.ble : recentRows,
            aliases: settingsData.aliases,
            // Opened from D0's failure screen: why the database cannot be opened.
            storage:
              launch.screen === 'failed' && startFailure
                ? {
                    heading: START_FAILED_TITLE,
                    reason: startFailure,
                    full: false,
                  }
                : settingsData.storage,
            now,
          })}
          onOpen={open}
        />
      );
      break;
    case 'alertPreview':
      // Debug builds only (a fixture's &page=alertPreview).
      page = __DEV__ ? (
        <AlertPreview
          alerts={alerts}
          now={fixture ? now : Date.now()}
          fake={!!fixture}
          background={alertBackground}
          onAdvance={ms => setAlertClockOffset(value => value + ms)}
          onBackground={setAlertBackground}
        />
      ) : null;
      break;
    case 'advanced':
      page = (
        <AdvancedSettings
          wifi={wifi}
          deletion={deletion}
          onWifi={() => open('wifi')}
          deletedText={deletedAt ? `已刪除・${formatClock(deletedAt)}` : null}
        />
      );
      break;
    default:
      break;
  }
  const light = LIGHT_PAGES.has(route.name);
  const full = FULL_PAGES.has(route.name);

  return (
    // Addresses (053a): the card and the history list share one lookup and
    // its cache; a fixture brings its own.
    <AddressLookupContext.Provider
      value={mapInputs.addressLookup ?? addressLookup}
    >
      <SafeAreaView
        style={[styles.safeArea, (light || full) && styles.page]}
        edges={showsMap ? [] : ['top', 'bottom', 'left', 'right']}
      >
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={light || full ? colors.surface : undefined}
        />
        {light && (
          // No bottom tabs (v3): every settings page says where it is and
          // goes back the way the back key does (「‹ 標題」).
          <View style={styles.header}>
            <Pressable
              testID="page-back"
              accessibilityRole="button"
              accessibilityLabel={`返回，${pageTitle(route)}`}
              onPress={goBack}
              hitSlop={space.s}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <Text style={styles.brand}>{`‹ ${pageTitle(route)}`}</Text>
            </Pressable>
            {/* 「⚠ N」 on the right of the title row (歷史、設定的紅色「⚠ N」). */}
            <AlertBadge
              badge={offMap.badge}
              onPress={pressAlertBadge}
              style={styles.headerBadge}
            />
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
            historyCloud={mapInputs.historyCloud}
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
            fixture={isHistory && !historyFixture ? null : fixture}
            todayRoute={mapInputs.todayRoute}
            onOpenSettings={() => open('settings')}
            // Restoring a saved sign-in counts: A6 offers no 「登入 Supabase」.
            signedIn={!!mapInputs.cloudSync.ownerId || !!mapInputs.restoring}
            cloudProblem={mapInputs.cloudProblem}
            signInExpired={mapInputs.signInExpired}
            notificationsDenied={mapInputs.permissions.notificationsDenied}
            nearbyDenied={mapInputs.permissions.nearbyDenied}
            receiver={{
              state: isHistory ? null : receiverState,
              wait: receiverWait.current,
            }}
            onAlertAction={alertAction}
            onAlertInput={onAlertInput}
            openDogRequest={openDogRequest}
            frameRequest={frameRequest}
            notificationRequest={launch.screen === 'map' ? mapRequest : null}
            onCardChange={cardChanged}
            onOpenHistory={slaveId => {
              // From a card an alert opened: a new errand, the snapshot
              // dropped (ReturnSnapshot.openTrackFrom).
              const next = openTrackFrom(stackNow.current, slaveId == null
                ? { subject: 'phone', slaveId: null }
                : { subject: 'dog', slaveId });
              setCardHistory(
                next.fromCard && slaveId !== alertCardDog.current ? slaveId : null,
              );
              setStack(next.stack);
            }}
            // A fixture's history page (no route target): whom its query is about.
            historyTarget={
              isHistory
                ? route.target ??
                  historyTargetOf(mapInputs.history?.preferences)
                : null
            }
            onLeaveHistory={goBack}
            historyBack={historyBack}
            historyRestore={isHistory ? route.restore ?? null : null}
            historySnapshot={historySnapshot}
            alertBadge={isHistory ? { badge: offMap.badge, onPress: pressAlertBadge } : null}
            n3Bottom={isHistory && offMap.card ? n3Top + n3Height : 0}
          />
        </View>
        {/* The map's surface shows through anything transparent above it, even
                hidden (opacity 0): off the map, an opaque cover in the page colour
                keeps it out of the status bar and navigation bar insets. */}
        {!showsMap && (
          <View
            testID="map-cover"
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.mapCover,
              (light || full) && styles.page,
            ]}
          />
        )}
        {(light || full) && (
          <View style={styles.page}>
            {page}
            {light && n3Shown && (
              <N3Card
                value={n3Shown}
                leaving={n3Leaving}
                top={layout.belowStatusBar}
                onPress={pressN3}
                onGone={n3Gone}
              />
            )}
          </View>
        )}
        {isHistory && n3Shown && (
          <N3Card
            value={n3Shown}
            leaving={n3Leaving}
            top={n3Top}
            onPress={pressN3}
            onGone={n3Gone}
            onHeight={setN3Height}
          />
        )}
      </SafeAreaView>
    </AddressLookupContext.Provider>
  );
}

// D2, asking for real (or drawing a fixture's rows).
function PermissionsRoute({ tracking, fixture, step, onNext, onLayout }) {
  const prefs = tracking.preferences?.value || {};
  const guide = usePermissionsGuide({
    asked: prefs.askedPermissions || [],
    fixture: fixture?.permissionsGuide ?? null,
    onAsked: list =>
      tracking.saveTrackingPreferences?.({ askedPermissions: list }),
  });
  return (
    <PermissionsScreen
      page={guide}
      step={step}
      onNext={onNext}
      onSystemSettings={() => Linking.openSettings()}
      onLayout={onLayout}
    />
  );
}

// D3 for one opening (route.key): usePairing with this app's receiver.
function PairRoute({
  route,
  tracking,
  receiverState,
  service,
  restore,
  locationServices,
  fixture,
  backRef,
  onConnected,
  onLeave,
  onLayout,
}) {
  const flow = pairingFlow(route.entry, route.mode);
  const prefs = tracking.preferences?.value || {};
  const pairing = usePairing({
    flow,
    receiverState,
    service,
    restore,
    asked: prefs.askedPermissions || [],
    onAsked: list =>
      tracking.saveTrackingPreferences?.({ askedPermissions: list }),
    locationServices,
    fixture: fixture?.pairing ?? null,
    initialView: route.view || 'scan',
    onConnected,
    onLeave,
  });
  backRef.current = pairing.back;
  return (
    <PairingScreen
      pairing={pairing}
      step={flow.guide ? 3 : null}
      camera={!fixture}
      onLayout={onLayout}
    />
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // No dark slab anywhere (v3): the old dark pages' navy is gone.
    safeArea: {
      flex: 1,
      backgroundColor: theme.isDark ? colors.bg : colors.surface,
    },
    mapLayer: { backgroundColor: theme.isDark ? colors.bg : colors.surface },
    hiddenMapLayer: { opacity: 0, zIndex: -1 },
    // Above the (hidden) map, below the page: the page colour edge to edge,
    // status bar and navigation bar insets included.
    mapCover: {
      backgroundColor: theme.isDark ? colors.bg : colors.surface,
    },
    // The settings pages: a 56dp header 「‹ 標題」 over the page colour.
    header: {
      // Above the page-colour map cover (drawn after it in the tree).
      zIndex: 1,
      backgroundColor: theme.isDark ? colors.bg : colors.surface,
      minHeight: touch.subpageHeader,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.s,
      paddingVertical: space.xs,
    },
    back: {
      minHeight: touch.min,
      justifyContent: 'center',
      paddingHorizontal: space.s,
      alignSelf: 'flex-start',
    },
    pressed: { opacity: 0.7 },
    headerBadge: { marginRight: space.s },
    brand: { ...type.title, color: colors.text },
    page: {
      flex: 1,
      backgroundColor: theme.isDark ? colors.bg : colors.surface,
    },
  });
});

import { createAtomicDogCardReader } from '../map/AtomicDogCardReader';
import { createAtomicDogSnapshot } from '../map/AtomicDogSnapshot';
import { combinedResumeCatchUp } from '../tracking/ResumeCatchUp';
import { t } from '../i18n';
import { dismissWaitingSources, waitingSourcesCount, waitingSourcesState } from '../map/WaitingSources';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HistoryScreen from '../mapHistory/HistoryScreen';
import { historyPanelMinHeight } from '../map/MapPanelHeight';
import { useHistoryScreen } from '../mapHistory/useHistoryScreen';
import { nativeExporter } from '../mapHistory/ExportNative';
import { faceMarkers as historyFaces } from '../history/screen/HistoryMultiModel';
import { useLiveLocation } from '../locationTracker/useLiveLocation';
import { splashChrome, useSplashState } from '../app/hideSplash';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackingMap from '../map/TrackingMap';
import {
  createTrackingMapPresentation,
  outOfRangeLines,
  receiverRangeRing,
} from '../map/TrackingMapPresentation';
import { mergeDogMarkers, LIVE_PACKET_WINDOW_MS } from '../map/DogMerge';
import { cameraCoordinates } from '../map/TrackingGeometry';
import { createRideDetector } from '../placement/RideAlong';
import { useAddress } from '../placement/AddressLookup';
import { useMapClock } from '../map/useMapClock';

import { useReceiverState } from '../map/useReceiverState';
import {
  isOtherReceiver,
  receiverLink,
  receiverNumber,
} from '../map/ReceiverState';
import { dogMarkers, dogName } from '../map/DogMarkers';
import { coldStartCoordinates, phoneFix, PHONE_FIX_MAX_AGE_S } from '../map/MapFraming';
import DogCard from '../map/DogCard';
import ActivityScreen from '../activity/ActivityScreen';
import DogProfile from '../dogs/DogProfile';
import { displayName } from '../dogs/DogName';
import { dogCard, nativePhoneReading, phoneReading } from '../map/DogCardModel';
import { useDogCardReadings } from '../map/useDogCardReadings';
import {
  cloudClock,
  dogFreshness,
  isIndoorHold,
} from '../tracking/DogFreshness';
import { layout, space, radius, size as sizes, type } from '../theme/tokens';
import { CatchUpPill, SettingsGear } from '../map/MapControls';
import TopAlertCards from '../map/TopAlertCards';
import {
  gearLabel,
  gearReasons,
  receiverOutage,
  showsNoDogs,
  storageProblem,
  topCards,
  trackReceiverWait,
} from '../map/TopAlerts';
import { startOfToday, todayPill } from '../tracking/TodayDistance';
import { behindSheet } from '../utils/a11yFocus';

// How long the first framing waits for the phone's first position report
// before framing without it (the launch screen is still up meanwhile).
export const PHONE_WAIT_MS = 1500;
// With no local dog to frame the phone is all the cold start frames (設計稿
// 「冷啟動」: 都還沒定位就只框手機), and the launch screen stays until the map is
// framed (「啟動畫面 → 地圖」): so it waits this long for the phone's first fix
// instead (the native side lets go at 10 s whatever happens).
export const PHONE_ALONE_WAIT_MS = 6000;

export default function MapScreen({
  tracking,
  phone,
  bottomInset,
  mapProvider,
  active = true,
  history,
  historical = false,
  cloudDogs: incomingCloudDogs,
  cloudOwner,
  // The live cloud sync (useCloudSync): when the last download succeeded and
  // since when it has been failing, for judging cloud dogs' freshness.
  cloudSync = null,
  // { avatars } from useDogAvatars: each dog's face by collar number.
  dogAvatars = null,
  // The history's cloud days and downloads (054b; HistoryCloud's
  // useHistoryCloudSource, or a fixture's): { cloud, online }.
  historyCloud = null,
  // Debug builds only (src/dev/ScreenFixtures.js): the clock, the phone's live
  // position and the receiver reader of a named screen state.
  fixture = null,
  // A dog's card opens or closes.
  onCardChange,
  // 看軌跡: the history query is saved; open the history page for slaveId.
  onOpenHistory,
  // { slaveId, key }: open this dog's card (back from its history).
  openDogRequest = null,
  // The history screen's subject ({ subject: 'dog', slaveId } or { subject:
  // 'phone' }), its ‹ 回到現在 (onLeaveHistory) and its back-key steps
  // (historyBack.current(): true when the screen used the key).
  historyTarget = null,
  onLeaveHistory,
  historyBack = null,
  // Alerts off the live map (058c): the history page's state kept under a
  // card or page an alert opened (`historyRestore`, its route's snapshot;
  // `historySnapshot.current()` takes one), 「⚠ N」 on the history's top row
  // ({ badge, onPress }) and the bottom of an N3 card over it (the compass
  // moves under it).
  historyRestore = null,
  historySnapshot = null,
  alertBadge = null,
  n3Bottom = 0,
  // Back from D3 opened by A6: frame that receiver's located dogs (once per key).
  frameRequest = null,
  // A notification tapped (058b, AlertNotifications.notificationDestination
  // with a key): 'map' with a dogId opens that dog's card (once the dog is
  // on the map), 'open-map' closes the card and frames everything, 'my-route'
  // opens today's route. App opens the settings pages itself.
  notificationRequest = null,
  // 「今天 x km」: today's recorded route of this phone ({ count, metres },
  // useTodayRoute), null until read.
  todayRoute = null,
  // The gear (A1 top right) opens settings.
  onOpenSettings,
  // Signed in to Supabase (A6 hides 「登入 Supabase」).
  signedIn = false,
  // The cloud upload failing (gear red dot); the download side is judged
  // from cloudSync.
  cloudProblem = false,
  // The Supabase sign-in expired while in use (gear red dot, 「需要重新登入」).
  signInExpired = false,
  // Android 13+ notification permission not given (gear red dot).
  notificationsDenied = false,
  // Android 12+ 附近的裝置 not given (gear red dot).
  nearbyDenied = false,
  // { state, wait }: the receiver's native state and how long it has waited
  // (TopAlerts.trackReceiverWait), read by App; omitted, the map reads them.
  receiver = null,
  // A top card's button that leaves the map: 'receiver-settings',
  // 'storage-settings', 'storage-reason', 'connect-receiver', 'sign-in'.
  onAlertAction,
  switchingReceiver = false,
  pausedReceiver = false,
  // The alerts' view of the dogs (058a, App's useAlertEngine): { source,
  // ready, dogs (named, with their range judgement), receiverBattery }.
  onAlertInput,
}) {
  let cloudDogs = incomingCloudDogs;
  const atomicDogs = useRef(null);
  if (!atomicDogs.current) atomicDogs.current = createAtomicDogSnapshot();
  const styles = useStyles(getStyles);
  const insets = useSafeAreaInsets();
  // The base map's state (GoogleTrackingMap): drives the 地圖載入失敗 card.
  const [mapState, setMapState] = useState('loading');
  const [mapRetry, setMapRetry] = useState(0);
  // Top cards closed with ✕ (TopAlerts): the disconnection by its start, the
  // storage problem until writing works again. A fixture can start with some.
  const [dismissed, setDismissed] = useState(() => fixture?.dismissed ?? {});
  const [noDogsClosed, setNoDogsClosed] = useState(false);
  const [topHeight, setTopHeight] = useState(0);
  const [noticeHeight, setNoticeHeight] = useState(0);
  // What is open: one dog's card on the live map, or a track's panel in
  // history. Both are answered by a tap on the marker.
  const [selected, setSelected] = useState(null);
  const card = useRef(null);
  // The card's height while it is up (the map buttons sit above it).
  const [cardHeight, setCardHeight] = useState(0);
  // Each opening of a card asks the map once to bring that dog into view.
  const [focusRequest, setFocusRequest] = useState(null);
  const [cardPage, setCardPage] = useState(null);
  const [heading, setHeading] = useState(0);
  // A card sliding away is replaced by a new one (a new key) when a dog is
  // tapped meanwhile, so the new card rises instead of finishing the close.
  // Bumped on every opening and closing, so a 看軌跡 save that finishes
  // after its card went away does not navigate.
  const cardGeneration = useRef(0);
  // The history's protagonist switch (set below, once the screen exists).
  const selectHistoryDog = useRef(null);
  const cardClosing = useRef(false);
  const [cardKey, setCardKey] = useState(0);
  const cardHeightChanged = useCallback(value => {
    if (!value) cardGeneration.current += 1;
    cardClosing.current = !value;
    setCardHeight(value);
  }, []);
  const openDog = useCallback(
    slaveId => {
      // In history a face is another dog shown: it becomes the protagonist.
      if (historical) {
        selectHistoryDog.current?.(slaveId);
        return;
      }
      cardGeneration.current += 1;
      if (cardClosing.current) {
        cardClosing.current = false;
        setCardKey(value => value + 1);
      }
      setSelected(current =>
        current?.kind === 'dog' && current.slaveId === slaveId
          ? current
          : { kind: 'dog', slaveId },
      );
      setCardPage(null);
      setFocusRequest({ slaveId, key: Date.now() });
    },
    [historical],
  );
  // Tapping empty map closes the card (sliding away), like swiping it down.
  const pressMap = useCallback(() => card.current?.close(), []);
  const { point, route, positionSamples, mode } = tracking;
  // Ageing is measured against this clock, not against the newest row: a silent
  // collar changes nothing else on this screen.
  const liveNow = useMapClock(active && tracking.foreground && !fixture);
  // A screen fixture stops the clock, so its screenshot is the same every time.
  const now = fixture ? fixture.now : liveNow;
  // The history list's clock: a fixture's fixed one, else the real one.
  const fixtureNow = fixture?.now ?? null;
  const fixtureClock = useCallback(
    () => fixtureNow ?? Date.now(),
    [fixtureNow],
  );
  // The receiver this phone is set up for, read from the native service while
  // the live map is in front (a fixture supplies its own reader).
  const receiverActive = active && tracking.foreground && !historical;
  // App reads it for the settings pages too and hands it in (`receiver`:
  // { state, wait }); on its own the map reads it itself.
  const ownReceiverState = useReceiverState(
    receiverActive && !receiver,
    fixture?.readReceiverState,
  );
  const receiverState = receiver
    ? receiverActive
      ? receiver.state
      : null
    : ownReceiverState;
  // The newest stored packet can be from a receiver used before this one.
  const otherReceiver = isOtherReceiver(point, receiverState);
  useEffect(() => {
    setSelected(null);
  }, [mode, point.masterId]);
  // A screen fixture can open one dog's card (card-* states).
  const fixtureDog = fixture?.openDog ?? null;
  const fixtureName = fixture?.name ?? null;
  const fixturePage = fixture?.openPage ?? null;
  const pendingPage = useRef(null);
  useEffect(() => {
    if (fixtureDog != null) {
      openDog(fixtureDog);
      // dog-edit opens the dog's page (A5) over its card, once the card is.
      pendingPage.current = fixturePage;
      if (fixturePage) setCardPage(fixturePage);
    } else {
      // A fixture without a card: no page of the previous one stays asked for.
      pendingPage.current = null;
      setCardPage(null);
      setSelected(null);
    }
  }, [fixtureName, fixtureDog, fixturePage, openDog]);
  useEffect(() => {
    if (openDogRequest?.slaveId != null) openDog(openDogRequest.slaveId);
    // A new request has a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDogRequest?.key]);
  const link = receiverLink(receiverState, now);
  // ---- top cards and the gear's red dot (A2/A2b/A2c/A6) -------------------
  useEffect(() => {
    setDismissed(fixture?.dismissed ?? {});
    setNoDogsClosed(false);
    // A fixture's own starting state only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureName]);
  const outage = receiverOutage(receiverState, now);
  const storage = storageProblem(tracking.realWriteError);
  // Writing works again: a collapsed storage card is forgotten (a new failure
  // shows it again).
  const storageFailing = !!storage;
  useEffect(() => {
    if (!storageFailing)
      setDismissed(current =>
        current.storage ? { ...current, storage: false } : current,
      );
  }, [storageFailing]);
  const ownWait = useRef(null);
  ownWait.current = trackReceiverWait(ownWait.current, receiverState, now);
  const receiverWait = receiver ? receiver.wait : ownWait.current;
  // When the user switched this receiver off and on (DogFreshness grace),
  // recorded by the native service whatever screen was open.
  const pausesKey = JSON.stringify(
    Array.isArray(receiverState?.receiverPauses)
      ? receiverState.receiverPauses
      : [],
  );
  const pauses = useMemo(() => JSON.parse(pausesKey), [pausesKey]);
  const currentCatchUp = useMemo(() => combinedResumeCatchUp(tracking.catchUp, cloudSync?.catchUp),
    [tracking.catchUp, cloudSync?.catchUp]);
  const cloudSuccess = cloudSync?.mapSuccessRevision ?? cloudSync?.lastSuccess ?? null;
  const cloudReadPending = cloudSuccess != null && incomingCloudDogs?.cloudCommit !== cloudSuccess;
  const catchUpMemory = useRef(null);
  const catchUpOwner = useRef(cloudOwner);
  if (catchUpOwner.current !== cloudOwner) {
    catchUpOwner.current = cloudOwner;
    catchUpMemory.current = null;
  }
  if (currentCatchUp.phase === 'catching-up') catchUpMemory.current = currentCatchUp;
  else if (currentCatchUp.phase === 'failed' || incomingCloudDogs?.error || !cloudReadPending) catchUpMemory.current = null;
  // Network success alone is not publication: keep the return shimmer until
  // the complete map read has accepted that successful pass.
  const catchUp = currentCatchUp.phase === 'idle' && cloudReadPending && catchUpMemory.current
    ? catchUpMemory.current : currentCatchUp;
  const lastDownloadAt = cloudSync?.lastDownloadAt ?? null;
  const failingSince = cloudSync?.failingSince ?? null;
  const cloudClockInput = useMemo(
    () => ({ lastDownloadAt, failingSince }),
    [lastDownloadAt, failingSince],
  );
  const avatars = useMemo(
    () => dogAvatars?.avatars || {},
    [dogAvatars?.avatars],
  );
  const basePresentation = useMemo(() => {
    const base = createTrackingMapPresentation(
      point,
      route,
      positionSamples,
      { ...tracking.preferences.value, windowMinutes: 2, showTrails: false },
      now,
    );
    // Another receiver's last position is not this one's: no ring around
    // it, and nothing framed there.
    if (otherReceiver)
      return {
        ...base,
        positions: { ...base.positions, master: null },
        cameraPositions: [],
      };
    const rangeRing = receiverRangeRing(base.positions.master, link);
    // The receiver is framed only through its ring: without a ring nothing
    // of it is drawn, so the camera must not aim at it either.
    const slave = base.positions.slave?.stale ? null : base.positions.slave;
    return rangeRing
      ? { ...base, rangeRing }
      : { ...base, cameraPositions: cameraCoordinates(null, slave) };
  }, [
    point,
    positionSamples,
    route,
    tracking.preferences.value,
    now,
    otherReceiver,
    link,
  ]);
  // One marker per dog: the newest of the BLE feed and the downloaded cloud
  // rows. The handler's phone driving tells the map which dogs ride along.
  const realPhone = useLiveLocation(active && tracking.foreground && !fixture);
  const livePhone = fixture ? fixture.livePhone : realPhone;
  const rideDetector = useRef(null);
  if (!rideDetector.current) rideDetector.current = createRideDetector();
  if (realPhone?.running && realPhone.position)
    rideDetector.current.add(realPhone.position, now);
  const currentRide = fixture ? fixture.ride : rideDetector.current.ride(now);
  const rideKey = currentRide
    ? `${currentRide.coordinate.latitude},${currentRide.coordinate.longitude}`
    : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ride = useMemo(() => currentRide, [rideKey]);
  const mergedDogs = useMemo(
    () =>
      mergeDogMarkers({
        point,
        samples: positionSamples,
        cloudRows: cloudDogs?.rows,
        packetRows: cloudDogs?.packets,
        holds: cloudDogs?.holds,
        statuses: cloudDogs?.statuses,
        ride,
        now,
        windowMs: LIVE_PACKET_WINDOW_MS,
      }),
    [
      point,
      positionSamples,
      cloudDogs?.rows,
      cloudDogs?.packets,
      cloudDogs?.holds,
      cloudDogs?.statuses,
      ride,
      now,
    ],
  );
  const dogSnapshot = atomicDogs.current.select({
    owner: cloudOwner, dogs: mergedDogs, cloudDogs,
    busy: !!cloudSync?.busy || cloudSync?.catchUp?.phase === 'catching-up',
    success: cloudSync?.mapSuccessRevision ?? cloudSync?.lastSuccess ?? null,
  });
  const dogs = dogSnapshot.dogs;
  cloudDogs = dogSnapshot.cloudDogs;
  const noDogs =
    !historical &&
    showsNoDogs({
      receiverState,
      hasDogData:
        dogs.length > 0 ||
        point?.id != null ||
        !!cloudDogs?.rows?.length ||
        !!cloudDogs?.packets?.length,
      dataRead: tracking.initialSnapshotReady === true && !!cloudDogs?.loaded,
      dismissed:
        noDogsClosed || !!tracking.preferences.value?.noDataCardDismissed,
    });
  // ---- the alerts' snapshot (058a) ----------------------------------------
  // The same merged dogs, names, range judgements and receiver battery as the
  // markers and the gear, so an alert is about exactly what the map shows.
  const alertDogAliases = history?.preferences.dogAliases;
  const alertSnapshotReady =
    tracking.initialSnapshotReady === true && !!cloudDogs?.loaded;
  const alertBatteryValid =
    otherReceiver || point?.id == null ? null : point.masterBatteryValid;
  const alertBatteryPercentage =
    otherReceiver || point?.id == null ? null : point.masterBatteryPercentage;
  const alertSource = fixture?.name ?? 'live';
  useEffect(() => {
    onAlertInput?.({
      source: alertSource,
      ready: alertSnapshotReady,
      dogs: dogs.map(dog => ({
        ...dog,
        name: dogName(dog.slaveId, alertDogAliases),
        range: cloudDogs?.ranges?.[dog.slaveId] ?? null,
        indoorState: cloudDogs?.statuses?.[dog.slaveId]?.indoorState ?? null,
      })),
      receiverBattery:
        alertBatteryValid == null
          ? null
          : { valid: alertBatteryValid, percentage: alertBatteryPercentage },
    });
  }, [
    onAlertInput,
    alertSource,
    alertSnapshotReady,
    dogs,
    alertDogAliases,
    cloudDogs?.ranges,
    cloudDogs?.statuses,
    alertBatteryValid,
    alertBatteryPercentage,
  ]);
  const waitingMemory = useRef(null);
  const waitingSaved = tracking.preferences.value?.waitingLocationSources;
  const [waitingRevision, setWaitingRevision] = useState(0);
  const currentReceiver = receiver?.state ?? receiverState;
  const waitingReceiver = pausedReceiver ? { ...currentReceiver, enabled: false } : currentReceiver;
  const waitingReady = tracking.preferences.ready && cloudDogs?.loaded && !!waitingReceiver;
  const waitingState = !active && !switchingReceiver
    ? waitingMemory.current ?? waitingSaved ?? waitingSourcesState(null, waitingReceiver, [], now)
    : waitingSourcesState(waitingMemory.current ?? waitingSaved, waitingReceiver,
      cloudDogs?.packets, now, switchingReceiver);
  const waitingKey = JSON.stringify(waitingState);
  if (waitingReady) waitingMemory.current = waitingState;
  const lastWaitingSaved = useRef(null);
  useEffect(() => {
    if (!waitingReady || waitingKey === lastWaitingSaved.current || waitingKey === JSON.stringify(waitingSaved)) return;
    lastWaitingSaved.current = waitingKey;
    tracking.saveTrackingPreferences?.({ waitingLocationSources: JSON.parse(waitingKey) });
  }, [waitingKey, waitingSaved, tracking, waitingRevision, waitingReady]);
  const waitingSources = waitingReady ? waitingSourcesCount(waitingState, now) : 0;
  // History shares the map: only the map's own card follows it there.
  const cards = topCards({
    map: mapState === 'retrying' ? 'load-failed' : mapState,
    retrying: mapState === 'retrying',
    ...(historical ? {} : { outage, storage, noDogs, signedIn, dismissed, waitingSources }),
  });
  const reasons = historical
    ? []
    : gearReasons({
        outage,
        storage,
        dismissed,
        receiverState,
        receiverWait,
        receiverBattery:
          otherReceiver || point?.id == null
            ? null
            : {
                valid: point.masterBatteryValid,
                percentage: point.masterBatteryPercentage,
              },
        cloudFailing:
          !!cloudOwner && (cloudSync?.failingSince != null || cloudProblem),
        signInExpired,
        phone,
        notificationsDenied,
        nearbyDenied,
        now,
      });
  const pressCardAction = useCallback(
    id => {
      if (id === 'map-retry') setMapRetry(value => value + 1);
      else onAlertAction?.(id);
    },
    [onAlertAction],
  );
  const closeCard = useCallback(
    id => {
      if (id === 'receiver' && outage)
        setDismissed(current => ({ ...current, receiver: outage.key }));
      else if (id === 'storage')
        setDismissed(current => ({ ...current, storage: true }));
      else if (id === 'waiting-sources') {
        const closed = dismissWaitingSources(waitingMemory.current);
        waitingMemory.current = closed;
        tracking.saveTrackingPreferences?.({ waitingLocationSources: closed });
        setWaitingRevision(value => value + 1);
      }
      else if (id === 'no-dogs') {
        setNoDogsClosed(true);
        tracking.saveTrackingPreferences?.({ noDataCardDismissed: true });
      }
    },
    [outage, tracking],
  );
  const selectedDogId =
    selected?.kind === 'dog' && !historical ? selected.slaveId : null;
  const dogAliases = history?.preferences.dogAliases;
  const previousMarkerStale = useRef({});
  const livePresentation = useMemo(() => {
    // The connected pair's single dog marker is not drawn: every dog is one
    // of `dogMarkers`.
    if (!dogs.length)
      return {
        ...basePresentation,
        slave: null,
        slaveSegments: [],
        dogMarkers: [],
        dogs: [],
      };
    // Every dog that has ever had a position is drawn, however old (v3 §6:
    // grey after 10 minutes, kept after 24 hours). v3 has no hidden dogs and
    // no following: preferences stored by older versions are ignored.
    const drawn = dogs.filter(dog => dog.coordinate);
    return {
      ...basePresentation,
      rangeLines: outOfRangeLines(
        basePresentation.rangeRing,
        drawn,
        cloudDogs?.ranges,
      ),
      // dogs replaces the single slave marker.
      slave: null,
      slaveSegments: [],
      dogs: drawn,
      dogMarkers: dogMarkers(drawn, {
        now,
        cloud: cloudClockInput,
        pauses,
        ranges: cloudDogs?.ranges,
        aliases: dogAliases,
        selectedId: selectedDogId,
        previousStale: previousMarkerStale.current,
        catchUpSince: catchUp.phase === 'catching-up' ? catchUp.since : null,
      }),
      dogPaths: [],
    };
  }, [
    basePresentation,
    dogs,
    cloudDogs?.ranges,
    now,
    cloudClockInput,
    pauses,
    dogAliases,
    selectedDogId,
    catchUp,
  ]);
  useEffect(() => {
    if (catchUp.phase !== 'catching-up')
      previousMarkerStale.current = Object.fromEntries(
        livePresentation.dogMarkers.map(marker => [marker.slaveId, marker.stale]),
      );
  }, [livePresentation, catchUp]);
  // What the first view (cold start, or a data source switch) frames: the
  // dogs from this phone's own receiver and the phone; a far cloud dog only
  // with 框住全部 (MapFraming).
  const [nativePhone, setNativePhone] = useState(null);
  const acceptNativePhone = useCallback(value => {
    if (!Number.isFinite(value?.latitude) || !Number.isFinite(value?.longitude)
      || Math.abs(value.latitude) > 90 || Math.abs(value.longitude) > 180) return;
    setNativePhone({ ...value, receivedAt: Date.now() });
  }, []);
  const phoneSpotValue = phoneFix(livePhone) ?? (!fixture && nativePhone
    && now - nativePhone.receivedAt <= PHONE_FIX_MAX_AGE_S * 1000 ? nativePhone : null);
  const receiverId = receiverState ? receiverNumber(receiverState) : null;
  const phoneKey = phoneSpotValue
    ? `${phoneSpotValue.latitude},${phoneSpotValue.longitude}`
    : '';
  const phoneSpot = useMemo(() => {
    if (!phoneKey) return null;
    const [latitude, longitude] = phoneKey.split(',').map(Number);
    return { latitude, longitude };
  }, [phoneKey]);
  const framedPresentation = useMemo(
    () => ({
      ...livePresentation,
      cameraPositions: coldStartCoordinates(
        livePresentation.dogMarkers,
        phoneSpot,
        receiverId,
      ),
      // phoneKey stands for phoneSpot.
    }),
    [livePresentation, phoneSpot, receiverId],
  );
  // The first framing waits (briefly) for the phone's first report.
  // A history sheet is open: the map behind it is hidden from TalkBack.
  const [historySheet, setHistorySheet] = useState(false);
  const [phoneWaitOver, setPhoneWaitOver] = useState(false);
  const [phoneAloneWaitOver, setPhoneAloneWaitOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPhoneWaitOver(true), PHONE_WAIT_MS);
    const alone = setTimeout(
      () => setPhoneAloneWaitOver(true),
      PHONE_ALONE_WAIT_MS,
    );
    return () => {
      clearTimeout(timer);
      clearTimeout(alone);
    };
  }, []);
  // Settled once the phone has a fix, or says it is not recording, or the
  // wait is over; a report without a position yet keeps waiting — longer
  // when there is no local dog to frame without it.
  const localToFrame =
    coldStartCoordinates(livePresentation.dogMarkers, null, receiverId)
      .length > 0;
  const phoneSettled =
    !!fixture ||
    !!phoneSpot ||
    (livePhone != null && !livePhone.running) ||
    (phoneWaitOver && (localToFrame || phoneAloneWaitOver));
  // ---- the history screen (055a) -----------------------------------------
  const target = historical ? historyTarget : null;
  const exportNative = useMemo(() => fixture?.exporter ?? nativeExporter(), [fixture]);
  const screen = useHistoryScreen({ target, read: history?.readDay, readDays: history?.readDays, owner: cloudOwner,
    clock: fixtureClock, active: historical && active && tracking.foreground !== false, aliases: dogAliases, avatars,
    recording: livePhone ? !!livePhone.running : null,
    recordingStoppedAt: livePhone?.stoppedAt ?? null,
    // A fixture's ranges stay apart from the real ones; H2b starts dragged.
    memoryScope: fixture ? `fixture:${fixture.name}:` : '',
    preset: fixture?.historyView ?? null,
    restore: historical ? historyRestore : null,
    cloud: historyCloud?.cloud ?? null,
    online: historyCloud?.online !== false,
    cloudSeed: historyCloud?.seed ?? null,
  });
  selectHistoryDog.current = screen.selectDog;
  if (historySnapshot) historySnapshot.current = historical ? screen.snapshot : null;
  const window = useWindowDimensions();
  const [historyHeight, setHistoryHeight] = useState(() => historyPanelMinHeight(window.height, insets.top, insets.bottom));
  const historyScreen = useRef(null);
  if (historyBack) historyBack.current = () => !!historyScreen.current?.back();
  const [historyFrame, setHistoryFrame] = useState(null);
  const settleHistoryPanel = useCallback(height => {
    setHistoryHeight(height);
    setHistoryFrame(previous => ({ key: (previous?.key ?? 0) + 1 }));
  }, []);
  const presentation = useMemo(() => {
    // The live map is live only: what it draws is never decided by the
    // history's parameters.
    if (!historical)
      return {
        ...framedPresentation,
        dogAliases: history?.preferences.dogAliases,
        dogAvatars: avatars,
      };
    // Several dogs (H7): the others are faces at their cursor points, drawn
    // like the live map's dogs (a tap makes one the protagonist; faces that
    // run into each other share one 「2 隻」 tag and its menu).
    return {
      positions: {},
      slave: null,
      slaveSegments: [],
      rangeRing: null,
      rangeLines: [],
      historyMode: true,
      dogMarkers: historyFaces(screen.map?.faces),
      dogAvatars: avatars,
      cameraPositions: screen.map?.camera ?? [],
      historyRoute: screen.map,
    };
  }, [
    historical,
    history?.preferences.dogAliases,
    framedPresentation,
    avatars,
    screen.map,
  ]);
  // The dogs that can be added (「＋ 加入」): every dog that has ever had a
  // position, by collar number (never-fixed sources are not dogs yet).
  const historyCandidates = useMemo(
    () =>
      historical
        ? dogs
            .filter(dog => dog.coordinate)
            .map(dog => ({
              id: dog.slaveId,
              name: displayName(dog.slaveId, dogAliases),
              avatar: avatars[dog.slaveId] ?? null,
            }))
        : [],
    [historical, dogs, dogAliases, avatars],
  );
  // ---- the dog's card (A3) ------------------------------------------------
  // The card belongs to a dog drawn on the live map: it goes when the dog
  // does (a dog that never had a position has no card).
  const cardDog = useMemo(
    () =>
      selectedDogId == null || !active
        ? null
        : dogs.find(dog => dog.slaveId === selectedDogId && dog.coordinate) ||
          null,
    [selectedDogId, active, dogs],
  );
  const cardOpen = !!cardDog;
  useEffect(() => {
    if (selectedDogId != null && !cardDog) setSelected(null);
  }, [selectedDogId, cardDog]);
  useEffect(() => {
    if (!cardOpen) {
      setCardHeight(0);
      setCardPage(null);
    } else if (pendingPage.current) {
      setCardPage(pendingPage.current);
      pendingPage.current = null;
    }
    onCardChange?.(cardOpen);
  }, [cardOpen, onCardChange]);
  const database = tracking.cloudDatabase;
  const cardReader = useMemo(() => database?.dogCardRows
    ? createAtomicDogCardReader(database, cloudOwner) : null, [database, cloudOwner]);
  const cardBusy = !!cloudSync?.busy || cloudSync?.catchUp?.phase === 'catching-up' || cloudReadPending;
  const cardSuccess = cloudSync?.mapSuccessRevision ?? cloudSync?.lastSuccess ?? null;
  cardReader?.update(cardBusy, cardSuccess);
  const readCardRows = fixture?.readCardRows ?? cardReader?.read ?? null;
  // The activity page (A4) reads the dog's period from the same tables.
  const readActivity = useMemo(
    () =>
      fixture?.readActivity ??
      (database?.activityPeriod
        ? (slaveId, period) =>
            database.activityPeriod(cloudOwner ?? null, slaveId, period)
        : null),
    [fixture?.readActivity, database, cloudOwner],
  );
  const readActivityEarliest = useMemo(
    () =>
      fixture?.readActivityEarliest ??
      (database?.activityEarliest
        ? slaveId => database.activityEarliest(cloudOwner ?? null, slaveId)
        : null),
    [fixture?.readActivityEarliest, database, cloudOwner],
  );
  const readings = useDogCardReadings(
    cardOpen ? readCardRows : null,
    cardDog?.slaveId ?? null,
    now,
    `${cardBusy}:${cardSuccess}`,
  );
  // A7b: the held place's address under 「室內」 (none while asking/offline).
  const address = useAddress(
    cardDog && isIndoorHold(cardDog) ? cardDog.coordinate : null,
  );
  const cardModel = useMemo(() => {
    if (!cardDog) return null;
    const freshness = dogFreshness(cardDog, {
      now,
      cloud: cloudClockInput,
      pauses,
    });
    return dogCard(cardDog, {
      freshness,
      range: cloudDogs?.ranges?.[cardDog.slaveId] ?? null,
      battery: readings.battery,
      activity: readings.activity,
      // The recording service's fix, else the map's blue dot (E03).
      phone: phoneReading(livePhone, now) ?? (fixture ? null : nativePhoneReading(nativePhone, now)),
      now,
      reference:
        freshness.source === 'cloud' ? cloudClock(cloudClockInput, now) : now,
      name: dogName(cardDog.slaveId, dogAliases),
      address,
    });
  }, [
    cardDog,
    now,
    cloudClockInput,
    pauses,
    cloudDogs?.ranges,
    readings,
    livePhone,
    nativePhone,
    fixture,
    dogAliases,
    address,
  ]);
  const closedCard = useCallback(
    () => setSelected(current => (current?.kind === 'dog' ? null : current)),
    [],
  );
  const [trackBusy, setTrackBusy] = useState(false);
  // 看軌跡: today's path of this dog. The query is stored first, so the
  // history page never opens on the previous one.
  const openTrackHistory = async () => {
    if (!cardDog || !history?.save || trackBusy) return;
    const dog = cardDog;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    // Every receiver known to have heard this dog, so a day relayed by several
    // receivers is not cut down to the one heard last.
    const heard = (history.devices || [])
      .filter(pair => pair.slave === dog.slaveId)
      .map(pair => pair.master);
    const masters = [
      ...new Set([...heard, ...(dog.masterId != null ? [dog.masterId] : [])]),
    ];
    setTrackBusy(true);
    const generation = cardGeneration.current;
    const saved = await history.save({
      ...history.preferences,
      timeMode: 'fixed',
      startAt: start.getTime(),
      endAt: Math.max(now, start.getTime() + 60000),
      slaves: [dog.slaveId],
      client: true,
      source: dog.fixSource === 'cloud' ? 'cloud' : 'ble',
      masters: masters.length ? masters : history.preferences.masters,
    });
    setTrackBusy(false);
    // The card was closed or another dog opened meanwhile: stay on the map.
    if (!saved || generation !== cardGeneration.current) return;
    setSelected(null);
    onOpenHistory?.(dog.slaveId);
  };
  // 「今天 x km」 (A1/A2): today's distance and whether the phone records
  // and has a location.
  // Recording that has not had a first fix yet waits 10 minutes before the
  // slash, like a lost one (判定表「暫時沒有 GPS 訊號」).
  const waitingSince = useRef(null);
  const waiting = !!livePhone?.running && !livePhone?.position;
  if (!waiting) waitingSince.current = null;
  else if (waitingSince.current == null) waitingSince.current = now;
  const pillKey = JSON.stringify(
    todayPill({
      route: todayRoute,
      livePhone,
      phone,
      now,
      waitingSince: waitingSince.current,
    }),
  );
  const today = useMemo(() => JSON.parse(pillKey), [pillKey]);
  const [routeBusy, setRouteBusy] = useState(false);
  // Only while the live map is still in front does a finished save navigate.
  const liveInFront = useRef(false);
  liveInFront.current = active && !historical;
  // Tapping it opens my route: today's recorded route of this phone in the
  // history page (the whole day, so it grows while recording and ends at the
  // last fix when recording stops), no dogs. The query is stored first, like
  // 看軌跡.
  const openMyRoute = useCallback(async () => {
    if (!history?.save || routeBusy) return;
    const start = startOfToday(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    setRouteBusy(true);
    const saved = await history.save({
      ...history.preferences,
      timeMode: 'fixed',
      startAt: start,
      endAt: end.getTime(),
      phone: true,
      client: false,
    });
    setRouteBusy(false);
    if (saved && liveInFront.current) onOpenHistory?.(null);
  }, [history, routeBusy, now, onOpenHistory]);
  // ---- a notification tapped (058b) ----------------------------------------
  // 判定表「通知本體和「打開地圖」按鈕」: the body opens the most severe
  // problem (a dog: its card); 「打開地圖」 only the live map, everything
  // framed, no card. A request waits until what it opens is there.
  // From a cold start the launch screen first flies to the alerted dog
  // (hideSplash.notificationTargets); its card rises, and the map moves to it,
  // once the handover has finished (判定表「從通知冷啟動」). A warm start has
  // no launch screen: at once.
  const splashDone = useSplashState().phase === 'done';
  const handledNotification = useRef(null);
  const [notificationFrame, setNotificationFrame] = useState(null);
  useEffect(() => {
    const request = notificationRequest;
    if (!request || handledNotification.current === request.key || !active || historical || !splashDone) return;
    if (request.screen === 'open-map') {
      handledNotification.current = request.key;
      if (cardOpen) card.current?.close();
      setNotificationFrame({ key: request.key, all: true });
    } else if (request.screen === 'map' && request.dogId != null) {
      if (!dogs.some(dog => dog.slaveId === request.dogId && dog.coordinate)) return;
      handledNotification.current = request.key;
      openDog(request.dogId);
    } else if (request.screen === 'my-route') {
      if (!history?.save) return;
      handledNotification.current = request.key;
      openMyRoute();
    } else handledNotification.current = request.key;
  }, [notificationRequest, active, historical, splashDone, cardOpen, dogs, openDog, history, openMyRoute]);
  // The newer of the two framing requests.
  const mapFrameRequest =
    notificationFrame && (!frameRequest || notificationFrame.key > frameRequest.key)
      ? notificationFrame
      : frameRequest;
  // A5: the name is stored with the history preferences' names (dogAliases),
  // the face in dog_avatars; both by collar number, on this phone only.
  const saveName = async name => {
    if (!cardDog || !history?.save) return false;
    const aliases = {
      ...(history.preferences.dogAliases || {}),
      [cardDog.slaveId]: name,
    };
    return !!(await history.save({
      ...history.preferences,
      dogAliases: aliases,
    }));
  };
  const saveAvatar = async avatar => {
    if (!cardDog || !dogAvatars?.save) return false;
    return !!(await dogAvatars.save(cardDog.slaveId, avatar));
  };
  const closePage = useCallback(() => setCardPage(null), []);
  const focusDog = useMemo(
    () =>
      cardDog && cardHeight && focusRequest?.slaveId === cardDog.slaveId
        ? { key: focusRequest.key, coordinate: cardDog.coordinate }
        : null,
    // Asked once per opening, after the card has its height.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusRequest, !!cardHeight, cardDog?.slaveId],
  );
  // History notices live in the history card, next to the controls that cause
  // them; the map keeps only what belongs to the map itself.
  const messages = [];
  // The base map, cloud sync and storage speak through the top cards and the
  // gear's red dot (A2); reading this phone's own copies can still fail.
  if (!historical && cloudDogs?.error)
    messages.push(t("c902", { error: cloudDogs.error }));
  if (phone?.error)
    messages.push(t("c903", { error: phone.error }));
  if (tracking.errors[mode])
    messages.push(
      ((tracking.ready[mode]) ? t("c904", { value: tracking.errors[mode] }) : t("c905", { value: tracking.errors[mode] })),
    );
  else if (!tracking.ready[mode]) messages.push(t("c906"));
  if (tracking.preferences.error)
    messages.push(
      t("c907", { error: tracking.preferences.error }),
    );
  const top = insets.top + layout.floatingGap;
  // The top cards hang 8dp under the gear (8dp under the status bar, 48dp).
  const gearTop = insets.top + layout.belowStatusBar;
  const cardsTop = gearTop + sizes.floatingButton + layout.belowStatusBar;
  const cardsBottom = cards.length && topHeight ? cardsTop + topHeight : 0;
  const noticesTop = cardsBottom ? cardsBottom + space.s : top + sizes.mapSource.noticeTopReserve;
  // History: under the top capsule row (8dp under the status bar, 48dp).
  const controlsTop = historical
    ? gearTop + sizes.floatingButton + layout.belowStatusBar + (messages.length ? noticeHeight + 8 : 0)
    : top + 44 + (messages.length ? noticeHeight + 8 : 0);
  // The compass: 12dp under the gear, or under the whole stack of cards.
  const compassTop = historical
    ? Math.max(controlsTop, n3Bottom) + 12
    : (cardsBottom || gearTop + 48) + 12;
  // The live map's padding stays put (an open card covers the map, it does
  // not move it); its buttons sit 12dp above the open card, else above the tabs.
  // History reserves the measured panel height for all camera actions.
  const mapBottom = historical ? historyHeight : bottomInset;
  const coverBottom = historical
    ? historyHeight
    : cardHeight
    ? cardHeight + layout.floatingGap
    : 0;
  const historySource =
    historical && target
      ? `history:${target.subject}:${target.slaveId ?? ''}:${screen.day}:${
          fixture?.name ?? ''
        }`
      : null;
  // A4/A5 only cover the map while they are drawn: a page asked for before
  // its card exists (a fixture's openPage, or a card that went) must not hide
  // the map with nothing over it (a blank screen).
  const coveringPage = cardModel ? cardPage : null;
  return (
    <View style={styles.root} testID="fullscreen-map-screen">
      {/* Under A4/A5 the map and its card stay mounted, only out of reach of
          touch and TalkBack. Never display:none or a style that changes
          whether this view is flattened: either one detaches the native
          MapView, and react-native-maps re-creates its GoogleMap on every
          re-attach without destroying the old one (a leak per opening).
          collapsable={false} keeps this one native view for good. Under a
          page the layer is moved off screen (a transform, which keeps it
          attached): the native map draws into its own surface under the
          window, and an opaque page alone left it showing in the status-bar
          inset. */}
      <View testID="map-background-layer" style={[StyleSheet.absoluteFill, coveringPage && styles.coveredMap]}
        collapsable={false}
        pointerEvents={coveringPage ? 'none' : 'auto'}
        accessibilityElementsHidden={!!coveringPage}
        importantForAccessibility={coveringPage ? 'no-hide-descendants' : 'auto'}>
      <TrackingMap
        a11yHidden={historical && historySheet}
        provider={mapProvider}
        // A screen fixture counts as a new source, so the map frames its dogs.
        source={
          historySource ?? (fixture ? `${mode}:fixture:${fixture.name}` : mode)
        }
        presentation={presentation}
        topInset={controlsTop}
        bottomInset={mapBottom}
        onMapState={setMapState}
        retryKey={mapRetry}
        failure={fixture?.mapFailure ?? null}
        coverTop={cardsBottom}
        compassTop={compassTop}
        livePhone={livePhone}
        onNativePhone={acceptNativePhone}
        foreground={tracking.foreground && active}
        appForeground={tracking.foreground}
        // A fixture switch (or a return to live data) reads the receiver
        // again: frame only once its link is known, so the ring is framed.
        // The first view also waits for the phone's first report (or a
        // moment), so it frames the phone with the local dogs.
        framingReady={
          historical
            ? !!screen.model
            : receiverActive && receiverState !== undefined && phoneSettled
        }
        dataReady={
          tracking.preferences.ready &&
          (tracking.initialSnapshotReady === true || !!tracking.errors[mode]) &&
          // The first fit waits for the receiver's identity (one native read),
          // so another receiver's stored position is never framed as ours.
          receiverState !== undefined
        }
        phoneEnabled={!!phone?.enabled}
        onDogPress={openDog}
        onMapPress={
          historical
            ? () => historyScreen.current?.mapPressed()
            : cardOpen
            ? pressMap
            : undefined
        }
        onCursorMove={screen.moveCursor}
        onStopPress={place =>
          screen.moveCursor(place.start, 'stop', { start: place.start })
        }
        historyFocus={
          historical && screen.focus && screen.cursor?.point
            ? {
                key: screen.focus.key,
                // 換主角時的地圖: to the new protagonist's cursor, even after a drag.
                centre:
                  screen.focus.action === 'node' ||
                  screen.focus.action === 'stop' ||
                  (screen.focus.action === 'protagonist' &&
                    screen.focus.id != null),
                coordinate: {
                  latitude: screen.cursor.point.latitude,
                  longitude: screen.cursor.point.longitude,
                },
              }
            : null
        }
        historyFrame={historyFrame}
        onHeading={setHeading}
        focusDog={focusDog}
        frameRequest={historical ? null : mapFrameRequest}
        coverBottom={coverBottom}
        today={historical ? null : today}
        onToday={today?.unrecorded ? () => onAlertAction?.('phone-unrecorded') : openMyRoute}
      />

      {/* The launch screen's handover fades these in (splashChrome). */}
      <Animated.View
        pointerEvents="box-none"
        importantForAccessibility={behindSheet(historical && historySheet)}
        style={[
          StyleSheet.absoluteFill,
          styles.chrome,
          // The gear and top cards go under A4/A5 (not an ancestor of the map).
          coveringPage && styles.hiddenChrome,
          { opacity: splashChrome },
        ]}
      >
        {!historical && (
          // Fixed under the status bar; it does not move with the card.
          <SettingsGear
            top={gearTop}
            alert={reasons.length > 0}
            alertLabel={gearLabel(reasons)}
            onPress={onOpenSettings}
          />
        )}
        {!historical && active && tracking.foreground && (
          <CatchUpPill phase={catchUp.phase} top={gearTop}
            onRetry={() => {
              if (tracking.catchUp?.phase === 'failed') tracking.retryCatchUp?.();
              if (cloudSync?.catchUp?.phase === 'failed') cloudSync.retry?.();
            }} />
        )}
        <TopAlertCards
          cards={cards}
          top={cardsTop}
          onAction={pressCardAction}
          onClose={closeCard}
          onHeight={setTopHeight}
        />
      </Animated.View>
      {!historical && !tracking.preferences.ready && (
        <View style={[styles.source, { top }]}>
          <View style={styles.statusDot} />
          <Text style={styles.sourceText}>{t('c424')}</Text>
        </View>
      )}
      {!!messages.length && (
        <View
          onLayout={event => setNoticeHeight(event.nativeEvent.layout.height)}
          style={[styles.notices, { top: noticesTop }]}
        >
          <ScrollView nestedScrollEnabled>
            {messages.map(message => (
              <Text
                key={message}
                accessibilityRole="alert"
                style={styles.noticeText}
              >
                {message}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}
      {historical && target && (
        <HistoryScreen
          key={fixture ? `fixture:${fixture.name}` : 'live'}
          ref={historyScreen}
          screen={screen}
          top={gearTop}
          initialRangeOpen={!!fixture?.historyView?.rangeOpen}
          initialCalendar={fixture?.historyView?.calendar ?? null}
          candidates={historyCandidates}
          initialSheet={fixture?.historyView?.sheet ?? null}
          bottomInset={insets.bottom}
          onPanelHeight={settleHistoryPanel}
          onBack={onLeaveHistory}
          onFrame={() => setHistoryFrame({ key: Date.now() })}
          exportNative={exportNative}
          initialExport={fixture?.historyView?.export ?? null}
          alertBadge={alertBadge?.badge ?? null}
          onAlertBadge={alertBadge?.onPress}
          onSheetOpen={setHistorySheet}
          closedAt={
            target.subject === 'phone' &&
            screen.today &&
            livePhone &&
            !livePhone.running
              ? livePhone.stoppedAt ?? null
              : null
          }
        />
      )}
      {cardModel && (
        <DogCard
          key={cardKey}
          ref={card}
          card={cardModel}
          avatar={avatars[cardModel.slaveId]}
          heading={heading}
          onHeight={cardHeightChanged}
          onClosed={closedCard}
          onEdit={() => setCardPage('edit')}
          onActivity={() => setCardPage('activity')}
          onTrack={openTrackHistory}
          trackBusy={trackBusy}
        />
      )}
      </View>
      {cardModel && cardPage === 'activity' && (
        <ActivityScreen
          key={`${fixture?.name ?? 'live'}:${cardModel.slaveId}`}
          name={cardModel.name}
          slaveId={cardModel.slaveId}
          read={readActivity}
          readEarliest={readActivityEarliest}
          now={fixture?.activityNow ?? now}
          active={active}
          initialView={fixture?.activityView ?? null}
          onBack={closePage}
        />
      )}
      {cardModel && cardPage === 'edit' && (
        <DogProfile
          key={cardModel.slaveId}
          slaveId={cardModel.slaveId}
          name={displayName(cardModel.slaveId, dogAliases)}
          alias={dogAliases?.[cardModel.slaveId] || ''}
          avatar={avatars[cardModel.slaveId] || null}
          onSaveName={saveName}
          onSaveAvatar={saveAvatar}
          onBack={closePage}
        />
      )}
    </View>
  );
}
const getStyles = makeStyles(theme => {
  const {
    appColors: colors,
    floatingShadow,
    literalColors: themeLiteral,
  } = theme;
  return StyleSheet.create({
    // The gear and the top cards, above the map and the card (as before).
    chrome: { zIndex: 70, elevation: 32 },
    hiddenChrome: { display: 'none' },
    // Far enough that no part of the covered map is on screen.
    coveredMap: { transform: [{ translateX: layout.offscreen }] },
    // MapScreen lives in App's persistent absolute map layer. A flex-only child
    // can measure to zero under Fabric, sending bottom-anchored overlays above
    // the viewport, so make this screen an explicit inset box as well.
    root: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.canvas,
    },
    source: {
      position: 'absolute',
      zIndex: 20,
      left: space.m,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      paddingHorizontal: space.m,
      minHeight: sizes.mapSource.height,
      flexDirection: 'row',
      alignItems: 'center',
      ...floatingShadow,
    },
    statusDot: {
      width: sizes.mapSource.statusDot,
      height: sizes.mapSource.statusDot,
      borderRadius: radius.full,
      backgroundColor: colors.master,
      marginRight: space.s,
    },
    sourceText: { color: colors.ink, fontSize: type.caption.fontSize, fontWeight: type.captionBold.fontWeight },
    notices: {
      position: 'absolute',
      zIndex: 20,
      left: space.m,
      right: space.m,
      maxHeight: sizes.mapSource.noticeLimit,
      backgroundColor: themeLiteral.mapNoticeBackground,
      borderRadius: radius.snackbar,
      padding: space.s,
      ...floatingShadow,
    },
    noticeText: {
      color: themeLiteral.mapNoticeText,
      fontSize: type.small.fontSize,
      lineHeight: type.caption.lineHeight,
    },
  });
});

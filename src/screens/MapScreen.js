import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HistorySheet, { shortRangeLabel } from '../mapHistory/HistorySheet';
import HistoryPlaybackControls from '../mapHistory/HistoryPlaybackControls';
import { clipTrackTo } from '../mapHistory/HistoryPlayback';
import { dogHistoryLabel } from '../mapHistory/DogAliases';
import { useHistoryPlayback } from '../mapHistory/useHistoryPlayback';
import { useLiveLocation } from '../locationTracker/useLiveLocation';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackingMap from '../map/TrackingMap';
import {
  createTrackingMapPresentation, outOfRangeLines, receiverRangeRing,
} from '../map/TrackingMapPresentation';
import { mergeDogMarkers, LIVE_PACKET_WINDOW_MS } from '../map/DogMerge';
import { cameraCoordinates } from '../map/TrackingGeometry';
import { createRideDetector } from '../placement/RideAlong';
import { dogColor } from '../map/CloudTracks';
import { useMapClock } from '../map/useMapClock';
import DeviceDetails from '../map/DeviceDetails';
import { SHEET_COLLAPSED_HEIGHT } from '../map/SheetMotion';
import { floatingShadow, mapColors as colors } from '../map/MapTheme';
import { useReceiverState } from '../map/useReceiverState';
import { isOtherReceiver, receiverLink, receiverNumber } from '../map/ReceiverState';
import { dogMarkers, dogName } from '../map/DogMarkers';
import { coldStartCoordinates, phoneFix } from '../map/MapFraming';
import DogCard from '../map/DogCard';
import { ActivityPage } from '../map/DogCardPages';
import DogProfile from '../dogs/DogProfile';
import { displayName } from '../dogs/DogName';
import { dogCard, phoneReading } from '../map/DogCardModel';
import { useDogCardReadings } from '../map/useDogCardReadings';
import { cloudClock, dogFreshness } from '../tracking/DogFreshness';
import { layout } from '../theme/tokens';
import { SettingsGear } from '../map/MapControls';
import TopAlertCards from '../map/TopAlertCards';
import {
  gearLabel, gearReasons, receiverOutage, showsNoDogs, storageProblem, topCards, trackReceiverWait,
} from '../map/TopAlerts';
import { startOfToday, todayPill } from '../tracking/TodayDistance';

// How long the first framing waits for the phone's first position report
// before framing without it (the launch screen is still up meanwhile).
export const PHONE_WAIT_MS = 1500;

export default function MapScreen({
  tracking,
  phone,
  bottomInset,
  mapProvider,
  active = true,
  history,
  historical = false,
  cloudDogs,
  cloudOwner,
  // The live cloud sync (useCloudSync): when the last download succeeded and
  // since when it has been failing, for judging cloud dogs' freshness.
  cloudSync = null,
  // { avatars } from useDogAvatars: each dog's face by collar number.
  dogAvatars = null,
  historyDownload,
  // Debug builds only (src/dev/ScreenFixtures.js): the clock, the phone's live
  // position and the receiver reader of a named screen state.
  fixture = null,
  // A dog's card opens or closes.
  onCardChange,
  // 看軌跡: the history query is saved; open the history page for slaveId.
  onOpenHistory,
  // { slaveId, key }: open this dog's card (back from its history).
  openDogRequest = null,
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
  // A top card's button that leaves the map: 'receiver-settings',
  // 'storage-settings', 'storage-reason', 'connect-receiver', 'sign-in'.
  onAlertAction,
}) {
  const insets = useSafeAreaInsets();
  const snapshot = useRef(null);
  const onSnapshotReady = useCallback(value => { snapshot.current = value; }, []);
  const [sheetHeight, setSheetHeight] = useState(0);
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
  const closeDetails = useCallback(() => setSelected(null), []);
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
  const cardClosing = useRef(false);
  const [cardKey, setCardKey] = useState(0);
  const cardHeightChanged = useCallback(value => {
    if (!value) cardGeneration.current += 1;
    cardClosing.current = !value;
    setCardHeight(value);
  }, []);
  const openDog = useCallback(slaveId => {
    if (historical) return;
    cardGeneration.current += 1;
    if (cardClosing.current) {
      cardClosing.current = false;
      setCardKey(value => value + 1);
    }
    setSelected(current => (current?.kind === 'dog' && current.slaveId === slaveId ? current
      : { kind: 'dog', slaveId }));
    setCardPage(null);
    setFocusRequest({ slaveId, key: Date.now() });
  }, [historical]);
  const openTrack = useCallback(name => setSelected({ kind: 'track', name }), []);
  // Tapping empty map closes the card (sliding away), like swiping it down.
  const pressMap = useCallback(() => card.current?.close(), []);
  const { point, route, positionSamples, mode } = tracking;
  // Ageing is measured against this clock, not against the newest row: a silent
  // collar changes nothing else on this screen.
  const liveNow = useMapClock(active && tracking.foreground && !fixture);
  // A screen fixture stops the clock, so its screenshot is the same every time.
  const now = fixture ? fixture.now : liveNow;
  // The receiver this phone is set up for, read from the native service while
  // the live map is in front (a fixture supplies its own reader).
  const receiverActive = active && tracking.foreground && !historical;
  const receiverState = useReceiverState(receiverActive, fixture?.readReceiverState);
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
    } else setSelected(null);
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
    if (!storageFailing) setDismissed(current => (current.storage ? { ...current, storage: false } : current));
  }, [storageFailing]);
  const receiverWait = useRef(null);
  receiverWait.current = trackReceiverWait(receiverWait.current, receiverState, now);
  // When the user switched this receiver off and on (DogFreshness grace),
  // recorded by the native service whatever screen was open.
  const pausesKey = JSON.stringify(Array.isArray(receiverState?.receiverPauses) ? receiverState.receiverPauses : []);
  const pauses = useMemo(() => JSON.parse(pausesKey), [pausesKey]);
  const lastDownloadAt = cloudSync?.lastDownloadAt ?? null;
  const failingSince = cloudSync?.failingSince ?? null;
  const cloudClockInput = useMemo(() => ({ lastDownloadAt, failingSince }), [lastDownloadAt, failingSince]);
  const avatars = useMemo(() => dogAvatars?.avatars || {}, [dogAvatars?.avatars]);
  const basePresentation = useMemo(
    () => {
      const base = createTrackingMapPresentation(
        point,
        route,
        positionSamples,
        { ...tracking.preferences.value, windowMinutes: 2, showTrails: false },
        now,
      );
      // Another receiver's last position is not this one's: no ring around
      // it, and nothing framed there.
      if (otherReceiver) return { ...base, positions: { ...base.positions, master: null }, cameraPositions: [] };
      const rangeRing = receiverRangeRing(base.positions.master, link);
      // The receiver is framed only through its ring: without a ring nothing
      // of it is drawn, so the camera must not aim at it either.
      const slave = base.positions.slave?.stale ? null : base.positions.slave;
      return rangeRing ? { ...base, rangeRing } : { ...base, cameraPositions: cameraCoordinates(null, slave) };
    },
    [point, positionSamples, route, tracking.preferences.value, now, otherReceiver, link],
  );
  // One marker per dog: the newest of the BLE feed and the downloaded cloud
  // rows. The handler's phone driving tells the map which dogs ride along.
  const realPhone = useLiveLocation(active && tracking.foreground && !fixture);
  const livePhone = fixture ? fixture.livePhone : realPhone;
  const rideDetector = useRef(null);
  if (!rideDetector.current) rideDetector.current = createRideDetector();
  if (realPhone?.running && realPhone.position) rideDetector.current.add(realPhone.position, now);
  const currentRide = fixture ? fixture.ride : rideDetector.current.ride(now);
  const rideKey = currentRide
    ? `${currentRide.coordinate.latitude},${currentRide.coordinate.longitude}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ride = useMemo(() => currentRide, [rideKey]);
  const dogs = useMemo(
    () => mergeDogMarkers({ point, samples: positionSamples, cloudRows: cloudDogs?.rows,
      packetRows: cloudDogs?.packets, holds: cloudDogs?.holds, statuses: cloudDogs?.statuses,
      ride, now, windowMs: LIVE_PACKET_WINDOW_MS }),
    [point, positionSamples, cloudDogs?.rows, cloudDogs?.packets, cloudDogs?.holds,
      cloudDogs?.statuses, ride, now],
  );
  const noDogs = !historical && showsNoDogs({
    receiverState,
    hasDogData: dogs.length > 0 || point?.id != null || !!cloudDogs?.rows?.length || !!cloudDogs?.packets?.length,
    dataRead: tracking.initialSnapshotReady === true && !!cloudDogs?.loaded,
    dismissed: noDogsClosed || !!tracking.preferences.value?.noDataCardDismissed,
  });
  // History shares the map: only the map's own card follows it there.
  const cards = topCards({
    map: mapState === 'retrying' ? 'load-failed' : mapState, retrying: mapState === 'retrying',
    ...(historical ? {} : { outage, storage, noDogs, signedIn, dismissed }),
  });
  const reasons = historical ? [] : gearReasons({
    outage, storage, dismissed, receiverState, receiverWait: receiverWait.current,
    receiverBattery: otherReceiver || point?.id == null ? null
      : { valid: point.masterBatteryValid, percentage: point.masterBatteryPercentage },
    cloudFailing: !!cloudOwner && (cloudSync?.failingSince != null || cloudProblem),
    signInExpired, phone, notificationsDenied, now,
  });
  const pressCardAction = useCallback(id => {
    if (id === 'map-retry') setMapRetry(value => value + 1);
    else onAlertAction?.(id);
  }, [onAlertAction]);
  const closeCard = useCallback(id => {
    if (id === 'receiver' && outage) setDismissed(current => ({ ...current, receiver: outage.key }));
    else if (id === 'storage') setDismissed(current => ({ ...current, storage: true }));
    else if (id === 'no-dogs') {
      setNoDogsClosed(true);
      tracking.saveTrackingPreferences?.({ noDataCardDismissed: true });
    }
  }, [outage, tracking]);
  const selectedDogId = selected?.kind === 'dog' && !historical ? selected.slaveId : null;
  const dogAliases = history?.preferences.dogAliases;
  const livePresentation = useMemo(() => {
    // The connected pair's single dog marker is not drawn: every dog is one
    // of `dogMarkers`.
    if (!dogs.length) return { ...basePresentation, slave: null, slaveSegments: [], dogMarkers: [], dogs: [] };
    // Every dog that has ever had a position is drawn, however old (v3 §6:
    // grey after 10 minutes, kept after 24 hours). v3 has no hidden dogs and
    // no following: preferences stored by older versions are ignored.
    const drawn = dogs.filter(dog => dog.coordinate);
    return {
      ...basePresentation,
      rangeLines: outOfRangeLines(basePresentation.rangeRing, drawn, cloudDogs?.ranges),
      // dogs replaces the single slave marker.
      slave: null,
      slaveSegments: [],
      dogs: drawn,
      dogMarkers: dogMarkers(drawn, { now, cloud: cloudClockInput, pauses,
        ranges: cloudDogs?.ranges, aliases: dogAliases, selectedId: selectedDogId }),
      dogPaths: [],
    };
  }, [basePresentation, dogs, cloudDogs?.ranges, now, cloudClockInput, pauses, dogAliases, selectedDogId]);
  // What the first view (cold start, or a data source switch) frames: the
  // dogs from this phone's own receiver and the phone; a far cloud dog only
  // with 框住全部 (MapFraming).
  const phoneSpot = phoneFix(livePhone);
  const receiverId = receiverState ? receiverNumber(receiverState) : null;
  const phoneKey = phoneSpot ? `${phoneSpot.latitude},${phoneSpot.longitude}` : '';
  const framedPresentation = useMemo(() => ({
    ...livePresentation,
    cameraPositions: coldStartCoordinates(livePresentation.dogMarkers, phoneSpot, receiverId),
    // phoneKey stands for phoneSpot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [livePresentation, phoneKey, receiverId]);
  // The first framing waits (briefly) for the phone's first report.
  const [phoneWaitOver, setPhoneWaitOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPhoneWaitOver(true), PHONE_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  // Settled once the phone has a fix, or says it is not recording, or the
  // wait is over; a report without a position yet keeps waiting.
  const phoneSettled = !!fixture || !!phoneSpot || (livePhone != null && !livePhone.running) || phoneWaitOver;
  const playback = useHistoryPlayback(history?.data, history?.key, historical);
  const playbackAt = playback.at;
  const presentation = useMemo(() => {
    // The live map is live only: what it draws is never decided by the
    // history tab's parameters.
    if (!historical) return { ...framedPresentation, dogAliases: history?.preferences.dogAliases, dogAvatars: avatars };
    const data = history.data;
    // Playback draws the same tracks up to the cursor, so the map never shows a
    // position the replayed moment did not have yet.
    const clip = track => (Number.isFinite(playbackAt) ? clipTrackTo(track, playbackAt) : track);
    // One track per dog, each with its own colour, plus this phone's own trace.
    const tracks = data ? [
      { ...clip(data.phone), name: '手機', color: '#2563EB', role: 'phone',
        sourceLabel: '來源：這支手機自己的定位記錄' },
      // Each dog's position at the replayed moment wears the same face as on
      // the live map, instead of an anonymous map pin.
      ...(data.clients || []).map((track, index) => ({
        ...clip(track),
        name: dogHistoryLabel(track.slaveId, history.preferences.dogAliases),
        avatar: avatars[track.slaveId],
        color: dogColor(track.slaveId, index),
        role: 'slave',
        sourceLabel: history.preferences.source === 'cloud'
          ? '來源：雲端下載的資料' : '來源：這支手機用 BLE 收到的資料',
      })),
    ] : [];
    const points = tracks.flatMap(track => track.segments.flat());
    const cameraPositions = [];
    if (points.length) {
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      for (const p of points) { minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude); minLon = Math.min(minLon, p.longitude); maxLon = Math.max(maxLon, p.longitude); }
      cameraPositions.push({ latitude: minLat, longitude: minLon }, { latitude: maxLat, longitude: maxLon });
    }
    return { positions: {}, slave: null, slaveSegments: [], rangeRing: null, rangeLines: [], cameraPositions, historyTracks: tracks };
  }, [historical, history?.data, history?.preferences.source, history?.preferences.dogAliases, framedPresentation,
    playbackAt, avatars]);
  // A history track's panel (the live map's dogs answer with their card).
  const trackSubject = useMemo(() => {
    if (!historical || selected?.kind !== 'track') return null;
    const track = (presentation.historyTracks || []).find(item => item.name === selected.name);
    return track ? { kind: 'track', track } : null;
  }, [selected, historical, presentation.historyTracks]);
  // ---- the dog's card (A3) ------------------------------------------------
  // The card belongs to a dog drawn on the live map: it goes when the dog
  // does (a dog that never had a position has no card).
  const cardDog = useMemo(() => (selectedDogId == null || !active ? null
    : dogs.find(dog => dog.slaveId === selectedDogId && dog.coordinate) || null), [selectedDogId, active, dogs]);
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
  const readCardRows = useMemo(() => fixture?.readCardRows
    ?? (database?.dogCardRows ? (slaveId, since) => database.dogCardRows(cloudOwner ?? null, slaveId, since) : null),
  [fixture?.readCardRows, database, cloudOwner]);
  const readings = useDogCardReadings(cardOpen ? readCardRows : null, cardDog?.slaveId ?? null, now);
  const cardModel = useMemo(() => {
    if (!cardDog) return null;
    const freshness = dogFreshness(cardDog, { now, cloud: cloudClockInput, pauses });
    return dogCard(cardDog, {
      freshness,
      range: cloudDogs?.ranges?.[cardDog.slaveId] ?? null,
      battery: readings.battery,
      activity: readings.activity,
      phone: phoneReading(livePhone, now),
      now,
      reference: freshness.source === 'cloud' ? cloudClock(cloudClockInput, now) : now,
      name: dogName(cardDog.slaveId, dogAliases),
    });
  }, [cardDog, now, cloudClockInput, pauses, cloudDogs?.ranges, readings, livePhone, dogAliases]);
  const closedCard = useCallback(() => setSelected(current => (current?.kind === 'dog' ? null : current)), []);
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
    const heard = (history.devices || []).filter(pair => pair.slave === dog.slaveId).map(pair => pair.master);
    const masters = [...new Set([...heard, ...(dog.masterId != null ? [dog.masterId] : [])])];
    setTrackBusy(true);
    const generation = cardGeneration.current;
    const saved = await history.save({
      ...history.preferences,
      timeMode: 'fixed', startAt: start.getTime(), endAt: Math.max(now, start.getTime() + 60000),
      slaves: [dog.slaveId], client: true,
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
  const pillKey = JSON.stringify(todayPill({ route: todayRoute, livePhone, phone, now,
    waitingSince: waitingSince.current }));
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
      timeMode: 'fixed', startAt: start, endAt: end.getTime(),
      phone: true, client: false,
    });
    setRouteBusy(false);
    if (saved && liveInFront.current) onOpenHistory?.(null);
  }, [history, routeBusy, now, onOpenHistory]);
  // A5: the name is stored with the history preferences' names (dogAliases),
  // the face in dog_avatars; both by collar number, on this phone only.
  const saveName = async name => {
    if (!cardDog || !history?.save) return false;
    const aliases = { ...(history.preferences.dogAliases || {}), [cardDog.slaveId]: name };
    return !!(await history.save({ ...history.preferences, dogAliases: aliases }));
  };
  const saveAvatar = async avatar => {
    if (!cardDog || !dogAvatars?.save) return false;
    return !!(await dogAvatars.save(cardDog.slaveId, avatar));
  };
  const closePage = useCallback(() => setCardPage(null), []);
  const focusDog = useMemo(() => (cardDog && cardHeight && focusRequest?.slaveId === cardDog.slaveId
    ? { key: focusRequest.key, coordinate: cardDog.coordinate } : null),
  // Asked once per opening, after the card has its height.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [focusRequest, !!cardHeight, cardDog?.slaveId]);
  // History notices live in the history card, next to the controls that cause
  // them; the map keeps only what belongs to the map itself.
  const messages = [];
  if (historical && Number.isFinite(playbackAt))
    messages.push(`回放中：${new Date(playbackAt).toLocaleString()}`);
  // The base map, cloud sync and storage speak through the top cards and the
  // gear's red dot (A2); reading this phone's own copies can still fail.
  if (!historical && cloudDogs?.error)
    messages.push(`雲端定位讀取失敗：${cloudDogs.error}。下一輪自動重試。`);
  if (phone?.error)
    messages.push(`手機定位讀取失敗：${phone.error}。回到前景時會重試。`);
  if (
    historical && (history?.data?.phone.limited ||
      history?.data?.clients?.some(track => track.limited))
  )
    messages.push(
      '歷史軌跡已簡化顯示，保留各時段代表路段；完整資料仍保留，未顯示的斷續路段不會連線。',
    );
  if (tracking.errors[mode])
    messages.push(
      `讀取失敗：${tracking.errors[mode]}。${
        tracking.ready[mode]
          ? '保留最後讀取資料，前景自動重試。'
          : '資料庫尚未就緒，請重新啟動 App 重試。'
      }`,
    );
  else if (!tracking.ready[mode]) messages.push('正在準備 SQLite…');
  if (tracking.preferences.error)
    messages.push(`地圖設定讀取失敗：${tracking.preferences.error}。重新開啟 App 重試。`);
  const top = insets.top + 12;
  // The top cards hang 8dp under the gear (8dp under the status bar, 48dp).
  const gearTop = insets.top + layout.belowStatusBar;
  const cardsTop = gearTop + 48 + 8;
  const cardsBottom = cards.length && topHeight ? cardsTop + topHeight : 0;
  const noticesTop = cardsBottom ? cardsBottom + 8 : top + 44;
  const controlsTop = top + 44 + (messages.length ? noticeHeight + 8 : 0);
  // The compass: 12dp under the gear, or under the whole stack of cards.
  const compassTop = historical ? controlsTop + 12 : (cardsBottom || gearTop + 48) + 12;
  // The live map's padding stays put (an open card covers the map, it does
  // not move it); its buttons sit 12dp above the open card, else above the tabs.
  const mapBottom = historical ? bottomInset + (sheetHeight || SHEET_COLLAPSED_HEIGHT) + 12 : bottomInset;
  const coverBottom = !historical && cardHeight ? cardHeight + layout.floatingGap : 0;
  return (
    <View style={styles.root} testID="fullscreen-map-screen">
      <TrackingMap
        provider={mapProvider}
        // A screen fixture counts as a new source, so the map frames its dogs.
        source={historical ? 'history:' + history.key : fixture ? `${mode}:fixture:${fixture.name}` : mode}
        presentation={presentation}
        topInset={controlsTop}
        bottomInset={mapBottom}
        onMapState={setMapState}
        retryKey={mapRetry}
        failure={fixture?.mapFailure ?? null}
        coverTop={cardsBottom}
        compassTop={compassTop}
        onSnapshotReady={onSnapshotReady}
        livePhone={livePhone}
        foreground={tracking.foreground && active}
        appForeground={tracking.foreground}
        // A fixture switch (or a return to live data) reads the receiver
        // again: frame only once its link is known, so the ring is framed.
        // The first view also waits for the phone's first report (or a
        // moment), so it frames the phone with the local dogs.
        framingReady={historical || (receiverActive && receiverState !== undefined && phoneSettled)}
        dataReady={
          tracking.preferences.ready &&
          (tracking.initialSnapshotReady === true || !!tracking.errors[mode]) &&
          // The first fit waits for the receiver's identity (one native read),
          // so another receiver's stored position is never framed as ours.
          receiverState !== undefined
        }
        phoneEnabled={!!phone?.enabled}
        onDogPress={openDog}
        onTrackPress={openTrack}
        onMapPress={cardOpen ? pressMap : undefined}
        onHeading={setHeading}
        focusDog={focusDog}
        coverBottom={coverBottom}
        today={historical ? null : today}
        onToday={openMyRoute}
      />
      {!historical && (
        // Fixed under the status bar; it does not move with the card.
        <SettingsGear top={gearTop} alert={reasons.length > 0} alertLabel={gearLabel(reasons)}
          onPress={onOpenSettings} />
      )}
      <TopAlertCards cards={cards} top={cardsTop} onAction={pressCardAction} onClose={closeCard}
        onHeight={setTopHeight} />
      {(historical || !tracking.preferences.ready) && <View style={[styles.source, { top }]}>
        <View style={styles.statusDot} />
        <Text style={styles.sourceText}>
          {historical
            ? `歷史 · ${shortRangeLabel(history.preferences)}`
            : '讀取設定中…'}
        </Text>
      </View>}
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
      {historical && (
        <HistorySheet
          history={history}
          download={historyDownload}
          extras={<HistoryPlaybackControls playback={playback} />}
          snapshot={snapshot}
          bottomInset={bottomInset}
          topInset={controlsTop}
          onHeight={setSheetHeight}
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
      {cardModel && cardPage === 'activity' && (
        <ActivityPage name={cardModel.name} slaveId={cardModel.slaveId} database={database} owner={cloudOwner}
          active={active && tracking.foreground && !!tracking.ready?.real} dogAliases={dogAliases}
          onBack={closePage} />
      )}
      {cardModel && cardPage === 'edit' && (
        <DogProfile key={cardModel.slaveId} slaveId={cardModel.slaveId}
          name={displayName(cardModel.slaveId, dogAliases)} alias={dogAliases?.[cardModel.slaveId] || ''}
          avatar={avatars[cardModel.slaveId] || null} onSaveName={saveName} onSaveAvatar={saveAvatar}
          onBack={closePage} />
      )}
      {trackSubject && (
        <DeviceDetails
          activityOwner={cloudOwner}
          activityActive={active}
          tracking={tracking}
          subject={trackSubject}
          dogAliases={history?.preferences.dogAliases}
          topInset={controlsTop}
          bottomInset={bottomInset}
          onClose={closeDetails}
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
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
    left: 14,
    borderRadius: 20,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    ...floatingShadow,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.master,
    marginRight: 8,
  },
  sourceText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  notices: {
    position: 'absolute',
    zIndex: 20,
    left: 14,
    right: 14,
    maxHeight: 108,
    backgroundColor: '#FFFAF0',
    borderRadius: 12,
    padding: 10,
    ...floatingShadow,
  },
  noticeText: { color: '#75430B', fontSize: 12, lineHeight: 18 },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HistorySheet, { shortRangeLabel } from '../mapHistory/HistorySheet';
import HistoryPlaybackControls from '../mapHistory/HistoryPlaybackControls';
import { clipTrackTo } from '../mapHistory/HistoryPlayback';
import { useHistoryPlayback } from '../mapHistory/useHistoryPlayback';
import { useLiveLocation } from '../locationTracker/useLiveLocation';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackingMap from '../map/TrackingMap';
import { createTrackingMapPresentation } from '../map/TrackingMapPresentation';
import { mergeDogMarkers } from '../map/DogMerge';
import { cloudTracks, dogColor } from '../map/CloudTracks';
import TrackingSheet from '../map/TrackingSheet';
import Glyph from '../map/Glyph';
import { useMapClock } from '../map/useMapClock';
import DeviceDetails from '../map/DeviceDetails';
import { SHEET_COLLAPSED_HEIGHT } from '../map/SheetMotion';
import { floatingShadow, mapColors as colors } from '../map/MapTheme';

// The first fit frames what this handler is working with: the connected pair
// and the path inside the chosen window. Framing every cloud dog as well zoomed
// the map out to the whole county, where the path is a dot. With no BLE pair
// there is nothing local to frame, so the cloud dogs are what the map is for.
function homeCameraPositions(base, dogs, dogsVisible, dogPaths = []) {
  const drawn = [
    ...base.cameraPositions,
    ...base.masterSegments.flat(),
    ...base.slaveSegments.flat(),
    ...dogPaths.flatMap(track => track.segments.flat()),
  ];
  if (drawn.length) return drawn;
  return dogsVisible ? dogs.map(dog => dog.coordinate) : [];
}

// Close enough to read the street a dog is on.
const FOCUS_ZOOM = 17;
// The collar reports every few seconds over LoRa, and the cloud copy is pulled
// every 30 seconds while the App is open; anything older than these means the
// way in is not carrying data any more.
const BLE_LIVE_MS = 60000;
const CLOUD_LIVE_MS = 5 * 60000;

/** Whether one of the two ways in is carrying data, drawn rather than named. */
function LinkGlyph({ name, live, subject }) {
  return (
    <View
      accessible
      accessibilityLabel={`${subject}${live ? '有資料進來' : '沒有資料'}`}
      style={styles.link}
    >
      <Glyph name={name} color={live ? colors.green : colors.muted} size={20} />
    </View>
  );
}
// Roughly 150 m around a point, as a two-corner box for the opening camera.
const FRAME_DEGREES = 0.0015;
function framedCoordinates({ latitude, longitude }) {
  return [
    { latitude: latitude - FRAME_DEGREES, longitude: longitude - FRAME_DEGREES },
    { latitude: latitude + FRAME_DEGREES, longitude: longitude + FRAME_DEGREES },
  ];
}

export default function MapScreen({
  tracking,
  phone,
  bottomInset,
  mapProvider,
  active = true,
  history,
  historical = false,
  cloudDogs,
  historyDownload,
}) {
  const insets = useSafeAreaInsets();
  const snapshot = useRef(null);
  const onSnapshotReady = useCallback(value => { snapshot.current = value; }, []);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [mapStatus, setMapStatus] = useState(null);
  const [noticeHeight, setNoticeHeight] = useState(0);
  // Which marker's panel is open: the handler, or one dog by id. Both markers
  // answer a tap the same way.
  const [selected, setSelected] = useState(null);
  // Tapping a row takes the map there once. Following — the camera chasing one
  // dog until the row was tapped again — was a mode to remember on a screen
  // read at a glance, and it fought with panning.
  const [focus, setFocus] = useState(null);
  const focusId = useRef(0);
  const zoomTo = useCallback(coordinate => {
    if (!coordinate) return 0;
    focusId.current += 1;
    setFocus({ id: focusId.current, coordinate, zoom: FOCUS_ZOOM });
    return focusId.current;
  }, []);
  const closeDetails = useCallback(() => setSelected(null), []);
  const openMaster = useCallback(() => setSelected({ kind: 'master' }), []);
  // Read through a ref so the callback itself never changes: the map's marker
  // props feed effects that re-subscribe timers, and a handler with a new
  // identity on every render makes that queue grow faster than it drains.
  const session = useRef(tracking);
  session.current = tracking;
  const rememberDog = useCallback(slaveId => {
    const current = session.current;
    if (current.preferences.value.focusSlaveId !== slaveId)
      current.saveTrackingPreferences({ focusSlaveId: slaveId });
  }, []);
  const openDog = useCallback(slaveId => {
    rememberDog(slaveId);
    setSelected({ kind: 'dog', slaveId });
  }, [rememberDog]);
  const openTrack = useCallback(name => setSelected({ kind: 'track', name }), []);
  const { point, route, positionSamples, mode } = tracking;
  // Ageing is measured against this clock, not against the newest row: a silent
  // collar changes nothing else on this screen.
  const now = useMapClock(active && tracking.foreground);
  useEffect(() => {
    setSelected(null);
  }, [mode, point.masterId, tracking.preferences.value.showMasterMarker]);
  const basePresentation = useMemo(
    () =>
      createTrackingMapPresentation(
        point,
        route,
        positionSamples,
        tracking.preferences.value,
        now,
      ),
    [point, positionSamples, route, tracking.preferences.value, now],
  );
  // One marker per dog: the newest of the BLE feed and the downloaded cloud
  // rows. Demo positions stay isolated, so cloud dogs only join in real mode.
  // The eye hides the markers, not the list: the card must still say which dogs
  // reported and when.
  const dogs = useMemo(
    () => (mode === 'real'
      ? mergeDogMarkers({ point, samples: positionSamples, cloudRows: cloudDogs?.rows, now,
        windowMs: tracking.preferences.value.windowMinutes * 60000 })
      : []),
    [mode, point, positionSamples, cloudDogs?.rows,
      tracking.preferences.value.windowMinutes, now],
  );
  // The live feed only holds the pair this phone is connected to, so the dogs
  // that arrived through the cloud draw their path from the downloaded copy.
  const dogPaths = useMemo(() => {
    if (!tracking.preferences.value.showTrails || mode !== 'real') return [];
    const since = now - tracking.preferences.value.windowMinutes * 60000;
    return cloudTracks(cloudDogs?.track, { since })
      .filter(track => track.slaveId !== point.slaveId)
      .map(track => ({ ...track, color: dogColor(track.slaveId) }));
  }, [cloudDogs?.track, mode, now, point.slaveId,
    tracking.preferences.value.showTrails, tracking.preferences.value.windowMinutes]);
  const dogsVisible = tracking.preferences.value.showSlaveMarker;
  const lastTappedSlaveId = tracking.preferences.value.focusSlaveId;
  const hiddenSlaveIds = tracking.preferences.value.hiddenSlaveIds;
  // The map opens where the handler last looked: the dog they tapped, else the
  // dog this phone is connected to over BLE, else one the cloud knows about.
  // Opening on the whole working area meant finding the dog again every time.
  const openingDog = useMemo(() => {
    const placed = dogs.filter(dog =>
      dog.coordinate && !hiddenSlaveIds.includes(dog.slaveId));
    return placed.find(dog => dog.slaveId === lastTappedSlaveId)
      || placed.find(dog => dog.source === 'ble')
      || placed[0]
      || null;
  }, [dogs, hiddenSlaveIds, lastTappedSlaveId]);
  // The framing is only read when the map mounts, and on a cold start only the
  // BLE dog exists that early — the cloud ones arrive a second later. So the
  // move is made explicitly, and once the remembered dog does turn up the
  // camera is allowed to correct itself exactly once. Any move the handler
  // makes ends it: their camera, not ours.
  const opened = useRef({ slaveId: null, focusId: 0 });
  useEffect(() => {
    if (historical || !active || !openingDog) return;
    if (focus && focus.id !== opened.current.focusId) return;
    if (opened.current.slaveId === openingDog.slaveId) return;
    if (opened.current.slaveId !== null && openingDog.slaveId !== lastTappedSlaveId) return;
    opened.current = {
      slaveId: openingDog.slaveId, focusId: zoomTo(openingDog.coordinate),
    };
  }, [active, focus, historical, lastTappedSlaveId, openingDog, zoomTo]);
  const livePresentation = useMemo(() => {
    if (!dogs.length) return basePresentation;
    // A dog hidden by its own eye leaves the map but stays in the card.
    const drawn = dogs.filter(dog => !hiddenSlaveIds.includes(dog.slaveId));
    return {
      ...basePresentation,
      // dogs replaces the single slave marker; positions stays untouched so the
      // card and camera keep reading the connected pair.
      slave: null,
      dogs: dogsVisible ? drawn : [],
      // Hidden dogs take their line with them, like the markers.
      dogPaths: dogsVisible
        ? dogPaths.filter(track => !hiddenSlaveIds.includes(track.slaveId))
        : [],
      // A single coordinate makes a degenerate box, which Android fits at
      // maximum zoom; frame a small square around the dog instead.
      cameraPositions: dogsVisible && openingDog
        ? framedCoordinates(openingDog.coordinate)
        : homeCameraPositions(basePresentation, drawn, dogsVisible, dogPaths),
    };
  }, [basePresentation, dogPaths, dogs, dogsVisible, hiddenSlaveIds, openingDog]);
  const livePhone = useLiveLocation(active && tracking.foreground);
  const playback = useHistoryPlayback(history?.data, history?.key, historical);
  const playbackAt = playback.at;
  const presentation = useMemo(() => {
    // The live map is live only: what it draws is decided by the card's own
    // eyes and time window, never by the history tab's parameters.
    if (!historical) return { ...livePresentation, focus };
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
        name: `狗 ${track.slaveId}`,
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
    return { positions: {}, master: null, slave: null, masterSegments: [], slaveSegments: [], masterRangeMeters: 0, cameraPositions, historyTracks: tracks, focus };
  }, [focus, historical, history?.data, history?.preferences.source, livePresentation,
    playbackAt]);
  const { master, slave } = presentation.positions;
  // Read from the merged dogs, which carry the app's own camelCase model: the
  // rows straight out of SQLite are snake_case, so `receivedAt` on them is
  // undefined and the cloud icon was grey while the cloud was updating.
  const newestFrom = source => Math.max(0, ...dogs
    .filter(dog => dog.source === source)
    .map(dog => (Number.isFinite(dog.receivedAt) ? dog.receivedAt : 0)));
  const newestBle = Math.max(newestFrom('ble'),
    Number.isFinite(point.receivedAt) ? point.receivedAt : 0);
  const newestCloud = newestFrom('cloud');
  const bleLive = newestBle > 0 && now - newestBle < BLE_LIVE_MS;
  const cloudLive = !cloudDogs?.error && newestCloud > 0 && now - newestCloud < CLOUD_LIVE_MS;
  // A panel closes itself when its subject leaves the map: a dog that stopped
  // reporting, or the handler's marker being hidden.
  const detailSubject = useMemo(() => {
    if (!selected) return null;
    if (historical) {
      if (selected.kind !== 'track') return null;
      const track = (presentation.historyTracks || [])
        .find(item => item.name === selected.name);
      return track ? { kind: 'track', track } : null;
    }
    if (selected.kind === 'master') return master ? { kind: 'master' } : null;
    const dog = dogs.find(item => item.slaveId === selected.slaveId);
    return dog ? { kind: 'dog', dog } : null;
  }, [selected, historical, master, dogs, presentation.historyTracks]);
  // History notices live in the history card, next to the controls that cause
  // them; the map keeps only what belongs to the map itself.
  // The card names the colours next to the eyes that control them; a banner
  // over the map only covered the map.
  const messages = [];
  if (historical && Number.isFinite(playbackAt))
    messages.push(`回放中：${new Date(playbackAt).toLocaleString()}`);
  if (mapStatus) messages.push(mapStatus);
  if (!historical && cloudDogs?.error)
    messages.push(`雲端定位讀取失敗：${cloudDogs.error}。下一輪自動重試。`);
  // Which dog came from where is written on its row in the card and in its
  // panel; repeating it over the map only covered the map.
  if (phone?.error)
    messages.push(`手機定位讀取失敗：${phone.error}。回到前景時會重試。`);
  if (
    route.limited &&
    tracking.preferences.value.showTrails &&
    (tracking.preferences.value.showMasterMarker ||
      tracking.preferences.value.showSlaveMarker)
  )
    messages.push(
      '首頁路徑已達繪圖上限，僅顯示較新的部分；此繪圖限制不會刪除 DB 資料。',
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
  if (tracking.realWriteError)
    messages.push(
      `正式資料儲存失敗：${tracking.realWriteError}。部分硬體資料未能儲存，不會自動重送。`,
    );
  if (mode === 'demo' && tracking.demoError)
    messages.push(`${tracking.demoError}。請至設定 → Demo 設定處理。`);
  if (tracking.preferences.error)
    messages.push(
      `追蹤設定失敗：${tracking.preferences.error}。請上滑卡片重試。`,
    );
  if (master?.retained || slave?.retained)
    messages.push(
      `${[master?.retained && '領犬員', slave?.retained && '狗']
        .filter(Boolean)
        .join('、')}顯示最後有效位置，非最新定位。`,
    );
  const top = insets.top + 12;
  const controlsTop = top + 44 + (messages.length ? noticeHeight + 8 : 0);
  return (
    <View style={styles.root} testID="fullscreen-map-screen">
      <TrackingMap
        provider={mapProvider}
        source={historical ? 'history:' + history.key : mode}
        presentation={presentation}
        topInset={controlsTop}
        bottomInset={bottomInset + (sheetHeight || SHEET_COLLAPSED_HEIGHT) + 12}
        onStatus={setMapStatus}
        onSnapshotReady={onSnapshotReady}
        livePhone={livePhone}
        foreground={tracking.foreground && active}
        appForeground={tracking.foreground}
        dataReady={
          tracking.preferences.ready &&
          (tracking.initialSnapshotReady === true || !!tracking.errors[mode])
        }
        phoneEnabled={!!phone?.enabled}
        onMasterPress={openMaster}
        onDogPress={openDog}
        onTrackPress={openTrack}
      />
      <View style={[styles.source, { top }]}>
        {historical || mode === 'demo' ? (
          <>
            <View style={[styles.statusDot, mode === 'demo' && styles.demoDot]} />
            <Text style={styles.sourceText}>
              {historical ? `歷史 · ${shortRangeLabel(history.preferences)}` : 'DEMO'}
            </Text>
          </>
        ) : (
          // Which of the two ways in is alive, as icons: the words said the
          // storage engine, which is never the question being asked.
          <>
            <LinkGlyph name="ble" live={bleLive} subject="Master BLE" />
            <LinkGlyph name="cloud" live={cloudLive} subject="雲端" />
          </>
        )}
      </View>
      {!!messages.length && (
        <View
          onLayout={event => setNoticeHeight(event.nativeEvent.layout.height)}
          style={[styles.notices, { top: top + 44 }]}
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
      {historical ? (
        <HistorySheet
          history={history}
          download={historyDownload}
          extras={<HistoryPlaybackControls playback={playback} />}
          snapshot={snapshot}
          bottomInset={bottomInset}
          topInset={controlsTop}
          onHeight={setSheetHeight}
        />
      ) : (
        <TrackingSheet
          tracking={tracking}
          onZoom={zoomTo}
          onDetails={setSelected}
          onRememberDog={rememberDog}
          master={master}
          slave={slave}
          dogs={dogs}
          bottomInset={bottomInset}
          topInset={controlsTop}
          onHeight={setSheetHeight}
        />
      )}
      {detailSubject && (
        <DeviceDetails
          tracking={tracking}
          subject={detailSubject}
          master={master}
          topInset={controlsTop}
          bottomInset={bottomInset + SHEET_COLLAPSED_HEIGHT}
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
  link: { paddingHorizontal: 4 },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.master,
    marginRight: 8,
  },
  demoDot: { backgroundColor: colors.dog },
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

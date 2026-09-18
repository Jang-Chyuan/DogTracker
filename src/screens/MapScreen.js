import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HistoryExportButton from '../mapHistory/HistoryExportButton';
import { useLiveLocation } from '../locationTracker/useLiveLocation';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TrackingMap from '../map/TrackingMap';
import { createTrackingMapPresentation } from '../map/TrackingMapPresentation';
import TrackingSheet from '../map/TrackingSheet';
import MasterDetails from '../map/MasterDetails';
import { SHEET_COLLAPSED_HEIGHT } from '../map/SheetMotion';
import { floatingShadow, mapColors as colors } from '../map/MapTheme';

export default function MapScreen({
  tracking,
  phone,
  bottomInset,
  mapProvider,
  active = true,
  history,
}) {
  const insets = useSafeAreaInsets();
  const snapshot = useRef(null);
  const onSnapshotReady = useCallback(value => { snapshot.current = value; }, []);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [mapStatus, setMapStatus] = useState(null);
  const [noticeHeight, setNoticeHeight] = useState(0);
  const [masterSelected, setMasterSelected] = useState(false);
  const closeMaster = useCallback(() => setMasterSelected(false), []);
  const openMaster = useCallback(() => setMasterSelected(true), []);
  const { point, route, positionSamples, mode } = tracking;
  useEffect(() => {
    setMasterSelected(false);
  }, [mode, point.masterId, tracking.preferences.value.showMasterMarker]);
  const livePresentation = useMemo(
    () =>
      createTrackingMapPresentation(
        point,
        route,
        positionSamples,
        tracking.preferences.value,
      ),
    [point, positionSamples, route, tracking.preferences.value],
  );
  const historical = !!history?.preferences.enabled;
  const livePhone = useLiveLocation(active && tracking.foreground);
  const presentation = useMemo(() => {
    if (!historical) return history?.preferences.client === false
      ? { ...livePresentation, slave: null, slaveSegments: [],
        cameraPositions: livePresentation.master ? [livePresentation.master.coordinate] : [] }
      : livePresentation;
    const data = history.data;
    const tracks = data ? [
      { ...data.phone, name: '手機', color: '#2563EB' },
      { ...data.client, name: 'Client', color: '#E45756' },
    ] : [];
    const points = tracks.flatMap(track => track.segments.flat());
    const cameraPositions = [];
    if (points.length) {
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      for (const p of points) { minLat = Math.min(minLat, p.latitude); maxLat = Math.max(maxLat, p.latitude); minLon = Math.min(minLon, p.longitude); maxLon = Math.max(maxLon, p.longitude); }
      cameraPositions.push({ latitude: minLat, longitude: minLon }, { latitude: maxLat, longitude: maxLon });
    }
    return { positions: {}, master: null, slave: null, masterSegments: [], slaveSegments: [], masterRangeMeters: 0, cameraPositions, historyTracks: tracks };
  }, [historical, history?.data, history?.preferences.client, livePresentation]);
  const { master, slave } = presentation.positions;
  const messages = [];
  if (historical) {
    if (history.error) messages.push(history.error);
    else if (!history.data) messages.push('正在讀取歷史定位…');
    else {
      if (history.data.message) messages.push(history.data.message);
      messages.push(`手機 ${history.data.phone.count} 筆 · Client ${history.data.client.count} 筆（藍色／紅色）`);
      messages.push(`${new Date(history.data.since).toLocaleString()} ～ ${new Date(history.data.until).toLocaleString()}`);
      if (history.data.phone.limited || history.data.client.limited) messages.push('軌跡已達繪圖上限，僅顯示較新的部分，原始資料仍保留。');
    }
  }
  if (mapStatus) messages.push(mapStatus);
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
      />
      {historical && active && <HistoryExportButton history={history} snapshot={snapshot} top={controlsTop + 8} />}
      <View style={[styles.source, { top }]}>
        <View style={[styles.statusDot, mode === 'demo' && styles.demoDot]} />
        <Text style={styles.sourceText}>
          {historical ? `歷史 · ${history.preferences.timeMode === 'fixed' ? '指定區間' : '最近'} ${history.preferences.hours} 小時` : !tracking.preferences.ready
            ? '讀取設定中…'
            : mode === 'demo'
            ? 'DEMO · 模擬資料'
            : '正式 · SQLite'}
        </Text>
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
      {!historical && <TrackingSheet
        tracking={tracking}
        master={master}
        slave={slave}
        bottomInset={bottomInset}
        topInset={controlsTop}
        onHeight={setSheetHeight}
      />}
      {masterSelected && presentation.master && (
        <MasterDetails
          tracking={tracking}
          master={master}
          topInset={controlsTop}
          bottomInset={bottomInset + SHEET_COLLAPSED_HEIGHT}
          onClose={closeMaster}
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

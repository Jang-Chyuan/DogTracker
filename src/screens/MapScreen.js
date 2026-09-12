import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
}) {
  const insets = useSafeAreaInsets();
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
  const presentation = useMemo(
    () =>
      createTrackingMapPresentation(
        point,
        route,
        positionSamples,
        tracking.preferences.value,
      ),
    [point, positionSamples, route, tracking.preferences.value],
  );
  const { master, slave } = presentation.positions;
  const messages = [];
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
        source={mode}
        presentation={presentation}
        topInset={controlsTop}
        bottomInset={bottomInset + (sheetHeight || SHEET_COLLAPSED_HEIGHT) + 12}
        onStatus={setMapStatus}
        foreground={tracking.foreground && active}
        dataReady={
          tracking.preferences.ready &&
          (tracking.initialSnapshotReady === true || !!tracking.errors[mode])
        }
        phoneEnabled={!!phone?.enabled}
        onMasterPress={openMaster}
      />
      <View style={[styles.source, { top }]}>
        <View style={[styles.statusDot, mode === 'demo' && styles.demoDot]} />
        <Text style={styles.sourceText}>
          {!tracking.preferences.ready
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
      <TrackingSheet
        tracking={tracking}
        master={master}
        slave={slave}
        bottomInset={bottomInset}
        topInset={controlsTop}
        onHeight={setSheetHeight}
      />
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

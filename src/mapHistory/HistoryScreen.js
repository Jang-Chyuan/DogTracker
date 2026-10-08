// The v3 history screen over the map (055a: one dog or my route; H1/H2/H2b/
// H3a/H8): the top capsule row (‹ 回到現在, the dog or 「我的路線」, ＋ 加入,
// the export icon), and the bottom panel with the date row, the range
// summary (and its range bar) and the time-line list. The map itself draws
// useHistoryScreen's presentation (GoogleTrackingMap).
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import Glyph from '../map/Glyph';
import { MapTip, PressScale } from '../map/MapControls';
import { emptyText } from '../history/HistoryText';
import { dateRowLabel } from '../history/screen/HistoryScreenDates';
import { colors, layout, motion, radius, shadow, size as sizes, space, touch, type } from '../theme/tokens';
import HistoryPanel from './HistoryPanel';
import HistoryRangeSummary from './HistoryRangeSummary';
import HistoryTimelineList from './HistoryTimelineList';
import HistoryExportDialog from './HistoryExportDialog';
import HistoryCalendarSheet from './HistoryCalendarSheet';

const OPEN_MOTION = LayoutAnimation.create(motion.rangeExpand.duration, LayoutAnimation.Types.easeOut,
  LayoutAnimation.Properties.opacity);
const CLOSE_MOTION = LayoutAnimation.create(motion.rangeCollapse.duration, LayoutAnimation.Types.easeOut,
  LayoutAnimation.Properties.opacity);

function Capsule({ children, onPress, testID, label, style, disabled }) {
  const body = <View style={[styles.capsule, style]}>{children}</View>;
  if (!onPress) return <View testID={testID} accessible accessibilityLabel={label}>{body}</View>;
  return (
    <PressScale testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      disabled={disabled} hitSlop={6}>
      {body}
    </PressScale>
  );
}

/** The top row: ‹ 回到現在, the dog (or 我的路線), ＋ 加入; the export icon right. */
function TopRow({ top, subject, name, avatar, color, onBack, onExport, exportEnabled, exportLabel = '匯出' }) {
  return (
    <View style={[styles.topRow, { top }]} pointerEvents="box-none">
      <View style={styles.capsules} pointerEvents="box-none">
        <Capsule testID="history-back-now" label="回到現在" onPress={onBack}>
          <Text style={styles.backText}>‹ 回到現在</Text>
        </Capsule>
        {subject === 'phone' ? (
          <Capsule testID="history-target" label="我的路線"><Text style={styles.capsuleText}>我的路線</Text></Capsule>
        ) : (
          <>
            {/* The protagonist wears a 2dp outline in its route colour. */}
            <Capsule testID="history-target" label={name} style={[styles.dogCapsule, { borderColor: color }]}>
              <DogAvatar avatar={avatar} size={sizes.chip.avatar} border={0} />
              <Text style={styles.capsuleText} numberOfLines={1}>{name}</Text>
            </Capsule>
            {/* More dogs come with 055b; the capsule is there, it adds nothing yet. */}
            <Capsule testID="history-add" label="加入（下一版）"><Text style={styles.capsuleText}>＋ 加入</Text></Capsule>
          </>
        )}
      </View>
      <PressScale testID="history-export" accessibilityRole="button" accessibilityLabel={exportLabel}
        accessibilityState={{ disabled: !exportEnabled }} disabled={!exportEnabled} onPress={onExport}
        style={[styles.exportButton, !exportEnabled && styles.disabled]}>
        <Glyph name="share" color={exportEnabled ? colors.text : colors.iconMuted} size={sizes.icon.map} />
      </PressScale>
    </View>
  );
}

/** ‹ 10/03（六）今天 ▾ › (H3a); the date opens the calendar (H3b). */
function DateRow({ day, todayStart, navigation, onPrevious, onNext, onOpen }) {
  const label = dateRowLabel(day, todayStart);
  const arrow = (side, enabled, onPress) => (
    <Pressable testID={`history-day-${side}`} accessibilityRole="button"
      accessibilityLabel={side === 'previous' ? '前一個有紀錄的日子' : '後一個有紀錄的日子'}
      accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onPress} style={styles.dayArrow}>
      <Glyph name={side === 'previous' ? 'back' : 'chevron'} color={enabled ? colors.text : colors.line}
        size={20} />
    </Pressable>
  );
  return (
    <View style={styles.dateRow}>
      {arrow('previous', !!navigation.previous, onPrevious)}
      <PressScale testID="history-date" accessibilityRole="button" accessibilityLabel={label}
        accessibilityHint="打開月曆選日期" onPress={onOpen} style={styles.datePill}>
        <Text style={styles.dateText}>{label}</Text>
        <Text style={styles.dateCaret}> ▾</Text>
      </PressScale>
      {arrow('next', !!navigation.next, onNext)}
    </View>
  );
}

/** H3c: 「下載 9/28 的紀錄…」「只有雲端有，正在下載」 and 取消, where the summary goes. */
function DownloadSummary({ panel, onCancel }) {
  return (
    <View style={styles.download} testID="history-downloading" accessibilityLiveRegion="polite">
      <View style={styles.downloadText}>
        <Text style={styles.downloadTitle}>{panel.title}</Text>
        <Text style={styles.downloadDetail}>{panel.detail}</Text>
      </View>
      <Pressable testID="history-download-cancel" accessibilityRole="button" accessibilityLabel="取消下載"
        onPress={onCancel} style={styles.textButton} hitSlop={8}>
        <Text style={styles.textButtonText}>{panel.action}</Text>
      </Pressable>
    </View>
  );
}

/** While the day downloads: grey lines where the list will be (no motion). */
function Skeleton() {
  return (
    <View style={styles.skeleton} testID="history-skeleton" accessible={false}>
      {['70%', '45%', '80%', '55%'].map(width => <View key={width} style={[styles.skeletonLine, { width }]} />)}
    </View>
  );
}

/** 資料不完整　重試: a cancelled or failed download left part of the day. */
function IncompleteRow({ panel, onRetry }) {
  return (
    <View style={styles.incomplete} testID="history-incomplete">
      <Text style={styles.incompleteText}>{panel.text}</Text>
      <Pressable testID="history-download-retry" accessibilityRole="button" accessibilityLabel="重試下載"
        onPress={onRetry} style={styles.textButton} hitSlop={8}>
        <Text style={styles.textButtonText}>{panel.action}</Text>
      </Pressable>
    </View>
  );
}

/** The 框住全部 button on the panel's top edge (the only map button in history). */
function FrameButton({ onPress }) {
  return (
    <PressScale testID="history-frame-all" accessibilityRole="button" accessibilityLabel="框住全部"
      accessibilityHint="把範圍裡的路線放進畫面" onPress={onPress} style={styles.frameButton}>
      <Glyph name="frame" color={colors.text} size={sizes.icon.map} />
    </PressScale>
  );
}

/**
 * `screen` is useHistoryScreen's. Ref: { back() } — 返回鍵 inside the screen
 * (the range bar closes, the panel comes down from 75%); false when the key
 * should leave the history. { mapPressed() } closes the range bar.
 */
const HistoryScreen = forwardRef(function HistoryScreen({ screen, name = '', avatar = null, top, levels, bottomInset,
  onBack, onFrame, onLevel, history, snapshot, closedAt = null, initialRangeOpen = false, initialCalendar = null }, ref) {
  const panel = useRef(null);
  const list = useRef(null);
  const rows = useRef({});
  const [rangeOpen, setRangeOpen] = useState(initialRangeOpen);
  const raised = useRef(false);
  const [exporting, setExporting] = useState(false);
  // initialCalendar ('month' | 'months'): a screen fixture opens on H3b / H3e.
  const [calendarOpen, setCalendarOpen] = useState(!!initialCalendar);
  const calendar = useRef(null);
  // H3d's 「沒有網路，9/28 的紀錄還沒下載，連上網路再試」 (over the sheet or the panel).
  const [tip, setTip] = useState(null);
  const showTip = useCallback(text => { if (text) setTip({ text, key: Date.now() }); }, []);
  const hideTip = useCallback(() => setTip(null), []);
  const { model, subject, cursor, download } = screen;
  const downloading = download?.kind === 'downloading';
  const empty = !!model && !model.dayRecords;
  const hasRoute = !!model?.points.length && !downloading;
  const openRange = useCallback(next => {
    LayoutAnimation.configureNext(next ? OPEN_MOTION : CLOSE_MOTION);
    setRangeOpen(next);
    if (next && panel.current?.level === 'summary') {
      // 判定表「只留摘要時點摘要」: up to half first, then the bar.
      raised.current = true;
      panel.current.setLevel('half');
    } else if (!next && raised.current) {
      raised.current = false;
      panel.current?.setLevel('summary');
    }
  }, []);
  const closeRange = useCallback(() => { if (rangeOpen) openRange(false); }, [rangeOpen, openRange]);
  useImperativeHandle(ref, () => ({
    back: () => {
      if (exporting) { setExporting(false); return true; }
      // 選月份 → 選日期 → closed (返回鍵 table).
      if (calendarOpen) return calendar.current?.back() ?? false;
      // 下載中按返回＝取消: what arrived stays, 「資料不完整　重試」.
      if (downloading) { screen.cancelDownload(); return true; }
      if (rangeOpen) { openRange(false); return true; }
      return !!panel.current?.back();
    },
    mapPressed: closeRange,
  }), [exporting, calendarOpen, downloading, screen, rangeOpen, openRange, closeRange]);
  const step = useCallback(move => {
    closeRange();
    const result = move();
    if (result?.type === 'offline') showTip(result.message);
  }, [closeRange, showTip]);
  const openCalendar = useCallback(() => {
    closeRange();
    setTip(null);
    setCalendarOpen(true);
  }, [closeRange]);
  const retry = useCallback(() => {
    const result = screen.retryDownload();
    if (result?.type === 'offline') showTip(result.message);
  }, [screen, showTip]);
  // A new day, or a day without a route, closes the bar.
  // The row of a stop number tapped on the map scrolls into view.
  const focusKey = screen.focus?.key;
  useEffect(() => {
    if (!focusKey || screen.focus.action !== 'stop') return;
    const y = rows.current[screen.pressed];
    if (y != null) list.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    // Once per tap.
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The row the cursor is on: a pressed row, else the stay it is in.
  const cursorTime = cursor?.point?.time;
  const stay = cursorTime == null ? null : model?.locations.find(n => ['stop', 'indoor'].includes(n.type)
    && cursorTime >= n.start && cursorTime <= n.end);
  const selected = screen.pressed ?? stay?.start ?? null;
  const pressNode = useCallback(node => {
    closeRange();
    const action = ['movement', 'gap'].includes(node.type) ? 'route' : 'node';
    screen.moveCursor(node.start, action, action === 'node' || node.type === 'gap' ? node : null);
  }, [closeRange, screen]);
  const dragStart = useCallback(() => {
    raised.current = false;
    closeRange();
  }, [closeRange]);
  const panelLevel = useCallback((level, height) => {
    // Dragged by hand: the bar no longer takes it back down.
    onLevel?.(level, height);
  }, [onLevel]);
  const header = (
    <View>
      <DateRow day={screen.day} todayStart={screen.todayStart} navigation={screen.navigation}
        onPrevious={() => step(screen.previousDay)} onNext={() => step(screen.nextDay)} onOpen={openCalendar} />
      {downloading && <DownloadSummary panel={download} onCancel={screen.cancelDownload} />}
      {download?.kind === 'incomplete' && <IncompleteRow panel={download} onRetry={retry} />}
      {hasRoute && (
        <HistoryRangeSummary model={model} subject={subject} range={screen.range} track={screen.track}
          today={screen.today} open={rangeOpen} onToggle={() => openRange(!rangeOpen)}
          onDrag={screen.dragRange} onCommit={screen.commitRange} closedAt={closedAt} />
      )}
    </View>
  );
  let body;
  if (downloading) body = <Skeleton />;
  else if (download?.kind === 'unfinished' && !model?.dayRecords) {
    // Not H8: the day is not known to be empty (判定表「下載取消或失敗、手機裡又完全沒有」).
    body = (
      <View style={styles.unfinished} testID="history-unfinished">
        <Text style={styles.unfinishedText}>{download.text}</Text>
        <PressScale testID="history-download-retry" accessibilityRole="button" accessibilityLabel="重試下載"
          onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>{download.action}</Text>
        </PressScale>
      </View>
    );
  } else if (screen.error) body = <Text style={styles.empty}>{screen.error}</Text>;
  else if (!model) body = <Text style={styles.empty}>讀取中…</Text>;
  else if (empty) body = <Text style={styles.empty} testID="history-empty">{emptyText({ subject, today: screen.today, name })}</Text>;
  else if (!hasRoute) body = <Text style={styles.empty}>這段時間沒有紀錄</Text>;
  else {
    body = (
      <View style={styles.list}>
        <HistoryTimelineList model={model} color={screen.color} selected={selected} onPressNode={pressNode}
          onRowLayout={(start, y) => { rows.current[start] = y; }} />
      </View>
    );
  }
  return (
    <>
      <TopRow top={top} subject={subject} name={name} avatar={avatar} color={screen.color} onBack={onBack}
        exportEnabled={hasRoute && !!history} onExport={() => setExporting(true)}
        exportLabel={hasRoute ? '匯出' : downloading ? '匯出，無法使用，正在下載'
          : empty ? '匯出，無法使用，這天沒有紀錄' : model ? '匯出，無法使用，這段時間沒有紀錄' : '匯出，無法使用'} />
      <HistoryPanel ref={panel} levels={levels} header={header} onLevel={panelLevel} onDragStart={dragStart}
        bottomInset={bottomInset} scrollRef={list} locked={empty || !model || downloading}
        above={hasRoute ? <FrameButton onPress={onFrame} /> : null}>
        <Pressable onPress={closeRange} disabled={!rangeOpen} accessible={false}>{body}</Pressable>
      </HistoryPanel>
      {history && (
        <HistoryExportDialog history={history} snapshot={snapshot} visible={exporting}
          onClose={() => setExporting(false)} />
      )}
      {calendarOpen && (
        <HistoryCalendarSheet ref={calendar} screen={screen} bottomInset={bottomInset} onOffline={showTip}
          initialView={initialCalendar}
          onClosed={() => setCalendarOpen(false)} />
      )}
      <MapTip message={tip} bottom={bottomInset + space.l} onDone={hideTip} strong />
    </>
  );
});

export default HistoryScreen;

const styles = StyleSheet.create({
  topRow: { position: 'absolute', left: layout.screenEdge, right: layout.screenEdge, zIndex: 30,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  capsules: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  capsule: { height: sizes.chip.height, borderRadius: sizes.chip.height / 2, paddingHorizontal: sizes.chip.paddingH,
    backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6, ...shadow.floating },
  dogCapsule: { borderWidth: sizes.chip.leadBorder, paddingHorizontal: sizes.chip.paddingH - sizes.chip.leadBorder },
  backText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  capsuleText: { color: colors.text, fontSize: 16, fontWeight: '700', maxWidth: 120 },
  exportButton: { width: sizes.floatingButton, height: sizes.floatingButton, borderRadius: sizes.floatingButton / 2,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.floating },
  disabled: { opacity: 0.6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingBottom: 4 },
  dayArrow: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  datePill: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 18, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.line, marginHorizontal: 12 },
  dateText: { color: colors.text, fontSize: 17, fontWeight: '700' },
  dateCaret: { color: colors.text, fontSize: 13 },
  frameButton: { width: sizes.floatingButton, height: sizes.floatingButton, borderRadius: sizes.floatingButton / 2,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.floating },
  list: { paddingTop: 8, paddingRight: 16 },
  download: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, paddingTop: space.xs,
    paddingBottom: space.s, gap: space.s },
  downloadText: { flex: 1, minWidth: 0 },
  downloadTitle: { ...type.title, color: colors.text },
  downloadDetail: { ...type.value, fontWeight: '400', color: colors.textMuted, marginTop: 2 },
  textButton: { minHeight: touch.min, minWidth: touch.min, alignItems: 'flex-end', justifyContent: 'center' },
  textButtonText: { ...type.status, color: colors.tonalText },
  skeleton: { paddingHorizontal: space.l, paddingTop: space.l },
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: colors.line, marginBottom: space.m },
  incomplete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.l, minHeight: touch.min },
  incompleteText: { ...type.value, color: colors.textMuted },
  unfinished: { alignItems: 'center', paddingVertical: layout.emptyStatePadding, paddingHorizontal: space.l,
    gap: space.l },
  unfinishedText: { color: colors.textMuted, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  retryButton: { height: touch.min, paddingHorizontal: space.xl, borderRadius: radius.button,
    backgroundColor: colors.tonal, alignItems: 'center', justifyContent: 'center' },
  retryButtonText: { ...type.status, color: colors.tonalText },
  // 判定表「空狀態文字」: the middle of the panel, 32dp above and below.
  empty: { color: colors.textMuted, fontSize: 16, fontWeight: '700', textAlign: 'center',
    paddingVertical: layout.emptyStatePadding, paddingHorizontal: 16 },
});

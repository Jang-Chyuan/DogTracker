// The v3 history screen over the map (055a/055b: one dog, 2–4 dogs or my
// route; H1/H2/H2b/H3a/H7/H8): the top capsule row (‹ 回到現在, the dogs or
// 「我的路線」, ＋ 加入, the export icon), and the bottom panel with the date
// row, the range summary (and its range bar), the time-line list of the
// protagonist and, for dogs, 資料來源 at its foot. The map itself draws
// useHistoryScreen's presentation (GoogleTrackingMap).
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { AddDogSheet, SourceSheet } from './HistoryPickers';
import { sourceLabel } from '../history/screen/HistoryMultiSources';

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

/** A dog's chip: its face, name and ✕; the protagonist outlined in its route colour. */
function DogChip({ dog, name, onPress, onRemove, onLayout }) {
  const faded = !dog.hasData;
  return (
    <PressScale onLayout={onLayout} testID={`history-dog-${dog.id}`} accessibilityRole="button"
      accessibilityLabel={`${name}${dog.protagonist ? '，目前看的狗' : ''}${faded ? '，這段時間沒有紀錄' : ''}`}
      accessibilityState={{ selected: dog.protagonist }} onPress={onPress} hitSlop={6}>
      <View style={[styles.capsule, styles.dogCapsule, { borderColor: dog.protagonist ? dog.color : colors.surface },
        faded && styles.faded]}>
        <DogAvatar avatar={dog.avatar} size={sizes.chip.avatar} border={0} />
        <Text style={styles.capsuleText} numberOfLines={1}>{name}</Text>
        {dog.removable && (
          <Pressable testID={`history-remove-${dog.id}`} accessibilityRole="button" accessibilityLabel={`移除${name}`}
            onPress={onRemove} hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }} style={styles.remove}>
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        )}
      </View>
    </PressScale>
  );
}

/**
 * The top row: ‹ 回到現在 (fixed left), the dogs and ＋ 加入 (scrolling
 * sideways when they do not fit) or 「我的路線」; the export icon fixed right.
 */
function TopRow({ top, subject, dogs, nameOf, full, onBack, onExport, onSelect, onRemove, onAdd, exportEnabled,
  exportLabel = '匯出' }) {
  // The protagonist's chip is scrolled into view when it changes (a face
  // tapped on the map can lead to a chip out of sight).
  const scroller = useRef(null);
  const places = useRef({});
  const lead = dogs.find(dog => dog.protagonist)?.id;
  useEffect(() => {
    const place = places.current[lead];
    if (place) scroller.current?.scrollTo({ x: Math.max(0, place.x - 8), animated: true });
  }, [lead]);
  return (
    <View style={[styles.topRow, { top }]} pointerEvents="box-none">
      <Capsule testID="history-back-now" label="回到現在" onPress={onBack}>
        <Text style={styles.backText}>‹ 回到現在</Text>
      </Capsule>
      {subject === 'phone' ? (
        <View style={[styles.middle, styles.chips]} pointerEvents="box-none">
          <Capsule testID="history-target" label="我的路線"><Text style={styles.capsuleText}>我的路線</Text></Capsule>
        </View>
      ) : (
        <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} style={styles.middle}
          contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled" testID="history-chips">
          {dogs.map(dog => (
            <DogChip key={dog.id} dog={dog} name={nameOf(dog)} onPress={() => onSelect(dog.id)}
              onRemove={() => onRemove(dog.id)}
              onLayout={event => { places.current[dog.id] = event.nativeEvent.layout; }} />
          ))}
          {/* 滿 4 隻: 40% but still tappable (it says 最多同時 4 隻). */}
          <Capsule testID="history-add" label={full ? '加入，最多同時 4 隻' : '加入'} onPress={onAdd}
            style={full && styles.faded}>
            <Text style={styles.capsuleText}>＋ 加入</Text>
          </Capsule>
        </ScrollView>
      )}
      <PressScale testID="history-export" accessibilityRole="button" accessibilityLabel={exportLabel}
        accessibilityState={{ disabled: !exportEnabled }} disabled={!exportEnabled} onPress={onExport}
        style={[styles.exportButton, !exportEnabled && styles.disabled]}>
        <Glyph name="share" color={exportEnabled ? colors.text : colors.iconMuted} size={sizes.icon.map} />
      </PressScale>
    </View>
  );
}

/** 資料來源：全部 › — fixed at the foot of a dog's panel (not my route's). */
function SourceRow({ source, onPress }) {
  const label = sourceLabel(source);
  return (
    <Pressable testID="history-source" accessibilityRole="button" accessibilityLabel={label.replace(' ›', '')}
      accessibilityHint="選資料來源" onPress={onPress} style={({ pressed }) => [styles.sourceRow, pressed && styles.pressed]}>
      <Text style={styles.sourceText}>{label}</Text>
    </Pressable>
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
const HistoryScreen = forwardRef(function HistoryScreen({ screen, name = '', top, levels, bottomInset,
  onBack, onFrame, onLevel, history, snapshot, closedAt = null, initialRangeOpen = false, initialCalendar = null,
  candidates = [], initialSheet = null }, ref) {
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
  // 「＋ 加入」 or 資料來源 open ('add' | 'source'); a fixture can open on one.
  const [sheet, setSheet] = useState(initialSheet);
  const sheetRef = useRef(null);
  const { model, subject, cursor, download } = screen;
  // The entry dog's name as the caller knows it (a fixture's tests), else the hook's.
  const nameOf = useCallback(dog => (dog.id === screen.entryId && name) || dog.name, [screen.entryId, name]);
  const lead = screen.dogs?.find(dog => dog.protagonist);
  const leadName = lead ? nameOf(lead) : name;
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
      // A small window closes before anything else (返回鍵 table).
      if (sheet) {
        if (!sheetRef.current?.back()) setSheet(null);
        return true;
      }
      // 選月份 → 選日期 → closed (返回鍵 table).
      if (calendarOpen) return calendar.current?.back() ?? false;
      // 下載中按返回＝取消: what arrived stays, 「資料不完整　重試」.
      if (downloading) { screen.cancelDownload(); return true; }
      if (rangeOpen) { openRange(false); return true; }
      return !!panel.current?.back();
    },
    mapPressed: closeRange,
  }), [exporting, sheet, calendarOpen, downloading, screen, rangeOpen, openRange, closeRange]);
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
  // 滿 4 隻: 「最多同時 4 隻」 instead of the list.
  const pressAdd = useCallback(() => {
    closeRange();
    if (screen.full) { showTip(`最多同時 ${screen.dogs.length} 隻`); return; }
    setSheet('add');
  }, [closeRange, screen.full, screen.dogs, showTip]);
  const pressDog = useCallback(id => {
    closeRange();
    screen.selectDog(id);
  }, [closeRange, screen]);
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
  // 換主角時清單捲到哪: to the stay the cursor is in, or the place before the
  // movement it is on, or the nearest place (unlit when it has no data then).
  useEffect(() => {
    if (!focusKey || screen.focus.action !== 'protagonist' || screen.focus.id == null) return;
    // After the new protagonist's list has laid out.
    const timer = setTimeout(() => {
      const time = screen.cursor?.time ?? screen.cursor?.point?.time;
      const places = (model?.locations ?? []).filter(n => rows.current[n.start] != null);
      if (time == null || !places.length) return;
      const before = places.filter(n => n.start <= time).pop() ?? places[0];
      list.current?.scrollTo({ y: Math.max(0, rows.current[before.start] - 8), animated: true });
    }, 80);
    return () => clearTimeout(timer);
    // Once per switch.
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The row the cursor is on: a pressed row, else the stay it is in (none
  // while the protagonist has no data at the cursor's time).
  const cursorTime = cursor?.stale ? null : cursor?.point?.time;
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
          onDrag={screen.dragRange} onCommit={screen.commitRange} closedAt={closedAt}
          dayPoints={screen.dayPoints} who={screen.multi ? leadName : null} />
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
  else if (empty) body = <Text style={styles.empty} testID="history-empty">{emptyText({ subject, today: screen.today, name: leadName })}</Text>;
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
      <TopRow top={top} subject={subject} dogs={screen.dogs ?? []} nameOf={nameOf} full={screen.full} onBack={onBack}
        onSelect={pressDog} onRemove={id => { closeRange(); screen.removeDog(id); }} onAdd={pressAdd}
        exportEnabled={hasRoute && !!history} onExport={() => setExporting(true)}
        exportLabel={hasRoute ? '匯出' : downloading ? '匯出，無法使用，正在下載'
          : empty ? '匯出，無法使用，這天沒有紀錄' : model ? '匯出，無法使用，這段時間沒有紀錄' : '匯出，無法使用'} />
      <HistoryPanel ref={panel} levels={levels} header={header} onLevel={panelLevel} onDragStart={dragStart}
        bottomInset={bottomInset} scrollRef={list} locked={empty || !model || downloading}
        above={hasRoute ? <FrameButton onPress={onFrame} /> : null}
        footer={subject === 'dog' ? <SourceRow source={screen.source} onPress={() => { closeRange(); setSheet('source'); }} />
          : null}>
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
      {sheet === 'add' && (
        <AddDogSheet ref={sheetRef} bottomInset={bottomInset} checkDay={screen.checkDay}
          candidates={candidates.filter(dog => !(screen.dogs ?? []).some(shown => shown.id === dog.id))}
          onAdd={dog => screen.addDog(dog)} onClosed={() => setSheet(null)} />
      )}
      {sheet === 'source' && (
        <SourceSheet ref={sheetRef} bottomInset={bottomInset} selected={screen.source}
          onChoose={value => screen.setSource(value)} onClosed={() => setSheet(null)} />
      )}
      <MapTip message={tip} bottom={bottomInset + space.l} onDone={hideTip} strong />
    </>
  );
});

export default HistoryScreen;

const styles = StyleSheet.create({
  topRow: { position: 'absolute', left: layout.screenEdge, right: layout.screenEdge, zIndex: 30,
    flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Room above and below for the capsules' shadows and the 48dp touch.
  middle: { flex: 1, marginVertical: -8 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingRight: 4 },
  capsule: { height: sizes.chip.height, borderRadius: sizes.chip.height / 2, paddingHorizontal: sizes.chip.paddingH,
    backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6, ...shadow.floating },
  dogCapsule: { borderWidth: sizes.chip.leadBorder, paddingHorizontal: sizes.chip.paddingH - sizes.chip.leadBorder },
  faded: { opacity: 0.4 },
  remove: { marginLeft: -2, marginRight: -4, paddingHorizontal: 4, height: sizes.chip.height, justifyContent: 'center' },
  removeText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  sourceRow: { height: sizes.sheet.dataSourceRow, justifyContent: 'center', paddingHorizontal: space.l,
    borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  sourceText: { ...type.value, fontWeight: '400', color: colors.text },
  pressed: { backgroundColor: colors.pressedOverlay },
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

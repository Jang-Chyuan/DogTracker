// History over the map: one dog capsule (or 我的路線), immediate dog chooser,
// shared range and cursor, calendar, timeline and export.
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DogAvatar from '../dogs/DogAvatar';
import Glyph from '../map/Glyph';
import { MapTip, PressScale } from '../map/MapControls';
import { emptyText } from '../history/HistoryText';
import { dateRowLabel } from '../history/screen/HistoryScreenDates';
import {
  layout,
  motion,
  radius,
  size as sizes,
  space,
  touch,
  type,
} from '../theme/tokens';
import HistoryPanel from './HistoryPanel';
import HistoryRangeSummary from './HistoryRangeSummary';
import HistoryTimelineList from './HistoryTimelineList';
import HistoryExportSheet from './HistoryExportSheet';
import { useHistoryExport } from './useHistoryExport';
import HistoryCalendarSheet from './HistoryCalendarSheet';
import { DogsSheet } from './HistoryPickers';
import { historyDogsPill, routeTint } from '../history/screen/HistoryDogsPill';

const OPEN_MOTION = LayoutAnimation.create(
  motion.rangeExpand.duration,
  LayoutAnimation.Types.easeOut,
  LayoutAnimation.Properties.opacity,
);
const CLOSE_MOTION = LayoutAnimation.create(
  motion.rangeCollapse.duration,
  LayoutAnimation.Types.easeOut,
  LayoutAnimation.Properties.opacity,
);

function Capsule({ children, onPress, testID, label, style, disabled, onLayout }) {
  const styles = useStyles(getStyles);
  const body = <View style={[styles.capsule, style]}>{children}</View>;
  if (!onPress)
    return (
      <View testID={testID} accessible accessibilityLabel={label} onLayout={onLayout}>
        {body}
      </View>
    );
  return (
    <PressScale
      testID={testID}
      onLayout={onLayout}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      {body}
    </PressScale>
  );
}

/** One fixed capsule, followed by a flexible spacer and the export control. */
export function TopRow({ top, subject, dogs, nameOf, candidates = [], onBack, onExport,
  onAdd, warningCount = 0, exportEnabled, exportLabel = '匯出', exportBusy = false }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const pill = historyDogsPill(dogs.map(dog => ({ ...dog, name: nameOf(dog) })), candidates, subject);
  return (
    <View style={[styles.topRow, { top }]} pointerEvents="box-none">
      <Capsule testID="history-back-now" label="回到現在" onPress={onBack}>
        <Text style={styles.backText}>‹ 回到現在</Text>
      </Capsule>
      <View style={styles.pillSlot}>
        <Capsule testID="history-dogs-pill" label={pill.label} onPress={pill.tappable ? onAdd : undefined}>
          {pill.lead && <View style={[styles.hero, { borderColor: pill.lead.color }]}>
            <DogAvatar avatar={pill.lead.avatar} size={26} border={0} tint={routeTint(pill.lead, colors)} />
          </View>}
          <Text style={styles.capsuleText} numberOfLines={1}>{pill.name}</Text>
          {!!pill.faces.length && <View style={styles.others}>
            {pill.faces.map((dog, index) => <View key={dog.id} style={index > 0 && styles.overlap}>
              <DogAvatar avatar={dog.avatar} size={18} border={1.5} tint={routeTint(dog, colors)} />
            </View>)}
            {pill.more > 0 && <Text style={styles.more}>{`+${pill.more}`}</Text>}
          </View>}
          {pill.plus && <Text style={styles.plus}>＋</Text>}
          {pill.caret && <Text style={styles.caret}>▾</Text>}
        </Capsule>
      </View>
      <View style={styles.spacer} />
      {warningCount > 0 && <Capsule testID="history-warning" label={`警告 ${warningCount}`}>
        <Text style={styles.warning}>{`⚠ ${warningCount}`}</Text>
      </Capsule>}
      <PressScale testID="history-export" accessibilityRole="button"
        accessibilityLabel={exportBusy ? '匯出，產生中' : exportLabel}
        accessibilityState={{ disabled: !exportEnabled || exportBusy, busy: exportBusy }}
        disabled={!exportEnabled || exportBusy} onPress={onExport}
        style={[styles.exportButton, !exportEnabled && !exportBusy && styles.disabled]}>
        {exportBusy ? <ActivityIndicator size={sizes.spinner} color={colors.text} testID="history-export-spinner" />
          : <Glyph name="share" color={exportEnabled ? colors.text : colors.iconMuted} size={sizes.icon.map} />}
      </PressScale>
    </View>
  );
}

/** ‹ 10/03（六）今天 ▾ › (H3a); the date opens the calendar (H3b). */
function DateRow({ day, todayStart, navigation, onPrevious, onNext, onOpen }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const label = dateRowLabel(day, todayStart);
  const arrow = (side, enabled, onPress) => (
    <Pressable
      testID={`history-day-${side}`}
      accessibilityRole="button"
      accessibilityLabel={
        side === 'previous' ? '前一個有紀錄的日子' : '後一個有紀錄的日子'
      }
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={styles.dayArrow}
    >
      <Glyph
        name={side === 'previous' ? 'back' : 'chevron'}
        color={enabled ? colors.text : colors.line}
        size={20}
      />
    </Pressable>
  );

  return (
    <View style={styles.dateRow}>
      {arrow('previous', !!navigation.previous, onPrevious)}
      <PressScale
        testID="history-date"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="打開月曆選日期"
        onPress={onOpen}
        style={styles.datePill}
      >
        <Text style={styles.dateText}>{label}</Text>
        <Text style={styles.dateCaret}> ▾</Text>
      </PressScale>
      {arrow('next', !!navigation.next, onNext)}
    </View>
  );
}

/** H3c: 「下載 9/28 的紀錄…」「只有雲端有，正在下載」 and 取消, where the summary goes. */
function DownloadSummary({ panel, onCancel }) {
  const styles = useStyles(getStyles);
  return (
    <View
      style={styles.download}
      testID="history-downloading"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.downloadText}>
        <Text style={styles.downloadTitle}>{panel.title}</Text>
        <Text style={styles.downloadDetail}>{panel.detail}</Text>
      </View>
      <Pressable
        testID="history-download-cancel"
        accessibilityRole="button"
        accessibilityLabel="取消下載"
        onPress={onCancel}
        style={styles.textButton}
        hitSlop={8}
      >
        <Text style={styles.textButtonText}>{panel.action}</Text>
      </Pressable>
    </View>
  );
}

/** While the day downloads: grey lines where the list will be (no motion). */
function Skeleton() {
  const styles = useStyles(getStyles);
  return (
    <View style={styles.skeleton} testID="history-skeleton" accessible={false}>
      {['70%', '45%', '80%', '55%'].map(width => (
        <View key={width} style={[styles.skeletonLine, { width }]} />
      ))}
    </View>
  );
}

/** 資料不完整　重試: a cancelled or failed download left part of the day. */
function IncompleteRow({ panel, onRetry }) {
  const styles = useStyles(getStyles);
  return (
    <View style={styles.incomplete} testID="history-incomplete">
      <Text style={styles.incompleteText}>{panel.text}</Text>
      <Pressable
        testID="history-download-retry"
        accessibilityRole="button"
        accessibilityLabel="重試下載"
        onPress={onRetry}
        style={styles.textButton}
        hitSlop={8}
      >
        <Text style={styles.textButtonText}>{panel.action}</Text>
      </Pressable>
    </View>
  );
}

/** The 框住全部 button on the panel's top edge (the only map button in history). */
function FrameButton({ onPress }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <PressScale
      testID="history-frame-all"
      accessibilityRole="button"
      accessibilityLabel="框住全部"
      accessibilityHint="把範圍裡的路線放進畫面"
      onPress={onPress}
      style={styles.frameButton}
    >
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
  onBack, onFrame, onLevel, closedAt = null, initialRangeOpen = false, initialCalendar = null,
  candidates = [], initialSheet = null, exportNative = null, initialExport = null },
ref) {
  const styles = getStyles(useTheme());
  const panel = useRef(null);
  const list = useRef(null);
  const rows = useRef({});
  const [rangeOpen, setRangeOpen] = useState(initialRangeOpen);
  const raised = useRef(false);
  // H9/H10: the export window and the export running from it.
  const exporter = useHistoryExport({ screen, exporter: exportNative, initial: initialExport });
  const exportSheet = useRef(null);
  const exporting = exporter.phase !== 'closed';
  // initialCalendar ('month' | 'months'): a screen fixture opens on H3b / H3e.
  const [calendarOpen, setCalendarOpen] = useState(!!initialCalendar);
  const calendar = useRef(null);
  // H3d's 「沒有網路，9/28 的紀錄還沒下載，連上網路再試」 (over the sheet or the panel).
  const [tip, setTip] = useState(null);
  const showTip = useCallback(text => {
    if (text) setTip({ text, key: Date.now() });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);
  // A fixture may open the dog chooser.
  const [sheet, setSheet] = useState(initialSheet);
  const sheetRef = useRef(null);
  const { model, subject, cursor, download } = screen;
  // The entry dog's name as the caller knows it (a fixture's tests), else the hook's.
  const nameOf = useCallback(
    dog => (dog.id === screen.entryId && name) || dog.name,
    [screen.entryId, name],
  );
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
      // 匯出產生中: 返回鍵＝取消; the window closes first like any other.
      if (exporting) {
        if (!exportSheet.current?.back()) exporter.close();
        return true;
      }
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
  }), [exporting, exporter, sheet, calendarOpen, downloading, screen, rangeOpen, openRange, closeRange]);
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
  const pressAdd = useCallback(() => {
    closeRange();
    setSheet('dogs');
  }, [closeRange]);
  const pressDog = useCallback(
    id => {
      closeRange();
      screen.selectDog(id);
    },
    [closeRange, screen],
  );
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
    if (y != null)
      list.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    // Once per tap.
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 換主角時清單捲到哪: to the stay the cursor is in, or the place before the
  // movement it is on, or the nearest place (unlit when it has no data then).
  useEffect(() => {
    if (
      !focusKey ||
      screen.focus.action !== 'protagonist' ||
      screen.focus.id == null
    )
      return;
    // After the new protagonist's list has laid out.
    const timer = setTimeout(() => {
      const time = screen.cursor?.time ?? screen.cursor?.point?.time;
      const places = (model?.locations ?? []).filter(
        n => rows.current[n.start] != null,
      );
      if (time == null || !places.length) return;
      const before = places.filter(n => n.start <= time).pop() ?? places[0];
      list.current?.scrollTo({
        y: Math.max(0, rows.current[before.start] - 8),
        animated: true,
      });
    }, 80);
    return () => clearTimeout(timer);
    // Once per switch.
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The row the cursor is on: a pressed row, else the stay it is in (none
  // while the protagonist has no data at the cursor's time).
  const cursorTime = cursor?.stale ? null : cursor?.point?.time;
  const stay =
    cursorTime == null
      ? null
      : model?.locations.find(
          n =>
            ['stop', 'indoor'].includes(n.type) &&
            cursorTime >= n.start &&
            cursorTime <= n.end,
        );
  const selected = screen.pressed ?? stay?.start ?? null;
  const pressNode = useCallback(
    node => {
      closeRange();
      const action = ['movement', 'gap'].includes(node.type) ? 'route' : 'node';
      screen.moveCursor(
        node.start,
        action,
        action === 'node' || node.type === 'gap' ? node : null,
      );
    },
    [closeRange, screen],
  );
  const dragStart = useCallback(() => {
    raised.current = false;
    closeRange();
  }, [closeRange]);
  const panelLevel = useCallback(
    (level, height) => {
      // Dragged by hand: the bar no longer takes it back down.
      onLevel?.(level, height);
    },
    [onLevel],
  );
  const header = (
    <View>
      <DateRow
        day={screen.day}
        todayStart={screen.todayStart}
        navigation={screen.navigation}
        onPrevious={() => step(screen.previousDay)}
        onNext={() => step(screen.nextDay)}
        onOpen={openCalendar}
      />
      {downloading && (
        <DownloadSummary panel={download} onCancel={screen.cancelDownload} />
      )}
      {download?.kind === 'incomplete' && (
        <IncompleteRow panel={download} onRetry={retry} />
      )}
      {hasRoute && (
        <HistoryRangeSummary
          model={model}
          subject={subject}
          range={screen.range}
          track={screen.track}
          today={screen.today}
          open={rangeOpen}
          onToggle={() => openRange(!rangeOpen)}
          onDrag={screen.dragRange}
          onCommit={screen.commitRange}
          closedAt={closedAt}
          dayPoints={screen.dayPoints}
          who={screen.multi ? leadName : null}
        />
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
        <PressScale
          testID="history-download-retry"
          accessibilityRole="button"
          accessibilityLabel="重試下載"
          onPress={retry}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonText}>{download.action}</Text>
        </PressScale>
      </View>
    );
  } else if (screen.error)
    body = <Text style={styles.empty}>{screen.error}</Text>;
  else if (!model) body = <Text style={styles.empty}>讀取中…</Text>;
  else if (empty)
    body = (
      <Text style={styles.empty} testID="history-empty">
        {emptyText({ subject, today: screen.today, name: leadName })}
      </Text>
    );
  else if (!hasRoute) body = <Text style={styles.empty}>這段時間沒有紀錄</Text>;
  else {
    body = (
      <View style={styles.list}>
        <HistoryTimelineList
          model={model}
          color={screen.color}
          selected={selected}
          onPressNode={pressNode}
          onRowLayout={(start, y) => {
            rows.current[start] = y;
          }}
        />
      </View>
    );
  }
  return (
    <>
      <TopRow top={top} subject={subject} dogs={screen.dogs ?? []} nameOf={nameOf} candidates={candidates} warningCount={screen.warningCount ?? 0} onBack={onBack}
        onAdd={pressAdd}
        exportEnabled={hasRoute} exportBusy={exporter.generating}
        onExport={() => { closeRange(); exporter.open(); }}
        exportLabel={hasRoute ? '匯出' : downloading ? '匯出，無法使用，正在下載'
          : empty ? '匯出，無法使用，這天沒有紀錄' : model ? '匯出，無法使用，這段時間沒有紀錄' : '匯出，無法使用'} />
      <HistoryPanel ref={panel} levels={levels} header={header} onLevel={panelLevel} onDragStart={dragStart}
        bottomInset={bottomInset} scrollRef={list} locked={empty || !model || downloading}
        above={hasRoute ? <FrameButton onPress={onFrame} /> : null}
      >
        <Pressable
          onPress={closeRange}
          disabled={!rangeOpen}
          accessible={false}
        >
          {body}
        </Pressable>
      </HistoryPanel>
      {exporting && <HistoryExportSheet ref={exportSheet} exporter={exporter} bottomInset={bottomInset} />}
      {calendarOpen && (
        <HistoryCalendarSheet
          ref={calendar}
          screen={screen}
          bottomInset={bottomInset}
          onOffline={showTip}
          initialView={initialCalendar}
          onClosed={() => setCalendarOpen(false)}
        />
      )}
      {sheet === 'dogs' && (
        <DogsSheet
          ref={sheetRef}
          bottomInset={bottomInset}
          checkDay={screen.checkDay}
          candidates={candidates}
          dogs={(screen.dogs ?? []).map(dog => ({ ...dog, name: nameOf(dog) }))}
          onSelect={pressDog}
          onRemove={screen.removeDog}
          onAdd={dog => screen.addDog(dog)}
          onClosed={() => setSheet(null)}
        />
      )}
      <MapTip
        message={tip}
        bottom={bottomInset + space.l}
        onDone={hideTip}
        strong
      />
    </>
  );
});

export default HistoryScreen;

const getStyles = makeStyles(theme => {
  const { colors, shadow, opacity } = theme;
  return StyleSheet.create({
    topRow: {
      position: 'absolute',
      left: 8,
      right: 8,
      zIndex: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    pillSlot: { flexShrink: 1, minWidth: 0, maxWidth: 240 },
    spacer: { flex: 1 },
    hero: { borderWidth: 2, borderRadius: 15 },
    others: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: 1,
      borderLeftColor: colors.line, paddingLeft: 4, marginLeft: 2 },
    overlap: { marginLeft: -6 },
    more: { fontSize: 11, fontWeight: '700', color: colors.textMuted, marginLeft: 4 },
    caret: { fontSize: 10, color: colors.textMuted },
    plus: { fontSize: 16, fontWeight: '700', color: colors.tonalText },
    warning: { fontSize: 13, color: colors.warn },
    capsule: {
      height: sizes.chip.height,
      borderRadius: sizes.chip.height / 2,
      paddingHorizontal: sizes.chip.paddingH,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    backText: { color: colors.text, fontSize: 13, fontWeight: '700' },
    capsuleText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      maxWidth: 80,
      flexShrink: 1,
    },
    exportButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    disabled: { opacity: opacity.disabled },
    dateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: 4,
    },
    dayArrow: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    datePill: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 40,
      paddingHorizontal: 18,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.line,
      marginHorizontal: 12,
    },
    dateText: { color: colors.text, fontSize: 17, fontWeight: '700' },
    dateCaret: { color: colors.text, fontSize: 13 },
    frameButton: {
      width: sizes.floatingButton,
      height: sizes.floatingButton,
      borderRadius: sizes.floatingButton / 2,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    list: { paddingTop: 8, paddingRight: 16 },
    download: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.l,
      paddingTop: space.xs,
      paddingBottom: space.s,
      gap: space.s,
    },
    downloadText: { flex: 1, minWidth: 0 },
    downloadTitle: { ...type.title, color: colors.text },
    downloadDetail: {
      ...type.value,
      fontWeight: '400',
      color: colors.textMuted,
      marginTop: 2,
    },
    textButton: {
      minHeight: touch.min,
      minWidth: touch.min,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    textButtonText: { ...type.status, color: colors.tonalText },
    skeleton: { paddingHorizontal: space.l, paddingTop: space.l },
    skeletonLine: {
      height: 14,
      borderRadius: 7,
      backgroundColor: colors.line,
      marginBottom: space.m,
    },
    incomplete: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.l,
      minHeight: touch.min,
    },
    incompleteText: { ...type.value, color: colors.textMuted },
    unfinished: {
      alignItems: 'center',
      paddingVertical: layout.emptyStatePadding,
      paddingHorizontal: space.l,
      gap: space.l,
    },
    unfinishedText: {
      color: colors.textMuted,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
    },
    retryButton: {
      height: touch.min,
      paddingHorizontal: space.xl,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryButtonText: { ...type.status, color: colors.tonalText },
    // 判定表「空狀態文字」: the middle of the panel, 32dp above and below.
    empty: {
      color: colors.textMuted,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
      paddingVertical: layout.emptyStatePadding,
      paddingHorizontal: 16,
    },
  });
});

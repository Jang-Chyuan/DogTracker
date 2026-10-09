import { t } from '../i18n';
import { LoadingContent } from '../components/Skeleton';
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
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import DogAvatar from '../dogs/DogAvatar';
import BangGlyph from '../components/BangGlyph';
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
  border,
  fontScale as fontScales,
} from '../theme/tokens';
import HistoryPanel from './HistoryPanel';
import MyRouteHeader from '../history/screen/MyRouteHeader';
import HistoryRangeSummary from './HistoryRangeSummary';
import HistoryTimelineList from './HistoryTimelineList';
import HistoryExportSheet from './HistoryExportSheet';
import { useHistoryExport } from './useHistoryExport';
import HistoryCalendarSheet from './HistoryCalendarSheet';
import { DogsSheet } from './HistoryPickers';
import { historyDogsPill, routeTint } from '../history/screen/HistoryDogsPill';
import { AlertBadge } from '../map/TopAlertCards';
import { isReduceMotion } from '../utils/reduceMotion';
import { behindSheet } from '../utils/a11yFocus';
import { fontScaleAtLeast } from '../utils/textScale';

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

// 「＋」 (add or choose more dogs): a coral plus in a dashed coral circle the
// size of an avatar, no fill (user 2026-10-09, option B). The capsule around
// it stays the 48dp target. SVG: Android draws dashed round borders unevenly.
function PlusRing({ color, style }) {
  const { plusRing: ring, plusRingDash: dash } = sizes.historyTop;
  const stroke = border.regular;
  return (
    <View testID="history-dogs-plus" style={styles2.plusRing}>
      <Svg width={ring} height={ring} style={StyleSheet.absoluteFill}>
        <Circle cx={ring / 2} cy={ring / 2} r={(ring - stroke) / 2} fill="none" stroke={color}
          strokeWidth={stroke} strokeDasharray={dash} />
      </Svg>
      <Text style={style} maxFontSizeMultiplier={fontScales.graphicTextMax}>＋</Text>
    </View>
  );
}
const styles2 = StyleSheet.create({
  plusRing: { width: sizes.historyTop.plusRing, height: sizes.historyTop.plusRing, alignItems: 'center',
    justifyContent: 'center' },
});

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
      hitSlop={(touch.min - sizes.chip.height) / 2}
    >
      {body}
    </PressScale>
  );
}

// The 40dp date pill, 48dp to the finger.
const DATE_PILL_SLOP = (touch.min - sizes.datePill.height) / 2;
const NARROW_WIDTH = layout.narrowWidth;
const COMPACT_FONT_SCALE = fontScales.large;
const FACE_ONLY_FONT_SCALE = fontScales.faceOnly;

/** One fixed capsule, followed by a flexible spacer and the export control. */
export function TopRow({ top, subject, dogs, nameOf, candidates = [], onBack, onExport,
  onAdd, alertBadge = null, onAlertBadge, exportEnabled, exportLabel = t("c821"), exportBusy = false,
  hidden = false }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const pill = historyDogsPill(dogs.map(dog => ({ ...dog, name: nameOf(dog) })), candidates, subject);
  // 窄螢幕、大字體的上方膠囊列 (320dp wide, or the system font at 130% and up):
  // 「‹ 回到現在」 keeps only its ‹; the dog's name is cut with an ellipsis, and
  // from 180% it goes (the face stays, the name is in TalkBack). The row never scrolls.
  const { width, fontScale } = useWindowDimensions();
  const compact = width <= NARROW_WIDTH || fontScaleAtLeast(fontScale, COMPACT_FONT_SCALE);
  // No room for even a cut name beside 「⚠ N」 and 匯出 in the compact row:
  // the face alone (C16 in the E2E check: the name had shrunk to 「…」).
  const faceOnly =
    fontScaleAtLeast(fontScale, FACE_ONLY_FONT_SCALE) || (compact && !!alertBadge);
  return (
    <View style={[styles.topRow, { top }]} pointerEvents="box-none"
      importantForAccessibility={behindSheet(hidden)}>
      <Capsule testID="history-back-now" label={t("c838")} onPress={onBack}
        style={compact && styles.backRound}>
        {compact ? <Glyph name="back" color={colors.text} size={sizes.icon.row} />
          : <Text style={styles.backText}>{t('c117')}</Text>}
      </Capsule>
      <View style={styles.pillSlot}>
        {subject === 'phone' ? <MyRouteHeader /> : <Capsule testID="history-dogs-pill" label={pill.label} onPress={pill.tappable ? onAdd : undefined}>
          {pill.lead && <View style={[styles.hero, { borderColor: pill.lead.color }]}>
            {pill.lead.downloadFailed && <View testID="history-download-failed-lead" style={styles.downloadFailure}><BangGlyph size={sizes.badge.size} background={colors.problemBadge} color={colors.avatarFrameMap} /></View>}
            <DogAvatar avatar={pill.lead.avatar} size={sizes.historyTop.avatar} border={0} tint={routeTint(pill.lead, colors)} />
          </View>}
          {/* A dog's name is cut (or, at 180%, left to TalkBack); 「我的路線」 is
              never cut: it has no face to stand for it. */}
          {!(faceOnly && pill.lead) && <Text style={[styles.capsuleText, !pill.lead && styles.capsuleTextWhole]}
            numberOfLines={pill.lead ? 1 : undefined}>{pill.name}</Text>}
          {!!pill.faces.length && <View style={styles.others}>
            {pill.faces.map((dog, index) => <View key={dog.id} style={index > 0 && styles.overlap}>
              {dog.downloadFailed && <View testID={`history-download-failed-${dog.id}`} style={styles.downloadFailure}><BangGlyph size={sizes.badge.size} background={colors.problemBadge} color={colors.avatarFrameMap} /></View>}
              <DogAvatar avatar={dog.avatar} size={sizes.historyTop.companionAvatar} border={border.regular} tint={routeTint(dog, colors)} />
            </View>)}
            {pill.more > 0 && <Text style={styles.more} maxFontSizeMultiplier={fontScales.graphicTextMax}>{`+${pill.more}`}</Text>}
          </View>}
          {pill.plus && <PlusRing color={colors.accent} style={styles.plus} />}
          {pill.caret && <Text style={styles.caret}>▾</Text>}
        </Capsule>}
      </View>
      <View style={styles.spacer} />
      {/* 「⚠ N」: 8dp left of the export icon (the row's gap is 6). */}
      <AlertBadge badge={alertBadge} onPress={onAlertBadge} style={styles.alertBadge} />
      <PressScale testID="history-export" accessibilityRole="button"
        accessibilityLabel={exportBusy ? t("c837") : exportLabel}
        accessibilityState={{ disabled: !exportEnabled || exportBusy, busy: exportBusy }}
        disabled={!exportEnabled || exportBusy} onPress={onExport} hitSlop={(touch.min - sizes.chip.height) / 2}
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
        side === 'previous' ? t("c839") : t("c840")
      }
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [styles.dayArrow, pressed && styles.pressed]}
    >
      <Glyph
        name={side === 'previous' ? 'back' : 'chevron'}
        color={enabled ? colors.text : colors.line}
        size={sizes.icon.row}
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
        accessibilityHint={t("c829")}
        onPress={onOpen}
        style={styles.datePill}
        hitSlop={DATE_PILL_SLOP}
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
        accessibilityLabel={t("c830")}
        onPress={onCancel}
        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
        hitSlop={space.s}
      >
        <Text style={styles.textButtonText}>{panel.action}</Text>
      </Pressable>
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
        accessibilityLabel={t("c836")}
        onPress={onRetry}
        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
        hitSlop={space.s}
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
      accessibilityLabel={t("c758")}
      accessibilityHint={t("c831")}
      onPress={onPress}
      style={styles.frameButton}
    >
      <Glyph name="frame" color={colors.text} size={sizes.icon.map} />
    </PressScale>
  );
}

/**
 * `screen` is useHistoryScreen's. Ref: { back() } — 返回鍵 inside the screen
 * (the range bar closes); false when the key
 * should leave the history. { mapPressed() } closes the range bar.
 */
const HistoryScreen = forwardRef(function HistoryScreen({ screen, name = '', top, bottomInset,
  onBack, onFrame, closedAt = null, initialRangeOpen = false, initialCalendar = null,
  candidates = [], initialSheet = null, exportNative = null, initialExport = null, alertBadge = null,
  onAlertBadge, onSheetOpen },
ref) {
  const styles = getStyles(useTheme());
  const panel = useRef(null);
  const list = useRef(null);
  const rows = useRef({});
  const [rangeOpen, setRangeOpen] = useState(initialRangeOpen);
  // H9/H10: the export window and the export running from it.
  // 「存到下載」 done (067): 「已存到 下載／DogTracker／<檔名>」 with 「開啟」.
  const tipRef = useRef(null);
  const onSaved = useCallback(({ files, mime }) => {
    const first = files[0];
    const text = files.length > 1 ? t('c1168', { name: first.name, count: files.length }) : t('c1164', { name: first.name });
    const key = Date.now();
    tipRef.current?.({ text, key, action: exportNative?.openDownload ? { label: t('c1165'),
      // A failed 開啟 replaces only its own tip (or none), never a newer one.
      onPress: () => Promise.resolve(exportNative.openDownload(first.uri, mime))
        .catch(() => tipRef.current?.(current => (!current || current.key === key
          ? { text: t('c1167'), key: Date.now() } : current))) } : null });
  }, [exportNative]);
  const exporter = useHistoryExport({ screen, exporter: exportNative, initial: initialExport, onSaved });
  const exportSheet = useRef(null);
  const exporting = exporter.phase !== 'closed';
  // initialCalendar ('month' | 'months'): a screen fixture opens on H3b / H3e.
  const [calendarOpen, setCalendarOpen] = useState(!!initialCalendar);
  const calendar = useRef(null);
  // H3d's 「沒有網路，9/28 的紀錄還沒下載，連上網路再試」 (over the sheet or the panel).
  const [tip, setTip] = useState(null);
  tipRef.current = setTip;
  const showTip = useCallback(text => {
    if (text) setTip({ text, key: Date.now() });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);
  // A fixture may open the dog chooser.
  const [sheet, setSheet] = useState(initialSheet);
  // A sheet over the screen: TalkBack stays inside it (設計稿「無障礙」).
  const sheetOpen = exporting || calendarOpen || sheet === 'dogs';
  useEffect(() => {
    onSheetOpen?.(sheetOpen);
  }, [sheetOpen, onSheetOpen]);
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
    // 減少動態效果: the range bar opens and closes at once.
    if (!isReduceMotion())
      LayoutAnimation.configureNext(next ? OPEN_MOTION : CLOSE_MOTION);
    setRangeOpen(next);
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
      list.current?.scrollTo({ y: Math.max(0, y - 8), animated: !isReduceMotion() });
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
        animated: !isReduceMotion(),
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
  if (downloading) body = null;
  else if (download?.kind === 'unfinished' && !model?.dayRecords) {
    // Not H8: the day is not known to be empty (判定表「下載取消或失敗、手機裡又完全沒有」).
    body = (
      <View style={styles.unfinished} testID="history-unfinished">
        <Text style={styles.unfinishedText}>{download.text}</Text>
        <PressScale
          testID="history-download-retry"
          accessibilityRole="button"
          accessibilityLabel={t("c836")}
          onPress={retry}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonText}>{download.action}</Text>
        </PressScale>
      </View>
    );
  } else if (screen.error)
    body = <Text style={styles.empty}>{screen.error}</Text>;
  else if (!model) body = null;
  else if (empty)
    body = (
      <Text style={styles.empty} testID="history-empty">
        {emptyText({ subject, today: screen.today, name: leadName })}
      </Text>
    );
  else if (!hasRoute) body = <Text style={styles.empty}>{t('c318')}</Text>;
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
      <TopRow top={top} subject={subject} dogs={screen.dogs ?? []} nameOf={nameOf} candidates={candidates} alertBadge={alertBadge}
        onAlertBadge={onAlertBadge} onBack={onBack}
        onAdd={pressAdd}
        exportEnabled={hasRoute} exportBusy={exporter.generating}
        onExport={() => { closeRange(); exporter.open(); }}
        exportLabel={hasRoute ? t("c821") : downloading ? t("c832")
          : empty ? t('c379') : model ? t("c833") : t("c834")}
        hidden={sheetOpen} />
      <HistoryPanel ref={panel} header={header}
        hidden={sheetOpen}
        bottomInset={bottomInset} scrollRef={list}
        above={hasRoute ? <FrameButton onPress={onFrame} /> : null}
      >
        <Pressable
          onPress={closeRange}
          disabled={!rangeOpen}
          accessible={false}
        >
          {!model && !downloading && !screen.error && <Text style={styles.empty}>{t('c424')}</Text>}
          <LoadingContent loading={downloading || (!model && !screen.error && download?.kind !== 'unfinished')}
            shape="timeline" label={downloading ? download.title.replace('…', '') : t("c835")} skeletonTestID="history-skeleton">
            {body}
          </LoadingContent>
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
    // 設計稿「元件狀態」: the pressed state.
    pressed: { backgroundColor: colors.pressedOverlay },
    topRow: {
      position: 'absolute',
      left: space.s,
      right: space.s,
      zIndex: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    pillSlot: { flexShrink: 1, minWidth: 0, maxWidth: sizes.historyTop.slotLimit },
    spacer: { flex: 1 },
    hero: { borderWidth: border.strong, borderRadius: sizes.historyTop.avatar / 2 + border.strong },
    others: { flexDirection: 'row', alignItems: 'center', borderLeftWidth: border.hairline,
      borderLeftColor: colors.line, paddingLeft: space.xs, marginLeft: space.xs },
    overlap: { marginLeft: -sizes.historyTop.avatarOverlap },
    more: { fontSize: type.micro.fontSize, fontWeight: type.micro.fontWeight, color: colors.textMuted, marginLeft: space.xs },
    caret: { fontSize: sizes.historyTop.caretGlyph, color: colors.textMuted },
    plus: { fontSize: type.body.fontSize, fontWeight: type.status.fontWeight, color: colors.accent,
      lineHeight: sizes.historyTop.plusRing, textAlign: 'center', includeFontPadding: false },
    alertBadge: { marginRight: space.xs },
    // A dog whose download failed (K12): the problem 「!」 on its face.
    downloadFailure: { position: 'absolute', top: -space.xs, right: -space.xs, zIndex: 1 },
    capsule: {
      // 36dp, taller with a large system font (膠囊可以變高、不裁字).
      minHeight: sizes.chip.height,
      borderRadius: radius.full,
      paddingHorizontal: sizes.chip.paddingH,
      backgroundColor: colors.surface,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      ...shadow.floating,
      ...theme.floatingBorder,
    },
    // The compact 「‹」: a 36dp circle (48dp to the finger).
    backRound: {
      width: sizes.chip.height,
      paddingHorizontal: 0,
      justifyContent: 'center',
    },
    backText: { color: colors.text, fontSize: type.caption.fontSize, fontWeight: type.captionBold.fontWeight },
    capsuleText: {
      color: colors.text,
      fontSize: type.caption.fontSize,
      fontWeight: type.captionBold.fontWeight,
      maxWidth: sizes.historyTop.capsuleTextMax,
      flexShrink: 1,
    },
    capsuleTextWhole: { maxWidth: '100%', flexShrink: 0 },
    exportButton: {
      width: sizes.historyTop.exportDisc,
      height: sizes.historyTop.exportDisc,
      borderRadius: sizes.historyTop.exportDisc / 2,
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
      paddingBottom: space.xs,
    },
    dayArrow: {
      width: touch.min,
      height: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    datePill: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: sizes.datePill.height,
      flexShrink: 1,
      paddingHorizontal: space.l,
      borderRadius: radius.full,
      borderWidth: border.regular,
      borderColor: colors.line,
      marginHorizontal: space.m,
    },
    dateText: { color: colors.text, fontSize: type.body.fontSize, fontWeight: type.status.fontWeight, flexShrink: 1 },
    dateCaret: { color: colors.text, fontSize: type.caption.fontSize },
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
    list: { paddingTop: space.s, paddingRight: space.l },
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
      fontWeight: type.body.fontWeight,
      color: colors.textMuted,
      marginTop: space.xs,
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
      height: sizes.skeleton.line,
      borderRadius: sizes.skeleton.line / 2,
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
      fontSize: type.body.fontSize,
      fontWeight: type.status.fontWeight,
      textAlign: 'center',
    },
    retryButton: {
      minHeight: touch.min,
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
      fontSize: type.body.fontSize,
      fontWeight: type.status.fontWeight,
      textAlign: 'center',
      paddingVertical: layout.emptyStatePadding,
      paddingHorizontal: space.l,
    },
  });
});

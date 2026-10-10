import { t } from '../i18n';
// H9: the export window (判定表「匯出小視窗的標題」「匯出產生中」, copy
// c160–c167, c258): 「匯出 08:03–12:11」 and the three formats (PNG 長圖 /
// GPX / CSV, in fixed order); a format chosen turns the
// window, in place, into 「⟳ 產生中…　取消」, then 「匯出失敗　重試」 when it
// failed. Android's share sheet closes it.
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { clock } from '../history/HistoryText';
import { size as sizes, space, touch, type, border, radius } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/ThemeProvider';
import HistoryBottomSheet from './HistoryBottomSheet';
import Glyph from '../map/Glyph';
import { EXPORT_FORMATS } from './useHistoryExport';

/** 「匯出 08:03–12:11」 (always one day; the end is the last fix's time). */
export const exportTitle = range => (range ? t('c160', { time: clock(range.start), time2: clock(range.end) }) : t("c821"));

const HistoryExportSheet = forwardRef(function HistoryExportSheet({ exporter, bottomInset }, ref) {
  const theme = useTheme();
  const { colors } = theme;
  const styles = getStyles(theme);
  const sheet = useRef(null);
  const { phase, range } = exporter;
  // The back key: 產生中＝取消 (the hook stops it); the window slides away.
  // The run stops at the press (a result arriving while the window slides
  // away is never shared); the window closes after its slide.
  const cancel = () => { exporter.stop(); sheet.current?.close(); };
  useImperativeHandle(ref, () => ({ back: () => { cancel(); return true; } }));
  const busy = phase === 'generating';
  // 原地變成: the window keeps the formats' height while 產生中 or failed.
  const [listHeight, setListHeight] = useState(0);
  const keep = listHeight ? { minHeight: listHeight } : null;
  let body;
  if (busy) {
    body = (
      <View style={keep}><View style={styles.status} testID="history-export-generating" accessibilityLiveRegion="polite">
        <ActivityIndicator size={sizes.spinner} color={colors.tonalText} />
        <Text style={styles.statusText}>{t("c817")}</Text>
        <Pressable testID="history-export-cancel" accessibilityRole="button" accessibilityLabel={t("c818")}
          onPress={cancel} style={({ pressed }) => [styles.textButton, pressed && styles.pressedRow]} hitSlop={space.s}>
          <Text style={styles.textButtonText}>{t('c046')}</Text>
        </Pressable>
      </View></View>
    );
  } else if (phase === 'failed') {
    body = (
      <View style={keep}><View style={styles.status} testID="history-export-failed" accessibilityLiveRegion="polite">
        <Text style={[styles.statusText, styles.failed]}>{t('c258')}</Text>
        <Pressable testID="history-export-retry" accessibilityRole="button" accessibilityLabel={t("c819")}
          onPress={exporter.retry} style={({ pressed }) => [styles.textButton, pressed && styles.pressedRow]} hitSlop={space.s}>
          <Text style={styles.textButtonText}>{t('c049')}</Text>
        </Pressable>
      </View></View>
    );
  } else {
    body = <View onLayout={event => setListHeight(event.nativeEvent.layout.height)}>{EXPORT_FORMATS.map((format, index) => {
      return (
        <View key={format.id} style={[styles.formatRow, index > 0 && styles.divided]}>
          <View testID={`history-export-format-${format.id}`} style={[styles.row, styles.texts]}>
            <Text style={styles.format}>{format.title}</Text>
            <Text style={styles.detail}>{format.detail}</Text>
          </View>
          <Pressable testID={`history-export-${format.id}`} accessibilityRole="button"
            accessibilityLabel={t('c1171', { format: format.title })}
            onPress={() => exporter.start(format.id)}
            style={styles.iconButton}>
            {({ pressed }) => <View style={[styles.iconDisc, pressed && styles.pressed]} pointerEvents="none">
              <Glyph name="share" color={colors.tonalText} size={sizes.icon.exportAction} />
            </View>}
          </Pressable>
          {exporter.canSave && <Pressable testID={`history-export-save-${format.id}`} accessibilityRole="button"
            accessibilityLabel={t('c1166', { format: format.title })} onPress={() => exporter.save(format.id)}
            style={styles.iconButton}>
            {({ pressed }) => <View style={[styles.iconDisc, pressed && styles.pressed]} pointerEvents="none">
              <Glyph name="download" color={colors.tonalText} size={sizes.icon.exportAction} />
            </View>}
          </Pressable>}
        </View>
      );
    })}</View>;
  }
  return (
    <HistoryBottomSheet ref={sheet} title={exportTitle(range)} onClosed={() => exporter.close()}
      bottomInset={bottomInset} testID="history-export-sheet" closeLabel={t("c820")} locked={busy} divided>
      {body}
    </HistoryBottomSheet>
  );
});

export default HistoryExportSheet;

// Inside the sheet (elevated in dark): rules are `line`, words text/textMuted,
// actions tonalText (DESIGN.md 深色模式「對話框、底部面板」).
const getStyles = makeStyles(({ colors }) => StyleSheet.create({
    // 設計稿「元件狀態」: the pressed state.
    pressedRow: { backgroundColor: colors.brandSoft },
  row: { minHeight: touch.row, justifyContent: 'center', paddingVertical: space.m },
  divided: { borderTopWidth: border.hairline, borderTopColor: colors.line },
  // Format words stay separate from the two independent actions.
  formatRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  iconButton: { minHeight: touch.min, minWidth: touch.min, alignItems: 'center',
    justifyContent: 'center', flexShrink: 0 },
  iconDisc: { height: touch.min - space.s, width: touch.min - space.s, alignItems: 'center',
    justifyContent: 'center', borderRadius: radius.full, backgroundColor: colors.brandSoft },
  pressed: { backgroundColor: colors.pressedOverlay },
  texts: { flex: 1, minWidth: 0 },
  format: { ...type.status, color: colors.text },
  detail: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
  // 判定表「載入中、產生中」: one 48dp row, a 20dp spinner, the words, 取消.
  status: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.m, marginVertical: space.s },
  statusText: { ...type.body, color: colors.text, flex: 1 },
  failed: { fontWeight: type.status.fontWeight },
  textButton: { minHeight: touch.min, minWidth: touch.min, alignItems: 'flex-end', justifyContent: 'center' },
  textButtonText: { ...type.status, color: colors.tonalText },
}));

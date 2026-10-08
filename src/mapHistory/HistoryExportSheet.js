// H9: the export window (判定表「匯出小視窗的標題」「匯出產生中」, copy
// c160–c167, c258): 「匯出 08:03–12:11」 and the three formats (PNG 長圖 /
// GPX / CSV, the one used last marked 「✓ 上次用」); a format chosen turns the
// window, in place, into 「⟳ 產生中…　取消」, then 「匯出失敗　重試」 when it
// failed. Android's share sheet closes it.
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { clock } from '../history/HistoryText';
import { colors, size as sizes, space, touch, type } from '../theme/tokens';
import HistoryBottomSheet from './HistoryBottomSheet';
import { EXPORT_FORMATS } from './useHistoryExport';

/** 「匯出 08:03–12:11」 (always one day; the end is the last fix's time). */
export const exportTitle = range => (range ? `匯出 ${clock(range.start)}–${clock(range.end)}` : '匯出');

const HistoryExportSheet = forwardRef(function HistoryExportSheet({ exporter, bottomInset }, ref) {
  const sheet = useRef(null);
  const { phase, lastFormat, range } = exporter;
  // The back key: 產生中＝取消 (the hook stops it); the window slides away.
  useImperativeHandle(ref, () => ({ back: () => { sheet.current?.close(() => exporter.cancel()); return true; } }),
    [exporter]);
  const busy = phase === 'generating';
  let body;
  if (busy) {
    body = (
      <View style={styles.status} testID="history-export-generating" accessibilityLiveRegion="polite">
        <ActivityIndicator size={sizes.spinner} color={colors.tonalText} />
        <Text style={styles.statusText}>產生中…</Text>
        <Pressable testID="history-export-cancel" accessibilityRole="button" accessibilityLabel="取消匯出"
          onPress={() => sheet.current?.close(() => exporter.cancel())} style={styles.textButton} hitSlop={8}>
          <Text style={styles.textButtonText}>取消</Text>
        </Pressable>
      </View>
    );
  } else if (phase === 'failed') {
    body = (
      <View style={styles.status} testID="history-export-failed" accessibilityLiveRegion="polite">
        <Text style={[styles.statusText, styles.failed]}>匯出失敗</Text>
        <Pressable testID="history-export-retry" accessibilityRole="button" accessibilityLabel="重試匯出"
          onPress={exporter.retry} style={styles.textButton} hitSlop={8}>
          <Text style={styles.textButtonText}>重試</Text>
        </Pressable>
      </View>
    );
  } else {
    body = EXPORT_FORMATS.map((format, index) => {
      const last = format.id === lastFormat;
      return (
        <Pressable key={format.id} testID={`history-export-${format.id}`} accessibilityRole="button"
          accessibilityLabel={`${format.title}，${format.detail}${last ? '，上次用' : ''}`}
          onPress={() => exporter.start(format.id)}
          style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed]}>
          <View style={styles.texts}>
            <Text style={styles.format}>{format.title}</Text>
            <Text style={styles.detail}>{format.detail}</Text>
          </View>
          {last && <Text style={styles.last}>✓ 上次用</Text>}
        </Pressable>
      );
    });
  }
  return (
    <HistoryBottomSheet ref={sheet} title={exportTitle(range)} onClosed={() => exporter.close()}
      bottomInset={bottomInset} testID="history-export-sheet" closeLabel="關閉匯出" locked={busy} divided>
      {body}
    </HistoryBottomSheet>
  );
});

export default HistoryExportSheet;

const styles = StyleSheet.create({
  row: { minHeight: touch.row, flexDirection: 'row', alignItems: 'center', paddingVertical: space.m,
    gap: space.m },
  divided: { borderTopWidth: 1, borderTopColor: colors.line },
  pressed: { backgroundColor: colors.pressedOverlay },
  texts: { flex: 1, minWidth: 0 },
  format: { ...type.status, color: colors.text },
  detail: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  last: { ...type.caption, color: colors.tonalText, fontWeight: '700' },
  // 判定表「載入中、產生中」: one 48dp row, a 20dp spinner, the words, 取消.
  status: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: space.m, marginVertical: space.s },
  statusText: { ...type.body, color: colors.text, flex: 1 },
  failed: { fontWeight: '700' },
  textButton: { minHeight: touch.min, minWidth: touch.min, alignItems: 'flex-end', justifyContent: 'center' },
  textButtonText: { ...type.status, color: colors.tonalText },
});

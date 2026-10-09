import React, { useRef, useState } from 'react';
import { Alert, Modal, NativeModules, StyleSheet, Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { serializeHistory } from './HistoryExport';

/**
 * The export of the old history page (PNG of the map, GPX, CSV of the
 * history query), opened by the history screen's top-right export icon until
 * 056 replaces it with H9/H10 (計畫第 4 節第 2 點). The query is the one the
 * screen keeps in step with its day and range (useMapHistory.save).
 */
export default function HistoryExportDialog({ history, snapshot, visible, onClose }) {
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState('png');
  const lock = useRef(false);
  const currentKey = useRef(history.key);
  currentKey.current = history.key;
  async function run(action) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const key = history.key;
    try {
      const native = NativeModules.HistoryExport;
      if (!native) throw new Error('請安裝支援匯出的 Android 版本');
      if (!history.data) throw new Error('請等待歷史資料載入');
      let text = '', path = '';
      const data = history.data;
      if (format === 'png') {
        if (!snapshot.current) throw new Error('地圖尚未載入完成，請稍後重試');
        path = await snapshot.current();
      } else text = serializeHistory(format, await history.exportRows());
      if (currentKey.current !== key) throw new Error('帳號或條件已改變，請重新匯出');
      const label = `DogTracker\n${new Date(data.since).toLocaleString()}\n至 ${new Date(data.until).toLocaleString()}`;
      const file = await native.prepare(format, text, path, label);
      if (currentKey.current !== key) throw new Error('帳號或條件已改變，請重新匯出');
      const result = await native[action](file);
      if (result === 'saved') Alert.alert('匯出完成', '檔案已儲存到你選擇的位置。');
      onClose?.();
    } catch (e) { Alert.alert('匯出失敗', e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return (
    <Modal visible={visible} transparent onRequestClose={() => { if (!busy) onClose?.(); }}>
      <View style={styles.shade}><View style={[ui.card, styles.dialog]} testID="history-export-dialog">
        <Text style={ui.heading}>匯出歷史地圖</Text>
        <Text style={ui.hint}>PNG：目前歷史地圖畫面與軌跡。GPX／CSV：所選區間的完整定位資料。分享後由你選擇接收對象。</Text>
        {['png', 'gpx', 'csv'].map(value => <ActionButton key={value} title={(value === format ? '✓ ' : '') + value.toUpperCase()} secondary={value !== format} disabled={busy} onPress={() => setFormat(value)} />)}
        <ActionButton title={busy ? '處理中…' : '儲存檔案'} disabled={busy} onPress={() => run('save')} />
        <ActionButton title="分享" disabled={busy} onPress={() => run('share')} />
        <ActionButton title="取消" secondary disabled={busy} onPress={() => onClose?.()} />
      </View></View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: '#0009', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%' },
});

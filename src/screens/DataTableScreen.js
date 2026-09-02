import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const COLUMNS = [
  { key: 'received_at', label: '接收時間', width: 96, format: value => new Date(value).toLocaleTimeString('zh-TW', { hour12: false }) },
  { key: 'master_id', label: 'Master ID', width: 84 },
  { key: 'slave_id', label: 'Slave ID', width: 76 },
  { key: 'slave_lat', label: 'Slave 緯度', width: 110 },
  { key: 'slave_lon', label: 'Slave 經度', width: 110 },
  { key: 'master_lat', label: 'Master 緯度', width: 110 },
  { key: 'master_lon', label: 'Master 經度', width: 110 },
  { key: 'distance_meters', label: '距離(m)', width: 78 },
  { key: 'speed_kmh', label: '速度(km/h)', width: 96 },
  { key: 'satellites', label: '衛星', width: 62 },
  { key: 'hdop', label: 'HDOP', width: 66 },
  { key: 'activity', label: '活動量', width: 78 },
  { key: 'battery_percentage', label: 'Slave 電量%', width: 94 },
  { key: 'master_battery_percentage', label: 'Master 電量%', width: 102 },
  { key: 'rssi', label: 'RSSI', width: 64 },
  { key: 'snr', label: 'SNR', width: 64 },
  { key: 'gps_time', label: 'GPS 時間', width: 86 },
  { key: 'sequence', label: '序號', width: 68 },
];

export const DEFAULT_TABLE_COLUMNS = [
  'received_at',
  'master_id',
  'slave_id',
  'distance_meters',
  'battery_percentage',
];

const renderValue = (row, column) => {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return '-';
  return String(column.format ? column.format(value) : value);
};

export default function DataTableScreen({ dogDatabase, onBack, profile }) {
  const profileColumns = profile?.tableColumns || DEFAULT_TABLE_COLUMNS;
  const historyLimit = profile?.historyLimit || 100;
  const refreshIntervalMs = profile?.tableRefreshIntervalMs || 1000;
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => [...profileColumns]);
  const [showColumns, setShowColumns] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRows = useCallback(async () => {
    try {
      setRows(await dogDatabase.listHistory(historyLimit));
      setError('');
    } catch (loadError) {
      setError(`讀取 SQLite 失敗：${loadError.message}`);
    } finally {
      setLoading(false);
    }
  }, [dogDatabase, historyLimit]);

  useEffect(() => {
    loadRows();
    const timer = setInterval(loadRows, refreshIntervalMs);
    return () => clearInterval(timer);
  }, [loadRows, refreshIntervalMs]);

  useEffect(() => {
    setSelected([...profileColumns]);
  }, [profileColumns]);

  const toggleColumn = key => {
    setSelected(current => {
      if (current.includes(key)) {
        return current.length === 1 ? current : current.filter(item => item !== key);
      }
      return COLUMNS.filter(column => current.includes(column.key) || column.key === key)
        .map(column => column.key);
    });
  };

  const visibleColumns = COLUMNS.filter(column => selected.includes(column.key));

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>即時資料</Text>
          <Text style={styles.subtitle}>SQLite 最近 100 筆，每秒更新</Text>
        </View>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.link}>返回</Text></Pressable>
      </View>

      <Pressable style={styles.columnButton} onPress={() => setShowColumns(value => !value)}>
        <Text style={styles.columnButtonText}>
          {showColumns ? '收起欄位設定' : `選擇欄位（${selected.length}）`}
        </Text>
      </Pressable>
      {showColumns ? (
        <View style={styles.columnPicker}>
          {COLUMNS.map(column => {
            const active = selected.includes(column.key);
            return (
              <Pressable
                key={column.key}
                onPress={() => toggleColumn(column.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {active ? '✓ ' : ''}{column.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setSelected([...profileColumns])} style={styles.resetButton}>
            <Text style={styles.link}>恢復預設欄位</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? <ActivityIndicator color="#60a5fa" style={styles.loader} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && rows.length === 0 ? (
        <Text style={styles.empty}>尚無資料，BLE 訂閱收到資料後會自動寫入。</Text>
      ) : null}

      {rows.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={[styles.row, styles.headerRow]}>
              {visibleColumns.map(column => (
                <Text key={column.key} style={[styles.cell, styles.headerCell, { width: column.width }]}>
                  {column.label}
                </Text>
              ))}
            </View>
            {rows.map((row, index) => (
              <View key={row.id} style={[styles.row, index % 2 === 1 && styles.altRow]}>
                {visibleColumns.map(column => (
                  <Text key={column.key} numberOfLines={1} style={[styles.cell, { width: column.width }]}>
                    {renderValue(row, column)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#111827', borderColor: '#374151', borderRadius: 16, borderWidth: 1, padding: 14 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  title: { color: '#f8fafc', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#94a3b8', fontSize: 12, marginTop: 3 },
  link: { color: '#93c5fd', fontSize: 14, fontWeight: '600' },
  columnButton: { alignItems: 'center', backgroundColor: '#1d4ed8', borderRadius: 9, padding: 11 },
  columnButtonText: { color: '#fff', fontWeight: '700' },
  columnPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingVertical: 12 },
  chip: { borderColor: '#475569', borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  chipActive: { backgroundColor: '#1e3a8a', borderColor: '#60a5fa' },
  chipText: { color: '#94a3b8', fontSize: 12 },
  chipTextActive: { color: '#dbeafe' },
  resetButton: { justifyContent: 'center', paddingHorizontal: 8 },
  loader: { margin: 18 },
  error: { color: '#fca5a5', marginVertical: 14 },
  empty: { color: '#94a3b8', marginVertical: 18, textAlign: 'center' },
  row: { flexDirection: 'row', minHeight: 38 },
  headerRow: { backgroundColor: '#1e3a8a' },
  altRow: { backgroundColor: '#1f2937' },
  cell: { color: '#e2e8f0', fontSize: 12, paddingHorizontal: 7, paddingVertical: 10 },
  headerCell: { color: '#fff', fontWeight: '700' },
});

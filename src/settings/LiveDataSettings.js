import { useStyles } from '../theme/ThemeProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { getDeviceProfile } from '../config/DeviceProfiles';
import { formatClockSeconds } from '../map/MapFormat';
import {
  ColumnPicker,
  DataTable,
  LoadState,
  PillButton,
  getDataStyles,
} from './DataTable';
import { getSettingsStyles } from './SettingsUI';

// Every dog_status column worth reading (widths are the narrowest a column
// gets; nothing is cut short).
export const LIVE_COLUMNS = Object.freeze([
  {
    key: 'received_at',
    label: '接收時間',
    width: 84,
    format: formatClockSeconds,
  },
  { key: 'master_id', label: '接收器', width: 64 },
  { key: 'slave_id', label: '訊號源', width: 64 },
  { key: 'slave_lat', label: '狗的緯度', width: 96 },
  { key: 'slave_lon', label: '狗的經度', width: 104 },
  { key: 'master_lat', label: '接收器緯度', width: 96 },
  { key: 'master_lon', label: '接收器經度', width: 104 },
  { key: 'distance_meters', label: '距離 (m)', width: 76 },
  { key: 'speed_kmh', label: '速度 (km/h)', width: 92 },
  { key: 'satellites', label: '衛星', width: 52 },
  { key: 'hdop', label: 'HDOP', width: 64 },
  { key: 'activity', label: '活動量', width: 72 },
  { key: 'battery_percentage', label: '狗的電量 %', width: 92 },
  { key: 'master_battery_percentage', label: '接收器電量 %', width: 104 },
  { key: 'rssi', label: 'RSSI', width: 64 },
  { key: 'snr', label: 'SNR', width: 56 },
  { key: 'gps_time', label: 'GPS 時間', width: 84 },
  { key: 'sequence', label: '序號', width: 60 },
]);

/**
 * 診斷 → 即時資料 (S8): the newest rows this phone's receiver delivered
 * (dog_status), refreshed every second while open; columns can be picked and
 * reset. `dogDatabase.listHistory(limit)` reads them (a fixture's own rows).
 */
export default function LiveDataSettings({
  dogDatabase,
  profile = getDeviceProfile(),
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const dataStyles = useStyles(getDataStyles);
  const defaults = profile.tableColumns;
  const limit = profile.historyLimit || 100;
  const refreshMs = profile.tableRefreshIntervalMs || 1000;
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => [...defaults]);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    try {
      const next = await dogDatabase.listHistory(limit);
      if (mounted.current) {
        setRows(next || []);
        setError('');
      }
    } catch (failure) {
      if (mounted.current)
        setError(`讀取失敗：${failure?.message || '手機裡的資料讀不到'}`);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [dogDatabase, limit]);
  useEffect(() => {
    load();
    const timer = setInterval(load, refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);
  const toggle = key =>
    setSelected(current => {
      if (current.includes(key))
        return current.length === 1
          ? current
          : current.filter(item => item !== key);
      return LIVE_COLUMNS.filter(
        column => current.includes(column.key) || column.key === key,
      ).map(column => column.key);
    });
  const columns = LIVE_COLUMNS.filter(column => selected.includes(column.key));
  return (
    <ScrollView
      testID="live-data"
      style={settingsStyles.page}
      contentContainerStyle={settingsStyles.content}
    >
      <Text
        style={dataStyles.hint}
      >{`接收器收到的最近 ${limit} 筆，每秒更新。`}</Text>
      <View style={dataStyles.buttons}>
        <PillButton
          testID="live-data-columns"
          title={picking ? '收起欄位' : `選擇欄位（${selected.length}）`}
          onPress={() => setPicking(value => !value)}
        />
      </View>
      {picking ? (
        <ColumnPicker
          columns={LIVE_COLUMNS}
          selected={selected}
          onToggle={toggle}
          onReset={() => setSelected([...defaults])}
        />
      ) : null}
      <LoadState
        testID="live-data"
        loading={loading}
        error={error}
        empty={rows.length === 0}
        emptyText="還沒有資料：接收器連上、收到狗的訊號後會出現在這裡。"
        onRetry={load}
      />
      {!error && rows.length > 0 ? (
        <DataTable testID="live-data-table" columns={columns} rows={rows} />
      ) : null}
    </ScrollView>
  );
}

import { t } from '../i18n';
import { size as sizes } from '../theme/tokens';
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
    label: t("c968"),
    width: sizes.diagnostics.columnWidth.time,
    format: formatClockSeconds,
  },
  { key: 'master_id', label: t('c075'), width: sizes.diagnostics.columnWidth.receiverId },
  { key: 'slave_id', label: t("c532"), width: sizes.diagnostics.columnWidth.sourceId },
  { key: 'slave_lat', label: t("c972"), width: sizes.diagnostics.columnWidth.latitude },
  { key: 'slave_lon', label: t("c973"), width: sizes.diagnostics.columnWidth.longitude },
  { key: 'master_lat', label: t("c974"), width: sizes.diagnostics.columnWidth.latitude },
  { key: 'master_lon', label: t("c975"), width: sizes.diagnostics.columnWidth.longitude },
  { key: 'distance_meters', label: t("c976"), width: sizes.diagnostics.columnWidth.distance },
  { key: 'speed_kmh', label: t("c977"), width: sizes.diagnostics.columnWidth.speed },
  { key: 'satellites', label: t("c537"), width: sizes.diagnostics.columnWidth.satellites },
  { key: 'hdop', label: t("c967"), width: sizes.diagnostics.columnWidth.precision },
  { key: 'activity', label: t('c068'), width: sizes.diagnostics.columnWidth.activity },
  { key: 'battery_percentage', label: t("c969"), width: sizes.diagnostics.columnWidth.dogBattery },
  { key: 'master_battery_percentage', label: t("c970"), width: sizes.diagnostics.columnWidth.receiverBattery },
  { key: 'rssi', label: t("c978"), width: sizes.diagnostics.columnWidth.signalStrength },
  { key: 'snr', label: t("c979"), width: sizes.diagnostics.columnWidth.signalNoise },
  { key: 'gps_time', label: t("c971"), width: sizes.diagnostics.columnWidth.time },
  { key: 'sequence', label: t("c539"), width: sizes.diagnostics.columnWidth.sequence },
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
  // Only the newest read (a 重試, another database) may set the table.
  const reading = useRef(0);
  const load = useCallback(async () => {
    const id = ++reading.current;
    const latest = () => mounted.current && id === reading.current;
    try {
      const next = await dogDatabase.listHistory(limit);
      if (latest()) {
        setRows(next || []);
        setError('');
      }
    } catch (failure) {
      if (latest())
        setError(t("c565", { value: failure?.message || t("c966") }));
    } finally {
      if (latest()) setLoading(false);
    }
  }, [dogDatabase, limit]);
  // The next read is planned when this one is done, so a slow read never
  // overlaps the next one (an older answer cannot replace a newer one).
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const tick = async () => {
      await load();
      if (!stopped) timer = setTimeout(tick, refreshMs);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
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
      >{t("c964", { limit: limit })}</Text>
      <View style={dataStyles.buttons}>
        <PillButton
          testID="live-data-columns"
          title={picking ? t("c556") : t("c557", { length: selected.length })}
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
        emptyText={t("c965")}
        onRetry={load}
      />
      {!error && rows.length > 0 ? (
        <DataTable testID="live-data-table" columns={columns} rows={rows} />
      ) : null}
    </ScrollView>
  );
}

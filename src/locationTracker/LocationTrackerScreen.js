import { t } from '../i18n';
import { LoadingContent } from '../components/Skeleton';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { space, touch, type, border } from '../theme/tokens';
import {
  formatClockSeconds,
  formatCount,
  formatDate,
  formatDateTime,
} from '../map/MapFormat';
import { LoadState, PillButton, getDataStyles } from '../settings/DataTable';
import { getSettingsStyles } from '../settings/SettingsUI';
import { LOCATION_RECORD_LIMIT } from './LocationTrackerDatabase';
import { useLocationTracker } from './useLocationTracker';

const motionLabel = state =>
  ({
    moving: t('c125'),
    suspected_stationary: t("c713"),
    stationary: t("c625"),
    unknown: t("c714"),
  }[state] || t("c715"));
const time = formatClockSeconds;
const date = formatDate;
const fixed = (value, digits, unit = '') =>
  value == null ? '—' : `${Number(value).toFixed(digits)}${unit}`;
// A gap of two minutes, or another recording session, is a break.
const BREAK_MS = 120000;

/**
 * 設定 → 診斷 → 記錄清單 (S8): the phone's recorded positions, newest first,
 * a page at a time; rows grouped by day, a line where the recording broke
 * off, a row pressed shows all it stored. Recording itself is switched on and
 * off in 設定 → 手機 (S4). `readPage` replaces where the rows come from (a
 * screen fixture's, in debug).
 */
export default function LocationTrackerScreen({ foreground, readPage }) {
  const settingsStyles = useStyles(getSettingsStyles);
  const dataStyles = useStyles(getDataStyles);
  const styles = useStyles(getStyles);
  const tracker = useLocationTracker(foreground, readPage);
  const [open, setOpen] = useState(null);
  const rows = tracker.rows || [];
  return (
    <ScrollView
      testID="location-records"
      style={settingsStyles.page}
      contentContainerStyle={settingsStyles.content}
    >
      <Text style={dataStyles.hint}>
        {t("c700", { value: formatCount(tracker.total), value2: formatCount(
          LOCATION_RECORD_LIMIT,
        ), page: tracker.page })}
      </Text>
      <View style={dataStyles.buttons}>
        <PillButton title={t("c703")} onPress={tracker.refresh} />
        <PillButton
          title={t("c559")}
          onPress={tracker.previous}
          disabled={tracker.page === 1 || tracker.loading}
        />
        <PillButton
          title={t("c551")}
          onPress={tracker.next}
          disabled={!tracker.hasMore || tracker.loading}
        />
      </View>
      <LoadingContent loading={tracker.loading && !rows.length && !tracker.error} skeletonTestID="location-records-loading">
      <LoadState
        testID="location-records"
        loading={false}
        error={tracker.error ? t("c702", { error: tracker.error }) : ''}
        empty={!rows.length}
        emptyText={t("c701")}
        onRetry={tracker.refresh}
      />
      {rows.map((row, index) => {
        const previous = rows[index - 1];
        const newDay =
          !previous || date(previous.location_at) !== date(row.location_at);
        const broke =
          previous &&
          !newDay &&
          (previous.location_at - row.location_at > BREAK_MS ||
            previous.session_id !== row.session_id);
        const expanded = open === row.id;
        return (
          <View key={row.id}>
            {newDay ? (
              <Text style={dataStyles.heading} accessibilityRole="header">
                {date(row.location_at)}
              </Text>
            ) : null}
            {broke ? <Text style={styles.break}>{t("c706")}</Text> : null}
            <Pressable
              testID={`record-${row.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${time(row.location_at)}，${fixed(
                row.latitude,
                6,
              )}, ${fixed(row.longitude, 6)}`}
              accessibilityState={{ expanded }}
              onPress={() =>
                setOpen(current => (current === row.id ? null : row.id))
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.head}>
                <Text style={styles.time}>{time(row.location_at)}</Text>
                <Text style={styles.id}>{`#${row.id}`}</Text>
              </View>
              <Text style={styles.value}>{`${fixed(row.latitude, 6)}, ${fixed(
                row.longitude,
                6,
              )}`}</Text>
              <Text style={styles.detail}>
                {t("c707", { value: fixed(row.accuracy_meters, 1, ' m'), value2: fixed(
                  row.speed_kmh,
                  1,
                  ' km/h',
                ), value3: motionLabel(row.motion_state) })}
              </Text>
              {expanded ? (
                <View style={styles.more}>
                  <Text style={styles.detail}>{t("c708", { value: row.altitude_meters ?? '—', value2: row.heading_degrees ?? '—' })}</Text>
                  <Text style={styles.detail}>{t("c709", { value: formatDateTime(
                    row.recorded_at,
                  ) })}</Text>
                  {row.display_latitude != null ? (
                    <Text style={styles.detail}>
                      {((row.display_source === 'animated') ? t("c710", { value: fixed(row.display_latitude, 6), value2: fixed(
                        row.display_longitude,
                        6,
                      ) }) : t("c711", { value: fixed(row.display_latitude, 6), value2: fixed(
                        row.display_longitude,
                        6,
                      ) }))}
                    </Text>
                  ) : null}
                  <Text style={styles.detail}>
                    {t("c712", { value: fixed(
                      row.raw_speed_kmh,
                      1,
                      ' km/h',
                    ), value2: fixed(
                      row.speed_accuracy_mps,
                      2,
                      ' m/s',
                    ) })}
                  </Text>
                  {row.raw_latitude != null ? (
                    <Text style={styles.detail}>
                      {((row.motion_state === 'stationary') ? t("c705", { value: fixed(row.raw_latitude, 6), value2: fixed(
                        row.raw_longitude,
                        6,
                      ) }) : t("c704", { value: fixed(row.raw_latitude, 6), value2: fixed(
                        row.raw_longitude,
                        6,
                      ) }))}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          </View>
        );
      })}
      </LoadingContent>
    </ScrollView>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    row: {
      minHeight: touch.row,
      paddingVertical: space.s,
      paddingHorizontal: space.xs,
      borderTopWidth: border.hairline,
      borderTopColor: colors.line,
    },
    pressed: { backgroundColor: colors.pressedOverlay },
    head: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    time: { ...type.status, color: colors.text },
    id: { ...type.small, color: colors.textMuted },
    value: { ...type.body, color: colors.text, marginTop: space.xs },
    detail: { ...type.small, color: colors.textMuted, marginTop: space.xs },
    more: { marginTop: space.xs },
    break: {
      ...type.captionBold,
      color: colors.warn,
      textAlign: 'center',
      paddingVertical: space.s,
      borderTopWidth: border.hairline,
      borderTopColor: colors.line,
    },
  });
});

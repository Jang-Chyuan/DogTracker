import { t } from '../i18n';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radius, space as gap, type, border } from '../theme/tokens';
import { formatClockSeconds, formatDateTime } from '../map/MapFormat';
import {
  ColumnPicker,
  DataTable,
  LoadState,
  PillButton,
  TextButton,
  getDataStyles,
} from '../settings/DataTable';
import {
  GroupCard,
  GroupTitle,
  ListRow,
  getSettingsStyles,
} from '../settings/SettingsUI';
import { getCloudClient } from './CloudClient';
import { CLOUD_BUDGET_BYTES } from './CloudDatabase';

/** The stored record is the whole Supabase row, JSON encoded when it arrived. */
export function formatRaw(value) {
  if (!value) return t("c571");
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return String(value);
  }
}

const PAGE = 50;
// The downloaded columns (nothing is cut short: a cell wraps).
const COLUMNS = [
  ['received_at', t("c531"), 150, formatDateTime],
  ['master_id', t('c075'), 64],
  ['slave_id', t("c532"), 64],
  ['slave_lat', t("c533"), 96],
  ['slave_lon', t("c534"), 104],
  ['speed_kmh', t("c535"), 84],
  ['battery_percentage', t("c536"), 64],
  ['usb_present', 'usb_present', 96],
  ['satellites', t("c537"), 52],
  ['hdop', 'HDOP', 64],
  ['activity', t("c538"), 72],
  ['rssi', 'RSSI', 64],
  ['snr', 'SNR', 56],
  ['sequence', t("c539"), 72],
].map(([key, label, width, format]) => ({ key, label, width, format }));
// What the table shows until other columns are picked (「恢復預設欄位」).
export const CLOUD_DEFAULT_COLUMNS = Object.freeze([
  'received_at',
  'master_id',
  'slave_id',
  'slave_lat',
  'slave_lon',
  'battery_percentage',
  'usb_present',
  'sequence',
]);

const megabytes = bytes => `${Math.round(bytes / (1024 * 1024))} MB`;

// 設定 → 診斷 → 本機／雲端資料 (S8): the cloud rows downloaded to this phone,
// page by page, each with its original Supabase JSON. Signing in and out,
// and the download/upload status, live on 設定 → Supabase 帳號 (S3).
// `phoneId`: this phone's upload ID, for authorizing it on a receiver in the
// cloud.
export default function CloudDataScreen({
  database,
  sync,
  phoneId = '',
  clientFactory = getCloudClient,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  const dataStyles = useStyles(getDataStyles);
  const [connection] = useState(() => {
    try {
      return { client: clientFactory() };
    } catch (configurationError) {
      return { error: configurationError.message };
    }
  });
  const client = connection.client;
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  // Which row's original Supabase JSON is open. The mapped columns only carry
  // the fields this app reads; the question "does the payload hold anything
  // else, such as the Master's own position" can only be answered by the raw
  // record, which every row already stores.
  const [rawId, setRawId] = useState(null);
  const [count, setCount] = useState(0);
  const [usage, setUsage] = useState(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The first read of this account's rows finished (until then: 讀取中).
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(() => [...CLOUD_DEFAULT_COLUMNS]);
  const [picking, setPicking] = useState(false);
  const mounted = useRef(false);
  const owner = useRef(null);
  const generation = useRef(0);
  const locked = useRef(false);
  const current = version => mounted.current && version === generation.current;

  useEffect(() => {
    mounted.current = true;
    if (!client)
      return () => {
        mounted.current = false;
      };
    let authEventSeen = false;
    const receive = next => {
      if (!mounted.current) return;
      const nextOwner = next?.user.id || null;
      if (owner.current !== nextOwner) {
        generation.current += 1;
        owner.current = nextOwner;
        setRows([]);
        setCount(0);
        setOffset(0);
        setError('');
        setLoaded(false);
      }
      setSession(next);
    };
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, next) => {
      authEventSeen = true;
      receive(next);
    });
    client.auth
      .getSession()
      .then(({ data, error: authError }) => {
        if (!mounted.current || authEventSeen) return;
        if (authError) setError(t("c540"));
        else receive(data.session);
      })
      .catch(() => {
        if (mounted.current) setError(t("c493"));
      });
    return () => {
      mounted.current = false;
      generation.current += 1;
      subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!session?.user.id) return;
    let cancelled = false;
    const version = generation.current;
    const userId = session.user.id;
    database
      .initialize()
      .then(async () => {
        const [history, total, space] = await Promise.all([
          database.listHistory(userId, offset),
          database.count(userId),
          database.usage(),
        ]);
        if (!cancelled && current(version)) {
          setRows(history);
          setCount(total);
          setUsage(space);
          setLoaded(true);
        }
      })
      .catch(failure => {
        if (!cancelled && current(version))
          setError(t("c565", { value: failure?.message || t("c566") }));
      });
    return () => {
      cancelled = true;
    };
  }, [database, session?.user.id, sync?.revision, offset]);

  async function loadRows(nextOffset, version = generation.current) {
    const userId = owner.current;
    if (!userId) return;
    await database.initialize();
    const [history, total, space] = await Promise.all([
      database.listHistory(userId, nextOffset),
      database.count(userId),
      database.usage(),
    ]);
    if (current(version)) {
      setRows(history);
      setCount(total);
      setUsage(space);
      setOffset(nextOffset);
      setLoaded(true);
    }
  }

  async function perform(action) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const version = generation.current;
    try {
      await action(version);
    } catch (failure) {
      if (current(version))
        setError(t("c565", { value: failure?.message || t("c545") }));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(count / PAGE));
  const syncText = !sync
    ? null
    : sync.mode === 'auto'
    ? t("c547")
    : sync.lastSuccess
    ? t("c548", { value: formatClockSeconds(sync.lastSuccess) })
    : t("c549");
  return (
    <ScrollView
      testID="cloud-data"
      style={settingsStyles.page}
      contentContainerStyle={settingsStyles.content}
    >
      {connection.error ? (
        <Text style={styles.error}>{connection.error}</Text>
      ) : null}
      {error && !session ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {!session ? (
        <Text testID="cloud-data-signed-out" style={styles.empty}>{t("c567")}</Text>
      ) : (
        <>
          <GroupTitle>{t("c568")}</GroupTitle>
          <GroupCard flat>
            <ListRow
              title={t("c550")}
              right={session.user.email}
              label={t("c541", { email: session.user.email })}
            />
            {syncText ? (
              <ListRow
                title={t("c552")}
                right={syncText}
                label={t("c542", { syncText: syncText })}
              />
            ) : null}
            {sync?.error ? (
              <ListRow
                problem
                title={t("c553")}
                detail={sync.error}
                detailTone="crit"
                label={t("c543", { error: sync.error })}
              />
            ) : null}
            {phoneId ? (
              <ListRow
                title={t("c554")}
                detail={phoneId}
                label={t("c544", { phoneId: phoneId })}
              />
            ) : null}
          </GroupCard>
          <Text style={dataStyles.hint}>
            {Platform.OS === 'android'
              ? t("c569")
              : t("c570")}
          </Text>
          <Text style={dataStyles.hint}>
            {((usage) ? t("c528", { value: megabytes(
              CLOUD_BUDGET_BYTES,
            ), rows: usage.rows, value2: megabytes(usage.bytes) }) : t("c529", { value: megabytes(
              CLOUD_BUDGET_BYTES,
            ) }))}
          </Text>

          <Text
            style={dataStyles.heading}
            accessibilityRole="header"
          >{t("c560", { count: count })}</Text>
          <View style={dataStyles.buttons}>
            <PillButton
              title={t("c555")}
              disabled={busy}
              onPress={() => perform(() => loadRows(0))}
            />
            <PillButton
              title={picking ? t("c556") : t("c557", { length: selected.length })}
              onPress={() => setPicking(value => !value)}
            />
          </View>
          {picking ? (
            <ColumnPicker
              columns={COLUMNS}
              selected={selected}
              onReset={() => setSelected([...CLOUD_DEFAULT_COLUMNS])}
              onToggle={key =>
                setSelected(shown =>
                  shown.includes(key)
                    ? shown.length === 1
                      ? shown
                      : shown.filter(item => item !== key)
                    : COLUMNS.filter(
                        column =>
                          shown.includes(column.key) || column.key === key,
                      ).map(column => column.key),
                )
              }
            />
          ) : null}
          <LoadState
            testID="cloud-data"
            loading={!loaded && !error}
            error={error}
            onRetry={() => perform(() => loadRows(offset))}
            empty={false}
          />
          {!loaded || error ? null : rows.length ? (
            <>
              <DataTable
                testID="cloud-data-table"
                columns={COLUMNS.filter(column =>
                  selected.includes(column.key),
                )}
                rows={rows}
                openId={rawId}
                rowLabel={row => t("c546", { id: row.id })}
                onRowPress={row =>
                  setRawId(open => (open === row.id ? null : row.id))
                }
              />
              <Text style={dataStyles.hint}>{t("c561")}</Text>
            </>
          ) : (
            <Text style={styles.empty}>{t("c562")}</Text>
          )}
          {rawId != null && (
            <View testID="cloud-data-raw" style={styles.raw}>
              <Text
                style={styles.rawTitle}
              >{t("c563", { rawId: rawId })}</Text>
              <ScrollView horizontal>
                <Text selectable style={styles.rawText}>
                  {formatRaw(rows.find(row => row.id === rawId)?.raw_payload)}
                </Text>
              </ScrollView>
              <TextButton title={t("c558")} onPress={() => setRawId(null)} />
            </View>
          )}
          <Text style={dataStyles.hint}>{t("c564", { value: Math.floor(offset / PAGE) + 1, pages: pages, PAGE: PAGE })}</Text>
          <View style={dataStyles.buttons}>
            <PillButton
              title={t("c559")}
              disabled={busy || offset === 0}
              onPress={() =>
                perform(() => loadRows(Math.max(0, offset - PAGE)))
              }
            />
            <PillButton
              title={t("c551")}
              disabled={busy || offset + PAGE >= count}
              onPress={() => perform(() => loadRows(offset + PAGE))}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    error: { ...type.body, color: colors.crit, marginTop: gap.l },
    empty: { ...type.body, color: colors.textMuted, marginTop: gap.l },
    raw: {
      marginTop: gap.m,
      padding: gap.m,
      borderRadius: radius.input,
      backgroundColor: colors.bg,
      borderWidth: border.hairline,
      borderColor: colors.line,
    },
    rawTitle: { ...type.captionBold, color: colors.text, marginBottom: gap.s },
    rawText: { ...type.small, color: colors.text, fontFamily: 'monospace' },
  });
});

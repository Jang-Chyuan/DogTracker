import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radius, space as gap, type } from '../theme/tokens';
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
  if (!value) return '這筆沒有保留原始紀錄（可能是舊版下載的）。';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return String(value);
  }
}

const PAGE = 50;
// The downloaded columns (nothing is cut short: a cell wraps).
const COLUMNS = [
  ['received_at', '雲端接收時間', 150, formatDateTime],
  ['master_id', '接收器', 64],
  ['slave_id', '訊號源', 64],
  ['slave_lat', '緯度', 96],
  ['slave_lon', '經度', 104],
  ['speed_kmh', '速度 km/h', 84],
  ['battery_percentage', '電量 %', 64],
  ['usb_present', 'usb_present', 96],
  ['satellites', '衛星', 52],
  ['hdop', 'HDOP', 64],
  ['activity', '活動值', 72],
  ['rssi', 'RSSI', 64],
  ['snr', 'SNR', 56],
  ['sequence', '序號', 72],
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
        if (authError) setError('無法讀取登入狀態，請重新登入');
        else receive(data.session);
      })
      .catch(() => {
        if (mounted.current) setError('無法讀取登入狀態');
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
          setError(`讀取失敗：${failure?.message || '手機裡的雲端資料讀不到'}`);
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
        setError(`讀取失敗：${failure?.message || '請再試一次'}`);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(count / PAGE));
  const syncText = !sync
    ? null
    : sync.mode === 'auto'
    ? '自動同步中…'
    : sync.lastSuccess
    ? `上次同步：${formatClockSeconds(sync.lastSuccess)}`
    : '等待自動同步';
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
        <Text testID="cloud-data-signed-out" style={styles.empty}>
          登入 Supabase 帳號後，這裡會列出下載到這支手機的雲端資料。
        </Text>
      ) : (
        <>
          <GroupTitle>帳號與同步</GroupTitle>
          <GroupCard flat>
            <ListRow
              title="帳號"
              right={session.user.email}
              label={`帳號，${session.user.email}`}
            />
            {syncText ? (
              <ListRow
                title="同步"
                right={syncText}
                label={`同步，${syncText}`}
              />
            ) : null}
            {sync?.error ? (
              <ListRow
                problem
                title="同步失敗"
                detail={sync.error}
                detailTone="crit"
                label={`同步失敗，${sync.error}`}
              />
            ) : null}
            {phoneId ? (
              <ListRow
                title="這支手機的上傳 ID"
                detail={phoneId}
                label={`這支手機的上傳 ID，${phoneId}`}
              />
            ) : null}
          </GroupCard>
          <Text style={dataStyles.hint}>
            {Platform.OS === 'android'
              ? '開著 App 時每 30 秒同步；背景或鎖屏時約每 15 分鐘，實際時間看系統省電。第一次取最近 24 小時；沒網路時等網路恢復；登出就停止。'
              : '開著 App 時每 30 秒同步；回到前景立刻補下載。'}
          </Text>
          <Text style={dataStyles.hint}>
            {`下載的資料會留著，直到所有帳號合計超過 ${megabytes(
              CLOUD_BUDGET_BYTES,
            )} 才從最早的開始清除` +
              `${
                usage
                  ? `（目前 ${usage.rows} 筆，約 ${megabytes(usage.bytes)}）`
                  : ''
              }；每筆的原始 JSON 只留一天。`}
          </Text>

          <Text
            style={dataStyles.heading}
            accessibilityRole="header"
          >{`這個帳號下載的資料（共 ${count} 筆）`}</Text>
          <View style={dataStyles.buttons}>
            <PillButton
              title="重新讀取本機資料"
              disabled={busy}
              onPress={() => perform(() => loadRows(0))}
            />
            <PillButton
              title={picking ? '收起欄位' : `選擇欄位（${selected.length}）`}
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
                rowLabel={row => `第 ${row.id} 筆原始資料`}
                onRowPress={row =>
                  setRawId(open => (open === row.id ? null : row.id))
                }
              />
              <Text style={dataStyles.hint}>
                點一列看這筆的原始雲端 JSON；時間照手機的時區。
              </Text>
            </>
          ) : (
            <Text style={styles.empty}>
              這支手機還沒有這個帳號的雲端資料；開著 App 會自動同步。
            </Text>
          )}
          {rawId != null && (
            <View testID="cloud-data-raw" style={styles.raw}>
              <Text
                style={styles.rawTitle}
              >{`原始雲端紀錄（第 ${rawId} 筆）`}</Text>
              <ScrollView horizontal>
                <Text selectable style={styles.rawText}>
                  {formatRaw(rows.find(row => row.id === rawId)?.raw_payload)}
                </Text>
              </ScrollView>
              <TextButton title="關閉原始紀錄" onPress={() => setRawId(null)} />
            </View>
          )}
          <Text style={dataStyles.hint}>{`第 ${
            Math.floor(offset / PAGE) + 1
          } 頁／共 ${pages} 頁，每頁 ${PAGE} 筆`}</Text>
          <View style={dataStyles.buttons}>
            <PillButton
              title="上一頁"
              disabled={busy || offset === 0}
              onPress={() =>
                perform(() => loadRows(Math.max(0, offset - PAGE)))
              }
            />
            <PillButton
              title="下一頁"
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
      borderWidth: 1,
      borderColor: colors.line,
    },
    rawTitle: { ...type.captionBold, color: colors.text, marginBottom: gap.s },
    rawText: { ...type.small, color: colors.text, fontFamily: 'monospace' },
  });
});

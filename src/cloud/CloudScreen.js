import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
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

const columns = [
  ['received_at', '雲端接收時間', 185], ['master_id', 'Master', 75],
  ['slave_id', 'Slave', 70], ['slave_lat', '緯度', 110], ['slave_lon', '經度', 110],
  ['speed_kmh', '速度 km/h', 100], ['battery_percentage', '電量 %', 80],
  ['satellites', '衛星', 65], ['hdop', 'HDOP', 70], ['activity', '活動值', 80],
  ['rssi', 'RSSI', 75], ['snr', 'SNR', 70], ['sequence', '序號', 80],
];

function Field({ label, ...props }) {
  return <View>
    <Text style={ui.text}>{label}</Text>
    <TextInput accessibilityLabel={label} style={styles.input}
      placeholderTextColor="#94a3b8" autoCapitalize="none" autoCorrect={false} {...props} />
  </View>;
}

const megabytes = bytes => `${Math.round(bytes / (1024 * 1024))} MB`;

export default function CloudScreen({ database, sync, clientFactory = getCloudClient }) {
  const [connection] = useState(() => {
    try { return { client: clientFactory() }; }
    catch (configurationError) { return { error: configurationError.message }; }
  });
  const client = connection.client;
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
  const mounted = useRef(false);
  const owner = useRef(null);
  const generation = useRef(0);
  const locked = useRef(false);
  const current = version => mounted.current && version === generation.current;

  useEffect(() => {
    mounted.current = true;
    if (!client) return () => { mounted.current = false; };
    let authEventSeen = false;
    const receive = next => {
      if (!mounted.current) return;
      const nextOwner = next?.user.id || null;
      if (owner.current !== nextOwner) {
        generation.current += 1;        owner.current = nextOwner;
        setRows([]); setCount(0); setOffset(0); setError('');
      }
      setSession(next);
    };
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      authEventSeen = true;
      receive(next);
    });
    client.auth.getSession().then(({ data, error: authError }) => {
      if (!mounted.current || authEventSeen) return;
      if (authError) setError('無法讀取登入狀態，請重新登入');
      else receive(data.session);
    }).catch(() => { if (mounted.current) setError('無法讀取登入狀態'); });
    return () => {
      mounted.current = false;
      generation.current += 1;      subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!session?.user.id) return;
    let cancelled = false;
    const version = generation.current;
    const userId = session.user.id;
    database.initialize().then(async () => {
      const [history, total, space] = await Promise.all([
        database.listHistory(userId, offset), database.count(userId), database.usage(),
      ]);
      if (!cancelled && current(version)) { setRows(history); setCount(total); setUsage(space); }
    }).catch(() => { if (!cancelled && current(version)) setError('讀取本機雲端資料失敗，請按重新讀取'); });
    return () => { cancelled = true; };
  }, [database, session?.user.id, sync?.revision, offset]);

  async function loadRows(nextOffset, version = generation.current) {
    const userId = owner.current;
    if (!userId) return;
    await database.initialize();
    const [history, total, space] = await Promise.all([
      database.listHistory(userId, nextOffset), database.count(userId), database.usage(),
    ]);
    if (current(version)) {
      setRows(history); setCount(total); setUsage(space); setOffset(nextOffset);
    }
  }

  async function perform(action) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError('');
    const version = generation.current;
    try { await action(version); }
    catch (failure) { if (current(version)) setError(failure.message || '操作失敗，請重試'); }
    finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const login = () => perform(async () => {
    const secret = password;
    setPassword('');
    const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password: secret });
    if (authError) throw new Error('登入失敗，請確認帳號、密碼、Email 驗證狀態及網路');
  });
  return <View>
    <Text style={ui.title}>雲端資料</Text>
    {connection.error ? <Text style={ui.error}>{connection.error}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    {!session ? <View style={ui.card}>
      <Text style={ui.heading}>登入 Supabase 帳號</Text>
      <Text style={ui.hint}>登入狀態會安全保存在手機；下次開啟自動恢復登入並補下載。</Text>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" editable={!busy} />
      <Field label="密碼" value={password} onChangeText={setPassword} secureTextEntry editable={!busy} />
      <ActionButton title={busy ? '登入中…' : '登入'} onPress={login}
        disabled={!client || busy || !email.trim() || !password} />
    </View> : <>
      <View style={ui.card}>
        <Text style={ui.text}>{session.user.email}</Text>
        <Text style={ui.hint}>下載範圍由此帳號的 Master 授權決定，包含該 Master 的所有 Slave。</Text>
        <Text style={ui.hint}>{Platform.OS === 'android'
          ? '前景每 30 秒同步；背景或鎖屏每 15 分鐘排程同步，實際時間依系統省電狀態調整。無網路時等待恢復；登出即取消背景同步。'
          : '開著 App 時每 30 秒同步；回到前景立即補下載。'}</Text>
        <Text style={ui.hint}>首次取最近 24 小時；回到前景先顯示本機歷史，同時補下載最新資料。</Text>
        <Text style={ui.hint}>已下載的資料可離線查看；較早且尚未下載的資料目前不提供手動補下載。</Text>
        {sync ? <Text accessibilityLiveRegion="polite" style={ui.hint}>
          {sync.mode === 'auto' ? '自動同步中…' : sync.lastSuccess
            ? `上次同步：${new Date(sync.lastSuccess).toLocaleTimeString('zh-TW', { hour12: false })}`
            : '等待自動同步'}
        </Text> : null}
        {sync?.error ? <Text style={ui.error}>{sync.error}</Text> : null}
        <ActionButton title="登出" secondary disabled={busy} onPress={() => perform(async () => {
          const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
          if (signOutError) throw new Error('登出失敗，請確認連線後重試');
        })} />
      </View>

      <View style={ui.card}>
        <Text style={ui.heading}>本機雲端資料</Text>
        <Text style={ui.hint}>
          下載過的資料會留著，直到所有帳號合計佔用超過 {megabytes(CLOUD_BUDGET_BYTES)}，
          才從最早的開始清除{usage ? `（目前 ${usage.rows} 筆，約 ${megabytes(usage.bytes)}）` : ''}。
          每筆的原始 JSON 只保留一天，其餘欄位不受影響。
        </Text>
        <Text style={ui.hint}>此帳號共 {count} 筆；每頁 50 筆。時間依手機時區顯示。</Text>
        <ActionButton title="重新讀取本機資料" secondary disabled={busy} onPress={() => perform(() => loadRows(0))} />
        {rows.length ? <ScrollView horizontal>
          <View>
            <View style={styles.row}>{columns.map(([key, label, width]) =>
              <Text key={key} style={[styles.cell, styles.header, { width }]}>{label}</Text>)}</View>
            {rows.map(row => <Pressable key={row.id} style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={`第 ${row.id} 筆原始資料`}
              accessibilityState={{ expanded: rawId === row.id }}
              onPress={() => setRawId(open => (open === row.id ? null : row.id))}>
              {columns.map(([key, , width]) => <Text key={key} style={[styles.cell, { width }]}>
                {row[key] == null ? '—' : key === 'received_at'
                  ? new Date(row[key]).toLocaleString('zh-TW', { hour12: false }) : String(row[key])}
              </Text>)}
            </Pressable>)}
          </View>
        </ScrollView> : <Text style={ui.hint}>尚無本機紀錄，請保持 App 開啟，等待自動同步。</Text>}
        {rows.length ? <Text style={ui.hint}>點任何一列可以看這筆的原始雲端 JSON。</Text> : null}
        {rawId != null && <View style={styles.raw}>
          <Text style={ui.text}>原始雲端紀錄（第 {rawId} 筆）</Text>
          <ScrollView horizontal>
            <Text selectable style={styles.rawText}>
              {formatRaw(rows.find(row => row.id === rawId)?.raw_payload)}
            </Text>
          </ScrollView>
          <ActionButton title="關閉原始紀錄" secondary onPress={() => setRawId(null)} />
        </View>}
        <Text style={ui.hint}>第 {Math.floor(offset / 50) + 1} 頁／共 {Math.max(1, Math.ceil(count / 50))} 頁</Text>
        <ActionButton title="上一頁" secondary disabled={busy || offset === 0}
          onPress={() => perform(() => loadRows(Math.max(0, offset - 50)))} />
        <ActionButton title="下一頁" secondary disabled={busy || offset + 50 >= count}
          onPress={() => perform(() => loadRows(offset + 50))} />
      </View>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  input: { color: '#f8fafc', borderColor: '#475569', borderWidth: 1, borderRadius: 8,
    padding: 12, marginBottom: 12, minHeight: 46 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#334155' },
  cell: { color: '#e2e8f0', padding: 8, fontSize: 12 },
  header: { fontWeight: '700', backgroundColor: '#1e3a8a' },
  raw: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#0b1220' },
  rawText: { color: '#e2e8f0', fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
});

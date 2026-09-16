import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { getCloudClient } from './CloudClient';
import { downloadCloudHistory } from './CloudDownload';
import { taiwanDateRange } from './CloudTelemetry';

const today = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
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

export default function CloudScreen({ database, sync, clientFactory = getCloudClient }) {
  const [connection] = useState(() => {
    try { return { client: clientFactory() }; }
    catch (configurationError) { return { error: configurationError.message }; }
  });
  const client = connection.client;
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [master, setMaster] = useState('');
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const owner = useRef(null);
  const generation = useRef(0);
  const locked = useRef(false);
  const controller = useRef(null);
  const current = version => mounted.current && version === generation.current;

  useEffect(() => {
    mounted.current = true;
    if (!client) return () => { mounted.current = false; };
    let authEventSeen = false;
    const receive = next => {
      if (!mounted.current) return;
      const nextOwner = next?.user.id || null;
      if (owner.current !== nextOwner) {
        generation.current += 1;
        controller.current?.abort();
        owner.current = nextOwner;
        setRows([]); setCount(0); setOffset(0); setMessage(''); setError('');
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
      generation.current += 1;
      controller.current?.abort();
      subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!session?.user.id) return;
    let cancelled = false;
    const version = generation.current;
    const userId = session.user.id;
    database.initialize().then(async () => {
      const [history, total] = await Promise.all([
        database.listHistory(userId, offset), database.count(userId),
      ]);
      if (!cancelled && current(version)) { setRows(history); setCount(total); }
    }).catch(() => { if (!cancelled && current(version)) setError('讀取本機雲端資料失敗，請按重新讀取'); });
    return () => { cancelled = true; };
  }, [database, session?.user.id, sync?.revision, offset]);

  async function loadRows(nextOffset, version = generation.current) {
    const userId = owner.current;
    if (!userId) return;
    await database.initialize();
    const [history, total] = await Promise.all([
      database.listHistory(userId, nextOffset), database.count(userId),
    ]);
    if (current(version)) { setRows(history); setCount(total); setOffset(nextOffset); }
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
      if (mounted.current) { setBusy(false); setDownloading(false); }
    }
  }

  const login = () => perform(async () => {
    const secret = password;
    setPassword('');
    const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password: secret });
    if (authError) throw new Error('登入失敗，請確認帳號、密碼、Email 驗證狀態及網路');
  });
  const download = () => perform(async version => {
    const masterText = master.trim();
    if (masterText && (!/^\d+$/.test(masterText) || !Number.isSafeInteger(Number(masterText)))) {
      throw new Error('Master ID 請填整數，或留空下載所有已授權 Master');
    }
    const range = taiwanDateRange(start.trim(), end.trim());
    const userId = owner.current;
    const abort = new AbortController();
    controller.current = abort;
    setDownloading(true); setMessage('準備下載…');
    try {
      await database.initialize();
      const run = leaseCurrent => downloadCloudHistory({
        client, database, owner: userId, ...range,
        masterId: masterText ? Number(masterText) : null, signal: abort.signal,
        isCurrent: () => current(version) && owner.current === userId && leaseCurrent(),
        onProgress: value => { if (current(version)) setMessage(`已處理 ${value} 筆，下載中…`); },
      });
      const processed = sync ? await sync.runManual(run, abort) : await run(() => true);
      if (current(version)) setMessage(processed
        ? `下載完成：處理 ${processed} 筆，重複紀錄不會新增。`
        : '此範圍沒有可讀取的雲端資料，請確認日期、Master 及授權。');
    } catch (failure) {
      if (current(version)) setMessage('下載已停止；已完成批次仍保留，可用相同範圍重試。');
      throw failure;
    } finally {
      controller.current = null;
      if (current(version)) await loadRows(0, version);
    }
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
        <Text style={ui.hint}>前景每 30 秒自動同步；首次取最近 24 小時。切到地圖仍會同步，背景時暫停。</Text>
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
        <Text style={ui.heading}>手動下載</Text>
        <Text style={ui.hint}>日期以台灣時間計算，包含結束日。每次下載截至開始操作的時間。</Text>
        <Field label="開始日期" placeholder="YYYY-MM-DD" value={start} onChangeText={setStart} editable={!busy} />
        <Field label="結束日期" placeholder="YYYY-MM-DD" value={end} onChangeText={setEnd} editable={!busy} />
        <Field label="Master ID（留空為所有已授權 Master）" value={master} onChangeText={setMaster}
          keyboardType="number-pad" editable={!busy} />
        <ActionButton title="下載到手機" onPress={download} disabled={busy} />
        {downloading ? <ActionButton title="取消下載" secondary onPress={() => controller.current?.abort()} /> : null}
        {message ? <Text accessibilityLiveRegion="polite" style={ui.hint}>{message}</Text> : null}
      </View>
      <View style={ui.card}>
        <Text style={ui.heading}>本機雲端資料</Text>
        <Text style={ui.hint}>所有帳號合計保留最新 15,000 筆；超出範圍的較早資料會自動清除。</Text>
        <Text style={ui.hint}>此帳號共 {count} 筆；每頁 50 筆。時間依手機時區顯示。</Text>
        <ActionButton title="重新讀取本機資料" secondary disabled={busy} onPress={() => perform(() => loadRows(0))} />
        {rows.length ? <ScrollView horizontal>
          <View>
            <View style={styles.row}>{columns.map(([key, label, width]) =>
              <Text key={key} style={[styles.cell, styles.header, { width }]}>{label}</Text>)}</View>
            {rows.map(row => <View key={row.id} style={styles.row}>
              {columns.map(([key, , width]) => <Text key={key} style={[styles.cell, { width }]}>
                {row[key] == null ? '—' : key === 'received_at'
                  ? new Date(row[key]).toLocaleString('zh-TW', { hour12: false }) : String(row[key])}
              </Text>)}
            </View>)}
          </View>
        </ScrollView> : <Text style={ui.hint}>尚無本機紀錄，請先下載。</Text>}
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
});

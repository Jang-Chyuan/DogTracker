import React, { useEffect, useState } from 'react';
import { Text, TextInput, Switch, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import HistoryDatePicker from './HistoryDatePicker';
import { historyWindow, localDateString } from './HistoryTime';

export default function HistorySettings({ history }) {
  const [draft, setDraft] = useState(history.preferences);
  useEffect(() => setDraft(history.preferences), [history.preferences]);
  const patch = value => setDraft(current => ({ ...current, ...value }));
  let preview = '';
  try {
    const window = historyWindow({ ...draft, hours: Number(draft.hours) });
    if (Number(draft.hours) > 0 && Number(draft.hours) <= 240)
      preview = `${new Date(window.since).toLocaleString()} ～ ${new Date(window.until).toLocaleString()}`;
  } catch { /* Validation is shown when applying settings. */ }
  return <View style={ui.card}>
    <Text style={ui.heading}>地圖定位來源與歷史</Text>
    {[['enabled', '顯示歷史地圖'], ['phone', '手機定位'], ['client', 'Client（Slave）定位']].map(([key, label]) => <View key={key}>
      <Text style={ui.text}>{label}</Text><Switch accessibilityLabel={label} value={draft[key]} onValueChange={value => patch({ [key]: value })} />
    </View>)}
    <Text style={ui.hint}>手機開關控制歷史軌跡，目前手機位置仍會顯示。Client 開關適用於即時與歷史地圖，不影響位置記錄。變更後請按下方「套用地圖設定」。關閉歷史地圖可回到即時／Demo 地圖。</Text>
    <Text style={ui.text}>Client 來源：{draft.source === 'ble' ? 'BLE 本機資料' : 'Supabase 已下載資料'}</Text>
    <ActionButton title="選用 BLE" secondary onPress={() => patch({ source: 'ble' })} />
    <ActionButton title="選用 Supabase" secondary onPress={() => patch({ source: 'cloud' })} />
    <Text style={ui.text}>時間模式：{draft.timeMode === 'fixed' ? '指定日期與開始時間' : '最近幾小時'}</Text>
    <ActionButton title="最近幾小時" secondary onPress={() => patch({ timeMode: 'recent' })} />
    <ActionButton title="指定日期與開始時間" secondary onPress={() => patch({ timeMode: 'fixed', startDate: draft.startDate || localDateString() })} />
    {draft.timeMode === 'fixed' && <View>
      <HistoryDatePicker value={draft.startDate} onChange={startDate => patch({ startDate })} />
      <Text style={ui.text}>開始時間（24 小時制 HH:mm）</Text>
      <TextInput accessibilityLabel="開始時間" value={draft.startTime} placeholder="08:30" placeholderTextColor="#94a3b8" maxLength={5} autoCorrect={false} onChangeText={startTime => patch({ startTime })} style={ui.text} />
    </View>}
    {[['master', 'Master 編號'], ['slave', 'Slave 編號'], ['hours', draft.timeMode === 'fixed' ? '持續時數（最多 240）' : '最近幾小時（最多 240）']].map(([key, label]) => <View key={key}>
      <Text style={ui.text}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={String(draft[key])} onChangeText={value => patch({ [key]: value })} style={[ui.text, { borderWidth: 1, borderColor: '#64748b', padding: 8 }]} />
    </View>)}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[1, 3, 6, 12, 24].map(hours => <ActionButton key={hours} title={`${hours} 小時`} secondary onPress={() => patch({ hours })} />)}</View>
    <Text style={ui.hint}>依手機本地時區。{draft.timeMode === 'fixed' ? '指定區間不隨目前時間移動。' : '區間會隨目前時間移動。'}</Text>
    {!!preview && <Text style={ui.text}>查詢區間：{preview}</Text>}
    {history.error ? <Text style={ui.error}>{history.error}</Text> : null}
    <ActionButton title={history.busy ? '儲存中…' : '套用地圖設定'} disabled={history.busy} onPress={() => history.save({ ...draft, master: Number(draft.master), slave: Number(draft.slave), hours: Number(draft.hours) })} />
  </View>;
}

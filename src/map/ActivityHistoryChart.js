import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { ACTIVITY_HISTORY_HOURS } from '../cloud/ActivityHistory';

const label = time => new Date(time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
export default function ActivityHistoryChart({ database, owner, active, dogAliases }) {
  const name = dogAliases?.[8]?.trim() || 'Slave 8';
  const [state, setState] = useState({ owner, data: null, error: '' });
  useEffect(() => {
    if (!active || !database?.activityHistory) return undefined;
    let alive = true, timer;
    const refresh = async () => {
      try {
        const data = await database.activityHistory(owner, 8, Date.now());
        if (alive) setState({ owner, data, error: '' });
      } catch { if (alive) setState({ owner, data: null, error: '活動量讀取失敗，稍後重試' }); }
      finally { if (alive) timer = setTimeout(refresh, 60000); }
    };
    refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [database, owner, active]);
  const data = state.owner === owner ? state.data : null;
  const segments = [];
  let part = [];
  for (const [i, point] of (data || []).entries()) {
    if (point.value == null) { if (part.length) segments.push(part); part = []; }
    else part.push({ x: 24 + i * 292 / Math.max(1, data.length - 1), y: 108 - point.value * 96 });
  }
  if (part.length) segments.push(part);
  const values = data?.filter(p => p.value != null) || [];
  return <View style={styles.root} testID="slave-8-activity-chart">
    <Text style={styles.title}>{name} 活動量 · 最近 {ACTIVITY_HISTORY_HOURS} 小時</Text>
    <Text style={styles.note}>每 60 秒有效平均 · 0–1 · 空白代表無有效資料</Text>
    {state.owner === owner && state.error ? <Text>{state.error}</Text> : !data ? <Text>讀取活動量…</Text>
      : !values.length ? <Text>最近 {ACTIVITY_HISTORY_HOURS} 小時尚無有效活動資料</Text> : <>
        <Svg width="100%" height={120} viewBox="0 0 320 120" accessible accessibilityLabel={`${name} 活動量，${values.length} 個有效分鐘，最近有效平均 ${values.at(-1).value.toFixed(3)}`}>
          {[12, 60, 108].map(y => <Line key={y} x1={24} x2={316} y1={y} y2={y} stroke="#CBD5E1" />)}
          {[1, 0.5, 0].map(value => <SvgText key={value} x={0} y={112 - value * 96} fontSize={10} fill="#64748B">{value}</SvgText>)}
          {segments.map((s, i) => s.length > 1
            ? <Polyline key={i} points={s.map(p => `${p.x},${p.y}`).join(' ')} stroke="#2563EB" strokeWidth={2} fill="none" />
            : <Circle key={i} cx={s[0].x} cy={s[0].y} r={2} fill="#2563EB" />)}
        </Svg>
        <Text style={styles.note}>最近有效平均：{values.at(-1).value.toFixed(3)}（{label(values.at(-1).time)}）</Text>
      </>}
    {!!data?.length && <>
      <Svg width="100%" height={22} viewBox="0 0 320 22" accessible accessibilityLabel="時間軸：8 小時前至現在">
        {Array.from({ length: ACTIVITY_HISTORY_HOURS + 1 }, (_, i) => (
          <SvgText key={i} x={24 + i * 292 / ACTIVITY_HISTORY_HOURS} y={15}
            textAnchor={i === ACTIVITY_HISTORY_HOURS ? 'end' : 'middle'} fontSize={11} fill="#64748B">
            {i - ACTIVITY_HISTORY_HOURS}
          </SvgText>
        ))}
      </Svg>
      <Text style={styles.note}>小時（0＝現在）</Text>
    </>}
    <Text style={styles.note}>本機 BLE 優先；缺少時使用已下載的雲端資料。</Text>
  </View>;
}
const styles = StyleSheet.create({ root: { marginVertical: 12 }, title: { fontSize: 15, fontWeight: '700', color: '#253831' },
  note: { fontSize: 12, color: '#64748B', marginVertical: 5 } });

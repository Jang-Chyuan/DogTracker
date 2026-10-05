import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { ACTIVITY_HISTORY_HOURS } from '../cloud/ActivityHistory';

const label = time => new Date(time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
export default function ActivityHistoryChart({ database, owner, active, dogAliases, slaveId }) {
  const name = dogAliases?.[slaveId]?.trim() || `Slave ${slaveId}`;
  const [zoom, setZoom] = useState(null);
  const [offset, setOffset] = useState(0);
  const maximum = ACTIVITY_HISTORY_HOURS * 60;
  const count = Math.min(maximum, zoom ?? maximum);
  const endOffset = Math.min(offset, maximum - count);
  const viewState = useRef(null), pinch = useRef(null), pan = useRef(null);
  const surface = useRef(null);
  const bounds = useRef({ left: 0, width: 320 });
  viewState.current = { count, maximum, endOffset };
  const changeZoom = next => setZoom(Math.max(1, Math.min(viewState.current.maximum, Math.round(next))));
  const responder = useMemo(() => {
    const span = event => {
      const touches = event.nativeEvent.touches || [];
      return touches.length === 2 ? Math.abs(touches[0].pageX - touches[1].pageX) : 0;
    };
    const fraction = event => {
      const touches = event.nativeEvent.touches || [];
      const center = (touches[0].pageX + touches[1].pageX) / 2;
      const x = (center - bounds.current.left) * 320 / bounds.current.width;
      return Math.max(0, Math.min(1, (x - 24) / 292));
    };
    const start = event => {
      if (span(event) <= 10) { pinch.current = null; return; }
      const view = viewState.current;
      pinch.current = { span: span(event), count: view.count,
        anchor: view.maximum - view.endOffset - view.count + fraction(event) * (view.count - 1) };
    };
    const startPan = event => {
      const touches = event.nativeEvent.touches || [];
      pan.current = touches.length === 1 ? { x: touches[0].pageX, offset: viewState.current.endOffset } : null;
    };
    const shouldMove = (event, gesture = {}) => span(event) > 10 || (
      event.nativeEvent.touches?.length === 1 && viewState.current.count < viewState.current.maximum
      && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5);
    return PanResponder.create({
      onStartShouldSetPanResponder: event => span(event) > 10,
      onMoveShouldSetPanResponder: shouldMove,
      onMoveShouldSetPanResponderCapture: shouldMove,
      onPanResponderGrant: event => {
        start(event);
        startPan(event);
        // The sheet may have moved since layout. Measure the surface in the
        // same screen coordinate space as the two touches.
        const snapshot = { nativeEvent: { touches: event.nativeEvent.touches.map(t => ({ pageX: t.pageX })) } };
        const initial = pinch.current;
        surface.current?.measureInWindow?.((left, _top, width) => {
          if (width > 0 && pinch.current === initial) {
            bounds.current = { left, width };
            if (initial) start(snapshot);
          }
        });
      },
      onPanResponderMove: event => {
        const touches = event.nativeEvent.touches || [];
        if (touches.length === 1) {
          pinch.current = null;
          if (!pan.current) { startPan(event); return; }
          const view = viewState.current;
          const minutes = (touches[0].pageX - pan.current.x) * Math.max(1, view.count - 1)
            / (bounds.current.width * 292 / 320);
          setOffset(Math.max(0, Math.min(view.maximum - view.count, Math.round(pan.current.offset + minutes))));
          return;
        }
        pan.current = null;
        const distance = span(event);
        if (distance <= 10) { pinch.current = null; return; }
        if (!pinch.current || pinch.current.span <= 10) { start(event); return; }
        const nextCount = Math.max(1, Math.min(viewState.current.maximum,
          Math.round(pinch.current.count * pinch.current.span / distance)));
        const first = Math.max(0, Math.min(viewState.current.maximum - nextCount,
          Math.round(pinch.current.anchor - fraction(event) * (nextCount - 1))));
        setZoom(nextCount);
        setOffset(viewState.current.maximum - first - nextCount);
      },
      onPanResponderRelease: () => { pinch.current = null; pan.current = null; },
      onPanResponderTerminate: () => { pinch.current = null; pan.current = null; },
    });
  }, []);
  const [state, setState] = useState({ owner, slaveId, data: null, error: '' });
  useEffect(() => {
    if (!active || !database?.activityHistory) return undefined;
    let alive = true, timer;
    const refresh = async () => {
      try {
        const data = await database.activityHistory(owner, slaveId, Date.now());
        if (alive) setState({ owner, slaveId, data, error: '' });
      } catch { if (alive) setState({ owner, slaveId, data: null, error: '活動量讀取失敗，稍後重試' }); }
      finally { if (alive) timer = setTimeout(refresh, 60000); }
    };
    refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [database, owner, slaveId, active]);
  const current = state.owner === owner && state.slaveId === slaveId;
  const range = current ? state.data?.slice(-maximum) : null;
  const end = range ? Math.max(0, range.length - endOffset) : 0;
  const data = range?.slice(Math.max(0, end - count), end);
  const rangeLabel = `最近 ${ACTIVITY_HISTORY_HOURS} 小時`;
  const ticks = data?.length ? [...new Set(Array.from({ length: 5 }, (_, i) =>
    Math.round(i * (data.length - 1) / 4)))] : [];
  const segments = [];
  let part = [];
  for (const [i, point] of (data || []).entries()) {
    if (point.value == null) { if (part.length) segments.push(part); part = []; }
    else part.push({ x: 24 + i * 292 / Math.max(1, data.length - 1), y: 108 - point.value * 96 });
  }
  if (part.length) segments.push(part);
  const values = data?.filter(p => p.value != null) || [];
  return <View style={styles.root} testID={`slave-${slaveId}-activity-chart`}>
    <Text style={styles.title}>{name} 活動量 · {rangeLabel}</Text>
    <View style={styles.ranges}>
      {[
        ['放大時間軸', '＋ 放大', count <= 1, () => changeZoom(count / 2)],
        ['縮小時間軸', '－ 縮小', count >= maximum, () => changeZoom(count * 2)],
        ['查看較早活動', '往前', endOffset >= maximum - count, () => setOffset(Math.min(maximum - count, endOffset + Math.max(1, Math.floor(count / 2))))],
        ['查看較新活動', '往後', endOffset === 0, () => setOffset(Math.max(0, endOffset - Math.max(1, Math.floor(count / 2))))],
        ['重設時間軸', '重設', false, () => { setZoom(null); setOffset(0); }],
      ].map(([accessibilityLabel, text, disabled, onPress]) => <Pressable key={accessibilityLabel}
        accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled}
        accessibilityState={{ disabled }} onPress={onPress} style={[styles.range, disabled && styles.disabled]}>
        <Text style={styles.rangeText}>{text}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.note}>雙指縮放 · 單指右滑看較早、左滑看較新 · 顯示 {count} 分鐘</Text>
    <Text style={styles.note}>每 60 秒有效平均 · 0–1 · 空白代表無有效資料</Text>
    <View ref={surface} collapsable={false} testID="activity-zoom-surface"
      onLayout={event => { if (event.nativeEvent.layout.width > 0) bounds.current.width = event.nativeEvent.layout.width; }}
      {...responder.panHandlers}>
    {current && state.error ? <Text>{state.error}</Text> : !data ? <Text>讀取活動量…</Text>
      : !values.length ? <Text>{rangeLabel}尚無有效活動資料</Text> : <>
        <Svg width="100%" height={120} viewBox="0 0 320 120" preserveAspectRatio="none" accessible accessibilityLabel={`${name} 活動量，${values.length} 個有效分鐘，最近有效平均 ${values.at(-1).value.toFixed(3)}`}>
          {[12, 60, 108].map(y => <Line key={y} x1={24} x2={316} y1={y} y2={y} stroke="#CBD5E1" />)}
          {[1, 0.5, 0].map(value => <SvgText key={value} x={0} y={112 - value * 96} fontSize={10} fill="#64748B">{value}</SvgText>)}
          {segments.map((s, i) => s.length > 1
            ? <Polyline key={i} points={s.map(p => `${p.x},${p.y}`).join(' ')} stroke="#2563EB" strokeWidth={2} fill="none" />
            : <Circle key={i} cx={s[0].x} cy={s[0].y} r={2} fill="#2563EB" />)}
        </Svg>
        <Text style={styles.note}>最近有效平均：{values.at(-1).value.toFixed(3)}（{label(values.at(-1).time)}）</Text>
      </>}
    {!!data?.length && <>
      <Svg width="100%" height={22} viewBox="0 0 320 22" preserveAspectRatio="none" accessible accessibilityLabel={`時間軸：${label(data[0].time)} 至 ${label(data.at(-1).time)}`}>
        {ticks.map((index, i) => (
          <SvgText key={index} x={24 + index * 292 / Math.max(1, data.length - 1)} y={15}
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} fontSize={11} fill="#64748B">
            {label(data[index].time)}
          </SvgText>
        ))}
      </Svg>
      <Text style={styles.note}>時間（手機當地時間）</Text>
    </>}
    </View>
    <Text style={styles.note}>本機 BLE 優先；缺少時使用已下載的雲端資料。</Text>
  </View>;
}
const styles = StyleSheet.create({ root: { marginVertical: 12 }, title: { fontSize: 15, fontWeight: '700', color: '#253831' },
  ranges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
  range: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#EAF1EC' },
  rangeText: { color: '#253831' },
  disabled: { opacity: 0.4 },
  note: { fontSize: 12, color: '#64748B', marginVertical: 5 } });

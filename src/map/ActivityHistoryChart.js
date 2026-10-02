import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { ACTIVITY_HISTORY_HOURS } from '../cloud/ActivityHistory';

const label = time => new Date(time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
// Any dog's activity; it used to be wired to dog 8 only.
export default function ActivityHistoryChart({ database, owner, active, dogAliases, slaveId }) {
  const name = dogAliases?.[slaveId]?.trim() || `狗 ${slaveId}`;
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
  }, [database, owner, active, slaveId]);
  // Another dog's or account's data never shows under this dog's name.
  const mine = state.owner === owner && state.slaveId === slaveId;
  const range = mine ? state.data?.slice(-maximum) : null;
  const end = range ? Math.max(0, range.length - endOffset) : 0;
  const data = range?.slice(Math.max(0, end - count), end);
  const rangeLabel = `最近 ${ACTIVITY_HISTORY_HOURS} 小時`;
  const segments = [];
  let part = [];
  for (const [i, point] of (data || []).entries()) {
    if (point.value == null) { if (part.length) segments.push(part); part = []; }
    else part.push({ x: 24 + i * 292 / Math.max(1, data.length - 1), y: 108 - point.value * 96 });
  }
  if (part.length) segments.push(part);
  const values = data?.filter(p => p.value != null) || [];
  // Compact, as in design 3: the chart is read at a glance; its controls are
  // icons with spoken labels, and its rules are not spelled out on screen.
  return <View style={styles.root} testID={`activity-chart-${slaveId}`}>
    <View style={styles.head}>
      <Text style={styles.title}>活動量・{rangeLabel.replace('最近 ', '')}</Text>
      {values.length > 0 && <View style={styles.ranges}>
        {[
          ['放大時間軸', '＋', count <= 1, () => changeZoom(count / 2)],
          ['縮小時間軸', '－', count >= maximum, () => changeZoom(count * 2)],
          ['查看較早活動', '‹', endOffset >= maximum - count, () => setOffset(Math.min(maximum - count, endOffset + Math.max(1, Math.floor(count / 2))))],
          ['查看較新活動', '›', endOffset === 0, () => setOffset(Math.max(0, endOffset - Math.max(1, Math.floor(count / 2))))],
          ['重設時間軸', '↺', count === maximum && endOffset === 0, () => { setZoom(null); setOffset(0); }],
        ].map(([accessibilityLabel, text, disabled, onPress]) => <Pressable key={accessibilityLabel}
          accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled}
          accessibilityState={{ disabled }} onPress={onPress} style={[styles.range, disabled && styles.disabled]}>
          <Text style={styles.rangeText}>{text}</Text>
        </Pressable>)}
      </View>}
    </View>
    <View ref={surface} collapsable={false} testID="activity-zoom-surface"
      onLayout={event => { if (event.nativeEvent.layout.width > 0) bounds.current.width = event.nativeEvent.layout.width; }}
      {...responder.panHandlers}>
    {mine && state.error ? <Text style={styles.note}>{state.error}</Text>
      : !data ? <Text style={styles.note}>讀取活動量…</Text>
      : !values.length ? <Text style={styles.note}>{rangeLabel}沒有活動資料</Text> : <>
        <Svg width="100%" height={72} viewBox="0 0 320 120" preserveAspectRatio="none" accessible accessibilityLabel={`${name} 活動量，${values.length} 個有效分鐘，最近有效平均 ${values.at(-1).value.toFixed(3)}，空白代表沒有資料`}>
          {[12, 108].map(y => <Line key={y} x1={0} x2={320} y1={y} y2={y} stroke="#EDE6E4" />)}
          {segments.map((s, i) => s.length > 1
            ? <Polyline key={i} points={s.map(p => `${p.x},${p.y}`).join(' ')} stroke="#C94D4A" strokeWidth={2.5} fill="none" />
            : <Circle key={i} cx={s[0].x} cy={s[0].y} r={2.5} fill="#C94D4A" />)}
        </Svg>
      </>}
    {!!data?.length && !!values.length &&
      <Svg width="100%" height={18} viewBox="0 0 320 18" preserveAspectRatio="none" accessible accessibilityLabel={`時間軸：${label(data[0].time)} 至 ${label(data.at(-1).time)}`}>
        {[0, data.length - 1].map((index, i) => (
          <SvgText key={i} x={i ? 316 : 24} y={13}
            textAnchor={i ? 'end' : 'start'} fontSize={11} fill="#5E5E5E">
            {label(data[index].time)}
          </SvgText>
        ))}
      </Svg>}
    </View>
  </View>;
}
const styles = StyleSheet.create({ root: { marginVertical: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  title: { fontSize: 13, fontWeight: '700', color: '#5E5E5E' },
  ranges: { flexDirection: 'row', gap: 2 },
  range: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  rangeText: { color: '#222222', fontSize: 18, fontWeight: '700' },
  disabled: { opacity: 0.3 },
  note: { fontSize: 13, color: '#5E5E5E', marginVertical: 8 } });

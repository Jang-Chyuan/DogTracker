import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { localDateString } from './HistoryTime';

export default function HistoryDatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const year = month.getFullYear(), index = month.getMonth();
  const offset = new Date(year, index, 1).getDay();
  const days = new Date(year, index + 1, 0).getDate();
  function show() {
    if (value) {
      const [y, m] = value.split('-').map(Number);
      setMonth(new Date(y, m - 1, 1));
    }
    setOpen(!open);
  }
  return <View>
    <ActionButton title={`選擇日期：${value || '尚未選擇'}`} secondary onPress={show} />
    {open && <View>
      <Text style={ui.text}>{year} 年 {index + 1} 月</Text>
      <ActionButton title="上一個月" secondary disabled={year === 2000 && index === 0} onPress={() => setMonth(new Date(year, index - 1, 1))} />
      <ActionButton title="下一個月" secondary disabled={year === 2100 && index === 11} onPress={() => setMonth(new Date(year, index + 1, 1))} />
      <View style={styles.grid}>
        {['日', '一', '二', '三', '四', '五', '六'].map(day => <Text key={day} style={[ui.text, styles.cell]}>{day}</Text>)}
        {Array.from({ length: offset + days }, (_, i) => {
          const day = i - offset + 1;
          if (day < 1) return <View key={i} style={styles.cell} />;
          const date = localDateString(new Date(year, index, day));
          return <Pressable key={i} style={[styles.cell, date === value && styles.selected]} accessibilityRole="button" accessibilityLabel={date}
            accessibilityState={{ selected: date === value }} onPress={() => { onChange(date); setOpen(false); }}>
            <Text style={ui.text}>{day}</Text>
          </Pressable>;
        })}
      </View>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', minHeight: 44, alignItems: 'center', textAlign: 'center', justifyContent: 'center' },
  selected: { backgroundColor: '#1d4ed8', borderRadius: 6 },
});

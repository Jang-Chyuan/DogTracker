import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ActionButton, ui } from '../components/ScreenUI';
import { DEMO_PRESETS } from './DemoPresets';

export default function DemoScreen({ tracking, onMap, onBack }) {
  const [choice, setChoice] = useState('A');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const { mode, demoBusy, ready, preferences, demoSummary } = tracking;
  const disabled = !ready.demo || demoBusy;
  const preset = DEMO_PRESETS.find(value => value.key === choice);
  const reset = () =>
    Alert.alert(
      '恢復預設 Demo 資料？',
      '以 A → B → C 三筆取代目前 Demo 資料。正式資料、模式與顯示開關不變。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '確認重設',
          style: 'destructive',
          onPress: async () => {
            setMessage(null);
            if (await tracking.resetDemo())
              setMessage('已恢復 A → B → C 三筆資料');
          },
        },
      ],
    );
  return (
    <View>
      <ActionButton title="‹ 設定" onPress={onBack} secondary />
      <Text style={[ui.title, styles.title]}>Demo 設定</Text>
      <View style={ui.card}>
        <View style={styles.row}>
          <View style={styles.description}>
            <Text style={ui.heading}>Demo 模式</Text>
            <Text style={ui.text}>
              {!preferences.ready
                ? '正在讀取模式設定…'
                : mode === 'demo'
                ? '地圖使用 Demo 資料'
                : '地圖使用正式資料'}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Demo 模式"
            value={mode === 'demo'}
            disabled={!preferences.ready || preferences.busy || demoBusy}
            onValueChange={tracking.setDemoMode}
            trackColor={{ false: '#64748b', true: '#dc6b40' }}
          />
        </View>
        <Text style={ui.hint}>重新開啟 App，保留目前模式。</Text>
        {preferences.busy && <Text style={ui.hint}>儲存設定中…</Text>}
        {preferences.error && (
          <View>
            <Text accessibilityRole="alert" style={ui.error}>
              設定讀取或儲存失敗：{preferences.error}。未套用失敗的變更。
            </Text>
            <ActionButton
              title="重試讀取設定"
              onPress={tracking.retryTrackingPreferences}
              disabled={preferences.busy || demoBusy}
              secondary
            />
          </View>
        )}
      </View>
      <View style={ui.card}>
        <Text style={ui.heading}>手動逐筆 · 選擇預設點</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="選擇 Demo 預設點"
          accessibilityState={{ expanded: pickerOpen, disabled }}
          disabled={disabled}
          style={styles.picker}
          onPress={() => setPickerOpen(value => !value)}
        >
          <Text style={ui.text}>點 {choice} · Master＋Slave 一組座標　⌄</Text>
        </Pressable>
        {pickerOpen && (
          <View accessibilityRole="radiogroup">
            {DEMO_PRESETS.map(value => (
              <Pressable
                key={value.key}
                accessibilityRole="radio"
                accessibilityLabel={'點 ' + value.key}
                accessibilityState={{
                  selected: choice === value.key,
                  disabled,
                }}
                disabled={disabled}
                style={styles.option}
                onPress={() => {
                  setChoice(value.key);
                  setPickerOpen(false);
                }}
              >
                <Text style={ui.text}>
                  點 {value.key}
                  {choice === value.key ? '　✓' : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text selectable style={ui.hint}>
          Master　{preset.masterLat.toFixed(6)}, {preset.masterLon.toFixed(6)}
          {'\n'}Slave　 {preset.slaveLat.toFixed(6)},{' '}
          {preset.slaveLon.toFixed(6)}
        </Text>
        <ActionButton
          title={demoBusy ? '處理中…' : '寫入 1 筆到 Demo DB'}
          disabled={disabled}
          onPress={async () => {
            setMessage(null);
            if (await tracking.appendDemo(choice))
              setMessage('已寫入點 ' + choice);
          }}
        />
        <Text accessibilityLiveRegion="polite" style={ui.text}>
          {demoSummary
            ? `目前 ${demoSummary.count} 筆${
                demoSummary.latestPreset
                  ? ' · 最新點 ' + demoSummary.latestPreset
                  : ''
              }`
            : '尚未取得 Demo 筆數'}
        </Text>
        {message && (
          <Text accessibilityLiveRegion="polite" style={styles.success}>
            {message}
          </Text>
        )}
        {tracking.demoSummaryError && (
          <View>
            <Text accessibilityRole="alert" style={ui.error}>
              筆數讀取失敗：{tracking.demoSummaryError}
              。顯示的筆數可能不是最新；請勿因此重複寫入。
            </Text>
            <ActionButton
              title="重新讀取筆數"
              onPress={tracking.refreshDemoSummary}
              disabled={disabled}
              secondary
            />
          </View>
        )}
        {tracking.errors.demo && (
          <Text accessibilityRole="alert" style={ui.error}>
            Demo 資料錯誤：{tracking.errors.demo}
            {!ready.demo ? '。請重新啟動 App 重試。' : '。前景會重試讀取。'}
          </Text>
        )}
        {tracking.demoError && (
          <Text accessibilityRole="alert" style={ui.error}>
            {tracking.demoError}。原有資料保留，請排除問題後重試。
          </Text>
        )}
      </View>
      <View style={ui.card}>
        <ActionButton title="回到地圖" onPress={onMap} secondary />
        <ActionButton
          title="重設 Demo"
          onPress={reset}
          disabled={disabled}
          destructive
        />
        <Text style={ui.hint}>
          重設恢復 A → B → C 三筆資料。沒有定時新增資料；切換頁面不會改變模式。
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  title: { marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  description: { flex: 1 },
  picker: {
    borderWidth: 1,
    borderColor: '#64748b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    minHeight: 48,
  },
  option: {
    padding: 12,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  success: { color: '#a9e7be', marginTop: 8, fontSize: 14 },
});

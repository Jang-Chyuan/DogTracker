import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Pressable, StyleSheet, Text, TextInput, useWindowDimensions,
  View } from 'react-native';
import { GuideButton, GuideDialog, GuidePage, guideStyles, useKeyboardHeight } from './GuideUI';
import QrCamera from './QrCamera';
import { signalLabel } from './Pairing';
import { colors, radius, space, type } from '../theme/tokens';

// The frame's backdrop before (or without) the camera picture.
const CAMERA_DARK = '#232A27';

/**
 * D3 連接接收器 (D3a–D3d and the dialogs of D3 的情況表). `pairing` is
 * usePairing's answer; `step` draws the guide's progress (first launch only);
 * `camera` false draws the dark frame without the live camera (screen
 * fixtures).
 */
export default function PairingScreen({ pairing, step = null, camera = true, onLayout }) {
  const keyboard = useKeyboardHeight();
  let page;
  if (pairing.view === 'manual') page = <ManualPage pairing={pairing} step={step} keyboard={keyboard} onLayout={onLayout} />;
  else if (pairing.view === 'connecting' || pairing.view === 'stopped') {
    page = <ConnectingPage pairing={pairing} step={step} onLayout={onLayout} />;
  }
  else if (pairing.view === 'connected') page = <ConnectedPage pairing={pairing} step={step} onLayout={onLayout} />;
  else page = <ScanPage pairing={pairing} step={step} camera={camera} onLayout={onLayout} />;
  return (
    <>
      {page}
      <GuideDialog dialog={pairing.dialog} onPress={pairing.press} onClose={pairing.closeDialog} />
    </>
  );
}

// D3a: the scan frame (square, screen − 96dp, radius 16, 4dp accent corners).
function ScanPage({ pairing, step, camera, onLayout }) {
  const { width } = useWindowDimensions();
  const size = Math.max(160, width - 96);
  const denied = pairing.camera === 'denied';
  return (
    <GuidePage testID="pair-scan" step={step} title="連接接收器" body="打開接收器電源，掃描機身上的 QR Code。"
      scroll={false} onLayout={onLayout}
      bottom={(
        <>
          <GuideButton kind="outline" testID="pair-manual" label="找不到 QR Code？手動輸入" onPress={pairing.openManual} />
          <GuideButton kind="text" testID="pair-later" label="稍後再說" onPress={pairing.later} />
        </>
      )}>
      <View style={styles.frameArea}>
        {denied ? (
          <View testID="pair-camera-denied" style={[styles.deniedFrame, { width: size, height: size }]}>
            <Text style={styles.deniedText}>需要相機才能掃描</Text>
            <Pressable testID="pair-camera-settings" accessibilityRole="button" accessibilityLabel="開系統設定"
              onPress={() => Linking.openSettings()} hitSlop={8}
              style={({ pressed }) => [styles.deniedAction, pressed && styles.pressed]}>
              <Text style={guideStyles.link}>開系統設定 ›</Text>
            </Pressable>
          </View>
        ) : (
          <View testID="pair-frame" style={[styles.frame, { width: size, height: size }]}
            accessible accessibilityLabel="QR Code 掃描框">
            {camera && pairing.camera === 'granted'
              ? <QrCamera style={StyleSheet.absoluteFill} paused={!!pairing.dialog} onScan={pairing.onQr} />
              : null}
            <Corners size={size} />
            {pairing.camera === 'granted' && !pairing.dialog ? <ScanLine size={size} /> : null}
          </View>
        )}
      </View>
    </GuidePage>
  );
}

function Corners({ size }) {
  const arm = Math.round(size * 0.18);
  const inset = Math.round(size * 0.12);
  const line = { position: 'absolute', backgroundColor: colors.accent, borderRadius: 2 };
  const corner = (vertical, horizontal) => (
    <React.Fragment key={`${vertical}${horizontal}`}>
      <View style={[line, styles.cornerAcross, { width: arm, [vertical]: inset, [horizontal]: inset }]} />
      <View style={[line, styles.cornerDown, { height: arm, [vertical]: inset, [horizontal]: inset }]} />
    </React.Fragment>
  );
  return <>{[corner('top', 'left'), corner('top', 'right'), corner('bottom', 'left'), corner('bottom', 'right')]}</>;
}

// 「掃描中（框內細線動畫）」: a thin line moving up and down inside the frame.
function ScanLine({ size }) {
  const move = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(move, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(move, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [move]);
  const inset = Math.round(size * 0.16);
  return (
    <Animated.View pointerEvents="none" style={[styles.scanLine, { left: inset, right: inset, top: inset,
      transform: [{ translateY: move.interpolate({ inputRange: [0, 1], outputRange: [0, size - 2 * inset] }) }] }]} />
  );
}

// D3c: the name typed in, and the receivers found nearby.
function ManualPage({ pairing, step, keyboard, onLayout }) {
  const [focused, setFocused] = useState(false);
  const { nearby, nameSearch } = pairing;
  const searchingName = !!nameSearch?.searching;
  return (
    <GuidePage testID="pair-manual-page" step={step} keyboard={keyboard} onLayout={onLayout}
      top={(
        <Pressable testID="pair-back-to-scan" accessibilityRole="button" accessibilityLabel="返回，掃描 QR Code"
          onPress={pairing.back} hitSlop={8} style={({ pressed }) => [styles.topLink, pressed && styles.pressed]}>
          <Text style={guideStyles.link}>‹ 掃描 QR Code</Text>
        </Pressable>
      )}
      title="手動輸入接收器" body="輸入接收器機身上的名稱。"
      bottom={<GuideButton kind="text" testID="pair-later" label="稍後再說" onPress={pairing.later} />}>
      <View style={[styles.field, focused && styles.fieldFocused, pairing.inputError && styles.fieldError]}>
        <TextInput testID="pair-name" accessibilityLabel="接收器名稱" style={styles.input} value={pairing.input}
          onChangeText={pairing.typeName} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={pairing.searchName} />
        <Text style={styles.example}>例：DogGPS-Master7</Text>
      </View>
      {pairing.inputError ? (
        <Text testID="pair-name-error" accessibilityLiveRegion="polite" style={styles.error}>{pairing.inputError}</Text>
      ) : null}
      <View style={styles.searchButton}>
        <GuideButton testID="pair-search" label="搜尋並連線" busy={searchingName} onPress={pairing.searchName} />
      </View>
      <View style={styles.sectionRow}>
        <Text style={[guideStyles.section, styles.sectionText]}>附近找到的接收器</Text>
        {nearby.searching ? <ActivityIndicator testID="pair-nearby-searching" size="small" color={colors.textMuted}
          accessibilityLabel="搜尋中" style={styles.sectionSpinner} /> : null}
      </View>
      {nearby.list.map(item => (
        <Pressable key={item.id} testID={`pair-nearby-${item.name}`} accessibilityRole="button"
          accessibilityLabel={[item.name, signalLabel(item.rssi)].filter(Boolean).join('，')}
          onPress={() => pairing.pickNearby(item)} style={({ pressed }) => [styles.nearby, pressed && styles.pressedRow]}>
          <Text style={styles.nearbyName}>{item.name}</Text>
          <Text style={styles.signal}>{signalLabel(item.rssi)}</Text>
        </Pressable>
      ))}
      {nearby.done && !nearby.list.length ? <Text testID="pair-nearby-none" style={styles.none}>附近找不到接收器</Text> : null}
      {nearby.done ? (
        <Pressable testID="pair-search-again" accessibilityRole="button" accessibilityLabel="重新搜尋"
          onPress={pairing.search} hitSlop={8} style={({ pressed }) => [styles.again, pressed && styles.pressed]}>
          <Text style={guideStyles.link}>重新搜尋</Text>
        </Pressable>
      ) : null}
    </GuidePage>
  );
}

// D3d: connecting, at most 30 s; 取消 stops it and stays in D3. Stopped
// (連不上, 編號不符) its dialog stands over this page, without the spinner.
function ConnectingPage({ pairing, step, onLayout }) {
  const name = pairing.target?.name || 'DogGPS-Master';
  return (
    <GuidePage testID="pair-connecting" step={step} title="連接接收器" body={`正在連 ${name}…`} scroll={false}
      onLayout={onLayout}
      bottom={<GuideButton kind="outline" testID="pair-cancel" label="取消" onPress={pairing.cancel} />}>
      <View style={styles.frameArea}>
        {pairing.view === 'connecting'
          ? <ActivityIndicator size="large" color={colors.textMuted} accessibilityLabel={`正在連 ${name}`} /> : null}
      </View>
    </GuidePage>
  );
}

// Back on D3 from D4: 「已連上 接收器 7」 with 下一步 and 換一台 (c269, c270).
function ConnectedPage({ pairing, step, onLayout }) {
  const text = pairing.connectedNumber != null ? `已連上 接收器 ${pairing.connectedNumber}` : '已連上接收器';
  return (
    <GuidePage testID="pair-connected" step={step} title="連接接收器" scroll={false} onLayout={onLayout}
      bottom={(
        <>
          <GuideButton testID="pair-next" label="下一步" onPress={pairing.next} />
          <GuideButton kind="text" testID="pair-change" label="換一台" onPress={pairing.changeReceiver} />
        </>
      )}>
      <View style={styles.connectedRow} accessible accessibilityLabel={text}>
        <View style={styles.okCircle}><Text style={styles.okMark}>✓</Text></View>
        <Text style={styles.connectedText}>{text}</Text>
      </View>
    </GuidePage>
  );
}

const styles = StyleSheet.create({
  frameArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.xl },
  frame: { borderRadius: radius.scanFrame, backgroundColor: CAMERA_DARK, overflow: 'hidden' },
  deniedFrame: { borderRadius: radius.scanFrame, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center', padding: space.xl },
  deniedText: { ...type.status, color: colors.text, textAlign: 'center' },
  deniedAction: { minHeight: 48, justifyContent: 'center', marginTop: space.s },
  cornerAcross: { height: 4 },
  cornerDown: { width: 4 },
  scanLine: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: colors.accent, opacity: 0.8 },
  topLink: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', marginTop: -space.m,
    marginBottom: space.xs },
  field: { minHeight: 56, borderRadius: radius.input, borderWidth: 1.5, borderColor: colors.line,
    paddingHorizontal: space.l, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface },
  fieldFocused: { borderWidth: 2, borderColor: colors.accent },
  fieldError: { borderWidth: 2, borderColor: colors.critLine },
  input: { ...type.body, color: colors.text, flex: 1, paddingVertical: space.s },
  example: { ...type.caption, color: colors.textMuted, marginLeft: space.s },
  error: { ...type.caption, color: colors.crit, marginTop: space.xs },
  searchButton: { marginTop: space.m },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end' },
  sectionText: { flex: 1 },
  sectionSpinner: { position: 'absolute', right: 0, bottom: space.s },
  nearby: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1,
    borderBottomColor: colors.line },
  pressedRow: { backgroundColor: colors.pressedOverlay },
  nearbyName: { ...type.body, color: colors.text, flex: 1 },
  signal: { ...type.caption, color: colors.textMuted },
  none: { ...type.body, color: colors.textMuted, marginTop: space.l },
  again: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  connectedRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.l },
  okCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.okBg, alignItems: 'center',
    justifyContent: 'center', marginRight: space.m },
  okMark: { ...type.captionBold, color: colors.ok },
  connectedText: { ...type.status, color: colors.text },
  pressed: { opacity: 0.6 },
});

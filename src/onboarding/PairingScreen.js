import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  GuideButton,
  GuideDialog,
  GuidePage,
  getGuideStyles,
  useKeyboardHeight,
} from './GuideUI';
import QrCamera from './QrCamera';
import { signalBars, signalBarsLabel } from './Pairing';
import SignalBars from './SignalBars';
import { radius, space, type, size as sizes, border, touch } from '../theme/tokens';
import { useReduceMotion } from '../utils/reduceMotion';

// The frame's backdrop before (or without) the camera picture.
const getCAMERA_DARK = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.cameraFrameBackground;
});

/**
 * D3 連接接收器 (D3a–D3d and the dialogs of D3 的情況表). `pairing` is
 * usePairing's answer; `step` draws the guide's progress (first launch only);
 * `camera` false draws the dark frame without the live camera (screen
 * fixtures).
 */
export default function PairingScreen({
  pairing,
  step = null,
  camera = true,
  onLayout,
}) {
  const keyboard = useKeyboardHeight();
  let page;
  if (pairing.view === 'manual')
    page = (
      <ManualPage
        pairing={pairing}
        step={step}
        keyboard={keyboard}
        onLayout={onLayout}
      />
    );
  else if (pairing.view === 'connecting' || pairing.view === 'stopped') {
    page = <ConnectingPage pairing={pairing} step={step} onLayout={onLayout} />;
  } else if (pairing.view === 'connected')
    page = <ConnectedPage pairing={pairing} step={step} onLayout={onLayout} />;
  else {
    page = (
      <ScanPage
        pairing={pairing}
        step={step}
        camera={camera}
        onLayout={event => {
          onLayout?.(event);
          pairing.onShown?.();
        }}
      />
    );
  }
  return (
    <>
      {page}
      <GuideDialog
        dialog={pairing.dialog}
        onPress={pairing.press}
        onClose={pairing.closeDialog}
      />
    </>
  );
}

// D3a: the scan frame (square, screen − 96dp, radius 16, 4dp accent corners).
function ScanPage({ pairing, step, camera, onLayout }) {
  const styles = useStyles(getStyles);
  const guideStyles = useStyles(getGuideStyles);
  const { width } = useWindowDimensions();
  const size = Math.max(sizes.scanFrame.minimum, width - sizes.scanFrame.inset);
  const denied = pairing.camera === 'denied';
  const live = camera && pairing.camera === 'granted';
  return (
    <GuidePage
      testID="pair-scan"
      step={step}
      title="連接接收器"
      body="打開接收器電源，掃描機身上的 QR Code。"
      scroll={false}
      onLayout={onLayout}
      bottom={
        <>
          <GuideButton
            kind="outline"
            testID="pair-manual"
            label="找不到 QR Code？手動輸入"
            onPress={pairing.openManual}
          />
          <GuideButton
            kind="text"
            testID="pair-later"
            label="稍後再說"
            onPress={pairing.later}
          />
        </>
      }
    >
      <View style={styles.frameArea}>
        {denied ? (
          <View
            testID="pair-camera-denied"
            style={[styles.deniedFrame, { width: size, height: size }]}
          >
            <Text style={styles.deniedText}>需要相機才能掃描</Text>
            <Pressable
              testID="pair-camera-settings"
              accessibilityRole="button"
              accessibilityLabel="開系統設定"
              onPress={() => Linking.openSettings()}
              hitSlop={space.s}
              style={({ pressed }) => [
                styles.deniedAction,
                pressed && styles.pressed,
              ]}
            >
              <Text style={guideStyles.link}>開系統設定 ›</Text>
            </Pressable>
          </View>
        ) : (
          // Keyed by the camera: the native preview is mounted together with
          // the corners drawn over it (a native view added later would cover
          // them).
          <View
            key={live ? 'live' : 'dark'}
            testID="pair-frame"
            style={[styles.frame, { width: size, height: size }]}
            accessible
            accessibilityLabel="QR Code 掃描框"
          >
            {live ? (
              <QrCamera
                style={StyleSheet.absoluteFill}
                paused={!!pairing.dialog}
                onScan={pairing.onQr}
              />
            ) : null}
            <Corners size={size} />
            {pairing.camera === 'granted' && !pairing.dialog ? (
              <ScanLine size={size} />
            ) : null}
          </View>
        )}
      </View>
    </GuidePage>
  );
}

function Corners({ size }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const arm = Math.round(size * 0.18);
  const inset = Math.round(size * 0.12);
  const line = {
    position: 'absolute',
    backgroundColor: colors.accent,
    borderRadius: sizes.scanFrame.corner / 2,
  };
  const corner = (vertical, horizontal) => (
    <React.Fragment key={`${vertical}${horizontal}`}>
      <View
        style={[
          line,
          styles.cornerAcross,
          { width: arm, [vertical]: inset, [horizontal]: inset },
        ]}
      />
      <View
        style={[
          line,
          styles.cornerDown,
          { height: arm, [vertical]: inset, [horizontal]: inset },
        ]}
      />
    </React.Fragment>
  );

  return (
    <>
      {[
        corner('top', 'left'),
        corner('top', 'right'),
        corner('bottom', 'left'),
        corner('bottom', 'right'),
      ]}
    </>
  );
}

// 「掃描中（框內細線動畫）」: a thin line moving up and down inside the frame.
function ScanLine({ size }) {
  const styles = useStyles(getStyles);
  const move = useRef(new Animated.Value(0)).current;
  const reduced = useReduceMotion();
  useEffect(() => {
    // 減少動態效果: the line rests in the middle of the frame.
    if (reduced) {
      move.setValue(0.5);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(move, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(move, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [move, reduced]);
  const inset = Math.round(size * 0.16);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.scanLine,
        {
          left: inset,
          right: inset,
          top: inset,
          transform: [
            {
              translateY: move.interpolate({
                inputRange: [0, 1],
                outputRange: [0, size - 2 * inset],
              }),
            },
          ],
        },
      ]}
    />
  );
}

// D3c: the name typed in, and the receivers found nearby.
function ManualPage({ pairing, step, keyboard, onLayout }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const guideStyles = useStyles(getGuideStyles);
  const [focused, setFocused] = useState(false);
  const { nearby, nameSearch } = pairing;
  const searchingName = !!nameSearch?.searching;
  return (
    <GuidePage
      testID="pair-manual-page"
      step={step}
      keyboard={keyboard}
      onLayout={onLayout}
      top={
        <Pressable
          testID="pair-back-to-scan"
          accessibilityRole="button"
          accessibilityLabel="返回，掃描 QR Code"
          onPress={pairing.back}
          hitSlop={space.s}
          style={({ pressed }) => [styles.topLink, pressed && styles.pressed]}
        >
          <Text style={guideStyles.link}>‹ 掃描 QR Code</Text>
        </Pressable>
      }
      title="手動輸入接收器"
      body="輸入接收器機身上的名稱。"
      bottom={
        <GuideButton
          kind="text"
          testID="pair-later"
          label="稍後再說"
          onPress={pairing.later}
        />
      }
    >
      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          pairing.inputError && styles.fieldError,
        ]}
      >
        <TextInput
          cursorColor={colors.accent}
          selectionColor={`${colors.accent}66`}
          selectionHandleColor={colors.accent}
          testID="pair-name"
          accessibilityLabel="接收器名稱"
          style={styles.input}
          value={pairing.input}
          onChangeText={pairing.typeName}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={pairing.searchName}
        />
      </View>
      <Text testID="pair-name-example" style={styles.example}>例：DogGPS-Master7</Text>
      {pairing.inputError ? (
        <Text
          testID="pair-name-error"
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {pairing.inputError}
        </Text>
      ) : null}
      <View style={styles.searchButton}>
        <GuideButton
          testID="pair-search"
          label="搜尋並連線"
          busy={searchingName}
          onPress={pairing.searchName}
        />
      </View>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionText}>附近找到的接收器</Text>
        {nearby.searching ? (
          <ActivityIndicator
            testID="pair-nearby-searching"
            size="small"
            color={colors.textMuted}
            accessibilityLabel="搜尋中"
          />
        ) : null}
      </View>
      {nearby.list.map((item, index) => (
        <Pressable
          key={item.id}
          testID={`pair-nearby-${item.name}`}
          accessibilityRole="button"
          accessibilityLabel={[item.name, signalBarsLabel(signalBars(item.rssi))]
            .filter(Boolean)
            .join('，')}
          onPress={() => pairing.pickNearby(item)}
          style={({ pressed }) => [
            styles.nearby,
            index === nearby.list.length - 1 && styles.lastNearby,
            pressed && styles.pressedRow,
          ]}
        >
          <Text style={styles.nearbyName}>{item.name}</Text>
          <SignalBars bars={signalBars(item.rssi)} />
        </Pressable>
      ))}
      {nearby.done && !nearby.list.length ? (
        <Text testID="pair-nearby-none" style={styles.none}>
          附近找不到接收器
        </Text>
      ) : null}
      {nearby.done ? (
        <Pressable
          testID="pair-search-again"
          accessibilityRole="button"
          accessibilityLabel="重新搜尋"
          onPress={pairing.search}
          hitSlop={space.s}
          style={({ pressed }) => [styles.again, pressed && styles.pressed]}
        >
          <Text style={guideStyles.link}>重新搜尋</Text>
        </Pressable>
      ) : null}
    </GuidePage>
  );
}

// D3d: connecting, at most 30 s; 取消 stops it and stays in D3. Stopped
// (連不上, 編號不符) its dialog stands over this page, without the spinner.
function ConnectingPage({ pairing, step, onLayout }) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const name = pairing.target?.name || 'DogGPS-Master';
  return (
    <GuidePage
      testID="pair-connecting"
      step={step}
      title="連接接收器"
      body={`正在連 ${name}…`}
      scroll={false}
      onLayout={onLayout}
      bottom={
        <GuideButton
          kind="outline"
          testID="pair-cancel"
          label="取消"
          onPress={pairing.cancel}
        />
      }
    >
      <View style={styles.frameArea}>
        {pairing.view === 'connecting' ? (
          <ActivityIndicator
            size="large"
            color={colors.textMuted}
            accessibilityLabel={`正在連 ${name}`}
          />
        ) : null}
      </View>
    </GuidePage>
  );
}

// Back on D3 from D4: 「已連上 接收器 7」 with 下一步 and 換一台 (c269, c270).
function ConnectedPage({ pairing, step, onLayout }) {
  const styles = useStyles(getStyles);
  const text =
    pairing.connectedNumber != null
      ? `已連上 接收器 ${pairing.connectedNumber}`
      : '已連上接收器';
  return (
    <GuidePage
      testID="pair-connected"
      step={step}
      title="連接接收器"
      scroll={false}
      onLayout={onLayout}
      bottom={
        <>
          <GuideButton
            testID="pair-next"
            label="下一步"
            onPress={pairing.next}
          />
          <GuideButton
            kind="text"
            testID="pair-change"
            label="換一台"
            onPress={pairing.changeReceiver}
          />
        </>
      }
    >
      <View style={styles.connectedRow} accessible accessibilityLabel={text}>
        <View style={styles.okCircle}>
          <Text style={styles.okMark} allowFontScaling={false}>✓</Text>
        </View>
        <Text style={styles.connectedText}>{text}</Text>
      </View>
    </GuidePage>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  const CAMERA_DARK = getCAMERA_DARK(theme);
  return StyleSheet.create({
    frameArea: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: space.xl,
    },
    frame: {
      borderRadius: radius.scanFrame,
      backgroundColor: CAMERA_DARK,
      overflow: 'hidden',
    },
    deniedFrame: {
      borderRadius: radius.scanFrame,
      backgroundColor: colors.bg,
      borderWidth: border.hairline,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xl,
    },
    deniedText: { ...type.status, color: colors.text, textAlign: 'center' },
    deniedAction: {
      minHeight: touch.min,
      justifyContent: 'center',
      marginTop: space.s,
    },
    cornerAcross: { height: sizes.scanFrame.corner },
    cornerDown: { width: sizes.scanFrame.corner },
    scanLine: {
      position: 'absolute',
      height: sizes.scanFrame.beam,
      borderRadius: sizes.scanFrame.beamRadius,
      backgroundColor: colors.accent,
      opacity: 0.8,
    },
    topLink: {
      minHeight: touch.min,
      justifyContent: 'center',
      alignSelf: 'flex-start',
      marginTop: -space.m,
      marginBottom: space.xs,
    },
    field: {
      minHeight: sizes.input.height,
      borderRadius: radius.input,
      borderWidth: border.regular,
      borderColor: colors.floatingOutline,
      paddingHorizontal: space.l,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    fieldFocused: { borderWidth: border.strong, borderColor: colors.accent },
    fieldError: { borderWidth: border.strong, borderColor: colors.critLine },
    input: {
      ...type.body,
      color: colors.text,
      flex: 1,
      paddingVertical: space.s,
    },
    example: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
    error: { ...type.caption, color: colors.crit, marginTop: space.xs },
    searchButton: { marginTop: space.m },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: space.xl,
      minHeight: sizes.groupTag.height,
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.line,
      paddingBottom: space.xs,
    },
    sectionText: { ...type.captionBold, color: colors.textMuted, flex: 1 },
    nearby: {
      minHeight: touch.row,
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: border.hairline,
      borderBottomColor: colors.line,
    },
    lastNearby: { borderBottomWidth: 0 },
    pressedRow: { backgroundColor: colors.pressedOverlay },
    nearbyName: { ...type.body, color: colors.text, flex: 1 },
    none: { ...type.body, color: colors.textMuted, marginTop: space.l },
    again: { minHeight: touch.min, justifyContent: 'center', alignSelf: 'flex-start' },
    connectedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: space.l,
    },
    okCircle: {
      width: sizes.permission.statusDisc,
      height: sizes.permission.statusDisc,
      borderRadius: sizes.permission.statusDisc / 2,
      backgroundColor: colors.okBg,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: space.m,
    },
    okMark: { ...type.captionBold, color: colors.ok },
    connectedText: { ...type.status, color: colors.text },
    pressed: { opacity: 0.6 },
  });
});

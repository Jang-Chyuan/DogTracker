import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { radius, space, type } from '../theme/tokens';

// The pieces every page of the first-use guide shares (design D1–D4): the
// four-step progress bar, the headline and its line, the buttons pinned to
// the bottom (a 56dp tonal pill, an outlined pill, a 48dp text button) and
// the dialog (rounded 24, title, body, text buttons on the right).

export const GUIDE_STEPS = 4;

/** The guide's progress: four 4dp bars, the steps reached in accent. */
export function GuideProgress({ step }) {
  const styles = useStyles(getStyles);
  if (!step) return <View style={styles.noProgress} />;
  return (
    <View
      testID="guide-progress"
      style={styles.progress}
      accessible
      accessibilityLabel={`第 ${step} 步，共 ${GUIDE_STEPS} 步`}
    >
      {Array.from({ length: GUIDE_STEPS }, (_, index) => (
        <View
          key={index}
          style={[styles.segment, index < step && styles.segmentOn]}
        />
      ))}
    </View>
  );
}

// The keyboard's height: the buttons ride on top of it (the window is drawn
// edge to edge, so it does not shrink for the keyboard).
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const onShow = Keyboard.addListener('keyboardDidShow', event =>
      setHeight(event?.endCoordinates?.height || 0),
    );
    const onHide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);
  return height;
}

/**
 * A guide page: progress (`step`, only in the first-launch guide), `top`
 * (above the headline, e.g. 「‹ 掃描 QR Code」), headline, its line, the page's
 * own content (`children`, filling the middle) and `bottom` (GuideButton
 * elements). `scroll` lets the middle scroll (lists).
 */
export function GuidePage({
  testID,
  step,
  top = null,
  icon = null,
  title,
  body,
  children,
  bottom,
  scroll = true,
  onLayout,
  keyboard = 0,
}) {
  const styles = useStyles(getStyles);
  const head = (
    <>
      <GuideProgress step={step} />
      {top}
      {icon}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </>
  );

  return (
    <View
      testID={testID}
      style={[styles.page, keyboard > 0 && { paddingBottom: keyboard }]}
      onLayout={onLayout}
    >
      {scroll ? (
        <ScrollView
          style={styles.middle}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {head}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.middle, styles.content]}>
          {head}
          {children}
        </View>
      )}
      {bottom ? <View style={styles.bottom}>{bottom}</View> : null}
    </View>
  );
}

/**
 * A button of the guide. kind: 'primary' (56dp tonal pill), 'outline'
 * (56dp pill with a line, white), 'text' (48dp, tonalText). `busy` adds a
 * spinner and keeps the label.
 */
export function GuideButton({
  kind = 'primary',
  label,
  onPress,
  disabled = false,
  busy = false,
  testID,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const style =
    kind === 'text'
      ? styles.text
      : kind === 'outline'
      ? styles.outline
      : styles.primary;
  const words =
    kind === 'text'
      ? styles.textLabel
      : kind === 'outline'
      ? styles.outlineLabel
      : styles.primaryLabel;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        disabled && styles.disabled,
        pressed && (kind === 'text' ? styles.pressed : styles.pressedButton),
      ]}
    >
      <View style={styles.buttonRow}>
        {busy ? (
          <ActivityIndicator color={colors.tonalText} style={styles.spinner} />
        ) : null}
        <Text style={words}>{label}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The guide's dialog (D3b, D3d, 編號不符…): `dialog` is { title, body,
 * buttons: [{ id, label }] }; the last button is the main one. Back or a tap
 * outside closes it (onClose).
 */
export function GuideDialog({
  dialog,
  onPress,
  onClose,
  testID = 'guide-dialog',
}) {
  const styles = useStyles(getStyles);
  return (
    <Modal
      visible={!!dialog}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityLabel="關閉對話框"
      >
        {dialog ? (
          <Pressable
            testID={testID}
            style={styles.dialog}
            accessibilityViewIsModal
            onPress={() => {}}
          >
            <Text style={styles.dialogTitle} accessibilityRole="header">
              {dialog.title}
            </Text>
            {dialog.body ? (
              <Text style={styles.dialogBody}>{dialog.body}</Text>
            ) : null}
            <View style={styles.dialogButtons}>
              {dialog.buttons.map(button => (
                <Pressable
                  key={button.id}
                  testID={`${testID}-${button.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={button.label}
                  onPress={() => onPress(button.id)}
                  style={({ pressed }) => [
                    styles.dialogButton,
                    pressed && styles.dialogPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.dialogAction,
                      button.id === 'cancel' && styles.dialogCancel,
                    ]}
                  >
                    {button.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

export const getGuideStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    link: { ...type.captionBold, color: colors.tonalText },
  });
});

const getStyles = makeStyles(theme => {
  const { colors, opacity, literalColors: themeLiteral } = theme;
  return StyleSheet.create({
    // Light keeps its white page; dark uses the page bg (深色模式「底色層次」).
    page: {
      flex: 1,
      backgroundColor: theme.isDark ? colors.bg : colors.surface,
    },
    middle: { flex: 1 },
    content: {
      flexGrow: 1,
      paddingHorizontal: space.xl,
      paddingTop: space.l,
      paddingBottom: space.l,
    },
    progress: { flexDirection: 'row', gap: space.xs, marginBottom: space.xl },
    segment: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.line,
    },
    segmentOn: { backgroundColor: colors.accent },
    noProgress: { height: space.s },
    title: { ...type.headline, color: colors.text, marginBottom: space.s },
    body: { ...type.body, color: colors.textMuted, marginBottom: space.l },
    bottom: {
      paddingHorizontal: space.xl,
      paddingTop: space.s,
      paddingBottom: space.l,
      gap: space.xs,
    },
    primary: {
      minHeight: 56,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.l,
    },
    outline: {
      minHeight: 56,
      borderRadius: radius.button,
      backgroundColor: colors.elevated,
      borderWidth: 1.5,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.l,
    },
    text: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    primaryLabel: { ...type.status, color: colors.tonalText },
    outlineLabel: { ...type.status, color: colors.text },
    textLabel: { ...type.status, color: colors.tonalText },
    buttonRow: { flexDirection: 'row', alignItems: 'center' },
    spinner: { marginRight: space.s },
    disabled: { opacity: opacity.disabled },
    pressed: { opacity: 0.6 },
    pressedButton: { transform: [{ scale: 0.97 }] },
    scrim: {
      flex: 1,
      backgroundColor: colors.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xl,
    },
    dialog: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: colors.elevated,
      borderRadius: radius.dialog,
      ...theme.floatingBorder,
      padding: space.xl,
      elevation: 8,
      shadowColor: themeLiteral.dialogShadow,
      shadowOpacity: theme.isDark ? 0.4 : 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    dialogTitle: { ...type.title, color: colors.text },
    dialogBody: { ...type.body, color: colors.textMuted, marginTop: space.m },
    dialogButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      flexWrap: 'wrap',
      marginTop: space.l,
      gap: space.s,
    },
    dialogButton: {
      minHeight: 48,
      minWidth: 64,
      paddingHorizontal: space.m,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.button,
    },
    dialogPressed: { backgroundColor: colors.pressedOverlay },
    dialogAction: { ...type.status, color: colors.tonalText },
    // 取消: light as before (textMuted); dark tonalText (S7 確認對話框・深色).
    dialogCancel: {
      color: theme.isDark ? colors.tonalText : colors.textMuted,
    },
  });
});

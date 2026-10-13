import { t } from '../i18n';
// A5: a dog's edit sheet, opened from its card (DESIGN.md §12「狗的名稱與頭像」).
// One sheet rises from the bottom over the dimmed card: 「取消 名字和頭像 完成」,
// the name input at the top with 「訊號源 4」 under it (read only), the face
// picker below (拍照／相簿／插圖, 樣子, 底色). Nothing is stored until 完成,
// which stores the name and the face together; 取消, the dimmed card and the
// back key store nothing (with something changed they ask first). The sheet
// rides on top of the keyboard and scrolls, so the keyboard never covers the
// picker.
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AvatarPicker, { faceOf, sameAvatar } from './AvatarPicker';
import { NAME_MAX, clampName, nameLength, nameToSave } from './DogName';
import ConfirmDialog from '../settings/ConfirmDialog';
import { isReduceMotion, REDUCED_FADE_MS } from '../utils/reduceMotion';
import { useInitialFocus } from '../utils/a11yFocus';
import { useKeyboardHeight } from '../utils/keyboard';
import { motion, radius, size as sizes, space, touch, type, border } from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);
const CLOSE_MS = 180;

/**
 * @param slaveId the dog's collar number (訊號源)
 * @param name what the dog is called now (「狗 4」 when never named)
 * @param alias the name stored for it ('' when none)
 * @param avatar its stored face, or null for the default
 * @param onSaveName(name) / onSaveAvatar(avatar) resolve true once stored
 * @param onBack back to the card (called once the sheet has slid away)
 * @param picker react-native-image-crop-picker (tests pass a stub)
 */
export default function DogProfile({
  slaveId,
  name,
  alias,
  avatar,
  onSaveName,
  onSaveAvatar,
  onBack,
  picker,
}) {
  const { colors } = useTheme();
  const styles = useStyles(getStyles);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  // React Native's keyboard height leaves out the navigation bar under it;
  // drawn edge to edge, the keyboard covers that too.
  const covered = keyboard ? keyboard + insets.bottom : 0;
  const [text, setText] = useState(alias || '');
  const [face, setFace] = useState(() => faceOf(avatar));
  const [focused, setFocused] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  // While storing, nothing can be typed or chosen, so nothing is lost.
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const input = useRef(null);
  const progress = useRef(new Animated.Value(0)).current;
  // 減少動態效果: no slide, the sheet fades with its scrim (DESIGN.md §8).
  const reduced = useRef(isReduceMotion()).current;
  // TalkBack starts on the sheet's title (設計稿「無障礙」).
  const titleRef = useRef(null);
  useInitialFocus(titleRef);
  const [sheetHeight, setSheetHeight] = useState(0);
  const closing = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // What 完成 would store: a trimmed new name (null: empty, spaces or the
  // same — the dog keeps its name) and the face, if it is a different one.
  const newName = nameToSave(text, alias);
  const faceChanged = !sameAvatar(face, avatar);
  const changed = newName != null || faceChanged;
  const busy = saving || photoBusy;
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    input.current?.blur();
    Keyboard.dismiss();
    Animated.timing(progress, {
      toValue: 0,
      duration: reduced ? REDUCED_FADE_MS : CLOSE_MS,
      easing: ease,
      useNativeDriver: true,
    }).start(() => onBack?.());
  }, [onBack, progress, reduced]);
  // 取消, the dimmed card and the back key: nothing is stored; with a change
  // made, the discard dialog asks first.
  const cancel = useCallback(() => {
    if (busy || closing.current) return;
    if (!changed) {
      close();
      return;
    }
    input.current?.blur();
    Keyboard.dismiss();
    setConfirming(true);
  }, [busy, changed, close]);
  const done = async () => {
    if (busy || closing.current) return;
    input.current?.blur();
    Keyboard.dismiss();
    if (!changed) {
      close();
      return;
    }
    setFailed(false);
    setSaving(true);
    const store = async (save, value) => {
      try {
        return !!(await save(value));
      } catch {
        return false;
      }
    };
    // Each is stored once: after a partial failure the stored one matches
    // its new props and only the other is tried again.
    const results = [
      faceChanged ? await store(onSaveAvatar, face) : true,
      newName != null ? await store(onSaveName, newName) : true,
    ];
    if (!alive.current) return;
    setSaving(false);
    if (results.every(Boolean)) close();
    else setFailed(true);
  };
  // Registered once; the newest state is read through refs.
  const backRef = useRef(cancel);
  backRef.current = cancel;
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // The dialog's own back (Modal) keeps editing.
      if (confirmingRef.current) setConfirming(false);
      else backRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);
  // The keyboard going away (Android's back key closes it first) ends typing.
  useEffect(() => {
    if (!keyboard) input.current?.blur();
  }, [keyboard]);
  const onLayout = event => {
    const value = Math.round(event.nativeEvent.layout.height);
    if (!value || sheetHeight) return;
    setSheetHeight(value);
    Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? REDUCED_FADE_MS : motion.cardRise.duration,
      easing: ease,
      useNativeDriver: true,
    }).start();
  };
  // A choice in the picker puts the keyboard away, so the picker is in full view.
  const leaveName = () => {
    input.current?.blur();
    Keyboard.dismiss();
  };
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reduced ? 0 : sheetHeight || windowHeight, 0],
  });
  const sheetOpacity = reduced ? progress : 1;
  const count = nameLength(text);
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} testID="dog-profile">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('c046')}
          testID="dog-profile-scrim"
          onPress={cancel}
        />
      </Animated.View>
      <Animated.View
        onLayout={onLayout}
        accessibilityViewIsModal
        importantForAccessibility={confirming ? 'no-hide-descendants' : 'auto'}
        testID="dog-profile-sheet"
        style={[
          styles.sheet,
          {
            // On top of the keyboard (the window does not shrink for it).
            bottom: covered,
            paddingBottom: space.l + (keyboard ? 0 : insets.bottom),
            maxHeight: windowHeight - insets.top - covered,
            transform: [{ translateY }],
            opacity: sheetOpacity,
          },
          !sheetHeight && styles.unmeasured,
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('c046')}
            disabled={busy}
            accessibilityState={{ disabled: busy }}
            onPress={cancel}
            testID="dog-profile-cancel"
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          >
            <Text style={styles.cancel}>{t('c046')}</Text>
          </Pressable>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header">
            {t('c1330')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('c101')}
            disabled={busy}
            accessibilityState={{ disabled: busy, busy: saving }}
            onPress={done}
            testID="dog-profile-done"
            style={({ pressed }) => [styles.headerButton, styles.headerEnd, pressed && styles.pressed]}
          >
            <View style={styles.doneRow}>
              {saving && <ActivityIndicator size="small" color={colors.tonalText} />}
              <Text style={styles.done}>{t('c101')}</Text>
            </View>
          </Pressable>
        </View>
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.body}
        >
          {failed && (
            <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {t('c627')}
            </Text>
          )}
          <Text style={[styles.section, styles.firstSection]}>{t('c1331')}</Text>
          <View
            style={[styles.field, focused && styles.fieldFocused]}
            testID="dog-profile-name-field"
          >
            <TextInput
              ref={input}
              cursorColor={colors.accent}
              selectionColor={`${colors.accent}66`}
              selectionHandleColor={colors.accent}
              value={text}
              accessibilityLabel={t('c347')}
              onChangeText={value => {
                setFailed(false);
                setText(clampName(value));
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              editable={!saving}
              maxLength={NAME_MAX * 2}
              placeholder={t('c347')}
              placeholderTextColor={colors.textMuted}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              testID="dog-profile-name-input"
              style={styles.input}
            />
            {count >= NAME_MAX - 4 && (
              <Text testID="dog-name-count" style={styles.count}>{`${count}/${NAME_MAX}`}</Text>
            )}
          </View>
          <Text style={styles.signal} testID="dog-profile-source">
            {t('c052', { number: slaveId })}
          </Text>
          <Text style={styles.section}>{t('c100')}</Text>
          <AvatarPicker
            value={face}
            name={name}
            picker={picker}
            disabled={saving}
            onInteract={leaveName}
            onBusy={setPhotoBusy}
            onChange={next => {
              setFailed(false);
              setFace(next);
            }}
          />
        </ScrollView>
      </Animated.View>
      <ConfirmDialog
        visible={confirming}
        testID="dog-profile-discard"
        title={t('c1332')}
        body={t('c1333')}
        cancelLabel={t('c1334')}
        confirm={t('c1335')}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          close();
        }}
      />
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    // Over the card, the map's gear and its top cards.
    layer: { zIndex: 80, elevation: 40 },
    scrim: { backgroundColor: colors.scrim },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      backgroundColor: colors.elevated,
      ...theme.floatingBorder,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: space.l,
      paddingTop: space.s,
      elevation: 16,
    },
    unmeasured: { opacity: 0 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.min,
    },
    headerButton: {
      minWidth: touch.min,
      minHeight: touch.min,
      justifyContent: 'center',
      borderRadius: radius.button,
      paddingHorizontal: space.xs,
    },
    headerEnd: { alignItems: 'flex-end' },
    doneRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    cancel: { ...type.status, color: colors.textMuted },
    done: { ...type.status, color: colors.tonalText },
    title: { ...type.status, color: colors.text, flex: 1, textAlign: 'center' },
    body: { paddingTop: space.s },
    error: { ...type.caption, color: colors.crit, textAlign: 'center' },
    section: {
      ...type.captionBold,
      color: colors.textMuted,
      marginTop: space.l,
      marginBottom: space.xs,
    },
    firstSection: { marginTop: space.s },
    // DESIGN.md 文字輸入欄: 56dp, radius 12, 1.5dp line; focused 2dp accent.
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: sizes.input.height,
      borderRadius: radius.input,
      borderWidth: border.regular,
      borderColor: colors.floatingOutline,
      paddingHorizontal: space.l,
      backgroundColor: colors.surface,
    },
    fieldFocused: { borderWidth: border.strong, borderColor: colors.accent },
    input: {
      ...type.body,
      color: colors.text,
      flex: 1,
      paddingVertical: space.s,
      paddingHorizontal: 0,
    },
    count: { ...type.caption, color: colors.textMuted, marginLeft: space.s },
    signal: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
    pressed: { backgroundColor: colors.pressedOverlay },
  });
});

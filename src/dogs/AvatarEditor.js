import { t } from '../i18n';
import { lightTheme } from '../theme/ThemeProvider';
// A5c: a dog's face, edited in a sheet that rises from the bottom of its page
// (design v3 A5c; DESIGN.md §12「狗的名稱與頭像」). 拍照／相簿 take a photo,
// 插圖 offers the five drawings (樣子) on twelve colours (底色). Nothing is
// stored until 完成; 取消, the dimmed page above and the back key leave the
// face as it was.
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DogAvatar from './DogAvatar';
import { isReduceMotion, REDUCED_FADE_MS } from '../utils/reduceMotion';
import { useInitialFocus } from '../utils/a11yFocus';
import {
  DEFAULT_AVATAR,
  DOG_ARTS,
  DOG_ART_KEYS,
  DOG_COLORS,
  DOG_COLOR_ROWS,
  normalizeAvatar,
} from './DogArt';
import { PHOTO_ERRORS, pickPhoto } from './PhotoAvatar';
import {
  motion,
  radius,
  size as sizes,
  space,
  touch,
  type,
  border,
} from '../theme/tokens';

const ease = Easing.bezier(...motion.easeOut);
const CLOSE_MS = 180;
// The A5c mockup's unselected 樣子: a neutral face, so the chosen colour stays
// the selected one's.
export const getNEUTRAL_TINT = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return Object.freeze({
    bg: themeLiteral.avatarNeutralBackground,
    line: themeLiteral.avatarNeutralLine,
  });
});
// The ring around the chosen 底色 (the mockup's dark line colour).
const getCOLOR_RING = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return themeLiteral.avatarSelectedRing;
});
const PREVIEW = sizes.edit.preview;

const sameAvatar = (left, right) =>
  JSON.stringify(normalizeAvatar(left) || DEFAULT_AVATAR) ===
  JSON.stringify(normalizeAvatar(right) || DEFAULT_AVATAR);

function SourceButton({ label, selected, disabled, onPress }) {
  const styles = useStyles(getStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      testID={`avatar-source-${label}`}
      style={({ pressed }) => [
        styles.source,
        selected && styles.sourceSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.sourceText, selected && styles.sourceTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * @param avatar the face stored now (null: the default illustration)
 * @param name the dog's name, for TalkBack
 * @param onSave(avatar) resolves true once stored
 * @param onClose called once the sheet has slid away
 * @param picker react-native-image-crop-picker (tests pass a stub)
 */
export default function AvatarEditor({
  avatar,
  name,
  onSave,
  onClose,
  picker,
}) {
  const styles = useStyles(getStyles);
  const NEUTRAL_TINT = useStyles(getNEUTRAL_TINT);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const saved = normalizeAvatar(avatar) || DEFAULT_AVATAR;
  const [draft, setDraft] = useState(saved);
  // The drawing and colour 插圖 comes back to after a photo was taken.
  const [art, setArt] = useState(saved.kind === 'art' ? saved : DEFAULT_AVATAR);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const progress = useRef(new Animated.Value(0)).current;
  // 減少動態效果: no slide, the sheet fades with its scrim (DESIGN.md §8).
  const reduced = useRef(isReduceMotion()).current;
  // TalkBack starts on the sheet's title (設計稿「無障礙」).
  const titleRef = useRef(null);
  useInitialFocus(titleRef);
  const sheetOpacity = reduced ? progress : 1;
  const [sheetHeight, setSheetHeight] = useState(0);
  const closing = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: reduced ? REDUCED_FADE_MS : CLOSE_MS,
      easing: ease,
      useNativeDriver: true,
    }).start(() => onClose?.());
  }, [onClose, progress, reduced]);
  // Back = 取消 (design 返回鍵: A5c 打開時等於「取消」).
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (!busy) close();
        return true;
      },
    );
    return () => subscription.remove();
  }, [busy, close]);
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
  const choose = next => {
    if (closing.current) return;
    setMessage('');
    setDraft(next);
    if (next.kind === 'art') setArt(next);
  };
  const photo = async source => {
    if (busy || closing.current) return;
    setBusy(true);
    setMessage('');
    const result = await pickPhoto(source, picker);
    if (!alive.current) return;
    setBusy(false);
    if (result.avatar) setDraft(result.avatar);
    else if (result.error) setMessage(PHOTO_ERRORS[result.error]);
  };
  const done = async () => {
    // Nothing is stored once 取消 (or back) has started closing the sheet.
    if (busy || closing.current) return;
    if (sameAvatar(draft, saved)) {
      close();
      return;
    }
    setBusy(true);
    let ok = false;
    try {
      ok = await onSave(draft);
    } catch {
      ok = false;
    }
    if (!alive.current) return;
    setBusy(false);
    if (ok) close();
    else setMessage(t("c627"));
  };
  const illustration = draft.kind === 'art';
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reduced ? 0 : sheetHeight || windowHeight, 0],
  });
  return (
    <View style={StyleSheet.absoluteFill} testID="avatar-editor">
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('c046')}
          onPress={() => {
            if (!busy) close();
          }}
        />
      </Animated.View>
      <Animated.View
        onLayout={onLayout}
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            paddingBottom: space.l + insets.bottom,
            maxHeight: windowHeight - insets.top,
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
            onPress={close}
            testID="avatar-cancel"
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.cancel}>{t('c046')}</Text>
          </Pressable>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header">{t('c100')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('c101')}
            disabled={busy}
            accessibilityState={{ disabled: busy }}
            onPress={done}
            testID="avatar-done"
            style={({ pressed }) => [
              styles.headerButton,
              styles.headerEnd,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.done}>{t('c101')}</Text>
          </Pressable>
        </View>
        <ScrollView bounces={false} contentContainerStyle={styles.body}>
          <View
            style={styles.preview}
            accessible
            accessibilityLabel={t("c626", { name: name })}
          >
            <DogAvatar avatar={draft} size={PREVIEW} border={0} />
          </View>
          <View style={styles.sources}>
            <SourceButton
              label={t('c102')}
              disabled={busy}
              onPress={() => photo('camera')}
            />
            <SourceButton
              label={t('c103')}
              disabled={busy}
              onPress={() => photo('library')}
            />
            <SourceButton
              label={t('c104')}
              disabled={busy}
              selected={illustration}
              onPress={() => choose(art)}
            />
          </View>
          {!!message && (
            <Text style={styles.message} accessibilityRole="alert">
              {message}
            </Text>
          )}
          {illustration && (
            <>
              <Text style={styles.section}>{t('c105')}</Text>
              <View
                style={styles.arts}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('c105')}
              >
                {DOG_ART_KEYS.map(key => {
                  const selected = draft.art === key;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="radio"
                      accessibilityLabel={DOG_ARTS[key].label}
                      accessibilityState={{ selected }}
                      testID={`avatar-art-${key}`}
                      onPress={() =>
                        choose({ kind: 'art', art: key, color: draft.color })
                      }
                      style={({ pressed }) => [styles.artChoice, selected && styles.artSelected, pressed && styles.pressed]}
                    >
                      {/* The drawing says which; the name is for TalkBack. */}
                      <DogAvatar
                        avatar={{ kind: 'art', art: key, color: draft.color }}
                        size={sizes.edit.choice}
                        border={0}
                        tint={selected ? null : NEUTRAL_TINT}
                      />
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.section}>{t('c106')}</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel={t('c106')}>
                {DOG_COLOR_ROWS.map(row => (
                  <View key={row[0]} style={styles.colors}>
                    {row.map(key => {
                      const selected = draft.color === key;
                      return (
                        <Pressable
                          key={key}
                          accessibilityRole="radio"
                          accessibilityLabel={DOG_COLORS[key].label}
                          accessibilityState={{ selected }}
                          testID={`avatar-color-${key}`}
                          onPress={() =>
                            choose({ kind: 'art', art: draft.art, color: key })
                          }
                          style={({ pressed }) => [styles.colorTarget, pressed && styles.pressed]}
                        >
                          <View
                            style={[
                              styles.colorRing,
                              selected && styles.colorRingSelected,
                            ]}
                          >
                            <View
                              style={[
                                styles.colorDot,
                                { backgroundColor: DOG_COLORS[key].bg },
                              ]}
                            />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const DOT = sizes.edit.colorDot;
const getStyles = makeStyles(theme => {
  const { colors } = theme;
  const COLOR_RING = getCOLOR_RING(theme);
  return StyleSheet.create({
    scrim: { backgroundColor: colors.scrim },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
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
    cancel: { ...type.status, color: colors.textMuted },
    done: { ...type.status, color: colors.tonalText },
    title: { ...type.status, color: colors.text, flex: 1, textAlign: 'center' },
    body: { paddingTop: space.s },
    preview: { alignSelf: 'center', marginBottom: space.l },
    sources: { flexDirection: 'row', gap: space.s },
    source: {
      flex: 1,
      minHeight: touch.min,
      paddingVertical: space.xs,
      borderRadius: radius.input,
      borderWidth: border.hairline,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sourceSelected: {
      backgroundColor: colors.tonal,
      borderColor: colors.tonal,
    },
    sourceText: { ...type.status, color: colors.text },
    sourceTextSelected: { color: colors.tonalText },
    message: {
      ...type.caption,
      color: colors.crit,
      marginTop: space.s,
      textAlign: 'center',
    },
    section: {
      ...type.captionBold,
      color: colors.textMuted,
      marginTop: space.l,
      marginBottom: space.xs,
    },
    arts: { flexDirection: 'row', justifyContent: 'space-between' },
    // 48dp drawn; the chosen one gets a 2dp white gap and a 2dp accent ring.
    artChoice: {
      width: sizes.edit.choice + sizes.edit.choiceRingClearance,
      height: sizes.edit.choice + sizes.edit.choiceRingClearance,
      borderRadius: (sizes.edit.choice + sizes.edit.choiceRingClearance) / 2,
      borderWidth: border.strong,
      borderColor: 'transparent',
      padding: space.xs,
      alignItems: 'center',
      justifyContent: 'center',
    },
    artSelected: { borderColor: colors.accent },
    colors: { flexDirection: 'row', justifyContent: 'space-between' },
    // 32dp dots, 48dp to the finger.
    colorTarget: {
      width: touch.min,
      height: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    colorRing: {
      width: DOT + sizes.edit.colorRingClearance,
      height: DOT + sizes.edit.colorRingClearance,
      borderRadius: (DOT + sizes.edit.colorRingClearance) / 2,
      borderWidth: border.strong,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    colorRingSelected: { borderColor: COLOR_RING },
    colorDot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
    pressed: { backgroundColor: colors.pressedOverlay },
  });
});

// Compatibility for non-hook consumers; views resolve their current theme.
export const NEUTRAL_TINT = getNEUTRAL_TINT(lightTheme);

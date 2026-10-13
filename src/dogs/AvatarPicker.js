import { t } from '../i18n';
import { lightTheme } from '../theme/ThemeProvider';
// A dog's face as chosen in its edit sheet (A5; DESIGN.md §12「狗的名稱與頭像」):
// the preview, 拍照／相簿 for a photo, 插圖 for the five drawings (樣子) on
// twelve colours (底色). It only changes `value`; the sheet stores it with the
// name on 完成 (DogProfile).
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DogAvatar from './DogAvatar';
import {
  DEFAULT_AVATAR,
  DOG_ARTS,
  DOG_ART_KEYS,
  DOG_COLORS,
  DOG_COLOR_ROWS,
  normalizeAvatar,
} from './DogArt';
import { PHOTO_ERRORS, pickPhoto } from './PhotoAvatar';
import { radius, size as sizes, space, touch, type, border } from '../theme/tokens';

// The unselected 樣子: a neutral face, so the chosen colour stays the
// selected one's.
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

/** The face a stored value stands for (null: the default illustration). */
export const faceOf = avatar => normalizeAvatar(avatar) || DEFAULT_AVATAR;

export const sameAvatar = (left, right) =>
  JSON.stringify(faceOf(left)) === JSON.stringify(faceOf(right));

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
 * @param value the face chosen so far (normalized; never null)
 * @param name the dog's name, for TalkBack
 * @param onChange(avatar) a new face was chosen
 * @param onBusy(busy) a photo is being taken or picked
 * @param onInteract called before any choice (the sheet closes the keyboard)
 * @param disabled while the sheet is storing or closing
 * @param picker react-native-image-crop-picker (tests pass a stub)
 */
export default function AvatarPicker({
  value,
  name,
  onChange,
  onBusy,
  onInteract,
  disabled = false,
  picker,
}) {
  const styles = useStyles(getStyles);
  const NEUTRAL_TINT = useStyles(getNEUTRAL_TINT);
  // The drawing and colour 插圖 comes back to after a photo was taken.
  const [art, setArt] = useState(value.kind === 'art' ? value : DEFAULT_AVATAR);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const off = disabled || busy;
  const choose = next => {
    if (off) return;
    onInteract?.();
    setMessage('');
    if (next.kind === 'art') setArt(next);
    onChange(next);
  };
  const photo = async source => {
    if (off) return;
    onInteract?.();
    setBusy(true);
    onBusy?.(true);
    setMessage('');
    const result = await pickPhoto(source, picker);
    if (!alive.current) return;
    setBusy(false);
    onBusy?.(false);
    if (result.avatar) onChange(result.avatar);
    else if (result.error) setMessage(PHOTO_ERRORS[result.error]);
  };
  const illustration = value.kind === 'art';
  return (
    <View testID="avatar-picker">
      <View
        style={styles.preview}
        accessible
        accessibilityLabel={t('c626', { name: name })}
      >
        <DogAvatar avatar={value} size={PREVIEW} border={0} />
      </View>
      <View style={styles.sources}>
        <SourceButton label={t('c102')} disabled={off} onPress={() => photo('camera')} />
        <SourceButton label={t('c103')} disabled={off} onPress={() => photo('library')} />
        <SourceButton
          label={t('c104')}
          disabled={off}
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
          <View style={styles.arts} accessibilityRole="radiogroup" accessibilityLabel={t('c105')}>
            {DOG_ART_KEYS.map(key => {
              const selected = value.art === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityLabel={DOG_ARTS[key].label}
                  accessibilityState={{ selected, disabled: off }}
                  testID={`avatar-art-${key}`}
                  onPress={() => choose({ kind: 'art', art: key, color: value.color })}
                  style={({ pressed }) => [styles.artChoice, selected && styles.artSelected, pressed && styles.pressed]}
                >
                  {/* The drawing says which; the name is for TalkBack. */}
                  <DogAvatar
                    avatar={{ kind: 'art', art: key, color: value.color }}
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
                  const selected = value.color === key;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="radio"
                      accessibilityLabel={DOG_COLORS[key].label}
                      accessibilityState={{ selected, disabled: off }}
                      testID={`avatar-color-${key}`}
                      onPress={() => choose({ kind: 'art', art: value.art, color: key })}
                      style={({ pressed }) => [styles.colorTarget, pressed && styles.pressed]}
                    >
                      <View style={[styles.colorRing, selected && styles.colorRingSelected]}>
                        <View style={[styles.colorDot, { backgroundColor: DOG_COLORS[key].bg }]} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const DOT = sizes.edit.colorDot;
const getStyles = makeStyles(theme => {
  const { colors } = theme;
  const COLOR_RING = getCOLOR_RING(theme);
  return StyleSheet.create({
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
    // The 48dp target around a colour swatch presses as a circle.
    colorTarget: {
      width: touch.min,
      height: touch.min,
      borderRadius: radius.full,
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

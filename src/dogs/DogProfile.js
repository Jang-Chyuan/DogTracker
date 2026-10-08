// A5: a dog's own page, opened by the pencil on its card (design v3 A5/A5a/
// A5c; DESIGN.md §12). The face with a camera button (A5c), the name with a
// pencil, 「訊號源 4」 under it. The title bar has only ‹.
//
// The name is edited in place (A5a): tapping it turns it into an input with
// the keyboard up; the keyboard's 完成, tapping anywhere else, or the keyboard
// going away stores it. Empty or only spaces is not an error: the dog keeps
// the name it had. ‹ and the back key store a name being edited, then return
// to the card; with A5c open they cancel A5c instead.
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AvatarEditor from './AvatarEditor';
import DogAvatar from './DogAvatar';
import { NAME_MAX, clampName, nameLength, nameToSave } from './DogName';
import Glyph from '../map/Glyph';
import { radius, size as sizes, space, touch, type } from '../theme/tokens';

const AVATAR = sizes.edit.avatar;
const CAMERA = sizes.edit.camera;

/**
 * @param slaveId the dog's collar number (訊號源)
 * @param name what the dog is called now (「狗 4」 when never named)
 * @param alias the name stored for it ('' when none)
 * @param avatar its stored face, or null for the default
 * @param onSaveName(name) / onSaveAvatar(avatar) resolve true once stored
 * @param onBack back to the card
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
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // While a name is being stored the input is read-only, so nothing typed
  // meanwhile is dropped when it closes.
  const [saving, setSaving] = useState(false);
  const input = useRef(null);
  // One finish per edit: 完成 blurs the input too, and blur finishes again.
  const finishing = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const startEditing = () => {
    if (editing) return;
    finishing.current = null;
    setFailed(false);
    setText(alias || '');
    setEditing(true);
  };
  // Stores the typed name (if there is one to store) and leaves the input.
  // Resolves false only when storing failed (the input stays open).
  const finish = useCallback(() => {
    if (!editing) return Promise.resolve(true);
    if (finishing.current) return finishing.current;
    const next = nameToSave(text, alias);
    finishing.current = (async () => {
      let ok = true;
      if (next != null) {
        setSaving(true);
        try {
          ok = await onSaveName(next);
        } catch {
          ok = false;
        }
      }
      if (!alive.current) return ok;
      setSaving(false);
      finishing.current = null;
      if (ok) setEditing(false);
      else setFailed(true);
      return ok;
    })();
    return finishing.current;
  }, [editing, text, alias, onSaveName]);
  // The keyboard going away (Android's back key closes it first) ends the edit.
  useEffect(() => {
    if (!editing) return undefined;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      finish();
    });
    return () => subscription.remove();
  }, [editing, finish]);
  const back = useCallback(async () => {
    if (await finish()) onBack?.();
  }, [finish, onBack]);
  // Registered once, so A5c's own listener (added when it opens) always comes
  // first; with A5c open this one passes the key on to it.
  const backRef = useRef(back);
  backRef.current = back;
  const avatarOpenRef = useRef(false);
  avatarOpenRef.current = avatarOpen;
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (avatarOpenRef.current) return false;
        backRef.current();
        return true;
      },
    );
    return () => subscription.remove();
  }, []);
  const tapOutside = () => {
    if (!editing) return;
    input.current?.blur();
    Keyboard.dismiss();
    finish();
  };
  return (
    <View style={[StyleSheet.absoluteFill, styles.page]} testID="dog-profile">
      {/* Behind the content: a tap anywhere else ends a name edit. Not a
             control for TalkBack (the keyboard's 完成 and ‹ are). */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={tapOutside}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        testID="dog-profile-outside"
      />
      {/* With A5c open, TalkBack stays in the sheet. */}
      <View
        style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}
        pointerEvents="box-none"
        importantForAccessibility={avatarOpen ? 'no-hide-descendants' : 'auto'}
      >
        <View style={styles.header} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            onPress={back}
            testID="dog-profile-back"
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Glyph name="back" color={colors.text} size={22} />
          </Pressable>
        </View>
        <View style={styles.profile} pointerEvents="box-none">
          <View style={styles.avatarWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`改${name}的頭像`}
              testID="dog-profile-avatar"
              onPress={() => {
                tapOutside();
                setAvatarOpen(true);
              }}
            >
              <DogAvatar avatar={avatar} size={AVATAR} border={0} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`改${name}的頭像`}
              testID="dog-profile-camera"
              hitSlop={(touch.min - CAMERA) / 2}
              onPress={() => {
                tapOutside();
                setAvatarOpen(true);
              }}
              style={({ pressed }) => [
                styles.camera,
                pressed && styles.cameraPressed,
              ]}
            >
              <Glyph name="camera" color={colors.text} size={18} />
            </Pressable>
          </View>
          {editing ? (
            <View style={styles.nameEdit} testID="dog-profile-name-input">
              <TextInput
                cursorColor={colors.accent}
                selectionColor={`${colors.accent}66`}
                selectionHandleColor={colors.accent}
                ref={input}
                value={text}
                autoFocus
                accessibilityLabel="狗的名字"
                onChangeText={value => {
                  setFailed(false);
                  setText(clampName(value));
                }}
                editable={!saving}
                maxLength={NAME_MAX * 2}
                placeholder="狗的名字"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                submitBehavior="blurAndSubmit"
                onSubmitEditing={() => finish()}
                onBlur={() => finish()}
                style={styles.input}
              />
              <Text style={styles.count}>{`${nameLength(
                text,
              )}/${NAME_MAX}`}</Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${name}，改名字`}
              onPress={startEditing}
              testID="dog-profile-name"
              style={styles.nameRow}
            >
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <Glyph
                name="pencil"
                color={colors.textMuted}
                size={sizes.edit.pencil}
              />
            </Pressable>
          )}
          <Text style={styles.source}>{`訊號源 ${slaveId}`}</Text>
          {failed && (
            <Text style={styles.error} accessibilityRole="alert">
              沒有存成功，再試一次
            </Text>
          )}
        </View>
      </View>
      {avatarOpen && (
        <AvatarEditor
          avatar={avatar}
          name={name}
          picker={picker}
          onSave={onSaveAvatar}
          onClose={() => setAvatarOpen(false)}
        />
      )}
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors, shadow } = theme;
  return StyleSheet.create({
    page: {
      zIndex: 40,
      elevation: 12,
      backgroundColor: theme.isDark ? colors.bg : colors.surface,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.subpageHeader,
      paddingHorizontal: 4,
    },
    back: {
      width: touch.min,
      height: touch.min,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.full,
    },
    profile: {
      alignItems: 'center',
      paddingHorizontal: space.l,
      paddingTop: space.s,
    },
    avatarWrap: { width: AVATAR, height: AVATAR },
    camera: {
      position: 'absolute',
      right: -2,
      bottom: 0,
      width: CAMERA,
      height: CAMERA,
      borderRadius: CAMERA / 2,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadow.floating,
      ...theme.floatingBorder,
      elevation: 4,
    },
    cameraPressed: { backgroundColor: colors.bg },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: touch.min,
      marginTop: space.s,
      paddingHorizontal: space.s,
      maxWidth: '100%',
    },
    name: { ...type.nameEdit, color: colors.text, flexShrink: 1 },
    // In place of the name: a 2dp accent underline, 「N/20」 on the same line.
    nameEdit: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: touch.min,
      marginTop: space.s,
      maxWidth: '100%',
    },
    input: {
      ...type.nameEdit,
      color: colors.text,
      minWidth: 64,
      flexShrink: 1,
      paddingVertical: 2,
      paddingHorizontal: 4,
      textAlign: 'center',
      borderBottomWidth: 2,
      borderBottomColor: colors.accent,
    },
    count: { ...type.caption, color: colors.textMuted, marginLeft: space.s },
    source: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
    error: { ...type.caption, color: colors.crit, marginTop: space.s },
    pressed: { backgroundColor: colors.pressedOverlay },
  });
});

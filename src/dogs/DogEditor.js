import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ImageCropPicker from 'react-native-image-crop-picker';
import DogAvatar from './DogAvatar';
import { DEFAULT_AVATAR, DOG_ARTS, DOG_ART_KEYS, DOG_COLORS, DOG_COLOR_ROWS } from './DogArt';
import { colors, space, touch, type } from '../theme/tokens';

export const NAME_LIMIT = 20;
// Small enough that the map and list stay quick; only this is kept, never the
// original picture (design 10).
const PHOTO = {
  width: 256, height: 256, cropperCircleOverlay: true, includeBase64: true,
  mediaType: 'photo', forceJpg: true, compressImageQuality: 0.8,
  cropperToolbarTitle: '移動、縮放，讓狗臉在圓圈裡',
  cropperChooseText: '使用', cropperCancelText: '取消',
};

function Button({ label, onPress, primary, accessibilityHint, expanded }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => [styles.button, primary && styles.primary, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

/**
 * One page for a dog's name and face (design 10), opened from its panel.
 * Nothing is saved until 完成; 取消 and the back button leave both as they
 * were. Stored on this phone only, by collar number.
 */
export default function DogEditor({ slaveId, alias, avatar, onSave, onClose, picker = ImageCropPicker }) {
  const [name, setName] = useState(alias || '');
  const [face, setFace] = useState(avatar || null);
  const [choosing, setChoosing] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const shown = face || DEFAULT_AVATAR;
  const art = shown.kind === 'art' ? shown : { ...DEFAULT_AVATAR, ...(face?.kind === 'art' ? face : {}) };
  // The picture is taken or picked first, then cropped, so the original's
  // path is known and it can be deleted: the camera keeps its full-size shot,
  // and a picked photo is copied, in the app's storage otherwise.
  const take = async open => {
    setMessage('');
    let original = null;
    try {
      original = await open({ mediaType: 'photo' });
      const image = await picker.openCropper({ ...PHOTO, path: original.path });
      if (image?.data) setFace({ kind: 'photo', uri: `data:${image.mime || 'image/jpeg'};base64,${image.data}` });
    } catch (error) {
      if (error?.code === 'E_PICKER_CANCELLED') return;
      setMessage(error?.code === 'E_NO_CAMERA_PERMISSION'
        ? '沒有相機權限：請到系統設定允許 DogTracker 使用相機。'
        : '沒有拿到照片，請再試一次。');
    } finally {
      if (original?.path) await picker.cleanSingle?.(original.path).catch(() => {});
      await picker.clean?.().catch(() => {});
    }
  };
  const done = async () => {
    setSaving(true);
    let ok = false;
    try { ok = await onSave({ name: name.trim(), avatar: face }); } catch { ok = false; }
    setSaving(false);
    if (ok !== false) onClose();
    else setMessage('沒有存成功，請再試一次。');
  };
  const label = name.trim() || `狗 ${slaveId}`;
  return (
    // While saving, neither 取消 nor Back can leave a half-written edit behind.
    <Modal visible animationType="slide" onRequestClose={() => { if (!saving) onClose(); }} statusBarTranslucent>
      <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} disabled={saving} accessibilityRole="button" accessibilityLabel="取消"
            accessibilityState={{ disabled: saving }} style={styles.headerButton}>
            <Text style={styles.headerText}>取消</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">狗 {slaveId} 的資料</Text>
          <Pressable onPress={done} disabled={saving} accessibilityRole="button" accessibilityLabel="完成"
            accessibilityState={{ disabled: saving }} style={styles.headerButton}>
            <Text style={[styles.headerText, styles.headerDone]}>完成</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.big} accessible accessibilityLabel={`${label} 的頭像`}>
            <DogAvatar avatar={shown} size={112} />
          </View>
          <View style={styles.sources}>
            <Button label="拍照" onPress={() => take(options => picker.openCamera(options))} />
            <Button label="從相簿選" onPress={() => take(options => picker.openPicker(options))} />
            <Button label="選插圖" primary={choosing} onPress={() => setChoosing(open => !open)}
              accessibilityHint="選一種狗的樣子和底色" expanded={choosing} />
          </View>
          {!!message && <Text style={styles.message} accessibilityRole="alert">{message}</Text>}

          {choosing && (
            <View style={styles.chooser}>
              <Text style={styles.label}>樣子</Text>
              <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="樣子">
                {DOG_ART_KEYS.map(key => {
                  const selected = shown.kind === 'art' && shown.art === key;
                  return (
                    <Pressable key={key} onPress={() => setFace({ kind: 'art', art: key, color: art.color })}
                      accessibilityRole="radio" accessibilityLabel={DOG_ARTS[key].label}
                      accessibilityState={{ selected }}
                      style={[styles.choice, selected && styles.choiceSelected]}>
                      {/* The drawing says which; the name is for TalkBack only. */}
                      <DogAvatar avatar={{ kind: 'art', art: key, color: art.color }} size={46} />
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.label}>底色</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="底色">
                {DOG_COLOR_ROWS.map(row => (
                  <View key={row[0]} style={styles.swatches}>
                    {row.map(key => {
                      const selected = shown.kind === 'art' && shown.color === key;
                      return (
                        <Pressable key={key} onPress={() => setFace({ kind: 'art', art: art.art, color: key })}
                          accessibilityRole="radio" accessibilityLabel={DOG_COLORS[key].label}
                          accessibilityState={{ selected }} hitSlop={4}
                          style={[styles.swatch, { backgroundColor: DOG_COLORS[key].bg }, selected && styles.swatchSelected]} />
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          )}
          {face && (
            <Pressable onPress={() => setFace(null)} accessibilityRole="button" style={styles.link}>
              <Text style={styles.linkText}>用預設插圖</Text>
            </Pressable>
          )}

          <Text style={styles.label}>名稱</Text>
          <View style={styles.inputRow}>
            <TextInput value={name} onChangeText={text => setName(text.slice(0, NAME_LIMIT))}
              placeholder={`狗 ${slaveId}`} maxLength={NAME_LIMIT} accessibilityLabel="名稱"
              style={styles.input} returnKeyType="done" />
            <Text style={styles.count}>{name.length}／{NAME_LIMIT}</Text>
          </View>
          <Text style={styles.hint}>清空就恢復成「狗 {slaveId}」。項圈編號一直會顯示在名稱旁邊。只存在這支手機。</Text>

          <Text style={styles.label}>在地圖上的樣子</Text>
          <View style={styles.preview}>
            <DogAvatar avatar={shown} size={44} />
            <View style={styles.tag}><Text style={styles.tagText}>{name.trim() ? `${name.trim()}・${slaveId}` : `狗 ${slaveId}`}</Text></View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.s, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerButton: { minHeight: touch.min, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  headerText: { ...type.status, fontWeight: '400', color: colors.text },
  headerDone: { fontWeight: '700', color: colors.tonalText },
  title: { ...type.status, color: colors.text },
  content: { padding: space.l, paddingBottom: space.xxl },
  big: { alignSelf: 'center', marginVertical: space.m },
  sources: { flexDirection: 'row', gap: space.s, justifyContent: 'center' },
  button: { flex: 1, minHeight: touch.min, borderRadius: 999, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.tonal, borderColor: colors.tonal },
  buttonText: { ...type.status, color: colors.text },
  primaryText: { color: colors.tonalText },
  pressed: { transform: [{ scale: 0.97 }] },
  message: { ...type.caption, color: colors.crit, marginTop: space.s, textAlign: 'center' },
  chooser: { marginTop: space.m, backgroundColor: colors.bg, borderRadius: 16, padding: space.m },
  label: { ...type.caption, color: colors.textMuted, fontWeight: '700', marginTop: space.l, marginBottom: space.xs },
  // All five in one row, like the colours below.
  grid: { flexDirection: 'row', justifyContent: 'space-between' },
  choice: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, borderWidth: 3, borderColor: 'transparent' },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.surface },
  swatches: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.s },
  // 40 dp drawn, 48 dp to the finger with the hit slop, six to a row.
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line },
  swatchSelected: { borderWidth: 3, borderColor: colors.accent },
  link: { alignSelf: 'center', minHeight: touch.min, justifyContent: 'center', paddingHorizontal: space.m },
  linkText: { ...type.status, fontWeight: '400', color: colors.tonalText },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, borderWidth: 1.5, borderColor: colors.accent, borderRadius: 12, paddingHorizontal: space.m },
  input: { flex: 1, minHeight: touch.min, ...type.body, color: colors.text },
  count: { ...type.caption, color: colors.textMuted },
  hint: { ...type.caption, color: colors.textMuted, marginTop: space.xs },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.s, backgroundColor: '#E8EFE6', borderRadius: 12, padding: space.m },
  tag: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.line, paddingHorizontal: space.s, paddingVertical: 2 },
  tagText: { ...type.status, color: colors.text },
});

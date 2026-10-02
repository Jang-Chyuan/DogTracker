import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dogMapLabel } from '../mapHistory/DogAliases';

// Fixed pixel offsets keep the label legible at every zoom. The native marker
// anchor is the avatar centre, so the leader never changes the GPS position.
// The canvas is tall enough for a name and a status line at 16sp; the marker
// is a fixed bitmap, so the text may grow only a little with the system font.
export const DOG_NAME_ANCHOR = { x: 24 / 260, y: 102 / 128 };
const FONT_SCALE_CAP = 1.2;

export default function DogNameMarker({ label, status, tone, children }) {
  if (!label) return children;
  return <View collapsable={false} style={styles.container}>
    <View style={styles.line} />
    <View style={[styles.label, tone && TONE_LABEL[tone]]}>
      <Text numberOfLines={status ? 1 : 2} maxFontSizeMultiplier={FONT_SCALE_CAP}
        style={styles.text}>{dogMapLabel(label)}</Text>
      {status ? <Text numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_CAP}
        style={[styles.text, tone && TONE_TEXT[tone]]}>{status}</Text> : null}
    </View>
    <View style={styles.avatar}>{children}</View>
  </View>;
}

// Aged positions: amber for 2–10 minutes, grey beyond. Words, not opacity.
const TONE_LABEL = {
  recent: { backgroundColor: '#FFF1D6', borderColor: '#9A5B00' },
  old: { backgroundColor: '#F1F2F1', borderColor: '#6B7470' },
};
const TONE_TEXT = { recent: { color: '#9A5B00', fontWeight: '700' }, old: { color: '#3F4743' } };

const styles = StyleSheet.create({
  // Wide enough for 「最後位置・10 分鐘前」 in bold 16sp, with room for the font cap.
  container: { width: 260, height: 128 },
  label: { position: 'absolute', left: 48, bottom: 62, maxWidth: 210,
    alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 10,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#64748B' },
  text: { color: '#0F172A', fontSize: 16, lineHeight: 20, textAlign: 'center' },
  line: { position: 'absolute', left: 14, top: 83, width: 44, height: 1,
    backgroundColor: '#64748B', transform: [{ rotate: '-58deg' }] },
  avatar: { position: 'absolute', left: 0, top: 78, width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center' },
});

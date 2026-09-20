import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dogMapLabel } from '../mapHistory/DogAliases';

// Fixed pixel offsets keep the label legible at every zoom. The native marker
// anchor is the avatar centre, so the leader never changes the GPS position.
export const DOG_NAME_ANCHOR = { x: 24 / 190, y: 78 / 104 };

export default function DogNameMarker({ label, children }) {
  if (!label) return children;
  return <View collapsable={false} style={styles.container}>
    <View style={styles.line} />
    <View style={styles.label}><Text numberOfLines={2} style={styles.text}>{dogMapLabel(label)}</Text></View>
    <View style={styles.avatar}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: 190, height: 104 },
  label: { position: 'absolute', left: 48, bottom: 62, maxWidth: 140,
    alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 10,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#64748B' },
  text: { color: '#0F172A', fontSize: 12, lineHeight: 16, textAlign: 'center' },
  line: { position: 'absolute', left: 14, top: 59, width: 44, height: 1,
    backgroundColor: '#64748B', transform: [{ rotate: '-58deg' }] },
  avatar: { position: 'absolute', left: 0, top: 54, width: 48, height: 48,
    alignItems: 'center', justifyContent: 'center' },
});

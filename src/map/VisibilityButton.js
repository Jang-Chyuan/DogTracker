import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { mapColors as colors } from './MapTheme';

export default function VisibilityButton({ role, visible, disabled, onPress }) {
  const color = visible
    ? role === 'master'
      ? colors.master
      : colors.dog
    : colors.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        (visible ? '隱藏' : '顯示') +
        (role === 'master' ? '領犬員' : '狗') +
        '位置'
      }
      accessibilityState={{ selected: visible, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <View accessible={false} style={[styles.eye, { borderColor: color }]}>
        <View style={[styles.pupil, { backgroundColor: color }]} />
      </View>
      {!visible && (
        <View
          accessible={false}
          style={[styles.slash, { backgroundColor: color }]}
        />
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F0F3F1',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eye: {
    width: 26,
    height: 17,
    borderWidth: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pupil: { width: 7, height: 7, borderRadius: 4 },
  slash: {
    position: 'absolute',
    width: 31,
    height: 2,
    transform: [{ rotate: '45deg' }],
  },
  disabled: { opacity: 0.45 },
});

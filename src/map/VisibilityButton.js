import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import EyeIcon from './EyeIcon';
import { mapColors as colors } from './MapTheme';

export default function VisibilityButton({
  role,
  visible,
  disabled,
  onPress,
  subject,
  size = 'large',
}) {
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
        (subject || (role === 'master' ? '領犬員' : '狗')) +
        '位置'
      }
      accessibilityState={{ selected: visible, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        size === 'small' && styles.small,
        disabled && styles.disabled,
      ]}
    >
      <EyeIcon color={color} open={visible} size={size === 'small' ? 22 : 26} />
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
  // A per-dog eye sits inside a list row, so it is a smaller target than the
  // section-level one, but still at the 44 pt minimum.
  small: { width: 44, height: 44, borderRadius: 22 },
  disabled: { opacity: 0.45 },
});

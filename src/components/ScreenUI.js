import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export function ActionButton({
  title,
  onPress,
  disabled = false,
  secondary = false,
  destructive = false,
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        secondary && ui.secondaryButton,
        destructive && ui.destructiveButton,
        disabled && ui.disabled,
        pressed && ui.pressed,
      ]}
    >
      <Text style={ui.buttonText}>{title}</Text>
    </Pressable>
  );
}

export const ui = StyleSheet.create({
  title: { color: '#f8fafc', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  heading: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  text: { color: '#e2e8f0', fontSize: 16, lineHeight: 25, marginBottom: 6 },
  hint: { color: '#94a3b8', fontSize: 14, lineHeight: 22, marginBottom: 12 },
  card: {
    backgroundColor: '#111827',
    borderColor: '#374151',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
  },
  badge: {
    color: '#c4b5fd',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  error: { color: '#fca5a5', fontSize: 15, lineHeight: 23, marginBottom: 12 },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    marginTop: 10,
  },
  secondaryButton: { backgroundColor: '#334155' },
  destructiveButton: { backgroundColor: '#7f1d1d' },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});

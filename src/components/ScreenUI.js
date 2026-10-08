import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { Pressable, StyleSheet, Text } from 'react-native';

export function ActionButton({
  title,
  onPress,
  disabled = false,
  secondary = false,
  destructive = false,
}) {
  const ui = useStyles(getUi);
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

export const getUi = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return StyleSheet.create({
    title: {
      color: themeLiteral.diagnosticTitle,
      fontSize: 28,
      fontWeight: '700',
      marginBottom: 8,
    },
    heading: {
      color: themeLiteral.diagnosticHeading,
      fontSize: 20,
      fontWeight: '700',
      marginBottom: 8,
    },
    text: {
      color: themeLiteral.diagnosticText,
      fontSize: 16,
      lineHeight: 25,
      marginBottom: 6,
    },
    hint: {
      color: themeLiteral.diagnosticHint,
      fontSize: 14,
      lineHeight: 22,
      marginBottom: 12,
    },
    card: {
      backgroundColor: themeLiteral.diagnosticSurface,
      borderColor: themeLiteral.diagnosticBorder,
      borderRadius: 16,
      borderWidth: 1,
      padding: 18,
      marginBottom: 16,
    },
    badge: {
      color: themeLiteral.diagnosticBadge,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 10,
    },
    error: {
      color: themeLiteral.diagnosticError,
      fontSize: 15,
      lineHeight: 23,
      marginBottom: 12,
    },
    button: {
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 12,
      backgroundColor: themeLiteral.diagnosticButton,
      borderRadius: 10,
      marginTop: 10,
    },
    secondaryButton: { backgroundColor: themeLiteral.diagnosticSecondary },
    destructiveButton: { backgroundColor: themeLiteral.diagnosticDestructive },
    buttonText: {
      color: themeLiteral.avatarFrameMap,
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center',
    },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.75 },
  });
});

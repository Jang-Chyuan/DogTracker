import { type, space, radius, border, touch, weights } from '../theme/tokens';
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
      fontSize: type.headline.fontSize,
      fontWeight: type.headline.fontWeight,
      marginBottom: space.s,
    },
    heading: {
      color: themeLiteral.diagnosticHeading,
      fontSize: type.title.fontSize,
      fontWeight: type.title.fontWeight,
      marginBottom: space.s,
    },
    text: {
      color: themeLiteral.diagnosticText,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
      marginBottom: space.xs,
    },
    hint: {
      color: themeLiteral.diagnosticHint,
      fontSize: type.value.fontSize,
      lineHeight: type.status.lineHeight,
      marginBottom: space.m,
    },
    card: {
      backgroundColor: themeLiteral.diagnosticSurface,
      borderColor: themeLiteral.diagnosticBorder,
      borderRadius: radius.card,
      borderWidth: border.hairline,
      padding: space.l,
      marginBottom: space.l,
    },
    badge: {
      color: themeLiteral.diagnosticBadge,
      fontSize: type.cardTitle.fontSize,
      fontWeight: type.cardTitle.fontWeight,
      marginBottom: space.s,
    },
    error: {
      color: themeLiteral.diagnosticError,
      fontSize: type.cardTitle.fontSize,
      lineHeight: type.status.lineHeight,
      marginBottom: space.m,
    },
    button: {
      minHeight: touch.min,
      justifyContent: 'center',
      alignItems: 'center',
      padding: space.m,
      backgroundColor: themeLiteral.diagnosticButton,
      borderRadius: radius.settingIcon,
      marginTop: space.s,
    },
    secondaryButton: { backgroundColor: themeLiteral.diagnosticSecondary },
    destructiveButton: { backgroundColor: themeLiteral.diagnosticDestructive },
    buttonText: {
      color: themeLiteral.avatarFrameMap,
      fontSize: type.body.fontSize,
      fontWeight: weights.medium,
      textAlign: 'center',
    },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.75 },
  });
});

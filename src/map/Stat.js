import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { StyleSheet, Text, View } from 'react-native';
import Glyph from './Glyph';

/**
 * One reading: its icon and its value.
 *
 * Speed, battery and distance used to run together in one grey sentence, where
 * none of them could be found at a glance. An icon says which reading it is
 * faster than a word does, and leaves the number as the only text.
 */
export default function Stat({ icon, label, value, level = null }) {
  const { appColors: colors } = useTheme();
  const styles = useStyles(getStyles);
  return (
    <View
      accessible
      accessibilityLabel={`${label} ${value}`}
      style={styles.stat}
    >
      <Glyph name={icon} color={colors.muted} size={15} level={level} />
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { literalColors: themeLiteral, appColors: colors } = theme;
  return StyleSheet.create({
    stat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 9,
      borderRadius: 10,
      backgroundColor: themeLiteral.surface,
    },
    value: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  });
});

import { Text, View } from 'react-native';
import { useStyles, makeStyles } from '../../theme/ThemeProvider';
import { border, size, space, type, fontWeight, radius } from '../../theme/tokens';
import Glyph from '../../map/Glyph';
import { useTheme } from '../../theme/ThemeProvider';
import { t } from '../../i18n';
import { withAlpha } from './HistoryMapModel';

export default function MyRouteHeader() {
  const styles = useStyles(getStyles);
  const { colors } = useTheme();
  return (
    <View testID="history-my-route-header" accessible accessibilityRole="header"
      accessibilityLabel={t('c132')} style={styles.row}>
      <View testID="history-my-route-avatar" style={styles.avatar}>
        <Glyph name="person" size={size.icon.row} color={colors.phone} />
      </View>
      <Text style={styles.label}>{t('c132')}</Text>
    </View>
  );
}
const getStyles = makeStyles(({ colors, settingIcon, opacity }) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs,
    paddingHorizontal: size.chip.paddingH, paddingVertical: space.xs,
    borderRadius: radius.full, backgroundColor: withAlpha(colors.surface, opacity.mapHeaderBacking) },
  avatar: { width: size.historyTop.phoneAvatar, height: size.historyTop.phoneAvatar,
    borderRadius: size.historyTop.phoneAvatar / 2, borderWidth: border.strong,
    borderColor: colors.phone, backgroundColor: settingIcon.phone.bg,
    alignItems: 'center', justifyContent: 'center' },
  label: { ...type.body, fontWeight: fontWeight.medium, color: colors.text,
    flexShrink: 1 },
}));

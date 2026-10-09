import { t } from '../i18n';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GuideButton, GuidePage } from './GuideUI';
import { space, type, border, touch, size as sizes } from '../theme/tokens';

/**
 * D2 「App 需要這些權限」 (D2a–D2d): one row per permission this phone needs
 * (Permissions.permissionsPage) and the button under them. `page` is that
 * answer plus allowAll (usePermissionsGuide); `onNext` goes on to D3 (下一步
 * and 稍後再說 alike), `onSystemSettings` opens this app's Android settings.
 */
export default function PermissionsScreen({
  page,
  step = null,
  onNext,
  onSystemSettings,
  onLayout,
}) {
  const styles = useStyles(getStyles);
  const primary = page.primary;
  return (
    <GuidePage
      testID="permissions-page"
      step={step}
      title={t('c008')}
      body={t('c009')}
      onLayout={onLayout}
      bottom={
        <>
          <GuideButton
            testID="permissions-primary"
            label={primary.label}
            disabled={primary.disabled}
            onPress={primary.id === 'next' ? onNext : page.allowAll}
          />
          {page.later ? (
            <GuideButton
              kind="text"
              testID="permissions-later"
              label={t('c007')}
              onPress={onNext}
            />
          ) : null}
        </>
      }
    >
      <View style={styles.list}>
        {page.rows.map((row, index) => (
          <React.Fragment key={row.id}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <PermissionRow row={row} onSystemSettings={onSystemSettings} />
          </React.Fragment>
        ))}
      </View>
    </GuidePage>
  );
}

// 「引導 D2 權限列」: at least 56dp, a 24dp state circle (number, ✓ ok on okBg,
// ! crit), title 16sp over its line 13sp; the row being asked on brandSoft;
// 「開系統設定 ›」 on the right, centred.
function PermissionRow({ row, onSystemSettings }) {
  const styles = useStyles(getStyles);
  const mark =
    row.state === 'ok'
      ? '✓'
      : row.state === 'problem'
      ? '!'
      : String(row.number);
  const label = [row.title, row.detail].filter(Boolean).join('，');
  return (
    <View
      testID={`permission-${row.id}`}
      style={[styles.row, row.state === 'asking' && styles.asking]}
      accessible={!row.action}
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.circle,
          row.state === 'ok' && styles.okCircle,
          row.state === 'problem' && styles.problemCircle,
        ]}
      >
        <Text
          style={[
            styles.mark,
            row.state === 'ok' && styles.okMark,
            row.state === 'problem' && styles.problemMark,
          ]}
          // A glyph in a fixed 24dp circle: it does not grow with the font.
          allowFontScaling={false}
        >
          {mark}
        </Text>
      </View>
      <View style={styles.words}>
        <Text style={styles.title}>{row.title}</Text>
        <Text testID={`permission-${row.id}-detail`} style={styles.detail}>
          {row.detail}
        </Text>
      </View>
      {row.action ? (
        <Pressable
          testID={`permission-${row.id}-settings`}
          accessibilityRole="button"
          accessibilityLabel={`${row.title}，${
            row.detail
          }，${row.action.replace(' ›', '')}`}
          hitSlop={space.s}
          onPress={onSystemSettings}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>{row.action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    list: {
      borderTopWidth: border.hairline,
      borderTopColor: colors.line,
      marginTop: space.s,
    },
    // The row being asked is tinted a little past the text on both sides; the
    // lines between rows keep to the text.
    row: {
      minHeight: touch.cardRowTwoLine,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: space.s,
      marginHorizontal: -space.s,
      paddingHorizontal: space.s,
    },
    rule: { height: border.hairline, backgroundColor: colors.line },
    asking: { backgroundColor: colors.brandSoft },
    circle: {
      width: sizes.permission.statusDisc,
      height: sizes.permission.statusDisc,
      borderRadius: sizes.permission.statusDisc / 2,
      backgroundColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: space.m,
    },
    okCircle: { backgroundColor: colors.okBg },
    problemCircle: { backgroundColor: colors.critBg },
    mark: {
      ...type.captionBold,
      color: colors.textMuted,
      includeFontPadding: false,
      textAlign: 'center',
      textAlignVertical: 'center',
    },
    okMark: { color: colors.ok },
    problemMark: { color: colors.crit },
    words: { flex: 1 },
    title: { ...type.status, color: colors.text },
    detail: { ...type.caption, color: colors.textMuted },
    action: { minHeight: touch.min, justifyContent: 'center', paddingLeft: space.s },
    actionText: { ...type.captionBold, color: colors.tonalText },
    pressed: { opacity: 0.6 },
  });
});

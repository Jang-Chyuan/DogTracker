import { t } from '../i18n';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useStyles, makeStyles, useTheme } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/tokens';
import { GroupCard, GroupTitle, ListRow, getSettingsStyles } from '../settings/SettingsUI';
import { formatClock } from '../map/MapFormat';

const MINUTE = 60000;
const STEPS = [1, 2, 10, 30];

// Debug builds only (a fixture's &page=alertPreview): what the alert engine
// (058a) decided. Shows the merged notification's content (N1/N2), the
// problems behind the red 「⚠ N」, and every alert so far with its vibration
// and N3 card; the fixture's fake clock moves on with 「+N 分」. 「App 在背景」
// posts the real notification (058b) from the fixture's fake problems, as the
// app would off screen. Not a v3 screen: developers only.
export default function AlertPreview({ alerts, now, fake, background, onAdvance, onBackground }) {
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  const { colors } = useTheme();
  const { content, problems, log, pause, badgeCount, notification } = alerts;
  // In front nothing is posted: the content is shown as it would be.
  const posted = notification !== 'cancel';
  const heading = background
    ? t('dev.alertPreview.AlertPreview.heading', { value1: posted ? (notification === 'notify' ? t('dev.alertPreview.AlertPreview.heading2') : t('dev.alertPreview.AlertPreview.heading3')) : t('dev.alertPreview.AlertPreview.heading4') })
    : t('dev.alertPreview.AlertPreview.heading5');
  return (
    <ScrollView
      testID="alert-preview"
      style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}
    >
      <GroupTitle>{heading}</GroupTitle>
      {content && (posted || !background) ? (
        <View testID="alert-preview-notification" style={styles.notification}>
          <Text style={styles.app}>{`DogTracker・${formatClock(now)}`}</Text>
          <Text style={styles.title}>{content.title}</Text>
          {content.lines.map(line => (
            <Text key={line} style={styles.line}>
              {line}
            </Text>
          ))}
          <View style={styles.actions}>
            {content.actions.map(action => (
              <Pressable
                key={action.id}
                testID={`alert-preview-${action.id}`}
                accessibilityRole="button"
                onPress={action.id === 'pause' ? () => alerts.pauseNow() : undefined}
                style={styles.action}
              >
                <Text style={styles.actionText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <Text style={styles.none}>{t('dev.alertPreview.AlertPreview')}</Text>
      )}

      <GroupTitle>{fake ? t('dev.alertPreview.AlertPreview2', { value1: formatClock(now) }) : t('dev.alertPreview.AlertPreview3', { value1: formatClock(now) })}</GroupTitle>
      <GroupCard flat>
        {fake && (
          <View style={styles.steps}>
            {STEPS.map(step => (
              <Pressable
                key={step}
                testID={`alert-preview-plus-${step}`}
                accessibilityRole="button"
                onPress={() => onAdvance(step * MINUTE)}
                style={styles.step}
              >
                <Text style={styles.stepText}>{t('dev.alertPreview.AlertPreview4', { value1: step })}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {fake && (
          <ListRow title={t('dev.alertPreview.AlertPreview.title')} accessible={false}>
            <Switch
              testID="alert-preview-background"
              value={background}
              onValueChange={onBackground}
              trackColor={{ false: colors.switchOff, true: colors.accent }}
              thumbColor={colors.avatarFrameMap}
            />
          </ListRow>
        )}
        <ListRow
          title={pause ? t('dev.alertPreview.AlertPreview.title2', { value1: formatClock(pause.until) }) : t('dev.alertPreview.AlertPreview.title3')}
          action={pause ? t('dev.alertPreview.AlertPreview.action') : t('dev.alertPreview.AlertPreview.action2')}
          actionTone="tonal"
          onPress={() => (pause ? alerts.resume() : alerts.pauseNow())}
          label={pause ? t('dev.alertPreview.AlertPreview.label') : t('dev.alertPreview.AlertPreview.label2')}
        />
      </GroupCard>

      <GroupTitle>{t('dev.alertPreview.AlertPreview5', { value1: badgeCount })}</GroupTitle>
      <GroupCard flat>
        {problems.length ? (
          problems.map(problem => <ListRow key={problem.key} title={problem.line} detail={problem.kind} />)
        ) : (
          <ListRow title={t('dev.alertPreview.AlertPreview.title4')} />
        )}
      </GroupCard>

      <GroupTitle>{t('dev.alertPreview.AlertPreview6')}</GroupTitle>
      <GroupCard flat>
        {log.length ? (
          log.map(entry => (
            <ListRow
              key={`${entry.at}-${entry.lines.join()}`}
              title={`${formatClock(entry.at)}・${entry.vibration ? (entry.critical ? t('dev.alertPreview.AlertPreview.title5') : t('dev.alertPreview.AlertPreview.title6')) : t('dev.alertPreview.AlertPreview.title7')}`}
              detail={[
                entry.lines.join('、'),
                entry.sound ? t('dev.alertPreview.AlertPreview.detail') : null,
                entry.card ? `N3：${entry.card}` : null,
                t('dev.alertPreview.AlertPreview.detail2', { value1: entry.notification }),
              ].filter(Boolean).join('・')}
            />
          ))
        ) : (
          <ListRow title={t('dev.alertPreview.AlertPreview.title8')} />
        )}
      </GroupCard>
    </ScrollView>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    notification: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.line,
      padding: space.l,
    },
    app: { ...type.caption, color: colors.textMuted },
    title: { ...type.status, color: colors.text, fontWeight: '700', marginTop: space.xs },
    line: { ...type.small, color: colors.text, marginTop: 2 },
    actions: { flexDirection: 'row', marginTop: space.m },
    action: { minHeight: 48, justifyContent: 'center', marginRight: space.l },
    actionText: { ...type.captionBold, color: colors.tonalText },
    none: { ...type.caption, color: colors.textMuted, paddingVertical: space.m },
    steps: { flexDirection: 'row', paddingVertical: space.s },
    step: {
      minHeight: 48,
      paddingHorizontal: space.l,
      marginRight: space.s,
      borderRadius: radius.button,
      backgroundColor: colors.tonal,
      justifyContent: 'center',
    },
    stepText: { ...type.captionBold, color: colors.tonalText },
  });
});

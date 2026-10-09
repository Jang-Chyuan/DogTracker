import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useStyles, makeStyles, useTheme } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/tokens';
import { GroupCard, GroupTitle, ListRow, getSettingsStyles } from '../settings/SettingsUI';
import { formatClock } from '../map/MapFormat';

const MINUTE = 60000;
const STEPS = [1, 2, 10, 30];

// Debug builds only (a fixture's &page=alertPreview): what the alert engine
// (058a) decided, while 058b's native notification does not exist yet. Shows
// the merged notification as the phone would (N1/N2), the problems behind the
// red 「⚠ N」, and every alert so far with its vibration and N3 card; the
// fixture's fake clock moves on with 「+N 分」. Not a v3 screen: developers only.
export default function AlertPreview({ alerts, now, fake, background, onAdvance, onBackground }) {
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  const { colors } = useTheme();
  const { content, problems, log, pause, badgeCount, notification } = alerts;
  // In front nothing is posted: the content is shown as it would be.
  const posted = notification !== 'cancel';
  const heading = background
    ? `通知欄（App 在背景）：${posted ? (notification === 'notify' ? '發出並提醒' : '安靜更新') : '收起'}`
    : '通知欄（App 在背景時會這樣寫）';
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
        <Text style={styles.none}>沒有通知</Text>
      )}

      <GroupTitle>{fake ? `假時鐘 ${formatClock(now)}` : `現在 ${formatClock(now)}`}</GroupTitle>
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
                <Text style={styles.stepText}>{`+${step} 分`}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {fake && (
          <ListRow title="App 在背景" accessible={false}>
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
          title={pause ? `暫停到 ${formatClock(pause.until)}` : '沒有暫停'}
          action={pause ? '恢復' : '暫停提醒 30 分'}
          actionTone="tonal"
          onPress={() => (pause ? alerts.resume() : alerts.pauseNow())}
          label={pause ? '恢復' : '暫停提醒 30 分'}
        />
      </GroupCard>

      <GroupTitle>{`現在的問題（⚠ ${badgeCount}）`}</GroupTitle>
      <GroupCard flat>
        {problems.length ? (
          problems.map(problem => <ListRow key={problem.key} title={problem.line} detail={problem.kind} />)
        ) : (
          <ListRow title="沒有" />
        )}
      </GroupCard>

      <GroupTitle>提醒過的（新的在上）</GroupTitle>
      <GroupCard flat>
        {log.length ? (
          log.map(entry => (
            <ListRow
              key={`${entry.at}-${entry.lines.join()}`}
              title={`${formatClock(entry.at)}・${entry.vibration ? (entry.critical ? '危急震動' : '一般震動') : '不震'}`}
              detail={[
                entry.lines.join('、'),
                entry.sound ? '聲音' : null,
                entry.card ? `N3：${entry.card}` : null,
                `通知 ${entry.notification}`,
              ].filter(Boolean).join('・')}
            />
          ))
        ) : (
          <ListRow title="還沒有" />
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

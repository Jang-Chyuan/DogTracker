import { t } from '../i18n';
import { useStyles, makeStyles } from '../theme/ThemeProvider';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { space, touch, type } from '../theme/tokens';
import {
  GroupCard,
  GroupTitle,
  ListRow,
  getSettingsStyles,
} from './SettingsUI';
import { StorageWarning } from './SettingsHome';

// The three data pages (design S8, 文案 c251–c253 with c252's suggestion).
export const DIAGNOSTICS_PAGES = Object.freeze([
  { id: 'liveData', title: t('c251') },
  { id: 'cloudData', title: t("c481") },
  { id: 'locationRecords', title: t('c253') },
]);

/**
 * S8 診斷: why dog positions cannot be written (where 「看原因」 leads), the
 * three data pages, and per dog the environment model's last result and the
 * moving/still speed buffer (only here: the live map shows neither). `page`
 * is DiagnosticsModel.diagnosticsPage.
 */
export default function DiagnosticsSettings({ page, onOpen, onHide, canHide = true }) {
  const settingsStyles = useStyles(getSettingsStyles);
  const styles = useStyles(getStyles);
  return (
    <ScrollView
      testID="diagnostics-settings"
      style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}
    >
      <StorageWarning storage={page.storage} testID="diagnostics-storage" />
      <View style={page.storage ? styles.afterWarning : null}>
        <GroupCard flat>
          {DIAGNOSTICS_PAGES.map(item => (
            <ListRow
              key={item.id}
              testID={`diagnostics-${item.id}`}
              title={item.title}
              chevron
              onPress={() => onOpen(item.id)}
              label={item.title}
            />
          ))}
        </GroupCard>
      </View>
      <GroupTitle>{t("c958")}</GroupTitle>
      {page.dogs.length === 0 ? (
        <Text testID="diagnostics-no-dogs" style={styles.empty}>{t('c109')}</Text>
      ) : (
        <GroupCard flat>
          {page.dogs.map(dog => (
            <View
              key={dog.slaveId}
              testID={`diagnostics-dog-${dog.slaveId}`}
              style={styles.dog}
              accessible
              accessibilityLabel={dog.label}
            >
              <Text style={styles.name}>
                {dog.name}
                <Text style={styles.source}>{t("c962", { slaveId: dog.slaveId })}</Text>
              </Text>
              <Line
                label={t("c959")}
                value={dog.environment?.label ?? t('c089')}
                extra={[
                  dog.environment?.evidence,
                  dog.environment?.window &&
                    `${
                      dog.environment.source
                        ? `${dog.environment.source}・`
                        : ''
                    }${dog.environment.window}`,
                ]}
              />
              <Line
                label={t("c960")}
                value={dog.movement?.label ?? t("c961")}
                extra={[dog.movement?.detail]}
              />
            </View>
          ))}
        </GroupCard>
      )}
      <Text style={styles.footnote}>{t("c963")}</Text>
      {canHide && <GroupCard flat>
        <ListRow
          testID="diagnostics-hide"
          title={t('c411')}
          label={t('c411')}
          onPress={onHide}
        />
      </GroupCard>}
    </ScrollView>
  );
}

// One judgement: its name, the answer, then the evidence in small text. No
// line is cut short (design 「欄位不截字」).
function Line({ label, value, extra = [] }) {
  const styles = useStyles(getStyles);
  return (
    <View style={styles.line}>
      <Text style={styles.value}>
        <Text style={styles.label}>{`${label}　`}</Text>
        {value}
      </Text>
      {extra.filter(Boolean).map(text => (
        <Text key={text} style={styles.extra}>
          {text}
        </Text>
      ))}
    </View>
  );
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    afterWarning: { marginTop: space.s },
    empty: {
      ...type.body,
      color: colors.textMuted,
      minHeight: touch.row,
      paddingHorizontal: space.xs,
      paddingTop: space.m,
    },
    dog: { paddingVertical: space.m, paddingHorizontal: space.xs },
    name: { ...type.status, color: colors.text },
    source: { ...type.caption, color: colors.textMuted },
    line: { marginTop: space.s },
    label: { ...type.captionBold, color: colors.textMuted },
    value: { ...type.body, color: colors.text },
    extra: { ...type.small, color: colors.textMuted, marginTop: space.xs },
    footnote: { ...type.small, color: colors.textMuted, marginTop: space.l },
  });
});

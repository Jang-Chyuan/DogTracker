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
  { id: 'liveData', title: '即時資料' },
  { id: 'cloudData', title: '本機／雲端資料' },
  { id: 'locationRecords', title: '記錄清單' },
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
      <GroupTitle>每隻狗的判斷</GroupTitle>
      {page.dogs.length === 0 ? (
        <Text testID="diagnostics-no-dogs" style={styles.empty}>
          還沒有狗的資料
        </Text>
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
                <Text style={styles.source}>{`　訊號源 ${dog.slaveId}`}</Text>
              </Text>
              <Line
                label="環境"
                value={dog.environment?.label ?? '沒有資料'}
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
                label="速度緩衝"
                value={dog.movement?.label ?? '沒有這支手機收到的速度'}
                extra={[dog.movement?.detail]}
              />
            </View>
          ))}
        </GroupCard>
      )}
      <Text style={styles.footnote}>
        環境判斷只當停在原處的參考；速度緩衝 1.5 km/h 以上算移動、0.5 km/h
        以下算靜止，中間照前一個狀態。兩者都不顯示在地圖上。
      </Text>
      {canHide && <GroupCard flat>
        <ListRow
          testID="diagnostics-hide"
          title="隱藏診斷"
          label="隱藏診斷"
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
    extra: { ...type.small, color: colors.textMuted, marginTop: 2 },
    footnote: { ...type.small, color: colors.textMuted, marginTop: space.l },
  });
});

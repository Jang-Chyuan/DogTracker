import { useStyles } from '../theme/ThemeProvider';
import { ScrollView, View } from 'react-native';
import ReceiverIcon from './ReceiverIcon';
import {
  GroupCard,
  GroupTitle,
  ListRow,
  getSettingsStyles,
} from './SettingsUI';
import { space } from '../theme/tokens';

/**
 * S2 接收器: the current receiver (its link, battery, last packet, position)
 * with its connection actions right under it — 中斷連線 (red; after it the
 * same row is 重新連線), 換接收器 › — then the
 * sources it has heard. Sources are only listed: the phone cannot stop one.
 * `page` is SettingsModel.receiverPage.
 */
export default function ReceiverSettings({
  page,
  onDisconnect,
  onReconnect,
  onChange,
  onConnect,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  if (!page.setUp) {
    return (
      <ScrollView
        testID="receiver-settings"
        style={settingsStyles.page}
        contentContainerStyle={settingsStyles.content}
      >
        <GroupTitle>目前的接收器</GroupTitle>
        <GroupCard flat>
          <ListRow title="還沒設定接收器" />
          <ListRow
            testID="receiver-connect"
            title="連接接收器"
            titleTone="tonal"
            chevron
            onPress={onConnect}
            label="連接接收器"
          />
        </GroupCard>
      </ScrollView>
    );
  }
  const off = page.connectAction === 'reconnect';
  return (
    <ScrollView
      testID="receiver-settings"
      style={settingsStyles.page}
      contentContainerStyle={settingsStyles.content}
    >
      <GroupTitle>目前的接收器</GroupTitle>
      <GroupCard flat>
        <ListRow
          testID="receiver-current"
          title={page.title}
          detail={page.subtitle}
          detailTone={page.subtitleProblem ? 'crit' : undefined}
          problem={page.subtitleProblem}
          leading={
            <View style={{ marginRight: space.m }}>
              <ReceiverIcon number={page.number} ring={40} />
            </View>
          }
          right={[page.battery, page.lastHeard].filter(Boolean)}
          rightTone={page.battery && page.batteryProblem ? ['crit'] : undefined}
          label={[
            page.title,
            page.subtitle,
            page.battery &&
              (page.batteryProblem ? `${page.battery}，電量低` : page.battery),
            page.lastHeard,
          ]
            .filter(Boolean)
            .join('，')}
        />
        <ListRow
          title="位置"
          right={page.position}
          label={`位置，${page.position}`}
        />
        {off ? (
          <ListRow
            testID="receiver-reconnect"
            title="重新連線"
            titleTone="tonal"
            onPress={onReconnect}
            label="重新連線"
          />
        ) : (
          <ListRow
            testID="receiver-disconnect"
            title="中斷連線"
            titleTone="danger"
            onPress={onDisconnect}
            label="中斷連線"
          />
        )}
        <ListRow
          testID="receiver-change"
          title="換接收器"
          chevron
          onPress={onChange}
          label="換接收器"
        />
      </GroupCard>
      <GroupTitle>收到的訊號源</GroupTitle>
      <GroupCard flat testID="receiver-sources">
        {page.sources.length ? (
          page.sources.map(source => (
            <ListRow
              key={source.slaveId}
              testID={`receiver-source-${source.slaveId}`}
              title={source.name}
              detail={source.detail}
              right={source.right}
              label={[source.name, source.detail, source.right]
                .filter(Boolean)
                .join('，')}
            />
          ))
        ) : (
          <ListRow title="還沒收到訊號源" titleTone="muted" />
        )}
      </GroupCard>
    </ScrollView>
  );
}

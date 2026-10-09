import { t } from '../i18n';
import { useRef } from 'react';
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
 * S2 接收器: the current receiver (its link, battery, last packet, position,
 * 最後上傳成功 — the same line S3 draws for it) with its connection actions
 * right under it — 中斷連線 (red; after it the same row is 重新連線),
 * 換接收器 › — then the
 * sources it has heard. Sources are only listed: the phone cannot stop one.
 * `page` is SettingsModel.receiverPage.
 */
export default function ReceiverSettings({
  page,
  fromWaitingSources = false,
  onDisconnect,
  onReconnect,
  onChange,
  onConnect,
}) {
  const scroll = useRef(null);
  const scrolled = useRef(false);
  const settingsStyles = useStyles(getSettingsStyles);
  if (!page.setUp) {
    return (
      <ScrollView
        ref={scroll}
      testID="receiver-settings"
        style={settingsStyles.page}
        contentContainerStyle={settingsStyles.content}
      >
        <GroupTitle>{t('c199')}</GroupTitle>
        <GroupCard flat>
          <ListRow title={t('c287')} />
          <ListRow
            testID="receiver-connect"
            title={t('c011')}
            titleTone="tonal"
            chevron
            onPress={onConnect}
            label={t('c011')}
          />
        </GroupCard>
      </ScrollView>
    );
  }
  const off = page.connectAction === 'reconnect';
  return (
    <ScrollView
      ref={scroll}
      testID="receiver-settings"
      style={settingsStyles.page}
      contentContainerStyle={settingsStyles.content}
    >
      <GroupTitle>{t('c199')}</GroupTitle>
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
              (page.batteryProblem ? t("c992", { battery: page.battery }) : page.battery),
            page.lastHeard,
          ]
            .filter(Boolean)
            .join('，')}
        />
        <ListRow
          title={t('c073')}
          right={page.position}
          label={t("c993", { position: page.position })}
        />
        {page.uploadProblem ? (
          <ListRow
            testID="receiver-upload-problem"
            title={page.uploadProblem.title}
            detail={page.uploadProblem.detail}
            right={page.uploadProblem.right}
            problem
            label={[page.uploadProblem.title, page.uploadProblem.detail, page.uploadProblem.right]
              .filter(Boolean).join('，')}
          />
        ) : null}
        {page.uploadLast ? (
          <ListRow
            testID="receiver-upload-last"
            title={page.uploadLast.text}
            titleTone={page.uploadLast.success ? undefined : 'muted'}
            success={page.uploadLast.success}
            label={page.uploadLast.label}
          />
        ) : null}
        {page.uploadLast?.previous ? (
          <ListRow
            testID="receiver-upload-previous"
            title={page.uploadLast.previous.text}
            success={page.uploadLast.previous.success}
            label={page.uploadLast.previous.label}
          />
        ) : null}
        {off ? (
          <ListRow
            testID="receiver-reconnect"
            title={t('c288')}
            titleTone="tonal"
            onPress={onReconnect}
            label={t('c288')}
          />
        ) : (
          <ListRow
            testID="receiver-disconnect"
            title={t('c204')}
            titleTone="danger"
            onPress={onDisconnect}
            label={t('c204')}
          />
        )}
        <ListRow
          testID="receiver-change"
          title={t('c206')}
          chevron
          onPress={onChange}
          label={t('c206')}
        />
      </GroupCard>
      <View onLayout={event => {
        if (fromWaitingSources && !scrolled.current) {
          scrolled.current = true;
          scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false });
        }
      }} testID="receiver-sources-heading"><GroupTitle>{t('c202')}</GroupTitle></View>
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
          <ListRow title={t("c994")} titleTone="muted" />
        )}
      </GroupCard>
    </ScrollView>
  );
}

import React from 'react';
import { ScrollView, Switch } from 'react-native';
import { colors } from '../theme/tokens';
import { GroupCard, ListRow, settingsStyles } from './SettingsUI';

/**
 * S4 手機: 位置記錄 (switch, today's count), 權限 (one cell: what is missing,
 * 「開系統設定 ›」 opens the app's system permission page), 定位服務
 * (「打開 ›」), 忽略電池最佳化 (a recommendation: never a 「!」). `page` is
 * SettingsModel.phonePage.
 */
export default function PhoneSettings({ page, onRecording, onPermissions, onLocationServices, onBattery }) {
  const { recording, permission, services, battery } = page;
  return (
    <ScrollView testID="phone-settings" style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}>
      <GroupCard flat>
        <ListRow title="位置記錄" detail={recording.detail} detailTone={recording.problem ? 'crit' : undefined}
          label={['位置記錄', recording.detail].filter(Boolean).join('，')}>
          <Switch testID="phone-recording" accessibilityLabel="位置記錄" value={recording.on}
            disabled={recording.busy} onValueChange={onRecording}
            trackColor={{ false: colors.line, true: colors.accent }} thumbColor={colors.surface} />
        </ListRow>
        <ListRow testID="phone-permissions" title="權限" problem={permission.problem} detail={permission.detail}
          right={permission.status} action={permission.action}
          onPress={permission.problem ? onPermissions : undefined}
          label={permission.problem ? `權限，有問題：${permission.detail}，開系統設定` : '權限，已允許'} />
        <ListRow testID="phone-location-services" title="定位服務" problem={services.problem} detail={services.detail}
          right={services.status} action={services.action}
          onPress={services.problem ? onLocationServices : undefined}
          label={services.problem ? '定位服務，有問題：定位服務關著，打開' : '定位服務，已開啟'} />
        <ListRow testID="phone-battery" title="忽略電池最佳化" detail="讓 App 在背景也能一直收資料"
          right={battery.status} action={battery.action} actionTone="plain"
          onPress={battery.action ? onBattery : undefined}
          label={battery.action ? '忽略電池最佳化，讓 App 在背景也能一直收資料，開系統設定' : '忽略電池最佳化，已允許'} />
      </GroupCard>
    </ScrollView>
  );
}

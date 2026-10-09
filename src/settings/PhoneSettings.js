import { useRef, useState } from 'react';
import { FocusedPhoneRow, firstPhoneProblem } from './PhoneProblemFocus';
import { useStyles } from '../theme/ThemeProvider';
import { ScrollView } from 'react-native';

import { GroupCard, ListRow, getSettingsStyles } from './SettingsUI';

/**
 * S4 手機: 位置記錄 (switch, today's count), 權限 (one cell: what is missing,
 * 「開系統設定 ›」 opens the app's system permission page), 定位服務
 * (「打開 ›」), 忽略電池最佳化 (a recommendation: never a 「!」). `page` is
 * SettingsModel.phonePage.
 */
export default function PhoneSettings({
  page,
  fromUnrecorded = false,
  onRecording,
  onPermissions,
  onLocationServices,
  onBattery,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const scroll = useRef(null);
  const focused = useRef(false);
  const [target] = useState(() => fromUnrecorded ? firstPhoneProblem(page) : null);
  const onPosition = (id, y) => {
    if (id === target && !focused.current) {
      focused.current = true;
      scroll.current?.scrollTo({ y, animated: false });
    }
  };
  const { recording, permission, services, battery } = page;
  return (
    <ScrollView
      ref={scroll}
      testID="phone-settings"
      style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}
    >
      <GroupCard flat onRowLayout={(index, y) => onPosition(['recording', 'permission', 'services'][index], y)}>
        <FocusedPhoneRow id="recording" target={target}>
        <ListRow
          title="位置記錄"
          detail={recording.detail}
          detailTone={recording.problem ? 'crit' : undefined}
          label={['位置記錄', recording.detail].filter(Boolean).join('，')}
          toggle={{
            testID: 'phone-recording',
            value: recording.on,
            disabled: recording.busy,
            onChange: onRecording,
          }}
        />
        </FocusedPhoneRow>
        <FocusedPhoneRow id="permission" target={target}>
        <ListRow
          testID="phone-permissions"
          title="權限"
          problem={permission.problem}
          detail={permission.detail}
          right={permission.status}
          action={permission.action}
          onPress={permission.problem ? onPermissions : undefined}
          label={
            permission.problem
              ? `權限，有問題：${permission.detail}，開系統設定`
              : '權限，已允許'
          }
        />
        </FocusedPhoneRow>
        <FocusedPhoneRow id="services" target={target}>
        <ListRow
          testID="phone-location-services"
          title="定位服務"
          problem={services.problem}
          detail={services.detail}
          right={services.status}
          action={services.action}
          onPress={services.problem ? onLocationServices : undefined}
          label={
            services.problem
              ? '定位服務，有問題：定位服務關著，打開'
              : '定位服務，已開啟'
          }
        />
        </FocusedPhoneRow>
        <ListRow
          testID="phone-battery"
          title="忽略電池最佳化"
          detail="讓 App 在背景也能一直收資料"
          right={battery.status}
          action={battery.action}
          actionTone="plain"
          onPress={battery.action ? onBattery : undefined}
          label={
            battery.action
              ? '忽略電池最佳化，讓 App 在背景也能一直收資料，開系統設定'
              : '忽略電池最佳化，已允許'
          }
        />
      </GroupCard>
    </ScrollView>
  );
}

import { useRef, useState } from 'react';
import { FocusedPhoneRow, firstPhoneProblem } from './PhoneProblemFocus';
import { useStyles } from '../theme/ThemeProvider';
import { ScrollView } from 'react-native';

import ConfirmDialog from './ConfirmDialog';
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
  onDeleteRoutes,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const deleteBusy = useRef(false);
  const removeRoutes = async () => {
    if (deleteBusy.current) return;
    deleteBusy.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteRoutes();
      setDeleteOpen(false);
    } catch (error) {
      setDeleteError(`刪除失敗：${error.message || '請再試一次'}`);
    } finally {
      deleteBusy.current = false;
      setDeleting(false);
    }
  };
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
          detail={['離開 App、鎖螢幕時也會繼續在背景記錄', recording.detail].filter(Boolean).join('；')}
          detailTone={recording.problem ? 'crit' : undefined}
          label={['位置記錄', '離開 App、鎖螢幕時也會繼續在背景記錄', recording.detail].filter(Boolean).join('，')}
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
        <ListRow testID="phone-delete-routes" title="刪除我的路線" titleTone="danger"
          onPress={() => { setDeleteError(null); setDeleteOpen(true); }} />
      </GroupCard>
      <ConfirmDialog testID="delete-phone-routes" visible={deleteOpen}
        title="刪除我的路線？"
        body="這支手機記錄的所有路線都會刪除，不能復原。狗的資料、名字和頭像不受影響。"
        confirm="刪除" destructive busy={deleting} problem={deleteError} problemBlocks={false}
        onConfirm={removeRoutes} onCancel={() => { if (!deleteBusy.current) setDeleteOpen(false); }} />
    </ScrollView>
  );
}

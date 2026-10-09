import { t } from '../i18n';
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
      setDeleteError(t("c989", { value: error.message || t("c545") }));
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
          title={t('c221')}
          detail={[t("c981"), recording.detail].filter(Boolean).join('；')}
          detailTone={recording.problem ? 'crit' : undefined}
          label={[t('c221'), t("c981"), recording.detail].filter(Boolean).join('，')}
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
          title={t('c223')}
          problem={permission.problem}
          detail={permission.detail}
          right={permission.status}
          action={permission.action}
          onPress={permission.problem ? onPermissions : undefined}
          label={
            permission.problem
              ? t("c983", { detail: permission.detail })
              : t("c984")
          }
        />
        </FocusedPhoneRow>
        <FocusedPhoneRow id="services" target={target}>
        <ListRow
          testID="phone-location-services"
          title={t('c226')}
          problem={services.problem}
          detail={services.detail}
          right={services.status}
          action={services.action}
          onPress={services.problem ? onLocationServices : undefined}
          label={
            services.problem
              ? t("c985")
              : t("c986")
          }
        />
        </FocusedPhoneRow>
        <ListRow
          testID="phone-battery"
          title={t('c229')}
          detail={t("c982")}
          right={battery.status}
          action={battery.action}
          actionTone="plain"
          onPress={battery.action ? onBattery : undefined}
          label={
            battery.action
              ? t("c987")
              : t("c988")
          }
        />
        <ListRow testID="phone-delete-routes" title={t("c990")} titleTone="danger"
          onPress={() => { setDeleteError(null); setDeleteOpen(true); }} />
      </GroupCard>
      <ConfirmDialog testID="delete-phone-routes" visible={deleteOpen}
        title={t("c991")}
        body={t("c980")}
        confirm={t("c949")} destructive busy={deleting} problem={deleteError} problemBlocks={false}
        onConfirm={removeRoutes} onCancel={() => { if (!deleteBusy.current) setDeleteOpen(false); }} />
    </ScrollView>
  );
}

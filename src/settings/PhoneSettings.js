import { t } from '../i18n';
import { useRef, useState } from 'react';
import { FocusedPhoneRow, firstPhoneProblem } from './PhoneProblemFocus';
import { useStyles } from '../theme/ThemeProvider';
import { ScrollView } from 'react-native';

import ConfirmDialog from './ConfirmDialog';
import { GroupCard, ListRow, getSettingsStyles } from './SettingsUI';

/** Phone recording, one location row, battery recommendation and route deletion. */
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
  const { recording, location, battery } = page;
  // Keep recording/count data intact; this row only shows actionable errors.
  const recordingError = recording.problem ? recording.detail : null;
  return (
    <ScrollView
      ref={scroll}
      testID="phone-settings"
      style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}
    >
      <GroupCard flat onRowLayout={(index, y) => onPosition(['recording', 'location'][index], y)}>
        <FocusedPhoneRow id="recording" target={target}>
        <ListRow
          title={t('c221')}
          detail={[t("c981"), recordingError].filter(Boolean).join('；')}
          detailTone={recording.problem ? 'crit' : undefined}
          label={[t('c221'), t("c981"), recordingError].filter(Boolean).join('，')}
          toggle={{
            testID: 'phone-recording',
            value: recording.on,
            disabled: recording.busy,
            onChange: onRecording,
          }}
        />
        </FocusedPhoneRow>
        <FocusedPhoneRow id="location" target={target}>
        <ListRow
          testID="phone-location"
          title={t('c073')}
          problem={location.problem}
          detail={location.detail}
          action={location.action}
          onPress={location.problem ? (location.destination === 'services' ? onLocationServices : onPermissions) : undefined}
          label={[t('c073'), location.detail, location.action].filter(Boolean).join('，')}
        />
        </FocusedPhoneRow>
        <ListRow
          testID="phone-battery"
          title={t('c229')}
          detail={t('c230')}
          right={battery.status}
          action={battery.action}
          actionTone="plain"
          onPress={battery.action ? onBattery : undefined}
          label={
            battery.action
              ? [t('c229'), t('c230'), t('c225')].join('，')
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

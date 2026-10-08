import { useStyles } from '../theme/ThemeProvider';
import { ScrollView } from 'react-native';
import ConfirmDialog from './ConfirmDialog';
import { GroupCard, ListRow, getSettingsStyles } from './SettingsUI';
import { wifiSummary } from './useReceiverWifi';

/**
 * S7 進階 (design S7): 接收器 Wi-Fi (the networks the receiver keeps, 「家裡、
 * 辦公室」) and 刪除全部狗資料 (red; asks first, saying what goes and what
 * stays). `wifi` is useReceiverWifi's answer, `deletion` useDeleteDogData's;
 * `deletedText` (「已刪除・10:21」) says the last deletion went through.
 */
export default function AdvancedSettings({
  wifi,
  deletion,
  onWifi,
  deletedText = null,
}) {
  const settingsStyles = useStyles(getSettingsStyles);
  const summary = wifiSummary(wifi);
  const dialog = deletion.dialog;
  return (
    <ScrollView
      testID="advanced-settings"
      style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, settingsStyles.firstCard]}
    >
      <GroupCard flat>
        <ListRow
          testID="advanced-wifi"
          title="接收器 Wi-Fi"
          detail={summary}
          chevron
          onPress={onWifi}
          label={`接收器 Wi-Fi，${summary}`}
        />
        <ListRow
          testID="advanced-delete"
          title="刪除全部狗資料"
          titleTone="danger"
          detail={deletedText}
          onPress={deletion.start}
          label={['刪除全部狗資料', deletedText].filter(Boolean).join('，')}
        />
      </GroupCard>
      <ConfirmDialog
        testID="delete-dog-data"
        visible={dialog.visible}
        title={dialog.title}
        body={dialog.body}
        note={dialog.note}
        problem={dialog.problem}
        problemBlocks={false}
        confirm={dialog.confirm}
        destructive
        busy={dialog.busy}
        onConfirm={deletion.confirm}
        onCancel={deletion.cancel}
        secondary={
          dialog.secondary
            ? {
                label: dialog.secondary,
                onPress: deletion.uploadFirst,
                busy: dialog.uploading,
              }
            : null
        }
      />
    </ScrollView>
  );
}

import React from 'react';
import { ScrollView } from 'react-native';
import { GroupCard, GroupTitle, ListRow, settingsStyles } from './SettingsUI';

// Until the new pages arrive (051c: S7 進階, S8 診斷), 診斷 and 進階 list the
// old pages that hold those things, so none of them is out of reach
// (implementation plan §4 item 1). The upload settings moved to S3 (051a).
export const SETTINGS_LINKS = {
  diagnostics: [
    { id: 'data', title: '即時資料', detail: '接收器收到的最近 100 筆' },
    { id: 'cloudData', title: '本機／雲端資料', detail: '下載到這支手機的雲端資料' },
    { id: 'records', title: '記錄清單', detail: '手機位置記錄的每一筆' },
  ],
  advanced: [
    { id: 'wifi', title: '接收器 Wi-Fi', detail: '查看、新增或刪除接收器的 Wi-Fi' },
  ],
};

// `storage`: a failed write of dog positions (TopAlerts.storageProblem),
// shown on 診斷 with its reason (where 「看原因」 leads).
export default function SettingsLinks({ links, onOpen, storage = null }) {
  return (
    <ScrollView style={settingsStyles.page}
      contentContainerStyle={[settingsStyles.content, !storage && settingsStyles.firstCard]}>
      {storage && <>
        <GroupTitle>位置存不進手機</GroupTitle>
        <GroupCard>
          <ListRow testID="diagnostics-storage" problem title={storage.full ? '手機空間不足' : '寫入失敗'}
            detail={storage.reason} detailTone="crit" label={`位置存不進手機，${storage.reason}`} />
        </GroupCard>
        <GroupTitle>舊的診斷頁</GroupTitle>
      </>}
      <GroupCard>
        {links.map(link => (
          <ListRow key={link.id} testID={`settings-link-${link.id}`} title={link.title} detail={link.detail} chevron
            onPress={() => onOpen(link.id)} label={`${link.title}，${link.detail}`} />
        ))}
      </GroupCard>
    </ScrollView>
  );
}

import React from 'react';
import { ScrollView } from 'react-native';
import { GroupCard, ListRow, settingsStyles } from './SettingsUI';

// Until the new pages arrive (051: S7 進階, S8 診斷), 診斷 and 進階 list the
// old pages that hold those things, so none of them is out of reach
// (implementation plan §4 item 1).
export const SETTINGS_LINKS = {
  diagnostics: [
    { id: 'data', title: '即時資料', detail: '接收器收到的最近 100 筆' },
    { id: 'records', title: '記錄清單', detail: '手機位置記錄的每一筆' },
  ],
  advanced: [
    { id: 'wifi', title: '接收器 Wi-Fi', detail: '查看、新增或刪除接收器的 Wi-Fi' },
    { id: 'upload', title: '上傳設定', detail: '每台接收器的上傳方式、待傳筆數' },
  ],
};

export default function SettingsLinks({ links, onOpen }) {
  return (
    <ScrollView style={settingsStyles.page} contentContainerStyle={settingsStyles.content}>
      <GroupCard>
        {links.map(link => (
          <ListRow key={link.id} testID={`settings-link-${link.id}`} title={link.title} detail={link.detail} chevron
            onPress={() => onOpen(link.id)} label={`${link.title}，${link.detail}`} />
        ))}
      </GroupCard>
    </ScrollView>
  );
}

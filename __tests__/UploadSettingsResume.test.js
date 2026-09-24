import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules, Platform, Switch } from 'react-native';
import { useCloudUpload } from '../src/cloudUpload/useCloudUpload';
import UploadSettingsScreen from '../src/cloudUpload/UploadSettingsScreen';
import { createUploadDatabase } from '../src/cloudUpload/UploadDatabase';
import { createUploadService } from '../src/cloudUpload/UploadService';

jest.mock('../src/database/TrackingDatabaseConnection', () => ({ openTrackingDatabase: () => ({}) }));
jest.mock('../src/cloudUpload/UploadDatabase', () => ({ createUploadDatabase: jest.fn() }));
jest.mock('../src/cloudUpload/UploadService', () => ({ createUploadService: jest.fn() }));
jest.mock('../src/cloud/CloudClient', () => ({ getCloudClient: () => ({ from: () => ({
  select: () => ({ eq: async () => ({ data: [{ gateway_id: 'master_5' }, { gateway_id: 'master_7' }] }) }),
}) }) }));

test('relay switches update only the selected Master and wait for saved settings', async () => {
  const upload = { owner: 'alice', phoneId: 'phone', supported: true, settingsReady: true,
    masters: [5, 7], settings: [{ master_id: 5, mode: 'phone' }, { master_id: 7, mode: 'wifi' }],
    counts: [], setMode: jest.fn(async () => {}), retry: jest.fn() };
  let renderer;
  await act(async () => { renderer = Renderer.create(<UploadSettingsScreen upload={upload} />); });
  const switches = renderer.root.findAllByType(Switch);
  expect(switches.map(s => s.props.value)).toEqual([true, false]);
  await act(async () => switches[0].props.onValueChange(false));
  expect(upload.setMode).toHaveBeenLastCalledWith(5, 'wifi');
  await act(async () => switches[1].props.onValueChange(true));
  expect(upload.setMode).toHaveBeenLastCalledWith(7, 'phone');
  await act(async () => renderer.update(<UploadSettingsScreen upload={{ ...upload, settingsReady: false }} />));
  expect(renderer.root.findAllByType(Switch)).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('resume keeps saved routes visible while uploads are slow, and account switches hide old routes', async () => {
  const previousOS = Platform.OS, previousNative = NativeModules.BleBackground;
  Platform.OS = 'android'; NativeModules.BleBackground = { executeDatabase: jest.fn() };
  const database = {
    owner: jest.fn(async () => {}), identity: async () => 'phone',
    settings: jest.fn(async owner => [{ owner_user_id: owner, master_id: 5, mode: 'phone' }]),
    summary: async () => ({ counts: [] }),
  };
  createUploadDatabase.mockReturnValue(database);
  const finish = [];
  createUploadService.mockReturnValue({ run: () => new Promise(resolve => finish.push(resolve)) });
  const seen = [];
  function Probe({ foreground, owner = 'alice' }) {
    const upload = useCloudUpload(true, owner, foreground);
    seen.push({ owner, settings: upload.settings, ready: upload.settingsReady });
    return <UploadSettingsScreen upload={upload} />;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe foreground />); });
    expect(JSON.stringify(renderer.toJSON())).toContain('本手機 BLE');
    expect(seen[seen.length - 1].settings[0].mode).toBe('phone');
    seen.length = 0;
    await act(async () => renderer.update(<Probe foreground={false} />));
    await act(async () => renderer.update(<Probe foreground />));
    expect(seen.every(s => s.ready && s.settings[0]?.mode === 'phone')).toBe(true);
    database.owner.mockReturnValue(new Promise(() => {}));
    await act(async () => renderer.update(<Probe foreground owner="bob" />));
    expect(seen[seen.length - 1]).toEqual({ owner: 'bob', settings: [], ready: false });
    expect(JSON.stringify(renderer.toJSON())).toContain('讀取設定中');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await act(async () => finish.forEach(resolve => resolve()));
    Platform.OS = previousOS; NativeModules.BleBackground = previousNative;
  }
});

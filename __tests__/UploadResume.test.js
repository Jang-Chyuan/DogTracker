import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules, Platform } from 'react-native';
import { useCloudUpload } from '../src/cloudUpload/useCloudUpload';
import { createUploadDatabase } from '../src/cloudUpload/UploadDatabase';
import { createUploadService } from '../src/cloudUpload/UploadService';

jest.mock('../src/database/TrackingDatabaseConnection', () => ({ openTrackingDatabase: () => ({}) }));
jest.mock('../src/cloudUpload/UploadDatabase', () => ({ createUploadDatabase: jest.fn() }));
jest.mock('../src/cloudUpload/UploadService', () => ({ createUploadService: jest.fn() }));
jest.mock('../src/cloud/CloudClient', () => ({ getCloudClient: () => ({ from: () => ({
  select: () => ({ eq: async () => ({ data: [{ gateway_id: 'master_5' }, { gateway_id: 'master_7' }] }) }),
}) }) }));

test('a route switch sends what waits first, then changes; offline it does not change', async () => {
  const previousOS = Platform.OS, previousNative = NativeModules.BleBackground;
  Platform.OS = 'android'; NativeModules.BleBackground = { executeDatabase: jest.fn() };
  let waiting = 12;
  const database = {
    owner: jest.fn(async () => {}), identity: async () => 'phone',
    settings: jest.fn(async () => [{ owner_user_id: 'alice', master_id: 7, mode: 'wifi' }]),
    summary: async () => ({ counts: [{ status: 'pending', count: waiting }], pendingByMaster: { 7: waiting } }),
    pendingCount: jest.fn(async () => waiting), setMode: jest.fn(async () => {}),
  };
  createUploadDatabase.mockReturnValue(database);
  const flush = jest.fn(async () => ({ result: 'offline', remaining: 12 }));
  createUploadService.mockReturnValue({ run: async () => 'idle', flush });
  const failures = jest.fn();
  let upload, renderer;
  function Probe() { upload = useCloudUpload(true, 'alice', true, failures); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(upload.pendingByMaster).toEqual({ 7: 12 });
    let failure;
    await act(async () => { await upload.switchMode(7, 'phone').catch(error => { failure = error; }); });
    expect(flush).toHaveBeenCalledWith('alice', 7);
    expect(failure.message).toBe('要先上傳完 12 筆，請連上網路');
    expect(database.setMode).not.toHaveBeenCalled();
    flush.mockImplementation(async () => { waiting = 0; return { result: 'done', remaining: 0 }; });
    await act(async () => upload.switchMode(7, 'phone'));
    expect(database.setMode).toHaveBeenCalledWith('alice', 7, 'phone');
    // Nothing waiting: no upload needed, it just switches.
    flush.mockClear();
    await act(async () => upload.switchMode(7, 'wifi'));
    expect(flush).not.toHaveBeenCalled();
    expect(database.setMode).toHaveBeenLastCalledWith('alice', 7, 'wifi');
    // A refused sign-in while sending reports it.
    waiting = 3;
    flush.mockImplementation(async () => ({ result: 'unauthorized', remaining: 3 }));
    await act(async () => { await upload.switchMode(7, 'phone').catch(error => { failure = error; }); });
    expect(failure.message).toBe('需要重新登入');
    expect(failures).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    Platform.OS = previousOS; NativeModules.BleBackground = previousNative;
  }
});

test('an upload refused for the sign-in (401) reports it once per pass', async () => {
  const previousOS = Platform.OS, previousNative = NativeModules.BleBackground;
  Platform.OS = 'android'; NativeModules.BleBackground = { executeDatabase: jest.fn() };
  createUploadDatabase.mockReturnValue({ owner: async () => {}, identity: async () => 'phone',
    settings: async () => [{ master_id: 7, mode: 'phone' }], summary: async () => ({ counts: [] }) });
  createUploadService.mockReturnValue({ run: async () => 'unauthorized' });
  const failures = jest.fn();
  let renderer;
  function Probe() { useCloudUpload(true, 'alice', true, failures); return null; }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(failures).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    Platform.OS = previousOS; NativeModules.BleBackground = previousNative;
  }
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
    return null;
  }
  let renderer;
  try {
    await act(async () => { renderer = Renderer.create(<Probe foreground />); });
    expect(seen[seen.length - 1].settings[0].mode).toBe('phone');
    seen.length = 0;
    await act(async () => renderer.update(<Probe foreground={false} />));
    await act(async () => renderer.update(<Probe foreground />));
    expect(seen.every(s => s.ready && s.settings[0]?.mode === 'phone')).toBe(true);
    database.owner.mockReturnValue(new Promise(() => {}));
    await act(async () => renderer.update(<Probe foreground owner="bob" />));
    expect(seen[seen.length - 1]).toEqual({ owner: 'bob', settings: [], ready: false });
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await act(async () => finish.forEach(resolve => resolve()));
    Platform.OS = previousOS; NativeModules.BleBackground = previousNative;
  }
});

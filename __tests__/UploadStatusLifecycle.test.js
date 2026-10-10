import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { NativeModules, Platform } from 'react-native';
import { useCloudUpload } from '../src/cloudUpload/useCloudUpload';
import { createUploadDatabase } from '../src/cloudUpload/UploadDatabase';
import { createUploadService } from '../src/cloudUpload/UploadService';

jest.mock('../src/database/TrackingDatabaseConnection', () => ({ openTrackingDatabase: () => ({}) }));
jest.mock('../src/cloud/CloudClient', () => ({ getCloudClient: () => ({}) }));
jest.mock('../src/cloudUpload/UploadDatabase', () => ({ createUploadDatabase: jest.fn() }));
jest.mock('../src/cloudUpload/UploadService', () => ({ createUploadService: jest.fn() }));

test('download refresh, route switches and account changes preserve only the current account evidence', async () => {
  jest.useFakeTimers();
  const oldOS = Platform.OS, oldBle = NativeModules.BleBackground;
  Platform.OS = 'android';
  NativeModules.BleBackground = { executeDatabase: jest.fn() };
  let mode = 'phone', value, renderer, late;
  const database = {
    owner: jest.fn(async () => {}), identity: async () => 'test-phone',
    settings: async () => [{ master_id: 5, mode }],
    summary: async owner => ({ last: owner === 'alice' ? 1000 : null,
      lastByMaster: owner === 'alice' ? { 5: 1000 } : {}, counts: [], pendingByMaster: {} }),
    setMode: async (owner, master, next) => { mode = next; },
  };
  createUploadDatabase.mockReturnValue(database);
  createUploadService.mockReturnValue({ run: async () => 'done' });
  const cloud = { wifiUploads: jest.fn().mockResolvedValue({ 5: 2000 }) };
  function Probe({ owner = 'alice', revision = 1 }) {
    value = useCloudUpload(true, owner, true, null, cloud, revision);
    return null;
  }
  try {
    await act(async () => { renderer = Renderer.create(<Probe />); });
    expect(value.lastByMaster).toEqual({ 5: 1000 });
    expect(value.wifiByMaster).toEqual({ 5: 2000 });
    cloud.wifiUploads.mockResolvedValue({ 5: 3000 });
    await act(async () => renderer.update(<Probe revision={2} />));
    expect(value.wifiByMaster).toEqual({ 5: 3000 });
    await act(async () => value.setMode(5, 'wifi'));
    expect(value.settings[0].mode).toBe('wifi');
    expect(value.lastByMaster).toEqual({ 5: 1000 });
    await act(async () => value.setMode(5, 'phone'));
    expect(value.lastByMaster).toEqual({ 5: 1000 });
    // An earlier account's read completing after the switch cannot leak.
    cloud.wifiUploads.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
    await act(async () => renderer.update(<Probe revision={3} />));
    cloud.wifiUploads.mockResolvedValue({ 7: 4000 });
    await act(async () => renderer.update(<Probe owner="bob" revision={4} />));
    await act(async () => late({ 5: 9999 }));
    expect(value.lastByMaster).toEqual({});
    expect(value.wifiByMaster).toEqual({ 7: 4000 });
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    NativeModules.BleBackground = oldBle;
    Platform.OS = oldOS;
    jest.useRealTimers();
  }
});

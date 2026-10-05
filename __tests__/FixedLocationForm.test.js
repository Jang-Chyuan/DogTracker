import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, TextInput, Switch } from 'react-native';
import FixedLocationForm from '../src/map/FixedLocationForm';
import { readFixedLocation, saveFixedLocation, unlockFixedLocation } from '../src/cloud/FixedLocations';

jest.mock('../src/cloud/CloudClient', () => ({ getCloudClient: () => ({}) }));
jest.mock('../src/cloud/FixedLocations', () => ({
  readFixedLocation: jest.fn(), saveFixedLocation: jest.fn(), unlockFixedLocation: jest.fn(),
}));
const row = { slave_id: 8, master_id: 7, name: '家', latitude: 25, longitude: 121, enabled: true };
let renderer, changeState;
const button = label => renderer.root.findAll(node => node.props.accessibilityLabel === label
  && typeof node.props.onPress === 'function')[0];
const field = label => renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label);
const view = (slaveId = 8, owner = 'owner') => <FixedLocationForm slaveId={slaveId} masterId={7} owner={owner} />;
async function unlock() {
  await act(async () => { button('修改固定位置設定').props.onPress(); });
  await act(async () => { field('雲端帳號密碼').props.onChangeText('password'); });
  await act(async () => { button('解鎖固定位置設定').props.onPress(); });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    changeState = callback;
    return { remove: jest.fn() };
  });
  readFixedLocation.mockResolvedValue(row);
  unlockFixedLocation.mockImplementation(async () => ({ token: 'grant', expiresAt: Date.now() + 300000 }));
  saveFixedLocation.mockResolvedValue(row);
});
afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
  renderer = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('settings start locked, password verification enables editing, and saving relocks', async () => {
  await act(async () => { renderer = Renderer.create(view()); });
  expect(field('固定位置位置名稱').props.editable).toBe(false);
  expect(renderer.root.findByType(Switch).props.disabled).toBe(true);
  await unlock();
  expect(unlockFixedLocation).toHaveBeenCalledWith({}, 'owner', 8, 7, 'password');
  expect(field('雲端帳號密碼')).toBeUndefined();
  expect(field('固定位置位置名稱').props.editable).toBe(true);
  const save = button('儲存固定位置');
  await act(async () => { save.props.onPress(); });
  expect(saveFixedLocation).toHaveBeenCalledWith({}, 'owner', expect.objectContaining({ slave_id: 8 }),
    expect.objectContaining({ token: 'grant' }));
  expect(field('固定位置位置名稱').props.editable).toBe(false);
});

test('wrong password keeps settings locked and clears password input', async () => {
  unlockFixedLocation.mockRejectedValue(new Error('密碼錯誤'));
  await act(async () => { renderer = Renderer.create(view()); });
  await unlock();
  expect(field('固定位置位置名稱').props.editable).toBe(false);
  expect(field('雲端帳號密碼').props.value).toBe('');
  expect(JSON.stringify(renderer.toJSON())).toContain('密碼錯誤');
  expect(saveFixedLocation).not.toHaveBeenCalled();
});

test('expiry, background and changing dogs or accounts require another password', async () => {
  await act(async () => { renderer = Renderer.create(view()); });
  await unlock();
  await act(async () => { jest.advanceTimersByTime(300000); });
  expect(field('固定位置位置名稱').props.editable).toBe(false);
  await unlock();
  await act(async () => { changeState('background'); });
  await act(async () => { changeState('active'); });
  expect(field('固定位置位置名稱').props.editable).toBe(false);
  await unlock();
  await act(async () => { renderer.update(view(4)); });
  expect(field('固定位置位置名稱').props.editable).toBe(false);
  await unlock();
  await act(async () => { renderer.update(view(4, 'other')); });
  expect(field('固定位置位置名稱').props.editable).toBe(false);
});

test('a late password response cannot unlock after entering background', async () => {
  let complete;
  unlockFixedLocation.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  await act(async () => { renderer = Renderer.create(view()); });
  await unlock();
  await act(async () => { changeState('background'); changeState('active'); });
  await act(async () => { complete({ token: 'late', expiresAt: Date.now() + 300000 }); });
  expect(field('固定位置位置名稱').props.editable).toBe(false);
});

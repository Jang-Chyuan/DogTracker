import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import WifiSettings from '../src/settings/WifiSettings';
import AdvancedSettings from '../src/settings/AdvancedSettings';
import { useReceiverWifi } from '../src/settings/useReceiverWifi';

const text = renderer => JSON.stringify(renderer.toJSON());
const node = (renderer, id) => renderer.root.findAllByProps({ testID: id })[0];

test('disconnected cached networks are last-known and cannot select, delete or send; reconnect is available', async () => {
  const reconnect = jest.fn();
  const wifi = { connected: false, ssids: ['Field'], activeSsid: 'Field', error: 'old error', reload: jest.fn(), save: jest.fn(), remove: jest.fn() };
  let renderer;
  await act(async () => { renderer = Renderer.create(<WifiSettings wifi={wifi} onReconnect={reconnect} />); });
  expect(text(renderer)).toContain('接收器沒有連線，連上後才能設定 Wi-Fi');
  expect(text(renderer)).toContain('上次看到的網路');
  expect(text(renderer)).not.toContain('使用中');
  expect(node(renderer, 'wifi-Field').props.onPress).toBeUndefined();
  expect(node(renderer, 'wifi-Field').props.label).toBe('Field');
  expect(node(renderer, 'wifi-delete-Field').props.disabled).toBe(true);
  expect(node(renderer, 'wifi-ssid').props.editable).toBe(false);
  expect(node(renderer, 'wifi-password').props.editable).toBe(false);
  expect(node(renderer, 'wifi-send').props.disabled).toBe(true);
  expect(node(renderer, 'wifi-load-error')).toBeUndefined();
  await act(async () => node(renderer, 'wifi-connect').props.onPress());
  expect(reconnect).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('connected can switch; never paired offers pairing without networks or form', async () => {
  const change = jest.fn(), pair = jest.fn();
  let renderer;
  await act(async () => { renderer = Renderer.create(<WifiSettings wifi={{ connected: true, ssids: [] }} onChange={change} />); });
  expect(text(renderer)).toContain('換接收器');
  await act(async () => node(renderer, 'wifi-change').props.onPress());
  expect(change).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<WifiSettings wifi={{ connected: false, ssids: ['old'] }} paired={false} onConnect={pair} />));
  expect(text(renderer)).toContain('還沒有配對接收器');
  expect(node(renderer, 'wifi-ssid')).toBeUndefined();
  expect(node(renderer, 'wifi-old')).toBeUndefined();
  await act(async () => node(renderer, 'wifi-pair').props.onPress());
  expect(pair).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test.each([[true, true, '接收器 23・連線中'], [false, true, '接收器 23・沒有連線'], [false, false, '還沒有配對接收器']])('S7 row: connected %s paired %s', async (connected, paired, expected) => {
  let renderer;
  await act(async () => { renderer = Renderer.create(<AdvancedSettings wifi={{ connected, ssids: ['old'] }} receiver="接收器 23" paired={paired} deletion={{ dialog: {} }} />); });
  expect(node(renderer, 'advanced-wifi').props.detail).toBe(expected);
  await act(async () => renderer.unmount());
});

test('disconnect preserves only last-known data, blocks commands and ignores pending reads; switching clears cache', async () => {
  const reads = [];
  const service = { getWifiList: jest.fn(() => new Promise(resolve => reads.push(resolve))), configureWifi: jest.fn(), removeWifi: jest.fn() };
  let wifi, renderer;
  function Probe({ connected, receiverKey }) { wifi = useReceiverWifi(service, { active: true, connected, receiverKey }); return null; }
  await act(async () => { renderer = Renderer.create(<Probe connected receiverKey="a" />); });
  await act(async () => reads[0]({ ssids: ['old'] }));
  await act(async () => { wifi.reload(); });
  await act(async () => renderer.update(<Probe connected={false} receiverKey="a" />));
  await act(async () => reads[1]({ ssids: ['late'] }));
  expect(wifi.ssids).toEqual(['old']);
  await act(async () => { await wifi.reload(); });
  await expect(wifi.save('name', 'password')).rejects.toThrow('接收器沒有連線');
  await expect(wifi.remove('old')).rejects.toThrow('接收器沒有連線');
  expect(service.getWifiList).toHaveBeenCalledTimes(2);
  expect(service.configureWifi).not.toHaveBeenCalled();
  expect(service.removeWifi).not.toHaveBeenCalled();
  await act(async () => renderer.update(<Probe connected receiverKey="b" />));
  expect(wifi.ssids).toBeNull();
  await act(async () => reads[2]({ ssids: ['new'] }));
  expect(wifi.ssids).toEqual(['new']);
  await act(async () => renderer.unmount());
});

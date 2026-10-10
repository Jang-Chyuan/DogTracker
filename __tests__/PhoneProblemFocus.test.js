import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Animated, ScrollView } from 'react-native';
import PhoneSettings from '../src/settings/PhoneSettings';
import { FocusedPhoneRow, firstPhoneProblem } from '../src/settings/PhoneProblemFocus';
import { phonePage } from '../src/settings/SettingsModel';
import { todayPill } from '../src/tracking/TodayDistance';
import { GroupCard } from '../src/settings/SettingsUI';

const page = (enabled, permission, services) => phonePage({ recording: { enabled }, phone: { permission, services } });

test('first problem follows row order, ignores non-location permissions, and clears resolved causes', () => {
  expect(firstPhoneProblem(page(false, 'denied', false))).toBe('recording');
  expect(firstPhoneProblem(page(true, 'denied', false))).toBe('location');
  expect(firstPhoneProblem(page(true, 'approximate', false))).toBe('location');
  expect(firstPhoneProblem(page(true, 'precise', false))).toBe('location');
  expect(firstPhoneProblem(phonePage({ phone: { permission: 'precise', services: true }, permissions: { notificationsDenied: true } }))).toBeNull();
});

test('unrecorded pill directs to phone settings with a reason; recorded route stays in history', () => {
  const input = { route: { count: 0, metres: 0 }, livePhone: { running: true }, phone: { permission: 'approximate', services: true } };
  expect(todayPill(input)).toMatchObject({ destination: 'phone-settings', unrecorded: true,
    label: '今天未記錄，只給了大概位置，點兩下到手機設定' });
  expect(todayPill({ ...input, route: { count: 2, metres: 1000 } })).toMatchObject({ destination: 'history', unrecorded: false });
});

test('S4 scrolls once to the measured problem row; normal entry never focuses', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
  let renderer;
  await act(async () => { renderer = Renderer.create(<PhoneSettings page={page(true, 'approximate', false)} fromUnrecorded />,
    { createNodeMock: () => ({ scrollTo }) }); });
  const card = renderer.root.findByType(GroupCard);
  await act(async () => { card.props.onRowLayout(0, 0); card.props.onRowLayout(1, 92); card.props.onRowLayout(2, 180); });
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenCalledWith({ y: 92, animated: false });
  expect(renderer.root.findAllByType(FocusedPhoneRow).map(row => row.props.target)).toEqual(['location', 'location']);
  await act(async () => renderer.unmount());
  await act(async () => { renderer = Renderer.create(<PhoneSettings page={page(false, 'denied', false)} />); });
  expect(renderer.root.findAllByType(FocusedPhoneRow)[0].props.target).toBeNull();
  await act(async () => renderer.unmount());
  scrollTo.mockRestore();
});

test('highlight holds for one second then fades for 300 ms', async () => {
  jest.useFakeTimers();
  const timing = jest.spyOn(Animated, 'timing');
  let renderer;
  await act(async () => { renderer = Renderer.create(<FocusedPhoneRow id="permission" target="permission" />); });
  const row = renderer.root.findAll(node => node.props.testID === 'phone-focus-permission' && typeof node.props.onLayout === 'function')[0];
  await act(async () => row.props.onLayout());
  await act(async () => jest.advanceTimersByTime(999));
  expect(timing).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1));
  expect(timing.mock.calls[0][1]).toMatchObject({ duration: 300, toValue: 0 });
  await act(async () => renderer.unmount());
  timing.mockRestore();
  jest.useRealTimers();
});

import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import SettingsHome from '../src/settings/SettingsHome';
import ReceiverSettings from '../src/settings/ReceiverSettings';
import PhoneSettings from '../src/settings/PhoneSettings';
import ReceiverLinkPaths from '../src/settings/ReceiverLinkPaths';
import { settingsHome, receiverPage, phonePage } from '../src/settings/SettingsModel';
import { ThemeScope, lightTheme, darkTheme } from '../src/theme/ThemeProvider';

const now = 1_000_000;
const base = { enabled: true, running: true, connected: true, receiving: true,
  deviceId: 'anonymous-receiver', expectedMasterId: 7, lastReceivedAt: now - 5000 };
const states = [
  ['connected', {}, 'receiver-link-signal'],
  ['waiting', { receiving: false, lastReceivedAt: 0 }, 'receiver-link-signal'],
  ['silent', { receiving: false, lastReceivedAt: now - 360000 }, 'receiver-link-signal'],
  ['connecting', { connected: false, receiving: false }, 'receiver-link-connecting'],
  ['disconnected', { connected: false, receiving: false, disconnectedAt: now - 60000 }, 'receiver-link-off'],
  ['off', { enabled: false, running: false, connected: false, receiving: false }, 'receiver-link-off'],
  ['none', { enabled: false, running: false, connected: false, deviceId: '' }, 'receiver-link-off'],
];

test.each([lightTheme, darkTheme])('S1/S2 use the true link phase and distinct geometry ($isDark)', async theme => {
  for (const [phase, override, glyph] of states) {
    const input = { now, receiverState: { ...base, ...override } };
    const home = settingsHome(input);
    const row = home.groups[0].rows[0];
    const page = receiverPage(input);
    expect(row.receiverPhase).toBe(phase);
    expect(page.phase).toBe(phase);
    let renderer;
    await act(async () => { renderer = Renderer.create(<ThemeScope theme={theme}>
      <SettingsHome home={home} />
      <ReceiverSettings page={page} />
    </ThemeScope>); });
    const drawings = renderer.root.findAllByType(ReceiverLinkPaths);
    expect(drawings).toHaveLength(phase === 'none' ? 1 : 2);
    for (const drawing of drawings) {
      expect(drawing.props.phase).toBe(phase);
      expect(drawing.findAllByProps({ testID: glyph }).length).toBeGreaterThan(0);
      for (const other of ['receiver-link-signal', 'receiver-link-off', 'receiver-link-connecting'].filter(id => id !== glyph))
        expect(drawing.findAllByProps({ testID: other })).toHaveLength(0);
    }
    const homeRow = renderer.root.findAll(node => node.props.testID === 'settings-row-receiver'
      && node.props.accessibilityRole === 'button')[0];
    expect(homeRow.props.accessibilityLabel).toBe(row.label);
    if (phase !== 'none') {
      const current = renderer.root.findAll(node => node.props.testID === 'receiver-current'
        && node.props.accessibilityLabel)[0];
      expect(current.props.accessibilityLabel).toContain(page.subtitle);
    }
    await act(async () => renderer.unmount());
  }
});

test('phone row hides only the daily count; recording data and actionable errors stay', async () => {
  const input = { phone: {}, todayCount: 1842, recording: { enabled: true } };
  const page = phonePage(input);
  expect(page.recording.detail).toBe('今天 1,842 筆');
  let renderer;
  await act(async () => { renderer = Renderer.create(<PhoneSettings page={page} />); });
  const words = () => renderer.root.findAllByType(Text).map(node => node.props.children).join('');
  expect(words()).not.toContain('今天 1,842 筆');
  expect(words()).toContain('離開 App、鎖螢幕時也會繼續在背景記錄');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel?.includes('今天 1,842 筆'))).toHaveLength(0);
  expect(input.todayCount).toBe(1842);
  expect(renderer.root.findByProps({ testID: 'phone-recording' }).props.value).toBe(true);
  const errorPage = phonePage({ ...input, recording: { enabled: false, error: 'permission denied' } });
  await act(async () => renderer.update(<PhoneSettings page={errorPage} />));
  expect(words()).toContain('permission denied');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel?.includes('permission denied')).length).toBeGreaterThan(0);
  await act(async () => renderer.unmount());
});

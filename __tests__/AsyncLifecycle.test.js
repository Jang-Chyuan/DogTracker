// 063 (audit R01–R06, R13; tests T01, T02): an answer that arrives after its
// page was left, its receiver or database replaced, or a newer read started
// never reaches the page; the operation itself still finishes.
// React 19 ignores a state update after unmount without a warning, so the
// unmount cases of T01/T02 check what is observable (the operation finishes,
// nothing rejects unhandled, the draft and the next page stay as they were);
// R02, R04 and R13 fail without their guards.
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import WifiSettings from '../src/settings/WifiSettings';
import { useReceiverWifi } from '../src/settings/useReceiverWifi';
import { useRecordingSwitch } from '../src/settings/useRecordingSwitch';
import { useMapHistory } from '../src/mapHistory/useMapHistory';
import LiveDataSettings from '../src/settings/LiveDataSettings';
import { openSystemSettings } from '../src/utils/systemSettings';

jest.mock('../src/locationTracker/useLiveLocation', () => ({ useLiveLocation: () => null }));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Renders `useHook(props)`; `result.current` is its latest answer. */
function renderHook(useHook, props) {
  const result = { current: null };
  function Probe(next) { result.current = useHook(next); return null; }
  let renderer;
  act(() => { renderer = Renderer.create(<Probe {...props} />); });
  return {
    result,
    rerender: next => act(() => renderer.update(<Probe {...next} />)),
    unmount: () => act(() => renderer.unmount()),
  };
}

let errors;
beforeEach(() => { errors = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

describe('T01 Wi-Fi settings', () => {
  const pressSend = renderer => renderer.root.findAllByProps({ testID: 'wifi-send' })
    .find(node => typeof node.props.onPress === 'function').props.onPress();

  test('a send still pending when the page is left finishes without touching the draft', async () => {
    const pending = deferred();
    const wifi = { connected: true, ssids: [], save: jest.fn(() => pending.promise) };
    const draft = { current: null };
    let renderer;
    await act(async () => { renderer = Renderer.create(<WifiSettings wifi={wifi} draft={draft} />); });
    const inputs = renderer.root.findAllByType(TextInput);
    await act(async () => { inputs[0].props.onChangeText('FieldNet'); inputs[1].props.onChangeText('secret123'); });
    let sending;
    await act(async () => { sending = pressSend(renderer); });
    expect(wifi.save).toHaveBeenCalledWith('FieldNet', 'secret123');
    await act(async () => renderer.unmount());
    await act(async () => { pending.resolve(); await sending; });
    expect(draft.current).toMatchObject({ ssid: 'FieldNet', password: 'secret123' });
  });

  test('a send that fails after the page was left shows nothing on the next page', async () => {
    const pending = deferred();
    const wifi = { connected: true, ssids: [], save: jest.fn(() => pending.promise) };
    let renderer;
    await act(async () => { renderer = Renderer.create(<WifiSettings wifi={wifi} />); });
    await act(async () => renderer.root.findAllByType(TextInput)[0].props.onChangeText('FieldNet'));
    let sending;
    await act(async () => { sending = pressSend(renderer); });
    await act(async () => renderer.unmount());
    let next;
    await act(async () => { next = Renderer.create(<WifiSettings wifi={wifi} />); });
    await act(async () => { pending.reject(new Error('逾時')); await sending; });
    expect(next.root.findAllByProps({ testID: 'wifi-result' })).toHaveLength(0);
    await act(async () => next.unmount());
  });

  test('a deletion that ends after the page was left settles quietly', async () => {
    const pending = deferred();
    const wifi = { connected: true, ssids: ['Home'], remove: jest.fn(() => pending.promise) };
    let renderer;
    await act(async () => { renderer = Renderer.create(<WifiSettings wifi={wifi} />); });
    await act(async () => renderer.root.findAllByProps({ testID: 'wifi-delete-Home' })
      .find(node => typeof node.props.onPress === 'function').props.onPress());
    const dialog = renderer.root.findAllByProps({ testID: 'wifi-delete-dialog' })[0];
    let removing;
    await act(async () => { removing = dialog.props.onConfirm(); });
    await act(async () => renderer.unmount());
    await act(async () => { pending.resolve(); await removing; });
    expect(wifi.remove).toHaveBeenCalledWith('Home');
  });
});

describe('R02 the receiver Wi-Fi list', () => {
  const service = () => {
    const pending = deferred();
    return { pending, configureWifi: jest.fn(() => pending.promise), removeWifi: jest.fn(() => pending.promise),
      getWifiList: jest.fn(async () => ({ ssids: ['Home'], activeSsid: 'Home' })) };
  };

  test('a save reads the list again while the same receiver is there', async () => {
    const live = service();
    const hook = renderHook(props => useReceiverWifi(props.service, { connected: true }), { service: live });
    let saving;
    act(() => { saving = hook.result.current.save('Home', 'pw'); });
    await act(async () => { live.pending.resolve(); await saving; });
    expect(live.getWifiList).toHaveBeenCalledTimes(1);
    expect(hook.result.current.ssids).toEqual(['Home']);
    hook.unmount();
  });

  test('a save that ends after the page was left reads nothing', async () => {
    const live = service();
    const hook = renderHook(props => useReceiverWifi(props.service, { connected: true }), { service: live });
    let saving;
    act(() => { saving = hook.result.current.save('Home', 'pw'); });
    hook.unmount();
    await act(async () => { live.pending.resolve(); await saving; });
    expect(live.getWifiList).not.toHaveBeenCalled();
  });

  test("an old receiver's save or deletion does not reach the new receiver's list", async () => {
    const old = service();
    const fresh = service();
    const hook = renderHook(props => useReceiverWifi(props.service, { connected: true }), { service: old });
    let saving, removing;
    act(() => { saving = hook.result.current.save('Home', 'pw'); removing = hook.result.current.remove('Home'); });
    hook.rerender({ service: fresh });
    await act(async () => { await hook.result.current.reload(); });
    await act(async () => { old.pending.resolve(); await saving; await removing; });
    expect(old.getWifiList).not.toHaveBeenCalled();
    expect(hook.result.current.ssids).toEqual(['Home']); // the new receiver's, not filtered by the old deletion
    hook.unmount();
  });
});

describe('T02 位置記錄 switch', () => {
  test('a start still pending when the page is left still completes', async () => {
    const pending = deferred();
    const recorder = { start: jest.fn(() => pending.promise), stop: jest.fn() };
    const hook = renderHook(props => useRecordingSwitch(false, props.recorder), { recorder });
    let toggling;
    act(() => { toggling = hook.result.current.toggle(true); });
    expect(hook.result.current.busy).toBe(true);
    hook.unmount();
    await act(async () => { pending.resolve(); await toggling; });
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  test('a failure after the page was left is dropped; on the page it is shown', async () => {
    const late = deferred();
    const recorder = { start: jest.fn(() => late.promise), stop: jest.fn(async () => { throw new Error('沒有權限'); }) };
    const hook = renderHook(props => useRecordingSwitch(false, props.recorder), { recorder });
    await act(async () => { await hook.result.current.toggle(false); });
    expect(hook.result.current.error).toBe('沒有權限');
    expect(hook.result.current.busy).toBe(false);
    let toggling;
    act(() => { toggling = hook.result.current.toggle(true); });
    hook.unmount();
    await act(async () => { late.reject(new Error('沒有權限')); await toggling; });
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  test('a second press while one runs is ignored, the next one after it works', async () => {
    const pending = deferred();
    const recorder = { start: jest.fn(() => pending.promise), stop: jest.fn(async () => {}) };
    const hook = renderHook(props => useRecordingSwitch(false, props.recorder), { recorder });
    let toggling;
    act(() => { toggling = hook.result.current.toggle(true); });
    await act(async () => { await hook.result.current.toggle(false); });
    expect(recorder.stop).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(); await toggling; });
    await act(async () => { await hook.result.current.toggle(false); });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});

describe('R04 history preferences save', () => {
  const database = (stored, save) => ({ load: jest.fn(async () => stored), save, listDevices: jest.fn(async () => []) });

  test("a save that ends after the database was replaced keeps the new database's preferences", async () => {
    const pending = deferred();
    const old = database({ source: 'ble', hours: 3 }, jest.fn(() => pending.promise));
    const fresh = database({ source: 'cloud', hours: 6 }, jest.fn());
    const hook = renderHook(props => useMapHistory(props.db, true, false, null), { db: old });
    await act(async () => {});
    let saving;
    act(() => { saving = hook.result.current.save({ hours: 12 }); });
    hook.rerender({ db: fresh });
    await act(async () => {});
    let stored;
    await act(async () => { pending.resolve({ source: 'ble', hours: 12 }); stored = await saving; });
    expect(stored).toBe(true);
    expect(hook.result.current.preferences).toEqual({ source: 'cloud', hours: 6 });
    expect(hook.result.current.busy).toBe(false);
    hook.unmount();
  });

  test('a save that ends after the history was closed is stored and settles quietly', async () => {
    const pending = deferred();
    const db = database({ source: 'ble' }, jest.fn(() => pending.promise));
    const hook = renderHook(props => useMapHistory(props.db, true, false, null), { db });
    await act(async () => {});
    let saving;
    act(() => { saving = hook.result.current.save({ hours: 12 }); });
    hook.unmount();
    await act(async () => { pending.reject(new Error('disk')); await expect(saving).resolves.toBe(false); });
    expect(db.save).toHaveBeenCalledTimes(1);
  });
});

describe('R13 即時資料 polling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('a slow read is never overlapped; the next one starts after it', async () => {
    const reads = [];
    const dogDatabase = { listHistory: jest.fn(() => { const read = deferred(); reads.push(read); return read.promise; }) };
    const profile = { tableColumns: ['dog'], historyLimit: 10, tableRefreshIntervalMs: 1000 };
    let renderer;
    await act(async () => { renderer = Renderer.create(<LiveDataSettings dogDatabase={dogDatabase} profile={profile} />); });
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(dogDatabase.listHistory).toHaveBeenCalledTimes(1);
    await act(async () => { reads[0].resolve([]); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(dogDatabase.listHistory).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
    await act(async () => { reads[1].resolve([]); jest.advanceTimersByTime(5000); });
    expect(dogDatabase.listHistory).toHaveBeenCalledTimes(2);
  });

  test('重試 while a read runs joins it instead of starting another', async () => {
    const reads = [];
    const dogDatabase = { listHistory: jest.fn(() => { const read = deferred(); reads.push(read); return read.promise; }) };
    const profile = { tableColumns: ['dog'], historyLimit: 10, tableRefreshIntervalMs: 1000 };
    let renderer;
    await act(async () => { renderer = Renderer.create(<LiveDataSettings dogDatabase={dogDatabase} profile={profile} />); });
    await act(async () => { reads[0].reject(new Error('busy')); });
    const retry = () => renderer.root.findAll(node => typeof node.props.onRetry === 'function')[0].props.onRetry();
    await act(async () => { jest.advanceTimersByTime(1000); }); // the timer's read starts
    expect(dogDatabase.listHistory).toHaveBeenCalledTimes(2);
    await act(async () => { retry(); retry(); });
    expect(dogDatabase.listHistory).toHaveBeenCalledTimes(2);
    await act(async () => { reads[1].resolve([]); });
    await act(async () => renderer.unmount());
  });
});

describe('R05 opening system settings', () => {
  test('falls back to the app settings and never rejects', async () => {
    const linking = { sendIntent: jest.fn(async () => { throw new Error('no activity'); }), openSettings: jest.fn(async () => {}) };
    await expect(openSystemSettings('android.settings.LOCATION_SOURCE_SETTINGS', linking)).resolves.toBe(true);
    expect(linking.openSettings).toHaveBeenCalledTimes(1);
    linking.openSettings.mockRejectedValueOnce(new Error('no settings'));
    await expect(openSystemSettings('x', linking)).resolves.toBe(false);
    await expect(openSystemSettings(null, { openSettings: async () => {} })).resolves.toBe(true);
  });
});

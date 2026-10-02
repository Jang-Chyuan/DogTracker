import {
  describeCloud,
  describeReceiver,
  formatClock,
  receiverName,
} from '../src/map/HomeStatus';

const NOW = new Date(2026, 9, 2, 9, 0).getTime();
const receiver = changes => ({
  enabled: true, running: true, connected: true, receiving: true,
  deviceName: 'DogGPS-Master7', lastReceivedAt: NOW - 12000, ...changes,
});

test('a past moment is written as its clock time, never as counting seconds', () => {
  expect(formatClock(new Date(2026, 9, 2, 8, 40).getTime())).toBe('08:40');
});

test('the receiver is named by the number at the end of its device name', () => {
  expect(receiverName('DogGPS-Master7')).toBe('接收器 7');
  expect(receiverName('DogGPS Master 12')).toBe('接收器 12');
  expect(receiverName('DogGPS Master')).toBe('接收器');
  expect(receiverName(undefined)).toBe('接收器');
});

test('a receiving receiver says nothing: only problems are shown', () => {
  expect(describeReceiver(receiver(), NOW).show).toBe(false);
});

test('connected but quiet is a warning, not a disconnection', () => {
  const state = describeReceiver(receiver({ lastReceivedAt: NOW - 45000 }), NOW);
  expect(state).toMatchObject({ show: true, tone: 'warn', label: '接收器 7｜已連線・無新資料', alert: null });
});

test('connected with a fresh timestamp but no data flowing is not healthy', () => {
  // Right after a reconnect the previous packet's time still looks recent.
  const state = describeReceiver(receiver({ receiving: false, lastReceivedAt: NOW - 3000 }), NOW);
  expect(state.tone).toBe('warn');
});

test('a dropped connection is a problem whose alert gives the clock time of the last packet', () => {
  const last = new Date(2026, 9, 2, 8, 40).getTime();
  const state = describeReceiver(receiver({ connected: false, receiving: false, lastReceivedAt: last }), NOW);
  expect(state).toMatchObject({ show: true, tone: 'crit', label: '接收器 7｜斷線' });
  expect(state.alert).toEqual({ title: '接收器 7 已斷線', detail: '最後收訊 08:40・會自動重連' });
});

test('first connection without any packet yet is not called a disconnection', () => {
  const state = describeReceiver(receiver({ connected: false, lastReceivedAt: 0 }), NOW);
  expect(state).toMatchObject({ show: true, tone: 'warn', label: '接收器 7｜連線中', alert: null });
});

test('a receiver the user never set up or stopped is shown as not connected, not as an error', () => {
  expect(describeReceiver(null, NOW)).toMatchObject({ show: true, tone: 'idle', label: '接收器｜未連接' });
  expect(describeReceiver(receiver({ enabled: false }), NOW).tone).toBe('idle');
});

test('an enabled receiver whose service died is a problem', () => {
  const state = describeReceiver(receiver({ running: false }), NOW);
  expect(state.tone).toBe('crit');
  expect(state.alert.title).toBe('接收器 7 已停止接收');
});

test('the cloud says nothing while it syncs, and only speaks up when it cannot', () => {
  expect(describeCloud({ ownerId: 'u', lastSuccess: NOW - 12000 }, NOW).show).toBe(false);
  expect(describeCloud({ ownerId: 'u', busy: true }, NOW).show).toBe(false);
  expect(describeCloud({ ownerId: 'u', error: 'timeout', lastSuccess: NOW }, NOW))
    .toEqual({ show: true, tone: 'warn', label: '雲端｜同步失敗' });
  expect(describeCloud({ ownerId: 'u', lastSuccess: new Date(2026, 9, 2, 8, 50).getTime() }, NOW))
    .toEqual({ show: true, tone: 'warn', label: '雲端｜最後同步 08:50' });
  expect(describeCloud({ ownerId: null }, NOW)).toEqual({ show: true, tone: 'idle', label: '雲端｜需登入' });
});

test('the receiver is named by its QR Master ID, or by its device name on an older build', () => {
  const { receiverNumber } = require('../src/map/HomeStatus');
  expect(receiverNumber({ expectedMasterId: 7, deviceName: 'DogGPS-Master3' })).toBe(7);
  expect(receiverNumber({ expectedMasterId: 0, deviceName: 'DogGPS-Master3' })).toBe(3);
  expect(receiverNumber({ deviceName: 'DogGPS Master' })).toBeNull();
  expect(receiverNumber(null)).toBeNull();
});

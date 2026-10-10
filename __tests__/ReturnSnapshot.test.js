// 058c: where an alert opens and how back returns (design v3 判定表「提醒入口
// （歷史畫面、設定頁）」「從 N3、通知、「⚠ N」打開的卡片怎麼關」「N3 之後的返回」
// 「從提醒打開的卡片按「看軌跡」」, flow 返回鍵).
import { closeAlertCard, isAlertReturn, keepsSnapshot, openAlertTarget, openTrackFrom }
  from '../src/alerts/ReturnSnapshot';
import { historySnapshot, usableSnapshot } from '../src/history/screen/HistoryScreenState';

const SETTINGS = new Set(['settings', 'receiver', 'alerts', 'diagnostics', 'cloud', 'phone']);
const history = { name: 'history', target: { subject: 'dog', slaveId: 6 } };
const snap = { key: 's1', day: 1, selection: { subject: 'dog', dogs: [{ id: 6, slot: 0 }], protagonist: 6 } };
const open = (stack, target, snapshot = null) => openAlertTarget(stack, target,
  { snapshot, settingsPages: SETTINGS, key: 7 });

// 「點了暫時切到即時地圖並照提醒對象打開（原畫面存成快照…）」: a dog → its card on the live map.
test('from the history: a dog card over a snapshot of the page', () => {
  const result = open([{ name: 'map' }, history], { screen: 'map', dogId: 4 }, snap);
  expect(result.dogId).toBe(4);
  expect(result.stack).toEqual([{ name: 'map' }, { ...history, restore: snap },
    { name: 'map', alertReturn: true, key: 7 }]);
  expect(isAlertReturn(result.stack[2])).toBe(true);
  // 「返回鍵、往下滑、點地圖空白處都一樣：回到原來的畫面並恢復快照」.
  expect(closeAlertCard(result.stack)).toEqual([{ name: 'map' }, { ...history, restore: snap }]);
});

// 「從 N3 提醒卡、通知或紅色「⚠ N」直接打開的…設定頁（含接收器頁、手機頁）→ 回到剛才的畫面」.
test('from the history or a settings page: a settings target opens over it', () => {
  const fromHistory = open([{ name: 'map' }, history], { screen: 'receiver-settings' }, snap);
  expect(fromHistory).toEqual({ dogId: null, stack: [{ name: 'map' }, { ...history, restore: snap },
    { name: 'receiver', alertReturn: true, key: 7 }] });
  const fromSettings = open([{ name: 'map' }, { name: 'settings' }, { name: 'alerts' }], { screen: 'diagnostics' });
  expect(fromSettings.stack.slice(-2)).toEqual([{ name: 'alerts' }, { name: 'diagnostics', alertReturn: true,
    key: 7 }]);
  const dogFromSettings = open([{ name: 'map' }, { name: 'settings' }], { screen: 'map', dogId: 5 });
  expect(dogFromSettings).toEqual({ dogId: 5, stack: [{ name: 'map' }, { name: 'settings' },
    { name: 'map', alertReturn: true, key: 7 }] });
});

// 058b as it was on the live map: a card on it, a page over it (back to the map); the guide etc. are left.
test('on the live map (or a page without a snapshot) nothing is kept', () => {
  expect(open([{ name: 'map' }], { screen: 'map', dogId: 4 })).toEqual({ stack: [{ name: 'map' }], dogId: 4 });
  expect(open([{ name: 'map' }], { screen: 'cloud-settings' }).stack).toEqual([{ name: 'map' }, { name: 'cloud' }]);
  expect(open([{ name: 'map' }, { name: 'pair' }], { screen: 'map', dogId: 4 }).stack).toEqual([{ name: 'map' }]);
  expect(keepsSnapshot({ name: 'pair' }, SETTINGS)).toBe(false);
});

// 空間不足 → 系統的儲存空間設定: the app's pages stay as they are.
test('system storage and unknown targets leave the stack', () => {
  const stack = [{ name: 'map' }, history];
  expect(open(stack, { screen: 'system-storage' })).toEqual({ stack, dogId: null });
  expect(open(stack, null)).toEqual({ stack, dogId: null });
  expect(open(stack, { screen: 'map' })).toEqual({ stack, dogId: null });
});

// A second alert while the card from the first is open: the card changes, the snapshot stays.
test('another alert over an alert card', () => {
  const first = open([{ name: 'map' }, history], { screen: 'map', dogId: 4 }, snap).stack;
  expect(open(first, { screen: 'map', dogId: 5 })).toEqual({ stack: first, dogId: 5 });
  expect(open(first, { screen: 'receiver-settings' }).stack.at(-1)).toEqual({ name: 'receiver', alertReturn: true,
    key: 7 });
});

// 「從提醒打開的卡片按「看軌跡」→ 當成換一件事：丟掉原本的快照…之後返回鍵或「‹ 回到現在」都回即時地圖」.
test('看軌跡 from an alert card drops the snapshot; from an ordinary card it returns to the card', () => {
  const first = open([{ name: 'map' }, history], { screen: 'map', dogId: 4 }, snap).stack;
  const target = { subject: 'dog', slaveId: 4 };
  expect(openTrackFrom(first, target)).toEqual({ fromCard: false,
    stack: [{ name: 'map' }, { name: 'history', target }] });
  expect(openTrackFrom([{ name: 'map' }], target)).toEqual({ fromCard: true,
    stack: [{ name: 'map' }, { name: 'history', target }] });
});

// A card closing elsewhere (no alert) changes nothing.
test('closing an ordinary card keeps the stack', () => {
  const stack = [{ name: 'map' }];
  expect(closeAlertCard(stack)).toBe(stack);
});

// flow 返回鍵「歷史的範圍、游標、加入的狗都保留」: day, dogs (slots, protagonist), cursor.
test('the history snapshot keeps the day, the dogs and the cursor', () => {
  const selection = { key: 'session', subject: 'dog', protagonist: 4, rangeOwner: 6, kept: null, message: 'x',
    dogs: [{ id: 6, slot: 0, hasData: true }, { id: 4, slot: 1, hasData: true }] };
  const saved = historySnapshot({ day: 100, selection, cursorTime: 5000, inGap: true }, 42);
  expect(saved).toEqual({ key: '42', day: 100, cursorTime: 5000, inGap: true,
    selection: { subject: 'dog', protagonist: 4, rangeOwner: 6, kept: null, message: null,
      dogs: [{ id: 6, slot: 0, hasData: true }, { id: 4, slot: 1, hasData: true }] } });
  // Detached from the screen's state and JSON-safe.
  selection.dogs[0].id = 9;
  expect(saved.selection.dogs[0].id).toBe(6);
  expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
  // The cursor following the newest fix stays following.
  expect(historySnapshot({ day: 100, selection, cursorTime: null, inGap: true }, 1)).toMatchObject({ cursorTime: null,
    inGap: false });
});

test('a snapshot is used only for the same subject', () => {
  const saved = historySnapshot({ day: 100, selection: { subject: 'dog', dogs: [{ id: 6, slot: 0 }],
    protagonist: 6 } }, 1);
  expect(usableSnapshot(saved, { subject: 'dog', entryId: 6 })).toBe(saved);
  expect(usableSnapshot(saved, { subject: 'phone', entryId: 'phone' })).toBeNull();
  expect(usableSnapshot(null, { subject: 'dog', entryId: 6 })).toBeNull();
  expect(usableSnapshot({ ...saved, day: null }, { subject: 'dog', entryId: 6 })).toBeNull();
});

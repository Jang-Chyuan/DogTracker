// Where an alert opens and how back returns (design v3 判定表「提醒入口（歷史
// 畫面、設定頁）」「從 N3、通知、「⚠ N」打開的卡片怎麼關」「N3 之後的返回」
// 「從提醒打開的卡片按「看軌跡」」, flow 返回鍵「從 N3 提醒卡、通知或紅色
// 「⚠ N」直接打開的卡片或設定頁」). Pure: works on App's page stack
// ([{ name, ... }], newest last).
//
// - From the history screen (a dog's or my route) or a settings page, an
//   alert's target opens over it and the page is kept as it was (the
//   snapshot): a dog's card on the live map (a 'map' page marked
//   `alertReturn`), or the settings page (S2 接收器, S8 診斷) marked the same.
//   The history page keeps its day, range, cursor and added dogs (`restore`).
// - Back, swiping the card down or tapping the empty map closes that card
//   and returns to the page under it; so does back (or 「‹ 標題」) on the
//   settings page. 活動量 and 編輯 opened from the card keep the snapshot.
// - 看軌跡 on that card is a new errand: the snapshot is dropped and the dog's
//   history opens over the live map (back there goes to the live map).
// - On the live map itself nothing is kept: a dog's card opens on it, a page
//   opens over it (back returns to the map).

// The pages a settings target opens.
export const TARGET_PAGES = Object.freeze({
  'receiver-settings': 'receiver',
  diagnostics: 'diagnostics',
  'cloud-settings': 'cloud',
});

/** Whether `route` keeps a snapshot under it (history or a settings page). */
export function keepsSnapshot(route, settingsPages) {
  return !!route && (route.name === 'history' || settingsPages.has(route.name));
}

/** A dog's card (or a page) opened from an alert over a kept page. */
export const isAlertReturn = route => !!route?.alertReturn;

/**
 * The stack after an alert's `target` (AlertContent.alertTarget, or a
 * notification's destination) is opened from the page on top.
 * `snapshot` is the history screen's state (useHistoryScreen.snapshot) when
 * the top is the history page. Returns { stack, dogId } — dogId: the card to
 * open on the live map (null for none).
 * - 'system-storage' leaves the app for Android's storage settings: the
 *   stack stays.
 * - over the live map (or anything that keeps no snapshot): a dog's card
 *   opens on the live map (other pages closed), a settings page over the map.
 */
export function openAlertTarget(stack, target, { snapshot = null, settingsPages, key = 0 } = {}) {
  const list = Array.isArray(stack) && stack.length ? stack : [{ name: 'map' }];
  const top = list[list.length - 1];
  const dogId = target?.screen === 'map' && target.dogId != null ? target.dogId : null;
  const page = TARGET_PAGES[target?.screen] ?? null;
  if (!target || target.screen === 'system-storage' || (!page && dogId == null)) return { stack: list, dogId: null };
  // Already on a card opened from an alert: another dog's card replaces it
  // (the snapshot under it stays); a page opens over it.
  if (isAlertReturn(top) && top.name === 'map') {
    return dogId != null ? { stack: list, dogId } : { stack: [...list, { name: page, alertReturn: true, key }], dogId: null };
  }
  if (!keepsSnapshot(top, settingsPages)) {
    return dogId != null ? { stack: [{ name: 'map' }], dogId }
      : { stack: [{ name: 'map' }, { name: page }], dogId: null };
  }
  const kept = top.name === 'history' && snapshot ? { ...top, restore: snapshot } : top;
  const opened = dogId != null ? { name: 'map', alertReturn: true, key } : { name: page, alertReturn: true, key };
  return { stack: [...list.slice(0, -1), kept, opened], dogId };
}

/** The card from an alert closed (back, swiped down, empty map): the page under it. */
export function closeAlertCard(stack) {
  const top = stack[stack.length - 1];
  return isAlertReturn(top) && top.name === 'map' && stack.length > 1 ? stack.slice(0, -1) : stack;
}

/**
 * 看軌跡 on a card: the dog's (or my route's) history over the live map.
 * From a card opened by an alert the snapshot is dropped and back goes to the
 * live map (`fromCard` false); from an ordinary card back reopens that card.
 */
export function openTrackFrom(stack, target) {
  const top = stack[stack.length - 1];
  const fromAlert = isAlertReturn(top);
  return {
    stack: fromAlert ? [{ name: 'map' }, { name: 'history', target }] : [...stack, { name: 'history', target }],
    fromCard: !fromAlert,
  };
}

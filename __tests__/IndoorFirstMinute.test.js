// 2026-10-15: an indoor hold's first minute read 「室內・0 分」 on the history
// list and the cursor; like a stay (「停 不到 1 分」) they say 「室內・不到 1 分」
// (c1276). (The live card no longer times a stay, 2026-10-16.)
import { t as i18nT } from '../src/i18n';
import { nodePill } from '../src/history/HistoryText';
import { cursorLabel } from '../src/history/screen';

const MINUTE = 60000;
const LESS = i18nT('c1276');

test('the list: an indoor capsule under half a minute is 在遮蔽處 不到 1 分', () => {
  expect(nodePill({ type: 'indoor', start: 0, end: 20000 }).text).toBe(`在遮蔽處 ${LESS}`);
  expect(nodePill({ type: 'indoor', start: 0, end: 10 * MINUTE, displayDurationMs: 0 }).text).toBe(`在遮蔽處 ${LESS}`);
  expect(nodePill({ type: 'indoor', start: 0, end: 10 * MINUTE }).text).toBe('在遮蔽處 10 分');
});

test('the cursor: 遮蔽處・不到 1 分 in the first minute', () => {
  const model = { points: [0, 1, 2].map(n => ({ time: n * 10000 })), sections: [],
    locations: [{ type: 'indoor', start: 0, end: 20000 }] };
  expect(cursorLabel(model, 10000)[1]).toBe(`遮蔽處・${LESS}`);
});

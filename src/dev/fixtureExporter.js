// The export of a screen fixture (056): the real native exporter (files in
// this phone's cache, Android's share sheet) with one step changed, for the
// states an emulator cannot reach on its own — 'hang': 產生中 never ends
// (the back key or 取消 stops it); 'fail': every export fails (匯出失敗　重試);
// 'fail-once': the first export fails, 重試 works.
import { nativeExporter } from '../mapHistory/ExportNative';

export function fixtureExporter(mode, real = nativeExporter()) {
  if (!real) return null;
  let failures = mode === 'fail-once' ? 1 : mode === 'fail' ? Infinity : 0;
  const step = run => (...args) => {
    if (mode === 'hang') return new Promise(() => {});
    if (failures > 0) { failures -= 1; return Promise.reject(new Error('情境：匯出失敗')); }
    return run(...args);
  };
  return { ...real, writeText: step(real.writeText), renderPng: step(real.renderPng) };
}

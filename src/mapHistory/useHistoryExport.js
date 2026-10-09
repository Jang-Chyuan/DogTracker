import { logger } from '../logger';
// The export of the history screen (H9/H10; 判定表「匯出產生中」, flow.txt
// 「匯出」): the small window's state, one export at a time from the moment a
// format is chosen — the day shown (range, dogs) captured then, the
// places' addresses asked for at most 5 s (none offline), the file(s) made
// by the native exporter, then Android's share sheet. 取消 (and the back
// key) drops a running export; 重試 makes the files again from the same
// snapshot. Temporary files go the next day.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AddressLookupContext } from '../placement/AddressLookup';
import { buildCSV } from './ExportCSV';
import { buildGPX } from './ExportGPX';
import { buildPNGLayout } from './ExportPNG';
import { measuredCharacters, pngDrawPages, widthMeasure } from './ExportDraw';
import { buildExportFilename, buildTempFile, shouldCleanupExport } from './ExportFiles';
import { activeSubjects } from './ExportData';
import { buildExportSnapshot, exportPlaces, placeKey } from './ExportSnapshot';

export const EXPORT_FORMATS = [
  { id: 'png', title: 'PNG 長圖', detail: '地圖＋時間軸清單' },
  { id: 'gpx', title: 'GPX', detail: '軌跡檔，可匯入地圖 App' },
  { id: 'csv', title: 'CSV', detail: '每一筆位置' },
];
export const EXPORT_MIME = { png: 'image/png', gpx: 'application/gpx+xml', csv: 'text/csv' };

/**
 * Makes the files of `format` from `snapshot` with `exporter` (the native
 * module's adapter). `alive()` false stops between steps. Returns the paths.
 */
export async function makeExportFiles(snapshot, format, exporter, { exportId, createdAt, alive = () => true }) {
  if (!activeSubjects(snapshot).length) throw new Error('這段時間沒有紀錄');
  const where = page => buildTempFile(snapshot, format, { createdAt, exportId, page });
  if (format === 'csv' || format === 'gpx') {
    const text = format === 'csv' ? buildCSV(snapshot) : buildGPX(snapshot);
    const file = where(null);
    return [await exporter.writeText(file.directory, file.filename, text)];
  }
  const widths = await exporter.charWidths(measuredCharacters(snapshot));
  if (!alive()) return [];
  const layout = buildPNGLayout(snapshot, { measureText: widthMeasure(widths) });
  const pages = pngDrawPages(layout);
  const directory = where(null).directory;
  const named = pages.map((page, index) => ({ ...page,
    filename: buildExportFilename(snapshot, 'png', pages.length > 1 ? index + 1 : null) }));
  return exporter.renderPng(exportId, directory, named);
}

/** Temporary exports made before today go (隔天清掉); a failure here never stops an export. */
export async function cleanExports(exporter, now) {
  try {
    const list = await exporter.listExports();
    const old = (list || []).filter(entry => shouldCleanupExport({ createdAt: entry.createdAt }, now))
      .map(entry => entry.directory);
    if (old.length) await exporter.removeExports(old);
  } catch { /* the cache is the system's to clear too */ }
}

/**
 * `screen`: useHistoryScreen's (dayModel, range, subject, look). `exporter`:
 * ExportNative's (or a fixture's). `initial`: a screen fixture opens on a state.
 * Returns { open, phase: 'closed' | 'choose' | 'generating' | 'failed',
 *   format, title, start(format), cancel(), retry(), close(), back() }.
 */
export function useHistoryExport({ screen, exporter, now = Date.now,
  initial = null }) {
  const lookup = useContext(AddressLookupContext);
  const [state, setState] = useState(() => initial ? { phase: initial.phase, format: initial.format ?? 'png' }
    : { phase: 'closed', format: null });
  const run = useRef(0);
  const prepared = useRef(null);
  const exporting = useRef(null);
  /** Drops the running export at once (its result, if any, is never shared). */
  const stop = useCallback(() => {
    run.current += 1;
    if (exporting.current) exporter?.cancel?.(exporting.current);
    exporting.current = null;
    // The export icon is back at once, while the window still slides away.
    setState(current => (current.phase === 'generating' ? { ...current, stopped: true } : current));
  }, [exporter]);
  const close = useCallback(() => {
    stop();
    prepared.current = null;
    setState({ phase: 'closed', format: null });
  }, [stop]);
  // Leaving the history stops an export still running.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current(), []);
  const open = useCallback(() => {
    prepared.current = null;
    setState({ phase: 'choose', format: null });
  }, []);
  const generate = useCallback(async (format, snapshotReady) => {
    const id = ++run.current;
    const alive = () => run.current === id;
    setState({ phase: 'generating', format });
    try {
      if (!exporter) throw new Error('請安裝支援匯出的 Android 版本');
      let snapshot = snapshotReady;
      if (!snapshot) {
        // 按下那一刻的資料: the day, range and dogs now; the addresses next.
        const day = screen.dayModel, range = screen.range, look = screen.look, subject = screen.subject;
        if (!day || !range) throw new Error('請等待歷史資料載入');
        const places = day.subjects.flatMap(entry => exportPlaces(entry.model));
        // 有網路時地址最多等 5 秒; offline none (lookupAddresses decides).
        const found = places.length ? await lookup.lookupAddresses(places, { timeoutMs: 5000 }) : [];
        if (!alive()) return;
        const addresses = {};
        places.forEach((place, index) => { if (found[index]) addresses[placeKey(place)] = found[index]; });
        snapshot = buildExportSnapshot({ day, range, subject, look, addresses });
        prepared.current = { snapshot, format };
      }
      const createdAt = now();
      await cleanExports(exporter, createdAt);
      if (!alive()) return;
      const exportId = `${createdAt}-${id}`;
      exporting.current = exportId;
      const paths = await makeExportFiles(snapshot, format, exporter, { exportId, createdAt, alive });
      if (!alive()) return;
      if (exporting.current === exportId) exporting.current = null;
      // 打開 Android 分享時才關掉小視窗.
      await exporter.share(paths, EXPORT_MIME[format]);
      if (!alive()) return;
      prepared.current = null;
      setState({ phase: 'closed', format: null });
    } catch (error) {
      if (!alive()) return;
      logger.warn('[History export]', error?.message || error);
      setState({ phase: 'failed', format });
    }
  }, [exporter, screen, lookup, now]);
  const start = useCallback(format => generate(format, null), [generate]);
  /** 重試: the same snapshot (判定表「匯出快照和停在原處」). */
  const retry = useCallback(() => {
    if (!state.format) return;
    generate(state.format, prepared.current?.format === state.format ? prepared.current.snapshot : null);
  }, [generate, state.format]);
  /** 返回鍵: 產生中＝取消; the window closes. False when nothing was open. */
  const back = useCallback(() => {
    if (state.phase === 'closed') return false;
    close();
    return true;
  }, [state.phase, close]);
  const range = screen.range;
  return { ...state, open, start, stop, cancel: close, retry, close, back,
    generating: state.phase === 'generating' && !state.stopped, range };
}

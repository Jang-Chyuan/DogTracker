import { t } from '../i18n';
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
  { id: 'png', title: t('c161'), detail: t('c162') },
  { id: 'gpx', title: t('c164'), detail: t('c165') },
  { id: 'csv', title: t('c166'), detail: t('c167') },
];
export const EXPORT_MIME = { png: 'image/png', gpx: 'application/gpx+xml', csv: 'text/csv' };

/**
 * Makes the files of `format` from `snapshot` with `exporter` (the native
 * module's adapter). `alive()` false stops between steps. Returns the paths.
 */
export async function makeExportFiles(snapshot, format, exporter, { exportId, createdAt, alive = () => true }) {
  if (!activeSubjects(snapshot).length) throw new Error(t('c318'));
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
  initial = null, onSaved = null }) {
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
  // `destination`: 'share' (Android's share sheet) or 'download' (「存到下載」,
  // 067: Download/DogTracker/, then onSaved({ files, mime }) for the tip).
  const generate = useCallback(async (format, snapshotReady, destination = 'share') => {
    const id = ++run.current;
    const alive = () => run.current === id;
    setState({ phase: 'generating', format, destination });
    let directory;
    let shared = false;
    try {
      if (!exporter) throw new Error(t("c844"));
      let snapshot = snapshotReady;
      if (!snapshot) {
        // 按下那一刻的資料: the day, range and dogs now; the addresses next.
        const day = screen.dayModel, range = screen.range, look = screen.look, subject = screen.subject;
        if (!day || !range) throw new Error(t("c797"));
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
      directory = `history_exports/${exportId}`;
      exporting.current = exportId;
      const paths = await makeExportFiles(snapshot, format, exporter, { exportId, createdAt, alive });
      if (!alive()) return;
      if (exporting.current === exportId) exporting.current = null;
      if (destination === 'download') {
        // The copies in Download/DogTracker/ are the phone's; the temporary
        // files go (finally) as after a share that was not made.
        const saved = await exporter.saveToDownloads(paths, EXPORT_MIME[format]);
        // Once the copy has begun it finishes (the system picker or MediaStore
        // cannot be called back): the tip says where it went even if the
        // window was closed meanwhile (Codex review, 067).
        if (saved?.files?.length) onSaved?.({ files: saved.files, mime: EXPORT_MIME[format] });
        if (!alive()) return;
        prepared.current = null;
        setState({ phase: 'closed', format: null });
        return;
      }
      // 打開 Android 分享時才關掉小視窗.
      const result = await exporter.share(paths, EXPORT_MIME[format]);
      shared = result !== 'cancelled';
      if (!alive()) return;
      prepared.current = null;
      setState({ phase: 'closed', format: null });
    } catch (error) {
      if (!alive()) return;
      logger.warn('[History export]', error?.message || error);
      setState({ phase: 'failed', format, destination });
    } finally {
      if (directory && !shared) {
        try { await exporter.removeExports([directory]); } catch { /* startup and daily cleanup retry */ }
      }
    }
  }, [exporter, screen, lookup, now, onSaved]);
  const start = useCallback(format => generate(format, null), [generate]);
  /** 「存到下載」: the same files, saved to Download/DogTracker/ (067). */
  const save = useCallback(format => generate(format, null, 'download'), [generate]);
  /** 重試: the same snapshot (判定表「匯出快照和停在原處」) and destination. */
  const retry = useCallback(() => {
    if (!state.format) return;
    generate(state.format, prepared.current?.format === state.format ? prepared.current.snapshot : null,
      state.destination ?? 'share');
  }, [generate, state.format, state.destination]);
  /** 返回鍵: 產生中＝取消; the window closes. False when nothing was open. */
  const back = useCallback(() => {
    if (state.phase === 'closed') return false;
    close();
    return true;
  }, [state.phase, close]);
  const range = screen.range;
  return { ...state, open, start, save, stop, cancel: close, retry, close, back,
    canSave: !!exporter?.saveToDownloads,
    generating: state.phase === 'generating' && !state.stopped, range };
}

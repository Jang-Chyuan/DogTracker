import { useCallback, useRef, useState } from 'react';
import { getCloudClient } from '../cloud/CloudClient';
import { downloadCloudHistory } from '../cloud/CloudDownload';

/**
 * Downloads the range the history card is asking for.
 *
 * A day the cloud holds but the phone has not downloaded used to mean leaving
 * the card, finding 設定 → 雲端資料, typing the same dates, coming back and
 * querying again. These are the same rows the cloud page downloads, written by
 * the same writer through the same exclusive slot, so the card can just fetch
 * them itself.
 *
 * One request per chosen Master: the downloader takes a single Master, and
 * asking for "all of them" would drag down Masters the user did not pick.
 */
export function useHistoryDownload({ database, sync, owner, clientFactory = getCloudClient }) {
  const [state, setState] = useState({ busy: false, message: '' });
  const controller = useRef(null);
  const running = useRef(false);
  const cancel = useCallback(() => controller.current?.abort(), []);
  const run = useCallback(async ({ startAt, endAt, masters = [] }) => {
    if (!database || !owner || running.current) return 0;
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return 0;
    let client;
    try { client = clientFactory(); }
    catch { setState({ busy: false, message: '雲端登入設定無法載入' }); return 0; }
    const abort = new AbortController();
    controller.current = abort;
    running.current = true;
    setState({ busy: true, message: '這段時間本機沒有資料，正在從雲端下載…' });
    let processed = 0;
    try {
      await database.initialize();
      for (const masterId of masters.length ? masters : [null]) {
        const work = leaseCurrent => downloadCloudHistory({
          client,
          database,
          owner,
          startAt: new Date(startAt).toISOString(),
          endBefore: new Date(endAt).toISOString(),
          masterId,
          signal: abort.signal,
          isCurrent: () => !abort.signal.aborted && leaseCurrent(),
          onProgress: value => setState({
            busy: true, message: `正在從雲端下載…已處理 ${processed + value} 筆`,
          }),
        });
        // The automatic sync owns the network/write slot; borrowing it is what
        // keeps a manual download from racing the every-30-second one.
        processed += await (sync ? sync.runManual(work, abort) : work(() => true));
      }
      setState({ busy: false, message: processed
        ? `下載完成：${processed} 筆，地圖會在下次讀取時帶出來。`
        : '雲端這段時間沒有這幾台 Master 的資料。' });
    } catch {
      setState({ busy: false,
        message: '下載已停止；已完成的部分留著，可以再套用一次重試。' });
    } finally {
      running.current = false;
      controller.current = null;
    }
    return processed;
  }, [database, sync, owner, clientFactory]);
  return { ...state, run, cancel };
}

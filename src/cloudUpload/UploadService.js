import { bleUploadPayload } from './BleUploadPayload';
export function createUploadService({ database, client }) {
  let busy = false;
  return {
    async run(owner, alive = () => true) {
      if (busy || !owner || !alive()) return;
      busy = true;
      try {
        const phone = await database.identity();
        if (!phone) throw new Error('手機識別尚未建立');
        for (const row of await database.pending(owner, Date.now())) {
          if (!alive()) break;
          // Recheck both login and fixed route before each event, including after a mode change.
          const { data, error: sessionError } = await client.auth.getSession();
          if (sessionError || data.session?.user.id !== owner || !alive()) break;
          const settings = await database.settings(owner);
          if (!alive()) break;
          if (!settings.some(s => s.master_id === row.master_id && s.mode === 'phone')) continue;
          let body;
          try { body = bleUploadPayload(row, phone); }
          catch (error) { await database.failed(row, error.message, true, Date.now()); continue; }
          try {
            const result = await client.functions.invoke('ingest-phone-telemetry', { body, timeout: 15000,
              headers: { Authorization: `Bearer ${data.session.access_token}` } });
            if (result.error) {
              const status = result.error.context?.status;
              await database.failed(row, `上傳失敗${status ? ` (${status})` : ''}：${result.error.message}`,
                [400, 403, 409, 413, 422].includes(status), Date.now());
              if (status === 401 || !status || status >= 500 || status === 429) break;
            } else if (result.data?.ok === true && result.data.event_id === row.event_id) {
              await database.sent(row);
            } else {
              await database.failed(row, '雲端回覆未確認事件，稍後重試', false, Date.now()); break;
            }
          } catch (error) {
            await database.failed(row, error.message || '網路連線失敗', false, Date.now()); break;
          }
        }
      } finally { busy = false; }
    },
  };
}

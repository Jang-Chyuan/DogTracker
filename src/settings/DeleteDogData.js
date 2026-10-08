import { useCallback, useEffect, useRef, useState } from 'react';
import { UnsentRowsError } from '../database/DogDataStore';

// 設定 → 進階 → 刪除全部狗資料 (design S7; 判定表「刪除全部狗資料」「刪除全部狗資料
// 時選「先上傳」但沒網路」; 文案 c296). The confirmation says what goes and what
// stays; with rows not uploaded yet it asks 「先上傳／一起刪除」 first.

export const DELETE_TITLE = '刪除全部狗資料？';
export const DELETE_BODY = '只刪這支手機裡的狗位置紀錄和下載紀錄。雲端、手機路線、狗的名字和頭像都不會動；'
  + '雲端有的資料，之後看歷史時可以再下載。';
// c296
export const unsentQuestion = count => `還有 ${count} 筆沒上傳：先上傳／一起刪除`;
export const OFFLINE_PROBLEM = '沒有網路，現在不能上傳。連上網路後再試，或選「一起刪除」';

/** Why 「先上傳」 left rows behind (nothing was deleted). */
export function uploadProblem(result, remaining) {
  if (result === 'offline') return OFFLINE_PROBLEM;
  if (result === 'signed-out') return '沒有登入 Supabase，現在不能上傳。登入後再試，或選「一起刪除」';
  if (result === 'unauthorized') return '需要重新登入才能上傳。登入後再試，或選「一起刪除」';
  return `還有 ${remaining} 筆沒上傳完，請再試一次，或選「一起刪除」`;
}

/**
 * What the dialog shows for a state of the flow: { visible, title, body,
 * note, problem, confirm, secondary: label | null, busy, uploading }.
 * state: { open, phase: 'counting' | 'ask' | 'uploading' | 'deleting',
 * unsent, problem }.
 */
export function deleteDialog(state) {
  const unsent = state?.unsent || 0;
  return {
    visible: !!state?.open,
    title: DELETE_TITLE,
    body: DELETE_BODY,
    note: unsent > 0 ? unsentQuestion(unsent) : null,
    problem: state?.problem || null,
    confirm: unsent > 0 ? '一起刪除' : '刪除',
    secondary: unsent > 0 ? '先上傳' : null,
    busy: state?.phase === 'deleting' || state?.phase === 'counting',
    uploading: state?.phase === 'uploading',
  };
}

const CLOSED = { open: false, phase: 'ask', unsent: 0, problem: null };

/**
 * The flow: `actions` = { countUnsent() → number, uploadAll() → result
 * (useCloudUpload.flushAll), deleteAll({ includeUnsent }), onDeleted() }.
 * A fixture hands in its own (nothing is written); `initial` opens the
 * dialog at once with that many rows not uploaded (a fixture's).
 */
export function useDeleteDogData(actions, initial = null, initialKey = null) {
  const [state, setState] = useState(() => (initial ? { ...CLOSED, open: true, unsent: initial.unsent || 0 }
    : CLOSED));
  const current = useRef(actions);
  current.current = actions;
  const mounted = useRef(true);
  // Bumped when the dialog closes or opens again: a 「先上傳」 still running
  // then never deletes.
  const run = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const set = useCallback(next => { if (mounted.current) setState(next); }, []);
  // Another fixture (initialKey) opens with its own dialog, or none.
  const first = useRef(true);
  const initialUnsent = initial ? initial.unsent || 0 : null;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    run.current += 1;
    set(initialUnsent == null ? CLOSED : { ...CLOSED, open: true, unsent: initialUnsent });
  }, [initialKey, initialUnsent, set]);
  // A 「先上傳」 still sending (it stops at the next row once its run is
  // over); a deletion waits for it, so no row goes up after it was deleted.
  const uploading = useRef(null);
  const remove = useCallback(async includeUnsent => {
    set(previous => ({ ...previous, phase: 'deleting', problem: null }));
    try {
      await uploading.current?.catch(() => {});
      await current.current.deleteAll({ includeUnsent });
      set(CLOSED);
      await current.current.onDeleted?.();
    } catch (error) {
      // Rows were queued meanwhile: ask about them first.
      if (error instanceof UnsentRowsError || error?.name === 'UnsentRowsError') {
        set(previous => ({ ...previous, phase: 'ask', unsent: error.count, problem: null }));
      } else {
        set(previous => ({ ...previous, phase: 'ask',
          problem: `刪除失敗：${error?.message || '請再試一次'}，請再試一次` }));
      }
    }
  }, [set]);
  return {
    state,
    dialog: deleteDialog(state),
    async start() {
      const id = run.current + 1;
      run.current = id;
      set({ ...CLOSED, open: true, phase: 'counting' });
      try {
        const unsent = await current.current.countUnsent();
        // Closed or opened again meanwhile: this count is not the dialog's.
        if (id === run.current) set(previous => ({ ...previous, phase: 'ask', unsent: Number(unsent) || 0 }));
      } catch (error) {
        if (id === run.current) {
          set(previous => ({ ...previous, phase: 'ask', problem: `讀不到還沒上傳的筆數：${error?.message || ''}` }));
        }
      }
    },
    cancel() {
      if (state.phase === 'deleting') return;
      run.current += 1;
      set(CLOSED);
    },
    /** 「先上傳」: send what waits, then delete when nothing is left. */
    async uploadFirst() {
      const id = run.current;
      set(previous => ({ ...previous, phase: 'uploading', problem: null }));
      let result = 'failed';
      // The upload stops once this run is over (closed, reopened, unmounted).
      const alive = () => mounted.current && id === run.current;
      const sending = Promise.resolve().then(() => current.current.uploadAll(alive));
      uploading.current = sending;
      try { result = await sending; } catch { result = 'failed'; }
      finally { if (uploading.current === sending) uploading.current = null; }
      let remaining;
      try { remaining = Number(await current.current.countUnsent()) || 0; }
      catch { remaining = state.unsent; }
      if (id !== run.current) return;
      if (remaining === 0) {
        await remove(false);
        return;
      }
      set(previous => ({ ...previous, phase: 'ask', unsent: remaining,
        problem: uploadProblem(result === 'done' ? 'failed' : result, remaining) }));
    },
    /** 「刪除」, or 「一起刪除」 with rows not uploaded yet. */
    confirm() {
      return remove(state.unsent > 0);
    },
  };
}

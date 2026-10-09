import { t } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UnsentRowsError } from '../database/DogDataStore';

// 設定 → 進階 → 刪除全部狗資料 (design S7; 判定表「刪除全部狗資料」「刪除全部狗資料
// 時選「先上傳」但沒網路」; 文案 c296). The confirmation says what goes and what
// stays; with rows not uploaded yet it asks 「先上傳／一起刪除」 first.

export const DELETE_TITLE = t("c951");
export const DELETE_BODY = t("c910");
// c296
export const unsentQuestion = count => t('c296', { count: count });
export const OFFLINE_PROBLEM = t("c952");

/** Why 「先上傳」 left rows behind (nothing was deleted). */
export function uploadProblem(result, remaining) {
  if (result === 'offline') return OFFLINE_PROBLEM;
  if (result === 'signed-out') return t("c955");
  if (result === 'unauthorized') return t("c956");
  return t("c957", { remaining: remaining });
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
    confirm: unsent > 0 ? t("c948") : t("c949"),
    secondary: unsent > 0 ? t("c950") : null,
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
          problem: t("c953", { value: error?.message || t("c545") }) }));
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
          set(previous => ({ ...previous, phase: 'ask', problem: t("c954", { value: error?.message || '' }) }));
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

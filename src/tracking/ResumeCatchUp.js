// Coming back to the app (070): the map says 「正在更新狗的位置」 while the
// tracking feed reads everything the Kotlin service wrote while the app was
// away, and the dogs keep the colours the user left them with, dimmed
// (opacity.catchingUp), until that read is through.
//
// Only a return counts. A cold start and an ordinary load have their own
// screens (the launch screen, the skeletons); nothing here shows before the
// feed has caught up once in this session.
//
// The rules:
// - The app goes away: the catch-up is cancelled and the moment is kept. It is
//   the clock the dogs' freshness is judged against while catching up, so a
//   dog the user saw in colour cannot turn grey on data not yet read, and one
//   that was already grey stays grey.
// - Back in the foreground: 正在更新狗的位置, until the feed reports it is
//   caught up (`caughtUp`), or the read fails (`failed`), or 20 s pass.
// - A failure is 「更新失敗」 with 重試; 重試 starts the catch-up over (the
//   caller restarts the feed, which drops the callbacks of the read that
//   failed, so a late answer from it cannot end the new attempt).
// - A failure clears itself when a later read gets through (a one-off read
//   error while the feed keeps polling is not worth a stuck 更新失敗; 070
//   device check). Retry stays for a read that keeps failing.
// Pure: no React, no SQLite, no AppState of its own.

/** 正在更新狗的位置 for longer than this is 更新失敗 (with 重試). */
export const CATCH_UP_TIMEOUT_MS = 20000;

export const CATCH_UP_IDLE = Object.freeze({ phase: 'idle', since: null });

/**
 * @param options.onChange called with each new { phase, since }: 'idle' (no
 *   pill, dogs as they are), 'catching-up' or 'failed'. `since` is the moment
 *   the app went away, the clock the dogs are judged against meanwhile.
 * @param options.onRetry 重試: restart the feed (the caller owns it).
 * @param options.now injectable clock; options.timers injectable timers.
 */
export function createResumeCatchUp({
  onChange,
  onRetry,
  now = Date.now,
  timers = { setTimeout, clearTimeout },
  timeoutMs = CATCH_UP_TIMEOUT_MS,
} = {}) {
  let state = CATCH_UP_IDLE;
  // Nothing shows before the first catch-up of this session: a cold start and
  // an ordinary load are not a return.
  let caughtUpOnce = false;
  let awayAt = null;
  let timer = null;
  const clear = () => {
    if (timer === null) return;
    timers.clearTimeout(timer);
    timer = null;
  };
  const set = next => {
    if (next.phase === state.phase && next.since === state.since) return;
    state = next;
    onChange?.(state);
  };
  const begin = () => {
    clear();
    set({ phase: 'catching-up', since: awayAt ?? now() });
    timer = timers.setTimeout(() => {
      timer = null;
      set({ phase: 'failed', since: state.since });
    }, timeoutMs);
  };
  return {
    state: () => state,
    /** The app went to the background: freeze the dogs' colours here. */
    away() {
      awayAt = now();
      clear();
      set(CATCH_UP_IDLE);
    },
    /** Back in the foreground: the feed reads on from its kept cursor. */
    back() {
      if (!caughtUpOnce || awayAt === null) return;
      begin();
    },
    /** The feed is through (it reports this on every poll). */
    caughtUp() {
      caughtUpOnce = true;
      clear();
      set(CATCH_UP_IDLE);
    },
    /** The feed's read failed; only an attempt in progress can fail. */
    failed() {
      if (state.phase !== 'catching-up') return;
      clear();
      set({ phase: 'failed', since: state.since });
    },
    /** 重試 on the failure pill. */
    retry() {
      if (state.phase !== 'failed') return;
      begin();
      onRetry?.();
    },
    close() {
      clear();
    },
  };
}

import { t } from '../i18n';
/**
 * Nitro SQLite allows one JS connection per database name. Serialize whole App
 * sessions, including full React remounts where component refs no longer exist.
 * A new session waits for the previous owner's pending work and close operation.
 */
export function createDatabaseSessionQueue() {
  let available = Promise.resolve();
  let closeFailed = false;
  return {
    open(setup) {
      const previous = available;
      let release;
      available = new Promise(resolve => {
        release = resolve;
      });
      let cancelled = false;
      let closing = null;
      const ready = previous.then(() => {
        if (cancelled) return undefined;
        if (closeFailed) {
          throw new Error(
            t("c613"),
          );
        }
        return setup();
      });
      return {
        ready,
        close() {
          if (closing) return closing;
          cancelled = true;
          closing = ready
            .then(
              async dispose => {
                try {
                  await dispose?.();
                } catch (error) {
                  // Do not open another native connection in an unknown state.
                  closeFailed = true;
                  throw error;
                }
              },
              // Setup errors are reported by ready; no disposer was acquired.
              () => {},
            )
            .finally(release);
          return closing;
        },
      };
    },
  };
}

export const databaseSessions = createDatabaseSessionQueue();

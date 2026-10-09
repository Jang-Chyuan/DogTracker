import { t } from '../i18n';
/**
 * Both ends of a fixed range are stored as epoch milliseconds: the card now
 * picks them with the platform's own date/time picker instead of parsing what
 * someone typed, and the query needs a real end, not a start plus a duration.
 */
export function parseHistoryRange(startAt, endAt) {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt))
    throw new Error(t("c841"));
  if (endAt <= startAt) throw new Error(t("c842"));
  if (endAt - startAt > 240 * 3600000) throw new Error(t("c843"));
  return { since: startAt, until: endAt };
}


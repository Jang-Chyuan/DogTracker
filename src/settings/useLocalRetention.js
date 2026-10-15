import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { shortDate } from '../history/screen/HistoryCalendar';

/** 「YYYY-MM-DD」 → 「YYYY/MM/DD」. */
export const longDate = day => day.replace(/-/g, '/');
import {
  DOG_RETENTION_DAYS,
  ROUTE_RETENTION_DAYS,
  retentionStartDay,
} from '../database/LocalRetention';

/**
 * 「保留到 M/D」 of my route (設定 → 手機) and of the dogs' packets this phone
 * received (設定 → 進階). Until the database answers (or without one: a
 * screen fixture), the rule's day for `now`.
 */
export function retentionLabels(read, now) {
  const route = read?.route?.from ?? retentionStartDay(now, ROUTE_RETENTION_DAYS);
  const dogs = read?.dogs?.from ?? retentionStartDay(now, DOG_RETENTION_DAYS);
  return {
    // A year back: the date with its year (「2025/10/16」), M/D alone would
    // read as the coming days.
    route: t('c1401', { date: longDate(route) }),
    dogs: t('c1399', { date: shortDate(dogs), days: DOG_RETENTION_DAYS }),
  };
}

/**
 * The first day kept, read again each time a page that shows it opens
 * (HistoryDatabase.localRetention: a cap may have cut into the window).
 */
export function useLocalRetention(database, ready, active) {
  const [read, setRead] = useState(null);
  useEffect(() => {
    if (!ready || !active || !database?.localRetention) return undefined;
    let alive = true;
    Promise.resolve(database.localRetention(Date.now()))
      .then(value => { if (alive) setRead(value); })
      // The rule's day stays shown.
      .catch(() => {});
    return () => { alive = false; };
  }, [database, ready, active]);
  return read;
}

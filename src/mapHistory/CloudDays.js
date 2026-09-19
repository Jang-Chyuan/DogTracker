const DAY = 24 * 3600000;
export const CLOUD_DAY_LIMIT = 10;

const iso = value => new Date(value).toISOString();
const startOfLocalDay = value => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/**
 * Which days the cloud holds rows for, so the card can offer a day this phone
 * has not downloaded yet instead of pretending it does not exist.
 *
 * It walks backwards: ask for the newest row before a cutoff, take the day that
 * row falls in, then look before that day. Each question is "top 1 by
 * received_at", and empty days cost nothing because the walk jumps straight
 * over them. Asking each day for a count instead took seconds per day on a
 * table with tens of thousands of rows a day.
 *
 * The questions have to be asked in order, so `onDay` reports each day the
 * moment it is known: on a real account one question takes about two seconds,
 * and holding ten of them back until the last one returns is what reads as a
 * card that never loads.
 */
export async function listCloudDays({
  client, masters, slaves, now = Date.now(), limit = CLOUD_DAY_LIMIT, signal, onDay,
}) {
  if (!client || !masters?.length || !slaves?.length) return { days: [], stopped: 'end' };
  const days = [];
  let cutoff = now;
  for (let index = 0; index < limit; index += 1) {
    const query = client.from('dog_telemetry')
      .select('received_at')
      .in('master_id', masters)
      .in('slave_id', slaves)
      .lt('received_at', iso(cutoff))
      .order('received_at', { ascending: false })
      .limit(1);
    const { data, error } = await (signal ? query.abortSignal(signal) : query);
    // A failed answer is not proof that the earlier days are empty. The card is
    // told the walk stopped early, because a short list shown as the whole
    // answer reads as "nothing before this" — which is what a timeout on this
    // table looked like.
    if (error) return { days, stopped: 'error', message: error.message || '' };
    if (!Array.isArray(data) || !data.length) return { days, stopped: 'end' };
    const time = Date.parse(data[0].received_at);
    if (!Number.isFinite(time)) return { days, stopped: 'end' };
    const day = startOfLocalDay(time);
    days.push({ day });
    onDay?.(day, [...days]);
    cutoff = day;
  }
  return { days, stopped: 'limit' };
}

/** Local days first; a cloud day the phone does not hold is marked as such. */
export function mergeDays(local, cloud) {
  const days = new Map(local.map(entry => [entry.day, { ...entry, inCloud: false }]));
  for (const entry of cloud) {
    const existing = days.get(entry.day);
    if (existing) existing.inCloud = true;
    else days.set(entry.day, { day: entry.day, rows: 0, inCloud: true,
      from: entry.day, to: entry.day + DAY - 1 });
  }
  return [...days.values()].sort((left, right) => right.day - left.day);
}

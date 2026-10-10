/* global BigInt */
import { createClient } from '@supabase/supabase-js';

// Run the production query builders through the real SDK. The local server
// interprets emitted REST filters instead of consuming one global page queue.
const split = text => {
  let depth = 0, start = 0; const parts = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '(') depth++;
    if (text[index] === ')') depth--;
    if (text[index] === ',' && depth === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  return [...parts, text.slice(start)];
};
const valueOf = (row, key) => key.startsWith('payload->') ? row.payload?.[key.slice(9)] : row[key];
const comparable = (value, key) => {
  if (!key.endsWith('_at') || value == null) return value;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('Invalid fixture timestamp');
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] || '';
  return BigInt(millis) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3));
};
const matches = (row, key, expression) => {
  const prop = valueOf(row, key);
  if (expression.startsWith('not.')) return !matches(row, key, expression.slice(4));
  const dot = expression.indexOf('.'), operator = expression.slice(0, dot), raw = expression.slice(dot + 1);
  if (operator === 'is') return raw === 'null' ? prop == null : prop === (raw === 'true');
  if (operator === 'in') return split(raw.slice(1, -1)).some(item => matches(row, key, `eq.${item}`));
  const target = typeof prop === 'number' ? Number(raw) : comparable(raw, key);
  const left = comparable(prop, key);
  if (left == null) return false;
  if (key.startsWith('payload->') && ['gte', 'lte'].includes(operator) && typeof prop !== 'number') return false;
  if (operator === 'eq') return left === target;
  if (operator === 'neq') return left !== target;
  if (operator === 'gt') return left > target;
  if (operator === 'gte') return left >= target;
  if (operator === 'lt') return left < target;
  if (operator === 'lte') return left <= target;
  throw new Error(`Unsupported fixture REST operator: ${operator}`);
};
const condition = (row, expression) => {
  for (const name of ['and', 'or']) if (expression.startsWith(`${name}(`)) {
    const children = split(expression.slice(name.length + 1, -1));
    return name === 'and' ? children.every(child => condition(row, child)) : children.some(child => condition(row, child));
  }
  const dot = expression.indexOf('.');
  return matches(row, expression.slice(0, dot), expression.slice(dot + 1));
};

export function latestArchiveRest({ events = [], members = [{ gateway_id: 'master_7', slave_id: 6 }],
  archivePageSize = 1000, beforeRead = async () => {} } = {}) {
  const calls = [];
  // These cases exercise publication/restart, not SDK backoff timers. Return
  // the injected transport failure to CloudSync without hidden SDK retries.
  const client = createClient('https://example.invalid', 'public-fixture-key', { db: { retry: false }, auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  }, global: { fetch: async (url, options = {}) => {
    const parsed = new URL(url), params = parsed.searchParams;
    const table = parsed.pathname.split('/').at(-1), select = params.get('select');
    const limit = Number(params.get('limit') || Infinity);
    const phase = table === 'device_members' ? 'masters' : options.method === 'HEAD' ? 'count'
      : select === 'slave_id' ? 'keys' : select?.startsWith('event_id,received_at,') ? 'repair'
        : limit === 500 ? 'context' : limit === 40 ? 'seeds' : limit === 1000 ? 'archive'
          : [...params.keys()].some(key => key.startsWith('payload->')) ? 'fix' : 'packet';
    const call = { phase, params, url: parsed, signal: options.signal }; calls.push(call);
    await beforeRead(call);
    let found = (table === 'device_members' ? members : events).filter(row => [...params].every(([key, expression]) => {
      if (['select', 'order', 'limit', 'offset'].includes(key)) return true;
      if (key === 'or' || key === 'and') return condition(row, `${key}${expression}`);
      // Membership fixtures represent this owner's already authorized rows.
      if (key === 'user_id') return true;
      return matches(row, key, expression);
    }));
    const count = found.length;
    const order = params.get('order')?.split(',') || [];
    found.sort((a, b) => {
      for (const spec of order) {
        const [key, direction] = spec.split('.');
        const left = comparable(valueOf(a, key), key), right = comparable(valueOf(b, key), key);
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        if (comparison) return direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
    const offset = Number(params.get('offset') || 0);
    found = found.slice(offset, offset + Math.min(limit, phase === 'archive' ? archivePageSize : Infinity));
    const fields = select.split(',');
    const data = found.map(row => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]])));
    return { ok: true, status: 200, statusText: 'OK', headers: { get: name => name.toLowerCase() === 'content-range' ? `0-0/${count}` : null },
      text: async () => options.method === 'HEAD' ? '' : JSON.stringify(data) };
  } } });
  return { client, calls };
}

export const cloudEvent = (id, time, { slave = 6, master = 7, latitude = 24.9892, longitude = 121.3132, ...extra } = {}) => ({
  event_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, master_id: master, slave_id: slave, seq: id,
  received_at: new Date(time).toISOString(), payload: { lat: Math.round(latitude * 1e6), lon: Math.round(longitude * 1e6), satellites: 9, hdop: 1 }, ...extra,
});

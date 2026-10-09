import { receiverNumber } from './ReceiverState';

export const SOURCE_LOCATION_GRACE_MS = 10000;
export const validSourceFix = packet => Number.isFinite(packet.slave_lat) && Number.isFinite(packet.slave_lon)
  && Math.abs(packet.slave_lat) <= 90 && Math.abs(packet.slave_lon) <= 180
  && !(packet.slave_lat === 0 && packet.slave_lon === 0);

export function normalizeWaitingSources(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sources = {};
  for (const [id, source] of Object.entries(value.sources || {})) {
    if (/^[1-9]\d*$/.test(id) && Number.isFinite(source?.firstAt)) {
      sources[id] = { firstAt: source.firstAt, fixed: source.fixed === true };
    }
  }
  return { receiver: String(value.receiver || ''), sources,
    dismissed: Array.isArray(value.dismissed) ? value.dismissed.filter(id => typeof id === 'string') : [],
    paused: value.paused === true, since: Number.isFinite(value.since) ? value.since : null };
}

/** Persist first reception, ever-located state and the identities dismissed with ✕. */
export function waitingSourcesState(previous, receiverState, packets, now, switching = false) {
  const number = receiverNumber(receiverState);
  const receiver = `${receiverState?.deviceId || receiverState?.deviceName || ''}:${number ?? ''}`;
  const prior = normalizeWaitingSources(previous);
  // A provisional switch hides the card but preserves its original checkpoint.
  // Cancellation restores this receiver; success changes the identity below.
  if (switching && prior) return { ...prior, paused: true };
  const same = prior?.receiver === receiver;
  const next = same ? { ...prior, sources: { ...prior.sources } }
    : { receiver, sources: {}, dismissed: [], paused: false, since: null };
  // Deliberate disconnect/change hides immediately; a dropped radio link keeps the card.
  if (receiverState?.enabled === false) {
    return next.paused ? next : { receiver, sources: {}, dismissed: [], paused: true, since: now };
  }
  if (!receiverState?.enabled || number == null) return next;
  next.paused = false;
  for (const packet of packets || []) {
    if (packet.source !== 'ble' || Number(packet.master_id) !== number) continue;
    const id = String(packet.slave_id);
    if (!/^[1-9]\d*$/.test(id)) continue;
    const received = Number(packet.received_at);
    if (!Number.isFinite(received) || (next.since != null && received < next.since && !validSourceFix(packet))) continue;
    const first = Number(packet.first_received_at ?? received);
    const source = next.sources[id];
    next.sources[id] = { firstAt: source?.firstAt ?? Math.max(first, next.since ?? first),
      fixed: !!source?.fixed || validSourceFix(packet) };
  }
  return next;
}

export function waitingSourcesCount(state, now) {
  if (!state || state.paused) return 0;
  const waiting = Object.entries(state.sources).filter(([, source]) => !source.fixed && now - source.firstAt >= SOURCE_LOCATION_GRACE_MS);
  // A reduction cannot undo dismissal; only a newly counted source can.
  if (!waiting.some(([id]) => !state.dismissed.includes(id))) return 0;
  return waiting.length;
}

export function dismissWaitingSources(state) {
  return { ...state, dismissed: Object.keys(state.sources) };
}

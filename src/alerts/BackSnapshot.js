import { updateAlertEvents } from './AlertEvents';
import { dogFreshness } from '../tracking/DogFreshness';
import { dogProblems } from '../tracking/DogProblems';
import { alertText, compareAlerts, notificationTap, presentAlerts } from './AlertsHistory';

/** JSON-safe background checkpoint, detached from mutable caller data. Takes
 * merged dogs and the same clock/cloud/receiver pause inputs as the live map.
 * Ordinary movement/battery readings are not a return alert.
 */
export function captureBackSnapshot({ dogs = [], active, now, cloud, pauses, receiver, receiverBattery, storageError, preferences } = {}) {
  const alerts = active ?? updateAlertEvents({}, { dogs, now, cloud, pauses, receiver,
    receiverBattery, storageError, preferences }).active;
  return { at: now, inferredEpisodes: active == null, dogs: dogs.map(dog => {
    const freshness = dogFreshness(dog, { now, cloud, pauses });
    return { id: dog.id, name: dog.name || `狗 ${dog.id}`, drawn: freshness.drawn,
      problems: dogProblems(dog, freshness, dog.range) };
  }), active: JSON.parse(JSON.stringify(presentAlerts(alerts))) };
}

/** Events are an optional journal: endpoints alone cannot reveal a problem
 * that started and cleared while away. Window is (background, return].
 * Current problems first by severity, then resolved changes, stable key ties.
 * Missing/never-positioned dogs are not described as recovered.
 */
export function backSnapshot(before, after, events = []) {
  if (!before || !after || !(after.at > before.at)) return null;
  const previous = new Map(before.active.map(event => [event.key, event]));
  const current = new Map(after.active.map(event => [event.key, event]));
  const changes = new Map();
  for (const event of after.active) {
    const old = previous.get(event.key);
    if (!old || (!before.inferredEpisodes && !after.inferredEpisodes && old.startedAt !== event.startedAt) || (event.level || 0) > (old.level || 0)) {
      changes.set(event.key, { ...event, status: 'active', at: event.startedAt });
    }
  }
  for (const event of before.active) {
    if (!current.has(event.key)) changes.set(event.key, { ...event, status: 'resolved', at: after.at });
  }
  for (const event of events) {
    if (!(event.at > before.at && event.at <= after.at)) continue;
    if (!changes.has(event.key)) changes.set(event.key, { ...event,
      status: current.has(event.key) ? 'active' : 'resolved' });
  }
  const items = [...changes.values()].filter(event => !event.kind.startsWith('dog-')
    || after.dogs.some(dog => dog.id === event.subject && dog.drawn))
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || compareAlerts(a, b))
    .map(event => ({ key: event.key, kind: event.kind, dogId: event.kind.startsWith('dog-') ? event.subject : null,
      status: event.status, at: event.at, text: alertText(event) }));
  if (!items.length) return null;
  return { from: before.at, to: after.at, items,
    dogs: [...new Set(items.map(item => item.dogId).filter(id => id !== null))]
      .map(id => after.dogs.find(dog => dog.id === id))
      .map(dog => ({ ...dog, problems: { ...dog.problems }, items: items.filter(item => item.dogId === dog.id) })),
    target: notificationTap(after.active) };
}

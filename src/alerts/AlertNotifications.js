// The alerts' Android side (058b; android .../alerts/, specs/NativeAlertNotifications):
//
// - one alert state, kept natively and shared with the receiver's background
//   service, which checks this phone's dogs, the receiver and the storage
//   while the app is off screen (design v3 N 「限制」). The app in front saves
//   its state there; when the service (or 「暫停提醒 30 分」 on the
//   notification) moved it on, the revision says so and the app reads it again
//   (useNativeAlertState);
// - the app hands over what only it knows about this phone's dogs (names,
//   indoor holds, range judgements) and the S6 settings (alertSnapshot). A
//   dog is this phone's while its own receiver hears it, even when a
//   teammate's cloud row of the same collar is newer (isLocalDog);
// - the merged notification (N1/N2) on the 「提醒」 channel, the alert
//   vibration and the sound (sendAlertEffects).
//
// Without the native module (tests, other platforms) the state stays in
// memory and nothing is posted; the last command is kept for the debug preview.
import NativeAlertNotifications from '../../specs/NativeAlertNotifications';
import { isIndoorHold } from '../tracking/DogFreshness';
import { RANGE } from '../tracking/ReceiverRange';

let last = { command: 'cancel', content: null, at: null };
let lastSent = null;
let lastHandOver = null;

const parse = text => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Carries out one step's effects: the alert vibration and sound, and the
 * notification command ('notify' posts with attention, 'update' changes the
 * lines silently, 'cancel'). Returns the command as remembered.
 */
export function sendAlertEffects(effects, at = Date.now(), native = NativeAlertNotifications) {
  const command = effects?.notification || 'cancel';
  const content = command === 'cancel' ? null : effects?.content ?? null;
  last = { command, content, at };
  const payload = {
    command,
    content: content && { title: content.title, lines: content.lines, target: content.target },
    vibration: effects?.vibration || null,
    critical: !!effects?.critical,
    sound: !!effects?.sound,
  };
  // The same command again with no attention changes nothing.
  const key = JSON.stringify({ ...payload, vibration: null, sound: false });
  const attention = !!payload.vibration || payload.sound;
  if (native && (attention || key !== lastSent)) {
    lastSent = key;
    Promise.resolve(native.deliver(JSON.stringify(payload))).catch(() => {
      lastSent = null;
    });
  }
  return last;
}

/** The last command, for the debug preview. */
export const lastAlertNotification = () => last;

/** Whether the native side posts and vibrates (else AlertEffects uses RN's Vibration). */
export const nativeAlerts = (native = NativeAlertNotifications) => !!native;

/** { revision, state }: the saved alert state (or null) and its revision. */
export async function loadAlertState(native = NativeAlertNotifications) {
  if (!native) return { revision: 0, state: null };
  const value = parse(await native.loadState());
  return { revision: Number(value?.revision) || 0, state: value?.state ?? null };
}

/** Saves the app's state; false when the native state moved on (read it again). */
export async function saveAlertState(state, basedOn, native = NativeAlertNotifications) {
  if (!native) return true;
  return !!(await native.saveState(JSON.stringify(state), basedOn));
}

// How recently this phone's receiver must have heard a dog for it to be one of
// this phone's dogs: the live map's own "still communicating" window and
// ReceiverRange's "only heard through the cloud" gap (RANGE.localSilenceMs).
export const LOCAL_RECEPTION_MS = RANGE.localSilenceMs;

const finite = value => (Number.isFinite(value) ? value : null);
const newestSource = dog => (isIndoorHold(dog) ? dog.packetSource ?? dog.fixSource : dog.fixSource ?? dog.packetSource);
// The last packet this phone heard itself: the newest BLE row (LocalReception),
// else the range judgement's own record of it.
const heardAt = dog => finite(dog.localPacketAt) ?? finite(dog.range?.lastLocalAt);

/**
 * Whether a dog is one of this phone's dogs, for the background check. Not
 * "whose row is newest": the same collar can be heard by this phone's
 * receiver and by a teammate's, and the teammate's cloud row is often a few
 * seconds newer. Such a dog is still this phone's (its name, hold and range
 * judgement must stay with the background check) as long as this phone heard
 * it within LOCAL_RECEPTION_MS of now or of the dog's newest packet. Only a
 * dog this phone has stopped hearing, while the cloud still does, is the
 * cloud's (design v3 N 「限制」).
 */
export function isLocalDog(dog, now = Date.now()) {
  if (!dog) return false;
  if (newestSource(dog) !== 'cloud') return true;
  const heard = heardAt(dog);
  if (heard == null) return false;
  const newest = finite(dog.packetAt) ?? finite(dog.fixAt);
  return now - heard <= LOCAL_RECEPTION_MS || (newest != null && newest - heard <= LOCAL_RECEPTION_MS);
}

// The background check times this phone's dogs by this phone's own packets
// (its stored rows move them on): a cloud time is another phone's or the
// server's clock, and a teammate's newer row is not this phone's reception.
const localTime = (value, source, local) => (source !== 'cloud' ? finite(value) : finite(local));

/**
 * What the background check needs from the app: this phone's dogs (isLocalDog;
 * not the cloud's, which wait until the app is back) with their names, indoor
 * holds and range judgements, and the S6 settings. `others` names the rest
 * with their range judgements, so a dog this phone hears again while the app
 * is away keeps its name and its judgement instead of starting from nothing.
 *
 * Each dog may carry `localPacketAt` / `localFixAt` (LocalReception): the
 * newest packet, and the newest valid position, this phone received itself.
 */
export function alertSnapshot(dogs = [], preferences = null, now = Date.now()) {
  const local = [], others = [];
  for (const dog of dogs) (isLocalDog(dog, now) ? local : others).push(dog);
  return {
    preferences: preferences || null,
    dogs: local.map(dog => ({
      slaveId: dog.slaveId,
      name: dog.name ?? null,
      coordinate: dog.coordinate ?? null,
      fixAt: localTime(dog.fixAt, dog.fixSource, dog.localFixAt),
      packetAt: localTime(dog.packetAt, dog.packetSource, heardAt(dog)),
      held: isIndoorHold(dog),
      indoorState: dog.indoorState ?? null,
      batteryPercentage: Number.isFinite(dog.batteryPercentage) ? dog.batteryPercentage : null,
      // The judgement behind it (BatteryPlausibility), so the background
      // check carries on with the same last believed reading and pending drop.
      battery: dog.batteryState ?? null,
      charging: !!dog.charging,
      range: dog.range ?? null,
    })),
    others: others.map(dog => ({ slaveId: dog.slaveId, name: dog.name ?? null, range: dog.range ?? null })),
  };
}

/** Hands the snapshot over when it changed. */
export function handOverAlerts(snapshot, native = NativeAlertNotifications) {
  if (!native) return;
  const text = JSON.stringify(snapshot);
  if (text === lastHandOver) return;
  lastHandOver = text;
  Promise.resolve(native.handOver(text)).catch(() => {
    lastHandOver = null;
  });
}

/** { required, granted, alertsEnabled } (Android 13+ asks for POST_NOTIFICATIONS). */
export async function notificationPermission(native = NativeAlertNotifications) {
  if (!native) return { required: false, granted: true, alertsEnabled: true };
  return parse(await native.permissionState()) || { required: false, granted: true, alertsEnabled: true };
}

const SCREENS = ['map', 'open-map', 'receiver-settings', 'diagnostics', 'system-storage', 'my-route',
  'cloud-settings'];

/**
 * Where a notification tap leads (dogtracker://notification/<screen>?dogId=):
 * { screen, dogId } or null. The merged alert's body opens its most severe
 * problem ('map' with a dog: its card); 「打開地圖」 is 'open-map' (the live
 * map, everything framed, no card); the 「常駐」 notifications open
 * 'receiver-settings', 'my-route' and 'cloud-settings'.
 */
export function notificationDestination(url) {
  const match = /^dogtracker:\/\/notification\/([^?#/]+)(?:\?([^#]*))?/.exec(url || '');
  if (!match || !SCREENS.includes(match[1])) return null;
  let dogId = null;
  for (const part of (match[2] || '').split('&')) {
    const [key, value = ''] = part.split('=');
    if (key !== 'dogId') continue;
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) dogId = number;
  }
  return { screen: match[1], dogId };
}

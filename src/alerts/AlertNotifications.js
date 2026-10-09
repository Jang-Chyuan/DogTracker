// The alerts' Android side (058b; android .../alerts/, specs/NativeAlertNotifications):
//
// - one alert state, kept natively and shared with the receiver's background
//   service, which checks this phone's dogs, the receiver and the storage
//   while the app is off screen (design v3 N 「限制」). The app in front saves
//   its state there; when the service (or 「暫停提醒 30 分」 on the
//   notification) moved it on, the revision says so and the app reads it again
//   (useNativeAlertState);
// - the app hands over what only it knows about this phone's dogs (names,
//   indoor holds, range judgements) and the S6 settings (alertSnapshot);
// - the merged notification (N1/N2) on the 「提醒」 channel, the alert
//   vibration and the sound (sendAlertEffects).
//
// Without the native module (tests, other platforms) the state stays in
// memory and nothing is posted; the last command is kept for the debug preview.
import NativeAlertNotifications from '../../specs/NativeAlertNotifications';
import { isIndoorHold } from '../tracking/DogFreshness';

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

const local = dog => {
  const held = isIndoorHold(dog);
  const source = held ? dog.packetSource ?? dog.fixSource : dog.fixSource ?? dog.packetSource;
  return source !== 'cloud';
};
const time = (value, source) => (Number.isFinite(value) && source !== 'cloud' ? value : null);

/**
 * What the background check needs from the app: this phone's dogs (not the
 * cloud's, which wait until the app is back) with their names, indoor holds
 * and range judgements, and the S6 settings.
 */
export function alertSnapshot(dogs = [], preferences = null) {
  return {
    preferences: preferences || null,
    dogs: dogs.filter(local).map(dog => ({
      slaveId: dog.slaveId,
      name: dog.name ?? null,
      coordinate: dog.coordinate ?? null,
      fixAt: time(dog.fixAt, dog.fixSource),
      packetAt: time(dog.packetAt, dog.packetSource),
      held: isIndoorHold(dog),
      batteryPercentage: Number.isFinite(dog.batteryPercentage) ? dog.batteryPercentage : null,
      charging: !!dog.charging,
      range: dog.range ?? null,
    })),
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

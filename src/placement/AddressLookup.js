import { NativeModules, Platform } from 'react-native';
import { distanceMeters } from './IndoorHold';

// Where a held dog is, in words: Android's built-in geocoder (free, no key)
// names the nearest address. The address only labels the place; the dog stays
// drawn where it was measured, because the address point can be a few hundred
// metres off (an airport, a farm road).
export const ADDRESS_CONFIG = Object.freeze({
  // Closer than this the address is written as "…附近"; farther, with the
  // distance, and beyond tooFarM only the district is named.
  nearM: 50,
  tooFarM: 300,
  precision: 4,
  cacheSize: 500,
  retryAfterMs: 60000,
});

// Google's data sometimes answers in simplified characters.
const TRADITIONAL = { 园: '園', 芦: '蘆', 华: '華', 区: '區', 复: '復', 兴: '興', 泽: '澤', 观: '觀', 东: '東',
  龙: '龍', 门: '門', 场: '場', 楼: '樓', 号: '號', 湾: '灣', 乡: '鄉', 镇: '鎮', 县: '縣', 头: '頭', 桥: '橋',
  车: '車', 杨: '楊', 梅: '梅', 农: '農', 厂: '廠', 馆: '館', 机: '機', 航: '航', 站: '站', 线: '線', 里: '里' };
const traditional = text => text.replace(/./gu, char => TRADITIONAL[char] ?? char);

/** "338台灣桃園市蘆竹區大華里大竹北路630巷21號" → "蘆竹區大竹北路630巷21號" */
export function shortAddress(line) {
  if (!line) return null;
  let text = traditional(String(line)).replace(/^\d{3,6}/, '').replace(/^(台灣|臺灣)/, '').trim();
  // "3樓, No. 20號中正路…" and other address formats are left whole.
  if (/^\d/.test(text) || /No\./.test(text)) return text;
  text = text.replace(/^[^市縣]{2,3}[市縣]/, '');
  // The village (…里) between district and road says nothing a handler uses.
  text = text.replace(/^([^區鄉鎮市]{1,4}[區鄉鎮市])[^區鄉鎮市路街道巷]{1,4}里/, '$1');
  return text;
}

/** The words for a place, from the geocoder's answers, or null. */
export function describePlace(anchor, results, config = ADDRESS_CONFIG) {
  const found = (results || []).filter(result => result?.line).map(result => ({
    ...result,
    away: Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
      ? distanceMeters(anchor, result) : Infinity,
  })).sort((left, right) => left.away - right.away);
  const best = found[0];
  if (!best) return null;
  const text = shortAddress(best.line);
  if (best.away <= config.nearM) return `${text}附近`;
  if (best.away <= config.tooFarM) return `${text}附近（約 ${Math.round(best.away / 10) * 10} m）`;
  const district = traditional(String(best.district || '')).trim();
  return district ? `${district}（附近沒有地址）` : null;
}

/** One lookup at a time, cached by rounded place; never waits on the map. */
export function createAddressLookup({ native = Platform.OS === 'android' ? NativeModules.PlaceLookup : null,
  config = ADDRESS_CONFIG } = {}) {
  const cache = new Map();
  const listeners = new Set();
  const queue = [];
  const key = anchor => `${anchor.latitude.toFixed(config.precision)},${anchor.longitude.toFixed(config.precision)}`;
  function put(name, entry) {
    cache.delete(name);
    cache.set(name, entry);
    while (cache.size > config.cacheSize) cache.delete(cache.keys().next().value);
  }
  async function drain() {
    while (queue.length) {
      const [name, anchor] = queue[0];
      try {
        const results = JSON.parse(await native.reverseGeocode(anchor.latitude, anchor.longitude));
        put(name, { value: describePlace(anchor, results, config) });
      } catch (_) {
        put(name, { value: null, failedAt: Date.now() });
      }
      queue.shift();
      for (const listener of listeners) listener(name);
    }
  }
  return {
    lookup(anchor) {
      if (!anchor || !native?.reverseGeocode) return null;
      const name = key(anchor);
      const entry = cache.get(name);
      if (entry?.pending) return undefined;
      if (entry && !(entry.failedAt && Date.now() - entry.failedAt > config.retryAfterMs)) {
        put(name, entry);
        return entry.value;
      }
      put(name, { pending: true });
      queue.push([name, anchor]);
      if (queue.length === 1) drain();
      return undefined;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const addressLookup = createAddressLookup();

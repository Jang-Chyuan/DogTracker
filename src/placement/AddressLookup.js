import { t } from '../i18n';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createAddressCache } from './AddressCache';
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
  cacheSize: 500,
  retryAfterMs: 60000,
  // A geocoder that never answers must not stall the places after it.
  timeoutMs: 15000,
});

// Google's data sometimes answers in simplified characters.
const TRADITIONAL = {
  园: '園',
  芦: '蘆',
  华: '華',
  区: '區',
  复: '復',
  兴: '興',
  泽: '澤',
  观: '觀',
  东: '東',
  龙: '龍',
  门: '門',
  场: '場',
  楼: '樓',
  号: '號',
  湾: '灣',
  乡: '鄉',
  镇: '鎮',
  县: '縣',
  头: '頭',
  桥: '橋',
  车: '車',
  杨: '楊',
  梅: '梅',
  农: '農',
  厂: '廠',
  馆: '館',
  机: '機',
  航: '航',
  站: '站',
  线: '線',
  里: '里',
};
Object.assign(TRADITIONAL, {
  国: '國',
  庆: '慶',
  乐: '樂',
  长: '長',
  万: '萬',
  亿: '億',
  圣: '聖',
  义: '義',
  礼: '禮',
  贡: '貢',
  贵: '貴',
  丰: '豐',
  学: '學',
  书: '書',
  育: '育',
  宫: '宮',
  寿: '壽',
  宁: '寧',
  宝: '寶',
  实: '實',
  广: '廣',
  庄: '莊',
  后: '後',
  这: '這',
  远: '遠',
  连: '連',
  达: '達',
  运: '運',
  进: '進',
  过: '過',
  环: '環',
  归: '歸',
  关: '關',
  绿: '綠',
  红: '紅',
  蓝: '藍',
  银: '銀',
  铁: '鐵',
  铜: '銅',
  钟: '鐘',
  鱼: '魚',
  鸟: '鳥',
  马: '馬',
  凤: '鳳',
  鹤: '鶴',
  鸡: '雞',
  猫: '貓',
  狮: '獅',
  岛: '島',
  岭: '嶺',
  岳: '岳',
  仑: '崙',
  伦: '倫',
  侨: '僑',
  刘: '劉',
  陈: '陳',
  郑: '鄭',
  颜: '顏',
  叶: '葉',
  萧: '蕭',
  吴: '吳',
  苏: '蘇',
  张: '張',
  赖: '賴',
  许: '許',
  罗: '羅',
  黄: '黃',
  凯: '凱',
  诚: '誠',
  爱: '愛',
  谊: '誼',
  艺: '藝',
  术: '術',
  团: '團',
  结: '結',
  顺: '順',
  总: '總',
  营: '營',
  业: '業',
  电: '電',
  专: '專',
  旧: '舊',
  溪: '溪',
  沟: '溝',
  见: '見',
  览: '覽',
  觉: '覺',
  选: '選',
  纵: '縱',
  横: '橫',
  头: '頭',
  坜: '壢',
  滨: '濱',
  澳: '澳',
  纶: '綸',
  维: '維',
  经: '經',
  纬: '緯',
  纺: '紡',
  织: '織',
  产: '產',
  围: '圍',
  变: '變',
  让: '讓',
  盐: '鹽',
  麦: '麥',
  龟: '龜',
  莲: '蓮',
  节: '節',
  双: '雙',
  树: '樹',
  权: '權',
  档: '檔',
});
const traditional = text =>
  text.replace(/./gu, char => TRADITIONAL[char] ?? char);

/** "338台灣桃園市蘆竹區大華里大竹北路630巷21號" → "蘆竹區大竹北路630巷21號" */
export function shortAddress(line) {
  if (!line) return null;
  let text = traditional(String(line))
    .trim()
    .replace(/^\d{3,6}\s*/, '')
    .replace(/^(台灣|臺灣)/, '')
    .trim();
  // "3樓, No. 20號中正路…" and other address formats are left whole.
  if (/^\d/.test(text) || /No\./.test(text)) return text;
  text = text.replace(/^[^市縣]{2,3}[市縣]/, '');
  // The village (…里) between district and road says nothing a handler uses.
  text = text.replace(
    /^([^區鄉鎮市]{1,4}[區鄉鎮市])[^區鄉鎮市路街道巷]{1,4}[里村]/,
    '$1',
  );
  // The copy deck writes numbers apart: 「中正路 1 號」, 「630 巷 21 號」.
  text = text
    .replace(/([\u3400-\u9fff])(\d)/gu, '$1 $2')
    .replace(/(\d)([\u3400-\u9fff])/gu, '$1 $2');
  return text || null;
}

/** The words for a place, from the geocoder's answers, or null. */
export function describePlace(anchor, results, config = ADDRESS_CONFIG) {
  const found = (Array.isArray(results) ? results : [])
    .filter(result => result?.line || result?.district)
    .map(result => ({
      ...result,
      away:
        Number.isFinite(result.latitude) && Number.isFinite(result.longitude)
          ? distanceMeters(anchor, result)
          : Infinity,
    }))
    .sort((left, right) => left.away - right.away);
  if (!found.length) return null;
  // 「台灣桃園市大園區」 alone names no address: it only gives the district.
  const districtOnly = text =>
    !text || /^[^區鄉鎮市]{1,4}[區鄉鎮市]$/u.test(text);
  const best =
    found.find(result => !districtOnly(shortAddress(result.line))) ||
    found[0];
  const text = districtOnly(shortAddress(best.line))
    ? null
    : shortAddress(best.line);
  if (text && best.away <= config.nearM) return t('c382', { address: text });
  if (text && best.away <= config.tooFarM)
    return t("c881", { text: text, value: Math.round(best.away / 10) * 10 });
  const district =
    found
      .map(
        result =>
          shortAddress(result.line)?.match(/^([^區鄉鎮市]{1,4}[區鄉鎮市])/u)?.[1] ||
          traditional(String(result.district || '')).trim(),
      )
      .find(Boolean) || null;
  return district ? t('c384', { district: district }) : null;
}

/** One lookup at a time, cached by anchored place; never waits on the map. */
export function createAddressLookup({
  store = null,
  now = Date.now,
  native = Platform.OS === 'android' ? NativeModules.PlaceLookup : null,
  config = ADDRESS_CONFIG,
} = {}) {
  const cache = new Map();
  const listeners = new Set();
  const queue = [];
  const valid = anchor =>
    anchor &&
    Number.isFinite(anchor.latitude) &&
    Number.isFinite(anchor.longitude) &&
    Math.abs(anchor.latitude) <= 90 &&
    Math.abs(anchor.longitude) <= 180;
  const key = anchor => `${anchor.latitude},${anchor.longitude}`;
  function nearestCached(anchor, accepts = () => true) {
    let nearest;
    let nearestDistance = Infinity;
    for (const [name, entry] of cache) {
      if (!entry.anchor || !accepts(entry)) continue;
      const distance = distanceMeters(anchor, entry.anchor);
      // LRU order changes on every read. Pick by distance, like the durable
      // cache, so the stay and end at one displayed point keep one address.
      if (
        distance <= config.nearM &&
        (distance < nearestDistance ||
          (distance === nearestDistance && name < nearest?.[0]))
      ) {
        nearest = [name, entry];
        nearestDistance = distance;
      }
    }
    return nearest;
  }
  function put(name, entry) {
    cache.delete(name);
    cache.set(name, entry);
    while (
      [...cache.values()].filter(item => !item.pending).length >
      config.cacheSize
    ) {
      const oldest = [...cache.entries()].find(([, item]) => !item.pending);
      if (!oldest) break;
      cache.delete(oldest[0]);
    }
  }
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
      const [name, anchor] = queue[0];
      try {
        // Offline the geocoder has nothing to say: do not wait on it.
        if (native.isOnline && !(await native.isOnline().catch(() => false)))
          throw new Error('offline');
        let timer;
        const answer = await Promise.race([
          native.reverseGeocode(anchor.latitude, anchor.longitude),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('timeout')),
              config.timeoutMs,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        const results = JSON.parse(answer);
        // No answer at all is what Android gives offline: ask again later.
        if (!Array.isArray(results) || !results.length)
          throw new Error('empty');
        const value = describePlace(anchor, results, config);
        put(name, { anchor, value, ...(value ? {} : { failedAt: now() }) });
      } catch (_) {
        put(name, { anchor, value: null, failedAt: now() });
      } finally {
        const entry = cache.get(name);
        try {
          await store?.save(entry);
        } catch (_) {
          /* Memory cache still works. */
        }
        queue.shift();
        for (const listener of listeners) listener(name);
      }
    }
    running = false;
  }
  return {
    /**
     * The words for a place: a string, null (none found, offline, no
     * geocoder) or undefined (still asking). `retry` asks again at once about
     * a place that had no answer (the card opened again: 下次打開卡片再查).
     */
    lookup(anchor, { retry = false } = {}) {
      if (!valid(anchor) || !native?.reverseGeocode) return null;
      const nearby = nearestCached(anchor);
      const name = nearby ? nearby[0] : key(anchor);
      const entry = cache.get(name);
      if (entry?.pending) return undefined;
      if (
        entry &&
        !(
          entry.failedAt !== undefined &&
          (retry || now() - entry.failedAt >= config.retryAfterMs)
        )
      ) {
        put(name, entry);
        return entry.value;
      }
      put(name, { pending: true, anchor });
      // The phone's saved addresses are read outside the geocoder's queue, so
      // a slow answer never holds up places already known.
      Promise.resolve(store ? store.find(anchor).catch(() => null) : null).then(
        saved => {
          if (
            saved &&
            (saved.value ||
              (!retry && now() - saved.failedAt < config.retryAfterMs))
          ) {
            put(name, saved);
            for (const listener of listeners) listener(name);
            return;
          }
          queue.push([name, anchor]);
          drain();
        },
      );
      return undefined;
    },
    async lookupAddresses(points, { timeoutMs = 5000 } = {}) {
      let timer;
      let unsubscribe;
      let active = true;
      const resolved = points.map(() => undefined);
      const cached = point => {
        if (!valid(point)) return null;
        return nearestCached(point, item => Boolean(item.value))?.[1].value ?? null;
      };
      try {
        return await Promise.race([
          (async () => {
            const online = native?.isOnline
              ? await native.isOnline().catch(() => false)
              : true;
            if (!active) return points.map(cached);
            if (!online)
              return Promise.all(
                points.map(async point => {
                  if (!valid(point)) return null;
                  return (
                    cached(point) ||
                    (await store?.find(point).catch(() => null))?.value ||
                    null
                  );
                }),
              );
            return new Promise(resolve => {
              const check = () => {
                const result = points.map((point, index) => {
                  if (resolved[index] === undefined)
                    resolved[index] = this.lookup(point);
                  return resolved[index];
                });
                if (result.every(value => value !== undefined)) resolve(result);
              };
              unsubscribe = this.subscribe(check);
              check();
            });
          })(),
          new Promise(resolve => {
            timer = setTimeout(
              () =>
                resolve(
                  points.map(
                    (point, index) => resolved[index] ?? cached(point),
                  ),
                ),
              Math.min(5000, Math.max(0, timeoutMs)),
            );
          }),
        ]);
      } finally {
        active = false;
        clearTimeout(timer);
        unsubscribe?.();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const addressLookup = createAddressLookup({
  store: createAddressCache(),
});

// The live card and the history list ask the same lookup (and so share its
// cache); a screen fixture gives its own, which never touches this phone's.
export const AddressLookupContext = React.createContext(addressLookup);

const pointKey = point =>
  point ? `${point.latitude},${point.longitude}` : '';

/**
 * A7b's second line: the label or null. Not found, offline and still asking
 * all read null (no spinner); asked again every minute and whenever the card
 * opens. A held point may drift 50 m from where it was first named.
 */
export function useAddress(point) {
  const lookup = useContext(AddressLookupContext);
  const anchor = useRef(null);
  if (!point) anchor.current = null;
  else if (
    !anchor.current ||
    distanceMeters(anchor.current, point) > ADDRESS_CONFIG.nearM
  )
    anchor.current = point;
  const latitude = anchor.current?.latitude;
  const longitude = anchor.current?.longitude;
  const [state, setState] = useState(null);
  useEffect(() => {
    const held = latitude === undefined ? null : { latitude, longitude };
    const refresh = retry =>
      setState({
        latitude,
        longitude,
        value: lookup.lookup(held, { retry }) ?? null,
      });
    const unsubscribe = lookup.subscribe(() => refresh(false));
    refresh(true);
    const timer = setInterval(
      () => refresh(false),
      ADDRESS_CONFIG.retryAfterMs,
    );
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [lookup, latitude, longitude]);
  return state?.latitude === latitude && state?.longitude === longitude
    ? state?.value ?? null
    : null;
}

/**
 * The history list's place names (判定表「清單節點的內容」): one
 * { state, text } per point — 'pending' while asking (「查地址中…」),
 * 'found', or 'none'. A place still unanswered after waitMs (5 s) counts as
 * not found (coordinates above the pill); an answer arriving later still
 * shows.
 */
export function usePlaceNames(points, { waitMs = 5000 } = {}) {
  const lookup = useContext(AddressLookupContext);
  const keys = points.map(pointKey).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stable = useMemo(() => points, [keys]);
  const [, setTick] = useState(0);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    const unsubscribe = lookup.subscribe(() => setTick(tick => tick + 1));
    const timer = setTimeout(() => setExpired(true), waitMs);
    setTick(tick => tick + 1);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [lookup, keys, waitMs]);
  return stable.map(point => {
    const value = point ? lookup.lookup(point) : null;
    if (typeof value === 'string') return { state: 'found', text: value };
    if (value === undefined && !expired) return { state: 'pending', text: null };
    return { state: 'none', text: null };
  });
}

/** Results preserve input order; missing/pending labels are null. */
export const lookupAddresses = (points, options) =>
  addressLookup.lookupAddresses(points, options);

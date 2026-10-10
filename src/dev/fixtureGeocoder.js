import { NativeModules } from 'react-native';
import { createAddressLookup } from '../placement/AddressLookup';

// What a screen fixture's places are called. A fixture never asks this
// phone's cache (nothing it shows is written down): it gets its own lookup,
// over the same describePlace rules, answered by
//   'real'                 Android's own Geocoder (needs network + Play services)
//   { offline: true }      no network: nothing is asked (edges「沒網路時查地址」)
//   { names: [...] }       made-up answers, one per new place in the order the
//                          screen asks: { line, awayM } (the address point
//                          awayM metres north of the place; 0 → 「…附近」),
//                          { district } (only the district) or null (no
//                          answer: 沒有地址). Places past the list get none.
//   anything else          no answer for any place.
const METRES_PER_DEGREE = 111320;

export function fixtureGeocoder(spec, { delayMs = 700 } = {}) {
  if (spec === 'real') return NativeModules.PlaceLookup ?? null;
  const names = spec?.names ?? [];
  const given = [];
  const answer = (latitude, longitude) => {
    const near = given.find(place => Math.abs(place.latitude - latitude) < 0.0003
      && Math.abs(place.longitude - longitude) < 0.0003);
    if (near) return near.name;
    const name = names[given.length] ?? null;
    given.push({ latitude, longitude, name });
    return name;
  };
  return {
    isOnline: async () => !spec?.offline,
    reverseGeocode: (latitude, longitude) => new Promise(resolve => {
      setTimeout(() => {
        const name = spec?.offline ? null : answer(latitude, longitude);
        if (!name) { resolve('[]'); return; }
        resolve(JSON.stringify([{ line: name.line ?? null, district: name.district ?? null,
          latitude: latitude + (name.awayM ?? 0) / METRES_PER_DEGREE, longitude }]));
      }, delayMs);
    }),
  };
}

/** The address lookup a fixture's screens use (AddressLookupContext). */
export const fixtureAddressLookup = (spec, options) =>
  createAddressLookup({ store: null, native: fixtureGeocoder(spec, options) });

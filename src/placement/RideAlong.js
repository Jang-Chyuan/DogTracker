// A collar in a car may have no fix: lying on the floor, in a crate or in a
// metal van. When the handler's phone is clearly driving and the receiver it
// is connected to hears the dog loudly (the dog is right beside it), the dog
// is in the same vehicle: draw it with the phone instead of at the place it
// got in. A dog whose own GPS still works keeps its own position.
export const RIDE_CONFIG = Object.freeze({
  // The phone has been this fast over the last windowMs, with a fresh fix.
  minSpeedKmh: 20,
  windowMs: 30000,
  minSamples: 3,
  maxPhoneAgeMs: 10000,
  // The connected receiver heard the dog at least this loudly, this recently.
  minRssi: -60,
  rssiFreshMs: 60000,
  // And the dog's own GPS has had no good fix for this long.
  noGoodFixMs: 60000,
  // Readings from the future (the clock was set back) are not fresh.
  clockSkewMs: 5000,
});

const within = (age, maxMs, config) => age >= -config.clockSkewMs && age <= maxMs;

const median = values => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Keeps the phone's recent speeds; riding() says whether it is driving. */
export function createRideDetector(config = RIDE_CONFIG) {
  let samples = [];
  let latest = null;
  return {
    add(position, now) {
      if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return;
      const speed = Number.isFinite(position.speedKmh) ? position.speedKmh : null;
      const time = Number.isFinite(position.timestamp) ? position.timestamp : now;
      if (latest && latest.time === time) return;
      latest = { latitude: position.latitude, longitude: position.longitude, time };
      if (speed !== null) samples.push({ time, speed });
      samples = samples.filter(sample => within(now - sample.time, config.windowMs, config));
    },
    ride(now) {
      const recent = samples.filter(sample => within(now - sample.time, config.windowMs, config));
      const riding = !!latest && within(now - latest.time, config.maxPhoneAgeMs, config)
        && recent.length >= config.minSamples && median(recent.map(sample => sample.speed)) >= config.minSpeedKmh;
      return riding ? { riding: true, coordinate: { latitude: latest.latitude, longitude: latest.longitude } } : null;
    },
  };
}

/** Whether this dog rides with the phone, from its hold-tracker status. */
export function ridesAlong(status, ride, now, config = RIDE_CONFIG) {
  if (!ride?.riding || !status) return false;
  const close = Number.isFinite(status.bleRssi) && status.bleRssi >= config.minRssi
    && within(now - status.bleRssiAt, config.rssiFreshMs, config);
  const blind = status.lastGoodAt == null || now - status.lastGoodAt >= config.noGoodFixMs;
  return close && blind;
}

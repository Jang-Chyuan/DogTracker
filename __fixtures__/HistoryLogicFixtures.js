// A meridian makes synthetic metre displacements exact on the spherical model.
export const point = (seconds, metres = 0, extra = {}) => ({ time: seconds * 1000,
  latitude: 25 + metres / (6371000 * Math.PI / 180), longitude: 121, ...extra });
export const route = (speeds, step = 10) => {
  let metres = 0;
  return [point(0), ...speeds.map((v, i) => { metres += v * step; return point((i + 1) * step, metres); })];
};
export const visitsFixture = () => [
  ...[0, 60, 120, 180, 240].map(t => point(t)),
  ...[300, 330, 360].map(t => point(t, 100)),
  ...[390, 420, 450].map(t => point(t, 200)),
  ...[480, 510, 540].map(t => point(t, 300)),
  ...[570, 600, 630].map(t => point(t, 400)),
];

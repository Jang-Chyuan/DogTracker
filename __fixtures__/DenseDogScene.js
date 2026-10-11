// Independently invented local-metre rings, not translated observations.
export function denseDogScene(count, { two = false, selected = count, mpp = 0.3, pan = 0 } = {}) {
  const n = two ? count / 2 : count;
  const markers = [], points = {};
  for (let i = 0; i < count; i++) {
    const k = i % n, angle = 2 * Math.PI * k / n;
    const radius = 0.25 + 0.7 * ((k * 7) % n) / (n - 1);
    const east = radius * Math.cos(angle) + (two ? (i < n ? -6 : 6) : 0);
    const north = radius * Math.sin(angle);
    const slaveId = i + 1;
    markers.push({ slaveId, name: `Dog ${slaveId}`, tag: `Dog ${slaveId}`, label: `Dog ${slaveId}`,
      size: (slaveId % 7 === 0 ? 48 : 40) + (slaveId === selected ? 8 : 0),
      selected: slaveId === selected, problem: slaveId % 7 === 0,
      coordinate: { latitude: 1 + north / 111000, longitude: 1 + east / 111000 } });
    points[slaveId] = { x: 300 + east / mpp + pan, y: 240 - north / mpp };
  }
  return { markers, points };
}

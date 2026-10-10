// Independently designed phases, not copied or transformed field observations.
// Regular relative clock; each step moves speed × five seconds north. The
// short lights and slow launches challenge the car-to-foot exit clock.
const stepMs = 5000;
const route = phases => {
  let time = 0, north = 0;
  const row = speed => [time, north, 0, north, 0, 8, speed * 3.6, 0.1, speed * 3.6];
  const rows = [row(phases[0][0])];
  for (const [speed, seconds] of phases) {
    for (let elapsed = 0; elapsed < seconds; elapsed += stepMs / 1000) {
      time += stepMs;
      north += speed * stepMs / 1000;
      rows.push(row(speed));
    }
  }
  return rows;
};
export default {
  trafficLights: route([[8, 20], [0, 90], [3.5, 45], [8, 25]]), // 37 points
  terminalParking: route([[8, 20], [0, 70], [8, 10], [3.5, 30], [0, 60], [8, 15]]), // 42 points
};

import { Animated, Easing } from 'react-native';

// A happy dog's wag: a quick burst of swings, a short pause, another burst.
// Each burst is four quick swings (out to one side, across, back, across)
// and back to the middle; the pause holds the tail still in the middle.
export const WAG_MAX_ANGLE = 20;
export const WAG_TIMING = {
  draw: 800,
  angle: WAG_MAX_ANGLE,
  // One side to the other.
  swing: 110,
  swings: 4,
  pause: 380,
};
/** One burst and its pause (ms). */
export const WAG_CYCLE_MS = WAG_TIMING.swing * WAG_TIMING.swings + WAG_TIMING.pause;

// Start only after the finished copy has appeared. Its first frame and the
// native vector's last frame both have a neutral tail. Native-driven holds
// keep the repeating sequence off the JS thread and don't block map work:
// the loop runs on the UI thread from one start.
export function startTailWag(value) {
  const timing = (toValue, duration) =>
    Animated.timing(value, {
      toValue,
      duration,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
      isInteraction: false,
    });
  const { angle, swing, swings, pause } = WAG_TIMING;
  // From the middle out to one side is half a swing; then full swings side
  // to side; the last half brings it back to the middle. The burst totals
  // `swings` swings of time.
  const burst = [timing(angle, swing / 2)];
  for (let i = 1; i < swings; i += 1) burst.push(timing(i % 2 ? -angle : angle, swing));
  burst.push(timing(0, swing / 2));
  const loop = Animated.loop(Animated.sequence([...burst, timing(0, pause)]));
  let stopped = false;
  const timer = setTimeout(() => {
    if (!stopped) loop.start();
  }, WAG_TIMING.draw);
  return () => {
    stopped = true;
    clearTimeout(timer);
    loop.stop();
    value.stopAnimation();
    value.setValue(0);
  };
}

import { Animated, Easing } from 'react-native';

export const WAG_TIMING = { draw: 800, angle: 12, cycle: 900, pause: 400 };

// Start only after the finished copy has appeared. Its first frame and the
// native vector's last frame both have a neutral tail. Native-driven holds
// keep the repeating sequence off the JS thread and don't block map work.
export function startTailWag(value) {
  const timing = (toValue, duration) =>
    Animated.timing(value, {
      toValue,
      duration,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
      isInteraction: false,
    });
  const wag = () => [
    timing(-WAG_TIMING.angle, WAG_TIMING.cycle / 4),
    timing(WAG_TIMING.angle, WAG_TIMING.cycle / 2),
    timing(0, WAG_TIMING.cycle / 4),
  ];
  const loop = Animated.loop(
    Animated.sequence([...wag(), ...wag(), timing(0, WAG_TIMING.pause)]),
  );
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

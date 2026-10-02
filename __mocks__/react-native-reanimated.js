// Minimal Reanimated for jest: shared values are plain boxes, animations land
// at once, styles are computed from the current values. Enough to render the
// home sheet and check its layout and state; the motion itself is checked on
// a phone (DESIGN.md, scripts/fixture-screenshots.sh).
const React = require('react');
const { ScrollView, Text, View, Image } = require('react-native');

const wrap = Component => React.forwardRef((props, ref) => {
  const { entering, exiting, layout, ...rest } = props;
  return React.createElement(Component, { ...rest, ref });
});
const Animated = {
  View: wrap(View), Text: wrap(Text), ScrollView: wrap(ScrollView), Image: wrap(Image),
  createAnimatedComponent: wrap,
};

const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
function interpolate(value, input, output, extrapolation) {
  let i = 1;
  while (i < input.length - 1 && value > input[i]) i += 1;
  const [x0, x1] = [input[i - 1], input[i]];
  const [y0, y1] = [output[i - 1], output[i]];
  let t = x1 === x0 ? 0 : (value - x0) / (x1 - x0);
  if (extrapolation === 'clamp') t = Math.max(0, Math.min(1, t));
  return y0 + (y1 - y0) * t;
}

const useBox = initial => {
  const ref = React.useRef(null);
  if (!ref.current) ref.current = { value: initial };
  return ref.current;
};

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  Extrapolation,
  interpolate,
  useSharedValue: useBox,
  useDerivedValue: fn => ({ get value() { return fn(); } }),
  useAnimatedStyle: fn => fn(),
  useAnimatedScrollHandler: () => () => {},
  useReducedMotion: () => false,
  useFrameCallback: () => {},
  withSpring: (value, _config, callback) => { callback?.(true); return value; },
  cancelAnimation: () => {},
  // Gesture Handler looks for these when it hands gestures to Reanimated.
  isSharedValue: value => !!value && typeof value === 'object' && 'value' in value,
  makeMutable: value => ({ value }),
  useEvent: () => () => {},
  useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }),
  useComposedEventHandler: () => () => {},
  runOnJS: fn => fn,
  runOnUI: fn => fn,
  withTiming: value => value,
};

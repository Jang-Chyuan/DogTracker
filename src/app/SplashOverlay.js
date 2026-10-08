// D0's JavaScript copy and its handover to the map (design 動效「啟動畫面 →
// 地圖」, 「D0 → 地圖銜接（C）」). It draws exactly what the system launch screen
// shows (the whole white sitting dog, finished, centred; light on accent,
// dark on bg with no disc), so the system screen can go the moment the copy
// is drawn, and nothing black or blank shows while the app opens. When the
// map is ready (hideSplash.reportMapFramed) the copy hands over:
//   fly  (dogs on screen): the background fades (280 ms); the body, legs and
//        tail fade (220 ms) while an accent disc fades in behind the head
//        (240 ms); the head shrinks about its own centre and flies to the dog
//        nearest the middle (520 ms, ease-out), becoming its face; the other
//        dogs pop in (0 → 1.12 → 1, 260 ms, from 280 ms / 340 ms); the map's
//        controls fade in from 380 ms. All settled by 600 ms.
//   fade (no dog on screen, D1 / onboarding / failure page, map cannot open,
//        opened from a notification): the copy fades out (300 ms).
// Animations off (animator scale 0): straight to the map; reduce motion: a
// 200 ms crossfade. Taps are ignored until the handover has finished.
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
} from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import DogMarkerView, { markerFrame } from '../map/DogMarkerView';
import {
  finishSplash,
  getSplashState,
  giveUpWaiting,
  hideSplash,
  launchInfo,
  showMarkers,
  splashChrome,
  subscribeSplash,
} from './hideSplash';

// The system launch screen's icon box (res/drawable/splash_icon_animated, a
// 108-unit vector), measured on the device: SPLASH_ICON dp square, centred.
export const SPLASH_ICON = 288;
const VIEW = 108;
// The dog's own coordinates inside the vector (its <group>).
const GROUP = { x: 20.258, y: 13.064, scale: 0.4962 };
// The head's centre and the disc around it, in the dog's coordinates.
export const HEAD = { x: 60, y: 57, r: 47 };
const strokeOf = color => ({
  fill: 'none',
  stroke: color,
  strokeWidth: 5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});
const HEAD_LINES = [
  'M38 37c8-7 36-7 44 0',
  'M39 35C24 35 17 52 21 71c2 7 9 8 12 2 2-5 2-11 4-17',
  'M81 35c15 0 22 17 18 36-2 7-9 8-12 2-2-5-2-11-4-17',
  'M41 78c9 9 29 9 38 0',
  'M54 69q3 4 6 0 3 4 6 0',
];
const BODY_LINES = [
  'M42 90v32c0 6 4 9 9 9s7-3 7-8v-21',
  'M62 104v19c0 5 3 8 8 8s9-3 9-9V92',
  'M88 82c10 12 13 30 8 42-2 5-6 7-12 7',
  'M98 124h9',
  'M100 129h12',
];

export const TIMING = {
  background: 280,
  body: 220,
  disc: 240,
  flight: 520,
  land: 40,
  popStart: [280, 340],
  pop: 260,
  chromeStart: 380,
  chrome: 200,
  settled: 600,
  fade: 300,
  reduced: 200,
};
const easeOut = Easing.bezier(0.2, 0, 0, 1);
const flightEase = Easing.bezier(0.3, 0, 0.1, 1);

function Layer({ children, opacity, size }) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
        <G transform={`translate(${GROUP.x} ${GROUP.y}) scale(${GROUP.scale})`}>
          {children}
        </G>
      </Svg>
    </Animated.View>
  );
}

/** Where the head's centre sits in the icon box, and the head's scale for a face. */
export function flightGeometry(size, target, box) {
  const unit = size / VIEW;
  const head = {
    x: (GROUP.x + GROUP.scale * HEAD.x) * unit,
    y: (GROUP.y + GROUP.scale * HEAD.y) * unit,
  };
  const disc = 2 * HEAD.r * GROUP.scale * unit;
  const scale = target.marker.size / disc;
  // RN scales about the box centre: place the scaled head's centre on the dog.
  const centre = size / 2;
  return {
    scale,
    x: target.x - (box.x + centre + scale * (head.x - centre)),
    y: target.y - (box.y + centre + scale * (head.y - centre)),
  };
}

function MarkerCopy({ target, opacity, scale }) {
  const frame = markerFrame(target.marker.size);
  const faceY = frame.anchor.y * frame.height;
  const lift = faceY - frame.height / 2;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        ...styles.absolute,
        left: target.x - frame.width / 2,
        top: target.y - faceY,
        opacity,
        transform: [{ translateY: lift }, { scale }, { translateY: -lift }],
      }}
    >
      <DogMarkerView
        marker={target.marker}
        tag={target.tag}
        avatar={target.avatar}
      />
    </Animated.View>
  );
}

export default function SplashOverlay() {
  const { colors, isDark } = useTheme();
  const [splash, setSplash] = useState(getSplashState);
  // The screen until the copy has measured itself, so the dog is drawn in
  // the very first frame (the copy covers the whole screen, edge to edge).
  const [box, setBox] = useState(() => {
    const { width, height } = Dimensions.get('screen');
    return { width, height };
  });
  const values = useRef({
    whole: new Animated.Value(1),
    background: new Animated.Value(1),
    body: new Animated.Value(1),
    disc: new Animated.Value(0),
    head: new Animated.Value(1),
    flight: new Animated.Value(0),
    landed: new Animated.Value(0),
    pops: [],
  }).current;
  const reduceMotion = useRef(false);
  useEffect(() => subscribeSplash(setSplash), []);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(value => {
        reduceMotion.current = !!value;
      })
      .catch(() => {});
    // A hang somewhere (nothing ever reported): fade to what is there.
    const timer = setTimeout(giveUpWaiting, 30000);
    return () => clearTimeout(timer);
  }, []);
  const drawn = useRef(false);
  const onLayout = event => {
    const { width, height } = event.nativeEvent.layout;
    setBox({ width, height });
    if (drawn.current) return;
    drawn.current = true;
    // The copy is on screen (a frame later): the system launch screen can go.
    requestAnimationFrame(() => requestAnimationFrame(hideSplash));
  };

  const { phase, mode, targets } = splash;
  // One pop-in value per other dog, made with the targets so the copies are
  // drawn at scale 0 from their first frame.
  if (values.pops.length !== Math.max(0, targets.length - 1))
    values.pops = targets.slice(1).map(() => new Animated.Value(0));
  useEffect(() => {
    if (phase !== 'handover') return;
    const { animatorScale } = launchInfo();
    const timing = (value, toValue, duration, delay = 0, easing = easeOut) =>
      Animated.timing(value, {
        toValue,
        duration,
        delay,
        easing,
        useNativeDriver: true,
      });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      finishSplash();
    };
    if (animatorScale === 0) {
      finish();
      return;
    }
    if (mode !== 'fly' || reduceMotion.current) {
      timing(
        values.whole,
        0,
        reduceMotion.current ? TIMING.reduced : TIMING.fade,
      ).start(finish);
      return;
    }
    // Hidden real markers take a frame to go: start on the next one.
    const pops = values.pops;
    const start = () =>
      Animated.parallel([
        timing(values.background, 0, TIMING.background),
        timing(values.body, 0, TIMING.body),
        timing(values.disc, 1, TIMING.disc),
        timing(values.flight, 1, TIMING.flight, 0, flightEase),
        timing(
          values.head,
          0,
          TIMING.land,
          TIMING.flight - TIMING.land,
          Easing.linear,
        ),
        timing(
          values.landed,
          1,
          TIMING.land,
          TIMING.flight - TIMING.land,
          Easing.linear,
        ),
        ...pops.map((value, index) =>
          Animated.sequence([
            Animated.delay(TIMING.popStart[Math.min(index, 1)]),
            timing(value, 1, TIMING.pop, 0, Easing.linear),
          ]),
        ),
        timing(splashChrome, 1, TIMING.chrome, TIMING.chromeStart),
      ]).start(() => {
        // The copies sit where the real markers are: show those, then go.
        showMarkers();
        setTimeout(finish, 120);
      });
    requestAnimationFrame(() => requestAnimationFrame(start));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === 'done') return null;
  const size = SPLASH_ICON;
  const iconBox = box && {
    x: (box.width - size) / 2,
    y: (box.height - size) / 2,
  };
  const flying = phase === 'handover' && mode === 'fly' && iconBox;
  const geometry = flying && flightGeometry(size, targets[0], iconBox);
  const transform = geometry
    ? [
        {
          translateX: values.flight.interpolate({
            inputRange: [0, 1],
            outputRange: [0, geometry.x],
          }),
        },
        {
          translateY: values.flight.interpolate({
            inputRange: [0, 1],
            outputRange: [0, geometry.y],
          }),
        },
        {
          scale: values.flight.interpolate({
            inputRange: [0, 1],
            outputRange: [1, geometry.scale],
          }),
        },
      ]
    : [];
  return (
    <Animated.View
      testID="splash-overlay"
      // Taps are ignored until the handover has finished.
      pointerEvents="auto"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, styles.layer, { opacity: values.whole }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark ? colors.bg : colors.accent,
            opacity: values.background,
          },
        ]}
      />
      {flying &&
        targets.map((target, index) => (
          <MarkerCopy
            key={target.slaveId}
            target={target}
            opacity={index === 0 ? values.landed : 1}
            scale={
              index === 0
                ? 1
                : values.pops[index - 1].interpolate({
                    inputRange: [0, 0.7, 1],
                    outputRange: [0, 1.12, 1],
                  })
            }
          />
        ))}
      {iconBox && (
        <Animated.View
          testID="splash-dog"
          style={{
            ...styles.absolute,
            left: iconBox.x,
            top: iconBox.y,
            width: size,
            height: size,
            // The disc and the head go together as the dog's face takes over.
            opacity: values.head,
            transform,
          }}
        >
          <Layer size={size} opacity={values.disc}>
            <Circle cx={HEAD.x} cy={HEAD.y} r={HEAD.r} fill={colors.accent} />
          </Layer>
          <Layer size={size} opacity={values.body}>
            <G {...strokeOf(colors.splashLine)}>
              {BODY_LINES.map(d => (
                <Path key={d} d={d} />
              ))}
            </G>
          </Layer>
          <Layer size={size} opacity={1}>
            <G {...strokeOf(colors.splashLine)}>
              {HEAD_LINES.map(d => (
                <Path key={d} d={d} />
              ))}
            </G>
            <G fill={colors.splashLine}>
              <Circle cx={49} cy={58} r={3.4} />
              <Circle cx={71} cy={58} r={3.4} />
              <Path d="M56.158 64.5a3.842 2.822 0 1 0 7.684 0a3.842 2.822 0 1 0 -7.684 0" />
            </G>
          </Layer>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 1000, elevation: 1000 },
  absolute: { position: 'absolute' },
});

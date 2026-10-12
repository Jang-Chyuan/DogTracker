import { t } from '../i18n';
import { size as sizes, border, type } from '../theme/tokens';
import { useTheme, useStyles, makeStyles } from '../theme/ThemeProvider';
import { useEffect, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';

import MapNameTag from './MapNameTag';
import { MARKER_WIDTH } from './DogMarkerView';

import { locationTrackerNative } from '../locationTracker/LocationTrackerService';
import { withAlpha } from '../history/screen/HistoryMapModel';
import { stablePhoneDisplay } from './PhoneDisplayPosition';
import { useLivePhone } from './LivePhoneFeed';

// Publish only live display coordinates to native memory; the recorder owns SQLite cadence.
export default function PhoneLocationOverlay({
  location: shownLocation,
  active = true,
  historical = false,
  phoneProblem = false,
  onPress,
  Circle,
  Marker,
  // The live map's feed of every snapshot (LivePhoneFeed): the dot follows
  // each fix without re-rendering the map around it.
  feed = null,
}) {
  const { colors, opacity, isDark, literalColors } = useTheme();
  const styles = useStyles(getStyles);
  const location = useLivePhone(feed, shownLocation);
  // The callout's fix time comes from the map's copy: the feed's would change
  // the marker's text, and have Google redraw the map, every second.
  const described = shownLocation?.position ?? location.position;
  const { position, ageSeconds } = location;
  // Age still fences animation/native display publication, never the dot colour.
  const stale = !historical && (ageSeconds == null || ageSeconds > 3);
  const muted = !historical && (phoneProblem || location.running === false);
  const target = { latitude: position.latitude, longitude: position.longitude };
  const [coordinate, setCoordinate] = useState(target);
  const current = useRef(target);
  const previousTime = useRef(null);
  const previousSession = useRef(location.sessionId);
  const marker = useRef(null);
  const publishDisplay = () => {
    if (
      historical ||
      !active ||
      stale ||
      phoneProblem ||
      !location.running ||
      !location.sessionId
    )
      return undefined;
    const publish = () =>
      locationTrackerNative?.displayPosition?.(
        location.sessionId,
        position.timestamp,
        current.current.latitude,
        current.current.longitude,
      );
    // Runs after each rendered animation frame; no SQLite work occurs here.
    publish();
    const timer = setInterval(publish, 100);
    return () => {
      clearInterval(timer);
      locationTrackerNative?.clearDisplayPosition?.(location.sessionId);
    };
  };
  useEffect(() => {
    const destination = {
      latitude: position.latitude,
      longitude: position.longitude,
    };
    const previous = previousTime.current;
    const sessionChanged = previousSession.current !== location.sessionId;
    previousSession.current = location.sessionId;
    previousTime.current = position.timestamp;
    const publish = value => {
      current.current = value;
      setCoordinate(value);
    };
    if (
      !active ||
      stale ||
      (!historical && (phoneProblem || location.running !== true)) ||
      sessionChanged ||
      position.motionState === 'stationary' ||
      previous == null ||
      position.timestamp - previous > (historical ? 120000 : 3000) ||
      position.timestamp < previous
    ) {
      publish(destination);
      return undefined;
    }
    if (!historical)
      Object.assign(
        destination,
        stablePhoneDisplay(current.current, {
          latitude: position.latitude,
          longitude: position.longitude,
          rawSpeedKmh: position.rawSpeedKmh,
          accuracy: position.accuracy,
        }),
      );
    const from = current.current;
    if (
      from.latitude === destination.latitude &&
      from.longitude === destination.longitude
    )
      return undefined;
    const duration = position.rawSpeedKmh > 20 ? 300 : 800;
    const started = Date.now();
    const longitudeDelta =
      ((destination.longitude - from.longitude + 540) % 360) - 180;
    const timer = setInterval(() => {
      const fraction = Math.min(1, (Date.now() - started) / duration);
      publish(
        fraction === 1
          ? destination
          : {
              latitude:
                from.latitude +
                (destination.latitude - from.latitude) * fraction,
              longitude:
                ((from.longitude + longitudeDelta * fraction + 540) % 360) -
                180,
            },
      );
      if (fraction === 1) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [
    active,
    stale,
    historical,
    phoneProblem,
    location.running,
    location.sessionId,
    position.latitude,
    position.longitude,
    position.timestamp,
    position.motionState,
    position.rawSpeedKmh,
    position.accuracy,
  ]);
  // Reset stale/session coordinates before attaching a new fix timestamp.
  useEffect(publishDisplay, [
    historical,
    active,
    stale,
    phoneProblem,
    location.running,
    location.sessionId,
    position.timestamp,
  ]);
  useEffect(() => {
    marker.current?.redraw?.();
  }, [muted, colors]);
  const height =
    sizes.phoneDot.canvas +
    sizes.marker.labelGap +
    type.mapLabel.lineHeight *
      (PixelRatio.getFontScale?.() || 1) *
      sizes.mapLabel.maxLines +
    2 * (sizes.mapLabel.paddingV + sizes.mapLabel.border);
  const title = historical
    ? t("c767")
    : stale || muted
    ? t('c055')
    : position.motionState === 'stationary'
    ? t("c769")
    : t("c770");
  return (
    <>
      {!historical &&
        Number.isFinite(position.accuracy) &&
        position.accuracy >= 0 && (
          <Circle
            center={coordinate}
            radius={position.accuracy}
            fillColor={
              isDark
                ? withAlpha(
                    muted ? colors.phoneStale : colors.phone,
                    opacity.phoneAccuracy,
                  )
                : muted
                ? literalColors.stalePhoneAccuracyFill
                : literalColors.phoneAccuracyFill
            }
            strokeColor={
              isDark
                ? withAlpha(muted ? colors.phoneStale : colors.phone, 0.4)
                : muted
                ? literalColors.stalePhoneAccuracyStroke
                : literalColors.phoneAccuracyStroke
            }
            strokeWidth={1}
            zIndex={2}
          />
        )}
      <Marker
        ref={marker}
        identifier={historical ? 'phone-history-last' : 'phone-timeline-live'}
        coordinate={coordinate}
        anchor={{ x: 0.5, y: sizes.phoneDot.canvas / 2 / height }}
        tracksViewChanges={false}
        zIndex={historical ? 25 : 30}
        onPress={onPress}
        title={onPress ? undefined : title}
        description={
          onPress
            ? undefined
            : historical
            ? ((position.rawSpeedKmh == null) ? t("c723", { value: new Date(position.timestamp).toLocaleString() }) : t("c724", { value: new Date(position.timestamp).toLocaleString(), value2: position.rawSpeedKmh.toFixed(1) + ' km/h' }))
            : t("c766", { value: described.accuracy.toFixed(1), value2: new Date(
                described.timestamp,
              ).toLocaleTimeString() })
        }
      >
        <View
          collapsable={false}
          style={[styles.container, { height }]}
          onLayout={() => marker.current?.redraw?.()}
        >
          <View style={styles.dotArea}>
            <View testID="phone-location-dot" style={[styles.dot, muted && styles.stale]} />
          </View>
          <MapNameTag
            text={t('c055')}
            testID="phone-name-tag"
            color={colors.phone}
            maxWidth={MARKER_WIDTH - sizes.marker.labelSafety}
            onLayout={() => marker.current?.redraw?.()}
          />
        </View>
      </Marker>
    </>
  );
}

const getStyles = makeStyles(theme => {
  const { literalColors: themeLiteral } = theme;
  return StyleSheet.create({
    container: {
      width: MARKER_WIDTH,
      alignItems: 'center',
    },
    dotArea: {
      height: sizes.phoneDot.canvas,
      marginBottom: sizes.marker.labelGap,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      width: sizes.phoneDot.liveDisc,
      height: sizes.phoneDot.liveDisc,
      borderRadius: sizes.phoneDot.liveDisc / 2,
      borderWidth: border.heavy,
      borderColor: themeLiteral.avatarFrameMap,
      backgroundColor: themeLiteral.phoneDot,
    },
    stale: { backgroundColor: themeLiteral.stalePhoneDot },
  });
});

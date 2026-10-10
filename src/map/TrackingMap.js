import { logger } from '../logger';
import { makeStyles, resolveStyles } from '../theme/ThemeProvider';
import React from 'react';
import { StyleSheet, View } from 'react-native';

export const MAP_LOAD_TIMEOUT_MS = 15000;

/**
 * @typedef {Object} TrackingMapRendererProps
 * @property {string} source
 * @property {Object} presentation
 * @property {number} topInset
 * @property {number} bottomInset
 * @property {boolean} supported
 * @property {boolean} configured
 * @property {boolean} foreground
 * @property {boolean} dataReady
 * @property {boolean} framingReady  false while what is framed is still unknown
 * @property {boolean} phoneEnabled
 * @property {Object} [today]  「今天 x km」 (TodayDistance.todayPill), drawn beside 我的位置
 * @property {Function} [onToday]
 *
 * A provider renderer receives only provider-neutral presentation and UI state.
 * It must not query SQLite or reinterpret route and fallback rules.
 */

export function createMapProviderDefinition({
  id,
  Renderer,
  isSupported = () => true,
  isConfigured = () => true,
}) {
  if (!id || typeof id !== 'string')
    throw new TypeError('map provider id is required');
  if (typeof Renderer !== 'function')
    throw new TypeError('map provider Renderer is required');
  if (typeof isSupported !== 'function' || typeof isConfigured !== 'function')
    throw new TypeError('map provider checks must be functions');
  return Object.freeze({
    id,
    Renderer,
    isSupported,
    isConfigured,
  });
}

/** The single provider-to-renderer adapter used by screen code. */
export default function TrackingMap({ provider, ...props }) {
  if (!provider) throw new TypeError('map provider is required');
  const { Renderer, isSupported, isConfigured } = provider;
  if (
    typeof Renderer !== 'function' ||
    typeof isSupported !== 'function' ||
    typeof isConfigured !== 'function'
  )
    throw new TypeError('invalid map provider definition');
  const supported = isSupported();
  const configured = supported && isConfigured();
  return (
    // 重試 (a new retryKey) opens a map that failed to open again.
    <MapBoundary retryKey={props.retryKey ?? 0} onMapState={props.onMapState}>
      <Renderer {...props} supported={supported} configured={configured} />
    </MapBoundary>
  );
}

/**
 * A map that throws while opening is 「地圖打不開」: grey, with the top card
 * (TopAlerts) saying so, instead of taking the whole app down.
 */
class MapBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.retryKey !== this.props.retryKey)
      this.setState({ failed: false });
  }
  componentDidCatch(error) {
    logger.warn('[Map] could not open', error?.message);
    this.props.onMapState?.('unavailable');
  }
  render() {
    const styles = resolveStyles(getStyles);
    if (this.state.failed)
      return <View testID="map-unavailable" style={styles.fallback} />;
    return this.props.children;
  }
}

const getStyles = makeStyles(theme => {
  const { colors } = theme;
  return StyleSheet.create({
    fallback: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.mapFallback,
    },
  });
});

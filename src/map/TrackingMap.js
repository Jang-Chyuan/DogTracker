import React from 'react';

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
 * @property {boolean} phoneEnabled
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
  return <Renderer {...props} supported={supported} configured={configured} />;
}

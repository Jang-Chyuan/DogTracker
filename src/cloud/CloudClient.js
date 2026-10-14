/* global globalThis */
import { t } from '../i18n';
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { cloudConfig } from './CloudConfig';
import { createCloudSecureStorage } from './CloudSecureStorage';
import { cloudDiagnosticFetch } from '../diagnostics/CloudAttemptDiagnostics';
import { serverClockFetch } from './ServerClock';

let client;
export function getCloudClient() {
  if (!client) {
    if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(cloudConfig.url) ||
        !cloudConfig.publishableKey.startsWith('sb_publishable_')) {
      throw new Error(t("c530"));
    }
    client = createClient(cloudConfig.url, cloudConfig.publishableKey, {
      auth: { storage: createCloudSecureStorage(), persistSession: true,
        autoRefreshToken: true, detectSessionInUrl: false },
      // Every response's Date header feeds the server clock (ServerClock).
      global: { fetch: serverClockFetch(cloudDiagnosticFetch(globalThis.fetch)) },
    });
  }
  return client;
}

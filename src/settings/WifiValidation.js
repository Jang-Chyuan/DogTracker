import { t } from '../i18n';
// Matches the existing receiver protocol: empty password means open network.
export const MAX_WIFI_COMMAND_BYTES = 512;
export const utf8Bytes = value => unescape(encodeURIComponent(value)).length;
export function validateSsid(ssid) {
  if (typeof ssid !== 'string' || !ssid.trim()) throw new Error(t("c1035"));
  if (utf8Bytes(ssid) > 32) throw new Error(t("c1036"));
}
export function wifiCommand(action, ssid, password) {
  validateSsid(ssid);
  if (action === 'upsert' && (typeof password !== 'string' ||
    (password !== '' && !/^[\x20-\x7e]{8,63}$/.test(password) && !/^[0-9a-fA-F]{64}$/.test(password)))) {
    throw new Error(t("c1037"));
  }
  const command = JSON.stringify(action === 'upsert' ? { action, ssid, password } : { action, ssid });
  if (utf8Bytes(command) > MAX_WIFI_COMMAND_BYTES) throw new Error(t("c1038"));
  return command;
}

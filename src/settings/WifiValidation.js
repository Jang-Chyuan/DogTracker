// Matches the existing receiver protocol: empty password means open network.
export const MAX_WIFI_COMMAND_BYTES = 512;
export const utf8Bytes = value => unescape(encodeURIComponent(value)).length;
export function validateSsid(ssid) {
  if (typeof ssid !== 'string' || !ssid.trim()) throw new Error('請輸入 Wi-Fi 名稱');
  if (utf8Bytes(ssid) > 32) throw new Error('Wi-Fi 名稱太長，請限制在 32 位元組內');
}
export function wifiCommand(action, ssid, password) {
  validateSsid(ssid);
  if (action === 'upsert' && (typeof password !== 'string' ||
    (password !== '' && !/^[\x20-\x7e]{8,63}$/.test(password) && !/^[0-9a-fA-F]{64}$/.test(password)))) {
    throw new Error('Wi-Fi 密碼請輸入 8～63 個英數字或符號，或 64 位十六進位金鑰；開放網路請留空');
  }
  const command = JSON.stringify(action === 'upsert' ? { action, ssid, password } : { action, ssid });
  if (utf8Bytes(command) > MAX_WIFI_COMMAND_BYTES) throw new Error('Wi-Fi 設定太長，請縮短後再試一次');
  return command;
}

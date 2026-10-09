import { t as i18nT } from '../src/i18n';
import { wifiCommand, utf8Bytes, MAX_WIFI_COMMAND_BYTES } from '../src/settings/WifiValidation';
import { parseMasterQr, MASTER_SERVICE_UUID } from '../src/qr/MasterQrParser';
test('Wi-Fi UTF-8 boundaries and supported password modes preserve wire format', () => {
  expect(utf8Bytes(i18nT('c233'))).toBe(3);
  expect(wifiCommand('upsert', i18nT('c233').repeat(10) + 'ab', '')).toBe(JSON.stringify({ action: 'upsert', ssid: i18nT('c233').repeat(10) + 'ab', password: '' }));
  expect(() => wifiCommand('upsert', '狗'.repeat(11), '')).toThrow('32');
  for (const password of ['12345678', 'a'.repeat(63), 'F'.repeat(64), '']) expect(() => wifiCommand('upsert', 'net', password)).not.toThrow();
  for (const password of ['short', 'z'.repeat(64), 'a'.repeat(65), '中文密碼中文密碼']) expect(() => wifiCommand('upsert', 'net', password)).toThrow('密碼');
  expect(() => wifiCommand('remove', '', '')).toThrow();
  expect(utf8Bytes(wifiCommand('upsert', '\u0001'.repeat(32), 'a'.repeat(63)))).toBeLessThanOrEqual(MAX_WIFI_COMMAND_BYTES);
});
test('QR identity and profile are bounded and allowlisted', () => {
  const qr = { v: 1, masterId: 7, bleName: 'DogGPS-Master7', serviceUuid: MASTER_SERVICE_UUID };
  const parse = extra => parseMasterQr(JSON.stringify({ ...qr, ...extra }));
  expect(parse({}).profile).toBe('default');
  expect(() => parse({ bleName: 'DogGPS-Master8' })).toThrow('不一致');
  for (const profile of ['other', 'a'.repeat(17), {}, ' default ']) expect(() => parse({ profile })).toThrow();
  expect(() => parseMasterQr(' '.repeat(1025))).toThrow();
});

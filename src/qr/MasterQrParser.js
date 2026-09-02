export const MASTER_QR_VERSION = 1;
export const MASTER_SERVICE_UUID = '7f510001-6d9e-4e2f-a671-8f3f2d49a001';

const normalizeUuid = value => value.trim().toLowerCase();

export function parseMasterQr(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new Error('QR Code 內容為空');
  }

  let config;
  try {
    config = JSON.parse(rawValue);
  } catch {
    throw new Error('不是有效的 Master QR Code');
  }

  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error('Master QR Code 格式錯誤');
  }

  if (config.v !== MASTER_QR_VERSION) {
    throw new Error(`不支援 QR Code 版本：${config.v ?? '未指定'}`);
  }

  if (!Number.isInteger(config.masterId) || config.masterId < 1 || config.masterId > 255) {
    throw new Error('Master ID 必須是 1 到 255 的整數');
  }

  if (
    typeof config.bleName !== 'string' ||
    !/^DogGPS-Master[0-9]+$/.test(config.bleName)
  ) {
    throw new Error('BLE 裝置名稱格式錯誤');
  }

  if (typeof config.serviceUuid !== 'string') {
    throw new Error('缺少 BLE Service UUID');
  }

  const serviceUuid = normalizeUuid(config.serviceUuid);
  if (serviceUuid !== MASTER_SERVICE_UUID) {
    throw new Error('BLE Service UUID 不符合 DogTracker');
  }

  if (config.profile !== undefined && typeof config.profile !== 'string') {
    throw new Error('Profile 格式錯誤');
  }

  return {
    version: config.v,
    masterId: config.masterId,
    bleName: config.bleName,
    serviceUuid,
    profile: config.profile?.trim() || 'default',
  };
}

import { t } from '../i18n';
export const MASTER_QR_VERSION = 1;
export const MASTER_SERVICE_UUID = '7f510001-6d9e-4e2f-a671-8f3f2d49a001';

const normalizeUuid = value => value.trim().toLowerCase();

export function parseMasterQr(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new Error(t("c884"));
  }

  if (rawValue.length > 1024) throw new Error(t("c888"));

  let config;
  try {
    config = JSON.parse(rawValue);
  } catch {
    throw new Error(t("c889"));
  }

  if (!config || Array.isArray(config) || typeof config !== 'object') {
    throw new Error(t("c890"));
  }

  if (config.v !== MASTER_QR_VERSION) {
    throw new Error(t("c891", { value: config.v ?? t("c892") }));
  }

  if (!Number.isInteger(config.masterId) || config.masterId < 1 || config.masterId > 255) {
    throw new Error(t("c893"));
  }

  if (
    typeof config.bleName !== 'string' ||
    !/^DogGPS-Master[0-9]+$/.test(config.bleName)
  ) {
    throw new Error(t("c894"));
  }

  if (config.bleName !== `DogGPS-Master${config.masterId}`) {
    throw new Error(t("c895"));
  }

  if (typeof config.serviceUuid !== 'string') {
    throw new Error(t("c885"));
  }

  const serviceUuid = normalizeUuid(config.serviceUuid);
  if (serviceUuid !== MASTER_SERVICE_UUID) {
    throw new Error(t("c886"));
  }

  if (config.profile !== undefined && (typeof config.profile !== 'string' || config.profile.length > 16 || !['default'].includes(config.profile))) {
    throw new Error(t("c887"));
  }

  return {
    version: config.v,
    masterId: config.masterId,
    bleName: config.bleName,
    serviceUuid,
    profile: config.profile?.trim() || 'default',
  };
}

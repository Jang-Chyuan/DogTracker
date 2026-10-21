import { t } from '../i18n';

// What a held dog is called (2026-10-19, the user's decision): on its charger
// 「充電中」, held for any other reason — the model's indoor or window, weak
// GPS, no fix at all — 「遮蔽處」: the collar may be under a roof, a pavilion
// or a tree, and the app cannot tell which. 「室內」 is no longer said of a
// dog; only the diagnostics keep the model's own words. Judged from the
// reason when shown, so a reason recorded before this (「室內」) reads
// 「遮蔽處」 too.
export const isChargingHold = reason => reason === t('c731');
export const holdWord = reason => (isChargingHold(reason) ? t('c731') : t('c1431'));

import { t } from '../i18n';
// A dog's name as edited on its page (design v3 A5a, 判定表「A5a 名字輸入」
// 「A5a 名字清空時」): at most 20 characters; a name that is empty or only
// spaces is never saved — the dog keeps the name it had (「狗 4」 if it never
// had one), with no error.

export const NAME_MAX = 20;

// Characters as the user sees them (an emoji is one, not two UTF-16 units).
export const nameLength = text => Array.from(text || '').length;

/** What the input may hold: cut at 20 characters, never mid-emoji. */
export function clampName(text) {
  const characters = Array.from(text || '');
  return characters.length > NAME_MAX ? characters.slice(0, NAME_MAX).join('') : (text || '');
}

/** 「小黑」, or 「狗 4」 for a dog nobody has named. */
export function displayName(slaveId, aliases) {
  const alias = aliases?.[slaveId]?.trim();
  return alias || t("c1009", { slaveId: slaveId });
}

/**
 * What finishing an edit does. `typed` is the input's text, `saved` the name
 * stored now ('' when none). Returns the name to store, or null to store
 * nothing (empty, only spaces, or unchanged).
 */
export function nameToSave(typed, saved) {
  const name = clampName(typed).trim();
  if (!name || name === (saved || '').trim()) return null;
  return name;
}

export function normalizeDogAliases(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([id, alias]) => /^[1-9]\d*$/.test(id) && typeof alias === 'string')
    .map(([id, alias]) => [id, alias.trim().slice(0, 20)])
    .filter(([, alias]) => alias));
}

// Keep the device number visible and unique even when aliases are identical.
export function dogHistoryLabel(id, aliases) {
  const alias = aliases?.[id]?.trim();
  return alias ? `${alias} 狗 ${id}` : `狗 ${id}`;
}

// Map labels omit the appended device number; track identity remains unique.
export function dogMapLabel(label) {
  return label?.replace(/ 狗 \d+$/, '');
}

import resources from './zh-TW.json';

// A single-language i18next-compatible subset while npm is unavailable.
// Interpolation deliberately preserves raw text (React escapes at rendering).
export function t(key, params = {}) {
  const template = resources[key];
  if (typeof template !== 'string') throw new Error(`Missing translation: ${key}`);
  return template.replace(/\{\{([^{}]+)\}\}/g, (placeholder, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder,
  );
}

export const useTranslation = () => ({ t, i18n: { language: 'zh-TW' } });
export default { t, language: 'zh-TW' };

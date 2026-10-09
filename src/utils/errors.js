import { t } from '../i18n';
// Native modules may reject with an Error, a message object, or a string.
// Never turn an unknown rejection into a blank (and therefore hidden) UI error.
export function getErrorMessage(error, fallback = t("c1049")) {
  const message = typeof error === 'string' ? error : error?.message;
  return typeof message === 'string' && message.trim()
    ? message.trim()
    : fallback;
}

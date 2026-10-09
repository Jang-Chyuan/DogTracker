// Sensitive details are available only in development builds.
const emit = (level, args) => { if (typeof __DEV__ !== 'undefined' && __DEV__) console[level](...args); };
export const logger = Object.fromEntries(['log', 'info', 'warn', 'error'].map(level => [level, (...args) => emit(level, args)]));

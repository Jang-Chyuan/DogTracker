// Under jest every "thread" is the JS thread.
module.exports = {
  scheduleOnRN: (fn, ...args) => fn(...args),
  scheduleOnUI: (fn, ...args) => fn(...args),
  runOnJS: fn => fn,
  runOnUI: fn => fn,
};

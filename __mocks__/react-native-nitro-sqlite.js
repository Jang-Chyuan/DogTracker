const executeAsync = jest.fn(async () => ({ insertId: 1, results: [] }));
const close = jest.fn();
const executeBatchAsync = jest.fn(async () => ({}));

export const open = jest.fn(() => ({
  close,
  executeAsync,
  executeBatchAsync,
}));

export const mockDatabase = {
  close,
  executeAsync,
  executeBatchAsync,
};

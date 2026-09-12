const executeAsync = jest.fn(async () => ({ insertId: 1, results: [] }));
const close = jest.fn();

export const open = jest.fn(() => ({
  close,
  executeAsync,
}));

export const mockDatabase = {
  close,
  executeAsync,
};

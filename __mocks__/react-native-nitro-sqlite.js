export const open = jest.fn(() => ({
  executeAsync: jest.fn(async () => ({ results: [], insertId: 1 })),
  close: jest.fn(),
}));

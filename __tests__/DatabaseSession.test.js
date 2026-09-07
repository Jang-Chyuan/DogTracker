import { createDatabaseSessionQueue } from '../src/database/DatabaseSession';

describe('database session ownership errors', () => {
  test('close is idempotent and the next owner waits for async disposal', async () => {
    const queue = createDatabaseSessionQueue();
    let finish;
    const disposal = new Promise(resolve => {
      finish = resolve;
    });
    const dispose = jest.fn(() => disposal);
    const first = queue.open(() => dispose);
    await first.ready;
    const setup = jest.fn();
    const second = queue.open(setup);
    const closing = first.close();
    expect(first.close()).toBe(closing);
    await Promise.resolve();
    expect(setup).not.toHaveBeenCalled();
    finish();
    await closing;
    await second.ready;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(1);
    await second.close();
  });

  test('cancelling a waiting owner never opens its connection', async () => {
    const queue = createDatabaseSessionQueue();
    const first = queue.open(() => jest.fn());
    await first.ready;
    const setup = jest.fn();
    const cancelled = queue.open(setup);
    const closing = cancelled.close();
    await first.close();
    await closing;
    expect(setup).not.toHaveBeenCalled();
  });

  test('a setup rejection is reported by ready, not misreported as close failure', async () => {
    const queue = createDatabaseSessionQueue();
    const first = queue.open(() => {
      throw new Error('open failed');
    });
    await expect(first.ready).rejects.toThrow('open failed');
    await expect(first.close()).resolves.toBeUndefined();
    const setup = jest.fn();
    const second = queue.open(setup);
    await second.ready;
    expect(setup).toHaveBeenCalledTimes(1);
    await second.close();
  });

  test('failed close blocks later opens instead of reusing unknown native state', async () => {
    const queue = createDatabaseSessionQueue();
    const dispose = jest.fn(async () => {
      throw new Error('close failed');
    });
    const first = queue.open(() => dispose);
    await first.ready;
    const setup = jest.fn();
    const second = queue.open(setup);
    await Promise.all([
      expect(first.close()).rejects.toThrow('close failed'),
      expect(second.ready).rejects.toThrow('請完整關閉並重新啟動 App'),
    ]);
    expect(setup).not.toHaveBeenCalled();
    await second.close();
    const third = queue.open(setup);
    await expect(third.ready).rejects.toThrow('請完整關閉並重新啟動 App');
    expect(setup).not.toHaveBeenCalled();
    await third.close();
  });
});

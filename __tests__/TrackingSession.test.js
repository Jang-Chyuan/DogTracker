import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useTrackingSession } from '../src/app/useTrackingSession';
import {
  dogStatusRow,
  trackingPoint,
} from '../__fixtures__/TrackingPointFixtures';
import { createDemoRow } from '../__fixtures__/DemoRowFixtures';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function databases() {
  return {
    settings: {
      initialize: jest.fn(async () => {}),
      load: jest.fn(async () => ({ mode: 'real' })),
      save: jest.fn(async () => {}),
    },
    real: {
      initialize: jest.fn(async () => {}),
      getLatestStatusRow: jest.fn(async () => null),
      listStatusRowsAfterId: jest.fn(async () => []),
      listStatusRowsByTimeCursor: jest.fn(async () => []),
      listLatestStatusRowsByTimeCursor: jest.fn(async () => []),
      getLatestValidStatusRows: jest.fn(async () => []),
      saveStatus: jest.fn(async () => 1),
    },
    demo: {
      initialize: jest.fn(async () => {}),
      getLatestRow: jest.fn(async () => null),
      listRowsAfterId: jest.fn(async () => []),
      listRowsByTimeCursor: jest.fn(async () => []),
      listLatestRowsByTimeCursor: jest.fn(async () => []),
      getLatestValidRows: jest.fn(async () => []),
      insertRow: jest.fn(async () => 1),
      ensureSeed: jest.fn(async () => {}),
      resetToSeed: jest.fn(async () => {}),
      getSummary: jest.fn(async () => ({ count: 3, latestPreset: 'C' })),
    },
    close: jest.fn(),
  };
}

describe('tracking session and connection lifetime', () => {
  let session;
  let renderer;
  function Harness({ factory }) {
    session = useTrackingSession(factory);
    return null;
  }
  async function mount(db) {
    const factory = () => db;
    await act(async () => {
      renderer = ReactTestRenderer.create(<Harness factory={factory} />);
    });
  }
  async function tick() {
    await act(async () => jest.advanceTimersByTimeAsync(1000));
  }
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(global, 'setInterval');
    jest.spyOn(global, 'clearInterval');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    if (renderer)
      await act(async () => {
        renderer.unmount();
      });
    renderer = null;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('no automatic Demo commands or writer remain in the session', async () => {
    const db = databases();
    await mount(db);
    expect(session).not.toHaveProperty('startDemo');
    expect(session).not.toHaveProperty('stopDemo');
    expect(session).not.toHaveProperty('demoRunning');
    await act(async () => session.setDemoMode(true));
    await tick();
    const onAppState = AppState.addEventListener.mock.calls[0][1];
    await act(async () => onAppState('background'));
    await tick();
    await act(async () => onAppState('active'));
    await tick();
    await act(async () => session.setDemoMode(false));
    await tick();
    expect(db.demo.insertRow).not.toHaveBeenCalled();
    expect(db.demo.resetToSeed).not.toHaveBeenCalled();
    expect(db.real.saveStatus).not.toHaveBeenCalled();
  });

  test('effect replay drains old hardware writes and closes before reopening', async () => {
    const first = databases();
    const second = databases();
    const write = deferred();
    first.real.saveStatus.mockReturnValue(write.promise);
    const order = [];
    first.close.mockImplementation(() => order.push('close first'));
    const factory1 = jest.fn(() => {
      order.push('open first');
      return first;
    });
    const factory2 = jest.fn(() => {
      order.push('open second');
      return second;
    });
    await act(async () => {
      renderer = ReactTestRenderer.create(<Harness factory={factory1} />);
    });
    const writing = session.saveRealStatus(trackingPoint, null);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      renderer.update(<Harness factory={factory2} />);
    });
    expect(first.close).not.toHaveBeenCalled();
    expect(factory2).not.toHaveBeenCalled();
    await act(async () => {
      write.resolve(1);
      await writing;
    });
    expect(order).toEqual(['open first', 'close first', 'open second']);
    expect(session.ready).toEqual({ real: true, demo: true });
  });

  test('effect replay also waits for an in-flight Demo reset', async () => {
    const first = databases();
    const second = databases();
    const clearing = deferred();
    first.demo.resetToSeed.mockReturnValue(clearing.promise);
    const factory1 = () => first;
    const factory2 = jest.fn(() => second);
    await act(async () => {
      renderer = ReactTestRenderer.create(<Harness factory={factory1} />);
    });
    let reset;
    await act(async () => {
      reset = session.resetDemo();
    });
    expect(first.demo.resetToSeed).toHaveBeenCalled();
    await act(async () => {
      renderer.update(<Harness factory={factory2} />);
    });
    expect(factory2).not.toHaveBeenCalled();
    await act(async () => {
      clearing.resolve();
      await reset;
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(factory2).toHaveBeenCalledTimes(1);
    expect(session.mode).toBe('real');
  });

  test('a full component remount waits for the old connection owner too', async () => {
    const first = databases();
    const second = databases();
    const write = deferred();
    first.real.saveStatus.mockReturnValue(write.promise);
    const factory1 = () => first;
    const factory2 = jest.fn(() => second);
    await act(async () => {
      renderer = ReactTestRenderer.create(<Harness factory={factory1} />);
    });
    const writing = session.saveRealStatus(trackingPoint, null);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      renderer.unmount();
      renderer = ReactTestRenderer.create(<Harness factory={factory2} />);
    });
    expect(factory2).not.toHaveBeenCalled();
    expect(first.close).not.toHaveBeenCalled();
    await act(async () => {
      write.resolve(1);
      await writing;
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(factory2).toHaveBeenCalledTimes(1);
    expect(session.ready.real).toBe(true);
  });

  test('Strict Mode does not share an already-closed connection with its replay', async () => {
    const db = databases();
    const factory = jest.fn(() => db);
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <React.StrictMode>
          <Harness factory={factory} />
        </React.StrictMode>,
      );
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(db.close).not.toHaveBeenCalled();
    expect(session.ready.real).toBe(true);
    await act(async () => {
      renderer.unmount();
    });
    renderer = null;
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(clearInterval).toHaveBeenCalledWith(
      setInterval.mock.results[0].value,
    );
    await expect(session.saveRealStatus(trackingPoint, null)).rejects.toThrow(
      'closed',
    );
  });

  test('reports a failed native open without starting a feed or Demo', async () => {
    const factory = () => {
      throw new Error('cannot open SQLite');
    };
    await act(async () => {
      renderer = ReactTestRenderer.create(<Harness factory={factory} />);
    });
    expect(session.errors.real).toBe('cannot open SQLite');
    expect(session.errors.demo).toBe('cannot open SQLite');
    expect(session.demoBusy).toBe(false);
    expect(setInterval).not.toHaveBeenCalled();
  });

  test('clears a read error on a successful empty incremental query without losing the point', async () => {
    const db = databases();
    db.real.getLatestStatusRow.mockResolvedValue(dogStatusRow);
    await mount(db);
    db.real.listStatusRowsAfterId.mockRejectedValueOnce(
      new Error('temporary lock'),
    );
    await tick();
    expect(session.errors.real).toBe('temporary lock');
    await tick();
    // B reads the latest row only at startup; history backfill belongs to C.
    expect(db.real.listStatusRowsAfterId).toHaveBeenCalledTimes(2);
    expect(session.errors.real).toBeNull();
    expect(session.point.id).toBe(dogStatusRow.id);
  });

  test('recovers a Demo read error while the table is empty', async () => {
    const db = databases();
    await mount(db);
    db.demo.getLatestRow.mockRejectedValueOnce(
      new Error('temporary Demo lock'),
    );
    await act(async () => session.setDemoMode(true));
    expect(session.errors.demo).toBe('temporary Demo lock');
    await tick();
    expect(session.errors.demo).toBeNull();
    expect(session.demoPoint.id).toBeNull();
    expect(db.demo.insertRow).not.toHaveBeenCalled();
  });

  test('unknown rejections stay visible, and repeated polling errors do not flood logs', async () => {
    const db = databases();
    db.real.getLatestStatusRow.mockRejectedValue(null);
    await mount(db);
    expect(session.errors.real).toBe('發生未知錯誤，請重試。');
    const logged = console.error.mock.calls.length;
    await tick();
    expect(console.error).toHaveBeenCalledTimes(logged);
    db.real.getLatestStatusRow.mockResolvedValue(dogStatusRow);
    await tick();
    expect(session.errors.real).toBeNull();
    db.real.listStatusRowsAfterId.mockRejectedValue('disk unavailable');
    await tick();
    expect(session.errors.real).toBe('disk unavailable');
    expect(console.error).toHaveBeenCalledTimes(logged + 1);
  });

  test('read success cannot clear a failed hardware write or silently retry that payload', async () => {
    const db = databases();
    await mount(db);
    db.real.saveStatus.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => {
      await expect(
        session.saveRealStatus(trackingPoint, 'hardware'),
      ).rejects.toThrow('disk full');
    });
    await tick();
    expect(session.errors.real).toBeNull();
    expect(session.realWriteError).toBe('disk full');
    expect(db.real.saveStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expect(
        session.saveRealStatus(trackingPoint, 'next packet'),
      ).resolves.toBe(1);
    });
    expect(session.realWriteError).toBeNull();
  });

  test('synchronous schema failure is isolated and does not leak its connection', async () => {
    const db = databases();
    db.demo.initialize.mockImplementation(() => {
      throw 'bad Demo schema';
    });
    await mount(db);
    expect(session.ready).toEqual({ real: true, demo: false });
    expect(session.errors.demo).toBe('bad Demo schema');
    await expect(session.saveRealStatus(trackingPoint, null)).resolves.toBe(1);
    await act(async () => renderer.unmount());
    renderer = null;
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  test('real schema failure blocks real writes but leaves Demo available', async () => {
    const db = databases();
    db.real.initialize.mockRejectedValue(new Error('bad real schema'));
    await mount(db);
    expect(session.ready).toEqual({ real: false, demo: true });
    await act(async () => {
      await expect(session.saveRealStatus(trackingPoint, null)).rejects.toThrow(
        'bad real schema',
      );
      await expect(session.setDemoMode(true)).resolves.toBe(true);
    });
    expect(db.real.saveStatus).not.toHaveBeenCalled();
    expect(db.demo.insertRow).not.toHaveBeenCalled();
    expect(session.realWriteError).toBe('bad real schema');
    expect(session.errors.real).toBe('bad real schema');
  });

  test('reset failure preserves data, unlocks controls, and allows retry', async () => {
    const db = databases();
    const row = { id: 4, ...createDemoRow(3, 1000) };
    db.demo.getLatestRow.mockResolvedValue(row);
    await mount(db);
    await act(async () => session.setDemoMode(true));
    expect(session.demoPoint.id).toBe(4);
    db.demo.resetToSeed.mockRejectedValueOnce(new Error('cannot clear'));
    await act(async () => {
      await expect(session.resetDemo()).resolves.toBe(false);
    });
    expect(session.demoError).toContain('cannot clear');
    expect(session.demoBusy).toBe(false);
    expect(session.demoPoint.id).toBe(4);
    const writes = db.demo.insertRow.mock.calls.length;
    await tick();
    expect(session.errors.demo).toBeNull();
    expect(session.demoError).toContain('cannot clear');
    expect(db.demo.insertRow).toHaveBeenCalledTimes(writes);
    db.demo.getLatestRow.mockResolvedValue(null);
    await act(async () => {
      await expect(session.resetDemo()).resolves.toBe(true);
    });
    expect(session.demoError).toBeNull();
    expect(session.demoPoint.id).toBeNull();
    expect(db.real.saveStatus).not.toHaveBeenCalled();
  });

  test('successful reads and source switches do not hide a reset error', async () => {
    const db = databases();
    await mount(db);
    db.demo.resetToSeed.mockRejectedValueOnce(new Error('Demo disk full'));
    await act(async () => {
      await expect(session.resetDemo()).resolves.toBe(false);
    });
    expect(session.demoBusy).toBe(false);
    await tick();
    expect(session.errors.demo).toBeNull();
    expect(session.demoError).toContain('Demo disk full');
    await act(async () => session.setDemoMode(false));
    await act(async () => session.setDemoMode(true));
    expect(session.demoError).toContain('Demo disk full');
    await act(async () => {
      await expect(session.resetDemo()).resolves.toBe(true);
    });
    expect(session.demoError).toBeNull();
  });

  test('a failed old hardware write drains without leaking its error into the next session', async () => {
    const first = databases();
    const second = databases();
    const write = deferred();
    first.real.saveStatus.mockReturnValueOnce(write.promise);
    await mount(first);
    const writing = session.saveRealStatus(trackingPoint, null);
    const failure = writing.catch(error => error);
    const factory = jest.fn(() => second);
    await act(async () => renderer.update(<Harness factory={factory} />));
    expect(factory).not.toHaveBeenCalled();
    await act(async () => {
      write.reject(new Error('old write failed'));
      expect(await failure).toEqual(new Error('old write failed'));
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(session.realWriteError).toBeNull();
    expect(session.errors.real).toBeNull();
  });

  test('a failed reopen does not leave the old ready state and controls enabled', async () => {
    await mount(databases());
    await act(async () => session.setDemoMode(true));
    expect(session.ready.demo).toBe(true);
    const factory = () => {
      throw new Error('reopen failed');
    };
    await act(async () => renderer.update(<Harness factory={factory} />));
    expect(session.ready).toEqual({ real: false, demo: false });
    expect(session.demoBusy).toBe(false);
    expect(session.errors.demo).toBe('reopen failed');
    await expect(session.saveRealStatus(trackingPoint, null)).rejects.toThrow(
      'closed',
    );
  });

  test('busy controls do not report a source switch as successful', async () => {
    const db = databases();
    const clearing = deferred();
    db.demo.resetToSeed.mockReturnValueOnce(clearing.promise);
    await mount(db);
    await act(async () => session.setDemoMode(true));
    let reset;
    await act(async () => {
      reset = session.resetDemo();
    });
    expect(session.demoBusy).toBe(true);
    await expect(session.setDemoMode(false)).resolves.toBe(false);
    await expect(session.setDemoMode(true)).resolves.toBe(false);
    expect(session.mode).toBe('demo');
    await act(async () => {
      clearing.resolve();
      await reset;
    });
    expect(session.demoBusy).toBe(false);
    await act(async () => {
      await expect(session.setDemoMode(false)).resolves.toBe(true);
    });
    expect(session.mode).toBe('real');
  });
  test('settings failure keeps writers ready but blocks source reads; pending saves drain before close', async () => {
    const db = databases();
    db.settings.load.mockRejectedValueOnce(new Error('settings failed'));
    await mount(db);
    expect(session.ready.real).toBe(true);
    expect(session.preferences.error).toBe('settings failed');
    expect(db.real.getLatestStatusRow).not.toHaveBeenCalled();
    expect(db.demo.getLatestRow).not.toHaveBeenCalled();
    await act(async () => session.retryTrackingPreferences());
    expect(db.real.getLatestStatusRow).toHaveBeenCalled();
    const saving = deferred();
    db.settings.save.mockReturnValue(saving.promise);
    let pending;
    await act(async () => {
      pending = session.saveTrackingPreferences({ mode: 'demo' });
    });
    await act(async () => renderer.unmount());
    renderer = null;
    expect(db.close).not.toHaveBeenCalled();
    saving.resolve();
    await pending;
    await act(async () => {});
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  test('manual append drains before reopening and cannot publish to the replacement owner', async () => {
    const first = databases();
    const second = databases();
    const write = deferred();
    first.demo.insertRow.mockReturnValueOnce(write.promise);
    await mount(first);
    let writing;
    await act(async () => {
      writing = session.appendDemo('B');
    });
    expect(session.demoBusy).toBe(true);
    const factory = jest.fn(() => second);
    await act(async () => renderer.update(<Harness factory={factory} />));
    expect(first.close).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    await act(async () => {
      write.resolve(9);
      await writing;
    });
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(session.demoBusy).toBe(false);
    expect(session.demoError).toBeNull();
  });

  test('mode is not switched until the settings write commits', async () => {
    const db = databases();
    const write = deferred();
    db.settings.save.mockReturnValueOnce(write.promise);
    await mount(db);
    let saving;
    await act(async () => {
      saving = session.setDemoMode(true);
    });
    expect(session.mode).toBe('real');
    expect(db.demo.getLatestRow).not.toHaveBeenCalled();
    await act(async () => {
      write.resolve();
      await saving;
    });
    expect(session.mode).toBe('demo');
    expect(db.demo.getLatestRow).toHaveBeenCalled();
  });
});

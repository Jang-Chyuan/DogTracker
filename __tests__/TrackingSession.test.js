import { t as i18nT } from '../src/i18n';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { useTrackingSession } from '../src/app/useTrackingSession';
import {
  dogStatusRow,
  trackingPoint,
} from '../__fixtures__/TrackingPointFixtures';

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

  test('resume catch-up finishes, failures retry, and a late read ends a timeout', async () => {
    const db = databases();
    db.real.getLatestStatusRow.mockResolvedValue(dogStatusRow);
    await mount(db);
    expect(session.catchUp.phase).toBe('idle');
    const change = AppState.addEventListener.mock.calls[0][1];
    await act(async () => change('background'));
    const read = deferred();
    db.real.listStatusRowsAfterId.mockReturnValueOnce(read.promise);
    await act(async () => change('active'));
    expect(session.catchUp.phase).toBe('catching-up');
    await act(async () => read.resolve([]));
    expect(session.catchUp.phase).toBe('idle');
    await act(async () => change('active'));
    expect(session.catchUp.phase).toBe('idle');
    await act(async () => change('background'));
    db.real.listStatusRowsAfterId.mockRejectedValueOnce(new Error('resume failed'));
    await act(async () => change('active'));
    expect(session.catchUp.phase).toBe('failed');
    const retry = deferred();
    db.real.listStatusRowsAfterId.mockReturnValueOnce(retry.promise);
    await act(async () => session.retryCatchUp());
    expect(session.catchUp.phase).toBe('catching-up');
    await act(async () => retry.resolve([]));
    expect(session.catchUp.phase).toBe('idle');
    await act(async () => change('background'));
    const slow = deferred();
    db.real.listStatusRowsAfterId.mockReturnValueOnce(slow.promise);
    await act(async () => change('active'));
    await act(async () => jest.advanceTimersByTimeAsync(19999));
    expect(session.catchUp.phase).toBe('catching-up');
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(session.catchUp.phase).toBe('failed');
    // A read that gets through after the timeout ends the failure.
    await act(async () => slow.resolve([]));
    expect(session.catchUp.phase).toBe('idle');
    await act(async () => session.retryCatchUp());
    expect(session.catchUp.phase).toBe('idle');
    await act(async () => change('background'));
    const obsolete = deferred();
    db.real.listStatusRowsAfterId.mockReturnValueOnce(obsolete.promise);
    await act(async () => change('active'));
    await act(async () => jest.advanceTimersByTimeAsync(20000));
    const fresh = deferred();
    db.real.listStatusRowsAfterId.mockReturnValueOnce(fresh.promise);
    await act(async () => session.retryCatchUp());
    expect(session.catchUp.phase).toBe('catching-up');
    await act(async () => obsolete.resolve([]));
    expect(session.catchUp.phase).toBe('catching-up');
    await act(async () => fresh.resolve([]));
    expect(session.catchUp.phase).toBe('idle');
  });

  test('foreground polling never generates hardware rows', async () => {
    const db = databases();
    await mount(db);
    expect(session.mode).toBe('real');
    await tick();
    const onAppState = AppState.addEventListener.mock.calls[0][1];
    await act(async () => onAppState('background'));
    await tick();
    await act(async () => onAppState('active'));
    await tick();
    await tick();
    expect(db.real.saveStatus).not.toHaveBeenCalled();
  });

  test('legacy demo preferences start only the real feed and preserve display settings', async () => {
    const db = databases();
    db.settings.load.mockResolvedValue({ mode: 'demo', showSlaveMarker: false, windowMinutes: 30 });
    db.real.getLatestStatusRow.mockResolvedValue(dogStatusRow);
    await mount(db);
    expect(session.mode).toBe('real');
    expect(session.point.id).toBe(dogStatusRow.id);
    expect(session.preferences.value).toMatchObject({ mode: 'real', showSlaveMarker: false, windowMinutes: 30 });
    expect(Object.keys(session.ready)).toEqual(['real']);
  });

  test('hardware diagnostics borrow the real DB and drain reads before close', async () => {
    const db = databases();
    const read = deferred();
    db.real.listHistory = jest.fn(() => read.promise);
    await mount(db);
    const adapter = session.hardwareDatabase;
    await adapter.initialize();
    const pending = adapter.listHistory(100);
    await act(async () => {});
    expect(db.real.listHistory).toHaveBeenCalledWith(100);
    await act(async () => renderer.unmount());
    renderer = null;
    expect(db.close).not.toHaveBeenCalled();
    read.resolve([dogStatusRow]);
    await expect(pending).resolves.toEqual([dogStatusRow]);
    await act(async () => {});
    expect(db.close).toHaveBeenCalledTimes(1);
    await expect(adapter.listHistory(1)).rejects.toThrow('closed');
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
    expect(session.ready).toEqual({ real: true });
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

  test('reports a failed native open without starting a feed', async () => {
    const factory = () => {
      throw new Error('cannot open SQLite');
    };
    await act(async () => {
      renderer = ReactTestRenderer.create(<Harness factory={factory} />);
    });
    expect(session.errors.real).toBe('cannot open SQLite');
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
    // One initial history query plus the failed and recovered live queries.
    expect(db.real.listStatusRowsAfterId).toHaveBeenCalledTimes(3);
    expect(session.errors.real).toBeNull();
    expect(session.point.id).toBe(dogStatusRow.id);
  });

  test('recovers a read error while the hardware table is empty', async () => {
    const db = databases();
    db.real.getLatestStatusRow.mockRejectedValueOnce(
      new Error('temporary hardware lock'),
    );
    await mount(db);
    expect(session.errors.real).toBe('temporary hardware lock');
    await tick();
    expect(session.errors.real).toBeNull();
    expect(session.point.id).toBeNull();
  });

  test('unknown rejections stay visible, and repeated polling errors do not flood logs', async () => {
    const db = databases();
    db.real.getLatestStatusRow.mockRejectedValue(null);
    await mount(db);
    expect(session.errors.real).toBe(i18nT("c1049"));
    const logged = console.error.mock.calls.length;
    await tick();
    expect(console.error).toHaveBeenCalledTimes(logged);
    db.real.getLatestStatusRow.mockResolvedValue(null);
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

  test('synchronous schema failure blocks writes and does not leak its connection', async () => {
    const db = databases();
    db.real.initialize.mockImplementation(() => {
      throw 'bad real schema';
    });
    await mount(db);
    expect(session.ready).toEqual({ real: false });
    expect(session.errors.real).toBe('bad real schema');
    await expect(session.saveRealStatus(trackingPoint, null)).rejects.toBe('bad real schema');
    await act(async () => renderer.unmount());
    renderer = null;
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  test('real schema failure blocks hardware writes', async () => {
    const db = databases();
    db.real.initialize.mockRejectedValue(new Error('bad real schema'));
    await mount(db);
    expect(session.ready).toEqual({ real: false });
    await act(async () => {
      await expect(session.saveRealStatus(trackingPoint, null)).rejects.toThrow(
        'bad real schema',
      );
    });
    expect(db.real.saveStatus).not.toHaveBeenCalled();
    expect(session.realWriteError).toBe('bad real schema');
    expect(session.errors.real).toBe('bad real schema');
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
    expect(session.ready.real).toBe(true);
    const factory = () => {
      throw new Error('reopen failed');
    };
    await act(async () => renderer.update(<Harness factory={factory} />));
    expect(session.ready).toEqual({ real: false });
    expect(session.errors.real).toBe('reopen failed');
    await expect(session.saveRealStatus(trackingPoint, null)).rejects.toThrow(
      'closed',
    );
  });

  test('route backfill cannot rewind latest hardware state', async () => {
    const db = databases();
    db.real.getLatestStatusRow.mockResolvedValue(dogStatusRow);
    db.real.listLatestStatusRowsByTimeCursor.mockResolvedValueOnce([
      { ...dogStatusRow, id: 40 },
      { ...dogStatusRow, id: 41 },
    ]);
    await mount(db);
    expect(session.point.id).toBe(42);
    expect(session.route.rawCount).toBe(2);
  });
  test('live route keeps every point in the moving 24-hour window', async () => {
    const db = databases();
    const day = 24 * 60 * 60 * 1000;
    db.real.getLatestStatusRow.mockResolvedValue(dogStatusRow);
    db.real.listLatestStatusRowsByTimeCursor.mockResolvedValueOnce([
      { ...dogStatusRow, id: 40, received_at: dogStatusRow.received_at - day },
      { ...dogStatusRow, id: 41, received_at: dogStatusRow.received_at - 1000 },
      dogStatusRow,
    ]);
    await mount(db);
    expect(session.route.rawCount).toBe(3);

    db.real.listStatusRowsAfterId.mockResolvedValueOnce([
      { ...dogStatusRow, id: 43, received_at: dogStatusRow.received_at + day },
    ]);
    await tick();

    expect(session.route.rawCount).toBe(2);
    expect(session.positionSamples).toHaveLength(1);
    expect(session.positionSamples[0].id).toBe(43);
  });
  test('settings failure keeps writers ready but blocks source reads; pending saves drain before close', async () => {
    const db = databases();
    db.settings.load.mockRejectedValueOnce(new Error('settings failed'));
    await mount(db);
    expect(session.ready.real).toBe(true);
    expect(session.preferences.error).toBe('settings failed');
    expect(db.real.getLatestStatusRow).not.toHaveBeenCalled();
    await act(async () => session.retryTrackingPreferences());
    expect(db.real.getLatestStatusRow).toHaveBeenCalled();
    const saving = deferred();
    db.settings.save.mockReturnValue(saving.promise);
    let pending;
    await act(async () => {
      pending = session.saveTrackingPreferences({ showTrails: true });
    });
    await act(async () => renderer.unmount());
    renderer = null;
    expect(db.close).not.toHaveBeenCalled();
    saving.resolve();
    await pending;
    await act(async () => {});
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  test('display preferences apply only after the settings write commits', async () => {
    const db = databases();
    const write = deferred();
    db.settings.save.mockReturnValueOnce(write.promise);
    await mount(db);
    let saving;
    await act(async () => {
      saving = session.saveTrackingPreferences({ showTrails: true });
    });
    expect(session.preferences.value.showTrails).toBe(false);
    await act(async () => {
      write.resolve();
      await saving;
    });
    expect(session.preferences.value.showTrails).toBe(true);
    expect(session.mode).toBe('real');
  });
});

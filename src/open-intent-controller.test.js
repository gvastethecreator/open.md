import { describe, expect, it, vi } from 'vitest';
import {
  createOpenIntentController,
  orderNativeOpenRequests,
} from './open-intent-controller.js';

function createHarness({ initialState = { state: 'idle', path: null }, windowFailure } = {}) {
  let state = initialState;
  const session = {
    current: vi.fn(() => state),
    open: vi.fn(async ({ path, fragment = '' }) => {
      state = { state: 'ready', path, document: {} };
      return { status: 'ready', path, fragment };
    }),
  };
  const openWindow = vi.fn(async (path) => {
    if (path === windowFailure) throw new Error('Window failed');
  });
  const onFeedback = vi.fn();
  const onDiagnostic = vi.fn();
  const controller = createOpenIntentController({
    session,
    openWindow,
    onFeedback,
    onDiagnostic,
  });
  return { controller, session, openWindow, onFeedback, onDiagnostic };
}

describe('open intent controller', () => {
  it('merges pending replay and buffered events in native request order', () => {
    const first = { id: 1, paths: ['first.md'] };
    const second = { id: 2, paths: ['second.md'] };

    expect(orderNativeOpenRequests([first], [second])).toEqual([first, second]);
    expect(orderNativeOpenRequests([first, second], [second])).toEqual([first, second]);
  });

  it('buffers pre-ready intents and drains them in FIFO order after the initial intent', async () => {
    const { controller, session } = createHarness();
    const first = controller.submit({ origin: 'picker', items: [{ path: 'first.md' }] });
    const second = controller.submit({ origin: 'drop', items: [{ path: 'second.md' }] });

    expect(session.open).not.toHaveBeenCalled();
    await controller.start({ origin: 'launch', items: [{ path: 'initial.md' }] });
    await Promise.all([first, second]);

    expect(session.open.mock.calls.map(([item]) => item.path)).toEqual([
      'initial.md',
      'first.md',
      'second.md',
    ]);
  });

  it('deduplicates paths in order and reports unsupported items once', async () => {
    const { controller, session, openWindow, onFeedback } = createHarness();
    await controller.start();

    const result = await controller.submit({
      origin: 'picker',
      items: [
        { path: 'C:\\Docs\\One.md' },
        { path: 'c:/docs/one.md' },
        { path: 'page.html' },
        { path: 'two.txt' },
      ],
    });

    expect(session.open).toHaveBeenCalledOnce();
    expect(session.open).toHaveBeenCalledWith({ path: 'C:\\Docs\\One.md', fragment: '' });
    expect(openWindow).toHaveBeenCalledWith('two.txt');
    expect(onFeedback).toHaveBeenCalledOnce();
    expect(onFeedback).toHaveBeenCalledWith('Only Markdown, text, and image files are supported');
    expect(result).toMatchObject({ status: 'partial', openedHere: ['C:\\Docs\\One.md'] });
  });

  it('accepts implicit plain-text companions without advertising them as unsupported', async () => {
    const { controller, session, openWindow, onFeedback } = createHarness();
    await controller.start();

    const result = await controller.submit({
      origin: 'drop',
      items: [
        { path: 'C:\\Docs\\config.json' },
        { path: 'setup.ini' },
        { path: 'info.nfo' },
      ],
    });

    expect(session.open).toHaveBeenCalledWith({ path: 'C:\\Docs\\config.json', fragment: '' });
    expect(openWindow).toHaveBeenCalledWith('setup.ini');
    expect(openWindow).toHaveBeenCalledWith('info.nfo');
    expect(onFeedback).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'completed', openedHere: ['C:\\Docs\\config.json'] });
  });

  it('preserves case-distinct POSIX paths while deduplicating Windows variants', async () => {
    const { controller, openWindow } = createHarness({
      initialState: { state: 'ready', path: 'current.md', document: {} },
    });
    await controller.start();

    await controller.submit({
      origin: 'association',
      items: [
        { path: 'C:\\Docs\\One.md' },
        { path: 'c:/docs/one.md' },
        { path: '/docs/A.md' },
        { path: '/docs/a.md' },
      ],
    });

    expect(openWindow.mock.calls.map(([path]) => path)).toEqual([
      'C:\\Docs\\One.md',
      '/docs/A.md',
      '/docs/a.md',
    ]);
  });

  it('replaces locally for picker/drop but preserves an occupied window for associations', async () => {
    const { controller, session, openWindow } = createHarness({
      initialState: { state: 'ready', path: 'current.md', document: {} },
    });
    await controller.start();

    await controller.submit({ origin: 'association', items: [{ path: 'associated.md' }] });
    expect(session.open).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('associated.md');

    await controller.submit({ origin: 'drop', items: [{ path: 'dropped.md' }] });
    expect(session.open).toHaveBeenCalledWith({ path: 'dropped.md', fragment: '' });
  });

  it('moves a superseded association into a new window before acknowledging it', async () => {
    let releaseAssociation;
    let state = { state: 'idle', path: null };
    const session = {
      current: vi.fn(() => state),
      open: vi.fn(({ path }) => {
        if (path === 'associated.md') {
          state = { state: 'loading', path };
          return new Promise((resolve) => {
            releaseAssociation = () => resolve({ status: 'superseded', path });
          });
        }
        state = { state: 'ready', path, document: {} };
        return Promise.resolve({ status: 'ready', path });
      }),
    };
    const openWindow = vi.fn(async () => undefined);
    const acknowledge = vi.fn(async () => true);
    const controller = createOpenIntentController({ session, openWindow });
    await controller.start();

    const association = controller.submit({
      origin: 'association',
      items: [{ path: 'associated.md' }],
      delivery: { key: '20', acknowledge },
    });
    await vi.waitFor(() => expect(session.open).toHaveBeenCalledWith({
      path: 'associated.md',
      fragment: '',
    }));
    await controller.submit({ origin: 'picker', items: [{ path: 'picked.md' }] });
    releaseAssociation();
    const result = await association;

    expect(openWindow).toHaveBeenCalledWith('associated.md');
    expect(result).toMatchObject({ status: 'completed', openedInWindows: ['associated.md'] });
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it('does not continue or acknowledge an in-flight association after disposal', async () => {
    let releaseAssociation;
    const session = {
      current: vi.fn(() => ({ state: 'idle', path: null })),
      open: vi.fn(() => new Promise((resolve) => {
        releaseAssociation = () => resolve({ status: 'superseded', path: 'associated.md' });
      })),
    };
    const openWindow = vi.fn(async () => undefined);
    const acknowledge = vi.fn(async () => true);
    const controller = createOpenIntentController({ session, openWindow });
    await controller.start();

    const association = controller.submit({
      origin: 'association',
      items: [{ path: 'associated.md' }],
      delivery: { key: '21', acknowledge },
    });
    await vi.waitFor(() => expect(session.open).toHaveBeenCalledOnce());
    controller.dispose();
    releaseAssociation();

    await expect(association).rejects.toThrow('disposed');
    expect(openWindow).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('coalesces duplicate native event and pending deliveries and acknowledges once', async () => {
    const { controller, session } = createHarness();
    const acknowledge = vi.fn(async () => true);
    const intent = {
      origin: 'association',
      items: [{ path: 'associated.md' }],
      delivery: { key: '17', acknowledge },
    };

    const eventDelivery = controller.submit(intent);
    const pendingDelivery = controller.submit({ ...intent, delivery: { key: '17', acknowledge } });
    await controller.start();
    const [eventResult, pendingResult] = await Promise.all([eventDelivery, pendingDelivery]);

    expect(eventResult).toEqual(pendingResult);
    expect(session.open).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it('does not acknowledge a queued delivery disposed before readiness', async () => {
    const { controller, session } = createHarness();
    const acknowledge = vi.fn(async () => true);
    const pending = controller.submit({
      origin: 'association',
      items: [{ path: 'associated.md' }],
      delivery: { key: '18', acknowledge },
    });

    controller.dispose();

    await expect(pending).rejects.toThrow('disposed');
    expect(session.open).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('retries a failed acknowledgment without reopening the delivery', async () => {
    const { controller, session, onDiagnostic } = createHarness();
    const acknowledge = vi.fn()
      .mockRejectedValueOnce(new Error('Ack failed'))
      .mockResolvedValueOnce(true);
    const intent = {
      origin: 'association',
      items: [{ path: 'associated.md' }],
      delivery: { key: '19', acknowledge },
    };

    await controller.start();
    const first = await controller.submit(intent);
    const duplicate = await controller.submit(intent);

    expect(duplicate).toEqual(first);
    expect(session.open).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(onDiagnostic).toHaveBeenCalledWith(
      'Could not acknowledge the file-open request',
      expect.any(Error)
    );
  });

  it('does not evict an in-flight delivery when the completed cache reaches its limit', async () => {
    let releaseFirst;
    const firstWindow = new Promise((resolve) => { releaseFirst = resolve; });
    const session = {
      current: vi.fn(() => ({ state: 'ready', path: 'current.md', document: {} })),
      open: vi.fn(),
    };
    const openWindow = vi.fn((path) => path === 'first.md' ? firstWindow : Promise.resolve());
    const controller = createOpenIntentController({ session, openWindow });
    await controller.start();

    const firstIntent = {
      origin: 'association',
      items: [{ path: 'first.md' }],
      delivery: { key: 'first' },
    };
    const first = controller.submit(firstIntent);
    const rest = Array.from({ length: 512 }, (_, index) => controller.submit({
      origin: 'association',
      items: [{ path: `queued-${index}.md` }],
      delivery: { key: `queued-${index}` },
    }));
    const duplicate = controller.submit(firstIntent);
    const sameOperation = duplicate === first;

    releaseFirst();
    await Promise.all([first, duplicate, ...rest]);

    expect(sameOperation).toBe(true);
    expect(openWindow.mock.calls.filter(([path]) => path === 'first.md')).toHaveLength(1);
  });

  it('preserves a link fragment and aggregates additional-window failures', async () => {
    const { controller, session, onFeedback } = createHarness({ windowFailure: 'third.md' });
    await controller.start();

    await controller.submit({
      origin: 'link',
      items: [{ path: 'guide.md', fragment: '#usage' }],
    });
    expect(session.open).toHaveBeenLastCalledWith({ path: 'guide.md', fragment: '#usage' });

    const result = await controller.submit({
      origin: 'picker',
      items: [{ path: 'one.md' }, { path: 'two.md' }, { path: 'third.md' }],
    });
    expect(result.status).toBe('partial');
    expect(result.failures).toHaveLength(1);
    expect(onFeedback).toHaveBeenCalledWith('Could not open third.md');
  });
});

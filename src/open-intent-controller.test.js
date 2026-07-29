import { describe, expect, it, vi } from 'vitest';
import { createOpenIntentController } from './open-intent-controller.js';

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
        { path: 'photo.png' },
        { path: 'two.txt' },
      ],
    });

    expect(session.open).toHaveBeenCalledOnce();
    expect(session.open).toHaveBeenCalledWith({ path: 'C:\\Docs\\One.md', fragment: '' });
    expect(openWindow).toHaveBeenCalledWith('two.txt');
    expect(onFeedback).toHaveBeenCalledOnce();
    expect(onFeedback).toHaveBeenCalledWith('Only .md, .markdown and .txt files are supported');
    expect(result).toMatchObject({ status: 'partial', openedHere: ['C:\\Docs\\One.md'] });
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

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApplicationLifecycleController } from './application-lifecycle.js';

function fixture({ isDirty = () => false } = {}) {
  const diagnostics = vi.fn();
  const controller = createApplicationLifecycleController({
    window,
    isDirty,
    hooks: { onDiagnostic: diagnostics },
  });
  return { controller, diagnostics };
}

describe('Application Lifecycle', () => {
  it('owns resources and listeners where they are acquired, then disposes them once in reverse order', async () => {
    const order = [];
    const listener = vi.fn(() => order.push('event'));
    const first = { dispose: vi.fn(() => order.push('dispose:first')) };
    const second = vi.fn(() => order.push('dispose:second'));
    const view = fixture();

    const start = view.controller.start(async ({ own, listen }) => {
      order.push('setup');
      expect(own(first)).toBe(first);
      expect(own(second)).toBe(second);
      listen(window, 'test-lifecycle', listener);
      order.push('startup');
    });
    await expect(start).resolves.toEqual({ status: 'started' });
    await expect(view.controller.start()).resolves.toEqual({ status: 'started' });
    window.dispatchEvent(new Event('test-lifecycle'));
    expect(order).toEqual(['setup', 'startup', 'event']);
    expect(view.controller.isStarted()).toBe(true);

    await view.controller.dispose();
    await view.controller.dispose();
    window.dispatchEvent(new Event('test-lifecycle'));
    expect(order).toEqual([
      'setup', 'startup', 'event', 'dispose:second', 'dispose:first',
    ]);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(view.controller.isDisposed()).toBe(true);
  });

  it('cleans resources acquired before setup fails', async () => {
    const cleanup = vi.fn();
    const view = fixture();

    await expect(view.controller.start(({ own }) => {
      own(cleanup);
      throw new Error('setup failed');
    })).rejects.toThrow('setup failed');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(view.controller.isDisposed()).toBe(true);
  });

  it('continues teardown after a cleanup failure', async () => {
    const order = [];
    const view = fixture();
    await view.controller.start(({ own }) => {
      own(() => order.push('first'));
      own(() => { throw new Error('cleanup failed'); });
      own(() => order.push('last'));
    });

    await expect(view.controller.dispose()).resolves.toMatchObject({
      status: 'disposed',
      cleanupErrors: [expect.objectContaining({ message: 'cleanup failed' })],
    });
    expect(order).toEqual(['last', 'first']);
    expect(view.diagnostics).toHaveBeenCalledWith(
      'Application cleanup failed',
      expect.objectContaining({ message: 'cleanup failed' }),
    );
  });

  it('guards dirty beforeunload and still tears down all owned listeners', async () => {
    const cleanup = vi.fn();
    const listener = vi.fn();
    const view = fixture({ isDirty: () => true });
    await view.controller.start(({ own, listen }) => {
      own(cleanup);
      listen(window, 'test-lifecycle-dirty', listener);
    });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('test-lifecycle-dirty'));
    expect(listener).not.toHaveBeenCalled();
    expect(view.controller.isDisposed()).toBe(true);
  });
});

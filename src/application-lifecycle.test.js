// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createApplicationLifecycleController } from './application-lifecycle.js';

function fixture({ startup, isDirty = () => false, mounts = [], events = [], disposables = [] } = {}) {
  const diagnostics = vi.fn();
  const controller = createApplicationLifecycleController({
    window,
    document,
    mounts,
    events,
    startup,
    isDirty,
    disposables,
    hooks: { onDiagnostic: diagnostics },
  });
  return { controller, diagnostics };
}

describe('Application Lifecycle', () => {
  it('runs mounts, event bindings and startup once in order, then disposes idempotently', async () => {
    const order = [];
    const listener = vi.fn(() => order.push('event'));
    const cleanup = vi.fn(() => order.push('cleanup'));
    const view = fixture({
      mounts: [
        () => order.push('mount:one'),
        async () => order.push('mount:two'),
      ],
      events: [{ target: window, type: 'test-lifecycle', listener }],
      startup: async () => order.push('startup'),
      disposables: [cleanup],
    });

    await expect(view.controller.start()).resolves.toEqual({ status: 'started' });
    await view.controller.start();
    window.dispatchEvent(new Event('test-lifecycle'));
    expect(order).toEqual(['mount:one', 'mount:two', 'startup', 'event']);
    expect(view.controller.isStarted()).toBe(true);

    view.controller.dispose();
    view.controller.dispose();
    window.dispatchEvent(new Event('test-lifecycle'));
    expect(cleanup).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(view.controller.isDisposed()).toBe(true);
  });

  it('cleans partial startup after a mount or startup failure', async () => {
    const cleanup = vi.fn();
    const view = fixture({
      mounts: [() => { throw new Error('mount failed'); }],
      disposables: [cleanup],
    });

    await expect(view.controller.start()).rejects.toThrow('mount failed');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(view.controller.isDisposed()).toBe(true);

    const startupCleanup = vi.fn();
    const startupFailure = fixture({
      startup: async () => { throw new Error('startup failed'); },
      disposables: [startupCleanup],
    });
    await expect(startupFailure.controller.start()).rejects.toThrow('startup failed');
    expect(startupCleanup).toHaveBeenCalledOnce();
  });

  it('guards dirty beforeunload and still tears down all owned listeners', async () => {
    const cleanup = vi.fn();
    const view = fixture({ isDirty: () => true, disposables: [cleanup] });
    await view.controller.start();

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(view.controller.isDisposed()).toBe(true);
  });
});

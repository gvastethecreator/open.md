import { describe, expect, it, vi } from 'vitest';
import { createEditorStateCoordinator } from './editor-state-coordinator.js';

function harness(overrides = {}) {
  const order = [];
  const applications = [];
  const adapters = Object.fromEntries([
    'renderFeedback',
    'closeTransientContext',
    'refreshDocumentMode',
    'observeSave',
    'markNavigationDirty',
    'scheduleTypography',
    'reapplyReadingTools',
    'refreshStatus',
  ].map((name) => [name, (application) => {
    order.push(name);
    applications.push(application);
  }]));
  Object.assign(adapters, overrides);
  const onDiagnostic = vi.fn();
  const coordinator = createEditorStateCoordinator({ adapters, hooks: { onDiagnostic } });
  return { coordinator, adapters, order, applications, onDiagnostic };
}

describe('Editor State Coordinator', () => {
  it('owns edit transitions and ordered application fan-out', () => {
    const view = harness();

    view.coordinator.apply({ mode: 'read', dirty: false });
    const read = view.applications[0];
    expect(read).toMatchObject({ isEditing: false, modeChanged: false });
    expect(view.order).toEqual([
      'renderFeedback', 'refreshDocumentMode', 'observeSave',
      'scheduleTypography', 'refreshStatus',
    ]);
    expect(new Set(view.applications)).toEqual(new Set([read]));

    view.order.length = 0;
    view.applications.length = 0;
    view.coordinator.apply({ mode: 'edit', dirty: true });
    const entered = view.applications[0];
    expect(view.coordinator.isEditing()).toBe(true);
    expect(entered).toMatchObject({ isEditing: true, modeChanged: true });
    expect(view.order).toEqual([
      'renderFeedback', 'closeTransientContext', 'refreshDocumentMode',
      'observeSave', 'markNavigationDirty', 'scheduleTypography',
      'reapplyReadingTools',
    ]);
    expect(new Set(view.applications)).toEqual(new Set([entered]));

    view.order.length = 0;
    view.coordinator.apply({ mode: 'edit', dirty: false });
    expect(view.order).toEqual([
      'renderFeedback', 'refreshDocumentMode', 'observeSave',
      'markNavigationDirty', 'scheduleTypography', 'refreshStatus',
    ]);

    view.order.length = 0;
    view.coordinator.apply({ mode: 'read', dirty: false });
    const exited = view.applications.at(-1);
    expect(exited).toMatchObject({ isEditing: false, modeChanged: true });
    expect(view.coordinator.isEditing()).toBe(false);
    expect(view.order).toEqual([
      'renderFeedback', 'closeTransientContext', 'refreshDocumentMode',
      'observeSave', 'scheduleTypography', 'reapplyReadingTools',
    ]);
  });

  it('queues reentrant snapshots without interleaving projections', () => {
    let coordinator;
    let reentered = false;
    const view = harness({
      renderFeedback: (application) => {
        view.order.push(`feedback:${application.snapshot.dirty}`);
        if (!reentered) {
          reentered = true;
          coordinator.apply({ mode: 'edit', dirty: false });
        }
      },
      refreshDocumentMode: (application) => view.order.push(`mode:${application.snapshot.dirty}`),
      observeSave: (application) => view.order.push(`save:${application.snapshot.dirty}`),
      markNavigationDirty: (application) => view.order.push(`nav:${application.snapshot.dirty}`),
      scheduleTypography: (application) => view.order.push(`type:${application.snapshot.dirty}`),
      reapplyReadingTools: (application) => view.order.push(`tools:${application.snapshot.dirty}`),
      refreshStatus: (application) => view.order.push(`status:${application.snapshot.dirty}`),
    });
    coordinator = view.coordinator;

    coordinator.apply({ mode: 'edit', dirty: true });
    expect(view.order).toEqual([
      'feedback:true', 'closeTransientContext', 'mode:true', 'save:true',
      'nav:true', 'type:true', 'tools:true',
      'feedback:false', 'mode:false', 'save:false', 'nav:false',
      'type:false', 'status:false',
    ]);
  });

  it('isolates adapter failures and ignores snapshots after disposal', () => {
    const failure = new Error('feedback unavailable');
    const view = harness({
      renderFeedback: () => { throw failure; },
    });

    view.coordinator.apply({ mode: 'edit', dirty: true });
    expect(view.onDiagnostic).toHaveBeenCalledWith(
      'Editor state projection failed at renderFeedback',
      failure,
    );
    expect(view.order).toContain('observeSave');
    expect(view.coordinator.isEditing()).toBe(true);

    view.order.length = 0;
    view.coordinator.dispose();
    expect(view.coordinator.apply({ mode: 'read' })).toBeUndefined();
    expect(view.order).toEqual([]);
  });
});

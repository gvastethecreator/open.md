const REQUIRED_ADAPTERS = Object.freeze([
  'renderFeedback',
  'closeTransientContext',
  'refreshDocumentMode',
  'observeSave',
  'markNavigationDirty',
  'scheduleTypography',
  'reapplyReadingTools',
  'refreshStatus',
]);

/**
 * Owns canonical edit-mode state and ordered application fan-out for editor
 * snapshots. Reentrant snapshots drain FIFO after the current projection.
 */
export function createEditorStateCoordinator({ adapters = {}, hooks = {} } = {}) {
  for (const name of REQUIRED_ADAPTERS) {
    if (typeof adapters[name] !== 'function') {
      throw new TypeError(`Editor State Coordinator requires adapter: ${name}`);
    }
  }

  let editing = false;
  let disposed = false;
  let draining = false;
  const queue = [];

  const diagnose = (stage, error) => {
    try {
      hooks.onDiagnostic?.(`Editor state projection failed at ${stage}`, error);
    } catch {
      // Diagnostics must not break the remaining application projection.
    }
  };

  const run = (stage, application) => {
    if (disposed) return;
    try {
      adapters[stage](application);
    } catch (error) {
      diagnose(stage, error);
    }
  };

  const project = (snapshot) => {
    const nextEditing = snapshot.mode === 'edit';
    const modeChanged = nextEditing !== editing;
    editing = nextEditing;
    const application = Object.freeze({ snapshot, isEditing: editing, modeChanged });

    run('renderFeedback', application);
    if (modeChanged) run('closeTransientContext', application);
    run('refreshDocumentMode', application);
    run('observeSave', application);
    if (editing) run('markNavigationDirty', application);
    run('scheduleTypography', application);
    if (modeChanged) run('reapplyReadingTools', application);
    else run('refreshStatus', application);
  };

  const apply = (snapshot) => {
    if (disposed) return;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new TypeError('Editor State Coordinator requires an editor snapshot');
    }

    queue.push(snapshot);
    if (draining) return;

    draining = true;
    try {
      while (!disposed && queue.length > 0) {
        project(queue.shift());
      }
    } finally {
      draining = false;
      if (disposed) queue.length = 0;
    }
  };

  return Object.freeze({
    apply,
    isEditing: () => editing,
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.length = 0;
    },
  });
}

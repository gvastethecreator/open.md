/**
 * Minimal JSON property editor surface (row chrome, not Markdown blocks).
 */

import {
  addJsonProperty,
  duplicateJsonProperty,
  parseJsonPropertyModel,
  removeJsonProperty,
  updateJsonPropertyModel,
} from './json-property-model.js';

export function createJsonPropertyEditor({
  window,
  root,
  onChange,
  onDiagnostic,
} = {}) {
  if (!window || !root) {
    throw new TypeError('JSON property editor requires window and root');
  }

  const { document } = window;
  let disposed = false;
  let model = null;
  let source = '';
  /** @type {HTMLElement | null} */
  let activeValueEl = null;

  const publish = () => {
    onChange?.({ source, model });
  };

  const commitValueElement = (valueEl) => {
    if (disposed || !model?.ok || !valueEl) return { ok: true, skipped: true };
    const row = valueEl.closest?.('[data-json-property]');
    const path = row?.dataset?.jsonPath;
    if (!path) return { ok: true, skipped: true };

    const currentRow = model.rows?.find((item) => item.path === path);
    if (currentRow && String(valueEl.textContent ?? '') === String(currentRow.text ?? '')) {
      return { ok: true, skipped: true };
    }

    const result = updateJsonPropertyModel(model, path, valueEl.textContent);
    if (!result.ok) {
      valueEl.classList.add('is-invalid');
      valueEl.setAttribute('data-error', result.error || 'Invalid value');
      valueEl.title = result.error || 'Invalid value';
      return result;
    }
    valueEl.classList.remove('is-invalid');
    valueEl.removeAttribute('data-error');
    valueEl.title = '';
    model = result.model;
    source = result.source;
    return result;
  };

  const valueElements = () => [...(root.querySelectorAll?.('[data-json-property][data-json-path] [data-json-value]') || [])];

  const rowForElement = (valueEl) => {
    const path = valueEl.closest?.('[data-json-property]')?.dataset?.jsonPath;
    return model?.rows?.find((item) => item.path === path) || null;
  };

  /**
   * True when any cell text differs from the committed model.
   * Scans the live DOM so dirty works without focus (jsdom / mid-edit save).
   */
  const hasPendingChanges = () => {
    if (disposed || !model?.ok) return false;
    return valueElements().some((valueEl) => {
      const row = rowForElement(valueEl);
      return Boolean(row) && String(valueEl.textContent ?? '') !== String(row.text ?? '');
    });
  };

  /**
   * Commit every dirty cell without requiring blur.
   * Critical for Ctrl+S / mode exit / document switch.
   */
  const flushPending = () => {
    if (disposed || !model?.ok) return { ok: true, skipped: true };
    const dirtyCells = valueElements().filter((valueEl) => {
      const row = rowForElement(valueEl);
      return Boolean(row) && String(valueEl.textContent ?? '') !== String(row.text ?? '');
    });
    if (dirtyCells.length === 0) return { ok: true, skipped: true };

    let lastError = null;
    let changed = false;
    for (const valueEl of dirtyCells) {
      const result = commitValueElement(valueEl);
      if (!result.ok) {
        lastError = result;
        continue;
      }
      if (!result.skipped) changed = true;
    }
    if (lastError) return lastError;
    if (changed) {
      const focusedPath = document.activeElement?.closest?.('[data-json-property]')?.dataset?.jsonPath || null;
      render({ focusPath: focusedPath });
      publish();
    }
    return { ok: true, skipped: !changed };
  };

  const render = ({ focusPath = null } = {}) => {
    if (disposed || !model?.ok) {
      root.replaceChildren();
      activeValueEl = null;
      return;
    }

    const list = document.createElement('div');
    list.className = 'json-props';
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'JSON properties');

    /** @type {HTMLElement | null} */
    let focusTarget = null;

    model.rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'json-props__row';
      item.dataset.jsonProperty = '';
      item.dataset.jsonKey = row.key;
      item.dataset.jsonPath = row.path;
      item.dataset.jsonType = row.type;
      item.setAttribute('role', 'listitem');

      const key = document.createElement('span');
      key.className = 'json-props__key';
      key.textContent = row.key;

      const type = document.createElement('span');
      type.className = 'json-props__type';
      type.textContent = row.composite ? 'json' : row.type;

      const value = document.createElement('div');
      value.className = 'json-props__value';
      value.dataset.jsonValue = '';
      value.contentEditable = 'true';
      value.spellcheck = false;
      value.setAttribute('role', 'textbox');
      value.setAttribute('aria-label', `Value for ${row.key}`);
      value.textContent = row.text;

      value.addEventListener('focus', () => {
        activeValueEl = value;
      });

      value.addEventListener('blur', () => {
        if (disposed) return;
        const result = commitValueElement(value);
        if (!result.ok) return;
        if (activeValueEl === value) activeValueEl = null;
        if (result.skipped) return;
        render();
        publish();
      });

      value.addEventListener('keydown', (event) => {
        if (event.isComposing || event.key === 'Process') return;
        if (event.key === 'Enter' && !event.shiftKey && !row.composite) {
          event.preventDefault();
          value.blur();
        }
      });

      item.append(key, type, value);
      list.append(item);
      if (focusPath && row.path === focusPath) focusTarget = value;
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'json-props__add';
    add.textContent = model.rootType === 'array' ? 'Add item' : 'Add property';
    add.addEventListener('click', () => {
      flushPending();
      const result = addJsonProperty(model);
      if (!result.ok) {
        onDiagnostic?.('Could not add property', result.error);
        return;
      }
      model = result.model;
      source = result.source;
      render();
      publish();
    });

    root.replaceChildren(list, add);
    if (focusTarget) {
      queueMicrotask(() => focusTarget.focus?.({ preventScroll: true }));
    }
  };

  return Object.freeze({
    load(nextSource) {
      if (disposed) return { ok: false };
      source = String(nextSource ?? '');
      model = parseJsonPropertyModel(source);
      activeValueEl = null;
      if (!model.ok) {
        root.replaceChildren();
        return model;
      }
      render();
      return model;
    },
    // Pure current source (committed). Call flushPending() before save/exit.
    source: () => source,
    model: () => model,
    hasPendingChanges,
    flushPending,
    duplicate(path) {
      flushPending();
      const result = duplicateJsonProperty(model, path);
      if (!result.ok) return result;
      model = result.model;
      source = result.source;
      render();
      publish();
      return result;
    },
    remove(path) {
      flushPending();
      const result = removeJsonProperty(model, path);
      if (!result.ok) return result;
      model = result.model;
      source = result.source;
      render();
      publish();
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      model = null;
      source = '';
      activeValueEl = null;
      root.replaceChildren();
    },
  });
}

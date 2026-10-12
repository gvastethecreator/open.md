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
  onHistory,
  onDiagnostic,
} = {}) {
  if (!window || !root) {
    throw new TypeError('JSON property editor requires window and root');
  }

  const { document } = window;
  let disposed = false;
  let rendering = false;
  let model = null;
  let source = '';
  /** @type {HTMLElement | null} */
  let activeValueEl = null;

  const publish = () => {
    onChange?.({ source, model });
  };

  const commitValueElement = (valueEl) => {
    if (disposed || rendering || !model?.ok || !valueEl || !root.contains(valueEl)) return { ok: true, skipped: true };
    const row = valueEl.closest?.('[data-json-property]');
    const path = row?.dataset?.jsonPath;
    if (path === undefined) return { ok: true, skipped: true };

    const currentRow = model.rows?.find((item) => item.path === path);
    const key = row.querySelector('[data-json-key-editor]')?.textContent ?? currentRow?.key;
    const type = row.querySelector('[data-json-type-editor]')?.value ?? currentRow?.type;
    if (currentRow && valueEl.textContent === currentRow.text && key === currentRow.key && type === currentRow.type) {
      return { ok: true, skipped: true };
    }

    const result = updateJsonPropertyModel(model, path, valueEl.textContent, { key, type });
    if (!result.ok) {
      valueEl.classList.add('is-invalid');
      valueEl.setAttribute('data-error', result.error || 'Invalid value');
      valueEl.title = result.error || 'Invalid value';
      row.querySelector('[role="status"]').textContent = valueEl.title;
      return result;
    }
    valueEl.classList.remove('is-invalid');
    valueEl.removeAttribute('data-error');
    valueEl.title = '';
    row.querySelector('[role="status"]').textContent = '';
    model = result.model;
    source = result.source;
    return result;
  };

  const valueElements = () => [...(root.querySelectorAll?.('[data-json-property][data-json-path] [data-json-value]') || [])];

  const rowForElement = (valueEl) => {
    const path = valueEl.closest?.('[data-json-property]')?.dataset?.jsonPath;
    return model?.rows?.find((item) => item.path === path) || null;
  };

  const isPending = (valueEl) => {
    const row = rowForElement(valueEl);
    const element = valueEl.closest('[data-json-property]');
    return Boolean(row) && (valueEl.textContent !== row.text
      || (element.querySelector('[data-json-key-editor]')?.textContent ?? row.key) !== row.key
      || (element.querySelector('[data-json-type-editor]')?.value ?? row.type) !== row.type);
  };

  /**
   * True when any cell text differs from the committed model.
   * Scans the live DOM so dirty works without focus (jsdom / mid-edit save).
   */
  const hasPendingChanges = () => {
    if (disposed || !model?.ok) return false;
    return valueElements().some(isPending);
  };

  /**
   * Commit every dirty cell without requiring blur.
   * Critical for Ctrl+S / mode exit / document switch.
   */
  const flushPending = () => {
    if (disposed || !model?.ok) return { ok: true, skipped: true };
    const dirtyCells = valueElements().filter(isPending);
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
      if (model.rootType === 'object') {
        key.contentEditable = 'true';
        key.dataset.jsonKeyEditor = '';
        key.setAttribute('role', 'textbox');
        key.setAttribute('aria-label', `Property name for ${row.key}`);
        key.spellcheck = false;
      }

      const type = document.createElement('select');
      type.className = 'json-props__type';
      type.dataset.jsonTypeEditor = '';
      type.setAttribute('aria-label', `Type for ${row.key}`);
      for (const name of [...(row.composite ? [row.type] : []), 'string', 'number', 'boolean', 'null']) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        type.append(option);
      }
      type.value = row.type;

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

      const commit = () => {
        if (disposed) return;
        const result = commitValueElement(value);
        if (!result.ok) return;
        if (activeValueEl === value) activeValueEl = null;
        if (result.skipped) return;
        render();
        publish();
      };
      value.addEventListener('blur', commit);
      key.addEventListener('blur', commit);
      key.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          key.blur();
        }
      });
      type.addEventListener('change', () => {
        value.textContent = { string: row.text, number: '0', boolean: 'false', null: 'null' }[type.value] ?? row.text;
        commit();
      });

      value.addEventListener('keydown', (event) => {
        if (event.isComposing || event.key === 'Process') return;
        if (event.key === 'Enter' && !event.shiftKey && !row.composite) {
          event.preventDefault();
          value.blur();
        }
      });

      const error = document.createElement('span');
      error.className = 'json-props__error';
      error.setAttribute('role', 'status');
      item.append(key, type, value, error);
      list.append(item);
      if (focusPath && row.path === focusPath) focusTarget = value;
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'json-props__add';
    add.textContent = model.rootType === 'array' ? 'Add item' : 'Add property';
    add.addEventListener('click', () => {
      if (!flushPending().ok) return;
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

    // Replacing a focused cell fires blur before the browser detaches it.
    rendering = true;
    try {
      root.replaceChildren(list, add);
    } finally {
      rendering = false;
    }
    if (focusTarget) {
      queueMicrotask(() => focusTarget.focus?.({ preventScroll: true }));
    }
  };

  const handleHistory = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    const path = event.target.closest?.('[data-json-property]')?.dataset.jsonPath;
    if (!flushPending().ok) return;
    onHistory?.(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    const values = valueElements();
    const target = values.find((value) => value.closest('[data-json-property]').dataset.jsonPath === path)
      || values[0] || root.querySelector('.json-props__add');
    target?.focus({ preventScroll: true });
  };
  root.addEventListener('keydown', handleHistory);

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
      const flushed = flushPending();
      if (!flushed.ok) return flushed;
      const result = duplicateJsonProperty(model, path);
      if (!result.ok) return result;
      model = result.model;
      source = result.source;
      render();
      publish();
      return result;
    },
    remove(path) {
      const flushed = flushPending();
      if (!flushed.ok) return flushed;
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
      root.removeEventListener('keydown', handleHistory);
      model = null;
      source = '';
      activeValueEl = null;
      root.replaceChildren();
    },
  });
}

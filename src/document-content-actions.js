function isElement(value) {
  return Boolean(value && value.nodeType === 1 && typeof value.closest === 'function');
}

export function createDocumentContentActions({
  window,
  document,
  elements = {},
  adapters = {},
  hooks = {},
} = {}) {
  if (!window || !document) {
    throw new TypeError('Document Content Actions requires window and document');
  }

  let disposed = false;

  const selectedTextWithin = (root) => {
    const selection = window.getSelection?.();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
    const range = selection.getRangeAt(0);
    return root.contains(range.commonAncestorContainer) ? selection.toString() : '';
  };

  const selectContents = (element) => {
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection?.();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.focus?.({ preventScroll: true });
  };

  const writeClipboardText = async (value, successMessage) => {
    const text = String(value ?? '');
    try {
      if (typeof window.navigator?.clipboard?.writeText === 'function') {
        await window.navigator.clipboard.writeText(text);
      } else {
        const active = document.activeElement;
        const selection = window.getSelection?.();
        const ranges = selection
          ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
          : [];
        const helper = document.createElement('textarea');
        helper.className = 'clipboard-helper';
        helper.value = text;
        helper.setAttribute('aria-hidden', 'true');
        document.body.append(helper);
        helper.select();
        const copied = document.execCommand?.('copy');
        helper.remove();
        selection?.removeAllRanges();
        ranges.forEach((range) => selection?.addRange(range));
        active?.focus?.({ preventScroll: true });
        if (!copied) throw new Error('Clipboard access is unavailable');
      }
      hooks.onToast?.(successMessage);
      return true;
    } catch (error) {
      console.error('Could not write to the clipboard:', error);
      hooks.onToast?.('Could not copy to the clipboard');
      return false;
    }
  };

  const pasteClipboardText = async () => {
    try {
      if (typeof window.navigator?.clipboard?.readText !== 'function') {
        throw new Error('Clipboard reading is unavailable');
      }
      const text = await window.navigator.clipboard.readText();
      if (!document.execCommand?.('insertText', false, text)) {
        throw new Error('The active editor did not accept pasted text');
      }
      hooks.onToast?.('Pasted');
    } catch (error) {
      console.error('Could not paste from the clipboard:', error);
      hooks.onToast?.('Could not paste from the clipboard');
    }
  };

  const handleReadTaskToggle = (event) => {
    if (disposed) return;
    const checkbox = isElement(event?.target)
      ? event.target.closest('.markdown-body input[type="checkbox"][data-source-line]')
      : null;
    if (!checkbox || adapters.isEditMode?.() || !adapters.isDocumentAvailable?.()) return;

    const sourceLine = Number.parseInt(checkbox.dataset.sourceLine, 10);
    void adapters.toggleReadTask?.({
      checkbox,
      sourceLine,
      checked: checkbox.checked,
    });
  };

  const editContextItems = (target) => {
    const editorSession = adapters.getEditorSession?.();
    const context = editorSession?.contextFor(target);
    if (!context) return null;
    const wrapper = target.closest('[data-block-id]');
    const blockText = wrapper?.querySelector('[data-editor-content]')?.innerText || '';
    const items = [];

    if (context.hasSelection) {
      items.push(
        {
          id: 'copy-selection',
          label: 'Copy selection',
          icon: 'iconoir-copy',
          shortcut: 'Ctrl+C',
          onSelect: () => writeClipboardText(context.selectionText, 'Selection copied'),
        },
        {
          id: 'cut-selection',
          label: 'Cut selection',
          icon: 'iconoir-edit-pencil',
          shortcut: 'Ctrl+X',
          onSelect: () => {
            if (!document.execCommand?.('cut')) hooks.onToast?.('Could not cut the selection');
          },
        },
        { type: 'separator' },
        { id: 'bold', label: 'Bold', icon: 'iconoir-bold', onSelect: () => editorSession.applyInlineCommand('bold') },
        { id: 'italic', label: 'Italic', icon: 'iconoir-italic', onSelect: () => editorSession.applyInlineCommand('italic') },
        { id: 'strike', label: 'Strikethrough', icon: 'iconoir-text', onSelect: () => editorSession.applyInlineCommand('strike') },
        { id: 'inline-code', label: 'Inline code', icon: 'iconoir-code', onSelect: () => editorSession.applyInlineCommand('code') },
        { id: 'link', label: 'Add link', icon: 'iconoir-link', shortcut: 'Ctrl+K', onSelect: () => editorSession.openLinkFromSelection() },
      );
    } else {
      items.push({
        id: 'copy-block',
        label: 'Copy block',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(blockText, 'Block copied'),
      });
    }

    items.push(
      {
        id: 'paste',
        label: 'Paste text',
        icon: 'iconoir-page-down',
        shortcut: 'Ctrl+V',
        onSelect: pasteClipboardText,
      },
      { type: 'separator' },
      {
        id: 'move-up',
        label: 'Move block up',
        icon: 'iconoir-arrow-up',
        shortcut: 'Alt+Shift+↑',
        disabled: !context.canMoveUp,
        onSelect: () => editorSession.performBlockAction(context.blockId, 'move-up'),
      },
      {
        id: 'move-down',
        label: 'Move block down',
        icon: 'iconoir-arrow-down',
        shortcut: 'Alt+Shift+↓',
        disabled: !context.canMoveDown,
        onSelect: () => editorSession.performBlockAction(context.blockId, 'move-down'),
      },
      {
        id: 'duplicate',
        label: 'Duplicate block',
        icon: 'iconoir-copy',
        onSelect: () => editorSession.performBlockAction(context.blockId, 'duplicate'),
      },
      {
        id: 'delete',
        label: 'Delete block',
        icon: 'iconoir-trash',
        danger: true,
        disabled: !context.canDelete,
        onSelect: () => editorSession.performBlockAction(context.blockId, 'delete'),
      },
    );

    return { label: `${context.blockType} block actions`, context, items };
  };

  const readContextItems = (target) => {
    if (!elements.content?.contains(target)) return null;
    const selectedText = selectedTextWithin(elements.content);
    const link = target.closest('a[href]');
    const code = target.closest('pre')?.querySelector('code');
    const checkbox = target.closest('input[type="checkbox"][data-source-line]');
    const image = target.closest('img');
    const diagram = target.closest('.mermaid[data-mermaid-source]');
    const table = target.closest('table');
    const items = [];

    if (selectedText) {
      items.push({
        id: 'copy-selection',
        label: 'Copy selection',
        icon: 'iconoir-copy',
        shortcut: 'Ctrl+C',
        onSelect: () => writeClipboardText(selectedText, 'Selection copied'),
      });
    }
    if (link) {
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { id: 'open-link', label: 'Open link', icon: 'iconoir-link', onSelect: () => link.click() },
        { id: 'copy-link', label: 'Copy link', icon: 'iconoir-copy', onSelect: () => writeClipboardText(link.href, 'Link copied') },
      );
    } else if (code) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ id: 'copy-code', label: 'Copy code', icon: 'iconoir-code', onSelect: () => writeClipboardText(code.innerText, 'Code copied') });
    } else if (checkbox) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        id: 'toggle-task',
        label: checkbox.checked ? 'Mark task incomplete' : 'Mark task complete',
        icon: 'iconoir-check-square',
        onSelect: () => checkbox.click(),
      });
    } else if (diagram) {
      if (items.length) items.push({ type: 'separator' });
      items.push(
        {
          id: 'copy-diagram-source',
          label: 'Copy diagram source',
          icon: 'iconoir-code',
          onSelect: () => writeClipboardText(diagram.dataset.mermaidSource, 'Diagram source copied'),
        },
        {
          id: 'copy-diagram-svg',
          label: 'Copy diagram SVG',
          icon: 'iconoir-copy',
          onSelect: () => writeClipboardText(diagram.querySelector('svg')?.outerHTML || '', 'Diagram SVG copied'),
        },
      );
    } else if (table) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        id: 'copy-table',
        label: 'Copy table',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(table.innerText, 'Table copied'),
      });
    } else if (image) {
      const source = image.dataset.documentSource || image.getAttribute('src');
      if (items.length) items.push({ type: 'separator' });
      if (source) items.push({ id: 'copy-image-source', label: 'Copy image source', icon: 'iconoir-copy', onSelect: () => writeClipboardText(source, 'Image source copied') });
      if (image.alt) items.push({ id: 'copy-image-description', label: 'Copy image description', icon: 'iconoir-text', onSelect: () => writeClipboardText(image.alt, 'Image description copied') });
    }

    if (items.length) items.push({ type: 'separator' });
    items.push(
      { id: 'copy-document', label: 'Copy document', icon: 'iconoir-copy', onSelect: () => writeClipboardText(elements.content.innerText, 'Document copied') },
      { id: 'select-document', label: 'Select all', icon: 'iconoir-page', shortcut: 'Ctrl+A', onSelect: () => selectContents(elements.content) },
    );
    return { label: 'Reading actions', items };
  };

  const sourceContextItems = (target) => {
    if (!elements.sourceView?.contains(target)) return null;
    const selectedText = selectedTextWithin(elements.sourceView);
    return {
      label: 'Source actions',
      items: [
        ...(selectedText ? [{ id: 'copy-selection', label: 'Copy selection', icon: 'iconoir-copy', shortcut: 'Ctrl+C', onSelect: () => writeClipboardText(selectedText, 'Selection copied') }, { type: 'separator' }] : []),
        { id: 'copy-source', label: 'Copy source', icon: 'iconoir-code', onSelect: () => writeClipboardText(adapters.getDocument?.()?.source || elements.sourceContent?.textContent || '', 'Source copied') },
        { id: 'select-source', label: 'Select all', icon: 'iconoir-page', shortcut: 'Ctrl+A', onSelect: () => selectContents(elements.sourceContent) },
      ],
    };
  };

  const resolveContext = ({ target } = {}) => {
    if (disposed || !isElement(target) || adapters.isHelpVisible?.() || !adapters.isDocumentAvailable?.()) return null;
    if (adapters.isEditMode?.()) return editContextItems(target);
    if (adapters.isSourceActive?.()) return sourceContextItems(target);
    return readContextItems(target);
  };

  return Object.freeze({
    handleReadTaskToggle,
    resolveContext,
    dispose() {
      disposed = true;
    },
  });
}

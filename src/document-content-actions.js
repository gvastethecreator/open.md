import { getDisplayName } from './document-path.js';
import {
  getEditorKind,
  getFormatLabel,
  isImageFormat,
  isMarkdownFormat,
  resolveFormatId,
} from './format-registry.js';
import { toUint8Array } from './image-resources.js';

function isElement(value) {
  return Boolean(value && value.nodeType === 1 && typeof value.closest === 'function');
}

function compactItems(items) {
  const next = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'separator') {
      if (next.length === 0 || next[next.length - 1]?.type === 'separator') continue;
      next.push(item);
      continue;
    }
    next.push(item);
  }
  while (next.length && next[next.length - 1]?.type === 'separator') next.pop();
  return next;
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

  const writeClipboardImage = async (blob, successMessage = 'Image copied') => {
    try {
      if (typeof window.ClipboardItem !== 'function' || typeof window.navigator?.clipboard?.write !== 'function') {
        throw new Error('Image clipboard is unavailable');
      }
      const type = blob.type || 'image/png';
      await window.navigator.clipboard.write([new window.ClipboardItem({ [type]: blob })]);
      hooks.onToast?.(successMessage);
      return true;
    } catch (error) {
      console.error('Could not copy the image:', error);
      hooks.onToast?.('Could not copy the image');
      return false;
    }
  };

  const bytesToBlob = (bytes, mimeType) => {
    const type = mimeType || 'application/octet-stream';
    if (bytes instanceof Blob) return bytes.type ? bytes : new Blob([bytes], { type });
    const unit8 = toUint8Array(bytes)
      || (Array.isArray(bytes) ? Uint8Array.from(bytes) : null);
    if (!unit8) throw new Error('Image bytes are unavailable');
    return new Blob([unit8], { type });
  };

  /**
   * WebViews often accept only image/png on the system clipboard. Download keeps
   * original bytes; copy prefers a PNG encoding when conversion is available.
   */
  const blobAsClipboardPng = async (blob) => {
    if (!blob) throw new Error('Image bytes are unavailable');
    if ((blob.type || '') === 'image/png') return blob;
    if (typeof window.createImageBitmap !== 'function') return blob;
    const bitmap = await window.createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, bitmap.width || 1);
      canvas.height = Math.max(1, bitmap.height || 1);
      const ctx = canvas.getContext('2d');
      if (!ctx || typeof canvas.toBlob !== 'function') return blob;
      ctx.drawImage(bitmap, 0, 0);
      const png = await new Promise((resolve) => {
        canvas.toBlob((next) => resolve(next), 'image/png');
      });
      return png || blob;
    } finally {
      bitmap.close?.();
    }
  };

  const copyStandaloneImage = async () => {
    const media = adapters.getImageMedia?.();
    if (!media?.bytes) {
      hooks.onToast?.('Could not copy the image');
      return false;
    }
    try {
      const original = bytesToBlob(media.bytes, media.mimeType || 'image/png');
      const blob = await blobAsClipboardPng(original);
      return writeClipboardImage(blob);
    } catch (error) {
      console.error('Could not copy the image:', error);
      hooks.onToast?.('Could not copy the image');
      return false;
    }
  };

  const downloadStandaloneImage = async () => {
    const media = adapters.getImageMedia?.();
    const path = adapters.getDocumentPath?.() || media?.path || '';
    if (!media?.bytes) {
      hooks.onToast?.('Could not download the image');
      return false;
    }
    if (typeof adapters.downloadImage !== 'function') {
      hooks.onToast?.('Could not download the image');
      return false;
    }
    try {
      const result = await adapters.downloadImage({
        bytes: media.bytes,
        mimeType: media.mimeType,
        path,
        defaultName: getDisplayName(path) || 'image',
      });
      if (result?.status === 'cancelled') return false;
      if (result?.status === 'saved' || result === true) {
        hooks.onToast?.('Image downloaded');
        return true;
      }
      throw new Error(result?.error || 'Download failed');
    } catch (error) {
      console.error('Could not download the image:', error);
      hooks.onToast?.('Could not download the image');
      return false;
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

  const currentFormat = () => {
    const path = adapters.getDocumentPath?.() || null;
    const doc = adapters.getDocument?.() || null;
    return resolveFormatId(path, doc);
  };

  const formatHint = () => {
    const path = adapters.getDocumentPath?.() || null;
    const doc = adapters.getDocument?.() || null;
    return { kind: doc?.kind, path };
  };

  const markdownEditContextItems = (target) => {
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

    items.push({
      id: 'paste',
      label: 'Paste text',
      icon: 'iconoir-page-down',
      shortcut: 'Ctrl+V',
      onSelect: pasteClipboardText,
    });

    if (editorSession.isBlockEditor?.()) {
      items.push(
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
    }

    return {
      label: editorSession.isBlockEditor?.()
        ? `${context.blockType} block actions`
        : 'Edit actions',
      context,
      items: compactItems(items),
    };
  };

  const plainEditContextItems = (target) => {
    const root = elements.editorView || elements.content;
    const inEditor = Boolean(
      target.closest?.('[data-editor-content], [data-json-property], .json-props, .editor-canvas, #editor-canvas')
      || (root && root.contains(target)),
    );
    // Do not open companion/JSON edit actions on chrome outside the editor surface.
    if (!inEditor) return null;

    const selectedText = selectedTextWithin(root) || selectedTextWithin(document);
    const propertyRow = target.closest?.('[data-json-property]');
    const items = [];

    if (selectedText) {
      items.push(
        {
          id: 'copy-selection',
          label: 'Copy selection',
          icon: 'iconoir-copy',
          shortcut: 'Ctrl+C',
          onSelect: () => writeClipboardText(selectedText, 'Selection copied'),
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
      );
    }

    if (propertyRow) {
      const key = propertyRow.dataset.jsonKey || '';
      const path = propertyRow.dataset.jsonPath || key;
      const valueText = propertyRow.querySelector('[data-json-value]')?.innerText
        || propertyRow.dataset.jsonValue
        || '';
      if (items.length) items.push({ type: 'separator' });
      if (key) {
        items.push({
          id: 'copy-json-key',
          label: 'Copy key',
          icon: 'iconoir-copy',
          onSelect: () => writeClipboardText(key, 'Key copied'),
        });
      }
      if (path) {
        items.push({
          id: 'copy-json-path',
          label: 'Copy property path',
          icon: 'iconoir-path-arrow',
          onSelect: () => writeClipboardText(path, 'Path copied'),
        });
      }
      items.push({
        id: 'copy-json-value',
        label: 'Copy value',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(valueText, 'Value copied'),
      });
      if (adapters.getEditorSession?.()?.jsonPropertyActions) {
        items.push(
          { type: 'separator' },
          {
            id: 'duplicate-json-property',
            label: 'Duplicate property',
            icon: 'iconoir-copy',
            onSelect: () => adapters.getEditorSession().jsonPropertyActions.duplicate(path),
          },
          {
            id: 'delete-json-property',
            label: 'Delete property',
            icon: 'iconoir-trash',
            danger: true,
            onSelect: () => adapters.getEditorSession().jsonPropertyActions.remove(path),
          },
        );
      }
    }

    items.push({
      id: 'paste',
      label: 'Paste text',
      icon: 'iconoir-page-down',
      shortcut: 'Ctrl+V',
      onSelect: pasteClipboardText,
    });

    return {
      label: getEditorKind(currentFormat(), formatHint()) === 'json-props'
        ? 'JSON property actions'
        : 'Edit actions',
      items: compactItems(items),
    };
  };

  const editContextItems = (target) => {
    const presentation = adapters.getEditorSession?.()?.current?.()?.presentation;
    if (presentation === 'block') return markdownEditContextItems(target);
    if (
      presentation === 'classic'
      || presentation === 'source'
      || presentation === 'json-props'
    ) {
      return plainEditContextItems(target);
    }
    const format = currentFormat();
    const hint = formatHint();
    if (isMarkdownFormat(format, hint) || getEditorKind(format, hint) === 'blocks') {
      return markdownEditContextItems(target);
    }
    return plainEditContextItems(target);
  };

  const imageDocumentContextItems = () => {
    const path = adapters.getDocumentPath?.() || '';
    const viewer = adapters.getImageViewer?.();
    const items = [
      {
        id: 'copy-image',
        label: 'Copy image',
        icon: 'iconoir-media-image',
        onSelect: () => copyStandaloneImage(),
      },
      {
        id: 'download-image',
        label: 'Download image…',
        icon: 'iconoir-download',
        onSelect: () => downloadStandaloneImage(),
      },
      { type: 'separator' },
      {
        id: 'image-fit',
        label: 'Fit to window',
        icon: 'iconoir-expand',
        onSelect: () => viewer?.fit?.(),
      },
      {
        id: 'image-actual-size',
        label: 'Actual size',
        icon: 'iconoir-one-finger-select-hand-gesture',
        onSelect: () => viewer?.actualSize?.(),
      },
    ];
    if (path) {
      items.push(
        { type: 'separator' },
        {
          id: 'copy-image-path',
          label: 'Copy path',
          icon: 'iconoir-copy',
          onSelect: () => writeClipboardText(path, 'Path copied'),
        },
      );
    }
    return {
      label: 'Image actions',
      items: compactItems(items),
    };
  };

  const jsonReadExtras = (target, items) => {
    const keyNode = target.closest?.('.json-key, .json-item');
    if (!keyNode) return items;
    const key = keyNode.querySelector?.('.json-key')?.textContent
      || (keyNode.classList.contains('json-key') ? keyNode.textContent : '');
    const index = keyNode.querySelector?.('.json-index')?.textContent;
    const valueNode = keyNode.querySelector?.(
      '.json-string, .json-number, .json-bool, .json-null, .json-collapsible, .json-array, .json-object'
    );
    let valueText = '';
    if (valueNode?.classList.contains('json-string')) {
      valueText = valueNode.textContent.replace(/^"|"$/g, '');
    } else if (valueNode) {
      valueText = valueNode.textContent || '';
    }
    if (items.length) items.push({ type: 'separator' });
    if (key) {
      items.push({
        id: 'copy-json-key',
        label: 'Copy key',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(key, 'Key copied'),
      });
    }
    if (index != null && index !== '') {
      items.push({
        id: 'copy-json-index',
        label: 'Copy index',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(String(index), 'Index copied'),
      });
    }
    if (valueText) {
      items.push({
        id: 'copy-json-value',
        label: 'Copy value',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(valueText, 'Value copied'),
      });
    }
    return items;
  };

  const readContextItems = (target) => {
    if (!elements.content?.contains(target)) return null;
    const format = currentFormat();
    const hint = formatHint();

    if (isImageFormat(format, hint) || target.closest?.('.image-document, [data-image-document="true"]')) {
      return imageDocumentContextItems();
    }

    const selectedText = selectedTextWithin(elements.content);
    const link = target.closest('a[href]');
    const code = target.closest('pre')?.querySelector('code');
    const checkbox = target.closest('input[type="checkbox"][data-source-line]');
    const image = target.closest('img');
    const diagram = target.closest('.mermaid[data-mermaid-source]');
    const table = target.closest('table');
    let items = [];

    if (selectedText) {
      items.push({
        id: 'copy-selection',
        label: 'Copy selection',
        icon: 'iconoir-copy',
        shortcut: 'Ctrl+C',
        onSelect: () => writeClipboardText(selectedText, 'Selection copied'),
      });
    }

    if (isMarkdownFormat(format, hint)) {
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
        if (source) {
          items.push({
            id: 'copy-image-source',
            label: 'Copy image source',
            icon: 'iconoir-copy',
            onSelect: () => writeClipboardText(source, 'Image source copied'),
          });
        }
        if (image.alt) {
          items.push({
            id: 'copy-image-description',
            label: 'Copy image description',
            icon: 'iconoir-text',
            onSelect: () => writeClipboardText(image.alt, 'Image description copied'),
          });
        }
      }
    } else {
      if (format === 'json') items = jsonReadExtras(target, items);
      if (table) {
        if (items.length) items.push({ type: 'separator' });
        items.push({
          id: 'copy-table',
          label: 'Copy table',
          icon: 'iconoir-copy',
          onSelect: () => writeClipboardText(table.innerText, 'Table copied'),
        });
      } else if (code) {
        if (items.length) items.push({ type: 'separator' });
        items.push({
          id: 'copy-code',
          label: 'Copy code',
          icon: 'iconoir-code',
          onSelect: () => writeClipboardText(code.innerText, 'Code copied'),
        });
      }
    }

    if (items.length) items.push({ type: 'separator' });
    items.push(
      {
        id: 'copy-document',
        label: 'Copy document',
        icon: 'iconoir-copy',
        onSelect: () => writeClipboardText(
          adapters.getDocument?.()?.source || elements.content.innerText,
          'Document copied',
        ),
      },
      {
        id: 'select-document',
        label: 'Select all',
        icon: 'iconoir-page',
        shortcut: 'Ctrl+A',
        onSelect: () => selectContents(elements.content),
      },
    );

    const label = format === 'json'
      ? 'JSON actions'
      : `${getFormatLabel(format, hint)} actions`;
    return { label: isMarkdownFormat(format, hint) ? 'Reading actions' : label, items: compactItems(items) };
  };

  const sourceContextItems = (target) => {
    if (!elements.sourceView?.contains(target)) return null;
    const selectedText = selectedTextWithin(elements.sourceView);
    const format = currentFormat();
    const label = `${getFormatLabel(format, formatHint())} source actions`;
    return {
      label: isMarkdownFormat(format, formatHint()) ? 'Source actions' : label,
      items: compactItems([
        ...(selectedText
          ? [{
              id: 'copy-selection',
              label: 'Copy selection',
              icon: 'iconoir-copy',
              shortcut: 'Ctrl+C',
              onSelect: () => writeClipboardText(selectedText, 'Selection copied'),
            }, { type: 'separator' }]
          : []),
        {
          id: 'copy-source',
          label: 'Copy source',
          icon: 'iconoir-code',
          onSelect: () => writeClipboardText(
            adapters.getDocument?.()?.source || elements.sourceContent?.textContent || '',
            'Source copied',
          ),
        },
        {
          id: 'select-source',
          label: 'Select all',
          icon: 'iconoir-page',
          shortcut: 'Ctrl+A',
          onSelect: () => selectContents(elements.sourceContent),
        },
      ]),
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

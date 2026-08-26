import {
  EDITOR_COMMANDS,
  createEditorDocumentModel,
  editableHtmlToMarkdown,
  editorBlockLabel,
  inlineMarkdownToHtml,
  parseMarkdownLine,
  serializeEditorDocument,
} from './editor-document.js';
import { createEditorClassicSurface } from './editor-classic-surface.js';
import { createEditorCaretTrail } from './editor-caret-trail.js';
import { createEditorOverlayController } from './editor-overlay-controller.js';
import { createEditorSelectionController } from './editor-selection-controller.js';
import { createEditorBlockInteractionController } from './editor-block-interaction-controller.js';
import { shouldReduceMotion } from './reader-preferences.js';
import { createJsonPropertyEditor } from './json-property-editor.js';
import { parseJsonPropertyModel } from './json-property-model.js';

const MAX_EDITABLE_CHARACTERS = 2 * 1024 * 1024;
const MAX_EDITABLE_BLOCKS = 20_000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function blockContent(wrapper) {
  return wrapper?.querySelector('[data-editor-content]') || null;
}

function readEditableText(element) {
  if (!element) return '';
  if (element.dataset.editorMode === 'source') {
    // Formatting commands may inject inline HTML; prefer Markdown serialization then.
    if (element.querySelector?.('b, strong, i, em, s, strike, del, code, a')) {
      return editableHtmlToMarkdown(element);
    }
    return String(element.innerText ?? element.textContent ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '')
      .replace(/\n+$/g, '');
  }
  return editableHtmlToMarkdown(element);
}

function caretOffset(element, selection) {
  if (!element || !selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return 0;
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function markdownAroundSelection(document, element, selection) {
  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    return { before: readEditableText(element), after: '' };
  }

  if (element.dataset.editorMode === 'source') {
    const full = String(element.innerText ?? element.textContent ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\u200b/g, '');
    const active = selection.getRangeAt(0);
    const beforeRange = active.cloneRange();
    beforeRange.selectNodeContents(element);
    beforeRange.setEnd(active.startContainer, active.startOffset);
    const afterRange = active.cloneRange();
    afterRange.selectNodeContents(element);
    afterRange.setStart(active.endContainer, active.endOffset);
    return {
      before: beforeRange.toString().replace(/\n+$/g, ''),
      after: afterRange.toString().replace(/^\n+/g, '').replace(/\n+$/g, ''),
    };
  }

  const active = selection.getRangeAt(0);
  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(element);
  beforeRange.setEnd(active.startContainer, active.startOffset);
  const afterRange = document.createRange();
  afterRange.selectNodeContents(element);
  afterRange.setStart(active.endContainer, active.endOffset);

  const beforeHost = document.createElement('div');
  beforeHost.append(beforeRange.cloneContents());
  const afterHost = document.createElement('div');
  afterHost.append(afterRange.cloneContents());
  return {
    before: editableHtmlToMarkdown(beforeHost),
    after: editableHtmlToMarkdown(afterHost),
  };
}

export function createEditorSession({ window, elements, adapters, hooks = {} }) {
  const { document } = window;
  const {
    root,
    canvas,
    commandMenu,
    blockMenu,
    blockToolbar,
    inlineToolbar,
    caretEcho,
    linkPopover,
    linkInput,
    linkApply,
    contextLabel,
    contextHint,
  } = elements;

  if (!root || !canvas || !commandMenu || !blockMenu || !inlineToolbar) {
    throw new Error('Editor session requires its document canvas and menus');
  }
  if (typeof adapters?.save !== 'function') {
    throw new Error('Editor session requires a save adapter');
  }

  let activeDocument = null;
  const documentModel = createEditorDocumentModel();
  let documentSnapshot = documentModel.snapshot();
  const unsubscribeDocumentModel = documentModel.subscribe((nextSnapshot) => {
    documentSnapshot = nextSnapshot;
  });
  let savedSource = '';
  let mode = 'read';
  let saveState = 'idle';
  let saveError = '';
  let activeBlockId = null;
  let overlayController = null;
  let selectionController = null;
  let blockInteractionController = null;
  let classicSurface = null;
  let caretTrail = null;
  let jsonPropertyEditor = null;
  let editPresentation = 'rendered';
  let disposed = false;
  let blockInputBound = false;
  let blockLineCounts = new Map();
  /** Additional source-projected blocks retained for legacy projection reconciliation. */
  let selectionSourceIds = new Set();
  const drafts = new Map();

  const isSourceSelected = () => editPresentation === 'source';
  const isSourcePresentation = () => mode === 'edit' && isSourceSelected();
  const isMarkdown = () => activeDocument?.markdown !== false && !isSourceSelected();
  const wantsJsonProps = () => !isSourceSelected() && activeDocument?.presentation === 'json-props';
  /** Block tools are optional chrome over the shared rich Rendered projection. */
  const isBlockEditor = () => (
    Boolean(adapters.isBlockEditor?.())
    && !isSourcePresentation()
    && !wantsJsonProps()
  );
  const isJsonProps = () => mode === 'edit' && wantsJsonProps() && Boolean(jsonPropertyEditor);
  const isBlockPresentation = () => mode === 'edit' && isMarkdown() && !isJsonProps();
  const isClassic = () => mode === 'edit' && !isBlockPresentation() && !isJsonProps();
  const flushJsonProps = () => {
    if (!isJsonProps()) return { ok: true, skipped: true };
    return jsonPropertyEditor.flushPending?.() || { ok: true, skipped: true };
  };
  const source = () => (
    isJsonProps()
      ? jsonPropertyEditor.source()
      : documentSnapshot.source
  );
  const dirty = () => {
    if (mode !== 'edit') return false;
    if (isJsonProps() && jsonPropertyEditor.hasPendingChanges?.()) return true;
    return source() !== savedSource;
  };
  const snapshot = () => Object.freeze({
    mode,
    path: activeDocument?.path || null,
    dirty: dirty(),
    saveState,
    error: saveError,
    stats: documentSnapshot.stats,
    cursor: documentSnapshot.cursor,
    presentation: isSourcePresentation()
      ? 'source'
      : isJsonProps() ? 'json-props' : isBlockPresentation() ? 'block' : 'classic',
  });
  const notify = () => hooks.onStateChange?.(snapshot());

  const reportJsonFlushFailure = (result) => {
    if (!result || result.ok !== false) return false;
    saveState = 'error';
    saveError = result.error || 'Fix invalid JSON values before continuing';
    notify();
    hooks.onUnavailable?.(saveError);
    return true;
  };

  const preparePresentationChange = () => {
    if (!isJsonProps()) return true;
    const flushed = flushJsonProps();
    return !reportJsonFlushFailure(flushed);
  };

  const disposeJsonPropertyEditor = () => {
    jsonPropertyEditor?.dispose?.();
    jsonPropertyEditor = null;
    root.classList.remove('is-json-props-presentation');
  };

  const setCursor = (nextCursor) => {
    if (!documentModel.setCursor(nextCursor)) return;
    hooks.onCursorChange?.(documentSnapshot.cursor);
  };

  const findBlock = (id) => documentModel.block(id);
  const findWrapper = (id) => [...canvas.querySelectorAll('[data-block-id]')]
    .find((wrapper) => wrapper.dataset.blockId === id) || null;

  const updateBlockToolbar = () => {
    if (!blockToolbar) return;
    // The preference controls block chrome, not the Rendered document projection.
    if (mode !== 'edit' || !activeBlockId || !isBlockEditor()) {
      blockToolbar.hidden = true;
      return;
    }
    const block = findBlock(activeBlockId);
    if (!block) {
      blockToolbar.hidden = true;
      return;
    }
    const context = contextFor(findWrapper(activeBlockId));
    blockToolbar.hidden = false;
    blockToolbar.dataset.activeBlockId = activeBlockId;
    const dragHandle = blockToolbar.querySelector('[data-block-drag], [data-block-menu]');
    if (dragHandle) {
      // Keep block identity on the toolbar root only so document-wide
      // `[data-block-id]` queries still mean canvas blocks.
      dragHandle.removeAttribute('data-block-id');
      dragHandle.draggable = !(block.type === 'paragraph' && block.text === '');
    }
    blockToolbar.querySelector('[data-block-toolbar-action="move-up"]')
      ?.toggleAttribute('disabled', !context?.canMoveUp);
    blockToolbar.querySelector('[data-block-toolbar-action="move-down"]')
      ?.toggleAttribute('disabled', !context?.canMoveDown);
    blockToolbar.querySelector('[data-block-toolbar-action="delete"]')
      ?.toggleAttribute('disabled', !context?.canDelete);
    const typeLabel = blockToolbar.querySelector('[data-block-toolbar-type-label]');
    if (typeLabel) typeLabel.textContent = editorBlockLabel(block.type);
  };

  const placeCaretInContent = (content, position = 'end') => {
    if (!content) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const numeric = typeof position === 'number' && Number.isFinite(position);
    let remaining = numeric
      ? Math.max(0, Math.floor(position))
      : position === 'start' ? 0 : Infinity;
    if (!content.firstChild) content.appendChild(document.createTextNode(''));
    const walker = document.createTreeWalker(content, window.NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let placed = false;
    while (node) {
      const len = node.nodeValue?.length || 0;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        break;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    if (!placed) {
      range.selectNodeContents(content);
      range.collapse(position === 'start');
    }
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const caretOffsetFromPointer = (element, event) => {
    if (!element || !event) return null;
    try {
      if (typeof document.caretPositionFromPoint === 'function' && Number.isFinite(event.clientX)) {
        const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
        if (pos?.offsetNode && element.contains(pos.offsetNode)) {
          const before = document.createRange();
          before.selectNodeContents(element);
          before.setEnd(pos.offsetNode, pos.offset);
          return before.toString().length;
        }
      }
      if (typeof document.caretRangeFromPoint === 'function' && Number.isFinite(event.clientX)) {
        const pointed = document.caretRangeFromPoint(event.clientX, event.clientY);
        if (pointed?.startContainer && element.contains(pointed.startContainer)) {
          const before = document.createRange();
          before.selectNodeContents(element);
          before.setEnd(pointed.startContainer, pointed.startOffset);
          return before.toString().length;
        }
      }
    } catch {
      /* jsdom */
    }
    return null;
  };

  /** Rebuild one wrapper body as source or preview (Classic live-preview). */
  const projectWrapperMode = (wrapper, block, { source, active }) => {
    if (!wrapper || !block) return;
    wrapper.className = `editor-block editor-block--${block.type}`;
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;
    wrapper.classList.toggle('is-active-line', Boolean(active));
    wrapper.classList.toggle('is-selection-source', Boolean(source && !active));
    const isSpacer = block.type === 'paragraph' && block.text === '';
    if (isSpacer) wrapper.dataset.blockSpacer = '';
    else delete wrapper.dataset.blockSpacer;
    wrapper.style.setProperty('--block-indent', String(block.indent || 0));

    const body = document.createElement('div');
    body.className = 'editor-block-body';

    if (block.type === 'divider') {
      const divider = document.createElement('div');
      divider.className = 'editor-divider';
      divider.setAttribute('role', 'separator');
      divider.tabIndex = isBlockEditor() ? 0 : -1;
      divider.dataset.editorContent = '';
      divider.dataset.editorMode = source ? 'source' : 'preview';
      divider.setAttribute('aria-label', 'Divider block');
      body.append(divider);
      wrapper.replaceChildren(body);
      return;
    }

    if (source) {
      if (block.type === 'todo') appendListChrome(body, block);
      else appendSourcePrefix(body, block);
    } else {
      appendListChrome(body, block);
    }

    const content = document.createElement(block.type === 'code' ? 'pre' : 'div');
    content.className = active
      ? 'editor-block-content is-active-line'
      : source
        ? 'editor-block-content is-selection-source'
        : 'editor-block-content editor-block-preview';
    content.dataset.editorContent = '';
    content.dataset.editorMode = source ? 'source' : 'preview';
    content.setAttribute('aria-label', `${editorBlockLabel(block.type)} block`);
    content.dataset.placeholder = block.type.startsWith('heading')
      ? 'Heading'
      : block.type === 'code'
        ? 'Write code…'
        : isBlockEditor()
          ? "Type '/' for commands"
          : 'Write…';

    if (source) {
      if (isBlockPresentation()) {
        content.contentEditable = 'true';
        content.tabIndex = 0;
        content.setAttribute('role', 'textbox');
        content.setAttribute('aria-multiline', String(block.type === 'code'));
      } else {
        content.removeAttribute('contenteditable');
        content.tabIndex = -1;
        content.setAttribute('aria-multiline', 'true');
      }
      content.spellcheck = block.type !== 'code';
      content.textContent = block.text;
    } else {
      content.contentEditable = 'false';
      content.tabIndex = -1;
      content.dataset.editorPreview = '';
      if (block.type === 'code' || !isMarkdown()) content.textContent = block.text;
      else content.innerHTML = inlineMarkdownToHtml(block.text);
    }

    body.append(content);
    wrapper.replaceChildren(body);
  };

  const focusBlock = (id, position = 'end', { preserveScroll = false } = {}) => {
    // Classic uses source-line indices, not block ids — no-op for block focus APIs.
    if (isClassic()) {
      if (classicSurface?.isMounted?.()) {
        classicSurface.render({
          source: source(),
          focusLine: classicSurface.activeLine?.() ?? 0,
          caret: position === 'start' ? 0 : null,
        });
      }
      return;
    }

    const previousId = activeBlockId;
    if (previousId && previousId !== id) {
      const previousWrapper = findWrapper(previousId);
      if (previousWrapper) updateBlockFromElement(previousWrapper);
    }

    activeBlockId = id;
    if (previousId !== id) {
      selectionSourceIds = new Set();
      const previousBlock = previousId ? findBlock(previousId) : null;
      const previousWrapper = previousId ? findWrapper(previousId) : null;
      const nextBlock = findBlock(id);
      const nextWrapper = findWrapper(id);
      if (previousWrapper && previousBlock && nextWrapper && nextBlock) {
        projectWrapperMode(previousWrapper, previousBlock, { source: false, active: false });
        projectWrapperMode(nextWrapper, nextBlock, { source: true, active: true });
        refreshBlockLineIndex();
        applyPresentationChrome();
      } else {
        render();
      }
    }
    const content = blockContent(findWrapper(id));
    if (!content) {
      updateBlockToolbar();
      return;
    }
    if (preserveScroll) content.focus({ preventScroll: true });
    else content.focus();
    placeCaretInContent(content, position);
    selectionController?.capture();
    updateBlockToolbar();
    if (!preserveScroll) content.scrollIntoView?.({ block: 'nearest' });
  };

  const cancelBlockAnimations = () => blockInteractionController?.cancelAnimations();
  const captureBlockLayout = () => blockInteractionController?.captureLayout();
  const animateBlockLayout = (layout, options) => blockInteractionController?.animateLayout(layout, options);

  const closeCommandMenu = (options) => overlayController?.closeCommand(options);
  const closeBlockMenu = (options) => overlayController?.closeBlock(options);

  const openCommandMenu = (blockId, query = '') => overlayController?.openCommand(blockId, query);
  const openBlockMenu = (blockId, anchor, options) => overlayController?.openBlock(blockId, anchor, options);

  const restoreHistory = (action) => {
    const result = action === 'redo'
      ? documentModel.redo(activeBlockId)
      : documentModel.undo(activeBlockId);
    if (!result.changed) return false;
    activeBlockId = result.focusId || activeBlockId;
    if (isClassic() && classicSurface?.isMounted?.()) {
      const line = Math.max(0, (result.cursor?.line || 1) - 1);
      const caret = Math.max(0, (result.cursor?.column || 1) - 1);
      classicSurface.render({ source: source(), focusLine: line, caret });
    } else {
      render();
    }
    notify();
    hooks.onHistoryRestore?.(action);
    if (!isClassic()) {
      queueMicrotask(() => focusBlock(result.focusId));
    }
    return true;
  };

  const applyBlockType = (id, type, { focus = 'end' } = {}) => {
    if (!documentModel.changeType(id, type)) return;
    activeBlockId = id;
    render();
    notify();
    closeCommandMenu();
    focusBlock(id, focus);
  };

  const addBlock = (afterId, type = 'paragraph', text = '') => {
    const next = documentModel.addAfter(afterId, { type, text });
    if (!next) return null;
    activeBlockId = next.id;
    render();
    notify();
    focusBlock(next.id, 'start');
    return next;
  };

  const removeBlock = (id, focusId = null) => {
    const previousLayout = captureBlockLayout();
    const result = documentModel.remove(id);
    if (!result?.changed) return false;
    activeBlockId = focusId || result.focusId;
    render({ previousLayout, enteringId: result.enteringId });
    notify();
    focusBlock(focusId || result.focusId);
    return true;
  };

  const moveBlock = (id, delta) => {
    const visibleBlocks = documentSnapshot.blocks.filter((block) => (
      block.type !== 'paragraph' || block.text !== ''
    ));
    const sourceIndex = visibleBlocks.findIndex((block) => block.id === id);
    const direction = Math.sign(Math.trunc(Number(delta) || 0));
    const target = visibleBlocks[sourceIndex + direction];
    if (sourceIndex < 0 || !direction || !target) return false;
    const previousLayout = captureBlockLayout();
    if (!documentModel.moveRelative(id, target.id, direction < 0 ? 'before' : 'after')) return false;
    activeBlockId = id;
    render({ previousLayout });
    notify();
    focusBlock(id);
    return true;
  };

  const duplicateBlock = (id) => {
    const previousLayout = captureBlockLayout();
    const copy = documentModel.duplicate(id);
    if (!copy) return false;
    activeBlockId = copy.id;
    render({ previousLayout, enteringId: copy.id });
    notify();
    focusBlock(copy.id);
    return true;
  };

  const contextFor = (target) => {
    const wrapper = target?.closest?.('[data-block-id]')
      || (activeBlockId ? findWrapper(activeBlockId) : null);
    if (!wrapper || !canvas.contains(wrapper)) return null;
    const block = findBlock(wrapper.dataset.blockId);
    if (!block) return null;
    const visibleBlocks = documentSnapshot.blocks.filter((candidate) => (
      candidate.type !== 'paragraph' || candidate.text !== ''
    ));
    const visibleIndex = visibleBlocks.findIndex((candidate) => candidate.id === block.id);
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const hasSelection = Boolean(
      range
      && !selection.isCollapsed
      && canvas.contains(range.commonAncestorContainer)
    );
    return Object.freeze({
      blockId: block.id,
      blockType: block.type,
      hasSelection,
      selectionText: hasSelection ? selection.toString() : '',
      canMoveUp: visibleIndex > 0,
      canMoveDown: visibleIndex >= 0 && visibleIndex < visibleBlocks.length - 1,
      canDelete: !(documentSnapshot.blocks.length === 1 && block.text === ''),
    });
  };

  const performBlockAction = (id, action) => {
    if (mode !== 'edit' || !isBlockPresentation()) return false;
    if (action === 'move-up') return moveBlock(id, -1);
    if (action === 'move-down') return moveBlock(id, 1);
    if (action === 'duplicate') return duplicateBlock(id);
    if (action === 'delete') return removeBlock(id);
    return false;
  };

  const liveMarkdownPatch = (block, text) => {
    if (!isBlockPresentation() || block?.type !== 'paragraph') return null;
    const fence = text.match(/^\s{0,3}(```|~~~)\s*([^\s`]*)\s*$/);
    if (fence) {
      return {
        type: 'code',
        text: '',
        language: fence[2] || '',
        fence: fence[1],
      };
    }
    const parsed = parseMarkdownLine(text);
    if (parsed.type === 'paragraph') return null;
    return {
      type: parsed.type,
      text: parsed.text,
      checked: parsed.checked,
      indent: parsed.indent,
      number: parsed.number,
      language: parsed.language,
      fence: parsed.fence,
    };
  };

  const updateBlockFromElement = (wrapper) => {
    const block = findBlock(wrapper?.dataset.blockId);
    if (!block) return null;
    const previousLineCount = blockLineCounts.get(block.id);
    const content = blockContent(wrapper);
    const checkbox = wrapper.querySelector('[data-todo-check]');
    if (!content && !checkbox) return null;
    const text = content ? readEditableText(content) : block.text;
    const structuralPatch = content ? liveMarkdownPatch(block, text) : null;
    const updated = documentModel.updateBlock(block.id, {
      ...(content ? (structuralPatch || { text }) : {}),
      ...(checkbox ? { checked: checkbox.checked } : {}),
    });
    if (updated && previousLineCount !== undefined && previousLineCount !== sourceLineCount(updated)) {
      refreshBlockLineIndex();
    }
    return {
      block: updated,
      reclassified: Boolean(updated && structuralPatch),
    };
  };

  /** Commit every source-mode block (active + multi-select expansion). */
  const commitAllSourceBlocks = () => {
    canvas.querySelectorAll('[data-block-id]').forEach((wrapper) => {
      const content = blockContent(wrapper);
      if (!content || content.dataset.editorMode !== 'source') return;
      updateBlockFromElement(wrapper);
    });
  };

  const updateContextChrome = () => {
    const markdown = isMarkdown();
    if (contextLabel) {
      contextLabel.textContent = isSourcePresentation()
        ? 'Source editor'
        : wantsJsonProps()
        ? 'JSON properties'
        : markdown
          ? (isBlockEditor() ? 'Block live preview' : 'Live preview')
          : 'Plain-text editor';
    }
    if (!contextHint) return;
    contextHint.replaceChildren();
    if (isSourcePresentation()) {
      contextHint.textContent = 'Edit raw source directly';
    } else if (wantsJsonProps()) {
      contextHint.textContent = 'Edit top-level keys · nested values as JSON';
    } else if (markdown && isBlockEditor()) {
      contextHint.append('Type ');
      const shortcut = document.createElement('kbd');
      shortcut.textContent = '/';
      contextHint.append(shortcut, ' for blocks · active block shows source');
    } else if (markdown) {
      contextHint.textContent = 'Active block is Markdown · other blocks are preview';
    } else {
      contextHint.textContent = 'Each line saves as text';
    }
  };

  const markNonEditableChrome = (element) => {
    if (!element) return element;
    element.contentEditable = 'false';
    element.setAttribute('aria-hidden', element.getAttribute('aria-hidden') || 'true');
    return element;
  };

  const appendListChrome = (body, block) => {
    if (block.type === 'todo') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = block.checked;
      checkbox.className = 'editor-todo-checkbox';
      checkbox.dataset.todoCheck = '';
      checkbox.setAttribute('aria-label', block.checked ? 'Mark task incomplete' : 'Mark task complete');
      // Keep interactive but outside the Classic continuous text host.
      checkbox.contentEditable = 'false';
      body.append(checkbox);
    }
    if (block.type === 'numbered') {
      const number = document.createElement('span');
      number.className = 'editor-list-marker';
      number.textContent = `${block.number}.`;
      markNonEditableChrome(number);
      body.append(number);
    }
    if (block.type === 'bullet') {
      const bullet = document.createElement('span');
      bullet.className = 'editor-list-marker';
      bullet.textContent = '•';
      markNonEditableChrome(bullet);
      body.append(bullet);
    }
  };

  /** Muted structural Markdown markers on source lines (Obsidian-like readability). */
  const appendSourcePrefix = (body, block) => {
    if (!isMarkdown()) return;
    let prefix = '';
    if (block.type === 'heading1') prefix = '#';
    else if (block.type === 'heading2') prefix = '##';
    else if (block.type === 'heading3') prefix = '###';
    else if (block.type === 'heading4') prefix = '####';
    else if (block.type === 'heading5') prefix = '#####';
    else if (block.type === 'heading6') prefix = '######';
    else if (block.type === 'quote') prefix = '>';
    else if (block.type === 'bullet') prefix = '-';
    else if (block.type === 'numbered') prefix = `${Math.max(1, Number(block.number) || 1)}.`;
    else if (block.type === 'todo') prefix = `- [${block.checked ? 'x' : ' '}]`;
    if (!prefix) return;
    const mark = document.createElement('span');
    mark.className = 'editor-source-prefix';
    mark.textContent = `${prefix} `;
    markNonEditableChrome(mark);
    body.append(mark);
  };

  const renderBlock = (block, index) => {
    const isSpacer = block.type === 'paragraph' && block.text === '';
    // Rendered live preview: the active block shows source Markdown and every
    // other block stays rendered. Continuous multi-line work belongs to Source Edit.
    const showSource = activeBlockId === block.id || selectionSourceIds.has(block.id);
    const isActive = activeBlockId === block.id;
    const wrapper = document.createElement('div');
    wrapper.className = `editor-block editor-block--${block.type}`;
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;
    if (isSpacer) wrapper.dataset.blockSpacer = '';
    projectWrapperMode(wrapper, block, { source: showSource, active: isActive });
    // projectWrapperMode owns body/content; index is only for a11y labels on create.
    const content = blockContent(wrapper);
    if (content) {
      content.setAttribute('aria-label', `${editorBlockLabel(block.type)} block ${index + 1}`);
    }
    return wrapper;
  };

  const sourceLineCount = (block) => serializeEditorDocument([block], {
    markdown: isMarkdown(),
  }).split('\n').length;

  const refreshBlockLineIndex = () => {
    let nextLine = 1;
    const nextCounts = new Map();
    documentSnapshot.blocks.forEach((block) => {
      const wrapper = findWrapper(block.id);
      const lineCount = sourceLineCount(block);
      if (wrapper) {
        wrapper.dataset.sourceLineStart = String(nextLine);
        wrapper.dataset.sourceLineCount = String(lineCount);
      }
      nextCounts.set(block.id, lineCount);
      nextLine += lineCount;
    });
    blockLineCounts = nextCounts;
  };

  function applyPresentationChrome() {
    const blockMode = isBlockPresentation();
    const jsonMode = isJsonProps();
    root.classList.toggle('is-source-presentation', isSourcePresentation());
    root.classList.toggle('is-block-presentation', blockMode && mode === 'edit');
    root.classList.toggle('is-classic-presentation', !blockMode && !jsonMode && mode === 'edit');
    root.classList.toggle('is-json-props-presentation', jsonMode);
    if (mode === 'edit' && jsonMode) {
      canvas.contentEditable = 'false';
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-multiline');
      canvas.setAttribute('aria-label', 'JSON property editor');
      canvas.classList.remove('is-classic-surface');
    } else if (mode === 'edit' && !blockMode) {
      canvas.contentEditable = 'true';
      canvas.setAttribute('role', 'textbox');
      canvas.setAttribute('aria-multiline', 'true');
      canvas.setAttribute('aria-label', isSourcePresentation() ? 'Source editor' : 'Document editor');
      canvas.classList.add('is-classic-surface');
    } else {
      canvas.contentEditable = 'false';
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-multiline');
      canvas.removeAttribute('aria-label');
      canvas.classList.remove('is-classic-surface');
    }
  }

  function render({ previousLayout = null, enteringId = null } = {}) {
    if (!previousLayout) cancelBlockAnimations();

    // JSON property surface owns the canvas; never reproject Markdown blocks over it.
    if (isJsonProps()) {
      unbindBlockInput();
      if (classicSurface?.isMounted?.()) classicSurface.unmount();
      applyPresentationChrome();
      if (blockToolbar) blockToolbar.hidden = true;
      root.classList.toggle('is-empty-document', source().length === 0);
      return;
    }

    // Source Edit and non-Markdown content use the continuous raw-source surface.
    if (isClassic()) {
      unbindBlockInput();
      applyPresentationChrome();
      if (!classicSurface?.isMounted?.()) classicSurface?.mount?.();
      else classicSurface?.render?.({ source: source(), focusLine: classicSurface.activeLine?.() ?? 0 });
      root.classList.toggle('is-empty-document', source().length === 0);
      updateBlockToolbar();
      return;
    }

    // Block presentation: leave classic surface and project block islands.
    if (classicSurface?.isMounted?.()) classicSurface.unmount();
    const fragment = document.createDocumentFragment();
    documentSnapshot.blocks.forEach((block, index) => fragment.append(renderBlock(block, index)));
    canvas.replaceChildren(fragment);
    applyPresentationChrome();
    refreshBlockLineIndex();
    root.classList.toggle(
      'is-empty-document',
      documentSnapshot.blocks.length === 1 && documentSnapshot.blocks[0].text === '',
    );
    animateBlockLayout(previousLayout, { enteringId });
    updateBlockToolbar();
    bindBlockInput();
  }

  const splitBlock = (wrapper) => {
    const block = findBlock(wrapper.dataset.blockId);
    const content = blockContent(wrapper);
    if (!block || !content || block.type === 'code') return false;
    const { before, after } = markdownAroundSelection(document, content, window.getSelection());
    const next = documentModel.split(block.id, { before, after });
    if (!next) return false;
    activeBlockId = next.id;
    render();
    notify();
    focusBlock(next.id, 'start');
    return true;
  };

  const mergeWithPrevious = (wrapper) => {
    const result = documentModel.mergeWithPrevious(wrapper.dataset.blockId);
    if (!result?.changed) return false;
    activeBlockId = result.focusId;
    render();
    notify();
    focusBlock(result.focusId);
    const content = blockContent(findWrapper(result.focusId));
    if (content) {
      const walker = document.createTreeWalker(content, window.NodeFilter.SHOW_TEXT);
      let remaining = result.offset;
      let textNode = walker.nextNode();
      while (textNode && remaining > textNode.nodeValue.length) {
        remaining -= textNode.nodeValue.length;
        textNode = walker.nextNode();
      }
      if (textNode) {
        const range = document.createRange();
        range.setStart(textNode, Math.min(remaining, textNode.nodeValue.length));
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    return true;
  };

  const handleCanvasInput = (event) => {
    if (event?.isComposing || event?.key === 'Process') return;
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper) return;
    const content = blockContent(wrapper);
    const caret = caretOffset(content, window.getSelection());
    const update = updateBlockFromElement(wrapper);
    activeBlockId = wrapper.dataset.blockId;
    saveState = 'idle';
    saveError = '';
    if (update?.reclassified) {
      selectionSourceIds = new Set();
      closeCommandMenu();
      const block = findBlock(activeBlockId);
      const live = findWrapper(activeBlockId);
      if (live && block) {
        projectWrapperMode(live, block, { source: true, active: true });
        refreshBlockLineIndex();
        const nextContent = blockContent(live);
        nextContent?.focus({ preventScroll: true });
        placeCaretInContent(nextContent, caret);
      } else {
        render();
        focusBlock(activeBlockId, caret);
      }
      notify();
      updateBlockToolbar();
      return;
    }
    notify();
    updateBlockToolbar();
    const block = findBlock(activeBlockId);
    // Slash commands are Block-presentation tools only.
    if (isBlockEditor() && block?.type !== 'code' && block?.text.startsWith('/')) {
      openCommandMenu(activeBlockId, block.text.slice(1));
    } else if (overlayController?.isCommandOpenFor(activeBlockId)) {
      closeCommandMenu();
    }
  };

  const handleCanvasKeydown = (event) => {
    if (event.isComposing || event.key === 'Process') return;
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper) return;
    const block = findBlock(wrapper.dataset.blockId);
    const content = blockContent(wrapper);
    const selection = window.getSelection();
    activeBlockId = block?.id || null;
    updateBlockToolbar();

    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      restoreHistory(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      restoreHistory('redo');
      return;
    }
    const headingMatch = block?.type?.match(/^heading([1-6])$/);
    if (
      event.key === '#'
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && selection?.isCollapsed
      && content
      && caretOffset(content, selection) === 0
      && headingMatch
      && Number(headingMatch[1]) < 6
    ) {
      event.preventDefault();
      applyBlockType(block.id, `heading${Number(headingMatch[1]) + 1}`, { focus: 'start' });
      return;
    }
    // Block-presentation tools only (toolbar, slash, drag, and matching shortcuts).
    if (isBlockEditor()) {
      if ((event.ctrlKey || event.metaKey) && event.altKey && /^[1-3]$/.test(event.key)) {
        event.preventDefault();
        applyBlockType(block.id, `heading${event.key}`);
        return;
      }
      if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveBlock(block.id, event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        const handle = blockToolbar?.querySelector('[data-block-menu]') || blockToolbar;
        if (handle) openBlockMenu(block.id, handle, { focus: true });
        return;
      }
      if (event.key === 'Tab' && ['bullet', 'numbered', 'todo'].includes(block?.type)) {
        event.preventDefault();
        const updated = documentModel.indent(block.id, event.shiftKey ? -1 : 1);
        if (updated) wrapper.style.setProperty('--block-indent', String(updated.indent));
        notify();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      if (selectionController?.openLinkFromCurrentSelection()) {
        event.preventDefault();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const inlineCommand = event.key.toLowerCase() === 'e'
        ? 'code'
        : event.shiftKey && event.key.toLowerCase() === 'x'
          ? 'strike'
          : null;
      if (inlineCommand && selectionController?.applyFromCurrentSelection(inlineCommand)) {
        event.preventDefault();
        return;
      }
    }

    if (
      isBlockEditor()
      && overlayController?.handleCommandKey(event, { blockId: block.id, query: block.text.slice(1) })
    ) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && block?.type !== 'code') {
      event.preventDefault();
      selectionSourceIds = new Set();
      splitBlock(wrapper);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Move between blocks when caret is at edge of active source line.
      if (content && selection?.isCollapsed) {
        const offset = caretOffset(content, selection);
        const length = content.textContent?.length || 0;
        const atStart = offset === 0;
        const atEnd = offset >= length;
        if ((event.key === 'ArrowUp' && atStart) || (event.key === 'ArrowDown' && atEnd)) {
          const blocks = documentSnapshot.blocks;
          const index = blocks.findIndex((item) => item.id === block.id);
          const next = blocks[index + (event.key === 'ArrowDown' ? 1 : -1)];
          if (next) {
            event.preventDefault();
            focusBlock(next.id, event.key === 'ArrowDown' ? 'start' : 'end');
            return;
          }
        }
      }
    }

    if (
      event.key === 'Delete'
      && content
      && selection?.isCollapsed
      && caretOffset(content, selection) >= (content.textContent?.length || 0)
    ) {
      const blocks = documentSnapshot.blocks;
      const index = blocks.findIndex((item) => item.id === block.id);
      const next = blocks[index + 1];
      if (next) {
        event.preventDefault();
        mergeWithPrevious(findWrapper(next.id));
        return;
      }
    }

    if (event.key === 'Backspace') {
      if (block?.type === 'divider') {
        event.preventDefault();
        removeBlock(block.id);
        return;
      }
      if (content && caretOffset(content, selection) === 0) {
        if (block.type !== 'paragraph' && block.type !== 'code') {
          event.preventDefault();
          const heading = block.type.match(/^heading([1-6])$/);
          const nextType = heading && Number(heading[1]) > 1
            ? `heading${Number(heading[1]) - 1}`
            : 'paragraph';
          applyBlockType(block.id, nextType, { focus: 'start' });
        } else if (block.text === '' && documentSnapshot.blocks.length > 1) {
          event.preventDefault();
          removeBlock(block.id);
        } else if (mergeWithPrevious(wrapper)) {
          event.preventDefault();
        }
      }
    }
  };

  let pendingPointerActivate = null;

  const pointerCaretFor = (wrapper, event) => {
    const content = blockContent(wrapper);
    let position = caretOffsetFromPointer(content, event);
    if (position == null && content) position = caretOffset(content, window.getSelection());
    if (position == null) position = 0;
    return position;
  };

  const activateBlockFromPointer = (wrapper, event, { preserveScroll = true } = {}) => {
    const id = wrapper.dataset.blockId;
    const position = pendingPointerActivate?.id === id
      ? pendingPointerActivate.position
      : pointerCaretFor(wrapper, event);
    pendingPointerActivate = { id, position };
    if (activeBlockId !== id) {
      selectionSourceIds = new Set();
      focusBlock(id, position, { preserveScroll });
    }
    return position;
  };

  const handleCanvasPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest?.('[data-todo-check]')) return;
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper) {
      pendingPointerActivate = null;
      return;
    }
    activateBlockFromPointer(wrapper, event);
  };

  const handleCanvasClick = (event) => {
    if (event.target.closest?.('[data-todo-check]')) return;
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper) return;
    const id = wrapper.dataset.blockId;
    if (activeBlockId !== id) {
      activateBlockFromPointer(wrapper, event, { preserveScroll: false });
    } else {
      activeBlockId = id;
      updateBlockToolbar();
    }
    pendingPointerActivate = null;
  };

  const handleCanvasFocusIn = (event) => {
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper || !canvas.contains(wrapper)) return;
    const id = wrapper.dataset.blockId;

    if (activeBlockId !== id) {
      const pending = pendingPointerActivate?.id === id ? pendingPointerActivate.position : null;
      const content = blockContent(wrapper);
      let position = pending;
      if (position == null) position = caretOffsetFromPointer(content, event);
      if (position == null && content) position = caretOffset(content, window.getSelection());
      if (position == null) position = 0;
      selectionSourceIds = new Set();
      focusBlock(id, position, { preserveScroll: true });
    } else {
      updateBlockToolbar();
    }
  };

  const handleCanvasChange = (event) => {
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper || !event.target.matches('[data-todo-check]')) return;
    updateBlockFromElement(wrapper);
    event.target.setAttribute('aria-label', event.target.checked ? 'Mark task incomplete' : 'Mark task complete');
    notify();
  };

  const handleBlockToolbarClick = (event) => {
    const button = event.target.closest?.('[data-block-toolbar-action], [data-block-menu]');
    if (!button || !blockToolbar?.contains(button)) return;
    const id = activeBlockId || blockToolbar.dataset.activeBlockId;
    if (!id) return;
    if (button.matches('[data-block-menu]')) {
      // Click opens menu; drag is handled by the interaction controller.
      openBlockMenu(id, button);
      return;
    }
    const action = button.dataset.blockToolbarAction;
    if (action === 'add') {
      const next = addBlock(id);
      if (next) openCommandMenu(next.id);
      return;
    }
    if (action === 'type') {
      openCommandMenu(id, '');
      return;
    }
    if (action === 'move-up') performBlockAction(id, 'move-up');
    if (action === 'move-down') performBlockAction(id, 'move-down');
    if (action === 'duplicate') performBlockAction(id, 'duplicate');
    if (action === 'delete') performBlockAction(id, 'delete');
  };

  const clearDragState = () => blockInteractionController?.clearDragState();

  const syncBlockToolControllers = () => {
    if (!blockInputBound || disposed) return;
    if (isBlockEditor()) {
      overlayController?.start();
      blockInteractionController?.start();
    } else {
      overlayController?.stop();
      blockInteractionController?.stop();
    }
  };

  const bindBlockInput = () => {
    if (blockInputBound || disposed) return;
    canvas.addEventListener('input', handleCanvasInput);
    canvas.addEventListener('keydown', handleCanvasKeydown);
    canvas.addEventListener('mousedown', handleCanvasPointerDown);
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('focusin', handleCanvasFocusIn);
    canvas.addEventListener('change', handleCanvasChange);
    blockToolbar?.addEventListener('click', handleBlockToolbarClick);
    selectionController?.start();
    blockInputBound = true;
    syncBlockToolControllers();
  };

  const unbindBlockInput = () => {
    if (!blockInputBound) return;
    canvas.removeEventListener('input', handleCanvasInput);
    canvas.removeEventListener('keydown', handleCanvasKeydown);
    canvas.removeEventListener('mousedown', handleCanvasPointerDown);
    canvas.removeEventListener('click', handleCanvasClick);
    canvas.removeEventListener('focusin', handleCanvasFocusIn);
    canvas.removeEventListener('change', handleCanvasChange);
    blockToolbar?.removeEventListener('click', handleBlockToolbarClick);
    selectionController?.stop();
    overlayController?.stop();
    blockInteractionController?.stop();
    caretTrail?.hide?.();
    blockInputBound = false;
  };

  const mountJsonProperties = (initialSource) => {
    const parsed = parseJsonPropertyModel(initialSource);
    if (!parsed.ok) return parsed;
    activeDocument = { ...activeDocument, presentation: 'json-props' };
    jsonPropertyEditor = createJsonPropertyEditor({
      window,
      root: canvas,
      onChange: ({ source: nextSource }) => {
        documentModel.applySource(nextSource);
        saveState = 'idle';
        saveError = '';
        notify();
      },
      onDiagnostic: hooks.onDiagnostic,
    });
    unbindBlockInput();
    if (classicSurface?.isMounted?.()) classicSurface.unmount();
    jsonPropertyEditor.load(initialSource);
    applyPresentationChrome();
    updateContextChrome();
    root.hidden = false;
    root.removeAttribute('inert');
    if (blockToolbar) blockToolbar.hidden = true;
    notify();
    queueMicrotask(() => {
      canvas.querySelector('[data-json-value]')?.focus?.({ preventScroll: true });
    });
    return { ok: true };
  };

  const enter = () => {
    if (disposed || !activeDocument) return false;
    const draft = drafts.get(activeDocument.path);
    const initialSource = draft?.source ?? activeDocument.source;
    const lineCount = initialSource.split('\n').length;
    if (initialSource.length > MAX_EDITABLE_CHARACTERS || lineCount > MAX_EDITABLE_BLOCKS) {
      hooks.onUnavailable?.(
        'This document is too large for live-preview editing. Source view is still available.'
      );
      return false;
    }

    disposeJsonPropertyEditor();
    editPresentation = adapters.isSourceMode?.() ? 'source' : 'rendered';

    let useJsonProps = wantsJsonProps();
    if (useJsonProps) {
      const parsed = parseJsonPropertyModel(initialSource);
      if (!parsed.ok) {
        // Invalid / primitive / oversized JSON falls back to plain monospace edit.
        useJsonProps = false;
        if (parsed.reason === 'invalid') {
          hooks.onUnavailable?.('Invalid JSON — editing as plain text');
        } else if (parsed.reason === 'too-large') {
          hooks.onUnavailable?.('Large JSON — editing as plain text');
        }
      }
    }

    documentModel.load(initialSource, {
      markdown: Boolean(activeDocument.markdown) && !useJsonProps && !isSourceSelected(),
    });
    savedSource = activeDocument.source;
    mode = 'edit';
    saveState = draft ? 'recovered' : 'idle';
    saveError = '';
    activeBlockId = documentSnapshot.blocks[0]?.id || null;
    selectionSourceIds = new Set();

    if (useJsonProps) {
      mountJsonProperties(initialSource);
      return true;
    }

    // Ensure plain path if we fell back from json-props.
    if (wantsJsonProps() && !useJsonProps) {
      activeDocument = { ...activeDocument, presentation: 'default', markdown: false };
    }

    render();
    applyPresentationChrome();
    updateContextChrome();
    root.hidden = false;
    root.removeAttribute('inert');
    updateBlockToolbar();
    notify();
    if (isClassic()) {
      queueMicrotask(() => {
        classicSurface?.render?.({ source: source(), focusLine: 0, caret: 0 });
        canvas.focus({ preventScroll: true });
      });
    } else {
      queueMicrotask(() => focusBlock(documentSnapshot.blocks[0].id, 'start', { preserveScroll: true }));
    }
    return true;
  };

  const exit = ({ force = false } = {}) => {
    if (mode !== 'edit') return true;
    flushJsonProps();
    if (dirty() && !force) {
      const discard = window.confirm('Discard unsaved changes and return to reading?');
      if (!discard) return false;
    }
    closeCommandMenu();
    closeBlockMenu();
    clearDragState();
    cancelBlockAnimations();
    selectionController?.clear();
    unbindBlockInput();
    if (classicSurface?.isMounted?.()) classicSurface.unmount();
    disposeJsonPropertyEditor();
    mode = 'read';
    saveState = 'idle';
    saveError = '';
    activeBlockId = null;
    selectionSourceIds = new Set();
    applyPresentationChrome();
    if (blockToolbar) blockToolbar.hidden = true;
    root.hidden = true;
    root.setAttribute('inert', '');
    notify();
    return true;
  };

  /** Re-project when Source/Rendered changes, or block tools are toggled. */
  const refreshPresentation = () => {
    if (disposed || mode !== 'edit') return;
    const nextEditPresentation = adapters.isSourceMode?.() ? 'source' : 'rendered';
    const presentationChanged = nextEditPresentation !== editPresentation;
    // JSON props ignore Classic/Block preference flips; keep the property surface.
    if (isJsonProps() && !presentationChanged) {
      applyPresentationChrome();
      updateContextChrome();
      if (blockToolbar) blockToolbar.hidden = true;
      notify();
      return true;
    }
    if (!presentationChanged) {
      if (classicSurface?.isMounted?.()) classicSurface.commitFromDom?.();
      else commitAllSourceBlocks();
      updateContextChrome();
      updateBlockToolbar();
      syncBlockToolControllers();
      notify();
      return true;
    }
    if (isJsonProps()) {
      if (!preparePresentationChange()) return false;
    } else if (classicSurface?.isMounted?.()) {
      classicSurface.commitFromDom?.();
    } else {
      commitAllSourceBlocks();
    }
    const committedSource = source();
    editPresentation = nextEditPresentation;
    disposeJsonPropertyEditor();
    documentModel.load(committedSource, {
      markdown: Boolean(activeDocument?.markdown) && !isSourceSelected(),
    });
    selectionSourceIds = new Set();
    closeCommandMenu();
    closeBlockMenu();
    clearDragState();
    // applySource re-parses blocks with new ids — always rebind the active block.
    activeBlockId = documentSnapshot.blocks[0]?.id || null;
    if (!isSourceSelected() && activeDocument?.presentation === 'json-props') {
      const result = mountJsonProperties(source());
      if (result.ok) return true;
      activeDocument = { ...activeDocument, presentation: 'default', markdown: false };
      const unavailableMessage = result.reason === 'invalid'
        ? 'Invalid JSON — editing as plain text'
        : 'Large JSON — editing as plain text';
      const fallbackPath = activeDocument.path;
      // Source/Rendered controls announce their settled mode after this refresh.
      // Defer the actionable fallback message so generic mode feedback cannot hide it.
      window.setTimeout(() => {
        if (
          !disposed
          && mode === 'edit'
          && !isSourceSelected()
          && activeDocument?.path === fallbackPath
        ) hooks.onUnavailable?.(unavailableMessage);
      }, 0);
    }
    if (classicSurface?.isMounted?.() && isBlockPresentation()) classicSurface.unmount();
    render();
    updateContextChrome();
    updateBlockToolbar();
    notify();
    if (isClassic()) {
      queueMicrotask(() => {
        classicSurface?.render?.({ source: source(), focusLine: 0, caret: 0 });
        canvas.focus({ preventScroll: true });
      });
    } else if (activeBlockId) {
      queueMicrotask(() => focusBlock(activeBlockId, 'end', { preserveScroll: true }));
    }
    return true;
  };

  const save = async () => {
    if (disposed || mode !== 'edit' || !activeDocument || saveState === 'saving') {
      return { status: 'unavailable' };
    }
    if (isJsonProps()) {
      const flushed = flushJsonProps();
      if (reportJsonFlushFailure(flushed)) {
        // Park autosave (observeEditor skips saveState error) until the next edit.
        return { status: 'unavailable', error: flushed.error };
      }
      documentModel.applySource(source());
    } else if (isClassic()) {
      classicSurface?.commitFromDom?.();
    } else {
      commitAllSourceBlocks();
    }
    const savingDocument = activeDocument;
    const savingPath = savingDocument.path;
    const nextSource = source();
    if (nextSource === savedSource) return { status: 'unchanged', source: nextSource };
    saveState = 'saving';
    saveError = '';
    notify();
    try {
      const result = await adapters.save(savingPath, nextSource);
      if (disposed || activeDocument !== savingDocument) return { status: 'stale' };
      savedSource = nextSource;
      drafts.delete(savingPath);
      saveState = 'saved';
      notify();
      await hooks.onSaved?.({ path: savingPath, source: nextSource, result });
      return { status: 'saved', source: nextSource, result };
    } catch (error) {
      if (disposed || activeDocument !== savingDocument) return { status: 'stale' };
      saveState = 'error';
      saveError = errorMessage(error);
      drafts.set(savingPath, { source: nextSource, savedSource });
      notify();
      hooks.onDiagnostic?.('Could not save the document', error);
      return { status: 'failed', error };
    }
  };

  const setDocument = ({
    path,
    source: nextSource,
    markdown = true,
    presentation = 'default',
  }) => {
    const normalizedSource = String(nextSource ?? '');
    const sameActiveEditor = mode === 'edit' && activeDocument?.path === path;
    if (activeDocument?.path && activeDocument.path !== path) {
      // Commit in-progress JSON cells before judging dirty / stashing a draft.
      flushJsonProps();
      if (dirty()) {
        drafts.set(activeDocument.path, { source: source(), savedSource });
        hooks.onDraftPreserved?.(activeDocument.path);
      }
    }
    activeDocument = {
      path,
      source: normalizedSource,
      markdown: Boolean(markdown),
      presentation: presentation === 'json-props' ? 'json-props' : 'default',
    };
    updateContextChrome();
    if (sameActiveEditor) {
      savedSource = normalizedSource;
      if (isJsonProps()) {
        jsonPropertyEditor?.load(normalizedSource);
      }
      saveState = source() === normalizedSource ? 'saved' : 'idle';
      saveError = '';
      notify();
    } else if (mode === 'edit') enter();
    else notify();
  };

  const clearDocument = () => {
    flushJsonProps();
    if (dirty() && activeDocument?.path) {
      drafts.set(activeDocument.path, { source: source(), savedSource });
    }
    activeDocument = null;
    exit({ force: true });
    documentModel.load('');
    savedSource = '';
    notify();
  };

  const canChangeDocument = () => {
    flushJsonProps();
    if (!dirty()) return true;
    const discard = window.confirm('Discard unsaved changes?');
    if (discard) exit({ force: true });
    return discard;
  };

  const resolveReduceMotion = () => shouldReduceMotion(
    window,
    adapters.getAdvancedPreferences?.() || null,
  );

  const activeLineBand = elements.activeLineBand
    || document.getElementById('editor-active-line-band');
  const trailCanvas = elements.caretTrail
    || document.getElementById('editor-caret-trail');

  if (trailCanvas) {
    caretTrail = createEditorCaretTrail({
      window,
      canvas: trailCanvas,
      adapters: { shouldReduceMotion: resolveReduceMotion },
    });
  }

  classicSurface = createEditorClassicSurface({
    window,
    canvas,
    adapters: {
      isMarkdown: () => isMarkdown(),
      highlightSource: () => isSourcePresentation() && activeDocument?.markdown !== false,
      getSource: () => source(),
      applySource: (next, options) => documentModel.applySource(next, options),
      restoreHistory,
      setCursor,
      shouldReduceMotion: resolveReduceMotion,
      getAriaLabel: () => isSourcePresentation() ? 'Source editor' : 'Document editor',
      getActiveLineBand: () => activeLineBand,
      getBandHost: () => root,
    },
    hooks: {
      onChange: () => {
        saveState = 'idle';
        saveError = '';
        notify();
      },
    },
  });

  overlayController = createEditorOverlayController({
    window,
    document,
    elements: { canvas, commandMenu, blockMenu },
    commands: EDITOR_COMMANDS,
    adapters: {
      isMarkdown: () => isMarkdown(),
      getBlock: findBlock,
      getBlocks: () => documentSnapshot.blocks,
      getWrapper: findWrapper,
      focusBlock,
    },
    hooks: {
      onCommand: applyBlockType,
      onBlockAction: performBlockAction,
    },
  });
  selectionController = createEditorSelectionController({
    window,
    document,
    elements: {
      root,
      canvas,
      inlineToolbar,
      caretEcho,
      linkPopover,
      linkInput,
      linkApply,
    },
    adapters: {
      isEditing: () => mode === 'edit',
      isMarkdown: () => isMarkdown(),
      getActiveBlockId: () => activeBlockId,
      setCursor,
      shouldReduceMotion: resolveReduceMotion,
      getCaretTrail: () => caretTrail,
      updateBlockFromElement,
    },
    hooks: {
      onDocumentChange: notify,
      focusBlock,
    },
  });
  blockInteractionController = createEditorBlockInteractionController({
    window,
    elements: { root, canvas },
    adapters: {
      moveRelative: (id, targetId, position) => documentModel.moveRelative(id, targetId, position),
      render: () => render(),
      focusBlock,
      getDragBlockId: () => activeBlockId,
      shouldReduceMotion: resolveReduceMotion,
    },
    hooks: {
      closeTransientUi: () => {
        closeBlockMenu();
        closeCommandMenu();
      },
      onReorder: notify,
    },
  });

  root.hidden = true;
  root.setAttribute('inert', '');
  if (blockToolbar) blockToolbar.hidden = true;

  return Object.freeze({
    setDocument,
    clearDocument,
    enter,
    exit,
    preparePresentationChange,
    refreshPresentation,
    toggle() {
      return mode === 'edit' ? exit() : enter();
    },
    save,
    canChangeDocument,
    isEditing: () => mode === 'edit',
    isDirty: dirty,
    isBlockEditor,
    current: snapshot,
    source,
    contextFor,
    jsonPropertyActions: Object.freeze({
      duplicate: (path) => jsonPropertyEditor?.duplicate?.(path),
      remove: (path) => jsonPropertyEditor?.remove?.(path),
    }),
    applyInlineCommand: (command) => (
      mode === 'edit' && isBlockPresentation()
        ? (selectionController?.applyFromCurrentSelection(command) || false)
        : false
    ),
    openLinkFromSelection: () => (
      mode === 'edit' && isBlockPresentation()
        ? (selectionController?.openLinkFromCurrentSelection() || false)
        : false
    ),
    performBlockAction,
    dispose() {
      if (disposed) return;
      disposed = true;
      unbindBlockInput();
      if (classicSurface?.isMounted?.()) classicSurface.unmount();
      disposeJsonPropertyEditor();
      overlayController?.dispose();
      selectionController?.dispose();
      blockInteractionController?.dispose();
      classicSurface?.dispose?.();
      caretTrail?.dispose?.();
      unsubscribeDocumentModel();
      documentModel.dispose();
      clearDragState();
      cancelBlockAnimations();
      closeCommandMenu();
      closeBlockMenu();
      if (blockToolbar) blockToolbar.hidden = true;
    },
  });
}

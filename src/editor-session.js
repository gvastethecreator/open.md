import {
  EDITOR_COMMANDS,
  createEditorDocumentModel,
  editableHtmlToMarkdown,
  editorBlockLabel,
  inlineMarkdownToHtml,
  serializeEditorDocument,
} from './editor-document.js';
import { createEditorOverlayController } from './editor-overlay-controller.js';
import { createEditorSelectionController } from './editor-selection-controller.js';
import { createEditorBlockInteractionController } from './editor-block-interaction-controller.js';

const MAX_EDITABLE_CHARACTERS = 2 * 1024 * 1024;
const MAX_EDITABLE_BLOCKS = 20_000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function blockContent(wrapper) {
  return wrapper?.querySelector('[data-editor-content]') || null;
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
    return { before: editableHtmlToMarkdown(element), after: '' };
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
  let disposed = false;
  let blockLineCounts = new Map();
  const drafts = new Map();

  const source = () => documentSnapshot.source;
  const dirty = () => mode === 'edit' && source() !== savedSource;
  const snapshot = () => Object.freeze({
    mode,
    path: activeDocument?.path || null,
    dirty: dirty(),
    saveState,
    error: saveError,
    stats: documentSnapshot.stats,
    cursor: documentSnapshot.cursor,
  });
  const notify = () => hooks.onStateChange?.(snapshot());

  const setCursor = (nextCursor) => {
    if (!documentModel.setCursor(nextCursor)) return;
    hooks.onCursorChange?.(documentSnapshot.cursor);
  };

  const restoreHistory = (action) => {
    const result = action === 'redo'
      ? documentModel.redo(activeBlockId)
      : documentModel.undo(activeBlockId);
    if (!result.changed) return false;
    render();
    notify();
    hooks.onHistoryRestore?.(action);
    queueMicrotask(() => focusBlock(result.focusId));
    return true;
  };

  const findBlock = (id) => documentModel.block(id);
  const findWrapper = (id) => [...canvas.querySelectorAll('[data-block-id]')]
    .find((wrapper) => wrapper.dataset.blockId === id) || null;

  const focusBlock = (id, position = 'end', { preserveScroll = false } = {}) => {
    const content = blockContent(findWrapper(id));
    if (!content) return;
    if (preserveScroll) content.focus({ preventScroll: true });
    else content.focus();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(position === 'start');
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    activeBlockId = id;
    selectionController?.capture();
    if (!preserveScroll) content.scrollIntoView?.({ block: 'nearest' });
  };

  const cancelBlockAnimations = () => blockInteractionController?.cancelAnimations();
  const captureBlockLayout = () => blockInteractionController?.captureLayout();
  const animateBlockLayout = (layout, options) => blockInteractionController?.animateLayout(layout, options);

  const closeCommandMenu = (options) => overlayController?.closeCommand(options);
  const closeBlockMenu = (options) => overlayController?.closeBlock(options);

  const openCommandMenu = (blockId, query = '') => overlayController?.openCommand(blockId, query);
  const openBlockMenu = (blockId, anchor, options) => overlayController?.openBlock(blockId, anchor, options);

  const applyBlockType = (id, type) => {
    if (!documentModel.changeType(id, type)) return;
    render();
    notify();
    closeCommandMenu();
    focusBlock(id, 'end');
  };

  const addBlock = (afterId, type = 'paragraph', text = '') => {
    const next = documentModel.addAfter(afterId, { type, text });
    if (!next) return null;
    render();
    notify();
    focusBlock(next.id, 'start');
    return next;
  };

  const removeBlock = (id, focusId = null) => {
    const previousLayout = captureBlockLayout();
    const result = documentModel.remove(id);
    if (!result?.changed) return false;
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
    render({ previousLayout });
    notify();
    focusBlock(id);
    return true;
  };

  const duplicateBlock = (id) => {
    const previousLayout = captureBlockLayout();
    const copy = documentModel.duplicate(id);
    if (!copy) return false;
    render({ previousLayout, enteringId: copy.id });
    notify();
    focusBlock(copy.id);
    return true;
  };

  const contextFor = (target) => {
    const wrapper = target?.closest?.('[data-block-id]');
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
    if (action === 'move-up') return moveBlock(id, -1);
    if (action === 'move-down') return moveBlock(id, 1);
    if (action === 'duplicate') return duplicateBlock(id);
    if (action === 'delete') return removeBlock(id);
    return false;
  };

  const updateBlockFromElement = (wrapper) => {
    const block = findBlock(wrapper?.dataset.blockId);
    if (!block) return;
    const previousLineCount = blockLineCounts.get(block.id);
    const content = blockContent(wrapper);
    const checkbox = wrapper.querySelector('[data-todo-check]');
    const updated = documentModel.updateBlock(block.id, {
      ...(content ? { text: editableHtmlToMarkdown(content) } : {}),
      ...(checkbox ? { checked: checkbox.checked } : {}),
    });
    if (updated && previousLineCount !== undefined && previousLineCount !== sourceLineCount(updated)) {
      refreshBlockLineIndex();
    }
  };

  const renderBlock = (block, index) => {
    const isSpacer = block.type === 'paragraph' && block.text === '';
    const wrapper = document.createElement('div');
    wrapper.className = `editor-block editor-block--${block.type}`;
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;
    if (isSpacer) wrapper.dataset.blockSpacer = '';

    const gutter = document.createElement('div');
    gutter.className = 'editor-block-gutter';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'editor-gutter-button';
    add.tabIndex = -1;
    add.dataset.addBlock = '';
    add.setAttribute('aria-label', `Add block after ${editorBlockLabel(block.type)}`);
    add.dataset.tooltip = 'Add block';
    const addIcon = document.createElement('i');
    addIcon.className = 'iconoir-plus';
    addIcon.setAttribute('aria-hidden', 'true');
    add.append(addIcon);
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'editor-gutter-button editor-drag-handle';
    menu.tabIndex = -1;
    menu.dataset.blockMenu = '';
    menu.draggable = !isSpacer;
    menu.setAttribute('aria-label', `Options for ${editorBlockLabel(block.type)} block ${index + 1}`);
    menu.dataset.tooltip = isSpacer ? 'Open block options' : 'Drag or open block options';
    const menuIcon = document.createElement('i');
    menuIcon.className = 'iconoir-menu-scale';
    menuIcon.setAttribute('aria-hidden', 'true');
    menu.append(menuIcon);
    gutter.append(add, menu);

    const body = document.createElement('div');
    body.className = 'editor-block-body';
    if (block.type === 'todo') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = block.checked;
      checkbox.className = 'editor-todo-checkbox';
      checkbox.dataset.todoCheck = '';
      checkbox.setAttribute('aria-label', block.checked ? 'Mark task incomplete' : 'Mark task complete');
      body.append(checkbox);
    }
    if (block.type === 'numbered') {
      const number = document.createElement('span');
      number.className = 'editor-list-marker';
      number.textContent = `${block.number}.`;
      number.setAttribute('aria-hidden', 'true');
      body.append(number);
    }
    if (block.type === 'bullet') {
      const bullet = document.createElement('span');
      bullet.className = 'editor-list-marker';
      bullet.textContent = '•';
      bullet.setAttribute('aria-hidden', 'true');
      body.append(bullet);
    }

    if (block.type === 'divider') {
      const divider = document.createElement('div');
      divider.className = 'editor-divider';
      divider.setAttribute('role', 'separator');
      divider.tabIndex = 0;
      divider.dataset.editorContent = '';
      divider.setAttribute('aria-label', 'Divider block');
      body.append(divider);
    } else {
      const content = document.createElement(block.type === 'code' ? 'pre' : 'div');
      content.className = 'editor-block-content';
      content.dataset.editorContent = '';
      content.contentEditable = 'true';
      content.tabIndex = 0;
      content.spellcheck = block.type !== 'code';
      content.setAttribute('role', 'textbox');
      content.setAttribute('aria-multiline', String(block.type === 'code'));
      content.setAttribute('aria-label', `${editorBlockLabel(block.type)} block ${index + 1}`);
      content.dataset.placeholder = block.type.startsWith('heading')
        ? 'Heading'
        : block.type === 'code'
          ? 'Write code…'
          : "Type '/' for commands";
      if (block.type === 'code') content.textContent = block.text;
      else content.innerHTML = inlineMarkdownToHtml(block.text);
      body.append(content);
    }

    wrapper.style.setProperty('--block-indent', String(block.indent || 0));
    wrapper.append(gutter, body);
    return wrapper;
  };

  const sourceLineCount = (block) => serializeEditorDocument([block], {
    markdown: activeDocument?.markdown !== false,
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

  function render({ previousLayout = null, enteringId = null } = {}) {
    if (!previousLayout) cancelBlockAnimations();
    const fragment = document.createDocumentFragment();
    documentSnapshot.blocks.forEach((block, index) => fragment.append(renderBlock(block, index)));
    canvas.replaceChildren(fragment);
    refreshBlockLineIndex();
    root.classList.toggle(
      'is-empty-document',
      documentSnapshot.blocks.length === 1 && documentSnapshot.blocks[0].text === '',
    );
    animateBlockLayout(previousLayout, { enteringId });
  }

  const splitBlock = (wrapper) => {
    const block = findBlock(wrapper.dataset.blockId);
    const content = blockContent(wrapper);
    if (!block || !content || block.type === 'code') return false;
    const { before, after } = markdownAroundSelection(document, content, window.getSelection());
    const next = documentModel.split(block.id, { before, after });
    if (!next) return false;
    render();
    notify();
    focusBlock(next.id, 'start');
    return true;
  };

  const mergeWithPrevious = (wrapper) => {
    const result = documentModel.mergeWithPrevious(wrapper.dataset.blockId);
    if (!result?.changed) return false;
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
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper) return;
    updateBlockFromElement(wrapper);
    activeBlockId = wrapper.dataset.blockId;
    saveState = 'idle';
    saveError = '';
    notify();
    const block = findBlock(activeBlockId);
    if (block?.type !== 'code' && block?.text.startsWith('/')) {
      openCommandMenu(activeBlockId, block.text.slice(1));
    } else if (overlayController?.isCommandOpenFor(activeBlockId)) {
      closeCommandMenu();
    }
  };

  const handleCanvasKeydown = (event) => {
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper) return;
    const block = findBlock(wrapper.dataset.blockId);
    const content = blockContent(wrapper);
    const selection = window.getSelection();
    activeBlockId = block?.id || null;

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
      const handle = wrapper.querySelector('[data-block-menu]');
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

    if (overlayController?.handleCommandKey(event, { blockId: block.id, query: block.text.slice(1) })) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && block?.type !== 'code') {
      event.preventDefault();
      splitBlock(wrapper);
      return;
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
          applyBlockType(block.id, 'paragraph');
        } else if (block.text === '' && documentSnapshot.blocks.length > 1) {
          event.preventDefault();
          removeBlock(block.id);
        } else if (mergeWithPrevious(wrapper)) {
          event.preventDefault();
        }
      }
    }
  };

  const handleCanvasClick = (event) => {
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper) return;
    const id = wrapper.dataset.blockId;
    activeBlockId = id;
    if (event.target.closest('[data-add-block]')) {
      const next = addBlock(id);
      openCommandMenu(next.id);
      return;
    }
    const menu = event.target.closest('[data-block-menu]');
    if (menu) {
      openBlockMenu(id, menu);
    }
  };

  const handleCanvasChange = (event) => {
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper || !event.target.matches('[data-todo-check]')) return;
    updateBlockFromElement(wrapper);
    event.target.setAttribute('aria-label', event.target.checked ? 'Mark task incomplete' : 'Mark task complete');
    notify();
  };

  const clearDragState = () => blockInteractionController?.clearDragState();

  const enter = () => {
    if (disposed || !activeDocument) return false;
    const draft = drafts.get(activeDocument.path);
    const initialSource = draft?.source ?? activeDocument.source;
    const lineCount = initialSource.split('\n').length;
    if (initialSource.length > MAX_EDITABLE_CHARACTERS || lineCount > MAX_EDITABLE_BLOCKS) {
      hooks.onUnavailable?.(
        'This document is too large for block editing. Source view is still available.'
      );
      return false;
    }
    documentModel.load(initialSource, { markdown: activeDocument.markdown });
    savedSource = activeDocument.source;
    mode = 'edit';
    saveState = draft ? 'recovered' : 'idle';
    saveError = '';
    render();
    root.hidden = false;
    root.removeAttribute('inert');
    notify();
    queueMicrotask(() => focusBlock(documentSnapshot.blocks[0].id, 'start', { preserveScroll: true }));
    return true;
  };

  const exit = ({ force = false } = {}) => {
    if (mode !== 'edit') return true;
    if (dirty() && !force) {
      const discard = window.confirm('Discard unsaved changes and return to reading?');
      if (!discard) return false;
    }
    closeCommandMenu();
    closeBlockMenu();
    clearDragState();
    cancelBlockAnimations();
    selectionController?.clear();
    mode = 'read';
    saveState = 'idle';
    saveError = '';
    root.hidden = true;
    root.setAttribute('inert', '');
    notify();
    return true;
  };

  const save = async () => {
    if (disposed || mode !== 'edit' || !activeDocument || saveState === 'saving') {
      return { status: 'unavailable' };
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

  const setDocument = ({ path, source: nextSource, markdown = true }) => {
    const normalizedSource = String(nextSource ?? '');
    const sameActiveEditor = mode === 'edit' && activeDocument?.path === path;
    if (activeDocument?.path && activeDocument.path !== path && dirty()) {
      drafts.set(activeDocument.path, { source: source(), savedSource });
      hooks.onDraftPreserved?.(activeDocument.path);
    }
    activeDocument = { path, source: normalizedSource, markdown: Boolean(markdown) };
    if (contextLabel) contextLabel.textContent = markdown ? 'Block editor' : 'Plain-text editor';
    if (contextHint) {
      contextHint.replaceChildren();
      if (markdown) {
        contextHint.append('Type ');
        const shortcut = document.createElement('kbd');
        shortcut.textContent = '/';
        contextHint.append(shortcut, ' for blocks');
      } else {
        contextHint.textContent = 'Each line saves as text';
      }
    }
    if (sameActiveEditor) {
      savedSource = normalizedSource;
      saveState = source() === normalizedSource ? 'saved' : 'idle';
      saveError = '';
      notify();
    } else if (mode === 'edit') enter();
    else notify();
  };

  const clearDocument = () => {
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
    if (!dirty()) return true;
    const discard = window.confirm('Discard unsaved changes and open another file?');
    if (discard) exit({ force: true });
    return discard;
  };

  overlayController = createEditorOverlayController({
    window,
    document,
    elements: { canvas, commandMenu, blockMenu },
    commands: EDITOR_COMMANDS,
    adapters: {
      isMarkdown: () => activeDocument?.markdown !== false,
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
  overlayController.start();

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
      isMarkdown: () => activeDocument?.markdown !== false,
      getActiveBlockId: () => activeBlockId,
      setCursor,
      updateBlockFromElement,
    },
    hooks: {
      onDocumentChange: notify,
      focusBlock,
    },
  });
  selectionController.start();

  blockInteractionController = createEditorBlockInteractionController({
    window,
    elements: { root, canvas },
    adapters: {
      moveRelative: (id, targetId, position) => documentModel.moveRelative(id, targetId, position),
      render: () => render(),
      focusBlock,
    },
    hooks: {
      closeTransientUi: () => {
        closeBlockMenu();
        closeCommandMenu();
      },
      onReorder: notify,
    },
  });
  blockInteractionController.start();

  canvas.addEventListener('input', handleCanvasInput);
  canvas.addEventListener('keydown', handleCanvasKeydown);
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('change', handleCanvasChange);

  root.hidden = true;
  root.setAttribute('inert', '');

  return Object.freeze({
    setDocument,
    clearDocument,
    enter,
    exit,
    toggle() {
      return mode === 'edit' ? exit() : enter();
    },
    save,
    canChangeDocument,
    isEditing: () => mode === 'edit',
    isDirty: dirty,
    current: snapshot,
    source,
    contextFor,
    applyInlineCommand: (command) => selectionController?.applyFromCurrentSelection(command) || false,
    openLinkFromSelection: () => selectionController?.openLinkFromCurrentSelection() || false,
    performBlockAction,
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('input', handleCanvasInput);
      canvas.removeEventListener('keydown', handleCanvasKeydown);
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('change', handleCanvasChange);
      overlayController?.dispose();
      selectionController?.dispose();
      blockInteractionController?.dispose();
      unsubscribeDocumentModel();
      documentModel.dispose();
      clearDragState();
      cancelBlockAnimations();
      closeCommandMenu();
      closeBlockMenu();
    },
  });
}

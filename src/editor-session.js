import {
  EDITOR_COMMANDS,
  createEditorDocumentModel,
  editableHtmlToMarkdown,
  editorBlockLabel,
  inlineMarkdownToHtml,
  serializeEditorDocument,
} from './editor-document.js';
import { createEditorOverlayController } from './editor-overlay-controller.js';

const INLINE_COMMANDS = Object.freeze({
  bold: 'bold',
  italic: 'italic',
  strike: 'strikeThrough',
});
const MAX_EDITABLE_CHARACTERS = 2 * 1024 * 1024;
const MAX_EDITABLE_BLOCKS = 20_000;
const BLOCK_DRAG_MIME = 'text/x-openmd-block';
const BLOCK_LAYOUT_DURATION = 220;
const BLOCK_LAYOUT_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function blockContent(wrapper) {
  return wrapper?.querySelector('[data-editor-content]') || null;
}

function isSelectionInside(selection, root) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer);
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

function editorTextFromNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  if (node.tagName === 'BR') return '\n';

  const content = [...node.childNodes].map(editorTextFromNode).join('');
  return node.tagName === 'DIV' || node.tagName === 'P' ? `${content}\n` : content;
}

function textBeforeSelection(document, element, selection) {
  if (!element || !selection || selection.rangeCount === 0) return '';
  const active = selection.getRangeAt(0);
  if (!element.contains(active.startContainer)) return '';
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(active.startContainer, active.startOffset);
  const host = document.createElement('div');
  host.append(before.cloneContents());
  return [...host.childNodes].map(editorTextFromNode).join('').replace(/\n$/, '');
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
  let savedSelection = null;
  let disposed = false;
  let caretEchoVersion = 0;
  let blockLineCounts = new Map();
  let dragState = null;
  const blockAnimations = new Set();
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

  const cancelBlockAnimations = () => {
    blockAnimations.forEach((animation) => animation.cancel());
    blockAnimations.clear();
  };

  const captureBlockLayout = () => {
    const layout = new Map([...canvas.querySelectorAll('[data-block-id]')].map((wrapper) => [
      wrapper.dataset.blockId,
      wrapper.getBoundingClientRect(),
    ]));
    cancelBlockAnimations();
    return layout;
  };

  const trackBlockAnimation = (animation) => {
    blockAnimations.add(animation);
    animation.finished
      .catch(() => undefined)
      .finally(() => blockAnimations.delete(animation));
  };

  const animateBlockLayout = (previousLayout, { enteringId = null } = {}) => {
    if (
      !previousLayout
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) return;

    canvas.querySelectorAll('[data-block-id]').forEach((wrapper) => {
      if (typeof wrapper.animate !== 'function') return;
      const previous = previousLayout.get(wrapper.dataset.blockId);
      const current = wrapper.getBoundingClientRect();
      const deltaX = previous ? previous.left - current.left : 0;
      const deltaY = previous ? previous.top - current.top : 0;
      const entering = wrapper.dataset.blockId === enteringId && !previous;
      if (!entering && Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

      const animation = wrapper.animate(
        entering
          ? [
              { opacity: 0, transform: 'translateY(-5px) scale(0.985)' },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ]
          : [
              { transform: `translate(${deltaX}px, ${deltaY}px)` },
              { transform: 'translate(0, 0)' },
            ],
        {
          duration: BLOCK_LAYOUT_DURATION,
          easing: BLOCK_LAYOUT_EASING,
        }
      );
      trackBlockAnimation(animation);
    });
  };

  const focusBlock = (id, position = 'end') => {
    const content = blockContent(findWrapper(id));
    if (!content) return;
    content.focus();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(position === 'start');
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    activeBlockId = id;
    updateCursorFromSelection(selection);
    content.scrollIntoView?.({ block: 'nearest' });
  };

  const closeCommandMenu = (options) => overlayController?.closeCommand(options);
  const closeBlockMenu = (options) => overlayController?.closeBlock(options);

  const closeInlineToolbar = () => {
    inlineToolbar.hidden = true;
    if (linkPopover) linkPopover.hidden = true;
    savedSelection = null;
  };

  const positionFloating = (element, anchorRect, preferred = 'below') => {
    element.hidden = false;
    const rect = element.getBoundingClientRect();
    const gap = 6;
    const editorContext = element === inlineToolbar
      ? contextLabel?.closest?.('.editor-context')?.getBoundingClientRect()
      : null;
    const safeTop = Math.max(40, (editorContext?.bottom || 34) + gap);
    const safeBottom = window.innerHeight - 38;
    const left = clamp(anchorRect.left, 8, window.innerWidth - rect.width - 8);
    const above = anchorRect.top - rect.height - gap;
    const below = anchorRect.bottom + gap;
    const fitsAbove = above >= safeTop;
    const fitsBelow = below + rect.height <= safeBottom;
    const top = preferred === 'above'
      ? fitsAbove ? above : fitsBelow ? below : clamp(above, safeTop, safeBottom - rect.height)
      : fitsBelow ? below : fitsAbove ? above : clamp(below, safeTop, safeBottom - rect.height);
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
  };

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
    if (!result?.changed) return;
    render({ previousLayout, enteringId: result.enteringId });
    notify();
    focusBlock(focusId || result.focusId);
  };

  const moveBlock = (id, delta) => {
    const previousLayout = captureBlockLayout();
    if (!documentModel.move(id, delta)) return;
    render({ previousLayout });
    notify();
    focusBlock(id);
  };

  const duplicateBlock = (id) => {
    const previousLayout = captureBlockLayout();
    const copy = documentModel.duplicate(id);
    if (!copy) return;
    render({ previousLayout, enteringId: copy.id });
    notify();
    focusBlock(copy.id);
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
    const wrapper = document.createElement('div');
    wrapper.className = `editor-block editor-block--${block.type}`;
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.blockType = block.type;

    const gutter = document.createElement('div');
    gutter.className = 'editor-block-gutter';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'editor-gutter-button';
    add.tabIndex = -1;
    add.dataset.addBlock = '';
    add.setAttribute('aria-label', `Add block after ${editorBlockLabel(block.type)}`);
    add.title = 'Add block';
    const addIcon = document.createElement('i');
    addIcon.className = 'iconoir-plus';
    addIcon.setAttribute('aria-hidden', 'true');
    add.append(addIcon);
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'editor-gutter-button editor-drag-handle';
    menu.tabIndex = -1;
    menu.dataset.blockMenu = '';
    menu.draggable = true;
    menu.setAttribute('aria-label', `Options for ${editorBlockLabel(block.type)} block ${index + 1}`);
    menu.title = 'Drag or open block options';
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
      const activeSelection = window.getSelection();
      if (isSelectionInside(activeSelection, canvas)) {
        event.preventDefault();
        savedSelection = activeSelection.getRangeAt(0).cloneRange();
        openLinkPopover();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const inlineCommand = event.key.toLowerCase() === 'e'
        ? 'code'
        : event.shiftKey && event.key.toLowerCase() === 'x'
          ? 'strike'
          : null;
      const activeSelection = window.getSelection();
      if (inlineCommand && isSelectionInside(activeSelection, canvas)) {
        event.preventDefault();
        savedSelection = activeSelection.getRangeAt(0).cloneRange();
        applyInlineCommand(inlineCommand);
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

  const clearDropTargets = () => {
    canvas.querySelectorAll('.is-drag-target-before, .is-drag-target-after').forEach((element) => {
      element.classList.remove('is-drag-target-before', 'is-drag-target-after');
    });
  };

  const clearDragState = () => {
    clearDropTargets();
    canvas.querySelectorAll('.is-dragging').forEach((element) => element.classList.remove('is-dragging'));
    root.classList.remove('is-block-dragging');
    dragState = null;
  };

  const hasBlockDragType = (dataTransfer) => (
    [...(dataTransfer?.types || [])].includes(BLOCK_DRAG_MIME)
  );

  const getDropLocation = (event) => {
    const wrappers = [...canvas.querySelectorAll('[data-block-id]')];
    if (wrappers.length === 0) return null;
    const directTarget = event.target.closest?.('[data-block-id]');
    if (directTarget) {
      const rect = directTarget.getBoundingClientRect();
      return {
        wrapper: directTarget,
        position: event.clientY <= rect.top + (rect.height / 2) ? 'before' : 'after',
      };
    }

    const nextWrapper = wrappers.find((wrapper) => {
      const rect = wrapper.getBoundingClientRect();
      return event.clientY <= rect.top + (rect.height / 2);
    });
    return nextWrapper
      ? { wrapper: nextWrapper, position: 'before' }
      : { wrapper: wrappers.at(-1), position: 'after' };
  };

  const handleDragStart = (event) => {
    const handle = event.target.closest?.('[data-block-menu]');
    const wrapper = handle?.closest('[data-block-id]');
    if (!wrapper || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    closeBlockMenu();
    closeCommandMenu();
    const sourceId = wrapper.dataset.blockId;
    dragState = { sourceId, targetId: null, position: null };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(BLOCK_DRAG_MIME, sourceId);
    const rect = wrapper.getBoundingClientRect();
    event.dataTransfer.setDragImage?.(
      wrapper,
      clamp(event.clientX - rect.left, 0, rect.width),
      clamp(event.clientY - rect.top, 0, rect.height)
    );
    wrapper.classList.add('is-dragging');
    root.classList.add('is-block-dragging');
  };

  const handleDragEnd = () => clearDragState();

  const handleDragOver = (event) => {
    if (!dragState && !hasBlockDragType(event.dataTransfer)) return;
    const location = getDropLocation(event);
    if (!location) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const targetId = location.wrapper.dataset.blockId;
    clearDropTargets();
    if (targetId === dragState?.sourceId) {
      dragState = { ...dragState, targetId: null, position: null };
      return;
    }
    location.wrapper.classList.add(`is-drag-target-${location.position}`);
    dragState = {
      sourceId: dragState?.sourceId || null,
      targetId,
      position: location.position,
    };
  };

  const handleDrop = (event) => {
    if (!dragState && !hasBlockDragType(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const location = getDropLocation(event);
    const sourceId = event.dataTransfer?.getData(BLOCK_DRAG_MIME) || dragState?.sourceId;
    const targetId = location?.wrapper.dataset.blockId || dragState?.targetId;
    const position = location?.position || dragState?.position;
    if (!sourceId || !targetId || !position || sourceId === targetId) {
      clearDragState();
      return;
    }

    const sourceIndex = documentSnapshot.blocks.findIndex((block) => block.id === sourceId);
    const targetIndex = documentSnapshot.blocks.findIndex((block) => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      clearDragState();
      return;
    }
    let destination = targetIndex + (position === 'after' ? 1 : 0);
    if (sourceIndex < destination) destination -= 1;
    destination = clamp(destination, 0, documentSnapshot.blocks.length - 1);
    clearDragState();
    if (destination === sourceIndex) {
      focusBlock(sourceId);
      return;
    }

    const previousLayout = captureBlockLayout();
    if (!documentModel.moveTo(sourceId, destination)) return;
    render({ previousLayout });
    notify();
    focusBlock(sourceId);
  };

  const hideCaretEcho = () => {
    if (!caretEcho) return;
    caretEchoVersion += 1;
    caretEcho.classList.remove('is-moving');
    caretEcho.hidden = true;
    root.classList.remove('has-custom-caret');
  };

  const captureCaretEcho = (selection) => {
    if (
      !caretEcho
      || mode !== 'edit'
      || !selection
      || selection.rangeCount === 0
      || !selection.isCollapsed
    ) {
      hideCaretEcho();
      return;
    }

    const range = selection.getRangeAt(0);
    if (!canvas.contains(range.startContainer)) {
      hideCaretEcho();
      return;
    }

    const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
    const rect = rects?.length > 0
      ? rects[0]
      : typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : null;
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.height <= 0) {
      hideCaretEcho();
      return;
    }

    caretEcho.style.left = `${Math.round(rect.left * 2) / 2}px`;
    caretEcho.style.top = `${Math.round(rect.top * 2) / 2}px`;
    caretEcho.style.height = `${Math.max(12, Math.min(32, rect.height))}px`;
    caretEcho.hidden = false;
    root.classList.add('has-custom-caret');
    caretEcho.classList.remove('is-moving');
    const version = ++caretEchoVersion;

    window.requestAnimationFrame(() => {
      if (version !== caretEchoVersion || caretEcho.hidden) return;
      caretEcho.classList.add('is-moving');
      caretEcho.addEventListener('animationend', () => {
        if (version !== caretEchoVersion) return;
        caretEcho.classList.remove('is-moving');
      }, { once: true });
    });
  };

  const updateInlineCommandStates = (range) => {
    const node = range.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    inlineToolbar.querySelectorAll('[data-inline-command]').forEach((button) => {
      const command = button.dataset.inlineCommand;
      const selectors = {
        bold: 'strong, b',
        italic: 'em, i',
        strike: 's, strike, del',
        code: 'code',
        link: 'a',
      };
      const active = Boolean(element?.closest?.(selectors[command]));
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const updateCursorFromSelection = (selection) => {
    if (mode !== 'edit' || !selection || selection.rangeCount === 0) {
      setCursor(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (!node) {
      setCursor(null);
      return;
    }
    const element = node.nodeType === 1 ? node : node.parentElement;
    const content = element?.closest?.('[data-editor-content]');
    const wrapper = content?.closest?.('[data-block-id]');
    if (!content || !wrapper || !canvas.contains(content)) {
      setCursor(null);
      return;
    }

    const before = textBeforeSelection(document, content, selection);
    const localLines = before.split('\n');
    const blockStartLine = Number.parseInt(wrapper.dataset.sourceLineStart, 10) || 1;
    const codeFenceOffset = activeDocument?.markdown !== false && wrapper.dataset.blockType === 'code' ? 1 : 0;
    setCursor({
      line: blockStartLine + codeFenceOffset + localLines.length - 1,
      column: localLines.at(-1).length + 1,
    });
  };

  const captureSelection = () => {
    const selection = window.getSelection();
    updateCursorFromSelection(selection);
    captureCaretEcho(selection);
    if (mode !== 'edit' || !isSelectionInside(selection, canvas)) {
      if (!linkPopover || linkPopover.hidden) closeInlineToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    savedSelection = range.cloneRange();
    updateInlineCommandStates(range);
    const rect = range.getBoundingClientRect();
    positionFloating(inlineToolbar, rect, 'above');
  };

  const restoreSelection = () => {
    if (!savedSelection) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedSelection);
    return true;
  };

  const syncSelectedBlock = () => {
    if (!savedSelection) return;
    const node = savedSelection.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const wrapper = element?.closest?.('[data-block-id]');
    if (wrapper) {
      updateBlockFromElement(wrapper);
      notify();
    }
  };

  const applyInlineCommand = (command) => {
    if (!restoreSelection()) return;
    if (command === 'code') {
      const selection = window.getSelection();
      const range = selection.getRangeAt(0);
      const code = document.createElement('code');
      try {
        range.surroundContents(code);
      } catch {
        code.append(range.extractContents());
        range.insertNode(code);
      }
      selection.removeAllRanges();
      const nextRange = document.createRange();
      nextRange.selectNodeContents(code);
      selection.addRange(nextRange);
    } else {
      document.execCommand(INLINE_COMMANDS[command], false);
    }
    syncSelectedBlock();
    captureSelection();
  };

  const openLinkPopover = () => {
    if (!savedSelection || !linkPopover || !linkInput) return;
    linkInput.value = '';
    linkPopover.hidden = false;
    positionFloating(linkPopover, inlineToolbar.getBoundingClientRect());
    linkInput.focus();
  };

  const applyLink = () => {
    const href = linkInput?.value.trim();
    if (!href || !restoreSelection()) return;
    const safeHref = /^(?:https?:|mailto:|#|\.\.?\/)/i.test(href) ? href : `https://${href}`;
    document.execCommand('createLink', false, safeHref);
    syncSelectedBlock();
    closeInlineToolbar();
  };

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
    queueMicrotask(() => focusBlock(documentSnapshot.blocks[0].id, 'start'));
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
    closeInlineToolbar();
    clearDragState();
    cancelBlockAnimations();
    hideCaretEcho();
    setCursor(null);
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
    const nextSource = source();
    if (nextSource === savedSource) return { status: 'unchanged', source: nextSource };
    saveState = 'saving';
    saveError = '';
    notify();
    try {
      const result = await adapters.save(activeDocument.path, nextSource);
      savedSource = nextSource;
      drafts.delete(activeDocument.path);
      saveState = 'saved';
      notify();
      await hooks.onSaved?.({ path: activeDocument.path, source: nextSource, result });
      return { status: 'saved', source: nextSource, result };
    } catch (error) {
      saveState = 'error';
      saveError = errorMessage(error);
      drafts.set(activeDocument.path, { source: nextSource, savedSource });
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
      onBlockAction: (id, action) => {
        if (action === 'move-up') moveBlock(id, -1);
        if (action === 'move-down') moveBlock(id, 1);
        if (action === 'duplicate') duplicateBlock(id);
        if (action === 'delete') removeBlock(id);
      },
    },
  });
  overlayController.start();

  canvas.addEventListener('input', handleCanvasInput);
  canvas.addEventListener('keydown', handleCanvasKeydown);
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('change', handleCanvasChange);
  canvas.addEventListener('dragstart', handleDragStart);
  canvas.addEventListener('dragend', handleDragEnd);
  canvas.addEventListener('dragover', handleDragOver);
  canvas.addEventListener('drop', handleDrop);
  document.addEventListener('selectionchange', captureSelection);

  inlineToolbar.addEventListener('mousedown', (event) => event.preventDefault());
  inlineToolbar.addEventListener('click', (event) => {
    const command = event.target.closest('[data-inline-command]')?.dataset.inlineCommand;
    if (!command) return;
    if (command === 'link') openLinkPopover();
    else applyInlineCommand(command);
  });
  linkApply?.addEventListener('click', applyLink);
  linkInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeInlineToolbar();
      focusBlock(activeBlockId);
    }
  });

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
    dispose() {
      disposed = true;
      overlayController?.dispose();
      unsubscribeDocumentModel();
      documentModel.dispose();
      document.removeEventListener('selectionchange', captureSelection);
      clearDragState();
      cancelBlockAnimations();
      hideCaretEcho();
      setCursor(null);
      closeCommandMenu();
      closeBlockMenu();
      closeInlineToolbar();
    },
  });
}

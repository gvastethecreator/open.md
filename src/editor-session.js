import {
  EDITOR_COMMANDS,
  createEditorBlock,
  editableHtmlToMarkdown,
  editorBlockLabel,
  getEditorDocumentStats,
  inlineMarkdownToHtml,
  parseEditorDocument,
  serializeEditorDocument,
} from './editor-document.js';

const INLINE_COMMANDS = Object.freeze({
  bold: 'bold',
  italic: 'italic',
  strike: 'strikeThrough',
});
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
  let blocks = [createEditorBlock()];
  let savedSource = '';
  let mode = 'read';
  let saveState = 'idle';
  let saveError = '';
  let activeBlockId = null;
  let commandBlockId = null;
  let commandIndex = 0;
  let blockMenuId = null;
  let savedSelection = null;
  let history = [''];
  let historyIndex = 0;
  let disposed = false;
  let caretEchoVersion = 0;
  let cursor = null;
  let blockLineCounts = new Map();
  const drafts = new Map();

  const source = () => serializeEditorDocument(blocks, {
    markdown: activeDocument?.markdown !== false,
  });
  const dirty = () => mode === 'edit' && source() !== savedSource;
  const snapshot = () => Object.freeze({
    mode,
    path: activeDocument?.path || null,
    dirty: dirty(),
    saveState,
    error: saveError,
    stats: getEditorDocumentStats(blocks),
    cursor: cursor ? Object.freeze({ ...cursor }) : null,
  });
  const notify = () => hooks.onStateChange?.(snapshot());

  const setCursor = (nextCursor) => {
    if (cursor?.line === nextCursor?.line && cursor?.column === nextCursor?.column) return;
    cursor = nextCursor;
    hooks.onCursorChange?.(cursor ? Object.freeze({ ...cursor }) : null);
  };

  const commitHistory = () => {
    const current = source();
    if (history[historyIndex] === current) return;
    history = history.slice(0, historyIndex + 1);
    history.push(current);
    if (history.length > 150) history.shift();
    historyIndex = history.length - 1;
  };

  const restoreHistory = (nextIndex) => {
    const index = clamp(nextIndex, 0, history.length - 1);
    if (index === historyIndex) return false;
    historyIndex = index;
    blocks = parseEditorDocument(history[index], { markdown: activeDocument?.markdown !== false });
    render();
    notify();
    return true;
  };

  const findBlock = (id) => blocks.find((block) => block.id === id) || null;
  const findWrapper = (id) => [...canvas.querySelectorAll('[data-block-id]')]
    .find((wrapper) => wrapper.dataset.blockId === id) || null;

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

  const closeCommandMenu = ({ returnFocus = false } = {}) => {
    const id = commandBlockId;
    commandBlockId = null;
    commandIndex = 0;
    commandMenu.hidden = true;
    commandMenu.replaceChildren();
    if (returnFocus && id) focusBlock(id);
  };

  const closeBlockMenu = ({ returnFocus = false } = {}) => {
    const id = blockMenuId;
    blockMenuId = null;
    blockMenu.hidden = true;
    if (returnFocus && id) findWrapper(id)?.querySelector('[data-block-menu]')?.focus();
  };

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

  const commandMatches = (query) => {
    const normalized = String(query || '').trim().toLowerCase();
    const available = activeDocument?.markdown === false
      ? EDITOR_COMMANDS.filter((command) => command.id === 'paragraph')
      : EDITOR_COMMANDS;
    if (!normalized) return available;
    return available.filter((command) => (
      command.label.toLowerCase().includes(normalized)
      || command.hint.toLowerCase().includes(normalized)
      || command.id.includes(normalized)
    ));
  };

  const openCommandMenu = (blockId, query = '') => {
    const wrapper = findWrapper(blockId);
    if (!wrapper) return;
    closeBlockMenu();
    commandBlockId = blockId;
    const commands = commandMatches(query);
    commandIndex = clamp(commandIndex, 0, Math.max(0, commands.length - 1));
    commandMenu.replaceChildren();

    const header = document.createElement('div');
    header.className = 'editor-menu-header';
    header.textContent = commands.length > 0 ? 'Turn into' : 'No matching blocks';
    commandMenu.append(header);
    commands.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'editor-command';
      button.dataset.command = command.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === commandIndex));
      const icon = document.createElement('i');
      icon.className = command.icon;
      icon.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = command.label;
      const hint = document.createElement('small');
      hint.textContent = command.hint;
      copy.append(label, hint);
      button.append(icon, copy);
      commandMenu.append(button);
    });
    positionFloating(commandMenu, wrapper.getBoundingClientRect());
  };

  const openBlockMenu = (blockId, anchor, { focus = false } = {}) => {
    closeCommandMenu();
    blockMenuId = blockId;
    const block = findBlock(blockId);
    if (!block) return;
    blockMenu.querySelector('[data-block-action="move-up"]')?.toggleAttribute(
      'disabled', blocks[0]?.id === blockId
    );
    blockMenu.querySelector('[data-block-action="move-down"]')?.toggleAttribute(
      'disabled', blocks.at(-1)?.id === blockId
    );
    blockMenu.querySelector('[data-block-action="delete"]')?.toggleAttribute(
      'disabled', blocks.length === 1 && block.text === ''
    );
    positionFloating(blockMenu, anchor.getBoundingClientRect());
    if (focus) queueMicrotask(() => blockMenu.querySelector('button:not(:disabled)')?.focus());
  };

  const applyBlockType = (id, type) => {
    const block = findBlock(id);
    if (!block) return;
    commitHistory();
    const currentText = block.text.replace(/^\/[^\s]*\s?/, '');
    block.type = type;
    block.text = type === 'divider' ? '' : currentText;
    block.checked = type === 'todo' ? block.checked : false;
    render();
    commitHistory();
    notify();
    closeCommandMenu();
    focusBlock(id, 'end');
  };

  const addBlock = (afterId, type = 'paragraph', text = '') => {
    commitHistory();
    const index = Math.max(0, blocks.findIndex((block) => block.id === afterId));
    const next = createEditorBlock(type, text);
    blocks.splice(index + 1, 0, next);
    render();
    commitHistory();
    notify();
    focusBlock(next.id, 'start');
    return next;
  };

  const removeBlock = (id, focusId = null) => {
    if (blocks.length === 1) {
      blocks[0] = createEditorBlock();
      render();
      commitHistory();
      notify();
      focusBlock(blocks[0].id);
      return;
    }
    commitHistory();
    const index = blocks.findIndex((block) => block.id === id);
    if (index < 0) return;
    blocks.splice(index, 1);
    render();
    commitHistory();
    notify();
    focusBlock(focusId || blocks[Math.max(0, index - 1)].id);
  };

  const moveBlock = (id, delta) => {
    const index = blocks.findIndex((block) => block.id === id);
    const destination = index + delta;
    if (index < 0 || destination < 0 || destination >= blocks.length) return;
    commitHistory();
    const [block] = blocks.splice(index, 1);
    blocks.splice(destination, 0, block);
    render();
    commitHistory();
    notify();
    focusBlock(id);
  };

  const duplicateBlock = (id) => {
    const block = findBlock(id);
    if (!block) return;
    commitHistory();
    const index = blocks.indexOf(block);
    const copy = createEditorBlock(block.type, block.text, {
      checked: block.checked,
      indent: block.indent,
      number: block.number,
      language: block.language,
      fence: block.fence,
    });
    blocks.splice(index + 1, 0, copy);
    render();
    commitHistory();
    notify();
    focusBlock(copy.id);
  };

  const updateBlockFromElement = (wrapper) => {
    const block = findBlock(wrapper?.dataset.blockId);
    if (!block) return;
    const previousLineCount = blockLineCounts.get(block.id);
    const content = blockContent(wrapper);
    if (content) block.text = editableHtmlToMarkdown(content);
    const checkbox = wrapper.querySelector('[data-todo-check]');
    if (checkbox) block.checked = checkbox.checked;
    if (previousLineCount !== undefined && previousLineCount !== sourceLineCount(block)) {
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
    blocks.forEach((block) => {
      const wrapper = findWrapper(block.id);
      if (wrapper) wrapper.dataset.sourceLineStart = String(nextLine);
      const lineCount = sourceLineCount(block);
      nextCounts.set(block.id, lineCount);
      nextLine += lineCount;
    });
    blockLineCounts = nextCounts;
  };

  function render() {
    const fragment = document.createDocumentFragment();
    blocks.forEach((block, index) => fragment.append(renderBlock(block, index)));
    canvas.replaceChildren(fragment);
    refreshBlockLineIndex();
    root.classList.toggle('is-empty-document', blocks.length === 1 && blocks[0].text === '');
  }

  const splitBlock = (wrapper) => {
    const block = findBlock(wrapper.dataset.blockId);
    const content = blockContent(wrapper);
    if (!block || !content || block.type === 'code') return false;
    const { before, after } = markdownAroundSelection(document, content, window.getSelection());
    commitHistory();
    block.text = before;
    const nextType = block.type.startsWith('heading') || block.type === 'quote' ? 'paragraph' : block.type;
    const next = createEditorBlock(nextType, after, {
      indent: block.indent,
      number: block.type === 'numbered' ? block.number + 1 : 1,
    });
    blocks.splice(blocks.indexOf(block) + 1, 0, next);
    render();
    commitHistory();
    notify();
    focusBlock(next.id, 'start');
    return true;
  };

  const mergeWithPrevious = (wrapper) => {
    const index = blocks.findIndex((block) => block.id === wrapper.dataset.blockId);
    if (index <= 0) return false;
    const block = blocks[index];
    const previous = blocks[index - 1];
    if (block.type === 'divider' || previous.type === 'divider' || previous.type === 'code') return false;
    commitHistory();
    const previousLength = previous.text.length;
    previous.text = `${previous.text}${block.text}`;
    blocks.splice(index, 1);
    render();
    commitHistory();
    notify();
    focusBlock(previous.id);
    const content = blockContent(findWrapper(previous.id));
    if (content) {
      const walker = document.createTreeWalker(content, window.NodeFilter.SHOW_TEXT);
      let remaining = previousLength;
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
    commitHistory();
    notify();
    const block = findBlock(activeBlockId);
    if (block?.type !== 'code' && block?.text.startsWith('/')) {
      openCommandMenu(activeBlockId, block.text.slice(1));
    } else if (commandBlockId === activeBlockId) {
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
      restoreHistory(historyIndex + (event.shiftKey ? 1 : -1));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      restoreHistory(historyIndex + 1);
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
      commitHistory();
      block.indent = clamp(block.indent + (event.shiftKey ? -1 : 1), 0, 6);
      wrapper.style.setProperty('--block-indent', String(block.indent));
      commitHistory();
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

    if (commandBlockId) {
      const commands = commandMatches(block.text.slice(1));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        commandIndex = (commandIndex + direction + commands.length) % Math.max(1, commands.length);
        openCommandMenu(block.id, block.text.slice(1));
        return;
      }
      if (event.key === 'Enter' && commands.length > 0) {
        event.preventDefault();
        applyBlockType(block.id, commands[commandIndex].id);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandMenu({ returnFocus: true });
        return;
      }
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
        } else if (block.text === '' && blocks.length > 1) {
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
    commitHistory();
    notify();
  };

  const handleDragStart = (event) => {
    const handle = event.target.closest?.('[data-block-menu]');
    const wrapper = handle?.closest('[data-block-id]');
    if (!wrapper) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/x-openmd-block', wrapper.dataset.blockId);
    wrapper.classList.add('is-dragging');
  };

  const handleDragEnd = () => {
    canvas.querySelectorAll('.is-dragging, .is-drag-target').forEach((element) => {
      element.classList.remove('is-dragging', 'is-drag-target');
    });
  };

  const handleDragOver = (event) => {
    const wrapper = event.target.closest?.('[data-block-id]');
    if (!wrapper || !event.dataTransfer.types.includes('text/x-openmd-block')) return;
    event.preventDefault();
    canvas.querySelectorAll('.is-drag-target').forEach((element) => element.classList.remove('is-drag-target'));
    wrapper.classList.add('is-drag-target');
  };

  const handleDrop = (event) => {
    const target = event.target.closest?.('[data-block-id]');
    const sourceId = event.dataTransfer.getData('text/x-openmd-block');
    if (!target || !sourceId || sourceId === target.dataset.blockId) return;
    event.preventDefault();
    const sourceIndex = blocks.findIndex((block) => block.id === sourceId);
    const targetIndex = blocks.findIndex((block) => block.id === target.dataset.blockId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    commitHistory();
    const [block] = blocks.splice(sourceIndex, 1);
    blocks.splice(targetIndex, 0, block);
    render();
    commitHistory();
    notify();
    focusBlock(sourceId);
  };

  const hideCaretEcho = () => {
    if (!caretEcho) return;
    caretEchoVersion += 1;
    caretEcho.classList.remove('is-moving');
    caretEcho.hidden = true;
  };

  const captureCaretEcho = (selection) => {
    if (
      !caretEcho
      || mode !== 'edit'
      || !selection
      || selection.rangeCount === 0
      || !selection.isCollapsed
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
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
    caretEcho.classList.remove('is-moving');
    const version = ++caretEchoVersion;

    window.requestAnimationFrame(() => {
      if (version !== caretEchoVersion || caretEcho.hidden) return;
      caretEcho.classList.add('is-moving');
      caretEcho.addEventListener('animationend', () => {
        if (version !== caretEchoVersion) return;
        caretEcho.classList.remove('is-moving');
        caretEcho.hidden = true;
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
      commitHistory();
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
    blocks = parseEditorDocument(initialSource, { markdown: activeDocument.markdown });
    savedSource = activeDocument.source;
    mode = 'edit';
    saveState = draft ? 'recovered' : 'idle';
    saveError = '';
    history = [initialSource];
    historyIndex = 0;
    render();
    root.hidden = false;
    root.removeAttribute('inert');
    notify();
    queueMicrotask(() => focusBlock(blocks[0].id, 'start'));
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
    blocks = [createEditorBlock()];
    savedSource = '';
    notify();
  };

  const canChangeDocument = () => {
    if (!dirty()) return true;
    const discard = window.confirm('Discard unsaved changes and open another file?');
    if (discard) exit({ force: true });
    return discard;
  };

  canvas.addEventListener('input', handleCanvasInput);
  canvas.addEventListener('keydown', handleCanvasKeydown);
  canvas.addEventListener('click', handleCanvasClick);
  canvas.addEventListener('change', handleCanvasChange);
  canvas.addEventListener('dragstart', handleDragStart);
  canvas.addEventListener('dragend', handleDragEnd);
  canvas.addEventListener('dragover', handleDragOver);
  canvas.addEventListener('drop', handleDrop);
  document.addEventListener('selectionchange', captureSelection);

  commandMenu.addEventListener('mousedown', (event) => event.preventDefault());
  commandMenu.addEventListener('click', (event) => {
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (command && commandBlockId) applyBlockType(commandBlockId, command);
  });
  blockMenu.addEventListener('click', (event) => {
    const action = event.target.closest('[data-block-action]')?.dataset.blockAction;
    const id = blockMenuId;
    if (!action || !id) return;
    closeBlockMenu();
    if (action === 'move-up') moveBlock(id, -1);
    if (action === 'move-down') moveBlock(id, 1);
    if (action === 'duplicate') duplicateBlock(id);
    if (action === 'delete') removeBlock(id);
  });
  blockMenu.addEventListener('keydown', (event) => {
    const buttons = [...blockMenu.querySelectorAll('button:not(:disabled)')];
    if (event.key === 'Escape') {
      event.preventDefault();
      const id = blockMenuId;
      closeBlockMenu();
      if (id) focusBlock(id);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || buttons.length === 0) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  });
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

  document.addEventListener('pointerdown', (event) => {
    if (!commandMenu.hidden && !commandMenu.contains(event.target) && !canvas.contains(event.target)) {
      closeCommandMenu();
    }
    if (!blockMenu.hidden && !blockMenu.contains(event.target) && !event.target.closest?.('[data-block-menu]')) {
      closeBlockMenu();
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
      document.removeEventListener('selectionchange', captureSelection);
      hideCaretEcho();
      setCursor(null);
      closeCommandMenu();
      closeBlockMenu();
      closeInlineToolbar();
    },
  });
}

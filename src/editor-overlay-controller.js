function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createEditorOverlayController({
  window,
  document,
  elements = {},
  commands = [],
  adapters = {},
  hooks = {},
}) {
  const { canvas, commandMenu, blockMenu } = elements;
  if (!window || !document || !canvas || !commandMenu || !blockMenu) {
    throw new TypeError('Editor Overlay Controller requires window, document, canvas and menus');
  }

  let commandBlockId = null;
  let commandIndex = 0;
  let blockMenuId = null;
  let started = false;
  let disposed = false;

  const position = (element, anchorRect, preferred = 'below') => {
    element.hidden = false;
    const rect = element.getBoundingClientRect();
    const gap = 6;
    const safeTop = 40;
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

  const matchingCommands = (query) => {
    const normalized = String(query || '').trim().toLowerCase();
    const available = adapters.isMarkdown?.() === false
      ? commands.filter((command) => command.id === 'paragraph')
      : commands;
    if (!normalized) return available;
    return available.filter((command) => (
      command.label.toLowerCase().includes(normalized)
      || command.hint.toLowerCase().includes(normalized)
      || command.id.includes(normalized)
    ));
  };

  const closeCommand = ({ returnFocus = false } = {}) => {
    const id = commandBlockId;
    commandBlockId = null;
    commandIndex = 0;
    commandMenu.hidden = true;
    commandMenu.replaceChildren();
    if (returnFocus && id) adapters.focusBlock?.(id);
  };

  const closeBlock = ({ returnFocus = false, focusBlock = false } = {}) => {
    const id = blockMenuId;
    blockMenuId = null;
    blockMenu.hidden = true;
    if (!returnFocus || !id) return;
    if (focusBlock) adapters.focusBlock?.(id);
    else adapters.getWrapper?.(id)?.querySelector('[data-block-menu]')?.focus();
  };

  const openCommand = (blockId, query = '') => {
    if (disposed) return false;
    const wrapper = adapters.getWrapper?.(blockId);
    if (!wrapper) return false;
    closeBlock();
    commandBlockId = blockId;
    const matches = matchingCommands(query);
    commandIndex = clamp(commandIndex, 0, Math.max(0, matches.length - 1));
    commandMenu.replaceChildren();
    const header = document.createElement('div');
    header.className = 'editor-menu-header';
    header.textContent = matches.length > 0 ? 'Turn into' : 'No matching blocks';
    commandMenu.append(header);
    matches.forEach((command, index) => {
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
    position(commandMenu, wrapper.getBoundingClientRect());
    return true;
  };

  const openBlock = (blockId, anchor, { focus = false } = {}) => {
    if (disposed || !anchor) return false;
    const block = adapters.getBlock?.(blockId);
    const blocks = adapters.getBlocks?.() || [];
    if (!block) return false;
    closeCommand();
    blockMenuId = blockId;
    blockMenu.querySelector('[data-block-action="move-up"]')?.toggleAttribute(
      'disabled', blocks[0]?.id === blockId,
    );
    blockMenu.querySelector('[data-block-action="move-down"]')?.toggleAttribute(
      'disabled', blocks.at(-1)?.id === blockId,
    );
    blockMenu.querySelector('[data-block-action="delete"]')?.toggleAttribute(
      'disabled', blocks.length === 1 && block.text === '',
    );
    position(blockMenu, anchor.getBoundingClientRect());
    if (focus) queueMicrotask(() => blockMenu.querySelector('button:not(:disabled)')?.focus());
    return true;
  };

  const activateCommand = (blockId, commandId) => {
    closeCommand();
    hooks.onCommand?.(blockId, commandId);
  };

  const handleCommandKey = (event, { blockId, query = '' } = {}) => {
    if (!commandBlockId || commandBlockId !== blockId) return false;
    const matches = matchingCommands(query);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      commandIndex = (commandIndex + direction + matches.length) % Math.max(1, matches.length);
      openCommand(blockId, query);
      return true;
    }
    if (event.key === 'Enter' && matches.length > 0) {
      event.preventDefault();
      activateCommand(blockId, matches[commandIndex].id);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCommand({ returnFocus: true });
      return true;
    }
    return false;
  };

  const onCommandMouseDown = (event) => event.preventDefault();
  const onCommandClick = (event) => {
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (command && commandBlockId) activateCommand(commandBlockId, command);
  };
  const onBlockClick = (event) => {
    const action = event.target.closest('[data-block-action]')?.dataset.blockAction;
    const id = blockMenuId;
    if (!action || !id) return;
    closeBlock();
    hooks.onBlockAction?.(id, action);
  };
  const onBlockKeyDown = (event) => {
    const buttons = [...blockMenu.querySelectorAll('button:not(:disabled)')];
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBlock({ returnFocus: true, focusBlock: true });
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
  };
  const onDocumentPointerDown = (event) => {
    if (!commandMenu.hidden && !commandMenu.contains(event.target) && !canvas.contains(event.target)) {
      closeCommand();
    }
    if (!blockMenu.hidden && !blockMenu.contains(event.target) && !event.target.closest?.('[data-block-menu]')) {
      closeBlock();
    }
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    commandMenu.addEventListener('mousedown', onCommandMouseDown);
    commandMenu.addEventListener('click', onCommandClick);
    blockMenu.addEventListener('click', onBlockClick);
    blockMenu.addEventListener('keydown', onBlockKeyDown);
    document.addEventListener('pointerdown', onDocumentPointerDown);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    commandMenu.removeEventListener('mousedown', onCommandMouseDown);
    commandMenu.removeEventListener('click', onCommandClick);
    blockMenu.removeEventListener('click', onBlockClick);
    blockMenu.removeEventListener('keydown', onBlockKeyDown);
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    closeCommand();
    closeBlock();
  };

  return Object.freeze({
    start,
    openCommand,
    closeCommand,
    openBlock,
    closeBlock,
    handleCommandKey,
    isCommandOpenFor: (blockId) => commandBlockId === blockId,
    dispose,
  });
}

function isTypingTarget(target) {
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName)
    || target?.isContentEditable
    || target?.closest?.('[contenteditable="true"], [contenteditable=""]');
}

export function createReaderKeyboardController({
  window,
  adapters = {},
  hooks = {},
} = {}) {
  if (!window) throw new TypeError('Reader Keyboard Controller requires a window');

  let disposed = false;
  let started = false;
  const isMac = /Mac/.test(window.navigator?.platform || '');

  const handleKeydown = (event) => {
    if (disposed) return;
    const command = event.ctrlKey || (isMac && event.metaKey);
    if (command && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      hooks.openFind?.();
      return;
    }

    if (event.key === 'F1') {
      event.preventDefault();
      hooks.toggleHelp?.();
      return;
    }

    if (event.key === 'Escape' && adapters.isHelpVisible?.()) {
      event.preventDefault();
      hooks.closeHelp?.();
      return;
    }

    if (event.key === 'Escape' && adapters.isReadingToolsOpen?.()) {
      event.preventDefault();
      hooks.closeReadingTools?.();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      hooks.toggleEdit?.();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's' && adapters.isEditMode?.()) {
      event.preventDefault();
      hooks.saveEditor?.();
      return;
    }

    if (command && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      hooks.openFile?.();
      return;
    }

    // Close the open document (not the window). Match key or code so layout
    // variants still deliver Ctrl+F4 to the page handler.
    if (!event.altKey && ((event.ctrlKey && (event.key === 'F4' || event.code === 'F4'))
      || (isMac && event.metaKey && event.key.toLowerCase() === 'w'))) {
      event.preventDefault();
      event.stopPropagation?.();
      hooks.closeFile?.();
      return;
    }

    if (command && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      hooks.zoomIn?.();
    } else if (command && event.key === '-') {
      event.preventDefault();
      hooks.zoomOut?.();
    } else if (command && event.key === '0') {
      event.preventDefault();
      hooks.resetZoom?.();
    }

    const typingField = isTypingTarget(event.target);
    if (!typingField && (event.key === 't' || event.key === 'T') && (!event.metaKey || isMac) && !event.altKey) {
      event.preventDefault();
      hooks.cycleTheme?.(command || event.shiftKey ? -1 : 1);
    }
  };

  const start = () => {
    if (disposed || started) return;
    started = true;
    if (isMac) {
      window.document?.querySelectorAll('kbd').forEach((key) => {
        if (key.textContent === 'Ctrl') key.textContent = 'Cmd';
        if (key.textContent === 'F4') key.textContent = 'W';
      });
    }
    window.addEventListener('keydown', handleKeydown);
  };

  return Object.freeze({
    start,
    handleKeydown,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('keydown', handleKeydown);
    },
  });
}

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

  const handleKeydown = (event) => {
    if (disposed) return;

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

    if (event.key === 'Escape' && adapters.isTypographyOpen?.()) {
      event.preventDefault();
      hooks.closeTypography?.();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      hooks.openFile?.();
      return;
    }

    if (event.ctrlKey && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      hooks.zoomIn?.();
    } else if (event.ctrlKey && event.key === '-') {
      event.preventDefault();
      hooks.zoomOut?.();
    } else if (event.ctrlKey && event.key === '0') {
      event.preventDefault();
      hooks.resetZoom?.();
    }

    const typingField = isTypingTarget(event.target);
    if (!typingField && (event.key === 't' || event.key === 'T') && !event.metaKey && !event.altKey) {
      event.preventDefault();
      hooks.cycleTheme?.(event.ctrlKey || event.shiftKey ? -1 : 1);
    }
  };

  const start = () => {
    if (disposed || started) return;
    started = true;
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

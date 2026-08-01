const INLINE_COMMANDS = Object.freeze({
  bold: 'bold',
  italic: 'italic',
  strike: 'strikeThrough',
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isSelectionInside(selection, root) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  return root.contains(selection.getRangeAt(0).commonAncestorContainer);
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

export function createEditorSelectionController({
  window,
  document,
  elements = {},
  adapters = {},
  hooks = {},
}) {
  const { root, canvas, inlineToolbar, caretEcho, linkPopover, linkInput, linkApply } = elements;
  if (!window || !document || !root || !canvas || !inlineToolbar) {
    throw new TypeError('Editor Selection Controller requires window, document, root, canvas and toolbar');
  }

  let savedRange = null;
  let caretVersion = 0;
  let caretFrameId = null;
  let caretSyncFrameId = null;
  let caretAnimationEnd = null;
  let started = false;
  let disposed = false;
  const scrollContainer = root.closest('.reader-page');

  const position = (element, anchorRect, preferred = 'above') => {
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

  const cancelCaretMotion = () => {
    caretVersion += 1;
    if (caretFrameId !== null) window.cancelAnimationFrame?.(caretFrameId);
    caretFrameId = null;
    if (caretAnimationEnd && caretEcho) caretEcho.removeEventListener('animationend', caretAnimationEnd);
    caretAnimationEnd = null;
    caretEcho?.classList.remove('is-moving');
  };

  const cancelCaretSync = () => {
    if (caretSyncFrameId !== null) window.cancelAnimationFrame?.(caretSyncFrameId);
    caretSyncFrameId = null;
  };

  const hideCaret = () => {
    cancelCaretMotion();
    if (caretEcho) caretEcho.hidden = true;
    root.classList.remove('has-custom-caret');
    // Leave-edit / clear / scroll-off must drop the trail immediately, not after idle.
    adapters.getCaretTrail?.()?.hide?.();
  };

  const isCaretVisibleInScrollContainer = (rect) => {
    if (!scrollContainer) return true;
    const clip = scrollContainer.getBoundingClientRect();
    if (clip.width <= 0 || clip.height <= 0) return true;
    return rect.bottom > clip.top
      && rect.top < clip.bottom
      && rect.right >= clip.left
      && rect.left <= clip.right;
  };

  const captureCaret = (selection, { animate = true } = {}) => {
    if (
      !caretEcho
      || !adapters.isEditing?.()
      || !selection
      || selection.rangeCount === 0
      || !selection.isCollapsed
    ) {
      hideCaret();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!canvas.contains(range.startContainer)) {
      hideCaret();
      return;
    }
    const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
    const rect = rects?.length > 0
      ? rects[0]
      : typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : null;
    if (
      !rect
      || !Number.isFinite(rect.left)
      || !Number.isFinite(rect.top)
      || rect.height <= 0
      || !isCaretVisibleInScrollContainer(rect)
    ) {
      hideCaret();
      return;
    }
    cancelCaretMotion();
    const left = Math.round(rect.left * 2) / 2;
    const top = Math.round(rect.top * 2) / 2;
    const height = Math.max(12, Math.min(32, rect.height));
    caretEcho.style.left = `${left}px`;
    caretEcho.style.top = `${top}px`;
    caretEcho.style.height = `${height}px`;
    caretEcho.hidden = false;
    root.classList.add('has-custom-caret');
    const reduced = typeof adapters.shouldReduceMotion === 'function'
      ? Boolean(adapters.shouldReduceMotion())
      : Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    if (!reduced) {
      adapters.getCaretTrail?.()?.moveTo?.(left, top, height, 2);
    } else {
      adapters.getCaretTrail?.()?.hide?.();
    }
    if (!animate || reduced) return;
    const version = ++caretVersion;
    caretFrameId = window.requestAnimationFrame?.(() => {
      caretFrameId = null;
      if (version !== caretVersion || caretEcho.hidden || disposed) return;
      caretEcho.classList.add('is-moving');
      caretAnimationEnd = () => {
        if (version !== caretVersion) return;
        caretEcho.classList.remove('is-moving');
        caretAnimationEnd = null;
      };
      caretEcho.addEventListener('animationend', caretAnimationEnd, { once: true });
    }) ?? null;
  };

  const scheduleCaretSync = () => {
    if (disposed || caretSyncFrameId !== null) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      captureCaret(window.getSelection(), { animate: false });
      return;
    }
    let ranSynchronously = false;
    const frameId = window.requestAnimationFrame(() => {
      ranSynchronously = true;
      caretSyncFrameId = null;
      if (disposed) return;
      captureCaret(window.getSelection(), { animate: false });
    });
    if (!ranSynchronously) caretSyncFrameId = frameId;
  };

  const updateCursor = (selection) => {
    if (!adapters.isEditing?.() || !selection || selection.rangeCount === 0) {
      adapters.setCursor?.(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const content = element?.closest?.('[data-editor-content]');
    const wrapper = content?.closest?.('[data-block-id]');
    if (!content || !wrapper || !canvas.contains(content)) {
      adapters.setCursor?.(null);
      return;
    }
    const before = textBeforeSelection(document, content, selection);
    const localLines = before.split('\n');
    const blockStartLine = Number.parseInt(wrapper.dataset.sourceLineStart, 10) || 1;
    const codeFenceOffset = adapters.isMarkdown?.() !== false && wrapper.dataset.blockType === 'code' ? 1 : 0;
    adapters.setCursor?.({
      line: blockStartLine + codeFenceOffset + localLines.length - 1,
      column: localLines.at(-1).length + 1,
    });
  };

  const updateInlineStates = (range) => {
    const node = range.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const selectors = {
      bold: 'strong, b',
      italic: 'em, i',
      strike: 's, strike, del',
      code: 'code',
      link: 'a',
    };
    inlineToolbar.querySelectorAll('[data-inline-command]').forEach((button) => {
      const active = Boolean(element?.closest?.(selectors[button.dataset.inlineCommand]));
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const close = () => {
    inlineToolbar.hidden = true;
    if (linkPopover) linkPopover.hidden = true;
    savedRange = null;
  };

  const capture = () => {
    if (disposed) return;
    cancelCaretSync();
    const selection = window.getSelection();
    updateCursor(selection);
    captureCaret(selection);
    if (!adapters.isEditing?.() || !isSelectionInside(selection, canvas)) {
      if (!linkPopover || linkPopover.hidden) close();
      return;
    }
    const range = selection.getRangeAt(0);
    savedRange = range.cloneRange();
    updateInlineStates(range);
    const rect = typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : inlineToolbar.getBoundingClientRect();
    position(inlineToolbar, rect, 'above');
  };

  const captureCurrentRange = () => {
    const selection = window.getSelection();
    if (!adapters.isEditing?.() || !isSelectionInside(selection, canvas)) return false;
    savedRange = selection.getRangeAt(0).cloneRange();
    return true;
  };

  const restore = () => {
    if (!savedRange) return false;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
    return true;
  };

  const syncSelectedBlock = () => {
    if (!savedRange) return;
    const node = savedRange.commonAncestorContainer;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const wrapper = element?.closest?.('[data-block-id]');
    if (!wrapper) return;
    adapters.updateBlockFromElement?.(wrapper);
    hooks.onDocumentChange?.();
  };

  const applyCommand = (command) => {
    if (!restore()) return false;
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
    } else if (INLINE_COMMANDS[command]) {
      document.execCommand(INLINE_COMMANDS[command], false);
    } else {
      return false;
    }
    syncSelectedBlock();
    capture();
    return true;
  };

  const applyFromCurrentSelection = (command) => (
    captureCurrentRange() && applyCommand(command)
  );

  const openLink = () => {
    if (!savedRange || !linkPopover || !linkInput) return false;
    linkInput.value = '';
    linkPopover.hidden = false;
    position(linkPopover, inlineToolbar.getBoundingClientRect(), 'below');
    linkInput.focus();
    return true;
  };
  const openLinkFromCurrentSelection = () => captureCurrentRange() && openLink();

  const applyLink = () => {
    const href = linkInput?.value.trim();
    if (!href || !restore()) return false;
    const safeHref = /^(?:https?:|mailto:|#|\.\.?\/)/i.test(href) ? href : `https://${href}`;
    document.execCommand('createLink', false, safeHref);
    syncSelectedBlock();
    close();
    return true;
  };

  const clear = () => {
    close();
    hideCaret();
    adapters.setCursor?.(null);
  };

  const onToolbarMouseDown = (event) => event.preventDefault();
  const onToolbarClick = (event) => {
    const command = event.target.closest('[data-inline-command]')?.dataset.inlineCommand;
    if (!command) return;
    if (command === 'link') openLink();
    else applyCommand(command);
  };
  const onLinkApply = () => applyLink();
  const onLinkKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyLink();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      hooks.focusBlock?.(adapters.getActiveBlockId?.());
    }
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    document.addEventListener('selectionchange', capture);
    scrollContainer?.addEventListener('scroll', scheduleCaretSync, { passive: true });
    window.addEventListener('resize', scheduleCaretSync, { passive: true });
    inlineToolbar.addEventListener('mousedown', onToolbarMouseDown);
    inlineToolbar.addEventListener('click', onToolbarClick);
    linkApply?.addEventListener('click', onLinkApply);
    linkInput?.addEventListener('keydown', onLinkKeyDown);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('selectionchange', capture);
    scrollContainer?.removeEventListener('scroll', scheduleCaretSync);
    window.removeEventListener('resize', scheduleCaretSync);
    inlineToolbar.removeEventListener('mousedown', onToolbarMouseDown);
    inlineToolbar.removeEventListener('click', onToolbarClick);
    linkApply?.removeEventListener('click', onLinkApply);
    linkInput?.removeEventListener('keydown', onLinkKeyDown);
    cancelCaretSync();
    clear();
  };

  return Object.freeze({
    start,
    capture,
    applyFromCurrentSelection,
    openLinkFromCurrentSelection,
    close,
    clear,
    dispose,
  });
}

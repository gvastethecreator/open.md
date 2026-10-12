import { MOTION_EASE_EXIT, MOTION_EASE_OUT } from './reader-motion.js';

export function createEditorCaretMotion({ window, canvas, isEnabled, shouldReduceMotion }) {
  const document = canvas.ownerDocument;
  const overlay = document.createElement('div');
  overlay.className = 'editor-caret-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  const caret = document.createElement('div');
  caret.className = 'editor-caret-slide';
  const trail = document.createElement('span');
  trail.className = 'editor-caret-gradient';
  caret.append(trail);
  overlay.append(caret);

  let mounted = false;
  let composing = false;
  let frame = null;
  let previous = null;
  let movement = null;
  let gradient = null;
  let slidingContent = null;
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  function stop() {
    const active = movement;
    movement = null;
    active?.cancel();
    gradient?.cancel();
    gradient = null;
    overlay.hidden = true;
    slidingContent?.classList.remove('is-caret-sliding');
    slidingContent = null;
  }

  function measure() {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !canvas.contains(selection.focusNode)
      || !canvas.contains(document.activeElement)) return null;
    const node = selection.focusNode;
    const element = node.nodeType === 1 ? node : node.parentElement;
    const row = element?.closest('[data-classic-line]');
    if (!row) return null;
    const content = row.querySelector('[data-classic-content]');
    if (!content) return null;
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(false);
    let rect = range.getClientRects?.()[0] || range.getBoundingClientRect?.();
    if (!rect?.height) {
      if (content?.textContent) return null;
      const bounds = content?.getBoundingClientRect();
      if (!bounds?.height) return null;
      const height = Number.parseFloat(window.getComputedStyle(content).fontSize);
      rect = { left: bounds.left, top: bounds.top + (bounds.height - height) / 2, height };
    }
    const host = canvas.closest('.editor-view') || canvas;
    const hostRect = host.getBoundingClientRect();
    const bounds = canvas.getBoundingClientRect();
    const style = window.getComputedStyle(canvas);
    const left = Math.max(bounds.left + (Number.parseFloat(style.paddingLeft) || 0), hostRect.left, 0);
    const right = Math.min(bounds.right - (Number.parseFloat(style.paddingRight) || 0), hostRect.right, window.innerWidth);
    const top = Math.max(hostRect.top, 0);
    const bottom = Math.min(hostRect.bottom, window.innerHeight);
    if (right <= left || bottom <= top || rect.top < top || rect.top + rect.height > bottom
      || rect.left < left || rect.left > right) return null;
    return {
      x: rect.left - left, y: rect.top - top, height: rect.height,
      line: row.classicLineIndex, content, left, top, width: right - left, bottom,
    };
  }

  function update() {
    frame = null;
    if (!mounted || composing || document.hidden || !isEnabled() || shouldReduceMotion()) {
      stop();
      previous = null;
      return;
    }
    const next = measure();
    if (!next) {
      stop();
      previous = null;
      return;
    }
    const from = previous;
    previous = next;
    if (!from || typeof caret.animate !== 'function') return;
    if (Math.abs(from.x - next.x) < 0.5 && Math.abs(from.y - next.y) < 0.5
      && from.line === next.line) return;

    // Sample the displayed caret before cancelling an interrupted flight.
    const live = movement ? caret.getBoundingClientRect() : null;
    const startX = live ? live.left - next.left : from.x + from.left - next.left;
    const startY = live ? live.top - next.top : from.y + from.top - next.top;
    stop();
    Object.assign(overlay.style, {
      left: `${next.left}px`, top: `${next.top}px`, width: `${next.width}px`,
      height: `${next.bottom - next.top}px`,
    });
    const changesLine = from.line !== next.line || Math.abs(from.y - next.y) > next.height / 2;
    const direction = changesLine
      ? (next.line === from.line ? Math.sign(next.y - from.y) : Math.sign(next.line - from.line))
      : Math.sign(next.x - from.x);
    caret.dataset.direction = direction < 0 ? 'left' : 'right';
    const tail = Math.min(96, next.width * 0.16, changesLine ? Infinity : Math.abs(next.x - startX));
    trail.style.width = `${tail}px`;
    const position = (x, y) => `translate3d(${x}px, ${y}px, 0)`;
    const end = position(next.x, next.y);
    caret.style.transform = end;
    caret.style.height = `${next.height}px`;
    overlay.hidden = false;
    slidingContent = next.content;
    slidingContent.classList.add('is-caret-sliding');
    const keyframes = changesLine ? [
      { transform: position(startX, startY), height: `${from.height}px`, offset: 0, easing: MOTION_EASE_EXIT },
      { transform: position(direction > 0 ? next.width + tail : -tail, startY), height: `${from.height}px`, offset: 0.42 },
      { transform: position(direction > 0 ? -2 : next.width + 2, next.y), height: `${next.height}px`, offset: 0.42, easing: MOTION_EASE_OUT },
      { transform: end, height: `${next.height}px`, offset: 1 },
    ] : [
      { transform: position(startX, startY) },
      { transform: end },
    ];
    const duration = changesLine ? 340 : 100;
    gradient = trail.animate([
      { opacity: 0, transform: 'scaleX(0.15)', offset: 0 },
      { opacity: 0.55, transform: 'scaleX(1)', offset: 0.25 },
      { opacity: 0.45, transform: 'scaleX(0.8)', offset: 0.65 },
      { opacity: 0, transform: 'scaleX(0.15)', offset: 1 },
    ], { duration, easing: 'linear' });
    const animation = caret.animate(keyframes, {
      duration, easing: changesLine ? 'linear' : MOTION_EASE_OUT,
    });
    movement = animation;
    animation.onfinish = () => {
      if (movement === animation) stop();
    };
  }

  function schedule() {
    if (mounted && frame == null) frame = window.requestAnimationFrame(update);
  }

  function refresh() {
    stop();
    previous = null;
    schedule();
  }

  function compositionStart() { composing = true; refresh(); }
  function compositionEnd() { composing = false; schedule(); }

  const bindings = [
    [document, 'selectionchange', schedule],
    [canvas, 'input', schedule],
    [canvas, 'focusin', schedule],
    [canvas, 'focusout', refresh],
    [canvas, 'compositionstart', compositionStart],
    [canvas, 'compositionend', compositionEnd],
    [document, 'scroll', refresh, true],
    [document, 'visibilitychange', refresh],
    [window, 'resize', refresh],
    [window, 'blur', refresh],
  ];

  function unmount() {
    mounted = false;
    stop();
    previous = null;
    composing = false;
    if (frame != null) window.cancelAnimationFrame(frame);
    frame = null;
    bindings.forEach(([target, type, listener, capture]) => target.removeEventListener(type, listener, capture));
    media?.removeEventListener?.('change', refresh);
    overlay.remove();
  }

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      document.body.append(overlay);
      bindings.forEach(([target, type, listener, capture]) => target.addEventListener(type, listener, capture));
      media?.addEventListener?.('change', refresh);
      schedule();
    },
    refresh,
    unmount,
  };
}

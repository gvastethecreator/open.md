const DEFAULT_DELAY_MS = 2000;
const SHIMMER_CLASS = 'is-shimmering';
const SHIMMER_ANIMATION_NAME = 'empty-logo-shimmer';

/** Owns the empty-state logo shimmer trigger, busy state, and cleanup. */
export function createEmptyStateMotion({
  window,
  shell,
  openButton = null,
  isEmpty = () => true,
} = {}) {
  if (!window || !shell) {
    throw new TypeError('Empty State Motion requires window and shell');
  }

  let started = false;
  let disposed = false;
  let busy = false;
  let timer = null;

  const play = () => {
    if (disposed || busy) return false;
    busy = true;
    shell.classList.remove(SHIMMER_CLASS);
    // A style flush lets a later idle pass restart the same keyframes.
    void shell.offsetWidth;
    shell.classList.add(SHIMMER_CLASS);
    return true;
  };

  const handleAnimationEnd = (event) => {
    if (event.animationName !== SHIMMER_ANIMATION_NAME) return;
    if (event.target !== shell && !shell.contains(event.target)) return;
    shell.classList.remove(SHIMMER_CLASS);
    busy = false;
  };

  const start = () => {
    if (started || disposed) return false;
    started = true;
    shell.addEventListener('animationend', handleAnimationEnd);
    openButton?.addEventListener('mouseenter', play);
    if (isEmpty()) timer = window.setTimeout(play, DEFAULT_DELAY_MS);
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    shell.removeEventListener('animationend', handleAnimationEnd);
    openButton?.removeEventListener('mouseenter', play);
    shell.classList.remove(SHIMMER_CLASS);
    busy = false;
  };

  return Object.freeze({ start, dispose });
}

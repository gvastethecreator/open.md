function ensureToastElement(document, element) {
  if (element) return element;
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  document.body.appendChild(toast);
  return toast;
}

function ensureMessageElement(document, toast) {
  let message = toast.querySelector('.toast-message');
  if (message) return message;
  message = document.createElement('span');
  message.className = 'toast-message';
  if (toast.textContent) message.textContent = toast.textContent;
  toast.replaceChildren(message);
  return message;
}

export function createToastPresenter({ window, document, element = null, duration = 2000 }) {
  if (!window || !document) throw new TypeError('Toast Presenter requires window and document');

  const toast = ensureToastElement(document, element);
  const messageElement = ensureMessageElement(document, toast);
  let timeoutId = null;
  let revision = 0;
  let animations = [];
  let disposed = false;

  const clearMorph = ({ invalidate = false } = {}) => {
    if (invalidate) revision += 1;
    animations.forEach((animation) => animation.cancel());
    animations = [];
    toast.querySelectorAll('.toast-message--previous').forEach((node) => node.remove());
    toast.style.removeProperty('width');
    toast.style.removeProperty('height');
  };

  const replaceMessage = (nextMessage) => {
    const visibleBox = toast.getBoundingClientRect();
    const candidates = [messageElement, ...toast.querySelectorAll('.toast-message--previous')];
    const outgoingElement = candidates.reduce((mostVisible, candidate) => {
      const candidateOpacity = Number.parseFloat(window.getComputedStyle(candidate).opacity) || 1;
      const currentOpacity = Number.parseFloat(window.getComputedStyle(mostVisible).opacity) || 1;
      return candidateOpacity > currentOpacity ? candidate : mostVisible;
    }, messageElement);
    const outgoingStyle = window.getComputedStyle(outgoingElement);
    const outgoing = {
      text: outgoingElement.textContent,
      opacity: outgoingStyle.opacity || '1',
      filter: outgoingStyle.filter || 'none',
    };
    const canMorph = toast.classList.contains('show')
      && messageElement.textContent !== nextMessage
      && visibleBox.width > 0
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      && typeof toast.animate === 'function';
    const morphRevision = ++revision;

    clearMorph();
    if (!canMorph) {
      messageElement.textContent = nextMessage;
      return;
    }

    const previousMessage = messageElement.cloneNode(true);
    previousMessage.classList.add('toast-message--previous');
    previousMessage.setAttribute('aria-hidden', 'true');
    previousMessage.textContent = outgoing.text;
    messageElement.textContent = nextMessage;

    const targetBox = toast.getBoundingClientRect();
    const currentRadius = window.getComputedStyle(toast).borderRadius;
    toast.style.width = `${visibleBox.width}px`;
    toast.style.height = `${visibleBox.height}px`;
    toast.appendChild(previousMessage);

    const shape = toast.animate([
      { width: `${visibleBox.width}px`, height: `${visibleBox.height}px`, borderRadius: currentRadius },
      {
        width: `${(visibleBox.width + targetBox.width) / 2}px`,
        height: `${(visibleBox.height + targetBox.height) / 2}px`,
        borderRadius: '8px',
        offset: 0.5,
      },
      { width: `${targetBox.width}px`, height: `${targetBox.height}px`, borderRadius: currentRadius },
    ], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
    const previous = previousMessage.animate([
      { opacity: outgoing.opacity, filter: outgoing.filter },
      { opacity: 0, filter: 'blur(0.6px)' },
    ], { duration: 120, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'both' });
    const next = messageElement.animate([
      { opacity: 0, filter: 'blur(0.6px)' },
      { opacity: 1, filter: 'blur(0)' },
    ], {
      duration: 180,
      delay: 58,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    });
    animations = [shape, previous, next];
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (morphRevision === revision && !disposed) clearMorph();
    });
  };

  const show = (message) => {
    if (disposed) return;
    replaceMessage(String(message));
    toast.classList.add('show');
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      toast.classList.remove('show');
    }, duration);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timeoutId);
    timeoutId = null;
    clearMorph({ invalidate: true });
    toast.classList.remove('show');
  };

  return Object.freeze({ show, cancel: () => clearMorph({ invalidate: true }), dispose, element: toast });
}

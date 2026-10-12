export function findTextMatches(text, query) {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

export function createDocumentFind({ window, panel, scroller, getSurface, observeRoot }) {
  const document = panel.ownerDocument;
  const input = panel.querySelector('input');
  const status = panel.querySelector('[role="status"]');
  let matches = [];
  let textNodes = [];
  let activeRange = null;
  let index = -1;
  let previousFocus = null;
  let timer = null;

  const clearHighlights = () => {
    window.CSS.highlights.delete('document-find-current');
  };

  const collect = () => {
    const surface = getSurface();
    if (!surface) return { nodes: [], matches: [] };
    const nodes = [];
    let text = '';
    let lastBlock = null;
    const walker = document.createTreeWalker(surface, window.NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent.closest('button, select, script, style, [hidden], .hidden, [aria-hidden="true"]')) continue;
      const block = parent.closest('p, div, li, pre, h1, h2, h3, h4, h5, h6, td, th');
      if (lastBlock && block !== lastBlock) text += '\n';
      lastBlock = block;
      nodes.push({ node, start: text.length, end: text.length + node.data.length });
      text += node.data;
    }
    return { nodes, matches: findTextMatches(text, input.value) };
  };

  const show = (scroll = false) => {
    clearHighlights();
    activeRange = null;
    if (index >= 0) {
      const match = matches[index];
      const first = textNodes.find((entry) => entry.end > match.start);
      const last = textNodes.find((entry) => entry.end >= match.end);
      activeRange = document.createRange();
      activeRange.setStart(first.node, match.start - first.start);
      activeRange.setEnd(last.node, match.end - last.start);
      window.CSS.highlights.set('document-find-current', new window.Highlight(activeRange));
      if (scroll) {
        const matchRect = activeRange.getBoundingClientRect();
        const viewport = scroller.getBoundingClientRect();
        scroller.scrollTop += matchRect.top - viewport.top - (scroller.clientHeight - matchRect.height) / 2;
      }
    }
    status.textContent = input.value ? `${index + 1} of ${matches.length} matches` : 'Type to find';
  };

  const refresh = () => {
    const result = collect();
    matches = result.matches;
    textNodes = result.nodes;
    index = matches.length ? Math.min(Math.max(0, index), matches.length - 1) : -1;
    show();
  };
  const move = (direction) => {
    refresh();
    if (matches.length) index = (index + direction + matches.length) % matches.length;
    show(true);
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    clearHighlights();
    const surface = getSurface();
    const editor = activeRange?.startContainer.parentElement?.closest('[contenteditable="true"]');
    if (editor?.isConnected && surface?.contains(editor)) {
      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(activeRange);
    } else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    else surface?.focus({ preventScroll: true });
  };
  const onInput = () => { index = 0; refresh(); show(true); };
  const onKey = (event) => {
    if (panel.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    } else if (event.key === 'Enter' && panel.contains(event.target)) {
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    }
  };
  const onClick = (event) => {
    const action = event.target.closest('[data-find-action]')?.dataset.findAction;
    if (action === 'close') close();
    else if (action) move(action === 'previous' ? -1 : 1);
  };
  const observer = new window.MutationObserver(() => {
    if (panel.hidden) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 100);
  });
  observer.observe(observeRoot, { childList: true, characterData: true, subtree: true });
  input.addEventListener('input', onInput);
  window.addEventListener('keydown', onKey);
  panel.addEventListener('click', onClick);

  return {
    open() {
      if (!getSurface()) return;
      if (panel.hidden) previousFocus = document.activeElement;
      panel.hidden = false;
      input.focus();
      input.select();
      refresh();
    },
    close,
    dispose() {
      observer.disconnect();
      window.clearTimeout(timer);
      close();
      input.removeEventListener('input', onInput);
      window.removeEventListener('keydown', onKey);
      panel.removeEventListener('click', onClick);
    },
  };
}

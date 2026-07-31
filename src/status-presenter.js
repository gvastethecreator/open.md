function prefersReducedMotion(window) {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function metricNodes(metrics) {
  return [...(metrics?.querySelectorAll?.('.status-metric') || [])];
}

export function createStatusPresenter({ window, document, elements = {} }) {
  const primary = elements.primary || document.getElementById('status-pill');
  const context = elements.context || document.getElementById('status-context');
  const metrics = elements.metrics || document.getElementById('status-metrics');
  const animations = new Set();
  let disposed = false;

  function cancelAnimations() {
    animations.forEach((animation) => animation.cancel?.());
    animations.clear();
    metricNodes(metrics).forEach((node) => {
      node.getAnimations?.().forEach((animation) => animation.cancel());
    });
  }

  function setIdentity({ primary: nextPrimary, context: nextContext = '', title } = {}) {
    if (disposed || !primary) return;

    const visiblePrimary = String(nextPrimary ?? '');
    const visibleContext = String(nextContext ?? '');
    const tooltip = title ?? [visiblePrimary, visibleContext].filter(Boolean).join(' · ');
    primary.textContent = visiblePrimary;
    primary.dataset.tooltip = tooltip;
    if (context) {
      context.textContent = visibleContext;
      context.dataset.tooltip = tooltip;
    }
  }

  function renderMetrics(items = [], accessibleLabel = '') {
    if (disposed || !metrics) return;

    const existingByKind = new Map(metricNodes(metrics).map((item) => [item.dataset.statusKind, item]));
    const nodes = items.map(({ kind, visible }) => {
      const item = existingByKind.get(kind) || document.createElement('span');
      item.className = `status-metric status-metric--${kind}`;
      item.dataset.statusKind = kind;

      if (kind === 'zoom') {
        let icon = item.querySelector('i');
        let value = item.querySelector('.status-metric-value');
        if (!icon) {
          icon = document.createElement('i');
          icon.className = 'iconoir-search';
          icon.setAttribute('aria-hidden', 'true');
          item.append(icon);
        }
        if (!value) {
          value = document.createElement('span');
          value.className = 'status-metric-value';
          item.append(value);
        }

        const changed = Boolean(value.textContent) && value.textContent !== visible;
        value.textContent = visible;
        if (
          changed
          && !prefersReducedMotion(window)
          && typeof value.animate === 'function'
        ) {
          value.getAnimations?.().forEach((animation) => animation.cancel());
          const animation = value.animate([
            { opacity: 0, transform: 'translateY(3px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], {
            duration: 160,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
          });
          animations.add(animation);
          animation.finished?.finally(() => animations.delete(animation));
        }
      } else {
        item.textContent = visible;
      }
      return item;
    });

    const currentKinds = metricNodes(metrics).map((item) => item.dataset.statusKind);
    const nextKinds = items.map(({ kind }) => kind);
    if (
      currentKinds.length !== nextKinds.length
      || currentKinds.some((kind, index) => kind !== nextKinds[index])
    ) {
      metrics.replaceChildren(...nodes);
    }

    metrics.hidden = nodes.length === 0;
    if (nodes.length === 0) {
      delete metrics.dataset.tooltip;
      metrics.removeAttribute('aria-label');
      return;
    }
    metrics.dataset.tooltip = accessibleLabel;
    metrics.setAttribute('aria-label', accessibleLabel);
  }

  function clear() {
    if (disposed) return;
    setIdentity({ primary: 'open.md', context: 'Ready' });
    renderMetrics([], '');
  }

  return Object.freeze({
    setIdentity,
    renderMetrics,
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimations();
    },
  });
}

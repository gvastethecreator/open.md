const STRICT_MERMAID_OPTIONS = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
});

let mermaidModulePromise = null;
let mermaidRenderQueue = Promise.resolve();
let mermaidRequestRevision = 0;

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid')
      .then(({ default: mermaid }) => mermaid)
      .catch((error) => {
        mermaidModulePromise = null;
        throw error;
      });
  }
  return mermaidModulePromise;
}

function enqueueMermaidRender(operation) {
  const queuedOperation = mermaidRenderQueue.then(operation);
  mermaidRenderQueue = queuedOperation.catch(() => undefined);
  return queuedOperation;
}

function getMermaidTheme(theme) {
  return theme === 'dark' ? 'dark' : 'default';
}

async function configureMermaid(theme, reset) {
  const mermaid = await loadMermaid();
  if (reset) mermaid.reset?.();
  mermaid.initialize({
    ...STRICT_MERMAID_OPTIONS,
    theme: getMermaidTheme(theme),
  });
  return mermaid;
}

function captureDiagramSource(diagram) {
  if (!diagram.dataset.mermaidSource) {
    diagram.dataset.mermaidSource = diagram.textContent || '';
  }
  return diagram.dataset.mermaidSource;
}

function isCurrentTarget(container, diagram) {
  if (diagram.isConnected === false) return false;
  return typeof container?.contains !== 'function' || container.contains(diagram);
}

export async function prepareMermaidDiagrams(
  container,
  { reset = false, theme = 'default' } = {}
) {
  const diagrams = [...(container?.querySelectorAll?.('.mermaid') || [])];
  if (diagrams.length === 0) return null;

  const requestRevision = ++mermaidRequestRevision;
  const resolvedTheme = getMermaidTheme(theme);
  const sources = diagrams.map(captureDiagramSource);

  return enqueueMermaidRender(async () => {
    if (requestRevision !== mermaidRequestRevision) return null;

    const mermaid = await configureMermaid(resolvedTheme, reset);
    if (requestRevision !== mermaidRequestRevision) return null;

    const renderResults = [];
    for (let index = 0; index < diagrams.length; index += 1) {
      const result = await mermaid.render(
        `openmd-mermaid-${requestRevision}-${index}`,
        sources[index]
      );
      if (requestRevision !== mermaidRequestRevision) return null;
      renderResults.push(result);
    }

    let committed = false;
    return Object.freeze({
      theme: resolvedTheme,
      count: diagrams.length,
      commit() {
        if (committed || requestRevision !== mermaidRequestRevision) return false;
        if (!diagrams.every((diagram) => isCurrentTarget(container, diagram))) return false;

        diagrams.forEach((diagram, index) => {
          diagram.innerHTML = renderResults[index].svg;
          diagram.dataset.processed = 'true';
          diagram.dataset.mermaidTheme = resolvedTheme;
        });
        diagrams.forEach((diagram, index) => {
          try {
            renderResults[index].bindFunctions?.(diagram);
          } catch (error) {
            console.warn('Could not bind Mermaid diagram interactions:', error);
          }
        });
        committed = true;
        return true;
      },
    });
  });
}

export async function renderMermaidDiagrams(container, options = {}) {
  const prepared = await prepareMermaidDiagrams(container, options);
  return prepared?.commit() || false;
}

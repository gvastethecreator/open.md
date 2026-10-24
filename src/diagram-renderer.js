const MOUNT_OPTIONS = Object.freeze({
  zoom: false,
  images: false,
  linkSchemes: ['http', 'https', 'mailto'],
});

const READABLE_KINDS = Object.freeze({
  flowchart: 'Flowchart',
  sequence: 'Sequence diagram',
  class: 'Class diagram',
  state: 'State diagram',
  er: 'Entity relationship diagram',
  gantt: 'Gantt diagram',
  gitGraph: 'Git graph',
  journey: 'Journey diagram',
  timeline: 'Timeline',
  mindmap: 'Mind map',
  pie: 'Pie chart',
});

const mounts = new Set();
let pelePromise = null;

function loadPele() {
  if (!pelePromise) {
    pelePromise = import('pele/lazy').catch((error) => {
      pelePromise = null;
      throw error;
    });
  }
  return pelePromise;
}

function captureSource(diagram) {
  if (!diagram.dataset.mermaidSource) {
    diagram.dataset.mermaidSource = diagram.textContent || '';
  }
  return diagram.dataset.mermaidSource;
}

function decorateDiagram(diagram, type, index) {
  const readable = READABLE_KINDS[type] || 'Diagram';
  diagram.dataset.processed = 'true';
  diagram.dataset.mermaidKind = type || '';
  diagram.tabIndex = 0;
  diagram.setAttribute?.('role', 'region');
  diagram.setAttribute?.('aria-label', `${readable} ${index + 1}`);
}

export async function renderDiagrams(container, { isCurrent = () => true } = {}) {
  const all = [...(container?.querySelectorAll?.('.mermaid') || [])];
  const diagrams = all.filter((diagram) => (
    !diagram.dataset.mermaidPending && !diagram.dataset.processed
  ));
  if (diagrams.length === 0) return false;

  // Claim before the first await so an overlapping call skips these diagrams.
  diagrams.forEach((diagram) => { diagram.dataset.processed = 'pending'; });
  const sources = diagrams.map(captureSource);
  let failures = 0;
  let mountedCount = 0;

  try {
    const { mountAsync } = await loadPele();
    for (let index = 0; index < diagrams.length; index += 1) {
      const diagram = diagrams[index];
      if (!isCurrent() || diagram.isConnected === false) break;
      const mounted = await mountAsync(diagram, sources[index], MOUNT_OPTIONS);
      if (!isCurrent()) {
        mounted?.destroy?.();
        break;
      }
      mounts.add(mounted);
      mountedCount += 1;
      if (mounted?.error) {
        diagram.dataset.processed = 'error';
        failures += 1;
        continue;
      }
      decorateDiagram(diagram, mounted?.result?.type, all.indexOf(diagram));
    }
  } finally {
    diagrams.forEach((diagram) => {
      if (diagram.dataset.processed === 'pending') delete diagram.dataset.processed;
    });
  }

  if (failures > 0) {
    throw new Error(`${failures} diagram(s) could not be rendered`);
  }
  return mountedCount > 0;
}

export function disposeDiagrams() {
  for (const mounted of mounts) mounted.destroy?.();
  mounts.clear();
}

const STRICT_MERMAID_OPTIONS = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
});

const FALLBACK_PALETTES = Object.freeze({
  default: Object.freeze({
    background: '#f7f9fa',
    text: '#18212b',
    surface: '#edf1f3',
    border: '#8b979f',
    accent: '#168c91',
    quote: '#53616d',
    danger: '#b4232f',
    codeBackground: '#e3e7e9',
    syntaxString: '#12662f',
    syntaxNumber: '#9a4e16',
    syntaxTitle: '#0750a6',
    syntaxMeta: '#633da9',
  }),
  dark: Object.freeze({
    background: '#111820',
    text: '#e7edf1',
    surface: '#19232d',
    border: '#657481',
    accent: '#62c6c8',
    quote: '#9cabb7',
    danger: '#ff8f9a',
    codeBackground: '#202b35',
    syntaxString: '#8bd49c',
    syntaxNumber: '#ff9f7a',
    syntaxTitle: '#9dc9ff',
    syntaxMeta: '#d0a8ff',
  }),
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

function validColor(value, fallback) {
  return typeof value === 'string' && /^#[\da-f]{6}$/iu.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

function resolvePalette(theme, tokens = {}) {
  const fallback = FALLBACK_PALETTES[getMermaidTheme(theme)];
  const source = tokens || {};
  return Object.freeze(Object.fromEntries(
    Object.entries(fallback).map(([key, value]) => [key, validColor(source[key], value)]),
  ));
}

export function getMermaidConfig(theme = 'default', tokens = {}) {
  const palette = resolvePalette(theme, tokens);
  const fontFamily = 'Inter, "Segoe UI", Helvetica, Arial, sans-serif';
  return {
    ...STRICT_MERMAID_OPTIONS,
    theme: 'base',
    look: 'classic',
    fontFamily,
    htmlLabels: true,
    markdownAutoWrap: true,
    themeVariables: {
      background: palette.background,
      primaryColor: palette.surface,
      primaryBorderColor: palette.accent,
      primaryTextColor: palette.text,
      secondaryColor: palette.codeBackground,
      secondaryBorderColor: palette.border,
      secondaryTextColor: palette.text,
      tertiaryColor: palette.background,
      tertiaryBorderColor: palette.border,
      tertiaryTextColor: palette.text,
      mainBkg: palette.surface,
      nodeBkg: palette.surface,
      nodeBorder: palette.accent,
      nodeTextColor: palette.text,
      textColor: palette.text,
      titleColor: palette.text,
      lineColor: palette.quote,
      arrowheadColor: palette.accent,
      defaultLinkColor: palette.quote,
      edgeLabelBackground: palette.background,
      clusterBkg: palette.codeBackground,
      clusterBorder: palette.border,
      noteBkgColor: palette.codeBackground,
      noteBorderColor: palette.quote,
      noteTextColor: palette.text,
      actorBkg: palette.surface,
      actorBorder: palette.accent,
      actorTextColor: palette.text,
      actorLineColor: palette.border,
      signalColor: palette.quote,
      signalTextColor: palette.text,
      labelBoxBkgColor: palette.background,
      labelBoxBorderColor: palette.border,
      labelTextColor: palette.text,
      loopTextColor: palette.text,
      activationBkgColor: palette.codeBackground,
      activationBorderColor: palette.accent,
      sequenceNumberColor: palette.text,
      stateBkg: palette.surface,
      stateBorder: palette.accent,
      stateLabelColor: palette.text,
      transitionColor: palette.quote,
      transitionLabelColor: palette.text,
      stateEdgeLabelBackground: palette.background,
      compositeBackground: palette.codeBackground,
      compositeBorder: palette.border,
      compositeTitleBackground: palette.background,
      classText: palette.text,
      relationColor: palette.quote,
      relationLabelColor: palette.text,
      relationLabelBackground: palette.background,
      attributeBackgroundColorOdd: palette.surface,
      attributeBackgroundColorEven: palette.background,
      sectionBkgColor: palette.surface,
      altSectionBkgColor: palette.codeBackground,
      gridColor: palette.border,
      taskBkgColor: palette.surface,
      taskBorderColor: palette.accent,
      taskTextColor: palette.text,
      activeTaskBkgColor: palette.codeBackground,
      activeTaskBorderColor: palette.accent,
      doneTaskBkgColor: palette.background,
      doneTaskBorderColor: palette.border,
      critBkgColor: palette.codeBackground,
      critBorderColor: palette.danger,
      todayLineColor: palette.danger,
      git0: palette.accent,
      git1: palette.syntaxString,
      git2: palette.syntaxNumber,
      git3: palette.syntaxTitle,
      git4: palette.syntaxMeta,
      git5: palette.quote,
      git6: palette.danger,
      git7: palette.border,
      pie1: palette.accent,
      pie2: palette.syntaxString,
      pie3: palette.syntaxNumber,
      pie4: palette.syntaxTitle,
      pie5: palette.syntaxMeta,
      pie6: palette.quote,
      pie7: palette.danger,
      pieStrokeColor: palette.background,
      pieTitleTextColor: palette.text,
      pieLegendTextColor: palette.text,
      radius: 8,
      strokeWidth: '1.5px',
      fontFamily,
      fontSize: '14px',
      fontWeight: 540,
      noteFontWeight: 520,
      useGradient: false,
    },
    flowchart: {
      curve: 'basis',
      diagramPadding: 18,
      nodeSpacing: 40,
      rankSpacing: 54,
      padding: 12,
      wrappingWidth: 180,
      useMaxWidth: true,
    },
    sequence: {
      diagramMarginX: 24,
      diagramMarginY: 18,
      actorMargin: 72,
      width: 140,
      height: 44,
      boxMargin: 12,
      boxTextMargin: 6,
      noteMargin: 12,
      messageMargin: 30,
      activationWidth: 8,
      mirrorActors: false,
      bottomMarginAdj: 8,
      actorFontFamily: fontFamily,
      actorFontSize: 14,
      actorFontWeight: 580,
      useMaxWidth: true,
    },
    class: {
      diagramPadding: 18,
      nodeSpacing: 42,
      rankSpacing: 56,
      padding: 12,
      dividerMargin: 10,
      hideEmptyMembersBox: true,
      useMaxWidth: true,
    },
    state: {
      padding: 12,
      miniPadding: 6,
      nodeSpacing: 42,
      rankSpacing: 56,
      noteMargin: 12,
      radius: 8,
      useMaxWidth: true,
    },
    er: {
      diagramPadding: 18,
      layoutDirection: 'TB',
      minEntityWidth: 120,
      minEntityHeight: 70,
      entityPadding: 12,
      stroke: palette.border,
      fill: palette.surface,
      fontSize: 14,
      useMaxWidth: true,
    },
  };
}

async function configureMermaid(theme, reset, tokens) {
  const mermaid = await loadMermaid();
  if (reset) mermaid.reset?.();
  mermaid.initialize(getMermaidConfig(theme, tokens));
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

function getDiagramKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (/^(?:graph|flowchart)|flowchart/u.test(normalized)) return 'flowchart';
  if (normalized.includes('sequence')) return 'sequence';
  if (normalized.includes('statediagram') || normalized === 'state') return 'state';
  if (normalized.includes('classdiagram') || normalized === 'class') return 'class';
  if (normalized.includes('erdiagram') || normalized === 'er') return 'entity';
  if (normalized.includes('gantt')) return 'gantt';
  if (normalized.includes('gitgraph')) return 'git';
  if (normalized.includes('journey')) return 'journey';
  if (normalized.includes('timeline')) return 'timeline';
  if (normalized.includes('mindmap')) return 'mindmap';
  if (normalized.includes('pie')) return 'pie';
  return 'diagram';
}

function decorateDiagram(diagram, kind, index) {
  diagram.dataset.mermaidKind = kind;
  diagram.dataset.mermaidPalette = 'semantic';
  const readableKinds = {
    flowchart: 'Flowchart',
    sequence: 'Sequence diagram',
    state: 'State diagram',
    class: 'Class diagram',
    entity: 'Entity relationship diagram',
    gantt: 'Gantt diagram',
    git: 'Git graph',
    journey: 'Journey diagram',
    timeline: 'Timeline',
    mindmap: 'Mind map',
    pie: 'Pie chart',
    diagram: 'Diagram',
  };
  const accessibleLabel = `${readableKinds[kind] || readableKinds.diagram} ${index + 1}`;
  diagram.tabIndex = 0;
  diagram.setAttribute?.('role', 'region');
  diagram.setAttribute?.('aria-label', accessibleLabel);
  const svg = diagram.querySelector?.('svg');
  if (!svg) return;
  svg.classList?.add('openmd-mermaid-svg');
  svg.setAttribute?.('preserveAspectRatio', 'xMidYMid meet');
  svg.dataset.diagramKind = kind;
  if (!svg.hasAttribute?.('aria-label') && !svg.hasAttribute?.('aria-labelledby')) {
    svg.setAttribute?.('aria-label', accessibleLabel);
  }
}

export async function prepareMermaidDiagrams(
  container,
  { reset = false, theme = 'default', tokens = null } = {}
) {
  const diagrams = [...(container?.querySelectorAll?.('.mermaid') || [])];
  if (diagrams.length === 0) return null;

  const requestRevision = ++mermaidRequestRevision;
  const resolvedTheme = getMermaidTheme(theme);
  const sources = diagrams.map(captureDiagramSource);

  return enqueueMermaidRender(async () => {
    if (requestRevision !== mermaidRequestRevision) return null;

    const mermaid = await configureMermaid(resolvedTheme, reset, tokens);
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
          decorateDiagram(
            diagram,
            getDiagramKind(renderResults[index].diagramType || sources[index]),
            index,
          );
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

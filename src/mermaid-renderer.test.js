import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  importCalls: 0,
  rejectNextImport: false,
  mermaid: {
    initialize: vi.fn(),
    reset: vi.fn(),
    render: vi.fn(async (id, source) => ({
      svg: `<svg data-id="${id}"><text>${source}</text></svg>`,
      bindFunctions: vi.fn(),
    })),
  },
}));

let prepareMermaidDiagrams;
let renderMermaidDiagrams;

function createContainer(diagrams = []) {
  return {
    querySelectorAll: vi.fn(() => diagrams),
    contains: vi.fn((candidate) => diagrams.includes(candidate)),
  };
}

function createDiagram(source = 'graph TD; A-->B') {
  return {
    dataset: {},
    textContent: source,
    innerHTML: source,
    isConnected: true,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  testState.importCalls = 0;
  testState.rejectNextImport = false;
  testState.mermaid.render.mockImplementation(async (id, source) => ({
    svg: `<svg data-id="${id}"><text>${source}</text></svg>`,
    bindFunctions: vi.fn(),
  }));
  vi.doMock('mermaid', () => {
    testState.importCalls += 1;
    if (testState.rejectNextImport) {
      testState.rejectNextImport = false;
      throw new Error('Mermaid import failed');
    }
    return { default: testState.mermaid };
  });
  ({ prepareMermaidDiagrams, renderMermaidDiagrams } = await import('./mermaid-renderer.js'));
});

describe('mermaid renderer boundary', () => {
  it('does not initialize Mermaid when there are no diagrams', async () => {
    await expect(renderMermaidDiagrams(createContainer())).resolves.toBe(false);

    expect(testState.importCalls).toBe(0);
    expect(testState.mermaid.initialize).not.toHaveBeenCalled();
    expect(testState.mermaid.render).not.toHaveBeenCalled();
  });

  it('loads Mermaid lazily and keeps strict rendering options', async () => {
    const diagram = createDiagram();

    await expect(renderMermaidDiagrams(createContainer([diagram]), { theme: 'dark' })).resolves.toBe(true);

    expect(testState.importCalls).toBe(1);
    expect(testState.mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    });
    expect(testState.mermaid.render).toHaveBeenCalledWith(
      expect.stringMatching(/^openmd-mermaid-\d+-0$/),
      'graph TD; A-->B'
    );
    expect(diagram.dataset.mermaidSource).toBe('graph TD; A-->B');
    expect(diagram.dataset.mermaidTheme).toBe('dark');
    expect(diagram.innerHTML).toContain('<svg');
  });

  it('prepares replacement SVGs without touching the visible diagram', async () => {
    const diagram = createDiagram();
    diagram.innerHTML = '<svg data-old="true"></svg>';
    diagram.dataset.mermaidSource = 'graph TD; A-->B';

    const prepared = await prepareMermaidDiagrams(
      createContainer([diagram]),
      { reset: true, theme: 'dark' }
    );

    expect(diagram.innerHTML).toBe('<svg data-old="true"></svg>');
    expect(testState.mermaid.reset).toHaveBeenCalledOnce();
    expect(prepared.theme).toBe('dark');
    expect(prepared.commit()).toBe(true);
    expect(diagram.innerHTML).toContain('graph TD; A-->B');
    expect(prepared.commit()).toBe(false);
  });

  it('caches a successful Mermaid module load', async () => {
    await renderMermaidDiagrams(createContainer([createDiagram('graph TD; A-->B')]));
    await renderMermaidDiagrams(createContainer([createDiagram('graph TD; C-->D')]));

    expect(testState.importCalls).toBe(1);
  });

  it('serializes singleton configuration and makes an older prepared result stale', async () => {
    const events = [];
    let releaseFirstRender;
    let firstRenderStarted;
    const firstRenderReady = new Promise((resolve) => {
      firstRenderStarted = resolve;
    });

    testState.mermaid.initialize.mockImplementation(({ theme }) => events.push(`initialize:${theme}`));
    testState.mermaid.reset.mockImplementation(() => events.push('reset'));
    testState.mermaid.render.mockImplementation((id, source) => {
      const renderNumber = testState.mermaid.render.mock.calls.length;
      events.push(`render:start:${renderNumber}`);
      if (renderNumber === 1) {
        firstRenderStarted();
        return new Promise((resolve) => {
          releaseFirstRender = () => {
            events.push('render:end:1');
            resolve({ svg: `<svg>${source}</svg>` });
          };
        });
      }
      events.push(`render:end:${renderNumber}`);
      return Promise.resolve({ svg: `<svg>${source}</svg>` });
    });

    const firstDiagram = createDiagram('graph TD; A-->B');
    const first = prepareMermaidDiagrams(createContainer([firstDiagram]), { theme: 'default' });
    await firstRenderReady;
    const secondDiagram = createDiagram('graph TD; C-->D');
    const second = prepareMermaidDiagrams(
      createContainer([secondDiagram]),
      { reset: true, theme: 'dark' }
    );
    releaseFirstRender();

    await expect(first).resolves.toBeNull();
    const preparedSecond = await second;
    expect(preparedSecond.commit()).toBe(true);
    expect(events).toEqual([
      'initialize:default',
      'render:start:1',
      'render:end:1',
      'reset',
      'initialize:dark',
      'render:start:2',
      'render:end:2',
    ]);
  });

  it('coalesces queued theme bursts to the latest requested preparation', async () => {
    const first = createDiagram('graph TD; A-->B');
    const second = createDiagram('graph TD; C-->D');
    const third = createDiagram('graph TD; E-->F');

    const results = await Promise.all([
      prepareMermaidDiagrams(createContainer([first]), { reset: true, theme: 'default' }),
      prepareMermaidDiagrams(createContainer([second]), { reset: true, theme: 'dark' }),
      prepareMermaidDiagrams(createContainer([third]), { reset: true, theme: 'default' }),
    ]);

    expect(results.slice(0, 2)).toEqual([null, null]);
    expect(testState.mermaid.render).toHaveBeenCalledTimes(1);
    expect(results[2].commit()).toBe(true);
    expect(third.dataset.mermaidTheme).toBe('default');
  });

  it('refuses to commit into a document that has been replaced', async () => {
    const diagram = createDiagram();
    const container = createContainer([diagram]);
    const prepared = await prepareMermaidDiagrams(container, { theme: 'dark' });
    diagram.isConnected = false;

    expect(prepared.commit()).toBe(false);
    expect(diagram.innerHTML).toBe('graph TD; A-->B');
  });

  it('clears a failed import so the next render retries successfully', async () => {
    testState.rejectNextImport = true;

    await expect(renderMermaidDiagrams(createContainer([createDiagram()]))).rejects.toThrow(/mocking a module/);
    await expect(renderMermaidDiagrams(createContainer([createDiagram()]))).resolves.toBe(true);

    expect(testState.importCalls).toBe(2);
  });

  it('keeps the render queue usable after a failed operation', async () => {
    let renderCount = 0;
    testState.mermaid.render.mockImplementation(async (_id, source) => {
      renderCount += 1;
      if (renderCount === 1) throw new Error('Mermaid render failed');
      return { svg: `<svg>${source}</svg>` };
    });

    await expect(
      renderMermaidDiagrams(createContainer([createDiagram('graph TD; A-->B')]))
    ).rejects.toThrow('Mermaid render failed');
    await expect(
      renderMermaidDiagrams(createContainer([createDiagram('graph TD; C-->D')]))
    ).resolves.toBe(true);
  });
});

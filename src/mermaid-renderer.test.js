import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  importCalls: 0,
  rejectNextImport: false,
  mermaid: {
    initialize: vi.fn(),
    reset: vi.fn(),
    run: vi.fn(),
  },
}));

let renderMermaidDiagrams;

function createContainer(diagrams = []) {
  return {
    querySelectorAll: vi.fn(() => diagrams),
  };
}

function createDiagram(source = 'graph TD; A-->B') {
  return {
    dataset: {},
    textContent: source,
    removeAttribute: vi.fn(),
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  testState.importCalls = 0;
  testState.rejectNextImport = false;
  vi.doMock('mermaid', () => {
    testState.importCalls += 1;
    if (testState.rejectNextImport) {
      testState.rejectNextImport = false;
      throw new Error('Mermaid import failed');
    }
    return { default: testState.mermaid };
  });
  ({ renderMermaidDiagrams } = await import('./mermaid-renderer.js'));
});

describe('mermaid renderer boundary', () => {
  it('does not initialize Mermaid when there are no diagrams', async () => {
    await expect(renderMermaidDiagrams(createContainer())).resolves.toBe(false);

    expect(testState.importCalls).toBe(0);
    expect(testState.mermaid.initialize).not.toHaveBeenCalled();
    expect(testState.mermaid.run).not.toHaveBeenCalled();
  });

  it('loads Mermaid only for diagrams and keeps strict rendering options', async () => {
    const diagram = createDiagram();

    await expect(renderMermaidDiagrams(createContainer([diagram]), { theme: 'dark' })).resolves.toBe(true);

    expect(testState.importCalls).toBe(1);
    expect(testState.mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    });
    expect(testState.mermaid.run).toHaveBeenCalledWith({ nodes: [diagram], suppressErrors: true });
    expect(diagram.dataset.mermaidSource).toBe('graph TD; A-->B');
  });

  it('caches a successful Mermaid module load', async () => {
    await renderMermaidDiagrams(createContainer([createDiagram('graph TD; A-->B')]));
    await renderMermaidDiagrams(createContainer([createDiagram('graph TD; C-->D')]));

    expect(testState.importCalls).toBe(1);
  });

  it('serializes consecutive themes without interleaving singleton operations', async () => {
    const events = [];
    let releaseFirstRun;
    let firstRunStarted;
    const firstRunReady = new Promise((resolve) => {
      firstRunStarted = resolve;
    });

    testState.mermaid.initialize.mockImplementation(({ theme }) => {
      events.push(`initialize:${theme}`);
    });
    testState.mermaid.reset.mockImplementation(() => {
      events.push('reset');
    });
    testState.mermaid.run.mockImplementation(() => {
      const runNumber = testState.mermaid.run.mock.calls.length;
      events.push(`run:start:${runNumber}`);
      if (runNumber === 1) {
        firstRunStarted();
        return new Promise((resolve) => {
          releaseFirstRun = () => {
            events.push('run:end:1');
            resolve();
          };
        });
      }
      events.push(`run:end:${runNumber}`);
      return Promise.resolve();
    });

    const first = renderMermaidDiagrams(createContainer([createDiagram('graph TD; A-->B')]), { theme: 'default' });
    const second = renderMermaidDiagrams(
      createContainer([createDiagram('graph TD; C-->D')]),
      { reset: true, theme: 'dark' }
    );

    await firstRunReady;
    expect(events).toEqual(['initialize:default', 'run:start:1']);
    releaseFirstRun();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(events).toEqual([
      'initialize:default',
      'run:start:1',
      'run:end:1',
      'reset',
      'initialize:dark',
      'run:start:2',
      'run:end:2',
    ]);
  });

  it('clears a failed import so the next render retries successfully', async () => {
    testState.rejectNextImport = true;

    await expect(renderMermaidDiagrams(createContainer([createDiagram()]))).rejects.toThrow(/mocking a module/);
    await expect(renderMermaidDiagrams(createContainer([createDiagram()]))).resolves.toBe(true);

    expect(testState.importCalls).toBe(2);
  });

  it('keeps the render queue usable after a failed operation', async () => {
    const events = [];
    let runCount = 0;
    testState.mermaid.run.mockImplementation(() => {
      runCount += 1;
      events.push(`run:${runCount}`);
      return runCount === 1
        ? Promise.reject(new Error('Mermaid render failed'))
        : Promise.resolve();
    });

    const first = renderMermaidDiagrams(createContainer([createDiagram('graph TD; A-->B')]));
    const second = renderMermaidDiagrams(createContainer([createDiagram('graph TD; C-->D')]));

    await expect(first).rejects.toThrow('Mermaid render failed');
    await expect(second).resolves.toBe(true);
    expect(events).toEqual(['run:1', 'run:2']);
  });

  it('resets diagram source before a theme rerender', async () => {
    const diagram = createDiagram();
    diagram.textContent = '<svg>old</svg>';
    diagram.dataset.mermaidSource = 'graph TD; A-->B';

    await renderMermaidDiagrams(createContainer([diagram]), { reset: true, theme: 'default' });

    expect(testState.mermaid.reset).toHaveBeenCalled();
    expect(diagram.textContent).toBe('graph TD; A-->B');
    expect(diagram.removeAttribute).toHaveBeenCalledWith('data-processed');
  });
});

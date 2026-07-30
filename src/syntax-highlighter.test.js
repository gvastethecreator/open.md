// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { highlightCodeBlocks } from './syntax-highlighter.js';

describe('syntax highlighter', () => {
  it('highlights an explicit supported language without changing its source text', () => {
    document.body.innerHTML = '<pre><code class="language-javascript">const answer = 42;</code></pre>';
    const code = document.querySelector('code');

    expect(highlightCodeBlocks(document)).toBe(true);
    expect(code.dataset.highlighted).toBe('true');
    expect(code.dataset.highlightLanguage).toBe('javascript');
    expect(code.textContent).toBe('const answer = 42;');
    expect(code.querySelectorAll('[class*="hljs-"]').length).toBeGreaterThan(0);
  });

  it('keeps unknown or unlabelled code untouched and avoids duplicate highlighting', () => {
    document.body.innerHTML = [
      '<pre><code class="language-unknown">&lt;safe&gt;</code></pre>',
      '<pre><code>plain text</code></pre>',
    ].join('');
    const [unknown, plain] = document.querySelectorAll('code');

    expect(highlightCodeBlocks(document)).toBe(false);
    expect(unknown.textContent).toBe('<safe>');
    expect(unknown.innerHTML).toBe('&lt;safe&gt;');
    expect(plain.textContent).toBe('plain text');
    expect(highlightCodeBlocks(document)).toBe(false);
    expect(document.querySelectorAll('.hljs').length).toBe(0);
  });
});

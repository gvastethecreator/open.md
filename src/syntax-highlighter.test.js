// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { highlightCodeBlocks, highlightDocument } from './syntax-highlighter.js';

describe('syntax highlighter', () => {
  it('highlights an explicit supported language without changing its source text', async () => {
    const source = 'const answer = 42; const label = "ok";';
    document.body.innerHTML = `<pre><code class="language-javascript">${source}</code></pre>`;
    const code = document.querySelector('code');

    expect(await highlightCodeBlocks(document)).toBe(true);
    expect(code.dataset.highlighted).toBe('true');
    expect(code.dataset.highlightLanguage).toBe('javascript');
    expect(code.classList.contains('syntax-highlighted')).toBe(true);
    expect(code.textContent).toBe(source);
    expect(code.querySelector('.syntax-keyword')).not.toBeNull();
    expect(code.querySelector('.syntax-string')).not.toBeNull();
    expect(code.querySelector('.syntax-number')).not.toBeNull();
    expect(code.querySelector('[style]')).toBeNull();
  });

  it('keeps unknown or unlabelled code untouched and avoids duplicate highlighting', async () => {
    document.body.innerHTML = [
      '<pre><code class="language-unknown">&lt;safe&gt;</code></pre>',
      '<pre><code>plain text</code></pre>',
    ].join('');
    const [unknown, plain] = document.querySelectorAll('code');

    expect(await highlightCodeBlocks(document)).toBe(false);
    expect(unknown.textContent).toBe('<safe>');
    expect(unknown.innerHTML).toBe('&lt;safe&gt;');
    expect(plain.textContent).toBe('plain text');
    expect(await highlightCodeBlocks(document)).toBe(false);
    expect(document.querySelectorAll('.syntax-highlighted').length).toBe(0);
  });

  it('highlights full companion documents for json and yaml', async () => {
    document.body.innerHTML = '<pre data-full-document-highlight="true"><code>{"ok":true}</code></pre>';
    const code = document.querySelector('code');
    expect(await highlightDocument(document.body, 'json')).toBe(true);
    expect(code.dataset.highlightLanguage).toBe('json');
    expect(code.classList.contains('syntax-highlighted')).toBe(true);
    expect(code.textContent).toBe('{"ok":true}');
    expect(code.querySelector('[style]')).toBeNull();

    document.body.innerHTML = '<pre data-full-document-highlight="true"><code>a: 1</code></pre>';
    expect(await highlightDocument(document.body, 'yaml')).toBe(true);
    expect(document.querySelector('code').dataset.highlightLanguage).toBe('yaml');
    const large = 'a: 1\n'.repeat(60000);
    document.body.innerHTML = '<pre data-full-document-highlight="true"><code></code></pre>';
    document.querySelector('code').textContent = large;
    expect(await highlightDocument(document.body, 'yaml')).toBe(false);
    expect(document.querySelector('code').textContent).toBe(large);
    expect(document.querySelector('.syntax-highlighted')).toBeNull();
  });

  it('returns false for unsupported full-document languages without throwing', async () => {
    document.body.innerHTML = '<pre><code>a,b,c</code></pre>';
    expect(await highlightDocument(document.body, 'csv')).toBe(false);
    expect(await highlightDocument(document.body, null)).toBe(false);
  });

  it('colors TOML keys and strings and resolves env to dotenv', async () => {
    document.body.innerHTML = '<pre data-full-document-highlight="true"><code>name = "harbor"</code></pre>';
    expect(await highlightDocument(document.body, 'toml')).toBe(true);
    const toml = document.querySelector('code');
    expect(toml.querySelector('.syntax-property')).not.toBeNull();
    expect(toml.querySelector('.syntax-string').textContent).toContain('harbor');

    document.body.innerHTML = '<pre><code class="language-env">PORT=1\nNAME="harbor"</code></pre>';
    expect(await highlightCodeBlocks(document.body)).toBe(true);
    const env = document.querySelector('code');
    expect(env.dataset.highlightLanguage).toBe('dotenv');
    expect(env.querySelector('.syntax-property')).not.toBeNull();
    expect(env.querySelector('.syntax-string').textContent).toContain('harbor');
  });

  it('keeps CRLF source text exact', async () => {
    const source = 'a = 1\r\nb = "x"\r\n';
    document.body.innerHTML = '<pre data-full-document-highlight="true"><code></code></pre>';
    const code = document.querySelector('code');
    code.textContent = source;
    expect(await highlightDocument(document.body, 'toml')).toBe(true);
    expect(code.textContent).toBe(source);
  });

  it('stops after the first slice when the document is no longer current', async () => {
    const source = Array.from({ length: 120 }, (_, index) => `const value${index} = ${index};`).join('\n');
    document.body.innerHTML = '<pre><code class="language-javascript"></code></pre>';
    const code = document.querySelector('code');
    code.textContent = source;
    const before = code.innerHTML;
    let checks = 0;

    expect(await highlightCodeBlocks(document.body, {
      isCurrent() {
        checks += 1;
        return false;
      },
    })).toBe(false);
    expect(checks).toBe(1);
    expect(code.innerHTML).toBe(before);
    expect(code.textContent).toBe(source);
    expect(code.dataset.highlighted).toBeUndefined();
    expect(code.querySelector('[style]')).toBeNull();
  });
});

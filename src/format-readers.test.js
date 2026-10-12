import { describe, expect, it } from 'vitest';
import {
  buildCompanionReadHtml,
  renderCsvRead,
  renderJsonRead,
  renderStructuredTextRead,
} from './format-readers.js';

describe('format readers', () => {
  it('renders valid JSON as a collapsible tree (F5)', () => {
    const result = renderJsonRead('{"name":"open","tags":[1,2]}');
    expect(result.mode).toBe('rich');
    expect(result.html).toContain('json-collapsible');
    expect(result.html).toContain('json-key');
    expect(result.html).toContain('name');
    expect(result.warning).toBeNull();
  });

  it.each(['object', 'array', 'nested'])('caps the entire generated JSON %s tree', (shape) => {
    const values = Array.from({ length: 50 }, (_, index) => index);
    const input = shape === 'object' ? Object.fromEntries(values.map((n) => [`k${n}`, n]))
      : shape === 'nested' ? { items: values, later: values } : values;
    const result = renderJsonRead(JSON.stringify(input), { nodeCap: 8 });
    expect(result.mode).toBe('rich');
    expect(result.truncated).toBe(true);
    expect(result.warning).toMatch(/first 8/i);
    expect(result.html).toContain('json-truncated');
    expect(result.html.match(/class="json-item"/g)).toHaveLength(7);
    expect(result.html.match(/class="json-truncated"/g)).toHaveLength(1);
    expect(result.html).toContain('<span class="json-number">0</span>');
    expect(result.html).not.toContain('<span class="json-number">49</span>');
  });

  it('degrades invalid JSON to plain with warning (F6)', () => {
    const result = renderJsonRead('{not valid');
    expect(result.mode).toBe('plain');
    expect(result.warning).toMatch(/Invalid JSON/i);
    expect(result.html).toContain('data-plain-text="true"');
    expect(result.html).toContain('{not valid');
    const large = renderJsonRead('{'.repeat(2 * 1024 * 1024) + 'UNSHOWN');
    expect(large.truncated).toBe(true);
    expect(large.warning).toContain('first 262144 characters');
    expect(large.html).not.toContain('UNSHOWN');
  });

  it('renders CSV tables and caps large row counts (F7)', () => {
    const lines = ['a,b', ...Array.from({ length: 20 }, (_, i) => `${i},x`)];
    const small = renderCsvRead(lines.join('\n'), { rowCap: 5 });
    expect(small.mode).toBe('rich');
    expect(small.truncated).toBe(true);
    expect(small.warning).toMatch(/first 5/i);
    expect(small.html).toContain('format-read-table');
    expect(small.html).toContain('<th');
  });

  it('renders INI/YAML-family structure with sections', () => {
    const result = renderStructuredTextRead('[main]\nfoo=bar\n# c\n', { format: 'ini' });
    expect(result.mode).toBe('rich');
    expect(result.html).toContain('struct-section');
    expect(result.html).toContain('struct-key');
    expect(result.html).toContain('foo');
    const capped = renderStructuredTextRead('key=value\n'.repeat(501));
    expect(capped.truncated).toBe(true);
    expect(capped.warning).toMatch(/first 500/i);
    expect(capped.html.match(/class="struct-kv"/g)).toHaveLength(500);
    const yaml = renderStructuredTextRead('parent:\n  child: value\n    deeper: yes', { format: 'yaml' });
    expect(yaml.html).toContain('padding-inline-start: 2ch');
    expect(yaml.html).toContain('padding-inline-start: 4ch');
    expect(renderStructuredTextRead('[[bin]]\nname="app"', { format: 'toml' }).html)
      .toContain('<h3 class="struct-section">bin</h3>');
  });

  it('routes companions through buildCompanionReadHtml', () => {
    expect(buildCompanionReadHtml('{"a":1}', 'json').mode).toBe('rich');
    expect(buildCompanionReadHtml('a,b\n1,2', 'csv').mode).toBe('rich');
    expect(buildCompanionReadHtml('k=v', 'env').mode).toBe('rich');
  });
});

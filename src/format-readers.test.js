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

  it('degrades invalid JSON to plain with warning (F6)', () => {
    const result = renderJsonRead('{not valid');
    expect(result.mode).toBe('plain');
    expect(result.warning).toMatch(/Invalid JSON/i);
    expect(result.html).toContain('data-plain-text="true"');
    expect(result.html).toContain('{not valid');
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
  });

  it('routes companions through buildCompanionReadHtml', () => {
    expect(buildCompanionReadHtml('{"a":1}', 'json').mode).toBe('rich');
    expect(buildCompanionReadHtml('a,b\n1,2', 'csv').mode).toBe('rich');
    expect(buildCompanionReadHtml('k=v', 'env').mode).toBe('rich');
  });
});

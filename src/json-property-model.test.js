import { describe, expect, it } from 'vitest';
import {
  parseJsonPropertyModel,
  removeJsonProperty,
  updateJsonPropertyModel,
} from './json-property-model.js';

describe('json property model', () => {
  it('renames keys and changes scalar types without accepting duplicate or unsafe names', () => {
    const model = parseJsonPropertyModel('{"newKey":"","used":true}');
    const renamed = updateJsonPropertyModel(model, 'newKey', '8080', { key: 'port', type: 'number' });
    expect(JSON.parse(renamed.source)).toEqual({ port: 8080, used: true });
    for (const key of ['used', '', '__proto__']) {
      expect(updateJsonPropertyModel(model, 'newKey', '', { key }).ok).toBe(false);
    }
    expect(updateJsonPropertyModel(model, 'newKey', '123456789012345678901', { type: 'number' }).ok).toBe(false);
  });

  it('parses objects into top-level rows and round-trips edits (F15)', () => {
    const source = '{\n  "name": "open.md",\n  "count": 2\n}\n';
    const model = parseJsonPropertyModel(source);
    expect(model.ok).toBe(true);
    expect(model.rootType).toBe('object');
    expect(model.keyCount).toBe(2);
    expect(model.indent).toBe(2);

    const updated = updateJsonPropertyModel(model, 'count', '3');
    expect(updated.ok).toBe(true);
    expect(JSON.parse(updated.source).count).toBe(3);
    expect(updated.source.endsWith('\n')).toBe(true);
  });

  it('rejects invalid JSON and supports array roots', () => {
    expect(parseJsonPropertyModel('{').ok).toBe(false);
    const arrayModel = parseJsonPropertyModel('[1, {"a":1}]');
    expect(arrayModel.ok).toBe(true);
    expect(arrayModel.rootType).toBe('array');
    expect(arrayModel.itemCount).toBe(2);
  });

  it.each([
    '{"name":"bot","guildId":123456789012345678901,"ratio":1.50}',
    '{"id":9007199254740993}',
    '{"ratio":1.50}',
    '[{"number":1e2}]',
    '{"number":-0}',
    '{"a":1,"a":2}',
    '[{"nested":{"a":1,"\\u0061":2}}]',
    '{"__proto__":{"polluted":true}}',
    '{"nested":{"\\u005f_proto__":1}}',
  ])('rejects JSON that cannot be rebuilt safely: %s', (source) => {
    expect(parseJsonPropertyModel(source)).toEqual({ ok: false, reason: 'unsafe' });
  });

  it('allows safe numbers, repeated keys in separate objects, and literal string content', () => {
    const source = '{"a":{"id":9007199254740991},"b":{"id":1.5},"text":"123456789012345678901 __proto__ \\\"a\\\":1 \\\"a\\\":2"}';
    const model = parseJsonPropertyModel(source);
    expect(model.ok).toBe(true);
    const updated = updateJsonPropertyModel(model, 'text', 'edited');
    expect(updated.ok).toBe(true);
    expect(JSON.parse(updated.source)).toEqual({
      a: { id: 9007199254740991 }, b: { id: 1.5 }, text: 'edited',
    });
  });

  it.each([
    ['count', '9007199254740993'],
    ['count', '1.50'],
    ['nested', '{"a":1,"a":2}'],
    ['nested', '{"id":123456789012345678901}'],
    ['nested', '{"__proto__":1}'],
  ])('rejects unsafe edits to %s: %s', (path, text) => {
    const model = parseJsonPropertyModel('{"count":1,"nested":{"a":1}}');
    expect(updateJsonPropertyModel(model, path, text)).toMatchObject({ ok: false, path });
    expect(model.value.count).toBe(1);
  });

  it('removes properties without corrupting siblings', () => {
    const model = parseJsonPropertyModel('{"a":1,"b":2}');
    const next = removeJsonProperty(model, 'a');
    expect(next.ok).toBe(true);
    expect(JSON.parse(next.source)).toEqual({ b: 2 });
  });

  it('keeps nested composites as JSON text cells', () => {
    const model = parseJsonPropertyModel('{"nested":{"x":1}}');
    const row = model.rows[0];
    expect(row.composite).toBe(true);
    expect(row.text).toContain('"x"');
    const updated = updateJsonPropertyModel(model, 'nested', '{"x":2,"y":3}');
    expect(updated.ok).toBe(true);
    expect(JSON.parse(updated.source).nested).toEqual({ x: 2, y: 3 });
  });

  it('keeps string cells literal even when text looks like JSON', () => {
    const model = parseJsonPropertyModel('{"note":"plain"}');
    const updated = updateJsonPropertyModel(model, 'note', '{"looks":"like-json"}');
    expect(updated.ok).toBe(true);
    expect(JSON.parse(updated.source).note).toBe('{"looks":"like-json"}');
    expect(typeof JSON.parse(updated.source).note).toBe('string');
  });
});

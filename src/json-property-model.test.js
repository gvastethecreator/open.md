import { describe, expect, it } from 'vitest';
import {
  parseJsonPropertyModel,
  removeJsonProperty,
  serializeJsonPropertyModel,
  updateJsonPropertyModel,
} from './json-property-model.js';

describe('json property model', () => {
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

  it('removes properties without corrupting siblings', () => {
    const model = parseJsonPropertyModel('{"a":1,"b":2}');
    const next = removeJsonProperty(model, 'a');
    expect(next.ok).toBe(true);
    expect(JSON.parse(next.source)).toEqual({ b: 2 });
    expect(serializeJsonPropertyModel(next.model)).toContain('"b"');
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

import { describe, expect, it } from 'vitest';
import runtimeThemes from './themes.runtime.json';

const runtimeKeys = [
  'name',
  'background',
  'foreground',
  'color_02',
  'color_03',
  'color_05',
  'color_06',
  'color_07',
  'color_08',
];

describe('runtime theme payload', () => {
  it('contains the complete ordered 364-theme catalog with only consumed fields', () => {
    expect(runtimeThemes).toHaveLength(364);
    expect(runtimeThemes[0].name).toBe('3024 Day');
    expect(runtimeThemes.at(-1).name).toBe('Zenburn');
    expect(runtimeThemes.every((theme) => Object.keys(theme).join('|') === runtimeKeys.join('|'))).toBe(true);
    expect(runtimeThemes.every((theme) => runtimeKeys.every((key) => typeof theme[key] === 'string'))).toBe(true);
  });
});

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');
const sourcePath = path.join(root, 'src', 'themes.json');
const runtimePath = path.join(root, 'src', 'themes.runtime.json');
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
const expectedThemeCount = 364;

const sourceThemes = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (!Array.isArray(sourceThemes) || sourceThemes.length !== expectedThemeCount) {
  throw new Error(`Expected ${expectedThemeCount} source themes, got ${sourceThemes?.length ?? 'invalid data'}`);
}

const seenNames = new Set();
const runtimeThemes = sourceThemes.map((theme, index) => {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    throw new Error(`Theme at index ${index} must be an object`);
  }

  if (typeof theme.name !== 'string' || theme.name.trim() === '') {
    throw new Error(`Theme at index ${index} is missing a valid name`);
  }

  const normalizedName = theme.name.trim().toLowerCase();
  if (seenNames.has(normalizedName)) {
    throw new Error(`Duplicate theme name detected: ${theme.name}`);
  }
  seenNames.add(normalizedName);

  for (const key of runtimeKeys) {
    if (typeof theme[key] !== 'string' || theme[key].trim() === '') {
      throw new Error(`Theme at index ${index} is missing a valid string property: ${key}`);
    }
  }

  return Object.fromEntries(runtimeKeys.map((key) => [key, theme[key]]));
});

writeFileSync(runtimePath, `${JSON.stringify(runtimeThemes, null, 2)}\n`);
console.log(`Generated ${path.relative(root, runtimePath)} (${runtimeThemes.length} themes, ${runtimeKeys.length} fields).`);

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'src/index.html',
  'src/main.js',
  'src/styles.css',
  'src/themes.json',
  'src-tauri/tauri.conf.json'
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
}

const indexHtml = readFileSync(path.join(root, 'src/index.html'), 'utf8');
if (!indexHtml.includes('src="/main.js"')) {
  throw new Error('src/index.html must load /main.js');
}
if (!indexHtml.includes('href="styles.css"')) {
  throw new Error('src/index.html must load styles.css');
}

const themesRaw = readFileSync(path.join(root, 'src/themes.json'), 'utf8').trim();
if (!themesRaw) {
  throw new Error('src/themes.json cannot be empty');
}

let themes;
try {
  themes = JSON.parse(themesRaw);
} catch (error) {
  throw new Error(`src/themes.json is not valid JSON: ${error.message}`);
}

if (!Array.isArray(themes) || themes.length === 0) {
  throw new Error('src/themes.json must contain a non-empty array of themes');
}

const requiredThemeKeys = ['name', 'background', 'foreground'];
for (const [index, theme] of themes.entries()) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    throw new Error(`Theme at index ${index} must be an object`);
  }

  for (const key of requiredThemeKeys) {
    if (typeof theme[key] !== 'string' || theme[key].trim() === '') {
      throw new Error(`Theme at index ${index} is missing a valid string property: ${key}`);
    }
  }
}

if (!themes.some((theme) => theme.name === 'GitHub')) {
  throw new Error('src/themes.json must provide a "GitHub" theme because main.js uses it as preferred default');
}

const tauriConfig = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
if (tauriConfig?.build?.frontendDist !== '../src') {
  throw new Error('src-tauri/tauri.conf.json must keep build.frontendDist set to ../src for this static frontend setup');
}

console.log(`Frontend validation passed (${themes.length} themes found).`);

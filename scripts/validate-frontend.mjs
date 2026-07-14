import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'index.html',
  'src/main.js',
  'src/styles.css',
  'src/themes.json',
  'src/assets/favicon.svg',
  'src-tauri/tauri.conf.json'
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
}

const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
const mainJavaScript = readFileSync(path.join(root, 'src/main.js'), 'utf8');
const stylesCss = readFileSync(path.join(root, 'src/styles.css'), 'utf8');
if (!indexHtml.includes('src="/src/main.js"')) {
  throw new Error('index.html must load /src/main.js');
}
if (!indexHtml.includes('href="/src/styles.css"')) {
  throw new Error('index.html must load /src/styles.css');
}
if (!indexHtml.includes('href="/src/assets/favicon.svg"')) {
  throw new Error('index.html must load /src/assets/favicon.svg as favicon');
}

const requiredAccessibleControls = [
  'id="empty-open-button"',
  'id="toolbar-open-button"',
  'id="help-toggle-button"',
  'id="close-help-button"',
  'role="status" aria-live="polite"',
];
for (const marker of requiredAccessibleControls) {
  if (!indexHtml.includes(marker)) {
    throw new Error(`index.html is missing required accessible UI marker: ${marker}`);
  }
}

if (/\sstyle\s*=/.test(indexHtml)) {
  throw new Error('index.html must not use inline style attributes');
}

if (!stylesCss.includes('box-sizing: border-box') || !stylesCss.includes('prefers-reduced-motion')) {
  throw new Error('src/styles.css must preserve global box sizing and reduced-motion support');
}

if (!mainJavaScript.includes("securityLevel: 'strict'") || !mainJavaScript.includes('getThemeTokens')) {
  throw new Error('src/main.js must preserve strict Mermaid rendering and semantic theme tokens');
}
if (!mainJavaScript.includes("invoke('get_initial_file_path')")) {
  throw new Error('src/main.js must preserve the native launch-path handoff');
}
if (!mainJavaScript.includes('MAX_LOCAL_IMAGES') || !mainJavaScript.includes('IMAGE_LOAD_CONCURRENCY')) {
  throw new Error('src/main.js must keep local image loading bounded');
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
const seenThemeNames = new Set();
for (const [index, theme] of themes.entries()) {
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
    throw new Error(`Theme at index ${index} must be an object`);
  }

  for (const key of requiredThemeKeys) {
    if (typeof theme[key] !== 'string' || theme[key].trim() === '') {
      throw new Error(`Theme at index ${index} is missing a valid string property: ${key}`);
    }
  }

  const normalizedName = theme.name.trim().toLowerCase();
  if (seenThemeNames.has(normalizedName)) {
    throw new Error(`Duplicate theme name detected: ${theme.name}`);
  }

  seenThemeNames.add(normalizedName);
}

const tauriConfig = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
if (tauriConfig?.build?.frontendDist !== '../dist') {
  throw new Error('src-tauri/tauri.conf.json must keep build.frontendDist set to ../dist for Vite build');
}

console.log(`Frontend validation passed (${themes.length} themes found).`);

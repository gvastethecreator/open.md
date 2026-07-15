import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'index.html',
  'src/main.js',
  'src/styles.css',
  'src/themes.json',
  'src/assets/openmd-icon.png',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/default.json'
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
if (!indexHtml.includes('href="/src/assets/openmd-icon.png"')) {
  throw new Error('index.html must load /src/assets/openmd-icon.png as favicon');
}

const requiredAccessibleControls = [
  'id="empty-open-button"',
  'id="toolbar-open-button"',
  'id="help-toggle-button"',
  'id="close-help-button"',
  'id="actions-toggle-button"',
  'id="reading-tools-button"',
  'id="reading-tools-panel"',
  'id="line-gutter"',
  'id="document-minimap"',
  'id="minimap-document"',
  'id="minimap-viewport"',
  'id="source-view"',
  'data-reading-tool="lineGuide"',
  'data-reading-tool="minimap"',
  'data-reading-tool="source"',
  'data-reading-tool="stats"',
  'id="status-context"',
  'id="window-minimize-button"',
  'id="window-maximize-button"',
  'id="window-close-button"',
  'data-tauri-drag-region',
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
if (!stylesCss.includes('--toolbar-height: 30px') || !stylesCss.includes('--motion-ease-out: cubic-bezier')) {
  throw new Error('src/styles.css must preserve the minimal status bar and semantic easing tokens');
}
if (!stylesCss.includes('--titlebar-height: 32px') || !stylesCss.includes('filter: blur(1px)')) {
  throw new Error('src/styles.css must preserve the compact custom title bar and minimap blur');
}
if (!stylesCss.includes('.reading-tools-panel') || !stylesCss.includes('.document-minimap')) {
  throw new Error('src/styles.css must include the concealed reading tools and minimap surfaces');
}
if (!stylesCss.includes('.minimap-document') || !stylesCss.includes('.minimap-viewport')) {
  throw new Error('src/styles.css must render a live document mirror with a real viewport overlay');
}
if (!stylesCss.includes('body.is-minimap .markdown-body')) {
  throw new Error('src/styles.css must reserve reading space for the opt-in minimap on narrow layouts');
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
if (
  !mainJavaScript.includes('normalizeDocumentPayload')
  || !mainJavaScript.includes('renderMinimapDocument')
  || !mainJavaScript.includes('getMinimapViewportGeometry')
  || !mainJavaScript.includes('getLineGutterLeft')
  || !mainJavaScript.includes('getStatusMetricParts')
  || !mainJavaScript.includes('getWindowControlPresentation')
) {
  throw new Error('src/main.js must preserve structured document data and measured reading-tool geometry');
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
if (tauriConfig?.app?.windows?.[0]?.decorations !== false) {
  throw new Error('src-tauri/tauri.conf.json must keep the main window undecorated');
}

const capabilities = JSON.parse(readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8'));
for (const permission of [
  'core:window:allow-toggle-maximize',
  'core:window:allow-minimize',
  'core:window:allow-close',
]) {
  if (!capabilities.permissions?.includes(permission)) {
    throw new Error(`src-tauri/capabilities/default.json is missing ${permission}`);
  }
}

console.log(`Frontend validation passed (${themes.length} themes found).`);

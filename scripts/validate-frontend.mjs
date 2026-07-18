import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'index.html',
  'src/main.js',
  'src/core/reader.js',
  'src/image-resources.js',
  'src/mermaid-renderer.js',
  'src/styles.css',
  'src/themes.json',
  'src/themes.runtime.json',
  'scripts/generate-runtime-themes.mjs',
  'src/assets/icon.png',
  'src/assets/app-icon.png',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/default.json',
  'src-tauri/src/lib.rs',
  'src-tauri/src/images.rs',
  'docs/FILE_ASSOCIATIONS.md'
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
}

const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
const mainJavaScript = readFileSync(path.join(root, 'src/main.js'), 'utf8');
const mermaidRendererJavaScript = readFileSync(path.join(root, 'src/mermaid-renderer.js'), 'utf8');
const stylesCss = readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const tauriRust = readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const imageRust = readFileSync(path.join(root, 'src-tauri/src/images.rs'), 'utf8');
const cargoManifest = readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');

function readPngInfo(relativePath) {
  const bytes = readFileSync(path.join(root, relativePath));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, signature.length).equals(signature) || bytes.length < 26) {
    throw new Error(`${relativePath} must be a valid PNG`);
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
    byteLength: bytes.length,
  };
}

const expectedPngOutputs = [
  ['src/assets/app-icon.png', 256, 256],
  ['src-tauri/icons/32x32.png', 32, 32],
  ['src-tauri/icons/128x128.png', 128, 128],
  ['src-tauri/icons/128x128@2x.png', 256, 256],
];
for (const [relativePath, expectedWidth, expectedHeight] of expectedPngOutputs) {
  const info = readPngInfo(relativePath);
  if (info.width !== expectedWidth || info.height !== expectedHeight) {
    throw new Error(`${relativePath} must be ${expectedWidth}x${expectedHeight}, got ${info.width}x${info.height}`);
  }
  if (info.colorType !== 6) {
    throw new Error(`${relativePath} must preserve an RGBA channel for transparent edges`);
  }
}
const appIconInfo = readPngInfo('src/assets/app-icon.png');
if (appIconInfo.byteLength >= 128 * 1024) {
  throw new Error('src/assets/app-icon.png must stay optimized for web use (under 128 KiB)');
}

if (!indexHtml.includes('src="/src/main.js"')) {
  throw new Error('index.html must load /src/main.js');
}
if (!indexHtml.includes('href="/src/styles.css"')) {
  throw new Error('index.html must load /src/styles.css');
}
if (!indexHtml.includes('href="/src/assets/app-icon.png"')) {
  throw new Error('index.html must load /src/assets/app-icon.png as favicon');
}
const legacyAssetName = ['openmd', 'icon.png'].join('-');
if (indexHtml.includes(legacyAssetName) || mainJavaScript.includes(legacyAssetName)) {
  throw new Error('stale legacy icon asset references must be removed');
}
const legacyProductName = ['Open', 'MD'].join('');
if ([indexHtml, tauriRust, mainJavaScript].some((source) => source.includes(legacyProductName))) {
  throw new Error('visible product branding must use open.md');
}

const requiredAccessibleControls = [
  'id="empty-open-button"',
  'id="toolbar-open-button"',
  'id="help-toggle-button"',
  'id="close-help-button"',
  'id="actions-toggle-button"',
  'id="reading-tools-button"',
  'id="reading-tools-panel"',
  'id="typography-button"',
  'id="typography-panel"',
  'id="sans-font-button"',
  'id="mono-font-button"',
  'id="always-on-top-button"',
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
if (!stylesCss.includes('.source-markup-token') || !stylesCss.includes('font-weight: 750')) {
  throw new Error('src/styles.css must distinguish Markdown markup in source mode');
}

if (
  !mermaidRendererJavaScript.includes("securityLevel: 'strict'")
  || !mermaidRendererJavaScript.includes("import('mermaid')")
  || !mainJavaScript.includes('getThemeTokens')
  || !mainJavaScript.includes("./mermaid-renderer.js")
  || !mainJavaScript.includes("./core/reader.js")
  || /from ['"]mermaid['"]/.test(mainJavaScript)
) {
  throw new Error('Mermaid must stay behind the lazy strict renderer boundary and pure reader helpers must stay deep-importable');
}
if (
  !stylesCss.includes('.typography-panel')
  || !stylesCss.includes('body.has-scroll-before .app-shell::before')
  || !stylesCss.includes('backdrop-filter: blur(1.25px)')
) {
  throw new Error('src/styles.css must preserve typography controls and conditional scroll-edge depth cues');
}
if (
  !mainJavaScript.includes("invoke('get_image_bytes'")
  || mainJavaScript.includes("invoke('get_image_data'")
  || mainJavaScript.includes('data:image')
  || !mainJavaScript.includes('ImageResourcePool')
  || !mainJavaScript.includes('IMAGE_RESOURCE_BUDGET_EXCEEDED')
) {
  throw new Error('Local images must use raw get_image_bytes IPC and bounded Blob URL resources');
}
if (
  [tauriRust, imageRust, cargoManifest].some((source) => source.includes('base64') || source.includes('get_image_data'))
  || !imageRust.includes('Response::new')
) {
  throw new Error('Rust image IPC must return raw bytes without a base64 command');
}
if (!mainJavaScript.includes("invoke('get_initial_file_path')")) {
  throw new Error('src/main.js must preserve the native launch-path handoff');
}
if (
  !mainJavaScript.includes('renderSourceContent(documentPayload.source,')
  || !mainJavaScript.includes("root.style.setProperty('--ui-accent', tokens.accent)")
  || !mainJavaScript.includes("root.style.setProperty('--accent-foreground', tokens.accentForeground)")
  || !mainJavaScript.includes('meta[name="theme-color"]')
) {
  throw new Error('src/main.js must preserve source markup emphasis and complete theme accent propagation');
}
if (
  !mainJavaScript.includes("listen('open-file-request'")
  || !mainJavaScript.includes("invoke('take_pending_open_file_requests')")
  || !mainJavaScript.includes("getCurrentWindow().label !== 'main'")
  || !tauriRust.includes('tauri::RunEvent::Opened')
  || !tauriRust.includes('take_pending_open_file_requests')
) {
  throw new Error('Native file associations must preserve queued macOS and single-instance handoff');
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
if (
  !mainJavaScript.includes('nativeWindow.setAlwaysOnTop')
  || !mainJavaScript.includes('FONT_PRESETS')
  || !mainJavaScript.includes('getScrollEdgeState')
  || !readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8')
    .includes('core:window:allow-set-always-on-top')
) {
  throw new Error('Window pinning, font presets, and scroll-edge state must stay wired through their runtime contracts');
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

const runtimeThemesRaw = readFileSync(path.join(root, 'src/themes.runtime.json'), 'utf8').trim();
let runtimeThemes;
try {
  runtimeThemes = JSON.parse(runtimeThemesRaw);
} catch (error) {
  throw new Error(`src/themes.runtime.json is not valid JSON: ${error.message}`);
}

const runtimeThemeKeys = [
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
if (!Array.isArray(runtimeThemes) || runtimeThemes.length !== themes.length) {
  throw new Error(`Runtime themes must preserve all ${themes.length} source themes`);
}
for (const [index, theme] of runtimeThemes.entries()) {
  if (Object.keys(theme).join('|') !== runtimeThemeKeys.join('|')) {
    throw new Error(`Runtime theme at index ${index} has an unexpected field set`);
  }
  for (const key of runtimeThemeKeys) {
    if (theme[key] !== themes[index][key]) {
      throw new Error(`Runtime theme drift at index ${index}, field ${key}`);
    }
  }
}

const tauriConfig = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
if (tauriConfig?.productName !== 'open.md' || tauriConfig?.app?.windows?.[0]?.title !== 'open.md') {
  throw new Error('src-tauri/tauri.conf.json must expose open.md as the visible product name');
}
if (tauriConfig?.build?.frontendDist !== '../dist') {
  throw new Error('src-tauri/tauri.conf.json must keep build.frontendDist set to ../dist for Vite build');
}
if (tauriConfig?.app?.windows?.[0]?.decorations !== false) {
  throw new Error('src-tauri/tauri.conf.json must keep the main window undecorated');
}
if (tauriConfig?.app?.withGlobalTauri !== false) {
  throw new Error('src-tauri/tauri.conf.json must keep withGlobalTauri disabled');
}
if (!tauriConfig?.app?.security?.csp?.includes('img-src') || !tauriConfig.app.security.csp.includes('blob:')) {
  throw new Error('src-tauri/tauri.conf.json must preserve the local image CSP mask');
}
const markdownAssociation = tauriConfig?.bundle?.fileAssociations?.find((association) =>
  association.ext?.includes('md') && association.ext?.includes('markdown')
);
if (markdownAssociation?.role !== 'Viewer' || markdownAssociation?.mimeType !== 'text/markdown') {
  throw new Error('src-tauri/tauri.conf.json must register Markdown files as a viewer association');
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

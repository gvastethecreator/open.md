import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pagesRoot = path.join(root, 'docs');
const pagePath = path.join(pagesRoot, 'index.html');
const cssPath = path.join(pagesRoot, 'assets', 'landing', 'site.css');
const scriptPath = path.join(pagesRoot, 'assets', 'landing', 'site.js');
const workflowPath = path.join(root, '.github', 'workflows', 'pages.yml');

const requiredFiles = [
  pagePath,
  cssPath,
  scriptPath,
  workflowPath,
  path.join(pagesRoot, '.nojekyll'),
  path.join(pagesRoot, 'PAGES.md'),
  path.join(pagesRoot, 'assets', 'landing', 'reader-desktop-dark.png'),
  path.join(pagesRoot, 'assets', 'landing', 'reader-hero-dark.png'),
  path.join(pagesRoot, 'assets', 'landing', 'reader-help-light.png'),
  path.join(pagesRoot, 'assets', 'landing', 'reader-narrow-dark.png'),
  path.join(pagesRoot, 'assets', 'landing', 'source-edit-dark.png'),
  path.join(pagesRoot, 'assets', 'landing', 'open-md-motion-study.mp4'),
];

for (const file of requiredFiles) {
  if (!existsSync(file)) throw new Error(`Missing Pages file: ${path.relative(root, file)}`);
}

const html = readFileSync(pagePath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const script = readFileSync(scriptPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

for (const marker of [
  '<main id="main">',
  'href="#main">Skip to content</a>',
  'role="tablist"',
  'role="tabpanel"',
  'controls playsinline muted preload="none"',
  'It is an illustrative composition, not a screen recording',
  'Hosted installers are not published yet',
  'https://gvastethecreator.github.io/open.md/',
]) {
  if (!html.includes(marker)) throw new Error(`Pages HTML is missing required marker: ${marker}`);
}

if (/<video[^>]*\sautoplay\b/i.test(html)) {
  throw new Error('Generated video must remain user-initiated; autoplay is not allowed');
}
if (/\sstyle\s*=/.test(html) || /<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) {
  throw new Error('Pages HTML must not contain inline styles or inline scripts');
}

const localReferences = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((reference) => !/^(?:https?:|#|mailto:|tel:)/.test(reference));

for (const reference of localReferences) {
  if (reference.startsWith('/')) {
    throw new Error(`Project Pages asset path must be relative: ${reference}`);
  }
  const cleanReference = reference.split(/[?#]/, 1)[0];
  const absolute = path.resolve(pagesRoot, cleanReference);
  if (!absolute.startsWith(`${pagesRoot}${path.sep}`) || !existsSync(absolute)) {
    throw new Error(`Broken local Pages reference: ${reference}`);
  }
}

function readPngSize(relativePath) {
  const bytes = readFileSync(path.join(pagesRoot, relativePath));
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) {
    throw new Error(`${relativePath} must be a valid PNG`);
  }
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const expectedPngSizes = new Map([
  ['assets/landing/reader-desktop-dark.png', [1440, 900]],
  ['assets/landing/reader-hero-dark.png', [960, 600]],
  ['assets/landing/reader-help-light.png', [1440, 900]],
  ['assets/landing/reader-narrow-dark.png', [480, 800]],
  ['assets/landing/source-edit-dark.png', [1440, 900]],
]);
for (const [relativePath, expected] of expectedPngSizes) {
  const actual = readPngSize(relativePath);
  if (actual[0] !== expected[0] || actual[1] !== expected[1]) {
    throw new Error(`${relativePath} must be ${expected.join('x')}, got ${actual.join('x')}`);
  }
}

const videoPath = path.join(pagesRoot, 'assets', 'landing', 'open-md-motion-study.mp4');
const video = readFileSync(videoPath);
if (video.length < 12 || video.subarray(4, 8).toString('ascii') !== 'ftyp') {
  throw new Error('open-md-motion-study.mp4 must be a valid MP4 container');
}
if (statSync(videoPath).size > 5 * 1024 * 1024) {
  throw new Error('open-md-motion-study.mp4 must remain under 5 MiB for the static landing');
}

for (const marker of [':focus-visible', 'prefers-reduced-motion', 'forced-colors', 'scrollbar-color']) {
  if (!css.includes(marker)) throw new Error(`Pages CSS is missing ${marker}`);
}
for (const marker of ['ArrowRight', 'ArrowLeft', "video?.addEventListener('error'"]) {
  if (!script.includes(marker)) throw new Error(`Pages script is missing ${marker}`);
}
for (const marker of [
  'actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d',
  'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9',
  'actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128',
  'path: docs',
]) {
  if (!workflow.includes(marker)) throw new Error(`Pages workflow is missing ${marker}`);
}

console.log(`GitHub Pages validation passed (${localReferences.length} local references checked).`);

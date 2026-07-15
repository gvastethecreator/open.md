import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const distDirectory = path.join(root, 'dist');
const indexPath = path.join(distDirectory, 'index.html');
const maxInitialJavaScriptBytes = 300_000;

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  });
}

function readAsset(relativePath) {
  const normalized = relativePath.replace(/^\//, '');
  const absolutePath = path.join(distDirectory, normalized);
  if (!statSync(absolutePath).isFile()) {
    throw new Error(`Bundle references a missing asset: ${relativePath}`);
  }
  const bytes = readFileSync(absolutePath);
  return {
    relativePath: normalized,
    bytes,
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
  };
}

if (!statSync(distDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('dist/ is missing; run `bun run build` before checking the bundle');
}

const indexHtml = readFileSync(indexPath, 'utf8');
const initialAssetPaths = [
  ...indexHtml.matchAll(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/gi),
  ...indexHtml.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi),
].map((match) => match[1]);

if (initialAssetPaths.length === 0) {
  throw new Error('dist/index.html does not expose a module entrypoint');
}

const initialAssets = initialAssetPaths.map(readAsset);
const initialJavaScriptAssets = initialAssets.filter((asset) => asset.relativePath.endsWith('.js'));
const initialJavaScriptBytes = initialJavaScriptAssets.reduce((total, asset) => total + asset.rawBytes, 0);

const initialMermaidAssets = initialJavaScriptAssets.filter((asset) => /mermaid/i.test(asset.relativePath));
if (initialMermaidAssets.length > 0) {
  throw new Error(`Mermaid assets must stay deferred, but are eager/preloaded: ${initialMermaidAssets.map((asset) => asset.relativePath).join(', ')}`);
}

const initialJavaScriptText = initialJavaScriptAssets.map((asset) => asset.bytes.toString('utf8')).join('\n');
if (/\b(?:import\s+mermaid|from\s*["']mermaid["']|require\(\s*["']mermaid["']\s*\))/i.test(initialJavaScriptText)) {
  throw new Error('Mermaid must be loaded through a dynamic import, never an eager import');
}

if (initialJavaScriptBytes > maxInitialJavaScriptBytes) {
  throw new Error(`Initial JavaScript is ${initialJavaScriptBytes} B; limit is ${maxInitialJavaScriptBytes} B`);
}

const allAssets = listFiles(distDirectory).map((absolutePath) => {
  const bytes = readFileSync(absolutePath);
  return {
    relativePath: path.relative(distDirectory, absolutePath).replaceAll(path.sep, '/'),
    rawBytes: bytes.length,
    gzipBytes: gzipSync(bytes).length,
  };
});
const totalRawBytes = allAssets.reduce((total, asset) => total + asset.rawBytes, 0);
const totalGzipBytes = allAssets.reduce((total, asset) => total + asset.gzipBytes, 0);
const deferredJavaScriptAssets = allAssets.filter(
  (asset) => asset.relativePath.endsWith('.js') && !initialAssetPaths.includes(`/${asset.relativePath}`) && !initialAssetPaths.includes(asset.relativePath)
);
const deferredRawBytes = deferredJavaScriptAssets.reduce((total, asset) => total + asset.rawBytes, 0);
const deferredGzipBytes = deferredJavaScriptAssets.reduce((total, asset) => total + asset.gzipBytes, 0);

console.log(`Bundle total: ${totalRawBytes} B raw / ${totalGzipBytes} B gzip (${allAssets.length} assets)`);
console.log(`Initial boot JS: ${initialJavaScriptBytes} B raw / ${initialJavaScriptAssets.reduce((total, asset) => total + asset.gzipBytes, 0)} B gzip (${initialJavaScriptAssets.length} assets)`);
console.log(`Deferred JS (Mermaid graph): ${deferredRawBytes} B raw / ${deferredGzipBytes} B gzip (${deferredJavaScriptAssets.length} assets)`);

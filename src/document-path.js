/**
 * Document path and link policy: display names, relative resolution, link
 * classification, and relative image source rules.
 */

import {
  isSupportedFilePath,
  resolveDocumentFormat,
} from './format-detect.js';

export function getDisplayName(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return 'No file';
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || filePath;
}

export function isImageFilePath(filePath) {
  return resolveDocumentFormat(filePath).family === 'image';
}

function normalizeFilePath(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

export function resolveRelativeFilePath(baseFilePath, relativePath) {
  if (!baseFilePath || !relativePath) return null;

  if (/^(?:[a-z]+:)?\/\//i.test(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    return relativePath;
  }

  const normalizedBase = normalizeFilePath(baseFilePath);
  const normalizedRelative = normalizeFilePath(relativePath);
  const baseParts = normalizedBase.split('/');
  baseParts.pop();

  const resolvedParts = [...baseParts];
  for (const segment of normalizedRelative.split('/')) {
    if (!segment || segment === '.') continue;

    if (segment === '..') {
      if (resolvedParts.length > 1 || !resolvedParts[0]?.endsWith(':')) {
        resolvedParts.pop();
      }
      continue;
    }

    resolvedParts.push(segment);
  }

  return resolvedParts.join('/');
}

export function getLinkAction(href, currentDocumentPath, absoluteHref = null) {
  if (typeof href !== 'string' || href.trim() === '') {
    return { type: 'blocked' };
  }

  const trimmedHref = href.trim();
  if (trimmedHref.startsWith('#')) {
    return { type: 'anchor', href: trimmedHref };
  }

  if (/^https?:\/\//i.test(trimmedHref)) {
    return { type: 'external', href: trimmedHref };
  }

  if (trimmedHref.startsWith('//') && absoluteHref && /^https?:\/\//i.test(absoluteHref)) {
    return { type: 'external', href: absoluteHref };
  }

  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmedHref)) {
    return { type: 'blocked' };
  }

  const hashIndex = trimmedHref.indexOf('#');
  const fragment = hashIndex >= 0 ? trimmedHref.slice(hashIndex) : '';
  const pathWithoutFragment = hashIndex >= 0 ? trimmedHref.slice(0, hashIndex) : trimmedHref;
  const pathWithoutQuery = pathWithoutFragment.split('?')[0];

  let decodedPath = pathWithoutQuery;
  try {
    decodedPath = decodeURIComponent(pathWithoutQuery);
  } catch {
    return { type: 'blocked' };
  }

  const resolvedPath = resolveRelativeFilePath(currentDocumentPath, decodedPath);
  if (!resolvedPath || !isSupportedFilePath(resolvedPath)) {
    return { type: 'blocked' };
  }

  return { type: 'file', path: resolvedPath, fragment };
}

export function getImageSourcePolicy(rawSource) {
  if (typeof rawSource !== 'string' || rawSource.trim() === '') {
    return { type: 'blocked', reason: 'Image source missing' };
  }

  if (/^(?:data|blob):/i.test(rawSource)) {
    return { type: 'blocked', reason: 'Embedded image not loaded' };
  }

  if (/^(?:[a-z]+:)?\/\//i.test(rawSource)) {
    return { type: 'blocked', reason: 'Remote image not loaded' };
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(rawSource)) {
    return { type: 'blocked', reason: 'Unsupported image source' };
  }

  return { type: 'relative', source: rawSource };
}

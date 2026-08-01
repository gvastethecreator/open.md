import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import properties from 'highlight.js/lib/languages/properties';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = Object.freeze({
  bash,
  css,
  ini,
  javascript,
  json,
  markdown,
  properties,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});

Object.entries(LANGUAGES).forEach(([name, language]) => {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
});

function resolveLanguage(language) {
  if (!language || typeof language !== 'string') return null;
  const normalized = language.toLowerCase();
  // toml → ini grammar; csv has no grammar
  const alias = normalized === 'toml' ? 'ini' : normalized === 'env' ? 'properties' : normalized;
  return hljs.getLanguage(alias) ? alias : null;
}

function getCodeLanguage(code) {
  const languageClass = [...code.classList]
    .find((className) => /^(?:lang|language)-/iu.test(className));
  if (!languageClass) return null;
  const language = languageClass.replace(/^(?:lang|language)-/iu, '').toLowerCase();
  return resolveLanguage(language);
}

export function highlightCodeBlocks(container) {
  const blocks = [...(container?.querySelectorAll?.('pre code') || [])];
  let highlighted = 0;

  blocks.forEach((code) => {
    if (code.dataset.highlighted === 'true') return;
    const source = code.textContent || '';
    const language = getCodeLanguage(code);

    if (language && source.trim()) {
      code.innerHTML = hljs.highlight(source, { language, ignoreIllegals: true }).value;
      code.classList.add('hljs');
      code.dataset.highlightLanguage = language;
      highlighted += 1;
    }

    code.dataset.highlighted = 'true';
  });

  return highlighted > 0;
}

/**
 * Full-document companion highlighting for Source surface or plain Read.
 * Accepts a container element or a single code/pre node.
 */
export function highlightDocument(container, language) {
  if (!container) return false;
  const resolved = resolveLanguage(language);
  if (!resolved) return false;

  const targets = [];
  if (container.matches?.('code')) targets.push(container);
  else if (container.matches?.('pre')) {
    const code = container.querySelector('code') || container;
    targets.push(code);
  } else {
    const full = container.querySelectorAll?.(
      `pre[data-full-document-highlight] code, pre code.language-${resolved}`
    );
    if (full?.length) targets.push(...full);
    else {
      // Source view is often a raw text container without pre/code
      if (container.childElementCount === 0 && (container.textContent || '').trim()) {
        targets.push(container);
      } else {
        targets.push(...(container.querySelectorAll?.('pre code') || []));
      }
    }
  }

  let highlighted = 0;
  for (const code of targets) {
    const source = code.textContent || '';
    if (!source.trim()) continue;
    try {
      code.innerHTML = hljs.highlight(source, { language: resolved, ignoreIllegals: true }).value;
      code.classList.add('hljs');
      code.dataset.highlightLanguage = resolved;
      code.dataset.highlighted = 'true';
      highlighted += 1;
    } catch {
      // leave plain text
    }
  }
  return highlighted > 0;
}

export function isHighlightLanguageSupported(language) {
  return Boolean(resolveLanguage(language));
}

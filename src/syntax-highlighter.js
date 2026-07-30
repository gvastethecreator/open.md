import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

const LANGUAGES = Object.freeze({
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
});

Object.entries(LANGUAGES).forEach(([name, language]) => {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
});

function getCodeLanguage(code) {
  const languageClass = [...code.classList]
    .find((className) => /^(?:lang|language)-/iu.test(className));
  if (!languageClass) return null;
  const language = languageClass.replace(/^(?:lang|language)-/iu, '').toLowerCase();
  return hljs.getLanguage(language) ? language : null;
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

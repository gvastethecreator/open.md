import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from '@shikijs/langs/bash';
import css from '@shikijs/langs/css';
import dotenv from '@shikijs/langs/dotenv';
import ini from '@shikijs/langs/ini';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import markdown from '@shikijs/langs/markdown';
import properties from '@shikijs/langs/properties';
import python from '@shikijs/langs/python';
import rust from '@shikijs/langs/rust';
import sql from '@shikijs/langs/sql';
import toml from '@shikijs/langs/toml';
import typescript from '@shikijs/langs/typescript';
import xml from '@shikijs/langs/xml';
import yaml from '@shikijs/langs/yaml';

const SLICE_LINES = 100;
const MAX_SOURCE_BYTES = 256 * 1024;
const TOKENIZE_MAX_LINE_LENGTH = 20_000;
// Shiki's default 500ms limit uses wall-clock time. When it trips, the last
// token is stretched to the end of the line and later scopes get no class.
// Line length is already capped. 0 turns that limit off.
const TOKENIZE_TIME_LIMIT = 0;

const ESCAPE = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const syntaxVar = (name) => `var(--syntax-${name})`;

const COLOR_CLASS = Object.freeze({
  [syntaxVar('comment')]: 'syntax-comment',
  [syntaxVar('keyword')]: 'syntax-keyword',
  [syntaxVar('string')]: 'syntax-string',
  [syntaxVar('number')]: 'syntax-number',
  [syntaxVar('title')]: 'syntax-title',
  [syntaxVar('property')]: 'syntax-property',
  [syntaxVar('meta')]: 'syntax-meta',
  [syntaxVar('addition')]: 'syntax-addition',
  [syntaxVar('deletion')]: 'syntax-deletion',
});

const ALIASES = Object.freeze({
  env: 'dotenv',
  html: 'xml',
  xhtml: 'xml',
  svg: 'xml',
  toml: 'toml',
});

const THEME = {
  name: 'open-md',
  type: 'dark',
  settings: [
    { settings: { foreground: syntaxVar('text') } },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.quoted.docstring'],
      settings: { foreground: syntaxVar('comment'), fontStyle: 'italic' },
    },
    {
      scope: [
        'keyword',
        'storage',
        'constant.language',
        'markup.heading',
        'entity.name.section',
        'markup.underline.link',
      ],
      settings: { foreground: syntaxVar('keyword') },
    },
    {
      scope: ['string', 'string.regexp', 'markup.inline.raw', 'markup.raw', 'property.value'],
      settings: { foreground: syntaxVar('string') },
    },
    {
      scope: [
        'constant.numeric',
        'constant.character',
        'constant.other',
        'markup.list',
        'punctuation.definition.list',
      ],
      settings: { foreground: syntaxVar('number') },
    },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'entity.name.type',
        'entity.name.class',
        'support.type',
        'support.class',
        'entity.name.tag',
      ],
      settings: { foreground: syntaxVar('title') },
    },
    {
      scope: [
        'variable',
        'variable.parameter',
        'support.type.property-name',
        'support.type.vendored.property-name',
        'entity.other.attribute-name',
        'meta.object-literal.key',
        'variable.other.property',
        'keyword.other.definition.ini',
        'support.variable',
        'entity.name.tag.yaml',
      ],
      settings: { foreground: syntaxVar('property') },
    },
    {
      scope: [
        'meta.preprocessor',
        'meta.annotation',
        'meta.decorator',
        'entity.name.function.decorator',
        'meta.attribute',
        'meta.embedded.block.frontmatter',
      ],
      settings: { foreground: syntaxVar('meta') },
    },
    { scope: ['markup.inserted'], settings: { foreground: syntaxVar('addition') } },
    { scope: ['markup.deleted'], settings: { foreground: syntaxVar('deletion') } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
  ],
};

let highlighter = null;
let loadedLanguages = null;

function getHighlighter() {
  if (highlighter) return highlighter;
  highlighter = createHighlighterCoreSync({
    engine: createJavaScriptRegexEngine(),
    themes: [THEME],
    langs: [
      bash,
      css,
      dotenv,
      ini,
      javascript,
      json,
      markdown,
      properties,
      python,
      rust,
      sql,
      toml,
      typescript,
      xml,
      yaml,
    ],
  });
  loadedLanguages = new Set(highlighter.getLoadedLanguages());
  return highlighter;
}

function resolveLanguage(language) {
  if (!language || typeof language !== 'string') return null;
  const normalized = language.toLowerCase();
  const alias = ALIASES[normalized] || normalized;
  getHighlighter();
  return loadedLanguages.has(alias) ? alias : null;
}

function getCodeLanguage(code) {
  const languageClass = [...code.classList]
    .find((className) => /^(?:lang|language)-/iu.test(className));
  if (!languageClass) return null;
  return resolveLanguage(languageClass.replace(/^(?:lang|language)-/iu, ''));
}

function escapeText(text) {
  return text.replace(/[&<>]/g, (character) => ESCAPE[character]);
}

function renderToken(token) {
  const classes = [];
  const mapped = COLOR_CLASS[token.color];
  if (mapped) classes.push(mapped);
  const fontStyle = token.fontStyle || 0;
  if (fontStyle & 1) classes.push('syntax-emphasis');
  if (fontStyle & 2) classes.push('syntax-strong');
  const text = escapeText(token.content);
  return classes.length ? `<span class="${classes.join(' ')}">${text}</span>` : text;
}

async function yieldSlice() {
  const yieldNow = globalThis.scheduler?.yield;
  if (typeof yieldNow === 'function') {
    await yieldNow.call(globalThis.scheduler);
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function splitKeepingCarriageReturn(source) {
  return source.split('\n').map((line) => (
    line.endsWith('\r')
      ? { text: line.slice(0, -1), carriageReturn: true }
      : { text: line, carriageReturn: false }
  ));
}

async function paintCode(code, source, language, isCurrent) {
  const engine = getHighlighter();
  const lines = splitKeepingCarriageReturn(source);
  const parts = [];
  let grammarState;

  for (let start = 0; start < lines.length; start += SLICE_LINES) {
    const slice = lines.slice(start, start + SLICE_LINES);
    const tokens = engine.codeToTokensBase(slice.map((line) => line.text).join('\n'), {
      lang: language,
      theme: 'open-md',
      ...(grammarState ? { grammarState } : {}),
      tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
      tokenizeTimeLimit: TOKENIZE_TIME_LIMIT,
    });
    grammarState = engine.getLastGrammarState(tokens);
    parts.push(tokens.map((lineTokens, index) => {
      const body = lineTokens.map(renderToken).join('');
      return slice[index]?.carriageReturn ? `${body}&#13;` : body;
    }).join('\n'));

    await yieldSlice();
    if (!isCurrent() || !code.isConnected) return false;
  }

  code.innerHTML = parts.join('\n');
  code.classList.add('syntax-highlighted');
  code.dataset.highlightLanguage = language;
  code.dataset.highlighted = 'true';
  return true;
}

export async function highlightCodeBlocks(container, { isCurrent = () => true } = {}) {
  const blocks = [...(container?.querySelectorAll?.('pre code') || [])];
  let highlighted = 0;

  for (const code of blocks) {
    if (code.dataset.highlighted === 'true') continue;
    const source = code.textContent || '';
    const language = getCodeLanguage(code);
    if (!language || !source.trim()) {
      code.dataset.highlighted = 'true';
      continue;
    }
    if (!await paintCode(code, source, language, isCurrent)) return false;
    highlighted += 1;
  }

  return highlighted > 0;
}

export async function highlightDocument(container, language, { isCurrent = () => true } = {}) {
  if (!container) return false;
  const resolved = resolveLanguage(language);
  if (!resolved) return false;

  const targets = [];
  if (container.matches?.('code')) targets.push(container);
  else if (container.matches?.('pre')) {
    targets.push(container.querySelector('code') || container);
  } else {
    const full = container.querySelectorAll?.(
      `pre[data-full-document-highlight] code, pre code.language-${resolved}`,
    );
    if (full?.length) targets.push(...full);
    else if (container.childElementCount === 0 && (container.textContent || '').trim()) {
      targets.push(container);
    } else {
      targets.push(...(container.querySelectorAll?.('pre code') || []));
    }
  }

  let highlighted = 0;
  for (const code of targets) {
    const source = code.textContent || '';
    if (source.length >= MAX_SOURCE_BYTES || !source.trim()) continue;
    try {
      if (!await paintCode(code, source, resolved, isCurrent)) return false;
      highlighted += 1;
    } catch {
      // Leave this block as plain text. A later pass can try again.
    }
  }
  return highlighted > 0;
}

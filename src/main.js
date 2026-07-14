import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import mermaid from 'mermaid';
import allThemes from './themes.json';

let currentZoom = 1;
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const THEME_STORAGE_KEY = 'openmd-theme';
const PREFERRED_THEME_NAMES = ['Github Light', 'Github Dark', 'GitHub', 'Ayu Light', 'Ayu Dark'];
const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt'];
const MAX_LOCAL_IMAGES = 100;
const IMAGE_LOAD_CONCURRENCY = 4;

let themes = [];
let currentThemeIndex = -1;
let dragDropUnlisten = null;
let toastTimeoutId = null;
let scrollRafId = null;
let currentFilePath = null;
let isHelpVisible = false;
let focusBeforeHelp = null;
let loadRequestId = 0;

const ui = {
  content: null,
  emptyStage: null,
  helpStage: null,
  emptyOpenButton: null,
  toolbarOpenButton: null,
  helpToggleButton: null,
  closeHelpButton: null,
  helpTitle: null,
  scrollToTop: null,
  toast: null,
};

try {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
} catch (e) {
  console.error('Mermaid init error:', e);
}

function cacheElements() {
  ui.content = document.getElementById('content');
  ui.emptyStage = document.getElementById('empty-stage');
  ui.helpStage = document.getElementById('help-stage');
  ui.emptyOpenButton = document.getElementById('empty-open-button');
  ui.toolbarOpenButton = document.getElementById('toolbar-open-button');
  ui.helpToggleButton = document.getElementById('help-toggle-button');
  ui.closeHelpButton = document.getElementById('close-help-button');
  ui.helpTitle = document.getElementById('help-title');
  ui.scrollToTop = document.getElementById('scroll-to-top');
  ui.toast = document.getElementById('toast');
}

export function isSupportedFilePath(filePath) {
  return typeof filePath === 'string' && SUPPORTED_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext));
}

export function getDisplayName(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return 'No file';
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || filePath;
}

function normalizeFilePath(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;

  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return null;

  const hex = match[1].length === 3
    ? [...match[1]].map((character) => character.repeat(2)).join('')
    : match[1];

  return `#${hex.toLowerCase()}`;
}

function hexToRgb(value) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;

  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function relativeLuminance(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return null;

  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return (channels[0] * 0.2126) + (channels[1] * 0.7152) + (channels[2] * 0.0722);
}

export function getContrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);

  if (foregroundLuminance === null || backgroundLuminance === null) {
    return 1;
  }

  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHexColors(background, foreground, foregroundWeight) {
  const backgroundRgb = hexToRgb(background);
  const foregroundRgb = hexToRgb(foreground);
  if (!backgroundRgb || !foregroundRgb) return background;

  const weight = Math.min(Math.max(foregroundWeight, 0), 1);
  const channel = (backgroundValue, foregroundValue) => (
    Math.round((backgroundValue * (1 - weight)) + (foregroundValue * weight))
      .toString(16)
      .padStart(2, '0')
  );

  return `#${channel(backgroundRgb.r, foregroundRgb.r)}${channel(backgroundRgb.g, foregroundRgb.g)}${channel(backgroundRgb.b, foregroundRgb.b)}`;
}

function chooseAccessibleColor(candidates, background, minimumRatio = 4.5) {
  for (const candidate of candidates) {
    const normalized = normalizeHexColor(candidate);
    if (normalized && getContrastRatio(normalized, background) >= minimumRatio) {
      return normalized;
    }
  }

  const blackRatio = getContrastRatio('#000000', background);
  const whiteRatio = getContrastRatio('#ffffff', background);
  return blackRatio >= whiteRatio ? '#000000' : '#ffffff';
}

export function getThemeTokens(theme = {}) {
  const background = normalizeHexColor(theme.background) || '#ffffff';
  const text = chooseAccessibleColor([theme.foreground], background);
  const accent = chooseAccessibleColor(
    [theme.color_05, theme.color_06, theme.color_02, theme.color_03, text],
    background
  );
  const quote = chooseAccessibleColor([theme.color_07, theme.color_08, text], background);
  const danger = chooseAccessibleColor(['#cf222e', '#ff7b72', text], background);
  let surface = mixHexColors(background, text, 0.055);

  if (getContrastRatio(text, surface) < 4.5) {
    surface = background;
  }

  return {
    background,
    text,
    surface,
    border: mixHexColors(background, text, 0.22),
    link: accent,
    accent,
    quote,
    danger,
    shadow: isColorDark(background) ? 'rgba(0, 0, 0, 0.42)' : 'rgba(15, 23, 42, 0.16)',
  };
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

export function getViewportMode(hasFilePath, helpVisible) {
  if (helpVisible) return 'help';
  return hasFilePath ? 'content' : 'empty';
}

function updateWindowTitle(filePath = null) {
  if (isHelpVisible) {
    document.title = 'OpenMD — Help';
    return;
  }

  document.title = filePath ? `OpenMD — ${getDisplayName(filePath)}` : 'OpenMD';
}

function updateWindowUrl(filePath = null) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (filePath) {
    url.searchParams.set('file', filePath);
  } else {
    url.searchParams.delete('file');
  }

  window.history.replaceState({}, '', url);
}

function renderImageError(image, reason) {
  const message = document.createElement('span');
  message.className = 'image-error';
  message.setAttribute('role', 'status');
  const label = image.getAttribute('alt')?.trim();
  message.textContent = label ? `${label}: ${reason}` : reason;
  image.replaceWith(message);
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

async function hydrateRelativeImages(documentPath, requestId) {
  if (!ui.content || !documentPath) return;

  const images = [...ui.content.querySelectorAll('img')];
  images.slice(MAX_LOCAL_IMAGES).forEach((image) => {
    renderImageError(image, 'Image limit exceeded');
  });

  const pendingImages = images.slice(0, MAX_LOCAL_IMAGES);
  let nextImageIndex = 0;

  const hydrateNextImage = async () => {
    while (nextImageIndex < pendingImages.length) {
      const image = pendingImages[nextImageIndex];
      nextImageIndex += 1;

      const policy = getImageSourcePolicy(image.getAttribute('src'));
      if (policy.type !== 'relative') {
        renderImageError(image, policy.reason);
        continue;
      }

      image.removeAttribute('src');
      image.setAttribute('aria-busy', 'true');

      try {
        const dataUrl = await invoke('get_image_data', {
          documentPath,
          relativeSource: policy.source,
        });

        if (requestId !== loadRequestId || !image.isConnected) return;
        image.src = dataUrl;
        image.removeAttribute('aria-busy');
      } catch (error) {
        console.warn('Could not load a relative image:', error);
        if (requestId === loadRequestId && image.isConnected) {
          renderImageError(image, 'Image unavailable');
        }
      }
    }
  };

  const workerCount = Math.min(IMAGE_LOAD_CONCURRENCY, pendingImages.length);
  await Promise.all(Array.from({ length: workerCount }, hydrateNextImage));
}

export function getPreferredThemeIndex(themeList, savedThemeName = null) {
  if (!Array.isArray(themeList) || themeList.length === 0) {
    return -1;
  }

  if (savedThemeName) {
    const savedThemeIndex = themeList.findIndex(
      (theme) => theme.name.toLowerCase() === savedThemeName.toLowerCase()
    );

    if (savedThemeIndex >= 0) {
      return savedThemeIndex;
    }
  }

  for (const preferredThemeName of PREFERRED_THEME_NAMES) {
    const preferredThemeIndex = themeList.findIndex(
      (theme) => theme.name.toLowerCase() === preferredThemeName.toLowerCase()
    );

    if (preferredThemeIndex >= 0) {
      return preferredThemeIndex;
    }
  }

  return 0;
}

function populateThemeSelect() {
  const select = document.getElementById('theme-select');
  if (!select) return;
  select.innerHTML = '';
  for (let i = 0; i < themes.length; i++) {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = themes[i].name;
    if (i === currentThemeIndex) option.selected = true;
    select.appendChild(option);
  }
}
function updateThemeCopy() {
  const select = document.getElementById('theme-select');
  if (select && currentThemeIndex >= 0) {
    select.value = String(currentThemeIndex);
    select.title = `Theme: ${themes[currentThemeIndex].name}`;
  }
}
function setStatusText(text, title = text) {
  const pill = document.getElementById('status-pill');
  if (!pill) return;
  pill.textContent = text;
  pill.title = title;
}
function updateStatus(filePath = null) {
  if (isHelpVisible) {
    setStatusText('Help');
    return;
  }
  setStatusText(filePath ? getDisplayName(filePath) : 'OpenMD');
}

function syncViewportState() {
  const mode = getViewportMode(Boolean(currentFilePath), isHelpVisible);

  if (ui.emptyStage) {
    ui.emptyStage.classList.toggle('hidden', mode !== 'empty');
  }

  if (ui.helpStage) {
    ui.helpStage.classList.toggle('hidden', mode !== 'help');
  }

  if (ui.content) {
    ui.content.classList.toggle('hidden', mode !== 'content');
  }

  document.body.classList.toggle('is-help-open', mode === 'help');
  ui.helpToggleButton?.setAttribute('aria-expanded', String(mode === 'help'));
  if (ui.helpToggleButton) {
    ui.helpToggleButton.textContent = mode === 'help' ? 'Close help' : 'Help';
  }
}

function setHelpVisible(nextVisible, { manageFocus = true } = {}) {
  if (nextVisible === isHelpVisible) return;

  if (nextVisible && manageFocus) {
    focusBeforeHelp = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  isHelpVisible = nextVisible;
  syncViewportState();
  updateStatus(currentFilePath);
  updateWindowTitle(currentFilePath);

  if (!manageFocus) return;

  if (nextVisible) {
    queueMicrotask(() => ui.helpTitle?.focus());
    return;
  }

  const returnTarget = focusBeforeHelp?.isConnected
    ? focusBeforeHelp
    : ui.helpToggleButton;
  focusBeforeHelp = null;
  queueMicrotask(() => returnTarget?.focus());
}

function toggleHelp() {
  setHelpVisible(!isHelpVisible);
}

function setDragState(isActive) {
  document.body.classList.toggle('is-dragging', isActive);
}

async function initThemes() {
  try {
    themes = [...allThemes].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    let savedThemeName = null;
    try {
      savedThemeName = localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
      console.warn('Could not read the saved theme:', error);
    }
    currentThemeIndex = getPreferredThemeIndex(themes, savedThemeName);

    populateThemeSelect();
    updateThemeCopy();

    if (currentThemeIndex >= 0) {
      applyTheme(themes[currentThemeIndex], { silent: true });
    }
  } catch (error) {
    console.error('Failed to initialize themes:', error);
    showToast('Could not load themes');
  }
}

function applyTheme(theme, { silent = false } = {}) {
  if (!theme) return;

  const root = document.documentElement;
  const tokens = getThemeTokens(theme);
  root.style.setProperty('--bg-color', tokens.background);
  root.style.setProperty('--text-color', tokens.text);
  root.style.setProperty('--border-color', tokens.border);
  root.style.setProperty('--link-color', tokens.link);
  root.style.setProperty('--accent-color', tokens.accent);
  root.style.setProperty('--code-bg', tokens.surface);
  root.style.setProperty('--heading-1', tokens.text);
  root.style.setProperty('--heading-2', tokens.text);
  root.style.setProperty('--heading-3', tokens.text);
  root.style.setProperty('--heading-4', tokens.text);
  root.style.setProperty('--heading-5', tokens.text);
  root.style.setProperty('--quote-color', tokens.quote);
  root.style.setProperty('--panel-bg', tokens.surface);
  root.style.setProperty('--toolbar-bg', tokens.surface);
  root.style.setProperty('--danger-color', tokens.danger);
  root.style.setProperty('--shadow-color', tokens.shadow);

  const isDark = isColorDark(tokens.background);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark ? 'dark' : 'default' });
  } catch (e) {
    console.error('Mermaid re-init error:', e);
  }

  currentThemeIndex = themes.findIndex((item) => item.name === theme.name);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.name);
  } catch (error) {
    console.warn('Could not persist the selected theme:', error);
  }
  updateThemeCopy();

  if (!silent) {
    showToast(`Theme: ${theme.name}`);
  }

  if (currentFilePath && ui.content?.querySelector('.mermaid')) {
    renderMermaidDiagrams({ reset: true }).catch((error) => {
      console.error('Mermaid theme update error:', error);
      showToast('The diagram could not update for this theme');
    });
  }
}

export function isColorDark(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return brightness < 155;
}

function showToast(message) {
  let toast = ui.toast || document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
    ui.toast = toast;
  }
  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

function cycleTheme(direction = 1) {
  if (themes.length === 0) return;
  currentThemeIndex = (currentThemeIndex + direction + themes.length) % themes.length;
  applyTheme(themes[currentThemeIndex]);
}

function renderLoadingState(filePath) {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.setAttribute('role', 'status');
  loading.textContent = `Opening ${getDisplayName(filePath)}…`;
  ui.content.replaceChildren(loading);
}

function renderErrorState(error) {
  const panel = document.createElement('div');
  panel.className = 'error';

  const title = document.createElement('h1');
  title.textContent = 'Could not open the file';

  const message = document.createElement('p');
  message.textContent = String(error);

  const retryButton = document.createElement('button');
  retryButton.className = 'primary-button';
  retryButton.type = 'button';
  retryButton.textContent = 'Choose another file';
  retryButton.addEventListener('click', openFilePicker);

  panel.append(title, message, retryButton);
  ui.content.replaceChildren(panel);
}

function enhanceTables() {
  ui.content.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('table-scroll')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Scrollable table');
    table.before(wrapper);
    wrapper.appendChild(table);
  });
}

function enhanceCodeBlocks() {
  ui.content.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-code-btn')) return;

    const button = document.createElement('button');
    button.className = 'copy-code-btn';
    button.type = 'button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code block');
    button.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard access is unavailable');
        }
        await navigator.clipboard.writeText(code.innerText);
        button.textContent = 'Copied';
        showToast('Code copied');
      } catch (error) {
        console.error('Could not copy code:', error);
        button.textContent = 'Retry';
        showToast('Could not copy the code');
      }

      setTimeout(() => {
        button.textContent = 'Copy';
      }, 2000);
    });

    pre.appendChild(button);
  });
}

async function renderMermaidDiagrams({ reset = false } = {}) {
  if (!ui.content) return;

  const diagrams = [...ui.content.querySelectorAll('.mermaid')];
  if (diagrams.length === 0) return;

  diagrams.forEach((diagram) => {
    if (!diagram.dataset.mermaidSource) {
      diagram.dataset.mermaidSource = diagram.textContent || '';
    }

    if (reset) {
      diagram.textContent = diagram.dataset.mermaidSource;
      diagram.removeAttribute('data-processed');
    }
  });

  await mermaid.run({ nodes: diagrams, suppressErrors: true });
}

function focusLoadedContent(fragment = '') {
  window.scrollTo({ top: 0, behavior: 'auto' });

  if (fragment) {
    let fragmentId = fragment.slice(1);
    try {
      fragmentId = decodeURIComponent(fragmentId);
    } catch {
      fragmentId = '';
    }

    const fragmentTarget = fragmentId
      ? [...ui.content.querySelectorAll('[id]')].find((element) => element.id === fragmentId)
      : null;

    if (fragmentTarget) {
      fragmentTarget.setAttribute('tabindex', '-1');
      fragmentTarget.focus({ preventScroll: true });
      fragmentTarget.scrollIntoView({ block: 'start' });
      return;
    }
  }

  ui.content.focus({ preventScroll: true });
}

async function loadContent(filePath = null, { fragment = '' } = {}) {
  if (!ui.content) {
    console.error('Content element not found!');
    return;
  }

  if (!filePath) {
    const urlParams = new URLSearchParams(window.location.search);
    filePath = urlParams.get('file');
  }

  if (!filePath) {
    loadRequestId += 1;
    currentFilePath = null;
    isHelpVisible = false;
    focusBeforeHelp = null;
    ui.content.removeAttribute('aria-busy');
    ui.content.replaceChildren();
    syncViewportState();
    updateStatus();
    updateWindowTitle();
    updateWindowUrl();
    return;
  }

  const requestId = ++loadRequestId;
  currentFilePath = filePath;
  isHelpVisible = false;
  focusBeforeHelp = null;
  ui.content.setAttribute('aria-busy', 'true');
  renderLoadingState(filePath);
  syncViewportState();
  setStatusText(`Opening ${getDisplayName(filePath)}…`, getDisplayName(filePath));
  updateWindowTitle(filePath);

  try {
    const htmlContent = await invoke('get_file_content', { path: filePath });
    if (requestId !== loadRequestId) return;
    ui.content.innerHTML = htmlContent;
    ui.content.removeAttribute('aria-busy');
    updateStatus(filePath);
    updateWindowTitle(filePath);
    updateWindowUrl(filePath);

    const images = ui.content.querySelectorAll('img');
    images.forEach((img) => {
      img.setAttribute('loading', 'lazy');
    });

    await hydrateRelativeImages(filePath, requestId);
    if (requestId !== loadRequestId) return;
    enhanceTables();
    enhanceCodeBlocks();

    try {
      await renderMermaidDiagrams();
    } catch (error) {
      console.error('Mermaid render error:', error);
      showToast('One or more diagrams could not be rendered');
    }

    focusLoadedContent(fragment);
    handleScroll();
  } catch (error) {
    if (requestId !== loadRequestId) return;
    console.error('Error loading content:', error);
    ui.content.removeAttribute('aria-busy');
    updateStatus(filePath);
    updateWindowTitle(filePath);
    updateWindowUrl(filePath);
    renderErrorState(error);
    focusLoadedContent();
  }
}

function handleLinkClick(event) {
  const target = event.target instanceof Element ? event.target.closest('a') : null;
  const hrefAttribute = target?.getAttribute('href');

  if (!target || !hrefAttribute) return;

  const action = getLinkAction(hrefAttribute, currentFilePath, target.href);
  if (action.type === 'anchor') return;

  event.preventDefault();

  if (action.type === 'external') {
    openUrl(action.href).catch((error) => {
      console.error('Failed to open URL:', error);
      showToast('Could not open the external link');
    });
    return;
  }

  if (action.type === 'file') {
    loadContent(action.path, { fragment: action.fragment });
    return;
  }

  showToast('This link type is not supported');
}

export function calculateNewZoom(current, deltaY, step, min, max) {
  let next = current;
  if (deltaY < 0) {
    next = current + step;
  } else {
    next = current - step;
  }
  return Math.min(Math.max(next, min), max);
}

function setZoom(newZoom) {
  currentZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
  document.documentElement.style.setProperty('--content-scale', currentZoom.toFixed(2));
  showToast(`Zoom: ${Math.round(currentZoom * 100)}%`);
}

function handleZoom(event) {
  if (event.ctrlKey) {
    event.preventDefault();
    setZoom(calculateNewZoom(currentZoom, event.deltaY, ZOOM_STEP, MIN_ZOOM, MAX_ZOOM));
  }
}

function handleScroll() {
  if (scrollRafId) return;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    if (!ui.scrollToTop) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = document.documentElement.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    if (maxScroll > 0 && scrollTop > maxScroll * 0.5) {
      ui.scrollToTop.classList.add('show');
    } else {
      ui.scrollToTop.classList.remove('show');
    }
  });
}

function scrollToTop() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({
    top: 0,
    behavior: reduceMotion ? 'auto' : 'smooth'
  });
}

function handleKeyboard(event) {
  if (event.key === 'F1') {
    event.preventDefault();
    toggleHelp();
    return;
  }

  if (event.key === 'Escape' && isHelpVisible) {
    event.preventDefault();
    setHelpVisible(false);
    return;
  }

  if (event.ctrlKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openFilePicker();
    return;
  }

  if (event.ctrlKey && (event.key === '=' || event.key === '+')) {
    event.preventDefault();
    setZoom(currentZoom + ZOOM_STEP);
  } else if (event.ctrlKey && event.key === '-') {
    event.preventDefault();
    setZoom(currentZoom - ZOOM_STEP);
  } else if (event.ctrlKey && event.key === '0') {
    event.preventDefault();
    setZoom(1.0);
  }

  const isTypingField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)
    || event.target?.isContentEditable;
  if (!isTypingField && (event.key === 't' || event.key === 'T') && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (event.ctrlKey || event.shiftKey) {
      cycleTheme(-1);
    } else {
      cycleTheme(1);
    }
  }
}

function handleThemeSelection(event) {
  const index = parseInt(event.target.value, 10);
  if (!isNaN(index) && index >= 0 && index < themes.length) {
    applyTheme(themes[index]);
  }
}

async function handleIncomingFiles(filePaths) {
  const supportedFiles = (filePaths || []).filter(isSupportedFilePath);

  if (supportedFiles.length === 0) {
    showToast('Only .md, .markdown and .txt files are supported');
    return;
  }

  await loadContent(supportedFiles[0]);

  if (supportedFiles.length > 1) {
    for (let index = 1; index < supportedFiles.length; index += 1) {
      try {
        await invoke('open_new_window', { path: supportedFiles[index] });
      } catch (error) {
        console.error('Could not open an additional window:', error);
        showToast(`Could not open ${getDisplayName(supportedFiles[index])}`);
      }
    }

    showToast(`${supportedFiles.length} files opened`);
  }
}

async function openFilePicker() {
  try {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: 'Markdown and text',
          extensions: ['md', 'markdown', 'txt'],
        },
      ],
    });

    if (selected === null) {
      return;
    }

    await handleIncomingFiles(Array.isArray(selected) ? selected : [selected]);
  } catch (error) {
    console.error('Open dialog failed:', error);
    showToast('Could not open the file picker');
  }
}

function setupDomDragSafety() {
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  window.addEventListener('drop', (event) => {
    event.preventDefault();
  });
}

async function setupDragAndDrop() {
  setupDomDragSafety();

  try {
    dragDropUnlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === 'over') {
        setDragState(true);
        return;
      }

      if (event.payload.type === 'drop') {
        setDragState(false);
        await handleIncomingFiles(event.payload.paths);
        return;
      }

      setDragState(false);
    });
  } catch (error) {
    console.warn('Drag & drop listener unavailable in this runtime:', error);
  }
}

function registerEvents() {
  window.addEventListener('wheel', handleZoom, { passive: false });
  window.addEventListener('keydown', handleKeyboard);
  window.addEventListener('scroll', handleScroll, { passive: true });
  window.addEventListener('beforeunload', () => {
    if (typeof dragDropUnlisten === 'function') {
      dragDropUnlisten();
    }
  });
  document.addEventListener('click', handleLinkClick);

  ui.emptyOpenButton?.addEventListener('click', openFilePicker);
  ui.toolbarOpenButton?.addEventListener('click', openFilePicker);
  ui.helpToggleButton?.addEventListener('click', toggleHelp);
  ui.closeHelpButton?.addEventListener('click', () => setHelpVisible(false));
  ui.scrollToTop?.addEventListener('click', scrollToTop);
  document.getElementById('theme-select')?.addEventListener('change', handleThemeSelection);
}

async function init() {
  cacheElements();
  syncViewportState();
  registerEvents();
  await initThemes();
  const queryFilePath = new URLSearchParams(window.location.search).get('file');
  let initialFilePath = queryFilePath;

  if (!initialFilePath && window.__TAURI_INTERNALS__) {
    try {
      initialFilePath = await invoke('get_initial_file_path');
    } catch (error) {
      console.warn('Could not inspect the launch file:', error);
    }
  }

  await loadContent(initialFilePath);
  await setupDragAndDrop();
}

if (typeof window !== 'undefined' && !window.__VITEST__) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => console.error('OpenMD initialization failed:', error));
    });
  } else {
    init().catch((error) => console.error('OpenMD initialization failed:', error));
  }
}

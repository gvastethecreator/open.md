import { convertFileSrc, invoke } from '@tauri-apps/api/core';
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

let themes = [];
let currentThemeIndex = -1;
let dragDropUnlisten = null;
let toastTimeoutId = null;
let scrollRafId = null;
let currentFilePath = null;
let activeImageUrls = [];
let isHelpVisible = false;

const ui = {
  content: null,
  emptyStage: null,
  helpStage: null,
  emptyOpenArea: null,
  scrollToTop: null,
};

try {
  mermaid.initialize({ startOnLoad: false, theme: 'default' });
} catch (e) {
  console.error('Mermaid init error:', e);
}

function cacheElements() {
  ui.content = document.getElementById('content');
  ui.emptyStage = document.getElementById('empty-stage');
  ui.helpStage = document.getElementById('help-stage');
  ui.emptyOpenArea = document.getElementById('empty-open-area');
  ui.scrollToTop = document.getElementById('scroll-to-top');
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function revokeActiveImageUrls() {
  activeImageUrls.forEach((url) => URL.revokeObjectURL(url));
  activeImageUrls = [];
}

function hydrateRelativeImages() {
  if (!ui.content || !currentFilePath) return;

  revokeActiveImageUrls();

  ui.content.querySelectorAll('img').forEach((image) => {
    const rawSource = image.getAttribute('src');
    if (!rawSource || /^(?:[a-z]+:)?\/\//i.test(rawSource) || rawSource.startsWith('data:')) {
      return;
    }

    const resolvedPath = resolveRelativeFilePath(currentFilePath, rawSource);
    if (!resolvedPath) {
      return;
    }

    try {
      image.src = convertFileSrc(resolvedPath);
    } catch (error) {
      console.warn('Could not resolve a relative image:', error);
    }
  });
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
  }
}
function updateStatus(filePath = null) {
  const pill = document.getElementById('status-pill');
  if (!pill) return;
  if (isHelpVisible) {
    pill.textContent = 'Help';
    return;
  }
  pill.textContent = filePath ? getDisplayName(filePath) : 'OpenMD';
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
}

function setHelpVisible(nextVisible) {
  isHelpVisible = nextVisible;
  syncViewportState();
  updateStatus(currentFilePath);
  updateWindowTitle(currentFilePath);
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
    currentThemeIndex = getPreferredThemeIndex(themes, localStorage.getItem(THEME_STORAGE_KEY));

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
  root.style.setProperty('--bg-color', theme.background);
  root.style.setProperty('--text-color', theme.foreground);
  root.style.setProperty('--border-color', theme.color_08 || '#e1e4e8');
  root.style.setProperty('--link-color', theme.color_05 || '#0366d6');
  root.style.setProperty('--code-bg', theme.color_01 || 'rgba(27, 31, 35, 0.05)');
  root.style.setProperty('--heading-1', theme.color_02 || theme.foreground);
  root.style.setProperty('--heading-2', theme.color_03 || theme.foreground);
  root.style.setProperty('--heading-3', theme.color_04 || theme.foreground);
  root.style.setProperty('--heading-4', theme.color_05 || theme.foreground);
  root.style.setProperty('--heading-5', theme.color_06 || theme.foreground);
  root.style.setProperty('--quote-color', theme.color_07 || theme.color_08 || '#6a737d');
  root.style.setProperty('--panel-bg', isColorDark(theme.background) ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.86)');
  root.style.setProperty('--toolbar-bg', isColorDark(theme.background) ? 'rgba(13, 17, 23, 0.75)' : 'rgba(255, 255, 255, 0.82)');
  root.style.setProperty('--shadow-color', isColorDark(theme.background) ? 'rgba(0, 0, 0, 0.32)' : 'rgba(15, 23, 42, 0.14)');

  const isDark = isColorDark(theme.background);
  try {
    mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
  } catch (e) {
    console.error('Mermaid re-init error:', e);
  }

  currentThemeIndex = themes.findIndex((item) => item.name === theme.name);

  localStorage.setItem(THEME_STORAGE_KEY, theme.name);
  updateThemeCopy();

  if (!silent) {
    showToast(`Theme: ${theme.name}`);
  }
}

export function isColorDark(color) {
  if (!color) return false;
  const hex = color.replace('#', '');
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return brightness < 155;
}

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show';

  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    toast.className = 'toast';
  }, 2000);
}

function cycleTheme(direction = 1) {
  if (themes.length === 0) return;
  currentThemeIndex = (currentThemeIndex + direction + themes.length) % themes.length;
  applyTheme(themes[currentThemeIndex]);
}

async function loadContent(filePath = null) {
  if (!ui.content) {
    console.error('Content element not found!');
    return;
  }

  if (!filePath) {
    const urlParams = new URLSearchParams(window.location.search);
    filePath = urlParams.get('file');
  }

  if (!filePath) {
    currentFilePath = null;
    isHelpVisible = false;
    syncViewportState();
    updateStatus();
    updateWindowTitle();
    updateWindowUrl();
    return;
  }

  try {
    const htmlContent = await invoke('get_file_content', { path: filePath });
    currentFilePath = filePath;
    isHelpVisible = false;
    ui.content.innerHTML = htmlContent;
    syncViewportState();
    updateStatus(filePath);
    updateWindowTitle(filePath);
    updateWindowUrl(filePath);

    const images = ui.content.querySelectorAll('img');
    images.forEach((img) => {
      img.setAttribute('loading', 'lazy');
    });

    hydrateRelativeImages();

    ui.content.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code) return;

      const btn = document.createElement('button');
      btn.className = 'copy-code-btn';
      btn.textContent = 'Copy';
      btn.onclick = () => {
        navigator.clipboard.writeText(code.innerText).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
        }).catch(() => {
          btn.textContent = 'Error';
          setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
        });
      };

      pre.style.position = 'relative';
      pre.appendChild(btn);
    });

    try {
      const mermaids = ui.content.querySelectorAll('.mermaid');
      if (mermaids.length > 0) {
        await mermaid.run({
          nodes: mermaids,
        });
      }
    } catch (e) {
      console.error('Mermaid render error:', e);
    }
  } catch (error) {
    console.error('Error loading content:', error);
    currentFilePath = filePath;
    isHelpVisible = false;
    syncViewportState();
    updateStatus(filePath);
    updateWindowTitle(filePath);
    updateWindowUrl(filePath);
    ui.content.innerHTML = `
      <div class="error">
        <h1>Could not open the file</h1>
        <p>${escapeHtml(error)}</p>
      </div>
    `;
  }
}

function handleLinkClick(event) {
  const target = event.target.closest('a');
  const hrefAttribute = target?.getAttribute('href');

  if (target && hrefAttribute) {
    if (target.href.startsWith('http://') || target.href.startsWith('https://')) {
      event.preventDefault();
      openUrl(target.href).catch((err) => {
        console.error('Failed to open URL:', err);
      });
      return;
    }

    if (hrefAttribute.startsWith('#')) {
      return;
    }

    const resolvedPath = resolveRelativeFilePath(currentFilePath, hrefAttribute);
    if (resolvedPath && isSupportedFilePath(resolvedPath)) {
      event.preventDefault();
      loadContent(resolvedPath);
    }
  }
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
  document.body.style.fontSize = `${currentZoom}rem`;
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
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
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

  const isTypingField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName);
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
      await invoke('open_new_window', { path: supportedFiles[index] }).catch(console.error);
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

    revokeActiveImageUrls();
  });
  document.addEventListener('click', handleLinkClick);

  ui.emptyOpenArea?.addEventListener('click', openFilePicker);
  ui.scrollToTop?.addEventListener('click', scrollToTop);
  document.getElementById('theme-select')?.addEventListener('change', handleThemeSelection);
}

function init() {
  cacheElements();
  syncViewportState();
  registerEvents();
  initThemes();
  loadContent();
  setupDragAndDrop();
}

if (typeof window !== 'undefined' && !window.__VITEST__) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

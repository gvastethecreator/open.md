const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
import mermaid from 'mermaid';

let currentZoom = 1;
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;

let themes = [];
let currentThemeIndex = 0;

mermaid.initialize({ startOnLoad: false, theme: 'default' });

async function initThemes() {
  try {
    const response = await fetch('/themes.json');
    themes = await response.json();
    
    // Try to load saved theme
    const savedTheme = localStorage.getItem('openmd-theme');
    if (savedTheme) {
      currentThemeIndex = themes.findIndex(t => t.name === savedTheme);
      if (currentThemeIndex === -1) currentThemeIndex = 0;
    } else {
      // Find a good default, e.g., GitHub or first one
      currentThemeIndex = Math.max(0, themes.findIndex(t => t.name === 'GitHub'));
    }
    
    applyTheme(themes[currentThemeIndex]);
  } catch (error) {
    console.error('Failed to load themes:', error);
  }
}

function applyTheme(theme) {
  if (!theme) return;
  
  const root = document.documentElement;
  root.style.setProperty('--bg-color', theme.background);
  root.style.setProperty('--text-color', theme.foreground);
  root.style.setProperty('--border-color', theme.color_08 || '#e1e4e8');
  root.style.setProperty('--link-color', theme.color_05 || '#0366d6');
  root.style.setProperty('--code-bg', theme.color_01 || 'rgba(27, 31, 35, 0.05)');
  
  // Map extra colors for headings to make them visually distinct and coherent with the theme
  root.style.setProperty('--heading-1', theme.color_02 || theme.foreground);
  root.style.setProperty('--heading-2', theme.color_03 || theme.foreground);
  root.style.setProperty('--heading-3', theme.color_04 || theme.foreground);
  root.style.setProperty('--heading-4', theme.color_05 || theme.foreground);
  root.style.setProperty('--heading-5', theme.color_06 || theme.foreground);
  root.style.setProperty('--quote-color', theme.color_07 || theme.color_08 || '#6a737d');

  // Update mermaid theme based on background color brightness
  const isDark = isColorDark(theme.background);
  mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
  
  // Show theme name momentarily
  showToast(`Theme: ${theme.name}`);
  localStorage.setItem('openmd-theme', theme.name);
}

function isColorDark(color) {
  // Very basic check for dark hex colors
  const hex = color.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
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
  
  setTimeout(() => {
    toast.className = 'toast';
  }, 2000);
}

function cycleTheme() {
  if (themes.length === 0) return;
  currentThemeIndex = (currentThemeIndex + 1) % themes.length;
  applyTheme(themes[currentThemeIndex]);
}

async function loadContent(filePath = null) {
  const contentElement = document.getElementById('content');
  
  // If no path is provided, try to get it from URL params
  if (!filePath) {
    const urlParams = new URLSearchParams(window.location.search);
    filePath = urlParams.get('file');
  }

  try {
    const htmlContent = await invoke('get_file_content', { path: filePath });
    contentElement.innerHTML = htmlContent;
    
    // Lazy load images
    const images = contentElement.querySelectorAll('img');
    images.forEach(img => {
      img.setAttribute('loading', 'lazy');
    });

    // Render mermaid diagrams
    try {
      await mermaid.run({
        nodes: document.querySelectorAll('.mermaid'),
      });
    } catch (e) {
      console.error('Mermaid render error:', e);
    }
    
  } catch (error) {
    contentElement.innerHTML = `
      <div class="error">
        <h1>Error</h1>
        <p>${error}</p>
      </div>
    `;
  }
}

function setZoom(newZoom) {
  currentZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
  document.body.style.fontSize = `${currentZoom}rem`;
  showToast(`Zoom: ${Math.round(currentZoom * 100)}%`);
}

function handleZoom(event) {
  if (event.ctrlKey) {
    event.preventDefault();
    if (event.deltaY < 0) {
      setZoom(currentZoom + ZOOM_STEP);
    } else {
      setZoom(currentZoom - ZOOM_STEP);
    }
  }
}

function handleKeyboard(event) {
  // Zoom shortcuts
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
  
  // Theme shortcut (T key, but not if user is typing in an input - though we don't have inputs)
  if ((event.key === 't' || event.key === 'T') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    cycleTheme();
  }
}

// Set up drag and drop natively
function setupDragAndDrop() {
  listen('tauri://file-drop', event => {
    const files = event.payload.paths;
    if (files && files.length > 0) {
      // Load the first file in this window
      loadContent(files[0]);
      
      // If there are more files, spawn new windows using our custom command
      if (files.length > 1) {
        for (let i = 1; i < files.length; i++) {
          invoke('open_new_window', { path: files[i] }).catch(console.error);
        }
      }
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initThemes();
  loadContent();
  
  window.addEventListener('wheel', handleZoom, { passive: false });
  window.addEventListener('keydown', handleKeyboard);
  
  setupDragAndDrop();
});

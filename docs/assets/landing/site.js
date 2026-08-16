document.documentElement.classList.add('has-js');

const deferredSections = [...document.querySelectorAll('.deferred-section')];

function revealDeferredSection(index = 0) {
  deferredSections[index]?.classList.add('is-visible');
  if (index + 1 < deferredSections.length) {
    requestAnimationFrame(() => revealDeferredSection(index + 1));
  }
}

const tabs = [...document.querySelectorAll('[data-shot-tab]')];
const panels = [...document.querySelectorAll('[data-shot-panel]')];

function activateShot(targetId, { focus = false } = {}) {
  const activeIndex = tabs.findIndex((tab) => tab.dataset.shotTab === targetId);
  if (activeIndex < 0) return;

  tabs.forEach((tab, index) => {
    const selected = index === activeIndex;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  });

  panels.forEach((panel) => {
    panel.hidden = panel.id !== targetId;
  });
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateShot(tab.dataset.shotTab));
  tab.addEventListener('keydown', (event) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activateShot(tabs[nextIndex].dataset.shotTab, { focus: true });
  });
});

const videoShell = document.querySelector('[data-video-shell]');
const video = videoShell?.querySelector('video');
const videoError = videoShell?.querySelector('[data-video-error]');

video?.addEventListener('error', () => {
  video.hidden = true;
  if (videoError) videoError.hidden = false;
});

if (deferredSections.length > 0) {
  // Commit the compact first view before below-fold sections enter layout.
  void document.body.offsetHeight;
  setTimeout(() => revealDeferredSection(), 100);
}

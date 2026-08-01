/**
 * Caret trail effect inspired by qwreey/dotfiles trailCursorEffect
 * (neovide-like particle trail). Driven by caret geometry from the app, not VS Code DOM polls.
 * https://github.com/qwreey/dotfiles/blob/master/vscode/trailCursorEffect/index.js
 */

const DEFAULT_LENGTH = 7;
/** Stop the rAF loop shortly after the caret stops moving (battery / idle). */
const IDLE_STOP_MS = 220;

function createTrailEngine({ canvas, length = DEFAULT_LENGTH, style = 'line' }) {
  const context = canvas.getContext('2d');
  let particles = [];
  let cursor = { x: 0, y: 0 };
  let sizeX = 2;
  let sizeY = 18;
  let width = 0;
  let height = 0;
  let initted = false;
  let color = '#7c6af7';

  const addParticle = (x, y) => {
    particles.push({ position: { x, y } });
  };

  const move = (x, y) => {
    cursor.x = x;
    cursor.y = y;
    if (!initted) {
      initted = true;
      particles = [];
      for (let i = 0; i < length; i += 1) addParticle(x, y);
    }
  };

  const updateSize = (w, h) => {
    width = Math.max(1, Math.floor(w));
    height = Math.max(1, Math.floor(h));
    canvas.width = width;
    canvas.height = height;
  };

  const updateCursorSize = (w, h) => {
    sizeX = Math.max(1, w || 2);
    sizeY = Math.max(8, h || 18);
  };

  const setColor = (next) => {
    if (next) color = next;
  };

  const calculatePosition = () => {
    let x = cursor.x;
    let y = cursor.y;
    for (let i = 0; i < particles.length; i += 1) {
      const next = particles[i + 1] || particles[0];
      const pos = particles[i].position;
      pos.x = x;
      pos.y = y;
      x += (next.position.x - pos.x) * 0.42;
      y += (next.position.y - pos.y) * 0.35;
    }
  };

  const drawPath = () => {
    context.beginPath();
    context.fillStyle = color;
    for (let i = 0; i < particles.length; i += 1) {
      const pos = particles[i].position;
      if (i === 0) context.moveTo(pos.x, pos.y);
      else context.lineTo(pos.x, pos.y);
    }
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const pos = particles[i].position;
      context.lineTo(pos.x, pos.y + sizeY);
    }
    context.closePath();
    context.fill();
  };

  const updateParticles = () => {
    if (!initted || !context) return;
    context.clearRect(0, 0, width, height);
    calculatePosition();
    if (style === 'line') drawPath();
  };

  const reset = () => {
    particles = [];
    initted = false;
    if (context && width && height) context.clearRect(0, 0, width, height);
  };

  return { move, updateSize, updateCursorSize, updateParticles, setColor, reset };
}

export function createEditorCaretTrail({
  window,
  canvas,
  adapters = {},
}) {
  if (!window || !canvas) {
    throw new TypeError('Caret trail requires window and canvas');
  }

  let engine = null; // Trail engine | null | false (unsupported)
  let rafId = null;
  let deferredFrameTimer = null;
  let running = false;
  let visible = false;
  let disposed = false;
  let loopToken = 0;
  let idleTimer = null;

  const reduceMotion = () => Boolean(adapters.shouldReduceMotion?.());
  const documentHidden = () => Boolean(window.document?.hidden);

  const clearIdleTimer = () => {
    if (idleTimer != null) {
      window.clearTimeout?.(idleTimer);
      idleTimer = null;
    }
  };

  const clearDeferredFrame = () => {
    if (deferredFrameTimer != null) {
      window.clearTimeout?.(deferredFrameTimer);
      deferredFrameTimer = null;
    }
  };

  const scheduleIdleStop = () => {
    clearIdleTimer();
    idleTimer = window.setTimeout?.(() => {
      idleTimer = null;
      if (!disposed) stop();
    }, IDLE_STOP_MS) ?? null;
  };

  const ensureEngine = () => {
    if (engine === false) return null;
    if (engine) return engine;
    try {
      const ctx = canvas.getContext?.('2d');
      if (!ctx) {
        engine = false;
        return null;
      }
    } catch {
      engine = false;
      return null;
    }
    engine = createTrailEngine({ canvas, length: DEFAULT_LENGTH, style: 'line' });
    engine.updateSize(window.innerWidth || 1, window.innerHeight || 1);
    return engine;
  };

  const readAccent = () => {
    try {
      const value = window.getComputedStyle?.(document.documentElement)
        ?.getPropertyValue('--ui-accent')
        ?.trim();
      return value || '#7c6af7';
    } catch {
      return '#7c6af7';
    }
  };

  const loop = (token) => {
    rafId = null;
    if (
      token !== loopToken
      || disposed
      || !running
      || reduceMotion()
      || documentHidden()
      || !engine
      || engine === false
    ) {
      running = false;
      if (canvas) canvas.hidden = true;
      return;
    }
    engine.updateParticles();
    const next = loopToken;
    // Detect synchronous rAF (test mocks / broken hosts): if the callback
    // runs before this frame returns, defer the next iteration to setTimeout.
    let deliveredAsync = false;
    const id = window.requestAnimationFrame?.(() => {
      if (!deliveredAsync) {
        rafId = null;
        clearDeferredFrame();
        deferredFrameTimer = window.setTimeout?.(() => {
          deferredFrameTimer = null;
          loop(next);
        }, 0) ?? null;
        return;
      }
      loop(next);
    }) ?? null;
    deliveredAsync = true;
    rafId = id;
  };

  const start = () => {
    if (disposed || running || reduceMotion() || documentHidden()) return;
    const eng = ensureEngine();
    if (!eng) return;
    running = true;
    canvas.hidden = false;
    eng.setColor(readAccent());
    eng.updateSize(window.innerWidth || 1, window.innerHeight || 1);
    loopToken += 1;
    const token = loopToken;
    if (rafId == null && deferredFrameTimer == null) {
      rafId = window.requestAnimationFrame?.(() => loop(token)) ?? null;
    }
  };

  const stop = () => {
    running = false;
    visible = false;
    loopToken += 1;
    clearIdleTimer();
    clearDeferredFrame();
    canvas.hidden = true;
    if (engine && engine !== false) engine.reset?.();
    if (rafId != null) window.cancelAnimationFrame?.(rafId);
    rafId = null;
  };

  const moveTo = (left, top, height = 18, width = 2) => {
    if (disposed || reduceMotion() || documentHidden()) {
      stop();
      return;
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      stop();
      return;
    }
    const eng = ensureEngine();
    if (!eng) return;
    start();
    visible = true;
    eng.setColor(readAccent());
    eng.updateCursorSize(width, height);
    eng.move(left, top);
    scheduleIdleStop();
  };

  const hide = () => {
    visible = false;
    stop();
  };

  const onResize = () => {
    if (!engine) return;
    engine.updateSize(window.innerWidth || 1, window.innerHeight || 1);
  };

  const onVisibility = () => {
    if (documentHidden()) stop();
  };

  window.addEventListener?.('resize', onResize, { passive: true });
  window.document?.addEventListener?.('visibilitychange', onVisibility);

  return Object.freeze({
    moveTo,
    hide,
    stop,
    isVisible: () => visible,
    isRunning: () => running,
    dispose() {
      disposed = true;
      stop();
      window.removeEventListener?.('resize', onResize);
      window.document?.removeEventListener?.('visibilitychange', onVisibility);
      engine = null;
    },
  });
}

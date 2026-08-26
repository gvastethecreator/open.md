/** JS copies of `--motion-*` in `styles.css`. Keep the values in lockstep. */
export const MOTION_FAST_MS = 140;
export const MOTION_BASE_MS = 200;
export const MOTION_SLOW_MS = 280;
export const MOTION_EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** Short off-screen exits. */
export const MOTION_EASE_EXIT = 'cubic-bezier(0.4, 0, 1, 1)';

export {
  APP_REDUCE_MOTION_CLASS,
  shouldReduceMotion,
} from './reader-preferences.js';
